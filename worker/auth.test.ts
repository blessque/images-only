import { describe, expect, it } from 'vitest';
import {
  bearerFrom,
  constantTimeEqual,
  hashPassword,
  PBKDF2_ITERATIONS,
  PBKDF2_MAX_ITERATIONS,
  signToken,
  verifyPassword,
  verifyToken,
} from './auth';

// A low iteration count keeps the suite fast. The production count travels INSIDE the
// stored hash, so this exercises exactly the same code path.
const FAST = 1000;
const SECRET = 'test-secret-value-long-enough-to-be-realistic';

describe('constantTimeEqual', () => {
  it('compares by value and rejects on length', () => {
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
    expect(constantTimeEqual(new Uint8Array(), new Uint8Array())).toBe(true);
  });
});

describe('password hashing', () => {
  // The one assertion that would have caught the outage. Every other test here runs at
  // FAST, and neither Node nor local workerd enforces the runtime cap — so the production
  // iteration count was never actually executed until it reached the edge and threw.
  it('stays within the Workers runtime cap on PBKDF2 iterations', () => {
    expect(PBKDF2_ITERATIONS).toBeLessThanOrEqual(PBKDF2_MAX_ITERATIONS);
  });

  it('round-trips the correct password', async () => {
    const stored = await hashPassword('correct horse battery staple', undefined, FAST);
    expect(await verifyPassword('correct horse battery staple', stored)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const stored = await hashPassword('correct horse battery staple', undefined, FAST);
    expect(await verifyPassword('Correct horse battery staple', stored)).toBe(false);
    expect(await verifyPassword('', stored)).toBe(false);
  });

  it('salts, so the same password hashes differently every time', async () => {
    const a = await hashPassword('same', undefined, FAST);
    const b = await hashPassword('same', undefined, FAST);
    expect(a).not.toBe(b);
    expect(await verifyPassword('same', a)).toBe(true);
    expect(await verifyPassword('same', b)).toBe(true);
  });

  it('carries its cost factor, so raising iterations does not invalidate stored hashes', async () => {
    const stored = await hashPassword('portable', undefined, FAST);
    expect(stored.startsWith(`pbkdf2$${FAST}$`)).toBe(true);
    expect(await verifyPassword('portable', stored)).toBe(true);
  });

  it('fails closed on a malformed or empty stored hash', async () => {
    for (const bad of ['', 'garbage', 'pbkdf2$$$', 'pbkdf2$abc$x$y', 'md5$1$a$b', 'pbkdf2$0$a$b']) {
      expect(await verifyPassword('anything', bad)).toBe(false);
    }
  });
});

describe('session tokens', () => {
  it('round-trips a freshly signed token', async () => {
    const token = await signToken(SECRET);
    expect(await verifyToken(SECRET, token)).not.toBeNull();
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signToken(SECRET);
    expect(await verifyToken('some-other-secret', token)).toBeNull();
  });

  it('rejects an expired token', async () => {
    const now = Date.now();
    const token = await signToken(SECRET, 1000, now);
    expect(await verifyToken(SECRET, token, now + 500)).not.toBeNull();
    expect(await verifyToken(SECRET, token, now + 1001)).toBeNull();
  });

  it('rejects a tampered payload', async () => {
    const token = await signToken(SECRET);
    const [body, signature] = token.split('.');
    const forgedBody = btoa(JSON.stringify({ exp: Date.now() + 10 ** 9 }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(forgedBody).not.toBe(body);
    expect(await verifyToken(SECRET, `${forgedBody}.${signature}`)).toBeNull();
  });

  it('never throws on malformed input — a bad token is simply not a token', async () => {
    for (const bad of ['', '.', 'a.b', 'nodot', '...', 'ᚠ.ᚠ', null, undefined]) {
      await expect(verifyToken(SECRET, bad)).resolves.toBeNull();
    }
  });

  it('rejects the "none algorithm" shape a JWT would have to consider', async () => {
    // The token format carries no algorithm field precisely so this is unrepresentable,
    // but assert it anyway: a bare payload with an empty signature must not authenticate.
    const body = btoa(JSON.stringify({ exp: Date.now() + 10 ** 6 })).replace(/=+$/, '');
    expect(await verifyToken(SECRET, `${body}.`)).toBeNull();
    expect(await verifyToken(SECRET, body)).toBeNull();
  });
});

describe('bearerFrom', () => {
  const withAuth = (value: string | null) =>
    new Request('https://example.com', value ? { headers: { authorization: value } } : {});

  it('extracts a bearer token', () => {
    expect(bearerFrom(withAuth('Bearer abc.def'))).toBe('abc.def');
  });

  it('ignores anything that is not a bearer scheme', () => {
    expect(bearerFrom(withAuth(null))).toBeNull();
    expect(bearerFrom(withAuth('Basic abc'))).toBeNull();
    expect(bearerFrom(withAuth('bearer abc'))).toBeNull();
    expect(bearerFrom(withAuth('Bearer '))).toBeNull();
  });
});
