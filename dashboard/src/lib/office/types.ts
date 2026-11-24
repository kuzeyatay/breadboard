/** Client-safe registry of the files the Spaces page creates and lists (Office documents, AFFiNE pages, designs, videos). */
export type OfficeKind = "docx" | "xlsx" | "pptx" | "md" | "html" | "pdf" | "affine" | "png" | "mp4";
export type OfficeTab = "docs" | "sheets" | "slides" | "pdf" | "markdown" | "html" | "pages" | "designs" | "videos";

export interface OfficeKindInfo {
  kind: OfficeKind;
  tab: OfficeTab;
  /** Tile title. */
  label: string;
  /** What Bread is asked to make, in a sentence. */
  noun: string;
  badge: string;
  color: string;
  extensions: readonly string[];
  /** Images and videos are everywhere in a Garden; only the ones in a Spaces folder count as designs and videos. */
  spacesFolderOnly?: boolean;
}

export const OFFICE_KINDS: readonly OfficeKindInfo[] = [
  { kind: "docx", tab: "docs", label: "Docs", noun: "Word document", badge: "W", color: "#2b6fd6", extensions: ["docx", "doc", "odt", "rtf"] },
  { kind: "xlsx", tab: "sheets", label: "Sheets", noun: "Excel spreadsheet", badge: "X", color: "#1f8a4c", extensions: ["xlsx", "xls", "ods", "csv", "tsv"] },
  { kind: "pptx", tab: "slides", label: "Slides", noun: "PowerPoint presentation", badge: "P", color: "#c8462d", extensions: ["pptx", "ppt", "odp"] },
  { kind: "affine", tab: "pages", label: "Pages", noun: "page", badge: "A", color: "#1e96eb", extensions: ["affine"] },
  { kind: "md", tab: "markdown", label: "Markdown", noun: "Markdown document", badge: "M↓", color: "#7a4fd1", extensions: ["md", "markdown"] },
  { kind: "html", tab: "html", label: "HTML", noun: "HTML page", badge: "</>", color: "#14857a", extensions: ["html", "htm"] },
  { kind: "pdf", tab: "pdf", label: "PDF", noun: "PDF", badge: "PDF", color: "#c42b2b", extensions: ["pdf"] },
  { kind: "png", tab: "designs", label: "Design", noun: "design", badge: "D", color: "#d1477a", extensions: ["png", "jpg", "jpeg", "webp"], spacesFolderOnly: true },
  { kind: "mp4", tab: "videos", label: "Video", noun: "video", badge: "▶︎", color: "#334155", extensions: ["mp4", "webm", "mov"], spacesFolderOnly: true },
];

/** Where new Spaces files go. Files made before Spaces live in "Office" and stay listed. */
export const OFFICE_FOLDER = "Spaces";
export const SPACES_FOLDERS = ["Spaces", "Office"] as const;

const extensionOf = (name: string) => name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";

export function officeKindForName(name: string): OfficeKindInfo | null {
  const ext = extensionOf(name);
  return OFFICE_KINDS.find(info => !info.spacesFolderOnly && info.extensions.includes(ext)) ?? null;
}

export const inSpacesFolder = (path: string) => SPACES_FOLDERS.some(folder => path === folder || path.startsWith(`${folder}/`));

/** The kind a Garden file has on the Spaces page, or null when Spaces does not list it. */
export function spacesKindForPath(path: string): OfficeKindInfo | null {
  const ext = extensionOf(path);
  const info = OFFICE_KINDS.find(kind => kind.extensions.includes(ext)) ?? null;
  return info && (!info.spacesFolderOnly || inSpacesFolder(path)) ? info : null;
}

export function officeKind(kind: unknown): OfficeKindInfo | null {
  return OFFICE_KINDS.find(info => info.kind === kind) ?? null;
}

export interface OfficeFile {
  id: string;
  gardenId: string;
  gardenName: string;
  name: string;
  path: string;
  size: number;
  revision: number;
  updatedAt: string;
  tab: OfficeTab;
}

export interface OfficeWorkspace { slug: string; name: string }

/** Which GenOffice editor opens a Garden file; Word files use the Docs editor (NativeWord). */
export type OfficeEditorApp = "markdown" | "pdf" | "sheets" | "slides";
// CSV and legacy formats stay with the Garden editors: these apps would save them as a different format.
const EDITOR_BY_EXTENSION: Record<string, OfficeEditorApp> = { md: "markdown", markdown: "markdown", pdf: "pdf", xlsx: "sheets", pptx: "slides" };
export const officeEditorApp = (name: string): OfficeEditorApp | null => EDITOR_BY_EXTENSION[name.split(".").pop()?.toLowerCase() ?? ""] ?? null;

/** Spaces opens these in Design (Doory) and Video (Timeline Studio) instead of a viewer. */
export const spacesStudio = (path: string): "design" | "video" | null => {
  const info = spacesKindForPath(path);
  return info?.tab === "designs" ? "design" : info?.tab === "videos" ? "video" : null;
};

/**
 * Every Spaces file opens in its Garden's Quartz reader, in the file view (its viewer and editor),
 * with the Garden's Assistant; `ask` hands it to that Assistant with the instruction ready.
 */
export const spacesEditHref = (file: { id: string; gardenId: string }, ask?: string) =>
  `/garden/${encodeURIComponent(file.gardenId)}?${new URLSearchParams({ file: file.id, fileGarden: file.gardenId, ...(ask ? { ask } : {}) })}`;
