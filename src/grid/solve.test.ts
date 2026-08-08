import { describe, expect, it } from 'vitest';
import { solve, type SolveParams, type SolvedRow } from './solve';
import { fractionsFor } from './gridParams';
import type { ImageItem, SizeClass } from '@/lib/types';

// Real-world aspect ratios, so failures look like photographs rather than like fixtures.
const A = {
  panorama: 3,
  wide: 16 / 9,
  landscape: 3 / 2,
  classic: 4 / 3,
  square: 1,
  portrait: 3 / 4,
  tall: 2 / 3,
  phone: 9 / 16,
} as const;

let seq = 0;
function img(aspect: number, sizeClass: SizeClass = 'medium'): ImageItem {
  seq += 1;
  // maxRung is irrelevant to layout — the solver only ever reads aspect and sizeClass.
  return { id: `i${seq}`, aspect, sizeClass, alt: '', maxRung: 2400 };
}

function params(over: Partial<SolveParams> = {}): SolveParams {
  return {
    fractions: fractionsFor(1440),
    maxRowHeight: 1120,
    minRowHeight: 160,
    ...over,
  };
}

/** Every invariant the grid promises, asserted together. */
function expectInvariants(rows: SolvedRow[], containerWidth: number, p: SolveParams) {
  for (const row of rows) {
    // 1. FILLS EXACTLY — integer widths summing to the container, no gap, no overflow.
    const sum = row.images.reduce((acc, i) => acc + i.width, 0);
    expect(sum).toBe(containerWidth);

    for (const solved of row.images) {
      // 2. NEVER CROPS — the product's one hard promise. Rendered width must match
      //    height x intrinsic aspect to within the sub-pixel rounding budget (1px).
      const ideal = solved.height * solved.item.aspect;
      expect(Math.abs(solved.width - ideal)).toBeLessThanOrEqual(1);
      expect(solved.width).toBeGreaterThan(0);
      expect(solved.height).toBeGreaterThan(0);
    }

    // 3. HEIGHT CLAMP — non-final rows must sit inside the band. The final row is
    //    exempt by design: gap and crop are both hard-rule violations, so tall is the
    //    only option left.
    if (!row.isLast) {
      expect(row.height).toBeLessThanOrEqual(Math.ceil(p.maxRowHeight));

      // The floor is only reachable by REMOVING images, so it is not an absolute
      // guarantee — a lone panorama in a 320px container genuinely is 107px tall. The
      // real invariant is that the solver breaches the floor only when it provably
      // could not do better: a single-image row, or one where giving an image back
      // would breach the ceiling instead.
      if (row.height < Math.floor(p.minRowHeight) - 1) {
        const withoutLast = row.images.slice(0, -1);
        const sumAspect = withoutLast.reduce((acc, i) => acc + i.item.aspect, 0);
        const heightIfPopped = sumAspect > 0 ? containerWidth / sumAspect : Infinity;
        expect(row.images.length === 1 || heightIfPopped > p.maxRowHeight).toBe(true);
      }
    }
  }
}

function flatten(rows: SolvedRow[]): string[] {
  return rows.flatMap((r) => r.images.map((i) => i.item.id));
}

describe('solve — core invariants', () => {
  it('fills every row exactly and never crops', () => {
    const items = [
      img(A.landscape), img(A.tall), img(A.wide), img(A.square),
      img(A.classic), img(A.portrait), img(A.panorama), img(A.phone),
    ];
    const p = params();
    const rows = solve(items, 1440, p);

    expect(rows.length).toBeGreaterThan(0);
    expectInvariants(rows, 1440, p);
  });

  it('preserves every image exactly once, in order', () => {
    const items = Array.from({ length: 37 }, (_, n) =>
      img([A.landscape, A.tall, A.square, A.wide, A.portrait][n % 5] ?? A.square),
    );
    const rows = solve(items, 1440, params());

    expect(flatten(rows)).toEqual(items.map((i) => i.id));
  });

  it('holds all invariants across a full sweep of container widths', () => {
    const items = Array.from({ length: 60 }, (_, n) =>
      img(
        [A.panorama, A.wide, A.landscape, A.classic, A.square, A.portrait, A.tall, A.phone][n % 8] ??
          A.square,
        (['big', 'medium', 'small', 'medium'] as const)[n % 4] ?? 'medium',
      ),
    );

    // Every width from phone to ultrawide, in 7px steps — catches the off-by-one
    // classes of bug that only show up at a specific container width.
    for (let w = 320; w <= 2560; w += 7) {
      const p = params({ fractions: fractionsFor(w) });
      const rows = solve(items, w, p);
      expectInvariants(rows, w, p);
      expect(flatten(rows)).toEqual(items.map((i) => i.id));
    }
  });
});

describe('solve — size class controls density', () => {
  it('gives a big landscape image a row to itself on desktop', () => {
    const items = [img(A.landscape, 'big'), img(A.landscape, 'small'), img(A.landscape, 'small')];
    const rows = solve(items, 1440, params({ fractions: fractionsFor(1440) }));

    // This is the ONLY mechanism the grid has for hierarchy: within a row, equal heights
    // lock widths to aspect ratios, so "big" can only mean "alone".
    expect(rows[0]?.images).toHaveLength(1);
    expect(rows[0]?.images[0]?.item.sizeClass).toBe('big');
    expect(rows[0]?.images[0]?.width).toBe(1440);
  });

  it('pairs big images on wide screens', () => {
    const items = [img(A.landscape, 'big'), img(A.landscape, 'big')];
    const rows = solve(items, 2560, params({ fractions: fractionsFor(2560) }));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.images).toHaveLength(2);
  });

  it('puts exactly one image per row on mobile, whatever the class', () => {
    const items = [
      img(A.landscape, 'big'), img(A.tall, 'small'),
      img(A.square, 'medium'), img(A.wide, 'small'),
    ];
    const p = params({ fractions: fractionsFor(390), maxRowHeight: 10_000 });
    const rows = solve(items, 390, p);

    expect(rows).toHaveLength(4);
    for (const row of rows) expect(row.images).toHaveLength(1);
    expectInvariants(rows, 390, p);
  });
});

describe('solve — the height clamp works by membership, not by cropping', () => {
  it('pulls extra images into a row that would be too tall', () => {
    // A lone phone-aspect portrait at 1440 solves to 2560px. The clamp must recruit
    // neighbours rather than crop.
    const items = [img(A.phone), img(A.phone), img(A.phone), img(A.phone), img(A.phone)];
    const p = params({ maxRowHeight: 1120 });
    const rows = solve(items, 1440, p);

    expect(rows[0]?.images.length).toBeGreaterThan(1);
    expectInvariants(rows, 1440, p);
  });

  it('pushes an image out of a row that would be too short', () => {
    const items = Array.from({ length: 12 }, () => img(A.panorama, 'small'));
    const p = params({ minRowHeight: 200, maxRowHeight: 1120 });
    const rows = solve(items, 1440, p);

    for (const row of rows) {
      if (!row.isLast) expect(row.height).toBeGreaterThanOrEqual(199);
    }
    expectInvariants(rows, 1440, p);
  });
});

describe('solve — pathological input', () => {
  it('returns nothing for an empty list or a zero-width container', () => {
    expect(solve([], 1440, params())).toEqual([]);
    expect(solve([img(A.landscape)], 0, params())).toEqual([]);
  });

  it('fills the width with a single image and flags it overheight when absurd', () => {
    const p = params({ maxRowHeight: 1120 });
    const rows = solve([img(A.phone)], 1440, p);

    // 1440 / 0.5625 = 2560px tall. We do NOT crop and we do NOT leave a gap — the row
    // is simply tall, and `overheight` is what lets the admin UI warn about it.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.images[0]?.width).toBe(1440);
    expect(rows[0]?.overheight).toBe(true);
    expect(rows[0]?.isLast).toBe(true);
  });

  it('handles an all-portrait gallery', () => {
    const items = Array.from({ length: 20 }, () => img(A.tall));
    const p = params();
    expectInvariants(solve(items, 1440, p), 1440, p);
  });

  it('handles an all-panorama gallery', () => {
    const items = Array.from({ length: 20 }, () => img(A.panorama));
    const p = params();
    expectInvariants(solve(items, 1440, p), 1440, p);
  });

  it('is deterministic', () => {
    const items = Array.from({ length: 25 }, (_, n) => img(n % 2 ? A.tall : A.wide));
    const a = solve(items, 1337, params());
    const b = solve(items, 1337, params());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
