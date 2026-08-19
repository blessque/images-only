import type { SizeClass } from '@/lib/types';
import type { VariantResult } from './compressWorker';
import { PASSTHROUGH_MAX_BYTES, formatFor } from './compressParams';

export type StagedStatus = 'queued' | 'compressing' | 'ready' | 'uploading' | 'done' | 'error';

export interface StagedFile {
  jobId: string;
  file: File;
  status: StagedStatus;
  /** Which rung the worker is on, for the progress bar. */
  rung: number | null;
  aspect: number;
  sizeClass: SizeClass;
  alt: string;
  highFidelity: boolean;
  /** Upload the source bytes untouched. Auto-checked for small files. */
  noCompression: boolean;
  /** Extension the bytes go to R2 under — the source's own when passing through. */
  format: string;
  variants: VariantResult[];
  sourceBytes: number;
  compressedBytes: number;
  previewUrl: string;
  error?: string;
}

/**
 * A decent alt text he can improve, rather than a required field he will resent or an
 * empty one he will never fill. He will not hand-write 200 of these, and empty alt on
 * images that ARE the content is a real accessibility and SEO loss.
 */
export function altFromFilename(name: string): string {
  const withoutExtension = name.replace(/\.[a-z0-9]+$/i, '');
  const words = withoutExtension
    .replace(/[_-]+/g, ' ')
    // Split camelCase, but leave acronyms alone.
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    // Camera dumps: IMG_4821, DSC00194, P1010023 carry no meaning worth keeping.
    .replace(/\b(IMG|DSC|DSCF|PXL|P|GOPR)[\s_-]?\d+\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!words) return '';
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Everything the ladder will write to storage. One write per variant, so also the write count. */
export function totalBytes(variants: VariantResult[]): number {
  return variants.reduce((sum, variant) => sum + variant.blob.size, 0);
}

/**
 * What one visitor actually downloads, worst case: the largest rung.
 *
 * This is the number the tray compares against the source, and it replaced the SUM of the
 * ladder, which was never a thing anyone downloads — `srcset` hands a browser exactly one
 * rung. Comparing four files against one made every honest compression read as a 2-5x gain
 * in weight and made the pipeline look broken when it was not. See TUNING_LOG.md.
 *
 * The largest rung is also the de-facto master (originals are not stored), so it is the
 * conservative choice in both directions: it never flatters the compression, and it is what
 * a retina screen showing a `solo` image is served.
 */
export function deliveredBytes(variants: VariantResult[]): number {
  let top: VariantResult | null = null;
  for (const variant of variants) if (!top || variant.rung >= top.rung) top = variant;
  return top ? top.blob.size : 0;
}

/**
 * The saving, signed honestly.
 *
 * The sign used to be a '−' hardcoded in the markup, so the growth this function now has to
 * express arrived on screen as '−-548%'. If a file comes out bigger, say so.
 */
export function savedLabel(sourceBytes: number, afterBytes: number): string {
  if (sourceBytes === 0 || afterBytes === 0) return '';
  const percent = Math.round((1 - afterBytes / sourceBytes) * 100);
  if (percent === 0) return '0%';
  return percent > 0 ? `−${percent}%` : `+${-percent}%`;
}

/**
 * Small enough that compressing it costs quality and buys nothing — so the checkbox on
 * this row becomes "No compression", pre-checked. Also requires a format we can serve
 * back verbatim: a TIFF has to go through the ladder whatever its size, because no
 * browser will render the original.
 */
export function canPassThrough(file: File): boolean {
  return file.size < PASSTHROUGH_MAX_BYTES && formatFor(file) !== null;
}

export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/tiff'];

export function isAcceptedImage(file: File): boolean {
  return ACCEPTED_TYPES.includes(file.type) || /\.(jpe?g|png|webp|avif|tiff?)$/i.test(file.name);
}
