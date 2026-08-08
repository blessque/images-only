import { useEffect, useMemo, useState } from 'react';
import type { Manifest } from '@/lib/types';
import { loadFixtureManifest, readInlineManifest } from '@/lib/manifest';
import { FIXTURE_BASE, PRODUCTION_BASE } from '@/lib/imageUrl';
import { Grid } from '@/grid/Grid';
import { Footer } from '@/components/Footer';
import '@/grid/grid.css';

export function App() {
  // Read synchronously on first render: in production the manifest is already in the HTML,
  // so there is no loading state at all and the grid solves before paint.
  const inline = useMemo(() => readInlineManifest(), []);
  const [manifest, setManifest] = useState<Manifest | null>(inline);
  const [error, setError] = useState<string | null>(null);

  const isDevelopment = inline === null;
  const base = isDevelopment ? FIXTURE_BASE : PRODUCTION_BASE;

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

  if (error) return <p className="app-message">{error}</p>;
  if (!manifest) return <p className="app-message" aria-busy="true" />;

  return (
    <>
      <Grid items={manifest.images} base={base} />
      <Footer settings={manifest.settings} />
    </>
  );
}
