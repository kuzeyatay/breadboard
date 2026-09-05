// Disposable document-ingestion executor. Never import this module from Next routes.
import fs from "fs";
import path from "path";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { setFlagsFromString } from "node:v8";
import AdmZip from "adm-zip";
import { PDFParse } from "pdf-parse";
import type OpenAI from "openai";
import { withCouncil } from "@/lib/council";
import {
  cleanGeneratedText,
  extractDocumentKnowledge,
  IncompleteKnowledgeExtractionError,
  normalizeSourceFileIdentity,
  scanClusterKnowledge,
  slugify,
  writeDocumentKnowledge,
  type DocumentPage,
  type KnowledgeExtraction,
  type KnowledgeExtractionChunkCheckpoint,
  type KnowledgeWriteTransaction,
} from "@/lib/knowledge";
import {
  renderSafetyCallout,
  safetyFrontmatter,
  scanDocumentForHiddenContent,
  type DocumentSafetyReport,
} from "@/lib/document-safety";
import {
  ANYDOC_VERSION,
  convertWithAnydoc,
} from "@/lib/anydoc/convert";
import type {
  AnydocConversion,
  AnydocImageSaver,
} from "@/lib/anydoc/convert";
import {
  anydocFormatForExtension,
  anydocPageLabel,
} from "@/lib/anydoc/formats";
import {
  getVlmOcrConfig,
  type VlmOcrConfig,
} from "@/lib/vlm-ocr/config";
import {
  VlmOcrDisabledError,
  VlmOcrUnavailableError,
} from "@/lib/vlm-ocr/errors";
import {
  parsePagesWithVlm,
  type VlmOcrDocument,
} from "@/lib/vlm-ocr/parse";
import {
  createOcrTextCompanionPdf,
  type OcrTextLayerPage,
} from "@/lib/pdf-text-layer";
import type { FigureSaver } from "@/lib/vlm-ocr/figures";
import type { VlmOcrTask } from "@/lib/vlm-ocr/prompts";
import { toBreadboardMarkdown } from "@/lib/vlm-ocr/quartz-safe";
import type { IngestUploadFile } from "@/lib/ingest-upload";

interface PdfScreenshotPage {
  pageNumber: number;
  dataUrl: string;
}

interface MarkdownInputPage {
  label: string;
  text: string;
  pageNumber: number;
  sectionTitle: string;
}

interface PdfOutlineEntry {
  title: string;
  pageNumber: number;
  source: "toc" | "heading";
}

interface MarkdownChunk {
  pages: MarkdownInputPage[];
  sectionTitle: string;
}

const PDF_MARKDOWN_CHUNK_MAX_PAGES = 12;
const PDF_MARKDOWN_CHUNK_MAX_CHARS = 18_000;
const PDF_MARKDOWN_PAGE_PART_MAX_CHARS = 7_500;
const PDF_OUTLINE_SCAN_PAGES = 12;
const PDF_OUTLINE_SCAN_LINES = 18;
const PDF_OUTLINE_MAX_ENTRIES = 36;
// Upload keeps a small eager cache so a large textbook does not create hundreds
// of PNGs up front. This is not a source-page limit: Learn renders any later
// syllabus/contract page from the preserved source_pdf on demand.
const PDF_EAGER_SNAPSHOT_CACHE_PAGES = 24;
// A 1,400 px page is often several megabytes as a data URL. Rendering an
// entire textbook before OCR retained gigabytes of page images and exhausted
// Node's heap. Keep only one small render batch live at a time.
const PDF_VLM_RENDER_BATCH_PAGES = 4;
const PDF_RENDER_BATCH_MAX_STDOUT_BYTES = 128 * 1024 * 1024;
const PDF_ANYDOC_MAX_STDOUT_BYTES = 256 * 1024 * 1024;
const PDF_ANYDOC_TIMEOUT_MS = 5 * 60_000;
const PDF_VLM_CHECKPOINT_SCHEMA_VERSION = 1;
const PDF_VLM_CHECKPOINT_MAX_BYTES = 256 * 1024 * 1024;
const KNOWLEDGE_CHECKPOINT_SCHEMA_VERSION = 1;
const KNOWLEDGE_CHECKPOINT_MAX_BYTES = 64 * 1024 * 1024;
const PDF_RENDER_BATCH_WORKER_PATH = fileURLToPath(
  new URL("../../../scripts/runtime-v2-pdf-render-batch-worker.mjs", import.meta.url),
);
const PDF_ANYDOC_WORKER_PATH = fileURLToPath(
  new URL("../../../scripts/runtime-v2-anydoc-pdf-worker.mjs", import.meta.url),
);
let collectPdfBatchGarbage: (() => void) | null | undefined;
let anydocTemporarySequence = 0;
let vlmCheckpointWriteSequence = 0;
let knowledgeCheckpointWriteSequence = 0;

interface PdfVlmCheckpointBatch {
  first: number;
  last: number;
  result: VlmOcrDocument;
}

interface PdfVlmCheckpoint {
  schemaVersion: number;
  identity: string;
  totalPages: number;
  batches: PdfVlmCheckpointBatch[];
}

interface PdfVlmCheckpointLocation {
  filePath: string;
  identity: string;
}

interface KnowledgeCheckpointEntry {
  index: number;
  total: number;
  inputHash: string;
  extraction: KnowledgeExtraction;
}

interface KnowledgeCheckpointFile {
  schemaVersion: number;
  identity: string;
  totalChunks: number;
  chunks: KnowledgeCheckpointEntry[];
}

interface KnowledgeCheckpointLocation {
  filePath: string;
  identity: string;
}

function collectReleasedPdfBatchMemory(): void {
  if (collectPdfBatchGarbage === undefined) {
    try {
      const existing = (globalThis as typeof globalThis & { gc?: () => void }).gc;
      if (typeof existing === "function") {
        collectPdfBatchGarbage = existing.bind(globalThis);
      } else {
        // The disposable ingestion worker owns its isolate. Expose a local GC
        // hook so multi-thousand-page PDFs do not wait for V8's multi-gigabyte
        // heap-growth threshold before releasing completed image batches.
        setFlagsFromString("--expose_gc");
        const exposed = runInNewContext("gc") as unknown;
        collectPdfBatchGarbage =
          typeof exposed === "function" ? (exposed as () => void) : null;
      }
    } catch {
      collectPdfBatchGarbage = null;
    }
  }
  collectPdfBatchGarbage?.();
}

function pdfVlmCheckpointLocation({
  contentPath,
  clusterSlug,
  filename,
  buffer,
  config,
  task,
}: {
  contentPath: string;
  clusterSlug: string;
  filename: string;
  buffer: Buffer;
  config: VlmOcrConfig;
  task: VlmOcrTask;
}): PdfVlmCheckpointLocation {
  const profile = JSON.stringify({
    schemaVersion: PDF_VLM_CHECKPOINT_SCHEMA_VERSION,
    filename,
    task,
    model: config.model,
    contextSize: config.contextSize,
    maxTokens: config.maxTokens,
    temperature: config.temperature,
    topP: config.topP,
    topK: config.topK,
    repeatPenalty: config.repeatPenalty,
    pageImageWidth: config.pageImageWidth,
    maxPages: config.maxPages,
  });
  const identity = createHash("sha256")
    .update(buffer)
    .update("\0")
    .update(profile)
    .digest("hex");
  const directory = path.join(
    path.dirname(contentPath),
    ".ingest-checkpoints",
    "vlm",
    clusterSlug,
  );
  return { filePath: path.join(directory, `${identity}.json`), identity };
}

function validCheckpointBatch(
  value: unknown,
  totalPages: number,
): value is PdfVlmCheckpointBatch {
  if (typeof value !== "object" || value === null) return false;
  const batch = value as Partial<PdfVlmCheckpointBatch>;
  if (
    !Number.isSafeInteger(batch.first) ||
    !Number.isSafeInteger(batch.last) ||
    batch.first! < 1 ||
    batch.last! < batch.first! ||
    batch.last! > totalPages ||
    batch.first! % PDF_VLM_RENDER_BATCH_PAGES !== 1 ||
    batch.last! !==
      Math.min(batch.first! + PDF_VLM_RENDER_BATCH_PAGES - 1, totalPages) ||
    typeof batch.result !== "object" ||
    batch.result === null
  ) {
    return false;
  }
  const result = batch.result as VlmOcrDocument;
  return (
    typeof result.markdown === "string" &&
    Array.isArray(result.pages) &&
    result.pages.length === batch.last! - batch.first! + 1 &&
    result.pages.every(
      (page, index) =>
        typeof page === "object" &&
        page !== null &&
        page.pageNumber === batch.first! + index &&
        typeof page.label === "string" &&
        typeof page.text === "string" &&
        typeof page.failed === "boolean",
    ) &&
    Array.isArray(result.warnings) &&
    result.warnings.every((warning) => typeof warning === "string") &&
    Number.isSafeInteger(result.failedPages) &&
    Number.isSafeInteger(result.truncatedPages) &&
    Number.isSafeInteger(result.figureCount) &&
    result.failedPages === 0 &&
    result.truncatedPages === 0 &&
    result.figureCount === 0
  );
}

function readPdfVlmCheckpoint(
  location: PdfVlmCheckpointLocation,
  totalPages: number,
): Map<number, PdfVlmCheckpointBatch> {
  try {
    const metadata = fs.lstatSync(location.filePath, { throwIfNoEntry: false });
    if (
      !metadata?.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.size <= 0 ||
      metadata.size > PDF_VLM_CHECKPOINT_MAX_BYTES
    ) {
      return new Map();
    }
    const parsed = JSON.parse(
      fs.readFileSync(location.filePath, "utf8"),
    ) as Partial<PdfVlmCheckpoint>;
    if (
      parsed.schemaVersion !== PDF_VLM_CHECKPOINT_SCHEMA_VERSION ||
      parsed.identity !== location.identity ||
      parsed.totalPages !== totalPages ||
      !Array.isArray(parsed.batches)
    ) {
      return new Map();
    }
    const batches = new Map<number, PdfVlmCheckpointBatch>();
    for (const batch of parsed.batches) {
      if (!validCheckpointBatch(batch, totalPages) || batches.has(batch.first)) {
        return new Map();
      }
      batches.set(batch.first, batch);
    }
    return batches;
  } catch {
    // A partial or stale cache is never authoritative; the page is OCR'd again.
    return new Map();
  }
}

function writePdfVlmCheckpoint(
  location: PdfVlmCheckpointLocation,
  totalPages: number,
  batches: Map<number, PdfVlmCheckpointBatch>,
): void {
  const value: PdfVlmCheckpoint = {
    schemaVersion: PDF_VLM_CHECKPOINT_SCHEMA_VERSION,
    identity: location.identity,
    totalPages,
    batches: [...batches.values()].sort((left, right) => left.first - right.first),
  };
  const serialized = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > PDF_VLM_CHECKPOINT_MAX_BYTES) {
    throw new Error("The VLM checkpoint exceeded its bounded size.");
  }
  fs.mkdirSync(path.dirname(location.filePath), { recursive: true });
  vlmCheckpointWriteSequence += 1;
  const pending = `${location.filePath}.pending.${process.pid}.${vlmCheckpointWriteSequence}`;
  try {
    fs.writeFileSync(pending, serialized, { encoding: "utf8", flag: "wx", mode: 0o600 });
    fs.renameSync(pending, location.filePath);
  } finally {
    fs.rmSync(pending, { force: true });
  }
}

function validStringArray(value: unknown, maximumItems = 10_000): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maximumItems &&
    value.every((item) => typeof item === "string")
  );
}

function validKnowledgeExtraction(value: unknown): value is KnowledgeExtraction {
  if (typeof value !== "object" || value === null) return false;
  const extraction = value as Partial<KnowledgeExtraction>;
  return (
    typeof extraction.documentTitle === "string" &&
    typeof extraction.summary === "string" &&
    validStringArray(extraction.suggestedTags, 1_000) &&
    Array.isArray(extraction.topics) &&
    extraction.topics.length <= 10_000 &&
    extraction.topics.every(
      (topic) =>
        typeof topic === "object" &&
        topic !== null &&
        typeof topic.title === "string" &&
        (topic.slug === undefined || typeof topic.slug === "string") &&
        typeof topic.explanation === "string" &&
        validStringArray(topic.keyPoints) &&
        validStringArray(topic.sourceEvidence) &&
        validStringArray(topic.locations) &&
        validStringArray(topic.relatedTopics) &&
        validStringArray(topic.tags),
    ) &&
    Array.isArray(extraction.relationships) &&
    extraction.relationships.length <= 50_000 &&
    extraction.relationships.every(
      (relationship) =>
        typeof relationship === "object" &&
        relationship !== null &&
        typeof relationship.source === "string" &&
        typeof relationship.target === "string" &&
        typeof relationship.relation === "string",
    )
  );
}

function knowledgeCheckpointLocation({
  contentPath,
  clusterSlug,
  filename,
  buffer,
  model,
  sourceType,
  isHandwriting,
}: {
  contentPath: string;
  clusterSlug: string;
  filename: string;
  buffer: Buffer;
  model: string;
  sourceType: string;
  isHandwriting: boolean;
}): KnowledgeCheckpointLocation {
  const profile = JSON.stringify({
    schemaVersion: KNOWLEDGE_CHECKPOINT_SCHEMA_VERSION,
    filename,
    model,
    sourceType,
    isHandwriting,
  });
  // Keep the outer checkpoint stable across nondeterministic OCR retries. Each
  // chunk is still independently fenced by its exact source-text SHA below, so
  // changed OCR is re-extracted without throwing away unaffected sections.
  const identity = createHash("sha256")
    .update(buffer)
    .update("\0")
    .update(profile)
    .digest("hex");
  const directory = path.join(
    path.dirname(contentPath),
    ".ingest-checkpoints",
    "knowledge",
    clusterSlug,
  );
  return { filePath: path.join(directory, `${identity}.json`), identity };
}

function readKnowledgeCheckpoint(
  location: KnowledgeCheckpointLocation,
): Map<number, KnowledgeCheckpointEntry> {
  try {
    const metadata = fs.lstatSync(location.filePath, { throwIfNoEntry: false });
    if (
      !metadata?.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.size <= 0 ||
      metadata.size > KNOWLEDGE_CHECKPOINT_MAX_BYTES
    ) {
      return new Map();
    }
    const parsed = JSON.parse(
      fs.readFileSync(location.filePath, "utf8"),
    ) as Partial<KnowledgeCheckpointFile>;
    if (
      parsed.schemaVersion !== KNOWLEDGE_CHECKPOINT_SCHEMA_VERSION ||
      parsed.identity !== location.identity ||
      !Number.isSafeInteger(parsed.totalChunks) ||
      parsed.totalChunks! < 1 ||
      parsed.totalChunks! > 10_000 ||
      !Array.isArray(parsed.chunks)
    ) {
      return new Map();
    }
    const chunks = new Map<number, KnowledgeCheckpointEntry>();
    for (const entry of parsed.chunks) {
      if (
        typeof entry !== "object" ||
        entry === null ||
        !Number.isSafeInteger(entry.index) ||
        entry.index < 0 ||
        entry.index >= parsed.totalChunks! ||
        entry.total !== parsed.totalChunks ||
        !/^[a-f0-9]{64}$/u.test(entry.inputHash) ||
        !validKnowledgeExtraction(entry.extraction) ||
        chunks.has(entry.index)
      ) {
        return new Map();
      }
      chunks.set(entry.index, entry);
    }
    return chunks;
  } catch {
    return new Map();
  }
}

function writeKnowledgeCheckpoint(
  location: KnowledgeCheckpointLocation,
  totalChunks: number,
  chunks: Map<number, KnowledgeCheckpointEntry>,
): void {
  const value: KnowledgeCheckpointFile = {
    schemaVersion: KNOWLEDGE_CHECKPOINT_SCHEMA_VERSION,
    identity: location.identity,
    totalChunks,
    chunks: [...chunks.values()].sort((left, right) => left.index - right.index),
  };
  const serialized = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > KNOWLEDGE_CHECKPOINT_MAX_BYTES) {
    throw new Error("The knowledge checkpoint exceeded its bounded size.");
  }
  fs.mkdirSync(path.dirname(location.filePath), { recursive: true });
  knowledgeCheckpointWriteSequence += 1;
  const pending = `${location.filePath}.pending.${process.pid}.${knowledgeCheckpointWriteSequence}`;
  try {
    fs.writeFileSync(pending, serialized, { encoding: "utf8", flag: "wx", mode: 0o600 });
    fs.renameSync(pending, location.filePath);
  } finally {
    fs.rmSync(pending, { force: true });
  }
}

function knowledgeChunkCheckpoint(
  location: KnowledgeCheckpointLocation,
): KnowledgeExtractionChunkCheckpoint {
  const chunks = readKnowledgeCheckpoint(location);
  const inputHash = (sourceChunk: string) =>
    createHash("sha256").update(sourceChunk).digest("hex");
  return {
    load({ index, total, sourceChunk }) {
      const entry = chunks.get(index);
      return entry?.total === total && entry.inputHash === inputHash(sourceChunk)
        ? entry.extraction
        : null;
    },
    save({ index, total, sourceChunk, extraction }) {
      // A changed chunking strategy invalidates the old positional layout.
      // Prune it before the next durable write so the checkpoint cannot become
      // internally inconsistent while the new layout is filled.
      for (const [cachedIndex, entry] of chunks) {
        if (entry.total !== total) chunks.delete(cachedIndex);
      }
      chunks.set(index, {
        index,
        total,
        inputHash: inputHash(sourceChunk),
        extraction,
      });
      writeKnowledgeCheckpoint(location, total, chunks);
    },
  };
}

function renderPdfBatchInSubprocess({
  sourceFilePath,
  first,
  last,
  desiredWidth,
  signal,
}: {
  sourceFilePath: string;
  first: number;
  last: number;
  desiredWidth: number;
  signal?: AbortSignal;
}): Promise<PdfScreenshotPage[]> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [
        PDF_RENDER_BATCH_WORKER_PATH,
        sourceFilePath,
        String(first),
        String(last),
        String(desiredWidth),
      ],
      {
        encoding: "utf8",
        maxBuffer: PDF_RENDER_BATCH_MAX_STDOUT_BYTES,
        windowsHide: true,
        signal,
      },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        try {
          const parsed = JSON.parse(stdout) as unknown;
          if (!Array.isArray(parsed) || parsed.length !== last - first + 1) {
            throw new Error("The isolated PDF renderer returned an incomplete batch.");
          }
          const pages = parsed.map((value, index) => {
            const expectedPageNumber = first + index;
            if (
              typeof value !== "object" ||
              value === null ||
              (value as { pageNumber?: unknown }).pageNumber !== expectedPageNumber ||
              typeof (value as { dataUrl?: unknown }).dataUrl !== "string" ||
              !(value as { dataUrl: string }).dataUrl.startsWith("data:image/png;base64,")
            ) {
              throw new Error("The isolated PDF renderer returned an invalid page.");
            }
            return {
              pageNumber: expectedPageNumber,
              dataUrl: (value as { dataUrl: string }).dataUrl,
            };
          });
          resolve(pages);
        } catch (parseError) {
          reject(parseError);
        }
      },
    );
  });
}

function validatePdfAnydocConversion(value: unknown): AnydocConversion {
  if (
    typeof value !== "object" ||
    value === null ||
    (value as { format?: unknown }).format !== "pdf" ||
    typeof (value as { markdown?: unknown }).markdown !== "string" ||
    !(value as { markdown: string }).markdown.trim() ||
    !Array.isArray((value as { sections?: unknown }).sections) ||
    !Array.isArray((value as { imagePaths?: unknown }).imagePaths) ||
    !Array.isArray((value as { warnings?: unknown }).warnings)
  ) {
    throw new Error("The isolated anydoc converter returned an invalid result.");
  }
  const conversion = value as AnydocConversion;
  if (
    conversion.sections.some(
      (section) =>
        typeof section !== "object" ||
        section === null ||
        typeof section.label !== "string" ||
        typeof section.text !== "string",
    ) ||
    conversion.imagePaths.some((entry) => typeof entry !== "string") ||
    conversion.warnings.some((entry) => typeof entry !== "string")
  ) {
    throw new Error("The isolated anydoc converter returned invalid fields.");
  }
  return conversion;
}

async function convertPdfWithAnydocInSubprocess({
  bytes,
  sourceFilePath,
  signal,
  onProgress,
  knowledgeWriteTransaction,
}: {
  bytes: Buffer;
  sourceFilePath: string;
  signal?: AbortSignal;
  onProgress: (step: string) => void;
  knowledgeWriteTransaction?: KnowledgeWriteTransaction;
}): Promise<AnydocConversion> {
  throwIfRequestAborted(signal);
  onProgress("Converting the PDF with isolated anydoc…");
  anydocTemporarySequence += 1;
  const temporaryPath = path.join(
    path.dirname(sourceFilePath),
    `.${path.basename(sourceFilePath)}.anydoc-${process.pid}-${anydocTemporarySequence}.pdf`,
  );
  writeTrackedIngestionAsset(
    temporaryPath,
    bytes,
    knowledgeWriteTransaction,
  );
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        process.execPath,
        [PDF_ANYDOC_WORKER_PATH, temporaryPath],
        {
          encoding: "utf8",
          maxBuffer: PDF_ANYDOC_MAX_STDOUT_BYTES,
          timeout: PDF_ANYDOC_TIMEOUT_MS,
          windowsHide: true,
          signal,
        },
        (error, childStdout, childStderr) => {
          if (error) {
            const detail = childStderr.trim().slice(0, 1_000);
            reject(
              new Error(
                `The isolated anydoc converter failed${detail ? `: ${detail}` : `: ${error.message}`}`,
              ),
            );
            return;
          }
          resolve(childStdout);
        },
      );
    });
    throwIfRequestAborted(signal);
    return validatePdfAnydocConversion(JSON.parse(stdout) as unknown);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

// Formats whose original bytes carry concealment the extracted text no longer
// shows — white-on-white runs, 1pt type, render mode 3. Everything else is
// scanned for invisible Unicode and injection phrasing on its text alone.
const STRUCTURALLY_SCANNABLE = new Set([
  "pdf",
  "docx",
  "docm",
  "dotx",
  "pptx",
  "pptm",
  "xlsx",
  "xlsm",
]);

class UploadAbortedError extends Error {
  constructor() {
    super("Upload canceled");
    this.name = "AbortError";
  }
}

export class ChatmockVisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatmockVisionError";
  }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function existingSourceDocument(
  contentPath: string,
  clusterSlug: string,
  filename: string,
) {
  const sourceFileName = normalizeSourceFileIdentity(filename);
  if (!sourceFileName) return undefined;

  // Duplicate detection is observational. The default scan also performs a
  // legacy source migration, which would escape the caller's durable garden
  // transaction and survive a later cancellation or crash rollback.
  return scanClusterKnowledge(contentPath, clusterSlug, {
    migrateSources: false,
  }).nodes.find(
    (node) =>
      node.type === "source-document" &&
      normalizeSourceFileIdentity(node.sourceFile) === sourceFileName,
  );
}

function isUsageLimitError(error: unknown): boolean {
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: unknown }).status)
      : undefined;
  const message = errorMessage(error, "").toLowerCase();
  return (
    status === 429 ||
    message.includes("usage limit") ||
    message.includes("rate limit") ||
    message.includes("quota")
  );
}

function throwIfRequestAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new UploadAbortedError();
}

function imageMimeType(mimeType: string, ext = ""): string {
  if (mimeType.startsWith("image/")) return mimeType;
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}

function mimeToBase64Prefix(mimeType: string, ext = ""): string {
  const normalized = imageMimeType(mimeType, ext);
  if (normalized === "image/png") return "data:image/png;base64,";
  if (normalized === "image/webp") return "data:image/webp;base64,";
  return "data:image/jpeg;base64,";
}

function isImageExt(ext: string): boolean {
  return ["jpg", "jpeg", "png", "webp"].includes(ext);
}

function pageMarkdown(
  pages: Array<
    Pick<DocumentPage, "label" | "text"> &
      Partial<Pick<DocumentPage, "imagePath" | "imageAlt">>
  >,
  options?: { includeImages?: boolean },
): string {
  const includeImages = options?.includeImages ?? true;

  return pages
    .map((page) => {
      const image =
        includeImages && page.imagePath
          ? `![${page.imageAlt || page.label}](${page.imagePath})\n\n`
          : "";
      return `## ${page.label}\n\n${image}${page.text.trim() || "_No legible text found._"}`;
    })
    .join("\n\n");
}

function pagePlainText(
  pages: Array<Pick<DocumentPage, "label" | "text">>,
): string {
  return pages
    .map(
      (page) =>
        `[[${page.label}]]\n${page.text.trim() || "No legible text found."}`,
    )
    .join("\n\n");
}

function splitMarkdownPageText(text: string, maxChars: number): string[] {
  const cleaned = text.trim() || "No legible text found.";
  if (cleaned.length <= maxChars) return [cleaned];

  const paragraphs = cleaned
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  const segments: string[] = [];
  let current = "";

  const pushCurrent = () => {
    if (current.trim()) {
      segments.push(current.trim());
      current = "";
    }
  };

  const pushHardSplit = (value: string) => {
    const matches = value.match(new RegExp(`[\\s\\S]{1,${maxChars}}`, "g"));
    if (!matches) return;
    for (const match of matches) {
      const trimmed = match.trim();
      if (trimmed) segments.push(trimmed);
    }
  };

  if (paragraphs.length === 0) {
    pushHardSplit(cleaned);
    return segments.length > 0 ? segments : [cleaned];
  }

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      pushCurrent();
      pushHardSplit(paragraph);
      continue;
    }

    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length > maxChars) {
      pushCurrent();
      current = paragraph;
      continue;
    }
    current = next;
  }

  pushCurrent();
  return segments.length > 0 ? segments : [cleaned];
}

function pageTextLines(text: string): string[] {
  return text
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
}

function normalizeOutlineTitle(value: string): string {
  return value
    .replace(/^[\-\*\u2022]+\s*/, "")
    .replace(/\s*\.{2,}\s*\d+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeOutlineKey(value: string): string {
  return normalizeOutlineTitle(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function lineWordCount(value: string): number {
  return value.split(/\s+/).filter(Boolean).length;
}

function looksMostlyUppercase(value: string): boolean {
  const letters = value.match(/[A-Za-z]/g)?.length ?? 0;
  const uppercase = value.match(/[A-Z]/g)?.length ?? 0;
  return letters > 0 && uppercase / letters >= 0.72;
}

function looksLikeTitleCase(value: string): boolean {
  const words = value
    .split(/\s+/)
    .map((word) => word.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, ""))
    .filter(Boolean);
  if (words.length === 0) return false;

  const smallWords = new Set([
    "a",
    "an",
    "and",
    "as",
    "at",
    "by",
    "for",
    "from",
    "in",
    "of",
    "on",
    "or",
    "the",
    "to",
    "via",
    "with",
  ]);

  let significant = 0;
  let titleLike = 0;
  for (const word of words) {
    if (!/[A-Za-z]/.test(word)) continue;
    const lower = word.toLowerCase();
    if (smallWords.has(lower)) continue;
    significant += 1;
    if (/^[A-Z][a-z0-9]/.test(word) || /^[A-Z0-9]{2,}$/.test(word)) {
      titleLike += 1;
    }
  }

  if (significant === 0) return false;
  return titleLike / significant >= 0.6;
}

function isLikelyHeadingLine(value: string): boolean {
  const line = normalizeOutlineTitle(value);
  if (!line) return false;
  if (line.length < 4 || line.length > 110) return false;
  if (!/[A-Za-z]/.test(line)) return false;
  if (/^page\s+\d+\b/i.test(line)) return false;
  if (/^[\[\(]?[0-9]{1,4}[\]\)]?$/.test(line)) return false;
  if (/^[\-\*\u2022]/.test(line)) return false;
  if (/[.!?]$/.test(line)) return false;

  const words = lineWordCount(line);
  if (words > 14) return false;

  if (
    /^(chapter|section|unit|module|part|week|lecture|lesson|topic|appendix|introduction|overview|summary|conclusion|references|bibliography)\b/i.test(
      line,
    )
  ) {
    return true;
  }

  if (/^\d+(?:\.\d+){0,3}\s+\S/.test(line)) return true;
  if (/^[ivxlcdm]+\.\s+\S/i.test(line)) return true;
  if (looksMostlyUppercase(line) && words <= 12) return true;
  return looksLikeTitleCase(line) && words <= 12;
}

function repeatedLeadingLines(pages: DocumentPage[]): Set<string> {
  const counts = new Map<string, number>();

  for (const page of pages) {
    const lines = pageTextLines(page.text).slice(0, 5);
    for (const line of lines) {
      const key = normalizeOutlineKey(line);
      if (!key || key.length < 4 || key.length > 70) continue;
      if (/^page \d+\b/.test(key)) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  return new Set(
    [...counts.entries()].filter(([, count]) => count >= 3).map(([key]) => key),
  );
}

function parseTocLine(
  line: string,
  totalPages: number,
): PdfOutlineEntry | null {
  const compact = line.replace(/\s+/g, " ").trim();
  if (!compact) return null;

  const match = compact.match(
    /^(.+?)(?:\s+\.{2,}\s*|\s{2,}|\s+-+\s+|\s+)(\d{1,4})$/,
  );
  if (!match) return null;

  const title = normalizeOutlineTitle(match[1] ?? "");
  const pageNumber = Number.parseInt(match[2] ?? "", 10);
  if (!title || !Number.isFinite(pageNumber)) return null;
  if (pageNumber < 1 || pageNumber > totalPages) return null;
  if (lineWordCount(title) > 18) return null;
  if (!/[A-Za-z]/.test(title)) return null;

  return { title, pageNumber, source: "toc" };
}

function extractTocOutline(pages: DocumentPage[]): PdfOutlineEntry[] {
  const totalPages = pages.length;
  const collected: PdfOutlineEntry[] = [];
  let foundTocPage = false;

  for (const page of pages.slice(0, PDF_OUTLINE_SCAN_PAGES)) {
    const lines = pageTextLines(page.text).slice(0, 80);
    const matches = lines
      .map((line) => parseTocLine(line, totalPages))
      .filter((entry): entry is PdfOutlineEntry => Boolean(entry));
    const hasTocHeader = lines.some((line) =>
      /\b(table of contents|contents)\b/i.test(line),
    );

    if (
      hasTocHeader ||
      matches.length >= 4 ||
      (foundTocPage && matches.length >= 2)
    ) {
      foundTocPage = true;
      collected.push(...matches);
    }
  }

  if (collected.length < 3) return [];

  const deduped = new Map<string, PdfOutlineEntry>();
  for (const entry of collected) {
    const key = `${entry.pageNumber}:${normalizeOutlineKey(entry.title)}`;
    if (!deduped.has(key)) deduped.set(key, entry);
  }

  return [...deduped.values()]
    .sort((left, right) => left.pageNumber - right.pageNumber)
    .slice(0, PDF_OUTLINE_MAX_ENTRIES);
}

function extractHeadingOutline(
  title: string,
  pages: DocumentPage[],
): PdfOutlineEntry[] {
  const repeated = repeatedLeadingLines(pages);
  const titleKey = normalizeOutlineKey(title);
  const outline: PdfOutlineEntry[] = [];
  let lastKey = "";

  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    const pageNumber = pageNumberFromLabel(page.label) ?? index + 1;
    const lines = pageTextLines(page.text).slice(0, PDF_OUTLINE_SCAN_LINES);

    const candidate = lines.find((line) => {
      const key = normalizeOutlineKey(line);
      if (!key || repeated.has(key) || key === titleKey) return false;
      return isLikelyHeadingLine(line);
    });

    if (!candidate) continue;

    const normalized = normalizeOutlineTitle(candidate);
    const key = normalizeOutlineKey(normalized);
    if (!key || key === lastKey) continue;

    outline.push({
      title: normalized,
      pageNumber,
      source: "heading",
    });
    lastKey = key;
  }

  return outline.slice(0, PDF_OUTLINE_MAX_ENTRIES);
}

function detectPdfOutline(
  title: string,
  pages: DocumentPage[],
): PdfOutlineEntry[] {
  const tocOutline = extractTocOutline(pages);
  if (tocOutline.length >= 3) return tocOutline;

  const headingOutline = extractHeadingOutline(title, pages);
  return headingOutline.length >= 2 ? headingOutline : [];
}

function renderPdfOutlineContext(
  title: string,
  totalPages: number,
  outline: PdfOutlineEntry[],
): string {
  if (outline.length === 0) {
    return (
      `Full PDF title: ${title}\n` +
      `Total pages: ${totalPages}\n` +
      "Detected outline: no reliable section outline was found, so preserve page order and local headings."
    );
  }

  const lines = outline
    .slice(0, PDF_OUTLINE_MAX_ENTRIES)
    .map(
      (entry) =>
        `- Page ${entry.pageNumber}: ${entry.title} (${entry.source === "toc" ? "table of contents" : "page heading"})`,
    )
    .join("\n");

  return (
    `Full PDF title: ${title}\n` +
    `Total pages: ${totalPages}\n` +
    `Detected outline for the whole PDF:\n${lines}`
  );
}

function sectionTitleForPage(
  pageNumber: number,
  fallbackTitle: string,
  outline: PdfOutlineEntry[],
): string {
  if (outline.length === 0) return fallbackTitle;

  let selected: PdfOutlineEntry | undefined;
  for (const entry of outline) {
    if (entry.pageNumber > pageNumber) break;
    selected = entry;
  }

  if (!selected) return "Front matter";
  return selected.title;
}

function pdfMarkdownInputPages(
  pages: DocumentPage[],
  title: string,
  outline: PdfOutlineEntry[],
): MarkdownInputPage[] {
  return pages.flatMap((page, index) => {
    const pageNumber = pageNumberFromLabel(page.label) ?? index + 1;
    const sectionTitle = sectionTitleForPage(pageNumber, title, outline);
    const parts = splitMarkdownPageText(
      page.text,
      PDF_MARKDOWN_PAGE_PART_MAX_CHARS,
    );

    if (parts.length <= 1) {
      return [
        {
          label: page.label,
          text: parts[0] ?? page.text,
          pageNumber,
          sectionTitle,
        },
      ];
    }

    return parts.map((text, partIndex) => ({
      label: `${page.label} (part ${partIndex + 1}/${parts.length})`,
      text,
      pageNumber,
      sectionTitle,
    }));
  });
}

function chunkPdfMarkdownInputPages(
  pages: MarkdownInputPage[],
): MarkdownChunk[] {
  const chunks: MarkdownChunk[] = [];
  let currentPages: MarkdownInputPage[] = [];
  let currentChars = 0;
  let currentSection = "";

  const flush = () => {
    if (currentPages.length === 0) return;
    chunks.push({
      pages: currentPages,
      sectionTitle: currentSection || "Document",
    });
    currentPages = [];
    currentChars = 0;
    currentSection = "";
  };

  for (const page of pages) {
    const pageChars = page.label.length + page.text.length + 32;
    const nextSection = page.sectionTitle || "Document";
    const sectionChanged =
      currentPages.length > 0 && nextSection !== currentSection;
    const exceedsLimits =
      currentPages.length > 0 &&
      (currentPages.length >= PDF_MARKDOWN_CHUNK_MAX_PAGES ||
        currentChars + pageChars > PDF_MARKDOWN_CHUNK_MAX_CHARS);

    if (sectionChanged || exceedsLimits) {
      flush();
    }

    if (!currentSection) currentSection = nextSection;
    currentPages.push(page);
    currentChars += pageChars;
  }

  flush();
  return chunks;
}

function chunkPageRange(pages: MarkdownInputPage[]): string {
  const numbers = [...new Set(pages.map((page) => page.pageNumber))].sort(
    (left, right) => left - right,
  );
  if (numbers.length === 0) {
    const first = pages[0]?.label ?? "chunk";
    const last = pages[pages.length - 1]?.label ?? first;
    return first === last ? first : `${first} to ${last}`;
  }

  const first = numbers[0];
  const last = numbers[numbers.length - 1];
  return first === last ? `Page ${first}` : `Pages ${first}-${last}`;
}

function chunkLabel(chunk: MarkdownChunk): string {
  const range = chunkPageRange(chunk.pages);
  return chunk.sectionTitle ? `${chunk.sectionTitle} (${range})` : range;
}

async function formatPdfPagesAsMarkdown({
  client,
  model,
  title,
  pages,
  signal,
  onProgress,
}: {
  client: OpenAI;
  model: string;
  title: string;
  pages: DocumentPage[];
  signal?: AbortSignal;
  onProgress?: (step: string) => void;
}): Promise<{ markdownText: string; warning: string }> {
  const outline = detectPdfOutline(title, pages);
  const outlineContext = renderPdfOutlineContext(title, pages.length, outline);
  const inputPages = pdfMarkdownInputPages(pages, title, outline);
  const chunks = chunkPdfMarkdownInputPages(inputPages);
  const markdownChunks: string[] = [];
  let formattingFallbackCount = 0;

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const chunk = chunks[chunkIndex];
    throwIfRequestAborted(signal);
    const label = chunkLabel(chunk);
    onProgress?.(
      `Formatting ${label} as Markdown (${chunkIndex + 1}/${chunks.length})…`,
    );

    try {
      const response = await client.chat.completions.create(
        withCouncil(
          {
            model,
            messages: [
              {
                role: "system",
                content:
                  "Convert raw PDF-extracted text into well-structured Markdown. " +
                  "You are formatting one chunk from a larger PDF, so use the provided full-document outline to keep terminology and heading hierarchy consistent across chunks. " +
                  "Preserve all content. Keep page labels as Markdown headings so page boundaries stay visible. " +
                  "If a page is split into parts, keep the part labels. Clean up obvious PDF artifacts, but do not summarize, omit, or merge away content. " +
                  "Return only Markdown, no commentary.",
              },
              {
                role: "user",
                content:
                  `Document title: ${title}\n` +
                  `Chunk: ${label}\n` +
                  `Current section: ${chunk.sectionTitle}\n\n` +
                  `${outlineContext}\n\n` +
                  `Convert this PDF chunk to Markdown:\n\n${pagePlainText(chunk.pages)}`,
              },
            ],
          },
          { taskType: "ocr" },
        ),
      );

      markdownChunks.push(
        response.choices[0]?.message?.content?.trim() ||
          pageMarkdown(chunk.pages, { includeImages: false }),
      );
    } catch (error) {
      formattingFallbackCount += 1;
      const reason = errorMessage(error, "model formatting failed");
      console.warn(
        `[ingest] PDF chunk formatting failed for ${label}; saved extracted text fallback instead. ${reason}`,
      );
      markdownChunks.push(pageMarkdown(chunk.pages, { includeImages: false }));
    }
  }

  if (formattingFallbackCount > 0) {
    console.warn(
      `[ingest] PDF formatting fell back to extracted text for ${formattingFallbackCount}/${chunks.length} chunk${formattingFallbackCount === 1 ? "" : "s"} in ${title}.`,
    );
  }

  return {
    markdownText: markdownChunks.join("\n\n"),
    warning: "",
  };
}

function dataUrlToImage(dataUrl: string): { buffer: Buffer; ext: string } {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex === -1) throw new Error("Invalid screenshot data URL");

  const header = dataUrl.slice(0, commaIndex);
  const base64 = dataUrl.slice(commaIndex + 1);
  const headerMatch = header.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64$/);
  if (!headerMatch) throw new Error("Invalid screenshot data URL");

  const mimeType = headerMatch[1].toLowerCase();
  const ext = mimeType.includes("png")
    ? "png"
    : mimeType.includes("webp")
      ? "webp"
      : "jpg";
  return { buffer: Buffer.from(base64, "base64"), ext };
}

function uniqueAssetPath(
  assetDir: string,
  baseName: string,
  ext: string,
): string {
  let counter = 1;
  let filePath = path.join(assetDir, `${baseName}.${ext}`);
  while (fs.existsSync(filePath)) {
    counter += 1;
    filePath = path.join(assetDir, `${baseName}-${counter}.${ext}`);
  }
  return filePath;
}

let ingestionAssetWriteSequence = 0;

function fsyncIngestionDirectory(directoryPath: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(directoryPath, "r");
    fs.fsyncSync(descriptor);
  } catch (error) {
    if (
      process.platform !== "win32" ||
      !(error instanceof Error) ||
      !("code" in error) ||
      !["EACCES", "EINVAL", "EPERM"].includes(String(error.code))
    ) {
      throw error;
    }
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function fsyncIngestionFile(filePath: string): void {
  const metadata = fs.lstatSync(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("Ingestion asset is not a direct regular file.");
  }
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(
      filePath,
      process.platform === "win32" ? "r+" : "r",
    );
    fs.fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function ensureTrackedIngestionDirectory(
  directoryPath: string,
  transaction?: KnowledgeWriteTransaction,
): void {
  const missing: string[] = [];
  let current = path.resolve(directoryPath);
  while (!fs.existsSync(current)) {
    missing.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  for (const created of missing.reverse()) {
    transaction?.recordCreatedDirectory(created);
  }
  fs.mkdirSync(directoryPath, { recursive: true });
}

function writeTrackedIngestionAsset(
  filePath: string,
  bytes: Buffer,
  transaction?: KnowledgeWriteTransaction,
): void {
  transaction?.captureFile(filePath);
  const temporaryPath = `${filePath}.pending.${process.pid}.${ingestionAssetWriteSequence++}`;
  transaction?.captureFile(temporaryPath);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporaryPath, "wx", 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporaryPath, filePath);
    fsyncIngestionFile(filePath);
    fsyncIngestionDirectory(path.dirname(filePath));
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function saveDataUrlAsset({
  contentPath,
  clusterSlug,
  baseName,
  label,
  dataUrl,
  createdFilePaths,
  knowledgeWriteTransaction,
}: {
  contentPath: string;
  clusterSlug: string;
  baseName: string;
  label: string;
  dataUrl: string;
  createdFilePaths?: string[];
  knowledgeWriteTransaction?: KnowledgeWriteTransaction;
}): { filePath: string; relativePath: string } {
  const { buffer, ext } = dataUrlToImage(dataUrl);
  const assetDir = path.join(contentPath, clusterSlug.trim(), "assets");
  ensureTrackedIngestionDirectory(assetDir, knowledgeWriteTransaction);
  const fileBase = slugify(`${baseName}-${label}`);
  const filePath = uniqueAssetPath(assetDir, fileBase, ext);
  writeTrackedIngestionAsset(filePath, buffer, knowledgeWriteTransaction);
  createdFilePaths?.push(filePath);
  return {
    filePath,
    relativePath: `/${clusterSlug.trim()}/assets/${path.basename(filePath)}`,
  };
}

function saveUploadedPdfAsset({
  contentPath,
  clusterSlug,
  baseName,
  buffer,
  createdFilePaths,
  knowledgeWriteTransaction,
}: {
  contentPath: string;
  clusterSlug: string;
  baseName: string;
  buffer: Buffer;
  createdFilePaths?: string[];
  knowledgeWriteTransaction?: KnowledgeWriteTransaction;
}): { filePath: string; relativePath: string } {
  const assetDir = path.join(contentPath, clusterSlug.trim(), "assets");
  ensureTrackedIngestionDirectory(assetDir, knowledgeWriteTransaction);
  const fileBase = slugify(`${baseName}-source`);
  const filePath = uniqueAssetPath(assetDir, fileBase, "pdf");
  writeTrackedIngestionAsset(filePath, buffer, knowledgeWriteTransaction);
  createdFilePaths?.push(filePath);
  return {
    filePath,
    relativePath: `/${clusterSlug.trim()}/assets/${path.basename(filePath)}`,
  };
}

/**
 * Persist a figure the VLM located on a page. Crops live beside the page
 * snapshots so a deleted document takes its figures with it.
 */
function vlmFigureSaver({
  contentPath,
  clusterSlug,
  baseName,
  createdFilePaths,
  knowledgeWriteTransaction,
}: {
  contentPath: string;
  clusterSlug: string;
  baseName: string;
  createdFilePaths: string[];
  knowledgeWriteTransaction?: KnowledgeWriteTransaction;
}): FigureSaver {
  return ({ png, pageNumber, index, caption }) => {
    try {
      const assetDir = path.join(contentPath, clusterSlug.trim(), "assets");
      ensureTrackedIngestionDirectory(assetDir, knowledgeWriteTransaction);
      const label = caption
        ? `page-${String(pageNumber).padStart(3, "0")}-${caption.slice(0, 48)}`
        : `page-${String(pageNumber).padStart(3, "0")}-figure-${index}`;
      const filePath = uniqueAssetPath(
        assetDir,
        slugify(`${baseName}-${label}`),
        "png",
      );
      writeTrackedIngestionAsset(filePath, png, knowledgeWriteTransaction);
      createdFilePaths.push(filePath);
      return {
        path: `/${clusterSlug.trim()}/assets/${path.basename(filePath)}`,
      };
    } catch (error) {
      if (knowledgeWriteTransaction) throw error;
      // A figure that cannot be written is reported as skipped, not fatal.
      return null;
    }
  };
}

/**
 * Persist an image anydoc pulled out of a document package. Markdown cannot
 * embed bytes, so anydoc leaves an embedded picture as its alt text and keeps
 * the bytes on the document model; these land beside the page snapshots so a
 * deleted document takes them with it.
 */
function anydocImageSaver({
  contentPath,
  clusterSlug,
  baseName,
  createdFilePaths,
  knowledgeWriteTransaction,
}: {
  contentPath: string;
  clusterSlug: string;
  baseName: string;
  createdFilePaths: string[];
  knowledgeWriteTransaction?: KnowledgeWriteTransaction;
}): AnydocImageSaver {
  return ({ index, mediaType, data }) => {
    try {
      const assetDir = path.join(contentPath, clusterSlug.trim(), "assets");
      ensureTrackedIngestionDirectory(assetDir, knowledgeWriteTransaction);
      const ext =
        mediaType.split("/")[1]?.split("+")[0]?.toLowerCase() || "png";
      const label = `image-${String(index).padStart(3, "0")}`;
      const filePath = uniqueAssetPath(
        assetDir,
        slugify(`${baseName}-${label}`),
        ext.replace(/[^a-z0-9]/g, "") || "png",
      );
      writeTrackedIngestionAsset(filePath, data, knowledgeWriteTransaction);
      createdFilePaths.push(filePath);
      return `/${clusterSlug.trim()}/assets/${path.basename(filePath)}`;
    } catch (error) {
      if (knowledgeWriteTransaction) throw error;
      // An image that cannot be written is reported as skipped, not fatal.
      return null;
    }
  };
}

function pageNumberFromLabel(label: string): number | undefined {
  const cleanLabel = label.trim();
  const prefixed = [
    ...cleanLabel.matchAll(
      /\b(?:pages?|p\.?|slides?)\s*[-#:]*\s*(\d{1,5})\b/gi,
    ),
  ];
  if (prefixed.length > 0) {
    return Number.parseInt(prefixed[prefixed.length - 1][1], 10);
  }

  const pathStyle = cleanLabel.match(
    /(?:^|[-_/\\])page[-_\s]*(\d{1,5})(?:\D|$)/i,
  );
  if (pathStyle) return Number.parseInt(pathStyle[1], 10);

  const bare = cleanLabel.match(/^\s*(\d{1,5})\s*$/);
  return bare ? Number.parseInt(bare[1], 10) : undefined;
}

function attachPdfScreenshotAssets({
  pages,
  screenshots,
  contentPath,
  clusterSlug,
  sourceTitle,
  createdFilePaths,
  knowledgeWriteTransaction,
}: {
  pages: DocumentPage[];
  screenshots: PdfScreenshotPage[];
  contentPath: string;
  clusterSlug: string;
  sourceTitle: string;
  createdFilePaths?: string[];
  knowledgeWriteTransaction?: KnowledgeWriteTransaction;
}): DocumentPage[] {
  const imageByPageNumber = new Map<number, string>();
  for (const screenshot of screenshots) {
    const imageAsset = saveDataUrlAsset({
      contentPath,
      clusterSlug,
      baseName: sourceTitle,
      label: `page-${String(screenshot.pageNumber).padStart(3, "0")}`,
      dataUrl: screenshot.dataUrl,
      createdFilePaths,
      knowledgeWriteTransaction,
    });
    imageByPageNumber.set(screenshot.pageNumber, imageAsset.relativePath);
  }

  return pages.map((page) => {
    const pageNumber = pageNumberFromLabel(page.label);
    const imagePath = pageNumber
      ? imageByPageNumber.get(pageNumber)
      : undefined;
    if (!imagePath) return page;
    return {
      ...page,
      imagePath,
      imageAlt: `${sourceTitle} ${page.label}`,
    };
  });
}

function markdownSnapshots(pages: DocumentPage[]): string {
  return pages
    .filter((page) => page.imagePath)
    .map((page) => `![${page.imageAlt || page.label}](${page.imagePath})`)
    .join("\n\n");
}

function appendSnapshots(markdownText: string, pages: DocumentPage[]): string {
  const snapshots = markdownSnapshots(pages);
  if (!snapshots) return markdownText;
  return `${markdownText.trim()}\n\n## Source snapshots\n\n${snapshots}`;
}

function pdfFallbackMarkdown(
  title: string,
  sourcePdfPath: string | undefined,
  reason: string,
): string {
  const sourceLink = sourcePdfPath
    ? `\n\nOriginal PDF: [${title}](${sourcePdfPath})`
    : "";
  return (
    `## ${title}\n\n` +
    `Automatic PDF extraction could not finish for this file.\n\n` +
    `Reason: ${reason}${sourceLink}\n\n` +
    `You can still open the attached source PDF from this note.`
  );
}

function scannedPdfMarkdown(
  title: string,
  sourcePdfPath: string | undefined,
): string {
  const sourceLink = sourcePdfPath
    ? `\n\nOriginal PDF: [${title}](${sourcePdfPath})`
    : "";
  return (
    `## ${title}\n\n` +
    `This PDF appears to be scanned or image-based, so there was not enough embedded text to build a Learning Map automatically.${sourceLink}\n\n` +
    `Upload it again with handwriting OCR enabled to transcribe the pages.`
  );
}

function ocrUnavailableMarkdown(
  title: string,
  sourcePdfPath: string | undefined,
  reason: string,
): string {
  const sourceLink = sourcePdfPath
    ? `\n\nOriginal PDF: [${title}](${sourcePdfPath})`
    : "";
  return (
    `## ${title}\n\n` +
    `Handwriting OCR could not run right now because the AI usage limit was reached.\n\n` +
    `Reason: ${reason}${sourceLink}\n\n` +
    `No OCR text or textbook pages were created from this failed run. Try again after the usage limit resets.`
  );
}

async function transcribePageImage({
  client,
  model,
  dataUrl,
  label,
  isHandwriting,
}: {
  client: OpenAI;
  model: string;
  dataUrl: string;
  label: string;
  isHandwriting: boolean;
}): Promise<string> {
  const response = await client.chat.completions.create(
    withCouncil(
      {
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: dataUrl } },
              {
                type: "text",
                text: isHandwriting
                  ? `Transcribe ${label} from a handwritten or scanned document as source notes for a study graph. Preserve every legible heading, equation, bullet, label, worked example, table entry, and line break. Describe diagrams, arrows, graphs, and circled or highlighted regions when they carry meaning. Do not summarize or omit repeated-looking details. If a word is uncertain, write [unclear]. Return only the transcription.`
                  : `Extract all text from ${label} verbatim. Preserve headings, equations, bullets, layout cues, and line breaks. Return only the extracted text.`,
              },
            ],
          },
        ],
      },
      { taskType: "ocr" },
    ),
  );

  return response.choices[0]?.message?.content?.trim() ?? "";
}

async function getPdfScreenshotPages(
  buffer: Buffer,
  options?: { maxPages?: number; desiredWidth?: number },
): Promise<PdfScreenshotPage[]> {
  const parser = new PDFParse({ data: buffer });
  try {
    const info = await parser.getInfo();
    const pages: PdfScreenshotPage[] = [];
    const maxPage = options?.maxPages
      ? Math.min(info.total, Math.max(1, options.maxPages))
      : info.total;
    const desiredWidth = options?.desiredWidth ?? 1200;

    for (let first = 1; first <= maxPage; first += 4) {
      const last = Math.min(first + 3, maxPage);
      const screenshots = await parser.getScreenshot({
        first,
        last,
        desiredWidth,
        imageBuffer: false,
        imageDataUrl: true,
      });

      pages.push(
        ...screenshots.pages
          .map((page) => ({
            pageNumber: page.pageNumber,
            dataUrl: page.dataUrl,
          }))
          .filter(
            (page) => Number.isFinite(page.pageNumber) && Boolean(page.dataUrl),
          ),
      );
    }

    return pages.sort((a, b) => a.pageNumber - b.pageNumber);
  } finally {
    await parser.destroy();
  }
}

async function parsePdfPagesWithVlm({
  buffer,
  sourceFilePath,
  config,
  task,
  signal,
  onProgress,
  saveFigure,
  checkpoint,
}: {
  buffer: Buffer;
  sourceFilePath: string;
  config: VlmOcrConfig;
  task: VlmOcrTask;
  signal?: AbortSignal;
  onProgress: (step: string) => void;
  saveFigure: FigureSaver;
  checkpoint: PdfVlmCheckpointLocation;
}): Promise<{
  vlm: VlmOcrDocument;
  snapshots: PdfScreenshotPage[];
  totalPages: number;
}> {
  const infoParser = new PDFParse({ data: buffer });
  let sourcePageCount: number;
  try {
    const info = await infoParser.getInfo();
    sourcePageCount = info.total;
  } finally {
    await infoParser.destroy();
  }
  const totalPages = config.maxPages > 0
    ? Math.min(sourcePageCount, config.maxPages)
    : sourcePageCount;
  const snapshots: PdfScreenshotPage[] = [];
  const checkpointBatches = readPdfVlmCheckpoint(checkpoint, totalPages);
  const results: PdfVlmCheckpointBatch[] = [];

  for (
    let first = 1;
    first <= totalPages;
    first += PDF_VLM_RENDER_BATCH_PAGES
  ) {
    throwIfRequestAborted(signal);
    const last = Math.min(first + PDF_VLM_RENDER_BATCH_PAGES - 1, totalPages);
    const cached = checkpointBatches.get(first);
    let rendered: PdfScreenshotPage[] = [];
    try {
      if (!cached || first <= PDF_EAGER_SNAPSHOT_CACHE_PAGES) {
        // pdf.js and its canvas backend retain process-level allocation pools.
        // Run each bounded render in a short-lived subprocess so Windows
        // releases that native memory before the next batch begins.
        rendered = await renderPdfBatchInSubprocess({
          sourceFilePath,
          first,
          last,
          desiredWidth: config.pageImageWidth,
          signal,
        });
        for (const page of rendered) {
          if (snapshots.length >= PDF_EAGER_SNAPSHOT_CACHE_PAGES) break;
          snapshots.push(page);
        }
      }

      if (cached) {
        results.push(cached);
        onProgress(`Restoring VLM checkpoint (${last}/${totalPages} pages)…`);
        continue;
      }

      const result = await parsePagesWithVlm({
        config: { ...config, maxPages: 0 },
        pages: rendered.map((page) => ({
          label: `Page ${page.pageNumber}`,
          pageNumber: page.pageNumber,
          dataUrl: page.dataUrl,
        })),
        task,
        signal,
        onProgress,
        saveFigure,
        progressOffset: first - 1,
        progressTotal: totalPages,
      });
      const batch = { first, last, result };
      results.push(batch);
      if (
        result.failedPages === 0 &&
        result.truncatedPages === 0 &&
        result.figureCount === 0
      ) {
        checkpointBatches.set(first, batch);
        writePdfVlmCheckpoint(checkpoint, totalPages, checkpointBatches);
      }
    } finally {
      collectReleasedPdfBatchMemory();
    }
  }

  const vlm: VlmOcrDocument = {
    markdown: results.map((batch) => batch.result.markdown.trim()).filter(Boolean).join("\n\n"),
    pages: results.flatMap((batch) => batch.result.pages),
    warnings: [...new Set(results.flatMap((batch) => batch.result.warnings))],
    failedPages: results.reduce((count, batch) => count + batch.result.failedPages, 0),
    truncatedPages: results.reduce(
      (count, batch) => count + batch.result.truncatedPages,
      0,
    ),
    figureCount: results.reduce((count, batch) => count + batch.result.figureCount, 0),
  };
  if (totalPages < sourcePageCount) {
    vlm.warnings.unshift(
      `Only the first ${totalPages} of ${sourcePageCount} pages were parsed (VLM_OCR_MAX_PAGES).`,
    );
  }
  return { vlm, snapshots, totalPages };
}

async function getPdfTextPages(
  buffer: Buffer,
): Promise<{ text: string; pages: DocumentPage[]; warning: string }> {
  const parser = new PDFParse({ data: buffer });
  try {
    const info = await parser.getInfo();
    const pages: DocumentPage[] = [];
    const warnings: string[] = [];

    const readRange = async (first: number, last: number): Promise<void> => {
      try {
        const result = await parser.getText({
          first,
          last,
          pageJoiner: "\n\n",
        });
        pages.push(
          ...result.pages.map((page) => ({
            label: `Page ${page.num}`,
            text: page.text,
          })),
        );
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : "PDF text extraction failed";
        if (first < last) {
          const middle = Math.floor((first + last) / 2);
          await readRange(first, middle);
          await readRange(middle + 1, last);
          return;
        }

        warnings.push(`Page ${first}: ${reason}`);
        pages.push({
          label: `Page ${first}`,
          text: `[PDF text extraction failed for Page ${first}: ${reason}]`,
        });
      }
    };

    for (let first = 1; first <= info.total; first += 12) {
      const last = Math.min(first + 11, info.total);
      await readRange(first, last);
    }

    pages.sort((left, right) => {
      const leftPage = pageNumberFromLabel(left.label) ?? 0;
      const rightPage = pageNumberFromLabel(right.label) ?? 0;
      return leftPage - rightPage;
    });

    return {
      text: pagePlainText(pages),
      pages,
      warning:
        warnings.length > 0
          ? `PDF text extraction failed for ${warnings.length} page${warnings.length === 1 ? "" : "s"}: ${warnings.join("; ")}`
          : "",
    };
  } finally {
    await parser.destroy();
  }
}

async function transcribePdfPages(
  client: OpenAI,
  model: string,
  screenshots: PdfScreenshotPage[],
  signal?: AbortSignal,
  onProgress?: (step: string) => void,
): Promise<{
  pages: DocumentPage[];
  warning: string;
  usageLimitReason?: string;
}> {
  const pages = new Array<DocumentPage>(screenshots.length);
  const warnings: string[] = [];
  let usageLimitReason = "";
  let nextIndex = 0;
  let completed = 0;

  async function worker() {
    while (nextIndex < screenshots.length && !usageLimitReason) {
      const index = nextIndex;
      nextIndex += 1;
      const page = screenshots[index];
      throwIfRequestAborted(signal);
      const label = `Page ${page.pageNumber}`;
      try {
        pages[index] = {
          label,
          text: await transcribePageImage({
            client,
            model,
            dataUrl: page.dataUrl,
            label,
            isHandwriting: true,
          }),
        };
        completed += 1;
        onProgress?.(
          `Reading handwriting with OCR (${completed}/${screenshots.length} pages)…`,
        );
      } catch (error) {
        const reason = errorMessage(error, "vision OCR failed");
        if (isUsageLimitError(error)) {
          usageLimitReason = reason;
          return;
        }
        warnings.push(`${label}: ${reason}`);
        pages[index] = {
          label,
          text: `[OCR failed for ${label}: ${reason}]`,
        };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(3, screenshots.length) }, () => worker()),
  );

  if (usageLimitReason) {
    return {
      pages: [],
      warning: `Handwriting OCR could not run because the AI usage limit was reached: ${usageLimitReason}`,
      usageLimitReason,
    };
  }

  return {
    pages: pages.filter(Boolean),
    warning:
      warnings.length > 0
        ? `Handwriting OCR failed for ${warnings.length} page${warnings.length === 1 ? "" : "s"}: ${warnings.join("; ")}`
        : "",
  };
}

/**
 * Keep the uploaded PDF byte-for-byte authoritative. The OCR transcript is
 * already retained in the source note and generated learning pages; rewriting
 * the source asset with an invisible text layer would silently change the file
 * the user uploaded and makes hash-based recovery/auditing impossible.
 */
async function preserveOriginalSourcePdf({
  pages,
  signal,
  emit,
}: {
  pages: OcrTextLayerPage[];
  signal?: AbortSignal;
  emit: (step: string) => void;
}): Promise<string> {
  if (
    !pages.some(
      (page) => Number.isInteger(page.pageNumber) && page.text.trim().length > 0,
    )
  ) {
    return "";
  }
  throwIfRequestAborted(signal);
  emit("Preserving the original source PDF; OCR text is retained in the notes…");
  return "";
}

/**
 * `writeDocumentKnowledge` runs `cleanGeneratedText` over whatever markdown it
 * is given, so run it here first and re-check the result: that way the markdown
 * whose math and HTML we verified is byte-identical to the markdown on disk
 * (both passes are idempotent).
 */
function finalizeVlmMarkdown(markdown: string): {
  markdown: string;
  warnings: string[];
} {
  const result = toBreadboardMarkdown(cleanGeneratedText(markdown));
  return { markdown: result.markdown, warnings: result.warnings };
}

function joinWarnings(existing: string, addition: string): string {
  if (!addition.trim()) return existing;
  return existing ? `${existing} ${addition}` : addition;
}

function isVlmSetupError(error: unknown): boolean {
  return (
    error instanceof VlmOcrUnavailableError ||
    error instanceof VlmOcrDisabledError
  );
}

function stripXml(xml: string): string {
  return xml
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractDocxText(buffer: Buffer): string {
  const zip = new AdmZip(buffer);
  const entry = zip.getEntry("word/document.xml");
  if (!entry) return "";
  return stripXml(entry.getData().toString("utf8"));
}

function extractPptxText(buffer: Buffer): string {
  const zip = new AdmZip(buffer);
  const slides = zip
    .getEntries()
    .filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName))
    .sort((a, b) => a.entryName.localeCompare(b.entryName));
  return slides
    .map((e) => stripXml(e.getData().toString("utf8")))
    .filter(Boolean)
    .join("\n\n---\n\n");
}

function extractXlsxText(buffer: Buffer): string {
  const zip = new AdmZip(buffer);
  const ssEntry = zip.getEntry("xl/sharedStrings.xml");
  const sharedStrings: string[] = [];
  if (ssEntry) {
    const xml = ssEntry.getData().toString("utf8");
    for (const m of xml.matchAll(/<t[^>]*>([^<]*)<\/t>/g))
      sharedStrings.push(m[1]);
  }

  const sheets = zip
    .getEntries()
    .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.entryName));
  const rows: string[] = [];

  for (const sheet of sheets) {
    const xml = sheet.getData().toString("utf8");
    for (const rowM of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const cm of rowM[1].matchAll(
        /<c[^>]*t="s"[^>]*>[\s\S]*?<v>(\d+)<\/v>/g,
      ))
        cells.push(sharedStrings[parseInt(cm[1])] ?? "");
      for (const cm of rowM[1].matchAll(
        /<c(?![^>]*t="s")[^>]*>[\s\S]*?<v>([^<]+)<\/v>/g,
      ))
        cells.push(cm[1]);
      if (cells.length) rows.push(cells.join("\t"));
    }
  }
  return rows.join("\n");
}

function extractZipText(buffer: Buffer): string {
  const zip = new AdmZip(buffer);
  const textExts = new Set([
    ".txt",
    ".md",
    ".csv",
    ".json",
    ".xml",
    ".html",
    ".js",
    ".ts",
    ".py",
    ".java",
    ".c",
    ".cpp",
    ".h",
    ".css",
    ".yaml",
    ".yml",
    ".toml",
    ".ini",
    ".sql",
    ".sh",
    ".bat",
  ]);
  const parts: string[] = [];
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    if (textExts.has(path.extname(entry.entryName).toLowerCase())) {
      parts.push(
        `=== ${entry.entryName} ===\n${entry.getData().toString("utf8")}`,
      );
    }
  }
  return parts.join("\n\n") || "(No readable text files found in archive)";
}

// Runs the full ingest pipeline, reporting each phase through `emit` so the
// route can stream progress. Returns the success payload, or throws on failure
// (the caller handles abort/cleanup and surfaces the error to the client).
export async function runIngest({
  request,
  client,
  contentPath,
  file,
  normalizedClusterSlug,
  filename,
  ext,
  nameWithoutExt,
  source,
  model,
  isHandwriting,
  parseWithVlm,
  parseWithAnydoc,
  vlmTask,
  generateMap,
  createdFilePaths,
  createdMarkdownPaths,
  knowledgeWriteTransaction,
  deferredCheckpointCleanupPaths,
  emit,
}: {
  request: Request;
  client?: OpenAI;
  contentPath: string;
  file: IngestUploadFile;
  normalizedClusterSlug: string;
  filename: string;
  ext: string;
  nameWithoutExt: string;
  source: string;
  /** The model the signed-in user currently has selected. */
  model: string;
  isHandwriting: boolean;
  parseWithVlm: boolean;
  parseWithAnydoc: boolean;
  vlmTask: VlmOcrTask;
  generateMap: boolean;
  createdFilePaths: string[];
  createdMarkdownPaths: string[];
  knowledgeWriteTransaction?: KnowledgeWriteTransaction;
  /**
   * Runtime V2 defers checkpoint deletion until its external garden/result
   * transaction commits. Legacy callers omit this and keep eager cleanup.
   */
  deferredCheckpointCleanupPaths?: string[];
  emit: (step: string) => void;
}): Promise<Record<string, unknown>> {
  // Multipart bytes are staged to a private file before this worker boundary.
  // Materialize at most one Buffer for parsers that require random access;
  // repeated safety/extraction passes reuse it instead of copying the upload.
  let originalBytes: Buffer | null = null;
  const fileBytes = async (): Promise<Buffer> => {
    if (originalBytes) return originalBytes;
    originalBytes = await file.readBuffer();
    return originalBytes;
  };
  const fileText = async (): Promise<string> =>
    (await fileBytes()).toString("utf8");
  // The uploaded filename is the stable identity shown in Documents. Stop a
  // re-upload before extraction so it cannot create a second source note or a
  // second set of concept scaffolding for the same document.
  const existingSource = existingSourceDocument(
    contentPath,
    normalizedClusterSlug,
    filename,
  );
  if (existingSource) {
    emit(`${filename} is already in Documents — skipping duplicate upload.`);
    return {
      success: true,
      duplicate: true,
      filename,
      slug: existingSource.slug,
      sourceRelPath: existingSource.relPath,
      wordCount: existingSource.wordCount,
      topicCount: 0,
      imageCount: 0,
      mapGenerated: false,
    };
  }

  // ── Text extraction ──────────────────────────────────────────────────────

  emit("Reading the uploaded file…");
  let markdownText: string;
  let plainText: string;
  let pages: DocumentPage[] = [];
  let screenshotWarning = "";
  let visionError = "";
  let sourcePdfPath: string | undefined;
  let skipKnowledgeExtraction = false;
  // Pictures pulled out of the document: figures the VLM cropped off a page, or
  // images anydoc lifted out of a document package.
  let figureCount = 0;
  let completedVlmCheckpointPath = "";
  let completedKnowledgeCheckpointPath = "";

  // The VLM reads pixels, so it only applies to formats that rasterize.
  const useVlm = parseWithVlm && (isImageExt(ext) || ext === "pdf");
  if (parseWithVlm && !useVlm) {
    screenshotWarning = joinWarnings(
      screenshotWarning,
      `${filename} is not a page-based file, so it was read directly instead of with the VLM.`,
    );
  }

  // anydoc reads document packages. When it is requested alongside the VLM for
  // a PDF, both readers run: the VLM remains the visual primary and anydoc is
  // retained as a text-layer cross-check in the source note and map input.
  const anydocFormat = parseWithAnydoc ? anydocFormatForExtension(ext) : null;
  const useAnydoc = Boolean(anydocFormat);
  let anydocApplied = false;
  if (parseWithAnydoc && !anydocFormat) {
    screenshotWarning = joinWarnings(
      screenshotWarning,
      `${filename} is not a format anydoc converts, so it was read directly instead.`,
    );
  }

  if (useAnydoc && !useVlm) {
    throwIfRequestAborted(request.signal);
    const buffer = await fileBytes();
    // A PDF keeps its original beside the note: anydoc reads the text layer,
    // not the rendered page, so the source is the only way back to the layout.
    if (ext === "pdf") {
      sourcePdfPath = saveUploadedPdfAsset({
        contentPath,
        clusterSlug: normalizedClusterSlug,
        baseName: nameWithoutExt,
        buffer,
        createdFilePaths,
        knowledgeWriteTransaction,
      }).relativePath;
    }

    const conversion = await convertWithAnydoc({
      bytes: buffer,
      ext,
      saveImage: anydocImageSaver({
        contentPath,
        clusterSlug: normalizedClusterSlug,
        baseName: nameWithoutExt,
        createdFilePaths,
        knowledgeWriteTransaction,
      }),
      onProgress: emit,
    });
    anydocApplied = true;
    throwIfRequestAborted(request.signal);

    pages =
      conversion.sections.length > 0
        ? conversion.sections.map((section) => ({
            label: section.label,
            text: section.text,
          }))
        : [{ label: anydocPageLabel(conversion.format), text: "" }];
    plainText = pagePlainText(pages);
    markdownText = sourcePdfPath
      ? `${conversion.markdown}\n\n## Source\n\n[${nameWithoutExt}](${sourcePdfPath})`
      : conversion.markdown;
    figureCount = conversion.imagePaths.length;
    screenshotWarning = joinWarnings(
      screenshotWarning,
      conversion.warnings.join(" "),
    );
  } else if (isImageExt(ext)) {
    throwIfRequestAborted(request.signal);
    const buffer = await fileBytes();
    const base64 = buffer.toString("base64");
    const dataUrl = `${mimeToBase64Prefix(file.type, ext)}${base64}`;

    let vlmImageMarkdown = "";
    if (useVlm) {
      emit("Parsing the image with the VLM…");
      const vlm = await parsePagesWithVlm({
        config: getVlmOcrConfig(),
        pages: [{ label: "Image", pageNumber: 1, dataUrl }],
        task: vlmTask,
        signal: request.signal,
        onProgress: emit,
        saveFigure: vlmFigureSaver({
          contentPath,
          clusterSlug: normalizedClusterSlug,
          baseName: nameWithoutExt,
          createdFilePaths,
          knowledgeWriteTransaction,
        }),
      });
      plainText = vlm.pages[0]?.text ?? "";
      figureCount = vlm.figureCount;
      vlmImageMarkdown = vlm.markdown;
      screenshotWarning = joinWarnings(
        screenshotWarning,
        vlm.warnings.join(" "),
      );
      if (vlm.failedPages > 0) skipKnowledgeExtraction = true;
    } else if (generateMap) {
      emit("Transcribing the image with vision…");
      try {
        plainText = await transcribePageImage({
          client: client!,
          model,
          dataUrl,
          label: "Image",
          isHandwriting,
        });
      } catch (error) {
        throw new ChatmockVisionError(
          `ChatMock vision failed: ${errorMessage(error, "image transcription failed")}`,
        );
      }
    } else {
      plainText = "";
    }
    throwIfRequestAborted(request.signal);
    const imageAsset = saveDataUrlAsset({
      contentPath,
      clusterSlug: normalizedClusterSlug,
      baseName: nameWithoutExt,
      label: "image",
      dataUrl,
      createdFilePaths,
      knowledgeWriteTransaction,
    });
    pages = [
      {
        label: "Image",
        text: plainText,
        imagePath: imageAsset.relativePath,
        imageAlt: nameWithoutExt,
      },
    ];
    if (vlmImageMarkdown) {
      // The VLM already emits the `## Image` heading, so only the source
      // snapshot needs adding on top of its markdown.
      const finalized = finalizeVlmMarkdown(
        `![${nameWithoutExt}](${imageAsset.relativePath})\n\n${vlmImageMarkdown}`,
      );
      markdownText = finalized.markdown;
      screenshotWarning = joinWarnings(
        screenshotWarning,
        finalized.warnings.join(" "),
      );
    } else {
      markdownText = pageMarkdown(pages);
    }
  } else if (ext === "pdf") {
    throwIfRequestAborted(request.signal);
    const buffer = await fileBytes();
    const sourcePdf = saveUploadedPdfAsset({
      contentPath,
      clusterSlug: normalizedClusterSlug,
      baseName: nameWithoutExt,
      buffer,
      createdFilePaths,
      knowledgeWriteTransaction,
    });
    sourcePdfPath = sourcePdf.relativePath;
    try {
      if (useVlm) {
        const vlmConfig = getVlmOcrConfig();
        const vlmCheckpoint = pdfVlmCheckpointLocation({
          contentPath,
          clusterSlug: normalizedClusterSlug,
          filename,
          buffer,
          config: vlmConfig,
          task: vlmTask,
        });
        completedVlmCheckpointPath = vlmCheckpoint.filePath;
        emit("Rendering PDF pages for the VLM…");
        const streamedVlm = await parsePdfPagesWithVlm({
          buffer,
          sourceFilePath: sourcePdf.filePath,
          config: vlmConfig,
          task: vlmTask,
          signal: request.signal,
          onProgress: emit,
          saveFigure: vlmFigureSaver({
            contentPath,
            clusterSlug: normalizedClusterSlug,
            baseName: nameWithoutExt,
            createdFilePaths,
            knowledgeWriteTransaction,
          }),
          checkpoint: vlmCheckpoint,
        });
        const { vlm, snapshots: snapshotPages, totalPages } = streamedVlm;
        if (vlm.pages.length === 0) {
          throw new Error(
            "The PDF produced no page images, so the VLM had nothing to read.",
          );
        }

        pages = vlm.pages.map((page) => ({
          label: page.label,
          text: page.text,
        }));
        plainText = pagePlainText(pages);
        figureCount = vlm.figureCount;
        screenshotWarning = joinWarnings(
          screenshotWarning,
          vlm.warnings.join(" "),
        );
        if (vlm.pages.length > 0 && vlm.failedPages === vlm.pages.length) {
          skipKnowledgeExtraction = true;
        }

        screenshotWarning = joinWarnings(
          screenshotWarning,
          await preserveOriginalSourcePdf({
            pages: vlm.pages
              .filter((page) => !page.failed)
              .map((page) => ({ pageNumber: page.pageNumber, text: page.text })),
            signal: request.signal,
            emit,
          }),
        );

        throwIfRequestAborted(request.signal);
        pages = attachPdfScreenshotAssets({
          pages,
          screenshots: snapshotPages,
          contentPath,
          clusterSlug: normalizedClusterSlug,
          sourceTitle: nameWithoutExt,
          createdFilePaths,
          knowledgeWriteTransaction,
        });
        if (totalPages > snapshotPages.length) {
          screenshotWarning = joinWarnings(
            screenshotWarning,
            `Cached the first ${snapshotPages.length} source page${snapshotPages.length === 1 ? "" : "s"}; later pages remain available from the full PDF and are rendered when Learn needs them. The VLM parsed ${totalPages} pages.`,
          );
        }

        const finalized = finalizeVlmMarkdown(vlm.markdown);
        screenshotWarning = joinWarnings(
          screenshotWarning,
          finalized.warnings.join(" "),
        );
        markdownText = appendSnapshots(finalized.markdown, pages);

        if (useAnydoc) {
          emit("Cross-checking PDF text with anydoc…");
          const applyAnydocCrossCheck = (conversion: AnydocConversion) => {
            anydocApplied = true;
            const anydocPages = conversion.sections.map((section) => ({
              label: `AnyDoc · ${section.label}`,
              text: section.text,
            }));
            const anydocText = pagePlainText(anydocPages);
            if (anydocText.trim()) {
              pages = [...pages, ...anydocPages];
              plainText = `${plainText}\n\n${anydocText}`;
            }
            markdownText = `${markdownText}\n\n## AnyDoc cross-check\n\n${conversion.markdown}`;
            screenshotWarning = joinWarnings(
              screenshotWarning,
              conversion.warnings.join(" "),
            );
          };
          try {
            const conversion = await convertPdfWithAnydocInSubprocess({
              bytes: buffer,
              sourceFilePath: sourcePdf.filePath,
              signal: request.signal,
              onProgress: emit,
              knowledgeWriteTransaction,
            });
            throwIfRequestAborted(request.signal);
            applyAnydocCrossCheck(conversion);
          } catch (error) {
            if (
              error instanceof UploadAbortedError ||
              (error instanceof Error && error.name === "AbortError")
            ) {
              throw error;
            }
            try {
              emit("Retrying anydoc with the VLM OCR text companion…");
              const companion = await createOcrTextCompanionPdf({
                pages: vlm.pages
                  .filter((page) => !page.failed)
                  .map((page) => ({
                    pageNumber: page.pageNumber,
                    text: page.text,
                  })),
              });
              if (companion.pagesWritten === 0) {
                throw new Error("the VLM produced no usable OCR text pages");
              }
              const conversion = await convertPdfWithAnydocInSubprocess({
                bytes: Buffer.from(companion.bytes),
                sourceFilePath: sourcePdf.filePath,
                signal: request.signal,
                onProgress: emit,
                knowledgeWriteTransaction,
              });
              throwIfRequestAborted(request.signal);
              applyAnydocCrossCheck(conversion);
              screenshotWarning = joinWarnings(
                screenshotWarning,
                `AnyDoc cross-checked a text-only companion generated from the VLM OCR after the original PDF conversion failed: ${errorMessage(error, "conversion failed")}.`,
              );
            } catch (fallbackError) {
              if (
                fallbackError instanceof UploadAbortedError ||
                (fallbackError instanceof Error &&
                  fallbackError.name === "AbortError")
              ) {
                throw fallbackError;
              }
              screenshotWarning = joinWarnings(
                screenshotWarning,
                `AnyDoc could not cross-check this PDF: ${errorMessage(fallbackError, "conversion failed")}. The VLM result was preserved.`,
              );
            }
          }
        }
      } else if (!generateMap) {
        emit("Extracting text from the PDF…");
        const extractedPdf = await getPdfTextPages(buffer);
        plainText = extractedPdf.text;
        pages = extractedPdf.pages;
        screenshotWarning = extractedPdf.warning;
        markdownText = pageMarkdown(pages, { includeImages: false });
      } else if (isHandwriting) {
        emit("Rendering PDF pages to images for OCR…");
        let screenshots: PdfScreenshotPage[] = [];
        try {
          screenshots = await getPdfScreenshotPages(buffer, {
            desiredWidth: 900,
          });
        } catch (error) {
          screenshotWarning =
            error instanceof Error
              ? `PDF screenshot capture failed: ${error.message}`
              : "PDF screenshot capture failed.";
        }

        if (screenshots.length > 0) {
          emit(`Reading handwriting with OCR (0/${screenshots.length} pages)…`);
          const transcription = await transcribePdfPages(
            client!,
            model,
            screenshots,
            request.signal,
            emit,
          );
          if (transcription.warning) visionError = transcription.warning;
          if (transcription.usageLimitReason) {
            skipKnowledgeExtraction = true;
            screenshotWarning = transcription.warning;
            pages = [
              {
                label: "Handwriting OCR unavailable",
                text: `OCR was not run because the AI usage limit was reached: ${transcription.usageLimitReason}`,
              },
            ];
            plainText = pagePlainText(pages);
            markdownText = ocrUnavailableMarkdown(
              nameWithoutExt,
              sourcePdfPath,
              transcription.usageLimitReason,
            );
          } else {
            pages = transcription.pages;
            if (transcription.warning) {
              screenshotWarning = screenshotWarning
                ? `${screenshotWarning} ${transcription.warning}`
                : transcription.warning;
            }
            screenshotWarning = joinWarnings(
              screenshotWarning,
              await preserveOriginalSourcePdf({
                pages: transcription.pages
                  .map((page, index) => ({
                    pageNumber: pageNumberFromLabel(page.label) ?? index + 1,
                    text: page.text,
                  }))
                  .filter((page) => !page.text.startsWith("[OCR failed for ")),
                signal: request.signal,
                emit,
              }),
            );
            throwIfRequestAborted(request.signal);
            const snapshotPages = screenshots.slice(
              0,
              PDF_EAGER_SNAPSHOT_CACHE_PAGES,
            );
            pages = attachPdfScreenshotAssets({
              pages,
              screenshots: snapshotPages,
              contentPath,
              clusterSlug: normalizedClusterSlug,
              sourceTitle: nameWithoutExt,
              createdFilePaths,
              knowledgeWriteTransaction,
            });
            if (screenshots.length > snapshotPages.length) {
              const limitWarning = `Cached the first ${snapshotPages.length} source page${snapshotPages.length === 1 ? "" : "s"}; later pages remain available from the full PDF and are rendered when Learn needs them. OCR still processed ${screenshots.length} pages.`;
              screenshotWarning = screenshotWarning
                ? `${screenshotWarning} ${limitWarning}`
                : limitWarning;
            }
          }
        } else {
          emit("No page images found — extracting embedded text…");
          const extractedPdf = await getPdfTextPages(buffer);
          pages = extractedPdf.pages;
          if (extractedPdf.warning) {
            screenshotWarning = screenshotWarning
              ? `${screenshotWarning} ${extractedPdf.warning}`
              : extractedPdf.warning;
          }
        }
        plainText = pagePlainText(pages);
        markdownText = pageMarkdown(pages);
      } else {
        emit("Extracting text from the PDF…");
        const extractedPdf = await getPdfTextPages(buffer);
        plainText = extractedPdf.text;
        pages = extractedPdf.pages;
        if (extractedPdf.warning) {
          screenshotWarning = screenshotWarning
            ? `${screenshotWarning} ${extractedPdf.warning}`
            : extractedPdf.warning;
        }

        const wordCount = plainText.trim().split(/\s+/).filter(Boolean).length;
        if (wordCount < 30) {
          skipKnowledgeExtraction = true;
          screenshotWarning = screenshotWarning
            ? `${screenshotWarning} This PDF appears to be scanned/image-based, so no embedded text was available for map generation.`
            : "This PDF appears to be scanned/image-based, so no embedded text was available for map generation.";
          pages = [
            {
              label: "Scanned PDF",
              text: "No embedded text was found. Re-upload with handwriting OCR enabled to transcribe the pages.",
            },
          ];
          plainText = pagePlainText(pages);
          markdownText = scannedPdfMarkdown(nameWithoutExt, sourcePdfPath);
        } else {
          emit("Capturing page snapshots…");
          let screenshots: PdfScreenshotPage[] = [];
          try {
            screenshots = await getPdfScreenshotPages(buffer, {
              maxPages: PDF_EAGER_SNAPSHOT_CACHE_PAGES,
              desiredWidth: 900,
            });
          } catch (error) {
            const reason =
              error instanceof Error
                ? error.message
                : "PDF screenshot capture failed.";
            screenshotWarning = screenshotWarning
              ? `${screenshotWarning} PDF screenshot capture failed: ${reason}`
              : `PDF screenshot capture failed: ${reason}`;
          }
          throwIfRequestAborted(request.signal);
          pages = attachPdfScreenshotAssets({
            pages,
            screenshots,
            contentPath,
            clusterSlug: normalizedClusterSlug,
            sourceTitle: nameWithoutExt,
            createdFilePaths,
            knowledgeWriteTransaction,
          });
          const formattedPdf = await formatPdfPagesAsMarkdown({
            client: client!,
            model,
            title: nameWithoutExt,
            pages,
            signal: request.signal,
            onProgress: emit,
          });

          if (formattedPdf.warning) {
            screenshotWarning = screenshotWarning
              ? `${screenshotWarning} ${formattedPdf.warning}`
              : formattedPdf.warning;
          }

          markdownText = appendSnapshots(formattedPdf.markdownText, pages);
        }
      }
    } catch (error) {
      if (
        error instanceof UploadAbortedError ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        throw error;
      }
      // A missing or unstartable model server is a setup problem, not a
      // problem with this document — surface it instead of quietly saving a
      // stub note the user would have to notice on their own.
      if (isVlmSetupError(error)) throw error;
      const reason =
        error instanceof Error ? error.message : "PDF extraction failed.";
      skipKnowledgeExtraction = true;
      screenshotWarning = `Rich PDF extraction failed: ${reason}. Saved the original PDF as a source note instead.`;
      plainText = `PDF upload fallback for ${filename}. ${reason}`;
      pages = [{ label: "PDF", text: plainText }];
      markdownText = pdfFallbackMarkdown(nameWithoutExt, sourcePdfPath, reason);
    }
  } else if (ext === "csv") {
    plainText = await fileText();
    markdownText = "```csv\n" + plainText + "\n```";
    pages = [{ label: "CSV Data", text: plainText }];
  } else if (ext === "docx") {
    const buffer = await fileBytes();
    plainText = extractDocxText(buffer);
    markdownText = plainText;
    pages = [{ label: "Word Document", text: plainText }];
  } else if (ext === "pptx") {
    const buffer = await fileBytes();
    plainText = extractPptxText(buffer);
    markdownText = plainText;
    pages = plainText
      .split("\n\n---\n\n")
      .map((t, i) => ({ label: `Slide ${i + 1}`, text: t }));
  } else if (ext === "xlsx") {
    const buffer = await fileBytes();
    plainText = extractXlsxText(buffer);
    markdownText = "```\n" + plainText + "\n```";
    pages = [{ label: "Excel Data", text: plainText }];
  } else if (ext === "zip") {
    const buffer = await fileBytes();
    plainText = extractZipText(buffer);
    markdownText = plainText;
    pages = [{ label: "Archive Contents", text: plainText }];
  } else {
    plainText = await fileText();
    markdownText = plainText;
    pages = [{ label: ext === "md" ? "Markdown" : "Text", text: plainText }];
  }

  // ── Hidden-content scan ──────────────────────────────────────────────────
  //
  // The last stage of reading the document, and deliberately the last one that
  // still happens before anything else in Breadboard consumes the text. Every
  // branch above hands back hidden and visible content as one indistinguishable
  // string — that is what makes white-on-white worth an attacker's trouble — so
  // this is the only point where the original bytes and the extracted text are
  // both in hand and the difference between them can still be recovered.
  //
  // It never rejects an upload. A false positive that lost somebody their
  // contract would be a worse failure than the one this prevents, so the
  // document is imported either way and the finding travels with it: quoted in
  // a callout at the top of the source note, recorded in the note's
  // frontmatter, and returned to the uploader as a message.

  throwIfRequestAborted(request.signal);
  emit("Checking for hidden text and prompt injection…");
  let safetyReport: DocumentSafetyReport | undefined;
  try {
    safetyReport = scanDocumentForHiddenContent({
      bytes: STRUCTURALLY_SCANNABLE.has(ext) ? await fileBytes() : undefined,
      ext,
      // Both forms are scanned because a carrier can survive into one and not
      // the other — anydoc's markdown is content, while a VLM page's plain text
      // is. In combined mode both forms are present; duplicate findings collapse
      // in the report's dedupe pass.
      extractedText:
        markdownText === plainText
          ? plainText
          : `${plainText}\n\n${markdownText}`,
      filename,
    });

    const callout = renderSafetyCallout(safetyReport);
    if (callout) markdownText = `${callout}\n\n${markdownText}`;
    if (safetyReport.message) {
      console.warn(`[ingest] ${safetyReport.message}`);
    }
  } catch (error) {
    // The scan is a safety net, not a gate. If it throws, the upload proceeds
    // and the note records that no scan happened rather than implying a clean
    // one — an absent verdict is the honest answer here.
    console.warn(
      `[ingest] Hidden-content scan failed for ${filename}: ${errorMessage(error, "unknown error")}`,
    );
  }

  // ── Knowledge extraction (optional) ──────────────────────────────────────

  let extraction: KnowledgeExtraction;
  let mapGenerationWarning = "";
  throwIfRequestAborted(request.signal);
  if (generateMap && !skipKnowledgeExtraction) {
    try {
      const knowledgeCheckpoint = knowledgeCheckpointLocation({
        contentPath,
        clusterSlug: normalizedClusterSlug,
        filename,
        buffer: await fileBytes(),
        model,
        sourceType: ext || "text",
        isHandwriting,
      });
      completedKnowledgeCheckpointPath = knowledgeCheckpoint.filePath;
      extraction = await extractDocumentKnowledge({
        client: client!,
        model,
        title: nameWithoutExt,
        sourceType: ext || "text",
        sourceLabel: source,
        isHandwriting,
        pages,
        text: plainText,
        onProgress: emit,
        checkpoint: knowledgeChunkCheckpoint(knowledgeCheckpoint),
      });
    } catch (error) {
      if (error instanceof IncompleteKnowledgeExtractionError) throw error;
      const reason = errorMessage(error, "map generation failed");
      console.warn(
        `[ingest] Map generation failed for ${filename}; saved source note without extracted lesson topics. ${reason}`,
      );
      mapGenerationWarning =
        "Map generation failed, so the source was saved without extracted lesson topics. You can retry with Learn after upload.";
      extraction = {
        documentTitle: nameWithoutExt,
        summary: plainText.trim()
          ? plainText.trim().slice(0, 300)
          : `Uploaded ${filename}; map generation failed.`,
        topics: [],
        relationships: [],
        suggestedTags: [],
      };
    }
  } else {
    const summary = plainText.trim()
      ? plainText.trim().slice(0, 300)
      : `Uploaded ${filename} without map generation.`;
    extraction = {
      documentTitle: nameWithoutExt,
      summary,
      topics: [],
      relationships: [],
      suggestedTags: [],
    };
  }

  throwIfRequestAborted(request.signal);
  emit("Saving notes to your garden…");
  const saved = await writeDocumentKnowledge({
    client,
    model,
    contentPath,
    clusterSlug: normalizedClusterSlug,
    sourceTitle: nameWithoutExt,
    sourceFileName: filename,
    sourceType: ext || "text",
    sourceLabel: source,
    sourcePdfPath,
    isHandwriting,
    markdownText,
    plainText,
    pages,
    extraction,
    sourceMetadata: {
      ...(useVlm && anydocApplied
        ? {
            extraction_method: `hunyuan-ocr-gguf+anydoc-${ANYDOC_VERSION}`,
            parse_mode: "vlm+anydoc",
            vlm_task: vlmTask,
            anydoc_format: anydocFormat ?? ext,
          }
        : useVlm
        ? {
            extraction_method: "hunyuan-ocr-gguf",
            parse_mode: "vlm",
            vlm_task: vlmTask,
          }
        : anydocApplied
          ? {
              extraction_method: `anydoc-${ANYDOC_VERSION}`,
              parse_mode: "anydoc",
              anydoc_format: anydocFormat ?? ext,
            }
          : {}),
      // Written for a clean document too: no key at all would be ambiguous
      // between "scanned and clean" and "uploaded before this stage existed".
      ...(safetyReport ? safetyFrontmatter(safetyReport) : {}),
    },
    abortSignal: request.signal,
    createdFilePaths: createdMarkdownPaths,
    knowledgeWriteTransaction,
    onProgress: emit,
  });
  const imageCount = pages.filter((page) => page.imagePath).length;

  for (const checkpointPath of [
    completedVlmCheckpointPath,
    completedKnowledgeCheckpointPath,
  ]) {
    if (!checkpointPath) continue;
    if (deferredCheckpointCleanupPaths) {
      deferredCheckpointCleanupPaths.push(checkpointPath);
    } else {
      fs.rmSync(checkpointPath, { force: true });
    }
  }

  emit("Finishing up…");
  return {
    success: true,
    filename,
    slug: saved.sourceSlug,
    sourceRelPath: saved.sourceRelPath,
    wordCount: saved.wordCount,
    topicCount: saved.topics.length,
    imageCount,
    figureCount,
    visionError: visionError || undefined,
    screenshotWarning: screenshotWarning || undefined,
    mapGenerationWarning: mapGenerationWarning || undefined,
    hiddenContentWarning: safetyReport?.message || undefined,
    hiddenContentVerdict: safetyReport?.verdict,
    hiddenContentFindings: safetyReport?.findings.length
      ? safetyReport.findings.map((finding) => ({
          severity: finding.severity,
          type: finding.type,
          where: finding.where,
          detail: finding.detail,
        }))
      : undefined,
    mapGenerated:
      generateMap && !mapGenerationWarning && !skipKnowledgeExtraction,
    topics: saved.topics,
  };
}
