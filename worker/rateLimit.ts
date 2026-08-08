/**
 * Login rate limiting, backed by D1.
 *
 * Ships WITH the login endpoint, not after it: one password on a public endpoint with
 * unlimited attempts is brute-forceable in an afternoon. See ADMIN_AUTH.md.
 *
 * D1 rather than a Durable Object or the rate-limiting binding because the state is one
 * row per client, written only on a login attempt — a few writes a day in normal use, and
 * no extra binding to configure or get wrong.
 */

export const WINDOW_MS = 15 * 60 * 1000;
export const MAX_ATTEMPTS = 8;

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the window resets. Sent as `Retry-After`. */
  retryAfterSeconds: number;
  remaining: number;
}

interface AttemptRow {
  attempts: number;
  window_start: number;
}

/**
 * Records an attempt and reports whether it may proceed.
 *
 * Counts BEFORE the password is checked, so a flood of wrong guesses cannot outrun the
 * counter, and a correct password clears it (see `clearAttempts`).
 */
export async function registerAttempt(
  db: D1Database,
  key: string,
  now: number = Date.now(),
): Promise<RateLimitResult> {
  const row = await db
    .prepare('SELECT attempts, window_start FROM login_attempts WHERE key = ?')
    .bind(key)
    .first<AttemptRow>();

  const windowStart = row && now - row.window_start < WINDOW_MS ? row.window_start : now;
  const attempts = (row && windowStart === row.window_start ? row.attempts : 0) + 1;

  await db
    .prepare(
      `INSERT INTO login_attempts (key, attempts, window_start) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET attempts = excluded.attempts, window_start = excluded.window_start`,
    )
    .bind(key, attempts, windowStart)
    .run();

  const elapsed = now - windowStart;
  return {
    allowed: attempts <= MAX_ATTEMPTS,
    retryAfterSeconds: Math.max(1, Math.ceil((WINDOW_MS - elapsed) / 1000)),
    remaining: Math.max(0, MAX_ATTEMPTS - attempts),
  };
}

export async function clearAttempts(db: D1Database, key: string): Promise<void> {
  await db.prepare('DELETE FROM login_attempts WHERE key = ?').bind(key).run();
}

/** Cloudflare sets CF-Connecting-IP; it cannot be spoofed by the client at the edge. */
export function clientKey(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? 'unknown';
}
