import path from "node:path";

import { atomicWrite, outputPath, readInputFile } from "./agent-query.ts";
import { pdfToDocx } from "./pdf-to-docx.ts";

export interface PdfConversionResult {
  file: string;
  outputPath: string;
  title: string;
  filename: string;
  kind: "document";
  pages: number;
  warnings: string[];
  scannedDocument: boolean;
  pageResults: Array<{
    page: number;
    status: "ok" | "degraded" | "scanned";
    reason?: string;
    confidence?: number;
  }>;
}

/**
 * PDF conversion is isolated from the native DOCX/PPTX editor so routes that
 * only edit Office files do not load PDFium or its WebAssembly payload.
 */
export async function convertPdfDocument(
  workspace: string,
  args: Record<string, unknown>,
): Promise<PdfConversionResult> {
  const input = readInputFile(workspace, args.file, [".pdf"]);
  const parsed = path.parse(input.relative);
  const fallback = `${parsed.name}.docx`;
  const output = outputPath(workspace, args.output ?? fallback, fallback, ".docx");
  const password = typeof args.password === "string" && args.password ? args.password : undefined;
  const converted = await pdfToDocx(input.bytes, password ? { password } : {});
  atomicWrite(output.absolute, converted.bytes);
  const filename = path.basename(output.absolute);
  const title = typeof args.title === "string" && args.title.trim()
    ? args.title.trim().slice(0, 240)
    : path.parse(filename).name;
  return {
    file: input.relative,
    outputPath: output.absolute,
    title,
    filename,
    kind: "document",
    pages: converted.pages,
    warnings: converted.warnings,
    scannedDocument: converted.scannedDocument,
    pageResults: converted.pageResults,
  };
}
