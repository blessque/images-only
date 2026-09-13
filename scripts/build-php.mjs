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
  await cp(path.resolve('php/install.php'), path.join(OUT, 'install.php'));
  await cp(path.resolve('php/schema.sql'), path.join(OUT, 'schema.sql'));
  await cp(path.resolve('php/.htaccess'), path.join(OUT, '.htaccess'));
  await cp(path.resolve('php/lib'), path.join(OUT, 'lib'), { recursive: true });

  // Empty, but present: a host's file manager makes creating a folder fiddlier than filling
  // one, and each must exist and be writable before the first photograph arrives.
  //
  // `photos/` and `cache/` serve folder mode; `uploads/` serves the database-backed one. All
  // three ship because which mode a site ends up in is the owner's choice at install time,
  // and a missing folder discovered later is a permissions errand over FTP.
  await mkdir(path.join(OUT, 'photos'), { recursive: true });
  await mkdir(path.join(OUT, 'cache'), { recursive: true });
  await mkdir(path.join(OUT, 'uploads'), { recursive: true });
  await writeFile(path.join(OUT, 'photos/.gitkeep'), '');
  await writeFile(path.join(OUT, 'cache/.gitkeep'), '');
  await writeFile(path.join(OUT, 'uploads/.gitkeep'), '');

  await writeFile(path.join(OUT, 'site.txt'), 'Your Name\nhello@example.com\n');

  await writeFile(
    path.join(OUT, 'READ-ME-FIRST.txt'),
    [
      'justimages — shared hosting',
      '',
      'Upload EVERYTHING in this folder to your web root (public_html, htdocs or www).',
      'Then make the folders `photos`, `cache` and `uploads` writable — permissions 755.',
      '',
      'Now pick ONE of these two. You can start with A and move to B later.',
      '',
      '',
      'A. THE SIMPLE ONE — no database, no password',
      '',
      '   1. Open your site. It will be empty. That is correct.',
      '   2. Put photographs into `photos/` with your FTP program. Reload. Done.',
      '',
      '   Ordering:   name files 01-..., 02-..., 03-... They appear in that order.',
      '   Big photo:  end the filename with -solo (it takes a whole row)',
      '   Packed row: end it with -tight',
      '   Otherwise:  it shares a row normally.',
      '',
      '   Your name and contact line: edit site.txt (line 1 name, line 2 contact).',
      '   To remove a photograph, delete it from `photos/`.',
      '',
      '',
      'B. THE FULL ONE — drag photographs onto the site itself',
      '',
      '   Everything in A, plus: uploading from the page, reordering by hand, editing',
      '   captions, undo, and photographs shrunk automatically before they are sent.',
      '',
      '   1. In your hosting panel, create a MySQL database. Note the four details it',
      '      shows you: host, database name, user, password.',
      '   2. Open  yoursite.com/install.php  and type them in. Choose a site password.',
      '   3. DELETE install.php afterwards. The page tells you again when it is done.',
      '   4. Open your site, press Option and \\ together (or click the small lock in',
      '      the footer), and drag photographs onto the page.',
      '',
      '   Forgotten the password later? In your hosting panel open phpMyAdmin, empty the',
      '   `auth` table, then reload your site and choose a new one.',
      '',
      '',
      'If your host needs to help with any of this, give them INSTALL-FOR-SUPPORT.txt —',
      'it is the same steps written for a hosting engineer.',
      '',
      'More help: open /help on your own site.',
    ].join('\n'),
  );

  // Addressed to a hosting support engineer, not to the owner.
  //
  // This is the actual delivery mechanism for a non-technical owner: he forwards one page to
  // the support desk he already pays for, and a person who does this every day does it in ten
  // minutes. Writing the install guide FOR him and hoping he manages is the failure mode —
  // the Aegea install that prompted this port took a support engineer, and worked for years
  // afterwards. Russian first: the hosts these owners use answer in Russian.
  await writeFile(
    path.join(OUT, 'INSTALL-FOR-SUPPORT.txt'),
    [
      'justimages — установка на виртуальный хостинг (для инженера поддержки)',
      '',
      'Обычный PHP-сайт. Без Composer, без фреймворков, без сборки на сервере.',
      '',
      'Требования:',
      '  PHP 8.0+ (проверено на 8.3), расширения pdo_mysql и gd',
      '  MySQL 5.7+ или MariaDB 10.3+',
      '  mod_rewrite и .htaccess',
      '  upload_max_filesize и post_max_size — не меньше 24M',
      '',
      'Установка:',
      '  1. Скопировать содержимое папки в корень сайта (public_html / htdocs / www).',
      '  2. chmod 755 на папки photos, cache, uploads (нужна запись из PHP).',
      '  3. Создать базу MySQL и пользователя с полными правами на неё.',
      '  4. Открыть https://<домен>/install.php — форма проверит окружение,',
      '     создаст таблицы и запросит пароль администратора сайта.',
      '  5. После установки УДАЛИТЬ install.php.',
      '',
      'Что делает .htaccess: передаёт заголовок Authorization в PHP (без этого не',
      'работает авторизация), направляет несуществующие пути на index.php, закрывает',
      'доступ к config.php, schema.sql, папкам lib/ и uploads/.',
      '',
      'Без config.php сайт работает в простом режиме: читает картинки из папки photos/.',
      'База в этом режиме не нужна.',
      '',
      'Сброс пароля: очистить таблицу auth через phpMyAdmin, затем открыть сайт заново.',
      '',
      '',
      '─────────────────────────────────────────────────────────────────────────────',
      '',
      'justimages — shared hosting install (for a support engineer)',
      '',
      'A plain PHP site. No Composer, no framework, no server-side build step.',
      '',
      'Requirements:',
      '  PHP 8.0+ (tested on 8.3) with pdo_mysql and gd',
      '  MySQL 5.7+ or MariaDB 10.3+',
      '  mod_rewrite and .htaccess enabled',
      '  upload_max_filesize and post_max_size at 24M or more',
      '',
      'Install:',
      '  1. Copy the contents of this folder into the web root.',
      '  2. chmod 755 on photos, cache and uploads (PHP must be able to write).',
      '  3. Create a MySQL database and a user with full rights on it.',
      '  4. Open https://<domain>/install.php — the form checks the environment,',
      '     creates the tables and asks for the site admin password.',
      '  5. DELETE install.php afterwards.',
      '',
      'What .htaccess does: passes the Authorization header through to PHP (without this',
      'login does not work), routes non-file paths to index.php, and denies config.php,',
      'schema.sql, lib/ and uploads/.',
      '',
      'With no config.php the site runs in folder mode, reading images from photos/.',
      'No database is needed in that mode.',
      '',
      'Password reset: empty the `auth` table in phpMyAdmin, then reload the site.',
    ].join('\n'),
  );

  console.log(`php-site/ is ready — upload its contents to your web root.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
