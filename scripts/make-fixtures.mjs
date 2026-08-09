/**
 * Generates local fixture photographs for grid work (Phase 2). Gitignored output.
 *
 * Each fixture carries a 3px inset border and a centred label. That is deliberate test
 * design: if the grid ever crops, the border is clipped on one side and the label goes
 * off-centre — the failure becomes VISIBLE rather than merely measurable. The unit tests
 * prove "never crops" numerically; these prove it to the eye.
 *
 * Real photographs can be dropped into fixtures/ later; this exists so Phase 2 needs
 * neither a backend nor the designer's files.
 *
 *   node scripts/make-fixtures.mjs
 */

import { execFile } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';

const run = promisify(execFile);

const OUT = path.resolve('fixtures');
const RUNGS = [400, 800, 1600, 2400];
const FONT = '/System/Library/Fonts/Helvetica.ttc';

/** Aspect ratios that actually occur in photography, not tidy test rectangles. */
const ASPECTS = [
  { label: '3:1 panorama', aspect: 3 },
  { label: '16:9', aspect: 16 / 9 },
  { label: '3:2', aspect: 3 / 2 },
  { label: '4:3', aspect: 4 / 3 },
  { label: '5:4', aspect: 5 / 4 },
  { label: '1:1', aspect: 1 },
  { label: '4:5', aspect: 4 / 5 },
  { label: '3:4', aspect: 3 / 4 },
  { label: '2:3', aspect: 2 / 3 },
  { label: '9:16', aspect: 9 / 16 },
];

const CLASSES = ['solo', 'wide', 'medium', 'wide', 'medium', 'medium'];

// Muted, desaturated pairs — an are.na-ish register rather than a colour-test chart, so
// tuning row heights by eye is not fought by garish fixtures.
const PALETTE = [
  ['0x1c2733', '0x3d5a6c'], ['0x2b2320', '0x6b4f3a'], ['0x1f2b22', '0x4a6b52'],
  ['0x2a2030', '0x5c4a72'], ['0x30261c', '0x7a5c3a'], ['0x1a2430', '0x4a6a8a'],
  ['0x2d1f26', '0x6e4356'], ['0x232a1e', '0x5a6b42'],
];

const COUNT = 42;

function sizeFor(aspect, longEdge) {
  return aspect >= 1
    ? { w: longEdge, h: Math.max(1, Math.round(longEdge / aspect)) }
    : { w: Math.max(1, Math.round(longEdge * aspect)), h: longEdge };
}

async function renderRung(spec, longEdge, file) {
  const { w, h } = sizeFor(spec.aspect, longEdge);
  const [c0, c1] = spec.colors;
  const fontSize = Math.max(11, Math.round(Math.min(w, h) * 0.08));
  const inset = Math.max(2, Math.round(Math.min(w, h) * 0.012));
  const thickness = Math.max(1, Math.round(Math.min(w, h) * 0.006));

  const text = `${spec.index} ${spec.label}`.replace(/:/g, '\\:');
  const filters = [
    `drawbox=x=${inset}:y=${inset}:w=iw-${inset * 2}:h=ih-${inset * 2}` +
      `:color=white@0.55:t=${thickness}`,
    `drawtext=fontfile=${FONT}:text='${text}':fontcolor=white@0.92:fontsize=${fontSize}` +
      `:x=(w-text_w)/2:y=(h-text_h)/2`,
  ].join(',');

  await run('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi',
    '-i', `gradients=s=${w}x${h}:c0=${c0}:c1=${c1}:x0=0:y0=0:x1=${w}:y1=${h}:nb_colors=2`,
    '-vf', filters,
    '-frames:v', '1',
    '-c:v', 'libwebp', '-quality', '82',
    file,
  ]);
}

async function pool(tasks, limit) {
  let cursor = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (cursor < tasks.length) {
      const task = tasks[cursor++];
      if (task) await task();
    }
  });
  await Promise.all(workers);
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const specs = Array.from({ length: COUNT }, (_, n) => {
    const base = ASPECTS[n % ASPECTS.length];
    const colors = PALETTE[n % PALETTE.length];
    return {
      id: `fx${String(n + 1).padStart(2, '0')}`,
      index: n + 1,
      label: base.label,
      aspect: base.aspect,
      sizeClass: CLASSES[n % CLASSES.length],
      colors,
    };
  });

  const tasks = [];
  for (const spec of specs) {
    tasks.push(async () => {
      await mkdir(path.join(OUT, spec.id), { recursive: true });
      for (const rung of RUNGS) {
        await renderRung(spec, rung, path.join(OUT, spec.id, `${rung}.webp`));
      }
      process.stdout.write('.');
    });
  }

  const started = Date.now();
  await pool(tasks, 8);

  const manifest = {
    images: specs.map((s) => ({
      id: s.id,
      aspect: s.aspect,
      sizeClass: s.sizeClass,
      alt: `Fixture ${s.index}, ${s.label}`,
      // Fixtures are rendered at every rung, so the whole ladder exists.
      maxRung: RUNGS[RUNGS.length - 1],
      passthrough: false,
      format: 'webp',
    })),
    settings: { name: 'Fixture Gallery', contact: 'hello@example.com' },
  };
  await writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n${specs.length} fixtures x ${RUNGS.length} rungs in ${seconds}s -> fixtures/`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
