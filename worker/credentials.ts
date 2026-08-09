/**
 * Where the admin credentials come from.
 *
 * Two sources, in order: the `auth` table, then the Worker secrets. The database wins.
 *
 * The secrets path is NOT deprecated — it is what the currently deployed site runs on, and
 * an installation that already has `ADMIN_PASSWORD_HASH` set must keep working untouched
 * after this change. It is simply no longer the only way in, because producing a PBKDF2
 * hash and setting a Worker secret are both terminal tasks and the owner has no terminal.
 *
 * "Unclaimed" — neither source present — is a real, expected state: a fresh deployment from
 * the Deploy to Cloudflare button starts there and stays there until someone claims it.
 */

import { hashPassword } from './auth';

export interface CredentialsEnv {
  DB: D1Database;
  /** Legacy/manual path. Optional now: a fresh deployment has neither. */
  ADMIN_PASSWORD_HASH?: string;
  TOKEN_SECRET?: string;
}

export interface Credentials {
  passwordHash: string;
  tokenSecret: string;
}

interface AuthRow {
  password_hash: string;
  token_secret: string;
}

/** Null means the site is unclaimed — no password has ever been set, by any route. */
export async function readCredentials(env: CredentialsEnv): Promise<Credentials | null> {
  const row = await env.DB.prepare('SELECT password_hash, token_secret FROM auth WHERE id = 1')
    .first<AuthRow>()
    .catch(() => null);

  if (row) return { passwordHash: row.password_hash, tokenSecret: row.token_secret };

  // Both, or neither. A hash with no token secret cannot sign a session, and a token secret
  // with no hash would let anyone in — so a half-configured deployment counts as unclaimed.
  if (env.ADMIN_PASSWORD_HASH && env.TOKEN_SECRET) {
    return { passwordHash: env.ADMIN_PASSWORD_HASH, tokenSecret: env.TOKEN_SECRET };
  }
  return null;
}

/**
 * Claims an unclaimed site.
 *
 * Returns null if it was already claimed, which the caller reports as 409. The INSERT is
 * the real guard: `CHECK (id = 1)` plus the primary key means a second row cannot exist, so
 * two simultaneous claims cannot both succeed however the handler is written.
 *
 * The token secret is generated here rather than supplied. It signs sessions and is never
 * typed by a human — asking the owner to invent one would be handing him a second hash
 * problem wearing a different hat.
 */
export async function claimSite(env: CredentialsEnv, password: string): Promise<Credentials | null> {
  if (await readCredentials(env)) return null;

  const credentials: Credentials = {
    passwordHash: await hashPassword(password),
    tokenSecret: crypto.randomUUID() + crypto.randomUUID(),
  };

  try {
    await env.DB.prepare(
      'INSERT INTO auth (id, password_hash, token_secret, claimed_at) VALUES (1, ?, ?, ?)',
    )
      .bind(credentials.passwordHash, credentials.tokenSecret, Date.now())
      .run();
  } catch {
    return null; // lost the race; the row that won is the one that counts
  }

  return credentials;
}
