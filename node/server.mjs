/**
 * Runs the Cloudflare Worker on an ordinary Node server.
 *
 * The exit route, made real. `docs/architecture/OVERVIEW.md` has claimed since iteration 13
 * that leaving Cloudflare is "thirty lines of adapter" — this file is that claim being
 * tested rather than asserted, because the audience is largely in Russia and Cloudflare's
 * reachability there is not something this project controls.
 *
 * `src/` does not change at all. `worker/` does not change at all. The Worker is a standard
 * `fetch(request, env)` handler, so all that is missing off the edge is an env to hand it
 * and a socket to read from.
 *
 *   npm run node:start                 # builds, migrates, serves on :8080
 *   PORT=3000 DATA_DIR=/srv/justimages npm run node:start
 *
 * Read node/README.md before putting this on a VPS. It is a genuinely different maintenance
 * story from Cloudflare and the guide says so plainly.
 */

import { createServer } from 'node:http';
import { readdir, readFile, mkdir } from 'node:fs/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { openDatabase, migrate } from './d1.mjs';
import { assetFetcher, fileStorage } from './bindings.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '127.0.0.1';
const DATA_DIR = path.resolve(process.env.DATA_DIR ?? path.join(ROOT, '.data'));
const DIST = path.resolve(process.env.DIST_DIR ?? path.join(ROOT, 'dist'));

/** Node gives an IncomingMessage; the Worker wants a web Request. */
function toRequest(req) {
  const url = new URL(req.url, `http://${req.headers.host ?? `${HOST}:${PORT}`}`);
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  return new Request(url, {
    method: req.method,
    headers: req.headers,
    body: hasBody ? Readable.toWeb(req) : undefined,
    // Required by Node whenever a request carries a streaming body.
    duplex: hasBody ? 'half' : undefined,
  });
}

async function send(res, response) {
  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (!response.body) return res.end();
  await Readable.fromWeb(response.body).pipe(res);
}

async function main() {
  await mkdir(DATA_DIR, { recursive: true });

  const database = openDatabase(path.join(DATA_DIR, 'justimages.sqlite'));

  const migrationsDir = path.join(ROOT, 'migrations');
  const names = (await readdir(migrationsDir)).filter((n) => n.endsWith('.sql')).sort();
  const files = await Promise.all(
    names.map(async (name) => ({
      name,
      sql: await readFile(path.join(migrationsDir, name), 'utf8'),
    })),
  );
  const applied = migrate(database, files);
  if (applied.length > 0) console.log(`applied ${applied.length} migration(s): ${applied.join(', ')}`);

  // Bundled by `npm run node:build`. The Worker's own sources use extensionless imports,
  // which esbuild resolves and Node does not — bundling is what makes `worker/` runnable
  // here without editing a single line of it.
  const worker = (await import('./build/worker.mjs')).default;

  const env = {
    DB: database,
    IMAGES: fileStorage(path.join(DATA_DIR, 'images')),
    ASSETS: assetFetcher(DIST),
    // ADMIN_PASSWORD_HASH / TOKEN_SECRET are deliberately absent: the site is claimed from
    // a browser, exactly as on Cloudflare. Set them here only if you want the manual route.
    ADMIN_PASSWORD_HASH: process.env.ADMIN_PASSWORD_HASH,
    TOKEN_SECRET: process.env.TOKEN_SECRET,
    SETUP_CODE: process.env.SETUP_CODE,
  };

  const server = createServer(async (req, res) => {
    try {
      await send(res, await worker.fetch(toRequest(req), env, { waitUntil() {} }));
    } catch (error) {
      // A thrown handler must not take the process with it. Cloudflare answers 1101 here;
      // this logs the reason, which is the thing that was missing when it mattered.
      console.error(`${req.method} ${req.url} —`, error);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal error' }));
    }
  });

  server.listen(PORT, HOST, () => {
    console.log(`justimages on http://${HOST}:${PORT}`);
    console.log(`  data     ${DATA_DIR}`);
    console.log(`  assets   ${DIST}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
