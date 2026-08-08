/**
 * Generates the values for the two Worker secrets.
 *
 *   npm run hash-password
 *
 * Imports the SHIPPING hash function rather than reimplementing it — a second copy of the
 * format string is exactly how a generator and a verifier drift apart and lock you out.
 *
 * Reads from stdin, never argv: a password on the command line lands in shell history and
 * in `ps` output.
 */

import { createInterface } from 'node:readline/promises';
import { hashPassword, PBKDF2_ITERATIONS } from '../worker/auth.ts';

const rl = createInterface({ input: process.stdin, output: process.stdout });

const password = (await rl.question('Admin password: ')).trim();
rl.close();

if (password.length < 12) {
  console.error(
    `\nRefusing: ${password.length} characters. This is the ONLY credential guarding the site,\n` +
      'it never expires, and there is no account recovery by design. Use 12+ characters.',
  );
  process.exit(1);
}

const hash = await hashPassword(password);
const tokenSecret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');

console.log(`
Two secrets. Set BOTH, and never commit either.

  npx wrangler secret put ADMIN_PASSWORD_HASH
  ${hash}

  npx wrangler secret put TOKEN_SECRET
  ${tokenSecret}

For local development, put the same two lines in .dev.vars (gitignored):

  ADMIN_PASSWORD_HASH="${hash}"
  TOKEN_SECRET="${tokenSecret}"

PBKDF2-SHA256, ${PBKDF2_ITERATIONS.toLocaleString('en-US')} iterations, random 16-byte salt.
Forgot the password later? Re-run this and \`wrangler secret put\` the new hash — that is
the account recovery story, deliberately (see docs/architecture/ADMIN_AUTH.md).
`);
