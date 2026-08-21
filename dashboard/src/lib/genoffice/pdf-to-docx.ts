import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import {
  convertPdfToDocx,
  type PdfiumModule,
} from "../../vendor/genoffice/pdf2docx/src/index.ts";

const require = createRequire(import.meta.url);
let pdfiumPromise: Promise<PdfiumModule> | null = null;

export interface PdfToDocxResult {
  bytes: Uint8Array;
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

/** Resolved through package exports so it works in development and a traced standalone app. */
export function resolvePdfiumWasmPath(): string {
  return require.resolve("@embedpdf/pdfium/pdfium.wasm");
}

async function loadPdfium(): Promise<PdfiumModule> {
  pdfiumPromise ??= (async () => {
    const raw = await readFile(resolvePdfiumWasmPath());
    const wasmBinary = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
    const { init } = (await import("@embedpdf/pdfium")) as unknown as {
      init(overrides: { wasmBinary: ArrayBuffer }): Promise<{ pdfium?: unknown }>;
    };
    const wrapped = await init({ wasmBinary });
    const pdfium = (wrapped.pdfium ?? wrapped) as PdfiumModule & { _PDFiumExt_Init(): void };
    pdfium._PDFiumExt_Init();
    return pdfium;
  })();
  return pdfiumPromise;
}

export async function pdfToDocx(
  buffer: Uint8Array,
  options: { password?: string; onProgress?: (page: number, total: number) => void } = {},
): Promise<PdfToDocxResult> {
  const result = await convertPdfToDocx(buffer, {
    pdfium: await loadPdfium(),
    ...(options.password ? { password: options.password } : {}),
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
  });
  return {
    bytes: result.docx,
    pages: result.pages,
    warnings: result.warnings,
    scannedDocument: result.scannedDocument,
    pageResults: result.pageResults,
  };
}
