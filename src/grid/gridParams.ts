/**
 * EVERY tunable number for the grid lives here.
 *
 * A width, breakpoint or clamp literal anywhere else in the codebase is a bug — the
 * entire look is meant to be tuned by editing this one file. See docs/architecture/GRID.md.
 */

import type { SizeClass } from '@/lib/types';

export interface Breakpoint {
  /** Applies from this container width upward. */
  minWidth: number;
  /**
   * Target share of a row each class asks for.
   *
   * These control ROW DENSITY, not size. Within a row every image shares a height, so
   * widths are locked to aspect ratios — two same-aspect images render identically wide
   * whatever their class. Real hierarchy comes only from being ALONE in a row, which is
   * what `solo` is for; `solo` is handled by the solver directly, not by this fraction.
   */
  fractions: Record<SizeClass, number>;
}

export const BREAKPOINTS: readonly Breakpoint[] = [
  // Mobile is NOT a separate code path — it is this row collapsing everything to 1/1,
  // which produces the one-image-per-row feel the brief asked for.
  { minWidth: 0, fractions: { solo: 1, wide: 1, tight: 1 } },
  { minWidth: 641, fractions: { solo: 1, wide: 1, tight: 1 / 2 } },
  { minWidth: 1025, fractions: { solo: 1, wide: 1 / 2, tight: 1 / 3 } },
  // Past ~1800px images stop needing to grow and the gallery benefits from density, so
  // `tight` tightens further. `wide` stays at a half — that is the "two large images per row"
  // the brief asked for on a 2560 display.
  { minWidth: 1801, fractions: { solo: 1, wide: 1 / 2, tight: 1 / 4 } },
];

/**
 * Ceiling on row height, as a multiple of the viewport height.
 *
 * NOT 1.0, and the reason matters: a full-width 3:2 photo at 1440px is 960px tall —
 * slightly more than a laptop viewport, and perfectly fine to scroll. Clamping at 1.0
 * would pull a second image into every `big` row and so destroy the ONLY mechanism this
 * grid has for hierarchy (see the density note above). The clamp exists to stop rows that
 * are absurd — a full-width portrait solves to 2160px — not to fit every row on one screen.
 *
 * 1.4 admits a full-width landscape alone while still catching squares and portraits.
 *
 * TASTE DIAL — not yet tuned against real photographs.
 */
export const MAX_ROW_HEIGHT_VH = 1.4;

/** Floor before pushing an image back out of a row. Guards over-dense wide-screen rows. */
export const MIN_ROW_HEIGHT_PX = 160;

/**
 * Admin-only warning threshold for a too-tall final row. UI-only — it never changes
 * layout. See "the last row" in docs/architecture/GRID.md for why we warn instead of crop.
 */
export const LAST_ROW_WARN_FACTOR = 1.5;

/**
 * Backoff before a failed image is declared broken.
 *
 * Workers KV is EVENTUALLY CONSISTENT — up to ~60s worldwide — so a photograph published
 * seconds ago can genuinely 404 for its own uploader. Showing the broken-image mark then
 * would look exactly like the srcset bug of iteration 7, and be wrong.
 *
 * Also earns its keep on any backend: it covers ordinary transient network failure.
 */
export const IMAGE_RETRY_DELAYS_MS = [1000, 3000, 8000] as const;

export function fractionsFor(containerWidth: number): Record<SizeClass, number> {
  let chosen = BREAKPOINTS[0];
  for (const bp of BREAKPOINTS) {
    if (containerWidth >= bp.minWidth) chosen = bp;
  }
  // BREAKPOINTS is a non-empty literal, but noUncheckedIndexedAccess cannot know that.
  return chosen ? chosen.fractions : { solo: 1, wide: 1, tight: 1 };
}

export function maxRowHeightFor(viewportHeight: number): number {
  return viewportHeight * MAX_ROW_HEIGHT_VH;
}
