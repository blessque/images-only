import { describe, expect, it } from 'vitest';
import { ZipBuilder, __crc32 } from './zip';

/**
 * A hand-rolled binary format is worth exactly as much as its proof that something else can
 * read it. These tests check the bytes against the ZIP spec's fixed offsets and against
 * published CRC-32 vectors — the two things that decide whether the owner's backup opens.
 */

const bytes = (...values: number[]) => new Uint8Array(values);

describe('crc32', () => {
  it('matches the published vectors', () => {
    // The canonical check value for CRC-32/ISO-HDLC over "123456789".
    expect(__crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(__crc32(new Uint8Array())).toBe(0);
    expect(__crc32(new TextEncoder().encode('a'))).toBe(0xe8b7be43);
  });
});

async function build(files: Array<[string, Uint8Array<ArrayBuffer>]>): Promise<Uint8Array> {
  const zip = new ZipBuilder();
  for (const [name, content] of files) await zip.add(name, new Blob([content]));
  return new Uint8Array(await zip.finish().arrayBuffer());
}

describe('ZipBuilder', () => {
  it('writes the local header, central directory and EOCD signatures', async () => {
    const out = await build([['a.txt', bytes(1, 2, 3)]]);
    const view = new DataView(out.buffer);

    expect(view.getUint32(0, true)).toBe(0x04034b50); // local file header
    const eocd = out.length - 22;
    expect(view.getUint32(eocd, true)).toBe(0x06054b50); // end of central directory
    expect(view.getUint16(eocd + 8, true)).toBe(1); // entries on this disk
    expect(view.getUint16(eocd + 10, true)).toBe(1); // entries total

    const directoryStart = view.getUint32(eocd + 16, true);
    expect(view.getUint32(directoryStart, true)).toBe(0x02014b50); // central directory
  });

  it('stores rather than compresses, so the payload appears verbatim', async () => {
    // Method 0 is the whole reason this file has no dependency. If it ever became 8, the
    // bytes below would no longer be findable and this test would say so.
    const payload = bytes(9, 8, 7, 6, 5);
    const out = await build([['photo.webp', payload]]);
    const view = new DataView(out.buffer);

    expect(view.getUint16(8, true)).toBe(0); // compression method
    expect(view.getUint32(18, true)).toBe(payload.length); // compressed size
    expect(view.getUint32(22, true)).toBe(payload.length); // uncompressed size

    const start = 30 + 'photo.webp'.length;
    expect([...out.slice(start, start + payload.length)]).toEqual([...payload]);
  });

  it('records each entry’s offset, so a reader can find the second file', async () => {
    const out = await build([
      ['first', bytes(1, 1, 1)],
      ['second', bytes(2, 2)],
    ]);
    const view = new DataView(out.buffer);
    const eocd = out.length - 22;
    expect(view.getUint16(eocd + 10, true)).toBe(2);

    const directoryStart = view.getUint32(eocd + 16, true);
    const secondEntry = directoryStart + 46 + 'first'.length;
    const offset = view.getUint32(secondEntry + 42, true);
    expect(view.getUint32(offset, true)).toBe(0x04034b50); // a local header lives there
    expect(offset).toBe(30 + 'first'.length + 3);
  });

  it('handles a name with non-ASCII characters by byte length, not character count', async () => {
    // Filenames are ASCII today (`{id}/{rung}.webp`), but a wrong length corrupts every
    // later offset in the file, so the arithmetic is worth pinning regardless.
    const name = 'фото/полный.webp';
    const out = await build([[name, bytes(4, 2)]]);
    const view = new DataView(out.buffer);
    const nameBytes = new TextEncoder().encode(name).length;

    expect(view.getUint16(26, true)).toBe(nameBytes);
    expect(nameBytes).toBeGreaterThan(name.length);
    const eocd = out.length - 22;
    expect(view.getUint32(eocd, true)).toBe(0x06054b50);
  });

  it('flags names as UTF-8 in BOTH headers', async () => {
    // Without bit 11 a reader may decode names as CP437. Verified against Python's zipfile
    // and macOS `ditto`, which both then read Cyrillic paths correctly. The two headers must
    // agree — a reader is entitled to consult either.
    const out = await build([['фото.webp', bytes(1)]]);
    const view = new DataView(out.buffer);
    expect(view.getUint16(6, true) & 0x0800).toBe(0x0800); // local header

    const eocd = out.length - 22;
    const directoryStart = view.getUint32(eocd + 16, true);
    expect(view.getUint16(directoryStart + 8, true) & 0x0800).toBe(0x0800); // central directory
  });

  it('writes a valid DOS timestamp rather than zero', async () => {
    // Zero decodes as day 0 of month 0 — `unzip -l` printed "00-00-1980" for it.
    const out = await build([['a', bytes(1)]]);
    const view = new DataView(out.buffer);
    const date = view.getUint16(12, true);
    expect((date >> 5) & 0x0f).toBeGreaterThanOrEqual(1); // month
    expect(date & 0x1f).toBeGreaterThanOrEqual(1); // day
  });

  it('produces a valid empty archive', async () => {
    const out = await build([]);
    expect(out.length).toBe(22);
    expect(new DataView(out.buffer).getUint32(0, true)).toBe(0x06054b50);
  });
});
