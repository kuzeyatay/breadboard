import type Database from "better-sqlite3";
import { externalRuntimeFilesystem as fs } from "./external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "./external-runtime-path.ts";
import { expiredStartedLearnCouncilReceiptProof } from "./learn-council-semantic-recovery.ts";

export type LearnPlanningCheckpointState = "started" | "completed";

export interface LearnPlanningCheckpointRow {
  request_id: string;
  job_id: string;
  garden_id: string;
  stage_key: string;
  semantic_attempt: number;
  request_hash: string;
  receipt_request_id: string | null;
  result_origin: "receipt" | "legacy";
  state: LearnPlanningCheckpointState;
  council_run_id: string | null;
  response_hash: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface ExpiredStartedPlanningReceiptBoundaryRow {
  origin_request_id: string;
  origin_job_id: string;
  garden_id: string;
  stage_key: string;
  semantic_attempt: number;
  request_hash: string;
  receipt_request_id: string;
  dispatch_generation: number;
  dispatch_count: number;
  redispatch_count: number;
  redispatch_allowed: number;
  attempt_count: number;
  started_at: string;
  observed_at: string;
  max_started_age_ms: number;
  failure_code: "council_started_receipt_expired";
  created_at: string;
}

export interface PriorPlanningCheckpointRow extends LearnPlanningCheckpointRow {
  job_garden_id: string;
  job_status: string;
  job_current_step: string | null;
  job_error: string | null;
  job_user_id: number | null;
  job_model: string | null;
  job_source_set_hash: string | null;
  job_source_ids_json: string | null;
  job_syllabus_source_id: string | null;
  job_source_only: number | null;
  job_include_source_snapshots: number | null;
  job_created_at: string;
  job_updated_at: string;
  started_requests: number | null;
  completed_requests: number | null;
  reported_requests: number | null;
  request_model: string | null;
  reasoning_effort: string | null;
  reasoning_summary: string | null;
  policy_observed_requests: number | null;
  policy_mismatch_requests: number | null;
  usage_updated_at: string | null;
  map_count: number;
  version_count: number;
}

export interface PriorRecoveredPlanningJobRow {
  job_id: string;
  garden_id: string;
  job_garden_id: string;
  job_status: string;
  job_current_step: string | null;
  job_error: string | null;
  job_user_id: number | null;
  job_model: string | null;
  job_source_set_hash: string | null;
  job_source_ids_json: string | null;
  job_syllabus_source_id: string | null;
  job_source_only: number | null;
  job_include_source_snapshots: number | null;
  job_created_at: string;
  job_updated_at: string;
  started_requests: number | null;
  completed_requests: number | null;
  reported_requests: number | null;
  request_model: string | null;
  reasoning_effort: string | null;
  reasoning_summary: string | null;
  policy_observed_requests: number | null;
  policy_mismatch_requests: number | null;
  usage_updated_at: string | null;
  map_count: number;
  version_count: number;
}

export interface CurrentPlanningJobBinding {
  garden_id: string;
  user_id: number | null;
  model: string | null;
  source_set_hash: string | null;
  source_ids_json: string | null;
  syllabus_source_id: string | null;
  source_only: number | null;
  include_source_snapshots: number | null;
  created_at: string;
}

function exactStringArrayJson(value: string | null): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === "string")) {
      return null;
    }
    return JSON.stringify(parsed);
  } catch {
    return null;
  }
}

/** Immutable job-selection fence for native strict receipts.
 *
 * The exact checkpoint request hash already binds transformed messages,
 * derived source context, model, Council mode, and reasoning policy. Requiring
 * best-effort token telemetry or the mutable derived source-set hash here can
 * only hide an ambiguous receipt and permit a duplicate POST. Raw selection,
 * user, options, terminal/no-artifact state, and time remain independently
 * durable job-origin fences.
 */
export function exactStrictReceiptOriginBinding(
  origin: PriorPlanningCheckpointRow | PriorRecoveredPlanningJobRow,
  current: CurrentPlanningJobBinding,
): boolean {
  const originSourceIds = exactStringArrayJson(origin.job_source_ids_json);
  const currentSourceIds = exactStringArrayJson(current.source_ids_json);
  const originCreatedAt = Date.parse(origin.job_created_at);
  const originUpdatedAt = Date.parse(origin.job_updated_at);
  const currentCreatedAt = Date.parse(current.created_at);
  return !(
    origin.job_status !== "failed" ||
    origin.map_count !== 0 ||
    origin.version_count !== 0 ||
    origin.garden_id !== current.garden_id ||
    origin.job_garden_id !== current.garden_id ||
    origin.job_user_id !== current.user_id ||
    origin.job_model !== current.model ||
    originSourceIds === null ||
    currentSourceIds === null ||
    originSourceIds !== currentSourceIds ||
    origin.job_syllabus_source_id !== current.syllabus_source_id ||
    Number(origin.job_source_only ?? 0) !== Number(current.source_only ?? 0) ||
    Number(origin.job_include_source_snapshots ?? 0) !==
      Number(current.include_source_snapshots ?? 0) ||
    !Number.isFinite(originCreatedAt) ||
    !Number.isFinite(originUpdatedAt) ||
    !Number.isFinite(currentCreatedAt) ||
    originCreatedAt > originUpdatedAt ||
    originUpdatedAt > currentCreatedAt
  );
}

export type RecoveredLegacyPlanningOriginDisposition =
  | "unrelated"
  | "proven_unissued"
  | "exact"
  | "conflict";

const SHA256_HEX = /^[0-9a-f]{64}$/;
const RECOVERED_WORKER_STEP =
  "Unresponsive Learn worker recovered; prior Learn state restored";
const RECOVERED_WORKER_ERROR =
  "Learn stopped responding before completion. Your garden was restored and is safe to retry.";

/** Classify an abandoned no-receipt job before the legacy ledger bridge.
 *
 * A complete source-set hash is part of every recoverable planning envelope.
 * Two valid, unequal hashes therefore prove different request epochs even when
 * the raw document selection is the same. Conversely, a missing/corrupt hash
 * is ambiguity, never permission to dispatch.
 *
 * A migration waiver is an explicit pre-run transition to the strict receipt
 * protocol. For a job created strictly after that seal, the strict runtime's
 * synchronous checkpoint-before-POST invariant makes an exact zero checkpoint
 * and zero-observation record positive negative-dispatch evidence. Pre-seal
 * jobs retain the full legacy source/model-policy requirements.
 */
export function classifyRecoveredLegacyPlanningOrigin(input: {
  origin: PriorRecoveredPlanningJobRow;
  current: CurrentPlanningJobBinding;
  checkpointCount: number;
  migrationSealedAt?: string | null;
  expectedRequestModel: string;
  expectedReasoningEffort: string;
  expectedReasoningSummary: string;
}): RecoveredLegacyPlanningOriginDisposition {
  const { origin, current } = input;
  const originSourceIds = exactStringArrayJson(origin.job_source_ids_json);
  const currentSourceIds = exactStringArrayJson(current.source_ids_json);

  // Invalid raw bindings are ambiguous. Valid but different immutable user,
  // selection, option, or model bindings are genuinely unrelated.
  if (originSourceIds === null || currentSourceIds === null) return "conflict";
  if (
    origin.garden_id !== current.garden_id ||
    origin.job_garden_id !== current.garden_id ||
    origin.job_user_id !== current.user_id ||
    origin.job_model !== current.model ||
    originSourceIds !== currentSourceIds ||
    origin.job_syllabus_source_id !== current.syllabus_source_id ||
    Number(origin.job_source_only ?? 0) !== Number(current.source_only ?? 0) ||
    Number(origin.job_include_source_snapshots ?? 0) !==
      Number(current.include_source_snapshots ?? 0)
  ) {
    return "unrelated";
  }

  const originSourceSetHash = origin.job_source_set_hash;
  const currentSourceSetHash = current.source_set_hash;
  if (
    typeof originSourceSetHash !== "string" ||
    !SHA256_HEX.test(originSourceSetHash) ||
    typeof currentSourceSetHash !== "string" ||
    !SHA256_HEX.test(currentSourceSetHash)
  ) {
    return "conflict";
  }
  if (originSourceSetHash !== currentSourceSetHash) return "unrelated";

  const originCreatedAt = Date.parse(origin.job_created_at);
  const originUpdatedAt = Date.parse(origin.job_updated_at);
  const currentCreatedAt = Date.parse(current.created_at);
  if (
    origin.job_status !== "failed" ||
    origin.job_current_step !== RECOVERED_WORKER_STEP ||
    origin.job_error !== RECOVERED_WORKER_ERROR ||
    origin.map_count !== 0 ||
    origin.version_count !== 0 ||
    !Number.isFinite(originCreatedAt) ||
    !Number.isFinite(originUpdatedAt) ||
    !Number.isFinite(currentCreatedAt) ||
    originCreatedAt > originUpdatedAt ||
    originUpdatedAt > currentCreatedAt
  ) {
    return "conflict";
  }

  if (input.migrationSealedAt !== undefined && input.migrationSealedAt !== null) {
    const migrationSealedAt = Date.parse(input.migrationSealedAt);
    if (!Number.isFinite(migrationSealedAt)) return "conflict";
    if (migrationSealedAt < originCreatedAt) {
      const usageUpdatedAt = Date.parse(origin.usage_updated_at ?? "");
      const exactZeroObservation =
        origin.started_requests === 0 &&
        origin.completed_requests === 0 &&
        origin.reported_requests === 0 &&
        origin.policy_observed_requests === 0 &&
        origin.policy_mismatch_requests === 0 &&
        origin.request_model === null &&
        origin.reasoning_effort === null &&
        origin.reasoning_summary === null &&
        Number.isFinite(usageUpdatedAt) &&
        usageUpdatedAt >= originCreatedAt &&
        usageUpdatedAt <= originUpdatedAt;
      return Number.isSafeInteger(input.checkpointCount) &&
        input.checkpointCount === 0 &&
        exactZeroObservation
        ? "proven_unissued"
        : "conflict";
    }
  }

  const observed = origin.policy_observed_requests;
  return (
    origin.request_model === input.expectedRequestModel &&
    origin.reasoning_effort === input.expectedReasoningEffort &&
    origin.reasoning_summary === input.expectedReasoningSummary &&
    origin.policy_mismatch_requests === 0 &&
    typeof observed === "number" &&
    Number.isSafeInteger(observed) &&
    observed > 0 &&
    origin.started_requests === observed &&
    origin.completed_requests === observed
  )
    ? "exact"
    : "conflict";
}

export type PlanningCheckpointRecoveryDisposition =
  | "eligible"
  | "ineligible"
  | "conflict";

/** Decide only whether a prior checkpoint must be resolved. Request-hash and
 * result lookup checks stay separate and fail closed after this decision. */
export function planningCheckpointRecoveryDisposition(input: {
  state: LearnPlanningCheckpointState;
  resultOrigin: "receipt" | "legacy";
  exactBinding: boolean;
  abandonedLineage: "none" | "valid" | "invalid";
}): PlanningCheckpointRecoveryDisposition {
  if (!input.exactBinding) return "ineligible";
  if (input.state === "started") {
    // A started strict receipt is durable ambiguity evidence by itself.
    return input.resultOrigin === "receipt" ? "eligible" : "conflict";
  }
  if (input.resultOrigin === "legacy") {
    return input.abandonedLineage === "valid" ? "eligible" : "conflict";
  }
  if (input.abandonedLineage === "invalid") return "conflict";
  return input.abandonedLineage === "valid" ? "eligible" : "ineligible";
}

/** Keep the no-duplicate sequencing executable and unit-testable: recovery is
 * always observed before the callback that persists and dispatches a POST. */
export async function recoverBeforePlanningDispatch<T>(input: {
  recover: () => Promise<T | null>;
  dispatch: () => Promise<T>;
}): Promise<T> {
  const recovered = await input.recover();
  if (recovered !== null) return recovered;
  return input.dispatch();
}

export function hasExactPlanningDispatchAuthority(input: {
  job: { id: string; gardenId: string; status: string } | null;
  expectedJobId: string;
  expectedGardenId: string;
  ownsLease: () => boolean;
}): boolean {
  return Boolean(
    input.job &&
    input.job.id === input.expectedJobId &&
    input.job.gardenId === input.expectedGardenId &&
    input.job.status === "planning" &&
    input.ownsLease(),
  );
}

/** Last synchronous gate before a recoverable HTTP POST. */
export async function dispatchAfterExactPlanningAuthority<T>(input: {
  authorized: () => boolean;
  dispatch: () => Promise<T>;
}): Promise<T> {
  if (!input.authorized()) {
    throw new PlanningRecoveryBoundaryError("dispatch_authority_lost");
  }
  return input.dispatch();
}

/** Execute a repair POST only after its issuance evidence is durably written.
 * Kept as an explicit boundary so persistence-failure injection can prove the
 * provider callback is unreachable. */
export async function dispatchAfterDurablePlanningIssuance<T>(input: {
  persist: () => void;
  dispatch: () => Promise<T>;
}): Promise<T> {
  input.persist();
  return input.dispatch();
}

function fsyncDirectoryBestEffort(directory: string): void {
  if (process.platform === "win32") return;
  let descriptor: number | null = null;
  try {
    descriptor = fs.openSync(directory, "r");
    fs.fsyncSync(descriptor);
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}

/** Strict append-only evidence for a semantic repair about to be issued.
 * Unlike the general garden telemetry writer, errors propagate and the file is
 * fsynced before control can reach the provider dispatch boundary. */
export function appendDurablePlanningIssuanceEvent(input: {
  contentPath: string;
  gardenId: string;
  type: "learn_planning_schema_repair_started";
  data: Record<string, unknown>;
  at: string;
}): void {
  const directory = path.join(input.contentPath, input.gardenId, ".breadboard");
  fs.mkdirSync(directory, { recursive: true });
  const eventPath = path.join(directory, "events.jsonl");
  const newFile = !fs.existsSync(eventPath);
  const entry = JSON.stringify({
    type: input.type,
    at: input.at,
    gardenId: input.gardenId,
    timestamp: input.at,
    ...input.data,
  });
  const descriptor = fs.openSync(eventPath, "a");
  try {
    fs.writeSync(descriptor, `${entry}\n`, undefined, "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  if (newFile) fsyncDirectoryBestEffort(directory);
}

export type PlanningRecoveryBoundaryCode =
  | "candidate_conflict"
  | "request_hash_mismatch"
  | "candidate_multiple"
  | "result_unresolved"
  | "dispatch_authority_lost";

export class PlanningRecoveryBoundaryError extends Error {
  readonly code: PlanningRecoveryBoundaryCode;

  constructor(code: PlanningRecoveryBoundaryCode) {
    super(code);
    this.name = "PlanningRecoveryBoundaryError";
    this.code = code;
  }
}

/** Select and resolve at most one prior call without ever owning the POST
 * callback. This makes hash drift, ambiguity, and torn/unresolved results
 * executable fail-closed behavior rather than caller convention. */
export async function resolveUniquePlanningCandidate<C, T>(input: {
  candidates: Array<{
    candidate: C;
    disposition: PlanningCheckpointRecoveryDisposition;
    requestHash: string;
  }>;
  expectedRequestHash: string;
  resolve: (candidate: C) => Promise<T | null>;
}): Promise<T | null> {
  if (input.candidates.some((entry) => entry.disposition === "conflict")) {
    throw new PlanningRecoveryBoundaryError("candidate_conflict");
  }
  const eligible = input.candidates.filter(
    (entry) => entry.disposition === "eligible",
  );
  if (eligible.some((entry) => entry.requestHash !== input.expectedRequestHash)) {
    throw new PlanningRecoveryBoundaryError("request_hash_mismatch");
  }
  if (eligible.length > 1) {
    throw new PlanningRecoveryBoundaryError("candidate_multiple");
  }
  if (eligible.length === 0) return null;
  const resolved = await input.resolve(eligible[0].candidate);
  if (resolved === null) {
    throw new PlanningRecoveryBoundaryError("result_unresolved");
  }
  return resolved;
}

export type LegacyStageIssuanceEvidence = "none" | "issued" | "ambiguous";

function durableEventTime(event: Record<string, unknown>): number | null {
  for (const key of ["timestamp", "at"]) {
    const value = event[key];
    if (typeof value !== "string") continue;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/** Stage-local pre-receipt ambiguity evidence.
 *
 * Global Learn request counters include formula, visual, and other unrelated
 * calls, so they can never prove issuance of a planning stage. Only an exact
 * transport-ambiguity event or a validation-gated repair-start event for this
 * task/stage/semantic attempt may fence a missing legacy result.
 */
export function classifyLegacyStageIssuanceEvidence(input: {
  events: Array<Record<string, unknown>>;
  taskType: string;
  stageKey: string;
  stageLabel: string;
  semanticAttempt: number;
  initialPlanningStageKey: string;
  jobCreatedAt: string;
  recoveredAt: string;
}): LegacyStageIssuanceEvidence {
  const jobCreatedAt = Date.parse(input.jobCreatedAt);
  const recoveredAt = Date.parse(input.recoveredAt);
  if (
    !Number.isFinite(jobCreatedAt) ||
    !Number.isFinite(recoveredAt) ||
    jobCreatedAt > recoveredAt ||
    !Number.isSafeInteger(input.semanticAttempt) ||
    input.semanticAttempt < 0
  ) {
    return "ambiguous";
  }

  let issued = false;
  for (const event of input.events) {
    let provesThisAttempt = false;
    if (event.type === "learn_planning_started") {
      if (
        input.semanticAttempt !== 0 ||
        input.stageKey !== input.initialPlanningStageKey
      ) {
        continue;
      }
      provesThisAttempt = true;
    } else if (event.type === "learn_planning_transport_ambiguous") {
      if (event.stageKey !== input.stageKey) continue;
      if (
        event.taskType !== input.taskType ||
        event.stageLabel !== input.stageLabel ||
        Number(event.semanticAttempt) !== input.semanticAttempt
      ) {
        return "ambiguous";
      }
      provesThisAttempt = true;
    } else if (event.type === "learn_planning_schema_repair_started") {
      const hasStageKey = typeof event.stageKey === "string";
      if (hasStageKey && event.stageKey !== input.stageKey) continue;
      if (
        hasStageKey &&
        (event.taskType !== input.taskType || event.stageLabel !== input.stageLabel)
      ) {
        return "ambiguous";
      }
      if (!hasStageKey && (
        event.taskType !== input.taskType || event.stageLabel !== input.stageLabel
      )) {
        continue;
      }
      const repairAttempt = Number(event.repairAttempt);
      if (!Number.isSafeInteger(repairAttempt) || repairAttempt < 1) {
        return "ambiguous";
      }
      // Starting repair N proves the initial candidate and repairs < N were
      // observed; it also proves repair N may have crossed the dispatch edge.
      provesThisAttempt = input.semanticAttempt <= repairAttempt;
    } else {
      continue;
    }
    if (!provesThisAttempt) continue;
    const at = durableEventTime(event);
    if (at === null || at < jobCreatedAt || at > recoveredAt) {
      return "ambiguous";
    }
    issued = true;
  }
  return issued ? "issued" : "none";
}

export function planningCheckpointOriginCounts(
  database: Database.Database,
  jobId: string,
): { nativeReceiptCount: number; materializedLegacyCount: number } {
  const row = database.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN result_origin = 'receipt' THEN 1 ELSE 0 END), 0)
         AS native_receipt_count,
       COALESCE(SUM(CASE WHEN result_origin = 'legacy' THEN 1 ELSE 0 END), 0)
         AS materialized_legacy_count
     FROM learn_planning_request_checkpoints
     WHERE job_id = ?`,
  ).get(jobId) as {
    native_receipt_count: number;
    materialized_legacy_count: number;
  };
  return {
    nativeReceiptCount: Number(row.native_receipt_count),
    materializedLegacyCount: Number(row.materialized_legacy_count),
  };
}

export function hasCompletedNativePlanningCheckpoint(
  database: Database.Database,
  jobId: string,
): boolean {
  return Boolean(database.prepare(
    `SELECT 1
     FROM learn_planning_request_checkpoints
     WHERE job_id = ? AND result_origin = 'receipt' AND state = 'completed'
     LIMIT 1`,
  ).get(jobId));
}

export function materializedLegacyPlanningResults(
  database: Database.Database,
  jobId: string,
): Array<{
  stageKey: string;
  semanticAttempt: number;
  requestHash: string;
  councilRunId: string;
  responseHash: string;
}> {
  return database.prepare(
    `SELECT stage_key, semantic_attempt, request_hash, council_run_id, response_hash
     FROM learn_planning_request_checkpoints
     WHERE job_id = ? AND result_origin = 'legacy' AND state = 'completed'
     ORDER BY created_at, rowid`,
  ).all(jobId).map((row) => {
    const value = row as {
      stage_key: string;
      semantic_attempt: number;
      request_hash: string;
      council_run_id: string;
      response_hash: string;
    };
    return {
      stageKey: value.stage_key,
      semanticAttempt: Number(value.semantic_attempt),
      requestHash: value.request_hash,
      councilRunId: value.council_run_id,
      responseHash: value.response_hash,
    };
  });
}

export function ensureLearnPlanningCheckpointSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS learn_planning_request_checkpoints (
      request_id       TEXT PRIMARY KEY,
      job_id            TEXT NOT NULL REFERENCES learn_jobs(id) ON DELETE CASCADE,
      garden_id         TEXT NOT NULL,
      stage_key         TEXT NOT NULL,
      semantic_attempt  INTEGER NOT NULL CHECK (semantic_attempt >= 0),
      request_hash      TEXT NOT NULL CHECK (length(request_hash) = 64),
      receipt_request_id TEXT,
      result_origin     TEXT NOT NULL DEFAULT 'receipt' CHECK (result_origin IN ('receipt', 'legacy')),
      state             TEXT NOT NULL CHECK (state IN ('started', 'completed')),
      council_run_id    TEXT,
      response_hash     TEXT,
      created_at        TEXT NOT NULL,
      updated_at        TEXT NOT NULL,
      completed_at      TEXT,
      UNIQUE(job_id, stage_key, semantic_attempt),
      CHECK (
        (state = 'started' AND council_run_id IS NULL AND response_hash IS NULL AND completed_at IS NULL)
        OR
        (state = 'completed' AND council_run_id IS NOT NULL AND response_hash IS NOT NULL AND completed_at IS NOT NULL)
      )
    );

  `);
  database.transaction(() => {
    // Recheck only after BEGIN IMMEDIATE owns SQLite's schema-write lock. Two
    // Dashboard/worker connections may enter startup together; the loser must
    // observe the winner's new column instead of issuing a duplicate ALTER.
    const columns = database
      .prepare("PRAGMA table_info(learn_planning_request_checkpoints)")
      .all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "result_origin")) {
      // Upgrade the pre-recovery table in place. SQLite applies the constant
      // default to existing rows, preserving every started/completed binding.
      database.exec(
        `ALTER TABLE learn_planning_request_checkpoints
         ADD COLUMN result_origin TEXT NOT NULL DEFAULT 'receipt'
         CHECK (result_origin IN ('receipt', 'legacy'))`,
      );
    }
    if (!columns.some((column) => column.name === "receipt_request_id")) {
      database.exec(
        `ALTER TABLE learn_planning_request_checkpoints
         ADD COLUMN receipt_request_id TEXT`,
      );
    }
    const invalidOrigin = database.prepare(
      `SELECT request_id
       FROM learn_planning_request_checkpoints
       WHERE result_origin NOT IN ('receipt', 'legacy')
       LIMIT 1`,
    ).get() as { request_id: string } | undefined;
    if (invalidOrigin) {
      throw new Error(
        `Learn planning checkpoint ${invalidOrigin.request_id} has an invalid result origin.`,
      );
    }
    const duplicateLegacyRun = database.prepare(
      `SELECT job_id, council_run_id
       FROM learn_planning_request_checkpoints
       WHERE result_origin = 'legacy' AND council_run_id IS NOT NULL
       GROUP BY job_id, council_run_id
       HAVING COUNT(*) > 1
       LIMIT 1`,
    ).get() as { job_id: string; council_run_id: string } | undefined;
    if (duplicateLegacyRun) {
      throw new Error(
        `Legacy Council run ${duplicateLegacyRun.council_run_id} is materialized more than once for Learn job ${duplicateLegacyRun.job_id}.`,
      );
    }
    database.exec(`
      CREATE INDEX IF NOT EXISTS idx_learn_planning_checkpoint_recovery
        ON learn_planning_request_checkpoints(
          garden_id, stage_key, semantic_attempt, request_hash, state, created_at
        );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_learn_planning_legacy_run_once
        ON learn_planning_request_checkpoints(job_id, council_run_id)
        WHERE result_origin = 'legacy';
      CREATE TABLE IF NOT EXISTS learn_planning_expired_receipt_boundaries (
        origin_request_id   TEXT PRIMARY KEY
          REFERENCES learn_planning_request_checkpoints(request_id) ON DELETE CASCADE,
        origin_job_id       TEXT NOT NULL REFERENCES learn_jobs(id) ON DELETE CASCADE,
        garden_id           TEXT NOT NULL,
        stage_key           TEXT NOT NULL,
        semantic_attempt    INTEGER NOT NULL CHECK (semantic_attempt >= 0),
        request_hash        TEXT NOT NULL CHECK (length(request_hash) = 64),
        receipt_request_id  TEXT NOT NULL UNIQUE,
        dispatch_generation INTEGER NOT NULL CHECK (dispatch_generation = 1),
        dispatch_count      INTEGER NOT NULL CHECK (dispatch_count = 1),
        redispatch_count    INTEGER NOT NULL CHECK (redispatch_count = 0),
        redispatch_allowed  INTEGER NOT NULL CHECK (redispatch_allowed = 0),
        attempt_count       INTEGER NOT NULL CHECK (attempt_count = 0),
        started_at          TEXT NOT NULL,
        observed_at         TEXT NOT NULL,
        max_started_age_ms  INTEGER NOT NULL CHECK (max_started_age_ms > 0),
        failure_code        TEXT NOT NULL
          CHECK (failure_code = 'council_started_receipt_expired'),
        created_at          TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_learn_planning_expired_receipt_lookup
        ON learn_planning_expired_receipt_boundaries(
          garden_id, stage_key, semantic_attempt, request_hash
        );
    `);
  }).immediate();
}

function exactExpiredStartedPlanningReceiptBoundary(
  database: Database.Database,
  originRequestId: string,
): ExpiredStartedPlanningReceiptBoundaryRow | null {
  const row = database.prepare(
    `SELECT *
     FROM learn_planning_expired_receipt_boundaries
     WHERE origin_request_id = ?`,
  ).get(originRequestId) as ExpiredStartedPlanningReceiptBoundaryRow | undefined;
  if (!row) return null;

  const origin = database.prepare(
    `SELECT c.*, j.status AS job_status,
            (SELECT COUNT(*) FROM learn_maps m WHERE m.job_id = c.job_id) AS map_count,
            (SELECT COUNT(*) FROM learn_versions v WHERE v.job_id = c.job_id) AS version_count
     FROM learn_planning_request_checkpoints c
     JOIN learn_jobs j ON j.id = c.job_id
     WHERE c.request_id = ?`,
  ).get(originRequestId) as (LearnPlanningCheckpointRow & {
    job_status: string;
    map_count: number;
    version_count: number;
  }) | undefined;
  const startedAtMs = Date.parse(row.started_at);
  const observedAtMs = Date.parse(row.observed_at);
  const createdAtMs = Date.parse(row.created_at);
  const exact = Boolean(
    origin &&
    origin.result_origin === "receipt" &&
    origin.state === "started" &&
    origin.job_status === "failed" &&
    Number(origin.map_count) === 0 &&
    Number(origin.version_count) === 0 &&
    row.origin_job_id === origin.job_id &&
    row.garden_id === origin.garden_id &&
    row.stage_key === origin.stage_key &&
    Number(row.semantic_attempt) === Number(origin.semantic_attempt) &&
    row.request_hash === origin.request_hash &&
    row.receipt_request_id === (origin.receipt_request_id ?? origin.request_id) &&
    row.dispatch_generation === 1 &&
    row.dispatch_count === 1 &&
    row.redispatch_count === 0 &&
    row.redispatch_allowed === 0 &&
    row.attempt_count === 0 &&
    row.failure_code === "council_started_receipt_expired" &&
    Number.isSafeInteger(row.max_started_age_ms) &&
    row.max_started_age_ms > 0 &&
    Number.isFinite(startedAtMs) &&
    Number.isFinite(observedAtMs) &&
    Number.isFinite(createdAtMs) &&
    row.started_at === origin.updated_at &&
    observedAtMs - startedAtMs >= row.max_started_age_ms &&
    createdAtMs === observedAtMs
  );
  if (!exact) {
    throw new Error(
      `Learn planning expired-receipt boundary ${originRequestId} is not exact.`,
    );
  }
  return row;
}

/** A durable boundary is required before an abandoned, still-started strict
 * planning receipt can stop fencing later retries. Planning checkpoints do not
 * support same-receipt generation two, so only the independently-known first
 * generation shape is eligible. */
export function recordExpiredStartedPlanningReceiptBoundary(
  database: Database.Database,
  input: {
    originRequestId: string;
    receiptRequestId: string;
    requestHash: string;
    dispatchGeneration: number;
    dispatchCount: number;
    redispatchCount: number;
    redispatchAllowed: boolean;
    attemptCount: number;
    observedAt: string;
    maxStartedAgeMs: number;
  },
): ExpiredStartedPlanningReceiptBoundaryRow | null {
  return database.transaction(() => {
    const existing = exactExpiredStartedPlanningReceiptBoundary(
      database,
      input.originRequestId,
    );
    if (existing) return existing;

    const origin = database.prepare(
      `SELECT c.*, j.status AS job_status,
              (SELECT COUNT(*) FROM learn_maps m WHERE m.job_id = c.job_id) AS map_count,
              (SELECT COUNT(*) FROM learn_versions v WHERE v.job_id = c.job_id) AS version_count
       FROM learn_planning_request_checkpoints c
       JOIN learn_jobs j ON j.id = c.job_id
       WHERE c.request_id = ?`,
    ).get(input.originRequestId) as (LearnPlanningCheckpointRow & {
      job_status: string;
      map_count: number;
      version_count: number;
    }) | undefined;
    if (
      !origin ||
      origin.result_origin !== "receipt" ||
      origin.state !== "started" ||
      origin.job_status !== "failed" ||
      Number(origin.map_count) !== 0 ||
      Number(origin.version_count) !== 0 ||
      origin.request_hash !== input.requestHash ||
      (origin.receipt_request_id ?? origin.request_id) !== input.receiptRequestId
    ) {
      throw new Error("Learn planning expired-receipt origin is not exact.");
    }
    const proof = expiredStartedLearnCouncilReceiptProof({
      requestId: input.receiptRequestId,
      requestHash: input.requestHash,
      dispatchGeneration: input.dispatchGeneration,
      dispatchCount: input.dispatchCount,
      redispatchCount: input.redispatchCount,
      redispatchAllowed: input.redispatchAllowed,
      attemptCount: input.attemptCount,
      // Planning owns exactly one initial POST and has no persisted
      // same-receipt redispatch generation. This independent local shape is
      // deliberately stricter than reflecting the server metadata back.
      checkpointDispatchCount: 1,
      checkpointRedispatchCount: 0,
      startedAt: origin.updated_at,
      observedAt: input.observedAt,
      maxStartedAgeMs: input.maxStartedAgeMs,
    });
    if (!proof) return null;

    database.prepare(
      `INSERT INTO learn_planning_expired_receipt_boundaries (
         origin_request_id, origin_job_id, garden_id, stage_key,
         semantic_attempt, request_hash, receipt_request_id,
         dispatch_generation, dispatch_count, redispatch_count,
         redispatch_allowed, attempt_count, started_at, observed_at,
         max_started_age_ms, failure_code, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
    ).run(
      origin.request_id,
      origin.job_id,
      origin.garden_id,
      origin.stage_key,
      origin.semantic_attempt,
      origin.request_hash,
      input.receiptRequestId,
      proof.dispatchGeneration,
      proof.dispatchCount,
      proof.redispatchCount,
      input.attemptCount,
      origin.updated_at,
      input.observedAt,
      input.maxStartedAgeMs,
      proof.failureCode,
      input.observedAt,
    );
    return exactExpiredStartedPlanningReceiptBoundary(
      database,
      input.originRequestId,
    );
  }).immediate();
}

export function hasExactExpiredStartedPlanningReceiptBoundary(
  database: Database.Database,
  originRequestId: string,
): boolean {
  return exactExpiredStartedPlanningReceiptBoundary(database, originRequestId) !== null;
}

export function createStartedPlanningCheckpoint(
  database: Database.Database,
  input: {
    requestId: string;
    jobId: string;
    gardenId: string;
    stageKey: string;
    semanticAttempt: number;
    requestHash: string;
    now: string;
  },
): void {
  database.prepare(
    `INSERT INTO learn_planning_request_checkpoints (
       request_id, job_id, garden_id, stage_key, semantic_attempt,
       request_hash, receipt_request_id, state, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'started', ?, ?)`,
  ).run(
    input.requestId,
    input.jobId,
    input.gardenId,
    input.stageKey,
    input.semanticAttempt,
    input.requestHash,
    input.requestId,
    input.now,
    input.now,
  );
}

export function createCompletedPlanningCheckpointAdoption(
  database: Database.Database,
  input: {
    requestId: string;
    receiptRequestId: string;
    jobId: string;
    gardenId: string;
    stageKey: string;
    semanticAttempt: number;
    requestHash: string;
    councilRunId: string;
    responseHash: string;
    now: string;
  },
): void {
  database.prepare(
    `INSERT INTO learn_planning_request_checkpoints (
       request_id, job_id, garden_id, stage_key, semantic_attempt,
       request_hash, receipt_request_id, result_origin, state,
       council_run_id, response_hash, created_at, updated_at, completed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'receipt', 'completed', ?, ?, ?, ?, ?)`,
  ).run(
    input.requestId,
    input.jobId,
    input.gardenId,
    input.stageKey,
    input.semanticAttempt,
    input.requestHash,
    input.receiptRequestId,
    input.councilRunId,
    input.responseHash,
    input.now,
    input.now,
    input.now,
  );
}

/** Atomically finish an origin receipt (when it was still started) and bind
 * the adopting job to that immutable receipt/result. There must never be an
 * observable origin-completed/adoption-missing state: that torn state lets a
 * third job overlook the middle job and issue the logical call again. */
export function completePlanningCheckpointWithAdoption(
  database: Database.Database,
  input: {
    originRequestId: string;
    receiptRequestId: string;
    requestHash: string;
    councilRunId: string;
    responseHash: string;
    adoptionRequestId: string;
    adoptingJobId: string;
    gardenId: string;
    stageKey: string;
    semanticAttempt: number;
    now: string;
  },
): void {
  database.transaction(() => {
    const origin = database.prepare(
      `SELECT request_id, job_id, garden_id, stage_key, semantic_attempt,
              request_hash, COALESCE(receipt_request_id, request_id) AS receipt_request_id,
              result_origin, state, council_run_id, response_hash
       FROM learn_planning_request_checkpoints
       WHERE request_id = ?`,
    ).get(input.originRequestId) as {
      request_id: string;
      job_id: string;
      garden_id: string;
      stage_key: string;
      semantic_attempt: number;
      request_hash: string;
      receipt_request_id: string;
      result_origin: string;
      state: string;
      council_run_id: string | null;
      response_hash: string | null;
    } | undefined;
    if (
      !origin ||
      origin.result_origin !== "receipt" ||
      origin.garden_id !== input.gardenId ||
      origin.stage_key !== input.stageKey ||
      Number(origin.semantic_attempt) !== input.semanticAttempt ||
      origin.request_hash !== input.requestHash ||
      origin.receipt_request_id !== input.receiptRequestId ||
      origin.job_id === input.adoptingJobId
    ) {
      throw new Error("Learn planning receipt adoption origin is not exact.");
    }
    if (origin.state === "started") {
      completePlanningCheckpoint(database, {
        requestId: input.originRequestId,
        requestHash: input.requestHash,
        councilRunId: input.councilRunId,
        responseHash: input.responseHash,
        now: input.now,
      });
    } else if (
      origin.state !== "completed" ||
      origin.council_run_id !== input.councilRunId ||
      origin.response_hash !== input.responseHash
    ) {
      throw new Error("Learn planning receipt adoption result is not exact.");
    }
    createCompletedPlanningCheckpointAdoption(database, {
      requestId: input.adoptionRequestId,
      receiptRequestId: input.receiptRequestId,
      jobId: input.adoptingJobId,
      gardenId: input.gardenId,
      stageKey: input.stageKey,
      semanticAttempt: input.semanticAttempt,
      requestHash: input.requestHash,
      councilRunId: input.councilRunId,
      responseHash: input.responseHash,
      now: input.now,
    });
  }).immediate();
}

export function completePlanningCheckpoint(
  database: Database.Database,
  input: {
    requestId: string;
    requestHash: string;
    councilRunId: string;
    responseHash: string;
    now: string;
  },
): void {
  const result = database.prepare(
    `UPDATE learn_planning_request_checkpoints
     SET state = 'completed', council_run_id = ?, response_hash = ?,
         completed_at = ?, updated_at = ?
     WHERE request_id = ? AND request_hash = ? AND state = 'started'`,
  ).run(
    input.councilRunId,
    input.responseHash,
    input.now,
    input.now,
    input.requestId,
    input.requestHash,
  );
  if (result.changes !== 1) {
    throw new Error("Learn planning checkpoint could not be completed exactly once.");
  }
}

export function materializeLegacyPlanningCheckpoint(
  database: Database.Database,
  input: {
    requestId: string;
    originJobId: string;
    gardenId: string;
    stageKey: string;
    semanticAttempt: number;
    requestHash: string;
    councilRunId: string;
    responseHash: string;
    now: string;
  },
): void {
  database.prepare(
    `INSERT INTO learn_planning_request_checkpoints (
       request_id, job_id, garden_id, stage_key, semantic_attempt,
       request_hash, result_origin, state, council_run_id, response_hash,
       created_at, updated_at, completed_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'legacy', 'completed', ?, ?, ?, ?, ?)`,
  ).run(
    input.requestId,
    input.originJobId,
    input.gardenId,
    input.stageKey,
    input.semanticAttempt,
    input.requestHash,
    input.councilRunId,
    input.responseHash,
    input.now,
    input.now,
    input.now,
  );
}

const PRIOR_JOB_PROJECTION = `
  j.garden_id AS job_garden_id,
  j.status AS job_status,
  j.current_step AS job_current_step,
  j.error AS job_error,
  j.user_id AS job_user_id,
  j.model AS job_model,
  j.source_set_hash AS job_source_set_hash,
  j.source_ids_json AS job_source_ids_json,
  j.syllabus_source_id AS job_syllabus_source_id,
  j.source_only AS job_source_only,
  j.include_source_snapshots AS job_include_source_snapshots,
  j.created_at AS job_created_at,
  j.updated_at AS job_updated_at,
  u.started_requests,
  u.completed_requests,
  u.reported_requests,
  u.request_model,
  u.reasoning_effort,
  u.reasoning_summary,
  u.policy_observed_requests,
  u.policy_mismatch_requests,
  u.usage_updated_at,
  (SELECT COUNT(*) FROM learn_maps m WHERE m.job_id = j.id) AS map_count,
  (SELECT COUNT(*) FROM learn_versions v WHERE v.job_id = j.id) AS version_count
`;

export function priorPlanningCheckpoints(
  database: Database.Database,
  input: {
    currentJobId: string;
    gardenId: string;
    stageKey: string;
    semanticAttempt: number;
  },
): PriorPlanningCheckpointRow[] {
  // Validate every member before suppressing older aliases. A corrupt newer
  // alias must never hide a valid origin row and turn recovery into a false
  // "no prior attempt" decision.
  const chainRows = database.prepare(
    `WITH relevant_receipts AS (
       SELECT DISTINCT COALESCE(receipt_request_id, request_id) AS receipt_id
       FROM learn_planning_request_checkpoints
       WHERE job_id <> ? AND garden_id = ?
         AND stage_key = ? AND semantic_attempt = ?
         AND result_origin = 'receipt'
     )
     SELECT c.request_id, c.job_id, c.garden_id, c.stage_key,
            c.semantic_attempt, c.request_hash,
            COALESCE(c.receipt_request_id, c.request_id) AS receipt_id,
            c.result_origin, c.state, c.council_run_id, c.response_hash,
            c.created_at AS checkpoint_created_at,
            j.garden_id AS job_garden_id, j.user_id AS job_user_id,
            j.model AS job_model, j.source_ids_json AS job_source_ids_json,
            j.syllabus_source_id AS job_syllabus_source_id,
            j.source_only AS job_source_only,
            j.include_source_snapshots AS job_include_source_snapshots,
            j.created_at AS job_created_at
     FROM learn_planning_request_checkpoints c
     JOIN relevant_receipts r
       ON r.receipt_id = COALESCE(c.receipt_request_id, c.request_id)
     JOIN learn_jobs j ON j.id = c.job_id
     ORDER BY receipt_id, c.created_at, c.request_id`,
  ).all(
    input.currentJobId,
    input.gardenId,
    input.stageKey,
    input.semanticAttempt,
  ) as Array<{
    request_id: string;
    job_id: string;
    garden_id: string;
    stage_key: string;
    semantic_attempt: number;
    request_hash: string;
    receipt_id: string;
    result_origin: string;
    state: string;
    council_run_id: string | null;
    response_hash: string | null;
    checkpoint_created_at: string;
    job_garden_id: string;
    job_user_id: number | null;
    job_model: string | null;
    job_source_ids_json: string | null;
    job_syllabus_source_id: string | null;
    job_source_only: number | null;
    job_include_source_snapshots: number | null;
    job_created_at: string;
  }>;
  const chains = new Map<string, typeof chainRows>();
  for (const row of chainRows) {
    const chain = chains.get(row.receipt_id) ?? [];
    chain.push(row);
    chains.set(row.receipt_id, chain);
  }
  for (const [receiptId, chain] of chains) {
    const base = chain[0];
    const completed = chain.filter((row) => row.state === "completed");
    const runIds = new Set(completed.map((row) => row.council_run_id));
    const responseHashes = new Set(completed.map((row) => row.response_hash));
    const invalid =
      !receiptId ||
      chain.some((row) =>
        row.result_origin !== "receipt" ||
        row.garden_id !== input.gardenId ||
        row.job_garden_id !== input.gardenId ||
        row.stage_key !== input.stageKey ||
        Number(row.semantic_attempt) !== input.semanticAttempt ||
        row.request_hash !== base.request_hash ||
        row.job_user_id !== base.job_user_id ||
        row.job_model !== base.job_model ||
        exactStringArrayJson(row.job_source_ids_json) === null ||
        exactStringArrayJson(row.job_source_ids_json) !==
          exactStringArrayJson(base.job_source_ids_json) ||
        row.job_syllabus_source_id !== base.job_syllabus_source_id ||
        Number(row.job_source_only ?? 0) !== Number(base.job_source_only ?? 0) ||
        Number(row.job_include_source_snapshots ?? 0) !==
          Number(base.job_include_source_snapshots ?? 0) ||
        !Number.isFinite(Date.parse(row.job_created_at)) ||
        !Number.isFinite(Date.parse(row.checkpoint_created_at)) ||
        Date.parse(row.job_created_at) > Date.parse(row.checkpoint_created_at) ||
        Date.parse(row.job_created_at) < Date.parse(base.job_created_at) ||
        (row.state !== "started" && row.state !== "completed")) ||
      (chain.length > 1 && chain.some((row) => row.state !== "completed")) ||
      runIds.size > 1 ||
      responseHashes.size > 1 ||
      completed.some((row) => !row.council_run_id || !row.response_hash);
    if (invalid) {
      throw new PlanningRecoveryBoundaryError("candidate_conflict");
    }
  }
  return database.prepare(
    `SELECT c.*, ${PRIOR_JOB_PROJECTION}
     FROM learn_planning_request_checkpoints c
     JOIN learn_jobs j ON j.id = c.job_id
     LEFT JOIN learn_job_token_usage u ON u.job_id = j.id
     WHERE c.job_id <> ? AND c.garden_id = ?
       AND c.stage_key = ? AND c.semantic_attempt = ?
       AND NOT EXISTS (
         SELECT 1
         FROM learn_planning_request_checkpoints newer
         WHERE COALESCE(newer.receipt_request_id, newer.request_id) =
               COALESCE(c.receipt_request_id, c.request_id)
           AND (
             newer.created_at > c.created_at OR
             (newer.created_at = c.created_at AND newer.rowid > c.rowid)
           )
       )
     ORDER BY c.created_at DESC, c.request_id DESC`,
  ).all(
    input.currentJobId,
    input.gardenId,
    input.stageKey,
    input.semanticAttempt,
  ) as PriorPlanningCheckpointRow[];
}

export function priorRecoveredPlanningJobs(
  database: Database.Database,
  input: { currentJobId: string; gardenId: string },
): PriorRecoveredPlanningJobRow[] {
  return database.prepare(
    `SELECT j.id AS job_id, j.garden_id, ${PRIOR_JOB_PROJECTION}
     FROM learn_jobs j
     LEFT JOIN learn_job_token_usage u ON u.job_id = j.id
     WHERE j.id <> ? AND j.garden_id = ?
       AND j.status = 'failed'
       AND j.current_step = 'Unresponsive Learn worker recovered; prior Learn state restored'
     ORDER BY j.created_at DESC, j.rowid DESC`,
  ).all(input.currentJobId, input.gardenId) as PriorRecoveredPlanningJobRow[];
}
