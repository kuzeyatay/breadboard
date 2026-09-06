"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { sendDesktopTabsCommand } from "@/lib/desktop-browser-tabs";
import { useBrowserDownloads } from "./use-browser-downloads";
import styles from "./browser-downloads.module.css";

export default function BrowserDownloadsButton({ active, open }: { active: boolean; open: boolean }) {
  const { snapshot, ready } = useBrowserDownloads(active);
  const button = useRef<HTMLButtonElement>(null);
  const seen = useRef<Set<string> | null>(null);
  const [error, setError] = useState("");
  const count = snapshot.items.filter(item => item.active && item.state === "progressing").length;
  const label = count ? `Downloads — ${count} downloading` : "Downloads";
  const show = useCallback(async () => {
    const bounds = button.current?.getBoundingClientRect();
    if (!bounds) return;
    const ok = await sendDesktopTabsCommand({ type: "browser-downloads-popover", x: bounds.right, y: bounds.bottom + 8 });
    setError(ok ? "" : "Couldn’t open downloads. Restart Breadboard and try again.");
  }, []);

  useEffect(() => {
    if (!ready || !active) return;
    const previous = seen.current;
    seen.current = new Set(snapshot.items.map(item => item.id));
    if (!previous || !snapshot.items.some(item => !previous.has(item.id))) return;
    const frame = requestAnimationFrame(() => { void show(); });
    return () => cancelAnimationFrame(frame);
  }, [active, ready, snapshot.items, show]);

  return <div className={styles.control}>
    <button ref={button} type="button" className={`browser-toolbar-button ${styles.trigger}`} aria-label={label} title={label}
      aria-haspopup="dialog" aria-expanded={open} data-downloading={count > 0}
      onClick={() => { if (open) void sendDesktopTabsCommand({ type: "browser-downloads-close" }); else void show(); }}>
      <Download aria-hidden="true" />
      {count > 0 ? <span className={styles.spinner} aria-hidden="true" /> : null}
    </button>
    <span className="sr-only" role="status">{count ? `${count} ${count === 1 ? "download" : "downloads"} in progress` : ""}</span>
    {error ? <span className={styles.toolbarError} role="alert">{error}</span> : null}
  </div>;
}
