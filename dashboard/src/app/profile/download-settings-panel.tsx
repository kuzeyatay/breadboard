"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { downloadSettingsControl, type DownloadSettingsState } from "@/lib/desktop-download-settings";

export default function DownloadSettingsPanel() {
  const [control, setControl] = useState<ReturnType<typeof downloadSettingsControl>>(null);
  const [settings, setSettings] = useState<DownloadSettingsState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revision = useRef(0);
  const writing = useRef(false);
  const invalidateReads = useCallback(() => { revision.current++; }, []);

  const refresh = useCallback(async () => {
    const desktop = downloadSettingsControl();
    if (!desktop || writing.current) return;
    setControl(desktop);
    const current = ++revision.current;
    try {
      const next = await desktop.getDownloadSettings();
      if (current !== revision.current) return;
      setSettings(next);
      setError(null);
    } catch {
      if (current === revision.current) setError("Could not load download preferences. Try again.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onFocus = () => { if (!document.hidden) void refresh(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      invalidateReads();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refresh, invalidateReads]);

  async function update(action: "prompt" | "folder") {
    if (!control || !settings || writing.current) return;
    writing.current = true;
    invalidateReads();
    setBusy(true);
    setError(null);
    try {
      const result = await (action === "folder"
        ? control.chooseDownloadDirectory() : control.setDownloadPrompt(!settings.askWhereToSave));
      if (result.ok) setSettings(result.settings);
      else setError(result.error);
    } catch { setError("Could not save download preferences. Try again."); }
    finally { writing.current = false; setBusy(false); }
  }

  if (!control) return null;
  return (
    <section className="neu-surface-raised rounded-2xl border border-gray-800 p-5" aria-busy={busy}>
      <header className="mb-4">
        <h2 className="text-sm font-semibold text-white">Downloads</h2>
        <p className="mt-0.5 text-xs text-gray-500">Choose where Breadboard saves files on this computer.</p>
      </header>
      {settings && <>
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-white">Download folder</p>
            <p className="mt-1 break-all text-xs leading-5 text-gray-500">{settings.directory}</p>
          </div>
          <button type="button" disabled={busy} onClick={() => void update("folder")}
            className="shrink-0 rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-white hover:bg-white/5 disabled:opacity-50">
            Change…
          </button>
        </div>
        <div className="mt-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-white">Ask where to save each file</p>
            <p className="mt-0.5 text-xs leading-5 text-gray-500">
              {settings.askWhereToSave ? "Choose a location each time you download." : "Files save automatically to your download folder."}
            </p>
          </div>
          <button type="button" role="switch" aria-label="Ask where to save each file"
            aria-checked={settings.askWhereToSave} disabled={busy} onClick={() => void update("prompt")}
            className={`neu-inset relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${settings.askWhereToSave ? "bg-[var(--botanical)]" : "bg-[var(--line-strong)]"}`}>
            <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-[var(--paper-raised)] shadow transition-transform ${settings.askWhereToSave ? "translate-x-5" : ""}`} />
          </button>
        </div>
      </>}
      {error && <p className="mt-4 text-xs text-red-400" role="alert">{error}{" "}
        <button type="button" disabled={busy} onClick={() => void refresh()} className="underline">Retry</button>
      </p>}
    </section>
  );
}
