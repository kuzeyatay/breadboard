// Reconciles the mem0 semantic index against canonical durable_memories.
//
// One mechanism covers every write path: tool saves, gadget saves, edits,
// confirms, supersedes, and embedding-model changes all land in the canonical
// table (or the fingerprint), and the next pass diffs canon against
// mem0_mirrors and applies the difference to the vector store. Budgeted like
// the garden retriever's embedding backfill: the index warms over successive
// turns instead of blocking any single one, and a row with no vector is still
// reachable lexically — partial coverage degrades smoothly rather than lying.
//
// Supersession is the one correctness-relevant direction: a superseded row's
// vector is removed here, but retrieval also re-checks row state when mapping
// hits back to canon, so even a not-yet-reconciled index can never resurface
// a forgotten memory.

import crypto from "node:crypto";
import type Database from "better-sqlite3";
import db from "../db.ts";
import type { DurableMemoryRow } from "../conversations/memory.ts";
import type { SemanticMemoryClient } from "./client.ts";

const ITEM_BUDGET = 24;
const TIME_BUDGET_MS = 3_000;

export function mirrorContentHash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 24);
}

interface MirrorColumns {
  mirror_mem0_id: string | null;
  mirror_hash: string | null;
  mirror_fingerprint: string | null;
}

export interface ReconcileResult {
  indexed: number;
  removed: number;
  /** Rows still waiting for a later, warmer pass. */
  pending: number;
}

export async function reconcileSemanticMirrors(input: {
  userId: number;
  client: SemanticMemoryClient;
  fingerprint: string;
  database?: Database.Database;
  itemBudget?: number;
  timeBudgetMs?: number;
}): Promise<ReconcileResult> {
  const database = input.database ?? db;
  const itemBudget = input.itemBudget ?? ITEM_BUDGET;
  const deadline = Date.now() + (input.timeBudgetMs ?? TIME_BUDGET_MS);
  let indexed = 0;
  let removed = 0;
  let pending = 0;
  let spent = 0;

  // Vectors left behind by permanent deletions (see the tombstone trigger in
  // schema.ts). Retired first: the user asked for this content to be gone.
  const tombstones = database.prepare(`
    SELECT mem0_id, fingerprint FROM mem0_tombstones WHERE user_id = ? LIMIT 100
  `).all(input.userId) as Array<{ mem0_id: string; fingerprint: string }>;
  for (const tombstone of tombstones) {
    if (spent >= itemBudget || Date.now() >= deadline) {
      pending += 1;
      continue;
    }
    if (tombstone.fingerprint === input.fingerprint &&
        !mem0IdShared(database, tombstone.mem0_id, -1)) {
      try {
        await input.client.remove(tombstone.mem0_id);
      } catch {
        pending += 1;
        continue;
      }
      spent += 1;
    }
    database.prepare("DELETE FROM mem0_tombstones WHERE mem0_id = ?").run(tombstone.mem0_id);
    removed += 1;
  }

  // Superseded rows whose mirror still exists: drop the vector, then the
  // bookkeeping row. A mirror written under another fingerprint points into an
  // abandoned store file, so only the bookkeeping needs to go.
  const staleMirrors = database.prepare(`
    SELECT mm.durable_id, mm.mem0_id, mm.fingerprint
    FROM mem0_mirrors mm
    JOIN durable_memories dm ON dm.id = mm.durable_id
    WHERE dm.user_id = ? AND dm.state = 'superseded'
    LIMIT 100
  `).all(input.userId) as Array<{ durable_id: number; mem0_id: string; fingerprint: string }>;
  for (const mirror of staleMirrors) {
    if (spent >= itemBudget || Date.now() >= deadline) {
      pending += 1;
      continue;
    }
    if (mirror.mem0_id && mirror.fingerprint === input.fingerprint &&
        !mem0IdShared(database, mirror.mem0_id, mirror.durable_id)) {
      try {
        await input.client.remove(mirror.mem0_id);
      } catch {
        pending += 1;
        continue;
      }
      spent += 1;
    }
    database.prepare("DELETE FROM mem0_mirrors WHERE durable_id = ?").run(mirror.durable_id);
    removed += 1;
  }

  // Active rows that are unmirrored, edited since mirroring, or mirrored in a
  // different vector space. The 500-row bound matches memory inspection; the
  // lexical ranker's own recency window is tighter than this.
  const activeRows = database.prepare(`
    SELECT dm.*, mm.mem0_id AS mirror_mem0_id, mm.content_hash AS mirror_hash,
           mm.fingerprint AS mirror_fingerprint
    FROM durable_memories dm
    LEFT JOIN mem0_mirrors mm ON mm.durable_id = dm.id
    WHERE dm.user_id = ? AND dm.state IN ('candidate','confirmed')
    ORDER BY COALESCE(dm.last_confirmed_at, dm.created_at) DESC, dm.id DESC
    LIMIT 500
  `).all(input.userId) as Array<DurableMemoryRow & MirrorColumns>;

  for (const row of activeRows) {
    const hash = mirrorContentHash(row.content);
    const current =
      row.mirror_fingerprint === input.fingerprint && row.mirror_hash === hash;
    if (current) continue;
    if (spent >= itemBudget || Date.now() >= deadline) {
      pending += 1;
      continue;
    }
    try {
      if (row.mirror_mem0_id && row.mirror_fingerprint === input.fingerprint &&
          !mem0IdShared(database, row.mirror_mem0_id, row.id)) {
        await input.client.remove(row.mirror_mem0_id);
        spent += 1;
      }
      const mem0Id = await input.client.index(row.content, {
        userId: input.userId,
        metadata: {
          durable_id: row.id,
          kind: row.kind,
          scope: row.scope,
          scope_id: row.scope_id ?? null,
        },
      });
      spent += 1;
      // A null id means mem0 would not hold this text; record it so the row
      // is not retried every pass. The empty id maps to no search hit.
      upsertMirror(database, row.id, mem0Id ?? "", hash, input.fingerprint);
      indexed += 1;
    } catch {
      // Embedding backend unreachable — stop burning budget this pass.
      pending += 1;
      break;
    }
  }

  return { indexed, removed, pending };
}

export function upsertMirror(
  database: Database.Database,
  durableId: number,
  mem0Id: string,
  contentHash: string,
  fingerprint: string,
): void {
  database.prepare(`
    INSERT INTO mem0_mirrors (durable_id, mem0_id, content_hash, fingerprint, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(durable_id) DO UPDATE SET
      mem0_id = excluded.mem0_id,
      content_hash = excluded.content_hash,
      fingerprint = excluded.fingerprint,
      updated_at = excluded.updated_at
  `).run(durableId, mem0Id, contentHash, fingerprint);
}

/**
 * Two durable rows with identical content share one mem0 entry (mem0
 * deduplicates by exact hash). Such an entry may only be deleted once no
 * other mirror references it.
 */
function mem0IdShared(
  database: Database.Database,
  mem0Id: string,
  exceptDurableId: number,
): boolean {
  const row = database.prepare(`
    SELECT COUNT(*) AS n FROM mem0_mirrors WHERE mem0_id = ? AND durable_id <> ?
  `).get(mem0Id, exceptDurableId) as { n: number };
  return row.n > 0;
}
