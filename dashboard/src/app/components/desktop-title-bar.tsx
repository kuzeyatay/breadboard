"use client";

import { Fragment, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import {
  TAB_GROUP_COLORS,
  describeTabUrl,
  openBrowserInDesktop,
  sendDesktopTabsCommand,
  tabLabel,
  type DesktopTabKind,
  type DesktopTabView,
  type DesktopTabsState,
} from "@/lib/desktop-browser-tabs";
import { createPortal } from "react-dom";
import { tabDropTarget, tabGroupDropTarget, type TabDropRect, type TabDropTarget } from "@/lib/desktop-tab-drag";
import { useDesktopTabs } from "./use-desktop-tabs";
import { isMacPlatform } from "@/app/buzz/lib/platform";

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
  // Hidden/prepared renderers must not publish caption hit regions over the
  // visible tab's controls. An unregistered page has no window drag ownership.
  const canDragWindow = tabs?.selfId != null && tabs.selfId === tabs.activeId;

  return (
    <div className="desktop-title-bar" data-window-drag={canDragWindow} aria-label="Window controls">
      {tabs?.enabled ? <TabStrip state={tabs} /> : null}
    </div>
  );
}

interface DragState {
  id: number;
  /** Present when the group label is dragging all of its members. */
  groupId?: string;
  width: number;
  pointerId: number;
  startX: number;
  offset: number;
  dragging: boolean;
  /** Where the tab would land if released now. */
  target: number;
  drop: TabDropTarget | null;
  groupReady: boolean;
  clientX: number;
  clientY: number;
  scrollLeft: number;
  rects: TabDropRect[];
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
 * each and a plus at the end. The empty area after the plus is the window's
 * drag handle; the control strip itself always receives mouse input.
 *
 * Nothing here is the source of truth. Every gesture is sent to the shell,
 * which owns the tabs and answers with the next state; a tab dragged along
 * the strip only moves for real once the shell has moved it.
 */
function TabStrip({ state }: { state: DesktopTabsState }) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const groupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressGroupClick = useRef<string | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const groups = state.groups ?? [];
  const ariaShortcutModifier = isMacPlatform() ? "Meta" : "Control";
  const visibleTabs = state.tabs.filter(tab => !groups.some(group => group.id === tab.groupId && group.collapsed));

  function clearGroupTimer() {
    if (groupTimer.current) clearTimeout(groupTimer.current);
    groupTimer.current = null;
  }

  function cancelDrag() {
    if (dragRef.current?.groupId) suppressGroupClick.current = dragRef.current.groupId;
    clearGroupTimer();
    updateDrag(null);
  }

  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") cancelDrag(); };
    window.addEventListener("keydown", escape);
    window.addEventListener("blur", cancelDrag);
    return () => { clearGroupTimer(); window.removeEventListener("keydown", escape); window.removeEventListener("blur", cancelDrag); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!drag?.dragging) return;
    let frame = 0;
    const tick = () => {
      const current = dragRef.current, strip = stripRef.current;
      if (!current || !strip) return;
      const bounds = strip.getBoundingClientRect();
      const step = current.clientX < bounds.left + 30 ? -8 : current.clientX > bounds.right - 30 ? 8 : 0;
      if (step) {
        const before = strip.scrollLeft;
        strip.scrollLeft += step;
        if (before !== strip.scrollLeft) previewDrop(current, current.clientX, current.clientY);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [drag?.dragging]); // eslint-disable-line react-hooks/exhaustive-deps

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

  function previewDrop(current: DragState, clientX: number, clientY: number) {
    const strip = stripRef.current;
    if (!strip) return;
    const bounds = strip.getBoundingClientRect();
    const scrollDelta = strip.scrollLeft - current.scrollLeft;
    const rects = current.rects.map(rect => ({ ...rect, left: rect.left - scrollDelta }));
    const drop = clientY < bounds.top - 12 || clientY > bounds.bottom + 18 ? null
      : current.groupId ? tabGroupDropTarget(stateRef.current.tabs, rects, current.groupId, clientX)
      : tabDropTarget(stateRef.current.tabs, rects, current.id, clientX);
    if (current.groupId) suppressGroupClick.current = current.groupId;
    const sameCandidate = drop?.groupTargetId !== undefined && drop.groupTargetId === current.drop?.groupTargetId;
    if (!sameCandidate) clearGroupTimer();
    const next = { ...current, clientX, clientY, offset: clientX - current.startX + scrollDelta,
      dragging: true, target: drop?.index ?? current.target, drop, groupReady: sameCandidate && current.groupReady };
    updateDrag(next);
    if (drop?.groupTargetId !== undefined && !sameCandidate) {
      groupTimer.current = setTimeout(() => {
        const live = dragRef.current;
        if (live && live.drop?.groupTargetId === drop.groupTargetId) updateDrag({ ...live, groupReady: true });
      }, 400);
    }
  }

  function onTabPointerDown(event: ReactPointerEvent<HTMLElement>, tab: DesktopTabView, groupId?: string) {
    if (event.button !== 0 || dragRef.current) return;
    clearGroupTimer();
    suppressGroupClick.current = null;
    event.currentTarget.setPointerCapture(event.pointerId);
    const elements = Array.from(stripRef.current?.querySelectorAll<HTMLElement>("[data-tab-id], [data-group-marker]") ?? []);
    const members = new Set(state.tabs.filter(tab => tab.groupId === groupId).map(tab => tab.id));
    const draggedElements = groupId ? elements.filter(element => element.dataset.groupMarker === groupId ||
      (element.dataset.tabId !== undefined && members.has(Number(element.dataset.tabId)))) : [event.currentTarget];
    updateDrag({
      id: tab.id,
      groupId,
      width: draggedElements.reduce((width, element) => {
        const style = getComputedStyle(element);
        return width + element.getBoundingClientRect().width + parseFloat(style.marginLeft) + parseFloat(style.marginRight);
      }, 0),
      pointerId: event.pointerId,
      startX: event.clientX,
      offset: 0,
      dragging: false,
      target: state.tabs.findIndex((candidate) => candidate.id === tab.id),
      drop: null, groupReady: false, clientX: event.clientX, clientY: event.clientY,
      scrollLeft: stripRef.current?.scrollLeft ?? 0,
      rects: elements.map(element => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, width: rect.width,
          ...(element.dataset.tabId ? { id: Number(element.dataset.tabId) } : { groupId: element.dataset.groupMarker }) };
      }),
    });
  }

  function onTabPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const current = dragRef.current;
    if (!current || event.pointerId !== current.pointerId) return;
    const offset = event.clientX - current.startX;
    const dragging = current.dragging || Math.abs(offset) > DRAG_THRESHOLD_PX;
    if (!dragging) return;
    previewDrop(current, event.clientX, event.clientY);
  }

  function onTabPointerUp(event: ReactPointerEvent<HTMLElement>, tab: DesktopTabView) {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    clearGroupTimer();
    updateDrag(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!drag.dragging) {
      if (!drag.groupId && tab.id !== state.activeId) void sendDesktopTabsCommand({ type: "activate", id: tab.id });
      return;
    }
    if (!drag.drop) return;
    if (drag.groupId) {
      if (drag.target !== state.tabs.findIndex(tab => tab.groupId === drag.groupId)) {
        void sendDesktopTabsCommand({ type: "group-move", groupId: drag.groupId, index: drag.target });
      }
      return;
    }
    if (drag.groupReady && drag.drop.groupTargetId !== undefined) {
      void sendDesktopTabsCommand({ type: "group-tabs", id: tab.id, targetId: drag.drop.groupTargetId });
      return;
    }
    const from = state.tabs.findIndex((candidate) => candidate.id === tab.id);
    if (drag.target !== from || (tab.groupId ?? null) !== drag.drop.groupId) {
      void sendDesktopTabsCommand({ type: "move", id: tab.id, index: drag.target, groupId: drag.drop.groupId });
    }
  }

  function onTabPointerCancel() { cancelDrag(); }

  function openTabMenu(tab: DesktopTabView, x: number, y: number) {
    cancelDrag();
    void sendDesktopTabsCommand({ type: "tab-menu", id: tab.id, x: Math.max(0, x), y: Math.max(0, y) });
  }

  const groupTarget = state.tabs.find(tab => tab.id === drag?.drop?.groupTargetId);
  const dropGroup = groups.find(group => group.id === groupTarget?.groupId);
  const draggedGroup = groups.find(group => group.id === drag?.groupId);
  const dropColor = TAB_GROUP_COLORS[draggedGroup?.color ?? dropGroup?.color ?? "blue"];
  const sourceIndex = state.tabs.findIndex(tab => tab.id === drag?.id);
  const sourceCount = drag?.groupId ? state.tabs.filter(tab => tab.groupId === drag.groupId).length : 1;
  const draggedWidth = drag?.width ?? 0;
  const previewReorder = drag?.dragging && drag.drop && drag.drop.groupTargetId === undefined &&
    (drag.groupId || state.tabs.slice(Math.min(sourceIndex, drag.target), Math.max(sourceIndex, drag.target) + 1).every(tab => !tab.groupId));
  const markerX = (drag?.drop?.markerX ?? 0) - (previewReorder && sourceIndex < drag.target ? draggedWidth : 0);

  return (
    <div ref={stripRef} className="bb-tabstrip" role="tablist" aria-label="Browser tabs">
      {state.tabs.map((tab, index) => {
        const group = groups.find(group => group.id === tab.groupId);
        const firstInGroup = group && state.tabs[index - 1]?.groupId !== group.id;
        const groupStyle = group ? { "--group-color": TAB_GROUP_COLORS[group.color] } as CSSProperties : undefined;
        const dragging = drag?.dragging === true && (drag.groupId ? tab.groupId === drag.groupId : drag.id === tab.id);
        const shift = previewReorder && !dragging ? sourceIndex < drag.target && index >= sourceIndex + sourceCount && index < drag.target + sourceCount ? -draggedWidth
          : sourceIndex > drag.target && index >= drag.target && index < sourceIndex ? draggedWidth : 0 : 0;
        const groupDragging = dragging && drag?.groupId === group?.id;
        const groupMarker = firstInGroup ? <button type="button" className="bb-tab-group" data-group-marker={group.id}
          data-collapsed={group.collapsed ? "true" : undefined}
          data-dragging={groupDragging ? "true" : undefined}
          data-reordering={drag?.dragging ? "true" : undefined}
          data-drop-target={drag?.groupReady && dropGroup?.id === group.id ? "true" : undefined}
          style={{ ...groupStyle, transform: `translateX(${groupDragging ? drag?.offset ?? 0 : shift}px)` }} aria-expanded={!group.collapsed}
          aria-label={`${group.collapsed ? "Expand" : "Collapse"} ${group.name || "tab group"}, ${state.tabs.filter(tab => tab.groupId === group.id).length} tabs`}
          title={`${group.name || "Tab group"} · Drag to reorder; click to ${group.collapsed ? "expand" : "collapse"}; right-click to manage`}
          onPointerDown={event => onTabPointerDown(event, tab, group.id)}
          onPointerMove={onTabPointerMove}
          onPointerUp={event => onTabPointerUp(event, tab)}
          onPointerCancel={onTabPointerCancel}
          onLostPointerCapture={onTabPointerCancel}
          onClick={event => {
            if (event.detail > 0 && suppressGroupClick.current === group.id) { suppressGroupClick.current = null; return; }
            void sendDesktopTabsCommand({ type: "group-update", groupId: group.id, collapsed: !group.collapsed });
          }}
          onContextMenu={event => { event.preventDefault(); event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect();
            void sendDesktopTabsCommand({ type: "group-menu", groupId: group.id, x: Math.max(0, rect.left), y: rect.bottom + 6 }); }}
          onKeyDown={event => { if ((event.shiftKey && event.key === "F10") || event.key === "ContextMenu") {
            event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect();
            void sendDesktopTabsCommand({ type: "group-menu", groupId: group.id, x: Math.max(0, rect.left), y: rect.bottom + 6 });
          } }}>
          {group.name ? <span>{group.name}</span> : null}
        </button> : null;
        if (group?.collapsed) return firstInGroup ? <Fragment key={tab.id}>{groupMarker}</Fragment> : null;
        const active = tab.id === state.activeId;
        const label = `${tab.browser?.private && tab.title !== "Private Tab" ? "Private · " : ""}${tabLabel(tab.title, tab.url)}`;
        const shortcutNumber = index < 8 ? index + 1 : index === state.tabs.length - 1 ? 9 : null;
        const kind = tab.browser ? "browser" : describeTabUrl(tab.url).kind;
        const learning = kind === "workspace" && tab.learnActive === true;
        const reportedFavicon = tab.browser?.favicon;
        const fallbackFavicon = browserTabFaviconFallback(tab.browser?.address);
        const favicon = tab.browser?.private ? undefined : reportedFavicon ?? fallbackFavicon;
        return (
          <Fragment key={tab.id}>{groupMarker}<div
            role="tab"
            tabIndex={active ? 0 : -1}
            onKeyDown={event => {
              if ((event.shiftKey && event.key === "F10") || event.key === "ContextMenu") {
                event.preventDefault();
                event.stopPropagation();
                const rect = event.currentTarget.getBoundingClientRect();
                openTabMenu(tab, rect.left, rect.bottom);
                return;
              }
              if (event.target !== event.currentTarget) return;
              if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void sendDesktopTabsCommand({ type: "activate", id: tab.id }); }
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                const next = visibleTabs[(visibleTabs.indexOf(tab) + (event.key === "ArrowRight" ? 1 : -1) + visibleTabs.length) % visibleTabs.length];
                stripRef.current?.querySelector<HTMLElement>(`[data-tab-id="${next.id}"]`)?.focus();
                void sendDesktopTabsCommand({ type: "activate", id: next.id });
              }
            }}
            aria-selected={active}
            aria-haspopup="menu"
            title={learning ? `${label} — Learn in progress` : label}
            aria-keyshortcuts={shortcutNumber ? `${ariaShortcutModifier}+${shortcutNumber}` : undefined}
            aria-label={learning ? `${label} — Learn in progress` : label}
            className="bb-tab"
            data-tab-id={tab.id}
            data-active={active ? "true" : undefined}
            data-anchored={tab.anchored ? "true" : undefined}
            data-loading={tab.loading ? "true" : undefined}
            data-learning={learning ? "true" : undefined}
            data-dragging={dragging ? "true" : undefined}
            data-reordering={drag?.dragging ? "true" : undefined}
            data-grouped={group ? "true" : undefined}
            data-group-end={group && state.tabs[index + 1]?.groupId !== group.id ? "true" : undefined}
            data-group-target={drag?.groupReady && drag.drop?.groupTargetId === tab.id ? "true" : undefined}
            style={{ ...groupStyle,
              ...(drag?.groupReady && drag.drop?.groupTargetId === tab.id ? { "--drop-color": dropColor } : {}),
              transform: `translateX(${dragging ? drag?.offset ?? 0 : shift}px)` } as CSSProperties}
            onPointerDown={(event) => onTabPointerDown(event, tab)}
            onPointerMove={onTabPointerMove}
            onPointerUp={(event) => onTabPointerUp(event, tab)}
            onPointerCancel={onTabPointerCancel}
            onLostPointerCapture={onTabPointerCancel}
            onContextMenu={event => {
              event.preventDefault();
              event.stopPropagation();
              openTabMenu(tab, event.clientX, event.clientY);
            }}
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
              ) : tab.loading && !learning ? (
                <span className="bb-tab-spinner" />
              ) : (
                <TabGlyph kind={kind} privateBrowsing={tab.browser?.private} />
              )}
            </span>
            <span className="bb-tab-title">{label}</span>
            <button
              type="button"
              className="bb-tab-anchor"
              hidden={tab.browser?.private === true}
              aria-label={`${tab.anchored ? "Unanchor" : "Anchor"} ${label}`}
              aria-pressed={tab.anchored === true}
              title={tab.anchored ? "Unanchor tab to change screens or close it" : "Anchor tab to keep this screen open"}
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
          </div></Fragment>
        );
      })}
      {state.savedGroups?.length ? <button type="button" className="bb-tab-saved" aria-label="Saved tab groups" title="Saved tab groups"
        onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); void sendDesktopTabsCommand({ type: "group-menu", x: Math.max(0, rect.left), y: rect.bottom + 6 }); }}>▣</button> : null}
      {drag?.dragging && drag.drop && typeof document !== "undefined" ? createPortal(<div className="bb-tab-drag-feedback" style={{ "--drop-color": dropColor } as CSSProperties}>
        {!drag.groupReady ? <span className="bb-tab-drop-line" style={{ left: markerX, top: (stripRef.current?.getBoundingClientRect().top ?? 0) + 5 }} /> : null}
        <span className="bb-tab-drop-hint" role="status" style={{ left: Math.max(8, Math.min(drag.clientX - 90, window.innerWidth - 300)), top: (stripRef.current?.getBoundingClientRect().bottom ?? 33) + 4 }}>
          {drag.groupId ? "Release to move group" : drag.drop.groupTargetId !== undefined ? drag.groupReady ? dropGroup ? `Release to add to ${dropGroup.name || "group"}` : "Release to create group" : "Hold to group · Move to edge to reorder" : "Release to move tab"}
        </span>
      </div>, document.body) : null}
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
function TabGlyph({ kind, privateBrowsing = false }: { kind: DesktopTabKind; privateBrowsing?: boolean }) {
  if (kind === "browser" && privateBrowsing) {
    return (
      <svg viewBox="0 0 14 14">
        <path d="M1.5 5.3c1.8-1.1 3.5-1.1 5.5-.2 2-.9 3.7-.9 5.5.2l-.5 3.2c-.3 1.7-2.4 2.2-3.6 1L7 8.2l-1.4 1.3c-1.2 1.2-3.3.7-3.6-1z" {...STROKE} />
        <path d="m3.4 6.7 1.5.4m4.2 0 1.5-.4" {...STROKE} />
      </svg>
    );
  }
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
    case "pdf":
      return (
        <svg viewBox="0 0 14 14">
          <path d="M3 1.5h5l3 3v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z" {...STROKE} />
          <path d="M8 1.5v3h3" {...STROKE} />
          <text x="6.5" y="9.7" textAnchor="middle" fill="currentColor" fontSize="4.1" fontWeight="700" fontFamily="Arial, sans-serif">PDF</text>
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
