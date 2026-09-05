"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  describeTabUrl,
  openBrowserInDesktop,
  sendDesktopTabsCommand,
  tabLabel,
  type DesktopTabKind,
  type DesktopTabView,
  type DesktopTabsState,
} from "@/lib/desktop-browser-tabs";
import { useDesktopTabs } from "./use-desktop-tabs";

/** How far a press travels before it is a drag rather than a click. */
const DRAG_THRESHOLD_PX = 6;

export default function DesktopTitleBar() {
  useEffect(() => {
    if (!("breadboardDesktop" in window)) return;
    // The inline script in the document head normally sets this before the first
    // paint, which is what keeps the caption strip from arriving a few frames
    // late. This is only the fallback for a session where that script did not
    // run, so it cleans up nothing it did not set itself.
    if (document.documentElement.dataset.breadboardDesktop === "true") return;
    document.documentElement.dataset.breadboardDesktop = "true";
    return () => {
      delete document.documentElement.dataset.breadboardDesktop;
    };
  }, []);

  const tabs = useDesktopTabs();

  return (
    <div className="desktop-title-bar" aria-label="Window controls">
      {tabs?.enabled ? <TabStrip state={tabs} /> : null}
    </div>
  );
}

interface DragState {
  id: number;
  pointerId: number;
  startX: number;
  offset: number;
  dragging: boolean;
  /** Where the tab would land if released now. */
  target: number;
}

function browserTabFaviconFallback(address: string | undefined): string | undefined {
  if (!address) return undefined;
  try {
    const page = new URL(address);
    if (page.protocol !== "http:" && page.protocol !== "https:") return undefined;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(page.hostname)}&sz=64`;
  } catch {
    return undefined;
  }
}

/**
 * The window's tabs, drawn along the caption strip: the active
 * one raised, the rest flat with a glyph for the kind of page, a close on
 * each and a plus at the end. The strip is the window's drag handle, so only
 * the tabs and buttons opt out of it.
 *
 * Nothing here is the source of truth. Every gesture is sent to the shell,
 * which owns the tabs and answers with the next state; a tab dragged along
 * the strip only moves for real once the shell has moved it.
 */
function TabStrip({ state }: { state: DesktopTabsState }) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  function updateDrag(next: DragState | null) {
    // Pointer down and up can arrive before React has rendered the state update
    // from the first event. Keep the gesture's live value synchronous so a
    // quick click never disappears merely because its tab was farther along
    // the strip (or the renderer was busy for a frame).
    dragRef.current = next;
    setDrag(next);
  }

  useEffect(() => {
    stripRef.current?.querySelector<HTMLElement>(`[data-tab-id="${state.activeId}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [state.activeId]);

  function orderedTabElements(): HTMLElement[] {
    const strip = stripRef.current;
    if (!strip) return [];
    return Array.from(strip.querySelectorAll<HTMLElement>("[data-tab-id]"));
  }

  function targetIndexFor(clientX: number, draggedId: number): number {
    // The slot a release would fill: one past every other tab whose middle
    // the pointer has crossed.
    let index = 0;
    for (const element of orderedTabElements()) {
      if (Number(element.dataset.tabId) === draggedId) continue;
      const rect = element.getBoundingClientRect();
      if (clientX > rect.left + rect.width / 2) index += 1;
    }
    return index;
  }

  function onTabPointerDown(event: ReactPointerEvent<HTMLDivElement>, tab: DesktopTabView) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateDrag({
      id: tab.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      offset: 0,
      dragging: false,
      target: state.tabs.findIndex((candidate) => candidate.id === tab.id),
    });
  }

  function onTabPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const current = dragRef.current;
    if (!current || event.pointerId !== current.pointerId) return;
    const offset = event.clientX - current.startX;
    const dragging = current.dragging || Math.abs(offset) > DRAG_THRESHOLD_PX;
    if (!dragging) return;
    updateDrag({
      ...current,
      offset,
      dragging,
      target: targetIndexFor(event.clientX, current.id),
    });
  }

  function onTabPointerUp(event: ReactPointerEvent<HTMLDivElement>, tab: DesktopTabView) {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    updateDrag(null);
    if (!drag.dragging) {
      if (tab.id !== state.activeId) void sendDesktopTabsCommand({ type: "activate", id: tab.id });
      return;
    }
    const from = state.tabs.findIndex((candidate) => candidate.id === tab.id);
    if (drag.target !== from) {
      void sendDesktopTabsCommand({ type: "move", id: tab.id, index: drag.target });
    }
  }

  function onTabPointerCancel() {
    updateDrag(null);
  }

  return (
    <div ref={stripRef} className="bb-tabstrip" role="tablist" aria-label="Browser tabs">
      {state.tabs.map((tab) => {
        const active = tab.id === state.activeId;
        const dragging = drag?.dragging === true && drag.id === tab.id;
        const label = tabLabel(tab.title, tab.url);
        const kind = tab.browser ? "browser" : describeTabUrl(tab.url).kind;
        const reportedFavicon = tab.browser?.favicon;
        const fallbackFavicon = browserTabFaviconFallback(tab.browser?.address);
        const favicon = reportedFavicon ?? fallbackFavicon;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            title={label}
            className="bb-tab"
            data-tab-id={tab.id}
            data-active={active ? "true" : undefined}
            data-anchored={tab.anchored ? "true" : undefined}
            data-loading={tab.loading ? "true" : undefined}
            data-dragging={dragging ? "true" : undefined}
            style={dragging ? { transform: `translateX(${drag?.offset ?? 0}px)` } : undefined}
            onPointerDown={(event) => onTabPointerDown(event, tab)}
            onPointerMove={onTabPointerMove}
            onPointerUp={(event) => onTabPointerUp(event, tab)}
            onPointerCancel={onTabPointerCancel}
            onAuxClick={(event) => {
              // The middle button closes a tab, as it does in a browser.
              if (event.button !== 1) return;
              event.preventDefault();
              void sendDesktopTabsCommand({ type: "close", id: tab.id });
            }}
          >
            <span className="bb-tab-glyph" aria-hidden="true">
              {favicon ? (
                <span className="bb-tab-favicon-frame">
                  <TabGlyph kind="browser" />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    key={`${reportedFavicon ?? ""}|${fallbackFavicon ?? ""}`}
                    className="bb-tab-favicon"
                    src={favicon}
                    alt=""
                    data-fallback={reportedFavicon ? undefined : "true"}
                    onError={(event) => {
                      const image = event.currentTarget;
                      if (fallbackFavicon && image.dataset.fallback !== "true") {
                        image.dataset.fallback = "true";
                        image.src = fallbackFavicon;
                      } else {
                        image.hidden = true;
                      }
                    }}
                  />
                </span>
              ) : tab.loading ? (
                <span className="bb-tab-spinner" />
              ) : (
                <TabGlyph kind={kind} />
              )}
            </span>
            <span className="bb-tab-title">{label}</span>
            <button
              type="button"
              className="bb-tab-anchor"
              aria-label={`${tab.anchored ? "Unanchor" : "Anchor"} ${label}`}
              aria-pressed={tab.anchored === true}
              title={tab.anchored ? "Unanchor tab to allow closing" : "Anchor tab to keep it open"}
              onPointerDown={(event) => event.stopPropagation()}
              onAuxClick={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                void sendDesktopTabsCommand({ type: "anchor", id: tab.id });
              }}
            >
              <svg viewBox="0 0 14 14" aria-hidden="true">
                <circle cx="7" cy="3" r="1.5" {...STROKE} />
                <path d="M7 4.5v8M4.5 6.5h5M2 8.5v1a5 3 0 0 0 10 0v-1M2 8.5l-1 1M12 8.5l1 1" {...STROKE} />
              </svg>
            </button>
            <button
              type="button"
              className="bb-tab-close"
              aria-label={`Close ${label}`}
              disabled={tab.anchored === true}
              title={tab.anchored ? "Unanchor tab before closing" : `Close ${label}`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                void sendDesktopTabsCommand({ type: "close", id: tab.id });
              }}
            >
              <CloseGlyph />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        className="bb-tab-new"
        aria-label="New tab"
        title="New tab (Ctrl+T); right-click to open Browser"
        onClick={() => {
          void sendDesktopTabsCommand({ type: "new" });
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void openBrowserInDesktop();
        }}
      >
        <PlusGlyph />
      </button>
    </div>
  );
}

const STROKE = {
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  fill: "none",
};

/** A small mark for the kind of page a tab shows, so a row of tabs reads at
 *  a glance even when several share a name. */
function TabGlyph({ kind }: { kind: DesktopTabKind }) {
  switch (kind) {
    case "dashboard":
      return (
        <svg viewBox="0 0 14 14">
          <rect x="1.5" y="1.5" width="4.5" height="4.5" rx="1" {...STROKE} />
          <rect x="8" y="1.5" width="4.5" height="4.5" rx="1" {...STROKE} />
          <rect x="1.5" y="8" width="4.5" height="4.5" rx="1" {...STROKE} />
          <rect x="8" y="8" width="4.5" height="4.5" rx="1" {...STROKE} />
        </svg>
      );
    case "plan":
      return (
        <svg viewBox="0 0 14 14">
          <path d="M2.5 3.5h9M2.5 7h9M2.5 10.5h5.5" {...STROKE} />
        </svg>
      );
    case "organization":
      return (
        <svg viewBox="0 0 14 14">
          <circle cx="7" cy="4" r="2" {...STROKE} />
          <circle cx="3" cy="10.5" r="1.7" {...STROKE} />
          <circle cx="11" cy="10.5" r="1.7" {...STROKE} />
          <path d="M5.6 5.4L4 8.9M8.4 5.4L10 8.9" {...STROKE} />
        </svg>
      );
    case "profile":
      return (
        <svg viewBox="0 0 14 14">
          <circle cx="7" cy="4.8" r="2.4" {...STROKE} />
          <path d="M2.5 12.3c.6-2.6 2.2-3.8 4.5-3.8s3.9 1.2 4.5 3.8" {...STROKE} />
        </svg>
      );
    case "calendar":
      return (
        <svg viewBox="0 0 14 14">
          <rect x="1.8" y="2.8" width="10.4" height="9.4" rx="1.4" {...STROKE} />
          <path d="M1.8 6h10.4M4.5 1.5v2.5M9.5 1.5v2.5" {...STROKE} />
        </svg>
      );
    case "gardens":
    case "lessons":
      return (
        <svg viewBox="0 0 14 14">
          <path d="M7 12.5V6.5" {...STROKE} />
          <path d="M7 7.5C7 4 9 2 12.3 1.8 12.2 5.2 10.3 7.3 7 7.5z" {...STROKE} />
          <path d="M7 9.8C7 7.6 5.6 6.2 3 6.1c.1 2.5 1.5 3.8 4 3.7z" {...STROKE} />
        </svg>
      );
    case "workspace":
      return (
        <svg viewBox="0 0 14 14">
          <rect x="1.8" y="2.3" width="10.4" height="9.4" rx="1.4" {...STROKE} />
          <path d="M1.8 5.4h10.4M5.4 5.4v6.3" {...STROKE} />
        </svg>
      );
    case "timer":
      return (
        <svg viewBox="0 0 14 14">
          <circle cx="7" cy="7.6" r="4.6" {...STROKE} />
          <path d="M7 5v2.8l1.8 1.2M5.3 1.6h3.4" {...STROKE} />
        </svg>
      );
    case "browser":
      // A globe: the tab is the sandboxed web rather than a Breadboard place.
      return (
        <svg viewBox="0 0 14 14">
          <circle cx="7" cy="7" r="5.2" {...STROKE} />
          <path d="M1.8 7h10.4M7 1.8c-1.9 1.6-1.9 8.8 0 10.4M7 1.8c1.9 1.6 1.9 8.8 0 10.4" {...STROKE} />
        </svg>
      );
    case "new":
      return (
        <svg viewBox="0 0 14 14">
          <path d="M7 2.5v9M2.5 7h9" {...STROKE} />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 14 14">
          <path d="M3.5 1.8h4.6l3 3v7.4a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V2.8a1 1 0 0 1 1-1z" {...STROKE} />
          <path d="M8 1.8v3h3" {...STROKE} />
        </svg>
      );
  }
}

function CloseGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" {...STROKE} strokeWidth={1.4} />
    </svg>
  );
}

function PlusGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M6 1.5v9M1.5 6h9" {...STROKE} />
    </svg>
  );
}
