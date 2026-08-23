"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import ModelAttachmentViewer from "@/app/components/model-attachment-viewer";
import {
  chatAttachmentHref,
  type ChatMessageAttachment,
} from "@/lib/chat-attachments";
import {
  formatVideoSize,
  isPlayableVideoFormat,
  videoFormatLabel,
} from "@/lib/video-attachments";
import { formatAudioSize } from "@/lib/audio-attachments";

interface Props {
  attachments?: readonly ChatMessageAttachment[];
  /** Filename-only fallback for messages saved before image previews existed. */
  attachmentNames?: readonly string[];
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

function isPastedScreenshotName(name: string): boolean {
  return /^pasted-screenshot-\d+\.(?:png|jpe?g|webp|gif)$/i.test(name.trim());
}

export default function ChatMessageAttachments({
  attachments = [],
  attachmentNames = [],
}: Props) {
  const [openImageIndex, setOpenImageIndex] = useState<number | null>(null);
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
  const fileEntries = useMemo(() => {
    const retainedNames = new Set(attachments.map((attachment) => attachment.name));
    return [
      ...attachments.filter(
        (attachment) =>
          attachment.type !== "image" &&
          attachment.type !== "model" &&
          attachment.type !== "video" &&
          attachment.type !== "audio",
      ),
      ...attachmentNames
        .filter(
          (name) =>
            !retainedNames.has(name) && !isPastedScreenshotName(name),
        )
        .map((name) => ({ type: "file" as const, name })),
    ];
  }, [attachmentNames, attachments]);

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

  if (
    images.length === 0 &&
    models.length === 0 &&
    videos.length === 0 &&
    tracks.length === 0 &&
    fileEntries.length === 0
  ) {
    return null;
  }

  return (
    <>
      <div className="flex max-w-full flex-col items-end gap-1.5">
        {images.length ? (
          <div
            className={`grid max-w-full gap-2 ${
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
                      ? "block max-h-80 w-auto max-w-[min(42rem,72vw)] rounded-[18px] object-contain"
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
              <div
                key={`${attachment.blobId}-${index}`}
                className="neu-surface-raised w-full max-w-[min(32rem,72vw)] overflow-hidden rounded-[22px] border border-[var(--line)] p-1"
              >
                {isPlayableVideoFormat(attachment.format) ? (
                  <video
                    controls
                    // The file can be gigabytes; nothing is fetched until played.
                    preload="metadata"
                    src={`/api/chat-attachments/videos/${attachment.blobId}`}
                    className="block max-h-80 w-full rounded-[18px] bg-black"
                  />
                ) : (
                  // No browser plays Matroska or AVI. Watch reads them fine, so
                  // the file is here and analyzable — just not previewable.
                  <a
                    href={`/api/chat-attachments/videos/${attachment.blobId}`}
                    className="block rounded-[18px] px-3 py-2 text-xs text-[var(--ink-muted)] underline decoration-dotted underline-offset-2"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {videoFormatLabel(attachment.format)} · not playable in the browser · download
                  </a>
                )}
                <span className="block truncate px-2 pb-1 pt-1.5 text-xs text-[var(--ink-muted)]">
                  {attachment.name}
                  {formatVideoSize(attachment.sizeBytes)
                    ? ` · ${formatVideoSize(attachment.sizeBytes)}`
                    : ""}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {tracks.length ? (
          <div className="flex w-full flex-col items-end gap-1.5">
            {tracks.map((attachment, index) => (
              <div
                key={`${attachment.blobId}-${index}`}
                className="neu-surface-raised w-full max-w-[min(32rem,72vw)] overflow-hidden rounded-[22px] border border-[var(--line)] p-1"
              >
                {/* Every stored audio format plays in a browser, so unlike a
                    video there is no unplayable branch. Nothing is fetched
                    until the person presses play. */}
                <audio
                  controls
                  preload="metadata"
                  src={`/api/chat-attachments/audio/${attachment.blobId}`}
                  className="block w-full"
                />
                <span className="block truncate px-2 pb-1 pt-1.5 text-xs text-[var(--ink-muted)]">
                  {attachment.name}
                  {formatAudioSize(attachment.sizeBytes)
                    ? ` · ${formatAudioSize(attachment.sizeBytes)}`
                    : ""}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {fileEntries.length ? (
          <div className="flex flex-wrap justify-end gap-1">
            {fileEntries.map((attachment, index) => {
              const key = `${attachment.name}-${index}`;
              // A stored document has a reader of its own, so its chip is a
              // way into it rather than a label. Everything else stays a label:
              // there is nowhere for it to go.
              const viewerHref = chatAttachmentHref(attachment);
              if (!viewerHref) {
                return (
                  <span key={key} className={FILE_CHIP_CLASS}>
                    <PaperclipIcon />
                    <span className="truncate">{attachment.name}</span>
                  </span>
                );
              }
              return (
                <Link
                  key={key}
                  href={viewerHref}
                  className={`${FILE_CHIP_CLASS} transition-colors hover:border-[var(--botanical)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--botanical)]`}
                  title={`Open ${attachment.name}`}
                >
                  <PaperclipIcon />
                  <span className="truncate">{attachment.name}</span>
                </Link>
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
