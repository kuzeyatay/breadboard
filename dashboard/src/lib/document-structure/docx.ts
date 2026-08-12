// Reading a Word document as the document it is.
//
// What this replaces was one line: strip every tag out of `word/document.xml`
// and collapse the whitespace. That is a reasonable first approximation for a
// letter and a disaster for everything a document is normally attached *for*:
//
//   - A table becomes a run-on sentence. A term sheet, a rent schedule, a cap
//     table and a damages calculation are all mostly tables, and "Party A 4.5%
//     2029 Party B 3.0% 2031" cannot be read back into rows by anyone.
//   - An equation becomes its characters with the structure removed, so `x²`
//     arrives as `x2` — plausible, wrong, and impossible to notice downstream.
//   - A figure becomes nothing at all. Not a placeholder: nothing. The model is
//     never told a chart was there, so it answers as though the document did
//     not have one.
//   - A tracked deletion reads as ordinary text, so a clause the parties have
//     already struck out is quoted back as though it were in force.
//
// Each of those is handled below, and the reason each one matters is the reason
// the code for it exists.

import AdmZip from "adm-zip";
import {
  attribute,
  childNamed,
  childrenNamed,
  countDescendants,
  descendants,
  parseXml,
  textContent,
  type XmlNode,
} from "./xml.ts";
import { isMeaningfulFormula, ommlToLatex } from "./omml.ts";
import {
  emptyStructure,
  figureFilename,
  type DocumentStructure,
  type ExtractedFigure,
  type ExtractedFormula,
} from "./types.ts";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "bmp", "tiff", "webp", "emf", "wmf", "svg"]);
const MAX_FIGURES = 60;
const MAX_FIGURE_BYTES = 12 * 1024 * 1024;

interface Context {
  zip: AdmZip;
  /** Relationship id → the part it points at, for images and links. */
  relationships: Map<string, string>;
  figures: ExtractedFigure[];
  formulas: ExtractedFormula[];
  /** The most recent heading, so a figure can say where in the document it is. */
  section: string;
  warnings: string[];
  trackedChanges: number;
  tables: number;
}

function readPart(zip: AdmZip, name: string): XmlNode | null {
  const entry = zip.getEntry(name);
  if (!entry) return null;
  try {
    return parseXml(entry.getData().toString("utf8"));
  } catch {
    return null;
  }
}

function readRelationships(zip: AdmZip, part: string): Map<string, string> {
  const map = new Map<string, string>();
  const root = readPart(zip, part);
  if (!root) return map;
  for (const relationship of childrenNamed(root, "Relationship")) {
    const id = attribute(relationship, "Id");
    const target = attribute(relationship, "Target");
    if (id && target) map.set(id, target);
  }
  return map;
}

/** Resolve a relationship target to an entry name inside the package. */
function mediaEntryName(target: string): string {
  const cleaned = target.replace(/^\/+/, "").replace(/^\.\.\//, "");
  return cleaned.startsWith("word/") || cleaned.startsWith("media/")
    ? cleaned.startsWith("media/")
      ? `word/${cleaned}`
      : cleaned
    : `word/${cleaned}`;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/**
 * Pull one picture out of the package.
 *
 * Returns null rather than throwing on anything unreadable: a document with a
 * broken image is still a document, and the alternative is refusing to read a
 * contract because a logo in its header is corrupt.
 */
function takeFigure(
  context: Context,
  relationshipId: string,
  altText: string,
): ExtractedFigure | null {
  if (context.figures.length >= MAX_FIGURES) return null;
  const target = context.relationships.get(relationshipId);
  if (!target) return null;
  const entry = context.zip.getEntry(mediaEntryName(target));
  if (!entry) return null;
  const extension = extensionOf(target);
  if (!IMAGE_EXTENSIONS.has(extension)) return null;
  let bytes: Buffer;
  try {
    bytes = entry.getData();
  } catch {
    return null;
  }
  if (!bytes.length || bytes.length > MAX_FIGURE_BYTES) return null;
  const figure: ExtractedFigure = {
    index: context.figures.length + 1,
    extension,
    bytes,
    caption: "",
    altText,
    location: context.section,
  };
  context.figures.push(figure);
  return figure;
}

/** The alt text an author wrote on a drawing, if any. */
function drawingAltText(drawing: XmlNode): string {
  for (const properties of descendants(drawing, "docPr")) {
    const description = attribute(properties, "descr") ?? "";
    const name = attribute(properties, "name") ?? "";
    const chosen = description.trim() || name.trim();
    // Word names every shape "Picture 3" by default; that is not alt text.
    if (chosen && !/^(picture|image|chart|diagram|object|graphic)\s*\d*$/i.test(chosen)) {
      return chosen;
    }
  }
  return "";
}

function isBold(run: XmlNode): boolean {
  const properties = childNamed(run, "rPr");
  if (!properties) return false;
  const bold = childNamed(properties, "b");
  return Boolean(bold) && attribute(bold!, "val") !== "0" && attribute(bold!, "val") !== "false";
}

function isItalic(run: XmlNode): boolean {
  const properties = childNamed(run, "rPr");
  if (!properties) return false;
  const italic = childNamed(properties, "i");
  return (
    Boolean(italic) && attribute(italic!, "val") !== "0" && attribute(italic!, "val") !== "false"
  );
}

function escapeMarkdown(value: string): string {
  // Only the characters that would change the structure of the output. A legal
  // document is full of underscores and asterisks used literally.
  return value.replace(/([*_`|\\])/g, "\\$1");
}

/**
 * The text of one run, with emphasis preserved.
 *
 * Bold matters more here than it looks: in an agreement, the defined terms are
 * the bold ones, and a model that can see which words are defined reads the
 * contract the way a lawyer does.
 */
function convertRun(context: Context, run: XmlNode, options: { struck: boolean }): string {
  let out = "";
  for (const child of run.children) {
    if (child.local === "t") out += escapeMarkdown(textContent(child));
    else if (child.local === "delText") out += escapeMarkdown(textContent(child));
    else if (child.local === "tab") out += "\t";
    else if (child.local === "br") out += "\n";
    else if (child.local === "noBreakHyphen") out += "-";
    else if (child.local === "sym") out += attribute(child, "char") ?? "";
    else if (child.local === "drawing" || child.local === "pict" || child.local === "object") {
      out += convertDrawing(context, child);
    }
  }
  if (!out) return "";
  if (options.struck) return out;
  if (isBold(run) && out.trim()) out = `**${out}**`;
  if (isItalic(run) && out.trim()) out = `*${out}*`;
  return out;
}

/** A picture becomes a markdown image reference pointing at the sidecar file. */
function convertDrawing(context: Context, drawing: XmlNode): string {
  const altText = drawingAltText(drawing);
  // `a:blip r:embed` for a picture; `c:chart r:id` for a chart, which has no
  // bitmap to lift but should still be announced.
  for (const blip of descendants(drawing, "blip")) {
    const id = attribute(blip, "embed") ?? attribute(blip, "link");
    if (!id) continue;
    const figure = takeFigure(context, id, altText);
    if (figure) {
      return `\n\n![${altText || `Figure ${figure.index}`}](${figureFilename(figure)})\n\n`;
    }
  }
  if (descendants(drawing, "chart").length) {
    context.warnings.push(
      "A chart is drawn from data held in the file rather than as a picture; its numbers are in the workbook part, not in the text.",
    );
    return `\n\n[Chart${altText ? `: ${altText}` : ""}]\n\n`;
  }
  return altText ? `\n\n[Image: ${altText}]\n\n` : "";
}

/** A `m:oMath` becomes LaTeX; the counter is what the summary reports. */
function convertMath(context: Context, node: XmlNode, display: boolean): string {
  const latex = ommlToLatex(node);
  if (!isMeaningfulFormula(latex)) return "";
  context.formulas.push({
    index: context.formulas.length + 1,
    latex,
    display,
    location: context.section,
  });
  return display ? `\n\n$$${latex}$$\n\n` : `$${latex}$`;
}

/** The heading level a paragraph's style implies, or 0 for body text. */
function headingLevel(paragraph: XmlNode): number {
  const style = childNamed(childNamed(paragraph, "pPr") ?? paragraph, "pStyle");
  const value = style ? attribute(style, "val") ?? "" : "";
  const match = /^Heading(\d)$/i.exec(value) ?? /^Titre(\d)$/i.exec(value);
  if (match) return Math.min(6, Number(match[1]));
  if (/^(Title|Subtitle)$/i.test(value)) return 1;
  return 0;
}

function isListItem(paragraph: XmlNode): boolean {
  return Boolean(childNamed(childNamed(paragraph, "pPr") ?? paragraph, "numPr"));
}

function listIndent(paragraph: XmlNode): number {
  const numbering = childNamed(childNamed(paragraph, "pPr") ?? paragraph, "numPr");
  const level = numbering ? childNamed(numbering, "ilvl") : null;
  const value = level ? Number(attribute(level, "val") ?? "0") : 0;
  return Number.isFinite(value) ? Math.min(6, Math.max(0, value)) : 0;
}

function isCaptionStyle(paragraph: XmlNode): boolean {
  const style = childNamed(childNamed(paragraph, "pPr") ?? paragraph, "pStyle");
  return /caption/i.test(style ? attribute(style, "val") ?? "" : "");
}

/**
 * One paragraph, with its children walked in order.
 *
 * Tracked changes are the reason this is not a simple concatenation. `w:ins` is
 * an insertion that has not been accepted and `w:del` is a deletion that has
 * not been applied — so the text inside a `w:del` is *not* what the document
 * says, and quoting it back as though it were is how an agent ends up advising
 * on a clause that was struck out weeks ago.
 */
function convertParagraph(context: Context, paragraph: XmlNode): string {
  let out = "";

  const walk = (node: XmlNode, struck: boolean) => {
    for (const child of node.children) {
      switch (child.local) {
        case "r":
          out += convertRun(context, child, { struck });
          break;
        case "ins":
          context.trackedChanges += 1;
          walk(child, struck);
          break;
        case "del": {
          context.trackedChanges += 1;
          const before = out.length;
          walk(child, true);
          const raw = out.slice(before);
          out = out.slice(0, before);
          // Kept, but marked, so the model can see what was proposed for
          // removal without mistaking it for operative text. The whitespace
          // around it is put back outside the marks: a deletion usually ends
          // with the space that separated it from the next word, and `~~` has
          // to sit against the text to render, so trimming without restoring
          // welds the neighbouring words together.
          const removed = raw.trim();
          if (removed) {
            const leading = raw.slice(0, raw.length - raw.trimStart().length);
            const trailing = raw.slice(raw.trimEnd().length);
            out += `${leading}~~${removed}~~${trailing}`;
          } else {
            out += raw;
          }
          break;
        }
        case "hyperlink":
          walk(child, struck);
          break;
        case "oMath":
          out += convertMath(context, child, false);
          break;
        case "oMathPara":
          for (const math of childrenNamed(child, "oMath")) {
            out += convertMath(context, math, true);
          }
          break;
        case "smartTag":
        case "sdt":
        case "sdtContent":
        case "fldSimple":
          walk(child, struck);
          break;
        case "pPr":
          break;
        default:
          // Anything unrecognised is walked rather than dropped, so a construct
          // this reader has not met still contributes its words.
          if (child.children.length) walk(child, struck);
          break;
      }
    }
  };
  walk(paragraph, false);

  const text = out.replace(/[ \t]+/g, " ").trim();
  if (!text) return "";

  const level = headingLevel(paragraph);
  if (level) {
    context.section = text.replace(/[*_~`]/g, "").slice(0, 120);
    return `${"#".repeat(level)} ${text}`;
  }
  if (isListItem(paragraph)) {
    return `${"  ".repeat(listIndent(paragraph))}- ${text}`;
  }
  return text;
}

/** Cells joined into a markdown row; a nested table degrades to its text. */
function convertTable(context: Context, table: XmlNode): string {
  context.tables += 1;
  const rows: string[][] = [];
  for (const row of childrenNamed(table, "tr")) {
    const cells: string[] = [];
    for (const cell of childrenNamed(row, "tc")) {
      const parts = cell.children
        .flatMap((child) => {
          if (child.local === "p") return [convertParagraph(context, child)];
          if (child.local === "tbl") return [textContent(child).replace(/\s+/g, " ").trim()];
          return [];
        })
        .filter(Boolean);
      // A newline inside a markdown cell would end the table, so the paragraphs
      // of one cell are joined instead.
      cells.push(parts.join(" ").replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|").trim());
      const span = childNamed(childNamed(cell, "tcPr") ?? cell, "gridSpan");
      const width = span ? Number(attribute(span, "val") ?? "1") : 1;
      for (let extra = 1; extra < (Number.isFinite(width) ? width : 1); extra += 1) {
        cells.push("");
      }
    }
    if (cells.length) rows.push(cells);
  }
  if (!rows.length) return "";

  const columns = Math.max(...rows.map((row) => row.length));
  const pad = (row: string[]) =>
    `| ${Array.from({ length: columns }, (_, index) => row[index] ?? "").join(" | ")} |`;
  // A table's first row is its header often enough, and markdown requires a
  // separator row regardless; without one the whole table renders as text.
  const [header, ...body] = rows;
  return [
    pad(header),
    `| ${Array.from({ length: columns }, () => "---").join(" | ")} |`,
    ...body.map(pad),
  ].join("\n");
}

/** Attach a Caption-styled paragraph to the figure it follows. */
function attachCaption(context: Context, text: string): void {
  const figure = context.figures.at(-1);
  if (!figure || figure.caption) return;
  const cleaned = text.replace(/^[#\s]+/, "").replace(/[*_~`]/g, "").trim();
  if (cleaned) figure.caption = cleaned.slice(0, 300);
}

function convertBody(context: Context, body: XmlNode): string {
  const blocks: string[] = [];
  let previousWasFigure = false;

  for (const child of body.children) {
    if (child.local === "p") {
      const figuresBefore = context.figures.length;
      const text = convertParagraph(context, child);
      const producedFigure = context.figures.length > figuresBefore;
      if (text) {
        // A caption is either styled as one or sits right after the picture and
        // starts the way captions start.
        if (
          !producedFigure &&
          previousWasFigure &&
          (isCaptionStyle(child) || /^(figure|fig\.|table|exhibit|chart|diagram)\b/i.test(text))
        ) {
          attachCaption(context, text);
        }
        blocks.push(text);
      }
      previousWasFigure = producedFigure;
      continue;
    }
    if (child.local === "tbl") {
      const table = convertTable(context, child);
      if (table) blocks.push(table);
      previousWasFigure = false;
      continue;
    }
    if (child.local === "sdt" || child.local === "sdtContent") {
      const nested = convertBody(context, child);
      if (nested) blocks.push(nested);
      continue;
    }
  }
  return blocks.join("\n\n");
}

/** Footnotes and endnotes, which carry a surprising amount of a contract. */
function convertNotes(context: Context, partName: string, label: string): string {
  const root = readPart(context.zip, partName);
  if (!root) return "";
  const notes: string[] = [];
  for (const note of root.children) {
    const type = attribute(note, "type");
    // Word keeps a separator and a continuation notice in the same part.
    if (type === "separator" || type === "continuationSeparator") continue;
    const id = attribute(note, "id") ?? "";
    const text = note.children
      .filter((child) => child.local === "p")
      .map((paragraph) => convertParagraph(context, paragraph))
      .filter(Boolean)
      .join(" ");
    if (text) notes.push(`${id ? `[^${id}]: ` : "- "}${text}`);
  }
  return notes.length ? `\n\n## ${label}\n\n${notes.join("\n")}` : "";
}

/** Comment threads: a reviewer's open question is part of what the file says. */
function convertComments(context: Context): { markdown: string; count: number } {
  const root = readPart(context.zip, "word/comments.xml");
  if (!root) return { markdown: "", count: 0 };
  const comments: string[] = [];
  for (const comment of childrenNamed(root, "comment")) {
    const author = attribute(comment, "author") ?? "Unknown";
    const date = (attribute(comment, "date") ?? "").slice(0, 10);
    const text = comment.children
      .filter((child) => child.local === "p")
      .map((paragraph) => convertParagraph(context, paragraph))
      .filter(Boolean)
      .join(" ");
    if (text) comments.push(`- **${author}**${date ? ` (${date})` : ""}: ${text}`);
  }
  return {
    markdown: comments.length ? `\n\n## Comments\n\n${comments.join("\n")}` : "",
    count: comments.length,
  };
}

/**
 * Read a .docx into structured markdown plus the figures and formulas it holds.
 *
 * Never throws: a document that cannot be read comes back with a warning and
 * whatever text was recoverable, because the caller is a chat message and the
 * alternative is a failed send.
 */
export function readDocx(buffer: Buffer): DocumentStructure {
  const structure = emptyStructure();
  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    structure.warnings.push("That Word file could not be opened.");
    return structure;
  }

  const document = readPart(zip, "word/document.xml");
  if (!document) {
    structure.warnings.push("That Word file has no readable document part.");
    return structure;
  }

  const context: Context = {
    zip,
    relationships: readRelationships(zip, "word/_rels/document.xml.rels"),
    figures: [],
    formulas: [],
    section: "",
    warnings: [],
    trackedChanges: 0,
    tables: 0,
  };

  const body = childNamed(document, "body") ?? document;
  let markdown = convertBody(context, body);
  markdown += convertNotes(context, "word/footnotes.xml", "Footnotes");
  markdown += convertNotes(context, "word/endnotes.xml", "Endnotes");
  const comments = convertComments(context);
  markdown += comments.markdown;

  structure.markdown = markdown.replace(/\n{3,}/g, "\n\n").trim();
  structure.figures = context.figures;
  structure.formulas = context.formulas;
  structure.warnings = [...new Set(context.warnings)];
  structure.summary = {
    ...structure.summary,
    figureCount: context.figures.length,
    formulaCount: context.formulas.length,
    tableCount: context.tables,
    trackedChangeCount: context.trackedChanges,
    commentCount: comments.count,
  };

  // Counted from the part rather than from what was converted, so a construct
  // this reader walked past is still reported as present.
  const declaredFigures = countDescendants(body, "blip");
  if (declaredFigures > context.figures.length) {
    structure.summary.figureCount = declaredFigures;
    structure.warnings.push(
      `${declaredFigures - context.figures.length} image${
        declaredFigures - context.figures.length === 1 ? "" : "s"
      } in this document could not be extracted.`,
    );
  }

  return structure;
}
