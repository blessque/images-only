/**
 * Assembles the folder you upload to shared hosting.
 *
 * Produces `php-site/` — drag its CONTENTS into your web root with any FTP client or your
 * host's file manager, and the site is live. Then drop photographs into `photos/` the same
 * way, forever. No terminal on the owner's side, ever.
 *
 *   npm run build && npm run build:php
 */

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUT = path.resolve('php-site');
const DIST = path.resolve('dist');

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  // The shell keeps its EMPTY manifest placeholder — index.php fills it per request, the
  // same way the Worker does. Copied as index.html and never served directly: the .htaccess
  // sets DirectoryIndex to index.php so PHP always gets first refusal.
  const shell = await readFile(path.join(DIST, 'index.html'), 'utf8');
  if (!shell.includes('<script type="application/json" id="manifest"></script>')) {
    throw new Error('dist/index.html has no manifest placeholder — run `npm run build` first');
  }
  await writeFile(path.join(OUT, 'index.html'), shell);

  await cp(path.join(DIST, 'assets'), path.join(OUT, 'assets'), { recursive: true });
  await cp(path.join(DIST, 'help.html'), path.join(OUT, 'help.html'));
  await cp(path.resolve('php/index.php'), path.join(OUT, 'index.php'));
  await cp(path.resolve('php/.htaccess'), path.join(OUT, '.htaccess'));

  // Empty, but present: a host's file manager makes creating a folder fiddlier than filling
  // one, and `cache/` must exist and be writable before the first photograph is requested.
  await mkdir(path.join(OUT, 'photos'), { recursive: true });
  await mkdir(path.join(OUT, 'cache'), { recursive: true });
  await writeFile(path.join(OUT, 'photos/.gitkeep'), '');
  await writeFile(path.join(OUT, 'cache/.gitkeep'), '');

  await writeFile(path.join(OUT, 'site.txt'), 'Your Name\nhello@example.com\n');

  await writeFile(
    path.join(OUT, 'READ-ME-FIRST.txt'),
    [
      'justimages — shared hosting',
      '',
      '1. Upload EVERYTHING in this folder to your web root (public_html, htdocs or www).',
      '2. Make the folders `photos` and `cache` writable (permissions 755, or 775).',
      '3. Open your site. It will be empty — that is correct.',
      '4. Put photographs into `photos/`. Reload. They are on your site.',
      '',
      'Ordering:   name files 01-..., 02-..., 03-... They appear in that order.',
      'Big photo:  end the filename with -solo, e.g. 04-sunset-solo.jpg (takes a whole row)',
      'Packed row: end it with -tight',
      'Otherwise:  it shares a row normally.',
      '',
      'Your name and contact line: edit site.txt (first line name, second line contact).',
      '',
      'The first time a photograph is viewed the site makes smaller copies of it, so that',
      'first load can be slow. After that it is fast forever.',
      '',
      'To remove a photograph, delete it from `photos/`.',
      '',
      'More help: open /help on your own site.',
    ].join('\n'),
  );

  console.log(`php-site/ is ready — upload its contents to your web root.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
