<?php
/**
 * The write API — the PHP twin of the router and handlers in worker/index.ts.
 *
 * The client is UNCHANGED. src/ and src/admin/ talk to these eleven URLs and know nothing
 * about what answers them, which is the whole reason this port is possible at all: the
 * grid, the upload tray and the WebP pipeline are already server-agnostic.
 *
 * Compression is not implemented here and never will be. It happens in the browser, in a
 * Web Worker, before a byte leaves the designer's Mac — this file receives variants that are
 * already encoded. See docs/architecture/IMAGE_PIPELINE.md.
 */

declare(strict_types=1);

require_once __DIR__ . '/http.php';
require_once __DIR__ . '/manifest.php';
require_once __DIR__ . '/credentials.php';
require_once __DIR__ . '/ratelimit.php';
require_once __DIR__ . '/store.php';

function unauthorized(): void
{
    json_response(['error' => 'Unauthorized'], 401);
}

/**
 * @return bool true when the request was an API route and has been answered
 */
function handle_api(string $path, string $method): bool
{
    if (!str_starts_with($path, '/api/')) {
        return false;
    }

    if ($path === '/api/images' && $method === 'GET') {
        json_response(read_manifest(), 200, ['Cache-Control' => 'no-cache']);
        return true;
    }
    if ($path === '/api/setup' && ($method === 'GET' || $method === 'POST')) {
        handle_setup($method);
        return true;
    }
    if ($path === '/api/login' && $method === 'POST') {
        handle_login();
        return true;
    }
    if ($path === '/api/images' && $method === 'POST') {
        handle_create();
        return true;
    }
    if ($path === '/api/reorder' && $method === 'POST') {
        handle_reorder();
        return true;
    }
    if ($path === '/api/settings' && $method === 'PATCH') {
        handle_settings();
        return true;
    }
    if (str_starts_with($path, '/api/upload/') && $method === 'PUT') {
        handle_upload(substr($path, strlen('/api/upload/')));
        return true;
    }
    if (preg_match('#^/api/images/([a-f0-9]{16})$#', $path, $parts)) {
        if ($method === 'PATCH') {
            handle_patch($parts[1]);
            return true;
        }
        if ($method === 'DELETE') {
            handle_delete($parts[1]);
            return true;
        }
    }
    if (preg_match('#^/api/images/([a-f0-9]{16})/restore$#', $path, $parts) && $method === 'POST') {
        handle_restore($parts[1]);
        return true;
    }

    json_response(['error' => 'Not found'], 404);
    return true;
}

function handle_login(): void
{
    $key = client_key();

    // Counted BEFORE the password is checked, so a flood of guesses cannot outrun it.
    $limit = register_attempt($key);
    if (!$limit['allowed']) {
        json_response(['error' => 'Too many attempts'], 429, [
            'Retry-After' => (string) $limit['retryAfterSeconds'],
        ]);
        return;
    }

    $body = read_json_body();
    if ($body === null) {
        json_response(['error' => 'Bad request'], 400);
        return;
    }

    // An unclaimed site has no password to be wrong. Saying so is not a leak — GET
    // /api/setup reports the same to anyone — and without it the owner meets "Incorrect
    // password" on a site that never had one.
    $credentials = read_credentials();
    if ($credentials === null) {
        json_response(['error' => 'Not set up', 'setupRequired' => true], 409);
        return;
    }

    $password = is_string($body['password'] ?? null) ? $body['password'] : '';
    if (!verify_password($password, $credentials['passwordHash'])) {
        json_response(['error' => 'Incorrect password', 'remaining' => $limit['remaining']], 401);
        return;
    }

    clear_attempts($key);
    json_response(['token' => sign_token($credentials['tokenSecret'])]);
}

/**
 * First-run claim. Normally already done by install.php, which sets the password while the
 * owner is looking at it — this remains for the reset path, where the auth row is deleted in
 * phpMyAdmin and the site is claimed again from the page. Clicking, not a terminal, which is
 * the point: the person who forgets the password is the person who cannot use a CLI.
 */
function handle_setup(string $method): void
{
    $config = load_config() ?? [];
    $setupCode = is_string($config['setupCode'] ?? null) ? $config['setupCode'] : '';

    if ($method === 'GET') {
        json_response([
            'claimed' => read_credentials() !== null,
            'codeRequired' => $setupCode !== '',
            'minPasswordLength' => MIN_PASSWORD_LENGTH,
        ]);
        return;
    }

    // Its own key: a claim attempt is not a login attempt, and sharing the counter would let
    // a failed claim lock the owner out of a login, or the reverse.
    $key = 'setup:' . client_key();
    $limit = register_attempt($key);
    if (!$limit['allowed']) {
        json_response(['error' => 'Too many attempts'], 429, [
            'Retry-After' => (string) $limit['retryAfterSeconds'],
        ]);
        return;
    }

    $body = read_json_body();
    if ($body === null) {
        json_response(['error' => 'Bad request'], 400);
        return;
    }

    if (read_credentials() !== null) {
        json_response(['error' => 'Already set up'], 409);
        return;
    }

    $code = is_string($body['code'] ?? null) ? $body['code'] : '';
    if ($setupCode !== '' && !hash_equals($setupCode, $code)) {
        json_response(['error' => 'Wrong setup code', 'remaining' => $limit['remaining']], 401);
        return;
    }

    $password = is_string($body['password'] ?? null) ? $body['password'] : '';
    if (strlen($password) < MIN_PASSWORD_LENGTH) {
        json_response(['error' => 'Use at least ' . MIN_PASSWORD_LENGTH . ' characters'], 400);
        return;
    }

    $credentials = claim_site($password);
    if ($credentials === null) {
        json_response(['error' => 'Already set up'], 409);
        return;
    }

    clear_attempts($key);
    json_response(['token' => sign_token($credentials['tokenSecret'])]);
}

function handle_upload(string $variant): void
{
    if (!require_auth()) {
        unauthorized();
        return;
    }

    // Measured on the ACTUAL bytes, not on a client-supplied content-length header — the
    // header is a claim, and this is the thing the limit is supposed to be about.
    $bytes = file_get_contents('php://input');
    if (!is_string($bytes) || $bytes === '') {
        json_response(['error' => 'Empty body'], 400);
        return;
    }
    if (strlen($bytes) > MAX_UPLOAD_BYTES) {
        // Named, and with the way out: the person who hits this is uploading an untouched
        // original, and "Too large" alone does not say that unchecking one box fixes it.
        $limit = (int) round(MAX_UPLOAD_BYTES / 1024 / 1024);
        json_response(['error' => "Larger than the {$limit}MB storage limit — compress this one"], 413);
        return;
    }

    // put_object validates the key shape and REFUSES to overwrite, so a variant can only be
    // written under a key that is subsequently readable, and only once.
    if (!put_object($variant, $bytes)) {
        $reason = object_exists($variant) ? 'Already uploaded' : 'Bad variant';
        json_response(['error' => $reason], object_exists($variant) ? 409 : 400);
        return;
    }

    json_response(['ok' => true]);
}

function handle_create(): void
{
    if (!require_auth()) {
        unauthorized();
        return;
    }

    $body = read_json_body();
    if ($body === null) {
        json_response(['error' => 'Bad request'], 400);
        return;
    }

    $id = is_string($body['id'] ?? null) && preg_match('/^[a-f0-9]{16}$/', $body['id']) ? $body['id'] : null;
    $aspect = is_numeric($body['aspect'] ?? null) && (float) $body['aspect'] > 0 ? (float) $body['aspect'] : null;
    $sizeClass = in_array($body['sizeClass'] ?? null, VALID_CLASSES, true) ? $body['sizeClass'] : null;

    $passthrough = ($body['passthrough'] ?? null) === true;
    $format = is_string($body['format'] ?? null) ? $body['format'] : 'webp';
    // A passthrough may be any format we can serve; a ladder is ALWAYS webp.
    $formatOk = $passthrough ? array_key_exists($format, PASSTHROUGH_TYPES) : $format === 'webp';
    // maxRung is meaningless for a passthrough — there is no ladder — so it is not required.
    $maxRung = in_array($body['maxRung'] ?? null, RUNGS, true) ? (int) $body['maxRung'] : null;

    if ($id === null || $aspect === null || $sizeClass === null || !$formatOk || (!$passthrough && $maxRung === null)) {
        json_response(['error' => 'Invalid image'], 400);
        return;
    }

    $item = [
        'id' => $id,
        'aspect' => $aspect,
        'sizeClass' => $sizeClass,
        'alt' => is_string($body['alt'] ?? null) ? mb_substr($body['alt'], 0, 500) : '',
        'maxRung' => $maxRung ?? RUNGS[0],
        'passthrough' => $passthrough,
        'format' => $format,
    ];

    // Metadata is written LAST, after every rung has landed — so an abandoned upload leaves
    // orphan bytes (invisible, cheap) rather than a manifest row pointing at nothing.
    try {
        insert_image($item, next_sort_order());
    } catch (PDOException $error) {
        if ($error->getCode() === '23000') {
            json_response(['error' => 'Image id already exists'], 409);
            return;
        }
        throw $error;
    }

    json_response(['ok' => true, 'image' => $item], 201);
}

function handle_patch(string $id): void
{
    if (!require_auth()) {
        unauthorized();
        return;
    }

    $body = read_json_body();
    if ($body === null) {
        json_response(['error' => 'Bad request'], 400);
        return;
    }

    $patch = [];
    if (is_string($body['alt'] ?? null)) {
        $patch['alt'] = mb_substr($body['alt'], 0, 500);
    }
    if (in_array($body['sizeClass'] ?? null, VALID_CLASSES, true)) {
        $patch['sizeClass'] = $body['sizeClass'];
    }

    update_image($id, $patch)
        ? json_response(['ok' => true])
        : json_response(['error' => 'Not found'], 404);
}

function handle_delete(string $id): void
{
    if (!require_auth()) {
        unauthorized();
        return;
    }
    soft_delete_image($id)
        ? json_response(['ok' => true])
        : json_response(['error' => 'Not found'], 404);
}

function handle_restore(string $id): void
{
    if (!require_auth()) {
        unauthorized();
        return;
    }
    restore_image($id)
        ? json_response(['ok' => true])
        : json_response(['error' => 'Not found'], 404);
}

function handle_reorder(): void
{
    if (!require_auth()) {
        unauthorized();
        return;
    }

    $body = read_json_body();
    $ids = $body['ids'] ?? null;
    if (!is_array($ids) || array_filter($ids, fn($id) => !is_string($id)) !== []) {
        json_response(['error' => 'Invalid order'], 400);
        return;
    }

    reorder_images(array_values($ids));
    json_response(['ok' => true]);
}

function handle_settings(): void
{
    if (!require_auth()) {
        unauthorized();
        return;
    }

    $body = read_json_body();
    if ($body === null) {
        json_response(['error' => 'Bad request'], 400);
        return;
    }

    $patch = [];
    foreach (['name', 'contact'] as $field) {
        if (is_string($body[$field] ?? null)) {
            $patch[$field] = mb_substr($body[$field], 0, 200);
        }
    }

    update_settings($patch);
    json_response(['ok' => true]);
}
