// Indexing an attached document, in the background, once.
//
// Rendering and embedding a hundred pages is tens of seconds of work, so it
// cannot happen inside the upload request — a person who attaches a report
// expects the chip to appear, not a spinner on a POST. The upload therefore
// enqueues and returns, and the status sidecar carries the rest of the story.
//
// The page pictures are kept, not just embedded. Retrieval needs the image of
// the page it picked, and re-deriving it at ask time would mean either a
// pdf-parse pass or a whole headless-browser run inside the turn. Caching them
// once, next to the blob, makes the ask-time path a file read — which is also
// what makes it safe to run for every attachment on every question.

import { createHash, randomUUID } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { colpaliMode, colpaliModel } from "./config.ts";
import {
  indexIsUsable,
  MAX_INDEXED_PAGES,
  readIndexStatus,
  writeIndexStatus,
} from "./index-status.ts";
import { renderDocumentPages } from "./page-images.ts";
import { colpaliIndex } from "./service.ts";
import type { DocumentAttachmentFormat } from "../document-attachments.ts";
import { documentBlobPath } from "../conversations/document-blob-store.ts";

/**
 * Documents being indexed right now, so a re-upload of the same blob or a
 * second entry point cannot start the work twice and hand the GPU two copies
 * of the same document.
 */
const inFlight = new Set<string>();
const PAGE_CACHE_PROTOCOL_VERSION = 1;
const MAX_CACHED_PAGE_BYTES = 32 * 1024 * 1024;

interface PageCacheManifest {
  protocolVersion: typeof PAGE_CACHE_PROTOCOL_VERSION;
  pages: Array<{ pageNumber: number; sizeBytes: number; sha256: string }>;
}

export function pageCacheDirectory(blobPath: string): string {
  const directory = path.dirname(blobPath);
  const base = path.basename(blobPath, path.extname(blobPath));
  return path.join(directory, `${base}.pages`);
}

export function pageImagePath(blobPath: string, pageNumber: number): string {
  return path.join(pageCacheDirectory(blobPath), `page-${pageNumber}.png`);
}

function pageCacheManifestPath(blobPath: string): string {
  return path.join(pageCacheDirectory(blobPath), "manifest.json");
}

function validManifest(value: unknown): value is PageCacheManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const manifest = value as Partial<PageCacheManifest>;
  if (
    manifest.protocolVersion !== PAGE_CACHE_PROTOCOL_VERSION ||
    !Array.isArray(manifest.pages) ||
    manifest.pages.length < 1 ||
    manifest.pages.length > MAX_INDEXED_PAGES
  ) return false;
  const seen = new Set<number>();
  return manifest.pages.every((page) => {
    if (
      !page ||
      !Number.isSafeInteger(page.pageNumber) ||
      page.pageNumber < 1 ||
      page.pageNumber > MAX_INDEXED_PAGES ||
      !Number.isSafeInteger(page.sizeBytes) ||
      page.sizeBytes < 1 ||
      page.sizeBytes > MAX_CACHED_PAGE_BYTES ||
      typeof page.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(page.sha256) ||
      seen.has(page.pageNumber)
    ) return false;
    seen.add(page.pageNumber);
    return true;
  });
}

async function readPageCacheManifest(blobPath: string): Promise<PageCacheManifest | null> {
  try {
    const parsed = JSON.parse(await fsp.readFile(pageCacheManifestPath(blobPath), "utf8"));
    return validManifest(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function readManifestPage(
  blobPath: string,
  page: PageCacheManifest["pages"][number],
): Promise<string | null> {
  try {
    const file = pageImagePath(blobPath, page.pageNumber);
    const metadata = await fsp.lstat(file);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size !== page.sizeBytes) return null;
    const bytes = await fsp.readFile(file);
    if (createHash("sha256").update(bytes).digest("hex") !== page.sha256) return null;
    return bytes.toString("base64");
  } catch {
    return null;
  }
}

export async function readCachedPage(
  blobPath: string,
  pageNumber: number,
): Promise<string | null> {
  const manifest = await readPageCacheManifest(blobPath);
  const page = manifest?.pages.find((entry) => entry.pageNumber === pageNumber);
  return page ? readManifestPage(blobPath, page) : null;
}

/** Drops the cached pictures. The service's vectors are dropped separately. */
export async function forgetCachedPages(blobPath: string): Promise<void> {
  await fsp.rm(pageCacheDirectory(blobPath), { recursive: true, force: true });
}

async function cachePages(
  blobPath: string,
  pages: readonly { pageNumber: number; imageBase64: string }[],
): Promise<void> {
  const directory = pageCacheDirectory(blobPath);
  await fsp.mkdir(directory, { recursive: true });
  const nonce = `${process.pid}-${randomUUID()}`;
  const pending: Array<{ temporary: string; target: string }> = [];
  const manifest: PageCacheManifest = { protocolVersion: PAGE_CACHE_PROTOCOL_VERSION, pages: [] };
  try {
    for (const page of pages) {
      if (
        !Number.isSafeInteger(page.pageNumber) ||
        page.pageNumber < 1 ||
        page.pageNumber > MAX_INDEXED_PAGES ||
        manifest.pages.some((entry) => entry.pageNumber === page.pageNumber)
      ) throw new Error("The ColPali page cache received an invalid page number.");
      const bytes = Buffer.from(page.imageBase64, "base64");
      if (bytes.byteLength < 1 || bytes.byteLength > MAX_CACHED_PAGE_BYTES) {
        throw new Error("A ColPali page image is empty or exceeds its cache bound.");
      }
      const target = pageImagePath(blobPath, page.pageNumber);
      const temporary = `${target}.${nonce}.tmp`;
      const handle = await fsp.open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      pending.push({ temporary, target });
      manifest.pages.push({
        pageNumber: page.pageNumber,
        sizeBytes: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
    manifest.pages.sort((left, right) => left.pageNumber - right.pageNumber);
    for (const entry of pending) await fsp.rename(entry.temporary, entry.target);

    const manifestPath = pageCacheManifestPath(blobPath);
    const temporaryManifest = `${manifestPath}.${nonce}.tmp`;
    const handle = await fsp.open(temporaryManifest, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(manifest)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fsp.rename(temporaryManifest, manifestPath);
  } finally {
    await Promise.all(pending.map(({ temporary }) => fsp.rm(temporary, { force: true })));
    const temporaryManifest = `${pageCacheManifestPath(blobPath)}.${nonce}.tmp`;
    await fsp.rm(temporaryManifest, { force: true });
  }
}

async function cachedPages(blobPath: string): Promise<Array<{ pageNumber: number; imageBase64: string }>> {
  const manifest = await readPageCacheManifest(blobPath);
  if (!manifest) return [];
  const values = await Promise.all(manifest.pages.map(async (page) => ({
    pageNumber: page.pageNumber,
    imageBase64: await readManifestPage(blobPath, page),
  })));
  if (values.some((page) => page.imageBase64 === null)) return [];
  return values.map((page) => ({ pageNumber: page.pageNumber, imageBase64: page.imageBase64! }));
}

/**
 * Render, cache and embed one document. Awaited by tests, not by the upload.
 *
 * Never throws. Every failure is a status the retrieval path reads as "inline
 * this document whole", which is what Breadboard did before ColPali existed.
 */
export async function indexDocument(input: {
  userId: number;
  blobId: string;
  blobPath: string;
  format: DocumentAttachmentFormat;
  env?: NodeJS.ProcessEnv;
}): Promise<void> {
  const env = input.env ?? process.env;
  const modelId = colpaliModel(env);
  const expectedBlobPath = documentBlobPath({
    userId: input.userId,
    blobId: input.blobId,
    format: input.format,
  });
  const sameBlobPath = process.platform === "win32"
    ? path.resolve(input.blobPath).toLowerCase() === path.resolve(expectedBlobPath).toLowerCase()
    : path.resolve(input.blobPath) === path.resolve(expectedBlobPath);
  if (!sameBlobPath) return;

  if (colpaliMode(env) === "disabled") return;
  if (inFlight.has(input.blobId)) return;
  if (indexIsUsable(readIndexStatus(input.blobPath), modelId)) return;
  inFlight.add(input.blobId);

  try {
    writeIndexStatus(input.blobPath, {
      state: "pending",
      pages: 0,
      modelId,
      truncated: false,
      detail: "",
    });

    const recoveredPages = await cachedPages(input.blobPath);
    const rendered = recoveredPages.length > 0
      ? { pages: recoveredPages, unsupported: "" }
      : await renderDocumentPages(input.blobPath, input.format, {
          userId: input.userId,
          blobId: input.blobId,
        });
    if (rendered.pages.length === 0) {
      writeIndexStatus(input.blobPath, {
        state: "unsupported",
        pages: 0,
        modelId,
        truncated: false,
        detail: rendered.unsupported,
      });
      return;
    }

    const pages = rendered.pages.slice(0, MAX_INDEXED_PAGES);
    // Cached before the embedding call, not after: if the service is down, the
    // pictures are still worth having for the next attempt, and a half-indexed
    // document with no cached pages would have to render all over again.
    await cachePages(input.blobPath, pages);

    const result = await colpaliIndex(input.blobId, pages, env);
    if (!result.ok) {
      writeIndexStatus(input.blobPath, {
        state: "failed",
        pages: 0,
        modelId,
        truncated: false,
        detail: result.detail,
      });
      return;
    }

    writeIndexStatus(input.blobPath, {
      state: "ready",
      pages: result.pages,
      modelId: result.modelId || modelId,
      truncated: result.truncated || rendered.pages.length > MAX_INDEXED_PAGES,
      detail: "",
    });
  } catch (error) {
    writeIndexStatus(input.blobPath, {
      state: "failed",
      pages: 0,
      modelId,
      truncated: false,
      detail: (error instanceof Error ? error.message : "indexing failed").slice(0, 300),
    });
  } finally {
    inFlight.delete(input.blobId);
  }
}

/**
 * Start indexing and return immediately.
 *
 * The floating promise is the point — the upload response must not wait on a
 * GPU. Rejections cannot escape, because `indexDocument` reports rather than
 * throws, but the catch stays as the guarantee that an unhandled rejection can
 * never take the server down over a document nobody has asked about yet.
 */
export function enqueueDocumentIndex(input: {
  userId: number;
  blobId: string;
  blobPath: string;
  format: DocumentAttachmentFormat;
  env?: NodeJS.ProcessEnv;
}): void {
  if (colpaliMode(input.env ?? process.env) === "disabled") return;
  void indexDocument(input).catch(() => {});
}
