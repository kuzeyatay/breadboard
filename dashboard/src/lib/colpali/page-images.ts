// Turning a stored document into the page pictures ColPali scores.
//
// Nothing here learns to rasterise. Both renderers already exist in the
// repository and are already used for exactly this shape of work: `pdf-parse`
// screenshots PDF pages for the vision-OCR fallback in `/api/extract-text`, and
// OfficeCLI renders Office pages to PNG through its own headless browser with
// no copy of Office installed. This module is the dispatch between them, plus
// the honest admission that OpenDocument has neither.
//
// Server-only: PDF pages stay in-process; Office pages are sealed into a fresh
// Runtime V2 worker and returned as bounded staged file references.

import fs from "node:fs";
import fsp from "node:fs/promises";
import { PDFParse } from "pdf-parse";
import { MAX_INDEXED_PAGES } from "./index-status.ts";
import { renderOfficePagesViaRuntime } from "../office/runtime-v2.ts";
import type { DocumentAttachmentFormat } from "../document-attachments.ts";

export interface RenderedPage {
  pageNumber: number;
  /** Base64 PNG, without a data-URL prefix. */
  imageBase64: string;
}

export interface RenderOutcome {
  pages: RenderedPage[];
  /** Set when the format has no renderer, or the renderer could not run. */
  unsupported: string;
}

/** The width the repository already renders pages at for vision work. */
const PAGE_WIDTH_PX = 1200;

function stripDataUrl(value: string): string {
  const comma = value.indexOf(",");
  return value.startsWith("data:") && comma >= 0 ? value.slice(comma + 1) : value;
}

async function renderPdfPages(blobPath: string): Promise<RenderOutcome> {
  const buffer = await fsp.readFile(blobPath);
  const parser = new PDFParse({ data: buffer });
  try {
    const info = await parser.getInfo();
    const total = Math.min(info.total, MAX_INDEXED_PAGES);
    const pages: RenderedPage[] = [];

    // Four at a time, the same stride `/api/extract-text` uses: a whole
    // textbook rasterised in one call is hundreds of megabytes of data URLs
    // resident at once.
    for (let first = 1; first <= total; first += 4) {
      const last = Math.min(first + 3, total);
      const shot = await parser.getScreenshot({
        first,
        last,
        desiredWidth: PAGE_WIDTH_PX,
        imageBuffer: false,
        imageDataUrl: true,
      });
      for (const page of shot.pages) {
        if (!Number.isFinite(page.pageNumber) || !page.dataUrl) continue;
        pages.push({
          pageNumber: page.pageNumber,
          imageBase64: stripDataUrl(page.dataUrl),
        });
      }
    }

    pages.sort((left, right) => left.pageNumber - right.pageNumber);
    return { pages, unsupported: pages.length > 0 ? "" : "the PDF produced no page images" };
  } finally {
    await parser.destroy();
  }
}

async function renderOfficePages(
  blobPath: string,
  format: "docx" | "xlsx" | "pptx",
  options: { userId: number; blobId: string; signal?: AbortSignal },
): Promise<RenderOutcome> {
  const rendered = await renderOfficePagesViaRuntime(
    { userId: options.userId, gardenId: null, conversationId: null },
    blobPath,
    format,
    {
      maximumPages: MAX_INDEXED_PAGES,
      width: PAGE_WIDTH_PX,
      idempotencySeed: `${options.blobId}:${format}:pages`,
      signal: options.signal,
    },
  );
  try {
    const pages = await Promise.all(
      rendered.pages.map(async (page) => ({
        pageNumber: page.pageNumber,
        imageBase64: (await fsp.readFile(page.filePath)).toString("base64"),
      })),
    );
    pages.sort((left, right) => left.pageNumber - right.pageNumber);
    return {
      pages: pages.slice(0, MAX_INDEXED_PAGES),
      unsupported: pages.length > 0 ? "" : rendered.unsupported,
    };
  } finally {
    rendered.cleanup();
  }
}

/**
 * Page images for a stored document, or the reason there are none.
 *
 * A `unsupported` outcome is not a failure: it means this document keeps the
 * behaviour Breadboard has always had, where the whole extracted text is
 * inlined. Every caller treats it that way.
 */
export async function renderDocumentPages(
  blobPath: string,
  format: DocumentAttachmentFormat,
  options: { userId: number; blobId: string; signal?: AbortSignal },
): Promise<RenderOutcome> {
  if (!fs.existsSync(blobPath)) {
    return { pages: [], unsupported: "the stored document is missing" };
  }
  try {
    if (format === "pdf") return await renderPdfPages(blobPath);
    if (format === "docx" || format === "xlsx" || format === "pptx") {
      return await renderOfficePages(blobPath, format, options);
    }
    // OpenDocument is read as flat text by `document-structure/opendocument.ts`
    // and has no renderer here either. Saying so is better than rendering it
    // badly: a wrong page picture is worse evidence than none.
    return { pages: [], unsupported: `${format} has no page renderer` };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "page rendering failed";
    return { pages: [], unsupported: reason.slice(0, 300) };
  }
}
