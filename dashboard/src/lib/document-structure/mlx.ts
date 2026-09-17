// Reading a MATLAB Live Script (.mlx) into markdown a model can follow.
//
// A Live Script is not a text file, though everything in it is text. It is a
// zip package in the Office Open XML style: `matlab/document.xml` is a
// WordprocessingML body whose paragraphs are styled `title`, `heading`,
// `text` or `code`, with equations, images and hyperlinks wrapped in
// `w:customXml` elements. Read as bytes it is the compressed package, which is
// what the attachment preview used to show — "raw binary data" — and why the
// lab instructions inside one could be listed but never read.
//
// Everything a student or an engineer put in the file is recoverable from that
// one part: the prose in document order, and the code cells as the lines they
// typed. Cell *outputs* live in `matlab/output.xml` and are not reproduced —
// they are a snapshot of one past run, and the reader is told they were
// skipped rather than left to wonder.

import AdmZip from "adm-zip";
import {
  attribute,
  childNamed,
  childrenNamed,
  parseXml,
  textContent,
  type XmlNode,
} from "./xml.ts";
import { emptyStructure, type DocumentStructure } from "./types.ts";

const DOCUMENT_PART = "matlab/document.xml";
const OUTPUT_PART = "matlab/output.xml";

/** Paragraph styles the Live Editor writes, mapped to a markdown prefix. */
const HEADING_PREFIX: Record<string, string> = {
  title: "# ",
  heading: "## ",
  heading1: "## ",
  heading2: "### ",
  heading3: "#### ",
};

function readPart(zip: AdmZip, name: string): XmlNode | null {
  const entry = zip.getEntry(name);
  if (!entry) return null;
  try {
    return parseXml(entry.getData().toString("utf8"));
  } catch {
    return null;
  }
}

function paragraphStyle(paragraph: XmlNode): string {
  const properties = childNamed(paragraph, "pPr");
  const style = properties ? childNamed(properties, "pStyle") : null;
  return (style ? attribute(style, "val") : null)?.toLowerCase() ?? "text";
}

function isListItem(paragraph: XmlNode): boolean {
  const properties = childNamed(paragraph, "pPr");
  return Boolean(properties && childNamed(properties, "numPr"));
}

/** True when this paragraph closes one of the script's sections. */
function endsSection(paragraph: XmlNode): boolean {
  const properties = childNamed(paragraph, "pPr");
  return Boolean(properties && childNamed(properties, "sectPr"));
}

/** The text of one run, with line breaks and tabs made literal. */
function runText(run: XmlNode): string {
  let out = "";
  for (const child of run.children) {
    if (child.local === "t") out += textContent(child);
    else if (child.local === "br") out += "\n";
    else if (child.local === "tab") out += "\t";
  }
  return out;
}

function runMarkdown(run: XmlNode): string {
  const text = runText(run);
  if (!text) return "";
  const properties = childNamed(run, "rPr");
  if (!properties) return text;
  const monospace =
    Boolean(childNamed(properties, "rFonts")) ||
    (childNamed(properties, "rStyle")
      ? attribute(childNamed(properties, "rStyle")!, "val")?.toLowerCase() === "code"
      : false);
  if (monospace) return `\`${text}\``;
  // Emphasis wraps the word, not its surrounding whitespace, or the markdown
  // does not render as emphasis at all.
  const leading = text.match(/^\s*/)?.[0] ?? "";
  const trailing = text.match(/\s*$/)?.[0] ?? "";
  let core = text.slice(leading.length, text.length - trailing.length);
  if (!core) return text;
  if (childNamed(properties, "b")) core = `**${core}**`;
  if (childNamed(properties, "i")) core = `_${core}_`;
  return `${leading}${core}${trailing}`;
}

/** An attribute the Live Editor stored on a `w:customXml` wrapper. */
function customAttribute(node: XmlNode, name: string): string | null {
  const properties = childNamed(node, "customXmlPr");
  if (!properties) return null;
  for (const entry of childrenNamed(properties, "attr")) {
    if (attribute(entry, "name") === name) return attribute(entry, "val");
  }
  return null;
}

interface Inline {
  markdown: string;
  /** True when the whole paragraph is one equation, which reads as display math. */
  equationOnly: boolean;
  formulas: string[];
}

function inlineContent(paragraph: XmlNode, code: boolean): Inline {
  let markdown = "";
  let equations = 0;
  let others = 0;
  const formulas: string[] = [];

  const visit = (node: XmlNode) => {
    for (const child of node.children) {
      if (child.local === "r") {
        const text = code ? runText(child) : runMarkdown(child);
        if (text.trim()) others += 1;
        markdown += text;
      } else if (child.local === "customXml") {
        const element = (attribute(child, "element") ?? "").toLowerCase();
        if (element === "equation") {
          const latex = textContent(child).trim();
          if (latex) {
            formulas.push(latex);
            equations += 1;
            markdown += `$${latex}$`;
          }
        } else if (element === "image") {
          others += 1;
          const alt = customAttribute(child, "altText") ?? customAttribute(child, "alt") ?? "";
          markdown += alt ? `_[image: ${alt}]_` : "_[image]_";
        } else if (element === "hyperlink") {
          others += 1;
          const url = customAttribute(child, "url") ?? customAttribute(child, "target") ?? "";
          const label = textContent(child).trim() || url;
          markdown += url ? `[${label}](${url})` : label;
        } else if (element === "controls" || element === "control") {
          // A slider, drop-down or check box: the code it drives is in the
          // paragraph already, so only its presence is worth a word.
          others += 1;
          markdown += "_[interactive control]_";
        } else {
          visit(child);
        }
      } else if (child.local === "hyperlink" || child.local === "smartTag" || child.local === "sdt" || child.local === "sdtContent") {
        visit(child);
      }
    }
  };
  visit(paragraph);

  return { markdown, equationOnly: equations === 1 && others === 0, formulas };
}

function tableMarkdown(table: XmlNode): string {
  const rows: string[][] = [];
  for (const row of childrenNamed(table, "tr")) {
    const cells: string[] = [];
    for (const cell of childrenNamed(row, "tc")) {
      const parts = childrenNamed(cell, "p").map(
        (paragraph) => inlineContent(paragraph, false).markdown.replace(/\s*\n\s*/g, " ").trim(),
      );
      cells.push(parts.filter(Boolean).join(" ").replace(/\|/g, "\\|"));
    }
    if (cells.length) rows.push(cells);
  }
  if (!rows.length) return "";
  const width = Math.max(...rows.map((row) => row.length));
  const pad = (row: string[]) => [...row, ...Array(width - row.length).fill("")];
  const lines = [
    `| ${pad(rows[0]).join(" | ")} |`,
    `| ${Array(width).fill("---").join(" | ")} |`,
    ...rows.slice(1).map((row) => `| ${pad(row).join(" | ")} |`),
  ];
  return lines.join("\n");
}

/**
 * How many outputs the file carries from its last run.
 *
 * `output.xml` is JSON wrapped in one element per output. The count is all the
 * reader needs: enough to say the outputs exist without pretending to have
 * rendered a figure.
 */
function savedOutputCount(zip: AdmZip): number {
  const entry = zip.getEntry(OUTPUT_PART);
  if (!entry) return 0;
  try {
    const source = entry.getData().toString("utf8");
    const matches = source.match(/<output(?:Data)?[\s>]/gi);
    return matches ? matches.length : 0;
  } catch {
    return 0;
  }
}

export function readMlx(buffer: Buffer): DocumentStructure {
  const structure = emptyStructure();
  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    structure.warnings.push("That Live Script could not be opened.");
    return structure;
  }

  const document = readPart(zip, DOCUMENT_PART);
  if (!document) {
    structure.warnings.push(
      "That file is not a MATLAB Live Script: it has no readable document part.",
    );
    return structure;
  }

  const body = childNamed(document, "body") ?? document;
  const lines: string[] = [];
  let codeLines: string[] | null = null;
  let sections = 0;
  let listOpen = false;

  const closeCode = () => {
    if (codeLines === null) return;
    // A cell often ends in blank lines the editor keeps for spacing.
    while (codeLines.length && !codeLines[codeLines.length - 1].trim()) codeLines.pop();
    if (codeLines.length) lines.push("```matlab", ...codeLines, "```", "");
    codeLines = null;
  };
  const closeList = () => {
    if (listOpen) lines.push("");
    listOpen = false;
  };

  for (const child of body.children) {
    if (child.local === "tbl") {
      closeCode();
      closeList();
      const table = tableMarkdown(child);
      if (table) {
        lines.push(table, "");
        structure.summary.tableCount += 1;
      }
      continue;
    }
    if (child.local !== "p") continue;

    const style = paragraphStyle(child);
    if (style === "code") {
      closeList();
      const { markdown } = inlineContent(child, true);
      if (codeLines === null) codeLines = [];
      codeLines.push(...markdown.split("\n"));
      if (endsSection(child)) {
        closeCode();
        sections += 1;
      }
      continue;
    }

    closeCode();
    const { markdown, equationOnly, formulas } = inlineContent(child, false);
    for (const [index, latex] of formulas.entries()) {
      structure.formulas.push({
        index: structure.formulas.length + 1,
        latex,
        display: equationOnly && index === 0,
        location: sections ? `Section ${sections + 1}` : "",
      });
    }
    const text = markdown.replace(/[ \t]+\n/g, "\n").trim();
    if (text) {
      const prefix = HEADING_PREFIX[style];
      if (prefix) {
        closeList();
        lines.push(`${prefix}${text.replace(/\n+/g, " ")}`, "");
      } else if (isListItem(child)) {
        lines.push(`- ${text.replace(/\n+/g, " ")}`);
        listOpen = true;
      } else if (equationOnly) {
        closeList();
        lines.push(`$$${formulas[0]}$$`, "");
      } else {
        closeList();
        lines.push(text, "");
      }
    } else if (!isListItem(child)) {
      closeList();
    }
    if (endsSection(child)) {
      closeList();
      sections += 1;
    }
  }
  closeCode();
  closeList();

  structure.markdown = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  structure.summary.formulaCount = structure.formulas.length;
  structure.summary.figureCount = (structure.markdown.match(/_\[image[:\]]/g) ?? []).length;

  if (!structure.markdown) {
    structure.warnings.push("This Live Script has no text or code in it.");
  }
  const outputs = savedOutputCount(zip);
  if (outputs > 0) {
    structure.warnings.push(
      `The file also stores ${outputs} saved output${outputs === 1 ? "" : "s"} from its last run (results, figures); those are not included here.`,
    );
  }
  if (structure.summary.figureCount > 0) {
    structure.warnings.push(
      `${structure.summary.figureCount} image${structure.summary.figureCount === 1 ? "" : "s"} in the text could not be extracted; each is marked where it appears.`,
    );
  }
  return structure;
}

/**
 * The Live Script as one string for callers that only want text: the markdown,
 * followed by whatever the reader had to leave out.
 */
export function mlxText(buffer: Buffer): string {
  const structure = readMlx(buffer);
  const notes = structure.warnings.map((warning) => `_${warning}_`);
  return [structure.markdown, ...notes].filter(Boolean).join("\n\n");
}
