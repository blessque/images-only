/**
 * Seeds a 200-image gallery into local D1/R2 and measures what a visitor actually pays.
 *
 * The numbers this prints go into docs/CHANGELOG.md per iteration, so a regression is
 * VISIBLE rather than argued about. 200 is the top of the brief's stated range.
 *
 *   node scripts/perf.mjs
 */

import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const PORT = 8790;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PASSWORD = 'test-password-1234';
const RUNGS = [400, 800, 1600, 2400];
const TARGET = 200;
const CLASSES = ['solo', 'wide', 'tight', 'wide', 'tight', 'tight'];

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

async function seed(token) {
  const fixtureManifest = JSON.parse(await readFile('fixtures/manifest.json', 'utf8'));
  const dirs = (await readdir('fixtures', { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  const blobs = new Map();
  for (const dir of dirs) {
    blobs.set(
      dir,
      Object.fromEntries(
        await Promise.all(
          RUNGS.map(async (rung) => [rung, await readFile(path.join('fixtures', dir, `${rung}.webp`))]),
        ),
      ),
    );
  }

  const existing = (await (await fetch(`${BASE}/api/images`)).json()).images.length;
  const needed = Math.max(0, TARGET - existing);
  const auth = { authorization: `Bearer ${token}` };
  process.stdout.write(`  seeding ${needed} images `);

  for (let index = 0; index < needed; index++) {
    const source = fixtureManifest.images[index % fixtureManifest.images.length];
    const id = [...crypto.getRandomValues(new Uint8Array(8))]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');

    await Promise.all(
      RUNGS.map((rung) =>
        fetch(`${BASE}/api/upload/${id}/${rung}.webp`, {
          method: 'PUT',
          headers: auth,
          body: blobs.get(source.id)[rung],
        }),
      ),
    );
    await fetch(`${BASE}/api/images`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        id,
        aspect: source.aspect,
        sizeClass: CLASSES[index % CLASSES.length],
        alt: source.alt,
        maxRung: RUNGS[RUNGS.length - 1],
        passthrough: false,
        format: 'webp',
      }),
    });
    if (index % 25 === 0) process.stdout.write('.');
  }
  console.log(' done');
}

async function main() {
  const server = spawn(
    'npx',
    ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--local'],
    { stdio: 'ignore' },
  );

  let browser;
  try {
    await waitForServer();
    const { token } = await (
      await fetch(`${BASE}/api/login`, {
        method: 'POST',
        body: JSON.stringify({ password: PASSWORD }),
      })
    ).json();
    if (!token) throw new Error('could not log in — is .dev.vars set to the test password?');

    await seed(token);
    const manifest = await (await fetch(`${BASE}/api/images`)).json();

    browser = await chromium.launch({ executablePath: CHROME });

    for (const [label, width, height] of [
      ['laptop', 1440, 900],
      ['mobile', 390, 844],
    ]) {
      const context = await browser.newContext({
        viewport: { width, height },
        deviceScaleFactor: 2,
      });
      await context.addInitScript(() => {
        window.__cls = 0;
        window.__lcp = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput) window.__cls += entry.value;
          }
        }).observe({ type: 'layout-shift', buffered: true });
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) window.__lcp = entry.startTime;
        }).observe({ type: 'largest-contentful-paint', buffered: true });
      });

      const page = await context.newPage();
      await page.goto(BASE, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1200);

      // The Resource Timing API, not content-length headers: wrangler dev serves the JS
      // and CSS chunked, so those responses carry no content-length at all and summing
      // the header silently reports images as 100% of the payload.
      const stats = await page.evaluate(() => {
        const resources = performance.getEntriesByType('resource');
        const sum = (predicate) =>
          resources
            .filter(predicate)
            .reduce((total, entry) => total + (entry.encodedBodySize || 0), 0);
        const navigation = performance.getEntriesByType('navigation')[0];

        return {
          cls: window.__cls,
          lcp: window.__lcp,
          rows: document.querySelectorAll('.grid-row').length,
          tiles: document.querySelectorAll('.tile').length,
          loaded: [...document.querySelectorAll('.tile-img')].filter(
            (img) => img.complete && img.naturalWidth,
          ).length,
          nodes: document.getElementsByTagName('*').length,
          documentBytes: navigation?.encodedBodySize ?? 0,
          imageBytes: sum((entry) => entry.name.includes('/img/')),
          codeBytes: sum((entry) => /\.(js|css)(\?|$)/.test(entry.name)),
          totalBytes: sum(() => true) + (navigation?.encodedBodySize ?? 0),
          requests: resources.length + 1,
        };
      });

      const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;
      console.log(`\n${label} — ${width}x${height}, ${manifest.images.length} images in the manifest`);
      console.log(`  rows                 ${stats.rows}`);
      console.log(`  tiles rendered       ${stats.tiles}   (DOM nodes ${stats.nodes})`);
      console.log(`  images fetched       ${stats.loaded} of ${stats.tiles}  ← lazy loading`);
      console.log(`  transferred          ${kb(stats.totalBytes)} over ${stats.requests} requests`);
      console.log(`    HTML + manifest    ${kb(stats.documentBytes)}  ← inlined, so no second round trip`);
      console.log(`    JS + CSS           ${kb(stats.codeBytes)}`);
      console.log(`    images             ${kb(stats.imageBytes)}`);
      console.log(`  LCP                  ${stats.lcp.toFixed(0)} ms`);
      console.log(`  CLS                  ${stats.cls.toFixed(5)}`);

      await context.close();
    }
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
