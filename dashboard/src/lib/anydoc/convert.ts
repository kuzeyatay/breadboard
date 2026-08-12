// Server-only: run an uploaded document through anydoc.
//
// anydoc (github.com/firecrawl/anydoc, cloned at ../../anydoc) is a Rust
// library that converts Word, PowerPoint, Excel, OpenDocument, RTF, EPUB, CSV
// and PDF into GitHub-Flavored Markdown. Breadboard uses its Node bindings —
// `@firecrawl/anydoc`, whose prebuilt win32-x64-msvc binary is the compiled
// form of the clone's `v0.1.7` tag. The clone is the readable source of truth
// for behaviour (formats, error codes, how the renderer treats anchors and
// embedded images); it cannot be built here because there is no Rust toolchain
// on this machine, so the published binary stands in for it.
//
// What this buys the ingest pipeline: before anydoc, `.docx` was
// `word/document.xml` with the tags stripped by a regex, `.xlsx` was
// tab-joined cell values, and `.pptx` was slides glued together with `---`.
// Headings, tables, lists and links all died in that pass. anydoc keeps them,
// and it runs locally in milliseconds, so it costs no ChatMock quota.

import { anydocFormatForExtension, anydocPageLabel } from "./formats.ts";
import type { AnydocFormat } from "./formats.ts";
import {
  anydocSectionPlainText,
  sanitizeAnydocMarkdown,
} from "./sanitize.ts";

/** Pinned in package.json; shown in the upload dialog so the build is legible. */
export const ANYDOC_VERSION = "0.1.7";

/** Sections beyond this collapse into one: a heading-per-line document should
 *  not turn into a thousand one-line citations. */
const MAX_SECTIONS = 120;
/** Embedded images saved per document. */
const MAX_EMBEDDED_IMAGES = 24;

// ── The native module ───────────────────────────────────────────────────────

interface AnydocAsset {
  id: number;
  mediaType: string;
  originPart: string;
  data: Buffer;
}

interface AnydocModule {
  toMarkdownBytes(
    bytes: Uint8Array,
    format?: string | null,
  ): Promise<string>;
  toDocument(
    bytes: Uint8Array,
    format?: string | null,
  ): Promise<{ assets: AnydocAsset[] }>;
  formatFromBytes(bytes: Uint8Array): string | null;
}

let cachedModule: AnydocModule | null = null;
let cachedLoadError: string | null = null;

/**
 * Load the bindings once. A failure is remembered rather than retried: the only
 * way it fails is a missing or wrong-platform binary, which will not fix itself
 * between two uploads, and the status probe would otherwise pay for the attempt
 * every time the upload dialog opens.
 */
async function loadAnydoc(): Promise<AnydocModule | null> {
  if (cachedModule) return cachedModule;
  if (cachedLoadError !== null) return null;
  try {
    cachedModule = (await import("@firecrawl/anydoc")) as unknown as AnydocModule;
    return cachedModule;
  } catch (error) {
    cachedLoadError =
      error instanceof Error ? error.message : "the module could not be loaded";
    return null;
  }
}

/** Test hook: drop the cached module so a reinstall is picked up. */
export function resetAnydocModuleCache(): void {
  cachedModule = null;
  cachedLoadError = null;
}

function anydocEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = (env.ANYDOC_ENABLED ?? "").trim();
  if (!value) return true;
  return /^(1|true|yes|on)$/i.test(value);
}

export interface AnydocAvailability {
  enabled: boolean;
  available: boolean;
  version: string;
  detail?: string;
}

export async function anydocAvailability(): Promise<AnydocAvailability> {
  const enabled = anydocEnabled();
  if (!enabled) {
    return { enabled: false, available: false, version: ANYDOC_VERSION };
  }
  const anydoc = await loadAnydoc();
  if (!anydoc || typeof anydoc.toMarkdownBytes !== "function") {
    return {
      enabled: true,
      available: false,
      version: ANYDOC_VERSION,
      detail: cachedLoadError ?? "the module exported no converter",
    };
  }
  return { enabled: true, available: true, version: ANYDOC_VERSION };
}

// ── Errors ──────────────────────────────────────────────────────────────────

/**
 * anydoc fails a conversion only when no meaningful Markdown could come out of
 * the bytes; producer quirks are recovered or skipped instead. The `code` names
 * which of those it was, and each maps to something a person can act on.
 */
const CODE_MESSAGES: Record<string, string> = {
  unsupported:
    "anydoc cannot convert this file — a scanned, image-only PDF is the usual cause. Try Parse using VLM or handwriting OCR instead.",
  malformed:
    "The file is structurally unusable, so no readable content could be extracted from it.",
  encrypted: "The file is encrypted or password-protected.",
  resourceLimit:
    "The file crossed one of anydoc's safety limits (decompression, nesting depth, or node count).",
  missingPart:
    "The file is missing a part that any meaningful output would need.",
  io: "The file could not be read.",
};

export class AnydocConvertError extends Error {
  readonly code: string;

  constructor(code: string, detail: string) {
    super(CODE_MESSAGES[code] ?? detail ?? "anydoc could not convert the file.");
    this.name = "AnydocConvertError";
    this.code = code;
  }
}

export class AnydocUnavailableError extends Error {
  constructor(detail: string) {
    super(
      `anydoc is not available: ${detail}. Reinstall @firecrawl/anydoc, or upload without the anydoc option.`,
    );
    this.name = "AnydocUnavailableError";
  }
}

function toConvertError(error: unknown): Error {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String((error as { code?: unknown }).code ?? "");
    if (code in CODE_MESSAGES) {
      return new AnydocConvertError(
        code,
        error instanceof Error ? error.message : code,
      );
    }
  }
  return error instanceof Error
    ? error
    : new Error("anydoc could not convert the file.");
}

// ── Sections ────────────────────────────────────────────────────────────────

export interface AnydocSection {
  label: string;
  text: string;
}

interface HeadingLine {
  index: number;
  level: number;
  title: string;
}

/**
 * Split a conversion at its shallowest heading level, so a spreadsheet becomes
 * one section per sheet and a book one per chapter. These sections are what the
 * knowledge extractor cites, so their labels have to be distinct and readable.
 */
export function splitAnydocSections(
  markdown: string,
  fallbackLabel: string,
): AnydocSection[] {
  const lines = markdown.split("\n");
  const headings: HeadingLine[] = [];
  let inFence = false;

  lines.forEach((line, index) => {
    if (/^\s{0,3}(```|~~~)/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const match = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line);
    if (!match) return;
    const title = match[2].replace(/\s+#+\s*$/, "").trim();
    if (title) headings.push({ index, level: match[1].length, title });
  });

  const single = (): AnydocSection[] => {
    const text = anydocSectionPlainText(markdown);
    return text ? [{ label: fallbackLabel, text }] : [];
  };

  if (headings.length === 0) return single();

  const topLevel = Math.min(...headings.map((heading) => heading.level));
  const splits = headings.filter((heading) => heading.level === topLevel);
  if (splits.length > MAX_SECTIONS) return single();

  // Section labels are what a citation points at, so repeated headings — two
  // sheets both called "Sheet1" — have to stay tellable apart.
  const used = new Map<string, number>();
  const label = (title: string): string => {
    const base = anydocSectionPlainText(title).slice(0, 80) || fallbackLabel;
    const seen = (used.get(base) ?? 0) + 1;
    used.set(base, seen);
    return seen === 1 ? base : `${base} (${seen})`;
  };

  const sections: AnydocSection[] = [];
  const push = (title: string, from: number, to: number) => {
    const text = anydocSectionPlainText(lines.slice(from, to).join("\n"));
    if (text) sections.push({ label: label(title), text });
  };

  // Anything before the first heading is its own section: a front page or an
  // abstract is content, not a stray.
  push(fallbackLabel, 0, splits[0].index);
  splits.forEach((heading, order) => {
    const end = splits[order + 1]?.index ?? lines.length;
    push(heading.title, heading.index + 1, end);
  });

  return sections.length > 0 ? sections : single();
}

// ── Conversion ──────────────────────────────────────────────────────────────

export interface AnydocImageSaver {
  (image: {
    index: number;
    mediaType: string;
    originPart: string;
    data: Buffer;
  }): string | null;
}

export interface AnydocConversion {
  /** GFM for the source note, already lowered to what Breadboard renders. */
  markdown: string;
  /** One entry per top-level section, for knowledge extraction and citations. */
  sections: AnydocSection[];
  /** Relative paths of the embedded images that were saved. */
  imagePaths: string[];
  warnings: string[];
  format: AnydocFormat;
}

/**
 * Convert one uploaded document.
 *
 * `saveImage` is optional: the Markdown renderer cannot embed bytes, so anydoc
 * renders an embedded image as its alt text and keeps the bytes on the document
 * model. When a saver is given, those bytes are written beside the note and
 * listed under a "Embedded images" heading — the pictures are kept, though not
 * at the positions they held in the original.
 */
export async function convertWithAnydoc({
  bytes,
  ext,
  saveImage,
  onProgress,
}: {
  bytes: Buffer;
  ext: string;
  saveImage?: AnydocImageSaver;
  onProgress?: (step: string) => void;
}): Promise<AnydocConversion> {
  const anydoc = await loadAnydoc();
  if (!anydoc) {
    throw new AnydocUnavailableError(cachedLoadError ?? "unknown reason");
  }
  if (!anydocEnabled()) {
    throw new AnydocUnavailableError("ANYDOC_ENABLED is false");
  }

  const byExtension = anydocFormatForExtension(ext);
  // Content detection is the authority — a mislabelled `.docx` that is really
  // an `.rtf` still converts. The extension is the fallback the signature-less
  // formats (CSV) need.
  let detected: string | null = null;
  try {
    detected = anydoc.formatFromBytes(bytes);
  } catch {
    detected = null;
  }
  const format = (detected ?? byExtension) as AnydocFormat | null;
  if (!format) {
    throw new AnydocConvertError(
      "unsupported",
      `anydoc does not recognize ${ext ? `.${ext}` : "this"} files.`,
    );
  }

  onProgress?.("Converting the document with anydoc…");
  let rawMarkdown: string;
  try {
    rawMarkdown = await anydoc.toMarkdownBytes(bytes, format);
  } catch (error) {
    throw toConvertError(error);
  }

  const warnings: string[] = [];
  const imagePaths: string[] = [];

  // PDFs have no document-model form in anydoc (the PDF frontend emits Markdown
  // directly), so there are no assets to pull out of one.
  if (saveImage && format !== "pdf") {
    try {
      const document = await anydoc.toDocument(bytes, format);
      const images = document.assets.filter((asset) =>
        asset.mediaType.startsWith("image/"),
      );
      const kept = images.slice(0, MAX_EMBEDDED_IMAGES);
      kept.forEach((asset, index) => {
        const saved = saveImage({
          index: index + 1,
          mediaType: asset.mediaType,
          originPart: asset.originPart,
          data: asset.data,
        });
        if (saved) imagePaths.push(saved);
      });
      if (images.length > kept.length) {
        warnings.push(
          `Saved the first ${kept.length} of ${images.length} embedded images to keep the upload stable.`,
        );
      }
    } catch {
      // Losing the pictures is not losing the document: the text conversion
      // already succeeded, so report it as a warning and keep going.
      warnings.push(
        "The embedded images could not be read out of this file, so only its text was saved.",
      );
    }
  }

  const text = sanitizeAnydocMarkdown(rawMarkdown);
  if (!text.trim()) {
    throw new AnydocConvertError(
      "malformed",
      "anydoc produced no content for this file.",
    );
  }

  // Sections come from the text alone. The image gallery is a heading the
  // document never had, and a section of nothing but alt text is noise in
  // everything downstream that reads them.
  const sections = splitAnydocSections(text, anydocPageLabel(format));
  const markdown =
    imagePaths.length > 0
      ? `${text}\n\n## Embedded images\n\n${imagePaths
          .map(
            (relativePath, index) =>
              `![Embedded image ${index + 1}](${relativePath})`,
          )
          .join("\n\n")}`
      : text;

  return { markdown, sections, imagePaths, warnings, format };
}
