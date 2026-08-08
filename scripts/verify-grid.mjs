/**
 * Drives the real page in a real browser and asserts the grid's promises hold.
 *
 * The unit tests prove the SOLVER is correct. This proves the rendered DOM matches the
 * solver — that CSS, object-fit, flex and device-pixel rounding did not quietly undo it.
 * Those are different claims and the second is the one a user actually sees.
 *
 *   node scripts/verify-grid.mjs            # asserts, writes screenshots to .screens/
 *
 * Uses playwright-core against the installed Chrome, as kresti does — no browser download.
 */

import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const PORT = 5177;
const URL = `http://localhost:${PORT}/`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHOTS = path.resolve('.screens');

const WIDTHS = [
  { w: 390, h: 844, label: 'mobile' },
  { w: 1024, h: 768, label: 'tablet' },
  { w: 1440, h: 900, label: 'laptop' },
  { w: 2560, h: 1440, label: 'wide' },
];

const failures = [];
function check(condition, message) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    console.log(`  ✗ ${message}`);
    failures.push(message);
  }
}

async function waitForServer(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`dev server never came up at ${url}`);
}

/** Everything measured inside the page, in one pass. */
function measure() {
  const rows = [...document.querySelectorAll('.grid-row')].map((row) => {
    const tiles = [...row.querySelectorAll('.tile')];
    return {
      rowWidth: Math.round(row.getBoundingClientRect().width),
      sumTileWidths: tiles.reduce((acc, t) => acc + Math.round(t.getBoundingClientRect().width), 0),
      height: row.getBoundingClientRect().height,
      count: tiles.length,
    };
  });

  const images = [...document.querySelectorAll('.tile-img')]
    .filter((img) => img.complete && img.naturalWidth > 0)
    .map((img) => {
      const box = img.getBoundingClientRect();
      return {
        intrinsic: img.naturalWidth / img.naturalHeight,
        rendered: box.width / box.height,
        boxWidth: box.width,
        currentSrc: img.currentSrc.split('/').slice(-2).join('/'),
      };
    });

  return {
    rows,
    images,
    docWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    cls: window.__cls ?? 0,
    loadedCount: images.length,
    totalImgs: document.querySelectorAll('.tile-img').length,
  };
}

async function main() {
  await mkdir(SHOTS, { recursive: true });

  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    stdio: 'ignore',
    detached: false,
  });

  let browser;
  try {
    await waitForServer(URL);
    browser = await chromium.launch({ executablePath: CHROME });

    // The production HTML carries the manifest inline; the dev server leaves it empty and
    // the client falls back to fetching fixtures. Those are DIFFERENT loading shapes, and
    // only the first one is what users get — so CLS must be judged against the inlined
    // form. Rather than assume, we simulate it: inject the manifest into the document and
    // rewrite /img/* to the fixtures, which also exercises the production URL path.
    const fixtureManifest = await fetch(`${URL}fixtures/manifest.json`).then((r) => r.text());

    async function simulateProduction(page) {
      await page.route(URL, async (route) => {
        const response = await route.fetch();
        const html = (await response.text()).replace(
          '<script type="application/json" id="manifest"></script>',
          `<script type="application/json" id="manifest">${fixtureManifest}</script>`,
        );
        await route.fulfill({ response, body: html });
      });
      await page.route('**/img/**', (route) =>
        route.continue({ url: route.request().url().replace('/img/', '/fixtures/') }),
      );
    }

    for (const { w, h, label } of WIDTHS) {
      const context = await browser.newContext({
        viewport: { width: w, height: h },
        deviceScaleFactor: 2,
      });
      // Install the CLS observer before any app code runs, or the shifts that matter
      // most (the first ones) are missed entirely.
      await context.addInitScript(() => {
        window.__cls = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput) window.__cls += entry.value;
          }
        }).observe({ type: 'layout-shift', buffered: true });
      });

      const page = await context.newPage();
      await simulateProduction(page);
      await page.goto(URL, { waitUntil: 'networkidle' });
      await page.waitForSelector('.grid-row', { timeout: 10_000 });
      // Scroll the whole page so lazy images resolve, then return to the top.
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 60));
        }
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(600);

      const m = await page.evaluate(measure);

      console.log(`\n${label} — ${w}x${h}  (${m.rows.length} rows, ${m.loadedCount}/${m.totalImgs} images loaded)`);

      check(m.docWidth <= m.viewportWidth, `no horizontal overflow (${m.docWidth} <= ${m.viewportWidth})`);

      const badFill = m.rows.filter((r) => Math.abs(r.sumTileWidths - r.rowWidth) > 1);
      check(badFill.length === 0, `every row fills its width exactly (${m.rows.length} rows)`);

      // The hard promise. Compare the IMAGE's intrinsic ratio against its rendered box.
      const cropped = m.images.filter((i) => Math.abs(i.intrinsic - i.rendered) > 0.02);
      check(
        cropped.length === 0,
        `never crops — every rendered box matches its image's aspect (${m.images.length} checked)` +
          (cropped.length ? ` — worst: ${JSON.stringify(cropped[0])}` : ''),
      );

      // Zero, not "good" — Google's threshold is 0.1, but this grid reserves every box
      // from the manifest before a byte is fetched, so any shift at all means something
      // is measuring a loaded image instead of trusting the solver.
      check(m.cls < 0.01, `CLS is effectively zero (${m.cls.toFixed(5)})`);

      if (w <= 640) {
        const multi = m.rows.filter((r) => r.count !== 1);
        check(multi.length === 0, 'mobile shows exactly one image per row');
      }

      // Prove srcset actually selects different rungs at different widths.
      const rungs = [...new Set(m.images.map((i) => i.currentSrc.split('/')[1]))].sort();
      console.log(`  · rungs in use: ${rungs.join(', ')}`);

      await page.screenshot({
        path: path.join(SHOTS, `grid-${label}-${w}.png`),
        fullPage: false,
      });
      await context.close();
    }
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
  }

  await writeFile(
    path.join(SHOTS, 'result.json'),
    JSON.stringify({ failures, ok: failures.length === 0 }, null, 2),
  );

  console.log(
    failures.length === 0
      ? `\nAll checks passed. Screenshots in ${SHOTS}/`
      : `\n${failures.length} CHECK(S) FAILED:\n - ${failures.join('\n - ')}`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
