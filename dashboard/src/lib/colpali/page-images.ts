// Turning a stored document into the page pictures ColPali scores.
//
// Nothing here learns to rasterise. Both renderers already exist in the
// repository and are already used for exactly this shape of work: `pdf-parse`
// screenshots PDF pages for the vision-OCR fallback in `/api/extract-text`, and
// OfficeCLI renders Office pages to PNG through its own headless browser with
// no copy of Office installed. This module is the dispatch between them, plus
// the honest admission that OpenDocument has neither.
//
// Server-only: spawns a process and reads the filesystem.

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PDFParse } from "pdf-parse";
import { MAX_INDEXED_PAGES } from "./index-status.ts";
import { officeCliEnv, resolveOfficeCli, runOfficeCli } from "../office/officecli.ts";
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

/** Office rendering is a headless browser per document; long decks take a while. */
const OFFICE_TIMEOUT_MS = 10 * 60 * 1000;

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

/**
 * Page number from whatever OfficeCLI decided to call the file.
 *
 * The naming is deliberately not assumed. `-o` names one path and the tool
 * derives the rest from it for a multi-page capture; rather than encode a guess
 * about the separator, the directory is emptied first and then read back, and
 * the trailing digits of each filename order the result. A single-page capture
 * with no number in its name is page one.
 */
function pageNumberFromName(name: string): number {
  const match = /(\d+)(?=\.[a-z]+$)/i.exec(name);
  return match ? Number.parseInt(match[1], 10) : 1;
}

async function renderOfficePages(
  blobPath: string,
  format: DocumentAttachmentFormat,
): Promise<RenderOutcome> {
  if (resolveOfficeCli() === null) {
    return { pages: [], unsupported: "OfficeCLI is not installed (npm run setup:officecli)" };
  }

  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "breadboard-colpali-"));
  try {
    const target = path.join(directory, "page.png");
    const result = await runOfficeCli(
      [
        "view",
        blobPath,
        "screenshot",
        "--page",
        `1-${MAX_INDEXED_PAGES}`,
        "--screenshot-width",
        String(PAGE_WIDTH_PX),
        "-o",
        target,
      ],
      { cwd: directory, timeoutMs: OFFICE_TIMEOUT_MS, env: officeCliEnv() },
    );

    const written = (await fsp.readdir(directory)).filter((name) =>
      /\.(png|jpe?g)$/i.test(name),
    );
    if (written.length === 0) {
      const detail = (result.stderr || result.stdout || "").trim().slice(0, 300);
      return {
        pages: [],
        unsupported: `OfficeCLI rendered no pages for this ${format}${detail ? `: ${detail}` : ""}`,
      };
    }

    const pages = await Promise.all(
      written.map(async (name) => ({
        pageNumber: pageNumberFromName(name),
        imageBase64: (await fsp.readFile(path.join(directory, name))).toString("base64"),
      })),
    );
    pages.sort((left, right) => left.pageNumber - right.pageNumber);
    return { pages: pages.slice(0, MAX_INDEXED_PAGES), unsupported: "" };
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
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
): Promise<RenderOutcome> {
  if (!fs.existsSync(blobPath)) {
    return { pages: [], unsupported: "the stored document is missing" };
  }
  try {
    if (format === "pdf") return await renderPdfPages(blobPath);
    if (format === "docx" || format === "xlsx" || format === "pptx") {
      return await renderOfficePages(blobPath, format);
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
