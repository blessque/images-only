<?php
/**
 * Where image bytes live — the filesystem backend of worker/storage.ts.
 *
 * That file says adding a third backend "means implementing them again and nothing else",
 * and this is that: two functions, no other part of the port knows how bytes are stored.
 *
 * Keys are IMMUTABLE, exactly as on R2 and KV: `{id}/{rung}.webp` or `{id}/full.{ext}`, and
 * "replace image" mints a new id rather than rewriting one. That is the whole reason the
 * year-long immutable cache header is safe, so overwriting is refused below rather than
 * merely avoided by convention — a mutated file behind that header is a stale image no
 * purge can reach, on an unknown number of client caches.
 */

declare(strict_types=1);

require_once __DIR__ . '/http.php';

function uploads_dir(): string
{
    return dirname(__DIR__) . '/uploads';
}

/**
 * Turns a validated key into an absolute path.
 *
 * The id is already matched against `[a-f0-9]{16}` by the router before it gets here. This
 * re-checks anyway: the cost is a regex, and the failure mode it prevents is a path traversal
 * that writes anywhere the webserver can reach.
 *
 * The extension is a WHITELIST, not a character class. `full\.[a-z0-9]{1,5}` reads like a
 * file extension and accepts `full.php` — which on shared hosting means an authenticated
 * upload can drop executable code into the web root, and .htaccess denying uploads/ is one
 * misconfigured server away from not saving you. The test suite caught exactly this.
 *
 * Rungs are checked against the ladder for the same reason the Worker does it: a key naming a
 * width we never serve is a file nothing will ever read.
 */
function object_path(string $key): ?string
{
    if (!preg_match('#^([a-f0-9]{16})/(\d+)\.webp$#', $key, $ladder)) {
        if (!preg_match('#^([a-f0-9]{16})/full\.([a-z0-9]{2,4})$#', $key, $full)) {
            return null;
        }
        if (!array_key_exists($full[2], PASSTHROUGH_TYPES)) {
            return null;
        }
        return uploads_dir() . '/' . $full[1] . '/full.' . $full[2];
    }

    if (!in_array((int) $ladder[2], RUNGS, true)) {
        return null;
    }
    return uploads_dir() . '/' . $ladder[1] . '/' . $ladder[2] . '.webp';
}

/** @return array{path:string,etag:string}|null */
function get_object(string $key): ?array
{
    $path = object_path($key);
    if ($path === null || !is_file($path)) {
        return null;
    }

    // Derived from the key, like the KV backend, and truthful for the same reason: a key is
    // written once and identifies its bytes for ever.
    return ['path' => $path, 'etag' => 'W/"' . $key . '"'];
}

function object_exists(string $key): bool
{
    $path = object_path($key);
    return $path !== null && is_file($path);
}

/**
 * Writes bytes under a key, refusing to replace an existing one.
 *
 * Written to a temporary name and renamed, because rename() is atomic on the same
 * filesystem: a request that dies mid-write leaves no half-file for the next reader to
 * serve as a truncated image.
 */
function put_object(string $key, string $bytes): bool
{
    $path = object_path($key);
    if ($path === null || is_file($path)) {
        return false;
    }

    $dir = dirname($path);
    if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
        return false;
    }

    $temp = $path . '.' . bin2hex(random_bytes(4)) . '.part';
    if (file_put_contents($temp, $bytes) === false) {
        return false;
    }
    if (!rename($temp, $path)) {
        @unlink($temp);
        return false;
    }

    return true;
}

/**
 * Deletes every object belonging to an id.
 *
 * Used ONLY by the 30-day purge, never by the delete button: deletes are soft, and undo has
 * to be able to bring the photograph back. Orphan bytes are cheap and invisible; a restored
 * row pointing at deleted files is a broken image the owner cannot fix.
 */
function delete_objects(string $id): void
{
    if (!preg_match('/^[a-f0-9]{16}$/', $id)) {
        return;
    }
    $dir = uploads_dir() . '/' . $id;
    foreach (glob($dir . '/*') ?: [] as $file) {
        @unlink($file);
    }
    @rmdir($dir);
}

/** Whether uploads/ is usable at all — reported by the installer, not discovered at 2am. */
function uploads_writable(): bool
{
    $dir = uploads_dir();
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }
    return is_dir($dir) && is_writable($dir);
}
