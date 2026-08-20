<?php
/**
 * Where the admin credentials live — the PHP twin of worker/credentials.ts.
 *
 * One source here, not two: the Worker falls back to `ADMIN_PASSWORD_HASH` and
 * `TOKEN_SECRET` environment secrets because a deployment could predate the claim flow.
 * A PHP install has no such history and no secret store to fall back to, so the `auth`
 * table is the only answer. Its absence means the site is UNCLAIMED, which is a real state
 * a fresh install starts in — not an error.
 *
 * A separate table, not a `settings` row: read_manifest() selects settings and hand-picks
 * name and contact. Nothing leaks today, but a credential one careless refactor away from
 * the public manifest is the wrong place to keep it. See docs/architecture/ADMIN_AUTH.md.
 */

declare(strict_types=1);

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/auth.php';

/** @return array{passwordHash:string,tokenSecret:string}|null */
function read_credentials(): ?array
{
    if (!is_configured()) {
        return null;
    }

    try {
        $row = db()->query('SELECT password_hash, token_secret FROM auth WHERE id = 1')->fetch();
    } catch (PDOException) {
        // The table is missing, which means the schema was never installed. Unclaimed is the
        // honest answer, and it routes the visitor to the installer instead of a 500.
        return null;
    }

    if (!is_array($row) || $row === []) {
        return null;
    }

    return [
        'passwordHash' => (string) $row['password_hash'],
        'tokenSecret' => (string) $row['token_secret'],
    ];
}

/**
 * Claims the site, once and only once.
 *
 * The PRIMARY KEY on id does the work `CHECK (id = 1)` does in D1: two simultaneous claims
 * cannot both succeed however this function is written, because the second INSERT is a
 * duplicate key. The race is closed by the database, not by the check above it.
 *
 * @return array{passwordHash:string,tokenSecret:string}|null null when already claimed
 */
function claim_site(string $password): ?array
{
    $credentials = [
        'passwordHash' => hash_password($password),
        // 64 hex characters. The Worker concatenates two UUIDs for the same ~256 bits of
        // entropy; the shape differs, the strength does not.
        'tokenSecret' => bin2hex(random_bytes(32)),
    ];

    try {
        db()->prepare(
            'INSERT INTO auth (id, password_hash, token_secret, claimed_at) VALUES (1, ?, ?, ?)'
        )->execute([$credentials['passwordHash'], $credentials['tokenSecret'], now_ms()]);
    } catch (PDOException) {
        return null;
    }

    return $credentials;
}

/**
 * Every write route calls this ITSELF.
 *
 * Not shared middleware you can forget to apply — a route added outside a guarded group is a
 * silent, invisible hole. ADMIN_AUTH.md requires a per-route test asserting a forged token is
 * rejected, and php/tests covers each one separately for exactly that reason.
 */
function require_auth(): bool
{
    $credentials = read_credentials();
    if ($credentials === null) {
        return false; // unclaimed: there is no session anyone could hold
    }
    return verify_token($credentials['tokenSecret'], bearer_from_request()) !== null;
}
