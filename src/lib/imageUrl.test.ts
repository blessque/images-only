import { describe, expect, it } from 'vitest';
import { availableRungs, fallbackSrc, srcSetFor, variantPixelWidth } from './imageUrl';
import { VARIANT_WIDTHS, type ImageItem } from './types';

function item(over: Partial<ImageItem> = {}): ImageItem {
  return {
    id: 'a1b2c3d4e5f60718',
    aspect: 1.5,
    sizeClass: 'medium',
    alt: '',
    maxRung: 2400,
    passthrough: false,
    format: 'webp',
    ...over,
  };
}

/**
 * These exist because of a real bug that reached the browser: the encoder never upscales,
 * so a 1024px source stops at the 800 rung — but srcset advertised all four regardless.
 * The browser picked 2400 at DPR 2, got a 404, and the tile fell through to the
 * broken-image mark. Every source in the test suite happened to be larger than the top
 * rung, so nothing caught it.
 */
describe('srcset never advertises a variant that was not written', () => {
  it('offers the whole ladder when the source filled it', () => {
    expect(availableRungs(item({ maxRung: 2400 }))).toEqual([...VARIANT_WIDTHS]);
  });

  it('stops where the encoder stopped', () => {
    expect(availableRungs(item({ maxRung: 800 }))).toEqual([400, 800]);
    expect(availableRungs(item({ maxRung: 1600 }))).toEqual([400, 800, 1600]);
    expect(availableRungs(item({ maxRung: 400 }))).toEqual([400]);
  });

  it('never returns an empty set, even for a nonsensical maxRung', () => {
    expect(availableRungs(item({ maxRung: 0 }))).toEqual([400]);
    expect(availableRungs(item({ maxRung: -1 }))).toEqual([400]);
  });

  it('builds a srcset containing only those rungs', () => {
    const srcset = srcSetFor('/img', item({ maxRung: 800 }));
    expect(srcset).toContain('/img/a1b2c3d4e5f60718/400.webp');
    expect(srcset).toContain('/img/a1b2c3d4e5f60718/800.webp');
    expect(srcset).not.toContain('1600.webp');
    expect(srcset).not.toContain('2400.webp');
  });

  it('clamps the fallback src to a rung that exists', () => {
    expect(fallbackSrc('/img', item({ maxRung: 400 }))).toContain('/400.webp');
    expect(fallbackSrc('/img', item({ maxRung: 2400 }))).toContain('/800.webp');
  });
});

describe('passthrough images bypass the ladder entirely', () => {
  it('offers NO srcset — there is one object, so src alone is the whole story', () => {
    expect(srcSetFor('/img', item({ passthrough: true, format: 'webp' }))).toBeNull();
  });

  it('points src at the untouched original, under its own extension', () => {
    expect(fallbackSrc('/img', item({ passthrough: true, format: 'png' }))).toBe(
      '/img/a1b2c3d4e5f60718/full.png',
    );
    expect(fallbackSrc('/img', item({ passthrough: true, format: 'jpg' }))).toBe(
      '/img/a1b2c3d4e5f60718/full.jpg',
    );
  });
});

describe('srcset descriptors use the file’s real pixel width', () => {
  it('reports the rung itself for landscape', () => {
    expect(variantPixelWidth(1600, 1.5)).toBe(1600);
    expect(variantPixelWidth(800, 1)).toBe(800);
  });

  it('reports the SHORTER edge for portrait — rungs are long-edge sizes', () => {
    // A 9:16 image at rung 1600 is 900x1600. Claiming 1600w would make the browser
    // over-fetch for every portrait in the gallery, silently.
    expect(variantPixelWidth(1600, 9 / 16)).toBe(900);
    expect(variantPixelWidth(400, 2 / 3)).toBe(267);
  });

  it('puts the real width in the srcset descriptor', () => {
    expect(srcSetFor('/img', item({ aspect: 9 / 16, maxRung: 1600 }))).toContain('1600.webp 900w');
  });
});
