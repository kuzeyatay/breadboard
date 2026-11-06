"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useDesktopTabs } from "@/app/components/use-desktop-tabs";
import BrowserDownloadsButton from "@/app/browser/browser-downloads-button";
import BrowserMenuControls from "@/app/browser/browser-menu-controls";
import BrowserDownloadsPanel from "@/app/browser/browser-downloads";
import { BrowserHistoryPanel } from "@/app/browser/browser-history-panel";
import { BrowserStarredPanel } from "@/app/browser/browser-starred-panel";
import { useBrowserRecentSearches } from "@/app/browser/use-browser-recent-searches";
import { useBrowserSavedItems } from "@/app/browser/use-browser-saved-items";
import { bookmarksKey, normalizeBookmarks } from "@/app/browser/browser-bookmarks";
import { browserBookmarksControl, navigateBrowserFromHome } from "@/lib/desktop-browser-tabs";
import { webDestinationUrl } from "@/lib/new-tab-search-suggestions";
import styles from "./terminal-browser-controls.module.css";

type Panel = "history" | "visited-pages" | "starred" | "downloads";

export default function TerminalBrowserControls({ ownerKey }: { ownerKey: string }) {
  const tabs = useDesktopTabs();
  const current = tabs?.tabs.find(tab => tab.id === tabs.selfId);
  const active = Boolean(current && current.id === tabs?.activeId);
  const [panel, setPanel] = useState<Panel | null>(null);
  // Browser tools need the desktop bridge, just as they do on a web tab.
  if (!tabs) return null;
  return <>
    <div className={styles.controls}>
      <BrowserDownloadsButton active={active} open={current?.downloadsOpen ?? current?.browser?.downloadsOpen ?? false} />
      <BrowserMenuControls profileLabel={ownerKey} onPanel={setPanel} />
    </div>
    {panel && <TerminalLibrary panel={panel} ownerKey={ownerKey} close={() => setPanel(null)} />}
  </>;
}

function TerminalLibrary({ panel, ownerKey, close }: { panel: Panel; ownerKey: string; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const tabs = useDesktopTabs();
  const searches = useBrowserRecentSearches(ownerKey);
  const bookmarks = useBrowserSavedItems(ownerKey, bookmarksKey(ownerKey), browserBookmarksControl, normalizeBookmarks);
  const [error, setError] = useState("");
  useEffect(() => { dialog.current?.showModal(); }, []);
  async function navigate(input: string) {
    if (await navigateBrowserFromHome(webDestinationUrl(input), tabs).catch(() => false)) close();
    else setError("Couldn’t open this page. Try again.");
  }
  const closeButton = <button type="button" className="browser-terminal-close" aria-label="Close browser library" onClick={close}><X size={18} /></button>;
  return createPortal(<dialog ref={dialog} className={styles.dialog} aria-label={panel === "starred" ? "Starred pages" : panel === "history" ? "Browser history" : panel === "visited-pages" ? "Visited pages" : "Downloads"} onCancel={close} onClick={event => { if (event.target === event.currentTarget) close(); }}>
    {error && <p role="alert">{error}</p>}
    {(panel === "history" || panel === "visited-pages") && <BrowserHistoryPanel active visitedOnly={panel === "visited-pages"} searches={searches} navigate={navigate} closeButton={closeButton} />}
    {panel === "starred" && <BrowserStarredPanel active bookmarks={bookmarks.items} ready={bookmarks.ready && !bookmarks.saving} navigate={navigate} remove={url => { void bookmarks.save(bookmarks.items.filter(item => item.url !== url)); }} closeButton={closeButton} />}
    {panel === "downloads" && <BrowserDownloadsPanel active closeButton={closeButton} />}
  </dialog>, document.body);
}
