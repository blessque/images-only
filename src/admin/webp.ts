/**
 * Just enough of the WebP container to answer one question: how many of these bytes can the
 * quality setting actually move?
 *
 * A lossy WebP with transparency is two things in one file — a lossy picture (the `VP8 `
 * chunk) and a LOSSLESS alpha plane (the `ALPH` chunk). Quality governs the first and has
 * no effect whatsoever on the second. Measured on one 2400x1600 image at qualities 0.92,
 * 0.80 and 0.62, the alpha plane came out 2,963,776 bytes every single time, to the byte,
 * while the picture fell from 1.6MB to 637KB.
 *
 * That is why this file exists. See docs/decisions/TUNING_LOG.md.
 */

const RIFF = 0x52494646; // 'RIFF'
const WEBP = 0x57454250; // 'WEBP'
const ALPH = 0x414c5048; // 'ALPH'

/** Where the chunk list starts: 'RIFF' + size + 'WEBP'. */
const FIRST_CHUNK = 12;

/**
 * Size of the lossless alpha plane, or 0 when there is none.
 *
 * Takes the HEAD of a file rather than the whole thing — the caller passes the first few KB,
 * because `ALPH` is always ahead of the image data and copying megabytes per encode attempt
 * to read one number would be its own kind of waste. A head too short to answer, or bytes
 * that are not a WebP at all, both report 0: the caller then budgets the whole file, which
 * is exactly the behaviour that existed before this parser.
 */
export function alphaBytes(head: ArrayBuffer): number {
  if (head.byteLength < FIRST_CHUNK + 8) return 0;
  const view = new DataView(head);
  if (view.getUint32(0) !== RIFF || view.getUint32(8) !== WEBP) return 0;

  let offset = FIRST_CHUNK;
  // `+ 8` because a chunk we cannot read the header of is a chunk we cannot skip either —
  // stopping is the only safe move, since guessing a length reads image data as an offset.
  while (offset + 8 <= head.byteLength) {
    const id = view.getUint32(offset);
    const size = view.getUint32(offset + 4, true);
    if (id === ALPH) return size;
    // RIFF pads odd payloads to an even boundary, and the pad byte is not counted in the
    // size field. Skipping only `size` lands one byte early and every id after it is junk.
    offset += 8 + size + (size % 2);
  }
  return 0;
}
