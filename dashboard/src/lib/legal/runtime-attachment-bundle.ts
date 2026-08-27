import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type { OuterAgentRuntimeBlobInput } from "../runtime-v2/outer-agent-run.ts";

export const LEGAL_RUNTIME_BUNDLE_MEDIA_TYPE =
  "application/vnd.breadboard.legal-bundle";

const MAGIC = Buffer.from("BBLEGAL1", "ascii");
const PREFIX_BYTES = MAGIC.byteLength + 4;
const MAX_HEADER_BYTES = 512 * 1024;
const MAX_BUNDLE_BYTES = 2 * 1024 * 1024 * 1024;

export type LegalBundleSegmentKind =
  | "task"
  | "memory"
  | "conversation"
  | "document-text"
  | "document-figure";

export interface LegalBundleSegment {
  readonly kind: LegalBundleSegmentKind;
  readonly attachmentIndex: number | null;
  readonly name: string | null;
  readonly offset: number;
  readonly sizeBytes: number;
}

export type LegalBundleSource = Omit<LegalBundleSegment, "offset" | "sizeBytes"> &
  ({ readonly bytes: Buffer; readonly filePath?: never } | {
    readonly bytes?: never;
    readonly filePath: string;
  });

export interface LegalRuntimeBundle {
  readonly filePath: string;
  readonly payloadOffset: number;
  readonly segments: readonly LegalBundleSegment[];
}

function exactRecord(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function samePath(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function fileSize(filePath: string): number {
  const direct = path.resolve(filePath);
  const metadata = fs.lstatSync(direct);
  const resolved = fs.realpathSync.native(direct);
  if (!metadata.isFile() || metadata.isSymbolicLink() || !samePath(resolved, direct)) {
    throw new Error("A Legal Agent bundle source is not a direct file.");
  }
  return metadata.size;
}

function sourceSize(source: LegalBundleSource): number {
  return source.bytes !== undefined ? source.bytes.byteLength : fileSize(source.filePath);
}

async function* bundleChunks(prefix: Buffer, sources: readonly LegalBundleSource[]) {
  yield prefix;
  for (const source of sources) {
    if (source.bytes !== undefined) {
      if (source.bytes.byteLength) yield source.bytes;
      continue;
    }
    for await (const chunk of fs.createReadStream(source.filePath)) {
      yield chunk as Buffer;
    }
  }
}

/** Build one streamed, authenticated sidecar for all non-file request content. */
export function createLegalRuntimeBundleInput(
  sources: readonly LegalBundleSource[],
): OuterAgentRuntimeBlobInput {
  const segments: LegalBundleSegment[] = [];
  let offset = 0;
  for (const source of sources) {
    const sizeBytes = sourceSize(source);
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
      throw new Error("A Legal Agent bundle segment has an invalid size.");
    }
    segments.push({
      kind: source.kind,
      attachmentIndex: source.attachmentIndex,
      name: source.name,
      offset,
      sizeBytes,
    });
    offset += sizeBytes;
  }
  const header = Buffer.from(JSON.stringify({ protocolVersion: 1, segments }), "utf8");
  if (header.byteLength < 1 || header.byteLength > MAX_HEADER_BYTES) {
    throw new Error("The Legal Agent attachment manifest is too large.");
  }
  const prefix = Buffer.alloc(PREFIX_BYTES + header.byteLength);
  MAGIC.copy(prefix, 0);
  prefix.writeUInt32BE(header.byteLength, MAGIC.byteLength);
  header.copy(prefix, PREFIX_BYTES);
  const sizeBytes = prefix.byteLength + offset;
  if (sizeBytes < 1 || sizeBytes > MAX_BUNDLE_BYTES) {
    throw new Error("The Legal Agent input bundle is too large.");
  }
  return {
    displayName: "legal-context.bundle",
    mediaType: LEGAL_RUNTIME_BUNDLE_MEDIA_TYPE,
    sizeBytes,
    stream: () => Readable.toWeb(Readable.from(bundleChunks(prefix, sources))) as ReadableStream<Uint8Array>,
  };
}

/** Read and validate only the bounded header; payload segments stay on disk. */
export function readLegalRuntimeBundle(filePath: string): LegalRuntimeBundle {
  const canonical = fs.realpathSync.native(filePath);
  const metadata = fs.lstatSync(canonical);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_BUNDLE_BYTES) {
    throw new Error("The sealed Legal Agent input bundle is invalid.");
  }
  const descriptor = fs.openSync(canonical, "r");
  try {
    const prefix = Buffer.alloc(PREFIX_BYTES);
    if (fs.readSync(descriptor, prefix, 0, prefix.byteLength, 0) !== prefix.byteLength ||
        !prefix.subarray(0, MAGIC.byteLength).equals(MAGIC)) {
      throw new Error("The sealed Legal Agent input bundle has an invalid header.");
    }
    const headerBytes = prefix.readUInt32BE(MAGIC.byteLength);
    if (headerBytes < 1 || headerBytes > MAX_HEADER_BYTES || PREFIX_BYTES + headerBytes > metadata.size) {
      throw new Error("The sealed Legal Agent input bundle has an invalid header size.");
    }
    const encoded = Buffer.alloc(headerBytes);
    if (fs.readSync(descriptor, encoded, 0, headerBytes, PREFIX_BYTES) !== headerBytes) {
      throw new Error("The sealed Legal Agent input bundle header is incomplete.");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(encoded.toString("utf8"));
    } catch {
      throw new Error("The sealed Legal Agent input bundle header is invalid JSON.");
    }
    if (
      !isRecord(parsed) ||
      !exactRecord(parsed, ["protocolVersion", "segments"]) ||
      parsed.protocolVersion !== 1 ||
      !Array.isArray(parsed.segments)
    ) {
      throw new Error("The sealed Legal Agent input bundle manifest is invalid.");
    }
    const segments: LegalBundleSegment[] = [];
    const segmentKeys = new Set<string>();
    let expectedOffset = 0;
    for (const value of parsed.segments) {
      if (
        !isRecord(value) ||
        !exactRecord(value, ["kind", "attachmentIndex", "name", "offset", "sizeBytes"]) ||
        !["task", "memory", "conversation", "document-text", "document-figure"].includes(
          value.kind as string,
        ) ||
        !(value.attachmentIndex === null || (
          Number.isSafeInteger(value.attachmentIndex) &&
          (value.attachmentIndex as number) >= 0 &&
          (value.attachmentIndex as number) < 10
        )) ||
        !(value.name === null || (
          typeof value.name === "string" &&
          /^figure-\d{1,4}\.[a-z0-9]{1,5}$/iu.test(value.name)
        )) ||
        !Number.isSafeInteger(value.offset) ||
        value.offset !== expectedOffset ||
        !Number.isSafeInteger(value.sizeBytes) ||
        (value.sizeBytes as number) < 0
      ) {
        throw new Error("The sealed Legal Agent input bundle segment is invalid.");
      }
      const segment = value as unknown as LegalBundleSegment;
      if (
        (["task", "memory", "conversation"].includes(segment.kind) &&
          (segment.attachmentIndex !== null || segment.name !== null)) ||
        (segment.kind === "document-text" &&
          (segment.attachmentIndex === null || segment.name !== null)) ||
        (segment.kind === "document-figure" &&
          (segment.attachmentIndex === null || segment.name === null))
      ) {
        throw new Error("The sealed Legal Agent input bundle segment scope is invalid.");
      }
      const segmentKey = `${segment.kind}:${segment.attachmentIndex ?? "content"}:${segment.name ?? ""}`;
      if (segmentKeys.has(segmentKey)) {
        throw new Error("The sealed Legal Agent input bundle repeated a segment.");
      }
      segmentKeys.add(segmentKey);
      expectedOffset += segment.sizeBytes;
      segments.push(segment);
    }
    const payloadOffset = PREFIX_BYTES + headerBytes;
    if (payloadOffset + expectedOffset !== metadata.size) {
      throw new Error("The sealed Legal Agent input bundle length is invalid.");
    }
    return { filePath: canonical, payloadOffset, segments };
  } finally {
    fs.closeSync(descriptor);
  }
}

export function readLegalBundleText(
  bundle: LegalRuntimeBundle,
  segment: LegalBundleSegment | undefined,
  maximumBytes: number,
): string {
  if (!segment) return "";
  if (segment.sizeBytes > maximumBytes) {
    throw new Error("The sealed Legal Agent text segment exceeded its bound.");
  }
  const bytes = Buffer.alloc(segment.sizeBytes);
  const descriptor = fs.openSync(bundle.filePath, "r");
  try {
    if (
      fs.readSync(
        descriptor,
        bytes,
        0,
        bytes.byteLength,
        bundle.payloadOffset + segment.offset,
      ) !== bytes.byteLength
    ) {
      throw new Error("The sealed Legal Agent text segment is incomplete.");
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return bytes.toString("utf8");
}

export function copyLegalBundleSegment(
  bundle: LegalRuntimeBundle,
  segment: LegalBundleSegment,
  target: string,
): void {
  const source = fs.openSync(bundle.filePath, "r");
  const destination = fs.openSync(target, "wx", 0o600);
  const chunk = Buffer.allocUnsafe(64 * 1024);
  let copied = 0;
  try {
    while (copied < segment.sizeBytes) {
      const requested = Math.min(chunk.byteLength, segment.sizeBytes - copied);
      const read = fs.readSync(
        source,
        chunk,
        0,
        requested,
        bundle.payloadOffset + segment.offset + copied,
      );
      if (read < 1) throw new Error("The sealed Legal Agent bundle segment is incomplete.");
      fs.writeSync(destination, chunk, 0, read);
      copied += read;
    }
    fs.fsyncSync(destination);
  } finally {
    fs.closeSync(destination);
    fs.closeSync(source);
  }
}
