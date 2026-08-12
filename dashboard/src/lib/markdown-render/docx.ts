// Styled Markdown -> DOCX (OpenXML) renderer, shared by the Hermes artifact
// `document`/docx renderer. It parses Markdown into the same remark AST the PDF
// path uses and emits WordprocessingML with real Word styles — headings, bold /
// italic, bullet & numbered lists, tables, fenced code, blockquotes, and rules —
// so an agent-generated .docx opens in Word looking like a written document, not
// a wall of literal Markdown (`#`, `**`, `- `).
//
// The look is NOT fixed: colours, fonts, heading scale, and rules come from the
// same DocumentTheme the PDF path uses (see ./theme), so a "formal" request and
// a "playful" one render differently — and a PDF and DOCX of one request match.
//
// No native Word libraries are available, so the .docx package (a zip of XML
// parts) is assembled by hand with AdmZip. A matching HTML preview is produced
// from the same AST for the in-app artifact viewer, which cannot render .docx.

import AdmZip from "adm-zip";
import { unified } from "unified";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import {
  HEADING_FACTORS,
  resolveDocumentTheme,
  type DocumentTheme,
  type DocumentThemeInput,
  type ThemeFontFamily,
} from "./theme.ts";

type MarkdownNode = {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  depth?: number;
  ordered?: boolean;
  start?: number;
  url?: string;
  alt?: string;
  align?: Array<string | null>;
};

function childrenOf(node: MarkdownNode): MarkdownNode[] {
  return Array.isArray(node.children) ? node.children : [];
}

function parseMarkdown(content: string): MarkdownNode {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .parse(content) as MarkdownNode;
}

function fontFamilyName(family: ThemeFontFamily): string {
  return family === "serif" ? "Georgia" : "Calibri";
}

/* -------------------------------------------------------------------------- */
/* XML helpers                                                                 */
/* -------------------------------------------------------------------------- */

function xml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function htmlEscape(value: string): string {
  return xml(value);
}

/* -------------------------------------------------------------------------- */
/* Inline runs                                                                 */
/* -------------------------------------------------------------------------- */

type InlineRun = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  color?: string;
  underline?: boolean;
};

type InlineStyle = { bold?: boolean; italic?: boolean; color?: string };

// Flattens a Markdown inline subtree into styled runs (Word) — links become an
// accent-coloured underlined label plus a dimmed "(url)" when the URL differs.
function collectInlineRuns(
  node: MarkdownNode,
  style: InlineStyle,
  out: InlineRun[],
  theme: DocumentTheme,
): void {
  switch (node.type) {
    case "text":
      out.push({ text: node.value ?? "", ...style });
      break;
    case "strong":
      childrenOf(node).forEach((child) =>
        collectInlineRuns(child, { ...style, bold: true }, out, theme),
      );
      break;
    case "emphasis":
      childrenOf(node).forEach((child) =>
        collectInlineRuns(child, { ...style, italic: true }, out, theme),
      );
      break;
    case "delete":
      childrenOf(node).forEach((child) => collectInlineRuns(child, style, out, theme));
      break;
    case "inlineCode":
    case "inlineMath":
      out.push({ text: node.value ?? "", code: true, color: style.color });
      break;
    case "break":
      out.push({ text: "\n", ...style });
      break;
    case "link": {
      const label = childrenOf(node).map(plainInline).join("").trim();
      childrenOf(node).forEach((child) =>
        collectInlineRuns(child, { ...style, color: theme.accent }, out, theme),
      );
      for (let i = out.length - 1; i >= 0 && out[i].color === theme.accent; i -= 1) {
        out[i].underline = true;
      }
      if (node.url && node.url !== label) {
        out.push({ text: ` (${node.url})`, color: theme.mutedColor });
      }
      break;
    }
    case "image":
      out.push({
        text: node.alt ? `[Image: ${node.alt}]` : "[Image]",
        italic: true,
        color: "4B5563",
      });
      break;
    default:
      if (typeof node.value === "string") {
        out.push({ text: node.value, ...style });
      } else {
        childrenOf(node).forEach((child) => collectInlineRuns(child, style, out, theme));
      }
  }
}

function plainInline(node: MarkdownNode): string {
  if (typeof node.value === "string") return node.value;
  if (node.type === "inlineCode" || node.type === "inlineMath") return node.value ?? "";
  if (node.type === "break") return " ";
  return childrenOf(node).map(plainInline).join("");
}

function runXml(run: InlineRun, theme: DocumentTheme): string {
  const props: string[] = [];
  if (run.bold) props.push("<w:b/>");
  if (run.italic) props.push("<w:i/>");
  if (run.underline) props.push('<w:u w:val="single"/>');
  if (run.color) props.push(`<w:color w:val="${run.color}"/>`);
  if (run.code) {
    props.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>');
    props.push(`<w:shd w:val="clear" w:color="auto" w:fill="${theme.codeBackground}"/>`);
  }
  const rPr = props.length ? `<w:rPr>${props.join("")}</w:rPr>` : "";
  // Keep soft line breaks (from `\n`) as hard breaks inside the run.
  const segments = (run.text ?? "").split("\n");
  const body = segments
    .map(
      (segment, index) =>
        (index > 0 ? "<w:br/>" : "") +
        `<w:t xml:space="preserve">${xml(segment)}</w:t>`,
    )
    .join("");
  return `<w:r>${rPr}${body}</w:r>`;
}

function runsXml(runs: InlineRun[], theme: DocumentTheme): string {
  return runs.map((run) => runXml(run, theme)).join("");
}

/* -------------------------------------------------------------------------- */
/* Block builders                                                              */
/* -------------------------------------------------------------------------- */

function paragraph(runs: InlineRun[], theme: DocumentTheme, pPr = ""): string {
  return `<w:p>${pPr}${runsXml(runs, theme)}</w:p>`;
}

function emptyParagraph(): string {
  return "<w:p/>";
}

const LIST_BULLET_NUM_ID = 1;
const LIST_ORDERED_NUM_ID = 2;

function listItemParagraphs(
  item: MarkdownNode,
  ordered: boolean,
  level: number,
  theme: DocumentTheme,
): string[] {
  const numId = ordered ? LIST_ORDERED_NUM_ID : LIST_BULLET_NUM_ID;
  const out: string[] = [];
  const children = childrenOf(item);
  const paras = children.filter((c) => c.type === "paragraph");
  const nestedLists = children.filter((c) => c.type === "list");

  const firstText = paras[0];
  const runs: InlineRun[] = [];
  if (firstText) collectInlineRuns(firstText, {}, runs, theme);
  else collectInlineRuns(item, {}, runs, theme);
  const numPr = `<w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${numId}"/></w:numPr>`;
  out.push(
    paragraph(
      runs.length ? runs : [{ text: "" }],
      theme,
      `<w:pPr><w:pStyle w:val="ListParagraph"/>${numPr}</w:pPr>`,
    ),
  );

  for (let i = 1; i < paras.length; i += 1) {
    const extra: InlineRun[] = [];
    collectInlineRuns(paras[i], {}, extra, theme);
    out.push(
      paragraph(
        extra,
        theme,
        `<w:pPr><w:pStyle w:val="ListParagraph"/><w:ind w:left="${(level + 1) * 720}"/></w:pPr>`,
      ),
    );
  }

  for (const nested of nestedLists) {
    childrenOf(nested).forEach((nestedItem) => {
      out.push(...listItemParagraphs(nestedItem, Boolean(nested.ordered), level + 1, theme));
    });
  }
  return out;
}

function tableXml(node: MarkdownNode, theme: DocumentTheme): string {
  const rows = childrenOf(node);
  if (rows.length === 0) return "";
  const align = Array.isArray(node.align) ? node.align : [];
  const columnCount = rows.reduce(
    (max, row) => Math.max(max, childrenOf(row).length),
    0,
  );
  if (columnCount === 0) return "";

  const jc = (col: number): string => {
    const value = align[col];
    if (value === "right") return '<w:jc w:val="right"/>';
    if (value === "center") return '<w:jc w:val="center"/>';
    return "";
  };

  const border =
    "<w:tblBorders>" +
    ["top", "left", "bottom", "right", "insideH", "insideV"]
      .map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="D1D5DB"/>`)
      .join("") +
    "</w:tblBorders>";

  const tblPr = `<w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/>${border}<w:tblLayout w:type="autofit"/></w:tblPr>`;

  const grid = `<w:tblGrid>${Array.from({ length: columnCount })
    .map(() => "<w:gridCol/>")
    .join("")}</w:tblGrid>`;

  const trs = rows
    .map((row, rowIndex) => {
      const isHeader = rowIndex === 0;
      const cells = childrenOf(row);
      const tcs = Array.from({ length: columnCount })
        .map((_unused, col) => {
          const cell = cells[col];
          const runs: InlineRun[] = [];
          if (cell) {
            collectInlineRuns(
              cell,
              isHeader ? { bold: true, color: theme.headingColor } : {},
              runs,
              theme,
            );
          }
          const shd = isHeader
            ? '<w:shd w:val="clear" w:color="auto" w:fill="F3F4F6"/>'
            : "";
          const tcPr = `<w:tcPr>${shd}</w:tcPr>`;
          const pPr = `<w:pPr>${jc(col)}<w:spacing w:before="20" w:after="20"/></w:pPr>`;
          return `<w:tc>${tcPr}${paragraph(runs.length ? runs : [{ text: "" }], theme, pPr)}</w:tc>`;
        })
        .join("");
      const trPr = isHeader ? "<w:trPr><w:tblHeader/></w:trPr>" : "";
      return `<w:tr>${trPr}${tcs}</w:tr>`;
    })
    .join("");

  return `<w:tbl>${tblPr}${grid}${trs}</w:tbl>`;
}

function codeBlockParagraphs(node: MarkdownNode, theme: DocumentTheme): string[] {
  const code = (node.value ?? "").replace(/\t/g, "  ").replace(/\s+$/, "");
  if (!code) return [];
  const lines = code.split("\n");
  const shd = `<w:shd w:val="clear" w:color="auto" w:fill="${theme.codeBackground}"/>`;
  const edge = 'w:val="single" w:sz="2" w:space="4" w:color="E5E7EB"';
  return lines.map((line, index) => {
    const sides: string[] = [`<w:left ${edge}/>`, `<w:right ${edge}/>`];
    if (index === 0) sides.unshift(`<w:top ${edge}/>`);
    if (index === lines.length - 1) sides.push(`<w:bottom ${edge}/>`);
    const border = `<w:pBdr>${sides.join("")}</w:pBdr>`;
    const pPr = `<w:pPr>${shd}${border}<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>`;
    return paragraph([{ text: line || " ", code: true }], theme, pPr);
  });
}

function blockToXml(node: MarkdownNode, theme: DocumentTheme): string[] {
  switch (node.type) {
    case "heading": {
      const depth = Math.min(Math.max(node.depth ?? 1, 1), 6);
      const runs: InlineRun[] = [];
      childrenOf(node).forEach((child) => collectInlineRuns(child, {}, runs, theme));
      return [paragraph(runs, theme, `<w:pPr><w:pStyle w:val="Heading${depth}"/></w:pPr>`)];
    }
    case "paragraph": {
      const runs: InlineRun[] = [];
      childrenOf(node).forEach((child) => collectInlineRuns(child, {}, runs, theme));
      if (runs.every((run) => !run.text.trim())) return [];
      return [paragraph(runs, theme)];
    }
    case "list": {
      const out: string[] = [];
      childrenOf(node).forEach((item) => {
        out.push(...listItemParagraphs(item, Boolean(node.ordered), 0, theme));
      });
      return out;
    }
    case "blockquote": {
      const out: string[] = [];
      childrenOf(node).forEach((child) => {
        if (child.type === "paragraph") {
          const runs: InlineRun[] = [];
          childrenOf(child).forEach((c) =>
            collectInlineRuns(c, { italic: true, color: theme.mutedColor }, runs, theme),
          );
          out.push(
            paragraph(
              runs,
              theme,
              `<w:pPr><w:pStyle w:val="Quote"/><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="${theme.accent}"/></w:pBdr><w:ind w:left="360"/></w:pPr>`,
            ),
          );
        } else {
          out.push(...blockToXml(child, theme));
        }
      });
      return out;
    }
    case "code":
      return codeBlockParagraphs(node, theme);
    case "math":
      return codeBlockParagraphs({ type: "code", value: node.value }, theme);
    case "table": {
      const table = tableXml(node, theme);
      return table ? [table, emptyParagraph()] : [];
    }
    case "thematicBreak":
      return [
        '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="D1D5DB"/></w:pBdr></w:pPr></w:p>',
      ];
    case "image": {
      const runs: InlineRun[] = [];
      collectInlineRuns(node, {}, runs, theme);
      return [paragraph(runs, theme)];
    }
    case "html":
      return [];
    default: {
      const out: string[] = [];
      childrenOf(node).forEach((child) => out.push(...blockToXml(child, theme)));
      return out;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Package parts                                                               */
/* -------------------------------------------------------------------------- */

function headingSizeHalfPoints(depth: number, theme: DocumentTheme): number {
  const factor = HEADING_FACTORS[depth - 1] ?? 1;
  return Math.round(theme.baseFontSize * factor * theme.headingScale * 2);
}

function stylesXml(theme: DocumentTheme): string {
  const headingFont = fontFamilyName(theme.headingFont);
  const bodyFont = fontFamilyName(theme.font);
  const bodySize = Math.round(theme.baseFontSize * 2);

  const heading = (level: number) => {
    const size = headingSizeHalfPoints(level, theme);
    const before = 260 - level * 16;
    const rule =
      theme.headingRule && level <= 2
        ? `<w:pBdr><w:bottom w:val="single" w:sz="${level === 1 ? 8 : 4}" w:space="2" w:color="${level === 1 ? theme.accent : "E5E7EB"}"/></w:pBdr>`
        : "";
    return `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/>${rule}<w:spacing w:before="${before}" w:after="80"/></w:pPr><w:rPr><w:rFonts w:ascii="${headingFont}" w:hAnsi="${headingFont}"/><w:b/><w:color w:val="${theme.headingColor}"/><w:sz w:val="${size}"/></w:rPr></w:style>`;
  };

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${bodyFont}" w:hAnsi="${bodyFont}" w:cs="${bodyFont}"/><w:sz w:val="${bodySize}"/><w:szCs w:val="${bodySize}"/><w:color w:val="${theme.bodyColor}"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
${[1, 2, 3, 4, 5, 6].map(heading).join("\n")}
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/><w:ind w:left="720"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:rPr><w:i/><w:color w:val="${theme.mutedColor}"/></w:rPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="D1D5DB"/><w:left w:val="single" w:sz="4" w:space="0" w:color="D1D5DB"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="D1D5DB"/><w:right w:val="single" w:sz="4" w:space="0" w:color="D1D5DB"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="D1D5DB"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="D1D5DB"/></w:tblBorders></w:tblPr></w:style>
</w:styles>`;
}

function numberingXml(theme: DocumentTheme): string {
  const levels = (bullet: boolean) =>
    Array.from({ length: 6 })
      .map((_unused, level) => {
        const leftIndent = 720 * (level + 1);
        const fmt = bullet
          ? '<w:numFmt w:val="bullet"/><w:lvlText w:val="&#8226;"/>'
          : `<w:numFmt w:val="decimal"/><w:lvlText w:val="%${level + 1}."/>`;
        const rPr = bullet
          ? `<w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/><w:color w:val="${theme.accent}"/></w:rPr>`
          : `<w:rPr><w:color w:val="${theme.accent}"/></w:rPr>`;
        return `<w:lvl w:ilvl="${level}"><w:start w:val="1"/>${fmt}<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${leftIndent}" w:hanging="360"/></w:pPr>${rPr}</w:lvl>`;
      })
      .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${levels(true)}</w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${levels(false)}</w:abstractNum>
<w:num w:numId="${LIST_BULLET_NUM_ID}"><w:abstractNumId w:val="0"/></w:num>
<w:num w:numId="${LIST_ORDERED_NUM_ID}"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;
}

function documentXml(bodyXml: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyXml}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>`;

const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

const DOCUMENT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`;

export interface RenderMarkdownToDocxOptions {
  /** Theme (preset name or explicit tokens) driving the document's look. */
  theme?: DocumentThemeInput;
}

/**
 * Renders a Markdown string to a styled .docx and returns the package bytes.
 */
export function renderMarkdownToDocx(
  content: string,
  options: RenderMarkdownToDocxOptions = {},
): Buffer {
  const theme = resolveDocumentTheme(options.theme);
  const tree = parseMarkdown(content);
  const blocks: string[] = [];
  childrenOf(tree).forEach((node) => blocks.push(...blockToXml(node, theme)));
  const bodyXml = blocks.join("") || emptyParagraph();

  const zip = new AdmZip();
  zip.addFile("[Content_Types].xml", Buffer.from(CONTENT_TYPES_XML, "utf8"));
  zip.addFile("_rels/.rels", Buffer.from(ROOT_RELS_XML, "utf8"));
  zip.addFile("word/document.xml", Buffer.from(documentXml(bodyXml), "utf8"));
  zip.addFile("word/styles.xml", Buffer.from(stylesXml(theme), "utf8"));
  zip.addFile("word/numbering.xml", Buffer.from(numberingXml(theme), "utf8"));
  zip.addFile("word/_rels/document.xml.rels", Buffer.from(DOCUMENT_RELS_XML, "utf8"));
  return zip.toBuffer();
}

/* -------------------------------------------------------------------------- */
/* HTML preview (the artifact viewer cannot render .docx directly)             */
/* -------------------------------------------------------------------------- */

function inlineHtml(node: MarkdownNode): string {
  switch (node.type) {
    case "text":
      return htmlEscape(node.value ?? "");
    case "strong":
      return `<strong>${childrenOf(node).map(inlineHtml).join("")}</strong>`;
    case "emphasis":
      return `<em>${childrenOf(node).map(inlineHtml).join("")}</em>`;
    case "delete":
      return `<del>${childrenOf(node).map(inlineHtml).join("")}</del>`;
    case "inlineCode":
    case "inlineMath":
      return `<code>${htmlEscape(node.value ?? "")}</code>`;
    case "break":
      return "<br>";
    case "link": {
      const label = childrenOf(node).map(inlineHtml).join("") || htmlEscape(node.url ?? "");
      return `<a>${label}</a>`;
    }
    case "image":
      return `<em>${htmlEscape(node.alt ? `[Image: ${node.alt}]` : "[Image]")}</em>`;
    default:
      if (typeof node.value === "string") return htmlEscape(node.value);
      return childrenOf(node).map(inlineHtml).join("");
  }
}

function listHtml(node: MarkdownNode): string {
  const tag = node.ordered ? "ol" : "ul";
  const items = childrenOf(node)
    .map((item) => {
      const parts = childrenOf(item)
        .map((child) => {
          if (child.type === "paragraph") return childrenOf(child).map(inlineHtml).join("");
          if (child.type === "list") return listHtml(child);
          return blockHtml(child);
        })
        .join("");
      return `<li>${parts}</li>`;
    })
    .join("");
  return `<${tag}>${items}</${tag}>`;
}

function blockHtml(node: MarkdownNode): string {
  switch (node.type) {
    case "heading": {
      const depth = Math.min(Math.max(node.depth ?? 1, 1), 6);
      return `<h${depth}>${childrenOf(node).map(inlineHtml).join("")}</h${depth}>`;
    }
    case "paragraph":
      return `<p>${childrenOf(node).map(inlineHtml).join("")}</p>`;
    case "list":
      return listHtml(node);
    case "blockquote":
      return `<blockquote>${childrenOf(node).map(blockHtml).join("")}</blockquote>`;
    case "code":
    case "math":
      return `<pre><code>${htmlEscape(node.value ?? "")}</code></pre>`;
    case "table": {
      const rows = childrenOf(node);
      const body = rows
        .map((row, rowIndex) => {
          const cellTag = rowIndex === 0 ? "th" : "td";
          const cells = childrenOf(row)
            .map((cell) => `<${cellTag}>${childrenOf(cell).map(inlineHtml).join("")}</${cellTag}>`)
            .join("");
          return `<tr>${cells}</tr>`;
        })
        .join("");
      return `<table>${body}</table>`;
    }
    case "thematicBreak":
      return "<hr>";
    case "image":
      return `<p><em>${htmlEscape(node.alt ? `[Image: ${node.alt}]` : "[Image]")}</em></p>`;
    case "html":
      return "";
    default:
      return childrenOf(node).map(blockHtml).join("");
  }
}

/** A self-contained, themed HTML preview of the same Markdown, for the viewer. */
export function markdownToDocxPreviewHtml(
  content: string,
  options: RenderMarkdownToDocxOptions = {},
): string {
  const theme = resolveDocumentTheme(options.theme);
  const tree = parseMarkdown(content);
  const body = childrenOf(tree).map(blockHtml).join("");
  const bodyFont = theme.font === "serif" ? 'Georgia,"Times New Roman",serif' : 'Calibri,"Segoe UI",system-ui,sans-serif';
  const headingFont =
    theme.headingFont === "serif" ? 'Georgia,"Times New Roman",serif' : 'Calibri,"Segoe UI",system-ui,sans-serif';
  const h1Rule = theme.headingRule ? `border-bottom:2px solid #${theme.accent};padding-bottom:.25em` : "";
  const h2Rule = theme.headingRule ? "border-bottom:1px solid #eef0f2;padding-bottom:.2em" : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>
:root{color-scheme:light}
body{font:${theme.baseFontSize + 5}px/1.65 ${bodyFont};max-width:52rem;margin:2.5rem auto;padding:0 1.75rem;color:#${theme.bodyColor};background:#ffffff}
h1,h2,h3,h4,h5,h6{color:#${theme.headingColor};font-family:${headingFont};font-weight:700;line-height:1.25;margin:1.6em 0 .5em}
h1{font-size:1.95rem;${h1Rule}}
h2{font-size:1.5rem;${h2Rule}}
h3{font-size:1.25rem}h4{font-size:1.08rem}
p{margin:.55em 0}
ul,ol{margin:.5em 0;padding-left:1.5em}
li{margin:.2em 0}
li::marker{color:#${theme.accent}}
blockquote{margin:.8em 0;padding:.1em 1em;border-left:3px solid #${theme.accent};color:#${theme.mutedColor};font-style:italic}
code{font-family:Consolas,"SFMono-Regular",monospace;background:#${theme.codeBackground};border-radius:4px;padding:.1em .35em;font-size:.9em}
pre{background:#${theme.codeBackground};border:1px solid #e5e7eb;border-radius:6px;padding:.9em 1.1em;overflow-x:auto}
pre code{background:none;padding:0}
a{color:#${theme.accent};text-decoration:underline}
table{border-collapse:collapse;width:100%;margin:1em 0;font-size:.94em}
th,td{border:1px solid #d1d5db;padding:.4em .6em;text-align:left}
th{background:#f3f4f6;color:#${theme.headingColor}}
hr{border:none;border-top:1px solid #d1d5db;margin:1.5em 0}
</style></head><body><article>${body}</article></body></html>`;
}
