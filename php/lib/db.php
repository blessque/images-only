<?php
/**
 * The MySQL connection, and the config file that describes it.
 *
 * `config.php` is written by install.php and holds the four values the hosting panel gives
 * you. It is a .php file rather than .ini or .json so that a webserver misconfiguration
 * serves an empty page instead of your database password — a file called config.json under
 * the web root is readable by anyone who guesses the name, and people guess that name.
 *
 * Its ABSENCE is the mode switch: no config.php means no database, which means the site
 * runs in folder mode (photographs read from photos/ over FTP). See php/index.php.
 */

declare(strict_types=1);

function config_path(): string
{
    return dirname(__DIR__) . '/config.php';
}

function is_configured(): bool
{
    return is_file(config_path());
}

/** @return array{host:string,name:string,user:string,pass:string,port:int}|null */
function load_config(): ?array
{
    if (!is_configured()) {
        return null;
    }
    $config = require config_path();
    return is_array($config) ? $config : null;
}

/**
 * Writes config.php with the credentials the installer collected.
 *
 * var_export rather than string concatenation: a MySQL password containing a quote or a
 * backslash is ordinary, and hand-rolled escaping is how an install fails with a PHP parse
 * error that the owner has no way to read.
 */
function write_config(array $config): bool
{
    $body = "<?php\n// Written by install.php. Delete this file to return to folder mode.\n"
        . 'return ' . var_export($config, true) . ";\n";
    return file_put_contents(config_path(), $body) !== false;
}

/**
 * One connection per request, opened lazily.
 *
 * ERRMODE_EXCEPTION so a failed statement is loud rather than a silent false that the next
 * line treats as data. Emulated prepares OFF so bound integers arrive as integers — with
 * emulation on, `sort_order = '3'` works by coercion right up until a comparison does not.
 */
function db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $config = load_config();
    if ($config === null) {
        throw new RuntimeException('Not configured');
    }

    $dsn = sprintf(
        'mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
        $config['host'],
        $config['port'] ?? 3306,
        $config['name'],
    );

    $pdo = new PDO($dsn, $config['user'], $config['pass'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);

    return $pdo;
}

/**
 * Applies schema.sql. Every statement is CREATE TABLE IF NOT EXISTS or INSERT IGNORE, so
 * running it twice is a no-op — which matters because the installer may be re-run after a
 * failed attempt, and a half-created database must not need hand-repair by the owner.
 *
 * Split on `;` at end of line: the schema is ours, contains no stored routines and no
 * semicolons inside string literals, so a full SQL parser would be weight for nothing.
 *
 * Comment LINES are stripped from each statement rather than statements that begin with a
 * comment being skipped. The difference is not cosmetic: every table here is preceded by an
 * explanatory block, so skipping meant `images` and `auth` were silently never created and
 * the site installed itself into a database missing half its tables.
 */
function install_schema(PDO $pdo): void
{
    $sql = (string) file_get_contents(dirname(__DIR__) . '/schema.sql');

    foreach (preg_split('/;\s*$/m', $sql) ?: [] as $chunk) {
        $lines = array_filter(
            explode("\n", $chunk),
            fn(string $line) => !str_starts_with(ltrim($line), '--'),
        );
        $statement = trim(implode("\n", $lines));
        if ($statement !== '') {
            $pdo->exec($statement);
        }
    }
}

/** True when the schema is present — used by the installer to report what it found. */
function schema_exists(PDO $pdo): bool
{
    try {
        $pdo->query('SELECT 1 FROM images LIMIT 1');
        return true;
    } catch (PDOException) {
        return false;
    }
}
