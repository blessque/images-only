import type { Manifest } from './types';

const INLINE_ELEMENT_ID = 'manifest';

/**
 * Reads the manifest the Worker inlined into the HTML shell.
 *
 * Synchronous and on the critical path by design: it is what collapses the
 * load-JS → fetch-manifest → solve → fetch-images waterfall, so the grid geometry exists
 * before any image byte is requested. See docs/architecture/OVERVIEW.md.
 *
 * Returns null in development, where the element is left empty.
 */
export function readInlineManifest(): Manifest | null {
  const element = document.getElementById(INLINE_ELEMENT_ID);
  const raw = element?.textContent?.trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Manifest;
  } catch {
    // A malformed manifest must not blank the site — fall through to the network.
    return null;
  }
}

/** Development only: the fixture set from `npm run fixtures`. */
export async function loadFixtureManifest(): Promise<Manifest> {
  const response = await fetch('/fixtures/manifest.json');
  if (!response.ok) {
    throw new Error(`No fixtures found (${response.status}). Run: npm run fixtures`);
  }
  return (await response.json()) as Manifest;
}
