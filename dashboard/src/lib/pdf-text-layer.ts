// Writes OCR output back into a PDF as an invisible text layer.
//
// The VLM and handwriting OCR paths transcribe page images into Markdown for
// the source note, but the saved PDF stayed a bare scan: nothing to search,
// select, or copy in any other viewer. This module paints each page's OCR
// text onto the page in text rendering mode 3 (invisible), which is how
// ocrmypdf and every "searchable PDF" scanner make a scan searchable. The
// pixels are untouched; text extractors and viewers see the words.
//
// OCR here yields per-page text without word boxes, so the layer is laid out
// as evenly spaced lines down the page. Search and copy work and reading order
// is kept; a viewer's highlight for a hit lands on the right page but not on
// the exact word.
//
// The module only knows pdf-lib and one Unicode font; it never touches the
// garden, so it can be unit tested against a synthetic PDF.

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import {
  PDFDocument,
  type PDFFont,
  type PDFPage,
  rgb,
  setTextRenderingMode,
  TextRenderingMode,
} from "@cantoo/pdf-lib";
import * as fontkit from "fontkit";

export interface OcrTextLayerPage {
  /** 1-based page number in the PDF. */
  pageNumber: number;
  /** OCR output for the page, Markdown or plain text. */
  text: string;
}

export interface OcrTextLayerResult {
  /** The PDF with the layer added, or the input bytes when no page changed. */
  bytes: Uint8Array;
  pagesWritten: number;
  /** Pages that had no usable text or do not exist in the PDF. */
  skippedPages: number[];
}

/** Keep lines at least this tall so extractors do not merge neighbours. */
const MIN_LINE_HEIGHT = 4;
const MAX_FONT_SIZE = 11;
const MIN_FONT_SIZE = 1;
/** Fraction of the shorter page side left clear on each edge. */
const MARGIN_RATIO = 0.04;

/**
 * The standard-font fallback pdf.js ships covers Latin, Latin Extended,
 * Greek and Cyrillic, which is what the OCR models here produce. It resolves
 * from `pdfjs-dist` (already a pdf-parse dependency) in both the development
 * tree and the packaged worker closure.
 */
function textLayerFontPath(): string {
  const require = createRequire(import.meta.url);
  const pdfjsRoot = path.dirname(require.resolve("pdfjs-dist/package.json"));
  return path.join(pdfjsRoot, "standard_fonts", "LiberationSans-Regular.ttf");
}

let cachedFontBytes: Uint8Array | null = null;

function loadTextLayerFont(): Uint8Array {
  if (cachedFontBytes) return cachedFontBytes;
  const fontPath = textLayerFontPath();
  try {
    cachedFontBytes = fs.readFileSync(fontPath);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `The OCR text-layer font is unavailable at ${fontPath}: ${reason}`,
    );
  }
  return cachedFontBytes;
}

/**
 * Reduce OCR Markdown to the words a reader would search for: one entry per
 * source line, with Markdown and HTML scaffolding removed and whitespace
 * collapsed. Empty lines, table rules and image embeds drop out.
 */
export function ocrTextLayerLines(text: string): string[] {
  const lines: string[] = [];
  let inFence = false;
  for (const rawLine of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(rawLine)) {
      inFence = !inFence;
      continue;
    }
    let line = rawLine;
    if (!inFence) {
      line = line
        // Image embeds carry an asset path, not page text.
        .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
        // Links keep their label.
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/<[^>]+>/g, " ")
        .replace(/^\s{0,3}#{1,6}\s+/, "")
        .replace(/^\s{0,3}>\s?/, "")
        .replace(/^\s*[-*+]\s+/, "")
        .replace(/^\s*\d+[.)]\s+/, "")
        .replace(/\*\*|__|`+/g, "")
        .replace(/\$\$?/g, " ");
      // Table rows become space-separated cells; separator rows vanish.
      if (line.includes("|")) {
        if (/^[\s|:-]+$/.test(line)) continue;
        line = line.replace(/\|/g, " ");
      }
    }
    line = line
      .replace(/\p{Cc}/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (line) lines.push(line);
  }
  return lines;
}

/**
 * Merge consecutive lines so no more than `maxLines` remain, keeping order.
 * A page with more OCR lines than it has room for still gets every word.
 */
export function packLines(lines: string[], maxLines: number): string[] {
  const limit = Math.max(1, Math.floor(maxLines));
  if (lines.length <= limit) return lines;
  const perGroup = Math.ceil(lines.length / limit);
  const packed: string[] = [];
  for (let index = 0; index < lines.length; index += perGroup) {
    packed.push(lines.slice(index, index + perGroup).join(" "));
  }
  return packed;
}

function drawInvisibleLines(
  page: PDFPage,
  font: PDFFont,
  lines: string[],
): void {
  const { width, height } = page.getSize();
  const margin = Math.min(width, height) * MARGIN_RATIO;
  const usableWidth = Math.max(1, width - margin * 2);
  const usableHeight = Math.max(1, height - margin * 2);
  const fitted = packLines(lines, usableHeight / MIN_LINE_HEIGHT);
  const lineHeight = usableHeight / fitted.length;
  const baseSize = Math.min(
    MAX_FONT_SIZE,
    Math.max(MIN_FONT_SIZE, lineHeight / 1.2),
  );

  // Tr is text state, not graphics state: pdf-lib wraps each drawText in q/Q,
  // so a mode set here outlives every call until it is reset below.
  page.pushOperators(setTextRenderingMode(TextRenderingMode.Invisible));
  fitted.forEach((line, index) => {
    let size = baseSize;
    const measured = font.widthOfTextAtSize(line, size);
    if (measured > usableWidth) {
      size = Math.max(MIN_FONT_SIZE, (size * usableWidth) / measured);
    }
    const baseline =
      height - margin - lineHeight * (index + 1) + (lineHeight - size) / 2;
    page.drawText(line, {
      x: margin,
      y: baseline,
      size,
      font,
      color: rgb(0, 0, 0),
    });
  });
  page.pushOperators(setTextRenderingMode(TextRenderingMode.Fill));
}

function drawVisibleLines(
  page: PDFPage,
  font: PDFFont,
  lines: string[],
): void {
  const { width, height } = page.getSize();
  const margin = Math.min(width, height) * MARGIN_RATIO;
  const usableWidth = Math.max(1, width - margin * 2);
  const usableHeight = Math.max(1, height - margin * 2);
  const fitted = packLines(lines, usableHeight / MIN_LINE_HEIGHT);
  const lineHeight = usableHeight / fitted.length;
  const baseSize = Math.min(
    MAX_FONT_SIZE,
    Math.max(MIN_FONT_SIZE, lineHeight / 1.2),
  );

  fitted.forEach((line, index) => {
    let size = baseSize;
    const measured = font.widthOfTextAtSize(line, size);
    if (measured > usableWidth) {
      size = Math.max(MIN_FONT_SIZE, (size * usableWidth) / measured);
    }
    const baseline =
      height - margin - lineHeight * (index + 1) + (lineHeight - size) / 2;
    page.drawText(line, {
      x: margin,
      y: baseline,
      size,
      font,
      color: rgb(0, 0, 0),
    });
  });
}

/**
 * Build a disposable, text-only PDF from OCR output. This gives structural
 * converters a real text document to cross-check when an image-only source is
 * unsupported. It is never a replacement for the retained source PDF.
 */
export async function createOcrTextCompanionPdf({
  pages,
  fontBytes,
}: {
  pages: OcrTextLayerPage[];
  /** Override the bundled font; tests and callers with their own glyph set. */
  fontBytes?: Uint8Array;
}): Promise<OcrTextLayerResult> {
  const skippedPages: number[] = [];
  const planned = pages
    .map((page) => ({
      pageNumber: page.pageNumber,
      lines: ocrTextLayerLines(page.text),
    }))
    .filter((page) => {
      const usable = Number.isInteger(page.pageNumber) && page.lines.length > 0;
      if (!usable) skippedPages.push(page.pageNumber);
      return usable;
    })
    .sort((left, right) => left.pageNumber - right.pageNumber);

  const document = await PDFDocument.create();
  document.registerFontkit(fontkit as never);
  const font = await document.embedFont(fontBytes ?? loadTextLayerFont(), {
    subset: true,
  });

  for (const { pageNumber, lines } of planned) {
    const page = document.addPage([612, 792]);
    drawVisibleLines(page, font, [`Page ${pageNumber}`, ...lines]);
  }

  return {
    bytes: await document.save(),
    pagesWritten: planned.length,
    skippedPages,
  };
}

/**
 * Add an invisible text layer to the given pages. Pages outside the PDF or
 * without usable text are reported in `skippedPages`. The input bytes are
 * returned unchanged when nothing was written.
 */
export async function embedOcrTextLayer({
  pdf,
  pages,
  fontBytes,
}: {
  pdf: Uint8Array;
  pages: OcrTextLayerPage[];
  /** Override the bundled font; tests and callers with their own glyph set. */
  fontBytes?: Uint8Array;
}): Promise<OcrTextLayerResult> {
  const skippedPages: number[] = [];
  const planned: Array<{ pageNumber: number; lines: string[] }> = [];
  for (const page of pages) {
    const lines = ocrTextLayerLines(page.text);
    if (lines.length === 0 || !Number.isInteger(page.pageNumber)) {
      skippedPages.push(page.pageNumber);
      continue;
    }
    planned.push({ pageNumber: page.pageNumber, lines });
  }
  if (planned.length === 0) {
    return { bytes: pdf, pagesWritten: 0, skippedPages };
  }

  const document = await PDFDocument.load(pdf, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  document.registerFontkit(fontkit as never);
  const font = await document.embedFont(fontBytes ?? loadTextLayerFont(), {
    subset: true,
  });
  const pdfPages = document.getPages();

  let pagesWritten = 0;
  for (const { pageNumber, lines } of planned) {
    const target = pdfPages[pageNumber - 1];
    if (!target) {
      skippedPages.push(pageNumber);
      continue;
    }
    drawInvisibleLines(target, font, lines);
    pagesWritten += 1;
  }
  if (pagesWritten === 0) {
    return { bytes: pdf, pagesWritten, skippedPages };
  }
  return { bytes: await document.save(), pagesWritten, skippedPages };
}

/**
 * Whether a page's existing extracted text is real content rather than the
 * empty or placeholder text a scan yields. Pages that already carry a text
 * layer must not get a second one: extractors would return every word twice.
 */
export function hasUsableTextLayer(existingText: string | undefined): boolean {
  if (!existingText) return false;
  const trimmed = existingText.trim();
  if (!trimmed || trimmed.startsWith("[PDF text extraction failed")) {
    return false;
  }
  return trimmed.split(/\s+/).filter(Boolean).length >= 5;
}
