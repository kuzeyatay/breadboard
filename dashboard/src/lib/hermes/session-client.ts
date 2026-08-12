"use client";

import type { HermesSurface } from "@/lib/hermes/config.ts";

export interface HermesSessionSnapshot {
  id?: unknown;
  title?: unknown;
  gardenId?: unknown;
  pageSlug?: unknown;
  activeDirectory?: unknown;
  filesystemMode?: unknown;
  activeRun?: unknown;
  externalAgentActive?: unknown;
  messages?: unknown;
  [key: string]: unknown;
}

const SUMMARY_TTL_MS = 5_000;
const summaries = new Map<
  HermesSurface,
  { expiresAt: number; value: HermesSessionSnapshot[] }
>();
const summaryRequests = new Map<HermesSurface, Promise<HermesSessionSnapshot[]>>();
const detailRequests = new Map<string, Promise<HermesSessionSnapshot>>();
const details = new Map<string, HermesSessionSnapshot>();

export const HERMES_SESSIONS_CHANGED_EVENT = "breadboard:hermes-sessions-changed";

export function notifyHermesSessionsChanged(surface: HermesSurface): void {
  invalidateHermesSessionSummaries(surface);
  window.dispatchEvent(new CustomEvent(HERMES_SESSIONS_CHANGED_EVENT, {
    detail: { surface },
  }));
}

/** Deduplicate the terminal and session hook's simultaneous history request. */
export async function loadHermesSessionSummaries(
  surface: HermesSurface,
  options: { force?: boolean } = {},
): Promise<HermesSessionSnapshot[]> {
  const pending = summaryRequests.get(surface);
  if (pending) return pending;
  const cached = summaries.get(surface);
  if (!options.force && cached && cached.expiresAt > Date.now()) return cached.value;

  const request = fetch(
    `/api/hermes/sessions?surface=${encodeURIComponent(surface)}`,
    { cache: "no-store" },
  )
    .then(async (response) => {
      if (!response.ok) throw new Error("Chats could not be loaded.");
      const data = await response.json().catch(() => ({ sessions: [] }));
      const value = Array.isArray(data.sessions) ? data.sessions : [];
      summaries.set(surface, { expiresAt: Date.now() + SUMMARY_TTL_MS, value });
      return value as HermesSessionSnapshot[];
    })
    .finally(() => summaryRequests.delete(surface));
  summaryRequests.set(surface, request);
  return request;
}

export function invalidateHermesSessionSummaries(surface?: HermesSurface): void {
  if (surface) summaries.delete(surface);
  else summaries.clear();
}

function detailKey(surface: HermesSurface, id: string): string {
  return `${surface}:${id}`;
}

export function cachedHermesSessionDetail(
  surface: HermesSurface,
  id: string,
): HermesSessionSnapshot | null {
  return details.get(detailKey(surface, id)) ?? null;
}

/** A selected transcript is revalidated, while concurrent readers share one request. */
export async function loadHermesSessionDetail(
  surface: HermesSurface,
  id: string,
): Promise<HermesSessionSnapshot> {
  const key = detailKey(surface, id);
  const pending = detailRequests.get(key);
  if (pending) return pending;
  const request = fetch(
    `/api/hermes/sessions/${encodeURIComponent(id)}?surface=${encodeURIComponent(surface)}`,
    { cache: "no-store" },
  )
    .then(async (response) => {
      if (!response.ok) throw new Error("This chat could not be loaded.");
      const data = await response.json().catch(() => null);
      if (!data?.session || typeof data.session !== "object") {
        throw new Error("This chat could not be loaded.");
      }
      details.set(key, data.session as HermesSessionSnapshot);
      // Keep a bounded in-memory working set; old transcripts can be fetched again.
      while (details.size > 12) details.delete(details.keys().next().value as string);
      return data.session as HermesSessionSnapshot;
    })
    .finally(() => detailRequests.delete(key));
  detailRequests.set(key, request);
  return request;
}

export function updateCachedHermesSessionMessages(
  surface: HermesSurface,
  id: string,
  messages: unknown[],
): void {
  const key = detailKey(surface, id);
  const cached = details.get(key);
  if (cached) details.set(key, { ...cached, messages });
}

export function invalidateHermesSessionDetail(surface: HermesSurface, id: string): void {
  details.delete(detailKey(surface, id));
}
