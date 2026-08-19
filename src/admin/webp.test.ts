import { describe, expect, it } from 'vitest';
import { alphaBytes } from './webp';

/**
 * The parser exists to answer one question — how many of this file's bytes is the quality
 * knob unable to reach — and it answers it by walking a container it did not write. These
 * tests pin the walk to the RIFF spec's rules, because a drifted offset does not throw: it
 * reads a length out of the middle of image data and silently reports a nonsense budget.
 */

function chunk(id: string, size: number): number[] {
  const header = [...id].map((character) => character.charCodeAt(0));
  const view = new DataView(new ArrayBuffer(4));
  view.setUint32(0, size, true);
  const length = [...new Uint8Array(view.buffer)];
  // RIFF pads every odd-sized payload to an even boundary. Forgetting this is the classic
  // way to walk off by one chunk and read garbage as a length.
  const payload = new Array<number>(size + (size % 2)).fill(0);
  return [...header, ...length, ...payload];
}

function webp(...chunks: number[][]): ArrayBuffer {
  const body = chunks.flat();
  const riff = [...'RIFF'].map((character) => character.charCodeAt(0));
  const view = new DataView(new ArrayBuffer(4));
  view.setUint32(0, body.length + 4, true);
  const size = [...new Uint8Array(view.buffer)];
  const webpTag = [...'WEBP'].map((character) => character.charCodeAt(0));
  return new Uint8Array([...riff, ...size, ...webpTag, ...body]).buffer;
}

describe('alphaBytes', () => {
  it('reports the ALPH payload of an extended file', () => {
    const file = webp(chunk('VP8X', 10), chunk('ICCP', 520), chunk('ALPH', 2963776), chunk('VP8 ', 64));
    expect(alphaBytes(file)).toBe(2963776);
  });

  it('reports zero for an opaque file, which carries no ALPH chunk at all', () => {
    // Measured: Chrome omits the chunk entirely when every pixel is opaque, so an opaque
    // photograph is unaffected by any of this.
    expect(alphaBytes(webp(chunk('VP8X', 10), chunk('ICCP', 520), chunk('VP8 ', 64)))).toBe(0);
  });

  it('reports zero for a plain lossy file with no extended header', () => {
    expect(alphaBytes(webp(chunk('VP8 ', 64)))).toBe(0);
  });

  it('survives an odd-sized chunk before the alpha plane', () => {
    // An odd ICCP is padded to even. A parser that skips only `size` lands one byte early
    // and reads 'LPH\0' as a chunk id — no throw, just a wrong answer forever after.
    const file = webp(chunk('VP8X', 10), chunk('ICCP', 521), chunk('ALPH', 1234), chunk('VP8 ', 64));
    expect(alphaBytes(file)).toBe(1234);
  });

  it('reports zero rather than throwing when the head is truncated mid-header', () => {
    // We only ever hand it the first few KB of a blob, so a truncated tail is the normal
    // case, not the exceptional one.
    const full = new Uint8Array(webp(chunk('VP8X', 10), chunk('ICCP', 520), chunk('ALPH', 4096)));
    expect(alphaBytes(full.slice(0, 30).buffer)).toBe(0);
  });

  it('reports zero for bytes that are not a WebP file', () => {
    expect(alphaBytes(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer)).toBe(0);
    expect(alphaBytes(new ArrayBuffer(0))).toBe(0);
  });
});
