/**
 * Freezes a live gallery into a plain folder that any static host will serve.
 *
 * This is the thing originally asked for — "a zip with the website" — and it is the only
 * pathway that needs no account, no server and no operator. It is the parachute: if
 * Cloudflare becomes unreachable, or unaffordable, or simply unwanted, the photographs and
 * the grid survive as files.
 *
 *   npm run freeze                             # local wrangler dev, started by this script
 *   npm run freeze -- https://your.site        # anything already running
 *
 * Output: freeze/index.html + freeze/assets/* + freeze/img/{id}/{file}
 *
 * It reads ONLY over HTTP, and takes `/` exactly as the server renders it — manifest already
 * inlined. Nothing here re-implements `serveShell`, so the frozen page cannot drift from the
 * live one, and this works against any deployment including a future Node port.
 *
 * What it deliberately does NOT do: strip the admin UI. A static copy has no API, so the
 * lock is inert — the copy is a mirror, and it is read-only because nothing is listening.
 * Updating it means running this again.
 */

import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUT = path.resolve('freeze');
const LOCAL_PORT = 8794;
const RUNGS = [400, 800, 1600, 2400];

const target = process.argv[2];
const BASE = target ?? `http://127.0.0.1:${LOCAL_PORT}`;

/** Mirrors filesFor() in export-images.mjs and src/admin/download.ts. */
function filesFor(image) {
  if (image.passthrough) return [`full.${image.format}`];
  const rungs = RUNGS.filter((rung) => rung <= image.maxRung);
  return (rungs.length > 0 ? rungs : [RUNGS[0]]).map((rung) => `${rung}.webp`);
}

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

async function save(urlPath, body) {
  const destination = path.join(OUT, urlPath.replace(/^\//, ''));
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, body);
  return body.byteLength;
}

/**
 * Every built asset a file refers to, normalised to `/assets/<name>`.
 *
 * Three spellings have to be caught, because Vite emits all of them: `/assets/x.js` in the
 * HTML, `assets/x.js` in the preload map, and a bare `./AdminLayer-HASH.js` in the dynamic
 * import itself. Missing the third silently produced a mirror without the admin chunk —
 * complete-looking, and broken the moment the lock was clicked.
 *
 * Normalising by basename is safe because Vite writes every output flat into `/assets/`.
 */
function assetPathsIn(text) {
  const found = new Set();
  for (const [, name] of text.matchAll(/(?:\.\/|\/)?assets\/([A-Za-z0-9._-]+)/g)) {
    found.add(`/assets/${name}`);
  }
  // A relative sibling import inside a file that already lives in /assets/.
  const sibling = /["'`]\.\/([A-Za-z0-9._-]+-[A-Za-z0-9_-]{6,}\.(?:js|css|woff2))["'`]/g;
  for (const [, name] of text.matchAll(sibling)) found.add(`/assets/${name}`);
  return found;
}

async function main() {
  const server = target
    ? null
    : spawn(
        'npx',
        ['wrangler', 'dev', '--port', String(LOCAL_PORT), '--ip', '127.0.0.1', '--local'],
        { stdio: 'ignore' },
      );

  try {
    await waitForServer();

    await rm(OUT, { recursive: true, force: true });
    await mkdir(OUT, { recursive: true });

    // 1. The shell, exactly as served — the manifest is already inside it.
    const html = await (await fetch(`${BASE}/`)).text();
    if (!html.includes('id="manifest"')) {
      throw new Error('the shell has no inlined manifest — is this the Worker, or Vite dev?');
    }
    let bytes = await save('/index.html', Buffer.from(html));

    // 2. Assets, following one level of reference: the CSS names the font.
    const pending = [...assetPathsIn(html)];
    const seen = new Set();
    let assets = 0;
    while (pending.length > 0) {
      const assetPath = pending.pop();
      if (seen.has(assetPath)) continue;
      seen.add(assetPath);

      const response = await fetch(`${BASE}${assetPath}`);
      if (!response.ok) throw new Error(`${assetPath} → ${response.status}`);
      const body = Buffer.from(await response.arrayBuffer());
      bytes += await save(assetPath, body);
      assets += 1;

      // Follow references out of CSS (the font) AND out of JS (the admin chunk, which is a
      // dynamic import and so is named nowhere in the HTML). Without the JS pass the mirror
      // is missing a chunk the page asks for the moment the lock is clicked.
      if (assetPath.endsWith('.css') || assetPath.endsWith('.js')) {
        for (const nested of assetPathsIn(body.toString('utf8'))) pending.push(nested);
      }
    }

    // 3. The photographs, under the same /img/ paths the frozen HTML asks for.
    const manifest = await (await fetch(`${BASE}/api/images`)).json();
    let files = 0;
    const missing = [];
    for (const image of manifest.images) {
      for (const file of filesFor(image)) {
        const response = await fetch(`${BASE}/img/${image.id}/${file}`);
        if (!response.ok) {
          missing.push(`${image.id}/${file} (${response.status})`);
          continue;
        }
        bytes += await save(`/img/${image.id}/${file}`, Buffer.from(await response.arrayBuffer()));
        files += 1;
      }
      process.stdout.write('.');
    }

    console.log(
      `\n${manifest.images.length} images · ${files} image files · ${assets} assets · ` +
        `${(bytes / 1024 / 1024).toFixed(1)} MB → freeze/`,
    );
    console.log('\nUpload the CONTENTS of freeze/ to any static host. No server, no database.');
    console.log('The lock icon is inert there: a frozen copy has nothing listening.');

    if (missing.length > 0) {
      console.log(`\n${missing.length} MISSING file(s):\n - ${missing.slice(0, 10).join('\n - ')}`);
      process.exitCode = 1;
    }
  } finally {
    server?.kill();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
