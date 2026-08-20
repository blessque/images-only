/**
 * Proves the PHP port and the Worker agree about credentials, in BOTH directions.
 *
 *   npm run verify:php
 *
 * The claim being tested is that a gallery can move between Cloudflare and shared hosting
 * without the owner choosing a new password. That rests on PBKDF2 parameters, a salt
 * encoding, a token layout and a JSON serialisation all matching across two runtimes — four
 * things that look identical when read side by side and are not the sort of thing reading
 * can settle. So the SHIPPING code on each side checks the other side's output.
 *
 * Imports worker/auth.ts rather than reimplementing it, for the same reason
 * scripts/hash-password.ts does: a second copy of the format is how a generator and a
 * verifier drift apart.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { hashPassword, signToken, verifyPassword, verifyToken } from '../worker/auth.ts';

const PASSWORD = 'a-shared-test-password';
const SECRET = 'a-shared-test-secret';

const php = process.env.PHP_BINARY ?? 'php';
const workspace = mkdtempSync(path.join(tmpdir(), 'justimages-php-'));
const workerFixture = path.join(workspace, 'from-worker.json');
const phpFixture = path.join(workspace, 'from-php.json');

// What the Worker produces, using the code that actually runs at the edge.
writeFileSync(
  workerFixture,
  JSON.stringify({
    password: PASSWORD,
    passwordHash: await hashPassword(PASSWORD),
    tokenSecret: SECRET,
    token: await signToken(SECRET),
  }),
);

let phpFailed = false;
try {
  const output = execFileSync(php, ['php/tests/auth.test.php', workerFixture, phpFixture], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  process.stdout.write(output);
} catch (error) {
  phpFailed = true;
  const message = error instanceof Error ? error.message : String(error);
  // A missing binary is a different failure from a failing test, and saying so saves the
  // next person from debugging assertions that never ran.
  if (message.includes('ENOENT')) {
    console.error('\nphp not found. Install it (brew install php) or set PHP_BINARY.');
    process.exit(2);
  }
  console.error('\nThe PHP test suite failed — see above.');
}

// And now the other direction: values PHP made, checked by the Worker's own verifiers.
const made = JSON.parse(readFileSync(phpFixture, 'utf8')) as {
  password: string;
  passwordHash: string;
  tokenSecret: string;
  token: string;
};

const results: [string, boolean][] = [
  ['a password hash made by PHP verifies in worker/auth.ts', await verifyPassword(made.password, made.passwordHash)],
  ['a wrong password against the PHP hash still fails', !(await verifyPassword(made.password + 'x', made.passwordHash))],
  ['a token signed by PHP verifies in worker/auth.ts', (await verifyToken(made.tokenSecret, made.token)) !== null],
  ['a PHP token under the wrong secret fails', (await verifyToken(made.tokenSecret + 'x', made.token)) === null],
  ['PHP uses the iteration count the Workers runtime can actually run', made.passwordHash.startsWith('pbkdf2$100000$')],
];

let failures = 0;
for (const [name, passed] of results) {
  if (!passed) {
    failures++;
    console.error(`FAIL  ${name}`);
  }
}

if (failures === 0 && !phpFailed) {
  console.log(`ok — ${results.length} reverse-direction checks passed`);
  process.exit(0);
}

console.error(`FAILED — ${failures} of ${results.length} reverse-direction checks failed`);
process.exit(1);
