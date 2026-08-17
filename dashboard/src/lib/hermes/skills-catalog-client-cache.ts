"use client";

import type { HermesSurface } from "@/lib/hermes/config.ts";

export const SKILLS_CATALOG_CACHE_TTL_MS = 5 * 60_000;

const responses = new Map<string, { expiresAt: number; value: unknown }>();
const requests = new Map<string, Promise<unknown>>();
let cacheGeneration = 0;

export function skillsCatalogUrl({
  surface,
  filter = "all",
  page = 0,
  perPage = 50,
  query = "",
  recentSkillIds = [],
}: {
  surface: HermesSurface;
  filter?: string;
  page?: number;
  perPage?: number;
  query?: string;
  recentSkillIds?: string[];
}): string {
  const normalizedQuery = query.trim();
  if (normalizedQuery && filter !== "featured" && filter !== "recent") {
    const search = new URLSearchParams({ q: normalizedQuery, surface });
    return `/api/hermes/skills/search?${search}`;
  }
  const parameters = new URLSearchParams({
    filter,
    page: String(page),
    perPage: String(perPage),
    surface,
  });
  if (normalizedQuery) parameters.set("q", normalizedQuery);
  if (filter === "recent") {
    recentSkillIds.forEach((id) => parameters.append("id", id));
  }
  return `/api/hermes/skills?${parameters}`;
}

export function peekCachedSkillsCatalog<T>(url: string): T | null {
  const cached = responses.get(url);
  if (!cached || cached.expiresAt <= Date.now()) return null;
  return cached.value as T;
}

export async function loadCachedSkillsCatalog<T>(
  url: string,
  options: { force?: boolean; maxAgeMs?: number } = {},
): Promise<T> {
  const force = options.force === true;
  if (force) invalidateSkillsCatalogCache(url);
  const pending = force ? undefined : requests.get(url);
  if (pending) return pending as Promise<T>;
  const cached = force ? null : peekCachedSkillsCatalog<T>(url);
  if (cached) return cached;

  const requestGeneration = cacheGeneration;
  const maxAgeMs = options.maxAgeMs ?? SKILLS_CATALOG_CACHE_TTL_MS;
  const request = fetch(url, { cache: "no-store" })
    .then(async (response) => {
      const value = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok) {
        const message = typeof value.message === "string"
          ? value.message
          : typeof value.error === "string"
            ? value.error
            : "The skills catalog is unavailable.";
        throw new Error(message);
      }
      if (requestGeneration === cacheGeneration) {
        responses.set(url, { expiresAt: Date.now() + maxAgeMs, value });
      }
      return value as T;
    })
    .finally(() => {
      if (requests.get(url) === request) requests.delete(url);
    });
  requests.set(url, request);
  return request as Promise<T>;
}

/** Remove exact URLs and their query-string variants. No arguments clears all. */
export function invalidateSkillsCatalogCache(...urls: string[]): void {
  cacheGeneration += 1;
  if (urls.length === 0) {
    responses.clear();
    requests.clear();
    return;
  }
  const matches = (key: string) =>
    urls.some((url) => key === url || key.startsWith(`${url}?`));
  for (const key of responses.keys()) {
    if (matches(key)) responses.delete(key);
  }
  for (const key of requests.keys()) {
    if (matches(key)) requests.delete(key);
  }
}
