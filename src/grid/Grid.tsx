import { useEffect, useMemo, useRef, useState } from 'react';
import type { ImageItem } from '@/lib/types';
import { solve } from './solve';
import {
  LAST_ROW_WARN_FACTOR,
  MIN_ROW_HEIGHT_PX,
  fractionsFor,
  maxRowHeightFor,
} from './gridParams';
import { Tile } from './Tile';
import { useAdminHooks } from '@/lib/adminContext';

interface GridProps {
  items: readonly ImageItem[];
  base: string;
}

/** Eager-load whatever falls inside roughly the first screenful, plus a little slack. */
const EAGER_VIEWPORT_FACTOR = 1.2;

export function Grid({ items, base }: GridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { adminActive } = useAdminHooks();

  // Seeded SYNCHRONOUSLY so the very first render already produces the full grid.
  //
  // Starting at 0 and waiting for the ResizeObserver was measurably wrong: the observer
  // fires after mount, so the first paint had no rows, the footer painted near the top of
  // the document, and 42 rows then shoved it down — one layout shift worth CLS 0.049,
  // attributed to `footer`. The manifest supplies every aspect ratio, but the solver also
  // needs the container width, and for a full-bleed grid that is knowable up front.
  //
  // `clientWidth` (not `innerWidth`) because it excludes the scrollbar, which is exactly
  // the width a full-width block element gets.
  const [containerWidth, setContainerWidth] = useState(() =>
    typeof document === 'undefined' ? 0 : document.documentElement.clientWidth,
  );
  const [viewportHeight, setViewportHeight] = useState(() => window.innerHeight);

  // The observer now handles only CHANGES, which is what it is for. It still watches the
  // CONTAINER rather than the window: a scrollbar appearing changes one and not the other,
  // and solving against a width the grid does not have overflows by the scrollbar's width.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    let frame = 0;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const width = entry.contentRect.width;
      // Coalesce to one solve per frame. The solver itself is sub-millisecond, but
      // re-rendering 200 tiles per pixel of a drag is not.
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setContainerWidth((previous) => (Math.abs(previous - width) < 0.5 ? previous : width));
      });
    });

    observer.observe(element);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  // Row height is clamped against the viewport HEIGHT, which the container observer
  // cannot see — the grid's own height is content-driven.
  useEffect(() => {
    const onResize = () => setViewportHeight(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const rows = useMemo(() => {
    if (containerWidth <= 0) return [];
    return solve(items, containerWidth, {
      fractions: fractionsFor(containerWidth),
      maxRowHeight: maxRowHeightFor(viewportHeight),
      minRowHeight: MIN_ROW_HEIGHT_PX,
    });
  }, [items, containerWidth, viewportHeight]);

  const eagerCutoff = viewportHeight * EAGER_VIEWPORT_FACTOR;
  let cumulativeHeight = 0;
  let flatIndex = -1;

  // An incomplete final row has three possible responses: leave a gap, crop, or be tall.
  // The first two break hard rules, so it is tall — and the honest fix is to tell him
  // where he can act on it, rather than silently degrade the one promise the site makes.
  const lastRow = rows[rows.length - 1];
  const lastIsSolo = lastRow?.images.length === 1 && lastRow.images[0]?.item.sizeClass === 'solo';
  const tooTall =
    adminActive === true &&
    lastRow !== undefined &&
    // A solo row is tall on purpose — nagging about a choice the user just made is noise.
    !lastIsSolo &&
    lastRow.height > maxRowHeightFor(viewportHeight) * LAST_ROW_WARN_FACTOR;

  return (
    <div className="grid" ref={containerRef}>
      {rows.map((row, rowIndex) => {
        const eager = cumulativeHeight < eagerCutoff;
        cumulativeHeight += row.height;
        return (
          <div
            className="grid-row"
            key={row.images[0]?.item.id ?? rowIndex}
            style={{ height: `${row.height}px` }}
          >
            {row.images.map((solved) => {
              flatIndex += 1;
              return (
                <Tile
                  key={solved.item.id}
                  solved={solved}
                  base={base}
                  eager={eager}
                  index={flatIndex}
                />
              );
            })}
          </div>
        );
      })}

      {tooTall ? (
        <p className="grid-warning">
          The last row is {Math.round(lastRow.height)}px tall — it has too few images to fill
          the width at a normal height. Add one more, or move a wider photograph to the end.
        </p>
      ) : null}
    </div>
  );
}
