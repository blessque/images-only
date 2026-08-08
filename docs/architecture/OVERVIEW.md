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
                    │  POST /api/upload-url → presigned PUT │
                    │  PATCH /api/settings → footer text    ┘
                    └────────┬──────────────┬──────────────┘
                             │              │
                       ┌─────▼─────┐  ┌─────▼─────┐
                       │    D1     │  │    R2     │
                       │ manifest  │  │  {id}/    │
                       │ settings  │  │ *.webp    │
                       └───────────┘  └───────────┘
```

Static assets *and* API in one Worker rather than Pages + Functions, because it lets the
Worker do the single most valuable thing in the whole architecture:

## The manifest is inlined into the HTML

```html
<script type="application/json" id="manifest">[{"id":"…","a":1.5,"c":"big",…}]</script>
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

**D1** (`worker/schema.sql`):

- `images` — `id`, `aspect` (w/h, float), `size_class`, `alt`, `sort_order`, `created_at`,
  `deleted_at`
- `settings` — key/value; currently the footer's `name` and `contact`

Aspect ratio is stored as a **float, not width and height**. It is the only thing the layout
needs, it is what makes the solver's arithmetic direct, and storing dimensions invites
someone to recompute it inconsistently somewhere.

**R2**: `{id}/{400,800,1600,2400}.webp`, immutable, never overwritten. See
[IMAGE_PIPELINE.md](IMAGE_PIPELINE.md).

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
tier with wide margins: R2 gives 10GB and — decisively for an image site — **zero egress
fees**, where S3-style billing would charge for every view. D1 free tier is 5GB. Workers
free tier is 100k requests/day.

Expected cost: **$0/month**, with no server to patch, no SSL to renew, and nothing that can
go down at 2am in a way the designer cannot fix by waiting.

## Local development

```bash
npm run dev      # Vite, against fixture data (Phase 2 needs no backend at all)
npm run worker   # wrangler dev — local R2 + D1 emulation
```

Phase 2 is deliberately buildable with **no Cloudflare account**: the grid is the part with
all the taste decisions in it, and it needs no infrastructure to judge.
