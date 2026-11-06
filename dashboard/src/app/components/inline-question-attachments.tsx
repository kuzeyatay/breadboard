"use client";

import { useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { ChatAttachment } from "@/lib/chat-attachments";

/** Use the Terminal composer's image tiles without sharing its draft state. */
export default function InlineQuestionAttachments({ files, onRemove }: {
  files: readonly ChatAttachment[];
  onRemove?: (index: number) => void;
}) {
  const [preview, setPreview] = useState<ChatAttachment | null>(null);
  const previewTrigger = useRef<HTMLButtonElement | null>(null);
  const images = files.filter(file => file.type === "image");
  const previewIndex = images.findIndex(file => file.type === "image" && preview?.type === "image" &&
    file.dataUrl === preview.dataUrl && file.name === preview.name);
  const active = images[previewIndex];
  const step = (direction: number) => {
    if (images.length) setPreview(images[(previewIndex + direction + images.length) % images.length]);
  };

  if (!files.length) return null;
  return <>
    <div className="mb-2 flex flex-wrap items-start gap-1.5" aria-label="Question attachments" data-selection-exclude>
      {files.map((file, index) => file.type === "image" ? (
        <div key={`${file.name}-${index}`} className="group relative h-36 w-36 max-w-full overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--paper-surface)] sm:h-44 sm:w-44">
          <button type="button" onClick={event => { previewTrigger.current = event.currentTarget; setPreview(file); }}
            className="block h-full w-full focus-visible:outline-2 focus-visible:outline-[var(--botanical)]"
            aria-label={`Zoom ${file.name}`} title={file.name}>
            {/* Pasted images already have local data URLs. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={file.dataUrl} alt={file.name} className="h-full w-full object-cover" />
          </button>
          {onRemove && <button type="button" onClick={() => onRemove(index)} aria-label={`Remove ${file.name}`}
            className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--paper-raised)] text-[var(--ink)] shadow-[var(--neu-soft-shadow)] transition hover:bg-[var(--paper-strong)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)]">
            <X className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden />
          </button>}
        </div>
      ) : (
        <div key={`${file.name}-${index}`} className="flex max-w-full items-center gap-1.5 rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-2.5 py-1.5 text-xs text-[var(--ink)]">
          <span className="truncate" title={file.name}>{file.name}</span>
          {onRemove && <button type="button" onClick={() => onRemove(index)} aria-label={`Remove ${file.name}`}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full hover:bg-[var(--paper-strong)]">
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>}
        </div>
      ))}
    </div>
    <Dialog.Root open={Boolean(active)} onOpenChange={open => { if (!open) setPreview(null); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="bb-viewer-overlay fixed z-[240] bg-black/80 backdrop-blur-sm" />
        <Dialog.Content data-assistant-response-overlay
          onCloseAutoFocus={event => { event.preventDefault(); previewTrigger.current?.focus(); }}
          onEscapeKeyDown={event => { event.preventDefault(); event.stopPropagation(); setPreview(null); }}
          className="fixed left-1/2 top-1/2 z-[241] flex max-h-[90vh] w-[min(92vw,64rem)] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3 rounded-2xl bg-[var(--paper-raised)] p-4 text-[var(--ink)] shadow-2xl focus:outline-none"
          onKeyDown={event => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            step(event.key === "ArrowRight" ? 1 : -1);
          }}>
          <div className="flex w-full items-center gap-2">
            <Dialog.Title className="min-w-0 flex-1 truncate text-sm font-medium">{active?.name}</Dialog.Title>
            <Dialog.Description className="sr-only">Image attachment preview. Use the arrow keys to browse images.</Dialog.Description>
            <Dialog.Close className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[var(--ink-muted)] hover:bg-[var(--paper-strong)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)]" aria-label="Close image preview">
              <X className="h-4 w-4" aria-hidden />
            </Dialog.Close>
          </div>
          {active?.type === "image" && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={active.dataUrl} alt={active.name} className="min-h-0 max-h-[70vh] max-w-full rounded-lg object-contain" />
          )}
          {images.length > 1 && <div className="flex items-center gap-3 text-xs text-[var(--ink-muted)]">
            <button type="button" onClick={() => step(-1)} aria-label="Previous image" className="grid h-8 w-8 place-items-center rounded-full hover:bg-[var(--paper-strong)]"><ChevronLeft className="h-4 w-4" aria-hidden /></button>
            <span>{previewIndex + 1} / {images.length}</span>
            <button type="button" onClick={() => step(1)} aria-label="Next image" className="grid h-8 w-8 place-items-center rounded-full hover:bg-[var(--paper-strong)]"><ChevronRight className="h-4 w-4" aria-hidden /></button>
          </div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </>;
}
