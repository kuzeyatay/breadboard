"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

interface ScreenshotEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
}

interface ScreenshotItem {
  id: string;
  caption: string;
}

function screenshotsFrom(events: ScreenshotEvent[]): ScreenshotItem[] {
  const seen = new Set<string>();
  const screenshots: ScreenshotItem[] = [];
  for (const event of events) {
    if (event.type !== "observation.screenshot") continue;
    const id = String(event.payload.screenshotId ?? "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    screenshots.push({
      id,
      caption: typeof event.payload.caption === "string" ? event.payload.caption : "Screenshot",
    });
  }
  return screenshots;
}

function Arrow({ direction }: { direction: "left" | "right" }) {
  return (
    <svg aria-hidden className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path strokeLinecap="round" strokeLinejoin="round" d={direction === "left" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"} />
    </svg>
  );
}

export default function AgentTarsScreenshotGallery({
  events,
  imageUrl,
  alt,
  emptyLabel,
}: {
  events: ScreenshotEvent[];
  imageUrl: (screenshotId: string) => string;
  alt: string;
  emptyLabel: string;
}) {
  const screenshots = useMemo(() => screenshotsFrom(events), [events]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [failedIds, setFailedIds] = useState<Set<string>>(() => new Set());

  const storedIndex = selectedId === null
    ? screenshots.length - 1
    : screenshots.findIndex((screenshot) => screenshot.id === selectedId);
  const selectedIndex = storedIndex < 0 ? Math.max(0, screenshots.length - 1) : storedIndex;
  const selected = screenshots[selectedIndex] ?? null;
  const selectedUnavailable = selected ? failedIds.has(selected.id) : false;

  const markUnavailable = useCallback((screenshotId: string) => {
    setFailedIds((current) => {
      if (current.has(screenshotId)) return current;
      const next = new Set(current);
      next.add(screenshotId);
      return next;
    });
  }, []);

  const retrySelected = useCallback(() => {
    if (!selected) return;
    setFailedIds((current) => {
      const next = new Set(current);
      next.delete(selected.id);
      return next;
    });
  }, [selected]);

  const selectIndex = useCallback((nextIndex: number) => {
    if (screenshots.length === 0) return;
    const bounded = Math.min(Math.max(nextIndex, 0), screenshots.length - 1);
    setSelectedId(bounded === screenshots.length - 1 ? null : screenshots[bounded]?.id ?? null);
  }, [screenshots]);

  useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
      if (event.key === "ArrowLeft") selectIndex(selectedIndex - 1);
      if (event.key === "ArrowRight") selectIndex(selectedIndex + 1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expanded, selectIndex, selectedIndex]);

  const navigation = screenshots.length > 1 ? (
    <div className="flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--paper-raised)]/95 p-1 text-[var(--ink-muted)] shadow-sm">
      <button
        type="button"
        onClick={(event) => { event.stopPropagation(); selectIndex(selectedIndex - 1); }}
        disabled={selectedIndex <= 0}
        className="rounded-full p-1 transition hover:bg-[var(--paper-strong)] hover:text-[var(--ink-heading)] disabled:opacity-30"
        aria-label="Previous Agent TARS screenshot"
      >
        <Arrow direction="left" />
      </button>
      <span className="min-w-10 text-center text-[10px] tabular-nums">{selectedIndex + 1}/{screenshots.length}</span>
      <button
        type="button"
        onClick={(event) => { event.stopPropagation(); selectIndex(selectedIndex + 1); }}
        disabled={selectedIndex >= screenshots.length - 1}
        className="rounded-full p-1 transition hover:bg-[var(--paper-strong)] hover:text-[var(--ink-heading)] disabled:opacity-30"
        aria-label="Next Agent TARS screenshot"
      >
        <Arrow direction="right" />
      </button>
    </div>
  ) : null;

  return (
    <>
      <div className="relative min-h-0 flex-1 overflow-hidden bg-[var(--paper-raised)]">
        {selected && !selectedUnavailable ? (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="absolute inset-0 block h-full w-full cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--botanical)]"
            aria-label={`Open ${selected.caption.toLowerCase()} full size`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl(selected.id)}
              alt={alt}
              className="block h-full w-full bg-[var(--paper-raised)] object-contain"
              onError={() => markUnavailable(selected.id)}
            />
          </button>
        ) : selected ? (
          <div className="flex h-full min-h-52 flex-col items-center justify-center gap-2 px-4 text-center text-xs text-[var(--ink-muted)]">
            <svg aria-hidden className="h-6 w-6 text-[var(--botanical-3)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path strokeLinecap="round" d="m7 15 3-3 2.5 2.5 1.75-1.75L18 16" />
              <path strokeLinecap="round" d="m6 7 12 10" />
            </svg>
            <span>This screenshot is not available.</span>
            <button
              type="button"
              onClick={retrySelected}
              className="rounded-full border border-[var(--line)] px-3 py-1 text-[11px] text-[var(--ink-heading)] transition hover:bg-[var(--paper-strong)]"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="flex h-full min-h-52 flex-col items-center justify-center gap-2 px-4 text-center text-xs text-[var(--ink-muted)]">
            <svg aria-hidden className="h-6 w-6 text-[var(--botanical-3)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <circle cx="9" cy="10" r="1.5" />
              <path strokeLinecap="round" strokeLinejoin="round" d="m5.5 17 4.25-4.25 2.75 2.75 2-2 4 3.5" />
            </svg>
            <span>{emptyLabel}</span>
          </div>
        )}
        {selected ? <div className="absolute bottom-2 left-1/2 -translate-x-1/2">{navigation}</div> : null}
      </div>

      {expanded && selected && typeof document !== "undefined"
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Agent TARS screenshot viewer"
              className="fixed inset-0 z-[180] flex flex-col bg-[color-mix(in_srgb,var(--ink)_86%,transparent)] p-3 sm:p-6"
              onMouseDown={(event) => { if (event.target === event.currentTarget) setExpanded(false); }}
            >
              <div className="mx-auto mb-3 flex w-full max-w-[min(96vw,1500px)] items-center justify-between gap-3 text-[var(--paper-raised)]">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{selected.caption}</p>
                  <p className="text-[11px] opacity-75">Screenshot {selectedIndex + 1} of {screenshots.length}</p>
                </div>
                <button type="button" onClick={() => setExpanded(false)} className="rounded-full border border-white/25 px-3 py-1.5 text-xs transition hover:bg-white/10">Close</button>
              </div>
              <div className="relative mx-auto flex min-h-0 w-full max-w-[min(96vw,1500px)] flex-1 items-center justify-center overflow-hidden rounded-xl border border-white/20 bg-black/80">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageUrl(selected.id)}
                  alt={alt}
                  className="max-h-full max-w-full object-contain"
                  onError={() => {
                    markUnavailable(selected.id);
                    setExpanded(false);
                  }}
                />
                {navigation ? <div className="absolute bottom-3 left-1/2 -translate-x-1/2">{navigation}</div> : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
