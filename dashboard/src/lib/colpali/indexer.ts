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

import fsp from "node:fs/promises";
import path from "node:path";
import { colpaliMode, colpaliModel } from "./config.ts";
import { MAX_INDEXED_PAGES, writeIndexStatus } from "./index-status.ts";
import { renderDocumentPages } from "./page-images.ts";
import { colpaliIndex } from "./service.ts";
import type { DocumentAttachmentFormat } from "../document-attachments.ts";

/**
 * Documents being indexed right now, so a re-upload of the same blob or a
 * second entry point cannot start the work twice and hand the GPU two copies
 * of the same document.
 */
const inFlight = new Set<string>();

export function pageCacheDirectory(blobPath: string): string {
  const directory = path.dirname(blobPath);
  const base = path.basename(blobPath, path.extname(blobPath));
  return path.join(directory, `${base}.pages`);
}

export function pageImagePath(blobPath: string, pageNumber: number): string {
  return path.join(pageCacheDirectory(blobPath), `page-${pageNumber}.png`);
}

export async function readCachedPage(
  blobPath: string,
  pageNumber: number,
): Promise<string | null> {
  try {
    const bytes = await fsp.readFile(pageImagePath(blobPath, pageNumber));
    return bytes.toString("base64");
  } catch {
    return null;
  }
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
  await Promise.all(
    pages.map((page) =>
      fsp.writeFile(pageImagePath(blobPath, page.pageNumber), Buffer.from(page.imageBase64, "base64")),
    ),
  );
}

/**
 * Render, cache and embed one document. Awaited by tests, not by the upload.
 *
 * Never throws. Every failure is a status the retrieval path reads as "inline
 * this document whole", which is what Breadboard did before ColPali existed.
 */
export async function indexDocument(input: {
  blobId: string;
  blobPath: string;
  format: DocumentAttachmentFormat;
  env?: NodeJS.ProcessEnv;
}): Promise<void> {
  const env = input.env ?? process.env;
  const modelId = colpaliModel(env);

  if (colpaliMode(env) === "disabled") return;
  if (inFlight.has(input.blobId)) return;
  inFlight.add(input.blobId);

  try {
    writeIndexStatus(input.blobPath, {
      state: "pending",
      pages: 0,
      modelId,
      truncated: false,
      detail: "",
    });

    const rendered = await renderDocumentPages(input.blobPath, input.format);
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
  blobId: string;
  blobPath: string;
  format: DocumentAttachmentFormat;
  env?: NodeJS.ProcessEnv;
}): void {
  if (colpaliMode(input.env ?? process.env) === "disabled") return;
  void indexDocument(input).catch(() => {});
}
