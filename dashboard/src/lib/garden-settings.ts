// Per-garden settings that live on the clusters row and are read on the hot
// path of a turn: the standing instructions and the memory scope.
//
// A leaf on purpose. The garden chat adapter and the memory ranker both need
// these, and neither can import src/app/actions/clusters.ts — that module is a
// "use server" file whose imports drag Next.js server actions into places that
// are also unit-tested against a bare SQLite handle.

import type DatabaseType from "better-sqlite3";

import db from "./db.ts";

export type GardenMemoryScope = "default" | "garden_only";

export const MAX_GARDEN_INSTRUCTIONS = 4_000;

export function isGardenMemoryScope(value: unknown): value is GardenMemoryScope {
  return value === "default" || value === "garden_only";
}

/** Standing instructions for a garden, or "" when it has none. */
export function gardenInstructions(
  clusterId: number | null | undefined,
  database: DatabaseType.Database = db,
): string {
  if (clusterId === null || clusterId === undefined) return "";
  try {
    const row = database
      .prepare(`SELECT instructions FROM clusters WHERE id = ?`)
      .get(clusterId) as { instructions?: string } | undefined;
    return typeof row?.instructions === "string" ? row.instructions : "";
  } catch {
    // Column not migrated yet on a very old profile: no instructions is the
    // correct, pre-existing behaviour rather than a failed turn.
    return "";
  }
}

export function gardenMemoryScope(
  clusterId: number | null | undefined,
  database: DatabaseType.Database = db,
): GardenMemoryScope {
  if (clusterId === null || clusterId === undefined) return "default";
  try {
    const row = database
      .prepare(`SELECT memory_scope FROM clusters WHERE id = ?`)
      .get(clusterId) as { memory_scope?: string } | undefined;
    return isGardenMemoryScope(row?.memory_scope) ? row.memory_scope : "default";
  } catch {
    return "default";
  }
}
