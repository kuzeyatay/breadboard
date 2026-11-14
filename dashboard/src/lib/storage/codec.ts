import { createHash } from "node:crypto";
import * as zlibModule from "node:zlib";
// The packaged Node runtime supports Zstandard; the repository still uses the
// older Node type catalog. Keep the compatibility declaration local.
type ZstdOptions = { params?: Record<number, number>; maxOutputLength?: number };
type ZstdCallback = (error: Error | null, value: Buffer) => void;
const zlib = zlibModule as typeof zlibModule & {
  constants: typeof zlibModule.constants & { ZSTD_c_compressionLevel: number };
  zstdCompressSync(value: Buffer, options: ZstdOptions): Buffer;
  zstdDecompressSync(value: Buffer, options: ZstdOptions): Buffer;
  zstdCompress(value: Buffer, options: ZstdOptions, callback: ZstdCallback): void;
  zstdDecompress(value: Buffer, options: ZstdOptions, callback: ZstdCallback): void;
};
import { promisify } from "node:util";
import { STORAGE_POLICY } from "./policy.ts";

// Each frame is independently bounded. No dictionary or external file is needed
// to read an archived value after housekeeping has been switched off.
const MAGIC = Buffer.from("BBZ1");
const compressAsync = promisify(zlib.zstdCompress);
const decompressAsync = promisify(zlib.zstdDecompress);

/** Compression and verification run on libuv workers. A caller can retain this
 * state between short idle slices without holding a SQLite transaction. */
export class PayloadPacker {
  private offset = 0;
  private frames: Buffer[] = [MAGIC];
  private hash = createHash("sha256");
  private readonly raw: Buffer;
  constructor(raw: Buffer) { this.raw = raw; }
  async step(shouldYield: () => boolean): Promise<{ encoded: Buffer; hash: string } | null> {
    const start = Date.now(); let processed = 0;
    while (this.offset < this.raw.length && !shouldYield()) {
      const raw = this.raw.subarray(this.offset, this.offset + 256 * 1024);
      const compressed = await compressAsync(raw, { params: { [zlib.constants.ZSTD_c_compressionLevel]: 3 } });
      const verified = await decompressAsync(compressed, { maxOutputLength: raw.length });
      if (!verified.equals(raw)) throw new Error("Storage roundtrip failed");
      const header = Buffer.alloc(8); header.writeUInt32LE(raw.length); header.writeUInt32LE(compressed.length, 4);
      this.frames.push(header, compressed); this.hash.update(raw); this.offset += raw.length; processed += raw.length;
      const pause = processed / STORAGE_POLICY.ioBytesPerSecond * 1000 - (Date.now() - start);
      if (pause > 0) await new Promise(resolve => setTimeout(resolve, Math.min(25, pause)));
    }
    return this.offset === this.raw.length ? { encoded: Buffer.concat(this.frames), hash: this.hash.digest("hex") } : null;
  }
}
export const payloadHash = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");

export function packPayload(value: Buffer): Buffer {
  const frames: Buffer[] = [MAGIC];
  for (let offset = 0; offset < value.length; offset += STORAGE_POLICY.chunkBytes) {
    const raw = value.subarray(offset, offset + STORAGE_POLICY.chunkBytes);
    const compressed = zlib.zstdCompressSync(raw, { params: { [zlib.constants.ZSTD_c_compressionLevel]: 3 } });
    const header = Buffer.alloc(8);
    header.writeUInt32LE(raw.length); header.writeUInt32LE(compressed.length, 4);
    frames.push(header, compressed);
  }
  return Buffer.concat(frames);
}

export function unpackPayload(encoded: Buffer, expectedBytes: number, expectedHash: string): Buffer {
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0 || expectedBytes > STORAGE_POLICY.cacheBytes
    || !encoded.subarray(0, 4).equals(MAGIC)) throw new Error("Invalid storage payload header");
  const chunks: Buffer[] = [];
  let offset = 4, bytes = 0;
  while (offset < encoded.length) {
    if (offset + 8 > encoded.length) throw new Error("Truncated storage payload");
    const rawLength = encoded.readUInt32LE(offset), length = encoded.readUInt32LE(offset + 4);
    offset += 8;
    if (!rawLength || rawLength > STORAGE_POLICY.chunkBytes || !length || offset + length > encoded.length
      || bytes + rawLength > expectedBytes) throw new Error("Invalid storage payload frame");
    const raw = zlib.zstdDecompressSync(encoded.subarray(offset, offset + length), { maxOutputLength: rawLength });
    if (raw.length !== rawLength) throw new Error("Storage payload length mismatch");
    chunks.push(raw); bytes += raw.length; offset += length;
  }
  const result = Buffer.concat(chunks);
  if (bytes !== expectedBytes || payloadHash(result) !== expectedHash) throw new Error("Storage payload checksum mismatch");
  return result;
}

export class PayloadCache {
  private readonly values = new Map<string, { text: string; bytes: number }>();
  private bytes = 0;
  private readonly limit: number;
  constructor(limit = STORAGE_POLICY.cacheBytes) { this.limit = limit; }
  get(key: string): string | undefined {
    const entry = this.values.get(key);
    if (!entry) return undefined;
    this.values.delete(key); this.values.set(key, entry);
    return entry.text;
  }
  put(key: string, text: string): void {
    const bytes = Math.max(Buffer.byteLength(text), text.length * 2);
    if (bytes > this.limit) return;
    const old = this.values.get(key);
    if (old) { this.bytes -= old.bytes; this.values.delete(key); }
    while (this.bytes + bytes > this.limit) {
      const first = this.values.entries().next().value;
      if (!first) break;
      this.values.delete(first[0]); this.bytes -= first[1].bytes;
    }
    this.values.set(key, { text, bytes }); this.bytes += bytes;
  }
  get byteLength(): number { return this.bytes; }
  clear(): void { this.values.clear(); this.bytes = 0; }
}
