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
import crypto from "crypto";
import type OpenAI from "openai";
import { PDFParse } from "pdf-parse";
import { breadSystemPrompt } from "./assistant-identity.ts";
import { cropPng, resizePngToMaxDimension } from "./png-crop.ts";
import { slugify } from "./tags.ts";

export type SourceVisualType =
  | "figure"
  | "graph"
  | "table"
  | "equation"
  | "diagram"
  | "full_page_fallback";

export type SourceVisualUsageStatus = "unused" | "assigned" | "intentionally_skipped";
export type SourceVisualConceptUsage =
  | "embedded_and_explained"
  | "explained_as_text_formula"
  | "explained_in_prose"
  | "used_as_interactive_grounding"
  | "referenced_again"
  | "intentionally_omitted";
export type SourceVisualCropStatus =
  | "embedded"
  | "available_not_embedded"
  | "omitted_unreliable"
  | "missing";

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
  conceptUsage?: SourceVisualConceptUsage;
  cropStatus?: SourceVisualCropStatus;
  assignedPageId?: string;
  assignedSectionId?: string;
  skipReason?: string;
}

const LEDGER_RELATIVE_PATH = path.join(".breadboard", "source-visuals.json");
const SCAN_CACHE_RELATIVE_PATH = path.join(".breadboard", "source-visual-scan-cache.json");
const CROPPED_ASSETS_FOLDER = path.join("assets", "source-visuals");
const DEFAULT_DETECTION_TIMEOUT_MS = 45_000;
const DETECTOR_VERSION = 1;
const DETECTION_IMAGE_MAX_DIMENSION = 768;

interface SourceVisualDetection {
  type: SourceVisualType;
  caption: string;
  bbox?: SourceVisualBBox;
}

interface SourceVisualScanEntry {
  detectorVersion: number;
  fingerprint: string;
  detections: SourceVisualDetection[];
}

interface SourceVisualScanCache {
  schemaVersion: 1;
  sources: Record<string, Record<string, SourceVisualScanEntry>>;
}

function sourceVisualDetectionTimeoutMs(): number {
  const parsed = Number(process.env.SOURCE_VISUAL_DETECTION_TIMEOUT_MS);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_DETECTION_TIMEOUT_MS;
  return Math.max(5_000, Math.min(parsed, 180_000));
}

const TYPE_LETTER: Record<SourceVisualType, string> = {
  figure: "F",
  diagram: "F",
  graph: "G",
  table: "T",
  equation: "E",
  full_page_fallback: "P",
};

function expandedCropBBox(
  bbox: SourceVisualBBox,
  type: SourceVisualType,
): SourceVisualBBox {
  if (type === "full_page_fallback") return bbox;
  const minWidth =
    type === "equation" ? 0.5 : type === "table" ? 0.55 : type === "graph" ? 0.5 : 0.42;
  const minHeight =
    type === "equation" ? 0.075 : type === "table" ? 0.12 : type === "graph" ? 0.14 : 0.1;
  const padX = type === "equation" ? 0.035 : type === "table" ? 0.04 : 0.03;
  const padY = type === "equation" ? 0.025 : type === "table" ? 0.035 : 0.03;
  const width = Math.min(1, Math.max(bbox.width + padX * 2, minWidth));
  const height = Math.min(1, Math.max(bbox.height + padY * 2, minHeight));
  const centerX = bbox.x + bbox.width / 2;
  const centerY = bbox.y + bbox.height / 2;
  return {
    x: Math.max(0, Math.min(1 - width, centerX - width / 2)),
    y: Math.max(0, Math.min(1 - height, centerY - height / 2)),
    width,
    height,
  };
}

const DETECTION_SYSTEM_PROMPT = breadSystemPrompt(`You identify the meaningful visuals on one page of an academic or educational document.
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
- If the page has no meaningful visuals, return [].`);

export function sourceVisualsLedgerPath(contentPath: string, gardenSlug: string): string {
  return path.join(contentPath, gardenSlug, LEDGER_RELATIVE_PATH);
}

export function sourceVisualScanCachePath(contentPath: string, gardenSlug: string): string {
  return path.join(contentPath, gardenSlug, SCAN_CACHE_RELATIVE_PATH);
}

function loadSourceVisualScanCache(
  contentPath: string,
  gardenSlug: string,
): SourceVisualScanCache {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(sourceVisualScanCachePath(contentPath, gardenSlug), "utf-8"),
    ) as Partial<SourceVisualScanCache>;
    if (parsed.schemaVersion === 1 && parsed.sources && typeof parsed.sources === "object") {
      return parsed as SourceVisualScanCache;
    }
  } catch {
    // A missing or damaged optimization cache is safe to rebuild.
  }
  return { schemaVersion: 1, sources: {} };
}

function saveSourceVisualScanCache(
  contentPath: string,
  gardenSlug: string,
  cache: SourceVisualScanCache,
): void {
  const cachePath = sourceVisualScanCachePath(contentPath, gardenSlug);
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  const temporaryPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
  const serialized = JSON.stringify(cache, null, 2);
  fs.writeFileSync(temporaryPath, serialized, "utf-8");
  try {
    fs.renameSync(temporaryPath, cachePath);
  } catch {
    // Some Windows filesystems do not replace an existing file atomically.
    fs.writeFileSync(cachePath, serialized, "utf-8");
    try {
      fs.unlinkSync(temporaryPath);
    } catch {
      // Best-effort cleanup of the temporary cache file.
    }
  }
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
  const contentDir = path.resolve(contentPath);
  const gardenDir = path.resolve(contentDir, gardenSlug);
  const gardenRelative = path.relative(contentDir, gardenDir);
  if (
    !gardenRelative ||
    gardenRelative.startsWith(`..${path.sep}`) ||
    gardenRelative === ".." ||
    path.isAbsolute(gardenRelative)
  ) {
    return null;
  }
  const resolved = path.resolve(gardenDir, normalized.slice(prefix.length));
  const relative = path.relative(gardenDir, resolved);
  if (
    !relative ||
    relative.startsWith(`..${path.sep}`) ||
    relative === ".." ||
    path.isAbsolute(relative)
  ) {
    return null;
  }
  return resolved;
}

export interface EnsureSourcePdfPageSnapshotsOptions {
  contentPath: string;
  gardenSlug: string;
  /** Basename slug of the source note whose canonical page assets are needed. */
  sourceId: string;
  /** Garden-relative URL of the preserved original PDF. */
  sourcePdfUrl: string;
  /** Specific 1-based PDF page numbers to materialize. */
  pageNumbers: number[];
  desiredWidth?: number;
  /** Called before and after each page render so Learn can stop promptly. */
  checkpoint?: () => void;
  onProgress?: (step: string) => void;
}

/**
 * Materialize only the requested full-page PDF snapshots. Existing canonical
 * assets are reused, so a later Learn run can request pages mentioned by the
 * syllabus without re-rendering the entire book or mutating the source note.
 */
export async function ensureSourcePdfPageSnapshots(
  options: EnsureSourcePdfPageSnapshotsOptions,
): Promise<string[]> {
  const {
    contentPath,
    gardenSlug,
    sourceId,
    sourcePdfUrl,
    checkpoint,
    onProgress,
    desiredWidth = 1200,
  } = options;
  const garden = gardenSlug.trim();
  const sourceAssetId = slugify(sourceId) || "source";
  const seen = new Set<number>();
  const pageNumbers = options.pageNumbers.filter((pageNumber) => {
    if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || seen.has(pageNumber)) return false;
    seen.add(pageNumber);
    return true;
  });
  if (pageNumbers.length === 0) return [];

  const pageAsset = (pageNumber: number): { diskPath: string; url: string } => {
    const fileName = `${sourceAssetId}-page-${String(pageNumber).padStart(3, "0")}.png`;
    const url = `/${garden}/assets/${fileName}`;
    const diskPath = assetDiskPath(contentPath, garden, url);
    if (!diskPath) throw new Error("Refusing to create a source snapshot outside the garden.");
    return { diskPath, url };
  };

  const assets = new Map(pageNumbers.map((pageNumber) => [pageNumber, pageAsset(pageNumber)]));
  const missingPages = pageNumbers.filter((pageNumber) => {
    const asset = assets.get(pageNumber);
    if (!asset) return true;
    try {
      const stat = fs.statSync(asset.diskPath);
      return !stat.isFile() || stat.size === 0;
    } catch {
      return true;
    }
  });
  if (missingPages.length === 0) {
    return pageNumbers.map((pageNumber) => assets.get(pageNumber)!.url);
  }

  const pdfPath = assetDiskPath(contentPath, garden, sourcePdfUrl);
  if (!pdfPath || path.extname(pdfPath).toLowerCase() !== ".pdf" || !fs.existsSync(pdfPath)) {
    throw new Error("The preserved source PDF is missing or is outside this garden.");
  }
  const gardenDir = fs.realpathSync(path.resolve(contentPath, garden));
  const realPdfPath = fs.realpathSync(pdfPath);
  const realPdfRelative = path.relative(gardenDir, realPdfPath);
  if (
    !realPdfRelative ||
    realPdfRelative.startsWith(`..${path.sep}`) ||
    realPdfRelative === ".." ||
    path.isAbsolute(realPdfRelative)
  ) {
    throw new Error("The preserved source PDF resolves outside this garden.");
  }

  const pdfBuffer = fs.readFileSync(realPdfPath);
  const parser = new PDFParse({ data: pdfBuffer });
  try {
    const info = await parser.getInfo();
    const invalidPages = missingPages.filter((pageNumber) => pageNumber > info.total);
    if (invalidPages.length > 0) {
      throw new Error(
        `Source PDF has ${info.total} page(s); requested page ${invalidPages.join(", ")}.`,
      );
    }

    const renderWidth = Number.isFinite(desiredWidth)
      ? Math.max(320, Math.min(2400, Math.round(desiredWidth)))
      : 1200;
    for (const pageNumber of missingPages) {
      checkpoint?.();
      onProgress?.(`Rendering source PDF page ${pageNumber}...`);
      const screenshot = await parser.getScreenshot({
        partial: [pageNumber],
        desiredWidth: renderWidth,
        imageBuffer: true,
        imageDataUrl: false,
      });
      const page = screenshot.pages.find((candidate) => candidate.pageNumber === pageNumber);
      if (!page?.data?.length) {
        throw new Error(`Source PDF page ${pageNumber} could not be rendered.`);
      }
      const asset = assets.get(pageNumber)!;
      fs.mkdirSync(path.dirname(asset.diskPath), { recursive: true });
      const temporaryPath = `${asset.diskPath}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(temporaryPath, Buffer.from(page.data));
      try {
        fs.renameSync(temporaryPath, asset.diskPath);
      } catch {
        fs.writeFileSync(asset.diskPath, Buffer.from(page.data));
        try {
          fs.unlinkSync(temporaryPath);
        } catch {
          // Best-effort cleanup after a non-atomic Windows replacement.
        }
      }
      checkpoint?.();
    }
  } finally {
    await parser.destroy();
  }

  return pageNumbers.map((pageNumber) => assets.get(pageNumber)!.url);
}

function pageNumberFromAssetUrl(assetUrl: string): number | undefined {
  const match = assetUrl.match(/-page-(\d{1,5})(?:-\d+)?\.(?:png|jpe?g|webp)$/i);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

/** True for the stored full-page snapshot assets ("...-page-003.png"). */
export function isFullPageSnapshotUrl(assetUrl: string): boolean {
  return pageNumberFromAssetUrl(assetUrl) !== undefined;
}

function parseDetections(raw: string): SourceVisualDetection[] {
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
  const detections: SourceVisualDetection[] = [];
  const normalizeType = (type: SourceVisualType, caption: string): SourceVisualType => {
    if (type !== "figure" && type !== "diagram") return type;
    const lower = caption.toLowerCase();
    if (
      /\b(graph|plot|curve|chart|bar|axis|axes)\b/.test(lower) ||
      /\bcomparison\b/.test(lower) ||
      /\b(training loss|training accuracy|latency|energy consumption|spike count)\b/.test(lower)
    ) {
      return "graph";
    }
    return type;
  };
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
    detections.push({ type: normalizeType(type, caption), caption: caption.slice(0, 300), bbox });
  }
  return detections;
}

async function detectVisualsOnPage(
  client: OpenAI,
  model: string,
  pngBuffer: Buffer,
): Promise<SourceVisualDetection[]> {
  const detectionBuffer =
    resizePngToMaxDimension(pngBuffer, DETECTION_IMAGE_MAX_DIMENSION) ?? pngBuffer;
  const dataUrl = `data:image/png;base64,${detectionBuffer.toString("base64")}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), sourceVisualDetectionTimeoutMs());
  try {
    const response = await client.chat.completions.create(
      {
        model,
        messages: [
          { role: "system", content: DETECTION_SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: dataUrl, detail: "low" } },
              {
                type: "text",
                text: "List the meaningful visuals on this page as the JSON array described. Return [] if there are none.",
              },
            ],
          },
        ],
      },
      { signal: controller.signal },
    );
    return parseDetections(response.choices[0]?.message?.content ?? "[]");
  } finally {
    clearTimeout(timeout);
  }
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
  /** Called between page requests so cancellation preserves completed scans. */
  checkpoint?: () => void;
  onProgress?: (step: string) => void;
  maxPages?: number;
}

/**
 * Detect + crop meaningful visuals on the supplied pages. Extraction is
 * incremental: prior pages remain in the ledger while newly supplied pages are
 * scanned (or restored from the per-page scan cache).
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
    checkpoint,
    onProgress,
    maxPages,
  } = options;

  const ledger = loadSourceVisuals(contentPath, gardenSlug);
  const existing = ledger.filter((visual) => visual.sourceId === sourceId);

  const scanCache = loadSourceVisualScanCache(contentPath, gardenSlug);
  const sourceCache = scanCache.sources[sourceId] ?? {};
  scanCache.sources[sourceId] = sourceCache;
  const cropDir = path.join(contentPath, gardenSlug, CROPPED_ASSETS_FOLDER);
  const found: SourceVisual[] = [];
  const replacedPages = new Set<number>();
  const counters = new Map<string, number>();
  const detectionErrors: string[] = [];
  let consecutiveDetectionFailures = 0;

  const nextId = (pageNumber: number, type: SourceVisualType): string => {
    const letter = TYPE_LETTER[type];
    const key = `${pageNumber}:${letter}`;
    const next = (counters.get(key) ?? 0) + 1;
    counters.set(key, next);
    return `S${sourceIndex}.P${pageNumber}.${letter}${next}`;
  };

  const requestedPageUrls = Number.isFinite(maxPages) && (maxPages ?? 0) > 0
    ? pageImageUrls.slice(0, Math.floor(maxPages!))
    : pageImageUrls;
  for (const pageUrl of requestedPageUrls) {
    checkpoint?.();
    const pageNumber = pageNumberFromAssetUrl(pageUrl) ?? 0;
    if (pageNumber < 1) continue;
    const existingOnPage = existing.filter((visual) => visual.pageNumber === pageNumber);
    // Legacy ledgers predate the scan cache. An existing page entry still
    // proves that page completed, and must not prevent later pages from being
    // scanned.
    if (!force && existingOnPage.length > 0) continue;
    const diskPath = assetDiskPath(contentPath, gardenSlug, pageUrl);
    if (!diskPath || !fs.existsSync(diskPath)) continue;

    let pngBuffer: Buffer;
    try {
      pngBuffer = fs.readFileSync(diskPath);
    } catch {
      continue;
    }

    const fingerprint = crypto.createHash("sha256").update(pngBuffer).digest("hex");
    const cached = sourceCache[pageUrl];
    let detections: SourceVisualDetection[] = [];
    if (
      !force &&
      cached?.detectorVersion === DETECTOR_VERSION &&
      cached.fingerprint === fingerprint &&
      Array.isArray(cached.detections)
    ) {
      detections = cached.detections;
      consecutiveDetectionFailures = 0;
      onProgress?.(`Reusing saved visual scan for page ${pageNumber || "?"}...`);
    } else {
      try {
        onProgress?.(`Scanning page ${pageNumber || "?"} for figures...`);
        detections = await detectVisualsOnPage(client, model, pngBuffer);
        consecutiveDetectionFailures = 0;
        sourceCache[pageUrl] = {
          detectorVersion: DETECTOR_VERSION,
          fingerprint,
          detections,
        };
        // Cache successful empty results too. This file is intentionally not a
        // rollback output, so Stop/Retry never pays for completed pages again.
        saveSourceVisualScanCache(contentPath, gardenSlug, scanCache);
        checkpoint?.();
      } catch (error) {
        // A throw is different from a successful scan returning no visuals.
        detections = [];
        detectionErrors.push(`page ${pageNumber || "?"}: ${error instanceof Error ? error.message : String(error)}`);
        consecutiveDetectionFailures += 1;
        // Stop when the model is clearly unavailable rather than grinding
        // every remaining page (each with its own SDK retries).
        if (consecutiveDetectionFailures >= 3) break;
      }
    }

    replacedPages.add(pageNumber);
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
        const cropped = cropPng(pngBuffer, expandedCropBBox(detection.bbox, detection.type));
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

  // A partial scan is not a completed extraction. Successful pages are already
  // cached, but the rollback-owned output ledger remains untouched until Retry
  // finishes every page.
  if (detectionErrors.length > 0) {
    throw new Error(
      `vision detection failed on ${detectionErrors.length} page(s): ${detectionErrors.slice(0, 2).join("; ")}`,
    );
  }

  // Pages where detection found nothing meaningful get no entry at all —
  // full-page screenshots are fallback assets, not extracted figures.
  const preservedSourceVisuals = existing.filter(
    (visual) => !replacedPages.has(visual.pageNumber),
  );
  const mergedSourceVisuals = [...preservedSourceVisuals, ...found].sort(
    (left, right) => left.pageNumber - right.pageNumber || left.sourceVisualId.localeCompare(right.sourceVisualId),
  );
  const merged = [...ledger.filter((visual) => visual.sourceId !== sourceId), ...mergedSourceVisuals];
  saveSourceVisuals(contentPath, gardenSlug, merged);
  return mergedSourceVisuals;
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
  options: { conceptAnchorIds?: Iterable<string> } = {},
): SourceVisual[] {
  const ledger = loadSourceVisuals(contentPath, gardenSlug);
  const conceptAnchorIds = new Set(options.conceptAnchorIds ?? []);
  const next = ledger.map((visual): SourceVisual => {
    const assignment = assignments.get(visual.sourceVisualId);
    if (assignment) {
      return {
        ...visual,
        usageStatus: "assigned",
        conceptUsage: "embedded_and_explained",
        cropStatus: visual.croppedImagePath ? "embedded" : "available_not_embedded",
        assignedPageId: assignment.pageId,
        assignedSectionId: assignment.sectionId,
        skipReason: undefined,
      };
    }
    const usedAsConceptAnchor = conceptAnchorIds.has(visual.sourceVisualId);
    const conceptUsage: SourceVisualConceptUsage =
      usedAsConceptAnchor && visual.type === "equation"
        ? "explained_as_text_formula"
        : usedAsConceptAnchor
          ? "used_as_interactive_grounding"
          : "intentionally_omitted";
    const cropStatus: SourceVisualCropStatus =
      conceptUsage === "explained_as_text_formula"
        ? "omitted_unreliable"
        : visual.croppedImagePath
          ? "available_not_embedded"
          : "missing";
    return {
      ...visual,
      usageStatus: usedAsConceptAnchor ? "assigned" : "intentionally_skipped",
      conceptUsage,
      cropStatus,
      assignedPageId: undefined,
      assignedSectionId: undefined,
      skipReason: visual.skipReason ?? skipReasonForUnused(visual),
    };
  });
  saveSourceVisuals(contentPath, gardenSlug, next);
  return next;
}
