"use client";

import { useCallback, useEffect, useState } from "react";

type ApiStatus = { ok?: boolean; sites?: number; operations?: number; reason?: string };

export function SettingsApiAnything() {
  const [status, setStatus] = useState<ApiStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/api-anything", { cache: "no-store" });
      setStatus(response.ok ? await response.json() : { ok: false });
    } catch { setStatus({ ok: false }); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  return <section aria-label="Website APIs" className="rounded-xl border border-[var(--line)] p-4">
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-sm font-medium text-[var(--ink)]">API Anything</h3>
      <span className="text-xs text-[var(--ink-muted)]">Built in</span>
    </div>
    <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
      Agents use website APIs when available, then continue in the browser when needed.
    </p>
    <p role="status" className="mt-2 text-xs text-[var(--ink-muted)]">
      {status?.ok ? `${status.sites} websites · ${status.operations} operations available`
        : status ? "Website APIs are unavailable. Browser control remains available." : "Checking website APIs…"}
    </p>
    {status && !status.ok ? <button type="button" disabled={busy} onClick={() => void refresh()}
      className="mt-2 text-xs text-[var(--botanical)] disabled:opacity-50">Check again</button> : null}
  </section>;
}
