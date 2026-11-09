import type Database from "better-sqlite3";
import { SwarmError } from "./types.ts";

/** Lightweight guard shared by Goal, LoopX recovery and Stop. No scheduler is
 * imported into those policy paths and old databases need no eager migration. */
export function conversationHasActiveSwarm(db: Database.Database, conversationId: number): boolean {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='swarm_runs'").get()) return false;
  return Boolean(db.prepare("SELECT 1 FROM swarm_runs WHERE conversation_id=? AND status NOT IN ('completed','cancelled','failed') LIMIT 1").get(conversationId));
}

/** Deleting the ledger before an executor acknowledges Stop loses its recovery
 * and cancellation identity. Keep the chat intact until that acknowledgement. */
export function assertConversationSwarmStopped(db: Database.Database, conversationId: number): void {
  if (conversationHasActiveSwarm(db, conversationId)) {
    throw new SwarmError("swarm_stop_pending", "Team work is stopping. Delete this chat again after its workers have stopped.", 409);
  }
}

export function swarmCoordinatorCurrent(db: Database.Database, runId: string, conversationId: number): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM swarm_runs WHERE id=? AND conversation_id=?
    AND status NOT IN ('paused','cancelling','cancelled','budget_limited')`).get(runId, conversationId));
}
