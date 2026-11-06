"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { isPrimaryShortcut } from "@/lib/keyboard-shortcuts";
import { releaseCanvasPixels } from "./canvas-resource";
import styles from "./pdf-print-preview.module.css";

type Props = {
  bytes: Uint8Array;
  title: string;
  pdfjs: typeof import("pdfjs-dist");
  onPrint: () => Promise<void>;
  onClose: () => void;
  returnFocusTo: HTMLElement | null;
};

/** Preview the exact saved bytes passed to the printer, including annotations.
 * Only one page owns pixels at a time, even for very large documents. */
export default function PdfPrintPreview({ bytes, title, pdfjs, onPrint, onClose, returnFocusTo }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const printPendingRef = useRef(false);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageDraft, setPageDraft] = useState<string | null>(null);
  const [zoom, setZoom] = useState("fit");
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [renderedPage, setRenderedPage] = useState(0);
  const [rendering, setRendering] = useState(true);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState("");
  const [printError, setPrintError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const dialog = dialogRef.current!;
    const previousFocus = returnFocusTo ?? document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [returnFocusTo]);

  useEffect(() => {
    const viewport = viewportRef.current!;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let disposed = false;
    // PDF.js transfers this buffer to its worker. Keep the print snapshot intact.
    const task = pdfjs.getDocument({ data: bytes.slice() });
    task.promise.then(document => {
      if (!disposed) { setPdf(document); setError(""); }
    }).catch(reason => {
      if (!disposed) { setError(reason instanceof Error ? reason.message : "Could not load the print preview."); setRendering(false); }
    });
    return () => { disposed = true; void task.destroy(); };
  }, [bytes, pdfjs, attempt]);

  useEffect(() => {
    if (!pdf || size.width <= 0 || size.height <= 0) return;
    let disposed = false;
    let renderTask: RenderTask | undefined;
    const sheet = sheetRef.current!;
    const canvas = document.createElement("canvas");
    setRendering(true);
    setError("");
    const render = async () => {
      const page = await pdf.getPage(pageNumber);
      if (disposed) return;
      const natural = page.getViewport({ scale: 1 });
      const scale = zoom === "fit"
        ? Math.max(0.05, Math.min(size.width / natural.width, size.height / natural.height))
        : Number(zoom) * 96 / 72;
      const viewport = page.getViewport({ scale });
      // Bound backing-store memory independently of the document's page size.
      const density = Math.min(window.devicePixelRatio || 1, 2,
        8192 / Math.max(viewport.width, viewport.height),
        Math.sqrt(12_000_000 / (viewport.width * viewport.height)));
      canvas.width = Math.max(1, Math.floor(viewport.width * density));
      canvas.height = Math.max(1, Math.floor(viewport.height * density));
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", `Print preview, page ${pageNumber} of ${pdf.numPages}`);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not create the print preview.");
      renderTask = page.render({
        canvas, canvasContext: context, viewport,
        transform: [density, 0, 0, density, 0, 0],
        intent: "print", annotationMode: pdfjs.AnnotationMode.ENABLE_STORAGE,
        background: "rgb(255, 255, 255)",
      });
      await renderTask.promise;
      if (disposed) return;
      sheet.replaceChildren(canvas);
      setRenderedPage(pageNumber);
      setRendering(false);
    };
    void render().catch(reason => {
      if (!disposed) { setError(reason instanceof Error ? reason.message : "Could not render this page."); setRendering(false); }
    });
    return () => {
      disposed = true;
      renderTask?.cancel();
      canvas.remove();
      // Wait for cancellation before releasing a canvas the worker may be using.
      void Promise.resolve(renderTask?.promise).catch(() => undefined).then(() => releaseCanvasPixels(canvas));
    };
  }, [pdf, pageNumber, zoom, size, pdfjs]);

  const ready = Boolean(pdf && renderedPage === pageNumber && !rendering && !error);
  const startPrint = async () => {
    if (!ready || printPendingRef.current) return;
    printPendingRef.current = true;
    setPrinting(true);
    setPrintError("");
    try { await onPrint(); }
    catch (reason) { setPrintError(reason instanceof Error ? reason.message : "Could not open the print dialog."); }
    finally { printPendingRef.current = false; setPrinting(false); }
  };
  const commitPage = () => {
    const value = Number(pageDraft);
    if (pageDraft !== null && Number.isInteger(value) && value >= 1 && value <= (pdf?.numPages ?? 0)) setPageNumber(value);
    setPageDraft(null);
  };

  return (
    <dialog ref={dialogRef} className={styles.dialog} aria-modal="true" aria-labelledby="pdf-print-preview-title"
      onCancel={event => { event.preventDefault(); if (!printing) onClose(); }}
      onKeyDown={event => {
        // Do not let viewer shortcuts edit or navigate the document behind us.
        event.stopPropagation();
        if (isPrimaryShortcut(event.nativeEvent, "p")) { event.preventDefault(); void startPrint(); }
      }}>
      <div className={styles.layout}>
        <header className={styles.header}>
          <div className={styles.heading}>
            <h2 id="pdf-print-preview-title">Print preview</h2>
            <p title={title}>{title}</p>
          </div>
          <button type="button" onClick={onClose} disabled={printing} aria-label="Close print preview">✕</button>
        </header>
        <div className={styles.toolbar}>
          <button type="button" disabled={!pdf || pageNumber <= 1 || printing}
            onClick={() => { setPageDraft(null); setPageNumber(page => page - 1); }}>Previous page</button>
          <label className={styles.pageField}>Page
            <input aria-label="Preview page number" inputMode="numeric" value={pageDraft ?? String(pageNumber)}
              disabled={!pdf || printing} onChange={event => setPageDraft(event.target.value)} onBlur={commitPage}
              onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); commitPage(); } }} />
            <span>of {pdf?.numPages ?? "…"}</span>
          </label>
          <button type="button" disabled={!pdf || pageNumber >= pdf.numPages || printing}
            onClick={() => { setPageDraft(null); setPageNumber(page => page + 1); }}>Next page</button>
          <label className={styles.zoom}>Zoom
            <select aria-label="Preview zoom" value={zoom} disabled={printing} onChange={event => setZoom(event.target.value)}>
              <option value="fit">Fit page</option><option value="1">100%</option>
              <option value="1.5">150%</option><option value="2">200%</option>
            </select>
          </label>
        </div>
        <div className={styles.progress} aria-hidden="true" data-busy={rendering} />
        <div className={styles.preview} ref={viewportRef} aria-busy={rendering}>
          <div ref={sheetRef} className={styles.sheet} />
        </div>
        <div className={styles.status} aria-live="polite">
          {error ? <span role="alert">{error} <button type="button" onClick={() => {
            setPdf(null); setError(""); setRendering(true); setAttempt(value => value + 1);
          }}>Retry preview</button></span> : rendering ? "Preparing preview…" : `${pdf?.numPages} page${pdf?.numPages === 1 ? "" : "s"} · Includes saved annotations`}
          {printError && <p role="alert">{printError}</p>}
        </div>
        <footer className={styles.footer}>
          <p>Choose the printer, page range, paper size and layout in the next dialog.</p>
          <div className={styles.actions}>
            <button type="button" onClick={onClose} disabled={printing}>Cancel</button>
            <button type="button" className={styles.primary} disabled={!ready || printing} onClick={() => void startPrint()}>
              {printing ? "Opening print dialog…" : "Continue to print"}
            </button>
          </div>
        </footer>
      </div>
    </dialog>
  );
}
