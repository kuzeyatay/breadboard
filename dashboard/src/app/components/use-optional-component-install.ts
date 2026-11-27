"use client";

import { useCallback, useState } from "react";

/** Start one optional-component install and follow its Runtime job to the end. */
export function useOptionalComponentInstall(id: string, onInstalled?: () => void) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const start = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    setMessage("Downloading… this can take a while.");
    try {
      const started = await fetch("/api/optional-components", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, action: "install" }),
      });
      const submitted = (await started.json()) as { ok: boolean; jobId?: string; error?: string };
      if (!started.ok || !submitted.ok || !submitted.jobId) throw new Error(submitted.error ?? `HTTP ${started.status}`);
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        const polled = await fetch(`/api/optional-components?job=${encodeURIComponent(submitted.jobId)}`);
        const data = (await polled.json()) as { ok: boolean; job?: { done: boolean; ok: boolean | null; message: string }; error?: string };
        if (!polled.ok || !data.ok || !data.job) throw new Error(data.error ?? `HTTP ${polled.status}`);
        if (!data.job.done) continue;
        setMessage(data.job.message);
        setFailed(data.job.ok !== true);
        if (data.job.ok) onInstalled?.();
        break;
      }
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [busy, id, onInstalled]);
  return { start, busy, message, failed };
}
