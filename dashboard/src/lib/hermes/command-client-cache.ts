"use client";

import type { HermesSurface } from "@/lib/hermes/config.ts";

/** Capability catalogs are stable between explicit mutations and cheap to revalidate. */
export const COMMAND_RESPONSE_CACHE_TTL_MS = 5 * 60_000;

const responses = new Map<string, { expiresAt: number; value: unknown }>();
const requests = new Map<string, Promise<unknown>>();
let cacheGeneration = 0;

export function commandResponseUrl({
  surface,
  sessionId,
  requestedOutcome = "",
}: {
  surface: HermesSurface;
  sessionId?: string | number | null;
  requestedOutcome?: string;
}): string {
  const parameters = new URLSearchParams({ surface });
  if (sessionId) parameters.set("sessionId", String(sessionId));
  const outcome = requestedOutcome.trim();
  // A bare slash is only the keyboard gesture that opens the palette, not a
  // task whose capability mode needs a distinct cache entry.
  if (outcome && outcome !== "/") parameters.set("outcome", outcome.slice(0, 4_000));
  return `/api/hermes/commands?${parameters}`;
}

export function peekCachedCommandResponse<T>(url: string): T | null {
  const cached = responses.get(url);
  if (!cached || cached.expiresAt <= Date.now()) return null;
  return cached.value as T;
}

export async function loadCachedCommandResponse<T>(
  url: string,
  options: { force?: boolean; maxAgeMs?: number } = {},
): Promise<T> {
  const force = options.force === true;
  if (force) invalidateCommandResponseCache(url);
  const pending = force ? undefined : requests.get(url);
  if (pending) return pending as Promise<T>;
  const cached = force ? null : peekCachedCommandResponse<T>(url);
  if (cached) {
    return cached;
  }
  const requestGeneration = cacheGeneration;
  const maxAgeMs = options.maxAgeMs ?? COMMAND_RESPONSE_CACHE_TTL_MS;
  const request = fetch(url, { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) {
        const error = new Error("Capabilities could not be loaded.");
        Object.assign(error, { status: response.status });
        throw error;
      }
      const value = await response.json();
      if (requestGeneration === cacheGeneration) {
        responses.set(url, { expiresAt: Date.now() + maxAgeMs, value });
      }
      return value;
    })
    .finally(() => {
      if (requests.get(url) === request) requests.delete(url);
    });
  requests.set(url, request);
  return request as Promise<T>;
}

/** Remove exact URLs and their query-string variants. No arguments clears all. */
export function invalidateCommandResponseCache(...urls: string[]): void {
  cacheGeneration += 1;
  if (urls.length === 0) {
    responses.clear();
    requests.clear();
    return;
  }
  const matches = (key: string) =>
    urls.some((url) => key === url || key.startsWith(`${url}?`));
  for (const key of responses.keys()) {
    if (matches(key)) {
      responses.delete(key);
    }
  }
  // The underlying request cannot be cancelled here, but dropping it from the
  // registry prevents a post-mutation read from adopting its stale result.
  for (const key of requests.keys()) {
    if (matches(key)) requests.delete(key);
  }
}
