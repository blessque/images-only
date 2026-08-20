<?php
/**
 * Folder mode: photographs read from photos/, dropped in by FTP.
 *
 * This is the original PHP pathway, moved out of index.php unchanged when the database-backed
 * mode arrived. It stays because it is genuinely the simpler thing: no database, no password,
 * no install step — the filename is the interface, and an FTP client is a Finder window.
 *
 * A site runs in this mode whenever there is no config.php. See php/lib/db.php.
 *
 * Requires PHP 8.0+ with GD.
 */

declare(strict_types=1);

require_once __DIR__ . '/http.php';

const PHOTOS_DIR = __DIR__ . '/../photos';
const CACHE_DIR  = __DIR__ . '/../cache';
const SITE_FILE  = __DIR__ . '/../site.txt';   // line 1: your name. line 2: your contact.

/** Below this a photograph is served untouched — re-encoding it would only lose quality. */
const PASSTHROUGH_MAX_BYTES = 150000;

/** The top rung is the master you keep, so it is encoded better than the rest. */
const QUALITY = 82;
const QUALITY_TOP = 90;

/**
 * Reads the folder and measures every picture in it.
 *
 * Cached to cache/manifest.json and rebuilt whenever the folder's modification time changes,
 * so the ordinary request does no work at all. Adding or removing a file changes that time;
 * editing one in place does not, which is why the id below includes the file's own mtime.
 */
function build_folder_manifest(): array
{
    $cache = CACHE_DIR . '/manifest.json';
    $stamp = is_dir(PHOTOS_DIR) ? (string) filemtime(PHOTOS_DIR) : '0';

    if (is_file($cache)) {
        $cached = json_decode((string) file_get_contents($cache), true);
        if (is_array($cached) && ($cached['stamp'] ?? null) === $stamp) {
            return $cached;
        }
    }

    $images = [];
    foreach (list_photos() as $file) {
        $path = PHOTOS_DIR . '/' . $file;
        $size = @getimagesize($path);
        if ($size === false || $size[0] < 1 || $size[1] < 1) {
            continue; // not an image we can measure; silently skipped rather than fatal
        }

        [$width, $height] = $size;
        $bytes = (int) filesize($path);
        $extension = strtolower((string) pathinfo($file, PATHINFO_EXTENSION));

        // Includes mtime and size, so editing a photograph in place mints a NEW id — which
        // is what keeps the year-long cache headers safe. Keys are never reused.
        $id = substr(sha1($file . '|' . filemtime($path) . '|' . $bytes), 0, 16);

        $longEdge = max($width, $height);
        $available = array_values(array_filter(RUNGS, fn($rung) => $rung <= $longEdge));
        if ($available === []) {
            $available = [RUNGS[0]];
        }

        // An animated GIF must never go through the resizer: it would come out as one frame.
        $animated = $extension === 'gif' && is_animated_gif($path);
        $passthrough = $bytes <= PASSTHROUGH_MAX_BYTES || $animated;

        $images[] = [
            'id' => $id,
            'aspect' => round($width / $height, 6),
            'sizeClass' => class_from_name($file),
            'alt' => alt_from_name($file),
            'maxRung' => (int) end($available),
            'passthrough' => $passthrough,
            'format' => $passthrough ? ($extension === 'jpeg' ? 'jpg' : $extension) : 'webp',
            'source' => $file, // ours only; stripped before the client sees it
        ];
    }

    $manifest = ['stamp' => $stamp, 'images' => $images, 'settings' => read_site()];

    if (!is_dir(CACHE_DIR)) {
        @mkdir(CACHE_DIR, 0775, true);
    }
    @file_put_contents($cache, json_encode($manifest));

    return $manifest;
}

/** Sorted by filename, so `01-`, `02-` prefixes are how you order the gallery. */
function list_photos(): array
{
    if (!is_dir(PHOTOS_DIR)) {
        return [];
    }
    $files = [];
    foreach (scandir(PHOTOS_DIR) ?: [] as $file) {
        if ($file[0] === '.') {
            continue;
        }
        if (array_key_exists(strtolower((string) pathinfo($file, PATHINFO_EXTENSION)), PASSTHROUGH_TYPES)) {
            $files[] = $file;
        }
    }
    natcasesort($files);
    return array_values($files);
}

/**
 * Size class from the filename: `sunset-solo.jpg`, `pair-tight.jpg`.
 *
 * Not a size — it decides how many photographs share a row. `solo` takes a whole row alone.
 * Default is `wide`, which is the middle and the one you want most of the time.
 */
function class_from_name(string $file): string
{
    $name = strtolower((string) pathinfo($file, PATHINFO_FILENAME));
    foreach (['solo', 'tight'] as $class) {
        if (preg_match('/(^|[-_ ])' . $class . '$/', $name)) {
            return $class;
        }
    }
    return 'wide';
}

/** `01_Sunrise-over-the-bay-solo.jpg` -> "Sunrise over the bay". A camera dump gives "". */
function alt_from_name(string $file): string
{
    $name = (string) pathinfo($file, PATHINFO_FILENAME);
    $name = preg_replace('/^\d+[-_. ]+/', '', $name) ?? $name;             // ordering prefix
    $name = preg_replace('/[-_ ](solo|wide|tight)$/i', '', $name) ?? $name; // class suffix
    $name = trim((string) preg_replace('/[-_]+/', ' ', $name));

    // IMG_4821, DSC00193 and friends are noise, and noise is worse than an empty alt.
    if ($name === '' || preg_match('/^(img|dsc|dscn|p|pxl|screenshot)[\s_-]*\d+$/i', $name)) {
        return '';
    }
    return ucfirst($name);
}

/** Your name and contact line, the only text on the site. Edit site.txt to change them. */
function read_site(): array
{
    $name = '';
    $contact = '';
    if (is_file(SITE_FILE)) {
        $lines = file(SITE_FILE, FILE_IGNORE_NEW_LINES) ?: [];
        $name = trim($lines[0] ?? '');
        $contact = trim($lines[1] ?? '');
    }
    return ['name' => $name, 'contact' => $contact];
}

function is_animated_gif(string $path): bool
{
    $contents = (string) file_get_contents($path);
    return substr_count($contents, "\x00\x21\xF9\x04") > 1;
}

function load_image(string $path, string $extension)
{
    return match ($extension) {
        'jpg', 'jpeg' => @imagecreatefromjpeg($path),
        'png' => @imagecreatefrompng($path),
        'webp' => @imagecreatefromwebp($path),
        'gif' => @imagecreatefromgif($path),
        default => false,
    };
}

/**
 * Halves repeatedly before the final step.
 *
 * Going from 6000px to 400px in one jump samples too sparsely and fine detail turns to
 * shimmer — which on a photography portfolio reads as a bad photograph rather than a bad
 * resize. The client-side pipeline does the same thing for the same reason.
 */
function resize_to(string $source, string $destination, int $rung, bool $top): bool
{
    $extension = strtolower((string) pathinfo($source, PATHINFO_EXTENSION));
    $image = load_image($source, $extension);
    if ($image === false) {
        return false;
    }

    $width = imagesx($image);
    $height = imagesy($image);
    $scale = $rung / max($width, $height);
    if ($scale >= 1) {
        $scale = 1.0; // never upscale: inventing pixels ships bytes carrying no information
    }

    $targetW = max(1, (int) round($width * $scale));
    $targetH = max(1, (int) round($height * $scale));

    while (imagesx($image) > $targetW * 2 && imagesy($image) > $targetH * 2) {
        $half = imagescale($image, (int) (imagesx($image) / 2), -1, IMG_BICUBIC);
        if ($half === false) {
            break;
        }
        imagedestroy($image);
        $image = $half;
    }

    $final = imagescale($image, $targetW, $targetH, IMG_BICUBIC);
    if ($final !== false) {
        imagedestroy($image);
        $image = $final;
    }

    @mkdir(dirname($destination), 0775, true);
    $ok = function_exists('imagewebp')
        ? imagewebp($image, $destination, $top ? QUALITY_TOP : QUALITY)
        : imagejpeg($image, $destination, $top ? QUALITY_TOP : QUALITY);
    imagedestroy($image);

    return $ok;
}

/** `/img/{id}/{rung}.webp` and `/img/{id}/full.{ext}` — built on first request, then cached. */
function serve_folder_image(string $id, string $file, array $manifest): void
{
    $image = null;
    foreach ($manifest['images'] as $candidate) {
        if ($candidate['id'] === $id) {
            $image = $candidate;
            break;
        }
    }
    if ($image === null) {
        not_found();
        return;
    }

    $source = PHOTOS_DIR . '/' . $image['source'];
    if (!is_file($source)) {
        not_found();
        return;
    }

    if (str_starts_with($file, 'full.')) {
        send_file($source, PASSTHROUGH_TYPES[$image['format']] ?? 'application/octet-stream', true);
        return;
    }

    if (!preg_match('/^(\d+)\.webp$/', $file, $matches)) {
        not_found();
        return;
    }
    $rung = (int) $matches[1];
    if (!in_array($rung, RUNGS, true) || $rung > $image['maxRung']) {
        not_found();
        return;
    }

    $cached = CACHE_DIR . '/' . $id . '/' . $rung . '.webp';
    if (!is_file($cached) && !resize_to($source, $cached, $rung, $rung === TOP_RUNG)) {
        not_found();
        return;
    }

    send_file($cached, function_exists('imagewebp') ? 'image/webp' : 'image/jpeg', true);
}

/** The client never sees `source` — it is our bookkeeping, not part of the manifest. */
function folder_manifest_for_client(array $manifest): array
{
    $public = array_map(
        fn($image) => array_diff_key($image, ['source' => null]),
        $manifest['images'],
    );
    return ['images' => array_values($public), 'settings' => $manifest['settings']];
}
