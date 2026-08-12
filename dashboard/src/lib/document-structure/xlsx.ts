// Reading a workbook, including the part that makes it a workbook.
//
// A spreadsheet's cells are its output. Its *formulas* are its reasoning, and
// they are what someone attaching a model wants looked at: whether the discount
// rate is hardcoded, whether a total sums the right range, whether a row was
// added below a SUM that never grew to meet it. The previous reader took the
// cached values and dropped every `<f>`, so the one question a workbook is
// usually attached to answer was the one question its extraction could not.
//
// Both are kept here: the value a cell shows, and the formula behind it.

import AdmZip from "adm-zip";
import {
  attribute,
  childNamed,
  childrenNamed,
  descendants,
  parseXml,
  textContent,
  type XmlNode,
} from "./xml.ts";
import { emptyStructure, type DocumentStructure } from "./types.ts";

const MAX_ROWS_PER_SHEET = 500;
const MAX_COLUMNS = 40;
const MAX_FORMULAS_LISTED = 200;

interface SheetRef {
  name: string;
  entryName: string;
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

/** Shared strings, which is where most text in a workbook actually lives. */
function readSharedStrings(zip: AdmZip): string[] {
  const root = readPart(zip, "xl/sharedStrings.xml");
  if (!root) return [];
  return childrenNamed(root, "si").map((item) =>
    descendants(item, "t")
      .map((node) => textContent(node))
      .join(""),
  );
}

/** Sheet name → part, resolved through the workbook's own relationships. */
function readSheets(zip: AdmZip): SheetRef[] {
  const workbook = readPart(zip, "xl/workbook.xml");
  if (!workbook) return [];
  const relationships = new Map<string, string>();
  const relationshipRoot = readPart(zip, "xl/_rels/workbook.xml.rels");
  if (relationshipRoot) {
    for (const relationship of childrenNamed(relationshipRoot, "Relationship")) {
      const id = attribute(relationship, "Id");
      const target = attribute(relationship, "Target");
      if (id && target) relationships.set(id, target);
    }
  }
  const sheetsNode = childNamed(workbook, "sheets");
  if (!sheetsNode) return [];
  return childrenNamed(sheetsNode, "sheet").flatMap((sheet, index) => {
    const name = attribute(sheet, "name") ?? `Sheet${index + 1}`;
    const id = attribute(sheet, "id");
    const target = id ? relationships.get(id) : null;
    const entryName = target
      ? `xl/${target.replace(/^\/?xl\//, "").replace(/^\.\.\//, "")}`
      : `xl/worksheets/sheet${index + 1}.xml`;
    return [{ name, entryName }];
  });
}

/** "B12" → 2. Column letters are base-26 with no zero. */
function columnIndex(reference: string): number {
  const letters = /^([A-Z]+)/i.exec(reference)?.[1] ?? "";
  let index = 0;
  for (const letter of letters.toUpperCase()) {
    index = index * 26 + (letter.charCodeAt(0) - 64);
  }
  return index;
}

interface CellValue {
  display: string;
  formula: string;
}

function readCell(cell: XmlNode, sharedStrings: string[]): CellValue {
  const type = attribute(cell, "t") ?? "n";
  const formulaNode = childNamed(cell, "f");
  const formula = formulaNode ? textContent(formulaNode).trim() : "";
  let display = "";

  if (type === "inlineStr") {
    display = descendants(cell, "t")
      .map((node) => textContent(node))
      .join("");
  } else {
    const valueNode = childNamed(cell, "v");
    const raw = valueNode ? textContent(valueNode).trim() : "";
    if (type === "s") {
      const index = Number(raw);
      display = Number.isInteger(index) ? sharedStrings[index] ?? "" : "";
    } else if (type === "e") {
      // An error value is a finding, not noise: #REF! means the model is broken.
      display = raw;
    } else {
      display = raw;
    }
  }
  return { display: display.replace(/\s+/g, " ").trim(), formula };
}

/**
 * Read a .xlsx into markdown tables plus a list of the formulas behind them.
 *
 * Never throws, for the same reason as the Word reader: the caller is a chat
 * message, and a workbook with one unreadable sheet is still worth reading.
 */
export function readXlsx(buffer: Buffer): DocumentStructure {
  const structure = emptyStructure();
  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    structure.warnings.push("That workbook could not be opened.");
    return structure;
  }

  const sharedStrings = readSharedStrings(zip);
  const sheets = readSheets(zip);
  if (!sheets.length) {
    structure.warnings.push("That workbook has no readable sheets.");
    return structure;
  }

  const blocks: string[] = [];
  const formulaLines: string[] = [];
  let formulaCount = 0;
  let errorCount = 0;

  for (const sheet of sheets) {
    const root = readPart(zip, sheet.entryName);
    if (!root) {
      structure.warnings.push(`Sheet "${sheet.name}" could not be read.`);
      continue;
    }
    const data = childNamed(root, "sheetData");
    if (!data) continue;

    const rows: string[][] = [];
    let truncated = false;
    for (const row of childrenNamed(data, "row")) {
      if (rows.length >= MAX_ROWS_PER_SHEET) {
        truncated = true;
        break;
      }
      const cells: string[] = [];
      for (const cell of childrenNamed(row, "c")) {
        const reference = attribute(cell, "r") ?? "";
        const index = Math.max(1, columnIndex(reference)) - 1;
        if (index >= MAX_COLUMNS) continue;
        const { display, formula } = readCell(cell, sharedStrings);
        while (cells.length < index) cells.push("");
        // The cell shows its value; the formula behind it is listed separately
        // so the grid stays readable as a grid. When there is no cached value —
        // which is every workbook written by a library rather than by Excel —
        // the formula is shown in the cell instead, so the row does not read as
        // empty when it is in fact the calculated part of the model.
        cells[index] = (display || (formula ? `=${formula}` : "")).replace(/\|/g, "\\|");
        if (formula) {
          formulaCount += 1;
          if (formulaLines.length < MAX_FORMULAS_LISTED) {
            formulaLines.push(`- \`${sheet.name}!${reference}\` = \`=${formula}\``);
          }
        }
        if (display.startsWith("#")) errorCount += 1;
      }
      if (cells.some((value) => value !== "")) rows.push(cells);
    }

    if (!rows.length) continue;
    const columns = Math.min(MAX_COLUMNS, Math.max(...rows.map((row) => row.length)));
    const pad = (row: string[]) =>
      `| ${Array.from({ length: columns }, (_, index) => row[index] ?? "").join(" | ")} |`;
    const [header, ...body] = rows;
    blocks.push(
      [
        `## Sheet: ${sheet.name}`,
        "",
        pad(header),
        `| ${Array.from({ length: columns }, () => "---").join(" | ")} |`,
        ...body.map(pad),
        truncated ? `\n_Only the first ${MAX_ROWS_PER_SHEET} rows of this sheet are shown._` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  if (formulaLines.length) {
    blocks.push(
      [
        "## Formulas",
        "",
        "The logic behind the cells above, in sheet order.",
        "",
        ...formulaLines,
        formulaCount > formulaLines.length
          ? `\n_${formulaCount - formulaLines.length} further formulas are not listed._`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  if (errorCount) {
    structure.warnings.push(
      `${errorCount} cell${errorCount === 1 ? "" : "s"} in this workbook currently show an error value.`,
    );
  }

  structure.markdown = blocks.join("\n\n").trim();
  structure.summary = {
    ...structure.summary,
    sheetCount: sheets.length,
    tableCount: blocks.filter((block) => block.startsWith("## Sheet:")).length,
    cellFormulaCount: formulaCount,
  };
  return structure;
}
