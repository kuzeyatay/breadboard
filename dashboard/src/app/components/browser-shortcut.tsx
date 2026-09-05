"use client";

// The navbar's embedded browser seat.
//
// Chromium already powers Electron, so the shell can put a sandboxed web page
// beneath Breadboard's own tab strip and address toolbar without launching a
// second application. In a normal browser the button has nothing to add.

import { useState } from "react";

import { openBrowserInDesktop } from "@/lib/desktop-browser-tabs";
import { useDesktopTabs } from "./use-desktop-tabs";

export default function BrowserShortcut() {
  const tabs = useDesktopTabs();
  const [busy, setBusy] = useState(false);
  if (!tabs?.enabled) return null;
  return (
    <button
      type="button"
      onClick={() => {
        if (busy) return;
        setBusy(true);
        void openBrowserInDesktop().finally(() => setBusy(false));
      }}
      className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors disabled:opacity-60"
      title="Open Browser in a new tab"
      aria-label="Open Browser"
      disabled={busy}
    >
      <svg
        className="h-3.5 w-3.5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="8.5" />
        <path d="M3.5 12h17M12 3.5c-3.2 2.7-3.2 14.3 0 17M12 3.5c3.2 2.7 3.2 14.3 0 17" />
      </svg>
      Browser
    </button>
  );
}
