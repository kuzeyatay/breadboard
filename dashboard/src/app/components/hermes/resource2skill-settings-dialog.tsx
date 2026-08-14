"use client";

import { useCallback, useEffect, useState } from "react";

interface Status {
  ready: boolean;
  reason: string;
  clone: { found: boolean; path: string };
  runtime: { found: boolean; python: string; version: string };
  domains: Record<"web" | "ppt" | "excel" | "blender" | "reaper", boolean>;
}

export default function Resource2SkillSettingsDialog({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const response = await fetch("/api/resource2skill/setup", { cache: "no-store" });
    const data = await response.json() as { status?: Status; error?: string };
    if (data.status) setStatus(data.status); else setNotice(data.error || "Setup could not be checked.");
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function install(action: "install-runtime" | "install-web" | "install-blender") {
    setBusy(true); setNotice("Installing in Breadboard's isolated environment…");
    try {
      const response = await fetch("/api/resource2skill/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
      const data = await response.json() as { status?: Status; message?: string; error?: string };
      if (data.status) setStatus(data.status);
      setNotice(data.message || data.error || "Setup finished.");
    } finally { setBusy(false); }
  }
  return <div className="bb-modal-backdrop fixed inset-0 z-[150] flex items-center justify-center p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="resource2skill-title" className="bb-modal-panel neu-dialog w-full max-w-[42rem] rounded-2xl border text-[var(--ink)]">
      <header className="flex items-start gap-3 border-b border-[var(--line)] p-5">
        <div className="min-w-0 flex-1"><h2 id="resource2skill-title" className="font-serif text-lg text-[var(--ink-heading)]">Resource2Skill setup</h2><p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">Runs Microsoft’s distilled Web, PowerPoint, Excel, Blender, and audio skills locally through ChatMock.</p></div>
        <button type="button" className="neu-button-icon h-9 w-9 rounded-full" onClick={onClose} aria-label="Close">×</button>
      </header>
      <div className="space-y-4 p-5">
        <div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${status?.ready ? "bg-[var(--botanical)]" : "bg-amber-500"}`} /><span className="text-sm">{status?.ready ? `Ready · Python ${status.runtime.version}` : "Setup needed"}</span><button type="button" className="neu-button ml-auto rounded-lg px-3 py-1.5 text-xs" onClick={() => void load()}>Refresh</button></div>
        {notice || status?.reason ? <p className="text-xs leading-5 text-[var(--ink-muted)]" role="status">{notice || status?.reason}</p> : null}
        <div className="bb-agent-run-panel p-3 text-xs leading-5 text-[var(--ink-muted)]"><p><strong className="text-[var(--ink-heading)]">Clone:</strong> {status?.clone.found ? status.clone.path : "not found"}</p><p><strong className="text-[var(--ink-heading)]">Runtime:</strong> {status?.runtime.found ? status.runtime.python : "not installed"}</p></div>
        <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} className="neu-button rounded-lg px-3 py-2 text-xs disabled:opacity-50" onClick={() => void install("install-runtime")}>Install core runtime</button><button type="button" disabled={busy} className="neu-button rounded-lg px-3 py-2 text-xs disabled:opacity-50" onClick={() => void install("install-web")}>Install Web browser</button><button type="button" disabled={busy} className="neu-button rounded-lg px-3 py-2 text-xs disabled:opacity-50" onClick={() => void install("install-blender")}>Install Blender support</button></div>
        {status ? <ul className="grid grid-cols-2 gap-2 sm:grid-cols-5">{Object.entries(status.domains).map(([name, ready]) => <li key={name} className="bb-agent-run-row flex items-center gap-2 p-2 text-xs capitalize"><span className={`h-1.5 w-1.5 rounded-full ${ready ? "bg-[var(--botanical)]" : "bg-amber-500"}`} />{name}</li>)}</ul> : null}
        <p className="text-[11px] leading-5 text-[var(--ink-muted)]">PowerPoint rendering also needs LibreOffice. Audio rendering needs FluidSynth and VWS_REAPER_SOUNDFONT. Setup runs only when you press a button.</p>
      </div>
    </section>
  </div>;
}
