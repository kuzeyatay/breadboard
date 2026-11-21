/** Client-safe registry of the document types the Office page creates and lists. */
export type OfficeKind = "docx" | "xlsx" | "pptx" | "md" | "html" | "pdf";
export type OfficeTab = "docs" | "sheets" | "slides" | "pdf" | "markdown" | "html";

export interface OfficeKindInfo {
  kind: OfficeKind;
  tab: OfficeTab;
  /** Tile title, "AI Docs" style. */
  label: string;
  /** What Bread is asked to make, in a sentence. */
  noun: string;
  badge: string;
  color: string;
  extensions: readonly string[];
}

export const OFFICE_KINDS: readonly OfficeKindInfo[] = [
  { kind: "docx", tab: "docs", label: "Docs", noun: "Word document", badge: "W", color: "#2b6fd6", extensions: ["docx", "doc", "odt", "rtf"] },
  { kind: "xlsx", tab: "sheets", label: "Sheets", noun: "Excel spreadsheet", badge: "X", color: "#1f8a4c", extensions: ["xlsx", "xls", "ods", "csv", "tsv"] },
  { kind: "pptx", tab: "slides", label: "Slides", noun: "PowerPoint presentation", badge: "P", color: "#c8462d", extensions: ["pptx", "ppt", "odp"] },
  { kind: "md", tab: "markdown", label: "Markdown", noun: "Markdown document", badge: "M↓", color: "#7a4fd1", extensions: ["md", "markdown"] },
  { kind: "html", tab: "html", label: "HTML", noun: "HTML page", badge: "</>", color: "#14857a", extensions: ["html", "htm"] },
  { kind: "pdf", tab: "pdf", label: "PDF", noun: "PDF", badge: "PDF", color: "#c42b2b", extensions: ["pdf"] },
];

export const OFFICE_FOLDER = "Office";

export function officeKindForName(name: string): OfficeKindInfo | null {
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  return OFFICE_KINDS.find(info => info.extensions.includes(ext)) ?? null;
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
