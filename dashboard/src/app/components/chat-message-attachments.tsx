"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import AttachmentPreviewDialog, {
  documentPreviewSource,
  storedFilePreviewSource,
  type AttachmentPreviewSource,
} from "@/app/components/attachment-preview-dialog";
import {
  MessageDocumentCard,
  attachmentFileKind,
  attachmentFileKindLabel,
  type AttachmentFileKind,
} from "@/app/components/document-attachment-card";
import { openBrowserInDesktop } from "@/lib/desktop-browser-tabs";
import ModelAttachmentViewer from "@/app/components/model-attachment-viewer";
import { ChatVideoAttachmentCard } from "@/app/components/chat-video-link-embed";
import {
  visibleChatMessageAttachments,
  type ChatMessageAttachment,
} from "@/lib/chat-attachments";
import {
  chatVideoPlaybackHref,
  formatVideoSize,
  isPlayableVideoFormat,
  videoFormatLabel,
} from "@/lib/video-attachments";
import { formatAudioSize } from "@/lib/audio-attachments";

interface Props {
  attachments?: readonly ChatMessageAttachment[];
  /** Filename-only fallback for messages saved before image previews existed. */
  attachmentNames?: readonly string[];
  /** Garden sources focused for this turn that still have previewable bytes. */
  sourceAttachments?: readonly AttachmentPreviewSource[];
  /**
   * The message is being edited: show every attachment as a plain chip with a
   * remove control, so one can be left off the resend. The owner filters the
   * removed names out of the props above.
   */
  onRemove?: (name: string) => void;
}

/** One attached-file chip, whether it links anywhere or not. */
const FILE_CHIP_CLASS =
  "neu-inset flex max-w-64 items-center gap-1 rounded-md border border-[var(--line)] bg-[var(--paper-surface)] px-2 py-0.5 text-xs text-[var(--ink-muted)]";

function PaperclipIcon() {
  return (
    <svg
      className="h-3 w-3 shrink-0"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.7}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m18.4 12.7-7.1 7.1a5 5 0 0 1-7.1-7.1l8.5-8.5a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 1 1-2.9-2.8l7.8-7.8"
      />
    </svg>
  );
}

// The transcript passes freshly filtered arrays each render; equal contents
// should not re-render the image grid.
function attachmentPropsEqual(previous: Props, next: Props): boolean {
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]) as Set<keyof Props>;
  for (const key of keys) {
    const a = previous[key];
    const b = next[key];
    if (a === b) continue;
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    if (a.some((item, index) => item !== b[index])) return false;
  }
  return true;
}

/**
 * What a viewed page actually was. A browser tab or garden page can be a PDF
 * or a video, so the address (or, for older turns, the title) decides the
 * mark; a garden page keeps the garden leaf whatever it holds.
 */
function webPageCard(page: { title: string; url?: string }): { kind: AttachmentFileKind; subtitle: string } {
  let host = "";
  let path = "";
  let garden = false;
  if (page.url) {
    try {
      const url = new URL(page.url, "http://app.invalid");
      garden = url.host === "app.invalid" && url.pathname.startsWith("/garden/");
      host = url.host === "app.invalid" ? "" : url.hostname.replace(/^www\./, "");
      path = garden ? url.searchParams.get("note") ?? "" : decodeURIComponent(url.pathname);
    } catch {
      // A malformed address still has a title to go by.
    }
  }
  const fileKind = [path, page.title]
    .map((name) => attachmentFileKind(name))
    .find((kind) => kind !== "file") ?? "file";
  const fileLabel = fileKind === "file" ? "" : attachmentFileKindLabel(fileKind);
  if (garden) {
    return { kind: "garden", subtitle: fileLabel ? `Garden · ${fileLabel}` : "Garden page" };
  }
  const kind = fileKind === "pdf" || fileKind === "video" ? fileKind : "web";
  const label = kind === "web" ? "" : attachmentFileKindLabel(kind);
  return {
    kind,
    subtitle: [label, host].filter(Boolean).join(" · ") || "Web page",
  };
}

/** A site opens in a browser tab of its own, or a new window outside the app. */
function openSiteInNewTab(url: string) {
  void openBrowserInDesktop({ url }).then((opened) => {
    if (!opened) window.open(url, "_blank", "noopener,noreferrer");
  });
}

/**
 * The popup a page reference opens. A PDF turn already carries the PDF it was
 * asked about (hidden as reader context), so its card opens that stored copy
 * at the page that was in view. A web or garden page opens at its address.
 */
function pageReferenceSource(
  attachments: readonly ChatMessageAttachment[] | undefined,
  pdfPage: { title: string; pageNumber: number } | undefined,
  webPage: { title: string; url?: string } | undefined,
): AttachmentPreviewSource | null {
  if (pdfPage) {
    const pdf = attachments?.find(
      (attachment): attachment is Extract<ChatMessageAttachment, { type: "document" }> =>
        attachment.context === "pdf" && attachment.type === "document" && attachment.format === "pdf",
    );
    if (!pdf) return null;
    const source = documentPreviewSource(pdf);
    return {
      ...source,
      name: `${pdfPage.title} — page ${pdfPage.pageNumber}`,
      href: `${source.href}#page=${pdfPage.pageNumber}`,
    };
  }
  if (webPage?.url) return { kind: "web", name: webPage.title, href: webPage.url };
  return null;
}

function isPastedScreenshotName(name: string): boolean {
  return /^pasted-screenshot-\d+\.(?:png|jpe?g|webp|gif)$/i.test(name.trim());
}

function ChatMessageAttachments({
  attachments: allAttachments,
  attachmentNames: allAttachmentNames,
  sourceAttachments = [],
  onRemove,
}: Props) {
  const { attachments, attachmentNames } = useMemo(
    () => visibleChatMessageAttachments(allAttachments, allAttachmentNames),
    [allAttachments, allAttachmentNames],
  );
  const [openImageIndex, setOpenImageIndex] = useState<number | null>(null);
  const pdfPage = allAttachments?.find(attachment => attachment.context === "pdf" && attachment.pdfPage)?.pdfPage;
  const webPage = allAttachments?.find(attachment => attachment.context === "web" && attachment.webPage)?.webPage;
  const pageSource = useMemo(
    () => pageReferenceSource(allAttachments, pdfPage, webPage),
    [allAttachments, pdfPage, webPage],
  );
  const images = useMemo(
    () => attachments.filter(
      (attachment): attachment is Extract<ChatMessageAttachment, { type: "image" }> =>
        attachment.type === "image",
    ),
    [attachments],
  );
  const models = useMemo(
    () => attachments.filter(
      (attachment): attachment is Extract<ChatMessageAttachment, { type: "model" }> =>
        attachment.type === "model",
    ),
    [attachments],
  );
  const videos = useMemo(
    () => attachments.filter(
      (attachment): attachment is Extract<ChatMessageAttachment, { type: "video" }> =>
        attachment.type === "video",
    ),
    [attachments],
  );
  const tracks = useMemo(
    () => attachments.filter(
      (attachment): attachment is Extract<ChatMessageAttachment, { type: "audio" }> =>
        attachment.type === "audio",
    ),
    [attachments],
  );
  const products = useMemo(
    () => attachments.filter(
      (attachment): attachment is Extract<ChatMessageAttachment, { type: "product" }> =>
        attachment.type === "product",
    ),
    [attachments],
  );
  const fileEntries = useMemo(() => {
    const retainedNames = new Set([
      ...attachments.map((attachment) => attachment.name),
      ...sourceAttachments.flatMap((attachment) => [
        attachment.name,
        ...(attachment.aliases ?? []),
      ]),
    ]);
    return [
      ...attachments.filter(
        (attachment) =>
          attachment.type !== "image" &&
          attachment.type !== "model" &&
          attachment.type !== "video" &&
          attachment.type !== "audio" &&
          attachment.type !== "product",
      ),
      ...attachmentNames
        .filter(
          (name) =>
            !retainedNames.has(name) && !isPastedScreenshotName(name),
        )
        .map((name) => ({ type: "file" as const, name })),
    ];
  }, [attachmentNames, attachments, sourceAttachments]);

  useEffect(() => {
    if (openImageIndex === null) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenImageIndex(null);
      if (event.key === "ArrowLeft" && images.length > 1) {
        setOpenImageIndex((current) =>
          current === null ? null : (current - 1 + images.length) % images.length,
        );
      }
      if (event.key === "ArrowRight" && images.length > 1) {
        setOpenImageIndex((current) =>
          current === null ? null : (current + 1) % images.length,
        );
      }
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [images.length, openImageIndex]);

  if (onRemove) {
    const names = [
      ...new Set([
        ...sourceAttachments.map((source) => source.name),
        ...attachments.map((attachment) => attachment.name),
        ...fileEntries.map((attachment) => attachment.name),
      ]),
    ];
    if (names.length === 0) return null;
    return (
      <div className="flex flex-wrap justify-end gap-1" data-testid="editable-chat-attachments">
        {names.map((name) => (
          <span key={name} className={FILE_CHIP_CLASS}>
            <PaperclipIcon />
            <span className="truncate">{name}</span>
            <button
              type="button"
              onClick={() => onRemove(name)}
              className="-mr-1 grid h-4 w-4 shrink-0 place-items-center rounded-full transition-colors hover:bg-[var(--paper-strong)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--botanical)]"
              title={`Remove ${name} from this message`}
              aria-label={`Remove ${name} from this message`}
            >
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </span>
        ))}
      </div>
    );
  }

  if (
    images.length === 0 &&
    models.length === 0 &&
    videos.length === 0 &&
    tracks.length === 0 &&
    products.length === 0 &&
    !pdfPage &&
    !webPage &&
    sourceAttachments.length === 0 &&
    fileEntries.length === 0
  ) {
    return null;
  }

  return (
    <>
      <div className="flex min-w-0 max-w-full flex-col items-end gap-1.5">
        {pdfPage ? (
          <MessageDocumentCard
            name={pdfPage.title}
            kind="pdf"
            subtitle={`PDF · Page ${pdfPage.pageNumber}`}
            source={pageSource}
            title={pageSource ? `Open ${pdfPage.title} at page ${pdfPage.pageNumber}` : `${pdfPage.title} — page ${pdfPage.pageNumber} at send time`}
            testId="pdf-page-attachment"
          />
        ) : null}
        {webPage ? (() => {
          const card = webPageCard(webPage);
          const site = webPage.url && /^https?:/i.test(webPage.url) ? webPage.url : null;
          return (
            <MessageDocumentCard
              name={webPage.title}
              kind={card.kind}
              subtitle={card.subtitle}
              source={site ? null : pageSource}
              onOpen={site ? () => openSiteInNewTab(site) : undefined}
              title={site || pageSource ? `Open ${webPage.title}` : `${webPage.title} at send time`}
              testId="web-page-attachment"
            />
          );
        })() : null}
        {images.length ? (
          <div
            className={`grid min-w-0 max-w-[min(42rem,72vw,100%)] gap-2 ${
              images.length > 1 ? "grid-cols-2" : "grid-cols-1"
            }`}
          >
            {images.map((attachment, imageIndex) => (
              <button
                key={`${attachment.name}-${imageIndex}`}
                type="button"
                className="neu-surface-raised group relative block max-w-full cursor-zoom-in overflow-hidden rounded-[22px] border border-[var(--line)] p-1 text-left transition hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--botanical)]"
                onClick={() => setOpenImageIndex(imageIndex)}
                title={`View ${attachment.name}`}
                aria-label={`View attached image ${attachment.name}`}
              >
                {/* Data URLs are local message payloads, not optimizable remote assets. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={attachment.dataUrl}
                  alt={attachment.name}
                  className={
                    images.length === 1
                      ? "block max-h-80 w-auto max-w-full rounded-[18px] object-contain"
                      : "h-40 w-56 max-w-full rounded-[18px] object-cover"
                  }
                />
              </button>
            ))}
          </div>
        ) : null}

        {models.length ? (
          <div className="flex w-full flex-col items-end gap-1.5">
            {models.map((attachment, index) => (
              <ModelAttachmentViewer
                key={`${attachment.blobId}-${index}`}
                attachment={attachment}
              />
            ))}
          </div>
        ) : null}

        {videos.length ? (
          <div className="flex w-full flex-col items-end gap-1.5">
            {videos.map((attachment, index) => (
              <ChatVideoAttachmentCard
                key={`${attachment.blobId}-${index}`}
                name={attachment.name}
                href={`/api/chat-attachments/videos/${attachment.blobId}`}
                playbackHref={chatVideoPlaybackHref(attachment.blobId, attachment.format)}
                sizeLabel={formatVideoSize(attachment.sizeBytes)}
                nativelyPlayable={isPlayableVideoFormat(attachment.format)}
                formatLabel={videoFormatLabel(attachment.format)}
              />
            ))}
          </div>
        ) : null}

        {tracks.length ? (
          <div className="flex w-full flex-col items-end gap-1.5">
            {tracks.map((attachment, index) => (
              <AttachmentPreviewDialog
                key={`${attachment.blobId}-${index}`}
                source={{
                  kind: "audio",
                  name: attachment.name,
                  href: `/api/chat-attachments/audio/${attachment.blobId}`,
                }}
                className="neu-surface-raised flex w-full max-w-[min(32rem,72vw)] items-center gap-2 rounded-xl border border-[var(--line)] px-3 py-2 text-left text-xs text-[var(--ink-muted)] transition hover:border-[var(--botanical)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--botanical)]"
                title={`Play ${attachment.name}`}
              >
                <svg
                  aria-hidden
                  className="h-4 w-4 shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.7}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 18V5.25l10.5-1.5V16.5M9 18a2.25 2.25 0 1 1-4.5 0A2.25 2.25 0 0 1 9 18Zm10.5-1.5a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
                </svg>
                <span className="min-w-0 flex-1 truncate">
                  {attachment.name}
                  {formatAudioSize(attachment.sizeBytes)
                    ? ` · ${formatAudioSize(attachment.sizeBytes)}`
                    : ""}
                </span>
                <span className="shrink-0 text-[10px]">Open player</span>
              </AttachmentPreviewDialog>
            ))}
          </div>
        ) : null}

        {products.length ? (
          <div
            className={`grid max-w-full gap-1.5 ${products.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}
            data-testid="product-chat-attachments"
          >
            {products.map((attachment) => (
              <article
                key={attachment.product.id}
                className="flex min-w-0 max-w-72 items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] p-2 text-left"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white">
                  {attachment.product.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={attachment.product.imageUrl}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-contain p-0.5"
                    />
                  ) : (
                    <PaperclipIcon />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="line-clamp-2 text-xs font-medium leading-4 text-[var(--ink-heading)]">
                    {attachment.product.title}
                  </p>
                  <p className="mt-0.5 truncate text-[10px] text-[var(--ink-muted)]">
                    {attachment.product.merchant}
                    {attachment.product.price ? ` · ${attachment.product.price.display}` : ""}
                  </p>
                </div>
              </article>
            ))}
          </div>
        ) : null}

        {sourceAttachments.length || fileEntries.length ? (
          <div className="flex w-full min-w-0 flex-col items-end gap-1.5" data-testid="message-file-attachments">
            {sourceAttachments.map((source, index) => (
              <MessageDocumentCard
                key={`${source.kind}:${source.href}:${index}`}
                name={source.name}
                format={source.kind === "pdf" ? "pdf" : undefined}
                source={source}
              />
            ))}
            {fileEntries.map((attachment, index) => {
              // A stored file opens in a popup over the chat: documents in
              // their reader (a workbook as a spreadsheet), ordinary files as
              // text, a grid or a rendering. A name with no stored bytes stays
              // a label: there is nothing to open.
              const preview =
                attachment.type === "document"
                  ? documentPreviewSource(attachment)
                  : attachment.type === "file" && "blobId" in attachment && typeof attachment.blobId === "string" && attachment.blobId
                    ? storedFilePreviewSource({ name: attachment.name, blobId: attachment.blobId })
                    : null;
              return (
                <MessageDocumentCard
                  key={`${attachment.name}-${index}`}
                  name={attachment.name}
                  format={"format" in attachment && typeof attachment.format === "string" ? attachment.format : undefined}
                  source={preview}
                />
              );
            })}
          </div>
        ) : null}
      </div>

      {openImageIndex !== null && images[openImageIndex] && typeof document !== "undefined" ? createPortal(
        <div
          className="bb-viewer-overlay fixed z-[200] flex items-center justify-center bg-black p-4 sm:p-8"
          role="dialog"
          aria-modal="true"
          aria-label={`Image preview: ${images[openImageIndex].name}`}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpenImageIndex(null);
          }}
        >
          {/* Data URLs are local message payloads, not optimizable remote assets. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={images[openImageIndex].dataUrl}
            alt={images[openImageIndex].name}
            className="max-h-full max-w-full object-contain"
          />
          <button
            type="button"
            onClick={() => setOpenImageIndex(null)}
            className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full border border-white/20 bg-black/55 text-white shadow-lg transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            aria-label="Close image preview"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
          {images.length > 1 ? (
            <>
              <button
                type="button"
                onClick={() => setOpenImageIndex((openImageIndex - 1 + images.length) % images.length)}
                className="absolute left-4 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-white/20 bg-black/55 text-white hover:bg-white/15"
                aria-label="Previous image"
              >
                <span aria-hidden>‹</span>
              </button>
              <button
                type="button"
                onClick={() => setOpenImageIndex((openImageIndex + 1) % images.length)}
                className="absolute right-4 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-white/20 bg-black/55 text-white hover:bg-white/15"
                aria-label="Next image"
              >
                <span aria-hidden>›</span>
              </button>
            </>
          ) : null}
        </div>,
        document.body,
      ) : null}
    </>
  );
}

// Rows re-render on every streamed token; this one only when its own props change.
export default memo(ChatMessageAttachments, attachmentPropsEqual);
