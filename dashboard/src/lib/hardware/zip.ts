// A minimal store-only ZIP writer.
//
// The artifact builds its project archive in the browser, where the server's
// zip dependency is not available, so the container format is written by hand.
// Store-only (no deflate) keeps this to one table and one loop; the payload is
// a few text files, so compression would buy almost nothing.

export interface ZipEntry {
  path: string;
  content: string;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

function writeUint16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value & 0xffff, true);
}

/**
 * Build a ZIP archive. `modified` is passed in rather than read from the clock
 * so the same design always produces byte-identical output.
 */
export function createZip(entries: ZipEntry[], modified = new Date(0)): Uint8Array {
  const encoder = new TextEncoder();
  const dosTime =
    ((modified.getUTCHours() & 0x1f) << 11) |
    ((modified.getUTCMinutes() & 0x3f) << 5) |
    ((modified.getUTCSeconds() / 2) & 0x1f);
  const dosDate =
    (((Math.max(1980, modified.getUTCFullYear()) - 1980) & 0x7f) << 9) |
    (((modified.getUTCMonth() + 1) & 0x0f) << 5) |
    (modified.getUTCDate() & 0x1f);

  const prepared = entries.map((entry) => {
    const name = encoder.encode(entry.path.replace(/\\/g, "/"));
    const data = encoder.encode(entry.content);
    return { name, data, crc: crc32(data) };
  });

  const localSize = prepared.reduce(
    (sum, entry) => sum + 30 + entry.name.length + entry.data.length,
    0,
  );
  const centralSize = prepared.reduce((sum, entry) => sum + 46 + entry.name.length, 0);
  const buffer = new ArrayBuffer(localSize + centralSize + 22);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  let offset = 0;
  const offsets: number[] = [];
  for (const entry of prepared) {
    offsets.push(offset);
    writeUint32(view, offset, 0x04034b50);
    writeUint16(view, offset + 4, 20);
    writeUint16(view, offset + 6, 0x0800); // UTF-8 filenames
    writeUint16(view, offset + 8, 0); // stored
    writeUint16(view, offset + 10, dosTime);
    writeUint16(view, offset + 12, dosDate);
    writeUint32(view, offset + 14, entry.crc);
    writeUint32(view, offset + 18, entry.data.length);
    writeUint32(view, offset + 22, entry.data.length);
    writeUint16(view, offset + 26, entry.name.length);
    writeUint16(view, offset + 28, 0);
    bytes.set(entry.name, offset + 30);
    bytes.set(entry.data, offset + 30 + entry.name.length);
    offset += 30 + entry.name.length + entry.data.length;
  }

  const centralStart = offset;
  prepared.forEach((entry, index) => {
    writeUint32(view, offset, 0x02014b50);
    writeUint16(view, offset + 4, 20);
    writeUint16(view, offset + 6, 20);
    writeUint16(view, offset + 8, 0x0800);
    writeUint16(view, offset + 10, 0);
    writeUint16(view, offset + 12, dosTime);
    writeUint16(view, offset + 14, dosDate);
    writeUint32(view, offset + 16, entry.crc);
    writeUint32(view, offset + 20, entry.data.length);
    writeUint32(view, offset + 24, entry.data.length);
    writeUint16(view, offset + 28, entry.name.length);
    writeUint16(view, offset + 30, 0);
    writeUint16(view, offset + 32, 0);
    writeUint16(view, offset + 34, 0);
    writeUint16(view, offset + 36, 0);
    writeUint32(view, offset + 38, 0);
    writeUint32(view, offset + 42, offsets[index]);
    bytes.set(entry.name, offset + 46);
    offset += 46 + entry.name.length;
  });

  writeUint32(view, offset, 0x06054b50);
  writeUint16(view, offset + 4, 0);
  writeUint16(view, offset + 6, 0);
  writeUint16(view, offset + 8, prepared.length);
  writeUint16(view, offset + 10, prepared.length);
  writeUint32(view, offset + 12, offset - centralStart);
  writeUint32(view, offset + 16, centralStart);
  writeUint16(view, offset + 20, 0);

  return bytes;
}
