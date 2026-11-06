import type Database from "better-sqlite3";
import { isRuntimeRunAbandoned } from "./run-liveness.ts";

export interface RuntimeClarification {
  requestId: string;
  question: string;
  choices: string[];
}

export interface ChatRuntimeControl {
  sessionId: number;
  runId: string;
  pendingClarification: RuntimeClarification | null;
}

/** Read controls independently of the viewer that originally started the turn. */
export function readChatRuntimeControl(database: Database.Database, chatSessionId: number): ChatRuntimeControl | null {
  const run = database.prepare(`
    SELECT r.id, r.runtime_session_id, r.dispatch_json, r.started_at, r.heartbeat_at
    FROM hermes_runs r JOIN hermes_runtime_sessions s ON s.id = r.runtime_session_id
    WHERE s.chat_session_id = ? AND r.status = 'active'
    ORDER BY r.started_at DESC LIMIT 1
  `).get(chatSessionId) as {
    id: string; runtime_session_id: number; dispatch_json: string;
    started_at: string; heartbeat_at: string | null;
  } | undefined;
  if (!run || isRuntimeRunAbandoned(run)) return null;
  let pendingClarification: RuntimeClarification | null = null;
  let dispatch: Record<string, unknown> = {};
  try { dispatch = JSON.parse(run.dispatch_json) ?? {}; } catch { /* older run */ }
  const pending = dispatch.pendingClarification as Partial<RuntimeClarification> | null | undefined;
  if (pending && typeof pending.requestId === "string" && typeof pending.question === "string") {
    pendingClarification = { requestId: pending.requestId, question: pending.question,
      choices: Array.isArray(pending.choices) ? pending.choices.filter((choice): choice is string => typeof choice === "string") : [] };
  } else if (pending === undefined && database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'chat_question_notifications'",
  ).get()) {
    // Recover questions raised before structured control snapshots existed.
    // A read/dismissed notification is still a question awaiting an answer.
    const question = database.prepare(`SELECT request_id, question FROM chat_question_notifications
      WHERE runtime_session_id = ? AND run_id = ? AND resolved = 0 ORDER BY id DESC LIMIT 1
    `).get(run.runtime_session_id, run.id) as { request_id: string; question: string } | undefined;
    if (question) pendingClarification = { requestId: question.request_id, question: question.question, choices: [] };
  }
  return { sessionId: run.runtime_session_id, runId: run.id, pendingClarification };
}

export function saveRuntimeClarification(database: Database.Database, input: RuntimeClarification & {
  runtimeSessionId: number; runId: string;
}): void {
  // Patch just this field: progress and other workers update dispatch metadata too.
  database.prepare(`UPDATE hermes_runs SET dispatch_json = json_set(
    CASE WHEN json_valid(dispatch_json) THEN dispatch_json ELSE '{}' END,
    '$.pendingClarification', json(?))
    WHERE id = ? AND runtime_session_id = ? AND status = 'active'
  `).run(JSON.stringify({ requestId: input.requestId, question: input.question, choices: input.choices }), input.runId, input.runtimeSessionId);
}

export function clearRuntimeClarification(database: Database.Database, runtimeSessionId: number, requestId: string): void {
  database.prepare(`UPDATE hermes_runs SET dispatch_json = json_set(dispatch_json, '$.pendingClarification', NULL)
    WHERE runtime_session_id = ? AND status = 'active' AND json_valid(dispatch_json)
      AND json_extract(dispatch_json, '$.pendingClarification.requestId') = ?
  `).run(runtimeSessionId, requestId);
}
