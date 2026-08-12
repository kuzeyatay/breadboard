// Which videos this user has already fetched, and where they went.
//
// A downloaded video is stored as an ordinary chat video blob — the same store
// an uploaded one lands in. That is the whole trick: once a link has been
// fetched it *is* an attachment, so everything downstream (the Watch skill's
// workspace bridge, the Video Use editor, the message's own attachment chip)
// works on it without knowing it came from a URL.
//
// This module adds only the index that makes the fetch happen once: source key
// → blob id, in a small JSON file beside the blobs. It is a cache, not a record:
// every read verifies the file is still there, and an entry whose blob has been
// swept is dropped rather than returned.

import fs from "node:fs";
import path from "node:path";
import {
  findVideoBlob,
  videoBlobRoot,
  type StoredVideoBlob,
} from "../conversations/video-blob-store.ts";
import { isVideoBlobId } from "../video-attachments.ts";

export interface CachedVideoSource {
  key: string;
  blobId: string;
  /** The address that was fetched, kept so the cache can explain itself. */
  canonicalUrl: string;
  /** The video's own title when the fetch learned one. */
  title: string;
  durationSeconds: number | null;
  byteSize: number;
  fetchedAt: string;
}

interface IndexFile {
  version: 1;
  sources: Record<string, CachedVideoSource>;
}

const MAX_ENTRIES = 500;

function indexPath(userId: number, root?: string): string {
  if (!Number.isInteger(userId) || userId < 0) {
    throw new Error("That video owner is not valid.");
  }
  const directory = path.join(videoBlobRoot(root), `u${userId}`);
  fs.mkdirSync(directory, { recursive: true });
  return path.join(directory, "sources.json");
}

function readIndex(userId: number, root?: string): IndexFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath(userId, root), "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return { version: 1, sources: {} };
    const sources = (parsed as IndexFile).sources;
    if (!sources || typeof sources !== "object") return { version: 1, sources: {} };
    return { version: 1, sources };
  } catch {
    // No index yet, or one written by something that no longer parses. Either
    // way the answer is the same: nothing is cached.
    return { version: 1, sources: {} };
  }
}

function writeIndex(userId: number, index: IndexFile, root?: string): void {
  const file = indexPath(userId, root);
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, file);
}

/**
 * The blob a source key already points at, or null.
 *
 * A hit is only a hit if the file is still on disk: blobs are swept when no
 * message references them, and an index entry that outlives its file would
 * otherwise hand back a path to nothing.
 */
export function lookupVideoSource(
  userId: number,
  key: string,
  root?: string,
): { entry: CachedVideoSource; blob: StoredVideoBlob } | null {
  const index = readIndex(userId, root);
  const entry = index.sources[key];
  if (!entry || !isVideoBlobId(entry.blobId)) return null;

  const blob = findVideoBlob({ userId, blobId: entry.blobId, root });
  if (!blob) {
    delete index.sources[key];
    try {
      writeIndex(userId, index, root);
    } catch {
      // A cache that cannot forget is still correct; it just re-checks.
    }
    return null;
  }
  return { entry, blob };
}

export function recordVideoSource(input: {
  userId: number;
  key: string;
  blob: StoredVideoBlob;
  canonicalUrl: string;
  title: string;
  durationSeconds: number | null;
  root?: string;
}): CachedVideoSource {
  const index = readIndex(input.userId, input.root);
  const entry: CachedVideoSource = {
    key: input.key,
    blobId: input.blob.blobId,
    canonicalUrl: input.canonicalUrl.slice(0, 2_000),
    title: input.title.slice(0, 300),
    durationSeconds: input.durationSeconds,
    byteSize: input.blob.byteSize,
    fetchedAt: new Date().toISOString(),
  };
  index.sources[input.key] = entry;

  // Oldest-first eviction of index entries only. The blobs themselves are the
  // upload sweep's business; dropping a row here just means the next mention
  // checks the disk again.
  const keys = Object.keys(index.sources);
  if (keys.length > MAX_ENTRIES) {
    const ordered = keys
      .map((key) => [key, index.sources[key].fetchedAt] as const)
      .sort((left, right) => left[1].localeCompare(right[1]));
    for (const [key] of ordered.slice(0, keys.length - MAX_ENTRIES)) {
      delete index.sources[key];
    }
  }

  writeIndex(input.userId, index, input.root);
  return entry;
}

/** Every cached source, newest first — used by tests and the uploads view. */
export function listVideoSources(userId: number, root?: string): CachedVideoSource[] {
  return Object.values(readIndex(userId, root).sources).sort((left, right) =>
    right.fetchedAt.localeCompare(left.fetchedAt),
  );
}
