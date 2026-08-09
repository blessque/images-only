import { useEffect, useRef, useState } from 'react';
import type { SolvedImage } from './solve';
import { fallbackSrc, srcSetFor } from '@/lib/imageUrl';
import { useAdminHooks } from '@/lib/adminContext';
import { IMAGE_RETRY_DELAYS_MS } from './gridParams';

type Status = 'loading' | 'loaded' | 'error';

interface TileProps {
  solved: SolvedImage;
  base: string;
  /** Above the fold: skip lazy loading and hint the fetch priority. */
  eager: boolean;
  /** Position in the gallery, for the admin overlay's reorder arrows. */
  index: number;
}

/**
 * The classic wireframe missing-image mark: a 1px box with a corner-to-corner cross.
 *
 * `preserveAspectRatio="none"` makes the cross reach the actual corners of whatever box
 * it lands in, and `vector-effect="non-scaling-stroke"` keeps the rule at 1px while that
 * happens — without it the stroke stretches with the viewBox and the "1px line" becomes
 * a wedge that is thicker on one axis.
 */
function BrokenMark({ alt }: { alt: string }) {
  return (
    <div className="tile-broken">
      <svg
        className="tile-broken-mark"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <g vectorEffect="non-scaling-stroke">
          <rect x="0.5" y="0.5" width="99" height="99" vectorEffect="non-scaling-stroke" />
          <line x1="0" y1="0" x2="100" y2="100" vectorEffect="non-scaling-stroke" />
          <line x1="100" y1="0" x2="0" y2="100" vectorEffect="non-scaling-stroke" />
        </g>
      </svg>
      {alt ? <span className="tile-broken-alt">{alt}</span> : null}
    </div>
  );
}

export function Tile({ solved, base, eager, index }: TileProps) {
  const [status, setStatus] = useState<Status>('loading');
  const [attempt, setAttempt] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { renderTileOverlay } = useAdminHooks();
  const { item, width, height } = solved;
  // Null for a passthrough image — one object, so `src` alone is the whole story.
  const srcSet = srcSetFor(base, item);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  /**
   * KV takes up to ~60s to propagate worldwide, so a just-published photograph can 404 for
   * the very person who uploaded it. Retry a few times before calling it broken.
   *
   * The `?r=` suffix appears ONLY on a retry: a browser may cache the 404, and without a
   * new URL the retry would be answered from that cache rather than the network. The first
   * request stays a clean immutable URL.
   */
  function handleError() {
    const delay = IMAGE_RETRY_DELAYS_MS[attempt];
    if (delay === undefined) {
      setStatus('error');
      return;
    }
    timerRef.current = setTimeout(() => setAttempt((current) => current + 1), delay);
  }

  const retrySuffix = attempt > 0 ? `?r=${attempt}` : '';

  return (
    <div className="tile" style={{ width: `${width}px`, height: `${height}px` }}>
      {status === 'error' ? (
        <BrokenMark alt={item.alt} />
      ) : (
        <img
          className={status === 'loaded' ? 'tile-img is-loaded' : 'tile-img'}
          key={attempt}
          src={`${fallbackSrc(base, item)}${retrySuffix}`}
          {...(srcSet
            ? {
                srcSet: retrySuffix
                  ? srcSet.replace(/\.webp /g, `.webp${retrySuffix} `)
                  : srcSet,
                /*
                 * The exact solved CSS width, not a guessed media query. We know it, and
                 * a guess here is the standard way responsive images silently fetch the
                 * wrong variant. See docs/architecture/GRID.md.
                 */
                sizes: `${width}px`,
              }
            : {})}
          alt={item.alt}
          width={width}
          height={Math.round(height)}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          fetchPriority={eager ? 'high' : 'auto'}
          onLoad={() => setStatus('loaded')}
          onError={handleError}
          draggable={false}
        />
      )}
      {status === 'loading' ? <div className="tile-pulse" aria-hidden="true" /> : null}
      {renderTileOverlay?.(item, index)}
    </div>
  );
}
