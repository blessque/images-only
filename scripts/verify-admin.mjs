/**
 * End-to-end admin flow in a real browser against the real Worker.
 *
 * Unlock -> drop files -> compress in the Web Worker -> publish to R2/D1 -> the grid
 * updates -> reorder -> delete -> undo. Also asserts the thing the architecture is built
 * around: a NORMAL VISITOR never downloads the admin chunk.
 *
 * Prerequisites: `npm run build` and the local schema applied.
 *   node scripts/verify-admin.mjs
 */

import { chromium } from 'playwright-core';
import { execFile } from 'node:child_process';
import { spawn } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';

const run = promisify(execFile);
const PORT = 8789;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PASSWORD = 'test-password-1234';
const UPLOADS = path.resolve('.screens/uploads');

const failures = [];
function check(condition, message, detail = '') {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    console.log(`  ✗ ${message}${detail ? ` — ${detail}` : ''}`);
    failures.push(message);
  }
}

// A saturated red we can look for again after the round trip. Solid colour makes any
// colour-management error unmissable: a hue shift moves the channel values outright.
const SWATCH = { r: 200, g: 30, b: 54 };

async function makeSources() {
  await rm(UPLOADS, { recursive: true, force: true });
  await mkdir(UPLOADS, { recursive: true });

  // Big enough that compression has real work to do, and detailed enough that a lazy
  // encoder cannot hit the byte budget for free.
  await run('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=s=4000x2667',
    '-frames:v', '1', path.join(UPLOADS, 'Sunrise_over_the_bay.png'),
  ]);
  await run('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=s=2000x3000',
    '-frames:v', '1', path.join(UPLOADS, 'IMG_4821.png'),
  ]);
  const hex = `0x${[SWATCH.r, SWATCH.g, SWATCH.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  await run('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `color=c=${hex}:s=1600x1600`,
    '-frames:v', '1', path.join(UPLOADS, 'swatch.png'),
  ]);
  // SMALLER than the 1600 and 2400 rungs. This is the case that shipped broken: the
  // encoder correctly refuses to upscale, so those rungs are never written — and srcset
  // must not advertise them. Every earlier fixture was >= 2400px, which is exactly why
  // nothing caught it.
  await run('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=s=1024x1024',
    '-frames:v', '1', path.join(UPLOADS, 'small_1024.png'),
  ]);
  // Comfortably under the 150KB passthrough threshold AND already WebP — the exact case
  // where re-encoding costs quality and buys nothing.
  await run('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=s=600x400',
    '-frames:v', '1', '-c:v', 'libwebp', '-quality', '80', path.join(UPLOADS, 'tiny.webp'),
  ]);
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
  throw new Error('wrangler dev never came up');
}

async function main() {
  await makeSources();
  const server = spawn(
    'npx',
    ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--local'],
    { stdio: 'ignore' },
  );

  let browser;
  try {
    await waitForServer();
    browser = await chromium.launch({ executablePath: CHROME });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    const requested = [];
    page.on('request', (request) => requested.push(request.url()));

    // The bug that reached the browser was a 404 on a variant srcset advertised but the
    // encoder never wrote. Watch every image response for the whole run.
    const imageErrors = [];
    page.on('response', (response) => {
      if (response.url().includes('/img/') && response.status() >= 400) {
        imageErrors.push(`${response.status()} ${response.url().split('/').slice(-2).join('/')}`);
      }
    });

    // ── A normal visitor ─────────────────────────────────────────────────────
    console.log('\nPublic visitor');
    await page.goto(BASE, { waitUntil: 'networkidle' });
    check(
      !requested.some((url) => /AdminLayer|compressWorker/.test(url)),
      'never downloads the admin chunk or the compression worker',
    );

    // ── Unlock ───────────────────────────────────────────────────────────────
    console.log('\nUnlock');
    await page.keyboard.press('Alt+Backslash');
    await page.waitForSelector('.unlock-input', { timeout: 10_000 });
    check(true, 'Option+\\ opens the password field');

    await page.fill('.unlock-input', 'not-the-password');
    await page.click('.unlock-submit');
    await page.waitForSelector('.unlock-error', { timeout: 10_000 });
    check(true, 'a wrong password shows an error and stays locked');
    check(!(await page.isVisible('.admin-bar')), 'admin chrome does not appear on a failed unlock');

    await page.fill('.unlock-input', PASSWORD);
    await page.click('.unlock-submit');
    await page.waitForSelector('.admin-bar', { timeout: 15_000 });
    check(true, 'the correct password activates admin mode');

    // ── Staging and compression ──────────────────────────────────────────────
    console.log('\nCompression');
    await page.setInputFiles('input[type=file]', [
      path.join(UPLOADS, 'Sunrise_over_the_bay.png'),
      path.join(UPLOADS, 'IMG_4821.png'),
      path.join(UPLOADS, 'swatch.png'),
      path.join(UPLOADS, 'small_1024.png'),
      path.join(UPLOADS, 'tiny.webp'),
    ]);
    await page.waitForFunction(
      () => document.querySelectorAll('.tray-item.is-ready').length === 5,
      undefined,
      { timeout: 120_000 },
    );
    check(true, 'all five files compress in the Web Worker');

    // ── No compression, for files already small enough ───────────────────────
    console.log('\nNo compression');
    const boxes = await page.evaluate(() =>
      [...document.querySelectorAll('.tray-item')].map((item) => ({
        label: item.querySelector('.tray-fidelity')?.textContent?.trim() ?? '',
        checked: item.querySelector('.tray-fidelity input')?.checked ?? false,
        untouched: item.querySelector('.tray-untouched') !== null,
      })),
    );
    check(
      boxes.slice(0, 2).every((b) => b.label === 'High fidelity' && !b.checked),
      'large files still offer "High fidelity", unchecked',
      JSON.stringify(boxes.slice(0, 2)),
    );
    check(
      boxes.slice(2).every((b) => b.label === 'No compression' && b.checked),
      'files under 150KB offer "No compression", pre-CHECKED',
      JSON.stringify(boxes.slice(2)),
    );
    check(
      boxes.slice(2).every((b) => b.untouched),
      'and report their size as untouched rather than a fake before/after',
    );

    // Unchecking must actually run the ladder. Do it for the two that later tests need
    // laddered — the colour swatch and the small source whose maxRung is asserted.
    for (const nth of [3, 4]) {
      await page.uncheck(`.tray-item:nth-child(${nth}) .tray-fidelity input`);
    }
    await page.waitForFunction(
      () => document.querySelectorAll('.tray-item.is-ready').length === 5,
      undefined,
      { timeout: 120_000 },
    );
    const afterUncheck = await page.evaluate(() =>
      [...document.querySelectorAll('.tray-item')].map(
        (item) => item.querySelector('.tray-untouched') === null,
      ),
    );
    check(
      afterUncheck[2] === true && afterUncheck[3] === true,
      'unchecking it runs the normal ladder instead',
    );
    check(afterUncheck[4] === true ? false : true, 'the untouched file stays untouched');

    const sizes = await page.evaluate(() =>
      [...document.querySelectorAll('.tray-item')].map((item) => ({
        before: item.querySelector('.tray-before')?.textContent ?? '',
        after: item.querySelector('.tray-after')?.textContent ?? '',
        saved: item.querySelector('.tray-saved')?.textContent ?? '',
        alt: item.querySelector('.tray-alt')?.value ?? '',
        // A passthrough row reports one number and no saving, deliberately — nothing was
        // re-encoded, so a before/after would be theatre.
        untouched: item.querySelector('.tray-untouched') !== null,
      })),
    );
    console.log(`  · ${sizes.map((s) => `${s.before}→${s.after} ${s.saved}`).join('  |  ')}`);
    // Every file must shrink — but ">50% always" is not a real invariant. The swatch is a
    // solid colour: an 11KB PNG that is already near-optimally compressed has nothing to
    // give, and 8KB across FOUR rungs is ~2KB each, which is correct. Only sources with
    // actual photographic content can be held to the halving bar.
    const parsePercent = (saved) => Number(saved.replace(/[−%]/g, ''));
    const parseBytes = (text) => {
      const value = Number.parseFloat(text);
      return text.includes('MB') ? value * 1024 * 1024 : text.includes('KB') ? value * 1024 : value;
    };
    // Only COMPRESSED rows can be held to a shrinkage bar. A passthrough reports no
    // saving by design, so asserting one over it is asserting against the feature.
    const compressed = sizes.filter((s) => !s.untouched);
    check(
      compressed.every((s) => parsePercent(s.saved) > 0),
      'every compressed file shrinks, with honest before/after byte counts',
    );
    check(
      compressed
        .filter((s) => parseBytes(s.before) > 100 * 1024)
        .every((s) => parsePercent(s.saved) > 50),
      'photographic sources shrink by more than half across the whole ladder',
    );
    check(
      sizes[0]?.alt === 'Sunrise over the bay',
      'alt text is prefilled from the filename',
      `got "${sizes[0]?.alt}"`,
    );
    check(
      sizes[1]?.alt === '',
      'a camera-dump filename (IMG_4821) yields empty alt rather than noise',
      `got "${sizes[1]?.alt}"`,
    );

    // ── Tray controls ────────────────────────────────────────────────────────
    console.log('\nTray');
    const firstAltBefore = await page.inputValue('.tray-item:nth-child(1) .tray-alt');
    await page.click('.tray-item:nth-child(1) [aria-label="Move down"]');
    await page.waitForTimeout(200);
    check(
      (await page.inputValue('.tray-item:nth-child(2) .tray-alt')) === firstAltBefore,
      'files can be reordered in the tray, BEFORE publishing',
    );

    const sizeBefore = await page.textContent('.tray-item:nth-child(1) .tray-after');
    await page.check('.tray-item:nth-child(1) .tray-fidelity input');
    await page.waitForFunction(
      () => document.querySelectorAll('.tray-item.is-ready').length === 4,
      undefined,
      { timeout: 120_000 },
    );
    const sizeAfter = await page.textContent('.tray-item:nth-child(1) .tray-after');
    check(
      sizeBefore !== sizeAfter,
      `high fidelity RE-ENCODES rather than doing nothing (${sizeBefore} → ${sizeAfter})`,
    );

    // ── Publish ──────────────────────────────────────────────────────────────
    console.log('\nPublish');
    const before = (await (await fetch(`${BASE}/api/images`)).json()).images.length;
    await page.click('.tray-primary');
    await page.waitForFunction(
      (n) => document.querySelectorAll('.tile').length === n + 5,
      before,
      { timeout: 120_000 },
    );
    check(true, `five images publish and appear in the grid (${before} → ${before + 5})`);

    const manifest = await (await fetch(`${BASE}/api/images`)).json();
    check(manifest.images.length === before + 5, 'and they persist in the manifest');

    // ── The passthrough object ───────────────────────────────────────────────
    const passed = manifest.images.find((image) => image.passthrough);
    check(passed !== undefined, 'the untouched file is recorded as a passthrough');
    if (passed) {
      check(passed.format === 'webp', `and keeps its own format (${passed.format})`);
      const original = await readFile(path.join(UPLOADS, 'tiny.webp'));
      const served = await fetch(`${BASE}/img/${passed.id}/full.${passed.format}`);
      check(served.ok, `its single object serves from R2 (${served.status})`);
      check(
        served.headers.get('content-type') === 'image/webp',
        `served under its true content type (${served.headers.get('content-type')})`,
      );
      check(
        (await served.arrayBuffer()).byteLength === original.byteLength,
        'BYTE-IDENTICAL to the source — nothing was re-encoded',
      );
    }

    const small = manifest.images.find((image) => image.maxRung < 2400);
    check(
      small !== undefined,
      'the 1024px source records a maxRung below the top of the ladder',
      `maxRungs: ${manifest.images.map((i) => i.maxRung).join(', ')}`,
    );
    await page.waitForTimeout(800);
    check(
      imageErrors.length === 0,
      'NO image request 404s — srcset never advertises a variant that was not written',
      imageErrors.slice(0, 4).join(', '),
    );

    const uncropped = await page.evaluate(() =>
      [...document.querySelectorAll('.tile-img')]
        .filter((img) => img.complete && img.naturalWidth > 0)
        .every((img) => {
          const box = img.getBoundingClientRect();
          return Math.abs(img.naturalWidth / img.naturalHeight - box.width / box.height) < 0.02;
        }),
    );
    check(uncropped, 'newly published images render at their true aspect ratio');

    // ── Colour fidelity ──────────────────────────────────────────────────────
    console.log('\nColour');
    // By name, not by position — the tray-reorder step above moves things around, and
    // there are four files now. Indexing into the manifest silently sampled the wrong
    // image and reported a 187-channel "colour drift" that was pure test error.
    const swatch = manifest.images.find((image) => image.alt === 'Swatch');
    check(swatch !== undefined, 'the swatch is findable by its alt text');
    const swatchId = swatch?.id ?? manifest.images[0].id;
    const sampled = await page.evaluate(async (id) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.src = `/img/${id}/400.webp`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      const [r, g, b] = ctx.getImageData(canvas.width >> 1, canvas.height >> 1, 1, 1).data;
      return { r, g, b };
    }, swatchId);
    const drift = Math.max(
      Math.abs(sampled.r - SWATCH.r),
      Math.abs(sampled.g - SWATCH.g),
      Math.abs(sampled.b - SWATCH.b),
    );
    console.log(`  · sent rgb(${SWATCH.r},${SWATCH.g},${SWATCH.b}) got rgb(${sampled.r},${sampled.g},${sampled.b})`);
    check(drift <= 4, `a solid swatch survives the pipeline (max channel drift ${drift})`);

    // ── Reorder ──────────────────────────────────────────────────────────────
    console.log('\nEditing');
    const firstId = manifest.images[0].id;
    const secondId = manifest.images[1].id;
    await page.click(`.tile:nth-child(1) .tc-wrap`, { force: true }).catch(() => {});
    await page.evaluate(() => {
      const button = [...document.querySelectorAll('.tc-btn')].find(
        (b) => b.getAttribute('aria-label') === 'Move later',
      );
      button?.click();
    });
    await page.waitForTimeout(900);
    const reordered = await (await fetch(`${BASE}/api/images`)).json();
    check(
      reordered.images[0].id === secondId && reordered.images[1].id === firstId,
      'the arrow icon reorders, and the new order persists server-side',
    );

    // ── Delete and undo ──────────────────────────────────────────────────────
    const doomed = reordered.images[0].id;
    await page.evaluate(() => {
      const button = [...document.querySelectorAll('.tc-btn')].find(
        (b) => b.getAttribute('aria-label') === 'Delete',
      );
      button?.click();
    });
    await page.waitForSelector('.toast', { timeout: 10_000 });
    await page.waitForTimeout(600);
    const afterDelete = await (await fetch(`${BASE}/api/images`)).json();
    check(
      !afterDelete.images.some((image) => image.id === doomed),
      'delete removes the image and raises an undo toast',
    );

    await page.click('.toast button');
    await page.waitForTimeout(900);
    const afterUndo = await (await fetch(`${BASE}/api/images`)).json();
    check(
      afterUndo.images.some((image) => image.id === doomed),
      'undo brings it back — soft delete kept the R2 bytes',
    );

    // ── Reload ends the session ──────────────────────────────────────────────
    console.log('\nSession');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    check(
      !(await page.isVisible('.admin-bar')),
      'reloading the page locks admin again — the token lived only in memory',
    );

    await page.screenshot({ path: '.screens/admin-flow.png' });
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
  }

  console.log(
    failures.length === 0
      ? '\nAll admin checks passed.'
      : `\n${failures.length} CHECK(S) FAILED:\n - ${failures.join('\n - ')}`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
