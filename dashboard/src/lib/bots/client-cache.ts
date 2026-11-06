"use client";

import type { BotDefinition } from "./types.ts";

export const BOTS_CHANGED_EVENT = "breadboard:bots-changed";
// Matches auth-client without pulling the authentication SDK into the roster.
export const BOTS_AUTH_CHANGED_EVENT = "breadboard:auth-changed";
// Use the same freshness window as the Skills and Agents catalogs.
export const BOTS_CACHE_TTL_MS = 5 * 60_000;

let cached: { bots: BotDefinition[]; expiresAt: number } | null = null;
let inFlight: Promise<BotDefinition[]> | null = null;
let generation = 0;
let listening = false;

export function invalidateBotsCache(): void {
  generation += 1;
  cached = null;
  inFlight = null;
}

function listenForChanges(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener(BOTS_CHANGED_EVENT, invalidateBotsCache);
  window.addEventListener(BOTS_AUTH_CHANGED_EVENT, invalidateBotsCache);
}

export function peekCachedBots(): BotDefinition[] | null {
  listenForChanges();
  // Expiry triggers revalidation, not an empty tab. Explicit mutations and
  // authentication changes still discard the snapshot immediately.
  return cached?.bots ?? null;
}

/** Preload and tab visits share one request, including a valid empty roster. */
export function loadCachedBots(): Promise<BotDefinition[]> {
  listenForChanges();
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.bots);
  if (inFlight) return inFlight;
  const requestGeneration = generation;
  const request = fetch("/api/bots", { cache: "no-store" })
    .then(async response => {
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        // Never retain another user's roster after a session expires, even if
        // the normal auth-change event has not reached this renderer yet.
        if ((response.status === 401 || response.status === 403) && requestGeneration === generation) invalidateBotsCache();
        throw Object.assign(new Error(body?.error || "Bots could not be loaded."), { status: response.status });
      }
      if (!Array.isArray(body?.bots)) throw new Error("Bots could not be loaded.");
      // A save or sign-out may finish while an older preload is still pending.
      if (requestGeneration !== generation) throw new Error("The bot list changed. Please retry.");
      cached = { bots: body.bots, expiresAt: Date.now() + BOTS_CACHE_TTL_MS };
      return cached.bots;
    })
    .finally(() => {
      if (inFlight === request) inFlight = null;
    });
  inFlight = request;
  return request;
}
