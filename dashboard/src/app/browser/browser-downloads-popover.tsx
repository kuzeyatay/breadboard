"use client";

import { useEffect, useRef } from "react";
import { Download, File, FileArchive, FileImage, FileText, FolderOpen, X } from "lucide-react";
import { sendDesktopTabsCommand } from "@/lib/desktop-browser-tabs";
import { downloadBytes } from "./browser-downloads";
import { useBrowserDownloads } from "./use-browser-downloads";
import styles from "./browser-downloads.module.css";

function fileIcon(filename: string) {
  if (/\.(png|jpe?g|gif|webp|svg|avif|ico)$/i.test(filename)) return FileImage;
  if (/\.(zip|rar|7z|gz|tar)$/i.test(filename)) return FileArchive;
  if (/\.(pdf|txt|docx?|md|csv)$/i.test(filename)) return FileText;
  return File;
}

export default function BrowserDownloadsPopover() {
  const { snapshot, ready, error, setError, busy, refresh, act } = useBrowserDownloads();
  const root = useRef<HTMLElement>(null);
  const items = [...snapshot.items].sort((a, b) => Number(b.active) - Number(a.active) || b.startedAt - a.startedAt).slice(0, 5);

  useEffect(() => {
    if (ready) root.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [ready]);

  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const resize = new ResizeObserver(() => {
      void sendDesktopTabsCommand({ type: "browser-downloads-resize", height: Math.ceil(node.getBoundingClientRect().height) });
    });
    resize.observe(node);
    return () => resize.disconnect();
  }, []);

  return <main ref={root} className={`bb-downloads-popover-page ${styles.popover}`} role="dialog" aria-label="Recent downloads"
    onKeyDown={event => {
      if (event.key === "Escape") void sendDesktopTabsCommand({ type: "browser-downloads-close" });
      if (event.key === "Tab") {
        const buttons = root.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
        const first = buttons?.[0], last = buttons?.[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
    <div className={styles.recentList}>
      {items.map(item => {
        const Icon = fileIcon(item.filename);
        const completed = item.state === "completed";
        const status = item.active ? item.state === "interrupted" ? "Connection interrupted" : "Downloading"
          : completed ? "Completed" : item.state === "cancelled" ? "Cancelled" : "Interrupted";
        const progress = item.totalBytes > 0 ? Math.min(100, item.receivedBytes / item.totalBytes * 100) : undefined;
        return <article key={item.id} className={styles.recentRow}>
          <span className={styles.fileIcon} aria-hidden="true"><Icon size={25} strokeWidth={1.5} /></span>
          <div className={styles.recentDetails}>
            <button type="button" className={styles.filename} title={item.filename} disabled={!completed || busy}
              aria-label={completed ? `Open ${item.filename}` : item.filename} onClick={() => void act({ type: "open", id: item.id })}>{item.filename}</button>
            <span className={styles.recentStatus}>{status} — {downloadBytes(item.receivedBytes)}{item.active && item.totalBytes > 0 ? ` of ${downloadBytes(item.totalBytes)}` : ""}</span>
            {item.active ? <progress className={styles.progress} aria-label={`Download progress for ${item.filename}`} max={100} value={progress} /> : null}
          </div>
          {completed && item.savePath ? <button type="button" className={styles.iconAction} disabled={busy} title="Show in folder" aria-label={`Show ${item.filename} in folder`} onClick={() => void act({ type: "show", id: item.id })}><FolderOpen size={18} /></button>
            : item.active ? <button type="button" className={styles.iconAction} disabled={busy} title="Cancel download" aria-label={`Cancel ${item.filename}`} onClick={() => void act({ type: "cancel", id: item.id })}><X size={17} /></button> : null}
        </article>;
      })}
      {!items.length && !snapshot.error ? <div className={styles.empty}><Download size={25} aria-hidden="true" /><span>{ready ? "No downloads yet" : "Loading downloads…"}</span><small>Files you download will appear here.</small></div> : null}
    </div>
    {error || snapshot.error ? <div className={styles.error} role="alert">{error || snapshot.error}<button type="button" onClick={() => { setError(null); void refresh(); }}>Try again</button></div> : null}
    <button type="button" className={styles.showAll} onClick={() => void sendDesktopTabsCommand({ type: "browser-downloads-show-all" })}>Show all downloads</button>
  </main>;
}
