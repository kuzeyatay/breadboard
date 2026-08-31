import "server-only";

// Reading and writing the demonstration side of a workflow.
//
// Deliberately thin: the workflow row itself is still owned by
// lib/workflows/store.ts, and this module only adds the columns and tables that
// demonstration needs. A learned workflow is a workflow first.

import { randomUUID } from "node:crypto";

import db from "../db.ts";
import type {
  DemonstratedProcedure,
  DemonstrationRunEvent,
  DemonstrationRunState,
  DemonstrationRunView,
  TeachSessionState,
  TeachSessionSummary,
} from "./types.ts";

/* ------------------------------------------------------------------ *
 * Demonstrations
 * ------------------------------------------------------------------ */

export interface DemonstrationRow {
  id: string;
  user_id: number;
  workflow_id: string | null;
  reteach_workflow_id: string | null;
  name: string;
  objective: string;
  state: TeachSessionState;
  started_at: string;
  started_epoch_ms: number;
  finished_at: string | null;
  duration_ms: number;
  event_count: number;
  audio_offset_ms: number;
  transcript_available: number;
  frames_available: number;
  recording_retained: number;
  draft: string | null;
  error: string | null;
  updated_at: string;
}

export function createDemonstration(input: {
  userId: number;
  name: string;
  objective?: string;
  reteachWorkflowId?: string | null;
}): DemonstrationRow {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO workflow_demonstrations (id, user_id, name, objective, reteach_workflow_id, state)
     VALUES (?, ?, ?, ?, ?, 'preparing')`,
  ).run(id, input.userId, input.name.slice(0, 200), (input.objective ?? "").slice(0, 2000), input.reteachWorkflowId ?? null);
  return requireDemonstration(input.userId, id);
}

export function getDemonstration(userId: number, id: string): DemonstrationRow | null {
  const row = db
    .prepare(`SELECT * FROM workflow_demonstrations WHERE id = ? AND user_id = ?`)
    .get(id, userId) as DemonstrationRow | undefined;
  return row ?? null;
}

export function requireDemonstration(userId: number, id: string): DemonstrationRow {
  const row = getDemonstration(userId, id);
  if (!row) throw new Error("That teaching session does not exist.");
  return row;
}

export function updateDemonstration(
  userId: number,
  id: string,
  patch: Partial<{
    workflowId: string | null;
    name: string;
    objective: string;
    state: TeachSessionState;
    startedEpochMs: number;
    finishedAt: string | null;
    durationMs: number;
    eventCount: number;
    audioOffsetMs: number;
    transcriptAvailable: boolean;
    framesAvailable: boolean;
    recordingRetained: boolean;
    draft: DemonstratedProcedure | null;
    error: string | null;
  }>,
): void {
  const sets: string[] = [];
  const values: unknown[] = [];
  const set = (column: string, value: unknown): void => {
    sets.push(`${column} = ?`);
    values.push(value);
  };

  if (patch.workflowId !== undefined) set("workflow_id", patch.workflowId);
  if (patch.name !== undefined) set("name", patch.name.slice(0, 200));
  if (patch.objective !== undefined) set("objective", patch.objective.slice(0, 2000));
  if (patch.state !== undefined) set("state", patch.state);
  if (patch.startedEpochMs !== undefined) set("started_epoch_ms", patch.startedEpochMs);
  if (patch.finishedAt !== undefined) set("finished_at", patch.finishedAt);
  if (patch.durationMs !== undefined) set("duration_ms", patch.durationMs);
  if (patch.eventCount !== undefined) set("event_count", patch.eventCount);
  if (patch.audioOffsetMs !== undefined) set("audio_offset_ms", patch.audioOffsetMs);
  if (patch.transcriptAvailable !== undefined) set("transcript_available", patch.transcriptAvailable ? 1 : 0);
  if (patch.framesAvailable !== undefined) set("frames_available", patch.framesAvailable ? 1 : 0);
  if (patch.recordingRetained !== undefined) set("recording_retained", patch.recordingRetained ? 1 : 0);
  if (patch.draft !== undefined) set("draft", patch.draft === null ? null : JSON.stringify(patch.draft));
  if (patch.error !== undefined) set("error", patch.error);
  if (sets.length === 0) return;

  sets.push("updated_at = datetime('now')");
  db.prepare(`UPDATE workflow_demonstrations SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`).run(
    ...values,
    id,
    userId,
  );
}

export function readDraft(row: DemonstrationRow): DemonstratedProcedure | null {
  if (!row.draft) return null;
  try {
    return JSON.parse(row.draft) as DemonstratedProcedure;
  } catch {
    return null;
  }
}

export function summarizeDemonstration(row: DemonstrationRow): TeachSessionSummary {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    name: row.name,
    state: row.state,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
    eventCount: row.event_count,
    transcriptAvailable: row.transcript_available === 1,
    framesAvailable: row.frames_available === 1,
    error: row.error,
    reteachOfWorkflowId: row.reteach_workflow_id,
  };
}

/** Sessions left mid-recording, which a restart has orphaned. */
export function listLiveDemonstrations(): DemonstrationRow[] {
  return db
    .prepare(`SELECT * FROM workflow_demonstrations WHERE state IN ('preparing','recording','paused')`)
    .all() as DemonstrationRow[];
}

/**
 * Sessions whose recording finished but whose analysis did not.
 *
 * Kept separate from the ones above because the answer is different: a
 * half-recorded session is over, but a half-analysed one can simply be analysed
 * again from what is already on disk.
 */
export function listProcessingDemonstrations(): DemonstrationRow[] {
  return db
    .prepare(`SELECT * FROM workflow_demonstrations WHERE state = 'processing'`)
    .all() as DemonstrationRow[];
}

export function listDemonstrationsForWorkflow(userId: number, workflowId: string): DemonstrationRow[] {
  return db
    .prepare(
      `SELECT * FROM workflow_demonstrations
       WHERE user_id = ? AND (workflow_id = ? OR reteach_workflow_id = ?)
       ORDER BY started_at DESC`,
    )
    .all(userId, workflowId, workflowId) as DemonstrationRow[];
}

/* ------------------------------------------------------------------ *
 * Procedures on the workflow row
 * ------------------------------------------------------------------ */

export interface DemonstratedWorkflowRow {
  id: string;
  user_id: number;
  name: string;
  description: string;
  source: string;
  procedure: string | null;
  procedure_version: number;
  created_at: string;
  updated_at: string;
}

export function isDemonstratedWorkflow(userId: number, workflowId: string): boolean {
  const row = db
    .prepare(`SELECT source FROM workflows WHERE id = ? AND user_id = ?`)
    .get(workflowId, userId) as { source?: string } | undefined;
  return row?.source === "demonstration";
}

export function getDemonstratedWorkflow(
  userId: number,
  workflowId: string,
): { row: DemonstratedWorkflowRow; procedure: DemonstratedProcedure } | null {
  const row = db
    .prepare(`SELECT * FROM workflows WHERE id = ? AND user_id = ? AND source = 'demonstration'`)
    .get(workflowId, userId) as DemonstratedWorkflowRow | undefined;
  if (!row || !row.procedure) return null;
  try {
    return { row, procedure: JSON.parse(row.procedure) as DemonstratedProcedure };
  } catch {
    return null;
  }
}

/** The same lookup the runner needs before it knows who is asking. */
export function getDemonstratedWorkflowById(
  workflowId: string,
): { row: DemonstratedWorkflowRow; procedure: DemonstratedProcedure } | null {
  const row = db
    .prepare(`SELECT * FROM workflows WHERE id = ? AND source = 'demonstration'`)
    .get(workflowId) as DemonstratedWorkflowRow | undefined;
  if (!row || !row.procedure) return null;
  try {
    return { row, procedure: JSON.parse(row.procedure) as DemonstratedProcedure };
  } catch {
    return null;
  }
}

/**
 * Save a new version of a workflow's procedure.
 *
 * The version row is written in the same transaction as the workflow update, so
 * a workflow's current procedure is always one that history also records. A
 * re-teach that half-succeeded would otherwise leave the live representation
 * with no version to roll back to.
 */
export function saveProcedureVersion(input: {
  userId: number;
  workflowId: string;
  procedure: DemonstratedProcedure;
  compiledDirectory: string | null;
  demonstrationId: string | null;
  note?: string;
}): number {
  const write = db.transaction((): number => {
    const current = db
      .prepare(`SELECT procedure_version FROM workflows WHERE id = ? AND user_id = ?`)
      .get(input.workflowId, input.userId) as { procedure_version?: number } | undefined;
    if (!current) throw new Error("That workflow does not exist.");
    const version = (current.procedure_version ?? 0) + 1;

    db.prepare(
      `UPDATE workflows
       SET source = 'demonstration',
           procedure = ?,
           procedure_version = ?,
           name = ?,
           description = ?,
           updated_at = datetime('now')
       WHERE id = ? AND user_id = ?`,
    ).run(
      JSON.stringify(input.procedure),
      version,
      input.procedure.name.slice(0, 200),
      (input.procedure.description || input.procedure.goal).slice(0, 2000),
      input.workflowId,
      input.userId,
    );

    db.prepare(
      `INSERT INTO workflow_procedure_versions (id, workflow_id, version, procedure, compiled_dir, demonstration_id, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      input.workflowId,
      version,
      JSON.stringify(input.procedure),
      input.compiledDirectory,
      input.demonstrationId,
      (input.note ?? "").slice(0, 500),
    );

    return version;
  });
  return write();
}

export interface ProcedureVersionRow {
  id: string;
  workflow_id: string;
  version: number;
  procedure: string;
  compiled_dir: string | null;
  demonstration_id: string | null;
  note: string;
  created_at: string;
}

export function listProcedureVersions(workflowId: string): ProcedureVersionRow[] {
  return db
    .prepare(`SELECT * FROM workflow_procedure_versions WHERE workflow_id = ? ORDER BY version DESC`)
    .all(workflowId) as ProcedureVersionRow[];
}

export function getProcedureVersion(workflowId: string, version: number): ProcedureVersionRow | null {
  const row = db
    .prepare(`SELECT * FROM workflow_procedure_versions WHERE workflow_id = ? AND version = ?`)
    .get(workflowId, version) as ProcedureVersionRow | undefined;
  return row ?? null;
}

/* ------------------------------------------------------------------ *
 * Runs
 * ------------------------------------------------------------------ */

export interface RunRow {
  id: string;
  workflow_id: string;
  user_id: number;
  version: number;
  state: DemonstrationRunState;
  inputs: string;
  events: string;
  pending_approval: string | null;
  error: string | null;
  helper_pid: number | null;
  started_at: string;
  finished_at: string | null;
  updated_at: string;
}

export function createRun(input: {
  userId: number;
  workflowId: string;
  version: number;
  inputs: Record<string, string>;
}): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO workflow_demonstration_runs (id, workflow_id, user_id, version, state, inputs)
     VALUES (?, ?, ?, ?, 'queued', ?)`,
  ).run(id, input.workflowId, input.userId, input.version, JSON.stringify(input.inputs));
  return id;
}

export function getRun(userId: number, runId: string): RunRow | null {
  const row = db
    .prepare(`SELECT * FROM workflow_demonstration_runs WHERE id = ? AND user_id = ?`)
    .get(runId, userId) as RunRow | undefined;
  return row ?? null;
}

export function updateRun(
  runId: string,
  patch: Partial<{
    state: DemonstrationRunState;
    events: DemonstrationRunEvent[];
    pendingApproval: DemonstrationRunView["pendingApproval"];
    error: string | null;
    helperPid: number | null;
    finishedAt: string | null;
  }>,
): void {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.state !== undefined) {
    sets.push("state = ?");
    values.push(patch.state);
  }
  if (patch.events !== undefined) {
    sets.push("events = ?");
    values.push(JSON.stringify(patch.events));
  }
  if (patch.pendingApproval !== undefined) {
    sets.push("pending_approval = ?");
    values.push(patch.pendingApproval === null ? null : JSON.stringify(patch.pendingApproval));
  }
  if (patch.error !== undefined) {
    sets.push("error = ?");
    values.push(patch.error);
  }
  if (patch.helperPid !== undefined) {
    sets.push("helper_pid = ?");
    values.push(patch.helperPid);
  }
  if (patch.finishedAt !== undefined) {
    sets.push("finished_at = ?");
    values.push(patch.finishedAt);
  }
  if (sets.length === 0) return;
  sets.push("updated_at = datetime('now')");
  db.prepare(`UPDATE workflow_demonstration_runs SET ${sets.join(", ")} WHERE id = ?`).run(...values, runId);
}

export function runView(row: RunRow): DemonstrationRunView {
  const parse = <T>(value: string | null, fallback: T): T => {
    if (!value) return fallback;
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  };
  return {
    runId: row.id,
    workflowId: row.workflow_id,
    state: row.state,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    inputs: parse<Record<string, string>>(row.inputs, {}),
    events: parse<DemonstrationRunEvent[]>(row.events, []),
    pendingApproval: parse<DemonstrationRunView["pendingApproval"]>(row.pending_approval, null),
    error: row.error,
  };
}

export function listRuns(userId: number, workflowId: string, limit = 20): RunRow[] {
  return db
    .prepare(
      `SELECT * FROM workflow_demonstration_runs
       WHERE user_id = ? AND workflow_id = ?
       ORDER BY started_at DESC LIMIT ?`,
    )
    .all(userId, workflowId, Math.max(1, Math.min(100, limit))) as RunRow[];
}

/** Runs still marked live. After a restart these own nothing and must be closed. */
export function listLiveRuns(): RunRow[] {
  return db
    .prepare(
      `SELECT * FROM workflow_demonstration_runs WHERE state IN ('queued','running','awaiting_approval')`,
    )
    .all() as RunRow[];
}
