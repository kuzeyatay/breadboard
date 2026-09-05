"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Download, File, FolderOpen, Search, X } from "lucide-react";
import { browserDownloadsControl, type BrowserDownloadCommand, type BrowserDownloadsSnapshot } from "@/lib/desktop-browser-downloads";
import styles from "./browser-downloads.module.css";

export function downloadBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const unit = bytes < 1024 ** 2 ? 1 : bytes < 1024 ** 3 ? 2 : 3;
  return `${(bytes / 1024 ** unit).toFixed(1)} ${["B", "KB", "MB", "GB"][unit]}`;
}

export default function BrowserDownloadsPanel({ active, closeButton }: { active: boolean; closeButton: ReactNode }) {
  const [snapshot, setSnapshot] = useState<BrowserDownloadsSnapshot>({ items: [], error: null });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    try {
      const control = browserDownloadsControl();
      if (!control) throw new Error("Restart Breadboard to enable Downloads.");
      const next = await control.getBrowserDownloads();
      if (request !== sequence.current) return;
      setSnapshot(next);
      setReady(true);
    } catch (error) {
      if (request === sequence.current) setSnapshot(current => ({ ...current, error: error instanceof Error ? error.message : "Couldn’t load downloads. Try again." }));
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => { void refresh(); });
    const timer = setInterval(() => { void refresh(); }, 1_000);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(timer);
    };
  }, [active, refresh]);

  async function act(command: BrowserDownloadCommand) {
    setBusy(true);
    setError(null);
    try {
      const control = browserDownloadsControl();
      if (!control) throw new Error("Restart Breadboard to enable Downloads.");
      const result = await control.browserDownloadCommand(command);
      if (!result.ok) throw new Error(result.error ?? "Couldn’t update this download.");
      await refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Couldn’t update this download.");
    } finally {
      setBusy(false);
    }
  }

  const visible = snapshot.items.filter(item => item.filename.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase()));
  const downloading = snapshot.items.filter(item => item.active).length;
  return (
    <section className={`browser-tool-panel ${styles.panel}`} data-active={active} aria-hidden={!active} inert={!active ? true : undefined} aria-label="Downloads">
      <header className="browser-library-panel-header">
        <span className="browser-library-panel-mark" aria-hidden="true"><Download /></span>
        <span><strong>Downloads</strong><small>{downloading ? `${downloading} downloading` : `${snapshot.items.length} ${snapshot.items.length === 1 ? "download" : "downloads"}`}</small></span>
        <div className="browser-library-panel-actions">
          {snapshot.items.some(item => !item.active) ? <button type="button" className="browser-library-clear" disabled={busy} onClick={() => void act({ type: "clear" })} title="Remove finished downloads from this list. Files stay on disk.">Clear finished</button> : null}
          {closeButton}
        </div>
      </header>
      {(error || snapshot.error) ? <div className={styles.error} role="alert">{error || snapshot.error}<button type="button" onClick={() => { setError(null); void refresh(); }}>Try again</button></div> : null}
      <label className="browser-library-filter">
        <Search aria-hidden="true" /><span className="sr-only">Filter downloads</span>
        <input type="search" value={filter} onChange={event => setFilter(event.currentTarget.value)} placeholder="Filter downloads" />
      </label>
      <div className={`browser-library-list ${styles.list}`}>
        {visible.map(item => {
          const progress = item.totalBytes > 0 ? Math.min(100, item.receivedBytes / item.totalBytes * 100) : undefined;
          const status = item.active ? (item.state === "interrupted" ? "Connection interrupted" : "Downloading")
            : item.state === "completed" ? "Completed" : item.state === "cancelled" ? "Cancelled" : "Interrupted";
          let source = "";
          try { source = new URL(item.url).hostname; } catch { /* Download URLs can be temporary blobs. */ }
          return (
            <article className={styles.row} key={item.id}>
              <span className="browser-library-icon" aria-hidden="true"><File size={19} /></span>
              <div className={styles.details}>
                <strong title={item.filename}>{item.filename}</strong>
                <span className={styles.status}>{status} · {downloadBytes(item.receivedBytes)}{item.active && item.totalBytes > 0 ? ` of ${downloadBytes(item.totalBytes)}` : ""}</span>
                {item.active ? <progress aria-label={`Download progress for ${item.filename}`} max={100} value={progress} /> : null}
                <small title={item.savePath || source}>{[source, new Date(item.startedAt).toLocaleDateString()].filter(Boolean).join(" · ")}</small>
                {!item.active && item.state === "interrupted" ? <small>Start this download again from its page.</small> : null}
                <div className={styles.actions}>
                  {item.state === "completed" ? <button type="button" disabled={busy} onClick={() => void act({ type: "open", id: item.id })}>Open file</button> : null}
                  {item.savePath && item.state === "completed" ? <button type="button" disabled={busy} onClick={() => void act({ type: "show", id: item.id })}><FolderOpen size={13} />Show in folder</button> : null}
                  {item.active ? <button type="button" disabled={busy} onClick={() => void act({ type: "cancel", id: item.id })}>Cancel</button> : null}
                </div>
              </div>
              {!item.active ? <button type="button" className={styles.remove} disabled={busy} aria-label={`Remove ${item.filename} from downloads`} title="Remove from list; keep file" onClick={() => void act({ type: "remove", id: item.id })}><X size={15} /></button> : null}
            </article>
          );
        })}
        {!visible.length && !snapshot.error ? <div className="browser-library-empty"><Download size={24} aria-hidden="true" /><strong>{!ready ? "Loading downloads…" : filter ? "No matching downloads" : "No downloads yet"}</strong><small>{filter ? "Try another filename." : "Files you download will appear here."}</small></div> : null}
      </div>
    </section>
  );
}
