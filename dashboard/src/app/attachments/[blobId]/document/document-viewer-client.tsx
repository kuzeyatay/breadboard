"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ChatMarkdown from "@/app/components/chat-markdown";
import FastReadReader from "@/app/components/fastread-reader";
import NavbarFlowerWind from "@/app/components/navbar-flower-wind";
import { startNavigationProgress } from "@/app/components/navigation-progress";

interface Props {
  /** The name the message kept, already reduced to a name. */
  fileName: string;
  /** "Word", "Excel", "PowerPoint" — what the header calls this file. */
  kicker: string;
  /** What is in the file besides prose, in the words a person would use. */
  description: string;
  /** The document read as markdown, with figures pointing at their sidecars. */
  markdown: string;
  /** Anything the reader could not do, said plainly rather than swallowed. */
  warnings: readonly string[];
  /** The original bytes, for downloading and for nothing else. */
  sourceUrl: string;
  /** Whether this account asked for the Fast-read seat in its profile. */
  fastRead?: boolean;
}

interface Heading {
  id: string;
  title: string;
  level: number;
}

interface OutlineEntry extends Heading {
  children: OutlineEntry[];
}

/**
 * A Chromium-only way to paint a search hit without touching the DOM. Where it
 * is missing the find still walks and still scrolls; only the colour is lost,
 * which is a better failure than rewriting the document to highlight it.
 */
interface HighlightRegistry {
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
}

const ALL_MATCHES = "bb-document-find";
const CURRENT_MATCH = "bb-document-find-current";
const MIN_SCALE = 0.7;
const MAX_SCALE = 2.4;

function highlightRegistry(): HighlightRegistry | null {
  if (typeof CSS === "undefined") return null;
  const registry = (CSS as unknown as { highlights?: HighlightRegistry }).highlights;
  return registry ?? null;
}

function makeHighlight(ranges: readonly Range[]): unknown {
  const constructor = (
    globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }
  ).Highlight;
  if (!constructor) return null;
  return new constructor(...ranges);
}

/**
 * The headings the outline is built from, read out of the markdown the way the
 * renderer will read them: ATX only, and never inside a fence.
 *
 * Reading them here rather than off the rendered page is what lets the outline
 * exist on the first paint. It costs one agreement — that this list and the
 * headings on the page come out in the same order — which is why a heading with
 * no text is kept in the list and merely hidden from the outline: dropping it
 * would shift every id after it onto the wrong heading.
 */
function parseHeadings(markdown: string): Heading[] {
  const headings: Heading[] = [];
  let fence = "";
  for (const line of markdown.split(/\r?\n/)) {
    const fenced = /^ {0,3}(```+|~~~+)/.exec(line);
    if (fenced) {
      const marker = fenced[1][0];
      if (!fence) fence = marker;
      else if (fence === marker) fence = "";
      continue;
    }
    if (fence) continue;
    const heading = /^ {0,3}(#{1,6})(?:\s+(.*?))?\s*$/.exec(line);
    if (!heading) continue;
    headings.push({
      id: `section-${headings.length}`,
      // A closing run of hashes is decoration, not part of the title.
      title: (heading[2] ?? "").replace(/\s+#+\s*$/, "").trim(),
      level: heading[1].length,
    });
  }
  return headings;
}

/** Flat headings into the nesting the outline shows, by their own levels. */
function buildOutline(headings: readonly Heading[]): OutlineEntry[] {
  const roots: OutlineEntry[] = [];
  const open: OutlineEntry[] = [];
  for (const heading of headings) {
    const entry: OutlineEntry = { ...heading, children: [] };
    while (open.length > 0 && open[open.length - 1].level >= entry.level) open.pop();
    if (open.length > 0) open[open.length - 1].children.push(entry);
    else roots.push(entry);
    open.push(entry);
  }
  return roots;
}

function OutlineItem({
  item,
  depth,
  activeId,
  collapsedIds,
  onToggle,
  onNavigate,
}: {
  item: OutlineEntry;
  depth: number;
  activeId: string;
  collapsedIds: Set<string>;
  onToggle: (id: string) => void;
  onNavigate: (id: string) => void;
}) {
  const hasChildren = item.children.length > 0;
  const isCollapsed = collapsedIds.has(item.id);

  return (
    <li>
      <div
        className="flex min-w-0 items-center gap-1"
        style={{ paddingLeft: `${depth * 12}px` }}
      >
        <button
          type="button"
          onClick={() => onToggle(item.id)}
          disabled={!hasChildren}
          aria-label={isCollapsed ? "Expand outline section" : "Collapse outline section"}
          className="flex h-5 w-4 shrink-0 items-center justify-center text-[10px] text-gray-600 transition-colors hover:text-gray-900 disabled:cursor-default disabled:text-transparent"
        >
          {isCollapsed ? ">" : "v"}
        </button>
        <button
          type="button"
          onClick={() => onNavigate(item.id)}
          className={`min-w-0 flex-1 truncate rounded px-1 py-0.5 text-left text-xs leading-5 transition-colors hover:bg-black/10 ${
            activeId === item.id ? "bg-black/10 font-medium text-gray-900" : "text-gray-700"
          }`}
          title={item.title}
        >
          {item.title}
        </button>
      </div>
      {hasChildren && !isCollapsed && (
        <ul>
          {item.children.map((child) => (
            <OutlineItem
              key={child.id}
              item={child}
              depth={depth + 1}
              activeId={activeId}
              collapsedIds={collapsedIds}
              onToggle={onToggle}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * The reader for an attached document that is not a PDF.
 *
 * Deliberately the PDF viewer's shape rather than a new one: the same header,
 * the same outline down the left, the same section and zoom and find controls,
 * and the document itself on a page in the middle. What differs is what is
 * being shown — a .docx has no pages to render, so what is on the sheet is the
 * structural reading the attachment pipeline already does, with the tables
 * still tables, the equations still equations, and the figures pulled out of
 * the file shown where they sat in it.
 *
 * Read-only throughout. An attachment is the file the person sent, and there is
 * nowhere to write an edited copy back to.
 */
export default function DocumentViewerClient({
  fileName,
  kicker,
  description,
  markdown,
  warnings,
  sourceUrl,
  fastRead = false,
}: Props) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sheetRef = useRef<HTMLElement | null>(null);
  const matchesRef = useRef<Range[]>([]);

  const [activeId, setActiveId] = useState("");
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [scale, setScale] = useState(1);
  const [query, setQuery] = useState("");
  const [matchCount, setMatchCount] = useState(0);
  const [matchIndex, setMatchIndex] = useState(0);
  const [fastReadOpen, setFastReadOpen] = useState(false);
  const [error, setError] = useState("");

  // Two lists, because they answer different questions. `rendered` is every
  // heading the page will have, in order, and only exists to put an id on each
  // one. `headings` is the ones worth showing, which is what the outline, the
  // section counter and Previous/Next all work from.
  const rendered = useMemo(() => parseHeadings(markdown), [markdown]);
  const headings = useMemo(() => rendered.filter((heading) => heading.title), [rendered]);
  const outline = useMemo(() => buildOutline(headings), [headings]);
  const activeIndex = headings.findIndex((heading) => heading.id === activeId);

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    sheet.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((element, index) => {
      const heading = rendered[index];
      if (heading) element.id = heading.id;
    });
  }, [rendered]);

  // Which section you are in, kept the way a PDF keeps which page you are on.
  useEffect(() => {
    const container = containerRef.current;
    const sheet = sheetRef.current;
    if (!container || !sheet || headings.length === 0) return;

    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const top = container.getBoundingClientRect().top + 96;
        let current = headings[0].id;
        for (const heading of headings) {
          const element = sheet.querySelector(`#${CSS.escape(heading.id)}`);
          if (!element) continue;
          if (element.getBoundingClientRect().top <= top) current = heading.id;
          else break;
        }
        setActiveId(current);
      });
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      container.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [headings]);

  const goToHeading = useCallback((id: string) => {
    const element = sheetRef.current?.querySelector(`#${CSS.escape(id)}`);
    if (!element) return;
    element.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveId(id);
  }, []);

  const goToAdjacentSection = useCallback(
    (step: number) => {
      const next = activeIndex + step;
      const heading = headings[next];
      if (heading) goToHeading(heading.id);
    },
    [activeIndex, goToHeading, headings],
  );

  const toggleOutlineItem = useCallback((id: string) => {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const paintMatch = useCallback((ranges: readonly Range[], index: number) => {
    const registry = highlightRegistry();
    if (!registry) return;
    const all = makeHighlight(ranges);
    const current = ranges[index] ? makeHighlight([ranges[index]]) : null;
    if (all) registry.set(ALL_MATCHES, all);
    else registry.delete(ALL_MATCHES);
    if (current) registry.set(CURRENT_MATCH, current);
    else registry.delete(CURRENT_MATCH);
  }, []);

  const clearMatches = useCallback(() => {
    matchesRef.current = [];
    setMatchCount(0);
    setMatchIndex(0);
    const registry = highlightRegistry();
    registry?.delete(ALL_MATCHES);
    registry?.delete(CURRENT_MATCH);
  }, []);

  const showMatch = useCallback(
    (index: number) => {
      const ranges = matchesRef.current;
      if (ranges.length === 0) return;
      const wrapped = ((index % ranges.length) + ranges.length) % ranges.length;
      setMatchIndex(wrapped);
      paintMatch(ranges, wrapped);
      const rect = ranges[wrapped].getBoundingClientRect();
      const container = containerRef.current;
      if (!container) return;
      const bounds = container.getBoundingClientRect();
      if (rect.top < bounds.top + 60 || rect.bottom > bounds.bottom - 60) {
        container.scrollBy({
          top: rect.top - bounds.top - bounds.height / 3,
          behavior: "smooth",
        });
      }
    },
    [paintMatch],
  );

  const runFind = useCallback(() => {
    const needle = query.trim().toLowerCase();
    const sheet = sheetRef.current;
    if (!needle || !sheet) {
      clearMatches();
      return;
    }

    const walker = document.createTreeWalker(sheet, NodeFilter.SHOW_TEXT);
    const ranges: Range[] = [];
    let node = walker.nextNode();
    while (node) {
      const text = node.nodeValue?.toLowerCase() ?? "";
      let from = text.indexOf(needle);
      while (from !== -1 && ranges.length < 2000) {
        const range = document.createRange();
        range.setStart(node, from);
        range.setEnd(node, from + needle.length);
        ranges.push(range);
        from = text.indexOf(needle, from + needle.length);
      }
      node = walker.nextNode();
    }

    matchesRef.current = ranges;
    setMatchCount(ranges.length);
    if (ranges.length === 0) {
      setError(`No match for "${query.trim()}".`);
      paintMatch([], 0);
      return;
    }
    setError("");
    showMatch(0);
  }, [clearMatches, paintMatch, query, showMatch]);

  useEffect(() => clearMatches, [clearMatches]);

  const goBack = useCallback(() => {
    startNavigationProgress();
    router.back();
  }, [router]);

  const hasText = markdown.trim().length > 0;

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <style>{`
        ::highlight(${ALL_MATCHES}) { background-color: #fde68a; color: #111827; }
        ::highlight(${CURRENT_MATCH}) { background-color: #f59e0b; color: #111827; }
      `}</style>

      <header className="breadboard-flower-navbar relative flex flex-wrap items-center justify-between gap-3 border-b border-gray-800 px-4 py-3">
        <NavbarFlowerWind />
        <div className="relative z-10 flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={goBack}
            className="rounded-md border border-gray-800 px-3 py-1.5 text-xs text-gray-400 transition-colors hover:border-gray-600 hover:text-white"
          >
            Back
          </button>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-gray-600">
              {kicker} attachment
            </p>
            <h1 className="truncate text-sm font-semibold text-white">{fileName}</h1>
          </div>
        </div>
        <div className="relative z-10 flex flex-wrap items-center gap-2">
          {description ? (
            <span className="px-1 text-xs text-gray-500">Contains {description}</span>
          ) : null}
          <a
            href={sourceUrl}
            download={fileName}
            className="rounded-md border border-gray-800 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:border-gray-600 hover:text-white"
          >
            Download original
          </a>
        </div>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-800 bg-gray-900 px-4 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setOutlineOpen((open) => !open)}
            disabled={headings.length === 0}
            className={`rounded-md border px-3 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              outlineOpen
                ? "border-gray-600 bg-gray-800 text-white"
                : "border-gray-700 bg-gray-900 text-gray-300 hover:border-gray-500 hover:text-white"
            }`}
            aria-pressed={outlineOpen}
            aria-expanded={outlineOpen}
            aria-controls="document-outline"
          >
            Outline
          </button>
          {fastRead && (
            <button
              type="button"
              onClick={() => setFastReadOpen(true)}
              disabled={!hasText}
              title="Speed-read this document one word at a time"
              className="flex items-center gap-1.5 rounded-md border border-gray-700 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.8}
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 4 6 13h5l-1 7 7-9h-5z" />
              </svg>
              Fast-read
            </button>
          )}
          <button
            type="button"
            onClick={() => goToAdjacentSection(-1)}
            disabled={activeIndex <= 0}
            className="rounded-md border border-gray-700 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Previous
          </button>
          <span className="min-w-24 text-center text-xs text-gray-500">
            {headings.length
              ? `${Math.max(activeIndex, 0) + 1} / ${headings.length}`
              : "No sections"}
          </span>
          <button
            type="button"
            onClick={() => goToAdjacentSection(1)}
            disabled={activeIndex < 0 || activeIndex >= headings.length - 1}
            className="rounded-md border border-gray-700 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
          <button
            type="button"
            onClick={() => setScale((current) => Math.max(MIN_SCALE, current - 0.1))}
            disabled={scale <= MIN_SCALE}
            className="h-8 w-8 rounded-md border border-gray-700 text-sm text-gray-300 transition-colors hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Zoom out"
          >
            -
          </button>
          <span className="w-14 text-center text-xs text-gray-500">
            {Math.round(scale * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setScale((current) => Math.min(MAX_SCALE, current + 0.1))}
            disabled={scale >= MAX_SCALE}
            className="h-8 w-8 rounded-md border border-gray-700 text-sm text-gray-300 transition-colors hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Zoom in"
          >
            +
          </button>
        </div>

        <form
          className="flex min-w-64 flex-1 items-center justify-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (matchesRef.current.length > 0) showMatch(matchIndex + 1);
            else runFind();
          }}
        >
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              // A match found in the old query points at text the new one may
              // not cover; dropping them as you type is cheaper than trying to
              // keep them honest.
              clearMatches();
              setError("");
            }}
            placeholder={`Find in ${kicker.toLowerCase()} file`}
            className="h-8 w-full max-w-64 rounded-md border border-gray-700 bg-gray-950 px-3 text-xs text-gray-200 outline-none transition-colors placeholder:text-gray-600 focus:border-gray-500"
          />
          <span className="w-20 text-center text-xs text-gray-500">
            {matchCount ? `${matchIndex + 1} of ${matchCount}` : ""}
          </span>
          <button
            type="submit"
            disabled={!query.trim() || !hasText}
            className="rounded-md border border-gray-700 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Find
          </button>
          <button
            type="button"
            onClick={() => showMatch(matchIndex - 1)}
            disabled={matchCount === 0}
            className="rounded-md border border-gray-700 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Previous match
          </button>
          <button
            type="button"
            onClick={() => showMatch(matchIndex + 1)}
            disabled={matchCount === 0}
            className="rounded-md border border-gray-700 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next match
          </button>
        </form>
      </div>

      {(error || warnings.length > 0) && (
        <div className="border-b border-amber-900/60 bg-amber-950/40 px-4 py-2 text-xs text-amber-200">
          {error ? <p>{error}</p> : null}
          {warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      )}

      <section className="flex min-h-0 flex-1">
        {outlineOpen && headings.length > 0 && (
          <aside
            id="document-outline"
            className="hidden w-64 shrink-0 border-r border-gray-800 bg-[#ece6d8] text-gray-800 shadow-inner md:flex md:min-h-0 md:flex-col"
          >
            <div className="flex h-11 shrink-0 items-center gap-2 border-b border-black/10 px-4">
              <svg
                className="h-4 w-4 text-gray-700"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M4 4h4v4H4V4Zm8 0h4v4h-4V4ZM4 12h4v4H4v-4Zm8 0h4v4h-4v-4Z" />
              </svg>
              <span className="truncate text-sm font-medium">Document outline</span>
              <button
                type="button"
                onClick={() => setOutlineOpen(false)}
                className="ml-auto flex h-7 w-7 items-center justify-center rounded text-gray-600 transition-colors hover:bg-black/10 hover:text-gray-900"
                aria-label="Close document outline"
                title="Close document outline"
              >
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto overscroll-contain px-2 py-3">
              <ul className="space-y-0.5">
                {outline.map((item) => (
                  <OutlineItem
                    key={item.id}
                    item={item}
                    depth={0}
                    activeId={activeId}
                    collapsedIds={collapsedIds}
                    onToggle={toggleOutlineItem}
                    onNavigate={goToHeading}
                  />
                ))}
              </ul>
            </div>
          </aside>
        )}

        <div className="relative min-w-0 flex-1">
          <div ref={containerRef} className="absolute inset-0 overflow-auto bg-gray-900 px-4 py-6">
            <article
              ref={sheetRef}
              style={{ fontSize: `${scale}rem` }}
              className="mx-auto w-full max-w-[52rem] rounded-sm border border-[#c7d8cc] bg-[#fbfaf6] px-10 py-12 text-gray-900 shadow-xl"
            >
              {hasText ? (
                <ChatMarkdown content={markdown} />
              ) : (
                <p className="text-sm leading-6 text-gray-600">
                  Nothing readable came out of this file. The original is still
                  here — download it above and open it in the application that
                  wrote it.
                </p>
              )}
            </article>
          </div>
        </div>
      </section>

      {fastReadOpen && (
        <FastReadReader
          title={fileName}
          content={markdown}
          onClose={() => setFastReadOpen(false)}
        />
      )}
    </main>
  );
}
