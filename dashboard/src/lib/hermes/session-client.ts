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
interface SharedRequest<T> {
  controller: AbortController;
  consumers: Set<symbol>;
  settled: boolean;
  promise: Promise<T>;
  abandon: () => void;
}

const summaryRequests = new Map<
  HermesSurface,
  SharedRequest<HermesSessionSnapshot[]>
>();
const detailRequests = new Map<string, SharedRequest<HermesSessionSnapshot>>();
const details = new Map<string, HermesSessionSnapshot>();
const detailFreshUntil = new Map<string, number>();
const recentPrefetches = new Map<string, number>();
const PREFETCH_REUSE_MS = 5_000;
const DETAIL_CACHE_FRESH_MS = 5_000;

function abortReason(signal: AbortSignal): unknown {
  return (
    signal.reason ??
    new DOMException("The operation was aborted.", "AbortError")
  );
}

/**
 * Join one deduplicated fetch without making any one component its owner.
 * The underlying request is cancelled only after every active consumer has
 * gone away; one route unmount therefore cannot break another mounted reader.
 */
function followSharedRequest<T>(
  request: SharedRequest<T>,
  signal?: AbortSignal,
): Promise<T> {
  const consumer = Symbol("hermes-request-consumer");
  request.consumers.add(consumer);

  return new Promise<T>((resolve, reject) => {
    let finished = false;
    const release = () => {
      request.consumers.delete(consumer);
      signal?.removeEventListener("abort", onAbort);
    };
    const settle = (action: () => void) => {
      if (finished) return;
      finished = true;
      release();
      action();
    };
    const onAbort = () => {
      if (finished) return;
      finished = true;
      release();
      reject(abortReason(signal as AbortSignal));
      if (!request.settled && request.consumers.size === 0) {
        request.abandon();
      }
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    request.promise.then(
      (value) => settle(() => resolve(value)),
      (cause) => settle(() => reject(cause)),
    );
  });
}

export const HERMES_SESSIONS_CHANGED_EVENT = "breadboard:hermes-sessions-changed";

/**
 * Chats whose delete has been sent but not yet acknowledged.
 *
 * Deleting a chat stops whatever it still has running before it removes the
 * rows, so the round trip can take seconds. The row leaves the rail on the
 * click and the request runs behind it — but until the server answers, the
 * chat is still in the history the server serves, and any poll that overlaps
 * the delete would list it and ghost the row back for a tick. Summaries
 * therefore hide these ids from every reader, which is one seam rather than a
 * filter in each surface that shows a Recents list.
 */
const deletingSessions = new Set<string>();

/** Hide one chat from history while its delete is in flight. */
export function markHermesSessionDeleting(id: string): void {
  deletingSessions.add(id);
}

/**
 * Stop hiding a chat. Called when the delete fails, so the next refresh shows
 * it again; after a delete succeeds the chat is simply gone from the server
 * and the id can be released just the same.
 */
export function clearHermesSessionDeleting(id: string): void {
  deletingSessions.delete(id);
}

export function notifyHermesSessionsChanged(surface: HermesSurface): void {
  invalidateHermesSessionSummaries(surface);
  window.dispatchEvent(new CustomEvent(HERMES_SESSIONS_CHANGED_EVENT, {
    detail: { surface },
  }));
}

/** Deduplicate the terminal and session hook's simultaneous history request. */
export async function loadHermesSessionSummaries(
  surface: HermesSurface,
  options: { force?: boolean; signal?: AbortSignal } = {},
): Promise<HermesSessionSnapshot[]> {
  const pending = summaryRequests.get(surface);
  if (pending) {
    return followSharedRequest(pending, options.signal).then(withoutDeleting);
  }
  if (options.signal?.aborted) throw abortReason(options.signal);
  const cached = summaries.get(surface);
  if (!options.force && cached && cached.expiresAt > Date.now()) {
    return withoutDeleting(cached.value);
  }

  const controller = new AbortController();
  const request: SharedRequest<HermesSessionSnapshot[]> = {
    controller,
    consumers: new Set<symbol>(),
    settled: false,
    promise: Promise.resolve([] as HermesSessionSnapshot[]),
    abandon: () => undefined,
  };
  request.abandon = () => {
    if (summaryRequests.get(surface) === request) {
      summaryRequests.delete(surface);
    }
    controller.abort();
  };
  request.promise = fetch(
    `/api/hermes/sessions?surface=${encodeURIComponent(surface)}`,
    { cache: "no-store", signal: controller.signal },
  )
    .then(async (response) => {
      if (!response.ok) throw new Error("Chats could not be loaded.");
      const data = await response.json().catch(() => ({ sessions: [] }));
      const value = Array.isArray(data.sessions) ? data.sessions : [];
      summaries.set(surface, { expiresAt: Date.now() + SUMMARY_TTL_MS, value });
      return value as HermesSessionSnapshot[];
    })
    .finally(() => {
      request.settled = true;
      if (summaryRequests.get(surface) === request) {
        summaryRequests.delete(surface);
      }
    });
  summaryRequests.set(surface, request);
  return followSharedRequest(request, options.signal).then(withoutDeleting);
}

/**
 * The cache keeps whatever the server said; the hiding happens on the way out,
 * so a delete that fails needs no cache surgery to bring its chat back.
 */
function withoutDeleting(
  sessions: HermesSessionSnapshot[],
): HermesSessionSnapshot[] {
  if (deletingSessions.size === 0) return sessions;
  return sessions.filter(
    (session) =>
      typeof session.id !== "string" || !deletingSessions.has(session.id),
  );
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
  const key = detailKey(surface, id);
  if ((detailFreshUntil.get(key) ?? 0) <= Date.now()) {
    details.delete(key);
    detailFreshUntil.delete(key);
    recentPrefetches.delete(key);
    return null;
  }
  return details.get(key) ?? null;
}

/** A selected transcript is revalidated, while concurrent readers share one request. */
export async function loadHermesSessionDetail(
  surface: HermesSurface,
  id: string,
  options: {
    reuseRecentPrefetch?: boolean;
    /**
     * A selected chat must be newer than a speculative hover/focus request.
     * Join that request so it is not orphaned, then fetch the authoritative
     * snapshot that decides whether a run is still active.
     */
    revalidateAfterPending?: boolean;
    signal?: AbortSignal;
  } = {},
): Promise<HermesSessionSnapshot> {
  const key = detailKey(surface, id);
  const pending = detailRequests.get(key);
  if (pending) {
    const shared = await followSharedRequest(pending, options.signal);
    if (!options.revalidateAfterPending) return shared;
    if (options.signal?.aborted) throw abortReason(options.signal);
    return loadHermesSessionDetail(surface, id, { signal: options.signal });
  }
  if (options.signal?.aborted) throw abortReason(options.signal);
  const prefetchedUntil = recentPrefetches.get(key) ?? 0;
  const prefetched = details.get(key);
  recentPrefetches.delete(key);
  if (
    options.reuseRecentPrefetch &&
    prefetched &&
    prefetchedUntil > Date.now()
  ) {
    return prefetched;
  }
  const controller = new AbortController();
  const request: SharedRequest<HermesSessionSnapshot> = {
    controller,
    consumers: new Set<symbol>(),
    settled: false,
    promise: Promise.resolve({} as HermesSessionSnapshot),
    abandon: () => undefined,
  };
  request.abandon = () => {
    if (detailRequests.get(key) === request) detailRequests.delete(key);
    controller.abort();
  };
  request.promise = fetch(
    `/api/hermes/sessions/${encodeURIComponent(id)}?surface=${encodeURIComponent(surface)}`,
    { cache: "no-store", signal: controller.signal },
  )
    .then(async (response) => {
      if (!response.ok) throw new Error("This chat could not be loaded.");
      const data = await response.json().catch(() => null);
      if (!data?.session || typeof data.session !== "object") {
        throw new Error("This chat could not be loaded.");
      }
      details.set(key, data.session as HermesSessionSnapshot);
      detailFreshUntil.set(key, Date.now() + DETAIL_CACHE_FRESH_MS);
      // Keep a bounded in-memory working set; old transcripts can be fetched again.
      while (details.size > 12) {
        const oldest = details.keys().next().value as string;
        details.delete(oldest);
        detailFreshUntil.delete(oldest);
        recentPrefetches.delete(oldest);
      }
      return data.session as HermesSessionSnapshot;
    })
    .finally(() => {
      request.settled = true;
      if (detailRequests.get(key) === request) detailRequests.delete(key);
    });
  detailRequests.set(key, request);
  return followSharedRequest(request, options.signal);
}

/**
 * Warm a transcript when a history row shows intent (hover, focus, or touch).
 * A fresh completed transcript is reused from the bounded working set; an
 * in-flight request is shared with `loadHermesSessionDetail` if the row is
 * opened before the response arrives. Expired entries are fetched again so a
 * background run cannot turn a one-message snapshot into a misleading restore.
 */
export function prefetchHermesSessionDetail(
  surface: HermesSurface,
  id: string,
): Promise<HermesSessionSnapshot> {
  const key = detailKey(surface, id);
  const cached = cachedHermesSessionDetail(surface, id);
  if (cached) return Promise.resolve(cached);
  return loadHermesSessionDetail(surface, id).then((session) => {
    recentPrefetches.set(key, Date.now() + PREFETCH_REUSE_MS);
    return session;
  });
}

export function updateCachedHermesSessionMessages(
  surface: HermesSurface,
  id: string,
  messages: unknown[],
): void {
  const key = detailKey(surface, id);
  const cached = details.get(key);
  if (cached) {
    details.set(key, { ...cached, messages });
    detailFreshUntil.set(key, Date.now() + DETAIL_CACHE_FRESH_MS);
  }
}

export function invalidateHermesSessionDetail(surface: HermesSurface, id: string): void {
  const key = detailKey(surface, id);
  details.delete(key);
  detailFreshUntil.delete(key);
  recentPrefetches.delete(key);
}
