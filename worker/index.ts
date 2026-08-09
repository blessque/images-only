import { VARIANT_WIDTHS, type ImageItem, type SizeClass } from '../src/lib/types';
import { getObject, putObject, type StorageEnv } from './storage';
import { bearerFrom, signToken, verifyPassword, verifyToken } from './auth';
import { clearAttempts, clientKey, registerAttempt } from './rateLimit';
import {
  insertImage,
  nextSortOrder,
  readManifest,
  reorderImages,
  restoreImage,
  softDeleteImage,
  updateImage,
  updateSettings,
} from './images';

export interface Env extends StorageEnv {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_PASSWORD_HASH: string;
  TOKEN_SECRET: string;
}

const IMMUTABLE = 'public, max-age=31536000, immutable';
const VALID_CLASSES = new Set<string>(['solo', 'wide', 'tight']);
const VALID_RUNGS = new Set<number>(VARIANT_WIDTHS);
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/**
 * Formats a passthrough object may be stored as, and the content type each is served with.
 *
 * A passthrough is the SOURCE bytes, so it is whatever the designer dropped in — serving a
 * JPEG under `image/webp` would be a lie the browser mostly tolerates and some tools do not.
 */
const PASSTHROUGH_TYPES: Record<string, string> = {
  webp: 'image/webp',
  jpg: 'image/jpeg',
  png: 'image/png',
  avif: 'image/avif',
  gif: 'image/gif',
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

/**
 * Every write route calls this ITSELF. Not shared middleware you can forget to apply —
 * a route added outside a guarded group is a silent, invisible hole, and the test suite
 * asserts rejection per route for exactly that reason. See ADMIN_AUTH.md.
 */
async function requireAuth(request: Request, env: Env): Promise<boolean> {
  return (await verifyToken(env.TOKEN_SECRET, bearerFrom(request))) !== null;
}

/**
 * Serialise the manifest for inlining into the HTML shell.
 *
 * `<` MUST be escaped. Alt text is user-controlled, so a caption containing `</script>`
 * would otherwise close the tag and turn a photo caption into script injection. JSON
 * treats < as identical to `<`, so nothing downstream needs to know.
 */
function inlineJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

async function weakEtag(body: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  const hex = [...new Uint8Array(digest).slice(0, 8)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `W/"${hex}"`;
}

/** The HTML shell, with the manifest injected — see docs/architecture/OVERVIEW.md. */
async function serveShell(request: Request, env: Env): Promise<Response> {
  const manifest = await readManifest(env.DB);
  const shell = await env.ASSETS.fetch(new Request(new URL('/index.html', request.url)));
  if (!shell.ok) return shell;

  const html = (await shell.text()).replace(
    '<script type="application/json" id="manifest"></script>',
    `<script type="application/json" id="manifest">${inlineJson(manifest)}</script>`,
  );

  const etag = await weakEtag(html);
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { etag } });
  }

  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // The manifest changes whenever he uploads, so the document must always be
      // revalidated. The hashed JS/CSS it points at are immutable, so this is cheap.
      'cache-control': 'no-cache',
      etag,
    },
  });
}

/** Resolves an image path to its R2 key and content type, or null if it is not one. */
function resolveImagePath(pathname: string): { key: string; contentType: string } | null {
  const ladder = /^\/img\/([a-f0-9]{16})\/(\d+)\.webp$/.exec(pathname);
  if (ladder) {
    const [, id, rung] = ladder;
    if (!id || !rung || !VALID_RUNGS.has(Number(rung))) return null;
    return { key: `${id}/${rung}.webp`, contentType: 'image/webp' };
  }

  const full = /^\/img\/([a-f0-9]{16})\/full\.([a-z0-9]+)$/.exec(pathname);
  if (full) {
    const [, id, format] = full;
    const contentType = format ? PASSTHROUGH_TYPES[format] : undefined;
    if (!id || !format || !contentType) return null;
    return { key: `${id}/full.${format}`, contentType };
  }

  return null;
}

async function serveImage(url: URL, env: Env): Promise<Response> {
  const resolved = resolveImagePath(url.pathname);
  if (!resolved) return new Response('Not found', { status: 404 });

  const object = await getObject(env, resolved.key);
  if (!object) return new Response('Not found', { status: 404 });

  return new Response(object.body, {
    headers: {
      'content-type': resolved.contentType,
      // Safe ONLY because keys are immutable — "replace" mints a new id and never
      // overwrites. An overwritten object behind this header is a stale image that no
      // purge can reach. See docs/architecture/IMAGE_PIPELINE.md.
      'cache-control': IMMUTABLE,
      etag: object.etag,
    },
  });
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  const key = clientKey(request);

  // Counted BEFORE the password is checked, so a flood of guesses cannot outrun it.
  const limit = await registerAttempt(env.DB, key);
  if (!limit.allowed) {
    return json({ error: 'Too many attempts' }, 429, {
      'retry-after': String(limit.retryAfterSeconds),
    });
  }

  let password = '';
  try {
    const body = (await request.json()) as { password?: unknown };
    if (typeof body.password === 'string') password = body.password;
  } catch {
    return json({ error: 'Bad request' }, 400);
  }

  if (!env.ADMIN_PASSWORD_HASH || !(await verifyPassword(password, env.ADMIN_PASSWORD_HASH))) {
    return json({ error: 'Incorrect password', remaining: limit.remaining }, 401);
  }

  await clearAttempts(env.DB, key);
  return json({ token: await signToken(env.TOKEN_SECRET) });
}

async function handleUpload(request: Request, env: Env, url: URL): Promise<Response> {
  if (!(await requireAuth(request, env))) return json({ error: 'Unauthorized' }, 401);

  // The upload path mirrors the serve path exactly, so a variant can only be written
  // under a key that is subsequently readable.
  const resolved = resolveImagePath(url.pathname.replace('/api/upload/', '/img/'));
  if (!resolved) return json({ error: 'Bad variant' }, 400);

  if (!request.body) return json({ error: 'Empty body' }, 400);

  // Measured on the ACTUAL bytes, not on a client-supplied content-length header — the
  // header is a claim, and this is the thing the limit is supposed to be about.
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0) return json({ error: 'Empty body' }, 400);
  if (bytes.byteLength > MAX_UPLOAD_BYTES) return json({ error: 'Too large' }, 413);

  await putObject(env, resolved.key, bytes, resolved.contentType, IMMUTABLE);
  return json({ ok: true });
}

async function handleCreate(request: Request, env: Env): Promise<Response> {
  if (!(await requireAuth(request, env))) return json({ error: 'Unauthorized' }, 401);

  let body: {
    id?: unknown;
    aspect?: unknown;
    sizeClass?: unknown;
    alt?: unknown;
    maxRung?: unknown;
    passthrough?: unknown;
    format?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'Bad request' }, 400);
  }

  const id = typeof body.id === 'string' && /^[a-f0-9]{16}$/.test(body.id) ? body.id : null;
  const aspect = typeof body.aspect === 'number' && body.aspect > 0 ? body.aspect : null;
  const sizeClass =
    typeof body.sizeClass === 'string' && VALID_CLASSES.has(body.sizeClass)
      ? (body.sizeClass as SizeClass)
      : null;
  // Must be a rung we actually serve — an arbitrary number here would make srcset
  // advertise a key that was never written.
  const passthrough = body.passthrough === true;
  const format = typeof body.format === 'string' ? body.format : 'webp';
  // A passthrough may be any format we can serve; a ladder image is always webp.
  const formatOk = passthrough ? format in PASSTHROUGH_TYPES : format === 'webp';
  // maxRung is meaningless for a passthrough (there is no ladder), so it is not required.
  const maxRung =
    typeof body.maxRung === 'number' && VALID_RUNGS.has(body.maxRung) ? body.maxRung : null;

  if (!id || !aspect || !sizeClass || !formatOk || (!passthrough && !maxRung)) {
    return json({ error: 'Invalid image' }, 400);
  }

  const item: ImageItem = {
    id,
    aspect,
    sizeClass,
    alt: typeof body.alt === 'string' ? body.alt.slice(0, 500) : '',
    maxRung: maxRung ?? (VARIANT_WIDTHS[0] ?? 400),
    passthrough,
    format,
  };

  // Metadata is written LAST, after every rung has landed in R2 — so an abandoned upload
  // leaves orphan bytes (invisible, cheap) rather than a manifest row pointing at nothing.
  //
  // The id is minted client-side (it is needed to name the R2 keys before this call), so
  // a primary-key collision is representable. Astronomically unlikely at 64 bits, but an
  // uncaught constraint error would surface as a 500, and a 500 on upload is the one place
  // a non-technical user has no idea what to do next.
  try {
    await insertImage(env.DB, item, await nextSortOrder(env.DB));
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (/UNIQUE|PRIMARY KEY|constraint/i.test(message)) {
      return json({ error: 'Image id already exists' }, 409);
    }
    throw cause;
  }
  return json({ ok: true, image: item }, 201);
}

async function handlePatch(request: Request, env: Env, id: string): Promise<Response> {
  if (!(await requireAuth(request, env))) return json({ error: 'Unauthorized' }, 401);

  let body: { alt?: unknown; sizeClass?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'Bad request' }, 400);
  }

  const patch: { alt?: string; sizeClass?: SizeClass } = {};
  if (typeof body.alt === 'string') patch.alt = body.alt.slice(0, 500);
  if (typeof body.sizeClass === 'string' && VALID_CLASSES.has(body.sizeClass)) {
    patch.sizeClass = body.sizeClass as SizeClass;
  }

  const changed = await updateImage(env.DB, id, patch);
  return changed ? json({ ok: true }) : json({ error: 'Not found' }, 404);
}

async function handleDelete(request: Request, env: Env, id: string): Promise<Response> {
  if (!(await requireAuth(request, env))) return json({ error: 'Unauthorized' }, 401);
  const changed = await softDeleteImage(env.DB, id);
  return changed ? json({ ok: true }) : json({ error: 'Not found' }, 404);
}

async function handleRestore(request: Request, env: Env, id: string): Promise<Response> {
  if (!(await requireAuth(request, env))) return json({ error: 'Unauthorized' }, 401);
  const changed = await restoreImage(env.DB, id);
  return changed ? json({ ok: true }) : json({ error: 'Not found' }, 404);
}

async function handleReorder(request: Request, env: Env): Promise<Response> {
  if (!(await requireAuth(request, env))) return json({ error: 'Unauthorized' }, 401);

  let ids: unknown;
  try {
    ({ ids } = (await request.json()) as { ids?: unknown });
  } catch {
    return json({ error: 'Bad request' }, 400);
  }
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
    return json({ error: 'Invalid order' }, 400);
  }

  await reorderImages(env.DB, ids as string[]);
  return json({ ok: true });
}

async function handleSettings(request: Request, env: Env): Promise<Response> {
  if (!(await requireAuth(request, env))) return json({ error: 'Unauthorized' }, 401);

  let body: { name?: unknown; contact?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'Bad request' }, 400);
  }

  const patch: { name?: string; contact?: string } = {};
  if (typeof body.name === 'string') patch.name = body.name.slice(0, 200);
  if (typeof body.contact === 'string') patch.contact = body.contact.slice(0, 200);

  await updateSettings(env.DB, patch);
  return json({ ok: true });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    if (pathname.startsWith('/img/')) {
      return method === 'GET' ? serveImage(url, env) : json({ error: 'Method not allowed' }, 405);
    }

    if (pathname.startsWith('/api/')) {
      if (pathname === '/api/images' && method === 'GET') {
        return json(await readManifest(env.DB), 200, { 'cache-control': 'no-cache' });
      }
      if (pathname === '/api/login' && method === 'POST') return handleLogin(request, env);
      if (pathname === '/api/images' && method === 'POST') return handleCreate(request, env);
      if (pathname === '/api/reorder' && method === 'POST') return handleReorder(request, env);
      if (pathname === '/api/settings' && method === 'PATCH') return handleSettings(request, env);
      if (pathname.startsWith('/api/upload/') && method === 'PUT') {
        return handleUpload(request, env, url);
      }

      const single = /^\/api\/images\/([a-f0-9]{16})$/.exec(pathname);
      if (single?.[1]) {
        if (method === 'PATCH') return handlePatch(request, env, single[1]);
        if (method === 'DELETE') return handleDelete(request, env, single[1]);
      }
      const restore = /^\/api\/images\/([a-f0-9]{16})\/restore$/.exec(pathname);
      if (restore?.[1] && method === 'POST') return handleRestore(request, env, restore[1]);

      return json({ error: 'Not found' }, 404);
    }

    // Hashed build assets — immutable, straight through.
    if (pathname.startsWith('/assets/')) return env.ASSETS.fetch(request);

    if (method === 'GET' || method === 'HEAD') {
      const asset = await env.ASSETS.fetch(request);

      // ANY html the asset server would return is replaced by the inlined shell.
      //
      // Returning the asset whenever it was not a 404 looked right and was wrong: for `/`
      // the asset server answers 200 with the un-inlined index.html, so serveShell never
      // ran and the manifest injection — the entire architectural point — silently did
      // nothing. Keying on the CONTENT TYPE rather than on the path also covers any future
      // route that resolves to a document.
      const isDocument = (asset.headers.get('content-type') ?? '').includes('text/html');
      if (asset.status !== 404 && !isDocument) return asset;

      return serveShell(request, env);
    }

    return json({ error: 'Method not allowed' }, 405);
  },
} satisfies ExportedHandler<Env>;
