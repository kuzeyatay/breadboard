// Which files the "Parse with anydoc" upload option accepts, and what to call
// the sections it produces.
//
// Client-safe on purpose: the upload dialogs import this to decide whether to
// offer the checkbox, so nothing here may reach for the native module (that
// lives in ./convert.ts, which is server-only).
//
// The extension table mirrors `Format::from_extension` in the anydoc clone
// (anydoc/src/lib.rs) — container variants that share a parser (`.docm`,
// `.xlsm`, `.ppsx`, …) collapse onto the format their parser is named after.

/** The format names anydoc's own `Format` enum uses. */
export type AnydocFormat =
  | "doc"
  | "docx"
  | "odt"
  | "pdf"
  | "ppt"
  | "pptx"
  | "rtf"
  | "epub"
  | "xlsx"
  | "ods"
  | "odp"
  | "csv";

const EXTENSION_FORMATS: Record<string, AnydocFormat> = {
  doc: "doc",
  docx: "docx",
  docm: "docx",
  odt: "odt",
  pdf: "pdf",
  ppt: "ppt",
  pps: "ppt",
  pot: "ppt",
  pptx: "pptx",
  pptm: "pptx",
  ppsx: "pptx",
  ppsm: "pptx",
  rtf: "rtf",
  epub: "epub",
  xls: "xlsx",
  xlsx: "xlsx",
  xlsm: "xlsx",
  xlsb: "xlsx",
  ods: "ods",
  odp: "odp",
  csv: "csv",
};

/** Files anydoc can convert, by extension. */
export const ANYDOC_PARSE_FILE_RE = new RegExp(
  `\\.(${Object.keys(EXTENSION_FORMATS).join("|")})$`,
  "i",
);

/** The anydoc format an extension names, with or without a leading dot. */
export function anydocFormatForExtension(
  extension: string,
): AnydocFormat | null {
  const normalized = extension.trim().toLowerCase().replace(/^\./, "");
  return EXTENSION_FORMATS[normalized] ?? null;
}

/**
 * What a whole-document section is called when the conversion has no headings
 * to split on. Matches the labels the hand-rolled extractors used, so a garden
 * that has both kinds of note reads consistently.
 */
export function anydocPageLabel(format: AnydocFormat): string {
  switch (format) {
    case "doc":
    case "docx":
    case "odt":
    case "rtf":
      return "Word Document";
    case "ppt":
    case "pptx":
    case "odp":
      return "Presentation";
    case "xlsx":
    case "ods":
      return "Spreadsheet";
    case "csv":
      return "CSV Data";
    case "epub":
      return "Book";
    case "pdf":
      return "PDF";
  }
}

/** How the option describes itself once a file is chosen. */
export function anydocFormatSummary(extensions: string[]): string {
  const formats = new Set<AnydocFormat>();
  for (const extension of extensions) {
    const format = anydocFormatForExtension(extension);
    if (format) formats.add(format);
  }
  return [...formats].join(", ");
}
