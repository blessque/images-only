<?php
/**
 * justimages on ordinary shared hosting.
 *
 * Why this exists: a static folder of files cannot be listed by a browser, and the grid must
 * know every photograph's proportions BEFORE any of them load, or the page jumps about while
 * it fills in. Something has to produce that list. On Cloudflare that is the Worker; here it
 * is this file — the same job Aegea's PHP does on shared hosting.
 *
 * TWO MODES, chosen by whether config.php exists:
 *
 *   managed  — a MySQL database and the full admin panel. Drag photographs onto the page,
 *              press Option+\, everything the Cloudflare version does. Run install.php once.
 *   folder   — no database, no password. Drop photographs into photos/ by FTP and they
 *              appear. Ordered by filename; `-solo` and `-tight` set the density.
 *
 * Neither is a fork of the other. They differ only in where the list comes from, and the
 * client — the grid, the solver, the WebP pipeline, every pixel of layout — is identical and
 * unmodified in both. See docs/architecture/OVERVIEW.md.
 *
 * Requires PHP 8.0+. Folder mode additionally needs GD; managed mode needs PDO MySQL.
 */

declare(strict_types=1);

require_once __DIR__ . '/lib/http.php';
require_once __DIR__ . '/lib/db.php';

const SHELL = __DIR__ . '/index.html';

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// The owner's handbook. Routed before anything else because the catch-all at the bottom
// answers every unmatched GET with the gallery, and /help would otherwise be the gallery.
if ($path === '/help' || $path === '/help.html') {
    if (is_file(__DIR__ . '/help.html')) {
        send_file(__DIR__ . '/help.html', 'text/html; charset=utf-8', false);
        exit;
    }
}

if (is_configured()) {
    serve_managed($path, $method);
} else {
    serve_folder_mode($path);
}

/**
 * Database-backed mode: the admin panel, uploads, the lot.
 */
function serve_managed(string $path, string $method): void
{
    require_once __DIR__ . '/lib/api.php';

    if (handle_api($path, $method)) {
        return;
    }

    if (preg_match('#^/img/([a-f0-9]{16})/([A-Za-z0-9._-]+)$#', $path, $parts)) {
        if ($method !== 'GET' && $method !== 'HEAD') {
            json_response(['error' => 'Method not allowed'], 405);
            return;
        }
        serve_stored_image($parts[1] . '/' . $parts[2]);
        return;
    }

    if ($method !== 'GET' && $method !== 'HEAD') {
        json_response(['error' => 'Method not allowed'], 405);
        return;
    }

    // Soft-deleted photographs are purged after 30 days. Shared hosting may have no cron, and
    // a purge that never runs is a disk that fills silently — so it rides on ordinary traffic,
    // roughly once every hundred page views rather than on every one.
    if (random_int(1, 100) === 1) {
        purge_expired();
    }

    serve_shell(read_manifest(), SHELL);
}

/**
 * `/img/{id}/{rung}.webp` and `/img/{id}/full.{ext}`, straight off the disk.
 *
 * The bytes were encoded in the designer's browser before they were uploaded, so there is no
 * resizing here at all — that is the difference from folder mode, and the reason this path is
 * a file read and nothing more.
 */
function serve_stored_image(string $key): void
{
    $object = get_object($key);
    if ($object === null) {
        not_found();
        return;
    }

    $extension = strtolower((string) pathinfo($key, PATHINFO_EXTENSION));
    $type = PASSTHROUGH_TYPES[$extension] ?? 'application/octet-stream';

    // Safe ONLY because keys are immutable — "replace" mints a new id and put_object refuses
    // to overwrite. A mutated file behind this header is a stale image no purge can reach.
    send_file($object['path'], $type, true, $object['etag']);
}

/**
 * FTP mode: read photos/, measure, cache, serve. No database, no password, no install.
 */
function serve_folder_mode(string $path): void
{
    require_once __DIR__ . '/lib/folder.php';

    if (preg_match('#^/img/([a-f0-9]{16})/([A-Za-z0-9._-]+)$#', $path, $parts)) {
        serve_folder_image($parts[1], $parts[2], build_folder_manifest());
        return;
    }

    // The admin panel needs an API, and folder mode has none. Answering 404 rather than
    // falling through to the shell means the unlock dialog reports a clean failure instead
    // of trying to parse the HTML page as JSON.
    if (str_starts_with($path, '/api/')) {
        json_response(['error' => 'Folder mode — run install.php to enable the admin panel'], 404);
        return;
    }

    serve_shell(folder_manifest_for_client(build_folder_manifest()), SHELL);
}
