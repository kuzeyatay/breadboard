/** Client-safe contracts for original files kept alongside a Garden's notes. */
export type GardenFileViewer = "text" | "markdown" | "table" | "json" | "html" | "image" | "pdf" | "document" | "spreadsheet" | "presentation" | "audio" | "video" | "model" | "archive" | "binary";
export type GardenFileEditor = "text" | "docx" | "cells" | "blocks" | "pdf";

export interface FileCapabilities {
  viewer: GardenFileViewer;
  editor: GardenFileEditor | null;
  mimeType: string;
  canIndex: boolean;
}

export interface GardenFileEntry {
  id: string;
  gardenId: string;
  kind: "file" | "folder";
  name: string;
  path: string;
  folder: string;
  size: number;
  mimeType: string;
  version: number;
  revision: number;
  visibility: "private" | "garden";
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  canEdit: boolean;
  capabilities: FileCapabilities;
}

export interface GardenFileVersion {
  version: number;
  size: number;
  sha256: string;
  createdAt: string;
}

export const GARDEN_FILE_TEXT_LIMIT = 5 * 1024 * 1024;
export const GARDEN_FILE_OFFICE_LIMIT = 128 * 1024 * 1024;
export const GARDEN_FILE_IMPORT_LIMIT = 2 * 1024 * 1024 * 1024;

const textExtensions = new Set("txt text log tex bib rst adoc md markdown csv tsv json jsonl ndjson xml svg html htm js jsx mjs cjs ts tsx py pyw java c h cpp hpp cc cxx css scss sass less yaml yml toml ini cfg conf sql sh bash zsh ps1 bat cmd rs go rb php swift kt kts scala lua r vue svelte m cir ckt sp spice net bbcir vcf ics gitignore env dockerfile makefile".split(" "));
const imageTypes: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", bmp: "image/bmp", ico: "image/x-icon", svg: "image/svg+xml" };
const audioTypes: Record<string, string> = { mp3: "audio/mpeg", wav: "audio/wav", flac: "audio/flac", ogg: "audio/ogg", oga: "audio/ogg", m4a: "audio/mp4", aac: "audio/aac" };
const videoTypes: Record<string, string> = { mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime" };
const models = new Set("glb gltf obj stl ply fbx 3mf dae 3ds amf wrl vtk pcd xyz usdz kmz lwo vox gcode pdb step stp iges igs brep".split(" "));

export function gardenFileExtension(name: string): string {
  return name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : name.toLowerCase();
}

/** Storage accepts every extension. This registry only determines available tools. */
export function gardenFileCapabilities(name: string, size = 0): FileCapabilities {
  const ext = gardenFileExtension(name);
  const textEditor = size <= GARDEN_FILE_TEXT_LIMIT ? "text" : null;
  const office = size <= GARDEN_FILE_OFFICE_LIMIT;
  const capability = (viewer: GardenFileViewer, mimeType: string, editor: GardenFileEditor | null = null, canIndex = false): FileCapabilities => ({ viewer, mimeType, editor, canIndex });
  if (ext === "pdf") return capability("pdf", "application/pdf", office ? "pdf" : null, true);
  if (ext === "docx") return capability("document", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", office ? "docx" : null, true);
  if (ext === "xlsx") return capability("spreadsheet", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", office ? "cells" : null, true);
  if (ext === "pptx") return capability("presentation", "application/vnd.openxmlformats-officedocument.presentationml.presentation", office ? "blocks" : null, true);
  if (["odt", "ods", "odp"].includes(ext)) return capability("document", `application/vnd.oasis.opendocument.${ext === "odt" ? "text" : ext === "ods" ? "spreadsheet" : "presentation"}`, null, true);
  if (imageTypes[ext]) return capability("image", imageTypes[ext], ext === "svg" ? textEditor : null, ["png", "jpg", "jpeg", "webp", "svg"].includes(ext));
  if (audioTypes[ext]) return capability("audio", audioTypes[ext]);
  if (videoTypes[ext]) return capability("video", videoTypes[ext]);
  if (models.has(ext)) return capability(office ? "model" : "binary", "application/octet-stream");
  if (ext === "zip") return capability("archive", "application/zip");
  if (ext === "md" || ext === "markdown") return capability("markdown", "text/markdown; charset=utf-8", textEditor, true);
  if (ext === "csv" || ext === "tsv") return capability("table", ext === "csv" ? "text/csv; charset=utf-8" : "text/tab-separated-values; charset=utf-8", textEditor, true);
  if (ext === "json") return capability("json", "application/json; charset=utf-8", textEditor, true);
  if (ext === "html" || ext === "htm") return capability("html", "text/html; charset=utf-8", textEditor, true);
  if (textExtensions.has(ext)) return capability("text", "text/plain; charset=utf-8", textEditor, true);
  return capability("binary", "application/octet-stream");
}

export function gardenFileApi(gardenId: string, fileId?: string): string {
  return `/api/gardens/${encodeURIComponent(gardenId)}/files${fileId ? `/${encodeURIComponent(fileId)}` : ""}`;
}

export function gardenFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const unit = Math.min(3, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** unit).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${["B", "KB", "MB", "GB"][unit]}`;
}
