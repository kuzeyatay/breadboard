"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Menu, X } from "lucide-react";
import { sendDesktopTabsCommand } from "@/lib/desktop-browser-tabs";
import styles from "./browser-menu-controls.module.css";

export default function BrowserMenuControls({ profileLabel, address, matches, onPanel }: {
  profileLabel: string;
  address: string;
  matches?: { matches: number; activeMatchOrdinal: number };
  onPanel: (panel: "history" | "starred" | "downloads") => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const button = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const action = (event: Event) => {
      const action = (event as CustomEvent).detail;
      if (action === "find") {
        setFindOpen(true);
        requestAnimationFrame(() => { input.current?.focus(); input.current?.select(); });
      } else if (action === "history" || action === "bookmarks" || action === "downloads") {
        onPanel(action === "bookmarks" ? "starred" : action);
      }
    };
    window.addEventListener("breadboard:browser-menu-action", action);
    return () => window.removeEventListener("breadboard:browser-menu-action", action);
  }, [onPanel]);

  useEffect(() => {
    if (!findOpen) return;
    const timer = setTimeout(() => {
      void sendDesktopTabsCommand({ type: "browser-find", text: query });
    }, 120);
    return () => clearTimeout(timer);
  }, [findOpen, query, address]);

  async function openMenu() {
    if (menuOpen || !button.current) return;
    setError("");
    setMenuOpen(true);
    const bounds = button.current.getBoundingClientRect();
    const ok = await sendDesktopTabsCommand({ type: "browser-menu", x: bounds.right, y: bounds.bottom + 4, profileLabel });
    setMenuOpen(false);
    if (!ok) setError("Restart Breadboard to enable the browser menu.");
  }

  function closeFind() {
    setFindOpen(false);
    void sendDesktopTabsCommand({ type: "browser-find-close" });
    button.current?.focus();
  }

  function next(forward: boolean) {
    if (query) void sendDesktopTabsCommand({ type: "browser-find", text: query, forward, findNext: true });
  }

  return (
    <>
      <button ref={button} type="button" className={`browser-toolbar-button ${styles.trigger}`} aria-label="Browser menu" aria-haspopup="menu" aria-expanded={menuOpen} title="Browser menu" onClick={() => void openMenu()} onKeyDown={event => {
        if (event.key === "ArrowDown") { event.preventDefault(); void openMenu(); }
      }}><Menu size={19} aria-hidden="true" /></button>
      {error ? <span className={styles.error} role="alert">{error}<button type="button" aria-label="Dismiss menu error" onClick={() => setError("")}><X size={14} /></button></span> : null}
      {findOpen ? (
        <form className={styles.find} role="search" aria-label="Find in page" onSubmit={event => { event.preventDefault(); next(true); }} onKeyDown={event => {
          if (event.key === "Escape") { event.preventDefault(); closeFind(); }
          else if (event.key === "Enter" && event.shiftKey) { event.preventDefault(); next(false); }
        }}>
          <input ref={input} value={query} maxLength={1000} onChange={event => setQuery(event.currentTarget.value)} aria-label="Find in page" placeholder="Find in page" autoComplete="off" spellCheck={false} />
          <span className={styles.count} role="status" aria-live="polite">{query ? `${matches?.activeMatchOrdinal ?? 0} / ${matches?.matches ?? 0}` : ""}</span>
          <button type="button" aria-label="Previous match" title="Previous match (Shift+Enter)" disabled={!query} onClick={() => next(false)}><ArrowUp size={15} /></button>
          <button type="submit" aria-label="Next match" title="Next match (Enter)" disabled={!query}><ArrowDown size={15} /></button>
          <button type="button" aria-label="Close find in page" title="Close (Esc)" onClick={closeFind}><X size={15} /></button>
        </form>
      ) : null}
    </>
  );
}
