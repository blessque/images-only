/**
 * The other two bindings: image bytes on the filesystem, and static assets from `dist/`.
 *
 * `worker/storage.ts` says adding a backend means implementing two functions and nothing
 * else. This is that claim being cashed in — `getObject`/`putObject` are untouched, and
 * they reach the disk because the object below answers to `get` and `put` the way Workers
 * KV does.
 */

import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import path from 'node:path';

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/** Refuses to escape the root. `/img/../../etc/passwd` is a request a public server will get. */
function resolveInside(root, urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const resolved = path.resolve(root, `.${path.posix.normalize(decoded)}`);
  return resolved === root || resolved.startsWith(root + path.sep) ? resolved : null;
}

/** Workers KV, as far as `worker/storage.ts` is concerned: `get(key, 'stream')` and `put`. */
export function fileStorage(root) {
  return {
    async get(key) {
      const file = resolveInside(root, `/${key}`);
      if (!file) return null;
      try {
        await stat(file);
      } catch {
        return null;
      }
      return Readable.toWeb(createReadStream(file));
    },

    async put(key, bytes) {
      const file = resolveInside(root, `/${key}`);
      if (!file) throw new Error(`refusing to write outside the data directory: ${key}`);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, Buffer.from(bytes));
    },
  };
}

/**
 * The `ASSETS` Fetcher.
 *
 * Content type matters more than it looks: `worker/index.ts` decides whether to inline the
 * manifest by checking whether the asset server returned `text/html`. Serve index.html as
 * `application/octet-stream` and the shell ships with an empty manifest — the exact bug
 * iteration 3 found in the Worker's own router, arriving by a different road.
 */
export function assetFetcher(root) {
  return {
    async fetch(request) {
      const url = new URL(request.url);
      let file = resolveInside(root, url.pathname);
      if (!file) return new Response('Not found', { status: 404 });

      try {
        const info = await stat(file);
        if (info.isDirectory()) file = path.join(file, 'index.html');
        await stat(file);
      } catch {
        return new Response('Not found', { status: 404 });
      }

      const type = CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
      const immutable = url.pathname.startsWith('/assets/');
      return new Response(Readable.toWeb(createReadStream(file)), {
        headers: {
          'content-type': type,
          'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
        },
      });
    },
  };
}
