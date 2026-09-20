// Proposals: the confirmation step between a measured pattern and a standing
// instruction.
//
// `answer-signal-analysis.ts` recomputes proposals from scratch every time it
// runs, which is what makes them trustworthy — nothing accumulates, and a
// pattern that stops holding stops being proposed. But recomputation alone has
// two failure modes this table exists to fix.
//
// A dismissed proposal would come back. The pattern that produced it is still
// in the signals and always will be, so a proposal the user has already
// considered and rejected would be offered again on every read, forever, until
// they accepted it to make it stop. That is not consent.
//
// An accepted proposal would be written twice. Accepting writes a durable
// memory; without a record that it happened, the next recomputation proposes
// the same sentence again and a second accept would write a near-duplicate row
// into the three-slot standing set.
//
// So this table stores *decisions*, not proposals. The proposal is always
// derived; the decision is what persists.

import type DatabaseType from "better-sqlite3";

import db from "../db.ts";
import { saveDurableMemory } from "../conversations/memory.ts";
import type { PreferenceProposal } from "./answer-signal-analysis.ts";

type Db = DatabaseType.Database;

export type ProposalStatus = "accepted" | "dismissed";

export interface ProposalDecisionRow {
  id: number;
  user_id: number;
  proposal_id: string;
  status: ProposalStatus;
  content: string;
  durable_memory_id: number | null;
  decided_at: string;
}

export interface DecidedProposal extends PreferenceProposal {
  status: ProposalStatus;
  decidedAt: string;
}

export function ensureProposalDecisionSchema(database: Db): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS answer_signal_proposal_decisions (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      -- Derived from (reason, dimension, value), so the same pattern recomputed
      -- next week resolves to the same decision.
      proposal_id       TEXT    NOT NULL,
      status            TEXT    NOT NULL CHECK (status IN ('accepted','dismissed')),
      -- The sentence as it stood when the decision was made. The wording is
      -- generated, so a later change to the generator must not make an old
      -- record describe something the user never actually agreed to.
      content           TEXT    NOT NULL,
      durable_memory_id INTEGER,
      decided_at        TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_proposal_decisions_unique
      ON answer_signal_proposal_decisions(user_id, proposal_id);
  `);
}

let schemaReady = false;

/**
 * A handle with the table guaranteed to exist. Write paths only: creating a
 * table is itself a write, and reading what has been decided must work against
 * a read-only connection — the report tool opens one so it is safe to run
 * while the app is.
 */
function handle(database?: Db): Db {
  const target = database ?? db;
  if (database || !schemaReady) {
    ensureProposalDecisionSchema(target);
    if (!database) schemaReady = true;
  }
  return target;
}

function decisionsTableExists(database: Db): boolean {
  return Boolean(
    database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'answer_signal_proposal_decisions'",
      )
      .get(),
  );
}

export function listProposalDecisions(
  userId: number,
  database?: Db,
): Map<string, ProposalDecisionRow> {
  const target = database ?? db;
  // Nothing decided yet is the same answer as no table yet, and it is the
  // normal state on an install where nobody has been asked anything.
  if (!decisionsTableExists(target)) return new Map();
  const rows = target
    .prepare("SELECT * FROM answer_signal_proposal_decisions WHERE user_id = ?")
    .all(userId) as ProposalDecisionRow[];
  return new Map(rows.map((row) => [row.proposal_id, row]));
}

/**
 * The proposals still awaiting a decision.
 *
 * A proposal whose wording has changed since it was decided is *not* offered
 * again: the user decided about the pattern, not about a sentence. Re-asking
 * because the generator reworded its own output would make dismissal useless.
 */
export function pendingProposals(
  userId: number,
  proposals: readonly PreferenceProposal[],
  database?: Db,
): PreferenceProposal[] {
  const decided = listProposalDecisions(userId, database);
  return proposals.filter((proposal) => !decided.has(proposal.id));
}

export function decidedProposals(
  userId: number,
  proposals: readonly PreferenceProposal[],
  database?: Db,
): DecidedProposal[] {
  const decided = listProposalDecisions(userId, database);
  return proposals.flatMap((proposal) => {
    const row = decided.get(proposal.id);
    return row ? [{ ...proposal, status: row.status, decidedAt: row.decided_at }] : [];
  });
}

/**
 * Accept a proposal: write the preference to durable memory, and record that it
 * was written so it is never offered or written again.
 *
 * The memory lands `confirmed` and `global` because that is what makes it part
 * of the standing set — a candidate row would never be applied, which would
 * make accepting a proposal do nothing visible and leave the user believing
 * they had changed something. Confidence is deliberately not 1.0: this is a
 * statement inferred from a handful of ratings, and the standing set sorts on
 * confidence × salience, so an inferred preference should lose a tie to one the
 * user actually stated.
 */
export function acceptProposal(
  input: { userId: number; proposal: PreferenceProposal },
  database?: Db,
): ProposalDecisionRow | null {
  const target = handle(database);
  const existing = listProposalDecisions(input.userId, database).get(input.proposal.id);
  if (existing) return existing;

  const memory = saveDurableMemory(
    {
      userId: input.userId,
      content: input.proposal.content,
      kind: input.proposal.kind,
      scope: "global",
      state: "confirmed",
      confidence: 0.7,
      salience: 0.8,
      // Keyed to the pattern, so a later accepted revision of the same
      // preference supersedes it rather than sitting beside it.
      memoryKey: `answer_signal:${input.proposal.id}`,
    },
    target,
  );

  target
    .prepare(
      `INSERT INTO answer_signal_proposal_decisions
         (user_id, proposal_id, status, content, durable_memory_id)
       VALUES (?, ?, 'accepted', ?, ?)
       ON CONFLICT(user_id, proposal_id) DO NOTHING`,
    )
    .run(input.userId, input.proposal.id, input.proposal.content, memory?.id ?? null);

  return listProposalDecisions(input.userId, database).get(input.proposal.id) ?? null;
}

/** Decline a proposal. It is not offered again, and nothing is written. */
export function dismissProposal(
  input: { userId: number; proposalId: string; content: string },
  database?: Db,
): ProposalDecisionRow | null {
  const target = handle(database);
  target
    .prepare(
      `INSERT INTO answer_signal_proposal_decisions
         (user_id, proposal_id, status, content)
       VALUES (?, ?, 'dismissed', ?)
       ON CONFLICT(user_id, proposal_id) DO NOTHING`,
    )
    .run(input.userId, input.proposalId, input.content);
  return listProposalDecisions(input.userId, database).get(input.proposalId) ?? null;
}

/**
 * Undo a decision. An accepted proposal's memory is left in place: retracting
 * the decision is not the same as deleting a memory the user can already see
 * and remove in the memory panel, and silently deleting it here would be a
 * second, invisible write.
 */
export function retractProposalDecision(
  userId: number,
  proposalId: string,
  database?: Db,
): boolean {
  const target = handle(database);
  const result = target
    .prepare(
      "DELETE FROM answer_signal_proposal_decisions WHERE user_id = ? AND proposal_id = ?",
    )
    .run(userId, proposalId);
  return result.changes > 0;
}
