"use client";

import { useCallback, useEffect, useState } from "react";
import { browserHistoryControl, type DesktopBrowserHistoryCommand, type DesktopBrowserHistorySnapshot } from "@/lib/desktop-browser-tabs";

export function useBrowserHistory() {
  const [state, setState] = useState<DesktopBrowserHistorySnapshot & { ready: boolean }>({ items: [], error: null, ready: false });
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    const control = browserHistoryControl();
    if (!control) {
      setState({ items: [], ready: true, error: "Restart Breadboard to enable saved website history." });
      return;
    }
    let alive = true;
    let request = 0;
    const refresh = async () => {
      const current = ++request;
      try {
        const snapshot = await control.read();
        if (alive && current === request) setState({ ...snapshot, ready: true });
      } catch {
        if (alive && current === request) setState((previous) => ({ ...previous, ready: true, error: "Couldn’t load browser history. Try again." }));
      }
    };
    const unsubscribe = control.subscribe(() => { void refresh(); });
    void refresh();
    window.addEventListener("focus", refresh);
    return () => { alive = false; unsubscribe(); window.removeEventListener("focus", refresh); };
  }, [revision]);

  const command = useCallback(async (action: DesktopBrowserHistoryCommand) => {
    try {
      if (!await browserHistoryControl()?.command(action)) throw new Error("Couldn’t update browser history. Try again.");
      retry();
      return true;
    } catch {
      setState((previous) => ({ ...previous, error: "Couldn’t update browser history. Try again." }));
      return false;
    }
  }, [retry]);

  return { ...state, command, retry };
}
