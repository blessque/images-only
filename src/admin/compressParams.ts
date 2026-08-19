/**
 * EVERY tunable number for the image pipeline lives here.
 *
 * Same rule as `grid/gridParams.ts`: a byte budget or quality literal anywhere else is a
 * bug. See docs/architecture/IMAGE_PIPELINE.md.
 */

import { VARIANT_WIDTHS } from '@/lib/types';

/**
 * Below this, the source is uploaded UNTOUCHED — no ladder, no re-encode.
 *
 * Re-encoding an already-compressed 52KB WebP costs quality and buys nothing, and the
 * canvas API has no lossless WebP mode (`quality: 1` is still lossy), so passing the
 * original bytes through is the only way to lose nothing at all.
 *
 * Note this is a BYTE threshold, as specified. A small file can still be large in
 * dimensions — a flat 4000px PNG can sit under 150KB — and passthrough serves those at
 * full size. Transfer cost is unaffected (that is what the threshold measures); only
 * decode cost is, and lazy loading keeps that off the critical path. Unchecking the box
 * runs the normal ladder if a particular image wants it.
 */
export const PASSTHROUGH_MAX_BYTES = 150_000;

/** Byte budget per rung. The top rung is the de-facto master, so it gets more room. */
export function budgetFor(rung: number, highFidelity: boolean): number {
  const base = rung <= 400 ? 60_000 : rung <= 800 ? 180_000 : rung <= 1600 ? 500_000 : 900_000;
  return highFidelity ? base * 2 : base;
}

/**
 * Rung 3 is encoded HIGHER than the rest, deliberately: originals are not stored, so it is
 * the master any future re-encode would have to start from. Bought insurance — do not
 * normalise it. See IMAGE_PIPELINE.md.
 *
 * High fidelity raises the STARTING quality, not only the budget. Raising the budget alone
 * was tried and is a no-op for most photographs: the search only steps quality DOWN when a
 * file is over budget, so an image that already fit came out byte-identical and the
 * checkbox visibly did nothing.
 */
export function startingQuality(rung: number, highFidelity: boolean): number {
  const isTopRung = rung === VARIANT_WIDTHS[VARIANT_WIDTHS.length - 1];
  if (highFidelity) return isTopRung ? 0.97 : 0.95;
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
