"use client";
import type { ReactNode } from "react";
import { BrowserSiteIcon } from "./browser-site-icon";
import type { BrowserBookmark } from "./browser-bookmarks";
const STROKE = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export function BrowserStarredPanel({ active, bookmarks, ready, navigate, remove, closeButton, normalizedAddress = "" }: {
  active: boolean; bookmarks: BrowserBookmark[]; ready: boolean; navigate: (url: string) => void; remove: (url: string) => void; closeButton: ReactNode; normalizedAddress?: string;
}) {
  return <section className="browser-tool-panel browser-library-panel" data-active={active} aria-hidden={!active} inert={!active ? true : undefined} aria-label="Starred pages">
    <header className="browser-library-panel-header">
      <span className="browser-library-panel-mark browser-library-panel-star" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m12 3.6 2.5 5.05 5.57.81-4.03 3.93.95 5.55L12 16.32l-4.99 2.62.95-5.55L3.93 9.46l5.57-.81L12 3.6Z" {...STROKE} /></svg></span>
      <span><strong>Starred</strong><small>{bookmarks.length} saved {bookmarks.length === 1 ? "page" : "pages"}</small></span>
      <div className="browser-library-panel-actions">{closeButton}</div>
    </header>
    <div className="browser-library-list browser-starred-list">
      {bookmarks.length ? bookmarks.map(bookmark => <div key={bookmark.url} className="browser-library-row" data-current={bookmark.url === normalizedAddress}>
        <button type="button" className="browser-library-link" onClick={() => navigate(bookmark.url)} title={bookmark.title}>
          <span className="browser-library-icon"><BrowserSiteIcon src={bookmark.iconUrl} pageUrl={bookmark.url} fallback={bookmark.title.slice(0, 1).toUpperCase()} /></span>
          <span><strong>{bookmark.title}</strong><small>{new URL(bookmark.url).hostname.replace(/^www\./iu, "")}</small></span>
        </button>
        <button type="button" className="browser-library-remove" disabled={!ready} onClick={() => remove(bookmark.url)} aria-label={`Remove ${bookmark.title} bookmark`} title="Remove bookmark"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 5 6 6m0-6-6 6" {...STROKE} /></svg></button>
      </div>) : <div className="browser-library-empty"><span aria-hidden="true">☆</span><strong>No starred pages yet</strong><small>Use the star in the address bar to save this page.</small></div>}
    </div>
  </section>;
}
