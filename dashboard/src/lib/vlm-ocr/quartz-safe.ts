// Turn HunyuanOCR output into Markdown that renders cleanly everywhere in
// Breadboard.
//
// Breadboard has three Markdown renderers with different capabilities:
//
//   * Quartz (the garden iframe)  — GFM + Obsidian flavour + KaTeX + raw HTML
//   * chat-markdown.tsx           — GFM + KaTeX, but NO rehype-raw, so raw HTML
//                                   is dropped entirely
//   * markdown-render/{pdf,docx}  — a hand-rolled subset used for export
//
// The model, following its official doc_parse prompt, emits tables as raw HTML
// and formulas as LaTeX. Raw HTML would silently vanish in chat and export, and
// an unparseable formula makes rehype-katex paint a red error into the page. So
// this module lowers everything to the common denominator — GFM tables and
// KaTeX-validated math — and escapes anything left that a renderer would eat.
//
// The output is deliberately plain: after this pass there is no raw HTML in the
// document at all.

import katex from "katex";

import { normalizeQuartzMarkdown } from "../quartz-markdown.ts";
import {
  closeDanglingDisplayMath,
  fixLeftRight,
  guardTrailingDelimiterFormula,
  netBraceDepth,
  repairDisplayBlock,
} from "./normalize.ts";

export interface QuartzSafeResult {
  markdown: string;
  /** Human-readable notes about content that had to be changed. */
  warnings: string[];
  stats: {
    tablesConverted: number;
    tablesDropped: number;
    mathRepaired: number;
    mathDemoted: number;
    htmlEscaped: number;
  };
}

// ── Masking ─────────────────────────────────────────────────────────────────

const MASK_OPEN = String.fromCharCode(0);
const MASK_CLOSE = String.fromCharCode(1);
// Cell masking happens inside an already-masked document, so it needs its own
// sentinels — sharing them would make the inner restore consume outer tokens
// and blank the cell.
const CELL_MASK_OPEN = String.fromCharCode(2);
const CELL_MASK_CLOSE = String.fromCharCode(3);

function maskRegex(open = MASK_OPEN, close = MASK_CLOSE): RegExp {
  return new RegExp(`${open}(\\d+)${close}`, "g");
}

/** Fenced code, inline code and math are never rewritten by the prose passes. */
const PROTECTED_RE =
  /```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`|\$\$[\s\S]*?\$\$|\$[^$\n]+\$/g;

function withProtectedSpans(
  text: string,
  transform: (prose: string) => string,
): string {
  const spans: string[] = [];
  const masked = text.replace(PROTECTED_RE, (value) => {
    spans.push(value);
    return `${MASK_OPEN}${spans.length - 1}${MASK_CLOSE}`;
  });
  return transform(masked).replace(
    maskRegex(),
    (_whole, index: string) => spans[Number(index)] ?? "",
  );
}

// ── HTML entities ───────────────────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  times: "×",
  divide: "÷",
  deg: "°",
  plusmn: "±",
  micro: "µ",
  middot: "·",
};

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_whole, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_whole, dec: string) =>
      String.fromCodePoint(Number.parseInt(dec, 10)),
    )
    .replace(
      /&([a-z]+);/gi,
      (whole, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? whole,
    );
}

// ── HTML tables → GFM tables ────────────────────────────────────────────────

interface HtmlCell {
  text: string;
  colspan: number;
  rowspan: number;
}

function spanAttr(attrs: string, name: string): number {
  const match = new RegExp(`${name}\\s*=\\s*["']?(\\d+)`, "i").exec(attrs);
  const parsed = match ? Number.parseInt(match[1], 10) : 1;
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  // A pathological span would blow up the grid; clamp to something sane.
  return Math.min(parsed, 64);
}

/** Flatten cell markup to a single line of text, keeping `$…$` math intact. */
export function htmlCellText(html: string): string {
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|div|li)>/gi, " ")
    .replace(/<li[^>]*>/gi, " ");
  const stripped = withBreaks.replace(/<[^>]*>/g, "");
  const decoded = decodeHtmlEntities(stripped).replace(/\s+/g, " ").trim();

  // Escape the cell separator, but not inside math where `\|` means something.
  const spans: string[] = [];
  const masked = decoded.replace(/\$\$[\s\S]*?\$\$|\$[^$\n]+\$/g, (value) => {
    spans.push(value);
    return `${CELL_MASK_OPEN}${spans.length - 1}${CELL_MASK_CLOSE}`;
  });
  return masked
    .replace(/\|/g, "\\|")
    .replace(
      maskRegex(CELL_MASK_OPEN, CELL_MASK_CLOSE),
      (_whole, index: string) => spans[Number(index)] ?? "",
    );
}

export function parseHtmlTableRows(tableHtml: string): HtmlCell[][] {
  const body = tableHtml
    .replace(/<\/?(thead|tbody|tfoot|colgroup)[^>]*>/gi, "")
    .replace(/<col[^>]*>/gi, "")
    .replace(/<caption[^>]*>[\s\S]*?<\/caption>/gi, "");

  const rowMatches = [...body.matchAll(/<tr[^>]*>([\s\S]*?)(?:<\/tr>|(?=<tr)|$)/gi)];
  const rowHtml =
    rowMatches.length > 0
      ? rowMatches.map((match) => match[1] ?? "")
      : /<t[dh][\s>]/i.test(body)
        ? [body]
        : [];

  const rows: HtmlCell[][] = [];
  for (const row of rowHtml) {
    const cells: HtmlCell[] = [];
    const cellMatches = [
      ...row.matchAll(
        /<(td|th)([^>]*)>([\s\S]*?)(?:<\/(?:td|th)>|(?=<t[dh][\s>])|$)/gi,
      ),
    ];
    for (const match of cellMatches) {
      const attrs = match[2] ?? "";
      cells.push({
        text: htmlCellText(match[3] ?? ""),
        colspan: spanAttr(attrs, "colspan"),
        rowspan: spanAttr(attrs, "rowspan"),
      });
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

/**
 * Expand colspan/rowspan into a rectangular grid. The value goes in the first
 * covered cell and the continuation cells are left blank, which is how a merged
 * cell reads best once the merge itself is gone.
 */
export function expandTableGrid(rows: HtmlCell[][]): string[][] {
  const grid: string[][] = [];
  const occupied: boolean[][] = [];

  const ensureRow = (index: number) => {
    while (grid.length <= index) {
      grid.push([]);
      occupied.push([]);
    }
  };

  rows.forEach((cells, rowIndex) => {
    ensureRow(rowIndex);
    let column = 0;
    for (const cell of cells) {
      while (occupied[rowIndex][column]) column += 1;
      for (let r = 0; r < cell.rowspan; r += 1) {
        ensureRow(rowIndex + r);
        for (let c = 0; c < cell.colspan; c += 1) {
          occupied[rowIndex + r][column + c] = true;
          grid[rowIndex + r][column + c] =
            r === 0 && c === 0 ? cell.text : "";
        }
      }
      column += cell.colspan;
    }
  });

  const width = grid.reduce((max, row) => Math.max(max, row.length), 0);
  return grid.map((row) => {
    const filled = [...row];
    for (let i = 0; i < width; i += 1) if (filled[i] === undefined) filled[i] = "";
    return filled;
  });
}

export function gridToGfmTable(grid: string[][]): string | null {
  if (grid.length === 0) return null;
  const width = grid[0].length;
  if (width === 0) return null;
  if (grid.every((row) => row.every((cell) => !cell.trim()))) return null;

  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  const header = grid[0];
  const separator = Array.from({ length: width }, () => "---");
  const bodyRows = grid.slice(1);

  return [line(header), line(separator), ...bodyRows.map(line)].join("\n");
}

const TABLE_BLOCK_RE = /<table[^>]*>[\s\S]*?(?:<\/table>|$)/gi;
const CAPTION_RE = /<caption[^>]*>([\s\S]*?)<\/caption>/i;

/** Replace every `<table>` with a GFM table. Returns counts for reporting. */
export function htmlTablesToMarkdown(text: string): {
  text: string;
  converted: number;
  dropped: number;
} {
  let converted = 0;
  let dropped = 0;

  const next = text.replace(TABLE_BLOCK_RE, (tableHtml) => {
    const caption = CAPTION_RE.exec(tableHtml)?.[1] ?? "";
    const rows = parseHtmlTableRows(tableHtml);
    const table = gridToGfmTable(expandTableGrid(rows));

    if (!table) {
      // Nothing parseable: keep the readable text rather than an empty hole.
      const fallback = htmlCellText(tableHtml).replace(/\\\|/g, "|").trim();
      dropped += 1;
      return fallback ? `\n\n${fallback}\n\n` : "\n\n";
    }

    converted += 1;
    const captionText = decodeHtmlEntities(
      caption.replace(/<[^>]*>/g, ""),
    )
      .replace(/\s+/g, " ")
      .trim();
    const prefix = captionText ? `**${captionText}**\n\n` : "";
    return `\n\n${prefix}${table}\n\n`;
  });

  return { text: next, converted, dropped };
}

// ── Obsidian-flavour and raw-HTML neutralization ────────────────────────────

// Quartz strips `%%…%%` from the *raw source* before parsing, so a stray pair
// of percent signs would delete everything between them. Breaking the pair with
// a character reference keeps the rendered text identical.
function neutralizeObsidianSyntax(prose: string): string {
  return prose
    .replace(/%%/g, "%&#37;")
    .replace(/\[\[/g, "[&#91;")
    .replace(/!\[&#91;/g, "!&#91;&#91;");
}

/**
 * Escape every remaining `<`. Tables are already GFM by this point, so any
 * angle bracket left is literal text that CommonMark would otherwise hand to
 * rehype-raw as a tag (and chat-markdown would drop outright).
 */
function escapeStrayHtml(prose: string): { text: string; escaped: number } {
  let escaped = 0;
  const text = prose.replace(/</g, () => {
    escaped += 1;
    return "&lt;";
  });
  return { text, escaped };
}

// ── Math validation ─────────────────────────────────────────────────────────

function katexRenders(formula: string, displayMode: boolean): boolean {
  if (!formula.trim()) return false;
  try {
    katex.renderToString(formula, {
      displayMode,
      throwOnError: true,
      strict: false,
      trust: false,
      output: "html",
    });
    return true;
  } catch {
    return false;
  }
}

/** Repairs applied in order, each retried against KaTeX. */
const MATH_REPAIRS: Array<(formula: string) => string> = [
  // A `\right` that lost its delimiter (e.g. to trailing-punctuation cleanup).
  (formula) => formula.replace(/\\right\s*$/, "\\right.{}"),
  (formula) => fixLeftRight(formula).content,
  (formula) => repairDisplayBlock(formula).content,
  (formula) =>
    formula
      .replace(/\\(?:label|ref|eqref|intertext|caption)\s*\{[^{}]*\}/g, "")
      .replace(/\\(?:nonumber|notag|noindent|centering|displaystyle\s*$)/g, "")
      .replace(/\\(?:small|med|big)skip/g, "")
      .replace(/\\vspace\*?\s*\{[^{}]*\}/g, "")
      .replace(/\\hspace\*/g, "\\hspace"),
  (formula) =>
    formula
      .replace(/\\mbox/g, "\\text")
      .replace(/\\bm\b/g, "\\boldsymbol")
      .replace(/\\mathbbm/g, "\\mathbb")
      .replace(/\\scalebox\s*\{[^{}]*\}\s*/g, "")
      .replace(/\\resizebox\s*\{[^{}]*\}\s*\{[^{}]*\}\s*/g, ""),
  (formula) =>
    formula
      .replace(/\\begin\{(equation|eqnarray|align|gather|multline)\*?\}/g, (
        _whole,
        name: string,
      ) =>
        name === "equation" || name === "multline"
          ? ""
          : `\\begin{${name === "gather" ? "gathered" : "aligned"}}`,
      )
      .replace(/\\end\{(equation|eqnarray|align|gather|multline)\*?\}/g, (
        _whole,
        name: string,
      ) =>
        name === "equation" || name === "multline"
          ? ""
          : `\\end{${name === "gather" ? "gathered" : "aligned"}}`,
      )
      .replace(/\\begin\{tabular\}/g, "\\begin{array}")
      .replace(/\\end\{tabular\}/g, "\\end{array}"),
  (formula) => formula.replace(/\\\\\s*$/, "").trim(),
  (formula) => {
    const depth = netBraceDepth(formula);
    if (depth > 0) return formula + "}".repeat(depth);
    return formula;
  },
];

/** Try hard to make `formula` render; report failure so it can be demoted. */
export function repairMath(
  formula: string,
  displayMode: boolean,
): { formula: string; ok: boolean; repaired: boolean } {
  if (katexRenders(formula, displayMode)) {
    return { formula, ok: true, repaired: false };
  }

  let candidate = formula;
  for (const repair of MATH_REPAIRS) {
    const next = repair(candidate);
    if (next === candidate) continue;
    candidate = next;
    if (katexRenders(candidate, displayMode)) {
      // A repair ending in `\right.` would lose its dot to the write-time
      // normalizer, so hand back the anchored form when it still renders.
      const guarded = guardTrailingDelimiterFormula(candidate);
      return {
        formula:
          guarded !== candidate && katexRenders(guarded, displayMode)
            ? guarded
            : candidate,
        ok: true,
        repaired: true,
      };
    }
  }

  return { formula, ok: false, repaired: false };
}

/**
 * Guarantee that every math span renders. Anything KaTeX still refuses is
 * demoted to code so the reader sees the LaTeX instead of a red error box.
 */
export function ensureRenderableMath(markdown: string): {
  markdown: string;
  repaired: number;
  demoted: number;
} {
  let repaired = 0;
  let demoted = 0;

  const codeSpans: string[] = [];
  const withoutCode = markdown.replace(
    /```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`/g,
    (value) => {
      codeSpans.push(value);
      return `${MASK_OPEN}${codeSpans.length - 1}${MASK_CLOSE}`;
    },
  );

  let next = withoutCode.replace(/\$\$([\s\S]*?)\$\$/g, (whole, inner: string) => {
    const formula = inner.trim();
    if (!formula) return "";
    const result = repairMath(formula, true);
    if (result.ok) {
      if (result.repaired) repaired += 1;
      return result.repaired ? `$$\n${result.formula}\n$$` : whole;
    }
    demoted += 1;
    return `\n\n\`\`\`latex\n${formula}\n\`\`\`\n\n`;
  });

  next = next.replace(
    /(^|[^\\$])\$([^\n$]+?)\$/g,
    (whole, prefix: string, inner: string) => {
      const formula = inner.trim();
      if (!formula) return whole;
      const result = repairMath(formula, false);
      if (result.ok) {
        if (result.repaired) repaired += 1;
        return result.repaired ? `${prefix}$${result.formula}$` : whole;
      }
      demoted += 1;
      return `${prefix}\`${formula}\``;
    },
  );

  return {
    markdown: next.replace(
      maskRegex(),
      (_whole, index: string) => codeSpans[Number(index)] ?? "",
    ),
    repaired,
    demoted,
  };
}

// ── Headings ────────────────────────────────────────────────────────────────

/**
 * Push OCR headings below the page heading the ingest pipeline adds, so a
 * document title on page 1 does not outrank the page structure.
 */
export function shiftHeadings(markdown: string, by: number): string {
  if (by <= 0) return markdown;
  return withProtectedSpans(markdown, (prose) =>
    prose.replace(/^(#{1,6})(\s+)/gm, (whole, hashes: string, space: string) => {
      const level = Math.min(hashes.length + by, 6);
      return `${"#".repeat(level)}${space}`;
    }),
  );
}

// ── Pipeline ────────────────────────────────────────────────────────────────

/**
 * Lower one OCR'd document to Markdown that every Breadboard renderer handles.
 *
 * `normalizeQuartzMarkdown` is run here rather than only at write time so the
 * math that gets validated is the math that ends up on disk; it is idempotent,
 * so the write-time pass leaves this output alone.
 */
export function toBreadboardMarkdown(text: string): QuartzSafeResult {
  const warnings: string[] = [];

  let escapedCount = 0;
  let tablesConverted = 0;
  let tablesDropped = 0;

  // Masking pairs up `$$…$$`, so a `$$` still in the prose is an unclosed
  // block. Close it before the rewrites, not after, or the formula inside it
  // never gets validated.
  const closed = withProtectedSpans(text, closeDanglingDisplayMath);

  // One masked pass: fenced code, inline code and math are held aside so the
  // table, Obsidian and HTML rewrites only ever see prose.
  const lowered = withProtectedSpans(closed, (prose) => {
    const tables = htmlTablesToMarkdown(prose);
    tablesConverted += tables.converted;
    tablesDropped += tables.dropped;

    const escaped = escapeStrayHtml(neutralizeObsidianSyntax(tables.text));
    escapedCount += escaped.escaped;
    return escaped.text;
  });

  const normalized = normalizeQuartzMarkdown(lowered);
  const math = ensureRenderableMath(normalized);

  if (tablesDropped > 0) {
    warnings.push(
      `${tablesDropped} table${tablesDropped === 1 ? "" : "s"} could not be read as a grid and were kept as plain text.`,
    );
  }
  if (math.demoted > 0) {
    warnings.push(
      `${math.demoted} formula${math.demoted === 1 ? "" : "s"} could not be rendered by KaTeX and are shown as LaTeX source instead of a broken equation.`,
    );
  }

  const markdown = math.markdown
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();

  return {
    markdown,
    warnings,
    stats: {
      tablesConverted,
      tablesDropped,
      mathRepaired: math.repaired,
      mathDemoted: math.demoted,
      htmlEscaped: escapedCount,
    },
  };
}
