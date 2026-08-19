/**
 * Which WebP encoder this browser can ACTUALLY use — asked, not assumed.
 *
 * `OffscreenCanvas.convertToBlob({type})` treats the type as a request. A browser that
 * cannot produce it silently returns `image/png` instead, with no error anywhere, and this
 * is not hypothetical: Safari cannot encode WebP from a canvas, so every rung came back a
 * PNG of the photograph. A 160KB source left as a 1.3MB "variant" — 10-20x its proper size —
 * and `quality` was ignored the whole way, which left the byte budgets downstream
 * unenforceable without anything looking wrong.
 *
 * The answer is not a different format. Converting to JPEG would destroy transparency, and
 * a WebP that arrives must stay a WebP. So: the native encoder where it works, libwebp
 * compiled to wasm where it does not, and failing both, no ladder at all — the original
 * bytes are kept instead. See docs/decisions/TUNING_LOG.md.
 */

import { PROBE_QUALITY_RATIO, PROBE_SIZE } from './compressParams';

const WEBP = 'image/webp';

export type EncoderKind = 'native' | 'wasm' | 'none';

export interface Encoder {
  kind: EncoderKind;
  /** `quality` is 0..1, as the canvas API takes it. */
  encode(canvas: OffscreenCanvas, quality: number): Promise<Blob>;
}

let probe: Promise<Encoder> | null = null;

/** Probed once per worker, then cached. */
export function pickEncoder(): Promise<Encoder> {
  probe ??= chooseEncoder();
  return probe;
}

async function chooseEncoder(): Promise<Encoder> {
  if (await nativeWebpWorks()) return native;
  // Only now is the wasm worth its ~385KB: Chrome and Firefox never reach this line, and a
  // visitor never loads any of it — the whole admin layer is behind a dynamic import.
  return (await wasmLoads()) ? wasm : unavailable;
}

/**
 * Two checks, because the first alone lets the second through:
 *
 *   1. The type really comes back `image/webp` — catches the silent PNG fallback.
 *   2. A low quality is materially smaller than a high one — catches an encoder that accepts
 *      the type and ignores `quality`, which is indistinguishable from a working one by type
 *      and would leave every byte budget a wish.
 */
async function nativeWebpWorks(): Promise<boolean> {
  try {
    const canvas = new OffscreenCanvas(PROBE_SIZE, PROBE_SIZE);
    const context = canvas.getContext('2d');
    if (!context) return false;

    // Noise, not a flat fill: quality can only prove itself on content that has detail to
    // throw away, and a solid colour encodes to the same few bytes at every setting.
    const noise = context.createImageData(PROBE_SIZE, PROBE_SIZE);
    for (let index = 0; index < noise.data.length; index += 4) {
      noise.data[index] = Math.random() * 255;
      noise.data[index + 1] = Math.random() * 255;
      noise.data[index + 2] = Math.random() * 255;
      noise.data[index + 3] = 255;
    }
    context.putImageData(noise, 0, 0);

    const [low, high] = await Promise.all([
      canvas.convertToBlob({ type: WEBP, quality: 0.2 }),
      canvas.convertToBlob({ type: WEBP, quality: 0.9 }),
    ]);
    if (low.type !== WEBP || high.type !== WEBP) return false;
    return low.size < high.size * PROBE_QUALITY_RATIO;
  } catch {
    return false;
  }
}

async function wasmLoads(): Promise<boolean> {
  try {
    await loadWasmEncode();
    return true;
  } catch {
    return false;
  }
}

let wasmEncode: Promise<typeof import('@jsquash/webp/encode').default> | null = null;

function loadWasmEncode() {
  wasmEncode ??= import('@jsquash/webp/encode').then((module) => module.default);
  return wasmEncode;
}

const native: Encoder = {
  kind: 'native',
  async encode(canvas, quality) {
    const blob = await canvas.convertToBlob({ type: WEBP, quality });
    // `pickEncoder` should make this unreachable. It exists so that if it ever is reached,
    // the result is one red row in the tray rather than a gallery quietly full of PNGs.
    if (blob.type !== WEBP) {
      throw new Error(`Browser returned ${blob.type || 'an unknown type'} when asked for WebP`);
    }
    return blob;
  },
};

const wasm: Encoder = {
  kind: 'wasm',
  async encode(canvas, quality) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('2d context unavailable');

    /*
     * Read out as sRGB, deliberately.
     *
     * libwebp takes raw pixels and writes NO colour profile — measured: the native encoder
     * emits an `ICCP` chunk, this one emits nothing. Untagged WebP is interpreted as sRGB,
     * so handing it Display-P3 values would ship a file whose pixels mean one thing and
     * whose absent tag says another, and every wide-gamut photograph would render shifted.
     * Converting on the way out costs gamut and keeps the colour CORRECT, which is the
     * right way round for a portfolio.
     */
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height, { colorSpace: 'srgb' });
    const encode = await loadWasmEncode();
    const buffer = await encode(pixels, { quality: Math.round(quality * 100) });
    const blob = new Blob([buffer], { type: WEBP });
    if (blob.size === 0) throw new Error('The WebP encoder produced nothing');
    return blob;
  },
};

const unavailable: Encoder = {
  kind: 'none',
  encode() {
    return Promise.reject(new Error('This browser cannot make WebP'));
  },
};
