# justimages on ordinary shared hosting

The same site, on the sort of hosting that costs 200–300₽ a month and comes with a support
desk that answers the phone. PHP 8 and MySQL, which every such host has had for a decade.

**`src/` is not modified to make this work.** The client — the grid, the solver, the WebP
pipeline, the admin panel — talks to eleven HTTP routes and does not know or care what
answers them. This directory is one implementation of those routes; `worker/` is another.

---

## Two modes

A site runs in one or the other depending on whether `config.php` exists. Nothing else
differs: the same client, the same URLs, the same layout.

| | **Folder mode** | **Managed mode** |
|---|---|---|
| Database | none | MySQL |
| Adding photographs | FTP into `photos/` | drag onto the page |
| Reordering | rename files `01-`, `02-` | drag, or arrow keys |
| Captions | from the filename | edited in place |
| Undo | no | yes, with soft delete |
| Compression | on the server, first view | in the browser, before upload |
| Install | upload and go | one form, once |

Folder mode is not a lesser version kept for nostalgia — it is genuinely simpler, and for
someone who posts twice a year it is the better answer. Managed mode exists because the
brief's hard requirement is that the designer manages the site *from the page*.

**Moving between them is not automatic.** Installing over an existing folder-mode site leaves
`photos/` untouched but the gallery starts empty; re-upload through the admin panel.

---

## Installing

Give `INSTALL-FOR-SUPPORT.txt` to your host's support desk. It is one page, written for
someone who does this daily, in Russian and English. This is the intended path, not a
fallback — it is how the Aegea install that inspired this port actually happened.

To do it yourself:

1. Upload everything to the web root.
2. `chmod 755` on `photos`, `cache` and `uploads`.
3. Create a MySQL database in the hosting panel.
4. Open `/install.php`, fill in the four values it shows you, choose a site password.
5. **Delete `install.php`.**

Step 5 matters: a working installer on a live site is a way for a stranger to repoint it at
their own database. The page says so when it finishes, and refuses to do anything once the
site is claimed — but the file should not be there at all.

### Requirements

PHP 8.0+ (tested on 8.3 and 8.5) with `pdo_mysql`, `gd` and `mbstring`; MySQL 5.7+ or
MariaDB 10.3+; `mod_rewrite`; `upload_max_filesize` and `post_max_size` at 24M or more. The
installer checks every one of these and says which is missing.

---

## Files

```
index.php        the router — picks a mode, dispatches, ~130 lines
install.php      the one-time setup form. Delete after use.
schema.sql       the MySQL shape of migrations/*.sql
lib/http.php     responses, constants, the shell with the manifest inlined
lib/db.php       config.php and the PDO connection
lib/auth.php     PBKDF2, HMAC tokens, constant-time compare
lib/credentials.php   the auth table; require_auth()
lib/ratelimit.php     login lockout
lib/store.php    where image bytes live — the filesystem twin of worker/storage.ts
lib/manifest.php the images table — the twin of worker/images.ts
lib/api.php      the eleven routes
lib/folder.php   folder mode, unchanged from the original single-file version
```

---

## Things that are load-bearing

**The `Authorization` header.** Apache does not pass it to PHP under CGI or FastCGI. Without
the `RewriteRule` in `.htaccess` that copies it into the environment, every write returns 401
and nothing in the error log explains why. It is the first thing to check if saving fails.

**Object keys are immutable.** `put_object` refuses to overwrite. Variants are served with a
one-year immutable cache header, and a mutated file behind that header is a stale image no
purge can reach — on an unknown number of client caches. "Replace" mints a new id instead.

**The extension whitelist in `object_path`.** It reads like pedantry until you notice that
`full.[a-z0-9]{1,5}` accepts `full.php`. On shared hosting that is executable code in the web
root. The earlier pattern did accept it; the test suite is what caught it.

**PBKDF2 stays at 100,000 iterations.** PHP would happily do OWASP's 600,000. The Workers
runtime hard-caps at 100,000 and *throws* above it, so a stronger hash here is one Cloudflare
cannot verify — and the two pathways are supposed to be interchangeable. See ADMIN_AUTH.md.

**Rate limiting keys on `REMOTE_ADDR`, not `X-Forwarded-For`.** At the Cloudflare edge
`CF-Connecting-IP` cannot be spoofed. On shared hosting `X-Forwarded-For` is just a request
header, so trusting it lets an attacker reset the counter on every guess.

---

## Testing

```bash
npm run verify:php        # crypto, key validation, escaping + cross-runtime round trip
npm run verify:php:api    # the full API over HTTP against a real MySQL database
```

The first proves a password hash and session token made by `worker/auth.ts` verify in PHP
**and the reverse** — using each side's shipping code, because that is the claim that lets a
gallery move between Cloudflare and shared hosting without the owner choosing a new password.

The second drives every route over HTTP, including a per-route assertion that each write
rejects a forged token. `ADMIN_AUTH.md` requires that shape specifically: shared middleware
is correct until someone adds a route outside the guarded group, and that failure is silent.

`verify:php:api` needs a local MySQL and a database it may drop; it is not part of
`verify:all` for that reason.
