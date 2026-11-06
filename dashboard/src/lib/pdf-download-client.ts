import type { SavePdfDownloadRequest, SavePdfDownloadResult } from "../../../desktop/src/shared/ipc-contract";

interface PdfDownloadBridge {
  savePdfDownload?: (request: SavePdfDownloadRequest) => Promise<SavePdfDownloadResult>;
}

export async function downloadPdf(blob: Blob, filename: string): Promise<string> {
  const desktop = (window as Window & { breadboardDesktop?: PdfDownloadBridge }).breadboardDesktop;
  if (desktop) {
    if (typeof desktop.savePdfDownload !== "function") {
      throw new Error("Restart Breadboard to finish installing the PDF download update.");
    }
    const result = await desktop.savePdfDownload({ filename, data: await blob.arrayBuffer() });
    if (!result.ok) {
      if (result.cancelled) return "Download cancelled.";
      throw new Error(result.error);
    }
    return `Saved: ${result.filename}`;
  }

  // Ordinary browsers choose their own destination and expose no completion
  // acknowledgement to the page. Do not claim the file has already been saved.
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  return "PDF download started. Check your browser's downloads.";
}
