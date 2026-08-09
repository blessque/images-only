/**
 * "Download everything" — the whole gallery as a zip, from the browser.
 *
 * The same bytes and the same layout as `npm run export`, so the two are interchangeable:
 * `npm run import` restores either one. That is the point — his photographs should be
 * recoverable by him, and by whatever comes after this site, without anyone installing Node.
 *
 * Reuses `availableRungs` from src/lib rather than restating which files exist. That rule
 * has already been wrong once (iteration 7 shipped a srcset advertising variants that were
 * never written), and a second copy of it here would be a second chance to be wrong.
 */

import { availableRungs } from '@/lib/imageUrl';
import type { ImageItem, Manifest } from '@/lib/types';
import { ZipBuilder } from './zip';

export interface DownloadProgress {
  done: number;
  total: number;
}

/** Mirrors `filesFor()` in scripts/export-images.mjs — same names, same order. */
function filesFor(image: ImageItem): string[] {
  if (image.passthrough) return [`full.${image.format}`];
  return availableRungs(image).map((rung) => `${rung}.webp`);
}

export interface DownloadResult {
  blob: Blob;
  files: number;
  missing: string[];
}

export async function buildGalleryZip(
  manifest: Manifest,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<DownloadResult> {
  const zip = new ZipBuilder();
  const missing: string[] = [];
  let files = 0;

  const total = manifest.images.length;
  let done = 0;

  for (const image of manifest.images) {
    for (const file of filesFor(image)) {
      const response = await fetch(`/img/${image.id}/${file}`);
      if (!response.ok) {
        // Recorded, not thrown: one unreachable variant must not cost him the other 199
        // photographs. Same call as the export script makes.
        missing.push(`${image.id}/${file} (${response.status})`);
        continue;
      }
      await zip.add(`${image.id}/${file}`, await response.blob());
      files += 1;
    }
    done += 1;
    onProgress?.({ done, total });
  }

  // Last, so an interrupted download is obviously incomplete rather than looking whole.
  await zip.add(
    'manifest.json',
    new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }),
  );

  return { blob: zip.finish(), files, missing };
}

/** Hands the blob to the browser's downloader and releases it once the click is consumed. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Revoking immediately can cancel the download in some browsers; a tick is enough.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function galleryFilename(now = new Date()): string {
  const stamp = now.toISOString().slice(0, 10);
  return `justimages-${stamp}.zip`;
}
