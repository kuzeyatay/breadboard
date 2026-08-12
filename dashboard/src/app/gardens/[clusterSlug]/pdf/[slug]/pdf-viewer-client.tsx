"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import FastReadReader from "@/app/components/fastread-reader";
import NavbarFlowerWind from "@/app/components/navbar-flower-wind";
import { startNavigationProgress } from "@/app/components/navigation-progress";
import {
  fetchFastReadNote,
  pdfTextToMarkdown,
  type FastReadNote,
  type PdfTextPageLike,
} from "@/lib/fastread-source";
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
type PdfOutlineItem = Awaited<ReturnType<PDFDocumentProxy["getOutline"]>>[number];

type EventBusLike = {
  on(eventName: string, listener: (event: Record<string, unknown>) => void): void;
  dispatch(eventName: string, data: Record<string, unknown>): void;
};

type LinkServiceLike = {
  goToDestination(dest: string | unknown[]): Promise<void>;
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
  clusterSlug?: string;
  documentSlug?: string;
  title: string;
  browserTitle?: string;
  sourceUrl?: string;
  readOnly?: boolean;
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

function fileNameFromTitle(value: string): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "document"}-annotated.pdf`;
}

function outlineItemKey(item: PdfOutlineItem, indexPath: number[]) {
  return `${indexPath.join("-")}-${item.title}`;
}

// Keys of every outline entry that has children, so they can start collapsed.
function collectCollapsibleKeys(
  items: PdfOutlineItem[],
  indexPath: number[] = [],
): string[] {
  const keys: string[] = [];
  items.forEach((item, index) => {
    const path = [...indexPath, index];
    if (item.items.length > 0) {
      keys.push(outlineItemKey(item, path));
      keys.push(...collectCollapsibleKeys(item.items, path));
    }
  });
  return keys;
}

function OutlineItem({
  item,
  indexPath,
  collapsedKeys,
  onToggle,
  onNavigate,
}: {
  item: PdfOutlineItem;
  indexPath: number[];
  collapsedKeys: Set<string>;
  onToggle: (key: string) => void;
  onNavigate: (item: PdfOutlineItem) => void;
}) {
  const key = outlineItemKey(item, indexPath);
  const hasChildren = item.items.length > 0;
  const isCollapsed = collapsedKeys.has(key);

  return (
    <li>
      <div
        className="flex min-w-0 items-center gap-1"
        style={{ paddingLeft: `${Math.max(0, indexPath.length - 1) * 12}px` }}
      >
        <button
          type="button"
          onClick={() => onToggle(key)}
          disabled={!hasChildren}
          aria-label={isCollapsed ? "Expand outline section" : "Collapse outline section"}
          className="flex h-5 w-4 shrink-0 items-center justify-center text-[10px] text-gray-300 transition-colors hover:text-white disabled:cursor-default disabled:text-transparent"
        >
          {isCollapsed ? ">" : "v"}
        </button>
        <button
          type="button"
          onClick={() => onNavigate(item)}
          disabled={!item.dest}
          className="min-w-0 flex-1 truncate rounded px-1 py-0.5 text-left text-xs leading-5 text-gray-200 transition-colors hover:bg-gray-700 hover:text-white disabled:cursor-default disabled:text-gray-500 disabled:hover:bg-transparent"
          title={item.title}
        >
          {item.title}
        </button>
      </div>
      {hasChildren && !isCollapsed && (
        <ul>
          {item.items.map((child, childIndex) => (
            <OutlineItem
              key={outlineItemKey(child, [...indexPath, childIndex])}
              item={child}
              indexPath={[...indexPath, childIndex]}
              collapsedKeys={collapsedKeys}
              onToggle={onToggle}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function PdfViewerClient({
  clusterSlug = "",
  documentSlug = "",
  title,
  browserTitle,
  sourceUrl,
  readOnly = false,
}: Props) {
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
  const restoredPageRef = useRef(false);
  const [pageCount, setPageCount] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [scaleLabel, setScaleLabel] = useState("100%");
  const [loading, setLoading] = useState(true);
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [outlineLoading, setOutlineLoading] = useState(false);
  const [outline, setOutline] = useState<PdfOutlineItem[]>([]);
  const [collapsedOutlineKeys, setCollapsedOutlineKeys] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<PdfViewerMode>("select");
  const [query, setQuery] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [lastSavedAt, setLastSavedAt] = useState("");
  const [serverHistoryCount, setServerHistoryCount] = useState(0);
  const [documentTitle, setDocumentTitle] = useState(title);
  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);
  const [savingTitle, setSavingTitle] = useState(false);
  const [fastReadNote, setFastReadNote] = useState<FastReadNote | null>(null);
  const [fastReadLoading, setFastReadLoading] = useState(false);

  const pdfUrl = useMemo(() => {
    if (sourceUrl) return sourceUrl;
    const params = new URLSearchParams({ clusterSlug });
    return `/api/documents/${encodeURIComponent(documentSlug)}/source-pdf?${params.toString()}`;
  }, [clusterSlug, documentSlug, sourceUrl]);

  const historyUrl = useMemo(() => {
    if (readOnly || sourceUrl) return null;
    const params = new URLSearchParams({ clusterSlug });
    return `/api/documents/${encodeURIComponent(documentSlug)}/source-pdf/history?${params.toString()}`;
  }, [clusterSlug, documentSlug, readOnly, sourceUrl]);

  const editedFileName = useMemo(
    () =>
      readOnly && browserTitle?.trim()
        ? browserTitle.trim()
        : fileNameFromTitle(documentTitle || documentSlug),
    [browserTitle, documentSlug, documentTitle, readOnly],
  );

  // Remember the last viewed page per document so it reopens where you left off.
  const pageStorageKey = useMemo(
    () => `sb:pdf-last-page:${clusterSlug || "artifact"}:${documentSlug || browserTitle || title}`,
    [browserTitle, clusterSlug, documentSlug, title],
  );
  const readSavedPage = useCallback((): number | null => {
    try {
      const raw = Number(localStorage.getItem(pageStorageKey));
      return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : null;
    } catch {
      return null;
    }
  }, [pageStorageKey]);
  const writeSavedPage = useCallback(
    (page: number) => {
      try {
        if (Number.isFinite(page) && page >= 1) {
          localStorage.setItem(pageStorageKey, String(Math.floor(page)));
        }
      } catch {
        // Ignore storage failures (private mode, quota, etc.).
      }
    },
    [pageStorageKey],
  );

  useEffect(() => {
    setDocumentTitle(title);
    setDraftTitle(title);
  }, [title]);

  useEffect(() => {
    const nextTitle = browserTitle?.trim() || documentTitle || title || "PDF editor";
    document.title = nextTitle;
    return () => {
      document.title = "breadboard";
    };
  }, [browserTitle, documentTitle, title]);

  const clearScheduledSave = useCallback(() => {
    if (!saveTimeoutRef.current) return;
    clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = null;
  }, []);

  const saveEditedPdfToServer = useCallback(async (): Promise<boolean> => {
    if (readOnly) return true;
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
  }, [clearScheduledSave, pdfUrl, readOnly]);

  useEffect(() => {
    saveEditedPdfRef.current = saveEditedPdfToServer;
  }, [saveEditedPdfToServer]);

  const scheduleAutoSave = useCallback(() => {
    if (readOnly) return;
    clearScheduledSave();
    setSaveState("dirty");
    saveTimeoutRef.current = setTimeout(() => {
      void saveEditedPdfRef.current();
    }, 0);
  }, [clearScheduledSave, readOnly]);

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

  const loadOutline = useCallback(async (pdfDocument: PDFDocumentProxy) => {
    setOutlineLoading(true);
    setCollapsedOutlineKeys(new Set());
    try {
      const nextOutline = await pdfDocument.getOutline();
      const items = nextOutline ?? [];
      setOutline(items);
      // Start with every section collapsed so only top-level entries show.
      setCollapsedOutlineKeys(new Set(collectCollapsibleKeys(items)));
    } catch {
      setOutline([]);
    } finally {
      setOutlineLoading(false);
    }
  }, []);

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
        if (!readOnly) wireDocument(newDoc);
        linkService.setDocument(newDoc, null);
        findController.setDocument(newDoc);
        restoredPageRef.current = false;
        pdfViewer.setDocument(newDoc);
        setPageCount(newDoc.numPages);
        const reloadPage = readSavedPage();
        setPageNumber(reloadPage && reloadPage <= newDoc.numPages ? reloadPage : 1);
        await loadOutline(newDoc);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Could not reload PDF.");
      }
    },
    [clearScheduledSave, loadOutline, readOnly, readSavedPage, wireDocument],
  );

  const serverUndo = useCallback(async () => {
    if (!historyUrl || serverHistoryCount <= 0) return;
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

  const startRenameTitle = useCallback(() => {
    setDraftTitle(documentTitle);
    setEditingTitle(true);
  }, [documentTitle]);

  const cancelRenameTitle = useCallback(() => {
    setDraftTitle(documentTitle);
    setEditingTitle(false);
  }, [documentTitle]);

  const saveDocumentTitle = useCallback(async () => {
    if (readOnly || !clusterSlug || !documentSlug) return;
    const nextTitle = draftTitle.trim().replace(/\s+/g, " ");
    if (!nextTitle) {
      setError("PDF name cannot be empty.");
      return;
    }
    if (nextTitle === documentTitle) {
      setEditingTitle(false);
      return;
    }

    setSavingTitle(true);
    setError("");
    try {
      const params = new URLSearchParams({ clusterSlug });
      const response = await fetch(
        `/api/documents/${encodeURIComponent(documentSlug)}?${params.toString()}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: nextTitle }),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.success) {
        throw new Error(
          typeof body.error === "string" ? body.error : "Could not rename PDF.",
        );
      }
      setDocumentTitle(
        typeof body.title === "string" && body.title.trim()
          ? body.title
          : nextTitle,
      );
      setDraftTitle(
        typeof body.title === "string" && body.title.trim()
          ? body.title
          : nextTitle,
      );
      setEditingTitle(false);
      router.refresh();
    } catch (renameError) {
      setError(
        renameError instanceof Error
          ? renameError.message
          : "Could not rename PDF.",
      );
    } finally {
      setSavingTitle(false);
    }
  }, [clusterSlug, documentSlug, documentTitle, draftTitle, readOnly, router]);

  useEffect(() => {
    if (readOnly) return;
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
  }, [readOnly, saveState]);

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
    setOutline([]);
    setCollapsedOutlineKeys(new Set());
    setMode("select");
    setSaveState("saved");
    setLastSavedAt("");
    restoredPageRef.current = false;
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
        eventBus.on("pagesinit", () => {
          const viewer = pdfViewerRef.current;
          restoredPageRef.current = true;
          if (!viewer) return;
          const total = viewer.pagesCount || 0;
          const saved = readSavedPage();
          if (saved && total > 0 && saved <= total) {
            try {
              viewer.currentPageNumber = saved;
            } catch {
              // Page views may not be laid out yet; pdf.js clamps the value.
            }
            setPageNumber(saved);
          }
        });
        eventBus.on("pagechanging", (event) => {
          const nextPage = Number(event.pageNumber);
          if (!Number.isFinite(nextPage)) return;
          setPageNumber(nextPage);
          if (restoredPageRef.current) writeSavedPage(nextPage);
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
          if (!readOnly) {
            // Always schedule save — covers any undo-stack change PDF.js fires this for
            scheduleAutoSave();
          }
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
        if (!readOnly) wireDocument(pdfDocument);
        linkService.setDocument(pdfDocument, null);
        findController.setDocument(pdfDocument);
        pdfViewer.setDocument(pdfDocument);
        pdfViewer.currentScaleValue = "page-width";
        setPageCount(pdfDocument.numPages);
        const initialPage = readSavedPage();
        setPageNumber(
          initialPage && initialPage <= pdfDocument.numPages ? initialPage : 1,
        );
        await loadOutline(pdfDocument);

        // Fetch server history count so Ctrl+Z can fall back to it
        if (historyUrl) {
          const histResp = await fetch(historyUrl).catch(() => null);
          if (!cancelled && histResp?.ok) {
            const histData = await histResp.json().catch(() => ({ count: 0 }));
            setServerHistoryCount(typeof histData.count === "number" ? histData.count : 0);
          }
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
      if (!readOnly && inContainer(event)) {
        setTimeout(() => { void saveEditedPdfRef.current(); }, 50);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (!readOnly && inContainer(event)) {
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
  }, [
    clearScheduledSave,
    historyUrl,
    loadOutline,
    pdfUrl,
    readOnly,
    readSavedPage,
    scheduleAutoSave,
    wireDocument,
    writeSavedPage,
  ]);

  const goBack = useCallback(async () => {
    if (readOnly) {
      startNavigationProgress();
      router.back();
      return;
    }
    if (saveState === "saving") {
      setError("Please wait for the PDF save to finish before leaving.");
      return;
    }

    if (saveState === "dirty" || saveState === "error") {
      const saved = await saveEditedPdfToServer();
      if (!saved) return;
    }

    startNavigationProgress();
    router.push(`/gardens/${clusterSlug}`);
  }, [clusterSlug, readOnly, router, saveEditedPdfToServer, saveState]);

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
    if (readOnly) return;
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
  }, [readOnly]);

  const toggleOutlineItem = useCallback((key: string) => {
    setCollapsedOutlineKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const goToOutlineItem = useCallback((item: PdfOutlineItem) => {
    const destination = item.dest;
    if (!destination) return;
    void linkServiceRef.current?.goToDestination(destination);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (readOnly) return;
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
  }, [readOnly]);

  const runFind = useCallback(
    (type: "again" | "" = "", findPrevious = false) => {
      eventBusRef.current?.dispatch("find", {
        caseSensitive: false,
        entireWord: false,
        findPrevious,
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

  // Ingest writes the PDF's text into a markdown note beside the file, so that
  // note is what Fast-read reads: it keeps the headings, figures, and equations
  // the reader stops on. A PDF with no note behind it — a chat artifact, or one
  // whose note was deleted — falls back to the file's own text layer.
  const openFastRead = useCallback(async () => {
    if (fastReadLoading) return;
    setFastReadLoading(true);
    setError("");

    try {
      if (clusterSlug && documentSlug) {
        try {
          setFastReadNote(await fetchFastReadNote(clusterSlug, documentSlug));
          return;
        } catch {
          // Fall through to the PDF itself.
        }
      }

      const pdfDocument = pdfDocumentRef.current;
      if (!pdfDocument) throw new Error("The PDF is still opening.");

      const pages: PdfTextPageLike[] = [];
      for (let page = 1; page <= pdfDocument.numPages; page += 1) {
        const loadedPage = await pdfDocument.getPage(page);
        pages.push(await loadedPage.getTextContent());
      }

      const content = pdfTextToMarkdown(pages);
      if (!content) {
        throw new Error(
          "This PDF has no text layer to read — it is scanned images only.",
        );
      }
      setFastReadNote({ title: documentTitle || title, content });
    } catch (fastReadError) {
      setError(
        fastReadError instanceof Error
          ? fastReadError.message
          : "Could not open Fast-read.",
      );
    } finally {
      setFastReadLoading(false);
    }
  }, [clusterSlug, documentSlug, documentTitle, fastReadLoading, title]);

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

      <header className="breadboard-flower-navbar relative flex flex-wrap items-center justify-between gap-3 border-b border-gray-800 px-4 py-3">
        <NavbarFlowerWind />
        <div className="relative z-10 flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={goBack}
            className="rounded-md border border-gray-800 px-3 py-1.5 text-xs text-gray-400 transition-colors hover:border-gray-600 hover:text-white"
          >
            Back
          </button>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-gray-600">
              {readOnly ? "PDF artifact" : "PDF source"}
            </p>
            {!readOnly && editingTitle ? (
              <form
                className="flex min-w-0 items-center gap-1.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveDocumentTitle();
                }}
              >
                <input
                  value={draftTitle}
                  onChange={(event) => setDraftTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      cancelRenameTitle();
                    }
                  }}
                  autoFocus
                  disabled={savingTitle}
                  className="h-8 min-w-0 max-w-sm rounded-md border border-gray-700 bg-gray-900 px-2 text-sm font-semibold text-white outline-none transition-colors focus:border-gray-500 disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={savingTitle}
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-gray-800 text-gray-400 transition-colors hover:border-gray-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                  title="Save PDF name"
                  aria-label="Save PDF name"
                >
                  {savingTitle ? (
                    <Spinner className="h-3.5 w-3.5" />
                  ) : (
                    <svg
                      className="h-3.5 w-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="m4.5 12.75 6 6 9-13.5"
                      />
                    </svg>
                  )}
                </button>
                <button
                  type="button"
                  onClick={cancelRenameTitle}
                  disabled={savingTitle}
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-gray-800 text-gray-500 transition-colors hover:border-gray-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                  title="Cancel rename"
                  aria-label="Cancel rename"
                >
                  <svg
                    className="h-3.5 w-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6 18 18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </form>
            ) : (
              <div className="flex min-w-0 items-center gap-1.5">
                <h1 className="truncate text-sm font-semibold text-white">
                  {documentTitle}
                </h1>
                {!readOnly ? (
                  <button
                    type="button"
                    onClick={startRenameTitle}
                    className="shrink-0 rounded p-1 text-gray-600 transition-colors hover:bg-gray-900 hover:text-white"
                    title="Rename PDF"
                    aria-label="Rename PDF"
                  >
                    <svg
                      className="h-3.5 w-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.8}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.862 4.487Z"
                      />
                    </svg>
                  </button>
                ) : null}
              </div>
            )}
          </div>
        </div>
        <div className="relative z-10 flex flex-wrap items-center gap-2">
          {!readOnly ? (
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
          ) : null}
          {!readOnly && serverHistoryCount > 0 && (
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
          {!readOnly && clusterSlug && documentSlug ? (
            <Link
              href={`/garden/${clusterSlug}?note=${encodeURIComponent(documentSlug)}`}
              className="rounded-md border border-gray-800 px-3 py-1.5 text-xs text-gray-400 transition-colors hover:border-gray-600 hover:text-white"
            >
              Source note
            </Link>
          ) : null}
          <a
            href={pdfUrl}
            className="rounded-md border border-gray-800 px-3 py-1.5 text-xs text-gray-400 transition-colors hover:border-gray-600 hover:text-white"
          >
            Open PDF
          </a>
          {!readOnly ? (
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
          ) : null}
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
            onClick={() => setOutlineOpen((open) => !open)}
            disabled={loading}
            className={`rounded-md border px-3 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              outlineOpen
                ? "border-gray-600 bg-gray-800 text-white"
                : "border-gray-700 bg-gray-900 text-gray-300 hover:border-gray-500 hover:text-white"
            }`}
            aria-pressed={outlineOpen}
            aria-expanded={outlineOpen}
            aria-controls="pdf-document-outline"
          >
            Outline
          </button>
          <button
            type="button"
            onClick={() => void openFastRead()}
            disabled={loading || fastReadLoading}
            title="Speed-read this PDF one word at a time"
            className="flex items-center gap-1.5 rounded-md border border-gray-700 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.8}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 4 6 13h5l-1 7 7-9h-5z" />
            </svg>
            {fastReadLoading ? "Opening..." : "Fast-read"}
          </button>
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
            onClick={() => runFind("again", true)}
            disabled={loading || !query.trim()}
            className="rounded-md border border-gray-700 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Previous match
          </button>
          <button
            type="button"
            onClick={() => runFind("again", false)}
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
            {exporting ? "Preparing" : readOnly ? "Download PDF" : "Save PDF"}
          </button>
          {!readOnly ? (
            <div className="flex rounded-md border border-gray-800 bg-gray-950 p-0.5">
              {(["select", "highlight", "text", "draw"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setEditorMode(item)}
                  disabled={loading}
                  aria-pressed={mode === item}
                  className={`rounded px-2.5 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                    mode === item
                      ? "bg-gray-800 text-white shadow-sm"
                      : "text-gray-400 hover:bg-gray-900 hover:text-gray-200"
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
          ) : null}
        </div>
      </div>

      <section className="relative flex min-h-0 flex-1 bg-gray-900">
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
        {outlineOpen && (
        <aside
          id="pdf-document-outline"
          className="hidden w-64 shrink-0 border-r border-gray-800 bg-[#ece6d8] text-gray-100 shadow-inner md:flex md:min-h-0 md:flex-col"
        >
          <div className="flex h-11 shrink-0 items-center gap-2 border-b border-gray-700/60 px-4">
            <svg
              className="h-4 w-4 text-gray-200"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M4 4h4v4H4V4Zm8 0h4v4h-4V4ZM4 12h4v4H4v-4Zm8 0h4v4h-4v-4Z" />
            </svg>
            <span className="truncate text-sm font-medium">Document outline</span>
            <button
              type="button"
              onClick={() => setOutlineOpen(false)}
              className="ml-auto flex h-7 w-7 items-center justify-center rounded text-gray-300 transition-colors hover:bg-gray-700 hover:text-white"
              aria-label="Close document outline"
              title="Close document outline"
            >
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto overscroll-contain px-2 py-3">
            {outlineLoading ? (
              <div className="flex items-center gap-2 px-2 text-xs text-gray-300">
                <Spinner className="h-3.5 w-3.5" />
                Loading outline
              </div>
            ) : outline.length > 0 ? (
              <ul className="space-y-0.5">
                {outline.map((item, index) => (
                  <OutlineItem
                    key={outlineItemKey(item, [index])}
                    item={item}
                    indexPath={[index]}
                    collapsedKeys={collapsedOutlineKeys}
                    onToggle={toggleOutlineItem}
                    onNavigate={goToOutlineItem}
                  />
                ))}
              </ul>
            ) : (
              <p className="px-2 text-xs leading-5 text-gray-300">
                No document outline was found for this PDF.
              </p>
            )}
          </div>
        </aside>
        )}
        <div className="relative min-w-0 flex-1">
          <div
            id="viewerContainer"
            ref={containerRef}
            className="absolute inset-0 overflow-auto bg-gray-900 [--page-border:1px_solid_#c7d8cc] [--page-margin:12px_auto_4px] [--pdfViewer-padding-bottom:24px]"
          >
            <div ref={viewerRef} className="pdfViewer" />
          </div>
        </div>
      </section>

      {fastReadNote && (
        <FastReadReader
          title={fastReadNote.title}
          content={fastReadNote.content}
          onClose={() => setFastReadNote(null)}
        />
      )}
    </main>
  );
}
