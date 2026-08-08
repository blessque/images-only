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
   * Target share of a row each size class wants.
   *
   * These control ROW DENSITY, not size. Within a row every image shares a height, so
   * widths are locked to aspect ratios — two same-aspect images render identically wide
   * regardless of class. Hierarchy comes from being ALONE in a row, which is why `big`
   * is 1/1 on desktop.
   */
  fractions: Record<SizeClass, number>;
}

export const BREAKPOINTS: readonly Breakpoint[] = [
  // Mobile is NOT a separate code path — it is this row collapsing every class to 1/1,
  // which produces the one-image-per-row feel the brief asked for.
  { minWidth: 0, fractions: { big: 1, medium: 1, small: 1 } },
  { minWidth: 641, fractions: { big: 1, medium: 1 / 2, small: 1 / 2 } },
  { minWidth: 1025, fractions: { big: 1, medium: 1 / 2, small: 1 / 3 } },
  // Wide: `big` drops to 1/2 so two large images share a row. Past ~1800px a single
  // full-width image stops being a portfolio plate and becomes a billboard.
  { minWidth: 1801, fractions: { big: 1 / 2, medium: 1 / 3, small: 1 / 4 } },
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

export function fractionsFor(containerWidth: number): Record<SizeClass, number> {
  let chosen = BREAKPOINTS[0];
  for (const bp of BREAKPOINTS) {
    if (containerWidth >= bp.minWidth) chosen = bp;
  }
  // BREAKPOINTS is a non-empty literal, but noUncheckedIndexedAccess cannot know that.
  return chosen ? chosen.fractions : { big: 1, medium: 1, small: 1 };
}

export function maxRowHeightFor(viewportHeight: number): number {
  return viewportHeight * MAX_ROW_HEIGHT_VH;
}
