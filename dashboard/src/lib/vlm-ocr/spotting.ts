// Text spotting for the OCR text layer.
//
// `doc_parse` gives the words of a page but not where they sit, so a text
// layer built from it can only be laid out as evenly spaced lines. HunyuanOCR's
// `spotting_json` task answers the other half: every text line with its box,
// normalized to [0, 1000] on the rendered page image. Run after a parse, it
// lets the invisible layer put each line over the printed one, which is what
// makes a viewer's selection highlight land on the words themselves.
//
// The model's reply is JSON in the happy case. Greedy decoding on a dense
// page can still trail off mid-array, so the parser also salvages complete
// `{box, text}` objects out of a reply that is not valid JSON as a whole.

import { runVlmOcrPage } from "./client.ts";
import type { VlmOcrConfig } from "./config.ts";
import { VLM_OCR_SPOTTING_PROMPT } from "./prompts.ts";

export interface SpottedTextLine {
  /** `[xmin, ymin, xmax, ymax]` as fractions of the rendered page, y down. */
  box: [number, number, number, number];
  text: string;
}

/** Coordinate space HunyuanOCR normalizes boxes into. */
const COORD_SCALE = 1000;

/** One complete `{"box": [...], "text": "..."}` object, for a cut-off reply. */
const OBJECT_RE =
  /\{\s*"box"\s*:\s*\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]\s*,\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"\s*\}/g;

function clampCoord(value: number): number {
  if (!Number.isFinite(value)) return Number.NaN;
  return Math.min(1, Math.max(0, value / COORD_SCALE));
}

function lineFromParts(
  raw: [unknown, unknown, unknown, unknown],
  text: unknown,
): SpottedTextLine | null {
  if (typeof text !== "string") return null;
  const cleaned = text.replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  const numbers = raw.map((value) =>
    clampCoord(typeof value === "number" ? value : Number(value)),
  );
  if (numbers.some((value) => Number.isNaN(value))) return null;
  const [x0, y0, x1, y1] = numbers;
  const box: [number, number, number, number] = [
    Math.min(x0, x1),
    Math.min(y0, y1),
    Math.max(x0, x1),
    Math.max(y0, y1),
  ];
  // A degenerate box cannot hold text; a page-sized one is the model giving
  // up on layout, and evenly spaced lines serve that page better.
  if (box[2] - box[0] <= 0 || box[3] - box[1] <= 0) return null;
  if (box[2] - box[0] > 0.98 && box[3] - box[1] > 0.9) return null;
  return { box, text: cleaned };
}

function stripFence(text: string): string {
  const trimmed = text.trim();
  const match = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/i.exec(trimmed);
  return match ? match[1] ?? "" : trimmed;
}

function parseWholeArray(text: string): SpottedTextLine[] | null {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const lines: SpottedTextLine[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const box = (entry as { box?: unknown }).box;
    if (!Array.isArray(box) || box.length !== 4) continue;
    const line = lineFromParts(
      box as [unknown, unknown, unknown, unknown],
      (entry as { text?: unknown }).text,
    );
    if (line) lines.push(line);
  }
  return lines;
}

function salvageObjects(text: string): SpottedTextLine[] {
  const lines: SpottedTextLine[] = [];
  for (const match of text.matchAll(OBJECT_RE)) {
    let value: string;
    try {
      value = JSON.parse(`"${match[5]}"`) as string;
    } catch {
      continue;
    }
    const line = lineFromParts([match[1], match[2], match[3], match[4]], value);
    if (line) lines.push(line);
  }
  return lines;
}

/**
 * Turn a `spotting_json` reply into lines. Reading order is the model's own:
 * the prompt asks for top-to-bottom, left-to-right, and reordering by box
 * would break multi-column pages it got right.
 */
export function parseSpottingReply(raw: string): SpottedTextLine[] {
  const text = stripFence(raw);
  const whole = parseWholeArray(text);
  if (whole && whole.length > 0) return whole;
  return salvageObjects(text);
}

export type SpottingRunner = (input: {
  config: VlmOcrConfig;
  dataUrl: string;
  prompt: string;
  signal?: AbortSignal;
}) => Promise<{ text: string }>;

/**
 * Spot the text lines of one rendered page. Failures are the caller's to
 * handle: a page without boxes still gets an evenly spaced layer.
 */
export async function spotPageTextLines({
  config,
  dataUrl,
  signal,
  runner = runVlmOcrPage,
}: {
  config: VlmOcrConfig;
  dataUrl: string;
  signal?: AbortSignal;
  runner?: SpottingRunner;
}): Promise<SpottedTextLine[]> {
  const result = await runner({
    config,
    dataUrl,
    prompt: VLM_OCR_SPOTTING_PROMPT,
    signal,
  });
  return parseSpottingReply(result.text);
}
