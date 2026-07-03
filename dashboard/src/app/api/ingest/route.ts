import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";
import { PDFParse } from "pdf-parse";
import type OpenAI from "openai";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server";
import { withCouncil } from "@/lib/council";
import {
  DEFAULT_MODEL,
  createChatmockClient,
  extractDocumentKnowledge,
  slugify,
  writeDocumentKnowledge,
  type DocumentPage,
  type KnowledgeExtraction,
} from "@/lib/knowledge";
import { requireOwnedClusterFromSlug, routeErrorResponse } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

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
const PDF_SOURCE_SNAPSHOT_LIMIT = 24;

class UploadAbortedError extends Error {
  constructor() {
    super("Upload canceled");
    this.name = "AbortError";
  }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
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

function cleanupCreatedFiles(filePaths: string[]) {
  for (const filePath of [...filePaths].reverse()) {
    try {
      if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
    } catch {
      // Best-effort cleanup only.
    }
  }
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
      const image = includeImages && page.imagePath
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
    [...counts.entries()]
      .filter(([, count]) => count >= 3)
      .map(([key]) => key),
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

    if (hasTocHeader || matches.length >= 4 || (foundTocPage && matches.length >= 2)) {
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

function detectPdfOutline(title: string, pages: DocumentPage[]): PdfOutlineEntry[] {
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

function chunkPdfMarkdownInputPages(pages: MarkdownInputPage[]): MarkdownChunk[] {
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
  title,
  pages,
  signal,
  onProgress,
}: {
  client: OpenAI;
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
      const response = await client.chat.completions.create(withCouncil({
        model: DEFAULT_MODEL,
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
      }, { taskType: "ocr" }));

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

function saveDataUrlAsset({
  contentPath,
  clusterSlug,
  baseName,
  label,
  dataUrl,
  createdFilePaths,
}: {
  contentPath: string;
  clusterSlug: string;
  baseName: string;
  label: string;
  dataUrl: string;
  createdFilePaths?: string[];
}): { filePath: string; relativePath: string } {
  const { buffer, ext } = dataUrlToImage(dataUrl);
  const assetDir = path.join(contentPath, clusterSlug.trim(), "assets");
  fs.mkdirSync(assetDir, { recursive: true });
  const fileBase = slugify(`${baseName}-${label}`);
  const filePath = uniqueAssetPath(assetDir, fileBase, ext);
  fs.writeFileSync(filePath, buffer);
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
}: {
  contentPath: string;
  clusterSlug: string;
  baseName: string;
  buffer: Buffer;
  createdFilePaths?: string[];
}): { filePath: string; relativePath: string } {
  const assetDir = path.join(contentPath, clusterSlug.trim(), "assets");
  fs.mkdirSync(assetDir, { recursive: true });
  const fileBase = slugify(`${baseName}-source`);
  const filePath = uniqueAssetPath(assetDir, fileBase, "pdf");
  fs.writeFileSync(filePath, buffer);
  createdFilePaths?.push(filePath);
  return {
    filePath,
    relativePath: `/${clusterSlug.trim()}/assets/${path.basename(filePath)}`,
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
}: {
  pages: DocumentPage[];
  screenshots: PdfScreenshotPage[];
  contentPath: string;
  clusterSlug: string;
  sourceTitle: string;
  createdFilePaths?: string[];
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
  dataUrl,
  label,
  isHandwriting,
}: {
  client: OpenAI;
  dataUrl: string;
  label: string;
  isHandwriting: boolean;
}): Promise<string> {
  const response = await client.chat.completions.create(withCouncil({
    model: DEFAULT_MODEL,
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
  }, { taskType: "ocr" }));

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
  screenshots: PdfScreenshotPage[],
  signal?: AbortSignal,
  onProgress?: (step: string) => void,
): Promise<{ pages: DocumentPage[]; warning: string; usageLimitReason?: string }> {
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
async function runIngest({
  request,
  client,
  contentPath,
  file,
  normalizedClusterSlug,
  filename,
  ext,
  nameWithoutExt,
  source,
  isHandwriting,
  generateMap,
  createdFilePaths,
  createdMarkdownPaths,
  emit,
}: {
  request: Request;
  client?: OpenAI;
  contentPath: string;
  file: File;
  normalizedClusterSlug: string;
  filename: string;
  ext: string;
  nameWithoutExt: string;
  source: string;
  isHandwriting: boolean;
  generateMap: boolean;
  createdFilePaths: string[];
  createdMarkdownPaths: string[];
  emit: (step: string) => void;
}): Promise<Record<string, unknown>> {
  // ── Text extraction ──────────────────────────────────────────────────────

  emit("Reading the uploaded file…");
  let markdownText: string;
  let plainText: string;
  let pages: DocumentPage[] = [];
  let screenshotWarning = "";
  let sourcePdfPath: string | undefined;
  let skipKnowledgeExtraction = false;

  if (isImageExt(ext)) {
    throwIfRequestAborted(request.signal);
    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const dataUrl = `${mimeToBase64Prefix(file.type, ext)}${base64}`;

    if (generateMap) emit("Transcribing the image with vision…");
    plainText = generateMap
      ? await transcribePageImage({
          client: client!,
          dataUrl,
          label: "Image",
          isHandwriting,
        })
      : "";
    throwIfRequestAborted(request.signal);
    const imageAsset = saveDataUrlAsset({
      contentPath,
      clusterSlug: normalizedClusterSlug,
      baseName: nameWithoutExt,
      label: "image",
      dataUrl,
      createdFilePaths,
    });
    pages = [
      {
        label: "Image",
        text: plainText,
        imagePath: imageAsset.relativePath,
        imageAlt: nameWithoutExt,
      },
    ];
    markdownText = pageMarkdown(pages);
  } else if (ext === "pdf") {
    throwIfRequestAborted(request.signal);
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    sourcePdfPath = saveUploadedPdfAsset({
      contentPath,
      clusterSlug: normalizedClusterSlug,
      baseName: nameWithoutExt,
      buffer,
      createdFilePaths,
    }).relativePath;
    try {
      if (!generateMap) {
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
            screenshots,
            request.signal,
            emit,
          );
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
            throwIfRequestAborted(request.signal);
            const snapshotPages = screenshots.slice(
              0,
              PDF_SOURCE_SNAPSHOT_LIMIT,
            );
            pages = attachPdfScreenshotAssets({
              pages,
              screenshots: snapshotPages,
              contentPath,
              clusterSlug: normalizedClusterSlug,
              sourceTitle: nameWithoutExt,
              createdFilePaths,
            });
            if (screenshots.length > snapshotPages.length) {
              const limitWarning = `Saved source snapshots for the first ${snapshotPages.length} page${snapshotPages.length === 1 ? "" : "s"} to keep the upload stable. OCR still processed ${screenshots.length} pages.`;
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
              maxPages: PDF_SOURCE_SNAPSHOT_LIMIT,
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
          });
          const formattedPdf = await formatPdfPagesAsMarkdown({
            client: client!,
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
      const reason =
        error instanceof Error ? error.message : "PDF extraction failed.";
      skipKnowledgeExtraction = true;
      screenshotWarning = `Rich PDF extraction failed: ${reason}. Saved the original PDF as a source note instead.`;
      plainText = `PDF upload fallback for ${filename}. ${reason}`;
      pages = [{ label: "PDF", text: plainText }];
      markdownText = pdfFallbackMarkdown(nameWithoutExt, sourcePdfPath, reason);
    }
  } else if (ext === "csv") {
    plainText = await file.text();
    markdownText = "```csv\n" + plainText + "\n```";
    pages = [{ label: "CSV Data", text: plainText }];
  } else if (ext === "docx") {
    const buffer = Buffer.from(await file.arrayBuffer());
    plainText = extractDocxText(buffer);
    markdownText = plainText;
    pages = [{ label: "Word Document", text: plainText }];
  } else if (ext === "pptx") {
    const buffer = Buffer.from(await file.arrayBuffer());
    plainText = extractPptxText(buffer);
    markdownText = plainText;
    pages = plainText
      .split("\n\n---\n\n")
      .map((t, i) => ({ label: `Slide ${i + 1}`, text: t }));
  } else if (ext === "xlsx") {
    const buffer = Buffer.from(await file.arrayBuffer());
    plainText = extractXlsxText(buffer);
    markdownText = "```\n" + plainText + "\n```";
    pages = [{ label: "Excel Data", text: plainText }];
  } else if (ext === "zip") {
    const buffer = Buffer.from(await file.arrayBuffer());
    plainText = extractZipText(buffer);
    markdownText = plainText;
    pages = [{ label: "Archive Contents", text: plainText }];
  } else {
    plainText = await file.text();
    markdownText = plainText;
    pages = [{ label: ext === "md" ? "Markdown" : "Text", text: plainText }];
  }

  // ── Knowledge extraction (optional) ──────────────────────────────────────

  let extraction: KnowledgeExtraction;
  let mapGenerationWarning = "";
  throwIfRequestAborted(request.signal);
  if (generateMap && !skipKnowledgeExtraction) {
    try {
      extraction = await extractDocumentKnowledge({
        client: client!,
        title: nameWithoutExt,
        sourceType: ext || "text",
        sourceLabel: source,
        isHandwriting,
        pages,
        text: plainText,
        onProgress: emit,
      });
    } catch (error) {
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
    abortSignal: request.signal,
    createdFilePaths: createdMarkdownPaths,
    onProgress: emit,
  });
  const imageCount = pages.filter((page) => page.imagePath).length;

  emit("Finishing up…");
  return {
    success: true,
    filename,
    slug: saved.sourceSlug,
    sourceRelPath: saved.sourceRelPath,
    wordCount: saved.wordCount,
    topicCount: saved.topics.length,
    imageCount,
    screenshotWarning: screenshotWarning || undefined,
    mapGenerationWarning: mapGenerationWarning || undefined,
    mapGenerated: generateMap && !mapGenerationWarning && !skipKnowledgeExtraction,
    topics: saved.topics,
  };
}

export async function POST(request: Request) {
  // Validation and auth run before streaming so genuine HTTP error codes
  // (400/401/500) still reach the client as a normal JSON response.
  let baseURL: string;
  let formData: FormData;
  try {
    ({ baseURL } = resolveChatmockBaseUrl(request));
    formData = await request.formData();
  } catch (err) {
    if (
      err instanceof UploadAbortedError ||
      (err instanceof Error && err.name === "AbortError")
    ) {
      return NextResponse.json({ error: "Upload canceled" }, { status: 499 });
    }
    return routeErrorResponse(err);
  }

  const file = formData.get("file");
  const clusterSlug = formData.get("clusterSlug");
  const sourceLabel = formData.get("sourceLabel");
  const isHandwriting = formData.get("isHandwriting") === "true";
  const generateMap = formData.get("generateMap") !== "false"; // default true

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (typeof clusterSlug !== "string" || !clusterSlug.trim()) {
    return NextResponse.json(
      { error: "clusterSlug is required" },
      { status: 400 },
    );
  }

  let cluster;
  try {
    ({ cluster } = await requireOwnedClusterFromSlug(clusterSlug));
  } catch (err) {
    return routeErrorResponse(err);
  }

  const contentPath = process.env.QUARTZ_CONTENT_PATH;
  if (!contentPath) {
    return NextResponse.json(
      { error: "QUARTZ_CONTENT_PATH is not configured" },
      { status: 500 },
    );
  }

  const normalizedClusterSlug = cluster.slug;
  const filename = file.name;
  const ext = path.extname(filename).toLowerCase().replace(".", "");
  const nameWithoutExt = path.basename(filename, path.extname(filename));
  const source =
    typeof sourceLabel === "string" && sourceLabel.trim()
      ? sourceLabel.trim()
      : "upload";
  const client = generateMap ? createChatmockClient(baseURL) : undefined;

  // Stream newline-delimited JSON: { type: "progress", step } events while the
  // pipeline runs, then a final { type: "result" } or { type: "error" }.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const startedAt = Date.now();
      const createdFilePaths: string[] = [];
      const createdMarkdownPaths: string[] = [];
      let closed = false;
      // Server-Sent Events framing ("data: …\n\n"): this streams to the client
      // chunk-by-chunk, whereas a plain JSON body gets buffered until the end.
      const send = (event: Record<string, unknown>) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // The client disconnected and the stream is already closed; stop
          // trying to write so the pipeline can unwind quietly.
          closed = true;
        }
      };
      const emit = (step: string) =>
        send({ type: "progress", step, elapsedMs: Date.now() - startedAt });

      try {
        const result = await runIngest({
          request,
          client,
          contentPath,
          file,
          normalizedClusterSlug,
          filename,
          ext,
          nameWithoutExt,
          source,
          isHandwriting,
          generateMap,
          createdFilePaths,
          createdMarkdownPaths,
          emit,
        });
        send({ type: "result", ...result, durationMs: Date.now() - startedAt });
      } catch (err) {
        if (
          err instanceof UploadAbortedError ||
          (err instanceof Error && err.name === "AbortError")
        ) {
          cleanupCreatedFiles(createdMarkdownPaths);
          cleanupCreatedFiles(createdFilePaths);
          send({ type: "error", error: "Upload canceled", canceled: true });
        } else {
          if (createdMarkdownPaths.length === 0) {
            cleanupCreatedFiles(createdFilePaths);
          }
          send({
            type: "error",
            error: errorMessage(err, "Upload failed"),
            durationMs: Date.now() - startedAt,
          });
        }
      } finally {
        closed = true;
        try {
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch {
          // Already closed (e.g. client disconnected) — nothing to do.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
