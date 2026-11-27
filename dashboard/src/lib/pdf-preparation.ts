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

const UNTRANSCRIBED_PAGE = "[This page has not been transcribed.";

/**
 * Whether a saved reading of this exact PDF already answers a new question.
 * A book of hundreds of pages re-uploaded and re-read per page outlasts the
 * preparation deadline; one reading serves every page it actually contains.
 */
export function pdfReadingCovers(
  text: string,
  need: { wholeDocument: boolean; page?: number },
): boolean {
  if (need.wholeDocument) return !text.includes(UNTRANSCRIBED_PAGE);
  if (need.page === undefined) return true; // A sent screenshot shows the view.
  const start = text.indexOf(`[[Page ${need.page}]]\n`);
  if (start < 0) return false; // Past the text limit, or never read.
  const next = text.indexOf("\n\n[[Page ", start);
  return !text.slice(start, next < 0 ? undefined : next).includes(UNTRANSCRIBED_PAGE);
}

/** Moving the bytes, not just reading them, grows with the file. */
export function pdfUploadTimeoutMs(byteLength: number, pageCount: number, wholeDocument: boolean): number {
  const transfer = Math.ceil(byteLength / (1024 * 1024)) * 1_000;
  return Math.max(180_000, (wholeDocument ? pageCount * 95_000 : 120_000) + transfer);
}

/**
 * The pages a saved reading already holds, as the reader's `pageReadings`, so
 * a narrower new reading neither re-extracts them nor loses their OCR.
 */
export function pdfReadingPages(text: string): Record<number, string> {
  const pages: Record<number, string> = {};
  for (const block of text.split(/\n\n(?=\[\[Page \d+\]\]\n)/)) {
    const match = /^\[\[Page (\d+)\]\]\n([\s\S]*)$/.exec(block);
    if (!match || match[2].includes(UNTRANSCRIBED_PAGE)) continue;
    const body = match[2].replace(/\n*\[Document reading incomplete:[\s\S]*$/, "").trim();
    if (body) pages[Number(match[1])] = body;
  }
  return pages;
}
