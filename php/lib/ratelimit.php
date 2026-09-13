<?php
/**
 * Login rate limiting — the PHP twin of worker/rateLimit.ts.
 *
 * Ships WITH the login endpoint, not after it: one password on a public endpoint with
 * unlimited attempts is brute-forceable in an afternoon. ADMIN_AUTH.md is explicit that this
 * is not a polish item to defer. See docs/architecture/ADMIN_AUTH.md.
 */

declare(strict_types=1);

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/auth.php';

const WINDOW_MS = 900000;   // 15 minutes
const MAX_ATTEMPTS = 8;

/**
 * Records an attempt and reports whether it may proceed.
 *
 * Counted BEFORE the password is checked, so a flood of wrong guesses cannot outrun the
 * counter, and a correct password clears it.
 *
 * @return array{allowed:bool,retryAfterSeconds:int,remaining:int}
 */
function register_attempt(string $key, ?int $now = null): array
{
    $now ??= now_ms();

    $statement = db()->prepare('SELECT attempts, window_start FROM login_attempts WHERE client_key = ?');
    $statement->execute([$key]);
    $row = $statement->fetch();

    $previousStart = is_array($row) && $row !== [] ? (int) $row['window_start'] : null;
    $inWindow = $previousStart !== null && $now - $previousStart < WINDOW_MS;

    $windowStart = $inWindow ? $previousStart : $now;
    $attempts = ($inWindow ? (int) $row['attempts'] : 0) + 1;

    db()->prepare(
        'INSERT INTO login_attempts (client_key, attempts, window_start) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE attempts = VALUES(attempts), window_start = VALUES(window_start)'
    )->execute([$key, $attempts, $windowStart]);

    $elapsed = $now - $windowStart;
    return [
        'allowed' => $attempts <= MAX_ATTEMPTS,
        'retryAfterSeconds' => max(1, (int) ceil((WINDOW_MS - $elapsed) / 1000)),
        'remaining' => max(0, MAX_ATTEMPTS - $attempts),
    ];
}

function clear_attempts(string $key): void
{
    db()->prepare('DELETE FROM login_attempts WHERE client_key = ?')->execute([$key]);
}

/**
 * REMOTE_ADDR, and deliberately not X-Forwarded-For.
 *
 * Cloudflare sets CF-Connecting-IP, which cannot be spoofed at the edge. Shared hosting has
 * no such guarantee: X-Forwarded-For is a request header like any other, so trusting it lets
 * an attacker send a fresh one per guess and make the limiter count to one, for ever. The
 * cost of not trusting it is that visitors behind the same NAT share a bucket — 8 attempts
 * per 15 minutes, on a site with one user, is a cost worth paying.
 */
function client_key(): string
{
    $address = $_SERVER['REMOTE_ADDR'] ?? '';
    return is_string($address) && $address !== '' ? substr($address, 0, 45) : 'unknown';
}
