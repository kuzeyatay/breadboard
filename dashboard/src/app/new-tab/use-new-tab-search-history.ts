"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { normalizeSearchHistory, type SearchHistoryEntry, type SearchScope } from "@/lib/new-tab-search-suggestions";

function createHistoryStore(ownerKey: string, initialItems: SearchHistoryEntry[]) {
  const initial = { items: normalizeSearchHistory(initialItems) };
  let state = initial;
  let queue = Promise.resolve();
  let failed: { method: string; entry?: SearchHistoryEntry } | null = null;
  const listeners = new Set<() => void>();
  function request(method = "GET", entry?: SearchHistoryEntry) {
    queue = queue.then(async () => {
      try {
        const response = await fetch("/api/new-tab/search/history", { method, cache: "no-store", keepalive: method !== "GET", signal: AbortSignal.timeout(30_000),
          ...(entry ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(entry) } : {}) });
        if (!response.ok) throw new Error("Recent searches are unavailable.");
        const data = await response.json();
        state = { items: normalizeSearchHistory(data.items) };
        failed = null;
      } catch {
        failed = { method, entry };
      }
      for (const listener of listeners) listener();
    });
    return queue;
  }
  return {
    ownerKey,
    getSnapshot: () => state,
    getServerSnapshot: () => initial,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    retry: () => failed ? request(failed.method, failed.entry) : request(),
    remember: (query: string, scope: SearchScope) => request("POST", { query, scope }),
    remove: (query: string, scope: SearchScope) => request("DELETE", { query, scope }),
  };
}

export function useNewTabSearchHistory(ownerKey: string, initialItems: SearchHistoryEntry[], active: boolean) {
  // A new account gets a fresh store immediately, before its first request.
  const store = useMemo(() => createHistoryStore(ownerKey, initialItems), [ownerKey, initialItems]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  useEffect(() => {
    if (!active) return;
    const refresh = () => { void store.retry(); };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [store, active]);
  return { ...state, remember: store.remember, remove: store.remove };
}
