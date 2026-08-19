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
import { type Encoder, type EncoderKind, pickEncoder } from './encoder';
import { downscale, fit } from './resize';
import { alphaBytes } from './webp';

export interface CompressRequest {
  jobId: string;
  file: File;
  /**
   * `passthrough` uploads the source bytes UNTOUCHED — no ladder, no re-encode. It is the
   * lossless escape hatch, available at any size, and the default under 150KB.
   */
  mode: 'ladder' | 'passthrough';
  /** The extension the original bytes would be stored under, or '' if we cannot serve them. */
  format: string;
}

export interface VariantResult {
  /** Ladder rung, or 0 for the single passthrough original. */
  rung: number;
  blob: Blob;
  width: number;
  height: number;
}

/**
 * Why an image ended up untouched. The tray says which, because "untouched" for a reason he
 * did not choose needs explaining — a greyed-out control with no cause is how a
 * non-technical owner concludes the site is broken.
 */
export type PassthroughReason =
  | 'chosen'
  /** The ladder ran and came out no smaller than the source, so it was thrown away. */
  | 'larger'
  /** No WebP encoder at all — not even the wasm one would load. */
  | 'no-encoder';

export type CompressResponse =
  | { type: 'progress'; jobId: string; rung: number }
  | { type: 'capabilities'; encoder: EncoderKind }
  | {
      type: 'done';
      jobId: string;
      aspect: number;
      sourceBytes: number;
      variants: VariantResult[];
      colorSpace: string;
      passthrough: boolean;
      passthroughReason: PassthroughReason | null;
      format: string;
    }
  | { type: 'error'; jobId: string; message: string };

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
  encoder: Encoder,
): Promise<Blob> {
  const budget = budgetFor(rung);
  let quality = startingQuality(rung);
  let blob = await encoder.encode(canvas, quality);

  while ((await compressibleBytes(blob)) > budget && quality > QUALITY_FLOOR) {
    quality = Math.max(QUALITY_FLOOR, quality - QUALITY_STEP);
    blob = await encoder.encode(canvas, quality);
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
async function passthrough(
  request: CompressRequest,
  reason: PassthroughReason,
): Promise<CompressResponse> {
  const { jobId, file, format } = request;
  if (!format) {
    // A TIFF is the one thing this cannot do. It uploads, but no browser renders it, so
    // "keep the original" would store something the gallery can never show.
    throw new Error(
      reason === 'no-encoder'
        ? 'This browser cannot convert TIFF. Open the site in Chrome to upload this one.'
        : 'A TIFF has to be converted — no browser can display the original.',
    );
  }

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
    passthroughReason: reason,
    format,
  };
}

async function ladder(request: CompressRequest): Promise<CompressResponse> {
  const { jobId, file } = request;
  const encoder = await pickEncoder();
  // No encoder at all, not even the wasm one. Keep the original rather than convert it to
  // something else: a WebP that arrives must stay a WebP, and JPEG has no alpha channel.
  if (encoder.kind === 'none') return passthrough(request, 'no-encoder');

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
    const blob = await encodeWithinBudget(canvas, rung, encoder);

    variants.push({ rung, blob, width: size.width, height: size.height });
    self.postMessage({ type: 'progress', jobId, rung } satisfies CompressResponse);
  }

  bitmap.close();

  /*
   * Compression must never make an image larger.
   *
   * The largest rung is what one visitor can be asked to download, so it is what the
   * comparison has to be against. If the ladder cannot beat the file it started from, the
   * ladder is not worth having — the original is smaller AND untouched. Only possible when
   * the original is servable; a TIFF has to take the ladder whatever it weighs.
   */
  const largest = variants.reduce((top, variant) => (variant.rung >= top.rung ? variant : top));
  if (request.format && largest.blob.size >= file.size) return passthrough(request, 'larger');

  return {
    type: 'done',
    jobId,
    aspect,
    sourceBytes: file.size,
    variants,
    colorSpace,
    passthrough: false,
    passthroughReason: null,
    format: 'webp',
  };
}

self.onmessage = async (event: MessageEvent<CompressRequest>) => {
  const request = event.data;
  try {
    self.postMessage(
      request.mode === 'passthrough'
        ? await passthrough(request, 'chosen')
        : await ladder(request),
    );
  } catch (cause) {
    self.postMessage({
      type: 'error',
      jobId: request.jobId,
      message: cause instanceof Error ? cause.message : String(cause),
    } satisfies CompressResponse);
  }
};

/*
 * Probe as soon as the worker starts, and say what it found.
 *
 * Unsolicited rather than request/response: the tray needs to know whether compression is
 * even possible before he drops anything, and on Safari this also warms the ~385KB wasm
 * download while he is still choosing files. It is only a LABEL — every real decision is
 * made here in the worker, so a slow probe can never race a dropped file into the wrong path.
 */
void pickEncoder().then((encoder) => {
  self.postMessage({ type: 'capabilities', encoder: encoder.kind } satisfies CompressResponse);
});
