// What can actually be filtered on, read from the pool rather than the schema.
//
// The persona schema has 1,290 dimensions and every persona carries a different
// sparse subset, so "does this pool have `life_stage`, and with which values" is
// a question only the pool can answer. The bridge answers it by reading the
// pool's own persona records; this module caches that answer, because the scan
// costs a second and the answer only changes when a pool is imported.
//
// The point of caching it here is that the cohort a model proposes is checked
// against real dimensions and real values before a run starts, instead of
// failing halfway through sampling on a dimension nobody has.

import { spawnSync } from "node:child_process";
import { MATRAIX_DEV_POOL, matraixAvailability } from "./runtime.ts";

export interface MatraixDimensionValue {
  value: string;
  personas: number;
}

export interface MatraixDimension {
  id: string;
  personas: number;
  values: MatraixDimensionValue[];
}

export interface MatraixCatalog {
  pool: string;
  count: number;
  dimensionCount: number;
  sourceCounts: Record<string, number>;
  dimensions: MatraixDimension[];
}

const CACHE_MS = 10 * 60_000;
const PROBE_TIMEOUT_MS = 180_000;

const cacheGlobal = globalThis as typeof globalThis & {
  __breadboardMatraixCatalog?: Map<string, { at: number; value: MatraixCatalog }>;
};
const cache = cacheGlobal.__breadboardMatraixCatalog ?? new Map();
cacheGlobal.__breadboardMatraixCatalog = cache;

export function matraixCatalog(pool = MATRAIX_DEV_POOL): MatraixCatalog | null {
  const cached = cache.get(pool);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;

  const runtime = matraixAvailability();
  if (!runtime.available || !runtime.root || !runtime.python) return null;
  const probe = spawnSync(
    runtime.python,
    [runtime.bridge, "--root", runtime.root, "--catalog", "--pool", pool, "--top", "80"],
    {
      cwd: runtime.root,
      encoding: "utf8",
      windowsHide: true,
      timeout: PROBE_TIMEOUT_MS,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: "1", PYTHONIOENCODING: "utf-8" },
    },
  );
  const line = (probe.stdout ?? "").trim().split(/\r?\n/).at(-1) ?? "";
  let parsed: (MatraixCatalog & { event?: string }) | null = null;
  try {
    parsed = JSON.parse(line) as MatraixCatalog & { event?: string };
  } catch {
    return null;
  }
  if (!parsed || parsed.event !== "catalog" || !Array.isArray(parsed.dimensions)) return null;
  const value: MatraixCatalog = {
    pool: parsed.pool,
    count: parsed.count,
    dimensionCount: parsed.dimensionCount,
    sourceCounts: parsed.sourceCounts ?? {},
    dimensions: parsed.dimensions,
  };
  cache.set(pool, { at: Date.now(), value });
  return value;
}

export function forgetMatraixCatalog(): void {
  cache.clear();
}

/**
 * Drop dimensions and values the pool does not have, and report what was
 * dropped. A filter nobody satisfies would sample zero personas, and the honest
 * answer to that is to run the study on the population that does exist and say
 * which part of the request could not be honoured — not to fail the run, and
 * certainly not to quietly widen it without saying so.
 */
export function reconcileFilters(
  catalog: MatraixCatalog | null,
  filters: Record<string, string[]>,
): { filters: Record<string, string[]>; dropped: string[] } {
  if (!catalog) return { filters, dropped: [] };
  const byId = new Map(catalog.dimensions.map((dimension) => [dimension.id, dimension]));
  const out: Record<string, string[]> = {};
  const dropped: string[] = [];
  for (const [dimension, values] of Object.entries(filters)) {
    const known = byId.get(dimension);
    if (!known) {
      dropped.push(`${dimension} is not a dimension in this persona pool`);
      continue;
    }
    const allowed = new Set(known.values.map((entry) => entry.value));
    const kept = values.filter((value) => allowed.has(value));
    const missing = values.filter((value) => !allowed.has(value));
    if (missing.length) {
      dropped.push(`${dimension} has no personas with ${missing.join(", ")}`);
    }
    if (kept.length) out[dimension] = kept;
  }
  return { filters: out, dropped };
}

/** Same reconciliation for the dimensions a study stratifies or cuts by. */
export function reconcileDimensions(
  catalog: MatraixCatalog | null,
  dimensions: string[],
): { dimensions: string[]; dropped: string[] } {
  if (!catalog) return { dimensions, dropped: [] };
  const known = new Set(catalog.dimensions.map((dimension) => dimension.id));
  const kept = dimensions.filter((dimension) => known.has(dimension));
  const dropped = dimensions
    .filter((dimension) => !known.has(dimension))
    .map((dimension) => `${dimension} is not a dimension in this persona pool`);
  return { dimensions: kept, dropped };
}

/**
 * The dimensions worth offering a model, as compact text. Capped hard: the full
 * index is tens of thousands of tokens, and a chooser needs the dimensions that
 * cover most of the pool, not all of them.
 */
export function renderDimensionMenu(catalog: MatraixCatalog, limit = 40): string {
  return catalog.dimensions
    .slice(0, limit)
    .map(
      (dimension) =>
        `- ${dimension.id} (${dimension.personas} personas): ${dimension.values
          .slice(0, 10)
          .map((entry) => entry.value)
          .join(" | ")}`,
    )
    .join("\n");
}
