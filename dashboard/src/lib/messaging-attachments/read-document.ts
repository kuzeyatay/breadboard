import fs from "node:fs";
import type { DocumentAttachmentFormat } from "../document-attachments.ts";
import { normalizeDocumentSummary } from "../document-attachments.ts";
import { documentContextText, readDocument, readOpenDocument } from "../document-structure/index.ts";
import { writeDocumentFigures } from "../conversations/document-blob-store.ts";

export async function readMessagingDocument(userId: number, blobId: string, format: DocumentAttachmentFormat, filePath: string, name: string) {
  try {
    const bytes = fs.readFileSync(filePath);
    if (format === "pdf") {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: bytes });
      try {
        const result = await parser.getText();
        const text = result.text.trim();
        return { text: text || "This PDF has no readable text layer. Read the attached original with PDF/vision tools, including its scanned pages." };
      } finally { await parser.destroy(); }
    }
    const structure = ["odt", "ods", "odp"].includes(format) ? await readOpenDocument(bytes) : readDocument(format, bytes);
    const summary = normalizeDocumentSummary(structure.summary);
    const figures = writeDocumentFigures({ userId, blobId, figures: structure.figures.map((figure) => ({ extension: figure.extension, bytes: figure.bytes })) });
    return { text: documentContextText({ filename: name, summary, markdown: structure.markdown, warnings: structure.warnings }), ...(summary ? { summary } : {}), figures };
  } catch {
    return { text: "Automatic text extraction failed. The original file is attached; inspect its workspace copy with the appropriate document tools." };
  }
}
