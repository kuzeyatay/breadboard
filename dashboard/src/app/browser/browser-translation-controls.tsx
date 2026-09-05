"use client";

import { useState } from "react";
import { Languages } from "lucide-react";
import { sendDesktopTabsCommand, type DesktopTabView } from "@/lib/desktop-browser-tabs";

export default function BrowserTranslationControls({ browser }: { browser: DesktopTabView["browser"] }) {
  const [error, setError] = useState("");
  const state = browser?.translation;
  const active = state && state.status !== "original";
  const label = state?.status === "translating" ? "Translating page…" : state?.status === "translated" ? `Page translated to ${state.language}` : "Translate page";
  return <>
    <button type="button" className="browser-translate-button" aria-label="Translate page" title={label}
      aria-pressed={Boolean(active)} disabled={!browser?.address}
      onClick={async () => { setError(""); if (!await sendDesktopTabsCommand({ type: "browser-translation-menu" })) setError("Restart Breadboard to enable page translation."); }}>
      <Languages size={18} aria-hidden="true" />
    </button>
    <span className="sr-only" role="status" aria-live="polite">{label}</span>
    {active ? <button type="button" className="browser-toolbar-button" aria-label="Show original page" title="Show original page" onClick={() => void sendDesktopTabsCommand({ type: "browser-translation-restore" })}><span className="text-xs">Original</span></button> : null}
    {error || state?.error ? <span className="flex max-w-64 items-center gap-2 text-[11px] leading-3 text-[var(--danger)]" role="alert">
      {error || state?.error}
      <button type="button" onClick={() => { setError(""); void sendDesktopTabsCommand(state?.error ? { type: "browser-translate", language: state.language } : { type: "browser-translation-menu" }); }}>Retry</button>
    </span> : null}
  </>;
}
