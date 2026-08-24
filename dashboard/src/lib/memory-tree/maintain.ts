// When the tree gets rebuilt, and when the vault gets synced.
//
// Rebuilding is cheap and deterministic, so the policy is simply "rebuild when
// the facts have changed". That is checked with one COUNT against a stored
// number rather than on a timer, so a memory saved thirty seconds ago is in
// the tree the next time anything looks at it, and a quiet week costs nothing.
//
// The vault is different: it writes files into the user's home directory, so
// nothing writes it until the user has asked for one. Once a vault exists,
// syncing reads it before it writes it — a correction made in an editor must
// not be overwritten by an export of the state it was correcting.

import type Database from "better-sqlite3";

import db from "../db.ts";
import { buildMemoryTree, type BuildResult } from "./build.ts";
import {
  exportVault,
  importVault,
  vaultRoot,
  type ExportResult,
  type ImportResult,
} from "./vault.ts";

export interface TreeStatus {
  builtAt: string | null;
  exportedAt: string | null;
  importedAt: string | null;
  memoryCount: number;
  nodeCount: number;
  /** Empty until the user has asked for a vault. */
  vaultPath: string;
  /** Where one would be written if they did. */
  vaultWouldBe: string;
  stale: boolean;
  lastError: string | null;
}

function liveMemoryCount(userId: number, database: Database.Database): number {
  const row = database
    .prepare(
      `SELECT COUNT(*) AS n FROM durable_memories
       WHERE user_id = ? AND state IN ('candidate','confirmed')`,
    )
    .get(userId) as { n: number };
  return Number(row.n);
}

export function treeStatus(
  userId: number,
  database: Database.Database = db,
): TreeStatus {
  const state = database
    .prepare(
      `SELECT built_at, exported_at, imported_at, memory_count, node_count,
              vault_path, last_error
       FROM memory_tree_state WHERE user_id = ?`,
    )
    .get(userId) as
    | {
        built_at: string | null;
        exported_at: string | null;
        imported_at: string | null;
        memory_count: number;
        node_count: number;
        vault_path: string;
        last_error: string | null;
      }
    | undefined;

  const live = liveMemoryCount(userId, database);
  return {
    builtAt: state?.built_at ?? null,
    exportedAt: state?.exported_at ?? null,
    importedAt: state?.imported_at ?? null,
    memoryCount: live,
    nodeCount: state?.node_count ?? 0,
    vaultPath: state?.vault_path ?? "",
    vaultWouldBe: vaultRoot(userId),
    stale: !state?.built_at || Number(state.memory_count) !== live,
    lastError: state?.last_error ?? null,
  };
}

/**
 * Rebuild the tree if the facts underneath it have changed.
 *
 * Returns what was built, or null when the existing tree was already current.
 * Never throws: a caller reading memory mid-turn should get the tree it has
 * rather than an exception about the tree it wanted.
 */
export function ensureFreshTree(
  userId: number,
  database: Database.Database = db,
): BuildResult | null {
  try {
    if (!treeStatus(userId, database).stale) return null;
    return buildMemoryTree(userId, database);
  } catch (error) {
    try {
      database
        .prepare(
          `INSERT INTO memory_tree_state (user_id, last_error)
           VALUES (?, ?)
           ON CONFLICT(user_id) DO UPDATE SET last_error = excluded.last_error`,
        )
        .run(userId, error instanceof Error ? error.message : String(error));
    } catch {
      // Nothing useful left to do; the caller gets the stale tree.
    }
    return null;
  }
}

export interface SyncResult {
  imported: ImportResult;
  built: BuildResult;
  exported: ExportResult;
}

/**
 * The full round trip: read the user's edits, rebuild, write the vault back.
 *
 * Import first, always. The vault is the surface the user edits, so their
 * version of a fact is newer than ours by definition, and exporting before
 * importing would overwrite it with the text they had just corrected.
 */
export function syncVault(
  userId: number,
  database: Database.Database = db,
): SyncResult {
  const imported = importVault(userId, database);
  const built = buildMemoryTree(userId, database);
  const exported = exportVault(userId, database);
  return { imported, built, exported };
}
