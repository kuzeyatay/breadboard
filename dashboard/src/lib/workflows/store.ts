// CRUD over the saved workflow graphs. The canvas persists `state` verbatim
// (sim's editor-state shape); nothing here interprets it beyond counting blocks
// for the list summary, so the editor and the executor can evolve their shared
// format without a migration here.

import { randomUUID } from "node:crypto";

import db from "@/lib/db";
import { removeDirectory, workflowDirectory } from "@/lib/teach/artifacts";
import type { LocalWorkflowSummary } from "@/lib/workflows/types";

export type WorkflowRow = {
  id: string;
  user_id: number;
  name: string;
  description: string;
  state: string;
  created_at: string;
  updated_at: string;
  // Added when workflows became authorable by demonstration as well as on the
  // canvas. Older rows predate the column and default to 'canvas'.
  source?: string | null;
  procedure?: string | null;
  procedure_version?: number | null;
};

/** How a workflow was authored. The canvas and the teaching flow both end here. */
export type WorkflowSource = "canvas" | "demonstration";

export type WorkflowRecord = {
  id: string;
  name: string;
  description: string;
  state: unknown;
  updatedAt: string;
  source: WorkflowSource;
  /** The learned procedure, for a workflow taught by demonstration. */
  procedure: unknown;
  procedureVersion: number;
};

function sourceOf(row: WorkflowRow): WorkflowSource {
  return row.source === "demonstration" ? "demonstration" : "canvas";
}

function procedureOf(row: WorkflowRow): unknown {
  if (!row.procedure) return null;
  try {
    return JSON.parse(row.procedure);
  } catch {
    return null;
  }
}

const EMPTY_STATE = { blocks: {}, edges: [], loops: {}, parallels: {} };

function parseState(raw: string): unknown {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : EMPTY_STATE;
  } catch {
    return EMPTY_STATE;
  }
}

function countBlocks(state: unknown): number {
  const blocks = (state as { blocks?: unknown })?.blocks;
  return blocks && typeof blocks === "object" ? Object.keys(blocks).length : 0;
}

/** The list shape the chat palette, super-agent inventory, and canvas home share. */
export function summarize(
  row: WorkflowRow,
): LocalWorkflowSummary & { description: string; source: WorkflowSource; stepCount: number } {
  const source = sourceOf(row);
  const procedure = source === "demonstration"
    ? (procedureOf(row) as {
        steps?: unknown[];
        inputs?: Array<{
          name?: unknown;
          label?: unknown;
          type?: unknown;
          required?: unknown;
        }>;
      } | null)
    : null;
  const inputs = Array.isArray(procedure?.inputs)
    ? procedure.inputs.flatMap((input) => {
        if (typeof input.name !== "string" || typeof input.label !== "string") return [];
        const type = ["string", "number", "date", "file", "folder"].includes(String(input.type))
          ? input.type as "string" | "number" | "date" | "file" | "folder"
          : "string";
        return [{ name: input.name, label: input.label, type, required: input.required === true }];
      })
    : [];
  return {
    id: row.id,
    name: row.name,
    // A native workflow is always runnable; "active" exists for the n8n-era contract.
    active: true,
    updatedAt: row.updated_at,
    nodeCount: countBlocks(parseState(row.state)),
    description: row.description,
    source,
    // A demonstrated workflow has steps where a canvas workflow has blocks, and
    // the list shows whichever one the workflow actually has.
    stepCount: Array.isArray(procedure?.steps) ? procedure.steps.length : 0,
    inputs,
  };
}

export function listWorkflows(
  userId: number,
): Array<LocalWorkflowSummary & { description: string; source: WorkflowSource; stepCount: number }> {
  const rows = db
    .prepare(`SELECT * FROM workflows WHERE user_id = ? ORDER BY updated_at DESC`)
    .all(userId) as WorkflowRow[];
  return rows.map(summarize);
}

export function getWorkflow(userId: number, id: string): WorkflowRecord | null {
  const row = db
    .prepare(`SELECT * FROM workflows WHERE id = ? AND user_id = ?`)
    .get(id, userId) as WorkflowRow | undefined;
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    state: parseState(row.state),
    updatedAt: row.updated_at,
    source: sourceOf(row),
    procedure: procedureOf(row),
    procedureVersion: row.procedure_version ?? 0,
  };
}

/** Used by the runner, which resolves a workflow before it knows the caller. */
export function getWorkflowById(id: string): (WorkflowRecord & { userId: number }) | null {
  const row = db.prepare(`SELECT * FROM workflows WHERE id = ?`).get(id) as WorkflowRow | undefined;
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    state: parseState(row.state),
    updatedAt: row.updated_at,
    source: sourceOf(row),
    procedure: procedureOf(row),
    procedureVersion: row.procedure_version ?? 0,
  };
}

export function createWorkflow(
  userId: number,
  input: { name?: string; description?: string; state?: unknown },
): WorkflowRecord {
  const id = randomUUID();
  const name = (input.name?.trim() || "Untitled workflow").slice(0, 200);
  const description = (input.description?.trim() ?? "").slice(0, 2000);
  const state = input.state ?? EMPTY_STATE;
  db
    .prepare(
      `INSERT INTO workflows (id, user_id, name, description, state) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, userId, name, description, JSON.stringify(state));
  return {
    id,
    name,
    description,
    state,
    updatedAt: new Date().toISOString(),
    source: "canvas",
    procedure: null,
    procedureVersion: 0,
  };
}

export function updateWorkflow(
  userId: number,
  id: string,
  patch: { name?: string; description?: string; state?: unknown },
): boolean {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (typeof patch.name === "string" && patch.name.trim()) {
    sets.push("name = ?");
    values.push(patch.name.trim().slice(0, 200));
  }
  if (typeof patch.description === "string") {
    sets.push("description = ?");
    values.push(patch.description.slice(0, 2000));
  }
  if (patch.state !== undefined) {
    sets.push("state = ?");
    values.push(JSON.stringify(patch.state));
  }
  if (!sets.length) return true;
  sets.push("updated_at = datetime('now')");
  const result = db
    .prepare(`UPDATE workflows SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`)
    .run(...values, id, userId);
  return result.changes > 0;
}

export function deleteWorkflow(userId: number, id: string): boolean {
  const result = db.prepare(`DELETE FROM workflows WHERE id = ? AND user_id = ?`).run(id, userId);
  if (result.changes === 0) return false;
  // A demonstrated workflow also owns a directory: its compiled representation
  // and any run screenshots. Deleting the row and leaving those behind is how a
  // "deleted" workflow keeps its screenshots on disk forever.
  try {
    removeDirectory(workflowDirectory(id));
  } catch {
    // No directory to remove. The row is gone either way, which is what the
    // caller asked for.
  }
  return true;
}

export function recordRun(input: {
  workflowId: string;
  status: "success" | "error" | "waiting" | "timeout";
  triggerKind: string;
  input?: unknown;
  output?: unknown;
  logs?: unknown;
  error?: string | null;
}): string {
  const id = randomUUID();
  db
    .prepare(
      `INSERT INTO workflow_runs (id, workflow_id, status, trigger_kind, input, output, logs, error, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    )
    .run(
      id,
      input.workflowId,
      input.status,
      input.triggerKind,
      input.input === undefined ? null : JSON.stringify(input.input),
      input.output === undefined ? null : JSON.stringify(input.output),
      input.logs === undefined ? null : JSON.stringify(input.logs),
      input.error ?? null,
    );
  return id;
}
