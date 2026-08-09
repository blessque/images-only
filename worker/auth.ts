/**
 * Password verification and session tokens.
 *
 * Everything here is Web Crypto only — no dependency, and it runs identically in the
 * Workers runtime and in Node, which is what makes it unit-testable off the edge.
 *
 * PBKDF2 rather than bcrypt/Argon2 because it is NATIVE to the Workers runtime. bcrypt
 * would mean shipping WASM to the edge for a single-user login. See ADMIN_AUTH.md.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * The Workers runtime HARD-CAPS PBKDF2 at 100,000 iterations. Above it, `deriveBits` throws
 * `NotSupportedError` — so a higher value does not "cost more", it takes the login endpoint
 * down with a 1101 at the edge. Do NOT raise this to match OWASP's 600,000; it cannot run.
 *
 * Neither the unit tests nor `wrangler dev` enforce the cap (Node's Web Crypto has none, and
 * local workerd does not apply it), so this is invisible everywhere except production. It
 * was shipped at 210,000 and every login crashed until the live logs said so.
 *
 * The count travels inside each stored hash, so changing it here only affects NEW hashes —
 * an existing `pbkdf2$210000$…` still throws and must be regenerated.
 */
export const PBKDF2_ITERATIONS = 100_000;

/** The runtime's ceiling. Asserted in the test suite, because nothing else catches it. */
export const PBKDF2_MAX_ITERATIONS = 100_000;

/**
 * Minimum admin password length, enforced wherever a password is chosen.
 *
 * This is the ONLY credential guarding the site, it never expires, and account recovery is
 * deliberately unbuilt — so the length floor is doing more work here than it would on a site
 * with email reset behind it. See ADMIN_AUTH.md.
 */
export const MIN_PASSWORD_LENGTH = 12;

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/**
 * Length-independent, value-constant-time comparison.
 *
 * Timing attacks across a network are marginal in practice, but the correct primitive
 * costs nothing and the wrong one is a permanent footnote.
 */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    key,
    256,
  );
  return new Uint8Array(bits);
}

/** Serialised as `pbkdf2$<iterations>$<salt>$<hash>`, so the cost factor travels with it. */
export async function hashPassword(
  password: string,
  salt: Uint8Array = crypto.getRandomValues(new Uint8Array(16)),
  iterations: number = PBKDF2_ITERATIONS,
): Promise<string> {
  const derived = await pbkdf2(password, salt, iterations);
  return `pbkdf2$${iterations}$${base64UrlEncode(salt)}$${base64UrlEncode(derived)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;

  const iterations = Number(parts[1]);
  const salt = parts[2];
  const expected = parts[3];
  if (!Number.isInteger(iterations) || iterations < 1 || !salt || !expected) return false;

  const derived = await pbkdf2(password, base64UrlDecode(salt), iterations);
  return constantTimeEqual(derived, base64UrlDecode(expected));
}

// ── Session tokens ──────────────────────────────────────────────────────────────
//
// A compact HMAC-signed token: base64url(payload).base64url(signature). Deliberately not
// a JWT — there is one issuer, one audience and one algorithm, so a header announcing
// which algorithm to trust would be pure attack surface (`alg: none` and friends).

export interface TokenPayload {
  /** Expiry, epoch milliseconds. */
  exp: number;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export const TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

export async function signToken(
  secret: string,
  ttlMs: number = TOKEN_TTL_MS,
  now: number = Date.now(),
): Promise<string> {
  const payload: TokenPayload = { exp: now + ttlMs };
  const body = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(body));
  return `${body}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/**
 * Returns the payload, or null. Never throws — a malformed token is simply not a token,
 * and letting a parse error escape into a route handler is how a 500 becomes an oracle.
 */
export async function verifyToken(
  secret: string,
  token: string | null | undefined,
  now: number = Date.now(),
): Promise<TokenPayload | null> {
  if (!token) return null;
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;

  try {
    const expected = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(body));
    if (!constantTimeEqual(new Uint8Array(expected), base64UrlDecode(signature))) return null;

    const payload = JSON.parse(decoder.decode(base64UrlDecode(body))) as TokenPayload;
    if (typeof payload?.exp !== 'number' || payload.exp <= now) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Extracts a bearer token. The token is sent in a header, never a cookie — see ADMIN_AUTH.md. */
export function bearerFrom(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}
