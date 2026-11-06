import type { PDFDocumentProxy } from "pdfjs-dist";

/** Unedited PDFs need their existing bytes, not a save that visits every page. */
export function currentPdfDocumentBytes(
  pdf: Pick<PDFDocumentProxy, "annotationStorage" | "getData" | "saveDocument">,
): Promise<Uint8Array> {
  return pdf.annotationStorage.size > 0 ? pdf.saveDocument() : pdf.getData();
}

/**
 * PDF.js work does not accept an AbortSignal. Race it as well as aborting fetches,
 * so Stop and deadlines settle even when a worker promise never returns. Late
 * results are ignored; callers must publish/cache results only after this wait.
 */
export function runPdfPreparationStep<T>(options: {
  signal: AbortSignal;
  label: string;
  run: (signal: AbortSignal) => Promise<T>;
  timeoutMs?: number;
}): Promise<T> {
  const { signal, label, run, timeoutMs = 30_000 } = options;
  signal.throwIfAborted();
  const controller = new AbortController();
  return new Promise<T>((resolve, reject) => {
    const finish = (settle: () => void) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      settle();
    };
    const abort = () => {
      controller.abort(signal.reason);
      finish(() => reject(signal.reason));
    };
    const timer = setTimeout(() => {
      const error = new Error(
        `${label} took too long. Regenerate this response to try again. If it keeps happening, reopen the PDF.`,
      );
      controller.abort(error);
      finish(() => reject(error));
    }, timeoutMs);
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return run(controller.signal);
    }).then(
      value => finish(() => resolve(value)),
      error => finish(() => reject(error)),
    );
  });
}
