/**
 * Downloads the whole gallery — every photograph and all its metadata — to a folder.
 *
 * This is a FEATURE, not a migration hack: the designer's photographs are his, and he
 * should be able to take them out at any time. It happens to also be the tool that moves
 * the site between storage backends (R2 → KV) or between hosts entirely, because it talks
 * only to the public HTTP API and therefore does not care what is behind it.
 *
 *   npm run export                     # against a local `wrangler dev` it starts itself
 *   npm run export -- https://your.site  # against anything already running
 *
 * Output: export/manifest.json + export/{id}/{file}. Restore with `npm run import`.
 */

import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUT = path.resolve('export');
const LOCAL_PORT = 8791;
const RUNGS = [400, 800, 1600, 2400];

const target = process.argv[2];
const BASE = target ?? `http://127.0.0.1:${LOCAL_PORT}`;

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

/** The files that exist for an image — mirrors availableRungs() in src/lib/imageUrl.ts. */
function filesFor(image) {
  if (image.passthrough) return [`full.${image.format}`];
  const rungs = RUNGS.filter((rung) => rung <= image.maxRung);
  return (rungs.length > 0 ? rungs : [RUNGS[0]]).map((rung) => `${rung}.webp`);
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
    const manifest = await (await fetch(`${BASE}/api/images`)).json();

    await rm(OUT, { recursive: true, force: true });
    await mkdir(OUT, { recursive: true });

    let files = 0;
    let bytes = 0;
    const missing = [];

    for (const image of manifest.images) {
      await mkdir(path.join(OUT, image.id), { recursive: true });
      for (const file of filesFor(image)) {
        const response = await fetch(`${BASE}/img/${image.id}/${file}`);
        if (!response.ok) {
          // Recorded rather than thrown: one unreachable variant should not cost you the
          // other 199 photographs.
          missing.push(`${image.id}/${file} (${response.status})`);
          continue;
        }
        const body = Buffer.from(await response.arrayBuffer());
        await writeFile(path.join(OUT, image.id, file), body);
        files += 1;
        bytes += body.byteLength;
      }
      process.stdout.write('.');
    }

    // The manifest is written LAST, so an interrupted export leaves an obviously
    // incomplete folder rather than one that looks whole and is not.
    await writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));

    console.log(
      `\n${manifest.images.length} images, ${files} files, ` +
        `${(bytes / 1024 / 1024).toFixed(1)} MB → export/`,
    );
    if (missing.length > 0) {
      console.log(`\n${missing.length} MISSING file(s):\n - ${missing.slice(0, 10).join('\n - ')}`);
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
