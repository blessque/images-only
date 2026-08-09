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
  // Only aspect and sizeClass matter to the solver; the rest is delivery metadata.
  return {
    id: `i${seq}`,
    aspect,
    sizeClass,
    alt: '',
    maxRung: 2400,
    passthrough: false,
    format: 'webp',
  };
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
  for (const [rowIndex, row] of rows.entries()) {
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

    // 3. HEIGHT CLAMP — non-final rows must sit inside the band. Two exemptions, both
    //    deliberate: the FINAL row (gap and crop are hard-rule violations, so tall is the
    //    only option left), and any SOLO row — being tall is precisely what solo means,
    //    and enforcing the ceiling there is what made the old `big` class render narrower
    //    than the `small` beside it.
    const isSolo = row.images.length === 1 && row.images[0]?.item.sizeClass === 'solo';

    if (!row.isLast && !isSolo) {
      // The ceiling is reachable only by ADDING an image, and a solo image is not
      // available for that — it must start its own row. So a shared row may exceed the
      // ceiling when the only candidate next in line is solo. Same shape as the
      // minRowHeight floor below: a goal, not a guarantee, and the honest assertion is
      // that the solver breaches it only when it provably could not do better.
      const nextIsSolo = rows[rowIndex + 1]?.images[0]?.item.sizeClass === 'solo';
      if (!nextIsSolo) {
        expect(row.height).toBeLessThanOrEqual(Math.ceil(p.maxRowHeight));
      }

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
        (['solo', 'wide', 'medium', 'wide'] as const)[n % 4] ?? 'medium',
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
  it('gives a solo image a row to itself on desktop', () => {
    const items = [img(A.landscape, 'solo'), img(A.landscape, 'medium'), img(A.landscape, 'medium')];
    const rows = solve(items, 1440, params({ fractions: fractionsFor(1440) }));

    expect(rows[0]?.images).toHaveLength(1);
    expect(rows[0]?.images[0]?.item.sizeClass).toBe('solo');
    expect(rows[0]?.images[0]?.width).toBe(1440);
  });

  it('keeps a solo image alone even when it is TALLER than the clamp', () => {
    // The bug that produced this class: a near-square image alone at 1440 solves to
    // ~1440px, the clamp recruited a neighbour, and then equal heights made the
    // "prominent" image render NARROWER than the wide photo beside it.
    const items = [img(A.tall, 'solo'), img(A.panorama, 'medium')];
    const rows = solve(items, 1440, params({ maxRowHeight: 900 }));

    expect(rows[0]?.images).toHaveLength(1);
    expect(rows[0]?.images[0]?.width).toBe(1440);
    expect(rows[0]?.height).toBeGreaterThan(900);
  });

  it('never conscripts a solo image to fix another row’s height', () => {
    const items = [img(A.phone, 'medium'), img(A.landscape, 'solo'), img(A.landscape, 'medium')];
    const rows = solve(items, 1440, params({ maxRowHeight: 900 }));

    // Row 0 is too tall and would love a neighbour, but the next image is solo.
    expect(rows[0]?.images).toHaveLength(1);
    expect(rows[1]?.images).toHaveLength(1);
    expect(rows[1]?.images[0]?.item.sizeClass).toBe('solo');
  });

  it('pairs wide images on wide screens', () => {
    const items = [img(A.landscape, 'wide'), img(A.landscape, 'wide')];
    const rows = solve(items, 2560, params({ fractions: fractionsFor(2560) }));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.images).toHaveLength(2);
  });

  it('puts exactly one image per row on mobile, whatever the class', () => {
    const items = [
      img(A.landscape, 'solo'), img(A.tall, 'medium'),
      img(A.square, 'medium'), img(A.wide, 'wide'),
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
    const items = Array.from({ length: 12 }, () => img(A.panorama, 'medium'));
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
