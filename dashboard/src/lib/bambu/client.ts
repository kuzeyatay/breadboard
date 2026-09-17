"use client";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type { JobView } from "./types.ts";
export type PrinterCardView = JobView & { attachments?: { id: string; name: string }[] };
type Snapshot = { view: PrinterCardView | null; error: string | null };
type Entry = { snapshot: Snapshot; listeners: Set<() => void>; timer?: ReturnType<typeof setTimeout>; loading: boolean; };
const entries = new Map<string, Entry>();
const empty: Snapshot = { view: null, error: null };
export function jobUrl(jobId: string, conversation: string, part = "") { return `/api/hermes/connections/bambu/jobs/${encodeURIComponent(jobId)}${part}?conversation=${encodeURIComponent(conversation)}`; }
export async function printerRequest(url: string, body?: Record<string, unknown>, init?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...(body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}), ...init });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? "The printer request failed.");
  return payload;
}
function entryFor(key: string) {
  let entry = entries.get(key);
  if (!entry) { entry = { snapshot: empty, listeners: new Set(), loading: false }; entries.set(key, entry); }
  return entry;
}
function updateEntry(entry: Entry, view: PrinterCardView) {
  entry.snapshot = { view, error: null }; for (const listener of entry.listeners) listener();
}
async function refresh(key: string, entry: Entry) {
  if (entry.loading) return;
  entry.loading = true; clearTimeout(entry.timer);
  try { entry.snapshot = { view: await printerRequest(key, undefined, { signal: AbortSignal.timeout(15000) }), error: null }; }
  catch (error) { entry.snapshot = { ...entry.snapshot, error: error instanceof Error ? error.message : "Printer status unavailable." }; }
  finally {
    entry.loading = false;
    for (const listener of entry.listeners) listener();
    if (entry.listeners.size) entry.timer = setTimeout(() => void refresh(key, entry), entry.snapshot.error ? 10000 : 3000);
    else entries.delete(key);
  }
}
/** Views share one HTTP observer; the native service owns the actual MQTT connection. */
export function usePrinterJob(jobId: string, conversation: string, legacyChatSessionId?: number | null) {
  const key = jobUrl(jobId, conversation) + (legacyChatSessionId ? `&chatSessionId=${legacyChatSessionId}` : ""), entry = useMemo(() => entryFor(key), [key]);
  const subscribe = useCallback((listener: () => void) => {
    entry.listeners.add(listener);
    if (entry.listeners.size === 1) void refresh(key, entry);
    return () => { entry.listeners.delete(listener); if (!entry.listeners.size) { clearTimeout(entry.timer); if (!entry.loading) entries.delete(key); } };
  }, [entry, key]);
  const snapshot = useSyncExternalStore(subscribe, () => entry.snapshot, () => empty);
  useEffect(() => {
    const refreshOnFocus = () => { if (document.visibilityState === "visible") void refresh(key, entry); };
    window.addEventListener("focus", refreshOnFocus);
    return () => window.removeEventListener("focus", refreshOnFocus);
  }, [entry, key]);
  return { ...snapshot, refresh: () => refresh(key, entry), update: (view: PrinterCardView) => updateEntry(entry, view) };
}
