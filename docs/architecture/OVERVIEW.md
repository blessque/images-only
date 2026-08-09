# Architecture Overview

## One Worker serves everything

```
                    ┌──────────────────────────────┐
   browser  ───────▶│   Cloudflare Worker          │
                    │                              │
                    │  GET  /          → HTML shell with the manifest INLINED
                    │  GET  /assets/*  → static assets (Vite build)
                    │  GET  /api/images    → manifest JSON
                    │  POST /api/login     → token          ┐
                    │  POST /api/images    → create row     │ all auth-gated,
                    │  PATCH/DELETE /api/images/:id         │ each independently
                    │  PUT  /api/upload/:id/:file → bytes   │
                    │  PATCH /api/settings → footer text    ┘
                    └────────┬──────────────┬──────────────┘
                             │              │
                       ┌─────▼─────┐  ┌─────▼──────────┐
                       │    D1     │  │  storage.ts    │
                       │ manifest  │  │  KV  (or R2)   │
                       │ settings  │  │  {id}/*.webp   │
                       └───────────┘  └────────────────┘
```

Static assets *and* API in one Worker rather than Pages + Functions, because it lets the
Worker do the single most valuable thing in the whole architecture:

## The manifest is inlined into the HTML

```html
<script type="application/json" id="manifest">{"images":[{"id":"…","aspect":1.5,…}],…}</script>
```

The naive alternative is a four-step waterfall: load HTML → load JS → fetch manifest →
solve layout → fetch images. Inlining collapses the middle two. The grid geometry is
solvable from the first response, so cells are laid out on first paint and images stream
into boxes that already exist.

**This matters far more than the framework-size question**, and it is the reason the React
decision was not worth agonising over. It is also what makes CLS 0 by construction — see
[GRID.md](GRID.md).

Manifest size: ~200 rows × ~150 bytes ≈ 30KB, ~8KB gzipped. Edge-cached, purged on write.

## Data

**D1** — defined solely by `migrations/`, which is the only source of truth for the schema:

- `images` — `id`, `aspect` (w/h, float), `size_class`, `alt`, `max_rung`, `passthrough`,
  `format`, `sort_order`, `created_at`, `deleted_at`
- `settings` — key/value; currently the footer's `name` and `contact`

Aspect ratio is stored as a **float, not width and height**. It is the only thing the layout
needs, it is what makes the solver's arithmetic direct, and storing dimensions invites
someone to recompute it inconsistently somewhere.

**Image bytes**: `{id}/{400,800,1600,2400}.webp` (or `{id}/full.{format}` for a
passthrough), immutable, never overwritten. See [IMAGE_PIPELINE.md](IMAGE_PIPELINE.md).

Which store holds them is decided by `worker/storage.ts`, the only file that knows:

| Backend | When | Limits |
|---|---|---|
| **Workers KV** | default, and what is deployed | 1 GB, 100k reads/day, **1,000 writes/day** |
| **R2** | whenever the `BUCKET` binding exists — preferred | 10 GB, no daily write cap |

R2 is the better store and the code still implements it; it is not deployed only because
**enabling R2 requires a credit card on the account** and KV does not. Switching back is
four steps, none of them code: enable R2 in the dashboard, `wrangler r2 bucket create`,
uncomment the block in `wrangler.jsonc`, then `npm run export && npm run import`. The
R2-era build is also tagged `r2-reference`.

**KV is eventually consistent** — up to ~60s worldwide — so a photograph published seconds
ago can 404 for its own uploader. `Tile.tsx` retries on a backoff before showing the
broken-image mark; see `IMAGE_RETRY_DELAYS_MS`.

## Moving off Cloudflare entirely

Written down so it stays a short job rather than a rebuild, because the audience may end up
being mostly in Russia, where Cloudflare has had reachability trouble.

The Worker is a standards-based `fetch(request, env)` handler, so it runs on Node behind a
thin adapter. **This is now built and tested rather than asserted** — see `node/` and
`npm run verify:node`. It was a claim in this file for two iterations; a written escape
route nobody has walked is a guess, and this one turned out to be true.

- `node/d1.mjs` — D1's query shapes on **Node's built-in SQLite**. Not `better-sqlite3`:
  `node:sqlite` ships with Node 22.5+, so there is **no dependency and no native module to
  compile**, which matters on a small VPS.
- `node/bindings.mjs` — the filesystem implementation of `worker/storage.ts` (two
  functions, as promised) and a static-file `ASSETS` fetcher.
- `node/server.mjs` — the HTTP adapter, plus migrations applied on boot.

**Neither `src/` nor `worker/` changes at all**, and `npm run export` / `npm run import`
carry the photographs across — verified byte-identical out of Workers KV and into the
filesystem backend.

**But read `node/README.md` before choosing it.** A VPS is not a simpler option than
Cloudflare, it is a harder one: a server to patch, a certificate to renew, and a process
that can die at 3am, all of which become somebody's job permanently. The reason to take it
is **reachability** — if visitors cannot get to Cloudflare — and not cost, since the free
tier is free and needs no card. Where nobody will be that somebody, the honest answer is
`npm run freeze`.

## Freezing it to plain files

`npm run freeze` turns a live gallery into a folder any static host serves — the only
pathway that needs no operator at all. It reads over HTTP and takes `/` exactly as the
server renders it, manifest already inlined, so the frozen page cannot drift from the live
one. `npm run verify:freeze` serves the result with `python3 -m http.server` and asserts the
grid still renders uncropped at **CLS 0.00000**.

Good targets: Yandex Object Storage (Russian payment, custom domain, free Let's Encrypt via
Certificate Manager — the bucket must be named exactly as the domain), any S3, or a folder
on any web host. The admin lock is inert there: a frozen copy has nothing listening.

## Client

```
main.tsx
  └─ reads the inlined manifest (no fetch on first load)
     ├─ Grid.tsx      ← ResizeObserver → solve() → rows
     │   └─ Tile.tsx  ← <img srcset sizes> + loading pulse + broken-image cross
     ├─ Footer.tsx    ← ©, name, contact, lock icon
     └─ unlock listener (Option+\ / lock click)
          └─ await import('./admin')   ← the ONLY path into admin code
```

`src/grid/solve.ts` is pure and DOM-free — see [GRID.md](GRID.md) for why that is load-bearing
rather than stylistic.

## Costs

At 200 images ≈ 300MB stored and portfolio-level traffic, this sits inside Cloudflare's free
tier: KV gives 1GB of storage and 100k reads a day, D1 gives 5GB, Workers gives 100k
requests a day. Cloudflare charges **nothing for egress**, which is what decides it for an
image site — S3-style billing charges for every view.

The one limit worth watching is **KV's 1,000 writes a day**: 200 photographs at four
variants is 800, so a full first upload fits inside a day and a bigger batch needs
splitting. The tray says so before you publish.

Expected cost: **$0/month**, with no server to patch, no SSL to renew, and nothing that can
go down at 2am in a way the designer cannot fix by waiting.

## Local development

```bash
npm run dev      # Vite, against generated fixtures — no backend at all
npm run local    # build + migrate + wrangler dev, with KV and D1 emulated locally
```

The whole site runs with **no Cloudflare account**: miniflare emulates KV and D1 on the
machine, which is how every suite in `scripts/` is run.
