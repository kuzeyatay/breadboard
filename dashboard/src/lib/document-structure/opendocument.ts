// Reading an OpenDocument file (.odt/.ods/.odp) — the format LibreOffice,
// OpenOffice, and Google Docs exports produce, which turns up in document
// libraries alongside their Microsoft equivalents.
//
// Adapted from simstudioai/sim (Apache-2.0) —
// apps/sim/lib/file-parsers/opendocument-parser.ts — to Breadboard's
// `DocumentStructure` shape (see docx.ts/xlsx.ts for the pattern this
// follows) rather than sim's flat `FileParseResult`.
//
// Two real differences from a docx/xlsx/pptx read in this directory, stated
// rather than hidden:
//
//  1. No structure. `officeparser` gives back one flattened text run for an
//     OpenDocument container, not a tree of paragraphs/tables/runs the way
//     `xml.ts` lets docx.ts and pptx.ts walk. So there are no tables-as-
//     tables, no figures lifted out, no tracked changes, no formulas here —
//     what officeparser extracts is what this returns, the same way the old
//     regex-based .docx reader used to flatten everything before this
//     directory existed.
//  2. This function is async. Every other reader here is synchronous — an
//     `AdmZip` read is a blocking, in-memory unzip. `officeparser`'s
//     decompression walks the archive with `yauzl`, a callback-driven unzip
//     library with no synchronous entry point, so there is no way to give
//     this the same signature as `readDocx`/`readXlsx`/`readPptx`. See
//     `readDocument`'s switch in `index.ts` for how the two are reconciled:
//     the synchronous entry point returns an empty structure with a warning
//     for these three formats (the same fallback already implicit for a
//     format like `pdf`, which this module's synchronous siblings do not
//     handle either), and the real read happens here, awaited directly by
//     the one caller that can — the attach-time route.
//
// Sim's version throws on failure ("no best-effort fallback: an OpenDocument
// file is a ZIP whose text lives in content.xml, so a failure means the
// archive is unreadable or has no text"). Every reader in *this* directory
// instead never throws — a document attachment is a chat message, not a
// request that should fail — so a failure here becomes a warning and an
// empty structure, matching `readDocx`/`readXlsx`/`readPptx`.

import { emptyStructure, type DocumentStructure } from "./types.ts";

/**
 * Read an OpenDocument text, spreadsheet, or presentation file into the flat
 * markdown a model reads. Never throws.
 */
export async function readOpenDocument(buffer: Buffer): Promise<DocumentStructure> {
  const structure = emptyStructure();

  if (!buffer || buffer.length === 0) {
    structure.warnings.push("That file was empty.");
    return structure;
  }

  let extracted = "";
  try {
    const { parseOfficeAsync } = await import("officeparser");
    const result = await parseOfficeAsync(buffer);
    extracted = typeof result === "string" ? result : "";
  } catch (error) {
    structure.warnings.push(
      error instanceof Error
        ? `That OpenDocument file could not be read: ${error.message}`
        : "That OpenDocument file could not be read.",
    );
    return structure;
  }

  const text = extracted.trim();
  if (!text) {
    structure.warnings.push("No readable text was found in that OpenDocument file.");
    return structure;
  }

  structure.markdown = text;
  structure.warnings.push(
    "This OpenDocument file was read as plain text: tables, figures, and formulas are not extracted as structure the way a .docx or .xlsx is.",
  );
  return structure;
}
