<?php
/**
 * justimages on ordinary shared hosting — upload photographs by dragging them into a folder.
 *
 * Why this exists: a static folder of files cannot be listed by a browser, and the grid must
 * know every photograph's proportions BEFORE any of them load, or the page jumps about while
 * it fills in. Something has to open the folder and measure the pictures. On Cloudflare that
 * is the Worker; here it is this file — the same job Aegea's PHP does on Hostinger.
 *
 * The whole client — the grid, the solver, every pixel of layout — is unchanged. This only
 * produces the list it reads.
 *
 * INSTALL: copy index.php, .htaccess and the assets/ folder to your web root. Make photos/
 * and cache/ writable. Drop photographs into photos/. That is all.
 *
 * Requires PHP 8.0+ with GD. Both are standard on every shared host worth using — 8.0 is
 * from 2020, and hosts that old are not ones to trust with someone's portfolio.
 */

declare(strict_types=1);

// ── Settings ─────────────────────────────────────────────────────────────────────────────
const PHOTOS_DIR = __DIR__ . '/photos';
const CACHE_DIR  = __DIR__ . '/cache';
const SHELL      = __DIR__ . '/index.html';
const SITE_FILE  = __DIR__ . '/site.txt';   // line 1: your name. line 2: your contact.

/** Long-edge sizes, matching src/lib/types.ts. Change here and the client follows. */
const RUNGS = [400, 800, 1600, 2400];

/** `end()` takes a reference, so it cannot be handed a constant directly. */
const TOP_RUNG = 2400;

/** Below this a photograph is served untouched — re-encoding it would only lose quality. */
const PASSTHROUGH_MAX_BYTES = 150000;

/** The top rung is the master you keep, so it is encoded better than the rest. */
const QUALITY = 82;
const QUALITY_TOP = 90;

const IMAGE_TYPES = [
    'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png',
    'webp' => 'image/webp', 'gif' => 'image/gif', 'avif' => 'image/avif',
];

// ── The list of photographs ──────────────────────────────────────────────────────────────

/**
 * Reads the folder and measures every picture in it.
 *
 * Cached to cache/manifest.json and rebuilt whenever the folder's modification time changes,
 * so the ordinary request does no work at all. Adding or removing a file changes that time;
 * editing one in place does not, which is why the id below includes the file's own mtime.
 */
function build_manifest(): array
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
        // is what keeps the year-long cache headers below safe. Keys are never reused.
        $id = substr(sha1($file . '|' . filemtime($path) . '|' . $bytes), 0, 16);

        $longEdge = max($width, $height);
        $available = array_values(array_filter(RUNGS, fn($r) => $r <= $longEdge));
        if (count($available) === 0) {
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
        if (isset(IMAGE_TYPES[strtolower((string) pathinfo($file, PATHINFO_EXTENSION))])) {
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

// ── Making the smaller copies ────────────────────────────────────────────────────────────

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

// ── Serving ──────────────────────────────────────────────────────────────────────────────

function send_file(string $path, string $type, bool $immutable): void
{
    header('Content-Type: ' . $type);
    header('Content-Length: ' . (string) filesize($path));
    header('Cache-Control: ' . ($immutable ? 'public, max-age=31536000, immutable' : 'no-cache'));
    readfile($path);
}

function not_found(): void
{
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    echo "Not found\n";
}

/** `/img/{id}/{rung}.webp` and `/img/{id}/full.{ext}` — built on first request, then cached. */
function serve_image(string $id, string $file, array $manifest): void
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
        send_file($source, IMAGE_TYPES[$image['format']] ?? 'application/octet-stream', true);
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

/** The shell, with the list inlined — the same trick the Worker uses, and the reason it is fast. */
function serve_shell(array $manifest): void
{
    $public = array_map(
        fn($image) => array_diff_key($image, ['source' => null]),
        $manifest['images'],
    );
    $json = json_encode(
        ['images' => array_values($public), 'settings' => $manifest['settings']],
        JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG,
    );

    $html = (string) file_get_contents(SHELL);
    $html = str_replace(
        '<script type="application/json" id="manifest"></script>',
        '<script type="application/json" id="manifest">' . $json . '</script>',
        $html,
    );

    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-cache');
    echo $html;
}

// ── Router ───────────────────────────────────────────────────────────────────────────────

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

if (preg_match('#^/img/([a-f0-9]{16})/([A-Za-z0-9._-]+)$#', $path, $parts)) {
    serve_image($parts[1], $parts[2], build_manifest());
    exit;
}

if ($path === '/help' || $path === '/help.html') {
    if (is_file(__DIR__ . '/help.html')) {
        send_file(__DIR__ . '/help.html', 'text/html; charset=utf-8', false);
        exit;
    }
}

serve_shell(build_manifest());
