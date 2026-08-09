import { describe, expect, it } from 'vitest';
import { claimSite, readCredentials, type CredentialsEnv } from './credentials';
import { verifyPassword } from './auth';

/**
 * A fake D1 covering exactly the surface `credentials.ts` uses: one SELECT and one INSERT
 * against a single-row table. Small enough to be obviously correct, which is the only kind
 * of test double worth having.
 *
 * It enforces the `CHECK (id = 1)` primary-key constraint from 0004_auth.sql, because that
 * constraint IS the claim-once guarantee — a double that let a second row in would be
 * testing a database this code never runs against.
 */
function fakeDb(seed?: { password_hash: string; token_secret: string }) {
  let row = seed ?? null;

  return {
    row: () => row,
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async run() {
              if (!sql.startsWith('INSERT INTO auth')) throw new Error(`unexpected: ${sql}`);
              if (row) throw new Error('UNIQUE constraint failed: auth.id');
              row = { password_hash: String(args[0]), token_secret: String(args[1]) };
              return { success: true };
            },
          };
        },
        async first() {
          if (!sql.startsWith('SELECT password_hash')) throw new Error(`unexpected: ${sql}`);
          return row;
        },
      };
    },
  } as unknown as D1Database & { row: () => { password_hash: string; token_secret: string } | null };
}

const env = (db: D1Database, extra: Partial<CredentialsEnv> = {}): CredentialsEnv => ({
  DB: db,
  ...extra,
});

describe('readCredentials', () => {
  it('reports an empty deployment as unclaimed', async () => {
    expect(await readCredentials(env(fakeDb()))).toBeNull();
  });

  it('falls back to Worker secrets, so an existing deployment keeps working', async () => {
    const credentials = await readCredentials(
      env(fakeDb(), { ADMIN_PASSWORD_HASH: 'pbkdf2$1000$a$b', TOKEN_SECRET: 'secret' }),
    );
    expect(credentials).toEqual({ passwordHash: 'pbkdf2$1000$a$b', tokenSecret: 'secret' });
  });

  it('treats a half-configured deployment as unclaimed, not as half-secured', async () => {
    // A hash with no token secret cannot sign a session; a token secret with no hash would
    // let anyone in. Neither is a state to limp along in.
    expect(await readCredentials(env(fakeDb(), { ADMIN_PASSWORD_HASH: 'x' }))).toBeNull();
    expect(await readCredentials(env(fakeDb(), { TOKEN_SECRET: 'x' }))).toBeNull();
  });

  it('prefers the database over the Worker secrets', async () => {
    const db = fakeDb({ password_hash: 'from-db', token_secret: 'db-secret' });
    const credentials = await readCredentials(
      env(db, { ADMIN_PASSWORD_HASH: 'from-env', TOKEN_SECRET: 'env-secret' }),
    );
    expect(credentials?.passwordHash).toBe('from-db');
  });
});

describe('claimSite', () => {
  it('stores a verifiable hash and never the password itself', async () => {
    const db = fakeDb();
    const credentials = await claimSite(env(db), 'a-real-password-1234');

    expect(credentials).not.toBeNull();
    expect(await verifyPassword('a-real-password-1234', credentials!.passwordHash)).toBe(true);
    expect(JSON.stringify(db.row())).not.toContain('a-real-password-1234');
  });

  it('generates a token secret rather than asking a human for one', async () => {
    const a = await claimSite(env(fakeDb()), 'a-real-password-1234');
    const b = await claimSite(env(fakeDb()), 'a-real-password-1234');
    expect(a!.tokenSecret).not.toBe(b!.tokenSecret);
    expect(a!.tokenSecret.length).toBeGreaterThan(32);
  });

  it('refuses a second claim — the takeover case', async () => {
    const db = fakeDb();
    await claimSite(env(db), 'the-owner-password');
    expect(await claimSite(env(db), 'the-attacker-password')).toBeNull();
    expect(await verifyPassword('the-owner-password', db.row()!.password_hash)).toBe(true);
  });

  it('refuses to claim over Worker secrets', async () => {
    const configured = env(fakeDb(), { ADMIN_PASSWORD_HASH: 'pbkdf2$1000$a$b', TOKEN_SECRET: 's' });
    expect(await claimSite(configured, 'the-attacker-password')).toBeNull();
  });
});
