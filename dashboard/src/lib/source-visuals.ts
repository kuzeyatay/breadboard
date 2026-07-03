// Stage 2 of the Breadboard pipeline: source visual extraction.
//
// Before any learning page is written, every meaningful visual in an uploaded
// source (figure, graph, table, equation, diagram) becomes a first-class
// SourceVisual object: detected per page via a vision call over the stored page
// snapshots, cropped out of the snapshot PNG where possible, and tracked in a
// ledger at .breadboard/source-visuals.json.
//
// Full-page screenshots are never figures. When detection or cropping fails,
// a page is represented (at most) by a "full_page_fallback" visual, which
// downstream stages may embed only as an explicit fallback.
//
// Stage 3 (learning page planning) then assigns every visual to a page or
// intentionally skips it with a reason — nothing disappears silently.

import fs from "fs";
import path from "path";
import type OpenAI from "openai";
import { cropPng } from "./png-crop";
import { slugify } from "./tags";

export type SourceVisualType =
  | "figure"
  | "graph"
  | "table"
  | "equation"
  | "diagram"
  | "full_page_fallback";

export type SourceVisualUsageStatus = "unused" | "assigned" | "intentionally_skipped";

export interface SourceVisualBBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SourceVisual {
  sourceVisualId: string;
  sourceId: string;
  pageNumber: number;
  type: SourceVisualType;
  caption: string;
  /** Garden-relative URL ("/garden/assets/source-visuals/....png") when cropped. */
  croppedImagePath?: string;
  /** Garden-relative URL of the full page snapshot this visual came from. */
  pageImagePath?: string;
  bbox?: SourceVisualBBox;
  usageStatus: SourceVisualUsageStatus;
  assignedPageId?: string;
  assignedSectionId?: string;
  skipReason?: string;
}

const LEDGER_RELATIVE_PATH = path.join(".breadboard", "source-visuals.json");
const CROPPED_ASSETS_FOLDER = path.join("assets", "source-visuals");

const TYPE_LETTER: Record<SourceVisualType, string> = {
  figure: "F",
  diagram: "F",
  graph: "G",
  table: "T",
  equation: "E",
  full_page_fallback: "P",
};

const DETECTION_SYSTEM_PROMPT = `You identify the meaningful visuals on one page of an academic or educational document.
Return ONLY a JSON array (no fence, no commentary). Each element:
{
  "type": "figure" | "graph" | "table" | "equation" | "diagram",
  "caption": "short specific description of what the visual shows, e.g. 'LIF neuron membrane potential model'",
  "bbox": { "x": 0.1, "y": 0.2, "width": 0.8, "height": 0.3 }
}
Rules:
- bbox values are fractions of the page (0..1), measured from the top-left corner, and must tightly enclose the visual including its printed caption.
- Report real figures, plots/graphs, tables, numbered display equations, and diagrams only.
- Do NOT report running body text, headers, footers, page numbers, author blocks, references, or logos.
- Do NOT report the whole page as one visual.
- captions must describe content ("Latency comparison across models"), never position ("image at top").
- If the page has no meaningful visuals, return [].`;

export function sourceVisualsLedgerPath(contentPath: string, gardenSlug: string): string {
  return path.join(contentPath, gardenSlug, LEDGER_RELATIVE_PATH);
}

export function loadSourceVisuals(contentPath: string, gardenSlug: string): SourceVisual[] {
  try {
    const raw = fs.readFileSync(sourceVisualsLedgerPath(contentPath, gardenSlug), "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SourceVisual[]) : [];
  } catch {
    return [];
  }
}

export function saveSourceVisuals(
  contentPath: string,
  gardenSlug: string,
  visuals: SourceVisual[],
): void {
  const ledgerPath = sourceVisualsLedgerPath(contentPath, gardenSlug);
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.writeFileSync(ledgerPath, JSON.stringify(visuals, null, 2), "utf-8");
}

/** Resolve a garden-relative asset URL ("/garden/assets/x.png") to a disk path,
 * refusing anything that escapes the garden directory. */
function assetDiskPath(contentPath: string, gardenSlug: string, assetUrl: string): string | null {
  const normalized = assetUrl.trim().replace(/\\/g, "/");
  const prefix = `/${gardenSlug}/`;
  if (!normalized.startsWith(prefix)) return null;
  const gardenDir = path.resolve(contentPath, gardenSlug);
  const resolved = path.resolve(gardenDir, normalized.slice(prefix.length));
  if (!resolved.startsWith(gardenDir + path.sep)) return null;
  return resolved;
}

function pageNumberFromAssetUrl(assetUrl: string): number | undefined {
  const match = assetUrl.match(/-page-(\d{1,5})(?:-\d+)?\.(?:png|jpe?g|webp)$/i);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

/** True for the stored full-page snapshot assets ("...-page-003.png"). */
export function isFullPageSnapshotUrl(assetUrl: string): boolean {
  return pageNumberFromAssetUrl(assetUrl) !== undefined;
}

function parseDetections(raw: string): Array<{
  type: SourceVisualType;
  caption: string;
  bbox?: SourceVisualBBox;
}> {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf("[");
    const end = stripped.lastIndexOf("]");
    if (start < 0 || end <= start) return [];
    try {
      parsed = JSON.parse(stripped.slice(start, end + 1));
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];

  const valid = new Set(["figure", "graph", "table", "equation", "diagram"]);
  const detections: Array<{ type: SourceVisualType; caption: string; bbox?: SourceVisualBBox }> = [];
  for (const item of parsed.slice(0, 12)) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const type = typeof record.type === "string" && valid.has(record.type)
      ? (record.type as SourceVisualType)
      : null;
    const caption = typeof record.caption === "string" ? record.caption.trim() : "";
    if (!type || !caption) continue;

    let bbox: SourceVisualBBox | undefined;
    const rawBox = record.bbox;
    if (rawBox && typeof rawBox === "object") {
      const box = rawBox as Record<string, unknown>;
      const nums = [box.x, box.y, box.width, box.height].map((value) =>
        typeof value === "number" && Number.isFinite(value) ? value : NaN,
      );
      if (nums.every((value) => !Number.isNaN(value))) {
        const [x, y, width, height] = nums;
        if (x >= 0 && y >= 0 && width > 0.02 && height > 0.02 && x + width <= 1.05 && y + height <= 1.05) {
          // A bbox covering ~the whole page is a failed detection, not a figure.
          if (width * height < 0.9) {
            bbox = {
              x: Math.max(0, x),
              y: Math.max(0, y),
              width: Math.min(width, 1 - Math.max(0, x)),
              height: Math.min(height, 1 - Math.max(0, y)),
            };
          }
        }
      }
    }
    detections.push({ type, caption: caption.slice(0, 300), bbox });
  }
  return detections;
}

async function detectVisualsOnPage(
  client: OpenAI,
  model: string,
  pngBuffer: Buffer,
): Promise<Array<{ type: SourceVisualType; caption: string; bbox?: SourceVisualBBox }>> {
  const dataUrl = `data:image/png;base64,${pngBuffer.toString("base64")}`;
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: DETECTION_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: dataUrl } },
          {
            type: "text",
            text: "List the meaningful visuals on this page as the JSON array described. Return [] if there are none.",
          },
        ],
      },
    ],
  });
  return parseDetections(response.choices[0]?.message?.content ?? "[]");
}

export interface ExtractSourceVisualsOptions {
  client: OpenAI;
  model: string;
  contentPath: string;
  gardenSlug: string;
  /** Basename slug of the source note (e.g. "2510-27379v1"). */
  sourceId: string;
  /** 1-based index of the source within the garden, for S{n} ids. */
  sourceIndex: number;
  /** Garden-relative URLs of the page snapshot images, in page order. */
  pageImageUrls: string[];
  /** Re-run detection even when the ledger already covers this source. */
  force?: boolean;
  onProgress?: (step: string) => void;
  maxPages?: number;
}

/**
 * Detect + crop the meaningful visuals of one source. Idempotent per source:
 * when the ledger already has entries for `sourceId` (and force is not set) the
 * existing entries are returned untouched, preserving usage statuses.
 */
export async function extractSourceVisuals(
  options: ExtractSourceVisualsOptions,
): Promise<SourceVisual[]> {
  const {
    client,
    model,
    contentPath,
    gardenSlug,
    sourceId,
    sourceIndex,
    pageImageUrls,
    force = false,
    onProgress,
    maxPages = 40,
  } = options;

  const ledger = loadSourceVisuals(contentPath, gardenSlug);
  const existing = ledger.filter((visual) => visual.sourceId === sourceId);
  if (existing.length > 0 && !force) return existing;

  const cropDir = path.join(contentPath, gardenSlug, CROPPED_ASSETS_FOLDER);
  const found: SourceVisual[] = [];
  const counters = new Map<string, number>();

  const nextId = (pageNumber: number, type: SourceVisualType): string => {
    const letter = TYPE_LETTER[type];
    const key = `${pageNumber}:${letter}`;
    const next = (counters.get(key) ?? 0) + 1;
    counters.set(key, next);
    return `S${sourceIndex}.P${pageNumber}.${letter}${next}`;
  };

  for (const pageUrl of pageImageUrls.slice(0, maxPages)) {
    const pageNumber = pageNumberFromAssetUrl(pageUrl) ?? 0;
    const diskPath = assetDiskPath(contentPath, gardenSlug, pageUrl);
    if (!diskPath || !fs.existsSync(diskPath)) continue;

    let pngBuffer: Buffer;
    try {
      pngBuffer = fs.readFileSync(diskPath);
    } catch {
      continue;
    }

    onProgress?.(`Extracting source visuals from page ${pageNumber || "?"}…`);
    let detections: Array<{ type: SourceVisualType; caption: string; bbox?: SourceVisualBBox }> = [];
    try {
      detections = await detectVisualsOnPage(client, model, pngBuffer);
    } catch {
      detections = [];
    }

    if (detections.length === 0) continue;

    for (const detection of detections) {
      const sourceVisualId = nextId(pageNumber, detection.type);
      const visual: SourceVisual = {
        sourceVisualId,
        sourceId,
        pageNumber,
        type: detection.type,
        caption: detection.caption,
        pageImagePath: pageUrl,
        bbox: detection.bbox,
        usageStatus: "unused",
      };

      if (detection.bbox) {
        const cropped = cropPng(pngBuffer, detection.bbox);
        if (cropped) {
          fs.mkdirSync(cropDir, { recursive: true });
          const fileName = `${slugify(
            `${sourceId}-page-${pageNumber}-${detection.type}-${sourceVisualId.split(".").pop()}-${detection.caption.slice(0, 48)}`,
          )}.png`;
          const cropPath = path.join(cropDir, fileName);
          try {
            fs.writeFileSync(cropPath, cropped);
            visual.croppedImagePath = `/${gardenSlug}/assets/source-visuals/${fileName}`;
          } catch {
            // Keep the visual with only the page-level fallback path.
          }
        }
      }
      found.push(visual);
    }
  }

  // Pages where detection found nothing meaningful get no entry at all —
  // full-page screenshots are fallback assets, not extracted figures.
  const merged = [...ledger.filter((visual) => visual.sourceId !== sourceId), ...found];
  saveSourceVisuals(contentPath, gardenSlug, merged);
  return found;
}

/** The image URL a page should embed for a visual: the crop when available,
 * otherwise the full page snapshot (an explicit full-page fallback). */
export function sourceVisualEmbedUrl(visual: SourceVisual): string | undefined {
  return visual.croppedImagePath ?? visual.pageImagePath;
}

/** Markdown image + compact provenance caption for embedding in a lesson body. */
export function sourceVisualMarkdown(visual: SourceVisual): string | null {
  const url = sourceVisualEmbedUrl(visual);
  if (!url) return null;
  const alt = visual.caption.replace(/[\[\]\n\r]/g, " ").replace(/\s+/g, " ").trim();
  const provenance = visual.pageNumber > 0 ? ` *(p. ${visual.pageNumber})*` : "";
  return `![${alt}](${url})\n\n*${alt}*${provenance}`;
}

/** Record final assignment decisions in the ledger: visuals embedded on pages
 * become "assigned"; everything else is intentionally skipped with a reason. */
export function recordSourceVisualAssignments(
  contentPath: string,
  gardenSlug: string,
  assignments: Map<string, { pageId: string; sectionId?: string }>,
  skipReasonForUnused: (visual: SourceVisual) => string,
): SourceVisual[] {
  const ledger = loadSourceVisuals(contentPath, gardenSlug);
  const next = ledger.map((visual): SourceVisual => {
    const assignment = assignments.get(visual.sourceVisualId);
    if (assignment) {
      return {
        ...visual,
        usageStatus: "assigned",
        assignedPageId: assignment.pageId,
        assignedSectionId: assignment.sectionId,
        skipReason: undefined,
      };
    }
    return {
      ...visual,
      usageStatus: "intentionally_skipped",
      assignedPageId: undefined,
      assignedSectionId: undefined,
      skipReason: visual.skipReason ?? skipReasonForUnused(visual),
    };
  });
  saveSourceVisuals(contentPath, gardenSlug, next);
  return next;
}
