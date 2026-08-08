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
and the API. Images in R2, manifest in D1.

## Development

```bash
npm install
npm run dev        # Vite dev server
npm run worker     # Worker + R2/D1 locally via wrangler
npm test           # unit tests (grid solver)
npm run build      # production build
```

## Deployment

Pushes to `main` deploy via GitHub Actions. See `docs/architecture/OVERVIEW.md`.
