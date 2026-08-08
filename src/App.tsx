import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import type { Manifest } from '@/lib/types';
import { loadFixtureManifest, readInlineManifest } from '@/lib/manifest';
import { FIXTURE_BASE, PRODUCTION_BASE } from '@/lib/imageUrl';
import { Grid } from '@/grid/Grid';
import { Footer } from '@/components/Footer';
import '@/grid/grid.css';

/**
 * The ONLY path into admin code.
 *
 * `lazy` + dynamic import is what keeps the whole admin layer — the compression worker,
 * the tray, the editing UI — out of a normal visitor's download. A static import here
 * would silently fold all of it into the main chunk, so `npm run check` inspects the built
 * chunks rather than trusting that the bundler did the right thing.
 */
const AdminLayer = lazy(() => import('@/admin/AdminLayer'));

export function App() {
  // Read synchronously on first render: in production the manifest is already in the HTML,
  // so there is no loading state and the grid solves before paint.
  const inline = useMemo(() => readInlineManifest(), []);
  const [manifest, setManifest] = useState<Manifest | null>(inline);
  const [error, setError] = useState<string | null>(null);
  const [adminRequested, setAdminRequested] = useState(false);

  const base = inline === null ? FIXTURE_BASE : PRODUCTION_BASE;

  useEffect(() => {
    if (manifest) return;
    let cancelled = false;
    loadFixtureManifest()
      .then((loaded) => {
        if (!cancelled) setManifest(loaded);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [manifest]);

  // Option+\ — matched on `event.code`, because Alt+Backslash on macOS produces the
  // character «, so `event.key` would never equal '\'.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey && event.code === 'Backslash') {
        event.preventDefault();
        setAdminRequested(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const closeAdmin = useCallback(() => setAdminRequested(false), []);

  if (error) return <p className="app-message">{error}</p>;
  if (!manifest) return <p className="app-message" aria-busy="true" />;

  const page = (
    <>
      <Grid items={manifest.images} base={base} />
      <Footer settings={manifest.settings} onUnlock={() => setAdminRequested(true)} />
    </>
  );

  if (!adminRequested) return page;

  // The fallback is the page itself, so requesting admin never blanks the gallery while
  // the chunk downloads.
  return (
    <Suspense fallback={page}>
      <AdminLayer manifest={manifest} onManifest={setManifest} onClose={closeAdmin}>
        {page}
      </AdminLayer>
    </Suspense>
  );
}
