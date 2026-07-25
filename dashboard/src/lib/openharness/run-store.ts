import { randomUUID } from "node:crypto";
import db from "../db.ts";

export type RuntimeRunStatus = "active" | "completed" | "cancelled" | "error";

export interface RuntimeRunRow {
  id: string;
  runtime_session_id: number;
  instruction: string;
  status: RuntimeRunStatus;
  dispatch_json: string;
  started_at: string;
  finished_at: string | null;
}

export interface RuntimeRunDispatch {
  conversationPublicId?: string;
  clientMessageId?: string;
  runtimeText?: string;
  model?: { providerID: string; modelID: string };
  variant?: string;
  system?: string;
  tools?: Record<string, boolean>;
}

export interface SteerRequestRow {
  id: number;
  runtime_session_id: number;
  run_id: string;
  client_request_id: string;
  content: string;
  status: "pending" | "accepted" | "failed";
  error_code: string | null;
  result_run_id: string | null;
  result_mode: "steer" | "follow_up" | null;
  created_at: string;
  accepted_at: string | null;
}

export function beginRuntimeRun(input: {
  runtimeSessionId: number;
  instruction: string;
  dispatch: RuntimeRunDispatch;
  now?: Date;
}): RuntimeRunRow {
  const id = randomUUID();
  const startedAt = (input.now ?? new Date()).toISOString();
  db.prepare(
    `INSERT INTO openharness_runs
       (id, runtime_session_id, instruction, status, dispatch_json, started_at)
     VALUES (?, ?, ?, 'active', ?, ?)`,
  ).run(
    id,
    input.runtimeSessionId,
    input.instruction,
    JSON.stringify(input.dispatch),
    startedAt,
  );
  return getRuntimeRun(id)!;
}

export function getRuntimeRun(id: string): RuntimeRunRow | null {
  const row = db
    .prepare("SELECT * FROM openharness_runs WHERE id = ?")
    .get(id) as RuntimeRunRow | undefined;
  return row ?? null;
}

export function getActiveRuntimeRun(
  runtimeSessionId: number,
): RuntimeRunRow | null {
  const row = db
    .prepare(
      `SELECT * FROM openharness_runs
       WHERE runtime_session_id = ? AND status = 'active'
       ORDER BY started_at DESC LIMIT 1`,
    )
    .get(runtimeSessionId) as RuntimeRunRow | undefined;
  return row ?? null;
}

export function getLatestRuntimeRun(
  runtimeSessionId: number,
): RuntimeRunRow | null {
  const row = db
    .prepare(
      `SELECT * FROM openharness_runs
       WHERE runtime_session_id = ?
       ORDER BY started_at DESC LIMIT 1`,
    )
    .get(runtimeSessionId) as RuntimeRunRow | undefined;
  return row ?? null;
}

export function finishRuntimeRun(
  id: string,
  status: Exclude<RuntimeRunStatus, "active">,
  now = new Date(),
): boolean {
  const result = db
    .prepare(
      `UPDATE openharness_runs
       SET status = ?, finished_at = ?
       WHERE id = ? AND status = 'active'`,
    )
    .run(status, now.toISOString(), id);
  return result.changes > 0;
}

export function finishActiveRuntimeRun(
  runtimeSessionId: number,
  status: Exclude<RuntimeRunStatus, "active">,
  now = new Date(),
): RuntimeRunRow | null {
  const active = getActiveRuntimeRun(runtimeSessionId);
  if (!active) return null;
  finishRuntimeRun(active.id, status, now);
  return getRuntimeRun(active.id);
}

export function parseRuntimeRunDispatch(
  run: RuntimeRunRow,
): RuntimeRunDispatch {
  try {
    const parsed = JSON.parse(run.dispatch_json) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as RuntimeRunDispatch)
      : {};
  } catch {
    return {};
  }
}

export function reserveSteerRequest(input: {
  runtimeSessionId: number;
  runId: string;
  clientRequestId: string;
  content: string;
  now?: Date;
}): { request: SteerRequestRow; created: boolean } {
  const reserve = db.transaction(() => {
    const existing = db
      .prepare(
        `SELECT * FROM openharness_steer_requests
         WHERE runtime_session_id = ? AND client_request_id = ?`,
      )
      .get(input.runtimeSessionId, input.clientRequestId) as
      | SteerRequestRow
      | undefined;
    if (existing) return { request: existing, created: false };

    const result = db
      .prepare(
        `INSERT INTO openharness_steer_requests
           (runtime_session_id, run_id, client_request_id, content, status, created_at)
         VALUES (?, ?, ?, ?, 'pending', ?)`,
      )
      .run(
        input.runtimeSessionId,
        input.runId,
        input.clientRequestId,
        input.content,
        (input.now ?? new Date()).toISOString(),
      );
    const request = db
      .prepare("SELECT * FROM openharness_steer_requests WHERE id = ?")
      .get(Number(result.lastInsertRowid)) as SteerRequestRow;
    return { request, created: true };
  });
  return reserve();
}

/**
 * Persist the accepted course correction and its visible user-history entry in
 * one transaction. The conditional status update guarantees exactly one
 * transcript append even if an acknowledgement is retried.
 */
export function acceptSteerRequest(input: {
  requestId: number;
  runtimeSessionId: number;
  chatSessionId: number | null;
  content: string;
  resultRunId: string;
  resultMode: "steer" | "follow_up";
  now?: Date;
}): boolean {
  const accept = db.transaction(() => {
    const result = db
      .prepare(
        `UPDATE openharness_steer_requests
         SET status = 'accepted', accepted_at = ?, error_code = NULL,
             result_run_id = ?, result_mode = ?
         WHERE id = ? AND runtime_session_id = ? AND status = 'pending'`,
      )
      .run(
        (input.now ?? new Date()).toISOString(),
        input.resultRunId,
        input.resultMode,
        input.requestId,
        input.runtimeSessionId,
      );
    if (result.changes === 0) return false;

    if (input.chatSessionId) {
      const next = db
        .prepare(
          "SELECT COALESCE(MAX(order_index) + 1, 0) AS value FROM chat_messages WHERE session_id = ?",
        )
        .get(input.chatSessionId) as { value: number };
      db.prepare(
        `INSERT INTO chat_messages (session_id, role, content, order_index)
         VALUES (?, 'user', ?, ?)`,
      ).run(input.chatSessionId, input.content, next.value);
      db.prepare(
        "UPDATE chat_sessions SET updated_at = datetime('now') WHERE id = ?",
      ).run(input.chatSessionId);
    } else {
      const next = db
        .prepare(
          "SELECT COALESCE(MAX(order_index) + 1, 0) AS value FROM openharness_messages WHERE runtime_session_id = ?",
        )
        .get(input.runtimeSessionId) as { value: number };
      db.prepare(
        `INSERT INTO openharness_messages
           (runtime_session_id, role, content, order_index)
         VALUES (?, 'user', ?, ?)`,
      ).run(input.runtimeSessionId, input.content, next.value);
      db.prepare(
        `UPDATE openharness_runtime_sessions
         SET updated_at = datetime('now') WHERE id = ?`,
      ).run(input.runtimeSessionId);
    }
    return true;
  });
  return accept();
}

export function failSteerRequest(
  requestId: number,
  errorCode: string,
): void {
  db.prepare(
    `UPDATE openharness_steer_requests
     SET status = 'failed', error_code = ?
     WHERE id = ? AND status = 'pending'`,
  ).run(errorCode, requestId);
}
