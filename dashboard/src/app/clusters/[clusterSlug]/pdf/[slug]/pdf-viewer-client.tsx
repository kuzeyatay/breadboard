"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";

type PdfJsModule = typeof import("pdfjs-dist");
type PdfDocumentLoadingTask = ReturnType<PdfJsModule["getDocument"]>;
type PromiseResolver<T> = (value: T | PromiseLike<T>) => void;
type PromiseRejecter = (reason?: unknown) => void;
type PromiseWithResolvers<T> = {
  promise: Promise<T>;
  resolve: PromiseResolver<T>;
  reject: PromiseRejecter;
};
type PromiseConstructorWithResolvers = PromiseConstructor & {
  withResolvers?<T>(): PromiseWithResolvers<T>;
};
type PdfViewerMode = "select" | "highlight" | "text" | "draw";
type SaveState = "saved" | "dirty" | "saving" | "error";

type EventBusLike = {
  on(eventName: string, listener: (event: Record<string, unknown>) => void): void;
  dispatch(eventName: string, data: Record<string, unknown>): void;
};

type LinkServiceLike = {
  setDocument(pdfDocument: PDFDocumentProxy | null, baseUrl?: string | null): void;
  setViewer(viewer: PdfViewerLike): void;
};

type FindControllerLike = {
  setDocument(pdfDocument: PDFDocumentProxy | null): void;
};

type PdfViewerLike = {
  currentPageNumber: number;
  currentScale: number;
  currentScaleValue: string;
  pagesCount: number;
  annotationEditorMode: { mode: number };
  cleanup(): void;
  decreaseScale(): void;
  increaseScale(): void;
  nextPage(): boolean;
  previousPage(): boolean;
  setDocument(pdfDocument: PDFDocumentProxy | null): void;
};

type PdfViewerModule = {
  EventBus: new () => EventBusLike;
  PDFFindController: new (options: {
    eventBus: EventBusLike;
    linkService: LinkServiceLike;
  }) => FindControllerLike;
  PDFLinkService: new (options: { eventBus: EventBusLike }) => LinkServiceLike;
  PDFViewer: new (options: Record<string, unknown>) => PdfViewerLike;
};

const PROMISE_WITH_RESOLVERS_POLYFILL = `
if (!Promise.withResolvers) {
  Promise.withResolvers = function withResolvers() {
    var resolve;
    var reject;
    var promise = new Promise(function executor(promiseResolve, promiseReject) {
      resolve = promiseResolve;
      reject = promiseReject;
    });
    return { promise: promise, resolve: resolve, reject: reject };
  };
}
`;
const PDFJS_MODULE_URL = "/api/pdfjs/pdf.mjs";
const PDFJS_VIEWER_MODULE_URL = "/api/pdfjs/pdf_viewer.mjs";
const PDFJS_VIEWER_CSS_URL = "/api/pdfjs/pdf_viewer.css";
const PDFJS_WORKER_URL = "/api/pdfjs/pdf.worker.mjs";
const PDFJS_IMAGE_RESOURCES_PATH = "/api/pdfjs/images/";

interface Props {
  clusterSlug: string;
  documentSlug: string;
  title: string;
}

function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none">
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

function ensurePdfJsRuntime() {
  const promiseConstructor = Promise as PromiseConstructorWithResolvers;
  promiseConstructor.withResolvers ??= function withResolvers<T>() {
    let resolve: PromiseResolver<T> | undefined;
    let reject: PromiseRejecter | undefined;
    const promise = new Promise<T>((promiseResolve, promiseReject) => {
      resolve = promiseResolve;
      reject = promiseReject;
    });
    if (!resolve || !reject) throw new Error("Could not create PDF promise");
    return { promise, resolve, reject };
  };
}

function createPdfWorkerSrc(workerUrl: string): string {
  return URL.createObjectURL(
    new Blob(
      [
        PROMISE_WITH_RESOLVERS_POLYFILL,
        `\nawait import(${JSON.stringify(workerUrl)});\n`,
      ],
      { type: "text/javascript" },
    ),
  );
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function downloadBytes(bytes: Uint8Array, fileName: string) {
  const blob = new Blob([bytesToArrayBuffer(bytes)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export default function PdfViewerClient({ clusterSlug, documentSlug, title }: Props) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const eventBusRef = useRef<EventBusLike | null>(null);
  const pdfViewerRef = useRef<PdfViewerLike | null>(null);
  const pdfjsRef = useRef<PdfJsModule | null>(null);
  const pdfDocumentRef = useRef<PDFDocumentProxy | null>(null);
  const linkServiceRef = useRef<LinkServiceLike | null>(null);
  const findControllerRef = useRef<FindControllerLike | null>(null);
  const saveAgainRef = useRef(false);
  const saveInFlightRef = useRef(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveEditedPdfRef = useRef<() => Promise<boolean>>(async () => true);
  const hasInMemoryUndoRef = useRef(false);
  const serverUndoRef = useRef<() => Promise<void>>(async () => {});
  const [pageCount, setPageCount] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [scaleLabel, setScaleLabel] = useState("100%");
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<PdfViewerMode>("select");
  const [query, setQuery] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [lastSavedAt, setLastSavedAt] = useState("");
  const [serverHistoryCount, setServerHistoryCount] = useState(0);

  const pdfUrl = useMemo(() => {
    const params = new URLSearchParams({ clusterSlug });
    return `/api/documents/${encodeURIComponent(documentSlug)}/source-pdf?${params.toString()}`;
  }, [clusterSlug, documentSlug]);

  const historyUrl = useMemo(() => {
    const params = new URLSearchParams({ clusterSlug });
    return `/api/documents/${encodeURIComponent(documentSlug)}/source-pdf/history?${params.toString()}`;
  }, [clusterSlug, documentSlug]);

  const editedFileName = useMemo(
    () => `${documentSlug || "document"}-annotated.pdf`,
    [documentSlug],
  );

  const clearScheduledSave = useCallback(() => {
    if (!saveTimeoutRef.current) return;
    clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = null;
  }, []);

  const saveEditedPdfToServer = useCallback(async (): Promise<boolean> => {
    const pdfDocument = pdfDocumentRef.current;
    if (!pdfDocument) return true;

    if (saveInFlightRef.current) {
      saveAgainRef.current = true;
      return false;
    }

    clearScheduledSave();
    saveInFlightRef.current = true;
    setSaveState("saving");
    setError("");

    try {
      const savedHash = pdfDocument.annotationStorage.modifiedIds.hash;
      const data = await pdfDocument.saveDocument();
      const response = await fetch(pdfUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/pdf" },
        body: bytesToArrayBuffer(data),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const message = typeof body.error === "string"
          ? body.error
          : "Could not save the edited PDF.";
        throw new Error(message);
      }

      const currentHash = pdfDocument.annotationStorage.modifiedIds.hash;
      if (currentHash === savedHash) {
        pdfDocument.annotationStorage.resetModified();
        setSaveState("saved");
        setLastSavedAt(
          new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        );
      } else {
        saveAgainRef.current = true;
        setSaveState("dirty");
      }
      return true;
    } catch (saveError) {
      setSaveState("error");
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save the edited PDF.",
      );
      return false;
    } finally {
      saveInFlightRef.current = false;
      if (saveAgainRef.current) {
        saveAgainRef.current = false;
        setSaveState("dirty");
        saveTimeoutRef.current = setTimeout(() => {
          void saveEditedPdfRef.current();
        }, 0);
      }
    }
  }, [clearScheduledSave, pdfUrl]);

  useEffect(() => {
    saveEditedPdfRef.current = saveEditedPdfToServer;
  }, [saveEditedPdfToServer]);

  const scheduleAutoSave = useCallback(() => {
    clearScheduledSave();
    setSaveState("dirty");
    saveTimeoutRef.current = setTimeout(() => {
      void saveEditedPdfRef.current();
    }, 0);
  }, [clearScheduledSave]);

  const wireDocument = useCallback(
    (pdfDocument: PDFDocumentProxy) => {
      pdfDocument.annotationStorage.onSetModified = () => {
        scheduleAutoSave();
      };
      pdfDocument.annotationStorage.onResetModified = () => {
        if (!saveInFlightRef.current && !saveTimeoutRef.current) {
          setSaveState("saved");
        }
      };
    },
    [scheduleAutoSave],
  );

  const reloadFromBytes = useCallback(
    async (bytes: Uint8Array) => {
      const pdfjs = pdfjsRef.current;
      const pdfViewer = pdfViewerRef.current;
      const linkService = linkServiceRef.current;
      const findController = findControllerRef.current;
      if (!pdfjs || !pdfViewer || !linkService || !findController) return;

      clearScheduledSave();
      setSaveState("saved");
      setError("");

      const oldDoc = pdfDocumentRef.current;
      pdfDocumentRef.current = null;
      if (oldDoc) {
        linkService.setDocument(null, null);
        findController.setDocument(null);
        pdfViewer.setDocument(null);
        void oldDoc.destroy();
      }

      try {
        const loadingTask = pdfjs.getDocument({ data: bytes });
        const newDoc = await loadingTask.promise;
        pdfDocumentRef.current = newDoc;
        wireDocument(newDoc);
        linkService.setDocument(newDoc, null);
        findController.setDocument(newDoc);
        pdfViewer.setDocument(newDoc);
        setPageCount(newDoc.numPages);
        setPageNumber(1);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Could not reload PDF.");
      }
    },
    [clearScheduledSave, wireDocument],
  );

  const serverUndo = useCallback(async () => {
    if (serverHistoryCount <= 0) return;
    setSaveState("saving");
    try {
      const response = await fetch(historyUrl, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(typeof body.error === "string" ? body.error : "Could not undo.");
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      await reloadFromBytes(bytes);
      setServerHistoryCount((c) => c - 1);
      setLastSavedAt(
        new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      );
    } catch (undoError) {
      setSaveState("error");
      setError(undoError instanceof Error ? undoError.message : "Could not undo.");
    }
  }, [serverHistoryCount, historyUrl, reloadFromBytes]);

  useEffect(() => {
    serverUndoRef.current = serverUndo;
  }, [serverUndo]);

  const saveStatusText = useMemo(() => {
    if (saveState === "saving") return "Saving changes";
    if (saveState === "dirty") return "Unsaved changes";
    if (saveState === "error") return "Save failed";
    return lastSavedAt ? `Saved ${lastSavedAt}` : "Saved";
  }, [lastSavedAt, saveState]);

  useEffect(() => {
    const hasPendingSave = saveState === "dirty" || saveState === "saving";
    if (!hasPendingSave) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [saveState]);

  useEffect(() => {
    if (!containerRef.current || !viewerRef.current) return;

    let cancelled = false;
    let loadingTask: PdfDocumentLoadingTask | null = null;
    let workerBlobUrl: string | null = null;
    let pdfDocument: PDFDocumentProxy | null = null;

    setLoading(true);
    setError("");
    setPageCount(0);
    setPageNumber(1);
    setMode("select");
    setSaveState("saved");
    setLastSavedAt("");
    clearScheduledSave();

    async function loadPdf() {
      try {
        ensurePdfJsRuntime();
        const pdfjs = (await import(
          /* webpackIgnore: true */ PDFJS_MODULE_URL
        )) as PdfJsModule;
        (globalThis as typeof globalThis & { pdfjsLib?: PdfJsModule }).pdfjsLib =
          pdfjs;

        const viewerModule = (await import(
          /* webpackIgnore: true */ PDFJS_VIEWER_MODULE_URL
        )) as PdfViewerModule;

        if (cancelled || !containerRef.current || !viewerRef.current) return;

        workerBlobUrl = createPdfWorkerSrc(
          new URL(PDFJS_WORKER_URL, window.location.origin).toString(),
        );
        pdfjs.GlobalWorkerOptions.workerSrc = workerBlobUrl;
        pdfjsRef.current = pdfjs;

        const eventBus = new viewerModule.EventBus();
        const linkService = new viewerModule.PDFLinkService({ eventBus });
        const findController = new viewerModule.PDFFindController({
          eventBus,
          linkService,
        });
        const pdfViewer = new viewerModule.PDFViewer({
          annotationEditorHighlightColors:
            "yellow=#ffff98,green=#53ffbc,blue=#80ebff,pink=#ffcbe6",
          annotationEditorMode: pdfjs.AnnotationEditorType.NONE,
          annotationMode: pdfjs.AnnotationMode.ENABLE_FORMS,
          container: containerRef.current,
          enableHighlightFloatingButton: true,
          eventBus,
          findController,
          imageResourcesPath: PDFJS_IMAGE_RESOURCES_PATH,
          linkService,
          removePageBorders: false,
          viewer: viewerRef.current,
        });

        linkService.setViewer(pdfViewer);
        eventBusRef.current = eventBus;
        pdfViewerRef.current = pdfViewer;
        linkServiceRef.current = linkService;
        findControllerRef.current = findController;

        eventBus.on("pagesloaded", (event) => {
          const count = Number(event.pagesCount);
          if (Number.isFinite(count)) setPageCount(count);
        });
        eventBus.on("pagechanging", (event) => {
          const nextPage = Number(event.pageNumber);
          if (Number.isFinite(nextPage)) setPageNumber(nextPage);
        });
        eventBus.on("scalechanging", (event) => {
          const scale = Number(event.scale);
          if (Number.isFinite(scale)) setScaleLabel(`${Math.round(scale * 100)}%`);
        });
        eventBus.on("updateviewarea", () => {
          const scale = pdfViewerRef.current?.currentScale;
          if (typeof scale === "number") {
            setScaleLabel(`${Math.round(scale * 100)}%`);
          }
        });
        eventBus.on("annotationeditormodechanged", (event) => {
          const nextMode = Number(event.mode);
          if (nextMode === pdfjs.AnnotationEditorType.HIGHLIGHT) {
            setMode("highlight");
          } else if (nextMode === pdfjs.AnnotationEditorType.FREETEXT) {
            setMode("text");
          } else if (nextMode === pdfjs.AnnotationEditorType.INK) {
            setMode("draw");
          } else {
            setMode("select");
          }
        });
        eventBus.on("annotationeditorstateschanged", (event) => {
          hasInMemoryUndoRef.current = Boolean(event.hasSomethingToUndo);
          // Always schedule save — covers any undo-stack change PDF.js fires this for
          scheduleAutoSave();
        });

        loadingTask = pdfjs.getDocument({
          url: pdfUrl,
          withCredentials: true,
        });
        pdfDocument = await loadingTask.promise;
        if (cancelled) {
          void pdfDocument.destroy();
          return;
        }

        pdfDocumentRef.current = pdfDocument;
        wireDocument(pdfDocument);
        linkService.setDocument(pdfDocument, null);
        findController.setDocument(pdfDocument);
        pdfViewer.setDocument(pdfDocument);
        pdfViewer.currentScaleValue = "page-width";
        setPageCount(pdfDocument.numPages);
        setPageNumber(1);

        // Fetch server history count so Ctrl+Z can fall back to it
        const histResp = await fetch(historyUrl).catch(() => null);
        if (!cancelled && histResp?.ok) {
          const histData = await histResp.json().catch(() => ({ count: 0 }));
          setServerHistoryCount(typeof histData.count === "number" ? histData.count : 0);
        }
      } catch (loadError: unknown) {
        if (cancelled) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not open this PDF.",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadPdf();

    // Document-level capture listeners so PDF.js stopPropagation() can't block them.
    // composedPath() is used instead of contains() so the check works even when
    // PDF.js places the drawing canvas inside a shadow root or a captured pointer
    // target that contains() cannot see.
    // pointerup: 50 ms delay gives PDF.js time to commit the stroke to annotationStorage
    //   in its own bubble-phase handler before we call saveDocument().
    // keyup: catches text edits and annotation deletions (Delete/Backspace).
    const container = containerRef.current;
    const inContainer = (event: Event) =>
      container != null && event.composedPath().includes(container);
    const onPointerUp = (event: PointerEvent) => {
      if (inContainer(event)) {
        setTimeout(() => { void saveEditedPdfRef.current(); }, 50);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (inContainer(event)) {
        void saveEditedPdfRef.current();
      }
    };
    document.addEventListener("pointerup", onPointerUp, { capture: true });
    document.addEventListener("keyup", onKeyUp, { capture: true });

    return () => {
      cancelled = true;
      document.removeEventListener("pointerup", onPointerUp, { capture: true });
      document.removeEventListener("keyup", onKeyUp, { capture: true });
      eventBusRef.current = null;
      pdfViewerRef.current?.setDocument(null);
      pdfViewerRef.current?.cleanup();
      pdfViewerRef.current = null;
      pdfDocumentRef.current = null;
      clearScheduledSave();
      linkServiceRef.current = null;
      findControllerRef.current = null;
      void loadingTask?.destroy();
      void pdfDocument?.destroy();
      if (workerBlobUrl) URL.revokeObjectURL(workerBlobUrl);
    };
  }, [clearScheduledSave, historyUrl, pdfUrl, scheduleAutoSave, wireDocument]);

  const goBack = useCallback(async () => {
    if (saveState === "saving") {
      setError("Please wait for the PDF save to finish before leaving.");
      return;
    }

    if (saveState === "dirty" || saveState === "error") {
      const saved = await saveEditedPdfToServer();
      if (!saved) return;
    }

    if (window.history.length > 1) {
      router.back();
      return;
    }
    router.push(`/clusters/${clusterSlug}`);
  }, [clusterSlug, router, saveEditedPdfToServer, saveState]);

  const goToPreviousPage = useCallback(() => {
    pdfViewerRef.current?.previousPage();
  }, []);

  const goToNextPage = useCallback(() => {
    pdfViewerRef.current?.nextPage();
  }, []);

  const zoomOut = useCallback(() => {
    pdfViewerRef.current?.decreaseScale();
  }, []);

  const zoomIn = useCallback(() => {
    pdfViewerRef.current?.increaseScale();
  }, []);

  const setEditorMode = useCallback((nextMode: PdfViewerMode) => {
    const pdfViewer = pdfViewerRef.current;
    const pdfjs = pdfjsRef.current;
    if (!pdfViewer || !pdfjs) return;

    const type =
      nextMode === "highlight"
        ? pdfjs.AnnotationEditorType.HIGHLIGHT
        : nextMode === "text"
          ? pdfjs.AnnotationEditorType.FREETEXT
          : nextMode === "draw"
            ? pdfjs.AnnotationEditorType.INK
            : pdfjs.AnnotationEditorType.NONE;

    pdfViewer.annotationEditorMode = { mode: type };
    setMode(nextMode);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const eventBus = eventBusRef.current;
      if (!eventBus) return;
      const isInput =
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement;
      if (isInput) return;

      if ((event.ctrlKey || event.metaKey) && !event.altKey) {
        if (event.key === "z" && !event.shiftKey) {
          event.preventDefault();
          if (hasInMemoryUndoRef.current) {
            eventBus.dispatch("undo", {});
          } else {
            void serverUndoRef.current();
          }
        } else if (event.key === "y" || (event.key === "z" && event.shiftKey)) {
          event.preventDefault();
          eventBus.dispatch("redo", {});
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const runFind = useCallback(
    (type: "again" | "" = "") => {
      eventBusRef.current?.dispatch("find", {
        caseSensitive: false,
        entireWord: false,
        findPrevious: false,
        highlightAll: true,
        matchDiacritics: true,
        query,
        source: null,
        type,
      });
    },
    [query],
  );

  const downloadEdited = useCallback(async () => {
    const pdfDocument = pdfDocumentRef.current;
    if (!pdfDocument) return;

    setExporting(true);
    setError("");
    try {
      if (saveState !== "saved") {
        const saved = await saveEditedPdfToServer();
        if (!saved) return;
      }
      const data = await pdfDocument.saveDocument();
      downloadBytes(data, editedFileName);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not download the edited PDF.",
      );
    } finally {
      setExporting(false);
    }
  }, [editedFileName, saveEditedPdfToServer, saveState]);

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <link rel="stylesheet" href={PDFJS_VIEWER_CSS_URL} />
      <style>{`
        :is(.annotationEditorLayer :is(.freeTextEditor,.inkEditor,.stampEditor,.highlightEditor,.signatureEditor),.textLayer) .editToolbar,
        .annotationEditorLayer .freeTextEditor,
        .annotationEditorLayer .inkEditor {
          --editor-toolbar-delete-image: url(/api/pdfjs/images/editor-toolbar-delete.svg);
          --editor-toolbar-highlight-image: url(/api/pdfjs/images/toolbarButton-editorHighlight.svg);
          --editor-toolbar-colorpicker-arrow-image: url(/api/pdfjs/images/toolbarButton-menuArrow.svg);
        }
        .annotationEditorLayer {
          --editorInk-editing-cursor: url(/api/pdfjs/images/cursor-editorInk.svg) 0 16, pointer;
          --editorFreeText-editing-cursor: url(/api/pdfjs/images/cursor-editorFreeText.svg) 0 16, text;
          --editorHighlight-editing-cursor: url(/api/pdfjs/images/cursor-editorTextHighlight.svg) 24 24, text;
          --editorFreeHighlight-editing-cursor: url(/api/pdfjs/images/cursor-editorFreeHighlight.svg) 1 18, pointer;
        }
      `}</style>

      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-800 bg-gray-950 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={goBack}
            className="rounded-md border border-gray-800 px-3 py-1.5 text-xs text-gray-400 transition-colors hover:border-gray-600 hover:text-white"
          >
            Back
          </button>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-gray-600">
              PDF source
            </p>
            <h1 className="truncate text-sm font-semibold text-white">{title}</h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            aria-live="polite"
            className={`px-1 text-xs ${
              saveState === "error"
                ? "text-red-300"
                : saveState === "dirty"
                  ? "text-yellow-300"
                  : saveState === "saving"
                    ? "text-gray-300"
                    : "text-gray-500"
            }`}
          >
            {saveStatusText}
          </span>
          {serverHistoryCount > 0 && (
            <button
              type="button"
              onClick={() => void serverUndo()}
              disabled={loading || saveState === "saving"}
              className="rounded-md border border-gray-800 px-3 py-1.5 text-xs text-gray-400 transition-colors hover:border-gray-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              title={`${serverHistoryCount} saved version${serverHistoryCount !== 1 ? "s" : ""} available`}
            >
              Undo
            </button>
          )}
          <Link
            href={`/garden/${clusterSlug}?note=${encodeURIComponent(documentSlug)}`}
            className="rounded-md border border-gray-800 px-3 py-1.5 text-xs text-gray-400 transition-colors hover:border-gray-600 hover:text-white"
          >
            Source note
          </Link>
          <a
            href={pdfUrl}
            className="rounded-md border border-gray-800 px-3 py-1.5 text-xs text-gray-400 transition-colors hover:border-gray-600 hover:text-white"
          >
            Open PDF
          </a>
          <button
            type="button"
            onClick={() => {
              void saveEditedPdfToServer();
            }}
            disabled={
              loading ||
              saveState === "saving" ||
              saveState === "saved" ||
              !pdfDocumentRef.current
            }
            className="rounded-md border border-gray-800 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:border-gray-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saveState === "saving"
              ? "Saving"
              : saveState === "saved"
                ? "Saved"
                : "Save"}
          </button>
          <button
            type="button"
            onClick={downloadEdited}
            disabled={
              loading ||
              exporting ||
              saveState === "saving" ||
              !pdfDocumentRef.current
            }
            className="rounded-md border border-gray-800 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:border-gray-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {exporting ? "Preparing" : "Download copy"}
          </button>
        </div>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-800 bg-gray-900 px-4 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={goToPreviousPage}
            disabled={loading || pageNumber <= 1}
            className="rounded-md border border-gray-700 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Previous
          </button>
          <span className="min-w-24 text-center text-xs text-gray-500">
            {pageCount ? `${pageNumber} / ${pageCount}` : "Loading"}
          </span>
          <button
            type="button"
            onClick={goToNextPage}
            disabled={loading || pageNumber >= pageCount}
            className="rounded-md border border-gray-700 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
          <button
            type="button"
            onClick={zoomOut}
            disabled={loading}
            className="h-8 w-8 rounded-md border border-gray-700 text-sm text-gray-300 transition-colors hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Zoom out"
          >
            -
          </button>
          <span className="w-14 text-center text-xs text-gray-500">{scaleLabel}</span>
          <button
            type="button"
            onClick={zoomIn}
            disabled={loading}
            className="h-8 w-8 rounded-md border border-gray-700 text-sm text-gray-300 transition-colors hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Zoom in"
          >
            +
          </button>
        </div>

        <form
          className="flex min-w-64 flex-1 items-center justify-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            runFind("");
          }}
        >
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find in PDF"
            className="h-8 w-full max-w-64 rounded-md border border-gray-700 bg-gray-950 px-3 text-xs text-gray-200 outline-none transition-colors placeholder:text-gray-600 focus:border-gray-500"
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="rounded-md border border-gray-700 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Find
          </button>
          <button
            type="button"
            onClick={() => runFind("again")}
            disabled={loading || !query.trim()}
            className="rounded-md border border-gray-700 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next match
          </button>
        </form>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={downloadEdited}
            disabled={
              loading ||
              exporting ||
              saveState === "saving" ||
              !pdfDocumentRef.current
            }
            className="rounded-md border border-gray-700 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {exporting ? "Preparing" : "Save PDF"}
          </button>
          {(["select", "highlight", "text", "draw"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setEditorMode(item)}
              disabled={loading}
              className={`rounded-md border px-3 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                mode === item
                  ? "border-gray-300 bg-gray-100 text-gray-950"
                  : "border-gray-700 text-gray-300 hover:border-gray-500 hover:text-white"
              }`}
            >
              {item === "select"
                ? "Select"
                : item === "highlight"
                  ? "Highlight"
                  : item === "text"
                    ? "Text"
                    : "Draw"}
            </button>
          ))}
        </div>
      </div>

      <section className="relative min-h-0 flex-1 bg-gray-900">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-gray-900 text-gray-500">
            <span className="flex items-center gap-2 text-sm">
              <Spinner />
              Opening PDF
            </span>
          </div>
        )}
        {error && (
          <div className="absolute left-1/2 top-4 z-20 max-w-xl -translate-x-1/2 rounded-md border border-red-900 bg-red-950 px-4 py-3 text-sm text-red-200 shadow-lg">
            {error}
          </div>
        )}
        <div
          id="viewerContainer"
          ref={containerRef}
          className="absolute inset-0 overflow-auto bg-gray-900 [--page-border:1px_solid_#393639] [--page-margin:12px_auto_4px] [--pdfViewer-padding-bottom:24px]"
        >
          <div ref={viewerRef} className="pdfViewer" />
        </div>
      </section>
    </main>
  );
}
