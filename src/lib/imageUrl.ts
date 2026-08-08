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

export function srcSetFor(base: string, item: ImageItem): string {
  return VARIANT_WIDTHS.map(
    (rung) => `${variantUrl(base, item.id, rung)} ${variantPixelWidth(rung, item.aspect)}w`,
  ).join(', ');
}

/** Fallback for browsers ignoring srcset — the middle rung, never the largest. */
export function fallbackSrc(base: string, item: ImageItem): string {
  return variantUrl(base, item.id, VARIANT_WIDTHS[1] ?? 800);
}
