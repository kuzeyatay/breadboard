import { randomUUID } from "node:crypto";
import db from "../db.ts";
import { isRuntimeRunAbandoned } from "./run-liveness.ts";

export type RuntimeRunStatus = "active" | "completed" | "cancelled" | "error";

export interface RuntimeRunRow {
  id: string;
  runtime_session_id: number;
  instruction: string;
  status: RuntimeRunStatus;
  dispatch_json: string;
  started_at: string;
  finished_at: string | null;
  /** Last time the pump driving this run proved it was still alive. */
  heartbeat_at: string | null;
}

export interface RuntimeArtifactRequirement {
  kind: string;
  rendererId: string;
  sourceSkill: string;
  readyEventType: string;
  previewRequired?: boolean;
}

export interface RuntimeRunDispatch {
  conversationPublicId?: string;
  clientMessageId?: string;
  runtimeText?: string;
  model?: { providerID: string; modelID: string };
  modelIdentity?: { modelID: string };
  variant?: string;
  system?: string;
  tools?: Record<string, boolean>;
  /** Goal Mode state active for this run; used by the native Goal MCP bridge. */
  goalMode?: {
    goalId: string;
    enabled: true;
  };
  /** Durable products that must exist before this run may report completion. */
  requiredArtifacts?: RuntimeArtifactRequirement[];
  /** Written only after the runtime acknowledges prompt submission. */
  submittedAt?: string;
  gardenGrounding?: {
    attempted: boolean;
    sources: Array<{
      title: string;
      gardenName: string;
      gardenSlug: string;
      pageSlug: string;
      pageRelPath: string;
      location: string;
      heading?: string;
      sourceFile?: string;
      evidenceAnchors: string[];
      locations: string[];
    }>;
    lexicalUsed?: boolean;
    semanticUsed?: boolean;
    warning?: string;
  };
  /**
   * Breadboard's own decision, made before dispatch, that this turn needs
   * verified map data. It is recorded on the run rather than recomputed at
   * finalize so the answer cannot influence whether it was required.
   */
  geographicGrounding?: {
    required: boolean;
    asks: string[];
    reason: string;
  };
  /** The task plan classified this turn as requiring current web evidence. */
  webGrounding?: {
    required: boolean;
    reason: string;
  };
  /**
   * The research classifier read this request as exhaustive enough to owe the
   * tracked pipeline. Recorded here so the turn's honesty gate stays armed even
   * if the turn never opened a session. See lib/research/classify.ts.
   */
  researchPipeline?: {
    required: boolean;
    intent: string;
    completenessRequired: boolean;
  };
}

export interface ActiveRuntimeRunSummary {
  id: string;
  conversationId: string;
  conversationTitle: string;
  instruction: string;
  surface: string;
  gardenId: string | null;
  pageSlug: string | null;
  startedAt: string;
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
    `INSERT INTO hermes_runs
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
    .prepare("SELECT * FROM hermes_runs WHERE id = ?")
    .get(id) as RuntimeRunRow | undefined;
  return row ?? null;
}

export function getActiveRuntimeRun(
  runtimeSessionId: number,
): RuntimeRunRow | null {
  const row = db
    .prepare(
      `SELECT * FROM hermes_runs
       WHERE runtime_session_id = ? AND status = 'active'
       ORDER BY started_at DESC LIMIT 1`,
    )
    .get(runtimeSessionId) as RuntimeRunRow | undefined;
  return row ?? null;
}

/**
 * All live chat turns owned by one user, in one bounded query. The Processes
 * overview polls this list, so it must not perform one runtime lookup per chat.
 */
export function listActiveRuntimeRunsForUser(
  userId: number,
  limit = 100,
): ActiveRuntimeRunSummary[] {
  const boundedLimit = Math.max(1, Math.min(250, Math.floor(limit)));
  const rows = db.prepare(`
    SELECT r.id,
           r.instruction,
           r.started_at,
           r.heartbeat_at,
           c.public_id AS conversation_public_id,
           c.title AS conversation_title,
           s.surface,
           s.garden_id,
           s.page_slug
      FROM hermes_runs r
      JOIN hermes_runtime_sessions s ON s.id = r.runtime_session_id
      JOIN conversations c ON c.id = s.conversation_id
     WHERE r.status = 'active'
       AND c.user_id = ?
     ORDER BY COALESCE(r.heartbeat_at, r.started_at) DESC, r.id DESC
     LIMIT ?
  `).all(userId, boundedLimit) as Array<{
    id: string;
    instruction: string;
    started_at: string;
    heartbeat_at: string | null;
    conversation_public_id: string;
    conversation_title: string;
    surface: string;
    garden_id: string | null;
    page_slug: string | null;
  }>;
  const now = Date.now();
  return rows
    .filter((row) => !isRuntimeRunAbandoned(row, now))
    .map((row) => ({
      id: row.id,
      conversationId: row.conversation_public_id,
      conversationTitle: row.conversation_title,
      instruction: row.instruction,
      surface: row.surface,
      gardenId: row.garden_id,
      pageSlug: row.page_slug,
      startedAt: row.started_at,
    }));
}

export function getLatestRuntimeRun(
  runtimeSessionId: number,
): RuntimeRunRow | null {
  const row = db
    .prepare(
      `SELECT * FROM hermes_runs
       WHERE runtime_session_id = ?
       ORDER BY started_at DESC LIMIT 1`,
    )
    .get(runtimeSessionId) as RuntimeRunRow | undefined;
  return row ?? null;
}

/**
 * Refresh the driving pump's claim on a run. Only an active run can be claimed,
 * so a beat that lands after the turn was finalized is a no-op rather than a
 * resurrection.
 */
export function touchRuntimeRunHeartbeat(id: string, now = new Date()): boolean {
  const result = db
    .prepare(
      `UPDATE hermes_runs SET heartbeat_at = ?
       WHERE id = ? AND status = 'active'`,
    )
    .run(now.toISOString(), id);
  return result.changes > 0;
}

/**
 * Active runs nobody is driving any more. At most one row per runtime session
 * can be active, so this list is short and the staleness rule stays in one
 * place rather than being duplicated into SQL.
 */
export function listAbandonedRuntimeRuns(now = Date.now()): RuntimeRunRow[] {
  const rows = db
    .prepare(
      `SELECT * FROM hermes_runs WHERE status = 'active' ORDER BY started_at ASC`,
    )
    .all() as RuntimeRunRow[];
  return rows.filter((row) => isRuntimeRunAbandoned(row, now));
}

export function finishRuntimeRun(
  id: string,
  status: Exclude<RuntimeRunStatus, "active">,
  now = new Date(),
): boolean {
  const result = db
    .prepare(
      `UPDATE hermes_runs
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

/**
 * Record the boundary between a reserved run and a prompt Hermes accepted.
 * The event stream is opened before dispatch, so `status = active` alone does
 * not prove that transcript recovery belongs to this run.
 */
export function markRuntimeRunSubmitted(
  id: string,
  now = new Date(),
): boolean {
  const mark = db.transaction(() => {
    const run = getRuntimeRun(id);
    if (!run) return false;
    const dispatch = parseRuntimeRunDispatch(run);
    if (dispatch.submittedAt) return false;
    const result = db.prepare(
      "UPDATE hermes_runs SET dispatch_json = ? WHERE id = ?",
    ).run(
      JSON.stringify({ ...dispatch, submittedAt: now.toISOString() }),
      id,
    );
    return result.changes > 0;
  });
  return mark();
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
        `SELECT * FROM hermes_steer_requests
         WHERE runtime_session_id = ? AND client_request_id = ?`,
      )
      .get(input.runtimeSessionId, input.clientRequestId) as
      | SteerRequestRow
      | undefined;
    if (existing) return { request: existing, created: false };

    const result = db
      .prepare(
        `INSERT INTO hermes_steer_requests
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
      .prepare("SELECT * FROM hermes_steer_requests WHERE id = ?")
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
        `UPDATE hermes_steer_requests
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
          "SELECT COALESCE(MAX(order_index) + 1, 0) AS value FROM hermes_messages WHERE runtime_session_id = ?",
        )
        .get(input.runtimeSessionId) as { value: number };
      db.prepare(
        `INSERT INTO hermes_messages
           (runtime_session_id, role, content, order_index)
         VALUES (?, 'user', ?, ?)`,
      ).run(input.runtimeSessionId, input.content, next.value);
      db.prepare(
        `UPDATE hermes_runtime_sessions
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
    `UPDATE hermes_steer_requests
     SET status = 'failed', error_code = ?
     WHERE id = ? AND status = 'pending'`,
  ).run(errorCode, requestId);
}
