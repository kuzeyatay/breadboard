// Stopping the work a chat still has in flight.
//
// An external agent run is a real process — a spawned child, a browser session,
// a request against a local service — and the only thing that remembers it
// belongs to this chat is the transcript row that launched it. Deleting the
// chat destroys that row, so anything still running has to be stopped *before*
// the delete, or it keeps burning CPU with nothing left that could ever reach
// it again.
//
// Every agent already exposes the same server-side stop its own abort route
// calls, so this file is only two things: the query that finds the running runs
// of one conversation, and the table that maps a run kind to its stop.

import type Database from "better-sqlite3";
import db from "../db.ts";
import {
  parseExternalAgentRun,
  type ExternalAgentRunKind,
} from "./external-agent-runs.ts";

export interface RunningExternalAgentRun {
  messageId: number;
  kind: ExternalAgentRunKind;
  runId: string;
}

export interface ExternalAgentCancelResult {
  kind: ExternalAgentRunKind;
  runId: string;
  /** False when the run had already finished, or its manager no longer holds it. */
  stopped: boolean;
}

/**
 * The stop each run kind answers, keyed the same way the abort routes are.
 *
 * `satisfies Record<ExternalAgentRunKind, ...>` is the point: a new agent does
 * not compile until it says how it is stopped, so it cannot ship a run that
 * survives its own chat being deleted. The imports are dynamic because a chat
 * delete must not drag all thirty-one agent stacks into memory to remove a
 * conversation that never ran one.
 */
const EXTERNAL_AGENT_ABORT_BY_KIND = {
  agent_tars: async (userId, runId) =>
    (await import("../ui-tars/service.ts")).abort(userId, runId),
  agent_browser: async (userId, runId) =>
    (await import("../agent-browser/run-manager.ts")).abortRun(userId, runId),
  agent_reach: async (userId, runId) =>
    (await import("../agent-reach/run-manager.ts")).abortRun(userId, runId),
  career_ops: async (userId, runId) =>
    (await import("../career-ops/run-manager.ts")).abortRun(userId, runId),
  trading_agents: async (userId, runId) =>
    (await import("../tradingagents/run-manager.ts")).abortRun(userId, runId),
  vibe_trading: async (userId, runId) =>
    (await import("../vibe-trading/run-manager.ts")).abortRun(userId, runId),
  stock_analyst: async (userId, runId) =>
    (await import("../stock-analyst/run-manager.ts")).abortRun(userId, runId),
  paper_trader: async (userId, runId) =>
    (await import("../paper-trader/run-manager.ts")).abortRun(userId, runId),
  deer_flow: async (userId, runId) =>
    (await import("../deer-flow/run-manager.ts")).abortRun(userId, runId),
  deep_research: async (userId, runId) =>
    (await import("../deep-research/service.ts")).abortRun(userId, runId),
  get_doc: async (userId, runId) =>
    (await import("../get-doc/run-manager.ts")).abortRun(userId, runId),
  meeting_notes: async (userId, runId) =>
    (await import("../meeting-notes/run-manager.ts")).abortRun(userId, runId),
  deep_tutor: async (userId, runId) =>
    (await import("../deep-tutor/run-manager.ts")).abortRun(userId, runId),
  openplanter: async (userId, runId) =>
    (await import("../openplanter/run-manager.ts")).abortRun(userId, runId),
  openwork: async (userId, runId) =>
    (await import("../openwork/run-manager.ts")).abortRun(userId, runId),
  openscience: async (userId, runId) =>
    (await import("../openscience/run-manager.ts")).abortRun(userId, runId),
  inbox_zero: async (userId, runId) =>
    (await import("../inbox-zero/run-manager.ts")).abortRun(userId, runId),
  codex: async (userId, runId) =>
    (await import("../codex/run-manager.ts")).abortRun(userId, runId),
  opencode: async (userId, runId) =>
    (await import("../opencode/run-manager.ts")).abortRun(userId, runId),
  ruflo: async (userId, runId) =>
    (await import("../ruflo/run-manager.ts")).abortRun(userId, runId),
  socials_manager: async (userId, runId) =>
    (await import("../socials-manager/run-manager.ts")).abortRun(userId, runId),
  hardware_blueprint: async (userId, runId) =>
    (await import("../hardware/run-manager.ts")).abortRun(userId, runId),
  parametric_cad: async (userId, runId) =>
    (await import("../cad/run-manager.ts")).abortRun(userId, runId),
  hyperframes: async (userId, runId) =>
    (await import("../hyperframes/run-manager.ts")).abortRun(userId, runId),
  resource2skill: async (userId, runId) =>
    (await import("../resource2skill/run-manager.ts")).abortRun(userId, runId),
  openmontage: async (userId, runId) =>
    (await import("../openmontage/run-manager.ts")).abortRun(userId, runId),
  vimax: async (userId, runId) =>
    (await import("../vimax/run-manager.ts")).abortRun(userId, runId),
  vox_director: async (userId, runId) =>
    (await import("../vox-director/run-manager.ts")).abortRun(userId, runId),
  shorts: async (userId, runId) =>
    (await import("../shorts/run-manager.ts")).abortRun(userId, runId),
  // Formsmith runs on shaper, and its stop is the one that is not named abortRun.
  formsmith: async (userId, runId) =>
    (await import("../shaper/run-manager.ts")).abortFormsmithRun(userId, runId),
  money_printer: async (userId, runId) =>
    (await import("../money-printer/run-manager.ts")).abortRun(userId, runId),
  video_use: async (userId, runId) =>
    (await import("../video-use/run-manager.ts")).abortRun(userId, runId),
  legal_agent: async (userId, runId) =>
    (await import("../legal/run-manager.ts")).abortRun(userId, runId),
  wardrobe: async (userId, runId) =>
    (await import("../wardrobe/run-manager.ts")).abortRun(userId, runId),
} as const satisfies Record<
  ExternalAgentRunKind,
  (userId: number, runId: string) => Promise<unknown>
>;

/**
 * The runs this conversation launched and has not seen finish.
 *
 * `externalAgentOutcome` is the same marker the history list reads to show a
 * chat as busy, so this finds exactly the runs the person can see are still
 * going. A stale 'running' costs nothing: the stop below is a no-op for a run
 * its manager has already retired.
 */
export function listRunningExternalAgentRuns(
  conversationId: number,
  database: Database.Database = db,
): RunningExternalAgentRun[] {
  const rows = database
    .prepare(
      `SELECT id, metadata FROM conversation_messages
       WHERE conversation_id = ?
         AND role = 'assistant'
         AND metadata IS NOT NULL
         AND json_valid(metadata)
         AND json_extract(metadata, '$.externalAgentOutcome') = 'running'
       ORDER BY order_index ASC`,
    )
    .all(conversationId) as Array<{ id: number; metadata: string }>;

  const seen = new Set<string>();
  const running: RunningExternalAgentRun[] = [];
  for (const row of rows) {
    let metadata: Record<string, unknown>;
    try {
      metadata = JSON.parse(row.metadata) as Record<string, unknown>;
    } catch {
      continue;
    }
    const run = parseExternalAgentRun(metadata.externalAgentRun);
    if (!run) continue;
    // A branched or retried turn can carry the same descriptor twice; one stop
    // is enough and the second would only log a run that is already gone.
    const key = `${run.kind}:${run.runId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    running.push({ messageId: row.id, kind: run.kind, runId: run.runId });
  }
  return running;
}

/**
 * Stop one run. A run its manager has already forgotten (`run_not_found`) or
 * has already finished is reported as not stopped rather than thrown: the
 * caller is deleting a chat, and a run that is no longer running is the
 * outcome it wanted anyway.
 */
export async function cancelExternalAgentRun(
  userId: number,
  kind: ExternalAgentRunKind,
  runId: string,
): Promise<boolean> {
  try {
    const result = await EXTERNAL_AGENT_ABORT_BY_KIND[kind](userId, runId);
    // Managers disagree on what they return — a boolean, a run summary, or
    // nothing at all. Only an explicit false means "there was nothing to stop".
    return result !== false;
  } catch {
    return false;
  }
}

/** Stop everything one conversation still has running, in parallel. */
export async function cancelRunningExternalAgentRuns(
  userId: number,
  conversationId: number,
  database: Database.Database = db,
): Promise<ExternalAgentCancelResult[]> {
  const running = listRunningExternalAgentRuns(conversationId, database);
  return Promise.all(
    running.map(async (run) => ({
      kind: run.kind,
      runId: run.runId,
      stopped: await cancelExternalAgentRun(userId, run.kind, run.runId),
    })),
  );
}
