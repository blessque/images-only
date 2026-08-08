# The Grid

## The four constraints

From the brief, all four are hard:

1. Every image at its **true aspect ratio** — never cropped.
2. **No gaps** — no margins, padding, or white space anywhere.
3. Rows **always fill** the viewport width.
4. Row height is **flexible**, so the full image is seen.

These are simultaneously satisfiable by exactly one family of algorithms: **justified rows**.

### Why there is no choice here

Scale a row of images to a common height `H`. Image `i` with aspect `aᵢ = wᵢ/hᵢ` then has
width `H·aᵢ`, so the row's total width is `H·Σaᵢ`. To fill a container of width `W` exactly:

```
H · Σaᵢ = W        →        H = W / Σaᵢ
```

One division. That single line is the whole algorithm, and it is *why* rows fill exactly
without cropping: we are solving for the one free variable (height) instead of forcing
widths onto images that do not have those proportions.

A-paper formats (A0 = 2×A1 = 4×A2) were the user's early illustration of *nesting*, and are
**not** a spec. The A-series has a fixed √2 aspect ratio — which is precisely the thing that
cannot coexist with constraint 1. Confirmed with the user: drop A-formats entirely.

---

## The consequence nobody expects

**Within a single row, the size class does not control relative size. Aspect ratio does.**

Two images in the same row share a height, so their widths are locked to their aspect
ratios. A "Big" 3:2 photo and a "Small" 3:2 photo sitting in the same row will render at
*identical* widths — there is no way around this that does not involve cropping or gaps.

This is not a defect in the algorithm; it is what "never crop" costs.

So the size class means one thing only: **how many images share the row.** Hierarchy is
produced by density, not by scaling. A Big image is big because it is *alone* in its row.

The breakpoint table is built around that:

| Breakpoint | Big | Medium | Small |
|---|---|---|---|
| ≤ 640 (mobile) | 1/1 | 1/1 | 1/1 |
| 641 – 1024 | 1/1 | 1/2 | 1/2 |
| 1025 – 1800 | **1/1** | 1/2 | 1/3 |
| ≥ 1801 (wide) | **1/2** | 1/3 | 1/4 |

Big is `1/1` on normal desktop — it takes a whole row, which is the only way it reads as
genuinely big. On wide screens it drops to `1/2` so two large images share a row, which is
exactly the user's own instinct for 2560px displays: past a certain width a single image
becomes a billboard, not a portfolio plate.

Mobile is **not a separate code path** — every class collapses to `1/1` in the table, which
produces the one-image-per-row Instagram feel the user asked for. If mobile ever needs
different behaviour, that behaviour belongs in the table, not in a branch.

**Future option, deliberately not built:** true size hierarchy *within* a row is achievable
by nesting — one tall image beside a vertical stack of two shorter ones, magazine-style.
It preserves no-crop and no-gaps, but requires nested height reconciliation. Revisit only
if density-based hierarchy proves insufficient in real use.

---

## The algorithm

```
1. PACK      Append images to the current row, accumulating target fractions fᵢ.
             Close the row when Σf ≥ 1.
             Overshoot rule: if adding the next image lands Σf further from 1 than
             closing now does, close now. (A Big image never gets dragged into a
             row that is already 3/4 full.)

2. SOLVE     H = W / Σaᵢ  ; each image's width = H · aᵢ

3. FIT       If H > MAX_ROW_HEIGHT: pull the next image into the row and re-solve.
             More images ⇒ larger Σaᵢ ⇒ smaller H.
             If H < MIN_ROW_HEIGHT: push the last image to the next row and re-solve.

             This is the elegant part — the height clamp is satisfied by changing row
             MEMBERSHIP, not by cropping or by letterboxing. Both bounds are reachable
             without ever violating constraint 1.

4. LAST ROW  Fills the width like any other row, whatever height results.
```

### Why the last row is handled that way

The usual justified-gallery bug is an incomplete final row: one image left over solves to an
enormous height. The three available responses are (a) leave the remaining width empty,
(b) crop to fit, (c) let it be tall.

(a) violates "no gaps" and (b) violates "never crop" — both are hard constraints. So (c),
and it is genuinely fine: the user controls image count and order, and a single trailing
3:2 photo at 1440px wide solves to 960px tall, which is large but not absurd. A trailing
*portrait* is the bad case (2:3 solves to 2160px), so **the admin UI should warn when the
last row would exceed ~1.5× `MAX_ROW_HEIGHT`** and suggest adding or reordering an image.

Solve the problem where the user can actually see it, rather than silently degrading the
one promise the site makes.

---

## Dials

All in `src/grid/gridParams.ts`. **A width, breakpoint or clamp literal anywhere else is a
bug** — the entire look is meant to be tuned by editing one file.

| Dial | Purpose | Notes |
|---|---|---|
| `BREAKPOINTS` | the table above | class → target width fraction, per breakpoint |
| `MAX_ROW_HEIGHT` | ceiling before pulling in another image | guards rows of portraits |
| `MIN_ROW_HEIGHT` | floor before pushing one out | guards over-dense rows on wide screens |
| `LAST_ROW_WARN_FACTOR` | admin warning threshold | ~1.5; UI-only, never changes layout |

`MAX_ROW_HEIGHT` and the wide-screen Big fraction are the two taste dials. Tune by eye,
record the verdict in `docs/decisions/TUNING_LOG.md`.

---

## Zero layout shift, by construction

Every aspect ratio arrives in the manifest, which the Worker inlines into the HTML. So the
complete geometry is solvable **before a single image byte is fetched**. Cells are sized
first; images arrive into boxes that already exist.

**CLS is 0 by construction, and it is asserted in the e2e test — not hoped for.** Anything
that measures a loaded `<img>` to decide layout has silently reintroduced layout shift and
is a bug regardless of how it looks locally on a fast connection.

The same fact gives a second win: because the solver knows each image's exact rendered CSS
width, `sizes` is set to that measured value rather than a guessed media query. A guessed
`sizes` is the standard way responsive images silently download the wrong variant.

## Resize

Re-solve on a debounced `ResizeObserver` (the container, not `window` — a scrollbar
appearing changes one and not the other). The solver is pure and fast: 200 items is a single
greedy pass, well under a millisecond. No virtualisation, no memo gymnastics needed.

## Testing

`solve.ts` is pure, DOM-free, and takes `(items, containerWidth, params)`. That is what
makes the invariants testable without a browser:

- every row's summed width equals `W` within 0.5px (fills exactly)
- every image's rendered `w/h` equals its intrinsic `w/h` within float tolerance (**never crops**)
- every non-final row's height lies within `[MIN_ROW_HEIGHT, MAX_ROW_HEIGHT]`
- pathological fixtures: all-portrait, all-panorama, a single image, one trailing image
- monotonic under resize — no row count oscillation across a 1px container change
