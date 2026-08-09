/**
 * Integration test for the first-run claim, on a Worker with NO credentials configured.
 *
 * This is the journey the site's owner actually takes: a deployment arrives from the Deploy
 * to Cloudflare button with no password anywhere, and he sets one from a browser. It cannot
 * be covered by `verify-worker.mjs`, which loads `.dev.vars` and is therefore always claimed
 * — so without this file the ONLY path a non-technical owner uses would be the one path no
 * test exercises.
 *
 * Emptying the two secrets with `--var` is what makes the unclaimed state reachable:
 * `--var` overrides `.dev.vars`, and `readCredentials` treats an empty string as absent.
 *
 * Leaves the local database as it found it — a leftover `auth` row would win over
 * `.dev.vars` and break `verify-worker.mjs` on the next run.
 *
 *   node scripts/verify-setup.mjs
 */

import { spawn } from 'node:child_process';

const PORT = 8793;
const BASE = `http://127.0.0.1:${PORT}`;
const CODE = 'open-sesame-42';
const PASSWORD = 'a-good-long-password';

const failures = [];
function check(condition, message, detail = '') {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    console.log(`  ✗ ${message}${detail ? ` — ${detail}` : ''}`);
    failures.push(message);
  }
}

const post = (path, body, headers = {}) =>
  fetch(`${BASE}${path}`, { method: 'POST', body: JSON.stringify(body), headers });

function d1(sql) {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      'npx',
      ['wrangler', 'd1', 'execute', 'justimages', '--local', '--command', sql],
      { stdio: 'ignore' },
    );
    proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`d1 failed: ${sql}`))));
  });
}

async function waitForServer(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${BASE}/api/setup`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('wrangler dev never came up');
}

async function main() {
  // Start from genuinely unclaimed: no row, and no leftover limiter counter.
  await d1('DELETE FROM auth; DELETE FROM login_attempts;');

  const server = spawn(
    'npx',
    [
      'wrangler', 'dev',
      '--port', String(PORT),
      '--ip', '127.0.0.1',
      '--local',
      '--var', 'ADMIN_PASSWORD_HASH:',
      '--var', 'TOKEN_SECRET:',
      '--var', `SETUP_CODE:${CODE}`,
    ],
    { stdio: 'ignore' },
  );

  try {
    await waitForServer();

    console.log('\nUnclaimed');
    const state = await (await fetch(`${BASE}/api/setup`)).json();
    check(state.claimed === false, 'a fresh deployment reports itself unclaimed');
    check(state.codeRequired === true, 'and says a setup code is required, so the form can ask');

    const noLogin = await post('/api/login', { password: PASSWORD });
    check(
      noLogin.status === 409,
      `login on an unclaimed site says so rather than "wrong password" (${noLogin.status})`,
    );

    console.log('\nClaiming');
    const wrongCode = await post('/api/setup', { password: PASSWORD, code: 'not-the-code' });
    check(wrongCode.status === 401, `the wrong setup code is refused (${wrongCode.status})`);

    const short = await post('/api/setup', { password: 'short', code: CODE });
    check(short.status === 400, `a password under the minimum is refused (${short.status})`);

    const claimed = await post('/api/setup', { password: PASSWORD, code: CODE });
    const { token } = await claimed.json();
    check(claimed.ok && typeof token === 'string', 'claiming returns a session token');

    console.log('\nAfter the claim');
    const write = await fetch(`${BASE}/api/settings`, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'set-by-claim' }),
      headers: { authorization: `Bearer ${token}` },
    });
    check(write.ok, `the claim's own token can write immediately (${write.status})`);

    const takeover = await post('/api/setup', { password: 'attacker-password', code: CODE });
    check(takeover.status === 409, `a second claim is refused (${takeover.status})`);

    const forged = await fetch(`${BASE}/api/settings`, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'nope' }),
      headers: { authorization: 'Bearer forged.token' },
    });
    check(forged.status === 401, `a forged token is still rejected (${forged.status})`);

    await d1('DELETE FROM login_attempts;');
    const good = await post('/api/login', { password: PASSWORD });
    check(good.ok, `the chosen password logs in (${good.status})`);

    const bad = await post('/api/login', { password: `${PASSWORD}X` });
    check(bad.status === 401, `a wrong password still fails closed (${bad.status})`);
  } finally {
    server.kill();
    // The row would outrank .dev.vars and break verify-worker.mjs on the next run.
    await d1("DELETE FROM auth; DELETE FROM login_attempts; UPDATE settings SET value='' WHERE key='name';");
  }

  console.log(
    failures.length === 0
      ? '\nAll setup checks passed.'
      : `\n${failures.length} setup check(s) FAILED.`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
