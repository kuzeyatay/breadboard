// Writes OCR output back into a PDF as an invisible text layer.
//
// The VLM and handwriting OCR paths transcribe page images into Markdown for
// the source note, but the saved PDF stayed a bare scan: nothing to search,
// select, or copy in any other viewer. This module paints each page's OCR
// text onto the page in text rendering mode 3 (invisible), which is how
// ocrmypdf and every "searchable PDF" scanner make a scan searchable. The
// pixels are untouched; text extractors and viewers see the words.
//
// A page that comes with spotted lines (text plus a box from the VLM's
// `spotting_json` pass) gets each line painted over the printed one, sized to
// the box and stretched to its width, so a viewer's selection highlight lands
// on the words themselves. A page with text but no boxes falls back to evenly
// spaced lines down the page: search and copy still work and reading order is
// kept, but a hit only lands on the right page, not the exact word.
//
// The module only knows pdf-lib and one Unicode font; it never touches the
// garden, so it can be unit tested against a synthetic PDF.

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import {
  degrees,
  PDFDocument,
  type PDFFont,
  PDFNumber,
  PDFOperator,
  PDFOperatorNames,
  type PDFPage,
  rgb,
  setTextRenderingMode,
  TextRenderingMode,
} from "@cantoo/pdf-lib";
import * as fontkit from "fontkit";

export interface OcrTextLine {
  /**
   * `[xmin, ymin, xmax, ymax]` as fractions of the page as a viewer shows it
   * (rotation applied, y down) — the space the VLM's spotting boxes come in.
   */
  box: [number, number, number, number];
  text: string;
}

export interface OcrTextLayerPage {
  /** 1-based page number in the PDF. */
  pageNumber: number;
  /** OCR output for the page, Markdown or plain text. */
  text: string;
  /**
   * Spotted lines with their boxes. When present and usable they replace
   * `text` as the layer's content, placed where each line was printed.
   */
  lines?: OcrTextLine[];
}

export interface OcrTextLayerResult {
  /** The PDF with the layer added, or the input bytes when no page changed. */
  bytes: Uint8Array;
  pagesWritten: number;
  /** Pages whose layer follows spotted boxes rather than an even spread. */
  positionedPages: number;
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

/** Glyph height of the layer font relative to its size (ascent + descent). */
const FONT_EM_HEIGHT = 1.15;
/** Share of the font size below the baseline. */
const FONT_DESCENT = 0.21;
/** Bounds for stretching a line to its box (Tz, percent). */
const MIN_H_SCALE = 25;
const MAX_H_SCALE = 400;

interface PageFrame {
  /** Crop box origin and size in PDF user space. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** 0 | 90 | 180 | 270, clockwise, as a viewer applies it. */
  rotation: number;
}

function pageFrame(page: PDFPage): PageFrame {
  const crop = page.getCropBox();
  const angle = page.getRotation().angle;
  const rotation = (((Math.round(angle / 90) * 90) % 360) + 360) % 360;
  return {
    x: crop.x,
    y: crop.y,
    width: crop.width,
    height: crop.height,
    rotation,
  };
}

/**
 * Map a point on the page as a viewer shows it (fractions, y down) into PDF
 * user space. Viewers render the crop box rotated by /Rotate, which is the
 * image the spotting boxes were measured on.
 */
function viewToPage(
  frame: PageFrame,
  u: number,
  v: number,
): { x: number; y: number } {
  const { x, y, width: w, height: h, rotation } = frame;
  // A quarter turn swaps the displayed width and height.
  const dw = rotation % 180 === 0 ? w : h;
  const dh = rotation % 180 === 0 ? h : w;
  const dx = u * dw;
  const dy = v * dh;
  switch (rotation) {
    case 90:
      return { x: x + dy, y: y + dx };
    case 180:
      return { x: x + (w - dx), y: y + dy };
    case 270:
      return { x: x + (w - dy), y: y + (h - dx) };
    default:
      return { x: x + dx, y: y + (h - dy) };
  }
}

function horizontalScaling(percent: number): PDFOperator {
  return PDFOperator.of(PDFOperatorNames.SetTextHorizontalScaling, [
    PDFNumber.of(percent),
  ]);
}

/**
 * Paint each spotted line invisibly over its box. The font size follows the
 * box height and Tz stretches the run to the box width, so the extractor's
 * word positions — and a viewer's selection highlight — match the print.
 * Returns how many lines were drawn.
 */
function drawPositionedInvisibleLines(
  page: PDFPage,
  font: PDFFont,
  lines: OcrTextLine[],
): number {
  const frame = pageFrame(page);
  const dw = frame.rotation % 180 === 0 ? frame.width : frame.height;
  const dh = frame.rotation % 180 === 0 ? frame.height : frame.width;

  page.pushOperators(setTextRenderingMode(TextRenderingMode.Invisible));
  let drawn = 0;
  for (const line of lines) {
    const [u0, v0, u1, v1] = line.box;
    const boxWidth = (u1 - u0) * dw;
    const boxHeight = (v1 - v0) * dh;
    if (boxWidth <= 0 || boxHeight <= 0) continue;
    const size = Math.max(MIN_FONT_SIZE, boxHeight / FONT_EM_HEIGHT);
    const natural = font.widthOfTextAtSize(line.text, size);
    if (natural <= 0) continue;
    const scale = Math.min(
      MAX_H_SCALE,
      Math.max(MIN_H_SCALE, (boxWidth / natural) * 100),
    );
    // The baseline sits one descent above the box bottom, at its left edge.
    const baseline = viewToPage(frame, u0, v1 - (size * FONT_DESCENT) / dh);
    page.pushOperators(horizontalScaling(scale));
    page.drawText(line.text, {
      x: baseline.x,
      y: baseline.y,
      size,
      font,
      color: rgb(0, 0, 0),
      rotate: degrees(frame.rotation),
    });
    drawn += 1;
  }
  page.pushOperators(horizontalScaling(100));
  page.pushOperators(setTextRenderingMode(TextRenderingMode.Fill));
  return drawn;
}

/** Spotted lines a layer can use: non-empty text inside a real box. */
export function usableOcrTextLines(
  lines: OcrTextLine[] | undefined,
): OcrTextLine[] {
  if (!lines) return [];
  const usable: OcrTextLine[] = [];
  for (const line of lines) {
    const text = line.text
      .replace(/\p{Cc}/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    const box = line.box.map((value) =>
      Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0)),
    ) as [number, number, number, number];
    if (box[2] <= box[0] || box[3] <= box[1]) continue;
    usable.push({ box, text });
  }
  return usable;
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
    positionedPages: 0,
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
  const planned: Array<{
    pageNumber: number;
    lines: string[];
    spotted: OcrTextLine[];
  }> = [];
  for (const page of pages) {
    const spotted = usableOcrTextLines(page.lines);
    const lines = spotted.length > 0 ? [] : ocrTextLayerLines(page.text);
    if (
      (lines.length === 0 && spotted.length === 0) ||
      !Number.isInteger(page.pageNumber)
    ) {
      skippedPages.push(page.pageNumber);
      continue;
    }
    planned.push({ pageNumber: page.pageNumber, lines, spotted });
  }
  if (planned.length === 0) {
    return { bytes: pdf, pagesWritten: 0, positionedPages: 0, skippedPages };
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
  let positionedPages = 0;
  for (const { pageNumber, lines, spotted } of planned) {
    const target = pdfPages[pageNumber - 1];
    if (!target) {
      skippedPages.push(pageNumber);
      continue;
    }
    if (spotted.length > 0) {
      if (drawPositionedInvisibleLines(target, font, spotted) > 0) {
        positionedPages += 1;
        pagesWritten += 1;
        continue;
      }
      // Every box collapsed at this page's size; spread the words instead.
      const fallback = ocrTextLayerLines(
        spotted.map((line) => line.text).join("\n"),
      );
      if (fallback.length === 0) {
        skippedPages.push(pageNumber);
        continue;
      }
      drawInvisibleLines(target, font, fallback);
      pagesWritten += 1;
      continue;
    }
    drawInvisibleLines(target, font, lines);
    pagesWritten += 1;
  }
  if (pagesWritten === 0) {
    return { bytes: pdf, pagesWritten, positionedPages, skippedPages };
  }
  return {
    bytes: await document.save(),
    pagesWritten,
    positionedPages,
    skippedPages,
  };
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
