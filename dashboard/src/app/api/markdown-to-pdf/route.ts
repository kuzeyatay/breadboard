import fs from "fs";
import path from "path";
import { getServerSession } from "next-auth/next";
import PDFDocument from "pdfkit";
import { unified } from "unified";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { authOptions } from "@/lib/auth-options";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
};

type PdfFonts = {
  body: string;
  bold: string;
  italic: string;
  code: string;
};

type PdfFontPaths = {
  body: string | null;
  bold: string | null;
  italic: string | null;
  code: string | null;
};

const FONT_CANDIDATES = {
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
  code: [
    process.env.MARKDOWN_PDF_FONT_CODE,
    "C:\\Windows\\Fonts\\consola.ttf",
    "C:\\Windows\\Fonts\\cour.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    "/System/Library/Fonts/Menlo.ttc",
  ],
};

function firstExistingPath(
  candidates: Array<string | undefined>,
): string | null {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function resolveFontPaths(): PdfFontPaths {
  return {
    body: firstExistingPath(FONT_CANDIDATES.body),
    bold: firstExistingPath(FONT_CANDIDATES.bold),
    italic: firstExistingPath(FONT_CANDIDATES.italic),
    code: firstExistingPath(FONT_CANDIDATES.code),
  };
}

function registerFonts(
  doc: PDFKit.PDFDocument,
  fontPaths: PdfFontPaths,
): PdfFonts {
  if (!fontPaths.body) {
    throw new Error("No usable PDF font found");
  }

  doc.registerFont("body", fontPaths.body);
  if (fontPaths.bold) doc.registerFont("bold", fontPaths.bold);
  if (fontPaths.italic) doc.registerFont("italic", fontPaths.italic);
  if (fontPaths.code) doc.registerFont("code", fontPaths.code);

  return {
    body: "body",
    bold: fontPaths.bold ? "bold" : "body",
    italic: fontPaths.italic ? "italic" : "body",
    code: fontPaths.code ? "code" : "body",
  };
}

function parseFrontmatter(content: string): { body: string; title: string } {
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

function sanitizeFileName(value: string): string {
  const base = value
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${base || "markdown-note"}.pdf`;
}

function contentWidth(doc: PDFKit.PDFDocument, indent = 0): number {
  return (
    doc.page.width - doc.page.margins.left - doc.page.margins.right - indent
  );
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

function resolveImagePath(
  url: string | undefined,
  clusterSlug: string,
): string | null {
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
    imagePath = path.resolve(root, parts[0], "assets", ...parts.slice(2));
  } else if (parts.length >= 2 && parts[0] === "assets" && clusterSlug) {
    imagePath = path.resolve(root, clusterSlug, "assets", ...parts.slice(1));
  }

  if (!imagePath || !imagePath.startsWith(root + path.sep)) return null;
  if (!/\.(png|jpe?g)$/i.test(imagePath)) return null;
  return fs.existsSync(imagePath) ? imagePath : null;
}

function renderImage(
  doc: PDFKit.PDFDocument,
  node: MarkdownNode,
  fonts: PdfFonts,
  clusterSlug: string,
  indent: number,
): void {
  const imagePath = resolveImagePath(node.url, clusterSlug);
  const caption = node.alt || node.url || "Image";
  if (!imagePath) {
    drawText(doc, `[Image: ${caption}]`, fonts, {
      indent,
      font: "italic",
      size: 9.5,
      color: "#4b5563",
    });
    doc.moveDown(0.45);
    return;
  }

  ensureSpace(doc, 180);
  try {
    doc.image(imagePath, left(doc, indent), doc.y, {
      fit: [contentWidth(doc, indent), 320],
      align: "center",
    });
    doc.moveDown(0.35);
    drawText(doc, caption, fonts, {
      indent,
      font: "italic",
      size: 8.5,
      color: "#6b7280",
    });
    doc.moveDown(0.65);
  } catch {
    drawText(doc, `[Image: ${caption}]`, fonts, {
      indent,
      font: "italic",
      size: 9.5,
      color: "#4b5563",
    });
    doc.moveDown(0.45);
  }
}

function renderList(
  doc: PDFKit.PDFDocument,
  node: MarkdownNode,
  fonts: PdfFonts,
  clusterSlug: string,
  indent: number,
): void {
  const start = typeof node.start === "number" ? node.start : 1;

  childrenOf(node).forEach((item, index) => {
    const marker = node.ordered ? `${start + index}.` : "-";
    const children = childrenOf(item);
    const firstParagraphIndex = children.findIndex(
      (child) => child.type === "paragraph",
    );
    const firstParagraph =
      firstParagraphIndex >= 0 ? children[firstParagraphIndex] : null;
    const label = firstParagraph
      ? inlineText(firstParagraph)
      : inlineText(item);

    ensureSpace(doc, 28);
    drawText(doc, `${marker} ${label}`, fonts, { indent, size: 10.2 });

    children.forEach((child, childIndex) => {
      if (childIndex !== firstParagraphIndex) {
        renderNode(doc, child, fonts, clusterSlug, indent + 18);
      }
    });
  });

  doc.moveDown(0.35);
}

function renderTable(
  doc: PDFKit.PDFDocument,
  node: MarkdownNode,
  fonts: PdfFonts,
  indent: number,
): void {
  const rows = childrenOf(node)
    .map((row) =>
      childrenOf(row)
        .map((cell) => inlineText(cell).trim())
        .join(" | "),
    )
    .filter(Boolean);

  if (rows.length === 0) return;
  ensureSpace(doc, 32);
  rows.forEach((row, index) => {
    drawText(doc, row, fonts, {
      indent,
      font: index === 0 ? "bold" : "body",
      size: 9.2,
      color: "#111827",
    });
  });
  doc.moveDown(0.55);
}

function renderCode(
  doc: PDFKit.PDFDocument,
  node: MarkdownNode,
  fonts: PdfFonts,
  indent: number,
): void {
  const code = (node.value ?? "").replace(/\t/g, "  ").trimEnd();
  if (!code) return;

  ensureSpace(doc, 54);
  doc
    .font(fonts.code)
    .fontSize(8.5)
    .fillColor("#111827")
    .text(code, left(doc, indent), doc.y, {
      width: contentWidth(doc, indent),
      lineGap: 2,
    });
  doc.moveDown(0.8);
}

function renderNode(
  doc: PDFKit.PDFDocument,
  node: MarkdownNode,
  fonts: PdfFonts,
  clusterSlug: string,
  indent = 0,
): void {
  switch (node.type) {
    case "root":
      childrenOf(node).forEach((child) =>
        renderNode(doc, child, fonts, clusterSlug, indent),
      );
      break;
    case "heading": {
      const depth = Math.min(Math.max(node.depth ?? 2, 1), 6);
      const sizeByDepth = [0, 21, 17, 14, 12.5, 11.5, 10.8];
      ensureSpace(doc, depth <= 2 ? 58 : 38);
      if (doc.y > doc.page.margins.top + 4)
        doc.moveDown(depth <= 2 ? 0.8 : 0.45);
      drawText(doc, inlineText(node), fonts, {
        indent,
        font: "bold",
        size: sizeByDepth[depth],
        color: "#0f172a",
        lineGap: 2,
      });
      doc.moveDown(depth <= 2 ? 0.45 : 0.25);
      break;
    }
    case "paragraph":
      drawText(doc, inlineText(node), fonts, { indent });
      doc.moveDown(0.55);
      break;
    case "list":
      renderList(doc, node, fonts, clusterSlug, indent);
      break;
    case "blockquote":
      drawText(doc, childrenOf(node).map(inlineText).join("\n"), fonts, {
        indent: indent + 14,
        font: "italic",
        color: "#4b5563",
      });
      doc.moveDown(0.6);
      break;
    case "code":
    case "math":
      renderCode(doc, node, fonts, indent);
      break;
    case "image":
      renderImage(doc, node, fonts, clusterSlug, indent);
      break;
    case "table":
      renderTable(doc, node, fonts, indent);
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
      drawText(doc, node.value ?? "", fonts, {
        indent,
        font: "italic",
        color: "#4b5563",
      });
      doc.moveDown(0.45);
      break;
    default:
      childrenOf(node).forEach((child) =>
        renderNode(doc, child, fonts, clusterSlug, indent),
      );
  }
}

async function markdownToPdf(
  content: string,
  title: string,
  clusterSlug: string,
): Promise<Buffer> {
  const fontPaths = resolveFontPaths();
  if (!fontPaths.body) {
    throw new Error("No usable PDF font found");
  }

  const doc = new PDFDocument({
    size: "A4",
    margin: 54,
    bufferPages: true,
    font: fontPaths.body,
    info: {
      Title: title || "Markdown note",
      Creator: "breadboard",
    },
  });
  const fonts = registerFonts(doc, fontPaths);
  const chunks: Buffer[] = [];
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const tree = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .parse(content) as MarkdownNode;

  renderNode(doc, tree, fonts, clusterSlug);

  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    doc
      .font(fonts.body)
      .fontSize(8)
      .fillColor("#6b7280")
      .text(
        `${index + 1} / ${range.count}`,
        doc.page.margins.left,
        doc.page.height - 34,
        {
          width: contentWidth(doc),
          align: "right",
        },
      );
  }

  doc.end();
  return finished;
}

export async function POST(request: Request): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const rawContent = typeof body.content === "string" ? body.content : "";
  if (!rawContent.trim()) {
    return Response.json({ error: "content is required" }, { status: 400 });
  }

  const { body: markdownBody, title: frontmatterTitle } =
    parseFrontmatter(rawContent);
  const title =
    typeof body.title === "string" && body.title.trim()
      ? body.title.trim()
      : frontmatterTitle || "Markdown note";
  const clusterSlug =
    typeof body.clusterSlug === "string" ? body.clusterSlug.trim() : "";
  const requestedName =
    typeof body.fileName === "string"
      ? body.fileName.replace(/\.md$/i, "")
      : title;
  const fileName = sanitizeFileName(requestedName || title);
  const pdf = await markdownToPdf(markdownBody, title, clusterSlug);
  const responseBody = pdf.buffer.slice(
    pdf.byteOffset,
    pdf.byteOffset + pdf.byteLength,
  ) as ArrayBuffer;

  return new Response(responseBody, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(pdf.byteLength),
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
