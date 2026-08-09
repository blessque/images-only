/**
 * Restores a gallery exported by `npm run export`.
 *
 * The other half of data portability, and the tool that carries the photographs across a
 * storage change (R2 → KV) or a change of host entirely. Talks only to the public HTTP API,
 * so it does not care what is behind it.
 *
 *   npm run import                            # local wrangler dev, started by this script
 *   npm run import -- https://your.site       # anything already running
 *
 * The admin password comes from IMPORT_PASSWORD, or defaults to the local dev one. It is
 * never taken from the command line, where it would land in shell history.
 */

import { spawn } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const SOURCE = path.resolve('export');
const LOCAL_PORT = 8792;

const target = process.argv[2];
const BASE = target ?? `http://127.0.0.1:${LOCAL_PORT}`;
const PASSWORD = process.env.IMPORT_PASSWORD ?? 'test-password-1234';

const CONTENT_TYPES = {
  webp: 'image/webp',
  jpg: 'image/jpeg',
  png: 'image/png',
  avif: 'image/avif',
  gif: 'image/gif',
};

async function waitForServer() {
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      if ((await fetch(`${BASE}/api/images`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`nothing answering at ${BASE}`);
}

async function main() {
  const manifest = JSON.parse(await readFile(path.join(SOURCE, 'manifest.json'), 'utf8'));

  const server = target
    ? null
    : spawn(
        'npx',
        ['wrangler', 'dev', '--port', String(LOCAL_PORT), '--ip', '127.0.0.1', '--local'],
        { stdio: 'ignore' },
      );

  try {
    await waitForServer();

    const login = await fetch(`${BASE}/api/login`, {
      method: 'POST',
      body: JSON.stringify({ password: PASSWORD }),
    });
    const { token } = await login.json().catch(() => ({}));
    if (!token) throw new Error('login failed — set IMPORT_PASSWORD to the admin password');
    const auth = { authorization: `Bearer ${token}` };

    const existing = new Set(
      (await (await fetch(`${BASE}/api/images`)).json()).images.map((image) => image.id),
    );

    let imported = 0;
    let skipped = 0;
    const failed = [];

    // In manifest order: `sort_order` is assigned on insert, so importing in order is what
    // preserves the gallery's arrangement.
    for (const image of manifest.images) {
      if (existing.has(image.id)) {
        skipped += 1;
        process.stdout.write('-');
        continue;
      }

      try {
        const files = await readdir(path.join(SOURCE, image.id));
        // Every byte lands before the metadata row, exactly as the admin UI does it — so an
        // interrupted import orphans bytes rather than pointing a row at a missing image.
        for (const file of files) {
          const extension = file.split('.').pop() ?? 'webp';
          const body = await readFile(path.join(SOURCE, image.id, file));
          const response = await fetch(`${BASE}/api/upload/${image.id}/${file}`, {
            method: 'PUT',
            headers: { ...auth, 'content-type': CONTENT_TYPES[extension] ?? 'image/webp' },
            body,
          });
          if (!response.ok) throw new Error(`${file} → ${response.status}`);
        }

        const created = await fetch(`${BASE}/api/images`, {
          method: 'POST',
          headers: { ...auth, 'content-type': 'application/json' },
          body: JSON.stringify(image),
        });
        if (!created.ok) throw new Error(`metadata → ${created.status}`);

        imported += 1;
        process.stdout.write('.');
      } catch (cause) {
        failed.push(`${image.id}: ${cause instanceof Error ? cause.message : String(cause)}`);
        process.stdout.write('x');
      }
    }

    if (manifest.settings) {
      await fetch(`${BASE}/api/settings`, {
        method: 'PATCH',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify(manifest.settings),
      });
    }

    console.log(
      `\n${imported} imported` +
        (skipped ? `, ${skipped} already present` : '') +
        (failed.length ? `, ${failed.length} FAILED` : ''),
    );
    if (failed.length > 0) {
      console.log(` - ${failed.slice(0, 10).join('\n - ')}`);
      process.exitCode = 1;
    }
  } finally {
    if (server) server.kill('SIGTERM');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
