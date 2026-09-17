// Independent review of source figure crops against their full page.
//
// The page detector returns one bbox per figure, graph, diagram, or table.
// Nothing else ever compared the resulting crop with the page, so a box placed
// on the wrong part of a slide (or cutting a figure in half) was embedded in
// lessons as-is. This review shows the model the page plus every crop, asks
// whether each crop holds the whole captioned visual without slicing through
// printed content, and accepts a corrected bbox for a bounded number of rounds.
// Equations are reviewed by the source-formula review and are never handled here.

import crypto from "crypto";
import { breadSystemPrompt } from "./assistant-identity.ts";
import { cropPng, decodePng, resizePngToMaxDimension } from "./png-crop.ts";

export type FigureCropVisualType = "figure" | "diagram" | "graph" | "table";

export interface FigureCropBBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FigureCropCandidate {
  /** Index of the detection on its page; identities are allocated from it. */
  detectionIndex: number;
  type: FigureCropVisualType;
  caption: string;
  bbox: FigureCropBBox;
}

export type FigureCropReviewStatus = "approved" | "corrected" | "rejected" | "unreviewed";

export interface FigureCropReviewOutcome {
  detectionIndex: number;
  status: FigureCropReviewStatus;
  /** The bbox the accepted crop was cut from (absent when rejected). */
  bbox?: FigureCropBBox;
  reason: string;
  rounds: number;
}

export interface FigureCropReviewReceipt {
  version: typeof FIGURE_CROP_REVIEW_VERSION;
  cacheKey: string;
  model: string;
  outcomes: FigureCropReviewOutcome[];
  modelCalls: number;
}

export interface CropEdgeInk {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
}

export type FigureCropReviewMessageContent = Array<
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail: "high" | "low" } }
>;

/** Sends one review request and returns the raw model text. */
export type FigureCropReviewCompletion = (request: {
  system: string;
  content: FigureCropReviewMessageContent;
  stageLabel: string;
}) => Promise<string>;

export const FIGURE_CROP_REVIEW_VERSION = 1 as const;
export const FIGURE_CROP_REVIEW_MAX_ROUNDS = 3;
/** One page image plus at most this many crops keeps a request under the
 * provider's per-message image limit. */
export const FIGURE_CROP_REVIEW_MAX_CROPS_PER_REQUEST = 8;
const REVIEW_PAGE_IMAGE_MAX_DIMENSION = 1400;
const REVIEW_MAX_PROTOCOL_ATTEMPTS = 2;

export const FIGURE_CROP_REVIEW_SYSTEM_PROMPT = breadSystemPrompt(`You verify source figure crops for an educational garden.

You receive the full PAGE IMAGE and one labeled CROP for each detected figure, graph, diagram, or table. Each crop comes with the detector's caption, its bbox (fractions of the page, 0..1, from the top-left corner), and the sides where printed content touches the crop edge ("contentTouchesEdge"), measured from the pixels.

For every crop, compare it with the page and decide:
- "complete": the crop shows the entire visual the caption describes (every node, arrow, axis, label, legend, and its printed caption when it has one), and no side slices through printed content. A little whitespace or a whole neighbouring element is acceptable; half a word or half a shape is not.
- "clipped": the crop shows the right visual but cuts part of it off, or slices through neighbouring printed text or graphics. Return a corrected bbox that includes the whole visual and either fully includes or fully excludes anything it would otherwise cut.
- "wrong_region": the crop shows a different part of the page than the caption describes, and that visual IS on the page. Return the bbox of the described visual.
- "not_on_page": the described visual cannot be found on this page.

Return ONLY one JSON object:
{"reviews":[{"crop":"exact supplied crop label","verdict":"complete|clipped|wrong_region|not_on_page","bbox":{"x":0.1,"y":0.2,"width":0.5,"height":0.3},"reason":"specific visual evidence"}]}

Rules:
- Return exactly one review for every supplied crop label and no others.
- bbox is required for clipped and wrong_region, and must be omitted otherwise.
- Measure bbox on the PAGE IMAGE, as fractions of its full width (x, width) and full height (y, height). It must lie inside the page and tightly enclose the visual including its printed caption.
- Judge only geometry. Do not rewrite captions.`);

/** Small, uniform padding around a reviewed bbox. Unlike the detector's
 * expansion there is no minimum crop size, so a small diagram is never widened
 * into the text beside it. */
export function tightFigureCropBBox(bbox: FigureCropBBox, type: FigureCropVisualType): FigureCropBBox {
  const pad = type === "table" ? 0.02 : 0.015;
  const x0 = Math.max(0, bbox.x - pad);
  const y0 = Math.max(0, bbox.y - pad);
  const x1 = Math.min(1, bbox.x + bbox.width + pad);
  const y1 = Math.min(1, bbox.y + bbox.height + pad);
  return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
}

/**
 * Which crop edges run through printed content. The background is the most
 * common colour in the crop; an edge is inked when enough of its outermost
 * pixels differ strongly from it. This is evidence for the reviewer, not a
 * verdict: scanned book pages carry grain and neighbouring text.
 */
export function cropEdgeInk(png: Buffer): CropEdgeInk {
  const none = { top: false, right: false, bottom: false, left: false };
  const decoded = decodePng(png);
  if (!decoded || decoded.width < 8 || decoded.height < 8) return none;
  const { width, height, channels, pixels } = decoded;
  const colorAt = (x: number, y: number): [number, number, number] => {
    const offset = (y * width + x) * channels;
    if (channels <= 2) {
      const gray = pixels[offset]!;
      return [gray, gray, gray];
    }
    return [pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!];
  };
  const counts = new Map<number, { count: number; color: [number, number, number] }>();
  const step = Math.max(1, Math.floor(Math.min(width, height) / 64));
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const color = colorAt(x, y);
      const key = ((color[0] >> 4) << 8) | ((color[1] >> 4) << 4) | (color[2] >> 4);
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { count: 1, color });
    }
  }
  let background: [number, number, number] = [255, 255, 255];
  let best = -1;
  for (const entry of counts.values()) {
    if (entry.count > best) {
      best = entry.count;
      background = entry.color;
    }
  }
  const inked = (x: number, y: number): boolean => {
    const color = colorAt(x, y);
    return Math.max(
      Math.abs(color[0] - background[0]),
      Math.abs(color[1] - background[1]),
      Math.abs(color[2] - background[2]),
    ) > 72;
  };
  const edgeInked = (length: number, at: (index: number) => [number, number]): boolean => {
    let ink = 0;
    for (let index = 0; index < length; index += 1) {
      const [x, y] = at(index);
      if (inked(x, y)) ink += 1;
    }
    return ink >= Math.max(3, Math.ceil(length * 0.01));
  };
  return {
    top: edgeInked(width, (index) => [index, 0]),
    bottom: edgeInked(width, (index) => [index, height - 1]),
    left: edgeInked(height, (index) => [0, index]),
    right: edgeInked(height, (index) => [width - 1, index]),
  };
}

export function isFigureCropVisualType(type: string): type is FigureCropVisualType {
  return type === "figure" || type === "diagram" || type === "graph" || type === "table";
}

export function figureCropReviewCacheKey(input: {
  model: string;
  pageFingerprint: string;
  candidates: readonly FigureCropCandidate[];
}): string {
  return crypto.createHash("sha256").update(JSON.stringify({
    version: FIGURE_CROP_REVIEW_VERSION,
    systemPromptSha256: crypto.createHash("sha256").update(FIGURE_CROP_REVIEW_SYSTEM_PROMPT).digest("hex"),
    model: input.model,
    pageFingerprint: input.pageFingerprint,
    candidates: input.candidates.map((candidate) => ({
      detectionIndex: candidate.detectionIndex,
      type: candidate.type,
      caption: candidate.caption,
      bbox: candidate.bbox,
    })),
  })).digest("hex");
}

export function figureCropReviewReceiptMatches(
  receipt: FigureCropReviewReceipt | undefined,
  cacheKey: string,
  candidates: readonly FigureCropCandidate[],
): receipt is FigureCropReviewReceipt {
  if (!receipt || receipt.version !== FIGURE_CROP_REVIEW_VERSION || receipt.cacheKey !== cacheKey) return false;
  if (!Array.isArray(receipt.outcomes) || receipt.outcomes.length !== candidates.length) return false;
  return candidates.every((candidate) => receipt.outcomes.some((outcome) =>
    outcome.detectionIndex === candidate.detectionIndex &&
    (outcome.status === "rejected" || validBBox(outcome.bbox))));
}

function validBBox(value: unknown): value is FigureCropBBox {
  if (!value || typeof value !== "object") return false;
  const { x, y, width, height } = value as Record<string, unknown>;
  return [x, y, width, height].every((n) => typeof n === "number" && Number.isFinite(n)) &&
    (x as number) >= 0 && (y as number) >= 0 && (width as number) > 0.005 && (height as number) > 0.005 &&
    (x as number) + (width as number) <= 1.0005 && (y as number) + (height as number) <= 1.0005;
}

interface ParsedReview {
  verdict: "complete" | "clipped" | "wrong_region" | "not_on_page";
  bbox?: FigureCropBBox;
  reason: string;
}

function jsonObjectCandidate(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const text = fenced?.[1] ?? trimmed;
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("the response is not a JSON object");
    return JSON.parse(text.slice(start, end + 1));
  }
}

/** Parse one response, keyed by crop label. Throws a readable diagnostic. */
export function parseFigureCropReviewResponse(raw: string, labels: readonly string[]): Map<string, ParsedReview> {
  let parsed: unknown;
  try {
    parsed = jsonObjectCandidate(raw);
  } catch (error) {
    throw new Error(`crop review response is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const reviews = (parsed as { reviews?: unknown })?.reviews;
  if (!Array.isArray(reviews)) throw new Error('crop review response has no "reviews" array');
  const expected = new Set(labels);
  const result = new Map<string, ParsedReview>();
  for (const entry of reviews) {
    const record = entry as Record<string, unknown>;
    const label = typeof record?.crop === "string" ? record.crop : "";
    if (!expected.has(label)) throw new Error(`crop review returned an unknown crop label ${JSON.stringify(label)}`);
    if (result.has(label)) throw new Error(`crop review returned ${label} twice`);
    const verdict = record.verdict;
    if (verdict !== "complete" && verdict !== "clipped" && verdict !== "wrong_region" && verdict !== "not_on_page") {
      throw new Error(`crop review for ${label} has an invalid verdict`);
    }
    const reason = typeof record.reason === "string" ? record.reason.trim() : "";
    if (!reason) throw new Error(`crop review for ${label} has no reason`);
    if (verdict === "clipped" || verdict === "wrong_region") {
      if (!validBBox(record.bbox)) throw new Error(`crop review for ${label} needs a valid in-page bbox for ${verdict}`);
      const bbox = record.bbox as FigureCropBBox;
      result.set(label, { verdict, reason, bbox: { x: bbox.x, y: bbox.y, width: Math.min(bbox.width, 1 - bbox.x), height: Math.min(bbox.height, 1 - bbox.y) } });
    } else {
      result.set(label, { verdict, reason });
    }
  }
  const missing = labels.filter((label) => !result.has(label));
  if (missing.length) throw new Error(`crop review omitted ${missing.join(", ")}`);
  return result;
}

/**
 * Review every figure crop on one page. Rounds are bounded: a crop the model
 * still reports as clipped or misplaced after the last round, or one it cannot
 * find, is rejected rather than embedded.
 */
export async function reviewFigureCropsOnPage(input: {
  model: string;
  pageImage: Buffer;
  pageFingerprint: string;
  pageNumber: number;
  candidates: readonly FigureCropCandidate[];
  complete: FigureCropReviewCompletion;
  checkpoint?: () => void;
}): Promise<FigureCropReviewReceipt> {
  const cacheKey = figureCropReviewCacheKey(input);
  const reviewPage = resizePngToMaxDimension(input.pageImage, REVIEW_PAGE_IMAGE_MAX_DIMENSION) ?? input.pageImage;
  const pageUrl = `data:image/png;base64,${reviewPage.toString("base64")}`;
  const outcomes = new Map<number, FigureCropReviewOutcome>();
  let pending = input.candidates.map((candidate) => ({ candidate, bbox: candidate.bbox, lastReason: "" }));
  let modelCalls = 0;

  for (let round = 1; round <= FIGURE_CROP_REVIEW_MAX_ROUNDS && pending.length > 0; round += 1) {
    const next: typeof pending = [];
    for (let start = 0; start < pending.length; start += FIGURE_CROP_REVIEW_MAX_CROPS_PER_REQUEST) {
      input.checkpoint?.();
      const batch = pending.slice(start, start + FIGURE_CROP_REVIEW_MAX_CROPS_PER_REQUEST);
      const items = batch.map((item, offset) => {
        const crop = cropPng(input.pageImage, tightFigureCropBBox(item.bbox, item.candidate.type));
        const edges = crop ? cropEdgeInk(crop) : { top: false, right: false, bottom: false, left: false };
        return {
          item,
          label: `crop-${start + offset + 1}`,
          crop,
          touches: (Object.keys(edges) as Array<keyof CropEdgeInk>).filter((side) => edges[side]),
        };
      });
      const labels = items.map((entry) => entry.label);
      const content: FigureCropReviewMessageContent = [
        {
          type: "text",
          text: JSON.stringify({
            task: "Review each crop against the full page image. Return the JSON object described in the system prompt.",
            pageNumber: input.pageNumber,
            round,
            crops: items.map((entry) => ({
              crop: entry.label,
              type: entry.item.candidate.type,
              caption: entry.item.candidate.caption,
              bbox: entry.item.bbox,
              contentTouchesEdge: entry.crop ? entry.touches : ["crop could not be cut from this bbox"],
              ...(entry.item.lastReason ? { previousReviewReason: entry.item.lastReason } : {}),
            })),
          }),
        },
        { type: "text", text: "PAGE IMAGE:" },
        { type: "image_url", image_url: { url: pageUrl, detail: "high" } },
      ];
      for (const entry of items) {
        content.push({ type: "text", text: `${entry.label}:` });
        if (entry.crop) {
          content.push({ type: "image_url", image_url: { url: `data:image/png;base64,${entry.crop.toString("base64")}`, detail: "high" } });
        } else {
          content.push({ type: "text", text: "(no crop could be cut from this bbox)" });
        }
      }

      let parsed: Map<string, ParsedReview> | null = null;
      let diagnostic = "";
      for (let attempt = 1; attempt <= REVIEW_MAX_PROTOCOL_ATTEMPTS && !parsed; attempt += 1) {
        const attemptContent = attempt === 1
          ? content
          : [...content, { type: "text" as const, text: `The previous response was rejected: ${diagnostic}. Return a complete corrected JSON object for every crop label.` }];
        modelCalls += 1;
        const raw = await input.complete({
          system: FIGURE_CROP_REVIEW_SYSTEM_PROMPT,
          content: attemptContent,
          stageLabel: `figure crop review for page ${input.pageNumber} (round ${round})`,
        });
        if (!raw.trim()) {
          // The transport gave up (bounded timeouts/502s) and handed back
          // nothing: the page keeps its detector crops, marked unreviewed.
          for (const entry of items) {
            outcomes.set(entry.item.candidate.detectionIndex, {
              detectionIndex: entry.item.candidate.detectionIndex,
              status: "unreviewed",
              bbox: entry.item.bbox,
              reason: "crop review did not complete; detector crop kept",
              rounds: round,
            });
          }
          parsed = new Map();
          break;
        }
        try {
          parsed = parseFigureCropReviewResponse(raw, labels);
        } catch (error) {
          diagnostic = error instanceof Error ? error.message : String(error);
        }
      }
      if (!parsed) {
        throw new Error(`Figure crop review for page ${input.pageNumber} returned no valid response: ${diagnostic}`);
      }

      for (const entry of items) {
        const review = parsed.get(entry.label);
        const { candidate } = entry.item;
        if (!review) continue; // review unavailable: outcome already recorded
        if (review.verdict === "complete" && entry.crop) {
          outcomes.set(candidate.detectionIndex, {
            detectionIndex: candidate.detectionIndex,
            status: round === 1 ? "approved" : "corrected",
            bbox: entry.item.bbox,
            reason: review.reason,
            rounds: round,
          });
        } else if (review.verdict === "not_on_page" || !review.bbox) {
          outcomes.set(candidate.detectionIndex, {
            detectionIndex: candidate.detectionIndex,
            status: "rejected",
            reason: review.reason,
            rounds: round,
          });
        } else {
          next.push({ candidate, bbox: review.bbox, lastReason: review.reason });
        }
      }
    }
    pending = next;
  }
  for (const item of pending) {
    outcomes.set(item.candidate.detectionIndex, {
      detectionIndex: item.candidate.detectionIndex,
      status: "rejected",
      reason: `Still reported as clipped or misplaced after ${FIGURE_CROP_REVIEW_MAX_ROUNDS} review rounds: ${item.lastReason}`,
      rounds: FIGURE_CROP_REVIEW_MAX_ROUNDS,
    });
  }

  return {
    version: FIGURE_CROP_REVIEW_VERSION,
    cacheKey,
    model: input.model,
    outcomes: input.candidates.map((candidate) => outcomes.get(candidate.detectionIndex)!),
    modelCalls,
  };
}
