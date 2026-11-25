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
/** One sheet as a grid of display values, with the formulas behind them. */
export interface XlsxSheetGrid {
  name: string;
  rows: string[][];
  /** `B12` → the formula source, for the cells that carry one. */
  formulas: { reference: string; formula: string }[];
  /** True when the sheet has more rows than were read. */
  truncated: boolean;
  /** Cells currently showing `#REF!` and friends. */
  errorCount: number;
}

/**
 * The workbook as data rather than as prose.
 *
 * `readXlsx` renders this into markdown for a chat message; callers that want
 * the cells themselves — a curated dataset shipped as a workbook, say — read
 * the grid directly instead of parsing the markdown back apart. Never throws:
 * an unopenable workbook comes back as warnings and no sheets.
 */
export function readXlsxGrid(buffer: Buffer): {
  sheets: XlsxSheetGrid[];
  warnings: string[];
} {
  const warnings: string[] = [];
  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    return { sheets: [], warnings: ["That workbook could not be opened."] };
  }

  const sharedStrings = readSharedStrings(zip);
  const sheetRefs = readSheets(zip);
  if (!sheetRefs.length) {
    return { sheets: [], warnings: ["That workbook has no readable sheets."] };
  }

  const sheets: XlsxSheetGrid[] = [];
  for (const sheet of sheetRefs) {
    const root = readPart(zip, sheet.entryName);
    if (!root) {
      warnings.push(`Sheet "${sheet.name}" could not be read.`);
      continue;
    }
    const data = childNamed(root, "sheetData");
    if (!data) continue;

    const rows: string[][] = [];
    const formulas: { reference: string; formula: string }[] = [];
    let truncated = false;
    let errorCount = 0;
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
        // The cell shows its value; the formula behind it is kept separately
        // so the grid stays a grid. When there is no cached value — which is
        // every workbook written by a library rather than by Excel — the
        // formula is shown in the cell instead, so the row does not read as
        // empty when it is in fact the calculated part of the model.
        cells[index] = display || (formula ? `=${formula}` : "");
        if (formula) formulas.push({ reference, formula });
        if (display.startsWith("#")) errorCount += 1;
      }
      if (cells.some((value) => value !== "")) rows.push(cells);
    }
    sheets.push({ name: sheet.name, rows, formulas, truncated, errorCount });
  }
  return { sheets, warnings };
}

// ---------------------------------------------------------------------------
// The workbook as a person sees it.
//
// `readXlsxGrid` is shaped for a model: empty rows dropped, values raw. A
// viewer needs the opposite: rows where Excel puts them, merged cells merged,
// columns at their widths, and a date showing as a date rather than 45291.

const VIEW_MAX_ROWS = 3000;
const VIEW_MAX_COLUMNS = 120;

export interface XlsxViewCell {
  /** 0-based column. */
  c: number;
  /** The value as the sheet displays it. */
  v: string;
  /** Numeric, so it sits right-aligned the way Excel puts it. */
  n?: 1;
  /** An error value such as #REF!. */
  e?: 1;
  /** Bold, from the cell's font. */
  b?: 1;
  /** The formula behind the value, without its leading "=". */
  f?: string;
}

export interface XlsxViewRow {
  /** 1-based row number, exactly as the sheet numbers it. */
  r: number;
  cells: XlsxViewCell[];
}

export interface XlsxViewSheet {
  name: string;
  rows: XlsxViewRow[];
  /** Highest row and column with anything in them (1-based / count). */
  rowCount: number;
  columnCount: number;
  /** 0-based top-left plus spans. */
  merges: { r: number; c: number; rs: number; cs: number }[];
  /** 0-based column → width in pixels, for the columns the sheet sizes. */
  columnWidths: Record<number, number>;
  truncated: boolean;
  hidden: boolean;
}

interface CellStyle {
  kind: "general" | "date" | "time" | "datetime" | "percent" | "number" | "text";
  decimals: number;
  grouping: boolean;
  prefix: string;
  suffix: string;
  bold: boolean;
}

const BUILTIN_FORMATS: Record<number, string> = {
  1: "0", 2: "0.00", 3: "#,##0", 4: "#,##0.00", 9: "0%", 10: "0.00%",
  11: "0.00E+00", 12: "# ?/?", 13: "# ??/??", 14: "yyyy-mm-dd", 15: "d-mmm-yy",
  16: "d-mmm", 17: "mmm-yy", 18: "h:mm AM/PM", 19: "h:mm:ss AM/PM", 20: "h:mm",
  21: "h:mm:ss", 22: "yyyy-mm-dd h:mm", 37: "#,##0 ;(#,##0)", 38: "#,##0 ;[Red](#,##0)",
  39: "#,##0.00;(#,##0.00)", 40: "#,##0.00;[Red](#,##0.00)", 45: "mm:ss", 46: "[h]:mm:ss",
  47: "mmss.0", 48: "##0.0E+0", 49: "@",
};

function describeFormat(code: string, bold: boolean): CellStyle {
  const style: CellStyle = { kind: "general", decimals: 0, grouping: false, prefix: "", suffix: "", bold };
  if (!code || /^general$/i.test(code.trim())) return style;
  const section = code.split(";")[0] ?? "";
  if (section.trim() === "@") return { ...style, kind: "text" };
  const currency = /\[\$([^\-\]]+)[^\]]*\]/.exec(section)?.[1] ?? "";
  // What is left once quoted literals, escapes and [colour]/[locale] blocks go
  // is the part that says what kind of number this is.
  const bare = section
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .replace(/\[(?!h\]|m\]|s\])[^\]]*\]/gi, "")
    .replace(/_.|\*./g, "");
  if (/[ymdhs]/i.test(bare) && !/[0#?]/.test(bare.replace(/s\.0+/gi, ""))) {
    const hasDate = /[yd]/i.test(bare) || (/m/i.test(bare) && !/[hs]/i.test(bare));
    const hasTime = /[hs]/i.test(bare);
    return { ...style, kind: hasDate && hasTime ? "datetime" : hasTime ? "time" : "date" };
  }
  const decimals = /\.([0#?]+)/.exec(bare)?.[1].length ?? 0;
  const grouping = /[#0?],[#0?]/.test(bare);
  const literalBefore = /^"([^"]*)"/.exec(section)?.[1] ?? "";
  const symbol = currency || literalBefore || (/^[^0#?]*([$€£¥])/.exec(bare)?.[1] ?? "");
  const literalAfter = /"([^"]*)"\s*$/.exec(section)?.[1] ?? "";
  return {
    ...style,
    kind: bare.includes("%") ? "percent" : /E[+-]/i.test(bare) ? "general" : "number",
    decimals,
    grouping,
    prefix: symbol,
    suffix: literalAfter && literalAfter !== literalBefore ? literalAfter : "",
  };
}

function readStyles(zip: AdmZip): CellStyle[] {
  const root = readPart(zip, "xl/styles.xml");
  if (!root) return [];
  const custom = new Map<number, string>();
  const numFmts = childNamed(root, "numFmts");
  if (numFmts) {
    for (const format of childrenNamed(numFmts, "numFmt")) {
      const id = Number(attribute(format, "numFmtId"));
      const code = attribute(format, "formatCode");
      if (Number.isInteger(id) && code) custom.set(id, code);
    }
  }
  const fonts = childNamed(root, "fonts");
  const boldFonts = fonts
    ? childrenNamed(fonts, "font").map((font) => {
        const b = childNamed(font, "b");
        return Boolean(b) && attribute(b!, "val") !== "0" && attribute(b!, "val") !== "false";
      })
    : [];
  const cellXfs = childNamed(root, "cellXfs");
  if (!cellXfs) return [];
  return childrenNamed(cellXfs, "xf").map((xf) => {
    const id = Number(attribute(xf, "numFmtId") ?? "0");
    const fontId = Number(attribute(xf, "fontId") ?? "0");
    const code = custom.get(id) ?? BUILTIN_FORMATS[id] ?? "";
    // Locale-dependent built-ins with no code written down are dates.
    const builtinDate = !code && ((id >= 27 && id <= 36) || (id >= 50 && id <= 58));
    return builtinDate
      ? { ...describeFormat("", false), kind: "date" as const, bold: Boolean(boldFonts[fontId]) }
      : describeFormat(code, Boolean(boldFonts[fontId]));
  });
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatSerialDate(serial: number, kind: CellStyle["kind"], date1904: boolean): string {
  const epochOffset = date1904 ? 24107 : 25569;
  // Lotus's phantom 29 February 1900 shifts every earlier serial by one day.
  const adjusted = !date1904 && serial < 60 ? serial + 1 : serial;
  const ms = Math.round((adjusted - epochOffset) * 86_400_000);
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return String(serial);
  const day = `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
  const seconds = date.getUTCSeconds();
  const time = `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}${seconds ? `:${pad2(seconds)}` : ""}`;
  if (kind === "time") return time;
  if (kind === "datetime") return `${day} ${time}`;
  return day;
}

function formatGeneral(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (Number.isInteger(value) && Math.abs(value) < 1e15) return String(value);
  const abs = Math.abs(value);
  if (abs !== 0 && (abs >= 1e11 || abs < 1e-9)) return value.toExponential(5).replace(/\.?0+e/, "e");
  // Excel's General shows about eleven significant digits; this is what hides
  // 0.1 + 0.2's float noise the way the spreadsheet itself does.
  return String(Number(value.toPrecision(11)));
}

function formatNumber(raw: string, style: CellStyle | undefined, date1904: boolean): string {
  const value = Number(raw);
  if (!raw || !Number.isFinite(value)) return raw;
  if (!style || style.kind === "general" || style.kind === "text") return formatGeneral(value);
  if (style.kind === "date" || style.kind === "time" || style.kind === "datetime") {
    return formatSerialDate(value, style.kind, date1904);
  }
  const scaled = style.kind === "percent" ? value * 100 : value;
  const formatted = Math.abs(scaled).toLocaleString("en-US", {
    minimumFractionDigits: style.decimals,
    maximumFractionDigits: style.decimals,
    useGrouping: style.grouping,
  });
  const sign = scaled < 0 && Number(formatted.replace(/,/g, "")) !== 0 ? "-" : "";
  return `${sign}${style.prefix}${formatted}${style.kind === "percent" ? "%" : ""}${style.suffix}`;
}

/** "B3" → { r: 2, c: 1 } (0-based). */
function parseReference(reference: string): { r: number; c: number } | null {
  const match = /^([A-Z]+)(\d+)$/i.exec(reference.replace(/\$/g, ""));
  if (!match) return null;
  return { r: Number(match[2]) - 1, c: columnIndex(match[1]) - 1 };
}

/**
 * Read a workbook for display: every sheet, rows at their real numbers,
 * merged ranges, column widths and number formats applied. Never throws.
 */
export function readXlsxForView(buffer: Buffer): { sheets: XlsxViewSheet[]; warnings: string[] } {
  const warnings: string[] = [];
  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    return { sheets: [], warnings: ["That workbook could not be opened."] };
  }
  const sharedStrings = readSharedStrings(zip);
  const styles = readStyles(zip);
  const workbook = readPart(zip, "xl/workbook.xml");
  const workbookPr = workbook ? childNamed(workbook, "workbookPr") : null;
  const date1904 = workbookPr ? ["1", "true"].includes(attribute(workbookPr, "date1904") ?? "") : false;
  const hiddenNames = new Set(
    workbook
      ? descendants(workbook, "sheet")
          .filter((sheet) => (attribute(sheet, "state") ?? "visible") !== "visible")
          .map((sheet) => attribute(sheet, "name") ?? "")
      : [],
  );
  const sheetRefs = readSheets(zip);
  if (!sheetRefs.length) return { sheets: [], warnings: ["That workbook has no readable sheets."] };

  const sheets: XlsxViewSheet[] = [];
  for (const sheet of sheetRefs) {
    const root = readPart(zip, sheet.entryName);
    if (!root) {
      warnings.push(`Sheet "${sheet.name}" could not be read.`);
      continue;
    }
    const data = childNamed(root, "sheetData");
    const rows: XlsxViewRow[] = [];
    let rowCount = 0;
    let columnCount = 0;
    let truncated = false;
    let previousRow = 0;
    for (const row of data ? childrenNamed(data, "row") : []) {
      const r = Number(attribute(row, "r")) || previousRow + 1;
      previousRow = r;
      if (r > VIEW_MAX_ROWS) {
        truncated = true;
        break;
      }
      const cells: XlsxViewCell[] = [];
      let previousColumn = -1;
      for (const cell of childrenNamed(row, "c")) {
        const reference = attribute(cell, "r");
        const c = reference ? Math.max(1, columnIndex(reference)) - 1 : previousColumn + 1;
        previousColumn = c;
        if (c >= VIEW_MAX_COLUMNS) {
          truncated = true;
          continue;
        }
        const type = attribute(cell, "t") ?? "n";
        const style = styles[Number(attribute(cell, "s") ?? "0")];
        const formulaNode = childNamed(cell, "f");
        const formula = formulaNode ? textContent(formulaNode).trim() : "";
        const valueNode = childNamed(cell, "v");
        const raw = valueNode ? textContent(valueNode) : "";
        let value = "";
        let numeric = false;
        let error = false;
        if (type === "inlineStr") {
          value = descendants(cell, "t").map((node) => textContent(node)).join("");
        } else if (type === "s") {
          const index = Number(raw.trim());
          value = Number.isInteger(index) ? sharedStrings[index] ?? "" : "";
        } else if (type === "b") {
          value = raw.trim() === "1" ? "TRUE" : "FALSE";
        } else if (type === "e") {
          value = raw.trim();
          error = true;
        } else if (type === "str") {
          value = raw;
        } else if (raw.trim()) {
          value = formatNumber(raw.trim(), style, date1904);
          numeric = true;
        }
        if (!value && formula) value = `=${formula}`;
        if (!value && !formula) continue;
        cells.push({
          c,
          v: value,
          ...(numeric ? { n: 1 as const } : {}),
          ...(error ? { e: 1 as const } : {}),
          ...(style?.bold ? { b: 1 as const } : {}),
          ...(formula ? { f: formula } : {}),
        });
        columnCount = Math.max(columnCount, c + 1);
      }
      if (cells.length) {
        rows.push({ r, cells });
        rowCount = Math.max(rowCount, r);
      }
    }

    const merges: XlsxViewSheet["merges"] = [];
    const mergeCells = childNamed(root, "mergeCells");
    for (const merge of mergeCells ? childrenNamed(mergeCells, "mergeCell") : []) {
      const [from, to] = (attribute(merge, "ref") ?? "").split(":");
      const start = from ? parseReference(from) : null;
      const end = to ? parseReference(to) : start;
      if (!start || !end) continue;
      if (start.r >= VIEW_MAX_ROWS || start.c >= VIEW_MAX_COLUMNS) continue;
      const rs = Math.min(end.r, VIEW_MAX_ROWS - 1) - start.r + 1;
      const cs = Math.min(end.c, VIEW_MAX_COLUMNS - 1) - start.c + 1;
      if (rs < 1 || cs < 1 || (rs === 1 && cs === 1)) continue;
      merges.push({ r: start.r, c: start.c, rs, cs });
      rowCount = Math.max(rowCount, start.r + rs);
      columnCount = Math.max(columnCount, start.c + cs);
    }

    const columnWidths: Record<number, number> = {};
    const cols = childNamed(root, "cols");
    for (const col of cols ? childrenNamed(cols, "col") : []) {
      const min = Number(attribute(col, "min"));
      const max = Math.min(Number(attribute(col, "max")), VIEW_MAX_COLUMNS);
      const width = Number(attribute(col, "width"));
      const hidden = ["1", "true"].includes(attribute(col, "hidden") ?? "");
      if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) continue;
      if (max - min > VIEW_MAX_COLUMNS) continue;
      const px = hidden ? 0 : Number.isFinite(width) && width > 0 ? Math.round(width * 7 + 5) : 0;
      if (!px && !hidden) continue;
      for (let index = min; index <= max; index += 1) columnWidths[index - 1] = Math.min(px, 640);
    }

    sheets.push({
      name: sheet.name,
      rows,
      rowCount,
      columnCount,
      merges,
      columnWidths,
      truncated,
      hidden: hiddenNames.has(sheet.name),
    });
  }
  return { sheets, warnings };
}

export function readXlsx(buffer: Buffer): DocumentStructure {
  const structure = emptyStructure();
  const grid = readXlsxGrid(buffer);
  structure.warnings.push(...grid.warnings);
  if (!grid.sheets.length) return structure;

  const blocks: string[] = [];
  const formulaLines: string[] = [];
  let formulaCount = 0;
  let errorCount = 0;

  for (const sheet of grid.sheets) {
    const { rows, truncated } = sheet;
    errorCount += sheet.errorCount;
    for (const { reference, formula } of sheet.formulas) {
      formulaCount += 1;
      if (formulaLines.length < MAX_FORMULAS_LISTED) {
        formulaLines.push(`- \`${sheet.name}!${reference}\` = \`=${formula}\``);
      }
    }

    if (!rows.length) continue;
    const columns = Math.min(MAX_COLUMNS, Math.max(...rows.map((row) => row.length)));
    const pad = (row: string[]) =>
      `| ${Array.from({ length: columns }, (_, index) =>
        (row[index] ?? "").replace(/\|/g, "\\|"),
      ).join(" | ")} |`;
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
    sheetCount: grid.sheets.length,
    tableCount: blocks.filter((block) => block.startsWith("## Sheet:")).length,
    cellFormulaCount: formulaCount,
  };
  return structure;
}
