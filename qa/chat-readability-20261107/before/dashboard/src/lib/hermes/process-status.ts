import type Database from "better-sqlite3";
import { withRuntimeV2Database } from "../runtime-v2/runtime-database.ts";
import { isLearnRunningStatus, learnStageLabel } from "../learn-stage-labels.ts";

/**
 * One view over every long-running thing Breadboard does on a person's
 * behalf, so the assistant can answer "how is the upload going on EM1?" from
 * the same rows the product's own panels read.
 *
 * Each process family lives in its own store with its own vocabulary: the
 * Rust runtime's `runtime_jobs` (document ingestion, learn workers, agent
 * runs, transcription), the dashboard's `learn_jobs`, `video_transcription_jobs`,
 * `thought_topology_jobs`, `gbrain_sync_jobs`, `runtime_v2_outer_agent_runs`,
 * `scheduled_chat_jobs`, `workflow_runs`, `hermes_runs` and the interactive
 * visualizer jobs. This module projects all of them onto one record shape
 * with a shared four-way `state` (running, waiting, succeeded, failed) and
 * keeps the family's own status word beside it. Every reader is wrapped so a
 * store that is absent on this install (or a runtime that is not running)
 * costs an empty family, never a failed answer.
 *
 * Nothing here writes, and every query is scoped to the signed-in user.
 */

export const PROCESS_KINDS = [
  "document_upload",
  "learn",
  "transcription",
  "thought_topology",
  "knowledge_sync",
  "agent_run",
  "chat_turn",
  "visualizer",
  "schedule",
  "workflow",
  "runtime_job",
] as const;

export type ProcessKind = (typeof PROCESS_KINDS)[number];

export type ProcessState = "running" | "waiting" | "succeeded" | "failed";

export interface ProcessRecord {
  kind: ProcessKind;
  id: string;
  /** What this process is working on: a file name, a Garden, an agent, a chat. */
  title: string;
  /** The Garden slug the process belongs to, when it belongs to one. */
  garden: string | null;
  gardenName: string | null;
  state: ProcessState;
  /** The family's own status word, unchanged (e.g. `generating_visuals`). */
  status: string;
  /** Human wording of the current stage, when the family reports one. */
  stage: string | null;
  progressPercent: number | null;
  error: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  finishedAt: string | null;
  detail: Record<string, string | number | boolean | null>;
}

export interface GardenMatch {
  id: number;
  slug: string;
  name: string;
}

export interface ProcessStatusReport {
  gardens: GardenMatch[];
  processes: ProcessRecord[];
  counts: Record<ProcessState, number>;
  /** How many records matched before `limit` was applied to `processes`. */
  total: number;
  /** Families whose store could not be read; named so the answer can say so. */
  unavailable: ProcessKind[];
  generatedAt: string;
}

export interface CollectProcessStatusOptions {
  database: Database.Database;
  userId: number;
  /** Gardens to include; null means every Garden the person owns plus Garden-less work. */
  gardens?: readonly GardenMatch[] | null;
  kinds?: readonly ProcessKind[];
  /** Include finished work from the last this-many hours (default 24). */
  lookbackHours?: number;
  limit?: number;
  runtimeDatabasePath?: string | null;
  now?: () => Date;
}

const DEFAULT_LOOKBACK_HOURS = 24;
const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 120;
const MAX_ERROR_CHARS = 300;

/** Runtime job families that are machinery, not something the person started. */
const RUNTIME_HOUSEKEEPING_JOB_TYPES = new Set([
  "background-task",
  "claude-account",
  "system-location",
  "loopx-tick",
  "scriberr-garden-health",
  "shorts-probe",
  "tradingagents-probe",
]);

/** Runtime job types already reported through a richer dashboard family. */
const RUNTIME_JOB_TYPES_WITH_OWN_FAMILY = new Set([
  "document-ingestion",
  "learn",
  "scriberr-garden-transcription",
  "thought-topology",
  "interactive-visualizer",
]);

const RUNTIME_STAGE_LABELS: Record<string, string> = {
  preparing: "Preparing",
  working: "Working",
  generating: "Generating",
  "waiting-external": "Waiting on an external service",
  processing: "Processing",
  persisting: "Saving results",
  finalizing: "Finalizing",
  cancelling: "Cancelling",
};

function isoFromMillis(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return new Date(value).toISOString();
}

function isoFromText(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = Date.parse(value.includes("T") ? value : value.replace(" ", "T") + "Z");
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value;
}

function trimError(value: string | null | undefined): string | null {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > MAX_ERROR_CHARS
    ? `${text.slice(0, MAX_ERROR_CHARS - 1).trimEnd()}…`
    : text;
}

function percent(current: number, total: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((current / total) * 100)));
}

function runtimeState(state: string): ProcessState {
  switch (state) {
    case "queued":
    case "admitted":
      return "waiting";
    case "starting":
    case "running":
    case "checkpointing":
    case "cancelling":
      return "running";
    case "succeeded":
      return "succeeded";
    default:
      return "failed";
  }
}

function tableExists(database: Database.Database, table: string): boolean {
  return Boolean(
    database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table),
  );
}

function gardenNameLookup(gardens: readonly GardenMatch[]): Map<string, string> {
  return new Map(gardens.map((garden) => [garden.slug, garden.name]));
}

/**
 * Match a person's Gardens by the words they used: exact slug or name first,
 * then a case-insensitive containment ("EM1" inside "EM1 – Electromagnetism"),
 * then a match on the initials of the name's words ("EM1" ≈ "Electro Magnetism 1").
 */
export function resolveGardens(
  database: Database.Database,
  userId: number,
  query: string | null | undefined,
): GardenMatch[] {
  const rows = database.prepare(`
    SELECT id, slug, name FROM clusters WHERE user_id = ? ORDER BY name COLLATE NOCASE
  `).all(userId) as GardenMatch[];
  const needle = (query ?? "").trim().toLowerCase();
  if (!needle) return rows;
  const normalized = (value: string) => value.toLowerCase().replace(/[\s_-]+/g, " ").trim();
  const compact = (value: string) => normalized(value).replace(/\s+/g, "");
  const exact = rows.filter(
    (row) => normalized(row.slug) === normalized(needle) || normalized(row.name) === normalized(needle),
  );
  if (exact.length > 0) return exact;
  const contains = rows.filter(
    (row) =>
      compact(row.slug).includes(compact(needle)) ||
      compact(row.name).includes(compact(needle)),
  );
  if (contains.length > 0) return contains;
  const abbreviation = compact(needle);
  if (abbreviation.length > 8) return [];
  const scored = rows
    .map((row) => ({
      row,
      score: Math.min(
        abbreviationScore(abbreviation, compact(row.name)),
        abbreviationScore(abbreviation, compact(row.slug)),
      ),
    }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => left.score - right.score);
  if (scored.length === 0) return [];
  const best = scored[0].score;
  return scored.filter((entry) => entry.score === best).map((entry) => entry.row);
}

/**
 * How well a short abbreviation ("EM1", "SaS") stands for a compact name.
 * Every character must appear in order, the first character must open the
 * name, and every digit must land on the same digit; the score is the span
 * the match covers, so a tighter fit ranks first. Infinity means no match.
 */
function abbreviationScore(abbreviation: string, name: string): number {
  if (!abbreviation || !name || abbreviation[0] !== name[0]) return Infinity;
  let position = 0;
  for (const character of abbreviation) {
    const found = name.indexOf(character, position);
    if (found === -1) return Infinity;
    position = found + 1;
  }
  return position;
}

type Reader = (
  options: Required<Pick<CollectProcessStatusOptions, "database" | "userId">> & {
    gardens: readonly GardenMatch[] | null;
    gardenNames: Map<string, string>;
    sinceIso: string;
    sinceMillis: number;
    runtimeDatabasePath: string | null | undefined;
    limit: number;
  },
) => ProcessRecord[];

function gardenSlugClause(
  column: string,
  gardens: readonly GardenMatch[] | null,
): { sql: string; params: string[] } {
  if (gardens === null) return { sql: "", params: [] };
  if (gardens.length === 0) return { sql: " AND 0", params: [] };
  return {
    sql: ` AND ${column} IN (${gardens.map(() => "?").join(", ")})`,
    params: gardens.map((garden) => garden.slug),
  };
}

function gardenIdClause(
  column: string,
  gardens: readonly GardenMatch[] | null,
): { sql: string; params: number[] } {
  if (gardens === null) return { sql: "", params: [] };
  if (gardens.length === 0) return { sql: " AND 0", params: [] };
  return {
    sql: ` AND ${column} IN (${gardens.map(() => "?").join(", ")})`,
    params: gardens.map((garden) => garden.id),
  };
}

const readDocumentUploads: Reader = ({ userId, gardens, gardenNames, sinceMillis, runtimeDatabasePath, limit }) => {
  const scope = gardenSlugClause("j.garden_id", gardens);
  const rows = withRuntimeV2Database((runtime) => runtime.prepare(`
    SELECT j.job_id, j.state, j.stage, j.garden_id, j.created_at, j.started_at,
           j.updated_at, j.finished_at, j.progress_current, j.progress_total,
           j.failure_code, j.failure_message, j.cancellation_requested,
           (SELECT group_concat(u.display_name, ' | ')
              FROM runtime_job_input_uploads u WHERE u.job_id = j.job_id) AS display_names
    FROM runtime_jobs j
    WHERE j.job_type = 'document-ingestion'
      AND j.user_id = ?${scope.sql}
      AND (j.finished_at IS NULL OR j.updated_at >= ?)
    ORDER BY j.updated_at DESC
    LIMIT ?
  `).all(userId, ...scope.params, sinceMillis, limit) as Array<{
    job_id: string;
    state: string;
    stage: string | null;
    garden_id: string | null;
    created_at: number;
    started_at: number | null;
    updated_at: number;
    finished_at: number | null;
    progress_current: number;
    progress_total: number;
    failure_code: string | null;
    failure_message: string | null;
    cancellation_requested: number;
    display_names: string | null;
  }>, { path: runtimeDatabasePath });
  if (rows === null) throw new Error("runtime store unavailable");
  return rows.map((row) => ({
    kind: "document_upload" as const,
    id: row.job_id,
    title: row.display_names?.trim() || "Document upload",
    garden: row.garden_id,
    gardenName: row.garden_id ? gardenNames.get(row.garden_id) ?? null : null,
    state: runtimeState(row.state),
    status: row.state,
    stage: row.stage ? RUNTIME_STAGE_LABELS[row.stage] ?? row.stage : null,
    progressPercent: percent(row.progress_current, row.progress_total),
    error: trimError(row.failure_message) ?? (row.failure_code ?? null),
    startedAt: isoFromMillis(row.started_at ?? row.created_at),
    updatedAt: isoFromMillis(row.updated_at),
    finishedAt: isoFromMillis(row.finished_at),
    detail: {
      cancellationRequested: row.cancellation_requested === 1,
      failureCode: row.failure_code,
      progressCurrent: row.progress_current,
      progressTotal: row.progress_total,
    },
  }));
};

const readLearnJobs: Reader = ({ database, userId, gardens, gardenNames, sinceIso, limit }) => {
  if (!tableExists(database, "learn_jobs")) return [];
  const scope = gardenSlugClause("j.garden_id", gardens);
  const rows = database.prepare(`
    SELECT j.id, j.garden_id, j.status, j.mode, j.model, j.current_step,
           j.progress_percent, j.current_section_title, j.current_page_title,
           j.error, j.paused_from_status, j.active_elapsed_ms, j.created_at, j.updated_at
    FROM learn_jobs j
    JOIN clusters c ON c.slug = j.garden_id AND c.user_id = ?
    WHERE 1${scope.sql}
      AND j.status <> 'idle'
      AND (j.status IN ('planning','analyzing_issues','repairing','revalidating',
                        'publishing_repair','generating_learning_pages','generating_textbook',
                        'generating_visuals','writing_quartz','building_navigation',
                        'paused','awaiting_confirmation')
           OR j.updated_at >= ?)
    ORDER BY j.updated_at DESC
    LIMIT ?
  `).all(userId, ...scope.params, sinceIso, limit) as Array<{
    id: string;
    garden_id: string;
    status: string;
    mode: string;
    model: string;
    current_step: string | null;
    progress_percent: number;
    current_section_title: string | null;
    current_page_title: string | null;
    error: string | null;
    paused_from_status: string | null;
    active_elapsed_ms: number;
    created_at: string;
    updated_at: string;
  }>;
  const stateFor = (status: string): ProcessState => {
    if (isLearnRunningStatus(status)) return "running";
    if (status === "paused" || status === "awaiting_confirmation") return "waiting";
    if (status === "complete") return "succeeded";
    return "failed";
  };
  return rows.map((row) => ({
    kind: "learn" as const,
    id: row.id,
    title: `Learn run (${row.mode})`,
    garden: row.garden_id,
    gardenName: gardenNames.get(row.garden_id) ?? null,
    state: stateFor(row.status),
    status: row.status,
    stage: row.current_step?.trim() || learnStageLabel(row.status),
    progressPercent: Math.max(0, Math.min(100, Math.round(row.progress_percent))),
    error: trimError(row.error),
    startedAt: isoFromText(row.created_at),
    updatedAt: isoFromText(row.updated_at),
    finishedAt: stateFor(row.status) === "running" || stateFor(row.status) === "waiting"
      ? null
      : isoFromText(row.updated_at),
    detail: {
      model: row.model,
      currentSection: row.current_section_title,
      currentPage: row.current_page_title,
      pausedFrom: row.paused_from_status,
      activeMinutes: Math.round(row.active_elapsed_ms / 60_000),
    },
  }));
};

const readTranscriptions: Reader = ({ database, userId, gardens, gardenNames, sinceIso, limit }) => {
  if (!tableExists(database, "video_transcription_jobs")) return [];
  const scope = gardenSlugClause("garden_slug", gardens);
  const rows = database.prepare(`
    SELECT id, garden_slug, input_kind, status, progress_percent, current_stage,
           original_filename, original_url, source_title, error_code, error_message,
           cancel_requested, created_at, updated_at, completed_at
    FROM video_transcription_jobs
    WHERE user_id = ?${scope.sql}
      AND (completed_at IS NULL OR updated_at >= ?)
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(userId, ...scope.params, sinceIso, limit) as Array<{
    id: string;
    garden_slug: string;
    input_kind: string;
    status: string;
    progress_percent: number | null;
    current_stage: string | null;
    original_filename: string | null;
    original_url: string | null;
    source_title: string | null;
    error_code: string | null;
    error_message: string | null;
    cancel_requested: number;
    created_at: string;
    updated_at: string;
    completed_at: string | null;
  }>;
  const stateFor = (status: string): ProcessState =>
    status === "completed"
      ? "succeeded"
      : status === "failed" || status === "cancelled"
        ? "failed"
        : status === "queued"
          ? "waiting"
          : "running";
  return rows.map((row) => ({
    kind: "transcription" as const,
    id: row.id,
    title: row.source_title || row.original_filename || row.original_url || "Transcription",
    garden: row.garden_slug,
    gardenName: gardenNames.get(row.garden_slug) ?? null,
    state: stateFor(row.status),
    status: row.status,
    stage: row.current_stage || row.status.replace(/_/g, " "),
    progressPercent: typeof row.progress_percent === "number"
      ? Math.max(0, Math.min(100, Math.round(row.progress_percent)))
      : null,
    error: trimError(row.error_message) ?? row.error_code,
    startedAt: isoFromText(row.created_at),
    updatedAt: isoFromText(row.updated_at),
    finishedAt: isoFromText(row.completed_at),
    detail: {
      inputKind: row.input_kind,
      cancellationRequested: row.cancel_requested === 1,
    },
  }));
};

const readThoughtTopology: Reader = ({ database, userId, gardens, gardenNames, sinceIso, limit }) => {
  if (!tableExists(database, "thought_topology_jobs")) return [];
  const scope = gardenIdClause("t.cluster_id", gardens);
  const rows = database.prepare(`
    SELECT t.id, t.revision, t.reason, t.status, t.last_error, t.attempts,
           t.created_at, t.updated_at, c.slug AS garden_slug
    FROM thought_topology_jobs t
    JOIN clusters c ON c.id = t.cluster_id AND c.user_id = ?
    WHERE 1${scope.sql}
      AND (t.status IN ('queued','running') OR t.updated_at >= ?)
    ORDER BY t.updated_at DESC
    LIMIT ?
  `).all(userId, ...scope.params, sinceIso, limit) as Array<{
    id: number;
    revision: number;
    reason: string;
    status: string;
    last_error: string | null;
    attempts: number;
    created_at: string;
    updated_at: string;
    garden_slug: string;
  }>;
  const stateFor = (status: string): ProcessState =>
    status === "done"
      ? "succeeded"
      : status === "running"
        ? "running"
        : status === "queued"
          ? "waiting"
          : "failed";
  return rows.map((row) => ({
    kind: "thought_topology" as const,
    id: `thought-topology:${row.id}`,
    title: "Thought Topology rebuild",
    garden: row.garden_slug,
    gardenName: gardenNames.get(row.garden_slug) ?? null,
    state: stateFor(row.status),
    status: row.status,
    stage: null,
    progressPercent: null,
    error: trimError(row.last_error),
    startedAt: isoFromText(row.created_at),
    updatedAt: isoFromText(row.updated_at),
    finishedAt: stateFor(row.status) === "succeeded" || stateFor(row.status) === "failed"
      ? isoFromText(row.updated_at)
      : null,
    detail: { revision: row.revision, reason: row.reason, attempts: row.attempts },
  }));
};

const readKnowledgeSync: Reader = ({ database, userId, gardens, gardenNames, sinceIso, limit }) => {
  if (!tableExists(database, "gbrain_sync_jobs")) return [];
  const scope = gardenIdClause("g.cluster_id", gardens);
  const rows = database.prepare(`
    SELECT g.id, g.reason, g.status, g.attempts, g.last_error, g.created_at, g.updated_at,
           c.slug AS garden_slug
    FROM gbrain_sync_jobs g
    JOIN clusters c ON c.id = g.cluster_id AND c.user_id = ?
    WHERE 1${scope.sql}
      AND (g.status IN ('queued','running','claimed') OR g.updated_at >= ?)
    ORDER BY g.updated_at DESC
    LIMIT ?
  `).all(userId, ...scope.params, sinceIso, limit) as Array<{
    id: number;
    reason: string;
    status: string;
    attempts: number;
    last_error: string | null;
    created_at: string;
    updated_at: string;
    garden_slug: string;
  }>;
  const stateFor = (status: string): ProcessState =>
    status === "done" || status === "synced" || status === "succeeded"
      ? "succeeded"
      : status === "queued"
        ? "waiting"
        : status === "running" || status === "claimed"
          ? "running"
          : "failed";
  return rows.map((row) => ({
    kind: "knowledge_sync" as const,
    id: `gbrain-sync:${row.id}`,
    title: "Knowledge index sync",
    garden: row.garden_slug,
    gardenName: gardenNames.get(row.garden_slug) ?? null,
    state: stateFor(row.status),
    status: row.status,
    stage: null,
    progressPercent: null,
    error: trimError(row.last_error),
    startedAt: isoFromText(row.created_at),
    updatedAt: isoFromText(row.updated_at),
    finishedAt: null,
    detail: { reason: row.reason, attempts: row.attempts },
  }));
};

const readAgentRuns: Reader = ({ database, userId, gardens, gardenNames, sinceIso, sinceMillis, runtimeDatabasePath, limit }) => {
  if (!tableExists(database, "runtime_v2_outer_agent_runs")) return [];
  const scope = gardenSlugClause("garden_id", gardens);
  // Garden-less agent runs belong to every view of "what is running for me".
  const scopeSql = gardens === null
    ? ""
    : gardens.length === 0
      ? " AND 0"
      : ` AND (garden_id IS NULL OR garden_id IN (${gardens.map(() => "?").join(", ")}))`;
  const rows = database.prepare(`
    SELECT job_id, agent_kind, garden_id, conversation_id, created_at, terminal_at
    FROM runtime_v2_outer_agent_runs
    WHERE owner_user_id = ?${scopeSql}
      AND (terminal_at IS NULL OR created_at >= ?)
    ORDER BY created_at DESC
    LIMIT ?
  `).all(userId, ...scope.params, sinceIso, limit) as Array<{
    job_id: string;
    agent_kind: string;
    garden_id: string | null;
    conversation_id: string;
    created_at: string;
    terminal_at: string | null;
  }>;
  if (rows.length === 0) return [];
  const runtimeRows = withRuntimeV2Database((runtime) => {
    const lookup = runtime.prepare(`
      SELECT job_id, state, stage, started_at, updated_at, finished_at,
             progress_current, progress_total, failure_code, failure_message
      FROM runtime_jobs WHERE job_id = ?
    `);
    return new Map(rows.map((row) => [row.job_id, lookup.get(row.job_id) as {
      state: string;
      stage: string | null;
      started_at: number | null;
      updated_at: number;
      finished_at: number | null;
      progress_current: number;
      progress_total: number;
      failure_code: string | null;
      failure_message: string | null;
    } | undefined]));
  }, { path: runtimeDatabasePath });
  void sinceMillis;
  return rows.map((row) => {
    const runtime = runtimeRows?.get(row.job_id);
    const state: ProcessState = runtime
      ? runtimeState(runtime.state)
      : row.terminal_at
        ? "succeeded"
        : "running";
    return {
      kind: "agent_run" as const,
      id: row.job_id,
      title: `${row.agent_kind} agent run`,
      garden: row.garden_id,
      gardenName: row.garden_id ? gardenNames.get(row.garden_id) ?? null : null,
      state,
      status: runtime?.state ?? (row.terminal_at ? "finished" : "unknown"),
      stage: runtime?.stage ? RUNTIME_STAGE_LABELS[runtime.stage] ?? runtime.stage : null,
      progressPercent: runtime ? percent(runtime.progress_current, runtime.progress_total) : null,
      error: runtime ? trimError(runtime.failure_message) ?? runtime.failure_code : null,
      startedAt: isoFromText(row.created_at),
      updatedAt: runtime ? isoFromMillis(runtime.updated_at) : isoFromText(row.terminal_at ?? row.created_at),
      finishedAt: runtime ? isoFromMillis(runtime.finished_at) : isoFromText(row.terminal_at),
      detail: {
        agent: row.agent_kind,
        conversationId: row.conversation_id,
        runtimeVisible: Boolean(runtime),
      },
    };
  });
};

const readChatTurns: Reader = ({ database, userId, gardens, gardenNames, sinceIso, limit }) => {
  if (!tableExists(database, "hermes_runs") || !tableExists(database, "hermes_runtime_sessions")) {
    return [];
  }
  const scopeSql = gardens === null
    ? ""
    : gardens.length === 0
      ? " AND 0"
      : ` AND (s.garden_id IS NULL OR s.garden_id IN (${gardens.map(() => "?").join(", ")}))`;
  const rows = database.prepare(`
    SELECT r.id, r.status, r.instruction, r.started_at, r.finished_at,
           s.surface, s.garden_id, s.conversation_id
    FROM hermes_runs r
    JOIN hermes_runtime_sessions s ON s.id = r.runtime_session_id
    WHERE s.user_id = ?${scopeSql}
      AND (r.status = 'active' OR (r.status <> 'cancelled' AND r.started_at >= ?))
    ORDER BY r.started_at DESC
    LIMIT ?
  `).all(userId, ...(gardens ?? []).map((garden) => garden.slug), sinceIso, limit) as Array<{
    id: string;
    status: string;
    instruction: string;
    started_at: string;
    finished_at: string | null;
    surface: string;
    garden_id: string | null;
    conversation_id: number | null;
  }>;
  const stateFor = (status: string): ProcessState =>
    status === "active" ? "running" : status === "completed" ? "succeeded" : "failed";
  return rows.map((row) => ({
    kind: "chat_turn" as const,
    id: row.id,
    title: row.instruction.replace(/\s+/g, " ").trim().slice(0, 120) || "Chat turn",
    garden: row.garden_id,
    gardenName: row.garden_id ? gardenNames.get(row.garden_id) ?? null : null,
    state: stateFor(row.status),
    status: row.status,
    stage: null,
    progressPercent: null,
    error: null,
    startedAt: isoFromText(row.started_at),
    updatedAt: isoFromText(row.finished_at ?? row.started_at),
    finishedAt: isoFromText(row.finished_at),
    detail: { surface: row.surface, conversationId: row.conversation_id },
  }));
};

const readVisualizers: Reader = ({ database, userId, gardens, gardenNames, sinceIso, limit }) => {
  if (
    !tableExists(database, "hermes_interactive_visualizer_jobs") ||
    !tableExists(database, "hermes_runs") ||
    !tableExists(database, "hermes_runtime_sessions")
  ) {
    return [];
  }
  const scopeSql = gardens === null
    ? ""
    : gardens.length === 0
      ? " AND 0"
      : ` AND (s.garden_id IS NULL OR s.garden_id IN (${gardens.map(() => "?").join(", ")}))`;
  const hasArtifacts = tableExists(database, "hermes_artifacts");
  const rows = database.prepare(`
    SELECT v.id, v.status, v.operation, v.attempt, v.started_at, v.completed_at,
           v.error_json, s.garden_id,
           ${hasArtifacts ? "(SELECT a.title FROM hermes_artifacts a WHERE a.id = v.artifact_id)" : "NULL"} AS artifact_title
    FROM hermes_interactive_visualizer_jobs v
    JOIN hermes_runs r ON r.id = v.run_id
    JOIN hermes_runtime_sessions s ON s.id = r.runtime_session_id
    WHERE s.user_id = ?${scopeSql}
      AND (v.completed_at IS NULL OR v.started_at >= ?)
    ORDER BY v.started_at DESC
    LIMIT ?
  `).all(userId, ...(gardens ?? []).map((garden) => garden.slug), sinceIso, limit) as Array<{
    id: string;
    status: string;
    operation: string;
    attempt: number;
    started_at: string;
    completed_at: string | null;
    error_json: string | null;
    garden_id: string | null;
    artifact_title: string | null;
  }>;
  const stateFor = (status: string): ProcessState =>
    status === "ready"
      ? "succeeded"
      : status === "failed" || status === "cancelled"
        ? "failed"
        : "running";
  return rows.map((row) => {
    let error: string | null = null;
    if (row.error_json) {
      try {
        const parsed = JSON.parse(row.error_json) as Record<string, unknown>;
        error = trimError(
          typeof parsed.message === "string" ? parsed.message : row.error_json,
        );
      } catch {
        error = trimError(row.error_json);
      }
    }
    return {
      kind: "visualizer" as const,
      id: row.id,
      title: row.artifact_title ? `Interactive visualizer: ${row.artifact_title}` : "Interactive visualizer",
      garden: row.garden_id,
      gardenName: row.garden_id ? gardenNames.get(row.garden_id) ?? null : null,
      state: stateFor(row.status),
      status: row.status,
      stage: row.status.replace(/_/g, " "),
      progressPercent: null,
      error,
      startedAt: isoFromText(row.started_at),
      updatedAt: isoFromText(row.completed_at ?? row.started_at),
      finishedAt: isoFromText(row.completed_at),
      detail: { operation: row.operation, attempt: row.attempt },
    };
  });
};

const readSchedules: Reader = ({ database, userId, gardens, gardenNames, limit }) => {
  if (!tableExists(database, "scheduled_chat_jobs")) return [];
  const scopeSql = gardens === null
    ? ""
    : gardens.length === 0
      ? " AND 0"
      : ` AND (garden_slug IS NULL OR garden_slug IN (${gardens.map(() => "?").join(", ")}))`;
  const rows = database.prepare(`
    SELECT id, title, cron_expression, enabled, next_run_at, last_run_at, last_status,
           last_error, run_count, garden_slug, one_shot
    FROM scheduled_chat_jobs
    WHERE user_id = ?${scopeSql}
    ORDER BY enabled DESC, next_run_at ASC
    LIMIT ?
  `).all(userId, ...(gardens ?? []).map((garden) => garden.slug), limit) as Array<{
    id: number;
    title: string;
    cron_expression: string;
    enabled: number;
    next_run_at: string;
    last_run_at: string | null;
    last_status: string | null;
    last_error: string | null;
    run_count: number;
    garden_slug: string | null;
    one_shot: number;
  }>;
  return rows.map((row) => ({
    kind: "schedule" as const,
    id: `schedule:${row.id}`,
    title: row.title,
    garden: row.garden_slug,
    gardenName: row.garden_slug ? gardenNames.get(row.garden_slug) ?? null : null,
    state: row.last_status === "running"
      ? "running"
      : row.last_status === "failed" || row.last_status === "error"
        ? "failed"
        : row.enabled
          ? "waiting"
          : "succeeded",
    status: row.enabled ? (row.last_status ?? "scheduled") : "disabled",
    stage: row.enabled ? `Next run ${isoFromText(row.next_run_at) ?? row.next_run_at}` : "Disabled",
    progressPercent: null,
    error: trimError(row.last_error),
    startedAt: isoFromText(row.last_run_at),
    updatedAt: isoFromText(row.last_run_at),
    finishedAt: null,
    detail: {
      cron: row.cron_expression,
      runCount: row.run_count,
      oneShot: row.one_shot === 1,
      nextRunAt: isoFromText(row.next_run_at),
    },
  }));
};

const readWorkflows: Reader = ({ database, userId, sinceIso, limit }) => {
  if (!tableExists(database, "workflow_runs") || !tableExists(database, "workflows")) return [];
  const rows = database.prepare(`
    SELECT r.id, r.status, r.trigger_kind, r.error, r.started_at, r.finished_at, w.name
    FROM workflow_runs r
    JOIN workflows w ON w.id = r.workflow_id
    WHERE w.user_id = ?
      AND (r.finished_at IS NULL OR r.started_at >= ?)
    ORDER BY r.started_at DESC
    LIMIT ?
  `).all(userId, sinceIso, limit) as Array<{
    id: string;
    status: string;
    trigger_kind: string;
    error: string | null;
    started_at: string;
    finished_at: string | null;
    name: string;
  }>;
  return rows.map((row) => ({
    kind: "workflow" as const,
    id: row.id,
    title: `Workflow: ${row.name}`,
    garden: null,
    gardenName: null,
    state: row.status === "success"
      ? "succeeded"
      : row.status === "waiting"
        ? "running"
        : "failed",
    status: row.status,
    stage: null,
    progressPercent: null,
    error: trimError(row.error),
    startedAt: isoFromText(row.started_at),
    updatedAt: isoFromText(row.finished_at ?? row.started_at),
    finishedAt: isoFromText(row.finished_at),
    detail: { trigger: row.trigger_kind },
  }));
};

/** Everything else the runtime is doing for this person that no family above names. */
const readOtherRuntimeJobs: Reader = ({ userId, gardens, gardenNames, sinceMillis, runtimeDatabasePath, limit }) => {
  const scopeSql = gardens === null
    ? ""
    : gardens.length === 0
      ? " AND 0"
      : ` AND (j.garden_id IS NULL OR j.garden_id IN (${gardens.map(() => "?").join(", ")}))`;
  const rows = withRuntimeV2Database((runtime) => runtime.prepare(`
    SELECT j.job_id, j.job_type, j.state, j.stage, j.garden_id, j.created_at, j.started_at,
           j.updated_at, j.finished_at, j.progress_current, j.progress_total,
           j.failure_code, j.failure_message
    FROM runtime_jobs j
    WHERE j.user_id = ?${scopeSql}
      AND (j.finished_at IS NULL OR j.updated_at >= ?)
    ORDER BY j.updated_at DESC
    LIMIT ?
  `).all(userId, ...(gardens ?? []).map((garden) => garden.slug), sinceMillis, limit * 3) as Array<{
    job_id: string;
    job_type: string;
    state: string;
    stage: string | null;
    garden_id: string | null;
    created_at: number;
    started_at: number | null;
    updated_at: number;
    finished_at: number | null;
    progress_current: number;
    progress_total: number;
    failure_code: string | null;
    failure_message: string | null;
  }>, { path: runtimeDatabasePath });
  if (rows === null) throw new Error("runtime store unavailable");
  return rows
    .filter(
      (row) =>
        !RUNTIME_HOUSEKEEPING_JOB_TYPES.has(row.job_type) &&
        !RUNTIME_JOB_TYPES_WITH_OWN_FAMILY.has(row.job_type),
    )
    .slice(0, limit)
    .map((row) => ({
      kind: "runtime_job" as const,
      id: row.job_id,
      title: row.job_type.replace(/-/g, " "),
      garden: row.garden_id,
      gardenName: row.garden_id ? gardenNames.get(row.garden_id) ?? null : null,
      state: runtimeState(row.state),
      status: row.state,
      stage: row.stage ? RUNTIME_STAGE_LABELS[row.stage] ?? row.stage : null,
      progressPercent: percent(row.progress_current, row.progress_total),
      error: trimError(row.failure_message) ?? row.failure_code,
      startedAt: isoFromMillis(row.started_at ?? row.created_at),
      updatedAt: isoFromMillis(row.updated_at),
      finishedAt: isoFromMillis(row.finished_at),
      detail: { jobType: row.job_type, failureCode: row.failure_code },
    }));
};

const READERS: Record<ProcessKind, Reader> = {
  document_upload: readDocumentUploads,
  learn: readLearnJobs,
  transcription: readTranscriptions,
  thought_topology: readThoughtTopology,
  knowledge_sync: readKnowledgeSync,
  agent_run: readAgentRuns,
  chat_turn: readChatTurns,
  visualizer: readVisualizers,
  schedule: readSchedules,
  workflow: readWorkflows,
  runtime_job: readOtherRuntimeJobs,
};

const STATE_ORDER: Record<ProcessState, number> = {
  running: 0,
  waiting: 1,
  failed: 2,
  succeeded: 3,
};

export function collectProcessStatus(options: CollectProcessStatusOptions): ProcessStatusReport {
  const now = options.now ?? (() => new Date());
  const lookbackHours = options.lookbackHours ?? DEFAULT_LOOKBACK_HOURS;
  const sinceMillis = now().getTime() - lookbackHours * 3_600_000;
  const sinceIso = new Date(sinceMillis).toISOString();
  const limit = Math.max(1, Math.min(MAX_LIMIT, options.limit ?? DEFAULT_LIMIT));
  const kinds = options.kinds && options.kinds.length > 0 ? options.kinds : PROCESS_KINDS;
  const gardens = options.gardens ?? null;
  const allGardens = gardens ?? resolveGardens(options.database, options.userId, null);
  const gardenNames = gardenNameLookup(allGardens);

  const processes: ProcessRecord[] = [];
  const unavailable: ProcessKind[] = [];
  // A runtime job that a richer family already described (an agent run, say)
  // must not reappear as a bare runtime job: families run in PROCESS_KINDS
  // order and the first description of an id wins.
  const seenIds = new Set<string>();
  const push = (records: ProcessRecord[]) => {
    for (const record of records) {
      if (seenIds.has(record.id)) continue;
      seenIds.add(record.id);
      processes.push(record);
    }
  };
  for (const kind of kinds) {
    try {
      push(
        READERS[kind]({
          database: options.database,
          userId: options.userId,
          gardens,
          gardenNames,
          sinceIso,
          sinceMillis,
          runtimeDatabasePath: options.runtimeDatabasePath,
          limit,
        }),
      );
    } catch {
      unavailable.push(kind);
    }
  }

  processes.sort((left, right) => {
    const byState = STATE_ORDER[left.state] - STATE_ORDER[right.state];
    if (byState !== 0) return byState;
    return (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "");
  });
  const bounded = processes.slice(0, limit);
  const counts: Record<ProcessState, number> = {
    running: 0,
    waiting: 0,
    succeeded: 0,
    failed: 0,
  };
  for (const record of processes) counts[record.state] += 1;

  return {
    gardens: [...allGardens],
    processes: bounded,
    counts,
    total: processes.length,
    unavailable,
    generatedAt: now().toISOString(),
  };
}

/**
 * The words the model reads. A compact prose summary keeps a 40-row report
 * from becoming a wall of JSON in the answer; the rows are still returned.
 */
export function summarizeProcessStatus(report: ProcessStatusReport): string {
  const unavailableLine = report.unavailable.length > 0
    ? `Could not read: ${report.unavailable.map((kind) => kind.replace(/_/g, " ")).join(", ")} (the runtime store is not reachable right now).`
    : null;
  if (report.processes.length === 0) {
    const scope = report.gardens.length === 1
      ? `for ${report.gardens[0].name}`
      : "for this account";
    return [`Nothing is running or recently finished ${scope}.`, unavailableLine]
      .filter((line): line is string => line !== null)
      .join("\n");
  }
  const lines: string[] = [];
  const running = report.processes.filter((record) => record.state === "running");
  const waiting = report.processes.filter((record) => record.state === "waiting");
  const failed = report.processes.filter((record) => record.state === "failed");
  const succeeded = report.processes.filter((record) => record.state === "succeeded");
  const describe = (record: ProcessRecord): string => {
    const where = record.gardenName ? ` in ${record.gardenName}` : "";
    const stage = record.stage ? ` — ${record.stage}` : "";
    const progress = record.progressPercent !== null ? ` (${record.progressPercent}%)` : "";
    const error = record.error ? ` — ${record.error}` : "";
    return `${record.kind.replace(/_/g, " ")}: ${record.title}${where}${stage}${progress}${error}`;
  };
  if (running.length > 0) {
    lines.push(`Running (${running.length}):`, ...running.map((record) => `- ${describe(record)}`));
  }
  if (waiting.length > 0) {
    lines.push(`Waiting (${waiting.length}):`, ...waiting.map((record) => `- ${describe(record)}`));
  }
  if (failed.length > 0) {
    lines.push(`Failed or cancelled (${failed.length}):`, ...failed.map((record) => `- ${describe(record)}`));
  }
  if (succeeded.length > 0) {
    lines.push(`Finished (${succeeded.length}):`, ...succeeded.slice(0, 8).map((record) => `- ${describe(record)}`));
    if (succeeded.length > 8) lines.push(`- …and ${succeeded.length - 8} more`);
  }
  if (report.total > report.processes.length) {
    lines.push(
      `Showing ${report.processes.length} of ${report.total} matching processes; narrow by garden or kinds, or raise limit, to see the rest.`,
    );
  }
  if (unavailableLine) lines.push(unavailableLine);
  return lines.join("\n");
}
