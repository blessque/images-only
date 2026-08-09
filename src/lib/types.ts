/**
 * Shared with `worker/` via `import type` ONLY — never a value import.
 * The two run in different runtimes; a value import compiles and then fails at the edge.
 */

/**
 * SOLO takes a whole row on its own, at any aspect ratio. WIDE and TIGHT share rows and
 * differ only in how much of one they ask for — `tight` packs more per row.
 *
 * This replaced big/medium/small, which promised a SIZE the grid could not deliver: within
 * a row every image shares a height, so widths are locked to aspect ratios — a "big"
 * portrait beside a "small" landscape came out NARROWER than the small one. `solo` is the
 * honest way to make something prominent, and it is named for what it actually does.
 * See docs/decisions/TUNING_LOG.md.
 */
export type SizeClass = 'solo' | 'wide' | 'tight';

export const SIZE_CLASSES: readonly SizeClass[] = ['solo', 'wide', 'tight'];

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
   * Meaningless when `passthrough` is true — there is no ladder.
   */
  maxRung: number;
  /**
   * The source was uploaded UNTOUCHED — one object, no ladder, no re-encode. Chosen for
   * files small enough that compressing them costs quality and buys nothing.
   */
  passthrough: boolean;
  /** Extension the bytes are stored under: 'webp' for the ladder, the source's own otherwise. */
  format: string;
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
