import { describe, expect, it } from 'vitest';
import type { VariantResult } from './compressWorker';
import { deliveredBytes, savedLabel, totalBytes } from './staging';

/**
 * What the tray prints is the only thing standing between him and a page he cannot see the
 * weight of, so the arithmetic behind it is worth pinning.
 *
 * The bug these cover: the "after" figure was the SUM of the whole ladder, compared against
 * one source file. A visitor downloads one rung, never four, so every honest compression
 * read as a 2–5x gain in weight. See docs/decisions/TUNING_LOG.md.
 */

const variant = (rung: number, size: number): VariantResult => ({
  rung,
  blob: new Blob([new Uint8Array(size)]),
  width: rung,
  height: rung,
});

describe('deliveredBytes', () => {
  it('is the largest rung — the most any one visitor can be asked to download', () => {
    const ladder = [variant(400, 15_000), variant(800, 45_000), variant(1600, 170_000), variant(2400, 577_000)];
    expect(deliveredBytes(ladder)).toBe(577_000);
    expect(totalBytes(ladder)).toBe(807_000);
  });

  it('reads the rung, not the byte count, so a freak small top rung still wins', () => {
    // Flat images occasionally encode smaller at 2400 than at 1600. The largest rung is
    // still the one srcset offers a retina screen, so it is still what he pays.
    expect(deliveredBytes([variant(1600, 90_000), variant(2400, 80_000)])).toBe(80_000);
  });

  it('handles a short ladder from a small source', () => {
    expect(deliveredBytes([variant(400, 9_000), variant(800, 25_000)])).toBe(25_000);
  });

  it('handles the single object of a passthrough, and an empty ladder', () => {
    expect(deliveredBytes([variant(0, 52_000)])).toBe(52_000);
    expect(deliveredBytes([])).toBe(0);
  });
});

describe('savedLabel', () => {
  it('signs a saving and a growth differently', () => {
    // The old label hardcoded the minus in the markup, so a growth rendered as '−-548%'.
    expect(savedLabel(1_000_000, 500_000)).toBe('−50%');
    expect(savedLabel(1_000_000, 1_200_000)).toBe('+20%');
  });

  it('says nothing was gained rather than picking a sign', () => {
    expect(savedLabel(1_000, 1_000)).toBe('0%');
  });

  it('is silent when there is nothing to compare', () => {
    expect(savedLabel(0, 500)).toBe('');
    expect(savedLabel(500, 0)).toBe('');
  });
});
