import type Database from "better-sqlite3";

export type LearnCouncilCheckpointState = "started" | "completed";
export type LearnCouncilCheckpointOrigin = "receipt" | "legacy";
export type LearnCouncilRedispatchReason =
  | "receipt_not_found"
  | "request_failed";

const SHA256_HEX = /^[0-9a-f]{64}$/;
const REQUEST_ID = /^[A-Za-z0-9_.:-]{1,256}$/;

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** Structural allowlist for the prompt-free legacy failed-outcome endpoint.
 * Model identity and route values are checked by Learn against its selected
 * model afterward; this gate prevents coercing malformed evidence first. */
export function isExactLegacyLearnCouncilFailureShape(value: unknown): boolean {
  const failure = plainRecord(value);
  const usage = plainRecord(failure?.usage);
  const routes = failure?.modelRouting;
  return Boolean(
    failure &&
      failure.outcome === "failed" &&
      failure.finalAnswerPresent === false &&
      failure.candidateCount === 0 &&
      typeof failure.councilRunId === "string" &&
      failure.councilRunId &&
      typeof failure.failureCode === "string" &&
      failure.failureCode &&
      (failure.failurePhase === null || typeof failure.failurePhase === "string") &&
      (failure.partialOutput === null || typeof failure.partialOutput === "boolean") &&
      (failure.replaySafe === null || typeof failure.replaySafe === "boolean") &&
      typeof failure.councilMode === "string" &&
      failure.councilMode &&
      typeof failure.requestedModel === "string" &&
      failure.requestedModel &&
      typeof failure.resolvedModel === "string" &&
      failure.resolvedModel &&
      usage &&
      usage.callCount === 1 &&
      (usage.reportedCallCount === 0 || usage.reportedCallCount === 1) &&
      Array.isArray(routes) &&
      routes.length === 1 &&
      routes.every((route) => plainRecord(route) !== null) &&
      typeof failure.createdAt === "string" &&
      Number.isFinite(Date.parse(failure.createdAt)) &&
      typeof failure.updatedAt === "string" &&
      Number.isFinite(Date.parse(failure.updatedAt)) &&
      Date.parse(failure.createdAt as string) <= Date.parse(failure.updatedAt as string)
  );
}

export function assertUniqueLegacyLearnCouncilFailureWithoutCompletion(
  failureCount: number,
  hasCompletedOutcome: boolean,
): void {
  if (
    !Number.isSafeInteger(failureCount) ||
    failureCount < 0 ||
    (!hasCompletedOutcome && failureCount > 1)
  ) {
    throw new Error(
      "Multiple legacy failed/no-final outcomes cannot authorize a fresh Learn Council receipt.",
    );
  }
}

export interface LearnCouncilCheckpointRow {
  checkpoint_id: string;
  receipt_request_id: string | null;
  origin_job_id: string;
  job_id: string;
  garden_id: string;
  stage_key: string;
  semantic_attempt: number;
  request_hash: string;
  result_origin: LearnCouncilCheckpointOrigin;
  state: LearnCouncilCheckpointState;
  dispatch_attempt_count: number;
  redispatch_count: number;
  redispatch_reason: LearnCouncilRedispatchReason | null;
  receipt_dispatch_count: number | null;
  council_run_id: string | null;
  response_hash: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface LearnCouncilDispatchGenerationOwnerRow {
  receipt_request_id: string;
  dispatch_generation: 1 | 2;
  job_id: string;
  checkpoint_id: string;
  request_hash: string;
  claimed_at: string;
}

export interface LearnCouncilRetryJobRow {
  id: string;
  garden_id: string;
  user_id: number | null;
  model: string | null;
  status: string;
  mode: string;
  current_step: string | null;
  error: string | null;
  requires_replan: number | null;
  confirmed_learning_map_id: string | null;
  source_set_hash: string | null;
  source_ids_json: string | null;
  syllabus_source_id: string | null;
  source_only: number | null;
  include_source_snapshots: number | null;
  created_at: string;
  updated_at: string;
  version_count: number;
}

export interface PriorLearnCouncilCheckpoint extends LearnCouncilCheckpointRow {
  job: LearnCouncilRetryJobRow;
}

export type LearnCouncilObservedCheckpointState =
  | "completed"
  | "failed"
  | "receipt_not_found"
  | "request_started";

export class LearnCouncilLineageAmbiguityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LearnCouncilLineageAmbiguityError";
  }
}

/** Select a reusable native/legacy result in deterministic failed-job order.
 * Exact terminal failure and proven pre-dispatch absence may be skipped while
 * looking for an older completion. An in-flight receipt is ambiguous and
 * fences the scan immediately. */
export async function selectNewestCompletedLearnCouncilCheckpoint(
  candidates: PriorLearnCouncilCheckpoint[],
  observe: (
    candidate: PriorLearnCouncilCheckpoint,
  ) => Promise<LearnCouncilObservedCheckpointState>,
): Promise<{
  completed: PriorLearnCouncilCheckpoint | null;
  newestIncomplete: PriorLearnCouncilCheckpoint | null;
}> {
  let previous: PriorLearnCouncilCheckpoint | null = null;
  let newestIncomplete: PriorLearnCouncilCheckpoint | null = null;
  for (const candidate of candidates) {
    const createdAt = Date.parse(candidate.job.created_at);
    const previousCreatedAt = previous ? Date.parse(previous.job.created_at) : null;
    if (
      !Number.isFinite(createdAt) ||
      (previousCreatedAt !== null &&
        (!Number.isFinite(previousCreatedAt) ||
          createdAt > previousCreatedAt ||
          (createdAt === previousCreatedAt && candidate.job.id !== previous!.job.id)))
    ) {
      throw new LearnCouncilLineageAmbiguityError(
        "Prior ordinary Learn checkpoint ordering is ambiguous.",
      );
    }
    previous = candidate;
    const state = candidate.state === "completed"
      ? "completed"
      : await observe(candidate);
    if (state === "completed") {
      return { completed: candidate, newestIncomplete };
    }
    if (state === "request_started") {
      throw new LearnCouncilLineageAmbiguityError(
        "A newer ordinary Learn receipt is still started; older results cannot be adopted.",
      );
    }
    newestIncomplete ??= candidate;
  }
  return { completed: null, newestIncomplete };
}

export interface LegacyLearnCouncilFailureProof {
  councilRunId: string;
  failureCode: string;
  failurePhase: string | null;
  partialOutput: boolean | null;
  replaySafe: boolean | null;
  councilMode: string;
  requestedModel: string;
  resolvedModel: string;
  callCount: number;
  reportedCallCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface NativeLearnCouncilBoundaryProof {
  outcome: "request_failed" | "receipt_not_found";
  receiptRequestId: string;
  dispatchGeneration: number | null;
  dispatchCount: number | null;
  redispatchCount: number | null;
  redispatchAllowed: boolean | null;
  failureCode: string | null;
}

function canonicalStringArrayJson(value: string | null): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    if (
      !Array.isArray(parsed) ||
      !parsed.every((entry) => typeof entry === "string")
    ) {
      return null;
    }
    return JSON.stringify(parsed);
  } catch {
    return null;
  }
}

function assertRequestId(value: string, label: string): void {
  if (!REQUEST_ID.test(value)) throw new Error(`${label} is invalid.`);
}

function assertRequestHash(value: string): void {
  if (!SHA256_HEX.test(value)) {
    throw new Error("Learn Council checkpoint request hash is invalid.");
  }
}

function assertStage(input: {
  stageKey: string;
  semanticAttempt: number;
}): void {
  if (!input.stageKey || input.stageKey.length > 1_000) {
    throw new Error("Learn Council checkpoint stage key is invalid.");
  }
  if (
    !Number.isSafeInteger(input.semanticAttempt) ||
    input.semanticAttempt < 0
  ) {
    throw new Error("Learn Council checkpoint semantic attempt is invalid.");
  }
}

function validTimeOrder(origin: LearnCouncilRetryJobRow, current: LearnCouncilRetryJobRow): boolean {
  const originCreatedAt = Date.parse(origin.created_at);
  const originUpdatedAt = Date.parse(origin.updated_at);
  const currentCreatedAt = Date.parse(current.created_at);
  return (
    Number.isFinite(originCreatedAt) &&
    Number.isFinite(originUpdatedAt) &&
    Number.isFinite(currentCreatedAt) &&
    originCreatedAt <= originUpdatedAt &&
    originUpdatedAt <= currentCreatedAt
  );
}

/** Immutable workflow fence for cross-job Council-result adoption.
 *
 * The exact request hash binds the complete effective prompt, Council mode,
 * model and reasoning policy.  This independent job fence prevents an equal
 * hash from an unrelated user/selection/map epoch from becoming a retry
 * candidate.  A prior committed Learn version is never a failed retry source.
 */
export function exactLearnCouncilRetryJobBinding(
  origin: LearnCouncilRetryJobRow,
  current: LearnCouncilRetryJobRow,
): boolean {
  const originSources = canonicalStringArrayJson(origin.source_ids_json);
  const currentSources = canonicalStringArrayJson(current.source_ids_json);
  return Boolean(
    origin.id !== current.id &&
      origin.status === "failed" &&
      !Number(origin.requires_replan ?? 0) &&
      origin.version_count === 0 &&
      !["failed", "cancelled", "complete"].includes(current.status) &&
      origin.garden_id === current.garden_id &&
      origin.user_id === current.user_id &&
      origin.model === current.model &&
      origin.mode === current.mode &&
      origin.confirmed_learning_map_id === current.confirmed_learning_map_id &&
      typeof origin.source_set_hash === "string" &&
      SHA256_HEX.test(origin.source_set_hash) &&
      origin.source_set_hash === current.source_set_hash &&
      originSources !== null &&
      currentSources !== null &&
      originSources === currentSources &&
      origin.syllabus_source_id === current.syllabus_source_id &&
      Number(origin.source_only ?? 0) === Number(current.source_only ?? 0) &&
      Number(origin.include_source_snapshots ?? 0) ===
        Number(current.include_source_snapshots ?? 0) &&
      validTimeOrder(origin, current),
  );
}

export function ensureLearnCouncilCheckpointSchema(
  database: Database.Database,
): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS learn_council_request_checkpoints (
      checkpoint_id          TEXT PRIMARY KEY,
      receipt_request_id     TEXT,
      origin_job_id          TEXT NOT NULL REFERENCES learn_jobs(id) ON DELETE CASCADE,
      job_id                 TEXT NOT NULL REFERENCES learn_jobs(id) ON DELETE CASCADE,
      garden_id              TEXT NOT NULL,
      stage_key              TEXT NOT NULL,
      semantic_attempt       INTEGER NOT NULL CHECK (semantic_attempt >= 0),
      request_hash           TEXT NOT NULL CHECK (length(request_hash) = 64),
      result_origin          TEXT NOT NULL CHECK (result_origin IN ('receipt', 'legacy')),
      state                  TEXT NOT NULL CHECK (state IN ('started', 'completed')),
      dispatch_attempt_count INTEGER NOT NULL CHECK (dispatch_attempt_count BETWEEN 0 AND 2),
      redispatch_count       INTEGER NOT NULL CHECK (redispatch_count BETWEEN 0 AND 1),
      redispatch_reason      TEXT CHECK (
        redispatch_reason IS NULL OR
        redispatch_reason IN ('receipt_not_found', 'request_failed')
      ),
      receipt_dispatch_count INTEGER CHECK (
        receipt_dispatch_count IS NULL OR receipt_dispatch_count BETWEEN 1 AND 2
      ),
      council_run_id         TEXT,
      response_hash          TEXT,
      created_at             TEXT NOT NULL,
      updated_at             TEXT NOT NULL,
      completed_at           TEXT,
      UNIQUE(job_id, stage_key, semantic_attempt),
      CHECK (
        (result_origin = 'receipt' AND receipt_request_id IS NOT NULL AND dispatch_attempt_count >= 1)
        OR
        (result_origin = 'legacy' AND receipt_request_id IS NULL AND dispatch_attempt_count = 0
          AND redispatch_count = 0 AND redispatch_reason IS NULL
          AND receipt_dispatch_count IS NULL)
      ),
      CHECK (
        (redispatch_count = 0 AND redispatch_reason IS NULL)
        OR
        (redispatch_count = 1 AND redispatch_reason IS NOT NULL AND dispatch_attempt_count = 2)
      ),
      CHECK (
        (state = 'started' AND result_origin = 'receipt'
          AND council_run_id IS NULL AND response_hash IS NULL
          AND receipt_dispatch_count IS NULL AND completed_at IS NULL)
        OR
        (state = 'completed' AND council_run_id IS NOT NULL
          AND response_hash IS NOT NULL AND completed_at IS NOT NULL)
      )
    );

    CREATE INDEX IF NOT EXISTS idx_learn_council_checkpoint_stage
      ON learn_council_request_checkpoints(
        garden_id, stage_key, semantic_attempt, created_at
      );

    CREATE INDEX IF NOT EXISTS idx_learn_council_checkpoint_receipt
      ON learn_council_request_checkpoints(receipt_request_id, created_at)
      WHERE receipt_request_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS learn_council_dispatch_generation_owners (
      receipt_request_id TEXT NOT NULL,
      dispatch_generation INTEGER NOT NULL CHECK (dispatch_generation IN (1, 2)),
      job_id             TEXT NOT NULL REFERENCES learn_jobs(id) ON DELETE CASCADE,
      checkpoint_id      TEXT NOT NULL REFERENCES learn_council_request_checkpoints(checkpoint_id) ON DELETE CASCADE,
      request_hash       TEXT NOT NULL CHECK (length(request_hash) = 64),
      claimed_at         TEXT NOT NULL,
      PRIMARY KEY (receipt_request_id, dispatch_generation),
      UNIQUE(checkpoint_id, dispatch_generation)
    );

    CREATE INDEX IF NOT EXISTS idx_learn_council_dispatch_owner_job
      ON learn_council_dispatch_generation_owners(job_id, claimed_at);

    CREATE TABLE IF NOT EXISTS learn_council_legacy_failure_proofs (
      proof_id                TEXT PRIMARY KEY,
      origin_job_id           TEXT NOT NULL REFERENCES learn_jobs(id) ON DELETE CASCADE,
      authorized_job_id       TEXT NOT NULL REFERENCES learn_jobs(id) ON DELETE CASCADE,
      garden_id               TEXT NOT NULL,
      stage_key               TEXT NOT NULL,
      semantic_attempt        INTEGER NOT NULL CHECK (semantic_attempt >= 0),
      request_hash            TEXT NOT NULL CHECK (length(request_hash) = 64),
      council_run_id          TEXT NOT NULL,
      outcome                 TEXT NOT NULL DEFAULT 'failed' CHECK (outcome = 'failed'),
      final_answer_present    INTEGER NOT NULL DEFAULT 0 CHECK (final_answer_present = 0),
      candidate_count         INTEGER NOT NULL DEFAULT 0 CHECK (candidate_count = 0),
      failure_code            TEXT NOT NULL,
      failure_phase           TEXT,
      partial_output          INTEGER CHECK (partial_output IS NULL OR partial_output IN (0, 1)),
      replay_safe             INTEGER CHECK (replay_safe IS NULL OR replay_safe IN (0, 1)),
      council_mode            TEXT NOT NULL,
      requested_model         TEXT NOT NULL,
      resolved_model          TEXT NOT NULL,
      call_count              INTEGER NOT NULL CHECK (call_count >= 0),
      reported_call_count     INTEGER NOT NULL CHECK (reported_call_count >= 0),
      outcome_created_at      TEXT NOT NULL,
      outcome_updated_at      TEXT NOT NULL,
      observed_at             TEXT NOT NULL,
      UNIQUE(authorized_job_id, stage_key, semantic_attempt),
      UNIQUE(origin_job_id, stage_key, semantic_attempt, request_hash, council_run_id)
    );

    CREATE TABLE IF NOT EXISTS learn_council_legacy_boundary_adoptions (
      adoption_id             TEXT PRIMARY KEY,
      proof_id                TEXT NOT NULL REFERENCES learn_council_legacy_failure_proofs(proof_id) ON DELETE CASCADE,
      source_job_id           TEXT NOT NULL REFERENCES learn_jobs(id) ON DELETE CASCADE,
      authorized_job_id       TEXT NOT NULL REFERENCES learn_jobs(id) ON DELETE CASCADE,
      garden_id               TEXT NOT NULL,
      stage_key               TEXT NOT NULL,
      semantic_attempt        INTEGER NOT NULL CHECK (semantic_attempt >= 0),
      request_hash            TEXT NOT NULL CHECK (length(request_hash) = 64),
      observed_at             TEXT NOT NULL,
      UNIQUE(authorized_job_id, stage_key, semantic_attempt),
      UNIQUE(proof_id, authorized_job_id)
    );

    CREATE TABLE IF NOT EXISTS learn_council_missing_receipt_recoveries (
      claim_id                 TEXT PRIMARY KEY,
      receipt_request_id       TEXT NOT NULL UNIQUE,
      authorized_job_id        TEXT NOT NULL REFERENCES learn_jobs(id) ON DELETE CASCADE,
      garden_id                TEXT NOT NULL,
      stage_key                TEXT NOT NULL,
      semantic_attempt         INTEGER NOT NULL CHECK (semantic_attempt >= 0),
      request_hash             TEXT NOT NULL CHECK (length(request_hash) = 64),
      claimed_at               TEXT NOT NULL,
      UNIQUE(authorized_job_id, stage_key, semantic_attempt)
    );

    CREATE TABLE IF NOT EXISTS learn_council_native_lineage_boundaries (
      boundary_id             TEXT PRIMARY KEY,
      origin_job_id           TEXT NOT NULL REFERENCES learn_jobs(id) ON DELETE CASCADE,
      authorized_job_id       TEXT NOT NULL REFERENCES learn_jobs(id) ON DELETE CASCADE,
      garden_id               TEXT NOT NULL,
      stage_key               TEXT NOT NULL,
      semantic_attempt        INTEGER NOT NULL CHECK (semantic_attempt >= 0),
      request_hash            TEXT NOT NULL CHECK (length(request_hash) = 64),
      receipt_request_id      TEXT NOT NULL,
      outcome                 TEXT NOT NULL CHECK (outcome IN ('request_failed', 'receipt_not_found')),
      dispatch_generation     INTEGER CHECK (dispatch_generation IS NULL OR dispatch_generation IN (1, 2)),
      dispatch_count          INTEGER CHECK (dispatch_count IS NULL OR dispatch_count IN (1, 2)),
      redispatch_count        INTEGER CHECK (redispatch_count IS NULL OR redispatch_count IN (0, 1)),
      redispatch_allowed      INTEGER CHECK (redispatch_allowed IS NULL OR redispatch_allowed IN (0, 1)),
      failure_code            TEXT,
      observed_at             TEXT NOT NULL,
      UNIQUE(authorized_job_id, stage_key, semantic_attempt),
      UNIQUE(receipt_request_id, authorized_job_id),
      CHECK (
        (outcome = 'receipt_not_found' AND dispatch_generation IS NULL
          AND dispatch_count IS NULL AND redispatch_count IS NULL
          AND redispatch_allowed IS NULL AND failure_code IS NULL)
        OR
        (outcome = 'request_failed' AND dispatch_generation IS NOT NULL
          AND dispatch_count = dispatch_generation
          AND redispatch_count = dispatch_count - 1
          AND redispatch_allowed IS NOT NULL AND failure_code IS NOT NULL)
      )
    );
  `);

  // Generation 1 is provably bound by the receipt-id checkpoint. Never infer
  // historical generation-2 ownership from later job aliases: an alias may be
  // a post-completion adopter rather than the worker that actually dispatched.
  database.exec(`
    INSERT OR IGNORE INTO learn_council_dispatch_generation_owners (
      receipt_request_id, dispatch_generation, job_id, checkpoint_id,
      request_hash, claimed_at
    )
    SELECT receipt_request_id, 1, job_id, checkpoint_id, request_hash, created_at
    FROM learn_council_request_checkpoints
    WHERE result_origin = 'receipt'
      AND checkpoint_id = receipt_request_id;

  `);
}

const JOB_PROJECTION = `
  j.id,
  j.garden_id,
  j.user_id,
  j.model,
  j.status,
  j.mode,
  j.current_step,
  j.error,
  j.requires_replan,
  j.confirmed_learning_map_id,
  j.source_set_hash,
  j.source_ids_json,
  j.syllabus_source_id,
  j.source_only,
  j.include_source_snapshots,
  j.created_at,
  j.updated_at,
  (SELECT COUNT(*) FROM learn_versions v WHERE v.job_id = j.id) AS version_count
`;

const GENERATION_SETUP_FAILED_BEFORE_MODEL_TRACKING_STEP =
  "Generation could not start";
export const LEARN_COUNCIL_PRE_DISPATCH_FAILURE_STEP =
  "Lesson generation failed before first Council dispatch";
const LEGACY_ABSENCE_PRE_DISPATCH_ERROR =
  "Prior exact Learn jobs are not durably quiescent or have no completed failure boundary; 404 absence cannot authorize a model request.";

/** Positive terminal-row evidence that a strict generation worker stopped
 * before it could issue its first ordinary Council request. Callers must also
 * verify that the job has no native planning or ordinary receipt. The setup
 * step is written only by the pre-model-tracking setup catch; the dedicated
 * failure step is written after a strict recovery error with no native
 * ordinary checkpoint. The exact legacy error recognizes jobs written by the
 * immediately preceding runtime, before the dedicated step existed. */
export function hasDurableLearnCouncilNoDispatchBoundary(
  job: LearnCouncilRetryJobRow,
): boolean {
  if (job.status !== "failed" || Number(job.version_count) !== 0) return false;
  if (job.current_step === GENERATION_SETUP_FAILED_BEFORE_MODEL_TRACKING_STEP) {
    return true;
  }
  if (job.current_step === LEARN_COUNCIL_PRE_DISPATCH_FAILURE_STEP) return true;
  return (
    job.error === LEGACY_ABSENCE_PRE_DISPATCH_ERROR &&
    Boolean(job.current_step?.startsWith(
      "Lesson generation failed; last internal step:",
    ))
  );
}

export function learnCouncilRetryJob(
  database: Database.Database,
  jobId: string,
): LearnCouncilRetryJobRow | null {
  return (database.prepare(
    `SELECT ${JOB_PROJECTION} FROM learn_jobs j WHERE j.id = ?`,
  ).get(jobId) as LearnCouncilRetryJobRow | undefined) ?? null;
}

export function exactFailedLearnCouncilLineage(
  database: Database.Database,
  currentJobId: string,
): LearnCouncilRetryJobRow[] {
  const current = learnCouncilRetryJob(database, currentJobId);
  if (!current) throw new Error("Current Learn Council job does not exist.");
  const prior = database.prepare(
    `SELECT ${JOB_PROJECTION}
     FROM learn_jobs j
     WHERE j.garden_id = ? AND j.id <> ? AND j.created_at <= ?
     ORDER BY j.created_at DESC, j.rowid DESC`,
  ).all(current.garden_id, current.id, current.created_at) as LearnCouncilRetryJobRow[];
  return prior.filter((candidate) =>
    exactLearnCouncilRetryJobBinding(candidate, current),
  );
}

export const LEARN_COUNCIL_LEGACY_QUIESCENCE_MS = 37 * 60_000;

/** Returns the remaining safe-observation delay for an exact legacy lineage.
 * Null means the lineage cannot become authoritative through time alone. */
export function legacyLearnCouncilLineageQuiescenceDelayMs(
  lineage: readonly LearnCouncilRetryJobRow[],
  observedAtMs: number,
): number | null {
  if (!Number.isFinite(observedAtMs)) return null;
  let remainingMs = 0;
  for (const job of lineage) {
    const createdAt = Date.parse(job.created_at);
    const updatedAt = Date.parse(job.updated_at);
    if (
      job.status !== "failed" ||
      !Number.isFinite(createdAt) ||
      !Number.isFinite(updatedAt) ||
      createdAt > updatedAt ||
      observedAtMs < updatedAt
    ) {
      return null;
    }
    remainingMs = Math.max(
      remainingMs,
      updatedAt + LEARN_COUNCIL_LEGACY_QUIESCENCE_MS - observedAtMs,
    );
  }
  return Math.max(0, remainingMs);
}

/** A legacy 404 is only meaningful after every exact predecessor is far past
 * both the Learn client deadline and the provider deadline. This prevents a
 * non-atomic ledger glob from racing a late pre-receipt writer. */
export function legacyLearnCouncilLineageIsQuiescent(
  lineage: readonly LearnCouncilRetryJobRow[],
  observedAtMs: number,
): boolean {
  return legacyLearnCouncilLineageQuiescenceDelayMs(lineage, observedAtMs) === 0;
}

function checkpointRowsForReceipt(
  database: Database.Database,
  receiptRequestId: string,
): LearnCouncilCheckpointRow[] {
  assertRequestId(receiptRequestId, "Learn Council receipt request id");
  return database.prepare(
    `SELECT * FROM learn_council_request_checkpoints
     WHERE receipt_request_id = ?
     ORDER BY created_at, rowid`,
  ).all(receiptRequestId) as LearnCouncilCheckpointRow[];
}

export function learnCouncilDispatchGenerationOwners(
  database: Database.Database,
  receiptRequestId: string,
): LearnCouncilDispatchGenerationOwnerRow[] {
  assertRequestId(receiptRequestId, "Learn Council receipt request id");
  return database.prepare(
    `SELECT receipt_request_id, dispatch_generation, job_id, checkpoint_id,
            request_hash, claimed_at
     FROM learn_council_dispatch_generation_owners
     WHERE receipt_request_id = ?
     ORDER BY dispatch_generation`,
  ).all(receiptRequestId) as LearnCouncilDispatchGenerationOwnerRow[];
}

function recordLearnCouncilDispatchGenerationOwner(
  database: Database.Database,
  input: {
    receiptRequestId: string;
    dispatchGeneration: 1 | 2;
    jobId: string;
    checkpointId: string;
    requestHash: string;
    now: string;
  },
): void {
  const existing = learnCouncilDispatchGenerationOwners(
    database,
    input.receiptRequestId,
  ).find((row) => row.dispatch_generation === input.dispatchGeneration);
  if (existing) {
    if (
      existing.job_id !== input.jobId ||
      existing.checkpoint_id !== input.checkpointId ||
      existing.request_hash !== input.requestHash
    ) {
      throw new Error("Learn Council dispatch generation owner conflicts.");
    }
    return;
  }
  database.prepare(
    `INSERT INTO learn_council_dispatch_generation_owners (
       receipt_request_id, dispatch_generation, job_id, checkpoint_id,
       request_hash, claimed_at
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    input.receiptRequestId,
    input.dispatchGeneration,
    input.jobId,
    input.checkpointId,
    input.requestHash,
    input.now,
  );
}

function assertExactReceiptChain(rows: LearnCouncilCheckpointRow[]): void {
  const first = rows[0];
  if (!first || !first.receipt_request_id) {
    throw new Error("Learn Council receipt chain is missing.");
  }
  assertRequestId(first.receipt_request_id, "Learn Council receipt request id");
  assertRequestHash(first.request_hash);
  const completed = rows.filter((row) => row.state === "completed");
  const invalid = rows.some((row) =>
    row.result_origin !== "receipt" ||
    row.receipt_request_id !== first.receipt_request_id ||
    row.origin_job_id !== first.origin_job_id ||
    row.garden_id !== first.garden_id ||
    row.stage_key !== first.stage_key ||
    Number(row.semantic_attempt) !== Number(first.semantic_attempt) ||
    row.request_hash !== first.request_hash ||
    Number(row.dispatch_attempt_count) !== Number(first.dispatch_attempt_count) ||
    Number(row.redispatch_count) !== Number(first.redispatch_count) ||
    row.redispatch_reason !== first.redispatch_reason ||
    row.receipt_dispatch_count !== first.receipt_dispatch_count ||
    row.state !== first.state ||
    (row.state === "completed" &&
      (row.council_run_id !== first.council_run_id ||
        row.response_hash !== first.response_hash))
  );
  if (
    invalid ||
    completed.length !== (first.state === "completed" ? rows.length : 0) ||
    rows.filter((row) => row.checkpoint_id === first.receipt_request_id).length !== 1
  ) {
    throw new Error("Learn Council receipt checkpoint chain conflicts.");
  }
}

export function currentLearnCouncilCheckpoint(
  database: Database.Database,
  input: {
    jobId: string;
    gardenId: string;
    stageKey: string;
    semanticAttempt: number;
  },
): LearnCouncilCheckpointRow | null {
  assertStage(input);
  const row = database.prepare(
    `SELECT * FROM learn_council_request_checkpoints
     WHERE job_id = ? AND garden_id = ? AND stage_key = ? AND semantic_attempt = ?`,
  ).get(
    input.jobId,
    input.gardenId,
    input.stageKey,
    input.semanticAttempt,
  ) as LearnCouncilCheckpointRow | undefined;
  if (row?.receipt_request_id) {
    assertExactReceiptChain(
      checkpointRowsForReceipt(database, row.receipt_request_id),
    );
  }
  return row ?? null;
}

export function priorLearnCouncilCheckpoints(
  database: Database.Database,
  input: {
    currentJobId: string;
    gardenId: string;
    stageKey: string;
    semanticAttempt: number;
  },
): PriorLearnCouncilCheckpoint[] {
  assertStage(input);
  const current = learnCouncilRetryJob(database, input.currentJobId);
  if (!current || current.garden_id !== input.gardenId) {
    throw new Error("Current Learn Council checkpoint job binding is invalid.");
  }
  const rows = database.prepare(
    `SELECT c.*,
            j.id AS job__id,
            j.garden_id AS job__garden_id,
            j.user_id AS job__user_id,
            j.model AS job__model,
            j.status AS job__status,
            j.mode AS job__mode,
            j.current_step AS job__current_step,
            j.error AS job__error,
            j.requires_replan AS job__requires_replan,
            j.confirmed_learning_map_id AS job__confirmed_learning_map_id,
            j.source_set_hash AS job__source_set_hash,
            j.source_ids_json AS job__source_ids_json,
            j.syllabus_source_id AS job__syllabus_source_id,
            j.source_only AS job__source_only,
            j.include_source_snapshots AS job__include_source_snapshots,
            j.created_at AS job__created_at,
            j.updated_at AS job__updated_at,
            (SELECT COUNT(*) FROM learn_versions v WHERE v.job_id = j.id)
              AS job__version_count
     FROM learn_council_request_checkpoints c
     JOIN learn_jobs j ON j.id = c.job_id
     WHERE c.job_id <> ? AND c.garden_id = ?
       AND c.stage_key = ? AND c.semantic_attempt = ?
     ORDER BY j.created_at DESC, c.created_at DESC, c.rowid DESC`,
  ).all(
    input.currentJobId,
    input.gardenId,
    input.stageKey,
    input.semanticAttempt,
  ) as Array<LearnCouncilCheckpointRow & Record<`job__${string}`, unknown>>;

  const latestByOrigin = new Map<string, PriorLearnCouncilCheckpoint>();
  for (const raw of rows) {
    const key = raw.receipt_request_id ?? `legacy:${raw.origin_job_id}`;
    if (latestByOrigin.has(key)) continue;
    if (raw.receipt_request_id) {
      assertExactReceiptChain(
        checkpointRowsForReceipt(database, raw.receipt_request_id),
      );
    }
    const job: LearnCouncilRetryJobRow = {
      id: String(raw.job__id),
      garden_id: String(raw.job__garden_id),
      user_id: raw.job__user_id === null ? null : Number(raw.job__user_id),
      model: raw.job__model === null ? null : String(raw.job__model),
      status: String(raw.job__status),
      mode: String(raw.job__mode),
      current_step: raw.job__current_step === null
        ? null
        : String(raw.job__current_step),
      error: raw.job__error === null ? null : String(raw.job__error),
      requires_replan: raw.job__requires_replan === null
        ? null
        : Number(raw.job__requires_replan),
      confirmed_learning_map_id: raw.job__confirmed_learning_map_id === null
        ? null
        : String(raw.job__confirmed_learning_map_id),
      source_set_hash: raw.job__source_set_hash === null
        ? null
        : String(raw.job__source_set_hash),
      source_ids_json: raw.job__source_ids_json === null
        ? null
        : String(raw.job__source_ids_json),
      syllabus_source_id: raw.job__syllabus_source_id === null
        ? null
        : String(raw.job__syllabus_source_id),
      source_only: raw.job__source_only === null ? null : Number(raw.job__source_only),
      include_source_snapshots: raw.job__include_source_snapshots === null
        ? null
        : Number(raw.job__include_source_snapshots),
      created_at: String(raw.job__created_at),
      updated_at: String(raw.job__updated_at),
      version_count: Number(raw.job__version_count),
    };
    const checkpoint = Object.fromEntries(
      Object.entries(raw).filter(([name]) => !name.startsWith("job__")),
    ) as unknown as LearnCouncilCheckpointRow;
    latestByOrigin.set(key, { ...checkpoint, job });
  }
  return [...latestByOrigin.values()];
}

export function createStartedLearnCouncilCheckpoint(
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
): LearnCouncilCheckpointRow {
  assertRequestId(input.requestId, "Learn Council request id");
  assertRequestHash(input.requestHash);
  assertStage(input);
  return database.transaction(() => {
    database.prepare(
      `INSERT INTO learn_council_request_checkpoints (
         checkpoint_id, receipt_request_id, origin_job_id, job_id, garden_id,
         stage_key, semantic_attempt, request_hash, result_origin, state,
         dispatch_attempt_count, redispatch_count, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'receipt', 'started', 1, 0, ?, ?)`,
    ).run(
      input.requestId,
      input.requestId,
      input.jobId,
      input.jobId,
      input.gardenId,
      input.stageKey,
      input.semanticAttempt,
      input.requestHash,
      input.now,
      input.now,
    );
    recordLearnCouncilDispatchGenerationOwner(database, {
      receiptRequestId: input.requestId,
      dispatchGeneration: 1,
      jobId: input.jobId,
      checkpointId: input.requestId,
      requestHash: input.requestHash,
      now: input.now,
    });
    return currentLearnCouncilCheckpoint(database, input)!;
  }).immediate();
}

/** Claim the sole retry of an HTTP request which the server proves never
 * created a receipt. This is a pre-provider transport recovery, not Council
 * generation 2, so it must not consume the failed-result redispatch counter. */
export function claimLearnCouncilMissingReceiptRecovery(
  database: Database.Database,
  input: {
    claimId: string;
    checkpointId: string;
    source: LearnCouncilCheckpointRow;
    jobId: string;
    gardenId: string;
    stageKey: string;
    semanticAttempt: number;
    requestHash: string;
    now: string;
    beforeOwnerTransfer?: (
      priorOwnerJobId: string,
      receiptRequestId: string,
      requestHash: string,
    ) => void;
  },
): LearnCouncilCheckpointRow {
  assertRequestId(input.claimId, "Learn Council missing-receipt claim id");
  assertRequestId(input.checkpointId, "Learn Council recovery checkpoint id");
  assertRequestHash(input.requestHash);
  assertStage(input);
  if (!input.source.receipt_request_id) {
    throw new Error("Missing-receipt recovery requires a strict receipt id.");
  }
  return database.transaction(() => {
    const rows = checkpointRowsForReceipt(
      database,
      input.source.receipt_request_id!,
    );
    assertExactReceiptChain(rows);
    const first = rows[0];
    const isUnclaimedNative =
      first.state === "started" &&
      first.dispatch_attempt_count === 1 &&
      first.redispatch_count === 0 &&
      first.redispatch_reason === null;
    const isLegacyMissingClaim =
      first.state === "started" &&
      first.dispatch_attempt_count === 2 &&
      first.redispatch_count === 1 &&
      first.redispatch_reason === "receipt_not_found";
    if (
      (!isUnclaimedNative && !isLegacyMissingClaim) ||
      first.garden_id !== input.gardenId ||
      first.stage_key !== input.stageKey ||
      Number(first.semantic_attempt) !== input.semanticAttempt ||
      first.request_hash !== input.requestHash
    ) {
      throw new Error("Learn Council receipt has no exact missing-receipt authority.");
    }

    const current = database.prepare(
      `SELECT * FROM learn_council_request_checkpoints
       WHERE job_id = ? AND stage_key = ? AND semantic_attempt = ?`,
    ).get(input.jobId, input.stageKey, input.semanticAttempt) as
      | LearnCouncilCheckpointRow
      | undefined;
    if (!current) {
      database.prepare(
        `INSERT INTO learn_council_request_checkpoints (
           checkpoint_id, receipt_request_id, origin_job_id, job_id, garden_id,
           stage_key, semantic_attempt, request_hash, result_origin, state,
           dispatch_attempt_count, redispatch_count, redispatch_reason,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'receipt', 'started', ?, ?, ?, ?, ?)`,
      ).run(
        input.checkpointId,
        first.receipt_request_id,
        first.origin_job_id,
        input.jobId,
        input.gardenId,
        input.stageKey,
        input.semanticAttempt,
        input.requestHash,
        first.dispatch_attempt_count,
        first.redispatch_count,
        first.redispatch_reason,
        input.now,
        input.now,
      );
    } else if (
      current.receipt_request_id !== first.receipt_request_id ||
      current.garden_id !== input.gardenId ||
      current.request_hash !== input.requestHash ||
      current.state !== "started"
    ) {
      throw new Error("Learn Council missing-receipt current-job alias conflicts.");
    }

    const claims = database.prepare(
      `SELECT * FROM learn_council_missing_receipt_recoveries
       WHERE receipt_request_id = ?
          OR (authorized_job_id = ? AND stage_key = ? AND semantic_attempt = ?)
       ORDER BY rowid`,
    ).all(
      first.receipt_request_id,
      input.jobId,
      input.stageKey,
      input.semanticAttempt,
    ) as Array<Record<string, unknown>>;
    if (claims.length > 0) {
      const claimOwnerJobId = String(claims[0]?.authorized_job_id ?? "");
      const exact = claims.length === 1 &&
        claims[0].receipt_request_id === first.receipt_request_id &&
        (claimOwnerJobId === input.jobId ||
          claimOwnerJobId === input.source.job_id) &&
        claims[0].garden_id === input.gardenId &&
        claims[0].stage_key === input.stageKey &&
        Number(claims[0].semantic_attempt) === input.semanticAttempt &&
        claims[0].request_hash === input.requestHash;
      if (!exact) {
        throw new Error("Learn Council missing-receipt recovery claim conflicts.");
      }
      if (claimOwnerJobId !== input.jobId) {
        const claimTransfer = database.prepare(
          `UPDATE learn_council_missing_receipt_recoveries
           SET authorized_job_id = ?, claimed_at = ?
           WHERE receipt_request_id = ? AND authorized_job_id = ?
             AND garden_id = ? AND stage_key = ? AND semantic_attempt = ?
             AND request_hash = ?`,
        ).run(
          input.jobId,
          input.now,
          first.receipt_request_id,
          claimOwnerJobId,
          input.gardenId,
          input.stageKey,
          input.semanticAttempt,
          input.requestHash,
        );
        if (claimTransfer.changes !== 1) {
          throw new Error(
            "Learn Council missing-receipt claim transfer was not atomic.",
          );
        }
      }
    } else {
      database.prepare(
        `INSERT INTO learn_council_missing_receipt_recoveries (
           claim_id, receipt_request_id, authorized_job_id, garden_id,
           stage_key, semantic_attempt, request_hash, claimed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        input.claimId,
        first.receipt_request_id,
        input.jobId,
        input.gardenId,
        input.stageKey,
        input.semanticAttempt,
        input.requestHash,
        input.now,
      );
    }
    const currentOwnerCheckpoint = currentLearnCouncilCheckpoint(database, input);
    const generationOneOwner = learnCouncilDispatchGenerationOwners(
      database,
      first.receipt_request_id!,
    ).find((row) => Number(row.dispatch_generation) === 1);
    if (
      !currentOwnerCheckpoint ||
      !generationOneOwner ||
      generationOneOwner.request_hash !== input.requestHash
    ) {
      throw new Error("Learn Council missing receipt has no exact generation owner.");
    }
    if (
      generationOneOwner.job_id !== input.jobId ||
      generationOneOwner.checkpoint_id !== currentOwnerCheckpoint.checkpoint_id
    ) {
      if (!input.beforeOwnerTransfer) {
        throw new Error(
          "Learn Council missing-receipt transfer has no atomic usage cleanup.",
        );
      }
      input.beforeOwnerTransfer(
        generationOneOwner.job_id,
        first.receipt_request_id!,
        input.requestHash,
      );
      const ownerUpdate = database.prepare(
        `UPDATE learn_council_dispatch_generation_owners
         SET job_id = ?, checkpoint_id = ?, claimed_at = ?
         WHERE receipt_request_id = ? AND dispatch_generation = 1
           AND job_id = ? AND checkpoint_id = ? AND request_hash = ?`,
      ).run(
        input.jobId,
        currentOwnerCheckpoint.checkpoint_id,
        input.now,
        first.receipt_request_id,
        generationOneOwner.job_id,
        generationOneOwner.checkpoint_id,
        input.requestHash,
      );
      if (ownerUpdate.changes !== 1) {
        throw new Error("Learn Council missing-receipt ownership was not atomic.");
      }
    }
    return currentLearnCouncilCheckpoint(database, input)!;
  }).immediate();
}

/** Persist the positive, prompt-free legacy failure proof and the first
 * strict-receipt epoch in one SQLite transaction.  Neither a 404 nor inferred
 * absence can call this function: the caller must supply the endpoint's
 * validated zero-candidate/final-answer-absent terminal outcome. */
export function createStartedLearnCouncilCheckpointAfterLegacyFailure(
  database: Database.Database,
  input: {
    proofId: string;
    requestId: string;
    originJobId: string;
    jobId: string;
    gardenId: string;
    stageKey: string;
    semanticAttempt: number;
    requestHash: string;
    proof: LegacyLearnCouncilFailureProof;
    now: string;
  },
): LearnCouncilCheckpointRow {
  assertRequestId(input.proofId, "Legacy Learn Council proof id");
  assertRequestId(input.requestId, "Learn Council request id");
  assertRequestId(input.proof.councilRunId, "Legacy Learn Council run id");
  assertRequestHash(input.requestHash);
  assertStage(input);
  if (
    !input.proof.failureCode ||
    !input.proof.councilMode ||
    !input.proof.requestedModel ||
    !input.proof.resolvedModel ||
    !Number.isSafeInteger(input.proof.callCount) ||
    input.proof.callCount < 0 ||
    !Number.isSafeInteger(input.proof.reportedCallCount) ||
    input.proof.reportedCallCount < 0 ||
    input.proof.reportedCallCount > input.proof.callCount ||
    !Number.isFinite(Date.parse(input.proof.createdAt)) ||
    !Number.isFinite(Date.parse(input.proof.updatedAt)) ||
    Date.parse(input.proof.createdAt) > Date.parse(input.proof.updatedAt)
  ) {
    throw new Error("Legacy Learn Council failure proof is invalid.");
  }
  return database.transaction(() => {
    recordLegacyLearnCouncilFailureProof(database, input);
    return createStartedLearnCouncilCheckpoint(database, input);
  }).immediate();
}

interface LegacyLearnCouncilFailureProofInput {
  proofId: string;
  originJobId: string;
  jobId: string;
  gardenId: string;
  stageKey: string;
  semanticAttempt: number;
  requestHash: string;
  proof: LegacyLearnCouncilFailureProof;
  now: string;
}

function assertLegacyLearnCouncilFailureProofInput(
  input: LegacyLearnCouncilFailureProofInput,
): void {
  assertRequestId(input.proofId, "Legacy Learn Council proof id");
  assertRequestId(input.proof.councilRunId, "Legacy Learn Council run id");
  assertRequestHash(input.requestHash);
  assertStage(input);
  if (
    !input.proof.failureCode ||
    !input.proof.councilMode ||
    !input.proof.requestedModel ||
    !input.proof.resolvedModel ||
    !Number.isSafeInteger(input.proof.callCount) ||
    input.proof.callCount < 0 ||
    !Number.isSafeInteger(input.proof.reportedCallCount) ||
    input.proof.reportedCallCount < 0 ||
    input.proof.reportedCallCount > input.proof.callCount ||
    !Number.isFinite(Date.parse(input.proof.createdAt)) ||
    !Number.isFinite(Date.parse(input.proof.updatedAt)) ||
    Date.parse(input.proof.createdAt) > Date.parse(input.proof.updatedAt)
  ) {
    throw new Error("Legacy Learn Council failure proof is invalid.");
  }
}

function exactLegacyLearnCouncilFailureProofRow(
  row: Record<string, unknown>,
  input: LegacyLearnCouncilFailureProofInput,
  requireCurrentAuthorization: boolean,
): boolean {
  return (
    row.origin_job_id === input.originJobId &&
    (!requireCurrentAuthorization || row.authorized_job_id === input.jobId) &&
    row.garden_id === input.gardenId &&
    row.stage_key === input.stageKey &&
    Number(row.semantic_attempt) === input.semanticAttempt &&
    row.request_hash === input.requestHash &&
    row.council_run_id === input.proof.councilRunId &&
    row.outcome === "failed" &&
    Number(row.final_answer_present) === 0 &&
    Number(row.candidate_count) === 0 &&
    row.failure_code === input.proof.failureCode &&
    row.failure_phase === input.proof.failurePhase &&
    (row.partial_output === null
      ? input.proof.partialOutput === null
      : Boolean(row.partial_output) === input.proof.partialOutput) &&
    (row.replay_safe === null
      ? input.proof.replaySafe === null
      : Boolean(row.replay_safe) === input.proof.replaySafe) &&
    row.council_mode === input.proof.councilMode &&
    row.requested_model === input.proof.requestedModel &&
    row.resolved_model === input.proof.resolvedModel &&
    Number(row.call_count) === input.proof.callCount &&
    Number(row.reported_call_count) === input.proof.reportedCallCount &&
    row.outcome_created_at === input.proof.createdAt &&
    row.outcome_updated_at === input.proof.updatedAt
  );
}

export function recordLegacyLearnCouncilFailureProof(
  database: Database.Database,
  input: LegacyLearnCouncilFailureProofInput,
): void {
  assertLegacyLearnCouncilFailureProofInput(input);
  const existing = database.prepare(
    `SELECT * FROM learn_council_legacy_failure_proofs
     WHERE (authorized_job_id = ? AND stage_key = ? AND semantic_attempt = ?)
        OR (origin_job_id = ? AND stage_key = ? AND semantic_attempt = ?
            AND request_hash = ? AND council_run_id = ?)
     ORDER BY rowid`,
  ).all(
    input.jobId,
    input.stageKey,
    input.semanticAttempt,
    input.originJobId,
    input.stageKey,
    input.semanticAttempt,
    input.requestHash,
    input.proof.councilRunId,
  ) as Array<Record<string, unknown>>;
  if (existing.length > 0) {
    const exact = existing.length === 1 &&
      exactLegacyLearnCouncilFailureProofRow(existing[0], input, true);
    if (exact) return;
    throw new Error("Legacy Learn Council failure proof conflicts with durable evidence.");
  }
  database.prepare(
    `INSERT INTO learn_council_legacy_failure_proofs (
       proof_id, origin_job_id, authorized_job_id, garden_id,
       stage_key, semantic_attempt, request_hash, council_run_id,
       failure_code, failure_phase, partial_output, replay_safe,
       council_mode, requested_model, resolved_model,
       call_count, reported_call_count,
       outcome_created_at, outcome_updated_at, observed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.proofId,
    input.originJobId,
    input.jobId,
    input.gardenId,
    input.stageKey,
    input.semanticAttempt,
    input.requestHash,
    input.proof.councilRunId,
    input.proof.failureCode,
    input.proof.failurePhase,
    input.proof.partialOutput === null ? null : Number(input.proof.partialOutput),
    input.proof.replaySafe === null ? null : Number(input.proof.replaySafe),
    input.proof.councilMode,
    input.proof.requestedModel,
    input.proof.resolvedModel,
    input.proof.callCount,
    input.proof.reportedCallCount,
    input.proof.createdAt,
    input.proof.updatedAt,
    input.now,
  );
}

/** Reuse one immutable legacy failure observation across an exact failed-job
 * retry lineage. The proof itself remains unique to the provider outcome; a
 * successor gets a fenced adoption row instead of attempting to rewrite it. */
function recordOrAdoptLegacyLearnCouncilFailureProof(
  database: Database.Database,
  input: LegacyLearnCouncilFailureProofInput,
): void {
  assertLegacyLearnCouncilFailureProofInput(input);
  const rows = database.prepare(
    `SELECT * FROM learn_council_legacy_failure_proofs
     WHERE origin_job_id = ? AND stage_key = ? AND semantic_attempt = ?
       AND request_hash = ? AND council_run_id = ?
     ORDER BY rowid`,
  ).all(
    input.originJobId,
    input.stageKey,
    input.semanticAttempt,
    input.requestHash,
    input.proof.councilRunId,
  ) as Array<Record<string, unknown>>;
  if (rows.length === 0) {
    recordLegacyLearnCouncilFailureProof(database, input);
    return;
  }
  const source = rows[0];
  if (
    rows.length !== 1 ||
    !exactLegacyLearnCouncilFailureProofRow(source, input, false)
  ) {
    throw new Error("Legacy Learn Council failure proof conflicts with durable evidence.");
  }
  if (source.authorized_job_id === input.jobId) {
    recordLegacyLearnCouncilFailureProof(database, input);
    return;
  }
  const sourceJobId = String(source.authorized_job_id);
  const sourceJob = learnCouncilRetryJob(database, sourceJobId);
  const currentJob = learnCouncilRetryJob(database, input.jobId);
  if (
    !sourceJob ||
    !currentJob ||
    !exactLearnCouncilRetryJobBinding(sourceJob, currentJob)
  ) {
    throw new Error("Legacy Learn Council failure proof has no exact failed-job lineage.");
  }
  const existing = database.prepare(
    `SELECT * FROM learn_council_legacy_boundary_adoptions
     WHERE (authorized_job_id = ? AND stage_key = ? AND semantic_attempt = ?)
        OR (proof_id = ? AND authorized_job_id = ?)
     ORDER BY rowid`,
  ).all(
    input.jobId,
    input.stageKey,
    input.semanticAttempt,
    source.proof_id,
    input.jobId,
  ) as Array<Record<string, unknown>>;
  if (existing.length > 0) {
    const exact = existing.length === 1 &&
      existing[0].proof_id === source.proof_id &&
      existing[0].source_job_id === sourceJobId &&
      existing[0].authorized_job_id === input.jobId &&
      existing[0].garden_id === input.gardenId &&
      existing[0].stage_key === input.stageKey &&
      Number(existing[0].semantic_attempt) === input.semanticAttempt &&
      existing[0].request_hash === input.requestHash;
    if (exact) return;
    throw new Error("Learn Council legacy boundary adoption conflicts.");
  }
  database.prepare(
    `INSERT INTO learn_council_legacy_boundary_adoptions (
       adoption_id, proof_id, source_job_id, authorized_job_id,
       garden_id, stage_key, semantic_attempt, request_hash, observed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.proofId,
    source.proof_id,
    sourceJobId,
    input.jobId,
    input.gardenId,
    input.stageKey,
    input.semanticAttempt,
    input.requestHash,
    input.now,
  );
}

export function hasLearnCouncilLegacyFailureBoundary(
  database: Database.Database,
  jobId: string,
): boolean {
  return Boolean(database.prepare(
    `SELECT 1 FROM learn_council_legacy_failure_proofs
     WHERE authorized_job_id = ?
     UNION ALL
     SELECT 1 FROM learn_council_legacy_boundary_adoptions
     WHERE authorized_job_id = ?
     UNION ALL
     SELECT 1 FROM learn_council_native_lineage_boundaries
     WHERE authorized_job_id = ?
     LIMIT 1`,
  ).get(jobId, jobId, jobId));
}

export function recordLearnCouncilNativeLineageBoundary(
  database: Database.Database,
  input: {
    boundaryId: string;
    originJobId: string;
    jobId: string;
    gardenId: string;
    stageKey: string;
    semanticAttempt: number;
    requestHash: string;
    proof: NativeLearnCouncilBoundaryProof;
    now: string;
  },
): void {
  assertRequestId(input.boundaryId, "Learn Council native boundary id");
  assertRequestId(input.proof.receiptRequestId, "Learn Council boundary receipt id");
  assertRequestHash(input.requestHash);
  assertStage(input);
  const origin = learnCouncilRetryJob(database, input.originJobId);
  const current = learnCouncilRetryJob(database, input.jobId);
  if (!origin || !current || !exactLearnCouncilRetryJobBinding(origin, current)) {
    throw new Error("Learn Council native boundary has no exact failed-job lineage.");
  }
  const checkpoint = database.prepare(
    `SELECT * FROM learn_council_request_checkpoints
     WHERE job_id = ? AND garden_id = ? AND stage_key = ?
       AND semantic_attempt = ? AND request_hash = ?
       AND receipt_request_id = ?`,
  ).get(
    input.originJobId,
    input.gardenId,
    input.stageKey,
    input.semanticAttempt,
    input.requestHash,
    input.proof.receiptRequestId,
  ) as LearnCouncilCheckpointRow | undefined;
  if (!checkpoint || checkpoint.state !== "started") {
    throw new Error("Learn Council native boundary source is not exact and incomplete.");
  }
  const missing = input.proof.outcome === "receipt_not_found";
  const failed = input.proof.outcome === "request_failed";
  if (
    (missing && (
      input.proof.dispatchGeneration !== null ||
      input.proof.dispatchCount !== null ||
      input.proof.redispatchCount !== null ||
      input.proof.redispatchAllowed !== null ||
      input.proof.failureCode !== null
    )) ||
    (failed && (
      ![1, 2].includes(input.proof.dispatchGeneration ?? 0) ||
      input.proof.dispatchCount !== input.proof.dispatchGeneration ||
      input.proof.redispatchCount !== input.proof.dispatchCount! - 1 ||
      typeof input.proof.redispatchAllowed !== "boolean" ||
      typeof input.proof.failureCode !== "string" ||
      !input.proof.failureCode ||
      input.proof.dispatchCount !== checkpoint.dispatch_attempt_count ||
      input.proof.redispatchCount !== checkpoint.redispatch_count
    ))
  ) {
    throw new Error("Learn Council native boundary proof is invalid.");
  }
  const existing = database.prepare(
    `SELECT * FROM learn_council_native_lineage_boundaries
     WHERE (authorized_job_id = ? AND stage_key = ? AND semantic_attempt = ?)
        OR (receipt_request_id = ? AND authorized_job_id = ?)
     ORDER BY rowid`,
  ).all(
    input.jobId,
    input.stageKey,
    input.semanticAttempt,
    input.proof.receiptRequestId,
    input.jobId,
  ) as Array<Record<string, unknown>>;
  if (existing.length > 0) {
    const row = existing[0];
    const exact = existing.length === 1 &&
      row.origin_job_id === input.originJobId &&
      row.authorized_job_id === input.jobId &&
      row.garden_id === input.gardenId &&
      row.stage_key === input.stageKey &&
      Number(row.semantic_attempt) === input.semanticAttempt &&
      row.request_hash === input.requestHash &&
      row.receipt_request_id === input.proof.receiptRequestId &&
      row.outcome === input.proof.outcome &&
      (row.dispatch_generation === null
        ? input.proof.dispatchGeneration === null
        : Number(row.dispatch_generation) === input.proof.dispatchGeneration) &&
      (row.dispatch_count === null
        ? input.proof.dispatchCount === null
        : Number(row.dispatch_count) === input.proof.dispatchCount) &&
      (row.redispatch_count === null
        ? input.proof.redispatchCount === null
        : Number(row.redispatch_count) === input.proof.redispatchCount) &&
      (row.redispatch_allowed === null
        ? input.proof.redispatchAllowed === null
        : Boolean(row.redispatch_allowed) === input.proof.redispatchAllowed) &&
      row.failure_code === input.proof.failureCode;
    if (exact) return;
    throw new Error("Learn Council native lineage boundary conflicts.");
  }
  database.prepare(
    `INSERT INTO learn_council_native_lineage_boundaries (
       boundary_id, origin_job_id, authorized_job_id, garden_id,
       stage_key, semantic_attempt, request_hash, receipt_request_id,
       outcome, dispatch_generation, dispatch_count, redispatch_count,
       redispatch_allowed, failure_code, observed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.boundaryId,
    input.originJobId,
    input.jobId,
    input.gardenId,
    input.stageKey,
    input.semanticAttempt,
    input.requestHash,
    input.proof.receiptRequestId,
    input.proof.outcome,
    input.proof.dispatchGeneration,
    input.proof.dispatchCount,
    input.proof.redispatchCount,
    input.proof.redispatchAllowed === null
      ? null
      : Number(input.proof.redispatchAllowed),
    input.proof.failureCode,
    input.now,
  );
}

/** A later legacy 404 is dispatch authority only after the current retry has
 * either created a native receipt already, or durably crossed a failed legacy
 * boundary while also recovering a completed legacy stage. A bare failure
 * proof is consumed atomically by that stage's first native receipt instead. */
export function canStartLearnCouncilAfterLegacyAbsence(
  database: Database.Database,
  jobId: string,
  input: { hasCompletedNativePlanningCheckpoint?: boolean } = {},
): boolean {
  if (input.hasCompletedNativePlanningCheckpoint) return true;
  if (hasNativeLearnCouncilCheckpoint(database, jobId)) return true;
  if (!hasLearnCouncilLegacyFailureBoundary(database, jobId)) return false;
  return Boolean(database.prepare(
    `SELECT 1 FROM learn_council_request_checkpoints
     WHERE job_id = ? AND result_origin = 'legacy' AND state = 'completed'
     LIMIT 1`,
  ).get(jobId));
}

export function adoptCompletedLearnCouncilCheckpoint(
  database: Database.Database,
  input: {
    checkpointId: string;
    source: LearnCouncilCheckpointRow;
    jobId: string;
    gardenId: string;
    stageKey: string;
    semanticAttempt: number;
    now: string;
  },
): LearnCouncilCheckpointRow {
  assertRequestId(input.checkpointId, "Learn Council adoption checkpoint id");
  assertStage(input);
  if (
    input.source.state !== "completed" ||
    input.source.garden_id !== input.gardenId ||
    input.source.stage_key !== input.stageKey ||
    Number(input.source.semantic_attempt) !== input.semanticAttempt ||
    !input.source.council_run_id ||
    !input.source.response_hash
  ) {
    throw new Error("Learn Council adoption source is not exact and completed.");
  }
  database.prepare(
    `INSERT INTO learn_council_request_checkpoints (
       checkpoint_id, receipt_request_id, origin_job_id, job_id, garden_id,
       stage_key, semantic_attempt, request_hash, result_origin, state,
       dispatch_attempt_count, redispatch_count, redispatch_reason,
       receipt_dispatch_count, council_run_id, response_hash,
       created_at, updated_at, completed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.checkpointId,
    input.source.receipt_request_id,
    input.source.origin_job_id,
    input.jobId,
    input.gardenId,
    input.stageKey,
    input.semanticAttempt,
    input.source.request_hash,
    input.source.result_origin,
    input.source.dispatch_attempt_count,
    input.source.redispatch_count,
    input.source.redispatch_reason,
    input.source.receipt_dispatch_count,
    input.source.council_run_id,
    input.source.response_hash,
    input.now,
    input.now,
    input.now,
  );
  return currentLearnCouncilCheckpoint(database, input)!;
}

interface PersistedLegacyLearnCouncilFailureProofRow {
  proof_id: string;
  origin_job_id: string;
  authorized_job_id: string;
  garden_id: string;
  stage_key: string;
  semantic_attempt: number;
  request_hash: string;
  council_run_id: string;
  outcome: string;
  final_answer_present: number;
  candidate_count: number;
  failure_code: string;
  failure_phase: string | null;
  partial_output: number | null;
  replay_safe: number | null;
  council_mode: string;
  requested_model: string;
  resolved_model: string;
  call_count: number;
  reported_call_count: number;
  outcome_created_at: string;
  outcome_updated_at: string;
  observed_at: string;
}

function legacyFailureProofForCompletedCheckpoint(
  database: Database.Database,
  source: LearnCouncilCheckpointRow,
): PersistedLegacyLearnCouncilFailureProofRow | null {
  if (source.result_origin !== "legacy" || source.state !== "completed") {
    return null;
  }
  const rows = database.prepare(
    `SELECT p.* FROM learn_council_legacy_failure_proofs p
     WHERE (
       p.authorized_job_id = ?
       OR EXISTS (
         SELECT 1 FROM learn_council_legacy_boundary_adoptions a
         WHERE a.proof_id = p.proof_id AND a.authorized_job_id = ?
           AND a.garden_id = p.garden_id AND a.stage_key = p.stage_key
           AND a.semantic_attempt = p.semantic_attempt
           AND a.request_hash = p.request_hash
       )
     ) AND p.garden_id = ? AND p.stage_key = ?
       AND p.semantic_attempt = ? AND p.request_hash = ?
     ORDER BY rowid`,
  ).all(
    source.job_id,
    source.job_id,
    source.garden_id,
    source.stage_key,
    source.semantic_attempt,
    source.request_hash,
  ) as PersistedLegacyLearnCouncilFailureProofRow[];
  if (rows.length > 1) {
    throw new Error("Legacy Learn Council boundary provenance is ambiguous.");
  }
  return rows[0] ?? null;
}

/** Adopt a completed cross-job checkpoint and carry forward the exact legacy
 * failed/no-final boundary that made its migration safe. This prevents a
 * crash-created successor generation from losing authority at the next
 * never-issued stage. */
export function adoptCompletedLearnCouncilCheckpointWithBoundary(
  database: Database.Database,
  input: {
    checkpointId: string;
    boundaryProofId: string;
    source: LearnCouncilCheckpointRow;
    jobId: string;
    gardenId: string;
    stageKey: string;
    semanticAttempt: number;
    now: string;
  },
): LearnCouncilCheckpointRow {
  return database.transaction(() => {
    const sourceJob = learnCouncilRetryJob(database, input.source.job_id);
    const currentJob = learnCouncilRetryJob(database, input.jobId);
    if (
      !sourceJob ||
      !currentJob ||
      !exactLearnCouncilRetryJobBinding(sourceJob, currentJob)
    ) {
      throw new Error("Learn Council checkpoint boundary has no exact failed-job lineage.");
    }
    const proof = legacyFailureProofForCompletedCheckpoint(database, input.source);
    if (proof) {
      if (
        proof.outcome !== "failed" ||
        Number(proof.final_answer_present) !== 0 ||
        Number(proof.candidate_count) !== 0
      ) {
        throw new Error("Legacy Learn Council boundary proof is not a failed/no-final outcome.");
      }
      const existing = database.prepare(
        `SELECT * FROM learn_council_legacy_boundary_adoptions
         WHERE (authorized_job_id = ? AND stage_key = ? AND semantic_attempt = ?)
            OR (proof_id = ? AND authorized_job_id = ?)
         ORDER BY rowid`,
      ).all(
        input.jobId,
        input.stageKey,
        input.semanticAttempt,
        proof.proof_id,
        input.jobId,
      ) as Array<Record<string, unknown>>;
      if (existing.length > 0) {
        const exact = existing.length === 1 &&
          existing[0].proof_id === proof.proof_id &&
          existing[0].source_job_id === input.source.job_id &&
          existing[0].authorized_job_id === input.jobId &&
          existing[0].garden_id === input.gardenId &&
          existing[0].stage_key === input.stageKey &&
          Number(existing[0].semantic_attempt) === input.semanticAttempt &&
          existing[0].request_hash === input.source.request_hash;
        if (!exact) {
          throw new Error("Learn Council legacy boundary adoption conflicts.");
        }
      } else {
        assertRequestId(input.boundaryProofId, "Learn Council boundary adoption id");
        database.prepare(
          `INSERT INTO learn_council_legacy_boundary_adoptions (
             adoption_id, proof_id, source_job_id, authorized_job_id,
             garden_id, stage_key, semantic_attempt, request_hash, observed_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          input.boundaryProofId,
          proof.proof_id,
          input.source.job_id,
          input.jobId,
          input.gardenId,
          input.stageKey,
          input.semanticAttempt,
          input.source.request_hash,
          input.now,
        );
      }
    }
    const nativeBoundaries = database.prepare(
      `SELECT * FROM learn_council_native_lineage_boundaries
       WHERE authorized_job_id = ? AND garden_id = ? AND stage_key = ?
         AND semantic_attempt = ? AND request_hash = ?
       ORDER BY rowid`,
    ).all(
      input.source.job_id,
      input.gardenId,
      input.stageKey,
      input.semanticAttempt,
      input.source.request_hash,
    ) as Array<Record<string, unknown>>;
    if (nativeBoundaries.length > 1) {
      throw new Error("Learn Council native boundary propagation is ambiguous.");
    }
    const nativeBoundary = nativeBoundaries[0];
    if (nativeBoundary) {
      recordLearnCouncilNativeLineageBoundary(database, {
        boundaryId: input.boundaryProofId,
        originJobId: String(nativeBoundary.origin_job_id),
        jobId: input.jobId,
        gardenId: input.gardenId,
        stageKey: input.stageKey,
        semanticAttempt: input.semanticAttempt,
        requestHash: input.source.request_hash,
        proof: {
          outcome: String(nativeBoundary.outcome) as NativeLearnCouncilBoundaryProof["outcome"],
          receiptRequestId: String(nativeBoundary.receipt_request_id),
          dispatchGeneration: nativeBoundary.dispatch_generation === null
            ? null
            : Number(nativeBoundary.dispatch_generation),
          dispatchCount: nativeBoundary.dispatch_count === null
            ? null
            : Number(nativeBoundary.dispatch_count),
          redispatchCount: nativeBoundary.redispatch_count === null
            ? null
            : Number(nativeBoundary.redispatch_count),
          redispatchAllowed: nativeBoundary.redispatch_allowed === null
            ? null
            : Boolean(nativeBoundary.redispatch_allowed),
          failureCode: nativeBoundary.failure_code === null
            ? null
            : String(nativeBoundary.failure_code),
        },
        now: input.now,
      });
    }
    return adoptCompletedLearnCouncilCheckpoint(database, input);
  }).immediate();
}

export function materializeCompletedLegacyLearnCouncilCheckpoint(
  database: Database.Database,
  input: {
    checkpointId: string;
    originJobId: string;
    jobId: string;
    gardenId: string;
    stageKey: string;
    semanticAttempt: number;
    requestHash: string;
    councilRunId: string;
    responseHash: string;
    now: string;
  },
): LearnCouncilCheckpointRow {
  assertRequestId(input.checkpointId, "Legacy Learn Council checkpoint id");
  assertRequestHash(input.requestHash);
  assertRequestHash(input.responseHash);
  assertStage(input);
  if (!input.councilRunId) {
    throw new Error("Legacy Learn Council result has no run id.");
  }
  const existing = currentLearnCouncilCheckpoint(database, input);
  if (existing) {
    if (
      existing.receipt_request_id === null &&
      existing.origin_job_id === input.originJobId &&
      existing.job_id === input.jobId &&
      existing.garden_id === input.gardenId &&
      existing.stage_key === input.stageKey &&
      Number(existing.semantic_attempt) === input.semanticAttempt &&
      existing.request_hash === input.requestHash &&
      existing.result_origin === "legacy" &&
      existing.state === "completed" &&
      Number(existing.dispatch_attempt_count) === 0 &&
      Number(existing.redispatch_count) === 0 &&
      existing.redispatch_reason === null &&
      existing.receipt_dispatch_count === null &&
      existing.council_run_id === input.councilRunId &&
      existing.response_hash === input.responseHash
    ) {
      return existing;
    }
    throw new Error("Legacy Learn Council completion conflicts with its checkpoint.");
  }
  database.prepare(
    `INSERT INTO learn_council_request_checkpoints (
       checkpoint_id, receipt_request_id, origin_job_id, job_id, garden_id,
       stage_key, semantic_attempt, request_hash, result_origin, state,
       dispatch_attempt_count, redispatch_count, council_run_id, response_hash,
       created_at, updated_at, completed_at
     ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 'legacy', 'completed', 0, 0, ?, ?, ?, ?, ?)`,
  ).run(
    input.checkpointId,
    input.originJobId,
    input.jobId,
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
  return currentLearnCouncilCheckpoint(database, input)!;
}

/** Persist a newer failed/no-final boundary and an older reusable completion
 * as one crash-consistent migration step. Both component writes are exact and
 * idempotent, which also heals a pre-upgrade crash that left only the proof. */
export function materializeCompletedLegacyLearnCouncilCheckpointAfterFailure(
  database: Database.Database,
  input: {
    proofId: string;
    failureOriginJobId: string;
    completionOriginJobId: string;
    jobId: string;
    gardenId: string;
    stageKey: string;
    semanticAttempt: number;
    requestHash: string;
    proof: LegacyLearnCouncilFailureProof;
    checkpointId: string;
    councilRunId: string;
    responseHash: string;
    now: string;
  },
): LearnCouncilCheckpointRow {
  return database.transaction(() => {
    recordOrAdoptLegacyLearnCouncilFailureProof(database, {
      proofId: input.proofId,
      originJobId: input.failureOriginJobId,
      jobId: input.jobId,
      gardenId: input.gardenId,
      stageKey: input.stageKey,
      semanticAttempt: input.semanticAttempt,
      requestHash: input.requestHash,
      proof: input.proof,
      now: input.now,
    });
    return materializeCompletedLegacyLearnCouncilCheckpoint(database, {
      checkpointId: input.checkpointId,
      originJobId: input.completionOriginJobId,
      jobId: input.jobId,
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

export function claimLearnCouncilRedispatch(
  database: Database.Database,
  input: {
    checkpointId: string;
    source: LearnCouncilCheckpointRow;
    jobId: string;
    gardenId: string;
    stageKey: string;
    semanticAttempt: number;
    requestHash: string;
    reason: LearnCouncilRedispatchReason;
    now: string;
  },
): LearnCouncilCheckpointRow {
  assertRequestId(input.checkpointId, "Learn Council redispatch checkpoint id");
  assertRequestHash(input.requestHash);
  assertStage(input);
  if (!input.source.receipt_request_id) {
    throw new Error("Legacy Learn Council results cannot be redispatched as receipts.");
  }
  if (input.reason !== "request_failed") {
    throw new Error(
      "Receipt absence uses the separate missing-receipt recovery claim.",
    );
  }
  return database.transaction(() => {
    const rows = checkpointRowsForReceipt(
      database,
      input.source.receipt_request_id!,
    );
    assertExactReceiptChain(rows);
    const first = rows[0];
    const firstFailedRedispatch =
      Number(first.dispatch_attempt_count) === 1 &&
      Number(first.redispatch_count) === 0 &&
      first.redispatch_reason === null;
    const legacyMissingRecovery =
      Number(first.dispatch_attempt_count) === 2 &&
      Number(first.redispatch_count) === 1 &&
      first.redispatch_reason === "receipt_not_found";
    if (
      first.state !== "started" ||
      first.garden_id !== input.gardenId ||
      first.stage_key !== input.stageKey ||
      Number(first.semantic_attempt) !== input.semanticAttempt ||
      first.request_hash !== input.requestHash ||
      (!firstFailedRedispatch && !legacyMissingRecovery)
    ) {
      throw new Error(
        "Learn Council receipt has no remaining exact redispatch authority.",
      );
    }
    const existing = database.prepare(
      `SELECT * FROM learn_council_request_checkpoints
       WHERE job_id = ? AND stage_key = ? AND semantic_attempt = ?`,
    ).get(input.jobId, input.stageKey, input.semanticAttempt) as
      | LearnCouncilCheckpointRow
      | undefined;
    if (!existing) {
      database.prepare(
        `INSERT INTO learn_council_request_checkpoints (
           checkpoint_id, receipt_request_id, origin_job_id, job_id, garden_id,
           stage_key, semantic_attempt, request_hash, result_origin, state,
           dispatch_attempt_count, redispatch_count, redispatch_reason,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'receipt', 'started', 2, 1, ?, ?, ?)`,
      ).run(
        input.checkpointId,
        first.receipt_request_id,
        first.origin_job_id,
        input.jobId,
        input.gardenId,
        input.stageKey,
        input.semanticAttempt,
        input.requestHash,
        input.reason,
        input.now,
        input.now,
      );
    } else if (
      existing.checkpoint_id !== input.source.checkpoint_id ||
      existing.receipt_request_id !== first.receipt_request_id
    ) {
      throw new Error("Learn Council redispatch current-job alias conflicts.");
    }
    recordLearnCouncilDispatchGenerationOwner(database, {
      receiptRequestId: first.receipt_request_id!,
      dispatchGeneration: 2,
      jobId: input.jobId,
      checkpointId: existing?.checkpoint_id ?? input.checkpointId,
      requestHash: input.requestHash,
      now: input.now,
    });
    const update = legacyMissingRecovery
      ? database.prepare(
          `UPDATE learn_council_request_checkpoints
           SET redispatch_reason = 'request_failed', updated_at = ?
           WHERE receipt_request_id = ? AND state = 'started'
             AND dispatch_attempt_count = 2 AND redispatch_count = 1
             AND redispatch_reason = 'receipt_not_found'`,
        ).run(input.now, first.receipt_request_id)
      : database.prepare(
          `UPDATE learn_council_request_checkpoints
           SET dispatch_attempt_count = 2, redispatch_count = 1,
               redispatch_reason = 'request_failed', updated_at = ?
           WHERE receipt_request_id = ? AND state = 'started'
             AND dispatch_attempt_count = 1 AND redispatch_count = 0
             AND redispatch_reason IS NULL`,
        ).run(input.now, first.receipt_request_id);
    const expectedChanges = rows.length;
    if (update.changes !== expectedChanges) {
      throw new Error("Learn Council redispatch claim was not atomic.");
    }
    return currentLearnCouncilCheckpoint(database, input)!;
  }).immediate();
}

/** Transfer a locally claimed-but-server-unobserved generation 2 to an exact
 * successor job. The server must still prove generation 1 failed and eligible;
 * this function creates no new redispatch claim or generation. */
export function adoptClaimedLearnCouncilRedispatch(
  database: Database.Database,
  input: {
    checkpointId: string;
    source: LearnCouncilCheckpointRow;
    jobId: string;
    gardenId: string;
    stageKey: string;
    semanticAttempt: number;
    requestHash: string;
    now: string;
    beforeOwnerTransfer?: (
      priorOwnerJobId: string,
      receiptRequestId: string,
      requestHash: string,
    ) => void;
  },
): LearnCouncilCheckpointRow {
  assertRequestId(input.checkpointId, "Learn Council claimed redispatch alias id");
  assertRequestHash(input.requestHash);
  assertStage(input);
  if (!input.source.receipt_request_id) {
    throw new Error("Claimed Learn Council redispatch has no receipt id.");
  }
  return database.transaction(() => {
    const rows = checkpointRowsForReceipt(
      database,
      input.source.receipt_request_id!,
    );
    assertExactReceiptChain(rows);
    const first = rows[0];
    const owners = learnCouncilDispatchGenerationOwners(
      database,
      first.receipt_request_id!,
    );
    const generationTwoOwner = owners.find((owner) =>
      Number(owner.dispatch_generation) === 2);
    if (
      first.state !== "started" ||
      Number(first.dispatch_attempt_count) !== 2 ||
      Number(first.redispatch_count) !== 1 ||
      first.redispatch_reason !== "request_failed" ||
      first.garden_id !== input.gardenId ||
      first.stage_key !== input.stageKey ||
      Number(first.semantic_attempt) !== input.semanticAttempt ||
      first.request_hash !== input.requestHash ||
      owners.length !== 2 ||
      !generationTwoOwner ||
      generationTwoOwner.job_id !== input.source.job_id
    ) {
      throw new Error("Learn Council claimed redispatch transfer is ambiguous.");
    }
    let current = database.prepare(
      `SELECT * FROM learn_council_request_checkpoints
       WHERE job_id = ? AND stage_key = ? AND semantic_attempt = ?`,
    ).get(input.jobId, input.stageKey, input.semanticAttempt) as
      | LearnCouncilCheckpointRow
      | undefined;
    if (!current) {
      database.prepare(
        `INSERT INTO learn_council_request_checkpoints (
           checkpoint_id, receipt_request_id, origin_job_id, job_id, garden_id,
           stage_key, semantic_attempt, request_hash, result_origin, state,
           dispatch_attempt_count, redispatch_count, redispatch_reason,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'receipt', 'started', 2, 1,
                   'request_failed', ?, ?)`,
      ).run(
        input.checkpointId,
        first.receipt_request_id,
        first.origin_job_id,
        input.jobId,
        input.gardenId,
        input.stageKey,
        input.semanticAttempt,
        input.requestHash,
        input.now,
        input.now,
      );
      current = currentLearnCouncilCheckpoint(database, input)!;
    } else if (
      current.receipt_request_id !== first.receipt_request_id ||
      current.request_hash !== input.requestHash ||
      current.state !== "started" ||
      current.redispatch_reason !== "request_failed"
    ) {
      throw new Error("Learn Council claimed redispatch successor alias conflicts.");
    }
    if (generationTwoOwner.job_id !== input.jobId) {
      if (!input.beforeOwnerTransfer) {
        throw new Error(
          "Learn Council generation-2 transfer has no atomic usage cleanup.",
        );
      }
      input.beforeOwnerTransfer(
        generationTwoOwner.job_id,
        first.receipt_request_id!,
        input.requestHash,
      );
      const transfer = database.prepare(
        `UPDATE learn_council_dispatch_generation_owners
         SET job_id = ?, checkpoint_id = ?, claimed_at = ?
         WHERE receipt_request_id = ? AND dispatch_generation = 2
           AND job_id = ? AND checkpoint_id = ? AND request_hash = ?`,
      ).run(
        input.jobId,
        current.checkpoint_id,
        input.now,
        first.receipt_request_id,
        generationTwoOwner.job_id,
        generationTwoOwner.checkpoint_id,
        input.requestHash,
      );
      if (transfer.changes !== 1) {
        throw new Error("Learn Council generation-2 ownership transfer was not atomic.");
      }
    }
    return current;
  }).immediate();
}

export function completeLearnCouncilReceiptChain(
  database: Database.Database,
  input: {
    receiptRequestId: string;
    requestHash: string;
    councilRunId: string;
    responseHash: string;
    receiptDispatchCount: number;
    now: string;
  },
): LearnCouncilCheckpointRow[] {
  assertRequestId(input.receiptRequestId, "Learn Council receipt request id");
  assertRequestHash(input.requestHash);
  assertRequestHash(input.responseHash);
  if (!input.councilRunId) throw new Error("Learn Council receipt has no run id.");
  if (![1, 2].includes(input.receiptDispatchCount)) {
    throw new Error("Learn Council receipt dispatch count is invalid.");
  }
  return database.transaction(() => {
    const rows = checkpointRowsForReceipt(database, input.receiptRequestId);
    assertExactReceiptChain(rows);
    const first = rows[0];
    if (first.request_hash !== input.requestHash) {
      throw new Error("Learn Council receipt completion hash conflicts.");
    }
    const exactInitialGenerationClaim =
      input.receiptDispatchCount === 1 &&
      Number(first.dispatch_attempt_count) === 1 &&
      Number(first.redispatch_count) === 0 &&
      first.redispatch_reason === null;
    const exactRedispatchedGenerationClaim =
      input.receiptDispatchCount === 2 &&
      Number(first.dispatch_attempt_count) === 2 &&
      Number(first.redispatch_count) === 1 &&
      first.redispatch_reason === "request_failed";
    if (!exactInitialGenerationClaim && !exactRedispatchedGenerationClaim) {
      throw new Error(
        "Learn Council receipt completion generation conflicts with its durable local claim.",
      );
    }
    const generationOwners = learnCouncilDispatchGenerationOwners(
      database,
      input.receiptRequestId,
    );
    if (
      generationOwners.length !== input.receiptDispatchCount ||
      generationOwners.some((owner, index) =>
        Number(owner.dispatch_generation) !== index + 1 ||
        owner.request_hash !== input.requestHash ||
        !rows.some((row) =>
          row.checkpoint_id === owner.checkpoint_id &&
          row.job_id === owner.job_id)
      )
    ) {
      throw new Error("Learn Council receipt generation ownership conflicts.");
    }
    if (first.state === "completed") {
      if (
        first.council_run_id !== input.councilRunId ||
        first.response_hash !== input.responseHash ||
        first.receipt_dispatch_count !== input.receiptDispatchCount
      ) {
        throw new Error("Learn Council receipt completion result conflicts.");
      }
      return rows;
    }
    const update = database.prepare(
      `UPDATE learn_council_request_checkpoints
       SET state = 'completed', receipt_dispatch_count = ?, council_run_id = ?,
           response_hash = ?, completed_at = ?, updated_at = ?
       WHERE receipt_request_id = ? AND request_hash = ? AND state = 'started'`,
    ).run(
      input.receiptDispatchCount,
      input.councilRunId,
      input.responseHash,
      input.now,
      input.now,
      input.receiptRequestId,
      input.requestHash,
    );
    if (update.changes !== rows.length) {
      throw new Error("Learn Council receipt chain did not complete atomically.");
    }
    const completed = checkpointRowsForReceipt(database, input.receiptRequestId);
    assertExactReceiptChain(completed);
    return completed;
  }).immediate();
}

export function hasNativeLearnCouncilCheckpoint(
  database: Database.Database,
  jobId: string,
): boolean {
  return Boolean(database.prepare(
    `SELECT 1 FROM learn_council_request_checkpoints
     WHERE job_id = ? AND result_origin = 'receipt' LIMIT 1`,
  ).get(jobId));
}
