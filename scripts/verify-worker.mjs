/**
 * Integration test against the real Worker, running on local D1 + R2 emulation.
 *
 * No Cloudflare account needed. This is the only way to prove the claims in
 * docs/architecture/ADMIN_AUTH.md are true of the SHIPPING routes rather than of the
 * helper functions the unit tests cover.
 *
 * Prerequisites: `npm run build`, `.dev.vars`, and the local schema applied:
 *   npx wrangler d1 execute justimages --local --file=worker/schema.sql
 *
 *   node scripts/verify-worker.mjs
 */

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const PORT = 8788;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'test-password-1234';

const failures = [];
function check(condition, message, detail = '') {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    console.log(`  ✗ ${message}${detail ? ` — ${detail}` : ''}`);
    failures.push(message);
  }
}

const newId = () =>
  [...crypto.getRandomValues(new Uint8Array(8))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

const id = newId();
/** A second image, for the JPEG ladder a browser without a WebP encoder produces. */
const jpgId = newId();

async function waitForServer(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/api/images`);
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('wrangler dev never came up');
}

async function main() {
  const server = spawn(
    'npx',
    ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--local'],
    { stdio: 'ignore' },
  );

  try {
    await waitForServer();

    // ── Public surface ───────────────────────────────────────────────────────
    console.log('\nPublic');
    const shell = await fetch(`${BASE}/`);
    const html = await shell.text();
    check(shell.ok, `GET / serves the shell (${shell.status})`);
    check(
      /<script type="application\/json" id="manifest">\{/.test(html),
      'the manifest is INLINED into the HTML, not fetched',
    );
    check(shell.headers.get('etag') !== null, 'the shell carries an ETag for revalidation');

    const notModified = await fetch(`${BASE}/`, {
      headers: { 'if-none-match': shell.headers.get('etag') ?? '' },
    });
    check(notModified.status === 304, `an unchanged shell revalidates to 304 (${notModified.status})`);

    // ── Auth: every write route, unauthenticated ─────────────────────────────
    console.log('\nAuth — no token');
    const writes = [
      ['POST', '/api/images', '{}'],
      ['POST', '/api/reorder', '{"ids":[]}'],
      ['PATCH', '/api/settings', '{"name":"x"}'],
      ['PATCH', `/api/images/${id}`, '{"alt":"x"}'],
      ['DELETE', `/api/images/${id}`, null],
      ['POST', `/api/images/${id}/restore`, null],
      ['PUT', `/api/upload/${id}/400.webp`, 'x'],
    ];
    for (const [method, path, body] of writes) {
      const response = await fetch(BASE + path, { method, body });
      check(response.status === 401, `${method} ${path} → 401 without a token`, `got ${response.status}`);
    }

    console.log('\nAuth — forged token');
    for (const [method, path, body] of writes) {
      const response = await fetch(BASE + path, {
        method,
        body,
        headers: { authorization: 'Bearer eyJleHAiOjk5OTk5OTk5OTk5OTl9.ZmFrZXNpZ25hdHVyZQ' },
      });
      check(response.status === 401, `${method} ${path} → 401 with a forged token`, `got ${response.status}`);
    }

    // ── Setup / claim ────────────────────────────────────────────────────────
    //
    // This run has ADMIN_PASSWORD_HASH in .dev.vars, so it exercises the case that matters
    // most for an EXISTING deployment: credentials in Worker secrets still work, and the
    // new claim endpoint refuses to hand the site to anyone.
    console.log('\nSetup');
    const setupState = await fetch(`${BASE}/api/setup`);
    const state = await setupState.json();
    check(state.claimed === true, 'a site configured by Worker secrets reports itself claimed');

    const takeover = await fetch(`${BASE}/api/setup`, {
      method: 'POST',
      body: JSON.stringify({ password: 'attacker-owns-this-now', code: '' }),
    });
    check(takeover.status === 409, `claiming an already-claimed site returns 409 (${takeover.status})`);

    const stillWorks = await fetch(`${BASE}/api/login`, {
      method: 'POST',
      body: JSON.stringify({ password: PASSWORD }),
    });
    check(stillWorks.ok, 'the original password still works after a rejected takeover');

    // ── Login ────────────────────────────────────────────────────────────────
    console.log('\nLogin');
    const wrong = await fetch(`${BASE}/api/login`, {
      method: 'POST',
      body: JSON.stringify({ password: 'wrong' }),
    });
    check(wrong.status === 401, `a wrong password fails closed (${wrong.status})`);

    const right = await fetch(`${BASE}/api/login`, {
      method: 'POST',
      body: JSON.stringify({ password: PASSWORD }),
    });
    const { token } = await right.json();
    check(right.ok && typeof token === 'string', 'the correct password returns a token');
    const auth = { authorization: `Bearer ${token}` };

    // ── Authenticated write path ─────────────────────────────────────────────
    console.log('\nWrite path');
    const webp = await readFile('fixtures/fx03/400.webp');
    const upload = await fetch(`${BASE}/api/upload/${id}/400.webp`, {
      method: 'PUT',
      headers: auth,
      body: webp,
    });
    check(upload.ok, `uploading a variant succeeds (${upload.status})`);

    const badRung = await fetch(`${BASE}/api/upload/${id}/999.webp`, {
      method: 'PUT',
      headers: auth,
      body: webp,
    });
    check(badRung.status === 400, `an off-ladder variant is rejected (${badRung.status})`);

    const served = await fetch(`${BASE}/img/${id}/400.webp`);
    check(served.ok, `the variant serves back from R2 (${served.status})`);
    check(
      (served.headers.get('cache-control') ?? '').includes('immutable'),
      'variants are served immutable — safe only because keys are never overwritten',
    );
    check(
      (await served.arrayBuffer()).byteLength === webp.byteLength,
      'the bytes round-trip unchanged',
    );

    // ── A ladder is always webp ──────────────────────────────────────────────
    // Safari cannot encode WebP from a canvas and `convertToBlob` does not say so — it
    // returns PNG, which shipped 1.3MB "variants" of 160KB photographs. The answer is a wasm
    // encoder, and failing that KEEPING THE ORIGINAL as a passthrough. What must never
    // happen is a ladder in some other format: that would cost transparency, and it would
    // put bytes behind a key whose extension disagrees with them.
    console.log('\nThe ladder is webp, and only webp');
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0, 0, 0, 0]);
    for (const extension of ['jpg', 'png', 'gif']) {
      const rejected = await fetch(`${BASE}/api/upload/${jpgId}/400.${extension}`, {
        method: 'PUT',
        headers: auth,
        body: jpegBytes,
      });
      check(rejected.status === 400, `a .${extension} ladder rung is rejected (${rejected.status})`);
    }

    const jpgLadder = await fetch(`${BASE}/api/images`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ id: jpgId, aspect: 1, sizeClass: 'tight', alt: '', maxRung: 400, passthrough: false, format: 'jpg' }),
    });
    check(jpgLadder.status === 400, `a ladder image cannot declare a non-webp format (${jpgLadder.status})`);

    // A PASSTHROUGH may be any format we can serve — that is the whole escape hatch.
    const original = await fetch(`${BASE}/api/upload/${jpgId}/full.jpg`, {
      method: 'PUT',
      headers: auth,
      body: jpegBytes,
    });
    check(original.ok, `but an untouched ORIGINAL may be a jpg (${original.status})`);
    const originalServed = await fetch(`${BASE}/img/${jpgId}/full.jpg`);
    check(
      originalServed.headers.get('content-type') === 'image/jpeg',
      'and serves under its own content type',
      `got ${originalServed.headers.get('content-type')}`,
    );

    // Alt text is user-controlled and lands in a <script> block. This is the injection.
    const xssAlt = 'caption </script><img src=x onerror=alert(1)>';
    const created = await fetch(`${BASE}/api/images`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ id, aspect: 1.5, sizeClass: 'tight', alt: xssAlt, maxRung: 400, passthrough: false, format: 'webp' }),
    });
    check(created.status === 201, `creating the metadata row succeeds (${created.status})`);

    const duplicate = await fetch(`${BASE}/api/images`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ id, aspect: 1.5, sizeClass: 'tight', alt: '', maxRung: 400, passthrough: false, format: 'webp' }),
    });
    check(duplicate.status === 409, `a colliding id returns 409, not a 500 (${duplicate.status})`);

    const invalid = await fetch(`${BASE}/api/images`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'nope', aspect: -1, sizeClass: 'huge', maxRung: 9999 }),
    });
    check(invalid.status === 400, `invalid image metadata is rejected (${invalid.status})`);

    console.log('\nInjection');
    const shell2 = await fetch(`${BASE}/`);
    const html2 = await shell2.text();
    check(
      !html2.includes('</script><img src=x'),
      'a caption containing </script> cannot break out of the manifest block',
    );
    check(html2.includes('\\u003c/script>'), 'the < is escaped as \\u003c in the inlined JSON');
    check(html2.includes(id), 'the new image reaches the inlined manifest');

    // ── Soft delete and restore ──────────────────────────────────────────────
    console.log('\nSoft delete');
    const deleted = await fetch(`${BASE}/api/images/${id}`, { method: 'DELETE', headers: auth });
    check(deleted.ok, `delete succeeds (${deleted.status})`);
    const afterDelete = await (await fetch(`${BASE}/api/images`)).json();
    check(
      !afterDelete.images.some((image) => image.id === id),
      'a deleted image leaves the manifest',
    );
    const stillThere = await fetch(`${BASE}/img/${id}/400.webp`);
    check(stillThere.ok, 'but its R2 bytes survive, so undo can bring it back');

    const restored = await fetch(`${BASE}/api/images/${id}/restore`, { method: 'POST', headers: auth });
    check(restored.ok, `restore succeeds (${restored.status})`);
    const afterRestore = await (await fetch(`${BASE}/api/images`)).json();
    check(
      afterRestore.images.some((image) => image.id === id),
      'and the image returns to the manifest',
    );

    // ── Rate limiting — LAST, because it locks this client out ────────────────
    console.log('\nRate limiting');
    let sawLimit = false;
    let attempts = 0;
    for (let n = 0; n < 12; n++) {
      const response = await fetch(`${BASE}/api/login`, {
        method: 'POST',
        body: JSON.stringify({ password: `guess-${n}` }),
      });
      attempts++;
      if (response.status === 429) {
        sawLimit = true;
        check(
          response.headers.get('retry-after') !== null,
          'the 429 carries Retry-After so a client knows when to stop',
        );
        break;
      }
    }
    check(sawLimit, `brute force is cut off (after ${attempts} attempts)`);

    const lockedOut = await fetch(`${BASE}/api/login`, {
      method: 'POST',
      body: JSON.stringify({ password: PASSWORD }),
    });
    check(
      lockedOut.status === 429,
      'even the CORRECT password is refused while limited — the limiter is not a password oracle',
      `got ${lockedOut.status}`,
    );
  } finally {
    server.kill('SIGTERM');
  }

  console.log(
    failures.length === 0
      ? '\nAll worker checks passed.'
      : `\n${failures.length} CHECK(S) FAILED:\n - ${failures.join('\n - ')}`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
