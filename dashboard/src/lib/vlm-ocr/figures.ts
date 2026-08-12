// Figure extraction for the VLM parse option.
//
// HunyuanOCR's `doc_parse` task transcribes body text, tables and formulas —
// it does not describe pictures. What it does emit, on its own, is the bounding
// box of a picture as a bare coordinate line:
//
//     (147,90),(925,415)
//
// Upstream's pattern U deletes those lines as benchmark noise. For a reader
// they are the opposite of noise: they say exactly where the figure is on the
// page. So before that cleanup runs, each bare box is cropped out of the page
// snapshot and embedded as a real image.
//
// Only *bare* boxes are treated as figures. A box trailing a line of text could
// just as easily be that text's own bounding box, and cropping it would put a
// picture of a sentence into the document; those keep upstream's behaviour of
// dropping the coordinates and keeping the words.
//
// Coordinates are normalized to [0, 1000], the convention HunyuanOCR uses
// throughout (see the `spotting_json` prompt). A page whose numbers fall
// outside that range is left alone rather than guessed at.

import { cropPng } from "../png-crop.ts";

export interface FigureBox {
  /** Fractions of the page, matching what `cropPng` expects. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectedFigure {
  lineIndex: number;
  box: FigureBox;
  /** Nearby caption text, when the page has one. */
  caption: string;
}

/** Coordinate space HunyuanOCR normalizes boxes into. */
const COORD_SCALE = 1000;

/** A whole line that is nothing but one or more coordinate pairs. */
const BARE_COORD_LINE =
  /^[ \t]*(?:\(\d{1,4},\d{1,4}\),\(\d{1,4},\d{1,4}\)[ \t,，]*)+$/;

const COORD_PAIR_GLOBAL =
  /\((\d{1,4}),(\d{1,4})\),\((\d{1,4}),(\d{1,4})\)/g;

const CAPTION_PREFIX =
  /^\s*(?:图\s*\d|表\s*\d|figure\s*\d|fig\.?\s*\d|chart\s*\d|diagram\s*\d)/i;

/**
 * A crop has to be big enough to be worth showing and small enough to be a
 * figure rather than the whole page.
 */
function isPlausibleFigure(box: FigureBox): boolean {
  if (box.width <= 0 || box.height <= 0) return false;
  if (box.width < 0.05 || box.height < 0.03) return false;
  if (box.width > 0.99 && box.height > 0.97) return false;
  return true;
}

function boxFromPairs(pairs: number[][]): FigureBox | null {
  if (pairs.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x1, y1, x2, y2] of pairs) {
    if ([x1, y1, x2, y2].some((value) => value > COORD_SCALE)) return null;
    minX = Math.min(minX, x1, x2);
    minY = Math.min(minY, y1, y2);
    maxX = Math.max(maxX, x1, x2);
    maxY = Math.max(maxY, y1, y2);
  }

  const box: FigureBox = {
    x: minX / COORD_SCALE,
    y: minY / COORD_SCALE,
    width: (maxX - minX) / COORD_SCALE,
    height: (maxY - minY) / COORD_SCALE,
  };
  return isPlausibleFigure(box) ? box : null;
}

/** First non-blank line in `step` direction from `lineIndex`. */
function nearestText(lines: string[], lineIndex: number, step: number): string {
  for (
    let i = lineIndex + step;
    i >= 0 && i < lines.length && Math.abs(i - lineIndex) <= 3;
    i += step
  ) {
    const trimmed = lines[i].trim();
    if (trimmed) return trimmed;
  }
  return "";
}

/**
 * Caption nearest the box. Below wins over above, which is where captions
 * usually sit; blank lines between the two are normal in the model's output
 * and do not break the association.
 */
function captionNear(lines: string[], lineIndex: number): string {
  for (const candidate of [
    nearestText(lines, lineIndex, 1),
    nearestText(lines, lineIndex, -1),
  ]) {
    if (!candidate || candidate.length > 200) continue;
    if (CAPTION_PREFIX.test(candidate)) return candidate.replace(/\s+/g, " ");
  }
  return "";
}

/** Find every bare figure box in one page of `doc_parse` output. */
export function detectFigureBoxes(text: string): DetectedFigure[] {
  const lines = text.split("\n");
  const figures: DetectedFigure[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (!BARE_COORD_LINE.test(line)) continue;

    const pairs = [...line.matchAll(COORD_PAIR_GLOBAL)].map((match) => [
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
      Number(match[4]),
    ]);
    const box = boxFromPairs(pairs);
    if (!box) continue;

    figures.push({ lineIndex, box, caption: captionNear(lines, lineIndex) });
  }

  return figures;
}

export interface SavedFigure {
  /** Garden-relative URL to embed, e.g. `/my-garden/assets/....png`. */
  path: string;
}

export type FigureSaver = (args: {
  png: Buffer;
  pageNumber: number;
  index: number;
  caption: string;
}) => SavedFigure | null;

export function pngBufferFromDataUrl(dataUrl: string): Buffer | null {
  const match = /^data:image\/png;base64,(.+)$/i.exec(dataUrl.trim());
  if (!match) return null;
  try {
    return Buffer.from(match[1], "base64");
  } catch {
    return null;
  }
}

export interface EmbedFiguresResult {
  text: string;
  /** Figures cropped and embedded. */
  embedded: number;
  /** Boxes found but not usable (crop failed, not a PNG page, save refused). */
  skipped: number;
}

/**
 * Replace each bare figure box with an image embed of that region of the page.
 * Boxes that cannot be cropped are left in place for pattern U to clean up, so
 * nothing is worse than it was before.
 */
export function embedPageFigures({
  text,
  pageNumber,
  pageDataUrl,
  saveFigure,
}: {
  text: string;
  pageNumber: number;
  pageDataUrl: string;
  saveFigure: FigureSaver;
}): EmbedFiguresResult {
  const figures = detectFigureBoxes(text);
  if (figures.length === 0) return { text, embedded: 0, skipped: 0 };

  const png = pngBufferFromDataUrl(pageDataUrl);
  if (!png) return { text, embedded: 0, skipped: figures.length };

  const lines = text.split("\n");
  let embedded = 0;
  let skipped = 0;

  figures.forEach((figure, index) => {
    const cropped = cropPng(png, figure.box);
    if (!cropped) {
      skipped += 1;
      return;
    }

    const saved = saveFigure({
      png: cropped,
      pageNumber,
      index: index + 1,
      caption: figure.caption,
    });
    if (!saved) {
      skipped += 1;
      return;
    }

    const alt = figure.caption || `Page ${pageNumber} figure ${index + 1}`;
    // Alt text is markdown-sensitive: a bracket would close the embed early.
    const safeAlt = alt.replace(/[[\]]/g, "");
    lines[figure.lineIndex] = `![${safeAlt}](${saved.path})`;
    embedded += 1;
  });

  return { text: lines.join("\n"), embedded, skipped };
}
