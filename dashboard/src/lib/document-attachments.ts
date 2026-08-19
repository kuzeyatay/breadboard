// The document formats a chat attachment may be, shared by the browser and the
// server so both agree on one list.
//
// A document is the third attachment kind whose *bytes* are the point, after a
// video and a mesh — and it took the longest to admit it. Until now a .docx was
// read at send time and thrown away: the message kept the extracted text and a
// filename, and nothing kept the file. That is enough to answer questions about
// a contract and not enough to *change* one. Marking up an agreement, accepting
// revisions, filling a template, recomputing a workbook — every one of those
// starts from the original bytes, and there were none.
//
// So a document now behaves like a video: the file is stored whole, the message
// carries a pointer, and the extracted text rides along beside it because that
// is what a model reads. Both, not either.
//
// Deliberately free of Node imports — the composer imports this too.

export type DocumentAttachmentFormat =
  | "docx"
  | "xlsx"
  | "pptx"
  | "pdf"
  | "odt"
  | "ods"
  | "odp";

export interface DocumentFormatDescriptor {
  mimeType: string;
  /** Shown on the attachment chip. */
  label: string;
  /** True when an agent can rewrite the original, not merely read it. */
  editable: boolean;
}

export const DOCUMENT_ATTACHMENT_FORMATS: Record<
  DocumentAttachmentFormat,
  DocumentFormatDescriptor
> = {
  docx: {
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    label: "Word",
    editable: true,
  },
  xlsx: {
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    label: "Excel",
    editable: true,
  },
  pptx: {
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    label: "PowerPoint",
    editable: true,
  },
  // A PDF is kept for the same reason but is not rewritten in place: what an
  // agent produces from one is a new file, not an edit of the original.
  pdf: { mimeType: "application/pdf", label: "PDF", editable: false },
  // OpenDocument formats are read as flat text (see document-structure/
  // opendocument.ts) rather than the structured markdown a docx/xlsx/pptx
  // gets, so they are kept readable but not marked editable: an agent has no
  // structural model of the file to write revisions back into.
  odt: {
    mimeType: "application/vnd.oasis.opendocument.text",
    label: "OpenDocument Text",
    editable: false,
  },
  ods: {
    mimeType: "application/vnd.oasis.opendocument.spreadsheet",
    label: "OpenDocument Spreadsheet",
    editable: false,
  },
  odp: {
    mimeType: "application/vnd.oasis.opendocument.presentation",
    label: "OpenDocument Presentation",
    editable: false,
  },
};

/**
 * The name to show for a stored attachment, from the name its message kept.
 *
 * The blob store never kept a filename — on disk a document is its id and its
 * format and nothing else — so the viewer pages are handed the name in a query
 * string. Only the parts of it that are really a name survive: anything that
 * could read as a path, a control character, or an unbounded string is dropped,
 * because this value also becomes the name of a download.
 */
export function attachmentDisplayName(
  value: unknown,
  format: DocumentAttachmentFormat,
  fallback: string,
): string {
  const cleaned =
    typeof value === "string"
      ? value
          .replace(/[\u0000-\u001F\u007F]/g, " ")
          .replace(/[\\/]/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 120)
      : "";
  if (!cleaned) return fallback;
  return cleaned.toLowerCase().endsWith(`.${format}`) ? cleaned : `${cleaned}.${format}`;
}

/**
 * The extracted markdown with its figures pointing somewhere a browser can go.
 *
 * The extractor references a figure by the name it wrote beside the blob —
 * `figure-2.png` — which is exactly right for an agent holding the sidecar
 * directory and useless to a page. Only names of that shape are rewritten, so
 * an image reference the document itself carried is left alone rather than
 * pointed at a file that was never extracted.
 */
export function withResolvedFigureUrls(markdown: string, sourceUrl: string): string {
  return markdown.replace(
    /\]\((figure-\d{1,4}\.[a-z0-9]{1,5})\)/gi,
    (_match, figure: string) => `](${sourceUrl}?figure=${encodeURIComponent(figure)})`,
  );
}

export const DOCUMENT_ATTACHMENT_EXTENSIONS = Object.keys(
  DOCUMENT_ATTACHMENT_FORMATS,
) as DocumentAttachmentFormat[];

export const DOCUMENT_ATTACHMENT_ACCEPT = DOCUMENT_ATTACHMENT_EXTENSIONS.map(
  (format) => `.${format}`,
).join(",");

/**
 * 128 MB. Well above any agreement or board pack and far below a video, which
 * is the point: this ceiling exists so a mis-typed upload fails fast, not so
 * that large documents are refused.
 */
export const MAX_DOCUMENT_ATTACHMENT_BYTES = 128 * 1024 * 1024;

/** The filename travels in a header, so the request body can be the raw file. */
export const DOCUMENT_FILENAME_HEADER = "x-document-filename";

export function documentAttachmentFormat(filename: string): DocumentAttachmentFormat | null {
  const base = filename.trim().toLowerCase().split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  const extension = dot > 0 ? base.slice(dot + 1) : "";
  return isDocumentAttachmentFormat(extension) ? extension : null;
}

export function isDocumentAttachmentFormat(
  value: unknown,
): value is DocumentAttachmentFormat {
  return typeof value === "string" && value in DOCUMENT_ATTACHMENT_FORMATS;
}

export function isDocumentAttachmentName(filename: string): boolean {
  return documentAttachmentFormat(filename) !== null;
}

export function isDocumentBlobId(value: unknown): value is string {
  return typeof value === "string" && /^doc_[0-9a-f]{32}$/.test(value);
}

/** True when an agent could be asked to change this file in place. */
export function isEditableDocumentFormat(format: DocumentAttachmentFormat): boolean {
  return DOCUMENT_ATTACHMENT_FORMATS[format].editable;
}

export function formatDocumentSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * What the extractor found in a document, kept with the attachment so a model
 * and an agent both know it is there without re-reading the file.
 *
 * This is the half of the problem the blob store does not solve. A document is
 * not a wall of prose: a term sheet is mostly a table, an engineering report is
 * mostly figures, a valuation is mostly formulas. Flattening all of that to
 * text loses exactly the parts a person attached the file for — so the counts
 * travel with the attachment, and the extracted markdown keeps the structures
 * themselves.
 */
export interface DocumentAttachmentSummary {
  /** Pictures, charts and embedded objects, with their captions where present. */
  figureCount: number;
  /** Equations, kept as LaTeX in the extracted text rather than dropped. */
  formulaCount: number;
  /** Tables, kept as markdown tables rather than flattened into a line. */
  tableCount: number;
  /** Worksheets, for a workbook. */
  sheetCount: number;
  /** Slides, for a deck. */
  slideCount: number;
  /** Pages, for a PDF. */
  pageCount: number;
  /** Live formulas found in a workbook, which are its actual logic. */
  cellFormulaCount: number;
  /** Unresolved revisions, which change what the document currently says. */
  trackedChangeCount: number;
  /** Comment threads left in the file. */
  commentCount: number;
}

export const EMPTY_DOCUMENT_SUMMARY: DocumentAttachmentSummary = {
  figureCount: 0,
  formulaCount: 0,
  tableCount: 0,
  sheetCount: 0,
  slideCount: 0,
  pageCount: 0,
  cellFormulaCount: 0,
  trackedChangeCount: 0,
  commentCount: 0,
};

function counted(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.min(Math.round(value), 1_000_000)
    : 0;
}

/** Validate a summary from a request or a stored row; never throws. */
export function normalizeDocumentSummary(
  value: unknown,
): DocumentAttachmentSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const summary: DocumentAttachmentSummary = {
    figureCount: counted(record.figureCount),
    formulaCount: counted(record.formulaCount),
    tableCount: counted(record.tableCount),
    sheetCount: counted(record.sheetCount),
    slideCount: counted(record.slideCount),
    pageCount: counted(record.pageCount),
    cellFormulaCount: counted(record.cellFormulaCount),
    trackedChangeCount: counted(record.trackedChangeCount),
    commentCount: counted(record.commentCount),
  };
  // An all-zero summary says nothing; treated as absent so nothing renders an
  // empty row of noughts under a plain letter.
  return Object.values(summary).some((count) => count > 0) ? summary : null;
}

/**
 * One line naming what is in the file besides prose. Shown on the attachment
 * chip and prefixed to the extracted text, so the model is told the figures
 * exist in the same breath as it is given the words.
 */
export function describeDocumentSummary(
  summary: DocumentAttachmentSummary | null | undefined,
): string {
  if (!summary) return "";
  const parts: string[] = [];
  const plural = (count: number, one: string, many = `${one}s`) =>
    `${count} ${count === 1 ? one : many}`;
  if (summary.pageCount) parts.push(plural(summary.pageCount, "page"));
  if (summary.slideCount) parts.push(plural(summary.slideCount, "slide"));
  if (summary.sheetCount) parts.push(plural(summary.sheetCount, "sheet"));
  if (summary.tableCount) parts.push(plural(summary.tableCount, "table"));
  if (summary.figureCount) parts.push(plural(summary.figureCount, "figure"));
  if (summary.formulaCount) parts.push(plural(summary.formulaCount, "formula"));
  if (summary.cellFormulaCount) {
    parts.push(`${plural(summary.cellFormulaCount, "live formula")}`);
  }
  if (summary.trackedChangeCount) {
    parts.push(plural(summary.trackedChangeCount, "tracked change"));
  }
  if (summary.commentCount) parts.push(plural(summary.commentCount, "comment"));
  return parts.join(" · ");
}
