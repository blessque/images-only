import type { SizeClass } from '@/lib/types';
import type { VariantResult } from './compressWorker';

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

export function totalBytes(variants: VariantResult[]): number {
  return variants.reduce((sum, variant) => sum + variant.blob.size, 0);
}

export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/tiff'];

export function isAcceptedImage(file: File): boolean {
  return ACCEPTED_TYPES.includes(file.type) || /\.(jpe?g|png|webp|avif|tiff?)$/i.test(file.name);
}
