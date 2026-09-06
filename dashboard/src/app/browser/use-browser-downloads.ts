"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { browserDownloadsControl, type BrowserDownloadCommand, type BrowserDownloadsSnapshot } from "@/lib/desktop-browser-downloads";

export function useBrowserDownloads(active = true) {
  const [snapshot, setSnapshot] = useState<BrowserDownloadsSnapshot>({ items: [], error: null });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const invalidate = useCallback(() => { sequence.current++; }, []);
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
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await refresh();
      if (!stopped) timer = setTimeout(() => void poll(), 500);
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); invalidate(); };
  }, [active, refresh, invalidate]);

  const act = useCallback(async (command: BrowserDownloadCommand) => {
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
  }, [refresh]);

  return { snapshot, ready, error, setError, busy, refresh, act };
}
