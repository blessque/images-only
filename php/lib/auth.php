<?php
/**
 * Password verification and session tokens — the PHP twin of worker/auth.ts.
 *
 * Byte-for-byte compatible with the Worker on purpose. Same PBKDF2 parameters, same
 * `pbkdf2$iterations$salt$hash` serialisation, same base64url, same HMAC token layout. A
 * password hash written by Cloudflare verifies here and vice versa, which is what lets a
 * gallery move between the two without the owner choosing a new password.
 *
 * No dependency: hash_pbkdf2, hash_hmac and hash_equals are PHP built-ins.
 *
 * See docs/architecture/ADMIN_AUTH.md — several rules in it are load-bearing and are
 * restated at the code they constrain.
 */

declare(strict_types=1);

/**
 * Matched to the Worker, NOT to what PHP could afford.
 *
 * The Workers runtime hard-caps PBKDF2 at 100,000 iterations — above it `deriveBits` throws
 * and the login endpoint dies at the edge. PHP has no such ceiling and would happily run
 * OWASP's 600,000. Raising it here anyway would produce hashes Cloudflare cannot verify,
 * silently breaking the move between pathways, so the cap travels with the format.
 *
 * The count lives inside each stored hash, so a future change affects only new hashes.
 */
const PBKDF2_ITERATIONS = 100000;

/** The only credential guarding the site, and account recovery is deliberately unbuilt. */
const MIN_PASSWORD_LENGTH = 12;

/** Two hours, matching TOKEN_TTL_MS. Reload clears it anyway — the token is never stored. */
const TOKEN_TTL_MS = 7200000;

function base64url_encode(string $bytes): string
{
    return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
}

function base64url_decode(string $value): string
{
    $padded = strtr($value, '-_', '+/');
    return (string) base64_decode($padded . str_repeat('=', (4 - strlen($padded) % 4) % 4), true);
}

/**
 * Serialised as `pbkdf2$<iterations>$<salt>$<hash>`, so the cost factor travels with it.
 *
 * 16-byte salt, 32-byte derived key, SHA-256 — the exact shape crypto.subtle.deriveBits
 * produces at 256 bits in worker/auth.ts.
 */
function hash_password(string $password, ?string $salt = null, int $iterations = PBKDF2_ITERATIONS): string
{
    $salt ??= random_bytes(16);
    $derived = hash_pbkdf2('sha256', $password, $salt, $iterations, 32, true);
    return 'pbkdf2$' . $iterations . '$' . base64url_encode($salt) . '$' . base64url_encode($derived);
}

function verify_password(string $password, string $stored): bool
{
    $parts = explode('$', $stored);
    if (count($parts) !== 4 || $parts[0] !== 'pbkdf2') {
        return false;
    }

    $iterations = (int) $parts[1];
    if ($iterations < 1 || $parts[2] === '' || $parts[3] === '') {
        return false;
    }

    $derived = hash_pbkdf2('sha256', $password, base64url_decode($parts[2]), $iterations, 32, true);

    // hash_equals is the constant-time primitive. Timing attacks across a network are
    // marginal in practice, but the correct one costs nothing and the wrong one is a
    // permanent footnote.
    return hash_equals(base64url_decode($parts[3]), $derived);
}

// ── Session tokens ───────────────────────────────────────────────────────────────────────
//
// base64url(payload).base64url(signature). Deliberately NOT a JWT: one issuer, one audience,
// one algorithm — a header announcing which algorithm to trust would be pure attack surface
// (`alg: none` and friends).

function sign_token(string $secret, int $ttlMs = TOKEN_TTL_MS, ?int $now = null): string
{
    $now ??= now_ms();
    // JSON_UNESCAPED_SLASHES so the body matches JS JSON.stringify byte for byte — a token
    // signed by the Worker must verify here, and the signature covers the encoded payload.
    $body = base64url_encode((string) json_encode(['exp' => $now + $ttlMs], JSON_UNESCAPED_SLASHES));
    return $body . '.' . base64url_encode(hash_hmac('sha256', $body, $secret, true));
}

/**
 * Returns the payload, or null. Never throws — a malformed token is simply not a token, and
 * letting a parse error escape into a route handler is how a 500 becomes an oracle.
 */
function verify_token(string $secret, ?string $token, ?int $now = null): ?array
{
    $now ??= now_ms();
    if ($token === null || $token === '') {
        return null;
    }

    $parts = explode('.', $token);
    if (count($parts) !== 2 || $parts[0] === '' || $parts[1] === '') {
        return null;
    }

    $expected = hash_hmac('sha256', $parts[0], $secret, true);
    if (!hash_equals($expected, base64url_decode($parts[1]))) {
        return null;
    }

    $payload = json_decode(base64url_decode($parts[0]), true);
    if (!is_array($payload) || !isset($payload['exp']) || !is_int($payload['exp'])) {
        return null;
    }

    return $payload['exp'] > $now ? $payload : null;
}

/** The token is sent in a header, never a cookie — see ADMIN_AUTH.md. */
function bearer_from_request(): ?string
{
    // Apache hides Authorization from PHP unless mod_rewrite passes it through; .htaccess
    // sets HTTP_AUTHORIZATION for exactly that reason. Both spellings are checked because
    // which one arrives depends on the SAPI, and getting this wrong makes every write route
    // return 401 with nothing in the logs to say why.
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if (!is_string($header) || !str_starts_with($header, 'Bearer ')) {
        return null;
    }
    $token = trim(substr($header, 7));
    return $token === '' ? null : $token;
}

/** Epoch milliseconds — the unit every timestamp in the schema is stored in. */
function now_ms(): int
{
    return (int) round(microtime(true) * 1000);
}
