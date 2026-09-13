<?php
/**
 * The manifest, in MySQL — the PHP twin of worker/images.ts.
 *
 * Every row that reaches the client goes through to_item(), which casts explicitly. PDO can
 * return a DOUBLE as the string "1.5" depending on driver and PHP version, and `aspect` as a
 * string reaches the solver as NaN, which lays out a row of zero-width images. Casting here
 * means the JSON the client receives is the same shape D1 produces, whatever the driver did.
 */

declare(strict_types=1);

require_once __DIR__ . '/db.php';

const LIVE_COLUMNS = 'id, aspect, size_class, alt, max_rung, passthrough, format, sort_order';

function to_item(array $row): array
{
    return [
        'id' => (string) $row['id'],
        'aspect' => (float) $row['aspect'],
        'sizeClass' => (string) $row['size_class'],
        'alt' => (string) $row['alt'],
        'maxRung' => (int) $row['max_rung'],
        'passthrough' => (int) $row['passthrough'] === 1,
        'format' => (string) $row['format'],
    ];
}

/** @return array{images:array,settings:array{name:string,contact:string}} */
function read_manifest(): array
{
    $images = db()
        ->query('SELECT ' . LIVE_COLUMNS . ' FROM images WHERE deleted_at IS NULL ORDER BY sort_order ASC')
        ->fetchAll();

    $settings = ['name' => '', 'contact' => ''];
    foreach (db()->query('SELECT setting_key, setting_value FROM settings')->fetchAll() as $row) {
        if (array_key_exists($row['setting_key'], $settings)) {
            $settings[$row['setting_key']] = (string) $row['setting_value'];
        }
    }

    return ['images' => array_map('to_item', $images), 'settings' => $settings];
}

function next_sort_order(): int
{
    $row = db()->query('SELECT COALESCE(MAX(sort_order), 0) AS max_order FROM images')->fetch();
    return (int) ($row['max_order'] ?? 0) + 1;
}

/**
 * Throws on a duplicate id, and the caller turns that into a 409.
 *
 * The id is minted client-side — it has to be, because the upload keys are named with it
 * before this row exists — so a primary-key collision is representable. Astronomically
 * unlikely at 64 bits, but an uncaught constraint error surfaces as a 500, and a 500 on
 * upload is the one place a non-technical user has no idea what to do next.
 */
function insert_image(array $item, int $sortOrder, ?int $now = null): void
{
    db()->prepare(
        'INSERT INTO images (id, aspect, size_class, alt, max_rung, passthrough, format, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )->execute([
        $item['id'],
        $item['aspect'],
        $item['sizeClass'],
        $item['alt'],
        $item['maxRung'],
        $item['passthrough'] ? 1 : 0,
        $item['format'],
        $sortOrder,
        $now ?? now_ms(),
    ]);
}

function update_image(string $id, array $patch): bool
{
    $assignments = [];
    $values = [];

    if (array_key_exists('alt', $patch)) {
        $assignments[] = 'alt = ?';
        $values[] = $patch['alt'];
    }
    if (array_key_exists('sizeClass', $patch)) {
        $assignments[] = 'size_class = ?';
        $values[] = $patch['sizeClass'];
    }
    if ($assignments === []) {
        return false;
    }

    $values[] = $id;
    $statement = db()->prepare(
        'UPDATE images SET ' . implode(', ', $assignments) . ' WHERE id = ? AND deleted_at IS NULL'
    );
    $statement->execute($values);
    return $statement->rowCount() > 0;
}

/**
 * SOFT delete. The uploaded files are deliberately left in place — undo must be able to
 * bring the photograph back, and orphan bytes are cheap where a missing image is not.
 */
function soft_delete_image(string $id, ?int $now = null): bool
{
    $statement = db()->prepare('UPDATE images SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL');
    $statement->execute([$now ?? now_ms(), $id]);
    return $statement->rowCount() > 0;
}

function restore_image(string $id): bool
{
    $statement = db()->prepare('UPDATE images SET deleted_at = NULL WHERE id = ?');
    $statement->execute([$id]);
    return $statement->rowCount() > 0;
}

/**
 * Applies a whole ordering in ONE transaction.
 *
 * D1 has `batch()`; here it is an explicit transaction, for the same reason — a request that
 * dies half way through must not leave the gallery in an order nobody chose. Renumbering
 * beats fractional indexing at 200 items: one cheap statement each, and far easier to reason
 * about. See ADMIN_AUTH.md.
 */
function reorder_images(array $orderedIds): void
{
    if ($orderedIds === []) {
        return;
    }

    $pdo = db();
    $pdo->beginTransaction();
    try {
        $statement = $pdo->prepare('UPDATE images SET sort_order = ? WHERE id = ?');
        foreach ($orderedIds as $index => $id) {
            $statement->execute([$index + 1, $id]);
        }
        $pdo->commit();
    } catch (Throwable $error) {
        $pdo->rollBack();
        throw $error;
    }
}

function update_settings(array $patch): void
{
    $entries = array_filter(
        $patch,
        fn($value, $key) => is_string($value) && in_array($key, ['name', 'contact'], true),
        ARRAY_FILTER_USE_BOTH,
    );
    if ($entries === []) {
        return;
    }

    $statement = db()->prepare(
        'INSERT INTO settings (setting_key, setting_value) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)'
    );
    foreach ($entries as $key => $value) {
        $statement->execute([$key, $value]);
    }
}

/**
 * Purges images soft-deleted more than 30 days ago, bytes and all.
 *
 * Called opportunistically from the manifest read rather than from cron, because shared
 * hosting may not offer cron and a purge that never runs is a disk that fills up silently.
 */
function purge_expired(int $days = 30): void
{
    $cutoff = now_ms() - $days * 86400000;
    $statement = db()->prepare('SELECT id FROM images WHERE deleted_at IS NOT NULL AND deleted_at < ?');
    $statement->execute([$cutoff]);

    foreach ($statement->fetchAll() as $row) {
        delete_objects((string) $row['id']);
    }

    db()->prepare('DELETE FROM images WHERE deleted_at IS NOT NULL AND deleted_at < ?')->execute([$cutoff]);
}
