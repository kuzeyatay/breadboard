"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ReactElement, ReactNode } from "react";
import {
  ContextMenuSurface,
  OpenInNewTabItem,
  OpenInNewWindowItem,
} from "@/app/components/link-context-menu";
import {
  ReclaimingAudio,
  ReclaimingVideo,
} from "@/app/components/reclaiming-media";

export interface AttachmentPreviewSource {
  kind: "pdf" | "audio" | "video";
  name: string;
  href: string;
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

function PreviewContextMenu({
  source,
  children,
}: {
  source: AttachmentPreviewSource;
  children: ReactNode;
}) {
  const label = source.kind === "pdf" ? "PDF" : "video";
  return (
    <ContextMenuSurface
      label={`${label} actions for ${source.name}`}
      menu={
        <>
          <OpenInNewTabItem href={source.href}>
            Open {label} in new tab
          </OpenInNewTabItem>
          <OpenInNewWindowItem href={source.href}>
            Open {label} in new window
          </OpenInNewWindowItem>
        </>
      }
    >
      {children as ReactElement}
    </ContextMenuSurface>
  );
}

/**
 * A file-name trigger that previews retained attachments without navigating
 * away from the conversation. Audio intentionally has no custom context menu;
 * PDF and video retain the desktop/browser open-in-tab and open-in-window menu.
 */
export default function AttachmentPreviewDialog({
  source,
  children,
  className,
  title,
}: Props) {
  const trigger = (
    <DialogPrimitive.Trigger asChild>
      <button
        type="button"
        className={className}
        title={title ?? `Open ${source.name}`}
        aria-label={`Open ${source.name} preview`}
      >
        {children}
      </button>
    </DialogPrimitive.Trigger>
  );

  return (
    <DialogPrimitive.Root>
      {source.kind === "audio" ? (
        trigger
      ) : (
        <PreviewContextMenu source={source}>{trigger}</PreviewContextMenu>
      )}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="bb-viewer-overlay fixed z-[240] bg-black/75 backdrop-blur-sm" />
        <DialogPrimitive.Content
          className={[
            "fixed left-1/2 top-1/2 z-[241] -translate-x-1/2 -translate-y-1/2 overflow-hidden",
            "rounded-2xl border border-white/15 bg-[var(--paper-raised)] shadow-2xl focus:outline-none",
            source.kind === "pdf"
              ? "h-[min(90vh,60rem)] w-[min(94vw,80rem)]"
              : "w-[min(92vw,64rem)]",
          ].join(" ")}
        >
          <header className="flex h-12 items-center gap-3 border-b border-[var(--line)] px-4">
            <DialogPrimitive.Title className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--ink-heading)]">
              {source.name}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">
              {source.kind === "pdf"
                ? "PDF attachment preview"
                : `${source.kind} attachment player`}
            </DialogPrimitive.Description>
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

          {source.kind === "pdf" ? (
            <iframe
              src={source.href}
              title={`${source.name} PDF preview`}
              className="h-[calc(100%_-_3rem)] w-full border-0 bg-white"
            />
          ) : source.kind === "audio" ? (
            <div className="p-5">
              <ReclaimingAudio
                autoPlay
                controls
                preload="metadata"
                src={source.href}
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
            <div className="flex items-center justify-center bg-black p-2">
              <ReclaimingVideo
                autoPlay
                controls
                preload="metadata"
                src={source.href}
                className="max-h-[calc(90vh_-_4rem)] max-w-full bg-black"
              />
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
