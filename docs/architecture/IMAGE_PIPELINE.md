# Image Pipeline

## Where compression happens, and why there

**In the browser, in a Web Worker, before upload.**

```
File (10MB JPEG)
  → createImageBitmap()          decode off the main thread
  → OffscreenCanvas (resized)    one canvas per rung
  → convertToBlob('image/webp')  native encoder, no dependency
  → 4 blobs (~600KB total)       uploaded to R2
```

Two reasons, both load-bearing:

1. **Upload speed.** A 10MB file becomes ~600KB before it leaves his Mac — a ~16× faster
   upload on home wifi. Twenty photos is the difference between a coffee break and a
   moment. Compressing server-side means uploading the full 200MB first, which is the slow
   part of the whole flow.
2. **The main thread never blocks.** Decoding twenty 10MB images on the main thread freezes
   the page. A Worker keeps the UI responsive and the progress bars honest.

### About ffmpeg

The user asked whether we can use ffmpeg. **No, and it would not help.**

ffmpeg is a CLI binary — it does not run in a browser. (`ffmpeg.wasm` exists, at ~30MB of
payload and a large speed penalty, to do worse what the browser already does natively.)
More importantly it is the wrong tool for stills: the dominant quality-per-byte win here is
**not shipping 6000px into an 800px cell**, and that is a resize decision, not an encoder
decision. Browsers ship a perfectly good WebP encoder.

ffmpeg stays installed on the dev machine (v8.0) for one-off batch work. That is its role.

---

## Resize first, quality second

This is the rule that most compression work gets backwards.

A 6000px photo displayed in an 800px cell is wasting ~93% of its pixels. Halving the
quality to hit a size budget visibly destroys the image; halving the *dimensions* to a size
the screen can actually show is invisible. So:

**Emit a responsive ladder at high quality, rather than one large file at low quality.**

| Rung | Long edge | Quality | Role |
|---|---|---|---|
| 0 | 400px | ~0.86 | small cells, dense wide-screen rows |
| 1 | 800px | ~0.86 | typical medium cell |
| 2 | 1600px | ~0.86 | large cell, or medium at DPR 2 |
| 3 | 2400px | **~0.92** | wide-screen Big at DPR 2 — **and the de-facto master** |

Served via `srcset`, with `sizes` set to the grid's exact computed CSS width (see
[GRID.md](GRID.md)). A small cell then fetches ~50KB instead of ~700KB — a far larger win
than lazy loading, and vastly larger than any bundle-size decision.

The per-image size budget is met by a **short quality search** (encode, measure, step down,
re-encode), not a fixed magic number: a flat photo and a densely-textured one need different
quality to hit the same bytes, and a fixed number over-compresses one and wastes bytes on
the other.

---

## ONE-WAY DOOR: originals are not stored

The user decided against retaining originals — he keeps masters on his own machine, which is
reasonable for a designer and saves ~90% of storage.

The consequence must be understood before anyone changes this pipeline:

> **The 2400px rung IS the master.** If the pipeline changes later, we cannot regenerate
> from source. Re-encoding a variant is lossy-on-lossy.

Mitigation, and the reason for the asymmetry in the table above: **rung 3 is encoded at
~0.92 while the others sit at ~0.86**, specifically so it survives as a practical master.
This is bought insurance. Do not "optimise" it down for consistency — the inconsistency is
the point, and this paragraph is why.

---

## Colour management is a correctness issue

A canvas re-encode **drops ICC and EXIF**. A Display-P3 photo pushed through an untagged
canvas comes out with visibly shifted hue — reds go dull, saturated blues go flat.

This is a graphic designer's portfolio. He will see it immediately, and he will be right.

- Set the canvas context colour space explicitly rather than accepting the default.
- Tag the WebP output so browsers interpret it correctly.
- **Verification is a round-trip test**, not an eyeball: push a known Display-P3 test image
  through the pipeline and assert no measurable hue shift. Eyeballing a colour shift on the
  same monitor that caused it is not a test.

Also dropped by the re-encode, and this is *wanted*: GPS coordinates and camera serial
numbers. Stripping EXIF is a privacy win we get for free.

---

## No global "skip compression" toggle

The user floated offering a compress / don't-compress choice. **Deliberately not built.**

A non-technical user faced with a compression toggle turns it off "to be safe", and the site
becomes a 200MB page — defeating the requirement he himself ranked first. The toggle looks
like control and functions as a footgun.

What is built instead:

- **Honest before/after byte counts and a side-by-side preview at upload**, so he can
  verify with his own eyes that nothing was lost. Trust earned by evidence, not by a switch.
- **A per-image "high fidelity" escape hatch** that raises that one image's budget, for the
  rare photo with fine grain or a subtle gradient that genuinely suffers.

Local, reversible, per-image — not global and permanent.

---

## Storage layout and immutability

```
r2://{id}/400.webp
r2://{id}/800.webp
r2://{id}/1600.webp
r2://{id}/2400.webp
```

**Keys are immutable and are never overwritten.** "Replace image" mints a **new id** and
deletes the old object afterwards.

This is what makes `Cache-Control: public, max-age=31536000, immutable` safe. The inverse —
overwriting an object that is already cached under an immutable header — produces a stale
image on an unknown number of client caches that **no purge can reach**. Never overwrite an
R2 object.

## Upload sequence

1. Worker decodes + encodes the ladder, reporting progress per file
2. Client requests short-lived presigned PUTs (auth checked server-side)
3. Rungs upload in parallel
4. Only once every rung lands: `POST /api/images` writes the D1 row

Metadata is written **last**, so a failed or abandoned upload leaves orphaned R2 objects
rather than a manifest row pointing at a missing image. Orphans are invisible and cheap;
a broken row is visible on the site. A periodic sweep can reap orphans later — that is a
maintenance task, not a correctness one.
