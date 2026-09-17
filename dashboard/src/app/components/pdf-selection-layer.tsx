"use client";

import { useEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type {
  ChatTextSelectionCandidate,
  FloatingAnchorRect,
} from "./chat-text-selection-ui";
import {
  intersectPdfRects,
  type PdfHighlight,
  type PdfHighlightRect,
} from "@/lib/pdf-assistant";

export interface PdfSelectionCandidate extends ChatTextSelectionCandidate {
  rects: PdfHighlightRect[];
  highlightId?: string;
}

export function pdfHighlightAnchor(
  container: HTMLElement,
  highlight: PdfHighlight,
): FloatingAnchorRect | null {
  const visible = container.getBoundingClientRect();
  for (const rect of highlight.rects) {
    const page = container.querySelector<HTMLElement>(
      `.page[data-page-number="${rect.page}"]`,
    );
    if (!page) continue;
    const bounds = page.getBoundingClientRect();
    const result = {
      left: bounds.left + rect.left * bounds.width,
      right: bounds.left + (rect.left + rect.width) * bounds.width,
      top: bounds.top + rect.top * bounds.height,
      bottom: bounds.top + (rect.top + rect.height) * bounds.height,
      width: rect.width * bounds.width,
      height: rect.height * bounds.height,
    };
    if (intersectPdfRects(result, visible)) return result;
  }
  return null;
}

export default function PdfSelectionLayer({
  containerRef,
  documentKey,
  enabled,
  highlights,
  onSelection,
  onOpenHighlight,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  documentKey: string;
  enabled: boolean;
  highlights: PdfHighlight[];
  onSelection: (selection: PdfSelectionCandidate) => void;
  onOpenHighlight: (
    highlight: PdfHighlight,
    anchor: FloatingAnchorRect,
  ) => void;
}) {
  const [pages, setPages] = useState<HTMLElement[]>([]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = () => {
      // PDF.js removes a page's children when zooming or recycling it. Give
      // React a dedicated portal host and recreate it after those resets.
      const next = [
        ...container.querySelectorAll<HTMLElement>(".page[data-page-number]"),
      ].map((page) => {
        let host = page.querySelector<HTMLElement>(
          ":scope > [data-pdf-highlight-host]",
        );
        if (!host) {
          host = document.createElement("div");
          host.dataset.pdfHighlightHost = "";
          host.dataset.pageNumber = page.dataset.pageNumber;
          Object.assign(host.style, {
            position: "absolute",
            inset: "0",
            pointerEvents: "none",
            zIndex: "4",
          });
          page.appendChild(host);
        }
        return host;
      });
      setPages((current) =>
        current.length === next.length &&
        current.every((page, i) => page === next[i])
          ? current
          : next,
      );
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(container, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [containerRef, documentKey]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;
    let frame = 0;
    function readSelection() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const selected = window.getSelection();
        if (!selected || selected.isCollapsed || !selected.rangeCount) return;
        const range = selected.getRangeAt(0);
        const startElement = range.startContainer.parentElement;
        const endElement = range.endContainer.parentElement;
        if (
          !container?.contains(range.startContainer) ||
          !container.contains(range.endContainer) ||
          !startElement?.closest(".textLayer") ||
          !endElement?.closest(".textLayer")
        )
          return;
        const quote = selected.toString().trim().slice(0, 4000);
        if (!quote) return;
        const rects: PdfHighlightRect[] = [];
        const seen = new Set<string>();
        for (const page of container.querySelectorAll<HTMLElement>(
          ".page[data-page-number]",
        )) {
          const bounds = page.getBoundingClientRect();
          for (const rect of range.getClientRects()) {
            const clip = intersectPdfRects(rect, bounds);
            if (!clip || clip.height > bounds.height / 5 || clip.width < 1)
              continue;
            const normalized = {
              page: Number(page.dataset.pageNumber),
              left: (clip.left - bounds.left) / bounds.width,
              top: (clip.top - bounds.top) / bounds.height,
              width: clip.width / bounds.width,
              height: clip.height / bounds.height,
            };
            const key = JSON.stringify(normalized);
            if (!seen.has(key)) {
              rects.push(normalized);
              seen.add(key);
            }
          }
        }
        if (!rects.length) return;
        const bounds = range.getBoundingClientRect();
        const pageText = startElement.closest(".textLayer")?.textContent ?? "";
        const offset = Math.max(0, pageText.indexOf(quote));
        onSelection({
          sourceMessageId: `${documentKey}:page:${rects[0].page}`,
          start: offset,
          end: offset + quote.length,
          quote,
          prefix: pageText.slice(Math.max(0, offset - 160), offset),
          suffix: pageText.slice(
            offset + quote.length,
            offset + quote.length + 160,
          ),
          rects: rects.slice(0, 500),
          anchor: {
            left: bounds.left,
            right: bounds.right,
            top: bounds.top,
            bottom: bounds.bottom,
            width: bounds.width,
            height: bounds.height,
          },
        });
      });
    }
    const keyup = (event: KeyboardEvent) => {
      if (event.shiftKey || event.key.startsWith("Arrow")) readSelection();
    };
    container.addEventListener("pointerup", readSelection, true);
    container.addEventListener("keyup", keyup, true);
    return () => {
      cancelAnimationFrame(frame);
      container.removeEventListener("pointerup", readSelection, true);
      container.removeEventListener("keyup", keyup, true);
    };
  }, [containerRef, documentKey, enabled, onSelection]);

  return pages.map((page) =>
    createPortal(
      <div
        className="pointer-events-none absolute inset-0 z-[4]"
        data-pdf-reader-highlights
      >
        {highlights.flatMap((highlight) =>
          highlight.rects.flatMap((rect, index) =>
            rect.page !== Number(page.dataset.pageNumber)
              ? []
              : [
                  <button
                    key={`${highlight.selection.id}:${index}`}
                    type="button"
                    data-pdf-highlight={highlight.selection.id}
                    className="absolute rounded-sm border-0 p-0 transition-[filter] hover:brightness-95 focus-visible:outline-2 focus-visible:outline-[var(--botanical)]"
                    style={{
                      left: `${rect.left * 100}%`,
                      top: `${rect.top * 100}%`,
                      width: `${rect.width * 100}%`,
                      height: `${rect.height * 100}%`,
                      backgroundColor: `color-mix(in srgb, ${highlight.selection.mode === "inline" ? "var(--selection-yellow)" : `var(--selection-highlight-${highlight.color})`} 45%, transparent)`,
                      pointerEvents: enabled ? "auto" : "none",
                    }}
                    title={`${
                      highlight.selection.mode === "inline"
                        ? `Ask here: ${highlight.selection.quote}`
                        : highlight.selection.quote
                    }${highlight.note ? `\n\nNote: ${highlight.note}` : ""}`}
                    aria-label={`${highlight.selection.mode === "inline" ? "Open answer" : "Highlighted text"}: ${highlight.selection.quote.slice(0, 140)}`}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={(event) => {
                      event.stopPropagation();
                      const bounds =
                        event.currentTarget.getBoundingClientRect();
                      onOpenHighlight(highlight, bounds);
                    }}
                  />,
                ],
          ),
        )}
      </div>,
      page,
      page.dataset.pageNumber,
    ),
  );
}
