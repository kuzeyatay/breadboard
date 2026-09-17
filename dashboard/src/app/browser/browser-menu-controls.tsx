"use client";

import { useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import { sendDesktopTabsCommand } from "@/lib/desktop-browser-tabs";
import styles from "./browser-menu-controls.module.css";

export default function BrowserMenuControls({ profileLabel, onPanel }: {
  profileLabel: string;
  onPanel: (panel: "history" | "starred" | "downloads") => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState("");
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const action = (event: Event) => {
      const action = (event as CustomEvent).detail;
      if (action === "history" || action === "bookmarks" || action === "downloads") {
        onPanel(action === "bookmarks" ? "starred" : action);
      }
    };
    window.addEventListener("breadboard:browser-menu-action", action);
    return () => window.removeEventListener("breadboard:browser-menu-action", action);
  }, [onPanel]);

  async function openMenu() {
    if (menuOpen || !button.current) return;
    setError("");
    setMenuOpen(true);
    const bounds = button.current.getBoundingClientRect();
    const ok = await sendDesktopTabsCommand({ type: "browser-menu", x: bounds.right, y: bounds.bottom + 4, profileLabel });
    setMenuOpen(false);
    if (!ok) setError("Restart Breadboard to enable the browser menu.");
  }

  return (
    <>
      <button ref={button} type="button" className={`browser-toolbar-button ${styles.trigger}`} aria-label="Browser menu" aria-haspopup="menu" aria-expanded={menuOpen} title="Browser menu" onClick={() => void openMenu()} onKeyDown={event => {
        if (event.key === "ArrowDown") { event.preventDefault(); void openMenu(); }
      }}><Menu size={19} aria-hidden="true" /></button>
      {error ? <span className={styles.error} role="alert">{error}<button type="button" aria-label="Dismiss menu error" onClick={() => setError("")}><X size={14} /></button></span> : null}
    </>
  );
}
