# justimages

A photography portfolio that is one page and one idea: a continuous, full-bleed grid of
images. No gaps, no captions, no navigation.

Two properties define it:

- **The grid never crops.** Every photo appears at its true aspect ratio, rows always fill
  the viewport width exactly, and row heights vary to make that true.
- **It is managed from the page itself.** Drop files onto the site to publish them — no git,
  no FTP, no dashboard, no build step.

## Stack

Vite + React 19 + TypeScript, on a single Cloudflare Worker serving both the static assets
and the API. Image bytes in Workers KV (or R2 where it is enabled), manifest in D1.

## Development

**No Cloudflare account is needed to run the whole thing.** `wrangler dev` emulates D1 and
R2 on your machine, so uploads, the database and the admin flow all work locally.

```bash
npm install
npm run local      # build + apply the local schema + serve on http://localhost:8787
```

That is the real site: drop photographs onto it, press `Option+\`, publish, reorder. Local
data lives in `.wrangler/` and never leaves the machine.

Other tasks:

```bash
npm run dev          # grid only, against generated fixtures — no backend at all
npm run fixtures     # regenerate the 42 test photographs (needs ffmpeg)
npm test             # 48 unit tests: grid solver invariants, auth, credentials
npm run verify:all   # browser suites: grid, Worker, first-run setup, admin end-to-end
npm run perf         # seed 200 images and measure bytes, LCP and CLS
npm run local:reset  # wipe local images and login attempts
npm run export       # download the whole gallery — photographs and metadata
npm run import       # restore an export (also how the site changes storage or host)
npm run freeze       # turn a live gallery into a static folder any host will serve
npm run verify:freeze  # prove that folder still renders, uncropped, at CLS 0
npm run db:migrate   # apply pending migrations (tracked; never re-runs one)
                     # migrations/ is the ONLY definition of the schema
```

The local admin password comes from `.dev.vars` (gitignored). Generate a real one with
`npm run hash-password`.

## Deploy your own

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/blessque/images-only)

One click. It copies this repository into **your** GitHub account, creates **your** KV
namespace and D1 database, applies the migrations, and asks you to invent a **setup code** —
one word, which you type once.

Then open the site and it asks you to choose a password. That is the whole setup: no
terminal, no Cloudflare dashboard, no hash. The free tier costs nothing and needs no card.

Click the button twice to run two separate sites from the same template.

> The setup code exists so that nobody who stumbles on the URL before you can claim the site.
> It stops mattering the moment you set your password.

### Or by hand

```bash
npx wrangler login                    # fails behind a VPN — Cloudflare challenges datacenter IPs
npx wrangler d1 create justimages     # paste database_id into wrangler.jsonc
npx wrangler kv namespace create IMAGES   # image bytes; R2 needs a card, KV does not
npm run db:remote                     # apply migrations to production
npm run deploy
```

Then open the site and choose a password, exactly as above. Setting
`ADMIN_PASSWORD_HASH` and `TOKEN_SECRET` as Worker secrets still works and still takes
precedence — that is how the original deployment runs — but it is no longer required.

After the first deploy, pushes to `main` deploy via GitHub Actions
(`.github/workflows/deploy.yml`). See `docs/architecture/OVERVIEW.md`.
