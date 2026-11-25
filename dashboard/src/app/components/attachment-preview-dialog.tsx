"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  ContextMenuSurface,
  OpenInNewTabItem,
  OpenInNewWindowItem,
} from "@/app/components/link-context-menu";
import BreadboardVideoPlayer from "@/app/components/breadboard-video-player";
import BreadboardAudioPlayer from "@/app/components/breadboard-audio-player";
import ChatMarkdown from "@/app/components/chat-markdown";
import AttachmentSpreadsheetView, {
  sheetFromDelimitedText,
} from "@/app/components/attachment-spreadsheet-view";
import type { XlsxViewSheet } from "@/lib/document-structure/xlsx";
import { chatAttachmentHref } from "@/lib/chat-attachments";
import type { DocumentAttachmentFormat } from "@/lib/document-attachments";

export interface AttachmentPreviewSource {
  /**
   * `document` is a stored Office file (Word, Excel, PowerPoint, OpenDocument);
   * `file` is a stored ordinary file (text, CSV, code, SVG, HTML, archives).
   */
  kind: "pdf" | "audio" | "video" | "document" | "file";
  name: string;
  /**
   * What the popup shows: the PDF reader, the media stream, or for `document`
   * and `file` the JSON reading the popup draws from.
   */
  href: string;
  /** The original bytes, for the popup's download button. */
  downloadHref?: string;
  /** A full-page reader, offered from the right-click menu only. */
  pageHref?: string;
  /** Names used by older transcript rows for the same Garden source. */
  aliases?: readonly string[];
  /** False for formats such as AVI and Matroska that browsers cannot decode. */
  playable?: boolean;
}

interface Props {
  source: AttachmentPreviewSource;
  children: ReactNode;
  className?: string;
  title?: string;
}

/** The popup for one stored document, by blob id. */
export function documentPreviewSource(attachment: {
  name: string;
  blobId: string;
  format: DocumentAttachmentFormat;
}): AttachmentPreviewSource {
  const id = encodeURIComponent(attachment.blobId);
  const pageHref = chatAttachmentHref({ type: "document", ...attachment });
  const downloadHref = `/api/chat-attachments/documents/${id}`;
  if (attachment.format === "pdf") {
    return { kind: "pdf", name: attachment.name, href: pageHref, downloadHref };
  }
  return {
    kind: "document",
    name: attachment.name,
    href: `/api/chat-attachments/documents/${id}/view`,
    downloadHref,
    pageHref,
  };
}

/** The popup for one stored ordinary file, by blob id. */
export function storedFilePreviewSource(attachment: {
  name: string;
  blobId: string;
}): AttachmentPreviewSource {
  const id = encodeURIComponent(attachment.blobId);
  return {
    kind: "file",
    name: attachment.name,
    href: `/api/chat-attachments/files/${id}/view`,
    downloadHref: `/api/chat-attachments/files/${id}/view?download=1`,
  };
}

function PreviewContextMenu({
  source,
  children,
}: {
  source: AttachmentPreviewSource;
  children: ReactNode;
}) {
  const pageHref = source.kind === "document" ? source.pageHref : source.href;
  if (!pageHref) return <>{children}</>;
  const label = source.kind === "pdf" ? "PDF" : source.kind === "document" ? "document" : "video";
  return (
    <ContextMenuSurface
      label={`${label} actions for ${source.name}`}
      menu={
        <>
          <OpenInNewTabItem href={pageHref}>
            Open {label} in new tab
          </OpenInNewTabItem>
          <OpenInNewWindowItem href={pageHref}>
            Open {label} in new window
          </OpenInNewWindowItem>
        </>
      }
    >
      {children as ReactElement}
    </ContextMenuSurface>
  );
}

type Reading =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; data: Record<string, unknown> };

function useReading(href: string, attempt: number): Reading {
  const [reading, setReading] = useState<{ key: string; value: Reading }>({
    key: "",
    value: { state: "loading" },
  });
  const key = `${href}#${attempt}`;
  useEffect(() => {
    const controller = new AbortController();
    fetch(href, { signal: controller.signal, credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 404 ? "This file is no longer stored." : `The file could not be read (${response.status}).`);
        return (await response.json()) as Record<string, unknown>;
      })
      .then((data) => setReading({ key, value: { state: "ready", data } }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setReading({
          key,
          value: { state: "error", message: error instanceof Error ? error.message : "The file could not be read." },
        });
      });
    return () => controller.abort();
  }, [href, key]);
  return reading.key === key ? reading.value : { state: "loading" };
}

function ReadingSkeleton() {
  return (
    <div className="h-full p-6" aria-busy="true" aria-label="Loading preview">
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        {[92, 78, 85, 60, 88, 70].map((width, index) => (
          <div
            key={index}
            className="h-3 animate-pulse rounded bg-[var(--paper-strong)]"
            style={{ width: `${width}%` }}
          />
        ))}
      </div>
    </div>
  );
}

function ReadingError({ message, onRetry, downloadHref, name }: { message: string; onRetry: () => void; downloadHref?: string; name: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="text-sm text-[var(--ink-muted)]">{message}</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-1.5 text-sm text-[var(--ink-heading)] transition hover:border-[var(--botanical)]"
        >
          Try again
        </button>
        {downloadHref ? (
          <a
            href={downloadHref}
            download={name}
            className="rounded-lg border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-1.5 text-sm text-[var(--ink-heading)] transition hover:border-[var(--botanical)]"
          >
            Download
          </a>
        ) : null}
      </div>
    </div>
  );
}

function PaperSheet({ markdown, warnings, emptyText }: { markdown: string; warnings: readonly string[]; emptyText: string }) {
  const [scale, setScale] = useState(1);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-end gap-1 border-b border-[var(--line)] px-3 py-1.5">
        <button
          type="button"
          onClick={() => setScale((value) => Math.max(0.7, Math.round((value - 0.1) * 10) / 10))}
          className="grid h-7 w-7 place-items-center rounded-md border border-[var(--line)] text-sm text-[var(--ink-muted)] transition hover:bg-[var(--paper-strong)] hover:text-[var(--ink-heading)]"
          aria-label="Zoom out"
        >
          −
        </button>
        <button type="button" onClick={() => setScale(1)} className="w-12 text-center text-xs tabular-nums text-[var(--ink-muted)]" title="Reset zoom">
          {Math.round(scale * 100)}%
        </button>
        <button
          type="button"
          onClick={() => setScale((value) => Math.min(2.4, Math.round((value + 0.1) * 10) / 10))}
          className="grid h-7 w-7 place-items-center rounded-md border border-[var(--line)] text-sm text-[var(--ink-muted)] transition hover:bg-[var(--paper-strong)] hover:text-[var(--ink-heading)]"
          aria-label="Zoom in"
        >
          +
        </button>
      </div>
      {warnings.length ? (
        <div className="shrink-0 border-b border-[var(--line)] bg-[var(--paper-strong)] px-4 py-1.5 text-xs text-[var(--ink-muted)]">
          {warnings.map((warning) => <p key={warning}>{warning}</p>)}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto bg-[var(--paper-strong)] px-4 py-6">
        <article
          style={{ fontSize: `${scale}rem` }}
          className="mx-auto w-full max-w-[52rem] rounded-sm border border-[#c7d8cc] bg-[#fbfaf6] px-6 py-8 text-gray-900 shadow-xl sm:px-10 sm:py-12"
        >
          {markdown.trim() ? (
            <ChatMarkdown content={markdown} />
          ) : (
            <p className="text-sm leading-6 text-gray-600">{emptyText}</p>
          )}
        </article>
      </div>
    </div>
  );
}

function DocumentBody({ source }: { source: AttachmentPreviewSource }) {
  const [attempt, setAttempt] = useState(0);
  const reading = useReading(source.href, attempt);
  if (reading.state === "loading") return <ReadingSkeleton />;
  if (reading.state === "error") {
    return <ReadingError message={reading.message} onRetry={() => setAttempt((value) => value + 1)} downloadHref={source.downloadHref} name={source.name} />;
  }
  const data = reading.data;
  const warnings = Array.isArray(data.warnings) ? (data.warnings as string[]) : [];
  if (Array.isArray(data.sheets)) {
    return <AttachmentSpreadsheetView sheets={data.sheets as XlsxViewSheet[]} warnings={warnings} />;
  }
  return (
    <PaperSheet
      markdown={typeof data.markdown === "string" ? data.markdown : ""}
      warnings={warnings}
      emptyText="Nothing readable came out of this file. Download the original to open it in the application that wrote it."
    />
  );
}

function svgDataUrl(text: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
}

function FileBody({ source }: { source: AttachmentPreviewSource }) {
  const [attempt, setAttempt] = useState(0);
  const [showSource, setShowSource] = useState(false);
  const reading = useReading(source.href, attempt);
  if (reading.state === "loading") return <ReadingSkeleton />;
  if (reading.state === "error") {
    return <ReadingError message={reading.message} onRetry={() => setAttempt((value) => value + 1)} downloadHref={source.downloadHref} name={source.name} />;
  }
  const data = reading.data;
  const format = typeof data.format === "string" ? data.format : "";
  if (data.textual !== true || typeof data.text !== "string") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm text-[var(--ink-muted)]">
          {format === "zip" ? "This is an archive" : "This file is not text"}, so it has no preview here.
        </p>
        {source.downloadHref ? (
          <a
            href={source.downloadHref}
            download={source.name}
            className="rounded-lg border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-1.5 text-sm text-[var(--ink-heading)] transition hover:border-[var(--botanical)]"
          >
            Download
          </a>
        ) : null}
      </div>
    );
  }
  const text = data.text;
  const note = data.truncated ? ["This file is large; only the first part is shown. Download it for the rest."] : [];
  if (format === "csv" || format === "tsv") {
    return <AttachmentSpreadsheetView sheets={[sheetFromDelimitedText(source.name, text, format === "tsv" ? "\t" : ",")]} warnings={note} />;
  }
  if (format === "md" || format === "markdown") {
    return <PaperSheet markdown={text} warnings={note} emptyText="This file is empty." />;
  }
  const renderable = format === "svg" || format === "html" || format === "htm";
  const lines = text.split(/\r?\n/);
  return (
    <div className="flex h-full min-h-0 flex-col">
      {renderable ? (
        <div className="flex shrink-0 items-center gap-1 border-b border-[var(--line)] px-3 py-1.5">
          {(["Preview", "Source"] as const).map((label) => {
            const active = (label === "Source") === showSource;
            return (
              <button
                key={label}
                type="button"
                onClick={() => setShowSource(label === "Source")}
                aria-pressed={active}
                className={`rounded-md px-3 py-1 text-xs transition ${active ? "bg-[var(--paper-strong)] font-medium text-[var(--ink-heading)]" : "text-[var(--ink-muted)] hover:text-[var(--ink-heading)]"}`}
              >
                {label}
              </button>
            );
          })}
        </div>
      ) : null}
      {note.length ? (
        <p className="shrink-0 border-b border-[var(--line)] bg-[var(--paper-strong)] px-4 py-1.5 text-xs text-[var(--ink-muted)]">{note[0]}</p>
      ) : null}
      {renderable && !showSource ? (
        format === "svg" ? (
          <div className="grid min-h-0 flex-1 place-items-center overflow-auto bg-[var(--paper-strong)] p-6">
            {/* An SVG drawn as an image cannot run script. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={svgDataUrl(text)} alt={source.name} className="max-h-full max-w-full rounded-md bg-white object-contain p-2" />
          </div>
        ) : (
          <iframe
            title={`${source.name} preview`}
            sandbox=""
            srcDoc={text}
            referrerPolicy="no-referrer"
            className="min-h-0 w-full flex-1 border-0 bg-white"
          />
        )
      ) : (
        <div className="min-h-0 flex-1 overflow-auto bg-[var(--paper-raised)]">
          <pre className="m-0 min-w-max py-3 font-mono text-xs leading-5 text-[var(--ink)]">
            {lines.map((line, index) => (
              <div key={index} className="flex">
                <span className="sticky left-0 w-12 shrink-0 select-none bg-[var(--paper-raised)] pr-3 text-right text-[var(--ink-muted)] opacity-70">
                  {index + 1}
                </span>
                <span className="whitespace-pre pr-6">{line || " "}</span>
              </div>
            ))}
          </pre>
        </div>
      )}
    </div>
  );
}

/**
 * A file-name trigger that previews retained attachments without navigating
 * away from the conversation. Audio intentionally has no custom context menu;
 * PDF, documents and video retain the open-in-tab and open-in-window menu.
 */
export default function AttachmentPreviewDialog({
  source,
  children,
  className,
  title,
}: Props) {
  const sourceIdentity = `${source.kind}:${source.href}:${source.name}`;
  const [dialogState, setDialogState] = useState(() => ({
    sourceIdentity,
    open: false,
  }));
  const pointerActivationAtRef = useRef<number | null>(null);
  const open =
    dialogState.sourceIdentity === sourceIdentity && dialogState.open;

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setDialogState({ sourceIdentity, open: nextOpen });
    },
    [sourceIdentity],
  );

  const trigger = (
    <DialogPrimitive.Trigger asChild>
      <button
        type="button"
        className={className}
        title={title ?? `Open ${source.name}`}
        aria-label={`Open ${source.name} preview`}
        onPointerDown={(event) => {
          pointerActivationAtRef.current = event.timeStamp;
        }}
        onPointerCancel={() => {
          pointerActivationAtRef.current = null;
        }}
        onClick={(event) => {
          // The document-level hydration bridge can replay an early click, but
          // it cannot replay the pointer sequence that located the control.
          // Chat rows move substantially when their virtual measurements land,
          // so accepting that detached click can open a PDF whose chip is now
          // far outside the viewport. Keyboard activation has detail === 0 and
          // remains supported.
          const pointerActivationAt = pointerActivationAtRef.current;
          const pointerActivationDelay =
            pointerActivationAt === null
              ? Number.POSITIVE_INFINITY
              : event.timeStamp - pointerActivationAt;
          const hasDirectActivation =
            event.detail === 0 ||
            (pointerActivationDelay >= 0 && pointerActivationDelay <= 1_000);
          pointerActivationAtRef.current = null;
          if (!hasDirectActivation) event.preventDefault();
        }}
      >
        {children}
      </button>
    </DialogPrimitive.Trigger>
  );

  const large = source.kind === "pdf" || source.kind === "document" || source.kind === "file";
  const description =
    source.kind === "pdf"
      ? "PDF attachment preview"
      : source.kind === "document" || source.kind === "file"
        ? "Attachment preview"
        : `${source.kind} attachment player`;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      {source.kind === "audio" || source.kind === "file" ? (
        trigger
      ) : (
        <PreviewContextMenu source={source}>{trigger}</PreviewContextMenu>
      )}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="bb-viewer-overlay fixed z-[240] bg-black/75 backdrop-blur-sm" />
        <DialogPrimitive.Content
          className={[
            "fixed left-1/2 top-1/2 z-[241] flex -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden",
            "rounded-2xl border border-white/15 bg-[var(--paper-raised)] shadow-2xl focus:outline-none",
            large
              ? "h-[min(90vh,60rem)] w-[min(94vw,80rem)]"
              : "w-[min(92vw,64rem)]",
          ].join(" ")}
        >
          <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--line)] px-4">
            <DialogPrimitive.Title className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--ink-heading)]">
              {source.name}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">
              {description}
            </DialogPrimitive.Description>
            {source.downloadHref ? (
              <a
                href={source.downloadHref}
                download={source.name}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[var(--ink-muted)] transition hover:bg-[var(--paper-strong)] hover:text-[var(--ink-heading)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--botanical)]"
                aria-label={`Download ${source.name}`}
                title="Download"
              >
                <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M8 2v7.5M5.25 7 8 9.75 10.75 7" />
                  <path d="M3 11.5v1.25c0 .7.55 1.25 1.25 1.25h7.5c.7 0 1.25-.55 1.25-1.25V11.5" />
                </svg>
              </a>
            ) : null}
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[var(--ink-muted)] transition hover:bg-[var(--paper-strong)] hover:text-[var(--ink-heading)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--botanical)]"
                aria-label="Close attachment preview"
              >
                <svg
                  aria-hidden
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </DialogPrimitive.Close>
          </header>

          <div className="min-h-0 flex-1">
            {source.kind === "pdf" ? (
              <iframe
                src={source.href}
                title={`${source.name} PDF preview`}
                className="h-full w-full border-0 bg-white"
              />
            ) : source.kind === "document" ? (
              <DocumentBody source={source} />
            ) : source.kind === "file" ? (
              <FileBody source={source} />
            ) : source.kind === "audio" ? (
              <div className="p-5">
                <BreadboardAudioPlayer
                  src={source.href}
                  label={source.name}
                  className="w-full"
                />
              </div>
            ) : source.playable === false ? (
              <div className="flex min-h-48 flex-col items-center justify-center gap-3 p-8 text-center">
                <p className="text-sm text-[var(--ink-muted)]">
                  This video format cannot be played by the browser.
                </p>
                <a
                  href={source.href}
                  download={source.name}
                  className="rounded-lg border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2 text-sm text-[var(--ink-heading)] transition hover:border-[var(--botanical)]"
                >
                  Download video
                </a>
              </div>
            ) : (
              <BreadboardVideoPlayer
                autoPlay
                src={source.href}
                title={source.name}
                className="max-h-[calc(90vh_-_4rem)] rounded-none"
              />
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
