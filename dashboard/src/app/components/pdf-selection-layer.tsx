"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type {
  ChatTextSelectionCandidate,
  FloatingAnchorRect,
} from "./chat-text-selection-ui";
import { NoteBubble } from "./chat-markdown";
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
  onMovePin,
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
  onMovePin: (id: string, rect: PdfHighlightRect) => void;
}) {
  const [pages, setPages] = useState<HTMLElement[]>([]);
  const [hover, setHover] = useState<{ id: string; note?: string; rect: DOMRect } | null>(null);
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
      const highlight = highlightAt(container, interactionRef.current.highlights, event.clientX, event.clientY);
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

  // Hovering a saved passage behaves as in chat: the mark lights up and a noted
  // passage shows its note. Marks stay transparent to the pointer so text
  // selection can still start on them, so the pointer is hit-tested instead.
  const hasMarks = highlights.some(item => !item.pin);
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !hasMarks) return;
    let frame = 0;
    const move = (event: PointerEvent) => {
      if (frame) return;
      const { clientX, clientY } = event;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const hit = highlightAt(container, interactionRef.current.highlights, clientX, clientY);
        setHover(current => {
          if (!hit) return null;
          if (current?.id === hit.selection.id) return current;
          const page = container.querySelector<HTMLElement>(`.page[data-page-number="${hit.rects[0].page}"]`);
          const bounds = page && pdfPageBounds(page, hit.coordinateSpace);
          if (!bounds) return null;
          // Under the passage's last line, as chat places the bubble under its text.
          const left = Math.min(...hit.rects.map(rect => rect.left));
          const top = Math.min(...hit.rects.map(rect => rect.top));
          const bottom = Math.max(...hit.rects.map(rect => rect.top + rect.height));
          return { id: hit.selection.id, ...(hit.note && notedPassage(hit) ? { note: hit.note } : {}), rect: new DOMRect(
            bounds.left + left * bounds.width, bounds.top + top * bounds.height,
            1, (bottom - top) * bounds.height) };
        });
      });
    };
    const clear = () => setHover(null);
    container.addEventListener("pointermove", move, { passive: true });
    container.addEventListener("pointerleave", clear);
    container.addEventListener("pointerdown", clear, true);
    container.addEventListener("scroll", clear, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      container.removeEventListener("pointermove", move);
      container.removeEventListener("pointerleave", clear);
      container.removeEventListener("pointerdown", clear, true);
      container.removeEventListener("scroll", clear);
      setHover(null);
    };
  }, [containerRef, hasMarks]);

  return <>
    {pages.map(page => {
      const entries = highlightsByPage.get(Number(page.dataset.pageNumber));
      if (!entries) return null;
      return <PdfPageHighlights key={`${documentKey}:${page.dataset.pageNumber}`}
        page={page} entries={entries} enabled={enabled} hoveredId={hover?.id} onOpenHighlight={onOpenHighlight} onMovePin={onMovePin} />;
    })}
    {hover?.note ? <NoteBubble id={`pdf-note-${hover.id}`} text={hover.note} anchor={hover.rect} /> : null}
  </>;
}

/** The topmost saved passage under a point; pins handle their own pointer input. */
function highlightAt(container: HTMLElement, highlights: readonly PdfHighlight[], x: number, y: number) {
  return [...highlights].reverse().find(item => !item.pin && item.rects.some(rect => {
    const page = container.querySelector<HTMLElement>(`.page[data-page-number="${rect.page}"]`);
    if (!page) return false;
    const bounds = pdfPageBounds(page, item.coordinateSpace);
    return x >= bounds.left + rect.left * bounds.width &&
      x <= bounds.left + (rect.left + rect.width) * bounds.width &&
      y >= bounds.top + rect.top * bounds.height &&
      y <= bounds.top + (rect.top + rect.height) * bounds.height;
  }));
}

interface PageHighlight {
  highlight: PdfHighlight;
  rect: PdfHighlightRect;
  index: number;
}

function PdfPageHighlights({ page, entries, enabled, hoveredId, onOpenHighlight, onMovePin }: {
  page: HTMLElement;
  entries: PageHighlight[];
  enabled: boolean;
  hoveredId?: string;
  onOpenHighlight: (highlight: PdfHighlight, anchor: FloatingAnchorRect) => void;
  onMovePin: (id: string, rect: PdfHighlightRect) => void;
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
      {entries.map(({ highlight, rect, index }) => highlight.pin ? (
        <PdfPin key={highlight.selection.id} highlight={highlight} rect={rect}
          onOpen={anchor => onOpenHighlight(highlight, anchor)} onMove={next => onMovePin(highlight.selection.id, next)} />
      ) : (
        <button
          key={`${highlight.selection.id}:${index}`}
          type="button"
          data-pdf-highlight={highlight.selection.id}
          data-chat-selection-id={highlight.selection.id}
          data-chat-selection-source={highlight.selection.sourceMessageId}
          tabIndex={enabled && index === 0 ? 0 : -1}
          data-chat-note={notedPassage(highlight) ? "true" : undefined}
          className={`absolute border-0 p-0 transition-[background-color,box-shadow] duration-100 focus-visible:outline-2 focus-visible:outline-[var(--botanical)] rounded-sm`}
          style={{
            left: highlight.coordinateSpace === "content" ? `${rect.left * 100}%`
              : `calc(${rect.left * 100}% + ${rect.left} * var(--pdf-border-width) - var(--pdf-border-left))`,
            top: highlight.coordinateSpace === "content" ? `${rect.top * 100}%`
              : `calc(${rect.top * 100}% + ${rect.top} * var(--pdf-border-height) - var(--pdf-border-top))`,
            width: highlight.coordinateSpace === "content" ? `${rect.width * 100}%`
              : `calc(${rect.width * 100}% + ${rect.width} * var(--pdf-border-width))`,
            height: highlight.coordinateSpace === "content" ? `${rect.height * 100}%`
              : `calc(${rect.height * 100}% + ${rect.height} * var(--pdf-border-height))`,
            ...markStyle(highlight, hoveredId === highlight.selection.id),
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

/** Where the needle meets the page, inside the 40px pin drawing. */
const PIN_TIP = { x: 9, y: 37 };

/** A pushpin stuck into the page: drag it anywhere on any page, click it to open its card. */
function PdfPin({ highlight, rect, onOpen, onMove }: {
  highlight: PdfHighlight;
  rect: PdfHighlightRect;
  onOpen: (anchor: FloatingAnchorRect) => void;
  onMove: (rect: PdfHighlightRect) => void;
}) {
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);
  const id = highlight.selection.id;
  const color = highlight.color;
  return (
    <button
      type="button"
      data-pdf-pin={id}
      data-chat-selection-id={id}
      data-chat-selection-source={highlight.selection.sourceMessageId}
      aria-label="Open pin (drag to move)"
      title={highlight.note ? `Pin: ${highlight.note}` : "Pin: click to open, drag to move"}
      className="absolute h-[40px] w-[40px] cursor-grab touch-none border-0 bg-transparent p-0 active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-[var(--botanical)]"
      style={{
        left: `${rect.left * 100}%`, top: `${rect.top * 100}%`, pointerEvents: "auto", zIndex: offset ? 6 : 5,
        transform: `translate(${(offset?.x ?? 0) - PIN_TIP.x}px, ${(offset?.y ?? 0) - PIN_TIP.y}px)`,
      }}
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        const current = drag.current;
        if (!current || current.id !== event.pointerId) return;
        const dx = event.clientX - current.x, dy = event.clientY - current.y;
        if (!current.moved && Math.hypot(dx, dy) < 4) return;
        current.moved = true;
        setOffset({ x: dx, y: dy });
      }}
      onPointerUp={event => {
        const current = drag.current;
        if (!current || current.id !== event.pointerId) return;
        drag.current = null;
        setOffset(null);
        if (!current.moved) return;
        suppressClick.current = true;
        // The needle's tip lands on whichever page is under it; off the pages it springs back.
        const box = event.currentTarget.getBoundingClientRect();
        const x = box.left + PIN_TIP.x, y = box.top + PIN_TIP.y;
        const target = document.elementsFromPoint(x, y)
          .map(element => element.closest<HTMLElement>(".page[data-page-number]"))
          .find(Boolean);
        if (!target) return;
        const bounds = pdfPageBounds(target, "content");
        const left = Math.min(0.999, Math.max(0, (x - bounds.left) / bounds.width));
        const top = Math.min(0.999, Math.max(0, (y - bounds.top) / bounds.height));
        onMove({ page: Number(target.dataset.pageNumber), left, top, width: 0.001, height: 0.001 });
      }}
      onLostPointerCapture={() => { drag.current = null; setOffset(null); }}
      onClick={event => {
        event.stopPropagation();
        if (suppressClick.current) { suppressClick.current = false; return; }
        onOpen(event.currentTarget.getBoundingClientRect());
      }}
    >
      <svg viewBox="0 0 40 40" className="h-full w-full overflow-visible" aria-hidden>
        <defs>
          {/* Cylinder shading, lit from the upper left. */}
          <linearGradient id={`pin-body-${id}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" style={{ stopColor: `var(--selection-highlight-${color}-line)` }} />
            <stop offset="30%" stopColor="#fff" stopOpacity={0.9} />
            <stop offset="45%" style={{ stopColor: `var(--selection-highlight-${color})` }} />
            <stop offset="100%" style={{ stopColor: `var(--selection-highlight-${color}-line)` }} />
          </linearGradient>
          <radialGradient id={`pin-cap-${id}`} cx="40%" cy="35%" r="70%">
            <stop offset="0%" stopColor="#fff" stopOpacity={0.85} />
            <stop offset="45%" style={{ stopColor: `var(--selection-highlight-${color})` }} />
            <stop offset="100%" style={{ stopColor: `var(--selection-highlight-${color}-hover)` }} />
          </radialGradient>
          <linearGradient id={`pin-needle-${id}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#8a8f94" />
            <stop offset="40%" stopColor="#f5f7f8" />
            <stop offset="100%" stopColor="#5f656b" />
          </linearGradient>
        </defs>
        {/* Shadow cast on the page, falling away from the light. */}
        <ellipse cx={PIN_TIP.x + 9} cy={PIN_TIP.y - 2} rx="9" ry="3.2" transform={`rotate(-28 ${PIN_TIP.x + 9} ${PIN_TIP.y - 2})`} fill="#000" opacity="0.16" />
        <ellipse cx={PIN_TIP.x} cy={PIN_TIP.y} rx="2.2" ry="1" fill="#000" opacity="0.32" />
        {/* An upright pushpin drawn point-down at the origin, then tilted into the page. */}
        <g transform={`translate(${PIN_TIP.x} ${PIN_TIP.y}) rotate(32)`} strokeWidth="0.7"
          style={{ stroke: `color-mix(in srgb, var(--selection-highlight-${color}-line) 75%, black)` }}>
          <path d="M-0.9 -12 L0.9 -12 L0.15 -0.6 L0 0 L-0.15 -0.6 Z" fill={`url(#pin-needle-${id})`} stroke="#4d5358" strokeWidth="0.3" />
          <path d="M-7 -14.5 L7 -14.5 L7 -12.6 A7 2.2 0 0 1 -7 -12.6 Z" fill={`url(#pin-body-${id})`} />
          <ellipse cx="0" cy="-14.5" rx="7" ry="2.2" fill={`url(#pin-cap-${id})`} />
          <path d="M-3.4 -25 L3.4 -25 L4.2 -15 A4.2 1.4 0 0 1 -4.2 -15 Z" fill={`url(#pin-body-${id})`} />
          <path d="M-8.5 -32 L8.5 -32 L8.5 -26.5 A8.5 2.6 0 0 1 -8.5 -26.5 Z" fill={`url(#pin-body-${id})`} />
          <ellipse cx="0" cy="-32" rx="8.5" ry="2.6" fill={`url(#pin-cap-${id})`} />
          <ellipse cx="-2.6" cy="-32.4" rx="3" ry="0.9" fill="#fff" opacity="0.75" stroke="none" />
        </g>
      </svg>
    </button>
  );
}

/** As in chat, only a plain highlight carries a note mark; question passages stay yellow. */
function notedPassage(highlight: PdfHighlight) {
  return Boolean(highlight.note) && highlight.selection.mode !== "inline" && !highlight.chatQuestion && !highlight.conversationId;
}

/** Chat's mark look on a PDF: a tint that deepens with a ring on hover; a noted passage is a dotted underline. */
function markStyle(highlight: PdfHighlight, hovered: boolean) {
  const question = highlight.selection.mode === "inline" || highlight.chatQuestion || highlight.conversationId;
  if (notedPassage(highlight)) {
    return { backgroundColor: "transparent", borderBottom: "1.5px dotted rgb(0 0 0 / 0.75)" };
  }
  const tone = question ? "--selection-yellow" : `--selection-highlight-${highlight.color}`;
  return hovered ? {
    backgroundColor: `color-mix(in srgb, var(${tone}-hover) 55%, transparent)`,
    boxShadow: `0 0 0 2px color-mix(in srgb, var(${tone}-line) 48%, transparent)`,
  } : { backgroundColor: `color-mix(in srgb, var(${tone}) 45%, transparent)` };
}
