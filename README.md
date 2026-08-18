# justimages

A photography portfolio that is one page and one idea: a continuous, full-bleed grid of
images. No gaps, no captions, no navigation.

Two properties define it:

- **The grid never crops.** Every photo appears at its true aspect ratio, rows always fill
  the viewport width exactly, and row heights vary to make that true.
- **It is managed from the page itself.** Drop files onto the site to publish them — no git,
  no FTP, no dashboard, no build step.

---

## Which version do you want?

Five ways to run this. **They all look identical to a visitor.** They differ only in how you
put photographs in, and who has to keep it alive.

| | You add photos by | Costs | You need |
|---|---|---|---|
| **1. Cloudflare** ← start here | dragging them onto the site | **free** | an email address |
| **2. Shared hosting** | dropping files in a folder | ~200₽/mo | hosting you may already have |
| **3. Frozen files** | you don't — someone rebuilds it | ~free | any hosting at all |
| **4. Your own server** | dragging them onto the site | ~200₽/mo | a techie, permanently |
| **5. Cloudflare + R2** | dragging them onto the site | $5/mo | a card that works abroad |

### 1. Cloudflare — the normal one

Press the button below. Make a free account, invent one word when it asks, wait two minutes,
open your site, choose a password. Then drag photos onto the page. That is the whole job.

No credit card. Room for about **600 photographs**. Nothing to maintain, ever.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/blessque/images-only)

Press it twice and you have two separate sites.

### 2. Shared hosting — the folder one

If you already pay for ordinary hosting, or Cloudflare is awkward where you live: upload one
folder, then **drop photographs into `photos/` by FTP** and they appear.

Name files `01-...`, `02-...` to order them. End a name with `-solo` to give a photo a whole
row. Edit `site.txt` for your name and contact.

Works on Beget, Timeweb, Hostinger, reg.ru — anything with PHP 8. See **[php/](php/)**.

### 3. Frozen files — the one that cannot break

Turns the site into plain files. Upload them anywhere — including free static hosting — and
there is no server, no database, no account, nothing to update or patch.

The catch: **you cannot add photographs yourself.** Someone runs `npm run freeze` again each
time. Good if you post rarely, or as a backup of a finished portfolio.

### 4. Your own server

A VPS running Node. Full site, drag-and-drop, no Cloudflare. **This is the hardest option,
not the safest** — somebody patches the server and renews the certificate forever. Choose it
only if your visitors genuinely cannot reach Cloudflare. See **[node/](node/)**.

### 5. Cloudflare + R2

Same as 1, with room for thousands of photographs. Needs a card that works with Cloudflare.
Four steps, no code — see `docs/RUNBOOK.md`.

### Still not sure?

- **You just want a portfolio online** → 1
- **You already pay for hosting** → 2
- **You are in Russia and want to pay in roubles** → 2, or 3 on Yandex Object Storage
- **You post twice a year** → 3
- **You have thousands of photos** → 5
- **You are an engineer with opinions** → 4

Everything else in this file is for developers.

---

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

## Deploying it

The one-click path is the **Deploy to Cloudflare** button above: it copies this repository
into your GitHub account, creates your KV namespace and D1 database, applies the migrations,
and asks you to invent a **setup code** — one word, typed once, which stops anyone who finds
the URL first from claiming the site. Then the site asks you to choose a password.

The other four pathways: **[php/](php/)** for shared hosting, `npm run freeze` for static
files, **[node/](node/)** for a VPS, and `docs/RUNBOOK.md` for R2.

### By hand

```bash
npx wrangler login                    # fails behind a VPN — Cloudflare challenges datacenter IPs
npx wrangler d1 create justimages     # paste database_id into wrangler.json
npx wrangler kv namespace create IMAGES   # image bytes; R2 needs a card, KV does not
npm run deploy                        # builds, applies migrations, ships
```

Then open the site and choose a password, exactly as above. Setting
`ADMIN_PASSWORD_HASH` and `TOKEN_SECRET` as Worker secrets still works and still takes
precedence — that is how the original deployment runs — but it is no longer required.

After the first deploy, pushes to `main` deploy via GitHub Actions
(`.github/workflows/deploy.yml`). See `docs/architecture/OVERVIEW.md`.
