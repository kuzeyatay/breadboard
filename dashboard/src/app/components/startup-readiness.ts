"use client";

import { useEffect } from "react";

// The server marks the document loading before any client bundle runs. Desktop
// reads this shared signal after load; a contentful paint alone can be a skeleton.
const pending = new Set<symbol>();
let hydrated = false;

function publish() {
  document.documentElement.dataset.breadboardStartup =
    hydrated && pending.size === 0 ? "ready" : "loading";
}

export function markStartupHydrated(): () => void {
  hydrated = true;
  publish();
  return () => { hydrated = false; publish(); };
}

/** Initial page/widget reads participate independently; failures settle too. */
export function beginStartupLoading(): () => void {
  const token = Symbol();
  pending.add(token);
  publish();
  return () => { if (pending.delete(token)) publish(); };
}

export function useStartupLoading(loading: boolean): void {
  useEffect(() => {
    if (loading) return beginStartupLoading();
  }, [loading]);
}
