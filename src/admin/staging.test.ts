import { describe, expect, it } from 'vitest';
import type { PassthroughReason, VariantResult } from './compressWorker';
import {
  canKeepOriginal,
  deliveredBytes,
  keepOriginalByDefault,
  originalTitle,
  savedLabel,
  totalBytes,
  untouchedLabel,
  type StagedFile,
} from './staging';

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

function sourceFile(name: string, type: string, bytes: number): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

/**
 * "No compression" is the whole lossless escape hatch: checked, not a pixel changes, and the
 * colour profile, the EXIF and any transparency survive. It is offered at EVERY size — the
 * 150KB threshold decides only where the box starts.
 */
describe('keeping the original', () => {
  it('is offered for a 5MB file, not only a small one', () => {
    expect(canKeepOriginal(sourceFile('big.jpg', 'image/jpeg', 5_000_000))).toBe(true);
    expect(keepOriginalByDefault(sourceFile('big.jpg', 'image/jpeg', 5_000_000))).toBe(false);
  });

  it('starts checked under the threshold, where re-encoding costs quality and buys nothing', () => {
    expect(keepOriginalByDefault(sourceFile('small.webp', 'image/webp', 100_000))).toBe(true);
    expect(keepOriginalByDefault(sourceFile('edge.webp', 'image/webp', 150_000))).toBe(false);
  });

  it('is impossible for a format no browser renders, at any size', () => {
    // A TIFF uploads happily and then cannot be displayed by anything. Storing it untouched
    // would put an image in the gallery that the gallery can never show.
    expect(canKeepOriginal(sourceFile('scan.tiff', 'image/tiff', 20_000))).toBe(false);
    expect(keepOriginalByDefault(sourceFile('scan.tiff', 'image/tiff', 20_000))).toBe(false);
  });
});

function staged(over: Partial<StagedFile> = {}): StagedFile {
  return {
    jobId: 'j1',
    file: sourceFile('a.jpg', 'image/jpeg', 900_000),
    status: 'ready',
    rung: null,
    aspect: 1,
    sizeClass: 'tight',
    alt: '',
    noCompression: false,
    passthroughReason: null,
    format: 'jpg',
    variants: [],
    sourceBytes: 900_000,
    compressedBytes: 0,
    previewUrl: 'blob:x',
    ...over,
  };
}

describe('saying WHO decided not to compress', () => {
  it('explains a passthrough he did not choose', () => {
    // An unexplained "untouched" on a 4MB photograph looks exactly like compression having
    // silently failed — which, for one iteration, is precisely what it was.
    const reasons: Array<[PassthroughReason | null, string]> = [
      [null, 'untouched'],
      ['chosen', 'untouched'],
      ['larger', 'untouched — already smaller'],
      ['no-encoder', 'untouched — cannot compress here'],
    ];
    for (const [reason, label] of reasons) {
      expect(untouchedLabel(staged({ passthroughReason: reason }))).toBe(label);
    }
  });

  it('gives a disabled checkbox a cause, both ways round', () => {
    expect(originalTitle(staged(), true)).toContain('untouched');
    expect(originalTitle(staged(), false)).toContain('cannot make WebP');
    expect(originalTitle(staged({ file: sourceFile('s.tiff', 'image/tiff', 10) }), true)).toContain(
      'has to be converted',
    );
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
