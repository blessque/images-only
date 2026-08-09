/**
 * A minimal ZIP writer, so the owner can download his own photographs from the site.
 *
 * `npm run export` already does this — but it needs Node, and the person who owns these
 * photographs does not have Node. A promise of data portability that requires a terminal is
 * not a promise he can collect on, so it has to exist in the browser too.
 *
 * NO COMPRESSION (method 0, "stored"). Every file in here is already a WebP, a JPEG or a
 * PNG; deflating them again costs CPU on his laptop and saves approximately nothing. It also
 * keeps this file small enough to read in one sitting, which is why there is no dependency.
 *
 * Not ZIP64: the 4GB ceiling is far above the 1GB Workers KV holds in total.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

interface Entry {
  nameBytes: Uint8Array<ArrayBuffer>;
  crc: number;
  size: number;
  offset: number;
  time: number;
  date: number;
}

/**
 * `TextEncoder` returns `Uint8Array<ArrayBufferLike>`, which `BlobPart` refuses because it
 * could in principle be backed by a SharedArrayBuffer. Copying into a plain ArrayBuffer is
 * a few bytes per filename and keeps the types honest instead of casting the problem away.
 */
function encodeName(name: string): Uint8Array<ArrayBuffer> {
  const source = new TextEncoder().encode(name);
  const copy = new Uint8Array(new ArrayBuffer(source.length));
  copy.set(source);
  return copy;
}

/**
 * Bit 11, the "language encoding flag". Without it a reader is entitled to decode filenames
 * as CP437, and macOS `unzip` does exactly that — a Cyrillic name came back as mojibake and
 * then failed to extract at all. Our names are ASCII today (`{id}/{rung}.webp`), so this
 * would have sat latent until the first name that was not.
 */
const UTF8_NAMES = 0x0800;

/**
 * DOS timestamp. Zero is not a valid date — it decodes as day 0 of month 0 of 1980 — and
 * some tools display or reject that oddly, so this writes the real time instead.
 */
function dosTime(date: Date): { time: number; date: number } {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/**
 * Accumulates BLOBS, never one growing ArrayBuffer.
 *
 * A gallery can be several hundred megabytes. Concatenating that into a single typed array
 * would hold all of it in JS memory at once and can simply fail on a laptop; a Blob built
 * from many parts lets the browser keep them wherever it likes, including on disk. Only one
 * file's bytes are resident at a time — long enough to CRC it.
 */
export class ZipBuilder {
  private parts: BlobPart[] = [];
  private entries: Entry[] = [];
  private offset = 0;

  async add(name: string, blob: Blob): Promise<void> {
    const nameBytes = encodeName(name);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const crc = crc32(bytes);

    const stamp = dosTime(new Date());

    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true); // local file header
    header.setUint16(4, 20, true); // version needed
    header.setUint16(6, UTF8_NAMES, true); // flags
    header.setUint16(8, 0, true); // method 0 = stored
    header.setUint16(10, stamp.time, true);
    header.setUint16(12, stamp.date, true);
    header.setUint32(14, crc, true);
    header.setUint32(18, bytes.length, true); // compressed size
    header.setUint32(22, bytes.length, true); // uncompressed size
    header.setUint16(26, nameBytes.length, true);
    header.setUint16(28, 0, true); // extra field length

    this.entries.push({
      nameBytes,
      crc,
      size: bytes.length,
      offset: this.offset,
      time: stamp.time,
      date: stamp.date,
    });
    this.parts.push(header.buffer, nameBytes, bytes);
    this.offset += 30 + nameBytes.length + bytes.length;
  }

  finish(): Blob {
    const directoryStart = this.offset;

    for (const entry of this.entries) {
      const record = new DataView(new ArrayBuffer(46));
      record.setUint32(0, 0x02014b50, true); // central directory header
      record.setUint16(4, 20, true); // version made by
      record.setUint16(6, 20, true); // version needed
      record.setUint16(8, UTF8_NAMES, true); // flags — must match the local header
      record.setUint16(10, 0, true); // method 0
      record.setUint16(12, entry.time, true);
      record.setUint16(14, entry.date, true);
      record.setUint32(16, entry.crc, true);
      record.setUint32(20, entry.size, true);
      record.setUint32(24, entry.size, true);
      record.setUint16(28, entry.nameBytes.length, true);
      record.setUint16(30, 0, true); // extra
      record.setUint16(32, 0, true); // comment
      record.setUint16(34, 0, true); // disk number
      record.setUint16(36, 0, true); // internal attrs
      record.setUint32(38, 0, true); // external attrs
      record.setUint32(42, entry.offset, true);

      this.parts.push(record.buffer, entry.nameBytes);
      this.offset += 46 + entry.nameBytes.length;
    }

    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); // end of central directory
    end.setUint16(4, 0, true); // disk
    end.setUint16(6, 0, true); // disk with directory
    end.setUint16(8, this.entries.length, true);
    end.setUint16(10, this.entries.length, true);
    end.setUint32(12, this.offset - directoryStart, true);
    end.setUint32(16, directoryStart, true);
    end.setUint16(20, 0, true); // comment length
    this.parts.push(end.buffer);

    return new Blob(this.parts, { type: 'application/zip' });
  }
}

/** Exported for the unit tests, which check this against known CRC-32 vectors. */
export const __crc32 = crc32;
