<?php
/**
 * The one-time setup page.
 *
 * Its whole reason to exist is that the alternative — "open config.php in a text editor and
 * type your database password between the quotes" — is the step where a non-technical owner
 * stops. This is the same move WordPress and Aegea make, and it is why they get installed by
 * people who do not write code. CLAUDE.md's rule is that the moment the workflow needs a
 * terminal the site stops being updated; a config file edited over FTP is the same failure
 * wearing different clothes.
 *
 * It collects the four values the hosting panel shows, tests them, writes config.php, creates
 * the tables and sets the admin password — in one form, in one pass.
 *
 * SECURITY: once the site is claimed this page refuses to do anything at all. An installer
 * that still works after installation is a way to repoint a live site at someone else's
 * database, and it is reachable by anyone who guesses the filename.
 */

declare(strict_types=1);

require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/auth.php';
require_once __DIR__ . '/lib/store.php';
require_once __DIR__ . '/lib/credentials.php';

$alreadyClaimed = is_configured() && read_credentials() !== null;
$errors = [];
$done = false;

/** @return list<array{label:string,ok:bool,detail:string}> */
function requirements(): array
{
    $bytes = static fn(string $value): int => (int) $value * match (strtoupper(substr(trim($value), -1))) {
        'G' => 1073741824, 'M' => 1048576, 'K' => 1024, default => 1,
    };
    $upload = (string) ini_get('upload_max_filesize');
    $post = (string) ini_get('post_max_size');
    $needed = 24 * 1048576;

    return [
        [
            'label' => 'PHP 8.0 or newer',
            'ok' => PHP_VERSION_ID >= 80000,
            'detail' => PHP_VERSION,
        ],
        [
            'label' => 'MySQL support (pdo_mysql)',
            'ok' => extension_loaded('pdo_mysql'),
            'detail' => extension_loaded('pdo_mysql') ? 'available' : 'missing — ask your host to enable it',
        ],
        [
            'label' => 'uploads/ folder writable',
            'ok' => uploads_writable(),
            'detail' => uploads_writable() ? 'writable' : 'set permissions to 755 on uploads/',
        ],
        [
            'label' => 'Upload size at least 24MB',
            'ok' => $bytes($upload) >= $needed && $bytes($post) >= $needed,
            'detail' => "upload_max_filesize {$upload}, post_max_size {$post}",
        ],
    ];
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && !$alreadyClaimed) {
    $config = [
        'host' => trim((string) ($_POST['host'] ?? '')),
        'port' => (int) ($_POST['port'] ?? 3306) ?: 3306,
        'name' => trim((string) ($_POST['name'] ?? '')),
        'user' => trim((string) ($_POST['user'] ?? '')),
        'pass' => (string) ($_POST['pass'] ?? ''),
    ];
    $password = (string) ($_POST['admin_password'] ?? '');
    $confirm = (string) ($_POST['admin_password_confirm'] ?? '');

    if ($config['host'] === '' || $config['name'] === '' || $config['user'] === '') {
        $errors[] = 'Fill in the database host, name and user — your hosting panel shows all three.';
    }
    if (strlen($password) < MIN_PASSWORD_LENGTH) {
        $errors[] = 'The site password needs at least ' . MIN_PASSWORD_LENGTH . ' characters.';
    }
    if ($password !== $confirm) {
        $errors[] = 'The two passwords do not match.';
    }

    if ($errors === []) {
        // Connect BEFORE writing config.php. Writing first and failing afterwards leaves the
        // site in managed mode pointing at a database that does not answer, which shows the
        // owner a blank page and no way back — folder mode at least still renders.
        try {
            $dsn = sprintf(
                'mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
                $config['host'],
                $config['port'],
                $config['name'],
            );
            $pdo = new PDO($dsn, $config['user'], $config['pass'], [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ]);
            install_schema($pdo);

            if (!write_config($config)) {
                $errors[] = 'Could not write config.php — set permissions to 755 on the site folder.';
            }
        } catch (PDOException $error) {
            $errors[] = 'The database refused the connection: ' . $error->getMessage();
        }
    }

    if ($errors === []) {
        $claimed = claim_site($password);
        if ($claimed === null) {
            $errors[] = 'This database already has a password set. Use it, or empty the auth table.';
        } else {
            $done = true;
        }
    }
}

$field = static fn(string $key): string => htmlspecialchars((string) ($_POST[$key] ?? ''), ENT_QUOTES);
?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Set up your site</title>
<style>
  :root { color-scheme: dark; }
  body { background: #000; color: #e8e8e8; font: 15px/1.55 ui-sans-serif, system-ui, sans-serif;
         margin: 0; padding: 48px 24px; }
  main { max-width: 460px; margin: 0 auto; }
  h1 { font-size: 20px; font-weight: 600; margin: 0 0 8px; }
  p { color: #9a9a9a; margin: 0 0 24px; }
  label { display: block; margin: 0 0 14px; }
  span { display: block; font-size: 13px; color: #9a9a9a; margin: 0 0 5px; }
  input { width: 100%; box-sizing: border-box; background: #141414; color: #e8e8e8;
          border: 1px solid #2c2c2c; border-radius: 3px; padding: 9px 11px; font: inherit; }
  input:focus { outline: none; border-color: #565656; }
  button { width: 100%; margin-top: 10px; background: #e8e8e8; color: #000; border: 0;
           border-radius: 3px; padding: 11px; font: inherit; font-weight: 600; cursor: pointer; }
  ul { list-style: none; padding: 0; margin: 0 0 28px; font-size: 13px; }
  li { display: flex; justify-content: space-between; gap: 12px; padding: 6px 0;
       border-bottom: 1px solid #1c1c1c; color: #9a9a9a; }
  .ok { color: #6a9a6a; } .bad { color: #b46a6a; }
  .err { background: #1e1212; border: 1px solid #4a2020; border-radius: 3px;
         padding: 12px 14px; margin: 0 0 20px; font-size: 14px; color: #e0b4b4; }
  .err p { color: inherit; margin: 0 0 6px; } .err p:last-child { margin: 0; }
  code { background: #1a1a1a; padding: 1px 5px; border-radius: 2px; font-size: 13px; }
</style>
</head>
<body>
<main>

<?php if ($alreadyClaimed): ?>
  <h1>Already set up</h1>
  <p>
    This site has a password and is running. For safety this page does nothing now —
    delete <code>install.php</code> from your hosting and open the site itself.
  </p>
  <p>
    Forgotten the password? In your hosting panel open phpMyAdmin, find the
    <code>auth</code> table and empty it. Then reload the site and choose a new one.
  </p>

<?php elseif ($done): ?>
  <h1>Done</h1>
  <p>
    Your site is ready. <strong>Delete <code>install.php</code> now</strong> — it is the one
    file that could be used to point your site somewhere else.
  </p>
  <p>
    Then open your site, press <code>Option</code>+<code>\</code> or click the small lock in
    the footer, and drag photographs onto the page.
  </p>

<?php else: ?>
  <h1>Set up your site</h1>
  <p>Your hosting panel shows the database details. Create a database there first, then copy them here.</p>

  <ul>
    <?php foreach (requirements() as $requirement): ?>
      <li>
        <span style="margin:0;color:inherit"><?= htmlspecialchars($requirement['label']) ?></span>
        <span class="<?= $requirement['ok'] ? 'ok' : 'bad' ?>" style="margin:0;text-align:right">
          <?= htmlspecialchars($requirement['detail']) ?>
        </span>
      </li>
    <?php endforeach; ?>
  </ul>

  <?php if ($errors !== []): ?>
    <div class="err">
      <?php foreach ($errors as $error): ?><p><?= htmlspecialchars($error) ?></p><?php endforeach; ?>
    </div>
  <?php endif; ?>

  <form method="post">
    <label><span>Database host</span><input name="host" value="<?= $field('host') ?: 'localhost' ?>" required></label>
    <label><span>Database name</span><input name="name" value="<?= $field('name') ?>" required></label>
    <label><span>Database user</span><input name="user" value="<?= $field('user') ?>" required></label>
    <label><span>Database password</span><input name="pass" type="password" value="<?= $field('pass') ?>"></label>
    <label><span>Port (leave 3306 unless your host says otherwise)</span><input name="port" value="<?= $field('port') ?: '3306' ?>"></label>
    <label><span>Choose a password for your site — at least <?= MIN_PASSWORD_LENGTH ?> characters</span>
      <input name="admin_password" type="password" required></label>
    <label><span>Type it again</span><input name="admin_password_confirm" type="password" required></label>
    <button type="submit">Set up the site</button>
  </form>
<?php endif; ?>

</main>
</body>
</html>
