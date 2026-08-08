/**
 * The justified-row solver.
 *
 * PURE and DOM-FREE, deliberately: it takes (items, containerWidth, params) and returns
 * solved rows. That is what makes the two invariants — "never crops" and "always fills" —
 * testable across pathological inputs without a browser. A single getBoundingClientRect
 * in this file destroys that. See docs/architecture/GRID.md.
 */

import type { ImageItem, SizeClass } from '@/lib/types';

export interface SolveParams {
  fractions: Record<SizeClass, number>;
  maxRowHeight: number;
  minRowHeight: number;
}

export interface SolvedImage {
  item: ImageItem;
  width: number;
  height: number;
}

export interface SolvedRow {
  images: SolvedImage[];
  height: number;
  isLast: boolean;
  /** True when the row had to exceed maxRowHeight — only reachable on the final row. */
  overheight: boolean;
}

/**
 * Scale a set of images to one common height so their widths sum to exactly `width`.
 *
 *   H · Σaᵢ = W   →   H = W / Σaᵢ
 *
 * Solving for height — the one free variable — is why rows fill exactly without forcing
 * widths onto images that do not have those proportions.
 */
function rowHeight(items: readonly ImageItem[], width: number): number {
  let sumAspect = 0;
  for (const item of items) sumAspect += item.aspect;
  return sumAspect > 0 ? width / sumAspect : 0;
}

/**
 * Assign integer pixel widths that sum to exactly `containerWidth`.
 *
 * The height stays FRACTIONAL, deliberately. Rounding it to an integer first was tried and
 * is wrong: it shifts Σ(H·aᵢ) off `containerWidth` by up to 0.5·Σa — nearly 5px for a row
 * of panoramas — and redistributing that much forces some widths to move by 2px, which
 * breaks the one-pixel budget the "never crops" guarantee rests on. Keeping H exact makes
 * Σ(exact) == W identically, so the remainder is bounded by the image count and each width
 * moves by AT MOST ONE PIXEL.
 *
 * Fractional row heights are safe: rows stack in normal flow, so adjacent rows abut
 * exactly and no seam is possible. Only the horizontal neighbours inside a row needed
 * integer widths.
 *
 * This sub-pixel rounding is the ONLY place the system deviates from an image's true
 * aspect ratio, and it is unavoidable: Σ(round(H·aᵢ)) == W generally has no exact
 * solution. The tile absorbs it with object-fit, imperceptibly.
 */
function layoutRow(
  items: readonly ImageItem[],
  containerWidth: number,
  height: number,
  isLast: boolean,
  maxRowHeight: number,
): SolvedRow {
  const exact = items.map((item) => item.aspect * height);
  const widths = exact.map((w) => Math.max(1, Math.floor(w)));

  let assigned = 0;
  for (const w of widths) assigned += w;
  let remainder = containerWidth - assigned;

  // Largest fractional part first: those are the widths that were rounded down hardest.
  const byFraction = exact
    .map((w, index) => ({ index, frac: w - Math.floor(w) }))
    .sort((a, b) => b.frac - a.frac);

  // ONE pixel per image, at most — that cap is what keeps every box within 1px of true.
  for (let k = 0; k < byFraction.length && remainder > 0; k++) {
    const target = byFraction[k];
    if (!target) break;
    widths[target.index] = (widths[target.index] ?? 1) + 1;
    remainder -= 1;
  }
  // Only reachable when the `max(1, …)` floor bumped a sub-pixel image up; take those
  // pixels back from the least-rounded widths, never below 1px.
  for (let k = byFraction.length - 1; k >= 0 && remainder < 0; k--) {
    const target = byFraction[k];
    if (!target) break;
    const current = widths[target.index] ?? 1;
    if (current > 1) {
      widths[target.index] = current - 1;
      remainder += 1;
    }
  }

  return {
    images: items.map((item, index) => ({
      item,
      width: widths[index] ?? 1,
      height,
    })),
    height,
    isLast,
    overheight: height > maxRowHeight,
  };
}

export function solve(
  items: readonly ImageItem[],
  containerWidth: number,
  params: SolveParams,
): SolvedRow[] {
  if (items.length === 0 || containerWidth <= 0) return [];

  const rows: SolvedRow[] = [];
  let i = 0;

  while (i < items.length) {
    const first = items[i];
    if (!first) break;

    // ── SOLO ────────────────────────────────────────────────────────────────
    // A solo image takes the whole row on its own, at whatever height its aspect ratio
    // produces, and is EXEMPT from the height clamp.
    //
    // The exemption is the whole point. Without it the clamp recruits a neighbour for any
    // solo image taller than the ceiling — and then equal heights lock widths to aspect
    // ratios, so a "prominent" portrait renders NARROWER than the wide photo beside it.
    // That is exactly what the old `big` class did, and why it was replaced.
    //
    // Unlike the last-row case, being tall here is an explicit choice the user made on
    // this specific photograph, not a silent degradation — so it is honoured literally.
    if (first.sizeClass === 'solo') {
      i += 1;
      rows.push(
        layoutRow(
          [first],
          containerWidth,
          rowHeight([first], containerWidth),
          i >= items.length,
          Infinity, // never flagged overheight: tall is what was asked for
        ),
      );
      continue;
    }

    const row: ImageItem[] = [];
    let sumFraction = 0;

    // ── PACK ────────────────────────────────────────────────────────────────
    // Always take at least one image, then keep adding while doing so lands the row
    // CLOSER to full. That single rule also subsumes "stop at Σf ≥ 1": once the sum
    // reaches 1, adding anything can only increase the distance. It is what stops a
    // `wide` image being dragged into a row that is already three-quarters full.
    while (i < items.length) {
      const item = items[i];
      if (!item) break;
      // A solo image never joins a row in progress — it starts the next one.
      if (item.sizeClass === 'solo') break;

      const fraction = params.fractions[item.sizeClass];
      if (row.length > 0) {
        const distanceIfClosed = Math.abs(1 - sumFraction);
        const distanceIfAdded = Math.abs(1 - (sumFraction + fraction));
        if (distanceIfClosed < distanceIfAdded) break;
      }

      row.push(item);
      sumFraction += fraction;
      i += 1;
    }

    // ── FIT ─────────────────────────────────────────────────────────────────
    // The height clamp is satisfied by changing row MEMBERSHIP, never by cropping or
    // letterboxing. More images ⇒ larger Σa ⇒ smaller H, and vice versa. Both bounds
    // are reachable without ever touching an aspect ratio.
    let height = rowHeight(row, containerWidth);

    while (height > params.maxRowHeight && i < items.length) {
      const next = items[i];
      // Never conscript a solo image to fix another row's height — it must start its own.
      if (!next || next.sizeClass === 'solo') break;
      row.push(next);
      i += 1;
      height = rowHeight(row, containerWidth);
    }

    while (height < params.minRowHeight && row.length > 1) {
      const last = row[row.length - 1];
      if (!last) break;
      row.pop();
      const candidate = rowHeight(row, containerWidth);
      // Giving an image back must not overshoot the other bound; if it would, the row
      // is simply between a rock and a hard place and we keep the denser arrangement.
      if (candidate > params.maxRowHeight) {
        row.push(last);
        break;
      }
      i -= 1;
      height = candidate;
    }

    // The final row fills the width like any other, whatever height results. Leaving a
    // gap and cropping are both hard-rule violations, so being tall is the only option
    // left — and `overheight` lets the admin UI warn where the user can actually see it.
    rows.push(
      layoutRow(row, containerWidth, height, i >= items.length, params.maxRowHeight),
    );
  }

  return rows;
}
