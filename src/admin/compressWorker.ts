/// <reference lib="webworker" />

/**
 * The WebP ladder, encoded off the main thread.
 *
 * Runs in a Web Worker because decoding twenty 10MB photographs on the main thread freezes
 * the page, and the progress bars would be lies. See docs/architecture/IMAGE_PIPELINE.md.
 *
 * Every tunable number lives in `compressParams.ts`.
 */

import { VARIANT_WIDTHS } from '@/lib/types';
import {
  ALPHA_HEAD_BYTES,
  QUALITY_FLOOR,
  QUALITY_STEP,
  budgetFor,
  startingQuality,
} from './compressParams';
import { alphaBytes } from './webp';

export interface CompressRequest {
  jobId: string;
  file: File;
  /**
   * `passthrough` uploads the source bytes UNTOUCHED — no ladder, no re-encode. Chosen for
   * small files, where re-encoding costs quality and buys nothing.
   */
  mode: 'ladder' | 'passthrough';
  /**
   * Ladder mode only. Raises this image's starting QUALITY and its byte budget — the
   * escape hatch for fine grain or subtle gradients. Per image, reversible, never global.
   */
  highFidelity: boolean;
  /** Passthrough mode only: the extension the original bytes are stored under. */
  format: string;
}

export interface VariantResult {
  /** Ladder rung, or 0 for the single passthrough original. */
  rung: number;
  blob: Blob;
  width: number;
  height: number;
}

export type CompressResponse =
  | { type: 'progress'; jobId: string; rung: number }
  | {
      type: 'done';
      jobId: string;
      aspect: number;
      sourceBytes: number;
      variants: VariantResult[];
      colorSpace: string;
      passthrough: boolean;
      format: string;
    }
  | { type: 'error'; jobId: string; message: string };

function fit(width: number, height: number, longEdge: number) {
  const scale = Math.min(1, longEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Progressive halving before the final draw.
 *
 * A single `drawImage` from 6000px to 400px is a 15x reduction, and the browser's filter
 * samples too sparsely at that ratio — fine detail aliases into shimmer, which on a
 * photography portfolio reads as a bad photograph rather than a bad resize. Halving until
 * within 2x keeps every step inside the filter's competence.
 */
function downscale(
  source: ImageBitmap | OffscreenCanvas,
  targetWidth: number,
  targetHeight: number,
  colorSpace: PredefinedColorSpace,
): OffscreenCanvas {
  let currentWidth = source.width;
  let currentHeight = source.height;
  let current: ImageBitmap | OffscreenCanvas = source;

  while (currentWidth > targetWidth * 2 && currentHeight > targetHeight * 2) {
    const nextWidth = Math.max(targetWidth, Math.round(currentWidth / 2));
    const nextHeight = Math.max(targetHeight, Math.round(currentHeight / 2));
    const step = new OffscreenCanvas(nextWidth, nextHeight);
    const stepContext = step.getContext('2d', { colorSpace });
    if (!stepContext) throw new Error('2d context unavailable');
    stepContext.imageSmoothingEnabled = true;
    stepContext.imageSmoothingQuality = 'high';
    stepContext.drawImage(current, 0, 0, nextWidth, nextHeight);
    current = step;
    currentWidth = nextWidth;
    currentHeight = nextHeight;
  }

  const canvas = new OffscreenCanvas(targetWidth, targetHeight);
  const context = canvas.getContext('2d', { colorSpace });
  if (!context) throw new Error('2d context unavailable');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(current, 0, 0, targetWidth, targetHeight);
  return canvas;
}

/**
 * The bytes the quality search is able to move.
 *
 * An image with transparency carries a LOSSLESS alpha plane that does not shrink by one
 * byte between quality 0.92 and the floor. Counting it against the budget was the bug: the
 * search saw a file four times over budget, spent every step it had, threw away a megabyte
 * of PICTURE quality, and finished still four times over — because it was chasing bytes it
 * could not reach. Budget what is compressible; the alpha plane costs what it costs.
 */
async function compressibleBytes(blob: Blob): Promise<number> {
  const head = await blob.slice(0, ALPHA_HEAD_BYTES).arrayBuffer();
  return blob.size - alphaBytes(head);
}

/**
 * Meet the budget by SEARCHING quality, not by picking a fixed number: a flat sky and a
 * densely textured street need different quality to land on the same byte count, and one
 * fixed value over-compresses the first and wastes bytes on the second.
 *
 * Note the resize already happened. Quality is the second lever, never the first.
 */
async function encodeWithinBudget(
  canvas: OffscreenCanvas,
  rung: number,
  highFidelity: boolean,
): Promise<Blob> {
  const budget = budgetFor(rung, highFidelity);
  let quality = startingQuality(rung, highFidelity);
  let blob = await canvas.convertToBlob({ type: 'image/webp', quality });

  while ((await compressibleBytes(blob)) > budget && quality > QUALITY_FLOOR) {
    quality = Math.max(QUALITY_FLOOR, quality - QUALITY_STEP);
    blob = await canvas.convertToBlob({ type: 'image/webp', quality });
  }
  return blob;
}

/**
 * Prefer Display-P3 where the browser supports it.
 *
 * A canvas re-encode drops the ICC profile, so a P3 photograph pushed through an sRGB
 * canvas comes back with dulled reds and flattened blues. This is a graphic designer's
 * portfolio — he will see it immediately and he will be right.
 */
function pickColorSpace(): PredefinedColorSpace {
  try {
    const probe = new OffscreenCanvas(1, 1);
    const context = probe.getContext('2d', { colorSpace: 'display-p3' });
    // `getContextAttributes` is implemented on offscreen 2D contexts in every browser
    // that supports wide-gamut canvas, but the TS DOM lib still only declares it on the
    // on-screen variant. Asking is the ONLY honest test: passing `colorSpace` is a
    // request, not a guarantee, and a browser that ignores it reports back 'srgb'.
    const attributes = (
      context as (OffscreenCanvasRenderingContext2D & {
        getContextAttributes?: () => { colorSpace?: string };
      }) | null
    )?.getContextAttributes?.();
    return attributes?.colorSpace === 'display-p3' ? 'display-p3' : 'srgb';
  } catch {
    return 'srgb';
  }
}

/**
 * Passthrough — the source bytes, untouched.
 *
 * The image is still decoded, but ONLY to read its dimensions, which the grid needs to
 * reserve the tile before anything loads. Nothing is drawn and nothing is re-encoded, so
 * not one pixel changes and the ICC profile and EXIF survive intact. (That last point cuts
 * both ways: the EXIF stripping the ladder gives away for free — GPS, camera serial — does
 * not happen here. Worth knowing before passing a camera original through.)
 */
async function passthrough(request: CompressRequest): Promise<CompressResponse> {
  const { jobId, file, format } = request;
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  bitmap.close();

  self.postMessage({ type: 'progress', jobId, rung: 0 } satisfies CompressResponse);

  return {
    type: 'done',
    jobId,
    aspect: width / height,
    sourceBytes: file.size,
    variants: [{ rung: 0, blob: file, width, height }],
    colorSpace: 'source',
    passthrough: true,
    format,
  };
}

async function ladder(request: CompressRequest): Promise<CompressResponse> {
  const { jobId, file, highFidelity } = request;
  const colorSpace = pickColorSpace();

  // `colorSpaceConversion: 'none'` keeps the decoder from flattening a wide-gamut source
  // to sRGB before we have a chance to put it on a wide-gamut canvas.
  const bitmap = await createImageBitmap(file, { colorSpaceConversion: 'none' });
  const aspect = bitmap.width / bitmap.height;
  const variants: VariantResult[] = [];

  for (const rung of VARIANT_WIDTHS) {
    // Never upscale: a 900px source has no 2400px version to give, and inventing one
    // would ship bytes carrying no information.
    if (Math.max(bitmap.width, bitmap.height) < rung && variants.length > 0) continue;

    const size = fit(bitmap.width, bitmap.height, rung);
    const canvas = downscale(bitmap, size.width, size.height, colorSpace);
    const blob = await encodeWithinBudget(canvas, rung, highFidelity);

    variants.push({ rung, blob, width: size.width, height: size.height });
    self.postMessage({ type: 'progress', jobId, rung } satisfies CompressResponse);
  }

  bitmap.close();
  return {
    type: 'done',
    jobId,
    aspect,
    sourceBytes: file.size,
    variants,
    colorSpace,
    passthrough: false,
    format: 'webp',
  };
}

self.onmessage = async (event: MessageEvent<CompressRequest>) => {
  const request = event.data;
  try {
    self.postMessage(
      request.mode === 'passthrough' ? await passthrough(request) : await ladder(request),
    );
  } catch (cause) {
    self.postMessage({
      type: 'error',
      jobId: request.jobId,
      message: cause instanceof Error ? cause.message : String(cause),
    } satisfies CompressResponse);
  }
};
