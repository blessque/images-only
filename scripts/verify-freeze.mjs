/**
 * Proves a frozen copy is a real, working site — served by a dumb static file server with
 * no Worker, no database and no API anywhere.
 *
 * This is the pathway with no operator: if Cloudflare becomes unreachable or unwanted, this
 * folder is what survives. An untested escape route is a claim, not an exit, and this
 * project has already learned twice that a suite one level down proves nothing about the
 * level above.
 *
 * Asserts the two properties the whole product rests on — never crops, and CLS is 0 by
 * construction — hold without the server that normally inlines the manifest.
 *
 * Prerequisites: `npm run build && npm run freeze`.
 *
 *   node scripts/verify-freeze.mjs
 */

import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 8797;
const ROOT = path.resolve('freeze');

const failures = [];
function check(condition, message, detail = '') {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    console.log(`  ✗ ${message}${detail ? ` — ${detail}` : ''}`);
    failures.push(message);
  }
}

async function main() {
  // python3 -m http.server: deliberately the dumbest thing that serves files. If it works
  // here it works on Yandex Object Storage, S3, a VPS, or a USB stick.
  const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], {
    cwd: ROOT,
    stdio: 'ignore',
  });

  let browser;
  try {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    browser = await chromium.launch({ executablePath: CHROME });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    const broken = [];
    page.on('requestfailed', (request) => broken.push(request.url()));
    page.on('response', (response) => {
      if (response.status() >= 400) broken.push(`${response.status()} ${response.url()}`);
    });
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));

    await page.addInitScript(() => {
      window.__cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) window.__cls += entry.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });

    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);

    // Scroll the whole page before counting. Images are lazy — a first-paint count is 13 of
    // 18 and that is the feature working, not a missing file. Scrolling also means the CLS
    // number covers the images that arrive late, which is where shift would actually show.
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight / 2) {
        window.scrollTo(0, y);
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      window.scrollTo(0, 0);
    });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(600);

    const stats = await page.evaluate(() => {
      const images = [...document.querySelectorAll('img')];
      const loaded = images.filter((image) => image.complete && image.naturalWidth > 0);
      const cropped = loaded.filter((image) => {
        const box = image.getBoundingClientRect();
        if (box.height === 0) return false;
        return Math.abs(box.width / box.height - image.naturalWidth / image.naturalHeight) > 0.02;
      });
      return {
        total: images.length,
        loaded: loaded.length,
        cropped: cropped.length,
        cls: window.__cls,
        scrollWidth: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
      };
    });

    console.log('\nFrozen copy, served as plain files');
    check(stats.total > 0, `the grid rendered (${stats.total} images)`);
    check(stats.loaded === stats.total, `every image loaded (${stats.loaded}/${stats.total})`);
    check(stats.cropped === 0, `nothing is cropped (${stats.cropped} off-aspect)`);
    check(stats.cls === 0, `CLS is 0.00000 without a server (${stats.cls.toFixed(5)})`);
    check(
      stats.scrollWidth <= stats.viewport,
      `no horizontal overflow (${stats.scrollWidth} ≤ ${stats.viewport})`,
    );
    check(broken.length === 0, 'no failed requests', broken.slice(0, 4).join(', '));
    check(errors.length === 0, 'no page errors', errors.slice(0, 2).join(' | '));
  } finally {
    await browser?.close();
    server.kill();
  }

  console.log(
    failures.length === 0
      ? '\nThe parachute opens.'
      : `\n${failures.length} freeze check(s) FAILED.`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
