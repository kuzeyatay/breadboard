// One entry point for reading a document into something a model can reason on.
//
// Callers ask for a format and get a `DocumentStructure` back. Nothing here
// throws: every caller is either a chat send or an agent run, and a document
// that will not open is a warning on a message rather than a failed request.

import {
  describeDocumentSummary,
  type DocumentAttachmentFormat,
  type DocumentAttachmentSummary,
} from "../document-attachments.ts";
import { readDocx } from "./docx.ts";
import { readPptx } from "./pptx.ts";
import { readXlsx } from "./xlsx.ts";
import { emptyStructure, type DocumentStructure } from "./types.ts";

export type { DocumentStructure, ExtractedFigure, ExtractedFormula } from "./types.ts";
export { figureFilename } from "./types.ts";
export { readDocx } from "./docx.ts";
export { readXlsx } from "./xlsx.ts";
export { readPptx } from "./pptx.ts";

/**
 * Read one document. PDFs are not handled here: their text comes from
 * `pdf-parse` in the extraction route, which already renders pages and can fall
 * back to transcribing them with a vision model. This module is the OOXML half,
 * where the structure is in the file rather than in its pixels.
 */
export function readDocument(
  format: DocumentAttachmentFormat,
  buffer: Buffer,
): DocumentStructure {
  switch (format) {
    case "docx":
      return readDocx(buffer);
    case "xlsx":
      return readXlsx(buffer);
    case "pptx":
      return readPptx(buffer);
    default:
      return emptyStructure();
  }
}

/**
 * The extracted text as a model should receive it: the structures themselves,
 * under one line saying what else is in the file.
 *
 * That header line is not decoration. A model given markdown with three image
 * references in it has no way to know whether those are the only three figures
 * or the three that happened to survive extraction, and no way to know a
 * workbook's numbers are computed rather than typed. Saying so once, at the
 * top, is what turns "here is some text" into "here is a document, and here is
 * what is in it that is not text".
 */
export function documentContextText(input: {
  filename: string;
  summary: DocumentAttachmentSummary | null;
  markdown: string;
  warnings: readonly string[];
  /** Set when the figures are on disk somewhere the reader can open them. */
  figureNote?: string;
}): string {
  const description = describeDocumentSummary(input.summary);
  const header = [
    `# ${input.filename}`,
    description ? `_Contains ${description}._` : "",
    input.figureNote ?? "",
    ...input.warnings.map((warning) => `_${warning}_`),
  ]
    .filter(Boolean)
    .join("\n\n");
  return [header, input.markdown].filter(Boolean).join("\n\n");
}
