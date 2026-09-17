import fs from "node:fs";
import path from "node:path";

import {
  TOPOLOGY_ARTIFACT_REL_PATH,
  TOPOLOGY_CACHE_REL_PATH,
} from "../thought-topology/storage.ts";
import { gardensForScope, type BrainGraphAccessContext } from "./brain-graph-auth.ts";
import type { BrainGraphResponse, BrainScope } from "./brain-graph-types.ts";

/**
 * A full brain-graph build reads and parses every scoped Garden's Thought
 * Topology artifact and cache (tens of megabytes) synchronously on the
 * dashboard's event loop, ~1.5 s at a time. The profile page polls it every
 * 30 s and on every focus, so an idle profile tab used to cost every other
 * tab a blocked request each half minute. A build is reused while the files
 * it read are byte-for-byte the same (size + mtime) and the database-backed
 * sources are younger than `maxAgeMs`.
 */
export interface BrainGraphCacheEntry {
  fingerprint: string;
  builtAt: number;
  response: BrainGraphResponse;
}

export interface BrainGraphCacheOptions {
  /** Upper bound on how stale the conversation/memory/artifact sources may be. */
  maxAgeMs?: number;
  now?: () => number;
  stat?: (filePath: string) => { size: number; mtimeMs: number } | null;
}

export const BRAIN_GRAPH_CACHE_MAX_AGE_MS = 5 * 60_000;
const MAX_CACHE_ENTRIES = 24;

function defaultStat(filePath: string): { size: number; mtimeMs: number } | null {
  try {
    const stats = fs.statSync(filePath);
    return { size: stats.size, mtimeMs: stats.mtimeMs };
  } catch {
    return null;
  }
}

export function brainGraphCacheKey(
  context: Pick<BrainGraphAccessContext, "userId">,
  scope: BrainScope,
  mode: string,
): string {
  const scopeKey =
    scope.kind === "organization" ? `organization:${scope.organizationId}` : scope.kind;
  return `${context.userId}|${scopeKey}|${mode}`;
}

/**
 * Cheap identity of everything the topology source would read for this
 * scope: the artifact and cache file of every Garden the scope can see. A
 * missing file is part of the identity too, so a Garden gaining its first
 * topology invalidates the entry.
 */
export function brainGraphSourceFingerprint(
  context: BrainGraphAccessContext,
  scope: BrainScope,
  stat: NonNullable<BrainGraphCacheOptions["stat"]> = defaultStat,
): string {
  const contentRoot = process.env.QUARTZ_CONTENT_PATH;
  const gardens = gardensForScope(context, scope);
  const parts: string[] = [contentRoot ? "root" : "no-root"];
  for (const garden of gardens) {
    parts.push(garden.slug);
    if (!contentRoot) continue;
    for (const relative of [TOPOLOGY_ARTIFACT_REL_PATH, TOPOLOGY_CACHE_REL_PATH]) {
      const stats = stat(path.join(contentRoot, garden.slug, relative));
      parts.push(stats ? `${stats.size}:${Math.round(stats.mtimeMs)}` : "-");
    }
  }
  return parts.join(" ");
}

export class BrainGraphCache {
  private readonly entries = new Map<string, BrainGraphCacheEntry>();
  private readonly inFlight = new Map<string, Promise<BrainGraphResponse>>();
  private readonly maxAgeMs: number;
  private readonly now: () => number;
  private readonly stat: NonNullable<BrainGraphCacheOptions["stat"]>;

  constructor(options: BrainGraphCacheOptions = {}) {
    this.maxAgeMs = options.maxAgeMs ?? BRAIN_GRAPH_CACHE_MAX_AGE_MS;
    this.now = options.now ?? Date.now;
    this.stat = options.stat ?? defaultStat;
  }

  /** The cached response when its sources are unchanged and it is fresh enough. */
  peek(
    context: BrainGraphAccessContext,
    scope: BrainScope,
    mode: string,
  ): BrainGraphResponse | null {
    const key = brainGraphCacheKey(context, scope, mode);
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (this.now() - entry.builtAt > this.maxAgeMs) {
      this.entries.delete(key);
      return null;
    }
    if (entry.fingerprint !== brainGraphSourceFingerprint(context, scope, this.stat)) {
      this.entries.delete(key);
      return null;
    }
    return entry.response;
  }

  /**
   * Serves the cached response or runs one build for everybody asking at the
   * same time. The fingerprint is taken before the build so a file that
   * changes while it runs invalidates the entry on the next read rather than
   * being missed.
   */
  async build(
    context: BrainGraphAccessContext,
    scope: BrainScope,
    mode: string,
    builder: () => Promise<BrainGraphResponse>,
  ): Promise<BrainGraphResponse> {
    const cached = this.peek(context, scope, mode);
    if (cached) return cached;
    const key = brainGraphCacheKey(context, scope, mode);
    const pending = this.inFlight.get(key);
    if (pending) return pending;
    const fingerprint = brainGraphSourceFingerprint(context, scope, this.stat);
    const attempt = builder().then((response) => {
      this.remember(key, { fingerprint, builtAt: this.now(), response });
      return response;
    });
    this.inFlight.set(key, attempt);
    try {
      return await attempt;
    } finally {
      if (this.inFlight.get(key) === attempt) this.inFlight.delete(key);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  private remember(key: string, entry: BrainGraphCacheEntry): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
    while (this.entries.size > MAX_CACHE_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}

export const brainGraphCache = new BrainGraphCache();
