/**
 * Drives the PHP site over HTTP, the way the browser does.
 *
 *   npm run verify:php:api
 *
 * Everything here is a real request to a real PHP process talking to a real MySQL database.
 * The unit tests in php/tests cover the crypto in isolation; this covers the thing they
 * cannot — that the router, .htaccess-equivalent rewriting, PDO, the filesystem store and the
 * auth checks compose into a working site.
 *
 * ADMIN_AUTH.md requires that EVERY write route reject a forged token, per route, with a test
 * proving it — because centralised auth is correct right up until someone adds a route
 * outside the guarded group, and that failure is silent. That requirement is why the
 * unauthorised sweep below enumerates routes rather than spot-checking one.
 *
 * Needs mysql running and a database it may DROP. Set MYSQL_DSN-ish values via env:
 *   PHP_TEST_DB_HOST (localhost) PHP_TEST_DB_PORT (3306)
 *   PHP_TEST_DB_NAME (justimages_test) PHP_TEST_DB_USER (root) PHP_TEST_DB_PASS ('')
 */

import { execFileSync, spawn } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PHP = process.env.PHP_BINARY ?? 'php';
const MYSQL = process.env.MYSQL_BINARY ?? 'mysql';
const PORT = Number(process.env.PHP_TEST_PORT ?? 8796);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'a-test-password-long-enough';

const db = {
  host: process.env.PHP_TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.PHP_TEST_DB_PORT ?? 3306),
  name: process.env.PHP_TEST_DB_NAME ?? 'justimages_test',
  user: process.env.PHP_TEST_DB_USER ?? 'root',
  pass: process.env.PHP_TEST_DB_PASS ?? '',
};

let failures = 0;
let checks = 0;

function check(name, condition, detail = '') {
  checks++;
  if (!condition) {
    failures++;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function mysql(sql) {
  const args = ['-h', db.host, '-P', String(db.port), '-u', db.user];
  if (db.pass) args.push(`-p${db.pass}`);
  args.push('-e', sql);
  execFileSync(MYSQL, args, { stdio: ['ignore', 'pipe', 'pipe'] });
}

/** A 1x1 WebP. Real bytes, so the store writes a real file and the server serves it back. */
const PIXEL = Buffer.from(
  'UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==',
  'base64',
);

async function api(method, route, { token, body, raw } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';

  const response = await fetch(BASE + route, {
    method,
    headers,
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });

  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not every route answers JSON — the shell is HTML */
  }
  return { status: response.status, json, text, headers: response.headers };
}

const workspace = mkdtempSync(path.join(tmpdir(), 'justimages-api-'));
let server;

try {
  // A site laid out exactly as build-php.mjs produces it.
  cpSync('php/index.php', path.join(workspace, 'index.php'));
  cpSync('php/install.php', path.join(workspace, 'install.php'));
  cpSync('php/schema.sql', path.join(workspace, 'schema.sql'));
  cpSync('php/lib', path.join(workspace, 'lib'), { recursive: true });
  cpSync('php/tests/fixtures/shell.html', path.join(workspace, 'index.html'));

  mysql(`DROP DATABASE IF EXISTS \`${db.name}\`; CREATE DATABASE \`${db.name}\``);

  writeFileSync(
    path.join(workspace, 'config.php'),
    `<?php return ${JSON.stringify({ ...db }).replace(/"/g, "'")};\n`,
  );

  // The PHP built-in server has no .htaccess, so a router script does the rewriting: real
  // files served as-is, everything else to index.php. That is what Apache's rules amount to.
  writeFileSync(
    path.join(workspace, 'router.php'),
    `<?php
     $file = __DIR__ . parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
     if (is_file($file) && !str_ends_with($file, '.php')) return false;
     require __DIR__ . '/index.php';\n`,
  );

  execFileSync(PHP, ['-r', `
    require '${workspace}/lib/db.php';
    install_schema(db());
  `], { cwd: workspace, stdio: ['ignore', 'pipe', 'inherit'] });

  server = spawn(PHP, ['-S', `127.0.0.1:${PORT}`, '-t', workspace, path.join(workspace, 'router.php')], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await fetch(BASE + '/api/setup');
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  // ── Setup and claim ────────────────────────────────────────────────────────────────────

  let response = await api('GET', '/api/setup');
  check('an unclaimed site reports itself unclaimed', response.json?.claimed === false);
  check('the minimum password length is advertised', response.json?.minPasswordLength === 12);

  response = await api('POST', '/api/login', { body: { password: PASSWORD } });
  check('login before claiming says setup is required', response.status === 409 && response.json?.setupRequired === true);

  response = await api('POST', '/api/setup', { body: { password: 'short' } });
  check('a short password is refused', response.status === 400);

  response = await api('POST', '/api/setup', { body: { password: PASSWORD } });
  check('the site can be claimed', response.status === 200 && typeof response.json?.token === 'string');
  const token = response.json?.token;

  response = await api('POST', '/api/setup', { body: { password: PASSWORD } });
  check('a second claim is refused', response.status === 409);

  response = await api('GET', '/api/setup');
  check('a claimed site reports itself claimed', response.json?.claimed === true);

  // ── Login ──────────────────────────────────────────────────────────────────────────────

  response = await api('POST', '/api/login', { body: { password: PASSWORD } });
  check('the right password logs in', response.status === 200 && typeof response.json?.token === 'string');

  response = await api('POST', '/api/login', { body: { password: 'wrong-password-here' } });
  check('the wrong password does not', response.status === 401);
  check('and the response is not "not set up"', response.json?.setupRequired === undefined);

  // ── Every write route rejects a forged token, one by one ───────────────────────────────
  //
  // Per ADMIN_AUTH.md: not "the router checks it" — each route, each with its own assertion.

  const id = 'a1b2c3d4e5f60718';
  const forged = 'ZXlKbGVIQWlPakY5.bm90LWEtcmVhbC1zaWduYXR1cmU';
  const writes = [
    ['POST', '/api/images', { body: { id, aspect: 1.5, sizeClass: 'wide', maxRung: 800, format: 'webp' } }],
    ['PATCH', `/api/images/${id}`, { body: { alt: 'x' } }],
    ['DELETE', `/api/images/${id}`, {}],
    ['POST', `/api/images/${id}/restore`, {}],
    ['POST', '/api/reorder', { body: { ids: [id] } }],
    ['PATCH', '/api/settings', { body: { name: 'x' } }],
    ['PUT', `/api/upload/${id}/400.webp`, { raw: PIXEL }],
  ];

  for (const [method, route, options] of writes) {
    const noToken = await api(method, route, options);
    check(`${method} ${route} rejects a request with no token`, noToken.status === 401, `got ${noToken.status}`);

    const badToken = await api(method, route, { ...options, token: forged });
    check(`${method} ${route} rejects a forged token`, badToken.status === 401, `got ${badToken.status}`);
  }

  // ── The upload flow, as the admin panel performs it ─────────────────────────────────────

  response = await api('PUT', `/api/upload/${id}/400.webp`, { token, raw: PIXEL });
  check('a variant uploads', response.status === 200 && response.json?.ok === true);

  response = await api('PUT', `/api/upload/${id}/400.webp`, { token, raw: PIXEL });
  check('the same key cannot be overwritten', response.status === 409);

  response = await api('PUT', `/api/upload/${id}/full.php`, { token, raw: PIXEL });
  check('a php extension cannot be uploaded', response.status === 400);

  response = await api('PUT', `/api/upload/${id}/999.webp`, { token, raw: PIXEL });
  check('a rung outside the ladder cannot be uploaded', response.status === 400);

  response = await api('PUT', `/api/upload/${id}/800.webp`, { token, raw: Buffer.alloc(0) });
  check('an empty body is refused', response.status === 400);

  response = await api('POST', '/api/images', {
    token,
    body: { id, aspect: 1.5, sizeClass: 'wide', maxRung: 400, format: 'webp' },
  });
  check('the image row is created', response.status === 201);

  response = await api('POST', '/api/images', {
    token,
    body: { id, aspect: 1.5, sizeClass: 'wide', maxRung: 400, format: 'webp' },
  });
  check('a duplicate id is a 409, not a 500', response.status === 409);

  response = await api('POST', '/api/images', { token, body: { id: 'zzz', aspect: 1.5, sizeClass: 'wide' } });
  check('an invalid id is refused', response.status === 400);

  response = await api('POST', '/api/images', {
    token,
    body: { id: 'b1b2c3d4e5f60718', aspect: 1.5, sizeClass: 'enormous', maxRung: 400, format: 'webp' },
  });
  check('an unknown size class is refused', response.status === 400);

  // ── Serving ────────────────────────────────────────────────────────────────────────────

  response = await api('GET', `/img/${id}/400.webp`);
  check('the uploaded variant is served', response.status === 200);
  check('with an immutable cache header', (response.headers.get('cache-control') ?? '').includes('immutable'));
  check('and an etag', (response.headers.get('etag') ?? '') !== '');

  const conditional = await fetch(`${BASE}/img/${id}/400.webp`, {
    headers: { 'if-none-match': response.headers.get('etag') },
  });
  check('a conditional request gets a 304', conditional.status === 304);

  response = await api('GET', `/img/${id}/1600.webp`);
  check('a rung that was never uploaded 404s', response.status === 404);

  // ── The manifest and the shell ─────────────────────────────────────────────────────────

  response = await api('GET', '/api/images');
  check('the manifest lists the image', response.json?.images?.length === 1);
  check('aspect is a number, not a string', typeof response.json?.images?.[0]?.aspect === 'number');
  check('passthrough is a boolean, not 0/1', typeof response.json?.images?.[0]?.passthrough === 'boolean');

  response = await api('PATCH', `/api/images/${id}`, { token, body: { alt: 'Тест <script>', sizeClass: 'solo' } });
  check('the image can be edited', response.status === 200);

  response = await api('GET', '/');
  check('the shell renders', response.status === 200 && response.text.includes('id="manifest"'));
  check('the manifest is inlined into it', response.text.includes('"sizeClass":"solo"'));
  check('cyrillic alt text survives', response.text.includes('Тест'));
  check('a script tag in alt text is escaped', !response.text.includes('<script>Тест') && response.text.includes('\\u003c'));

  // ── Soft delete and undo ───────────────────────────────────────────────────────────────

  response = await api('DELETE', `/api/images/${id}`, { token });
  check('the image can be deleted', response.status === 200);

  response = await api('GET', '/api/images');
  check('a deleted image leaves the manifest', response.json?.images?.length === 0);

  response = await api('GET', `/img/${id}/400.webp`);
  check('but its bytes are still there, so undo works', response.status === 200);

  response = await api('POST', `/api/images/${id}/restore`, { token });
  check('the image can be restored', response.status === 200);

  response = await api('GET', '/api/images');
  check('and it is back in the manifest', response.json?.images?.length === 1);

  response = await api('DELETE', '/api/images/ffffffffffffffff', { token });
  check('deleting an unknown id is a 404', response.status === 404);

  // ── Settings ───────────────────────────────────────────────────────────────────────────

  response = await api('PATCH', '/api/settings', { token, body: { name: 'Никита', contact: 'hi@example.com' } });
  check('settings can be written', response.status === 200);

  response = await api('GET', '/api/images');
  check('the name comes back', response.json?.settings?.name === 'Никита');
  check('the contact comes back', response.json?.settings?.contact === 'hi@example.com');
  check('credentials never appear in the manifest', !JSON.stringify(response.json).includes('pbkdf2'));

  // ── Reordering ─────────────────────────────────────────────────────────────────────────

  const second = 'c1b2c3d4e5f60718';
  await api('PUT', `/api/upload/${second}/400.webp`, { token, raw: PIXEL });
  await api('POST', '/api/images', {
    token,
    body: { id: second, aspect: 1, sizeClass: 'wide', maxRung: 400, format: 'webp' },
  });

  response = await api('POST', '/api/reorder', { token, body: { ids: [second, id] } });
  check('a new order is accepted', response.status === 200);

  response = await api('GET', '/api/images');
  check('and the manifest reflects it', response.json?.images?.[0]?.id === second);

  response = await api('POST', '/api/reorder', { token, body: { ids: 'not-an-array' } });
  check('a malformed order is refused', response.status === 400);

  // ── Rate limiting ──────────────────────────────────────────────────────────────────────
  //
  // ADMIN_AUTH.md: ship it with the endpoint or do not ship the endpoint.

  mysql(`USE \`${db.name}\`; DELETE FROM login_attempts`);
  let limited = false;
  for (let attempt = 0; attempt < 12; attempt++) {
    const result = await api('POST', '/api/login', { body: { password: 'wrong-password-here' } });
    if (result.status === 429) {
      limited = true;
      check('the lockout sends Retry-After', (result.headers.get('retry-after') ?? '') !== '');
      break;
    }
  }
  check('repeated wrong passwords are locked out', limited);

  response = await api('POST', '/api/login', { body: { password: PASSWORD } });
  check('and the lockout applies to the CORRECT password too', response.status === 429);

  // ── The installer refuses to run twice ─────────────────────────────────────────────────

  response = await api('GET', '/install.php');
  check('install.php is inert once the site is claimed', response.text.includes('Already set up'));
  check('and does not show the form', !response.text.includes('name="admin_password"'));

  // ── Unknown routes ─────────────────────────────────────────────────────────────────────

  response = await api('GET', '/api/nonexistent');
  check('an unknown api route 404s as JSON', response.status === 404 && response.json?.error !== undefined);

  response = await api('POST', '/', {});
  check('a POST to the shell is refused', response.status === 405);
} finally {
  if (server) server.kill();
  rmSync(workspace, { recursive: true, force: true });
  try {
    mysql(`DROP DATABASE IF EXISTS \`${db.name}\``);
  } catch {
    /* the database may never have been created */
  }
}

console.log(
  failures === 0
    ? `ok — ${checks} API checks passed`
    : `FAILED — ${failures} of ${checks} API checks failed`,
);
process.exit(failures === 0 ? 0 : 1);
