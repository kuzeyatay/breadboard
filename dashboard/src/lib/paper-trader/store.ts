// Reading and writing the desk's durable state.
//
// Two rules the rest of the integration relies on.
//
// A prepared decision is handed out exactly once. `takeReadyDecision` flips the
// row to `used` in the same statement that selects it, because the arena is a
// separate process on its own timer and a decision served twice would place the
// same trade twice.
//
// Only one analysis may be in flight. `claimAnalysis` inserts a `pending` row
// only when there is not already one, so a cycle that overlaps a slow analysis
// waits for it rather than starting a second one.

import { ensurePaperTraderSchema } from "./schema.ts";
import type DatabaseType from "better-sqlite3";
import type { PaperTraderSettings } from "./settings.ts";

type Db = DatabaseType.Database;

export interface PaperTraderState {
  /** The durable intent: the desk should be running, including after a restart. */
  enabled: boolean;
  ownerUserId: number | null;
  accountId: number | null;
  /** The capital the arena account was actually opened with. */
  accountCapital: number | null;
  callbackOrigin: string;
  /** The normalized settings pinned when this desk was started. */
  runSettings: PaperTraderSettings | null;
  startedAt: string | null;
  /** When the arena last asked for a decision — its trading loop's pulse. */
  lastCycleAt: string | null;
  lastError: string;
}

export type DecisionState = "pending" | "ready" | "used" | "failed";

export interface DecisionRecord {
  id: number;
  symbol: string;
  state: DecisionState;
  rating: string;
  /** The arena-shaped decision object, or null while it is still being worked out. */
  decision: Record<string, unknown> | null;
  reasoning: string;
  error: string;
  requestedAt: string;
  settledAt: string | null;
}

interface StateRow {
  enabled: number;
  owner_user_id: number | null;
  account_id: number | null;
  account_capital: number | null;
  callback_origin: string;
  run_settings_json: string;
  started_at: string | null;
  last_cycle_at: string | null;
  last_error: string;
}

/** One adviser's standing opinion. */
export interface AdviceRecord {
  seat: string;
  stance: "buy" | "sell" | "hold" | "note" | "abstain";
  note: string;
  error: string;
  /** True while the adviser is being consulted. */
  pending: boolean;
  askedAt: string | null;
  updatedAt: string;
}

interface AdviceRow {
  seat: string;
  stance: string;
  note: string;
  error: string;
  pending: number;
  asked_at: string | null;
  updated_at: string;
}

const STANCES = ["buy", "sell", "hold", "note", "abstain"] as const;

function presentAdvice(row: AdviceRow): AdviceRecord {
  return {
    seat: row.seat,
    stance: (STANCES as readonly string[]).includes(row.stance)
      ? (row.stance as AdviceRecord["stance"])
      : "note",
    note: row.note,
    error: row.error,
    pending: row.pending === 1,
    askedAt: row.asked_at,
    updatedAt: row.updated_at,
  };
}

interface DecisionRow {
  id: number;
  symbol: string;
  state: string;
  rating: string;
  decision: string;
  reasoning: string;
  error: string;
  requested_at: string;
  settled_at: string | null;
}

function presentState(row: StateRow): PaperTraderState {
  let runSettings: PaperTraderSettings | null = null;
  if (row.run_settings_json) {
    try {
      const parsed = JSON.parse(row.run_settings_json) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        runSettings = parsed as PaperTraderSettings;
      }
    } catch {
      // A truncated/corrupt snapshot falls back to the current settings. It is
      // never allowed to make the durable state unreadable.
    }
  }
  return {
    enabled: row.enabled === 1,
    ownerUserId: row.owner_user_id,
    accountId: row.account_id,
    accountCapital: row.account_capital,
    callbackOrigin: row.callback_origin,
    runSettings,
    startedAt: row.started_at,
    lastCycleAt: row.last_cycle_at,
    lastError: row.last_error,
  };
}

function presentDecision(row: DecisionRow): DecisionRecord {
  let decision: Record<string, unknown> | null = null;
  if (row.decision) {
    try {
      const parsed = JSON.parse(row.decision) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        decision = parsed as Record<string, unknown>;
      }
    } catch {
      // A row written by an older shape is not worth failing a read over.
    }
  }
  return {
    id: row.id,
    symbol: row.symbol,
    state: (["pending", "ready", "used", "failed"] as const).includes(row.state as DecisionState)
      ? (row.state as DecisionState)
      : "failed",
    rating: row.rating,
    decision,
    reasoning: row.reasoning,
    error: row.error,
    requestedAt: row.requested_at,
    settledAt: row.settled_at,
  };
}

export class PaperTraderStore {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
    ensurePaperTraderSchema(db);
  }

  state(): PaperTraderState {
    const row = this.db
      .prepare("SELECT * FROM paper_trader_settings WHERE id = 1")
      .get() as StateRow | undefined;
    if (row) return presentState(row);
    this.db.prepare("INSERT OR IGNORE INTO paper_trader_settings (id) VALUES (1)").run();
    return this.state();
  }

  /** Record the intent to run, and who asked for it. */
  markEnabled(input: {
    userId: number;
    callbackOrigin: string;
    settings?: PaperTraderSettings;
  }): PaperTraderState {
    this.db
      .prepare(
        `UPDATE paper_trader_settings
            SET enabled = 1, owner_user_id = ?, callback_origin = ?, run_settings_json = ?,
                started_at = datetime('now'), last_error = '', updated_at = datetime('now')
          WHERE id = 1`,
      )
      .run(input.userId, input.callbackOrigin, input.settings ? JSON.stringify(input.settings) : "");
    return this.state();
  }

  markDisabled(): PaperTraderState {
    this.db
      .prepare(
        `UPDATE paper_trader_settings
            SET enabled = 0, started_at = NULL, updated_at = datetime('now')
          WHERE id = 1`,
      )
      .run();
    return this.state();
  }

  recordAccount(input: { accountId: number; capital: number }): PaperTraderState {
    this.db
      .prepare(
        `UPDATE paper_trader_settings
            SET account_id = ?, account_capital = ?, updated_at = datetime('now')
          WHERE id = 1`,
      )
      .run(input.accountId, input.capital);
    return this.state();
  }

  /**
   * Stamp the arena's trading loop as alive.
   *
   * Called from the decision endpoint, which is the only thing the loop itself
   * reaches. Nothing else may write it: the value is trustworthy precisely
   * because it can only be set by the loop actually running.
   */
  recordCycle(): void {
    this.db
      .prepare(
        "UPDATE paper_trader_settings SET last_cycle_at = datetime('now') WHERE id = 1",
      )
      .run();
  }

  recordError(message: string): PaperTraderState {
    this.db
      .prepare(
        `UPDATE paper_trader_settings
            SET last_error = ?, updated_at = datetime('now')
          WHERE id = 1`,
      )
      .run(message.slice(0, 2_000));
    return this.state();
  }

  // ---- decisions -----------------------------------------------------------

  /**
   * Start one analysis, unless one is already running. Returns the new row's id,
   * or null when a `pending` row already exists — which is the signal to the
   * caller that this cycle has nothing to start.
   */
  claimAnalysis(symbol: string): number | null {
    const inFlight = this.db
      .prepare("SELECT id FROM paper_trader_decisions WHERE state = 'pending' LIMIT 1")
      .get() as { id: number } | undefined;
    if (inFlight) return null;
    const result = this.db
      .prepare("INSERT INTO paper_trader_decisions (symbol, state) VALUES (?, 'pending')")
      .run(symbol.toUpperCase());
    return Number(result.lastInsertRowid);
  }

  /**
   * Claim work only while the durable desk intent is enabled.
   *
   * The decision route may have begun just before Stop. Keeping the enabled
   * check and insert in one SQLite statement prevents that old request from
   * starting fresh model work after Stop has already cancelled the desk.
   */
  claimAnalysisIfEnabled(symbol: string): number | null {
    const result = this.db
      .prepare(
        `INSERT INTO paper_trader_decisions (symbol, state)
         SELECT ?, 'pending'
          WHERE EXISTS (
            SELECT 1 FROM paper_trader_settings WHERE id = 1 AND enabled = 1
          )
            AND NOT EXISTS (
              SELECT 1 FROM paper_trader_decisions WHERE state = 'pending'
            )`,
      )
      .run(symbol.toUpperCase());
    return result.changes === 1 ? Number(result.lastInsertRowid) : null;
  }

  settleAnalysis(input: {
    id: number;
    rating: string;
    decision: Record<string, unknown>;
    reasoning: string;
  }): void {
    this.db
      .prepare(
        `UPDATE paper_trader_decisions
            SET state = 'ready', rating = ?, decision = ?, reasoning = ?,
                settled_at = datetime('now')
          WHERE id = ? AND state = 'pending'`,
      )
      .run(
        input.rating.slice(0, 40),
        JSON.stringify(input.decision),
        input.reasoning.slice(0, 8_000),
        input.id,
      );
  }

  failAnalysis(id: number, error: string): void {
    this.db
      .prepare(
        `UPDATE paper_trader_decisions
            SET state = 'failed', error = ?, settled_at = datetime('now')
          WHERE id = ? AND state = 'pending'`,
      )
      .run(error.slice(0, 2_000), id);
  }

  /** Prevent work prepared by a stopped desk from being traded after a restart. */
  failUnservedAnalyses(error: string): number {
    const result = this.db
      .prepare(
        `UPDATE paper_trader_decisions
            SET state = 'failed', error = ?, settled_at = datetime('now')
          WHERE state IN ('pending', 'ready')`,
      )
      .run(error.slice(0, 2_000));
    return result.changes;
  }

  /**
   * Hand out the oldest prepared decision and mark it used in the same
   * statement. Returns null when there is nothing ready.
   */
  takeReadyDecision(): DecisionRecord | null {
    const row = this.db
      .prepare(
        `UPDATE paper_trader_decisions
            SET state = 'used'
          WHERE id = (
            SELECT id FROM paper_trader_decisions WHERE state = 'ready' ORDER BY id LIMIT 1
          )
          RETURNING *`,
      )
      .get() as DecisionRow | undefined;
    return row ? presentDecision(row) : null;
  }

  /**
   * Record what was actually served for a verdict. The order is worked out at
   * serve time, against the position as it stands then, so it is not known when
   * the analysis settles — but it is the only thing that explains, afterwards,
   * why a BUY became a close or nothing at all.
   */
  recordServedDecision(id: number, decision: Record<string, unknown>): void {
    this.db
      .prepare("UPDATE paper_trader_decisions SET decision = ? WHERE id = ?")
      .run(JSON.stringify(decision), id);
  }

  /** The analysis currently in flight, if there is one. */
  pendingDecision(): DecisionRecord | null {
    const row = this.db
      .prepare("SELECT * FROM paper_trader_decisions WHERE state = 'pending' ORDER BY id LIMIT 1")
      .get() as DecisionRow | undefined;
    return row ? presentDecision(row) : null;
  }

  recentDecisions(limit = 12): DecisionRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM paper_trader_decisions ORDER BY id DESC LIMIT ?")
      .all(Math.max(1, Math.min(limit, 100))) as DecisionRow[];
    return rows.map(presentDecision);
  }

  /**
   * The symbols analysed most recently, newest first. The rotation reads this to
   * pick whatever has been waiting longest.
   */
  recentlyAnalysedSymbols(limit = 24): string[] {
    const rows = this.db
      .prepare("SELECT symbol FROM paper_trader_decisions ORDER BY id DESC LIMIT ?")
      .all(Math.max(1, Math.min(limit, 200))) as { symbol: string }[];
    return rows.map((row) => row.symbol);
  }

  /** Abandon an analysis that outlived the process that was running it. */
  failStaleAnalyses(olderThanMinutes: number): number {
    const result = this.db
      .prepare(
        `UPDATE paper_trader_decisions
            SET state = 'failed', error = 'The analysis did not finish before the app restarted.',
                settled_at = datetime('now')
          WHERE state = 'pending'
            AND requested_at < datetime('now', ?)`,
      )
      .run(`-${Math.max(1, Math.trunc(olderThanMinutes))} minutes`);
    return result.changes;
  }

  /** Forget every decision. Used when the desk is reset onto fresh capital. */
  clearDecisions(): void {
    this.db.prepare("DELETE FROM paper_trader_decisions").run();
    this.db.prepare("DELETE FROM paper_trader_advice").run();
  }

  // ---- the advisers' noticeboard --------------------------------------------

  advice(): AdviceRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM paper_trader_advice ORDER BY seat")
      .all() as AdviceRow[];
    return rows.map(presentAdvice);
  }

  adviceFor(seat: string): AdviceRecord | null {
    const row = this.db
      .prepare("SELECT * FROM paper_trader_advice WHERE seat = ?")
      .get(seat) as AdviceRow | undefined;
    return row ? presentAdvice(row) : null;
  }

  /**
   * Take the right to consult a seat, if its note is stale and nobody else is
   * already asking. Returns false when this cycle should use what is on the
   * board instead.
   */
  claimAdvice(seat: string, maxAgeMinutes: number): boolean {
    const claimed = this.db
      .prepare(
        `INSERT INTO paper_trader_advice (seat, pending, asked_at, updated_at)
              VALUES (?, 1, datetime('now'), datetime('now'))
         ON CONFLICT(seat) DO UPDATE
              SET pending = 1, error = '',
                  asked_at = datetime('now'), updated_at = datetime('now')
            WHERE paper_trader_advice.pending = 0
              AND (paper_trader_advice.updated_at IS NULL
                   OR paper_trader_advice.updated_at < datetime('now', ?)
                   OR (paper_trader_advice.error <> ''
                       AND paper_trader_advice.updated_at < datetime('now', '-1 minute')))`,
      )
      .run(seat, `-${Math.max(1, Math.trunc(maxAgeMinutes))} minutes`);
    return claimed.changes > 0;
  }

  recordAdvice(input: { seat: string; stance: string; note: string }): void {
    this.db
      .prepare(
        `UPDATE paper_trader_advice
            SET stance = ?, note = ?, error = '', pending = 0, updated_at = datetime('now')
          WHERE seat = ?`,
      )
      .run(input.stance, input.note.slice(0, 4_000), input.seat);
  }

  failAdvice(seat: string, error: string): void {
    this.db
      .prepare(
        `UPDATE paper_trader_advice
            SET stance = 'abstain', error = ?, pending = 0, updated_at = datetime('now')
          WHERE seat = ?`,
      )
      .run(error.slice(0, 1_000), seat);
  }

  /** Release a seat left mid-consultation by a process that ended. */
  releaseStaleAdvice(olderThanMinutes: number): number {
    return this.db
      .prepare(
        `UPDATE paper_trader_advice
            SET pending = 0, stance = 'abstain',
                error = 'The adviser did not answer before the app restarted.'
          WHERE pending = 1 AND asked_at < datetime('now', ?)`,
      )
      .run(`-${Math.max(1, Math.trunc(olderThanMinutes))} minutes`).changes;
  }
}
