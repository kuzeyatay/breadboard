// Styled Markdown -> PDF renderer, shared by the /api/markdown-to-pdf route and
// the Hermes artifact `pdf` renderer so an agent-generated PDF looks the
// same as a "Download as PDF" from a garden page: real headings, bold/italic,
// lists, tables, fenced code, blockquotes, images, and LaTeX math — never raw
// Markdown source (`#`, `**`, `|`) dumped into the page.
//
// The look is NOT fixed: colours, fonts, heading scale, and rules all come from
// a DocumentTheme the caller resolves from the user's wish (see ./theme). A
// "formal report" and a "playful hand-out" render from the same Markdown with
// different palettes and typography.
//
// Fonts: TrueType system fonts are preferred (full Unicode). When none are found
// (a slim Linux container without DejaVu, say) we fall back to PDFKit's built-in
// standard fonts so rendering degrades gracefully instead of throwing.

import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import { unified } from "unified";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { mathjax } from "mathjax-full/js/mathjax.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { AllPackages } from "mathjax-full/js/input/tex/AllPackages.js";
import SVGtoPDF from "svg-to-pdfkit";
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
  lang?: string;
  align?: Array<string | null>;
};

type PdfFonts = {
  body: string;
  bold: string;
  italic: string;
  code: string;
  headingBold: string;
};

type FontStylePaths = { body: string | null; bold: string | null; italic: string | null };

/* -------------------------------------------------------------------------- */
/* Font resolution (per family, TrueType-first, standard-font fallback)        */
/* -------------------------------------------------------------------------- */

const SANS_CANDIDATES = {
  body: [
    process.env.MARKDOWN_PDF_FONT_REGULAR,
    "C:\\Windows\\Fonts\\arial.ttf",
    "C:\\Windows\\Fonts\\segoeui.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
  ],
  bold: [
    process.env.MARKDOWN_PDF_FONT_BOLD,
    "C:\\Windows\\Fonts\\arialbd.ttf",
    "C:\\Windows\\Fonts\\segoeuib.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
  ],
  italic: [
    process.env.MARKDOWN_PDF_FONT_ITALIC,
    "C:\\Windows\\Fonts\\ariali.ttf",
    "C:\\Windows\\Fonts\\segoeuii.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf",
    "/System/Library/Fonts/Supplemental/Arial Italic.ttf",
  ],
};

const SERIF_CANDIDATES = {
  body: [
    process.env.MARKDOWN_PDF_FONT_SERIF_REGULAR,
    "C:\\Windows\\Fonts\\georgia.ttf",
    "C:\\Windows\\Fonts\\times.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
    "/System/Library/Fonts/Supplemental/Georgia.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf",
  ],
  bold: [
    process.env.MARKDOWN_PDF_FONT_SERIF_BOLD,
    "C:\\Windows\\Fonts\\georgiab.ttf",
    "C:\\Windows\\Fonts\\timesbd.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
    "/System/Library/Fonts/Supplemental/Georgia Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf",
  ],
  italic: [
    process.env.MARKDOWN_PDF_FONT_SERIF_ITALIC,
    "C:\\Windows\\Fonts\\georgiai.ttf",
    "C:\\Windows\\Fonts\\timesi.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Italic.ttf",
    "/System/Library/Fonts/Supplemental/Georgia Italic.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSerif-Italic.ttf",
  ],
};

const MONO_CANDIDATES = [
  process.env.MARKDOWN_PDF_FONT_CODE,
  "C:\\Windows\\Fonts\\consola.ttf",
  "C:\\Windows\\Fonts\\cour.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
  "/System/Library/Fonts/Menlo.ttc",
];

// PDFKit built-in AFM standard fonts, used when no TrueType file resolves.
function standardFonts(family: ThemeFontFamily, headingFamily: ThemeFontFamily): PdfFonts {
  const pick = (fam: ThemeFontFamily) =>
    fam === "serif"
      ? { body: "Times-Roman", bold: "Times-Bold", italic: "Times-Italic" }
      : { body: "Helvetica", bold: "Helvetica-Bold", italic: "Helvetica-Oblique" };
  const body = pick(family);
  const heading = pick(headingFamily);
  return { ...body, code: "Courier", headingBold: heading.bold };
}

function firstExistingPath(candidates: Array<string | undefined>): string | null {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function resolveStylePaths(family: ThemeFontFamily): FontStylePaths {
  const set = family === "serif" ? SERIF_CANDIDATES : SANS_CANDIDATES;
  return {
    body: firstExistingPath(set.body),
    bold: firstExistingPath(set.bold),
    italic: firstExistingPath(set.italic),
  };
}

// Registers the resolved fonts for the theme's families and returns the logical
// names the renderer uses. Falls back to standard fonts when no TTF is found.
function registerFonts(doc: PDFKit.PDFDocument, theme: DocumentTheme): PdfFonts {
  const bodyPaths = resolveStylePaths(theme.font);
  const headingPaths =
    theme.headingFont === theme.font ? bodyPaths : resolveStylePaths(theme.headingFont);
  const codePath = firstExistingPath(MONO_CANDIDATES);

  if (!bodyPaths.body) {
    return standardFonts(theme.font, theme.headingFont);
  }

  doc.registerFont("body", bodyPaths.body);
  if (bodyPaths.bold) doc.registerFont("bold", bodyPaths.bold);
  if (bodyPaths.italic) doc.registerFont("italic", bodyPaths.italic);
  if (codePath) doc.registerFont("code", codePath);
  const headingBoldPath = headingPaths.bold ?? bodyPaths.bold;
  if (headingBoldPath) doc.registerFont("headingBold", headingBoldPath);

  return {
    body: "body",
    bold: bodyPaths.bold ? "bold" : "body",
    italic: bodyPaths.italic ? "italic" : "body",
    code: codePath ? "code" : "body",
    headingBold: headingBoldPath ? "headingBold" : bodyPaths.bold ? "bold" : "body",
  };
}

/* -------------------------------------------------------------------------- */
/* Render context (fonts + resolved theme tokens)                              */
/* -------------------------------------------------------------------------- */

interface RenderCtx {
  fonts: PdfFonts;
  theme: DocumentTheme;
  bodyStyle: InlineStyle;
  headingSizes: number[]; // index 1..6 -> point size
}

function hex(value: string): string {
  return value.startsWith("#") ? value : `#${value}`;
}

/* -------------------------------------------------------------------------- */
/* Math rendering (LaTeX -> SVG -> PDF vector)                                 */
/* -------------------------------------------------------------------------- */

// MathJax reports dimensions in `ex` units. This scales an `ex` to PDF points
// relative to the surrounding font size so a rendered formula's x-height tracks
// the body text x-height (≈0.52 of the em for the bundled sans fonts).
const MATH_EX_RATIO = 0.52;
// Surrounding font size used to scale display ($$...$$) equations.
const BLOCK_MATH_SIZE = 10.5;

type MathRenderer = {
  convert: (tex: string, options: { display: boolean }) => unknown;
  innerHTML: (node: unknown) => string;
};

let mathRenderer: MathRenderer | null = null;
const mathSvgCache = new Map<string, string>();

function getMathRenderer(): MathRenderer {
  if (!mathRenderer) {
    const adaptor = liteAdaptor();
    RegisterHTMLHandler(adaptor);
    const mathDocument = mathjax.document("", {
      InputJax: new TeX({ packages: AllPackages }),
      OutputJax: new SVG({ fontCache: "local" }),
    });
    mathRenderer = {
      convert: (tex, options) => mathDocument.convert(tex, options),
      innerHTML: (node) =>
        adaptor.innerHTML(node as Parameters<typeof adaptor.innerHTML>[0]),
    };
  }
  return mathRenderer;
}

function mathToSvg(latex: string, display: boolean): string {
  const key = (display ? "D|" : "I|") + latex;
  const cached = mathSvgCache.get(key);
  if (cached !== undefined) return cached;
  const renderer = getMathRenderer();
  const svg = renderer.innerHTML(renderer.convert(latex, { display }));
  mathSvgCache.set(key, svg);
  return svg;
}

// Pull `ex`-based dimensions out of the MathJax SVG markup. `depth` is how far
// the formula extends below the text baseline (from `vertical-align`).
function svgDimensions(
  svg: string,
): { width: number; height: number; depth: number } | null {
  const width = svg.match(/width="([\d.]+)ex"/);
  const height = svg.match(/height="([\d.]+)ex"/);
  if (!width || !height) return null;
  const verticalAlign = svg.match(/vertical-align:\s*(-?[\d.]+)ex/);
  const va = verticalAlign ? parseFloat(verticalAlign[1]) : 0;
  return {
    width: parseFloat(width[1]),
    height: parseFloat(height[1]),
    depth: va < 0 ? -va : 0,
  };
}

type MathRun = {
  kind: "math";
  svg: string;
  latex: string;
  width: number;
  height: number;
  depth: number;
};

// Renders a LaTeX string to a sized vector run, or null if MathJax/the SVG
// could not be produced (callers fall back to the raw `$...$` source).
function renderMathRun(latex: string, display: boolean, size: number): MathRun | null {
  const source = latex.trim();
  if (!source) return null;
  try {
    const svg = mathToSvg(source, display);
    const dims = svgDimensions(svg);
    if (!dims) return null;
    const exToPt = size * MATH_EX_RATIO;
    return {
      kind: "math",
      svg,
      latex: source,
      width: dims.width * exToPt,
      height: dims.height * exToPt,
      depth: dims.depth * exToPt,
    };
  } catch {
    return null;
  }
}

function drawMathSvg(
  doc: PDFKit.PDFDocument,
  fonts: PdfFonts,
  svg: string,
  latex: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fallbackSize: number,
): void {
  doc.save();
  try {
    SVGtoPDF(doc, svg, x, y, { width, height, assumePt: false });
  } catch {
    doc
      .font(fonts.code)
      .fontSize(fallbackSize)
      .fillColor("#b91c1c")
      .text(`$${latex}$`, x, y, { lineBreak: false });
  }
  doc.restore();
}

function fontMetrics(
  doc: PDFKit.PDFDocument,
  fontName: string,
  size: number,
): { ascent: number; descent: number } {
  doc.font(fontName).fontSize(size);
  const font = (doc as unknown as {
    _font: { ascender: number; descender: number };
  })._font;
  return {
    ascent: (font.ascender / 1000) * size,
    descent: (Math.abs(font.descender) / 1000) * size,
  };
}

/** Splits leading YAML frontmatter off a Markdown string and pulls its `title`. */
export function parseFrontmatter(content: string): { body: string; title: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { body: content, title: "" };

  const titleLine = (match[1] ?? "")
    .split(/\r?\n/)
    .find((line) => line.trimStart().startsWith("title:"));
  const title = titleLine
    ? titleLine
        .slice(titleLine.indexOf(":") + 1)
        .trim()
        .replace(/^["']|["']$/g, "")
    : "";

  return {
    body: content.slice(match[0].length).replace(/^\r?\n/, ""),
    title,
  };
}

function contentWidth(doc: PDFKit.PDFDocument, indent = 0): number {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right - indent;
}

function left(doc: PDFKit.PDFDocument, indent = 0): number {
  return doc.page.margins.left + indent;
}

function ensureSpace(doc: PDFKit.PDFDocument, height = 44): void {
  if (doc.y + height > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
  }
}

function childrenOf(node: MarkdownNode): MarkdownNode[] {
  return Array.isArray(node.children) ? node.children : [];
}

function inlineText(node: MarkdownNode): string {
  if (typeof node.value === "string") return node.value;

  if (node.type === "break") return "\n";
  if (node.type === "inlineCode") return `\`${node.value ?? ""}\``;
  if (node.type === "inlineMath") return `$${node.value ?? ""}$`;
  if (node.type === "link") {
    const label =
      childrenOf(node).map(inlineText).join("").trim() || node.url || "";
    return node.url && node.url !== label ? `${label} (${node.url})` : label;
  }
  if (node.type === "image") {
    return node.alt ? `[Image: ${node.alt}]` : "[Image]";
  }

  return childrenOf(node).map(inlineText).join("");
}

/* -------------------------------------------------------------------------- */
/* Inline layout (text + inline math on the same line)                         */
/* -------------------------------------------------------------------------- */

type InlineStyle = { font: keyof PdfFonts; size: number; color: string };
type InlineRun =
  | ({ kind: "text"; text: string } & InlineStyle)
  | MathRun
  | { kind: "break" };

// Neutral defaults for zero-width markers / blank-line metrics only. Real text
// uses the theme-derived ctx.bodyStyle.
const MARKER_SIZE = 10.5;

// Flattens a markdown inline subtree into styled runs, turning inline math into
// vector runs so it can flow alongside text. `accent` colours links.
function buildInline(
  node: MarkdownNode,
  style: InlineStyle,
  out: InlineRun[],
  accent: string,
): void {
  switch (node.type) {
    case "text":
      out.push({ kind: "text", text: node.value ?? "", ...style });
      break;
    case "strong":
      childrenOf(node).forEach((child) =>
        buildInline(child, { ...style, font: "bold" }, out, accent),
      );
      break;
    case "emphasis":
      childrenOf(node).forEach((child) =>
        buildInline(child, { ...style, font: "italic" }, out, accent),
      );
      break;
    case "delete":
      childrenOf(node).forEach((child) => buildInline(child, style, out, accent));
      break;
    case "inlineCode":
      out.push({
        kind: "text",
        text: node.value ?? "",
        font: "code",
        size: style.size,
        color: style.color,
      });
      break;
    case "break":
      out.push({ kind: "break" });
      break;
    case "inlineMath": {
      const math = renderMathRun(node.value ?? "", false, style.size);
      if (math) out.push(math);
      else out.push({ kind: "text", text: `$${node.value ?? ""}$`, ...style });
      break;
    }
    case "link": {
      const linkStyle: InlineStyle = { ...style, color: accent };
      childrenOf(node).forEach((child) => buildInline(child, linkStyle, out, accent));
      const label = childrenOf(node).map(inlineText).join("").trim();
      if (node.url && node.url !== label) {
        out.push({
          kind: "text",
          text: ` (${node.url})`,
          font: style.font,
          size: style.size,
          color: "#6b7280",
        });
      }
      break;
    }
    case "image":
      out.push({
        kind: "text",
        text: node.alt ? `[Image: ${node.alt}]` : "[Image]",
        font: "italic",
        size: style.size,
        color: "#4b5563",
      });
      break;
    default:
      if (typeof node.value === "string") {
        out.push({ kind: "text", text: node.value, ...style });
      } else {
        childrenOf(node).forEach((child) => buildInline(child, style, out, accent));
      }
  }
}

function buildInlineChildren(
  node: MarkdownNode,
  style: InlineStyle,
  out: InlineRun[],
  accent: string,
): void {
  childrenOf(node).forEach((child) => buildInline(child, style, out, accent));
}

type LineAtom =
  | {
      type: "word";
      text: string;
      font: keyof PdfFonts;
      size: number;
      color: string;
      width: number;
      ascent: number;
      descent: number;
      spaceAfter: number;
    }
  | {
      type: "math";
      svg: string;
      latex: string;
      size: number;
      width: number;
      ascent: number;
      descent: number;
      spaceAfter: number;
    };

// Greedy line-breaking renderer that places styled words and inline math on the
// same baseline, wrapping at the content width and paging when needed.
function renderInline(
  doc: PDFKit.PDFDocument,
  runs: InlineRun[],
  fonts: PdfFonts,
  options: { indent?: number; lineGap?: number } = {},
): void {
  const indent = options.indent ?? 0;
  const startX = left(doc, indent);
  const maxWidth = contentWidth(doc, indent);
  const lineGap = options.lineGap ?? 3;

  const metricsCache = new Map<string, { ascent: number; descent: number }>();
  const metricsFor = (font: keyof PdfFonts, size: number) => {
    const key = `${font}:${size}`;
    let cached = metricsCache.get(key);
    if (!cached) {
      cached = fontMetrics(doc, fonts[font], size);
      metricsCache.set(key, cached);
    }
    return cached;
  };

  const atoms: LineAtom[] = [];
  const attachSpace = (width: number) => {
    const prev = atoms[atoms.length - 1];
    if (prev && prev.spaceAfter === 0) prev.spaceAfter = width;
  };

  for (const run of runs) {
    if (run.kind === "break") {
      // Zero-width marker: the layout loop treats it as a forced line break.
      atoms.push({
        type: "word",
        text: "",
        font: "body",
        size: MARKER_SIZE,
        color: "#111827",
        width: 0,
        ascent: 0,
        descent: 0,
        spaceAfter: 0,
      });
      continue;
    }
    if (run.kind === "math") {
      atoms.push({
        type: "math",
        svg: run.svg,
        latex: run.latex,
        size: BLOCK_MATH_SIZE,
        width: run.width,
        ascent: run.height - run.depth,
        descent: run.depth,
        spaceAfter: 0,
      });
      continue;
    }

    doc.font(fonts[run.font]).fontSize(run.size);
    const spaceWidth = doc.widthOfString(" ");
    const metrics = metricsFor(run.font, run.size);
    const segments = run.text.split(/(\s+)/);
    for (const segment of segments) {
      if (!segment) continue;
      if (/^\s+$/.test(segment)) {
        attachSpace(spaceWidth);
        continue;
      }
      atoms.push({
        type: "word",
        text: segment,
        font: run.font,
        size: run.size,
        color: run.color,
        width: doc.widthOfString(segment),
        ascent: metrics.ascent,
        descent: metrics.descent,
        spaceAfter: 0,
      });
    }
  }
  let line: LineAtom[] = [];
  let lineWidth = 0;

  const flushLine = () => {
    const visible = line.filter((atom) => atom.width > 0 || atom.type === "math");
    let maxAscent = 0;
    let maxDescent = 0;
    line.forEach((atom) => {
      maxAscent = Math.max(maxAscent, atom.ascent);
      maxDescent = Math.max(maxDescent, atom.descent);
    });
    if (maxAscent === 0) maxAscent = metricsFor("body", MARKER_SIZE).ascent;

    if (doc.y + maxAscent + maxDescent > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
    }
    const baselineY = doc.y + maxAscent;
    let x = startX;
    if (visible.length > 0) {
      for (let index = 0; index < line.length; index += 1) {
        const atom = line[index];
        if (atom.type === "word") {
          if (atom.text) {
            doc
              .font(fonts[atom.font])
              .fontSize(atom.size)
              .fillColor(atom.color)
              .text(atom.text, x, baselineY - atom.ascent, { lineBreak: false });
          }
        } else {
          drawMathSvg(
            doc,
            fonts,
            atom.svg,
            atom.latex,
            x,
            baselineY - atom.ascent,
            atom.width,
            atom.ascent + atom.descent,
            atom.size,
          );
        }
        x += atom.width + atom.spaceAfter;
      }
    }
    doc.x = startX;
    doc.y = baselineY + maxDescent + lineGap;
    line = [];
    lineWidth = 0;
  };

  for (const atom of atoms) {
    const isBreakMarker = atom.type === "word" && atom.text === "" && atom.width === 0;
    if (isBreakMarker) {
      flushLine();
      continue;
    }
    if (line.length > 0 && lineWidth + atom.width > maxWidth) {
      flushLine();
    }
    line.push(atom);
    lineWidth += atom.width + atom.spaceAfter;
  }
  flushLine();
}

function drawText(
  doc: PDFKit.PDFDocument,
  text: string,
  fonts: PdfFonts,
  options: {
    indent?: number;
    font?: keyof PdfFonts;
    size?: number;
    color?: string;
    lineGap?: number;
  } = {},
): void {
  const cleanText = text.replace(/\n{3,}/g, "\n\n").trim();
  if (!cleanText) return;

  const indent = options.indent ?? 0;
  doc
    .font(fonts[options.font ?? "body"])
    .fontSize(options.size ?? 10.5)
    .fillColor(options.color ?? "#111827");
  doc.text(cleanText, left(doc, indent), doc.y, {
    width: contentWidth(doc, indent),
    lineGap: options.lineGap ?? 3,
  });
}

function resolveImagePath(url: string | undefined, clusterSlug: string): string | null {
  if (!url) return null;
  const contentPath = process.env.QUARTZ_CONTENT_PATH;
  if (!contentPath) return null;

  const root = path.resolve(contentPath);
  const cleanUrl = decodeURIComponent(
    url
      .trim()
      .replace(/[?#].*$/, "")
      .replace(/\\/g, "/"),
  );
  const parts = cleanUrl.split("/").filter(Boolean);

  let imagePath: string | null = null;
  if (parts.length >= 3 && parts[1] === "assets") {
    // A PDF job is scoped to one authenticated Garden. An absolute Markdown
    // asset URL must name that same Garden; an empty Garden scope has no
    // authority to read any Garden asset directory.
    if (!clusterSlug || parts[0] !== clusterSlug) return null;
    imagePath = path.resolve(root, parts[0], "assets", ...parts.slice(2));
  } else if (parts.length >= 2 && parts[0] === "assets" && clusterSlug) {
    imagePath = path.resolve(root, clusterSlug, "assets", ...parts.slice(1));
  }

  if (!imagePath || !imagePath.startsWith(root + path.sep)) return null;
  if (!/\.(png|jpe?g)$/i.test(imagePath)) return null;
  return fs.existsSync(imagePath) ? imagePath : null;
}

const ANNOTATION_RE = /^\[([A-Za-z][A-Za-z]*):\s*([\s\S]+?)\]$/;

function renderAnnotation(
  doc: PDFKit.PDFDocument,
  ctx: RenderCtx,
  tag: string,
  description: string,
  indent: number,
): void {
  ensureSpace(doc, 44);
  const barX = left(doc, indent);
  const textX = barX + 8;
  const textWidth = contentWidth(doc, indent) - 8;
  const startY = doc.y;

  doc
    .font(ctx.fonts.bold)
    .fontSize(7.5)
    .fillColor(hex(ctx.theme.mutedColor))
    .text(tag.toUpperCase(), textX, doc.y, { width: textWidth, lineGap: 1 });

  doc
    .font(ctx.fonts.italic)
    .fontSize(9.5)
    .fillColor("#374151")
    .text(description.trim(), textX, doc.y, {
      width: textWidth,
      lineGap: 3,
    });

  const endY = doc.y;
  doc
    .save()
    .rect(barX, startY, 2.5, endY - startY)
    .fillColor(hex(ctx.theme.accent))
    .fill()
    .restore();

  doc.moveDown(0.55);
}

function renderImage(
  doc: PDFKit.PDFDocument,
  ctx: RenderCtx,
  node: MarkdownNode,
  clusterSlug: string,
  indent: number,
): void {
  const imagePath = resolveImagePath(node.url, clusterSlug);
  const caption = node.alt || node.url || "Image";
  const drawPlaceholder = () => {
    drawText(doc, `[Image: ${caption}]`, ctx.fonts, {
      indent,
      font: "italic",
      size: 9.5,
      color: "#4b5563",
    });
    doc.moveDown(0.45);
  };

  if (!imagePath) {
    drawPlaceholder();
    return;
  }

  try {
    // Open once to read the natural size, then draw it inline within the text
    // flow. PDFKit's doc.image() does NOT advance doc.y, so we must scale to fit
    // and move the cursor ourselves — otherwise following content overlaps it.
    const image = (
      doc as unknown as {
        openImage: (src: string) => { width: number; height: number };
      }
    ).openImage(imagePath);
    const maxWidth = contentWidth(doc, indent);
    const maxHeight = doc.page.height - doc.page.margins.top - doc.page.margins.bottom;
    let width = image.width;
    let height = image.height;
    if (width > maxWidth) {
      const scale = maxWidth / width;
      width *= scale;
      height *= scale;
    }
    if (height > maxHeight) {
      const scale = maxHeight / height;
      width *= scale;
      height *= scale;
    }

    if (doc.y + height > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
    }
    const x = left(doc, indent) + Math.max(0, (maxWidth - width) / 2);
    doc.image(imagePath, x, doc.y, { width, height });
    doc.x = left(doc, indent);
    doc.y += height + 8;
  } catch {
    drawPlaceholder();
  }
}

function renderList(
  doc: PDFKit.PDFDocument,
  ctx: RenderCtx,
  node: MarkdownNode,
  clusterSlug: string,
  indent: number,
): void {
  const start = typeof node.start === "number" ? node.start : 1;
  const itemStyle: InlineStyle = {
    font: "body",
    size: ctx.bodyStyle.size,
    color: ctx.bodyStyle.color,
  };
  const markerStyle: InlineStyle = {
    font: "bold",
    size: ctx.bodyStyle.size,
    color: hex(ctx.theme.accent),
  };

  childrenOf(node).forEach((item, index) => {
    const marker = node.ordered ? `${start + index}.` : "•";
    const children = childrenOf(item);
    const firstParagraphIndex = children.findIndex(
      (child) => child.type === "paragraph",
    );
    const firstParagraph =
      firstParagraphIndex >= 0 ? children[firstParagraphIndex] : null;

    ensureSpace(doc, 28);
    const runs: InlineRun[] = [{ kind: "text", text: `${marker} `, ...markerStyle }];
    if (firstParagraph) buildInlineChildren(firstParagraph, itemStyle, runs, hex(ctx.theme.accent));
    else buildInline(item, itemStyle, runs, hex(ctx.theme.accent));
    renderInline(doc, runs, ctx.fonts, { indent });

    children.forEach((child, childIndex) => {
      if (childIndex !== firstParagraphIndex) {
        renderNode(doc, child, ctx, clusterSlug, indent + 18);
      }
    });
  });

  doc.moveDown(0.35);
}

function renderTable(
  doc: PDFKit.PDFDocument,
  ctx: RenderCtx,
  node: MarkdownNode,
  indent: number,
): void {
  const rows = childrenOf(node).map((row) =>
    childrenOf(row).map((cell) => inlineText(cell).replace(/\s+/g, " ").trim()),
  );
  if (rows.length === 0) return;

  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  if (columnCount === 0) return;

  const align = Array.isArray(node.align) ? node.align : [];
  const cellAlign = (col: number): "left" | "center" | "right" => {
    const value = align[col];
    if (value === "right") return "right";
    if (value === "center") return "center";
    return "left";
  };

  const tableWidth = contentWidth(doc, indent);
  const columnWidth = tableWidth / columnCount;
  const padX = 5;
  const padY = 4;
  const fontSize = 9;
  const x0 = left(doc, indent);
  const cellTextWidth = columnWidth - padX * 2;
  const pageBottom = () => doc.page.height - doc.page.margins.bottom;

  const measureRowHeight = (cells: string[], fontKey: keyof PdfFonts): number => {
    doc.font(ctx.fonts[fontKey]).fontSize(fontSize);
    let max = 0;
    for (let col = 0; col < columnCount; col += 1) {
      const text = cells[col] || " ";
      const height = doc.heightOfString(text, {
        width: cellTextWidth,
        lineGap: 1,
      });
      if (height > max) max = height;
    }
    return max + padY * 2;
  };

  rows.forEach((cells, rowIndex) => {
    const isHeader = rowIndex === 0;
    const fontKey: keyof PdfFonts = isHeader ? "bold" : "body";
    const rowHeight = measureRowHeight(cells, fontKey);

    if (doc.y + rowHeight > pageBottom()) doc.addPage();
    const y = doc.y;

    if (isHeader) {
      doc.save().rect(x0, y, tableWidth, rowHeight).fill("#f3f4f6").restore();
    }

    doc
      .font(ctx.fonts[fontKey])
      .fontSize(fontSize)
      .fillColor(isHeader ? hex(ctx.theme.headingColor) : "#374151");
    for (let col = 0; col < columnCount; col += 1) {
      const text = cells[col] ?? "";
      if (!text) continue;
      doc.text(text, x0 + col * columnWidth + padX, y + padY, {
        width: cellTextWidth,
        align: cellAlign(col),
        lineGap: 1,
      });
    }

    doc.save().lineWidth(0.5).strokeColor("#d1d5db");
    doc.rect(x0, y, tableWidth, rowHeight).stroke();
    for (let col = 1; col < columnCount; col += 1) {
      doc
        .moveTo(x0 + col * columnWidth, y)
        .lineTo(x0 + col * columnWidth, y + rowHeight)
        .stroke();
    }
    doc.restore();

    doc.x = x0;
    doc.y = y + rowHeight;
  });

  doc.moveDown(0.6);
}

function renderCode(
  doc: PDFKit.PDFDocument,
  ctx: RenderCtx,
  node: MarkdownNode,
  indent: number,
): void {
  const code = (node.value ?? "").replace(/\t/g, "  ").trimEnd();
  if (!code) return;

  ensureSpace(doc, 54);
  const x0 = left(doc, indent);
  const width = contentWidth(doc, indent);
  const startY = doc.y;
  const height = doc.font(ctx.fonts.code).fontSize(8.5).heightOfString(code, {
    width: width - 16,
    lineGap: 2,
  });

  // Soft card behind the code so it reads as a block, matching a chat code cell.
  doc
    .save()
    .roundedRect(x0, startY, width, height + 14, 5)
    .fill(hex(ctx.theme.codeBackground))
    .restore();
  doc
    .font(ctx.fonts.code)
    .fontSize(8.5)
    .fillColor(hex(ctx.theme.bodyColor))
    .text(code, x0 + 8, startY + 7, {
      width: width - 16,
      lineGap: 2,
    });
  doc.x = x0;
  doc.y = startY + height + 14;
  doc.moveDown(0.6);
}

// Renders a display ($$...$$) equation centered on its own line, scaling down
// to fit the content width. Falls back to the raw LaTeX as a code block.
function renderBlockMath(
  doc: PDFKit.PDFDocument,
  ctx: RenderCtx,
  latex: string,
  indent: number,
): void {
  const math = renderMathRun(latex, true, BLOCK_MATH_SIZE);
  if (!math) {
    renderCode(doc, ctx, { type: "math", value: latex }, indent);
    return;
  }

  let { width, height } = math;
  const maxWidth = contentWidth(doc, indent);
  if (width > maxWidth) {
    const scale = maxWidth / width;
    width *= scale;
    height *= scale;
  }

  ensureSpace(doc, height + 18);
  const x = left(doc, indent) + Math.max(0, (maxWidth - width) / 2);
  const y = doc.y + 6;
  drawMathSvg(doc, ctx.fonts, math.svg, math.latex, x, y, width, height, BLOCK_MATH_SIZE);
  doc.x = left(doc, indent);
  doc.y = y + height + 8;
}

function renderNode(
  doc: PDFKit.PDFDocument,
  node: MarkdownNode,
  ctx: RenderCtx,
  clusterSlug: string,
  indent = 0,
): void {
  const accent = hex(ctx.theme.accent);
  switch (node.type) {
    case "root":
      childrenOf(node).forEach((child) => renderNode(doc, child, ctx, clusterSlug, indent));
      break;
    case "heading": {
      const depth = Math.min(Math.max(node.depth ?? 2, 1), 6);
      ensureSpace(doc, depth <= 2 ? 58 : 38);
      if (doc.y > doc.page.margins.top + 4) doc.moveDown(depth <= 2 ? 0.8 : 0.45);
      const runs: InlineRun[] = [];
      buildInlineChildren(
        node,
        { font: "headingBold", size: ctx.headingSizes[depth], color: hex(ctx.theme.headingColor) },
        runs,
        accent,
      );
      renderInline(doc, runs, ctx.fonts, { indent, lineGap: 2 });
      // A thin accent rule under H1/H2 gives the page the sectioned feel of a
      // real document — omitted for themes that ask for no rule.
      if (depth <= 2 && ctx.theme.headingRule) {
        const ruleY = doc.y + 2;
        doc
          .save()
          .strokeColor(depth === 1 ? accent : "#e5e7eb")
          .lineWidth(depth === 1 ? 1 : 0.75)
          .moveTo(left(doc, indent), ruleY)
          .lineTo(left(doc, indent) + contentWidth(doc, indent), ruleY)
          .stroke()
          .restore();
        doc.y = ruleY + 2;
      }
      doc.moveDown(depth <= 2 ? 0.45 : 0.25);
      break;
    }
    case "paragraph": {
      const children = childrenOf(node);
      const hasImage = children.some((c) => c.type === "image");
      if (hasImage) {
        let buffer: MarkdownNode[] = [];
        const flushBuffer = () => {
          if (buffer.length) {
            const runs: InlineRun[] = [];
            buffer.forEach((child) => buildInline(child, ctx.bodyStyle, runs, accent));
            if (runs.length) {
              renderInline(doc, runs, ctx.fonts, { indent });
              doc.moveDown(0.3);
            }
            buffer = [];
          }
        };
        for (const child of children) {
          if (child.type === "image") {
            flushBuffer();
            renderImage(doc, ctx, child, clusterSlug, indent);
          } else {
            buffer.push(child);
          }
        }
        flushBuffer();
      } else {
        const annotMatch = inlineText(node).match(ANNOTATION_RE);
        if (annotMatch) {
          renderAnnotation(doc, ctx, annotMatch[1], annotMatch[2], indent);
        } else {
          const runs: InlineRun[] = [];
          buildInlineChildren(node, ctx.bodyStyle, runs, accent);
          renderInline(doc, runs, ctx.fonts, { indent });
          doc.moveDown(0.55);
        }
      }
      break;
    }
    case "list":
      renderList(doc, ctx, node, clusterSlug, indent);
      break;
    case "blockquote": {
      const quoteIndent = indent + 14;
      const quoteStyle: InlineStyle = {
        font: "italic",
        size: ctx.bodyStyle.size,
        color: "#4b5563",
      };
      const startY = doc.y;
      childrenOf(node).forEach((child) => {
        if (child.type === "paragraph") {
          const runs: InlineRun[] = [];
          buildInlineChildren(child, quoteStyle, runs, accent);
          renderInline(doc, runs, ctx.fonts, { indent: quoteIndent });
          doc.moveDown(0.3);
        } else {
          renderNode(doc, child, ctx, clusterSlug, quoteIndent);
        }
      });
      doc
        .save()
        .rect(left(doc, indent), startY, 3, Math.max(0, doc.y - startY))
        .fill(hex(ctx.theme.accent))
        .restore();
      doc.moveDown(0.6);
      break;
    }
    case "code":
      renderCode(doc, ctx, node, indent);
      break;
    case "math":
      renderBlockMath(doc, ctx, node.value ?? "", indent);
      break;
    case "image":
      renderImage(doc, ctx, node, clusterSlug, indent);
      break;
    case "table":
      renderTable(doc, ctx, node, indent);
      break;
    case "thematicBreak":
      ensureSpace(doc, 24);
      doc
        .strokeColor("#d1d5db")
        .lineWidth(1)
        .moveTo(left(doc, indent), doc.y + 4)
        .lineTo(left(doc, indent) + contentWidth(doc, indent), doc.y + 4)
        .stroke();
      doc.moveDown(1.1);
      break;
    case "html":
      drawText(doc, node.value ?? "", ctx.fonts, {
        indent,
        font: "italic",
        color: "#4b5563",
      });
      doc.moveDown(0.45);
      break;
    default:
      childrenOf(node).forEach((child) => renderNode(doc, child, ctx, clusterSlug, indent));
  }
}

export type PdfMarkdownDocument = {
  content: string;
  title: string;
};

export interface RenderMarkdownToPdfOptions {
  /** PDF metadata title (defaults to the first document's title). */
  title?: string;
  /** Garden slug used to resolve relative image assets, when available. */
  clusterSlug?: string;
  /** Theme (preset name or explicit tokens) driving the document's look. */
  theme?: DocumentThemeInput;
}

/**
 * Renders one or more Markdown documents into a single styled PDF and resolves
 * to the PDF bytes. Each document after the first starts on a new page. The
 * visual style comes from the resolved theme, not a fixed template.
 */
export async function renderMarkdownToPdf(
  documents: PdfMarkdownDocument[],
  options: RenderMarkdownToPdfOptions = {},
): Promise<Buffer> {
  if (documents.length === 0) {
    throw new Error("renderMarkdownToPdf requires at least one document");
  }
  const title = options.title?.trim() || documents[0].title || "Document";
  const clusterSlug = options.clusterSlug?.trim() ?? "";
  const theme = resolveDocumentTheme(options.theme);

  const doc = new PDFDocument({
    size: "A4",
    margin: theme.pageMargin,
    bufferPages: true,
    info: {
      Title: title,
      Creator: "breadboard",
    },
  });
  const fonts = registerFonts(doc, theme);
  doc.font(fonts.body);
  const ctx: RenderCtx = {
    fonts,
    theme,
    bodyStyle: { font: "body", size: theme.baseFontSize, color: hex(theme.bodyColor) },
    headingSizes: [
      0,
      ...HEADING_FACTORS.map((factor) =>
        Math.round(theme.baseFontSize * factor * theme.headingScale * 10) / 10,
      ),
    ],
  };

  const chunks: Buffer[] = [];
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  documents.forEach((document, index) => {
    if (index > 0) doc.addPage();
    const tree = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkMath)
      .parse(document.content) as MarkdownNode;
    renderNode(doc, tree, ctx, clusterSlug);
  });

  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    // The footer is drawn below the bottom margin. PDFKit treats writing into
    // the bottom margin as content overflow and appends a blank page, so drop
    // the bottom margin for the duration of the footer draw.
    const savedBottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .font(fonts.body)
      .fontSize(8)
      .fillColor(hex(theme.mutedColor))
      .text(
        `${index + 1} / ${range.count}`,
        doc.page.margins.left,
        doc.page.height - 34,
        {
          width: contentWidth(doc),
          align: "right",
          lineBreak: false,
        },
      );
    doc.page.margins.bottom = savedBottomMargin;
  }

  doc.end();
  return finished;
}
