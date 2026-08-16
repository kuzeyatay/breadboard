// Which gardens keep their memories to themselves.
//
// A garden set to `garden_only` makes two promises, and both have to hold or the
// setting is a lie: nothing this garden remembers may surface in a chat outside
// it, and nothing from outside may surface in a chat inside it. Ordinary
// scope *weighting* is not enough for either — an unrelated garden's memory
// still scores 0.10 and global memories still score 0.25, so without a hard
// filter an isolated garden would leak in both directions.
//
// Kept as its own leaf so the memory ranker can ask the question without
// importing the cluster actions, which drag in Next.js server actions.

import type DatabaseType from "better-sqlite3";

import db from "../db.ts";

/**
 * The cluster ids, as strings, whose memories are sealed inside their garden.
 *
 * Returned as strings because `durable_memories.scope_id` stores the cluster id
 * as text; comparing against numbers here would silently never match.
 */
export function isolatedGardenScopeIds(
  userId: number,
  database: DatabaseType.Database = db,
): Set<string> {
  try {
    const rows = database
      .prepare(
        `SELECT id FROM clusters WHERE user_id = ? AND memory_scope = 'garden_only'`,
      )
      .all(userId) as Array<{ id: number }>;
    return new Set(rows.map((row) => String(row.id)));
  } catch {
    // A database without the column yet (a very old profile mid-migration)
    // isolates nothing, which is the pre-existing behaviour.
    return new Set();
  }
}

/**
 * Whether a durable memory row may be read in the current context.
 *
 * `currentGardenScopeId` is the garden the chat is happening in, or null when it
 * is happening outside any garden.
 */
export function memoryVisibleInContext(
  memory: { scope: string; scope_id: string | null },
  context: {
    currentGardenScopeId: string | null;
    /** Cluster ids (as strings) whose memories are sealed. */
    isolatedGardenIds: ReadonlySet<string>;
    /** True when the chat itself sits in a garden-only garden. */
    currentGardenIsIsolated: boolean;
  },
): boolean {
  const gardenId =
    memory.scope === "garden" && memory.scope_id ? memory.scope_id : null;

  // Outward seal: a sealed garden's memory is invisible anywhere else.
  if (
    gardenId !== null &&
    context.isolatedGardenIds.has(gardenId) &&
    gardenId !== context.currentGardenScopeId
  ) {
    return false;
  }

  // Inward seal: inside a sealed garden, only that garden's own memories exist.
  if (context.currentGardenIsIsolated) {
    return gardenId !== null && gardenId === context.currentGardenScopeId;
  }

  return true;
}
