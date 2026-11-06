"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
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
  coordinateSpace?: "content";
}

function pdfPageBounds(page: HTMLElement, coordinateSpace?: "content") {
  const bounds = page.getBoundingClientRect();
  if (coordinateSpace !== "content") return bounds;
  const scaleX = page.offsetWidth ? bounds.width / page.offsetWidth : 1;
  const scaleY = page.offsetHeight ? bounds.height / page.offsetHeight : 1;
  const left = bounds.left + page.clientLeft * scaleX;
  const top = bounds.top + page.clientTop * scaleY;
  const width = page.clientWidth * scaleX;
  const height = page.clientHeight * scaleY;
  return { left, top, right: left + width, bottom: top + height, width, height };
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
    const bounds = pdfPageBounds(page, highlight.coordinateSpace);
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
  const interactionRef = useRef({ highlights, onSelection, onOpenHighlight });
  useLayoutEffect(() => {
    interactionRef.current = { highlights, onSelection, onOpenHighlight };
  }, [highlights, onSelection, onOpenHighlight]);
  const highlightsByPage = useMemo(() => {
    const grouped = new Map<number, PageHighlight[]>();
    for (const highlight of highlights) {
      highlight.rects.forEach((rect, index) => {
        const entries = grouped.get(rect.page) ?? [];
        entries.push({ highlight, rect, index });
        grouped.set(rect.page, entries);
      });
    }
    return grouped;
  }, [highlights]);
  const highlightedPages = [...highlightsByPage.keys()].sort((a, b) => a - b).join(",");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const pageNumbers = new Set(highlightedPages.split(",").filter(Boolean).map(Number));
    const observed = new Set<HTMLElement>();
    const visible = new Set<HTMLElement>();
    let frame = 0;
    const publish = () => {
      const next = [...visible];
      setPages(current => current.length === next.length &&
        current.every((page, index) => page === next[index]) ? current : next);
    };
    const intersection = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const page = entry.target as HTMLElement;
        if (entry.isIntersecting && observed.has(page)) visible.add(page);
        else visible.delete(page);
      }
      publish();
    }, { root: container, rootMargin: "100% 0px" });
    const update = () => {
      frame = 0;
      const next = new Set<HTMLElement>();
      if (pageNumbers.size) {
        for (const page of container.querySelectorAll<HTMLElement>(".page[data-page-number]")) {
          if (pageNumbers.has(Number(page.dataset.pageNumber))) next.add(page);
        }
      }
      for (const page of observed) {
        if (!next.has(page)) {
          intersection.unobserve(page);
          observed.delete(page);
          visible.delete(page);
        }
      }
      for (const page of next) {
        if (observed.has(page)) continue;
        observed.add(page);
        intersection.observe(page);
      }
      publish();
    };
    update();
    if (!pageNumbers.size) return () => intersection.disconnect();
    // Ignore text-layer/React mutations. Only page insertion or replacement
    // changes which elements the viewport observer needs to watch.
    const observer = new MutationObserver(records => {
      if (frame || !records.some(record =>
        [...record.addedNodes, ...record.removedNodes].some(node =>
          node instanceof Element && (node.matches(".page[data-page-number]") ||
            node.querySelector(".page[data-page-number]"))))) return;
      frame = requestAnimationFrame(update);
    });
    observer.observe(container, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      intersection.disconnect();
    };
  }, [containerRef, documentKey, highlightedPages]);

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
        const startElement = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
        const endElement = range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement;
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
        // Element rectangles include whole PDF spans, even when only part of
        // their text is selected. Read text-node ranges so marks cannot cover
        // unselected words or paint the same line twice.
        const selectionRects: DOMRect[] = [];
        const walker = document.createTreeWalker(container!, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!node.parentElement?.closest(".textLayer") || !range.intersectsNode(node)) continue;
          const part = document.createRange();
          part.selectNodeContents(node);
          if (node === range.startContainer) part.setStart(node, range.startOffset);
          if (node === range.endContainer) part.setEnd(node, range.endOffset);
          if (!part.collapsed) selectionRects.push(...part.getClientRects());
        }
        for (const page of container.querySelectorAll<HTMLElement>(
          ".page[data-page-number]",
        )) {
          if (!range.intersectsNode(page)) continue;
          const bounds = pdfPageBounds(page, "content");
          for (const rect of selectionRects) {
            const clip = intersectPdfRects(rect, bounds);
            if (!clip || clip.width < 1)
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
        const preceding = document.createRange();
        preceding.selectNodeContents(startElement.closest(".textLayer")!);
        preceding.setEnd(range.startContainer, range.startOffset);
        const leadingSpace = selected.toString().length - selected.toString().trimStart().length;
        const offset = preceding.toString().length + leadingSpace;
        interactionRef.current.onSelection({
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
          coordinateSpace: "content",
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
    let pointer: { x: number; y: number; id: number } | null = null;
    const pointerdown = (event: PointerEvent) => {
      if (event.button === 0) pointer = { x: event.clientX, y: event.clientY, id: event.pointerId };
    };
    const pointerup = (event: PointerEvent) => {
      const start = pointer;
      pointer = null;
      if (!start || start.id !== event.pointerId) return;
      const dragged = Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4;
      const selected = window.getSelection();
      if (dragged || (selected && !selected.isCollapsed && selected.toString().trim())) {
        readSelection();
        return;
      }
      // Painted marks are transparent to pointer input. Hit-test only a click,
      // leaving native text selection free to start inside an existing mark.
      const highlight = [...interactionRef.current.highlights].reverse().find(item => item.rects.some(rect => {
        const page = container.querySelector<HTMLElement>(`.page[data-page-number="${rect.page}"]`);
        if (!page) return false;
        const bounds = pdfPageBounds(page, item.coordinateSpace);
        return event.clientX >= bounds.left + rect.left * bounds.width &&
          event.clientX <= bounds.left + (rect.left + rect.width) * bounds.width &&
          event.clientY >= bounds.top + rect.top * bounds.height &&
          event.clientY <= bounds.top + (rect.top + rect.height) * bounds.height;
      }));
      if (highlight) {
        const anchor = pdfHighlightAnchor(container, highlight);
        if (anchor) interactionRef.current.onOpenHighlight(highlight, anchor);
      }
    };
    const cancelPointer = () => { pointer = null; };
    container.addEventListener("pointerdown", pointerdown, true);
    document.addEventListener("pointerup", pointerup, true);
    document.addEventListener("pointercancel", cancelPointer, true);
    container.addEventListener("keyup", keyup, true);
    return () => {
      cancelAnimationFrame(frame);
      container.removeEventListener("pointerdown", pointerdown, true);
      document.removeEventListener("pointerup", pointerup, true);
      document.removeEventListener("pointercancel", cancelPointer, true);
      container.removeEventListener("keyup", keyup, true);
    };
  }, [containerRef, documentKey, enabled]);

  return pages.map(page => {
    const entries = highlightsByPage.get(Number(page.dataset.pageNumber));
    if (!entries) return null;
    return <PdfPageHighlights key={`${documentKey}:${page.dataset.pageNumber}`}
      page={page} entries={entries} enabled={enabled} onOpenHighlight={onOpenHighlight} />;
  });
}

interface PageHighlight {
  highlight: PdfHighlight;
  rect: PdfHighlightRect;
  index: number;
}

function PdfPageHighlights({ page, entries, enabled, onOpenHighlight }: {
  page: HTMLElement;
  entries: PageHighlight[];
  enabled: boolean;
  onOpenHighlight: (highlight: PdfHighlight, anchor: FloatingAnchorRect) => void;
}) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    let current: HTMLElement | null = null;
    const updateBorders = () => {
      if (!current) return;
      const style = getComputedStyle(page);
      const left = parseFloat(style.borderLeftWidth) || 0;
      const top = parseFloat(style.borderTopWidth) || 0;
      current.style.setProperty("--pdf-border-left", `${left}px`);
      current.style.setProperty("--pdf-border-top", `${top}px`);
      current.style.setProperty("--pdf-border-width", `${left + (parseFloat(style.borderRightWidth) || 0)}px`);
      current.style.setProperty("--pdf-border-height", `${top + (parseFloat(style.borderBottomWidth) || 0)}px`);
    };
    const attach = () => {
      if (current?.parentElement === page) return;
      // PDF.js removes the page's children when zooming or recycling it.
      // Recreate only this visible highlight host, not one for every PDF page.
      current = document.createElement("div");
      current.dataset.pdfHighlightHost = "";
      current.dataset.pageNumber = page.dataset.pageNumber;
      Object.assign(current.style, {
        position: "absolute", inset: "0", pointerEvents: "none", zIndex: "4",
      });
      page.appendChild(current);
      updateBorders();
      setHost(current);
    };
    attach();
    const observer = new MutationObserver(attach);
    observer.observe(page, { childList: true });
    const resize = new ResizeObserver(updateBorders);
    resize.observe(page, { box: "border-box" });
    return () => {
      observer.disconnect();
      resize.disconnect();
      current?.remove();
    };
  }, [page]);

  if (host?.parentElement !== page) return null;
  return createPortal(
    <div
      className="pointer-events-none absolute inset-0 z-[4]"
      data-pdf-reader-highlights
    >
      {entries.map(({ highlight, rect, index }) => (
        <button
          key={`${highlight.selection.id}:${index}`}
          type="button"
          data-pdf-highlight={highlight.selection.id}
          data-chat-selection-id={highlight.selection.id}
          data-chat-selection-source={highlight.selection.sourceMessageId}
          tabIndex={enabled && index === 0 ? 0 : -1}
          className="absolute rounded-sm border-0 p-0 transition-[filter] hover:brightness-95 focus-visible:outline-2 focus-visible:outline-[var(--botanical)]"
          style={{
            left: highlight.coordinateSpace === "content" ? `${rect.left * 100}%`
              : `calc(${rect.left * 100}% + ${rect.left} * var(--pdf-border-width) - var(--pdf-border-left))`,
            top: highlight.coordinateSpace === "content" ? `${rect.top * 100}%`
              : `calc(${rect.top * 100}% + ${rect.top} * var(--pdf-border-height) - var(--pdf-border-top))`,
            width: highlight.coordinateSpace === "content" ? `${rect.width * 100}%`
              : `calc(${rect.width * 100}% + ${rect.width} * var(--pdf-border-width))`,
            height: highlight.coordinateSpace === "content" ? `${rect.height * 100}%`
              : `calc(${rect.height * 100}% + ${rect.height} * var(--pdf-border-height))`,
            backgroundColor: `color-mix(in srgb, ${highlight.selection.mode === "inline" || highlight.chatQuestion || highlight.conversationId ? "var(--selection-yellow)" : `var(--selection-highlight-${highlight.color})`} 45%, transparent)`,
            pointerEvents: "none",
          }}
          title={`${
            highlight.selection.mode === "inline"
              ? `Ask here: ${highlight.selection.quote}`
              : highlight.selection.quote
          }${highlight.note ? `\n\nNote: ${highlight.note}` : ""}`}
          aria-label={`${highlight.selection.mode === "inline" ? "Open answer" : highlight.chatQuestion || highlight.conversationId ? "Open question in chat" : "Highlighted text"}: ${highlight.selection.quote.slice(0, 140)}`}
          onClick={(event) => {
            event.stopPropagation();
            onOpenHighlight(highlight, event.currentTarget.getBoundingClientRect());
          }}
        />
      ))}
    </div>,
    host,
  );
}
