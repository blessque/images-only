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

## Decisions made — 2026-08-09 (Phase 2, grid built and measured)

### `MAX_ROW_HEIGHT_VH` is 1.4, NOT 1.0 — found by writing the maths down
At 1.0 the clamp pulls a second image into every `big` row, which destroys the only
mechanism this grid has for hierarchy. A full-width 3:2 photo at 1440px is 960px tall —
more than a laptop viewport and perfectly fine to scroll. The clamp exists to stop rows
that are *absurd* (a full-width portrait solves to 2160px), not to fit every row on one
screen. 1.4 admits a lone landscape while still catching squares and portraits.

### Row height stays FRACTIONAL; only widths are integers
Rounding the height to an integer first was implemented, tested and **reverted**. It shifts
`Σ(H·aᵢ)` off the container by up to `0.5·Σa` — nearly 5px for a row of panoramas — and
redistributing that much forces some widths to move 2px, breaking the one-pixel budget the
"never crops" guarantee rests on. Keeping H exact makes `Σ(exact) == W` identically, so the
remainder is bounded by the image count and **each width moves at most one pixel**.
Fractional row heights are safe: rows stack in normal flow, so adjacent rows abut exactly
and no seam is possible. Only horizontal neighbours inside a row needed integer widths.

### The `minRowHeight` floor is a goal, not a guarantee — the test was wrong, not the code
A lone panorama in a 320px container genuinely *is* 107px tall. The floor is only reachable
by REMOVING images and you cannot remove the last one. The honest invariant, now asserted:
the solver breaches the floor only when it provably cannot do better — a single-image row,
or one where giving an image back would breach the ceiling instead.

### CLS was 0.049 and the first hypothesis was WRONG — measure, do not reason
Browser verification showed CLS 0.03–0.08 despite "CLS is 0 by construction". First guess
was the dev-only async fixture fetch; simulating the production inlined manifest changed
almost nothing. Instrumenting individual `layout-shift` entries found **one** shift at
184ms attributed to `footer`.

Cause: `Grid` seeded `containerWidth` at 0 and waited for `ResizeObserver`, which fires
after mount — so the first paint had no rows, the footer painted near the top, and 42 rows
then shoved it down. A `requestAnimationFrame` in the observer made it worse.

Fix: seed `containerWidth` synchronously from `document.documentElement.clientWidth`
(**not** `innerWidth` — `clientWidth` excludes the scrollbar, which is exactly what a
full-width block gets). The observer now handles only *changes*, which is what it is for.
Result: **CLS 0.00000 at all four breakpoints.**

Lesson worth keeping: the manifest supplies every aspect ratio, but the solver also needs
the container width, and an asynchronously-discovered width reintroduces exactly the shift
the inlined manifest was bought to prevent.

### `srcset` `w` descriptors are the file's real width, not the rung number
Rungs are LONG-EDGE sizes, so a 9:16 image at rung 1600 is 900×1600 and its descriptor
must be `900w`. Getting this wrong makes variant selection wrong for every portrait in the
gallery — silently, and in the expensive direction. `variantPixelWidth()` in `imageUrl.ts`.

### Fixtures carry a border and a centred label, deliberately
If the grid ever crops, the border is clipped on one side and the label goes off-centre —
the failure becomes VISIBLE rather than merely measurable. The unit tests prove never-crops
numerically; the fixtures prove it to the eye.

---

## Decisions made — 2026-08-09 (Phase 3, Worker built and integration-tested)

### The router must key on CONTENT TYPE, not on 404 — the inlining bug
The first router did `env.ASSETS.fetch(request)` and returned the result unless it 404'd.
For `/` the asset server answers **200** with the un-inlined `index.html`, so `serveShell`
never ran and the manifest injection — the entire architectural point of putting one Worker
in front of both — silently did nothing. `run_worker_first: true` got the request to the
Worker; the Worker's own code then handed it straight back.

Fix: **any** response the asset server would return with `text/html` is replaced by the
inlined shell. Keying on content type rather than on the path also covers future routes
that resolve to a document. Caught only by integration-testing the real Worker; no unit
test of `serveShell` would have found it, because `serveShell` was correct.

### Presigned R2 URLs — rejected
They need R2's S3-compatible credentials as a third secret, and they exist to keep large
uploads off the origin. Every rung here is under a megabyte and the Worker is already the
auth boundary, so uploading through it means authorisation is checked by the same code as
every other write with nothing extra to configure or leak.

### Image ids are minted CLIENT-side, and a collision is a 409
The R2 keys must exist before the variants are written, and the variants are written before
the metadata row (so an abandoned upload orphans bytes rather than pointing a manifest row
at nothing). So the client mints the id. A primary-key collision is therefore representable
— astronomically unlikely at 64 bits, but an uncaught constraint error surfaces as a 500,
and a 500 mid-upload is the one failure a non-technical user cannot act on.

### The rate limiter counts BEFORE the password check, deliberately
A flood of wrong guesses cannot outrun the counter, and — verified in the integration test —
**even the correct password is refused while limited.** Refusing only wrong passwords would
turn the limiter into a password oracle.

### Not a JWT
One issuer, one audience, one algorithm. A header announcing which algorithm to trust would
be pure attack surface (`alg: none`). The token is `base64url(payload).base64url(HMAC)`.

### Alt text is the injection vector, and it is escaped at the inlining site
User-controlled alt text lands inside `<script type="application/json">`. A caption
containing `</script>` would close the tag. `<` is escaped to `\u003c` — JSON treats them
as identical, so nothing downstream needs to know. Asserted in the integration test with a
real payload.

---

## Decisions made — 2026-08-09 (Phase 4, admin and upload, verified in-browser)

### Progressive halving before the final draw — not one big `drawImage`
A single draw from 6000px to 400px is a 15x reduction and the browser's filter samples too
sparsely at that ratio: fine detail aliases into shimmer, which on a photography portfolio
reads as a bad PHOTOGRAPH rather than a bad resize. Halving until within 2x keeps every step
inside the filter's competence. Measured result on real sources: −80% and −69% across the
whole four-rung ladder.

### Colour survives the round trip — measured, not assumed
`display-p3` canvas where the browser reports it back (passing the attribute is a *request*,
not a guarantee — `getContextAttributes()` is the only honest test), plus
`colorSpaceConversion: 'none'` on decode so the decoder cannot flatten a wide-gamut source
before we get it onto a wide-gamut canvas. Verified end-to-end: `rgb(200,30,54)` in,
`rgb(198,27,54)` out — max channel drift **3/255**, which is WebP quantisation, not a
colour-management error.

### One long-lived compression Worker, jobs run SEQUENTIALLY
A worker per file re-parses the module each spawn, and twenty concurrent decodes of 10MB
photographs is how a responsive-looking tray runs the machine out of memory. One worker,
jobs correlated by id, driven one at a time.

### Never upscale a rung
A 900px source has no 2400px version to give, and inventing one ships bytes carrying no
information. Rungs above the source's long edge are skipped (the first rung always emits, so
even a tiny source produces something).

### Quality floor is 0.62
Below that WebP shows visible blocking, and shipping a visibly damaged photograph to hit a
byte target is the wrong trade on a site whose entire content is photographs. If a file
cannot make budget at 0.62 it goes over budget instead.

### The admin/public seam is a context in the MAIN chunk holding no admin code
`src/lib/adminContext.ts` is a context and a type. `Grid`/`Tile` consume it and therefore
never import from `src/admin/`, which is what keeps the whole admin layer behind a dynamic
import. **Verified rather than assumed**: the e2e test asserts a normal visitor's network
log contains no `AdminLayer` or `compressWorker` request. Built chunks: AdminLayer 13.27 kB
+ 4.32 kB CSS, worker 1.87 kB, all outside the main bundle.

### `Option+\` is matched on `event.code`, not `event.key`
Alt+Backslash on macOS produces the character `«`, so `event.key` never equals `\`. Matching
`event.code === 'Backslash'` is the only thing that works, and it is not obvious from a
keyboard-event tutorial.

### "Every file shrinks >50%" is NOT an invariant — the test was wrong
A solid-colour PNG is already near-optimally compressed; 11KB → 8KB across four rungs is
~2KB each and correct. Same class of mistake as the Phase 2 `minRowHeight` floor: an
invariant asserted over degenerate inputs it was never true for. Now: every file shrinks,
and sources above 100KB shrink by more than half.

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
