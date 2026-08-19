/**
 * EVERY tunable number for the image pipeline lives here.
 *
 * Same rule as `grid/gridParams.ts`: a byte budget or quality literal anywhere else is a
 * bug. See docs/architecture/IMAGE_PIPELINE.md.
 */

import { VARIANT_WIDTHS } from '@/lib/types';

/**
 * Below this the "No compression" box starts CHECKED — the source is uploaded untouched.
 *
 * Re-encoding an already-compressed 52KB WebP costs quality and buys nothing, and the
 * canvas API has no lossless WebP mode (`quality: 1` is still lossy), so passing the
 * original bytes through is the only way to lose nothing at all.
 *
 * This decides the DEFAULT only. The box is on every row, at every size, so a 5MB original
 * can be kept untouched by choice — that is the lossless escape hatch, and it is always
 * available. Note it is a BYTE threshold, as specified: a small file can still be large in
 * dimensions (a flat 4000px PNG can sit under 150KB), and that is fine — transfer cost is
 * what the threshold measures, and lazy loading keeps decode cost off the critical path.
 */
export const PASSTHROUGH_MAX_BYTES = 150_000;

/** Byte budget per rung. The top rung is the de-facto master, so it gets more room. */
export function budgetFor(rung: number): number {
  return rung <= 400 ? 60_000 : rung <= 800 ? 180_000 : rung <= 1600 ? 500_000 : 900_000;
}

/**
 * The top rung is encoded HIGHER than the rest, deliberately: originals are not stored, so
 * it is the master any future re-encode would have to start from. Bought insurance — do not
 * normalise it. See IMAGE_PIPELINE.md.
 *
 * There is no longer a "high fidelity" variant of these numbers. It was the per-image
 * quality lever, and "No compression" replaced it by being the complete version of the same
 * idea: the original, untouched, at any size. See docs/decisions/TUNING_LOG.md.
 */
export function startingQuality(rung: number): number {
  const isTopRung = rung === VARIANT_WIDTHS[VARIANT_WIDTHS.length - 1];
  return isTopRung ? 0.92 : 0.86;
}

/**
 * Below this WebP shows visible blocking. Shipping a visibly damaged photograph to hit a
 * byte target is the wrong trade on a site whose entire content is photographs — a file
 * that cannot make budget at this quality goes over budget instead.
 */
export const QUALITY_FLOOR = 0.62;

/** How far the quality search steps down per attempt. */
export const QUALITY_STEP = 0.06;

/**
 * Size of the throwaway canvas the encoder is probed with, before any real work.
 *
 * Big enough that a quality setting has something to act on — a 1x1 canvas encodes to the
 * same handful of header bytes at every quality, which would make the probe answer "quality
 * does nothing" for a perfectly good encoder.
 */
export const PROBE_SIZE = 128;

/**
 * How much smaller a low-quality encode must be before we believe the quality knob works.
 *
 * `quality: 0.2` on noise should land far under `quality: 0.9`. An encoder that returns the
 * same bytes for both is ignoring the parameter, and every byte budget downstream is then a
 * wish. 0.9 is deliberately generous: this is a smoke test, not a benchmark.
 */
export const PROBE_QUALITY_RATIO = 0.9;

/**
 * How much of an encoded file to read back when looking for its lossless alpha plane.
 *
 * `ALPH` sits ahead of the image data — after `VP8X` (18 bytes) and any colour profile
 * (~528) — so a few KB always covers it, and reading the head instead of the whole blob
 * keeps the budget check off the wrong side of a megabyte-sized copy per attempt.
 */
export const ALPHA_HEAD_BYTES = 4096;

/**
 * Workers KV's free-tier write budget, per UTC day.
 *
 * Each variant is one write, so 200 photographs at four rungs is 800 — a full first upload
 * fits inside a single day, but only just. A larger batch would fail part way through with
 * no explanation, so the tray warns before publishing. It does not block: it is his call,
 * and splitting across two days costs nothing.
 */
export const DAILY_WRITE_BUDGET = 1000;

/** Formats we will pass through untouched, mapped to the extension used in storage keys. */
export const PASSTHROUGH_FORMATS: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/avif': 'avif',
  'image/gif': 'gif',
};

export function formatFor(file: File): string | null {
  const byType = PASSTHROUGH_FORMATS[file.type];
  if (byType) return byType;
  const extension = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase();
  if (!extension) return null;
  const normalised = extension === 'jpeg' ? 'jpg' : extension === 'tif' ? 'tiff' : extension;
  return Object.values(PASSTHROUGH_FORMATS).includes(normalised) ? normalised : null;
}
