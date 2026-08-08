# Tuning Log

Decisions already made and alternatives already rejected. **Do not re-litigate or
reintroduce without an explicit reason.** Append new entries at the bottom of each section,
dated.

---

## Hard requirements (from the brief — never violate)

- **Never crop.** Every image renders at its intrinsic aspect ratio. This is the product's
  one hard promise; a change that violates it is a bug, not a trade-off.
- **No gaps, margins, padding or white space** anywhere in the grid.
- Rows always fill the viewport width. The grid always fills the screen.
- Row height is flexible so the whole image is seen.
- The designer manages the site **from the page** — drag-and-drop or `Option+\`. The moment
  the workflow needs a terminal, the site stops being updated.
- Register is **are.na**: black, 2–3 greys, Inter Tight, no effects, no decoration. If a
  change makes it look more like a *product* and less like a *wall of images*, it is wrong.

---

## Decisions made — 2026-08-09 (brainstorming, before any code)

### A-paper formats are NOT the grid — rejected
The brief opened with "A0 contains two A1s". The A-series has a **fixed √2 aspect ratio**,
which is exactly what cannot coexist with "never crop": any non-√2 photo would have to be
cropped or letterboxed (letterboxing = the banned gaps). Confirmed with the user that
A-formats were an illustration of *nesting*, not a spec. **Dropped entirely.** Do not
reintroduce fixed-ratio cells.

### Justified rows — the only algorithm that satisfies all four constraints
`H = W / Σaᵢ`. Solving for height (the one free variable) is what fills rows exactly without
forcing widths onto images that do not have those proportions. See `docs/architecture/GRID.md`.

### Size class controls DENSITY, not size — the non-obvious consequence
Within a row all images share a height, so their widths are locked to their aspect ratios.
**Two same-aspect images in one row render at identical widths regardless of class.** There
is no fix that does not crop or leave gaps.

Therefore hierarchy comes from *how many images share a row*, and Big is `1/1` on desktop —
it takes a whole row, which is the only way it reads as big. Wide screens drop Big to `1/2`
(two large images share), matching the user's own instinct for 2560px.

**Nested rows** (one tall image beside a stack of two) would give true in-row hierarchy while
preserving both constraints. Not built — revisit only if density-based hierarchy proves
insufficient in real use.

### Mobile is a table row, not a code path
Every class collapses to `1/1` at ≤640, producing the one-per-row Instagram feel the user
asked for. Resist adding a mobile branch.

### Last row: fills the width, whatever height results
The three options for an incomplete final row are leave a gap (violates a hard rule), crop
(violates a hard rule), or let it be tall. Only the third is available. The bad case is a
trailing portrait (2:3 solves to 2160px at W=1440), so **the admin UI warns** past ~1.5×
`MAX_ROW_HEIGHT` — solve it where the user can see it rather than silently degrading the
one promise the site makes.

### Height clamp is satisfied by row MEMBERSHIP, not by cropping
`H > MAX_ROW_HEIGHT` ⇒ pull in another image (larger `Σaᵢ` ⇒ smaller `H`). `H < MIN` ⇒ push
one out. Both bounds are reachable without ever touching an aspect ratio.

### ffmpeg — rejected, and it would not have helped
It is a CLI binary; it does not run in a browser. `ffmpeg.wasm` costs ~30MB of payload to do
worse what the browser does natively. More importantly it is the wrong tool for stills: the
dominant win is **not shipping 6000px into an 800px cell**, which is a resize decision, not
an encoder one. ffmpeg stays on the dev machine for one-off batch work.

### Resize first, quality second
A ladder (400/800/1600/2400) at high quality beats one large file crushed low, every time.
Do not respond to a size overage by dropping quality before checking the dimensions are sane.

### Rung 3 is encoded at ~0.92 while the others sit at ~0.86 — deliberate asymmetry
**Originals are not stored** (user's call; he keeps masters on his Mac). So the 2400px rung
*is* the master, and re-encoding from it later is lossy-on-lossy. The higher quality on that
rung alone is bought insurance. **Do not "optimise" it down for consistency.**

### No global "skip compression" toggle — rejected
The user floated offering the choice. A non-technical user turns it off "to be safe" and
ships a 200MB page, defeating the requirement he ranked first. The toggle looks like control
and functions as a footgun. Replaced by honest before/after byte counts at upload (trust
earned by evidence) plus a per-image "high fidelity" escape hatch — local and reversible
rather than global and permanent.

### Colour management is a correctness issue, not a nicety
A canvas re-encode drops ICC/EXIF; a Display-P3 photo through an untagged canvas shifts hue
visibly. This is a graphic designer's portfolio — he will see it and he will be right.
Verified by a round-trip test on a known P3 image, **not by eye** (eyeballing a colour shift
on the monitor that caused it is not a test).

### Placeholder: white rect pulsing opacity 0.10 ↔ 0.40 — user's call
Originally argued against "shimmer" as busy product-UI, but that objection was to the
Facebook skeleton *sweep* (a gradient travelling across the box). The user's version is an
opacity **pulse**, which is much quieter and does not have that problem.

Consequence: **ThumbHash and dominant-colour extraction are both dropped** — no dependency,
no upload-time hash computation, one less manifest field. Simpler than what was proposed.
Must respect `prefers-reduced-motion` (hold at a static 0.2).

### Broken image: 1px outline + corner-to-corner cross + alt text
The classic wireframe idiom, drawn in the exact reserved aspect box.

### React over vanilla TS — settled on roadmap, not on bytes
React gzipped costs roughly **one-fifth of a single 1600px photo**, on a page shipping 200
photos. The real levers, in descending magnitude: correctly-sized variants via `srcset`
(**megabytes**), lazy loading (**megabytes**), zero CLS (perceptual), framework choice
(~45KB). Decided on the stated roadmap — forms, more pages, possibly a storefront — where
hand-rolled vanilla becomes a bad framework. **Do not re-litigate on bundle size**; if size
ever genuinely matters the lever is code-splitting admin, which is already the design.

### No virtualisation at 200 images
200 lazy `<img>` is well within browser capability, and virtualising breaks Cmd+F and
accessibility. Revisit around 1000.

### Auto-save with undo, not a Save button
A non-technical user should never wonder whether he saved. Soft delete + undo toast makes the
destructive path recoverable, which is what a Save button was really protecting against.

### Email password reset — rejected as overengineering (user's own read, confirmed)
Account recovery adds a mail provider, reset tokens, expiry windows and an enumeration
endpoint to a single-user site, to save one dashboard visit. Forgotten password = rotate the
secret in the Cloudflare dashboard, 30 seconds.

### Footer is not sticky
Full-bleed is the point, and `Option+\` is the real admin entry — the lock icon is the
discoverable one, not the fast one. One-line change if the user disagrees after seeing it.

---

## Open issues

- `MAX_ROW_HEIGHT` and the wide-screen Big fraction (`1/2` vs `1/3`) are **taste dials, not
  yet tuned by eye**. Both need a pass against real photos in Phase 2, and the verdict
  recorded here.
- Drag-to-reorder is unbuilt. The hard part is that a justified grid re-solves under the
  dragged item, so the drop indicator must be computed against the **pre-drag** layout.
- Orphaned R2 objects from abandoned uploads are not yet reaped. Metadata is written last on
  purpose, so orphans are the designed failure mode — invisible and cheap, versus a manifest
  row pointing at a missing image. A sweep is a maintenance task, not a correctness one.
- No domain chosen. Workers gives a `*.workers.dev` subdomain; a custom domain is a later
  5-minute change.
