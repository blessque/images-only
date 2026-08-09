# Runbook

For a developer who did not build this, helping an owner who is not technical.

Read `README.md` for what the project is and `docs/architecture/OVERVIEW.md` for how it fits
together. This file is the operational half: deploy it, move it, fix it, get the data out.

**The owner is a graphic designer.** Any answer that ends in "just run this command" is a
wrong answer for him, even when it is right for you. Everything he needs day to day is at
`/help` on his own site.

---

## The four pathways

| | Host | Admin panel | Who must be technical | Cost |
|---|---|---|---|---|
| **A** | Cloudflare free | yes | you, once | 0 |
| **B** | Cloudflare + R2 | yes | you, once | $5/mo + a working card |
| **C** | VPS — Node, SQLite, files | yes | **someone, forever** | ~200–500₽/mo |
| **D** | Static freeze — any host | no | nobody | ~0 |

**A is the home. D is the parachute. C is for reachability, not cost.**

C is an *upgrade* in technical burden, not a safety net: a server to patch, a certificate to
renew, a process that dies at 3am. Take it only when visitors genuinely cannot reach
Cloudflare. Where nobody will own that permanently, D is the honest answer.

---

## A — Deploy to Cloudflare

Normally the **Deploy to Cloudflare** button in the README: it forks the repository into the
owner's GitHub, provisions his KV and D1, applies migrations, and prompts for `SETUP_CODE`.
He then claims the site in a browser.

By hand:

```bash
npx wrangler login                        # fails behind a VPN — Cloudflare challenges datacenter IPs
npx wrangler d1 create justimages         # paste database_id into wrangler.jsonc
npx wrangler kv namespace create IMAGES   # R2 needs a card; KV does not
npm run db:remote
npm run deploy
```

Then open the site and choose a password. Setting `ADMIN_PASSWORD_HASH` and `TOKEN_SECRET`
as Worker secrets still works and still takes precedence, but is no longer required.

### The free tier, in real numbers

- **1GB stored** ≈ 600 photographs at four variants each
- **1,000 writes/day** ≈ 250 photographs; the upload tray warns before a batch exceeds it
- **100k reads/day**; repeat views are free, since variants are immutable and edge-cached
- **KV is eventually consistent** (~60s), so a just-published image can 404 for its uploader.
  `Tile.tsx` retries before showing the broken mark.

---

## B — Moving to R2

Worth it above ~600 photographs, or to escape the daily write cap. Needs a card on the
account. No code changes — `worker/storage.ts` prefers R2 whenever the binding exists:

1. Enable R2 once in the dashboard (it fails with `code: 10042` until you do)
2. `npx wrangler r2 bucket create justimages`
3. Uncomment the `r2_buckets` block in `wrangler.jsonc`
4. `npm run export && npm run import` to carry the photographs across

---

## C — Off Cloudflare entirely

See **`node/README.md`**, which is the full guide. Short version:

```bash
npm run node:start      # builds, migrates, serves on :8080
npm run verify:node     # proves it works, on a throwaway database
```

Node 22.5+ only — SQLite is built into Node from that version, so there is **no dependency
to install and no native module to compile**. `src/` and `worker/` are unmodified; `node/`
supplies the three bindings the Worker expects.

Verified: 16 photographs exported from Workers KV and imported into the filesystem backend,
byte-identical, size classes intact.

---

## D — Freezing to plain files

```bash
npm run build && npm run freeze          # → freeze/
npm run verify:freeze                    # proves it renders, uncropped, at CLS 0
npm run freeze -- https://the-live-site  # against production instead of local
```

Upload the **contents** of `freeze/` to any static host. No server, no database, no account.
The admin lock is inert — a frozen copy has nothing listening — so updating it means running
`freeze` again.

**Yandex Object Storage** is the best fit for a Russian audience: Russian payment, custom
domain, free Let's Encrypt via Certificate Manager, automatic HTTP→HTTPS. Two constraints:
the bucket must be named **exactly** as the domain, and the domain must be third-level or
deeper.

---

## Connecting a domain

He buys it in his own name. **Cloudflare Registrar will likely refuse a Russian card** — use
reg.ru or Timeweb instead, then point the nameservers.

| Pathway | Steps |
|---|---|
| **Cloudflare** | Add the site to Cloudflare → change nameservers at the registrar → Worker → Settings → Domains & Routes → Add → Custom Domain. Cloudflare issues the certificate. |
| **Yandex Object Storage** | Name the bucket exactly as the domain → `CNAME` to `<domain>.website.yandexcloud.net` → issue a free certificate in Certificate Manager. |
| **VPS** | `A` record to the server's IP → Caddy with `your-domain.ru { reverse_proxy 127.0.0.1:8080 }`. It gets and renews certificates itself. |

The `*.workers.dev` subdomain is **account-wide and chosen once**; changing it breaks every
link already shared.

---

## Fixing things

### He cannot log in

1. **Check it is not the rate limiter.** Nine attempts in 15 minutes and the site refuses
   *every* password, including the right one — deliberately, so it cannot be used as an
   oracle. Wait, or clear it:
   `npx wrangler d1 execute justimages --remote --command "DELETE FROM login_attempts;"`
2. **Check the Worker is not throwing.** `npx wrangler tail`, then have him try. A 5xx is not
   a wrong password; the login form now says so, but the logs are definitive.
3. **Replace the password.** Dashboard → D1 → `justimages` → Console → `DELETE FROM auth;`
   then reload the site and claim it again. Do it promptly: while the row is gone, anyone who
   opens the site can claim it.

> Two hours were once spent on a "wrong password" that was a crashing Worker. `wrangler tail`
> answers in ten seconds. Reach for it before any theory about what he typed.

### Images 404 right after upload

KV is eventually consistent, up to ~60 seconds. `Tile.tsx` retries three times before showing
the broken mark. If they are still missing after a few minutes, check the browser network log
for which rung is missing and compare against `max_rung` on the row.

### A photograph was deleted

Deletes are soft. The row keeps `deleted_at` and the bytes survive 30 days:

```sql
UPDATE images SET deleted_at = NULL WHERE id = '…';
```

### Something looks wrong after a migration

Migrations are tracked in `d1_migrations` and never re-run. **Migration 0001 is not
idempotent** — running it twice once corrupted real data, because `medium` is both an old
name and a new one. Never apply migrations with `d1 execute --file`; always
`wrangler d1 migrations apply`.

---

## Getting the data out

- **He can do it himself:** *Download everything* in the admin bar → a zip of every
  photograph plus `manifest.json`. Same layout as `npm run export`.
- **You can do it:** `npm run export -- https://the-site`
- **Restoring either:** `IMPORT_PASSWORD='…' npm run import -- https://the-target`

`import` speaks only the public HTTP API, so it does not care what is behind it. That is what
makes every pathway above reachable from every other one.

---

## Before you change anything

- `docs/decisions/TUNING_LOG.md` — decisions already made and alternatives already rejected.
  Read it before re-opening one; several were argued expensively.
- `docs/architecture/ADMIN_AUTH.md` — the security model. Several rules are load-bearing.
- **PBKDF2 is capped at 100,000 iterations by the Workers runtime.** Raising it toward OWASP's
  number does not cost more, it takes the login endpoint down — and nothing local reproduces
  it, because Node has no cap and neither does `wrangler dev`.
- **Never overwrite a stored object.** Immutable keys are what make the immutable cache header
  safe; "replace image" mints a new id.
- **The grid never crops.** Any change rendering an image at other than its intrinsic aspect
  ratio is a bug, not a trade-off.

```bash
npm run typecheck && npm test     # 56 unit tests
npm run verify:all                # grid, worker, setup, admin end to end
npm run verify:node               # the Node port
npm run verify:freeze             # the static freeze (needs `npm run freeze` first)
```
