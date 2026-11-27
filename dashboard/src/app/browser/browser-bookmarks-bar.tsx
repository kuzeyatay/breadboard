"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { browserBookmarksControl } from "@/lib/desktop-browser-tabs";
import { BrowserSiteIcon } from "./browser-site-icon";
import { bookmarksKey, normalizeBookmarks, type BrowserBookmark } from "./browser-bookmarks";
import { useBrowserSavedItems } from "./use-browser-saved-items";
import { useBrowserBookmarkReorder } from "./use-browser-bookmark-reorder";

const STROKE = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" } as const;
type BookmarkStore = ReturnType<typeof useBrowserSavedItems<BrowserBookmark>>;

/**
 * The tab strip's overflow behaviour for the bookmark row: arrows appear only
 * when the bookmarks no longer fit, the wheel scrolls sideways, and the page
 * that is open stays in view.
 */
function useBookmarkOverflow(layoutKey: string, currentUrl: string) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const previousRef = useRef<HTMLButtonElement | null>(null);
  const nextRef = useRef<HTMLButtonElement | null>(null);
  const [overflow, setOverflow] = useState({ present: false, left: false, right: false });

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      const maximum = list.scrollWidth - list.clientWidth;
      // Measured against the space WITHOUT the arrows, so removing bookmarks
      // can hide them again even when their own width caused the overflow.
      const controlsWidth = (previousRef.current?.offsetWidth ?? 0) + (nextRef.current?.offsetWidth ?? 0);
      const present = maximum > controlsWidth + 1;
      const next = { present, left: present && list.scrollLeft > 1, right: present && list.scrollLeft < maximum - 1 };
      setOverflow(previous => previous.present === next.present && previous.left === next.left && previous.right === next.right ? previous : next);
    };
    const resize = new ResizeObserver(measure);
    resize.observe(list);
    for (const child of list.children) resize.observe(child);
    list.addEventListener("scroll", measure, { passive: true });
    measure();
    return () => { resize.disconnect(); list.removeEventListener("scroll", measure); };
  }, [layoutKey]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !currentUrl) return;
    const current = Array.from(list.querySelectorAll<HTMLElement>("[data-bookmark-url]"))
      .find(item => item.dataset.bookmarkUrl === currentUrl);
    current?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
  }, [currentUrl, layoutKey]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || list.scrollWidth <= list.clientWidth + 1) return;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 32
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? list.clientWidth : 1;
      event.preventDefault();
      list.scrollLeft += delta * unit;
    };
    // React's wheel listener is passive; this one keeps the page underneath
    // from scrolling along with the bookmarks.
    list.addEventListener("wheel", wheel, { passive: false });
    return () => list.removeEventListener("wheel", wheel);
  }, []);

  const scroll = (direction: number) => {
    const list = listRef.current;
    if (!list) return;
    list.scrollBy({ left: direction * Math.max(96, list.clientWidth - 140),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  };

  return { listRef, previousRef, nextRef, overflow, scroll };
}

/** The original browser bookmark row, shared with the combined home. */
export function BrowserBookmarksBar({ ownerKey, bookmarkStore, navigate, normalizedAddress = "" }: {
  ownerKey: string;
  bookmarkStore: BookmarkStore;
  navigate: (url: string) => void;
  normalizedAddress?: string;
}) {
  const helpId = useId();
  const bookmarks = bookmarkStore.items;
  const bookmarkReorder = useBrowserBookmarkReorder(ownerKey, bookmarks, bookmarkStore.ready && !bookmarkStore.saving, bookmarkStore.save);
  const { listRef, previousRef, nextRef, overflow, scroll } = useBookmarkOverflow(bookmarks.map(bookmark => bookmark.url).join("\n"), normalizedAddress);
  const removeBookmark = (url: string) => { void bookmarkStore.save(bookmarks.filter(bookmark => bookmark.url !== url)); };
  return (
      <nav className="browser-bookmarks-bar" aria-label="Bookmarks">
        {bookmarkStore.error && (
          <span role="alert" className="browser-bookmarks-empty">
            {bookmarkStore.error}{" "}
            {!bookmarkStore.ready && <button type="button" onClick={bookmarkStore.retry}>Retry</button>}
          </span>
        )}
        <span id={helpId} className="sr-only">Drag to reorder. You can also use Alt+Shift and the left or right arrow key.</span>
        <span className="sr-only" role="status">{bookmarkReorder.announcement}</span>
        <button ref={previousRef} type="button" className="browser-bookmarks-scroll" hidden={!overflow.present}
          disabled={!overflow.left} aria-label="Scroll bookmarks left" title="Scroll bookmarks left" onClick={() => scroll(-1)}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m10 4-4 4 4 4" {...STROKE} /></svg>
        </button>
        <div
          ref={listRef}
          className="browser-bookmarks-list"
          data-reordering={Boolean(bookmarkReorder.drag)}
          onDragOver={bookmarkReorder.over}
          onDrop={bookmarkReorder.drop}
        >
          {bookmarks.length ? bookmarks.map((bookmark) => (
            <span
              key={bookmark.url}
              className="browser-bookmark-item"
              data-bookmark-url={bookmark.url}
              data-current={bookmark.url === normalizedAddress}
              data-dragging={bookmarkReorder.drag?.url === bookmark.url}
              data-drop-before={bookmarkReorder.drag?.beforeUrl === bookmark.url && bookmarkReorder.drag.url !== bookmark.url}
              data-drop-after={bookmarkReorder.drag?.beforeUrl === null && bookmark === bookmarks.at(-1)}
              draggable={bookmarkStore.ready && !bookmarkStore.saving && bookmarks.length > 1}
              onDragStart={(event) => bookmarkReorder.start(event, bookmark.url)}
              onDragEnd={bookmarkReorder.end}
            >
              <button type="button" className="browser-bookmark-link" title={bookmark.title} aria-describedby={helpId} aria-keyshortcuts="Alt+Shift+ArrowLeft Alt+Shift+ArrowRight" onKeyDown={(event) => bookmarkReorder.keyDown(event, bookmark.url)} onClick={() => navigate(bookmark.url)}>
                <BrowserSiteIcon src={bookmark.iconUrl} pageUrl={bookmark.url} fallback={bookmark.title.slice(0, 1).toUpperCase()} />
                <span className="browser-bookmark-label">{bookmark.title}</span>
              </button>
              <button type="button" className="browser-bookmark-remove" aria-label={`Remove ${bookmark.title} bookmark`} title="Remove bookmark" disabled={!bookmarkStore.ready || bookmarkStore.saving} onClick={() => removeBookmark(bookmark.url)}>
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 5 6 6m0-6-6 6" {...STROKE} /></svg>
              </button>
            </span>
          )) : (
            !bookmarkStore.error && <span className="browser-bookmarks-empty">{bookmarkStore.ready ? "Pages you bookmark will appear here." : "Loading bookmarks…"}</span>
          )}
        </div>
        <button ref={nextRef} type="button" className="browser-bookmarks-scroll" hidden={!overflow.present}
          disabled={!overflow.right} aria-label="Scroll bookmarks right" title="Scroll bookmarks right" onClick={() => scroll(1)}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 4 4 4-4 4" {...STROKE} /></svg>
        </button>
      </nav>
  );
}

export default function SavedBrowserBookmarksBar({ ownerKey, navigate }: {
  ownerKey: string; navigate: (url: string) => void;
}) {
  const bookmarkStore = useBrowserSavedItems(ownerKey, bookmarksKey(ownerKey), browserBookmarksControl, normalizeBookmarks);
  return <BrowserBookmarksBar ownerKey={ownerKey} bookmarkStore={bookmarkStore} navigate={navigate} />;
}
