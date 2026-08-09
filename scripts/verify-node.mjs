/**
 * Proves the Worker runs off Cloudflare — Node, SQLite and the filesystem, no edge.
 *
 * `OVERVIEW.md` claimed since iteration 13 that leaving costs "thirty lines of adapter".
 * A written escape route that nobody has walked is a guess, and this project's audience is
 * largely in Russia, where Cloudflare's reachability is not ours to promise. So this runs
 * the real thing on a throwaway data directory and checks the properties that matter.
 *
 * Prerequisites: `npm run build && npm run node:build`.
 *
 *   node scripts/verify-node.mjs
 */

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT = 8796;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'a-node-port-password';

const failures = [];
function check(condition, message, detail = '') {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    console.log(`  ✗ ${message}${detail ? ` — ${detail}` : ''}`);
    failures.push(message);
  }
}

const post = (p, body, headers = {}) =>
  fetch(`${BASE}${p}`, { method: 'POST', body: JSON.stringify(body), headers });

const id = [...crypto.getRandomValues(new Uint8Array(8))]
  .map((b) => b.toString(16).padStart(2, '0'))
  .join('');

async function waitForServer() {
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      if ((await fetch(`${BASE}/api/setup`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('the node server never came up');
}

async function main() {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'justimages-node-'));
  const server = spawn('node', ['node/server.mjs'], {
    stdio: 'ignore',
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: dataDir },
  });

  try {
    await waitForServer();

    console.log('\nA site with no Cloudflare anywhere');
    const state = await (await fetch(`${BASE}/api/setup`)).json();
    check(state.claimed === false, 'migrations ran on boot and the site is unclaimed');

    const claimed = await post('/api/setup', { password: PASSWORD, code: '' });
    const { token } = await claimed.json();
    check(claimed.ok && typeof token === 'string', 'it can be claimed from a browser here too');
    const auth = { authorization: `Bearer ${token}` };

    console.log('\nStorage on the filesystem');
    // A tiny but real WebP-shaped payload; the point is byte-identity, not decodability.
    const bytes = crypto.getRandomValues(new Uint8Array(2048));
    const upload = await fetch(`${BASE}/api/upload/${id}/400.webp`, {
      method: 'PUT',
      body: bytes,
      headers: auth,
    });
    check(upload.ok, `a variant uploads (${upload.status})`);

    const served = await fetch(`${BASE}/img/${id}/400.webp`);
    const back = new Uint8Array(await served.arrayBuffer());
    check(served.ok, `and serves back (${served.status})`);
    check(
      back.length === bytes.length && back.every((b, i) => b === bytes[i]),
      'byte-identical through the filesystem backend',
    );
    check(
      (served.headers.get('cache-control') ?? '').includes('immutable'),
      'still immutable — the keys are still never overwritten',
    );

    console.log('\nD1 shapes on SQLite');
    const created = await post(
      '/api/images',
      { id, aspect: 1.5, sizeClass: 'wide', alt: 'node port', maxRung: 400, format: 'webp' },
      auth,
    );
    check(created.status === 201, `the metadata row inserts (${created.status})`);

    const manifest = await (await fetch(`${BASE}/api/images`)).json();
    check(manifest.images.some((image) => image.id === id), 'and reaches the manifest');

    const html = await (await fetch(`${BASE}/`)).text();
    check(html.includes(`"${id}"`), 'the shell inlines the manifest, as on the edge');

    // The SAME payload, not a shortened one: a partial body is rejected at validation with
    // a 400 before uniqueness is ever consulted, which tests nothing about SQLite's
    // constraint handling. (First run asserted 409 against a stub payload and got 400 —
    // the test was wrong, again.)
    const duplicate = await post(
      '/api/images',
      { id, aspect: 1.5, sizeClass: 'wide', alt: 'node port', maxRung: 400, format: 'webp' },
      auth,
    );
    check(duplicate.status === 409, `a colliding id is 409, not a 500 (${duplicate.status})`);

    console.log('\nAuth, per route, as ADMIN_AUTH.md requires');
    for (const [method, route] of [
      ['POST', '/api/images'],
      ['PATCH', '/api/settings'],
      ['POST', '/api/reorder'],
    ]) {
      const forged = await fetch(`${BASE}${route}`, {
        method,
        body: '{}',
        headers: { authorization: 'Bearer forged.token' },
      });
      check(forged.status === 401, `${method} ${route} → 401 with a forged token`);
    }
  } finally {
    server.kill();
    await rm(dataDir, { recursive: true, force: true });
  }

  console.log(
    failures.length === 0
      ? '\nThe Worker runs off the edge. The exit is walked, not written.'
      : `\n${failures.length} node check(s) FAILED.`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
