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
  return null;
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
  if (kind === "text" && extension === ".txt") {
    if (stat.size > MAX_TEXT_ARTIFACT_BYTES) {
      throw new ArtifactImportError("artifact_import_too_large", "Text imports cannot exceed 16 MiB.");
    }
    validateText(filePath);
    return profile("text-file", "text/plain; charset=utf-8", ".txt");
  }
  if (kind === "markdown" && (extension === ".md" || extension === ".markdown")) {
    if (stat.size > MAX_TEXT_ARTIFACT_BYTES) {
      throw new ArtifactImportError("artifact_import_too_large", "Markdown imports cannot exceed 16 MiB.");
    }
    validateText(filePath);
    return profile("markdown-file", "text/markdown; charset=utf-8", extension);
  }
  if (kind === "html" && (extension === ".html" || extension === ".htm")) {
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

  throw new ArtifactImportError(
    "artifact_import_signature",
    `The generated file does not match an allowed ${kind} artifact format.`,
  );
}
