"use client";

import { useEffect, useState, type ReactNode } from "react";
import AttachmentPreviewDialog, {
  type AttachmentPreviewSource,
} from "@/app/components/attachment-preview-dialog";
import type { XlsxViewSheet } from "@/lib/document-structure/xlsx";

/* ------------------------------------------------------------------------ */
/* File kinds                                                                */
/* ------------------------------------------------------------------------ */

export type AttachmentFileKind =
  | "spreadsheet"
  | "pdf"
  | "document"
  | "presentation"
  | "text"
  | "code"
  | "file";

const KIND_LABEL: Record<AttachmentFileKind, string> = {
  spreadsheet: "Spreadsheet",
  pdf: "PDF",
  document: "Document",
  presentation: "Presentation",
  text: "Text",
  code: "Code",
  file: "File",
};

const SPREADSHEET = new Set(["xlsx", "xls", "xlsm", "ods", "csv", "tsv", "numbers"]);
const DOCUMENT = new Set(["docx", "doc", "odt", "rtf", "pages"]);
const PRESENTATION = new Set(["pptx", "ppt", "odp", "key"]);
const TEXT = new Set(["txt", "md", "markdown", "log"]);
const CODE = new Set([
  "js", "jsx", "mjs", "cjs", "ts", "tsx", "json", "xml", "html", "htm", "svg",
  "py", "rb", "go", "rs", "java", "c", "h", "cpp", "cs", "css", "scss", "yml",
  "yaml", "toml", "sh", "sql",
]);

function extensionOf(name: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(name.trim());
  return match ? match[1].toLowerCase() : "";
}

export function attachmentFileKind(name: string, format?: string): AttachmentFileKind {
  const ext = (format || extensionOf(name)).toLowerCase();
  if (ext === "pdf") return "pdf";
  if (SPREADSHEET.has(ext)) return "spreadsheet";
  if (DOCUMENT.has(ext)) return "document";
  if (PRESENTATION.has(ext)) return "presentation";
  if (TEXT.has(ext)) return "text";
  if (CODE.has(ext)) return "code";
  // A format the caller did not know may still be told by the name.
  if (format) return attachmentFileKind(name);
  return "file";
}

export function attachmentFileKindLabel(kind: AttachmentFileKind): string {
  return KIND_LABEL[kind];
}

/** The coloured file-type mark shown beside an attachment's name. */
export function FileKindIcon({
  kind,
  className = "h-5 w-5",
}: {
  kind: AttachmentFileKind;
  className?: string;
}) {
  if (kind === "spreadsheet") {
    return (
      <svg aria-hidden className={`${className} shrink-0 text-[#10a37f]`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinejoin="round">
        <rect x="4" y="4" width="16" height="16" rx="3.5" />
        <path d="M4 10h16M4 15h16M10 10v10" />
      </svg>
    );
  }
  if (kind === "pdf") {
    return (
      <svg aria-hidden className={`${className} shrink-0 text-[#e5484d]`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round">
        <path d="M7 13V4.5A1.5 1.5 0 0 1 8.5 3H14l4 4v6" />
        <path d="M14 3v4h4" />
        <text x="12" y="21.4" textAnchor="middle" fontSize="7.2" fontWeight="800" fill="currentColor" stroke="none" fontFamily="system-ui, sans-serif">PDF</text>
      </svg>
    );
  }
  if (kind === "presentation") {
    return (
      <svg aria-hidden className={`${className} shrink-0 text-[#f76b15]`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinejoin="round" strokeLinecap="round">
        <rect x="3.5" y="4.5" width="17" height="12" rx="2.5" />
        <path d="M12 16.5V20M8.5 20h7M8 12.5l2.5-3 2 2 3-3.5" />
      </svg>
    );
  }
  if (kind === "document" || kind === "text") {
    return (
      <svg aria-hidden className={`${className} shrink-0 text-[#3b82f6]`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinejoin="round" strokeLinecap="round">
        <path d="M8 4h8.5A2.5 2.5 0 0 1 19 6.5v11a2.5 2.5 0 0 1-2.5 2.5H8" />
        <rect x="4" y="8" width="9" height="8" rx="2" />
        <path d="M6.5 10.5l1 3 1-2 1 2 1-3" strokeWidth={1.4} />
      </svg>
    );
  }
  if (kind === "code") {
    return (
      <svg aria-hidden className={`${className} shrink-0 text-[#8e4ec6]`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinejoin="round" strokeLinecap="round">
        <rect x="3.5" y="4" width="17" height="16" rx="3" />
        <path d="m9.5 10-2.5 2 2.5 2M14.5 10l2.5 2-2.5 2" />
      </svg>
    );
  }
  return (
    <svg aria-hidden className={`${className} shrink-0 text-[var(--ink-muted)]`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round">
      <path d="M14 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8l-5-5Z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}

/* ------------------------------------------------------------------------ */
/* Thumbnails                                                                */
/* ------------------------------------------------------------------------ */

type Thumbnail =
  | { kind: "image"; src: string }
  | { kind: "sheet"; rows: string[][]; bold: boolean[][]; numeric: boolean[][] }
  | { kind: "lines"; lines: { text: string; heading: boolean }[]; mono: boolean }
  | { kind: "none" };

const thumbnailCache = new Map<string, Promise<Thumbnail>>();

type PdfJsModule = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<PdfJsModule> | null = null;
let pdfWorkerSrc: string | null = null;

const PROMISE_WITH_RESOLVERS_POLYFILL = `
if (!Promise.withResolvers) {
  Promise.withResolvers = function withResolvers() {
    var resolve;
    var reject;
    var promise = new Promise(function executor(a, b) { resolve = a; reject = b; });
    return { promise: promise, resolve: resolve, reject: reject };
  };
}
`;

function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      // Older embedded Chromium builds lack it; pdf.js needs it.
      const promiseConstructor = Promise as unknown as { withResolvers?: unknown };
      if (!promiseConstructor.withResolvers) {
        promiseConstructor.withResolvers = function withResolvers() {
          let resolve!: (value: unknown) => void;
          let reject!: (reason?: unknown) => void;
          const promise = new Promise((a, b) => {
            resolve = a;
            reject = b;
          });
          return { promise, resolve, reject };
        };
      }
      // Same module the full PDF viewer loads, anchored to the page origin so
      // desktop chunks served from breadboard-assets:// still resolve it.
      return (await import(
        /* webpackIgnore: true */ new URL("/api/pdfjs/pdf.mjs", window.location.origin).href
      )) as PdfJsModule;
    })();
    pdfjsPromise.catch(() => {
      pdfjsPromise = null;
    });
  }
  return pdfjsPromise;
}

const THUMB_PIXEL_WIDTH = 280;

async function pdfThumbnail(href: string): Promise<Thumbnail> {
  const pdfjs = await loadPdfJs();
  // The full viewer swaps in (and later revokes) its own worker URL; set ours
  // each time so a thumbnail never starts on a revoked one.
  pdfWorkerSrc ??= URL.createObjectURL(
    new Blob(
      [
        PROMISE_WITH_RESOLVERS_POLYFILL,
        `\nawait import(${JSON.stringify(new URL("/api/pdfjs/pdf.worker.mjs", window.location.origin).href)});\n`,
      ],
      { type: "text/javascript" },
    ),
  );
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;
  const task = pdfjs.getDocument({ url: href, withCredentials: true, disableAutoFetch: true });
  const pdf = await task.promise;
  try {
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: THUMB_PIXEL_WIDTH / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(Math.min(viewport.height, viewport.width * 1.5));
    const context = canvas.getContext("2d");
    if (!context) return { kind: "none" };
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    return { kind: "image", src: canvas.toDataURL("image/png") };
  } finally {
    void pdf.destroy();
  }
}

function sheetThumbnail(sheets: XlsxViewSheet[]): Thumbnail {
  const sheet = sheets.find((candidate) => !candidate.hidden && candidate.rows.length) ?? sheets[0];
  if (!sheet) return { kind: "none" };
  const columns = Math.max(1, Math.min(sheet.columnCount || 1, 6));
  const rows: string[][] = [];
  const bold: boolean[][] = [];
  const numeric: boolean[][] = [];
  for (const row of sheet.rows.slice(0, 18)) {
    const values = Array.from({ length: columns }, () => "");
    const rowBold = Array.from({ length: columns }, () => false);
    const rowNumeric = Array.from({ length: columns }, () => false);
    for (const cell of row.cells) {
      if (cell.c >= columns) continue;
      values[cell.c] = cell.v;
      rowBold[cell.c] = Boolean(cell.b);
      rowNumeric[cell.c] = Boolean(cell.n);
    }
    rows.push(values);
    bold.push(rowBold);
    numeric.push(rowNumeric);
  }
  return rows.length ? { kind: "sheet", rows, bold, numeric } : { kind: "none" };
}

function delimitedThumbnail(text: string, separator: string): Thumbnail {
  const rows = text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .slice(0, 18)
    .map((line) => line.split(separator).slice(0, 6).map((cell) => cell.replace(/^"|"$/g, "")));
  if (!rows.length) return { kind: "none" };
  const width = Math.max(...rows.map((row) => row.length));
  const padded = rows.map((row) => [...row, ...Array.from({ length: width - row.length }, () => "")]);
  return {
    kind: "sheet",
    rows: padded,
    bold: padded.map((row, index) => row.map(() => index === 0)),
    numeric: padded.map((row) => row.map((cell) => /^-?[\d.,]+%?$/.test(cell.trim()))),
  };
}

function markdownLines(markdown: string): Thumbnail {
  const lines: { text: string; heading: boolean }[] = [];
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^[-|:\s]+$/.test(line) || line.startsWith("<!--")) continue;
    const heading = /^#{1,6}\s/.test(line) || /^\*\*[^*]+\*\*$/.test(line);
    const text = line
      .replace(/^#{1,6}\s+/, "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[*_`>]/g, "")
      .replace(/^\s*[-+]\s+/, "• ")
      .replace(/\|/g, "  ")
      .trim();
    if (text) lines.push({ text, heading });
    if (lines.length >= 30) break;
  }
  return lines.length ? { kind: "lines", lines, mono: false } : { kind: "none" };
}

async function readJson(href: string): Promise<Record<string, unknown>> {
  const response = await fetch(href, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`Preview request failed (${response.status})`);
  return (await response.json()) as Record<string, unknown>;
}

async function buildThumbnail(source: AttachmentPreviewSource): Promise<Thumbnail> {
  if (source.kind === "pdf") {
    return pdfThumbnail(source.downloadHref || source.href);
  }
  if (source.kind === "document") {
    const data = await readJson(source.href);
    if (Array.isArray(data.sheets)) return sheetThumbnail(data.sheets as XlsxViewSheet[]);
    return typeof data.markdown === "string" ? markdownLines(data.markdown) : { kind: "none" };
  }
  if (source.kind === "file") {
    const data = await readJson(source.href);
    if (data.textual !== true || typeof data.text !== "string") return { kind: "none" };
    const format = typeof data.format === "string" ? data.format : extensionOf(source.name);
    if (format === "csv") return delimitedThumbnail(data.text, ",");
    if (format === "tsv") return delimitedThumbnail(data.text, "\t");
    if (format === "md" || format === "markdown") return markdownLines(data.text);
    const lines = data.text
      .split(/\r?\n/)
      .slice(0, 30)
      .map((text) => ({ text: text.replace(/\t/g, "  "), heading: false }));
    return { kind: "lines", lines, mono: format !== "txt" };
  }
  return { kind: "none" };
}

function useThumbnail(source: AttachmentPreviewSource | null): Thumbnail | null {
  const key = source ? `${source.kind}:${source.downloadHref ?? ""}:${source.href}` : "";
  const [state, setState] = useState<{ key: string; value: Thumbnail | null }>({
    key: "",
    value: null,
  });
  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    let pending = thumbnailCache.get(key);
    if (!pending) {
      pending = buildThumbnail(source).catch((): Thumbnail => {
        // A failed read may succeed later (the upload may still be landing).
        thumbnailCache.delete(key);
        return { kind: "none" };
      });
      thumbnailCache.set(key, pending);
    }
    void pending.then((value) => {
      if (!cancelled) setState({ key, value });
    });
    return () => {
      cancelled = true;
    };
    // `source` is identified by `key`; a new object with the same key is the same file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state.key === key ? state.value : null;
}

/**
 * A miniature of the file's first page. Text-based previews are laid out at a
 * readable size and scaled down, so they look like a page rather than a list.
 */
function ThumbnailBody({ thumbnail, kind }: { thumbnail: Thumbnail | null; kind: AttachmentFileKind }) {
  if (!thumbnail) {
    return <div className="h-full w-full animate-pulse bg-[#f4f4f2]" aria-hidden />;
  }
  if (thumbnail.kind === "image") {
    // A rendered canvas, already local: nothing for next/image to optimise.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={thumbnail.src} alt="" className="h-full w-full object-cover object-top" draggable={false} />;
  }
  if (thumbnail.kind === "sheet") {
    return (
      <div className="h-full w-full overflow-hidden bg-white" aria-hidden>
        <table className="w-[300%] origin-top-left scale-[0.3333] border-collapse text-[11px] leading-[17px] text-[#1f1f1f]" style={{ tableLayout: "fixed" }}>
          <tbody>
            {thumbnail.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    className={`truncate border border-[#e3e3e3] px-1 ${thumbnail.numeric[rowIndex]?.[cellIndex] ? "text-right" : ""} ${thumbnail.bold[rowIndex]?.[cellIndex] ? "font-semibold" : ""}`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (thumbnail.kind === "lines") {
    return (
      <div className="h-full w-full overflow-hidden bg-white" aria-hidden>
        <div
          className={`w-[300%] origin-top-left scale-[0.3333] px-7 py-6 text-[12px] leading-[17px] text-[#2a2a2a] ${thumbnail.mono ? "font-mono" : ""}`}
        >
          {thumbnail.lines.map((line, index) => (
            <p
              key={index}
              className={`m-0 ${thumbnail.mono ? "whitespace-pre" : "mb-1.5 line-clamp-3"} ${line.heading ? "font-semibold text-black" : ""}`}
            >
              {line.text || " "}
            </p>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="grid h-full w-full place-items-center bg-[#f6f6f4]" aria-hidden>
      <FileKindIcon kind={kind} className="h-9 w-9 opacity-80" />
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Composer card: a page miniature with the file's mark and name beneath.    */
/* ------------------------------------------------------------------------ */

/** Matches the composer's image tiles so files and pictures line up. */
export const COMPOSER_ATTACHMENT_TILE_SIZE = "h-[120px] w-[120px]";

const CARD_FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--botanical)]";

export function ComposerDocumentCard({
  name,
  format,
  source,
  title,
  onRemove,
  removeDisabled,
}: {
  name: string;
  format?: string;
  /** The stored file to preview; null while it has no stored bytes. */
  source: AttachmentPreviewSource | null;
  title?: string;
  onRemove?: () => void;
  removeDisabled?: boolean;
}) {
  const kind = attachmentFileKind(name, format);
  const thumbnail = useThumbnail(source);
  const body = (
    <>
      <span className="absolute inset-0">
        <ThumbnailBody thumbnail={source ? thumbnail : { kind: "none" }} kind={kind} />
      </span>
      <span className="absolute inset-x-0 bottom-0 flex h-9 items-center gap-1.5 border-t border-[var(--line)] bg-[var(--paper-surface)] px-2">
        <FileKindIcon kind={kind} className="h-4 w-4" />
        <span className="min-w-0 flex-1 truncate text-left text-xs text-[var(--ink)]">{name}</span>
      </span>
    </>
  );
  const frame = `relative block ${COMPOSER_ATTACHMENT_TILE_SIZE} overflow-hidden rounded-2xl border border-[var(--line)] bg-white`;
  return (
    <div className="group relative shrink-0" data-testid="composer-document-card">
      {source ? (
        <AttachmentPreviewDialog
          source={source}
          className={`${frame} cursor-pointer transition hover:border-[var(--ink-muted)] ${CARD_FOCUS}`}
          title={title ?? `Open ${name}`}
        >
          {body}
        </AttachmentPreviewDialog>
      ) : (
        <div className={frame} title={title ?? name}>
          {body}
        </div>
      )}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          disabled={removeDisabled}
          className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--paper-raised)] text-[var(--ink)] opacity-0 shadow-[var(--neu-soft-shadow)] transition hover:bg-[var(--paper-strong)] focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-[var(--botanical)] group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100"
          aria-label={`Remove ${name}`}
        >
          <svg aria-hidden className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Message card: the file's mark, its name, and what kind of file it is.     */
/* ------------------------------------------------------------------------ */

const MESSAGE_CARD_CLASS =
  "flex h-16 w-[20rem] max-w-full min-w-0 items-center gap-3.5 rounded-2xl border border-[var(--line)] bg-[var(--paper-surface)] px-4 text-left";

export function MessageDocumentCard({
  name,
  format,
  source,
  title,
  trailing,
}: {
  name: string;
  format?: string;
  /** Opens the preview popup; null for a name with nothing stored to open. */
  source: AttachmentPreviewSource | null;
  title?: string;
  trailing?: ReactNode;
}) {
  const kind = attachmentFileKind(name, format);
  const content = (
    <>
      <FileKindIcon kind={kind} className="h-6 w-6" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-semibold text-[var(--ink-heading)]">{name}</span>
        <span className="truncate text-xs text-[var(--ink-muted)]">{attachmentFileKindLabel(kind)}</span>
      </span>
      {trailing}
    </>
  );
  if (!source) {
    return (
      <div className={MESSAGE_CARD_CLASS} title={title ?? name} data-testid="message-document-card">
        {content}
      </div>
    );
  }
  return (
    <AttachmentPreviewDialog
      source={source}
      className={`${MESSAGE_CARD_CLASS} cursor-pointer transition hover:border-[var(--ink-muted)] hover:bg-[var(--paper-raised)] ${CARD_FOCUS}`}
      title={title ?? `Open ${name}`}
    >
      {content}
    </AttachmentPreviewDialog>
  );
}
