import { VARIANT_WIDTHS } from './types';
import type { ImageItem } from './types';

/** Production is served by the Worker from R2; development from generated fixtures. */
export const PRODUCTION_BASE = '/img';
export const FIXTURE_BASE = '/fixtures';

export function variantUrl(base: string, id: string, rung: number): string {
  return `${base}/${id}/${rung}.webp`;
}

/**
 * The real pixel width of a rung, which is NOT the rung number for portraits.
 *
 * Rungs are LONG-EDGE sizes, so a 9:16 image at rung 1600 is 900x1600 — its width is 900.
 * `srcset`'s `w` descriptor must be the file's actual width or the browser's variant
 * selection is wrong for every portrait in the gallery, silently and in the expensive
 * direction (it over-fetches).
 */
export function variantPixelWidth(rung: number, aspect: number): number {
  return aspect >= 1 ? rung : Math.max(1, Math.round(rung * aspect));
}

/**
 * Rungs that actually exist for this image.
 *
 * The encoder never upscales, so a 1024px source stops at the 800 rung. Advertising 1600
 * or 2400 anyway makes the browser fetch a key that was never written — a 404, and the
 * tile falls through to the broken-image mark. Emitted rungs are a prefix of the ladder,
 * so `maxRung` describes the whole set.
 */
export function availableRungs(item: ImageItem): number[] {
  const rungs = VARIANT_WIDTHS.filter((rung) => rung <= item.maxRung);
  // Rung 0 is always emitted, even for a source smaller than it — never return nothing.
  return rungs.length > 0 ? rungs : [VARIANT_WIDTHS[0] ?? 400];
}

export function srcSetFor(base: string, item: ImageItem): string {
  return availableRungs(item)
    .map((rung) => `${variantUrl(base, item.id, rung)} ${variantPixelWidth(rung, item.aspect)}w`)
    .join(', ');
}

/** Fallback for browsers ignoring srcset — the middle rung, clamped to what exists. */
export function fallbackSrc(base: string, item: ImageItem): string {
  const rungs = availableRungs(item);
  return variantUrl(base, item.id, rungs[1] ?? rungs[0] ?? 400);
}
