/**
 * Shared with `worker/` via `import type` ONLY — never a value import.
 * The two run in different runtimes; a value import compiles and then fails at the edge.
 */

export type SizeClass = 'big' | 'medium' | 'small';

export const SIZE_CLASSES: readonly SizeClass[] = ['big', 'medium', 'small'];

export interface ImageItem {
  id: string;
  /**
   * w/h. Stored as a float rather than as width+height because it is the only thing
   * layout needs, and keeping both invites someone to recompute it inconsistently.
   */
  aspect: number;
  sizeClass: SizeClass;
  alt: string;
  /**
   * Largest rung present in R2. The encoder never upscales, so a small source stops part
   * way up the ladder; advertising a rung that does not exist 404s the tile.
   */
  maxRung: number;
}

export interface Settings {
  name: string;
  contact: string;
}

export interface Manifest {
  images: ImageItem[];
  settings: Settings;
}

/** Long-edge widths of the variant ladder. See docs/architecture/IMAGE_PIPELINE.md. */
export const VARIANT_WIDTHS = [400, 800, 1600, 2400] as const;
