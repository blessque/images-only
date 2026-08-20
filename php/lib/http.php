<?php
/**
 * Responses, and the constants both modes share.
 *
 * "Both modes" is the shape of this port: with a config.php the site is database-backed and
 * has the admin panel; without one it reads photos/ over FTP, exactly as before. Neither is
 * a fork of the other — they differ only in where the list of photographs comes from, and
 * everything below is common ground.
 */

declare(strict_types=1);

/** Long-edge sizes, matching VARIANT_WIDTHS in src/lib/types.ts. */
const RUNGS = [400, 800, 1600, 2400];

/** The top rung is the de-facto master, so it is encoded better than the rest. */
const TOP_RUNG = 2400;

const IMMUTABLE = 'public, max-age=31536000, immutable';

/**
 * Formats a passthrough may be stored as, and the content type each is served with.
 *
 * A passthrough is the SOURCE bytes, so it is whatever the designer dropped in — serving a
 * JPEG under image/webp would be a lie the browser mostly tolerates and some tools do not.
 */
const PASSTHROUGH_TYPES = [
    'webp' => 'image/webp',
    'jpg' => 'image/jpeg',
    'jpeg' => 'image/jpeg',
    'png' => 'image/png',
    'avif' => 'image/avif',
    'gif' => 'image/gif',
];

const VALID_CLASSES = ['solo', 'wide', 'tight'];

/**
 * Sized to match the Worker, whose own limit is set by Workers KV's 25 MiB value ceiling.
 *
 * Nothing on a filesystem needs this cap, but a photograph that uploads here and is rejected
 * by Cloudflare would make the two pathways disagree about what a valid gallery is — and the
 * export/import tooling moves galleries between them.
 *
 * Requires upload_max_filesize and post_max_size at 24M or more in php.ini; the installer
 * checks and says so, rather than letting a large upload fail with an empty body.
 */
const MAX_UPLOAD_BYTES = 25165824; // 24 MiB

function json_response(mixed $body, int $status = 200, array $headers = []): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    foreach ($headers as $name => $value) {
        header($name . ': ' . $value);
    }
    echo json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
}

/** @return array|null null when the body is absent or not an object */
function read_json_body(): ?array
{
    $raw = file_get_contents('php://input');
    if (!is_string($raw) || $raw === '') {
        return null;
    }
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : null;
}

function send_file(string $path, string $type, bool $immutable, string $etag = ''): void
{
    // A conditional request costs a stat and saves the whole body. Variants are immutable,
    // so this fires constantly once a visitor has scrolled the gallery once.
    if ($etag !== '') {
        header('ETag: ' . $etag);
        if (($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag) {
            http_response_code(304);
            return;
        }
    }

    header('Content-Type: ' . $type);
    header('Content-Length: ' . (string) filesize($path));
    header('Cache-Control: ' . ($immutable ? IMMUTABLE : 'no-cache'));
    readfile($path);
}

function not_found(): void
{
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    echo "Not found\n";
}

/**
 * The shell, with the manifest inlined — the trick that kills the
 * load-JS -> fetch-manifest -> layout -> fetch-images waterfall.
 *
 * `<` MUST be escaped. Alt text is user-controlled, so a caption containing `</script>`
 * would otherwise close the tag and turn a photo caption into script injection. JSON treats
 * < as identical to `<`, so nothing downstream needs to know.
 */
function serve_shell(array $manifest, string $shellPath): void
{
    // JSON_HEX_TAG turns < into < inside the JSON, which is what stops it. Doing this
    // with str_replace after the fact is the classic way to write a no-op by accident.
    $json = (string) json_encode(
        $manifest,
        JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG,
    );

    $html = (string) file_get_contents($shellPath);
    $html = str_replace(
        '<script type="application/json" id="manifest"></script>',
        '<script type="application/json" id="manifest">' . $json . '</script>',
        $html,
    );

    header('Content-Type: text/html; charset=utf-8');
    // The manifest changes whenever he uploads, so the document must always be revalidated.
    // The hashed JS and CSS it points at are immutable, so this is cheap.
    header('Cache-Control: no-cache');
    echo $html;
}
