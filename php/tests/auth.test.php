<?php
/**
 * Tests for the PHP port's security layer, plus the cross-runtime compatibility claim.
 *
 * No PHPUnit: that needs Composer, and this distribution deliberately has no dependency
 * manager — a test framework the owner's host cannot install is a test framework that never
 * runs there. Plain asserts, one file, `php php/tests/auth.test.php`.
 *
 * Run with a fixture file produced by scripts/verify-php.mjs to additionally prove that a
 * hash and a token made by worker/auth.ts verify HERE. That is the claim that lets a gallery
 * move between Cloudflare and shared hosting without the owner choosing a new password, and
 * it is not something inspection can establish.
 *
 *   php php/tests/auth.test.php [worker-fixture.json] [php-output.json]
 */

declare(strict_types=1);

require_once __DIR__ . '/../lib/auth.php';
require_once __DIR__ . '/../lib/store.php';
require_once __DIR__ . '/../lib/http.php';

$failures = 0;
$checks = 0;

function check(string $name, bool $condition): void
{
    global $failures, $checks;
    $checks++;
    if (!$condition) {
        $failures++;
        fwrite(STDERR, "FAIL  {$name}\n");
    }
}

// ── Passwords ────────────────────────────────────────────────────────────────────────────

$hash = hash_password('correct horse battery staple');
check('hash uses the pbkdf2$iterations$salt$hash format', str_starts_with($hash, 'pbkdf2$100000$'));
check('hash has four $-separated parts', count(explode('$', $hash)) === 4);
check('correct password verifies', verify_password('correct horse battery staple', $hash));
check('wrong password does not', !verify_password('correct horse battery stapl', $hash));
check('empty password does not', !verify_password('', $hash));

// The salt is random, so the same password must not produce the same hash twice — otherwise
// one leaked hash would identify every site using that password.
check('salt is random', hash_password('same') !== hash_password('same'));

check('garbage is rejected, not fatal', !verify_password('x', 'not-a-hash'));
check('wrong scheme is rejected', !verify_password('x', 'bcrypt$10$aaaa$bbbb'));
check('zero iterations is rejected', !verify_password('x', 'pbkdf2$0$aaaa$bbbb'));

// Unicode passwords must survive byte-for-byte — hash_pbkdf2 works on bytes, and a mangled
// encoding would let a Cyrillic password verify here and fail on Cloudflare.
$cyrillic = hash_password('пароль-который-длинный');
check('cyrillic password verifies', verify_password('пароль-который-длинный', $cyrillic));

// ── Tokens ───────────────────────────────────────────────────────────────────────────────

$secret = 'a-test-secret-value';
$token = sign_token($secret);
check('token has two dot-separated parts', count(explode('.', $token)) === 2);
check('valid token verifies', verify_token($secret, $token) !== null);
check('token carries an expiry', is_int(verify_token($secret, $token)['exp'] ?? null));

check('wrong secret is rejected', verify_token('other-secret', $token) === null);
check('null token is rejected', verify_token($secret, null) === null);
check('empty token is rejected', verify_token($secret, '') === null);
check('malformed token is rejected', verify_token($secret, 'no-dot-here') === null);
check('garbage signature is rejected', verify_token($secret, explode('.', $token)[0] . '.abcd') === null);

// A tampered payload must fail even though it is still valid base64 and valid JSON — this is
// the attack the signature exists for: extend your own expiry and re-send.
$forged = base64url_encode((string) json_encode(['exp' => now_ms() + 999999999]));
check('re-signed payload with no signature fails', verify_token($secret, $forged . '.') === null);
check('payload swapped under a good signature fails', verify_token($secret, $forged . '.' . explode('.', $token)[1]) === null);

$expired = sign_token($secret, -1000);
check('expired token is rejected', verify_token($secret, $expired) === null);
check('token expiring in the future is accepted', verify_token($secret, sign_token($secret, 60000)) !== null);

// ── Object keys ──────────────────────────────────────────────────────────────────────────
//
// object_path is the only thing between a request path and the filesystem. Every one of
// these would be a file written or read outside uploads/ if the regex were loosened.

$id = str_repeat('a', 16);
check('valid rung key resolves', object_path("{$id}/400.webp") !== null);
check('valid full key resolves', object_path("{$id}/full.jpg") !== null);
check('traversal in the id is rejected', object_path('../../etc/400.webp') === null);
check('traversal in the file is rejected', object_path("{$id}/../../../etc/passwd") === null);
check('absolute path is rejected', object_path("/etc/passwd") === null);
check('uppercase id is rejected', object_path(str_repeat('A', 16) . '/400.webp') === null);
check('short id is rejected', object_path('abc/400.webp') === null);
check('null byte is rejected', object_path("{$id}/400.webp\x00.php") === null);

// The extension whitelist. `full.php` matched an earlier `[a-z0-9]{1,5}` pattern, which on
// shared hosting means an authenticated upload writes executable code into the web root.
// These four are the regression tests for that.
check('php extension is rejected', object_path("{$id}/full.php") === null);
check('phtml extension is rejected', object_path("{$id}/full.phtml") === null);
check('htaccess is rejected', object_path("{$id}/full.htaccess") === null);
check('an unserved image format is rejected', object_path("{$id}/full.tiff") === null);
check('every passthrough format we serve is accepted', array_reduce(
    array_keys(PASSTHROUGH_TYPES),
    fn(bool $carry, string $ext) => $carry && object_path("{$id}/full.{$ext}") !== null,
    true,
));

// Rungs are a fixed ladder, so a width we never encode names a file nothing can read.
check('a rung outside the ladder is rejected', object_path("{$id}/401.webp") === null);
check('every rung on the ladder is accepted', array_reduce(
    RUNGS,
    fn(bool $carry, int $rung) => $carry && object_path("{$id}/{$rung}.webp") !== null,
    true,
));

// ── Manifest escaping ────────────────────────────────────────────────────────────────────
//
// Alt text is user-controlled and goes inside a <script> block in the HTML shell. A caption
// containing </script> that is not escaped ends the tag and starts running.

ob_start();
serve_shell(
    ['images' => [['id' => $id, 'alt' => '</script><img src=x onerror=alert(1)>']], 'settings' => []],
    __DIR__ . '/fixtures/shell.html',
);
$html = (string) ob_get_clean();
check('closing script tag is escaped in the manifest', !str_contains($html, '</script><img'));
check('the escape is the JSON one', str_contains($html, '</script'));
check('the shell is still rendered', str_contains($html, 'id="manifest"'));

// ── Cross-runtime compatibility with worker/auth.ts ───────────────────────────────────────

$workerFixture = $argv[1] ?? null;
if ($workerFixture !== null && is_file($workerFixture)) {
    $fixture = json_decode((string) file_get_contents($workerFixture), true);

    check(
        'a password hash made by worker/auth.ts verifies in PHP',
        verify_password($fixture['password'], $fixture['passwordHash']),
    );
    check(
        'a wrong password against the Worker hash still fails',
        !verify_password($fixture['password'] . 'x', $fixture['passwordHash']),
    );
    check(
        'a token signed by worker/auth.ts verifies in PHP',
        verify_token($fixture['tokenSecret'], $fixture['token']) !== null,
    );
    check(
        'a Worker token under the wrong secret fails in PHP',
        verify_token($fixture['tokenSecret'] . 'x', $fixture['token']) === null,
    );
} else {
    fwrite(STDERR, "note: no worker fixture given, cross-runtime checks skipped\n");
}

// Emit PHP-made values so the Node side can verify them in the other direction.
$phpOutput = $argv[2] ?? null;
if ($phpOutput !== null) {
    file_put_contents($phpOutput, (string) json_encode([
        'password' => 'php-made-password-1234',
        'passwordHash' => hash_password('php-made-password-1234'),
        'tokenSecret' => $secret,
        'token' => sign_token($secret),
    ]));
}

echo $failures === 0
    ? "ok — {$checks} checks passed\n"
    : "FAILED — {$failures} of {$checks} checks failed\n";

exit($failures === 0 ? 0 : 1);
