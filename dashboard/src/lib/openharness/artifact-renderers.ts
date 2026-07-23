import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import PDFDocument from "pdfkit";
import type { ArtifactKind, ArtifactRendererId } from "./artifact-types.ts";

export interface ArtifactRenderContext {
  directory: string;
  filename: string;
}

export interface ArtifactRenderResult {
  outputPath: string;
  previewPath: string;
  mimeType: string;
}

export interface ArtifactRenderer {
  kind: ArtifactKind;
  id: ArtifactRendererId;
  mimeType: string;
  extension: string;
  validate(content: string): Promise<{ ok: true } | { ok: false; error: string }>;
  render(content: string, context: ArtifactRenderContext): Promise<ArtifactRenderResult>;
}

function atomicWrite(target: string, content: string | Buffer): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, content);
  fs.renameSync(temporary, target);
}

function xml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function html(value: string): string {
  return xml(value).replace(/\n/g, "<br>");
}

const textRenderer = (id: "text" | "markdown", kind: "text" | "markdown"): ArtifactRenderer => ({
  id,
  kind,
  mimeType: kind === "markdown" ? "text/markdown; charset=utf-8" : "text/plain; charset=utf-8",
  extension: kind === "markdown" ? ".md" : ".txt",
  async validate(content) {
    return content.length > 0 ? { ok: true } : { ok: false, error: "Artifact content is empty." };
  },
  async render(content, context) {
    const outputPath = path.join(context.directory, context.filename);
    atomicWrite(outputPath, content);
    return { outputPath, previewPath: outputPath, mimeType: this.mimeType };
  },
});

const docxRenderer: ArtifactRenderer = {
  id: "docx",
  kind: "document",
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  extension: ".docx",
  async validate(content) {
    return content.trim() ? { ok: true } : { ok: false, error: "Document content is empty." };
  },
  async render(content, context) {
    const outputPath = path.join(context.directory, context.filename);
    const zip = new AdmZip();
    const paragraphs = content.split(/\r?\n/).map((line) =>
      `<w:p><w:r><w:t xml:space="preserve">${xml(line || " ")}</w:t></w:r></w:p>`,
    ).join("");
    zip.addFile("[Content_Types].xml", Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    ));
    zip.addFile("_rels/.rels", Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    ));
    zip.addFile("word/document.xml", Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`,
    ));
    zip.addFile("word/_rels/document.xml.rels", Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`,
    ));
    fs.mkdirSync(context.directory, { recursive: true });
    const temporary = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
    zip.writeZip(temporary);
    fs.renameSync(temporary, outputPath);
    const previewPath = path.join(context.directory, "preview.html");
    atomicWrite(previewPath, `<!doctype html><meta charset="utf-8"><style>body{font:16px/1.6 system-ui;max-width:52rem;margin:2rem auto;padding:0 1.5rem;color:#17241e;background:#fbfaf5}p{margin:.45rem 0}</style><article>${content.split(/\r?\n/).map((line) => `<p>${html(line || " ")}</p>`).join("")}</article>`);
    return { outputPath, previewPath, mimeType: this.mimeType };
  },
};

const pdfRenderer: ArtifactRenderer = {
  id: "pdf",
  kind: "pdf",
  mimeType: "application/pdf",
  extension: ".pdf",
  async validate(content) {
    return content.trim() ? { ok: true } : { ok: false, error: "PDF content is empty." };
  },
  async render(content, context) {
    const outputPath = path.join(context.directory, context.filename);
    fs.mkdirSync(context.directory, { recursive: true });
    const temporary = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
    await new Promise<void>((resolve, reject) => {
      const document = new PDFDocument({ size: "A4", margins: { top: 54, right: 54, bottom: 54, left: 54 } });
      const output = fs.createWriteStream(temporary);
      output.once("finish", resolve);
      output.once("error", reject);
      document.once("error", reject);
      document.pipe(output);
      document.font("Helvetica").fontSize(11).fillColor("#17241e").text(content, { lineGap: 4 });
      document.end();
    });
    fs.renameSync(temporary, outputPath);
    return { outputPath, previewPath: outputPath, mimeType: this.mimeType };
  },
};

const htmlRenderer: ArtifactRenderer = {
  id: "html",
  kind: "html",
  mimeType: "text/html; charset=utf-8",
  extension: ".html",
  async validate(content) {
    if (!content.trim()) return { ok: false, error: "HTML content is empty." };
    if (!/<(?:!doctype|html|body|main|section|article|div|p|h1)/i.test(content)) {
      return { ok: false, error: "HTML content must contain a document or visible root element." };
    }
    return { ok: true };
  },
  async render(content, context) {
    const outputPath = path.join(context.directory, context.filename);
    atomicWrite(outputPath, content);
    return { outputPath, previewPath: outputPath, mimeType: this.mimeType };
  },
};

const registry = new Map<ArtifactRendererId, ArtifactRenderer>([
  ["text", textRenderer("text", "text")],
  ["markdown", textRenderer("markdown", "markdown")],
  ["docx", docxRenderer],
  ["pdf", pdfRenderer],
  ["html", htmlRenderer],
]);

export function artifactRenderer(id: string): ArtifactRenderer | null {
  return registry.get(id as ArtifactRendererId) ?? null;
}

export function availableArtifactRenderers(): Array<{ id: ArtifactRendererId; kind: ArtifactKind; mimeType: string }> {
  return [...registry.values()].map(({ id, kind, mimeType }) => ({ id, kind, mimeType }));
}
