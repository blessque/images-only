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

### Inter Tight — self-hosted, subset, variable, and NOT preloaded (2026-08-09)
Google Fonts' download button ships **TTF only** — the woff2 files exist but are served from
their CDN and never appear in the ZIP. So the conversion is ours to do.

- **The variable font, not the 18 static faces.** One file covers 100–900, so the footer's
  regular text and the admin bar's bold share a single download. Italic is not shipped —
  nothing on this site is italic and it is a separate ~592KB face.
- **The 91% saving is SUBSETTING, not the woff2 container.** Inter Tight carries Latin,
  Cyrillic, Greek, Vietnamese and a pile of symbols; the site's entire public text is one
  footer line. Kept Latin + Cyrillic (the designer's name may well be Cyrillic), dropped the
  rest: 567KB → **49.5KB**. A plain TTF→woff2 with no subsetting lands near 200KB.
- **Referenced by a RELATIVE path from `styles/fonts.css`**, so Vite fingerprints it into
  `/assets/`. A content-hashed name can be cached immutably; a stable name in `public/` has
  to be revalidated on every visit.
- **`font-display: swap` is safe HERE specifically** because the footer has a fixed 44px
  height and is the only public text, so a late swap changes glyph widths inside a box whose
  height cannot move. Verified: CLS still 0.00000 at all four breakpoints. If text ever
  lands in a self-sizing container, re-measure before assuming this still holds.
- **Deliberately NOT preloaded.** The font serves a footer at the *end* of the document;
  preloading it would make it compete with the above-the-fold photographs, which are the
  actual content.
- Regeneration needs fonttools **and brotli** — the woff2 flavour fails with an unhelpful
  `ImportError: No module named brotli`. The command is in `src/styles/fonts.css`.
- OFL: the licence lives beside the file at `src/assets/fonts/OFL.txt` and must stay with it.

---

## Decisions made — 2026-08-09 (iteration 7, found by the user testing locally)

### `srcset` must never advertise a rung the encoder did not write — SHIPPED BROKEN
The encoder correctly refuses to upscale, so a 1024px source stops at the 800 rung. But
`srcSetFor` listed all four rungs unconditionally, so the browser was told a 2400 variant
existed, picked it at DPR 2, got a **404**, and the tile fell through to the broken-image
mark. 18 × 404 on `2400.webp`, 8 × on `1600.webp` in one session.

**Why nothing caught it:** every source in the whole test suite was ≥2400px (ffmpeg
`testsrc2` at 4000×2667 and 2000×3000), so all four rungs always existed. The bug requires
a source SMALLER than a rung, and that case was never exercised. AI-generated images —
1024×1024, 1536×1024 — hit it immediately.

Fix: D1 records `max_rung`, the largest rung actually written. Emitted rungs are always a
prefix of the ladder, so one number describes the set. Now covered three ways: a unit test
on `availableRungs`, a 1024px source in the e2e fixtures, and a **blanket assertion that no
`/img/` request 404s during the entire admin run**.

Lesson worth keeping: a fixture set that is uniform in the dimension a bug lives in cannot
find that bug, however many assertions it carries.

### High fidelity must raise QUALITY, not only the budget
First implementation doubled the byte budget. That is a no-op for most photographs: the
quality search only steps DOWN when a file is over budget, so an image that already fit came
back byte-identical and the checkbox visibly did nothing (193 KB → 193 KB, measured). It now
raises the starting quality too (0.86 → 0.95, top rung 0.92 → 0.97), which is what "this one
suffered, give it more" has to mean. Measured after: 193 KB → 274 KB.

### The tray reorders BEFORE publishing
`publish` walks `staged` in array order and `sort_order` is assigned on insert, so the
tray's order *is* the gallery's order. Arranging twenty photographs there is far less work
than shuffling them afterwards one arrow-click at a time.

### A positional assertion in a test is a latent bug
The colour check sampled `images[length - 1]` as the swatch. Adding a fourth fixture and a
reorder step moved it, and the test reported a 187-channel "colour drift" that was pure test
error. It now finds the swatch by alt text. Same class as the two earlier cases where a red
test meant the test was wrong.

---

## Decisions made — 2026-08-09 (iteration 8: solo/wide/medium, from real photographs)

### `big`/`medium`/`small` REPLACED by `solo`/`wide`/`medium`
The user hit the documented failure in his own work: a `big` image rendered NARROWER than
the `small` beside it. The mechanism, now understood precisely — `big` *was* 1/1, so it
should have been alone, but a near-square image alone at 1440px solves to ~1440px tall,
which exceeds `MAX_ROW_HEIGHT` (1.4 × viewport ≈ 1260px). The clamp recruited a neighbour,
and equal heights then locked widths to aspect ratios. **The height clamp was silently
cancelling the only hierarchy mechanism the grid had.**

His proposal, adopted: `solo` takes a whole row at any aspect ratio and is **exempt from
the clamp**; everything else shares. The exemption is the fix — without it the clamp
recruits a neighbour again and we are straight back here. It is a legitimate exemption
where the last row's was not: solo is an explicit per-photograph choice, not a silent
degradation, so being tall is honoured literally and never warned about.

The naming is also more honest than mine. "Big" promised a size the grid could not deliver;
"solo" promises to be alone, which is exactly what it does. He dropped `narrow` as
unnecessary — three classes, not four.

### Two rules the solver enforces directly, not through fractions
A solo image never joins a row in progress, and is never conscripted to fix another row's
height. The second means a shared row **can** exceed the ceiling when the only candidate
next in line is solo — a goal-not-guarantee, the same shape as the `minRowHeight` floor,
and the sweep test now asserts the weaker true property instead of the convenient false one.

### The tray drags to reorder; arrows got bigger
Only the HANDLE is draggable, not the whole row — making the `<li>` draggable breaks text
selection in the alt input inside it, so you drag the row when you meant to select a word.
The drop target is an insertion RULE rather than a reflowing gap: the tray is a fixed list,
and a line reads more clearly than every row shifting under the cursor.

### A migration run with `d1 execute --file` has no memory — and 0001 CORRUPTED DATA
Shipped `001-solo-wide-medium.sql` behind `npm run db:migrate` implemented as
`d1 execute --file`, and asserted it was idempotent. **It is not, and cannot be made so.**
The mapping is `big→solo, medium→wide, small→medium`; after one run the old `small` rows
are `medium`, so a second run matches them on `WHEN 'medium' THEN 'wide'` and pushes them
again. `medium` is both an old name and a new one, so the CASE cannot distinguish a
migrated row from an unmigrated one.

The user ran it twice. 8 rows that should be `medium` became `wide`, and **the loss is
unrecoverable** — no column separates them from the 3 rows that were legitimately `wide`.

The defect was never the SQL. It was that a migration was **re-runnable at all**. Now
applied through `wrangler d1 migrations apply`, which records each file in `d1_migrations`
and refuses to repeat it; `migrations_dir` sits inside the D1 binding (it is not a
top-level wrangler field). **Never invoke a migration with `d1 execute --file`.**

Second-order lesson: "idempotent" is a claim to *test*, not to reason about. Running it
twice against a scratch database would have taken thirty seconds.

### Renaming classes shipped with a MIGRATION, not a reset
`worker/migrations/001-solo-wide-medium.sql` rebuilds the table (SQLite cannot alter a CHECK
constraint in place) mapping big→solo, medium→wide, small→medium. Verified on the user's
own 17 uploaded photographs: 6/3/8 became 6 solo / 3 wide / 8 medium with the R2 objects
untouched. Nothing is deployed yet, so this existed purely to save him re-uploading — but
it is the pattern every future schema change must follow.

### `verify:worker` locks the rate limiter, so `verify:all` clears it between suites
The worker suite ends by deliberately tripping the login limiter; the admin suite then
could not log in and timed out on `.admin-bar`. A test-ordering artefact, not a product
bug, but it cost a confusing red run — `npm run login:reset` now sits between them.

---

## Decisions made — 2026-08-09 (iteration 10: passthrough for small files)

### Under 150KB, upload the source bytes UNTOUCHED
The user's point: there is no sense re-encoding a 52KB WebP. Correct — and the canvas API
has **no lossless WebP mode** (`quality: 1` is still lossy), so any re-encode is a strict
loss. Passthrough is the only way to lose nothing.

Stored once at `{id}/full.{format}` under its own extension, served with its true content
type; `passthrough` and `format` ride on the manifest row. The client emits **no srcset** —
one object means `src` alone is the whole story, and a one-entry srcset only creates a place
for a wrong `sizes` to matter.

Two honest caveats, recorded rather than hidden: the threshold is **bytes, not pixels** (a
flat 4000px PNG can sit under it and will be served full-size — transfer cost, which is what
the threshold measures, is unaffected), and **EXIF survives** a passthrough where the ladder
strips GPS and camera serials for free.

### It is a pre-checked CHECKBOX, not an automatic rule
Unchecking runs the ladder. That matters because a small file can still be worth
re-encoding — a 120KB PNG that would halve as WebP — and that stays the user's call. This is
**not** the global "skip compression" switch that was rejected in iteration 1: it is per
image, reversible, and its default is already right for the file in front of it.

### One checkbox, two meanings, and that is fine
Under the threshold it reads "No compression" (checked); above it, "High fidelity"
(unchecked). Both mean *compress this less*, so the direction is consistent and the row
never shows two competing controls.

### A passthrough row shows one number, not a before/after
Nothing was re-encoded, so a "−0%" saving would be theatre. It reports its size and the word
"untouched".

### The image-pipeline dials finally live in one params file
`src/admin/compressParams.ts`. CLAUDE.md has mandated this since iteration 1 and the
compression numbers had been sitting inline in the worker the whole time.

### FOURTH time a red test was the TEST's fault
The shrinkage assertion swept up the passthrough row, whose empty saving parses as `NaN`.
Asserting shrinkage over a file the feature exists to *not* shrink is asserting against the
feature. Now scoped to compressed rows. The running tally — `minRowHeight`, ">50% always",
the positional colour sample, and this — is the argument for reading a red test as a
question before touching the code.

---

## Decisions made — 2026-08-09 (iteration 11: full class names, no index badge)

### `medium` renamed to `tight`, in the code and the database — not just the button
"Medium" implied a size the class never controlled; "tight" says what it does — pack more
per row. Renaming only the label would have left the UI disagreeing with the data, which is
precisely the confusion `big` caused. Migration 0003 rebuilds the table (CHECK constraint
again). Unlike 0001 this one IS idempotent in shape, since `tight` does not match `medium`.

### The per-tile bar spells the classes out
`S W M` → `solo wide tight`. Three initials on a hover bar are a private code the user has
to memorise; the words cost about 60px and nothing else.

### The position number is gone
It sat at the end of the bar showing `2`, `3`, … The grid already shows you where an image
is, and the number could not be acted on — the arrows move things, not the digit. `index`
and `total` still reach the component, but only to disable the arrows at the two ends.

---

## Open issues

- **`MAX_ROW_HEIGHT_VH` (1.4) and the wide-screen `tight` fraction (1/4) are still taste
  dials** tuned against synthetic fixtures. `solo` is now exempt from the clamp, so the
  clamp only governs shared rows — its value matters less than it did. Record any verdict here.
- **A soft-deleted image has no UI to restore it once the undo toast has gone.** The row
  and its R2 objects survive for 30 days, so nothing is lost, but recovering one currently
  needs a SQL command. A "recently deleted" view is the obvious fix if it ever comes up.
- **Drag-to-reorder is unbuilt.** Arrows (icons and keys) work. The hard part is that a
  justified grid re-solves under the dragged item, so the drop indicator must be computed
  against the **pre-drag** layout.
- **Orphaned R2 objects are not reaped.** Metadata is written last on purpose, so orphans
  are the designed failure mode — invisible and cheap, versus a manifest row pointing at a
  missing image. Soft-deleted rows also keep their bytes so undo works. A sweep past the
  30-day window is a maintenance task, not a correctness one.
- **Nothing is deployed.** Needs a Cloudflare account, `wrangler d1 create justimages`, an
  R2 bucket, the real `database_id` in `wrangler.jsonc`, and two `wrangler secret put`
  calls. No domain chosen; `*.workers.dev` works until one is.
- **`.dev.vars` currently holds a throwaway local password** (`test-password-1234`) so the
  verification scripts can run. It is gitignored and never leaves the machine, but it is
  not a secret and must not be reused in production.
