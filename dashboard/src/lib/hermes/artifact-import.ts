import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import type { ArtifactKind, ArtifactRendererId } from "./artifact-types.ts";
import { AUDIO_ATTACHMENT_FORMATS } from "../audio-attachments.ts";
import { VIDEO_ATTACHMENT_FORMATS } from "../video-attachments.ts";
import {
  MODEL_ATTACHMENT_FORMATS,
  isModelAttachmentFormat,
} from "../model-attachments.ts";
import { inspectModelUpload } from "../conversations/model-inspect.ts";

export const MAX_IMPORTED_ARTIFACT_BYTES = 128 * 1024 * 1024;
/**
 * Video and audio get their own ceiling. 128 MiB is about three and a half
 * minutes of 1080p at the quality the editor renders, which would make "edit
 * this talk" fail on length alone — and unlike a document, a long media file is
 * the normal case rather than a sign that something went wrong.
 */
export const MAX_MEDIA_ARTIFACT_BYTES = 1024 * 1024 * 1024;
const MAX_OFFICE_ARTIFACT_BYTES = 32 * 1024 * 1024;
const MAX_TEXT_ARTIFACT_BYTES = 16 * 1024 * 1024;

/** The size ceiling that applies to one kind of import. */
export function maxImportBytes(kind: ArtifactKind): number {
  return kind === "video" || kind === "audio"
    ? MAX_MEDIA_ARTIFACT_BYTES
    : MAX_IMPORTED_ARTIFACT_BYTES;
}

export interface ArtifactImportProfile {
  rendererId: ArtifactRendererId;
  mimeType: string;
  extension: string;
  previewAvailable: boolean;
}

/**
 * Extensions the store treats as an archive of other files. A produced folder is
 * stored the same way (as one ZIP), which is why the two share a validator.
 */
const ARCHIVE_MIME_TYPES: Record<string, string> = {
  ".zip": "application/zip",
  ".tar": "application/x-tar",
  ".gz": "application/gzip",
  ".tgz": "application/gzip",
  ".bz2": "application/x-bzip2",
  ".xz": "application/x-xz",
  ".7z": "application/x-7z-compressed",
  ".rar": "application/vnd.rar",
};

const TEXT_EXTENSIONS = new Set([".txt", ".text", ".log", ".srt", ".vtt", ".sub", ".nfo"]);
const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdx"]);
const HTML_EXTENSIONS = new Set([".html", ".htm", ".xhtml"]);
const DATA_EXTENSIONS = new Set([
  ".json", ".jsonl", ".ndjson", ".geojson", ".ipynb", ".xml", ".yaml", ".yml", ".toml",
]);
const DOCUMENT_EXTENSIONS = new Set([".docx", ".odt", ".doc", ".rtf", ".epub"]);
const PRESENTATION_EXTENSIONS = new Set([".pptx", ".odp", ".ppt"]);
const SPREADSHEET_EXTENSIONS = new Set([".xlsx", ".ods", ".xls", ".csv", ".tsv"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff"]);
const DIAGRAM_EXTENSIONS = new Set([".svg"]);
/**
 * Source and script files. The list only needs the formats whose extension is
 * not already claimed by a richer kind; anything else textual is still
 * importable as code by `inspectArtifactImport`.
 */
const CODE_EXTENSIONS = new Set([
  ".m", ".py", ".ipy", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".java", ".kt",
  ".c", ".h", ".cpp", ".cc", ".hpp", ".cs", ".go", ".rs", ".rb", ".php", ".swift", ".scala",
  ".sh", ".bash", ".zsh", ".ps1", ".bat", ".cmd", ".sql", ".r", ".jl", ".lua", ".pl", ".tex",
  ".bib", ".sty", ".cls", ".css", ".scss", ".less", ".vue", ".svelte", ".dart", ".ex", ".exs",
  ".erl", ".hs", ".ml", ".clj", ".lisp", ".el", ".vim", ".mk", ".cmake", ".gradle", ".ini",
  ".cfg", ".conf", ".env", ".properties", ".mmd", ".mermaid", ".dot", ".gv", ".proto",
  ".graphql", ".asm", ".s", ".v", ".vhd", ".vhdl", ".ino", ".nb", ".wl", ".do", ".sas",
  ".rmd", ".qmd",
]);

/**
 * The artifact kind a produced file most plausibly is, from its extension alone.
 * The verdict is a starting point for `inspectArtifactImport`, which checks the
 * bytes; a file that fails that check is imported as `unknown` instead so it
 * still gets a card.
 */
export function inferArtifactKindForFile(filename: string): ArtifactKind {
  const extension = path.extname(filename).toLowerCase();
  const format = extension.slice(1);
  if (extension === ".pdf") return "pdf";
  if (TEXT_EXTENSIONS.has(extension)) return "text";
  if (MARKDOWN_EXTENSIONS.has(extension)) return "markdown";
  if (HTML_EXTENSIONS.has(extension)) return "html";
  if (DOCUMENT_EXTENSIONS.has(extension)) return "document";
  if (PRESENTATION_EXTENSIONS.has(extension)) return "presentation";
  if (SPREADSHEET_EXTENSIONS.has(extension)) return "spreadsheet";
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (DIAGRAM_EXTENSIONS.has(extension)) return "diagram";
  if (DATA_EXTENSIONS.has(extension)) return "data";
  if (format && format in AUDIO_ATTACHMENT_FORMATS) return "audio";
  if (format && format in VIDEO_ATTACHMENT_FORMATS) return "video";
  if (format && isModelAttachmentFormat(format)) return "model";
  if (CODE_EXTENSIONS.has(extension)) return "code";
  return "unknown";
}

/** MIME type for an archive extension, or null when it is not one. */
export function archiveMimeType(filename: string): string | null {
  return ARCHIVE_MIME_TYPES[path.extname(filename).toLowerCase()] ?? null;
}

/**
 * The entries inside a ZIP, as the folder card lists them. Bounded, because a
 * produced folder can be a whole project and the card only needs enough to
 * say what is inside.
 */
export function listZipEntries(
  filePath: string,
  limit = 200,
): { entries: Array<{ path: string; byteSize: number }>; total: number } {
  let archive: AdmZip;
  try {
    archive = new AdmZip(filePath);
  } catch {
    return { entries: [], total: 0 };
  }
  const files = archive.getEntries().filter((entry) => !entry.isDirectory);
  return {
    entries: files.slice(0, limit).map((entry) => ({
      path: entry.entryName.replace(/\\/g, "/"),
      byteSize: entry.header.size,
    })),
    total: files.length,
  };
}

export class ArtifactImportError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ArtifactImportError";
    this.code = code;
  }
}

function startsWith(buffer: Buffer, signature: number[]): boolean {
  return signature.every((value, index) => buffer[index] === value);
}

function ascii(buffer: Buffer, start: number, length: number): string {
  return buffer.subarray(start, start + length).toString("ascii");
}

function profile(
  rendererId: ArtifactRendererId,
  mimeType: string,
  extension: string,
  previewAvailable = true,
): ArtifactImportProfile {
  return { rendererId, mimeType, extension, previewAvailable };
}

function validateSvg(filePath: string): boolean {
  const content = fs.readFileSync(filePath, "utf8");
  if (!/<svg(?:\s|>)/i.test(content)) {
    throw new ArtifactImportError("artifact_import_signature", "The file is not a valid SVG document.");
  }
  if (
    /<\s*(?:script|foreignObject|iframe|object|embed)\b/i.test(content) ||
    /\son[a-z]+\s*=/i.test(content) ||
    /\b(?:href|src)\s*=\s*["']\s*(?:https?:|file:|javascript:)/i.test(content)
  ) {
    return false;
  }
  return true;
}

function validateOfficeArchive(filePath: string, expectedEntry: string): void {
  let archive: AdmZip;
  try {
    archive = new AdmZip(filePath);
  } catch {
    throw new ArtifactImportError("artifact_import_signature", "The Office file is not a valid ZIP package.");
  }
  if (!archive.getEntry(expectedEntry)) {
    throw new ArtifactImportError(
      "artifact_import_signature",
      `The Office package is missing ${expectedEntry}.`,
    );
  }
}

function validateZipArchive(filePath: string, expectedEntry?: string): void {
  let archive: AdmZip;
  try {
    archive = new AdmZip(filePath);
    archive.getEntries();
  } catch {
    throw new ArtifactImportError("artifact_import_signature", "The file is not a valid ZIP archive.");
  }
  if (expectedEntry && !archive.getEntry(expectedEntry)) {
    throw new ArtifactImportError(
      "artifact_import_signature",
      `The archive is missing ${expectedEntry}.`,
    );
  }
}

function validateText(filePath: string): string {
  const content = fs.readFileSync(filePath);
  if (content.includes(0)) {
    throw new ArtifactImportError("artifact_import_binary_text", "The selected text artifact contains binary data.");
  }
  return content.toString("utf8");
}

function imageProfile(header: Buffer, extension: string): ArtifactImportProfile | null {
  if (startsWith(header, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return profile("image-file", "image/png", ".png");
  }
  if (startsWith(header, [0xff, 0xd8, 0xff])) {
    return profile("image-file", "image/jpeg", extension === ".jpeg" ? ".jpeg" : ".jpg");
  }
  if (ascii(header, 0, 6) === "GIF87a" || ascii(header, 0, 6) === "GIF89a") {
    return profile("image-file", "image/gif", ".gif");
  }
  if (ascii(header, 0, 4) === "RIFF" && ascii(header, 8, 4) === "WEBP") {
    return profile("image-file", "image/webp", ".webp");
  }
  if (ascii(header, 0, 2) === "BM" && extension === ".bmp") {
    return profile("image-file", "image/bmp", ".bmp");
  }
  if (
    (startsWith(header, [0x49, 0x49, 0x2a, 0x00]) || startsWith(header, [0x4d, 0x4d, 0x00, 0x2a])) &&
    (extension === ".tif" || extension === ".tiff")
  ) {
    // Browsers do not render TIFF, so the card offers a download rather than a
    // preview that would come up blank.
    return profile("image-file", "image/tiff", extension, false);
  }
  return null;
}

const OLE_COMPOUND_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

function safeExtension(extension: string, fallback: string): string {
  return /^[.][a-z0-9+_-]{1,12}$/i.test(extension) ? extension : fallback;
}

function mediaProfile(
  kind: "audio" | "video",
  header: Buffer,
  extension: string,
): ArtifactImportProfile | null {
  const renderer = kind === "audio" ? "audio-file" : "video-file";
  if (
    kind === "audio" &&
    extension === ".aac" &&
    header[0] === 0xff &&
    (header[1] & 0xf6) === 0xf0
  ) {
    return profile(renderer, AUDIO_ATTACHMENT_FORMATS.aac.mimeType, ".aac");
  }
  if (
    kind === "audio" &&
    extension === ".mp3" &&
    (ascii(header, 0, 3) === "ID3" ||
      (header[0] === 0xff && (header[1] & 0xe0) === 0xe0))
  ) {
    return profile(renderer, "audio/mpeg", ".mp3");
  }
  if (kind === "audio" && ascii(header, 0, 4) === "RIFF" && ascii(header, 8, 4) === "WAVE") {
    return profile(renderer, "audio/wav", ".wav");
  }
  if (kind === "audio" && ascii(header, 0, 4) === "fLaC") {
    return profile(renderer, AUDIO_ATTACHMENT_FORMATS.flac.mimeType, ".flac");
  }
  if (ascii(header, 0, 4) === "OggS") {
    if (kind === "audio" && (extension === ".ogg" || extension === ".oga")) {
      return profile(renderer, AUDIO_ATTACHMENT_FORMATS[extension.slice(1) as "ogg" | "oga"].mimeType, extension);
    }
    return kind === "video" && extension === ".webm"
      ? null
      : profile(renderer, kind === "audio" ? "audio/ogg" : "video/ogg", extension);
  }
  if (
    kind === "video" &&
    startsWith(header, [0x1a, 0x45, 0xdf, 0xa3])
  ) {
    if (extension !== ".webm" && extension !== ".mkv") return null;
    const format = extension.slice(1) as "webm" | "mkv";
    return profile(renderer, VIDEO_ATTACHMENT_FORMATS[format].mimeType, extension);
  }
  if (ascii(header, 4, 4) === "ftyp") {
    if (kind === "audio") {
      if (![".m4a", ".mp4a"].includes(extension)) return null;
      const format = extension.slice(1) as "m4a" | "mp4a";
      return profile(renderer, AUDIO_ATTACHMENT_FORMATS[format].mimeType, extension);
    }
    if (![".mp4", ".mov", ".m4v"].includes(extension)) return null;
    const format = extension.slice(1) as "mp4" | "mov" | "m4v";
    return profile(
      renderer,
      VIDEO_ATTACHMENT_FORMATS[format].mimeType,
      extension,
    );
  }
  if (kind === "video" && ascii(header, 0, 4) === "RIFF" && ascii(header, 8, 4) === "AVI ") {
    return profile(renderer, VIDEO_ATTACHMENT_FORMATS.avi.mimeType, ".avi", false);
  }
  if (
    kind === "video" &&
    (startsWith(header, [0x00, 0x00, 0x01, 0xba]) || startsWith(header, [0x00, 0x00, 0x01, 0xb3])) &&
    (extension === ".mpg" || extension === ".mpeg")
  ) {
    return profile(renderer, VIDEO_ATTACHMENT_FORMATS[extension.slice(1) as "mpg" | "mpeg"].mimeType, extension, false);
  }
  if (
    kind === "video" &&
    extension === ".wmv" &&
    startsWith(header, [0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9, 0x00, 0xaa, 0x00, 0x62, 0xce, 0x6c])
  ) {
    return profile(renderer, VIDEO_ATTACHMENT_FORMATS.wmv.mimeType, ".wmv", false);
  }
  return null;
}

/**
 * Validate a generated file before it crosses from an authorized workspace
 * into Breadboard's durable artifact store. Extension alone is never trusted.
 */
export function inspectArtifactImport(
  filePath: string,
  kind: ArtifactKind,
): ArtifactImportProfile {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    throw new ArtifactImportError("artifact_import_not_file", "Only regular files can be imported as artifacts.");
  }
  if (stat.size <= 0) {
    throw new ArtifactImportError("artifact_import_empty", "The generated artifact file is empty.");
  }
  if (stat.size > maxImportBytes(kind)) {
    throw new ArtifactImportError(
      "artifact_import_too_large",
      `Imported ${kind} artifacts cannot exceed ${maxImportBytes(kind)} bytes.`,
    );
  }
  const extension = path.extname(filePath).toLowerCase();
  const descriptor = fs.openSync(filePath, "r");
  const header = Buffer.alloc(Math.min(4_096, stat.size));
  try {
    fs.readSync(descriptor, header, 0, header.length, 0);
  } finally {
    fs.closeSync(descriptor);
  }

  if (kind === "pdf") {
    // A PDF always starts with %PDF-; a paywall page saved under a .pdf name
    // does not, which is exactly the substitution worth catching here.
    if (ascii(header, 0, 5) === "%PDF-") {
      return profile("pdf-file", "application/pdf", ".pdf");
    }
    throw new ArtifactImportError(
      "artifact_import_signature",
      "The file is not a PDF document.",
    );
  }
  if (kind === "text" && TEXT_EXTENSIONS.has(extension)) {
    if (stat.size > MAX_TEXT_ARTIFACT_BYTES) {
      throw new ArtifactImportError("artifact_import_too_large", "Text imports cannot exceed 16 MiB.");
    }
    validateText(filePath);
    return profile("text-file", "text/plain; charset=utf-8", extension);
  }
  if (kind === "markdown" && MARKDOWN_EXTENSIONS.has(extension)) {
    if (stat.size > MAX_TEXT_ARTIFACT_BYTES) {
      throw new ArtifactImportError("artifact_import_too_large", "Markdown imports cannot exceed 16 MiB.");
    }
    validateText(filePath);
    return profile("markdown-file", "text/markdown; charset=utf-8", extension);
  }
  if (kind === "html" && HTML_EXTENSIONS.has(extension)) {
    if (stat.size > MAX_TEXT_ARTIFACT_BYTES) {
      throw new ArtifactImportError("artifact_import_too_large", "HTML imports cannot exceed 16 MiB.");
    }
    validateText(filePath);
    return profile("html-file", "text/html; charset=utf-8", extension);
  }
  if (kind === "image") {
    const detected = imageProfile(header, extension);
    if (detected) return detected;
  }
  if (kind === "diagram") {
    const detected = imageProfile(header, extension);
    if (detected) return { ...detected, rendererId: "diagram-file" };
    if (extension === ".svg") {
      return profile("diagram-file", "image/svg+xml", ".svg", validateSvg(filePath));
    }
  }
  if (kind === "audio" || kind === "video") {
    const detected = mediaProfile(kind, header, extension);
    if (detected) return detected;
  }
  if (kind === "document" && extension === ".docx") {
    if (stat.size > MAX_OFFICE_ARTIFACT_BYTES) {
      throw new ArtifactImportError("artifact_import_too_large", "Document imports cannot exceed 32 MiB.");
    }
    validateOfficeArchive(filePath, "word/document.xml");
    return profile(
      "document-file",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".docx",
      false,
    );
  }
  if (kind === "document" && extension === ".odt") {
    validateZipArchive(filePath, "content.xml");
    return profile("document-file", "application/vnd.oasis.opendocument.text", ".odt", false);
  }
  if (kind === "document" && extension === ".rtf") {
    if (stat.size > MAX_TEXT_ARTIFACT_BYTES) {
      throw new ArtifactImportError("artifact_import_too_large", "Document imports cannot exceed 16 MiB.");
    }
    if (ascii(header, 0, 5) !== "{\\rtf") {
      throw new ArtifactImportError("artifact_import_signature", "The file is not an RTF document.");
    }
    return profile("document-file", "application/rtf", ".rtf", false);
  }
  if (kind === "document" && extension === ".doc") {
    if (!startsWith(header, OLE_COMPOUND_SIGNATURE)) {
      throw new ArtifactImportError("artifact_import_signature", "The file is not a Word 97-2003 document.");
    }
    return profile("document-file", "application/msword", ".doc", false);
  }
  if (kind === "document" && extension === ".epub") {
    validateZipArchive(filePath, "META-INF/container.xml");
    return profile("document-file", "application/epub+zip", ".epub", false);
  }
  if (kind === "presentation" && extension === ".pptx") {
    if (stat.size > MAX_OFFICE_ARTIFACT_BYTES) {
      throw new ArtifactImportError("artifact_import_too_large", "Presentation imports cannot exceed 32 MiB.");
    }
    validateOfficeArchive(filePath, "ppt/presentation.xml");
    return profile(
      "presentation-file",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ".pptx",
      false,
    );
  }
  if (kind === "presentation" && extension === ".odp") {
    validateZipArchive(filePath, "content.xml");
    return profile("presentation-file", "application/vnd.oasis.opendocument.presentation", ".odp", false);
  }
  if (kind === "presentation" && extension === ".ppt") {
    if (!startsWith(header, OLE_COMPOUND_SIGNATURE)) {
      throw new ArtifactImportError("artifact_import_signature", "The file is not a PowerPoint 97-2003 deck.");
    }
    return profile("presentation-file", "application/vnd.ms-powerpoint", ".ppt", false);
  }
  if (kind === "spreadsheet") {
    if (extension === ".xlsx") {
      if (stat.size > MAX_OFFICE_ARTIFACT_BYTES) {
        throw new ArtifactImportError("artifact_import_too_large", "Spreadsheet imports cannot exceed 32 MiB.");
      }
      validateOfficeArchive(filePath, "xl/workbook.xml");
      return profile(
        "spreadsheet-file",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".xlsx",
        false,
      );
    }
    if (extension === ".ods") {
      validateZipArchive(filePath, "content.xml");
      return profile("spreadsheet-file", "application/vnd.oasis.opendocument.spreadsheet", ".ods", false);
    }
    if (extension === ".xls") {
      if (!startsWith(header, OLE_COMPOUND_SIGNATURE)) {
        throw new ArtifactImportError("artifact_import_signature", "The file is not an Excel 97-2003 workbook.");
      }
      return profile("spreadsheet-file", "application/vnd.ms-excel", ".xls", false);
    }
    if (extension === ".csv" || extension === ".tsv") {
      if (stat.size > MAX_TEXT_ARTIFACT_BYTES) {
        throw new ArtifactImportError("artifact_import_too_large", "Delimited spreadsheet imports cannot exceed 16 MiB.");
      }
      // A one-column CSV/TSV is still a valid delimited table, even though it
      // contains no delimiter character. Text validation is the reliable
      // boundary here; the spreadsheet editor decides how many columns exist.
      validateText(filePath);
      return profile(
        "spreadsheet-file",
        extension === ".tsv" ? "text/tab-separated-values; charset=utf-8" : "text/csv; charset=utf-8",
        extension,
      );
    }
  }
  if (kind === "data") {
    if (stat.size > MAX_TEXT_ARTIFACT_BYTES) {
      throw new ArtifactImportError("artifact_import_too_large", "Text data imports cannot exceed 16 MiB.");
    }
    const content = validateText(filePath);
    if (extension === ".json") {
      try {
        JSON.parse(content);
      } catch {
        throw new ArtifactImportError("artifact_import_signature", "The selected JSON artifact is invalid.");
      }
      return profile("data-file", "application/json; charset=utf-8", ".json");
    }
    if (extension === ".csv") {
      return profile("data-file", "text/csv; charset=utf-8", ".csv");
    }
    if (extension === ".ipynb" || extension === ".geojson") {
      try {
        JSON.parse(content);
      } catch {
        throw new ArtifactImportError("artifact_import_signature", `The selected ${extension.slice(1)} artifact is not valid JSON.`);
      }
      return profile(
        "data-file",
        extension === ".ipynb" ? "application/x-ipynb+json; charset=utf-8" : "application/geo+json; charset=utf-8",
        extension,
      );
    }
    if (extension === ".jsonl" || extension === ".ndjson") {
      return profile("data-file", "application/x-ndjson; charset=utf-8", extension);
    }
    if (extension === ".xml") {
      return profile("data-file", "application/xml; charset=utf-8", ".xml");
    }
    if (extension === ".yaml" || extension === ".yml") {
      return profile("data-file", "application/yaml; charset=utf-8", extension);
    }
    if (extension === ".toml") {
      return profile("data-file", "application/toml; charset=utf-8", ".toml");
    }
    if (extension === ".tsv") {
      return profile("data-file", "text/tab-separated-values; charset=utf-8", ".tsv");
    }
  }
  if (kind === "code") {
    if (stat.size > MAX_TEXT_ARTIFACT_BYTES) {
      throw new ArtifactImportError("artifact_import_too_large", "Code imports cannot exceed 16 MiB.");
    }
    validateText(filePath);
    const safeExtension = /^[.][a-z0-9+_-]{1,12}$/i.test(extension) ? extension : ".txt";
    return profile("code", "text/plain; charset=utf-8", safeExtension);
  }
  if (kind === "model") {
    const format = extension.slice(1);
    if (!isModelAttachmentFormat(format)) {
      throw new ArtifactImportError("artifact_import_signature", "That 3D model format is not supported.");
    }
    try {
      inspectModelUpload(fs.readFileSync(filePath), format);
    } catch {
      throw new ArtifactImportError("artifact_import_signature", "The file does not match its 3D model format.");
    }
    const descriptor = MODEL_ATTACHMENT_FORMATS[format];
    return profile("model-file", descriptor.mimeType, extension, format === "glb");
  }
  if (kind === "unknown" && extension === ".zip") {
    validateZipArchive(filePath);
    return profile("archive-file", "application/zip", ".zip", false);
  }
  if (kind === "unknown" && extension in ARCHIVE_MIME_TYPES) {
    if (extension === ".gz" || extension === ".tgz") {
      if (!startsWith(header, [0x1f, 0x8b])) {
        throw new ArtifactImportError("artifact_import_signature", "The file is not a gzip archive.");
      }
    } else if (extension === ".7z" && !startsWith(header, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) {
      throw new ArtifactImportError("artifact_import_signature", "The file is not a 7-Zip archive.");
    } else if (extension === ".rar" && ascii(header, 0, 4) !== "Rar!") {
      throw new ArtifactImportError("artifact_import_signature", "The file is not a RAR archive.");
    } else if (extension === ".bz2" && ascii(header, 0, 3) !== "BZh") {
      throw new ArtifactImportError("artifact_import_signature", "The file is not a bzip2 archive.");
    } else if (extension === ".xz" && !startsWith(header, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])) {
      throw new ArtifactImportError("artifact_import_signature", "The file is not an xz archive.");
    }
    return profile("archive-file", ARCHIVE_MIME_TYPES[extension]!, extension, false);
  }
  if (kind === "unknown") {
    // Whatever else a turn produced — a MATLAB live script, a compiled
    // binary, a font — is still the user's file. It gets a card with a
    // download and no preview; refusing it here is what left produced files
    // sitting in Downloads with nothing in the chat to show for them.
    return profile("binary-file", "application/octet-stream", safeExtension(extension, ".bin"), false);
  }
  if (kind === "folder" && extension === ".zip") {
    validateZipArchive(filePath);
    return profile("folder-archive", "application/zip", ".zip", false);
  }

  throw new ArtifactImportError(
    "artifact_import_signature",
    `The generated file does not match an allowed ${kind} artifact format.`,
  );
}
