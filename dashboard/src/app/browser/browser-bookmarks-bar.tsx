"use client";

import { useId } from "react";
import { browserBookmarksControl } from "@/lib/desktop-browser-tabs";
import { BrowserSiteIcon } from "./browser-site-icon";
import { bookmarksKey, normalizeBookmarks, type BrowserBookmark } from "./browser-bookmarks";
import { useBrowserSavedItems } from "./use-browser-saved-items";
import { useBrowserBookmarkReorder } from "./use-browser-bookmark-reorder";

const STROKE = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" } as const;
type BookmarkStore = ReturnType<typeof useBrowserSavedItems<BrowserBookmark>>;

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
        <div
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
      </nav>
  );
}

export default function SavedBrowserBookmarksBar({ ownerKey, navigate }: {
  ownerKey: string; navigate: (url: string) => void;
}) {
  const bookmarkStore = useBrowserSavedItems(ownerKey, bookmarksKey(ownerKey), browserBookmarksControl, normalizeBookmarks);
  return <BrowserBookmarksBar ownerKey={ownerKey} bookmarkStore={bookmarkStore} navigate={navigate} />;
}
