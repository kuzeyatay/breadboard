// What an extractor returns, and what every caller is entitled to assume.
//
// The shape is deliberately one level richer than "a string of text". The old
// contract was exactly that string, and it is why a term sheet arrived as a
// paragraph of run-together numbers and a report's charts arrived as nothing at
// all. A caller that only wants the words still reads `markdown` and ignores
// the rest; a caller that wants to reason about the document has the rest.

import type { DocumentAttachmentSummary } from "../document-attachments.ts";

/** One picture, chart or embedded object lifted out of a document. */
export interface ExtractedFigure {
  /** 1-based, in document order. Matches the `figure-N.ext` name on disk. */
  index: number;
  /** Lower-case, no dot. */
  extension: string;
  bytes: Buffer;
  /**
   * The caption as the document itself gives it — a Caption-styled paragraph,
   * or one starting "Figure 3" — rather than one invented here.
   */
  caption: string;
  /** The alt text the author wrote, which is often better than the caption. */
  altText: string;
  /** Where it sits: a page, a slide, a sheet, or a section heading. */
  location: string;
}

/** One equation, kept as LaTeX rather than flattened into its characters. */
export interface ExtractedFormula {
  index: number;
  latex: string;
  /** True when it stood on its own line rather than inside a sentence. */
  display: boolean;
  location: string;
}

export interface DocumentStructure {
  /**
   * The document as markdown: headings as headings, tables as tables, lists as
   * lists, equations as `$…$`, figures as image references pointing at the
   * sidecar names. This is what a model is given.
   */
  markdown: string;
  figures: ExtractedFigure[];
  formulas: ExtractedFormula[];
  summary: DocumentAttachmentSummary;
  /** Anything the reader could not do, said plainly rather than swallowed. */
  warnings: string[];
}

export function emptyStructure(): DocumentStructure {
  return {
    markdown: "",
    figures: [],
    formulas: [],
    summary: {
      figureCount: 0,
      formulaCount: 0,
      tableCount: 0,
      sheetCount: 0,
      slideCount: 0,
      pageCount: 0,
      cellFormulaCount: 0,
      trackedChangeCount: 0,
      commentCount: 0,
    },
    warnings: [],
  };
}

/** The name a figure is written under, and referenced by from the markdown. */
export function figureFilename(figure: { index: number; extension: string }): string {
  return `figure-${figure.index}.${figure.extension}`;
}
