import type Database from "better-sqlite3";
import {
  emptyLearnTokenUsage,
  type LearnModelRequestEvidence,
  type LearnModelRequestIdentity,
  type LearnModelRequestPolicyReceipt,
  type LearnTokenUsage,
  type LearnTokenUsageEvent,
} from "./learn-token-usage.ts";

interface LearnJobTokenUsageRow {
  job_id: string;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  cached_input_tokens: number | null;
  reasoning_tokens: number | null;
  started_requests: number | null;
  completed_requests: number | null;
  reported_requests: number | null;
  estimated_requests: number | null;
  request_model: string | null;
  reasoning_effort: string | null;
  reasoning_summary: string | null;
  policy_observed_requests: number | null;
  policy_mismatch_requests: number | null;
  usage_updated_at: string | null;
}

interface LearnTokenUsageReceiptAccountingRow {
  receipt_id: string;
  lifecycle_request_id: string;
  request_hash: string;
  job_id: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cached_input_tokens: number;
  reasoning_tokens: number;
  request_model: string;
  reasoning_effort: string;
  reasoning_summary: string;
  provider_call_count: number;
  reported_call_count: number;
  estimated_call_count: number;
}

interface LearnTokenUsageRequestLifecycleRow {
  job_id: string;
  request_id: string;
  request_hash: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cached_input_tokens: number;
  reasoning_tokens: number;
  started_requests: number;
  completed_requests: number;
  reported_requests: number;
  estimated_requests: number;
  request_model: string | null;
  reasoning_effort: string | null;
  reasoning_summary: string | null;
}

export interface PersistedLearnExactTokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly cachedInputTokens: number;
  readonly reasoningTokens: number;
}

export interface PersistedLearnReceiptReconciliation {
  /** Stable server-side request receipt identity. No prompt or response data is
   * accepted or persisted by this API. */
  readonly receiptId: string;
  readonly requestHash: string;
  readonly usage: PersistedLearnExactTokenUsage;
  /** Actual provider calls proven by the receipt generations assigned to this
   * job. This is independent from client HTTP attempts. */
  readonly providerCallCount: 1 | 2;
  readonly reportedCallCount: 0 | 1 | 2;
  readonly estimatedCallCount: 0 | 1 | 2;
  /** Calls made by this helper invocation. Two means one proven-unaccepted
   * transport attempt followed by the sole safe redispatch. */
  readonly dispatchCount: 0 | 1 | 2;
  /** True only when one dispatch returned normally and its usage was already
   * emitted by the tracked client. */
  readonly httpCompletionObserved: boolean;
  /** Exact tracked HTTP lifecycle. Generation-specific accounting aliases use
   * this to reconcile the original client request id without sharing a global
   * accounting primary key across jobs. */
  readonly lifecycleRequestId?: string;
  readonly requestEvidence: LearnModelRequestEvidence & {
    readonly model: string;
    readonly reasoningEffort: "max";
    readonly reasoningSummary: "detailed";
  };
}

const MODEL_EVIDENCE_MAX_LENGTH = 128;
const REASONING_EVIDENCE_MAX_LENGTH = 32;

function boundedPolicyField(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function durableRequestEvidence(
  evidence: LearnModelRequestEvidence,
): LearnModelRequestEvidence {
  return {
    model: boundedPolicyField(evidence.model, MODEL_EVIDENCE_MAX_LENGTH),
    reasoningEffort: boundedPolicyField(
      evidence.reasoningEffort,
      REASONING_EVIDENCE_MAX_LENGTH,
    ),
    reasoningSummary: boundedPolicyField(
      evidence.reasoningSummary,
      REASONING_EVIDENCE_MAX_LENGTH,
    ),
  };
}

/** Additive migration for databases created before model-policy receipts.
 * Existing token counters remain untouched and legacy jobs truthfully expose
 * no receipt until a policy-bearing request is observed. */
export function ensureLearnTokenUsagePersistenceSchema(
  database: Database.Database,
): void {
  const additions = [
    ["request_model", "request_model TEXT"],
    ["reasoning_effort", "reasoning_effort TEXT"],
    ["reasoning_summary", "reasoning_summary TEXT"],
    [
      "policy_observed_requests",
      "policy_observed_requests INTEGER NOT NULL DEFAULT 0",
    ],
    [
      "policy_mismatch_requests",
      "policy_mismatch_requests INTEGER NOT NULL DEFAULT 0",
    ],
  ] as const;
  database.transaction(() => {
    const columns = new Set(
      (database.prepare("PRAGMA table_info(learn_job_token_usage)").all() as Array<{
        name: string;
      }>).map((column) => column.name),
    );
    for (const [name, definition] of additions) {
      if (!columns.has(name)) {
        database.exec(`ALTER TABLE learn_job_token_usage ADD COLUMN ${definition}`);
      }
    }
    database.exec(`
      CREATE TABLE IF NOT EXISTS learn_token_usage_receipt_accounting (
        receipt_id              TEXT PRIMARY KEY,
        lifecycle_request_id    TEXT NOT NULL,
        request_hash            TEXT NOT NULL,
        job_id                  TEXT NOT NULL,
        input_tokens            INTEGER NOT NULL,
        output_tokens           INTEGER NOT NULL,
        total_tokens            INTEGER NOT NULL,
        cached_input_tokens     INTEGER NOT NULL,
        reasoning_tokens        INTEGER NOT NULL,
        request_model           TEXT NOT NULL,
        reasoning_effort        TEXT NOT NULL,
        reasoning_summary       TEXT NOT NULL,
        provider_call_count     INTEGER NOT NULL DEFAULT 1 CHECK (
          provider_call_count BETWEEN 1 AND 2
        ),
        reported_call_count     INTEGER NOT NULL DEFAULT 1 CHECK (
          reported_call_count BETWEEN 0 AND provider_call_count
        ),
        estimated_call_count    INTEGER NOT NULL DEFAULT 0 CHECK (
          estimated_call_count BETWEEN 0 AND provider_call_count
        ),
        observed_dispatch_count INTEGER NOT NULL CHECK (
          observed_dispatch_count BETWEEN 0 AND 2
        ),
        http_completion_observed INTEGER NOT NULL CHECK (
          http_completion_observed IN (0, 1)
        ),
        applied_at              TEXT NOT NULL,
        FOREIGN KEY (job_id) REFERENCES learn_job_token_usage(job_id)
          ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_learn_usage_receipt_accounting_job
        ON learn_token_usage_receipt_accounting(job_id, applied_at);

      CREATE TABLE IF NOT EXISTS learn_token_usage_request_lifecycles (
        job_id                  TEXT NOT NULL,
        request_id              TEXT NOT NULL,
        request_hash            TEXT NOT NULL,
        input_tokens            INTEGER NOT NULL DEFAULT 0,
        output_tokens           INTEGER NOT NULL DEFAULT 0,
        total_tokens            INTEGER NOT NULL DEFAULT 0,
        cached_input_tokens     INTEGER NOT NULL DEFAULT 0,
        reasoning_tokens        INTEGER NOT NULL DEFAULT 0,
        started_requests        INTEGER NOT NULL DEFAULT 0,
        completed_requests      INTEGER NOT NULL DEFAULT 0,
        reported_requests       INTEGER NOT NULL DEFAULT 0,
        estimated_requests      INTEGER NOT NULL DEFAULT 0,
        request_model           TEXT,
        reasoning_effort        TEXT,
        reasoning_summary       TEXT,
        created_at              TEXT NOT NULL,
        updated_at              TEXT NOT NULL,
        PRIMARY KEY (job_id, request_id, request_hash),
        UNIQUE (job_id, request_id),
        FOREIGN KEY (job_id) REFERENCES learn_job_token_usage(job_id)
          ON DELETE CASCADE,
        CHECK (started_requests >= completed_requests),
        CHECK (completed_requests >= reported_requests)
      );
      CREATE INDEX IF NOT EXISTS idx_learn_usage_request_lifecycle_hash
        ON learn_token_usage_request_lifecycles(
          job_id, request_hash, request_id
        );
    `);
    const accountingColumns = new Set(
      (database.prepare(
        "PRAGMA table_info(learn_token_usage_receipt_accounting)",
      ).all() as Array<{ name: string }>).map((column) => column.name),
    );
    const accountingAdditions = [
      ["lifecycle_request_id", "lifecycle_request_id TEXT"],
      ["provider_call_count", "provider_call_count INTEGER NOT NULL DEFAULT 1"],
      ["reported_call_count", "reported_call_count INTEGER NOT NULL DEFAULT 1"],
      ["estimated_call_count", "estimated_call_count INTEGER NOT NULL DEFAULT 0"],
    ] as const;
    for (const [name, definition] of accountingAdditions) {
      if (!accountingColumns.has(name)) {
        database.exec(
          `ALTER TABLE learn_token_usage_receipt_accounting ADD COLUMN ${definition}`,
        );
      }
    }
    database.exec(`
      UPDATE learn_token_usage_receipt_accounting
      SET lifecycle_request_id = receipt_id
      WHERE lifecycle_request_id IS NULL;
      CREATE INDEX IF NOT EXISTS idx_learn_usage_receipt_lifecycle
        ON learn_token_usage_receipt_accounting(
          job_id, lifecycle_request_id, request_hash
        );
    `);
  }).immediate();
}

const RECEIPT_ID_RE = /^[A-Za-z0-9_.:-]{1,256}$/;
const REQUEST_HASH_RE = /^[0-9a-f]{64}$/;

function assertReceiptIdentity(receiptId: string, requestHash: string): void {
  if (!RECEIPT_ID_RE.test(receiptId)) {
    throw new Error("Learn token usage receipt ID is invalid");
  }
  if (!REQUEST_HASH_RE.test(requestHash)) {
    throw new Error("Learn token usage receipt request hash is invalid");
  }
}

function assertRequestIdentity(identity: LearnModelRequestIdentity): void {
  assertReceiptIdentity(identity.clientRequestId, identity.clientRequestHash);
}

function assertExactTokenUsage(usage: PersistedLearnExactTokenUsage): void {
  const fields = [
    "inputTokens",
    "outputTokens",
    "totalTokens",
    "cachedInputTokens",
    "reasoningTokens",
  ] as const;
  for (const name of fields) {
    const value = usage[name];
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`Learn token usage receipt has invalid ${name}`);
    }
  }
}

function assertAdoptedRequestEvidence(
  evidence: PersistedLearnReceiptReconciliation["requestEvidence"],
): void {
  const model = boundedPolicyField(evidence.model, MODEL_EVIDENCE_MAX_LENGTH);
  if (!model || model !== evidence.model) {
    throw new Error("Adopted Learn token usage receipt is missing its exact model");
  }
  if (
    evidence.reasoningEffort !== "max" ||
    evidence.reasoningSummary !== "detailed"
  ) {
    throw new Error(
      "Adopted Learn token usage receipt must use max/detailed reasoning",
    );
  }
}

function assertDispatchObservation(
  dispatchCount: number,
  httpCompletionObserved: boolean,
): void {
  if (!Number.isInteger(dispatchCount) || dispatchCount < 0 || dispatchCount > 2) {
    throw new Error("Learn token usage receipt dispatch count is invalid");
  }
  if (typeof httpCompletionObserved !== "boolean") {
    throw new Error("Learn token usage receipt HTTP completion flag is invalid");
  }
  if (dispatchCount === 0 && httpCompletionObserved) {
    throw new Error(
      "Learn token usage receipt cannot observe HTTP completion without dispatch",
    );
  }
}

function assertProviderCallAccounting(
  reconciliation: PersistedLearnReceiptReconciliation,
): void {
  const {
    providerCallCount,
    reportedCallCount,
    estimatedCallCount,
    lifecycleRequestId,
  } = reconciliation;
  if (
    (providerCallCount !== 1 && providerCallCount !== 2) ||
    !Number.isSafeInteger(reportedCallCount) ||
    reportedCallCount < 0 ||
    reportedCallCount > providerCallCount ||
    !Number.isSafeInteger(estimatedCallCount) ||
    estimatedCallCount < 0 ||
    estimatedCallCount > providerCallCount
  ) {
    throw new Error("Learn token usage receipt provider-call accounting is invalid");
  }
  if (lifecycleRequestId !== undefined) {
    assertReceiptIdentity(lifecycleRequestId, reconciliation.requestHash);
  }
}

function assertReceiptAccountingIsCompatible(
  existing: LearnTokenUsageReceiptAccountingRow,
  jobId: string,
  reconciliation: PersistedLearnReceiptReconciliation,
): void {
  const usage = reconciliation.usage;
  const evidence = reconciliation.requestEvidence;
  const lifecycleRequestId =
    reconciliation.lifecycleRequestId ?? reconciliation.receiptId;
  if (
    existing.lifecycle_request_id !== lifecycleRequestId ||
    existing.request_hash !== reconciliation.requestHash ||
    existing.job_id !== jobId ||
    existing.input_tokens !== usage.inputTokens ||
    existing.output_tokens !== usage.outputTokens ||
    existing.total_tokens !== usage.totalTokens ||
    existing.cached_input_tokens !== usage.cachedInputTokens ||
    existing.reasoning_tokens !== usage.reasoningTokens ||
    existing.provider_call_count !== reconciliation.providerCallCount ||
    existing.reported_call_count !== reconciliation.reportedCallCount ||
    existing.estimated_call_count !== reconciliation.estimatedCallCount ||
    existing.request_model !== evidence.model ||
    existing.reasoning_effort !== evidence.reasoningEffort ||
    existing.reasoning_summary !== evidence.reasoningSummary
  ) {
    throw new Error(
      `Learn token usage receipt identity conflict for ${reconciliation.receiptId}`,
    );
  }
}

function counterReconciliationError(
  reconciliation: PersistedLearnReceiptReconciliation,
): Error {
  return new Error(
    `Learn token usage receipt ${reconciliation.receiptId} could not reconcile tracked counters`,
  );
}

function exactRequestLifecycle(
  database: Database.Database,
  jobId: string,
  requestId: string,
): LearnTokenUsageRequestLifecycleRow | undefined {
  return database.prepare(
    `SELECT job_id, request_id, request_hash,
            input_tokens, output_tokens, total_tokens,
            cached_input_tokens, reasoning_tokens,
            started_requests, completed_requests, reported_requests,
            estimated_requests, request_model, reasoning_effort,
            reasoning_summary
     FROM learn_token_usage_request_lifecycles
     WHERE job_id = ? AND request_id = ?`,
  ).get(jobId, requestId) as LearnTokenUsageRequestLifecycleRow | undefined;
}

function assertExactLifecycleBinding(
  row: LearnTokenUsageRequestLifecycleRow,
  requestHash: string,
  evidence: LearnModelRequestEvidence,
): void {
  const durableEvidence = durableRequestEvidence(evidence);
  if (
    row.request_hash !== requestHash ||
    row.request_model !== durableEvidence.model ||
    row.reasoning_effort !== durableEvidence.reasoningEffort ||
    row.reasoning_summary !== durableEvidence.reasoningSummary
  ) {
    throw new Error(
      `Learn token usage request identity conflict for ${row.request_id}`,
    );
  }
}

function insertEmptyExactLifecycle(
  database: Database.Database,
  jobId: string,
  identity: LearnModelRequestIdentity,
  evidence: LearnModelRequestEvidence | undefined,
  updatedAt: string,
): LearnTokenUsageRequestLifecycleRow {
  assertRequestIdentity(identity);
  const durableEvidence = evidence ? durableRequestEvidence(evidence) : null;
  database.prepare(
    `INSERT OR IGNORE INTO learn_token_usage_request_lifecycles (
       job_id, request_id, request_hash,
       request_model, reasoning_effort, reasoning_summary,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    jobId,
    identity.clientRequestId,
    identity.clientRequestHash,
    durableEvidence?.model ?? null,
    durableEvidence?.reasoningEffort ?? null,
    durableEvidence?.reasoningSummary ?? null,
    updatedAt,
    updatedAt,
  );
  const row = exactRequestLifecycle(database, jobId, identity.clientRequestId);
  if (!row) {
    throw new Error("Learn token usage exact request lifecycle was not persisted");
  }
  if (row.request_hash !== identity.clientRequestHash) {
    throw new Error(
      `Learn token usage request identity conflict for ${identity.clientRequestId}`,
    );
  }
  if (evidence) {
    assertExactLifecycleBinding(row, identity.clientRequestHash, evidence);
  }
  return row;
}

/**
 * Apply exact usage proven by one completed durable request receipt.
 *
 * The receipt identity is committed in the same immediate transaction as the
 * counters. Repeating the same receipt returns false without changing usage;
 * reusing its ID with a different hash, job, or mode fails closed.
 *
 * Reconciliation is anchored to the exact clientRequestId/requestHash row,
 * never to an available slot in the job-wide aggregates. This matters when a
 * process recovers a completed receipt after its tracked HTTP response was
 * already persisted: that exact row is normalized in place instead of adding
 * a duplicate lifecycle. Per-generation aliases may target the same tracked
 * lifecycle so a failed generation can be accounted before generation 2, then
 * extended cumulatively without losing or duplicating either provider call.
 * When the current job has no row and made zero dispatches, the receipt is a
 * genuine cross-job adoption and contributes the final provider call once.
 */
export function reconcilePersistedLearnTokenUsageFromReceipt(
  database: Database.Database,
  jobId: string,
  reconciliation: PersistedLearnReceiptReconciliation,
  updatedAt: string,
): boolean {
  assertReceiptIdentity(
    reconciliation.receiptId,
    reconciliation.requestHash,
  );
  assertExactTokenUsage(reconciliation.usage);
  assertAdoptedRequestEvidence(reconciliation.requestEvidence);
  assertDispatchObservation(
    reconciliation.dispatchCount,
    reconciliation.httpCompletionObserved,
  );
  assertProviderCallAccounting(reconciliation);

  return database.transaction(() => {
    const existing = database.prepare(
      `SELECT receipt_id, lifecycle_request_id, request_hash, job_id,
              input_tokens, output_tokens, total_tokens,
              cached_input_tokens, reasoning_tokens,
              request_model, reasoning_effort, reasoning_summary,
              provider_call_count, reported_call_count, estimated_call_count
       FROM learn_token_usage_receipt_accounting
       WHERE receipt_id = ?`,
    ).get(reconciliation.receiptId) as
      | LearnTokenUsageReceiptAccountingRow
      | undefined;
    const alreadyAccounted = Boolean(existing);
    if (existing) {
      // Idempotent re-observation must still heal a later pre-accept HTTP
      // phantom on the same tracked lifecycle (for example, a generation-2
      // POST that never reached the server after generation 1 was accounted).
      assertReceiptAccountingIsCompatible(existing, jobId, reconciliation);
    }

    const usage = reconciliation.usage;
    const evidence = reconciliation.requestEvidence;
    const { dispatchCount, httpCompletionObserved } = reconciliation;
    database.prepare(
      `INSERT OR IGNORE INTO learn_job_token_usage (job_id, usage_updated_at)
       VALUES (?, ?)`,
    ).run(jobId, updatedAt);

    const lifecycleRequestId =
      reconciliation.lifecycleRequestId ?? reconciliation.receiptId;
    let lifecycle = exactRequestLifecycle(
      database,
      jobId,
      lifecycleRequestId,
    );
    if (!lifecycle && dispatchCount !== 0) {
      throw counterReconciliationError(reconciliation);
    }
    if (!lifecycle) {
      lifecycle = insertEmptyExactLifecycle(
        database,
        jobId,
        {
          clientRequestId: lifecycleRequestId,
          clientRequestHash: reconciliation.requestHash,
        },
        evidence,
        updatedAt,
      );
    } else {
      assertExactLifecycleBinding(
        lifecycle,
        reconciliation.requestHash,
        evidence,
      );
    }

    const lifecycleCounters = [
      lifecycle.started_requests,
      lifecycle.completed_requests,
      lifecycle.reported_requests,
      lifecycle.estimated_requests,
    ];
    if (
      lifecycleCounters.some((value) => !Number.isSafeInteger(value) || value < 0) ||
      lifecycle.started_requests < lifecycle.completed_requests ||
      lifecycle.completed_requests < lifecycle.reported_requests ||
      dispatchCount > lifecycle.started_requests
    ) {
      throw counterReconciliationError(reconciliation);
    }

    const aggregate = database.prepare(
      `SELECT * FROM learn_job_token_usage WHERE job_id = ?`,
    ).get(jobId) as LearnJobTokenUsageRow | undefined;
    if (!aggregate) throw counterReconciliationError(reconciliation);
    const observedPolicy = Number(aggregate.policy_observed_requests ?? 0);
    if (
      observedPolicy > 0 &&
      (
        Number(aggregate.policy_mismatch_requests ?? 0) !== 0 ||
        aggregate.request_model !== evidence.model ||
        aggregate.reasoning_effort !== evidence.reasoningEffort ||
        aggregate.reasoning_summary !== evidence.reasoningSummary
      )
    ) {
      throw new Error("Adopted Learn receipt conflicts with job request policy");
    }

    const deltas = {
      inputTokens: usage.inputTokens - lifecycle.input_tokens,
      outputTokens: usage.outputTokens - lifecycle.output_tokens,
      totalTokens: usage.totalTokens - lifecycle.total_tokens,
      cachedInputTokens: usage.cachedInputTokens - lifecycle.cached_input_tokens,
      reasoningTokens: usage.reasoningTokens - lifecycle.reasoning_tokens,
      startedRequests: reconciliation.providerCallCount - lifecycle.started_requests,
      completedRequests: reconciliation.providerCallCount - lifecycle.completed_requests,
      reportedRequests: reconciliation.reportedCallCount - lifecycle.reported_requests,
      estimatedRequests: reconciliation.estimatedCallCount - lifecycle.estimated_requests,
      observedPolicyRequests: reconciliation.providerCallCount - lifecycle.started_requests,
    };
    const next = {
      inputTokens: Number(aggregate.input_tokens ?? 0) + deltas.inputTokens,
      outputTokens: Number(aggregate.output_tokens ?? 0) + deltas.outputTokens,
      totalTokens: Number(aggregate.total_tokens ?? 0) + deltas.totalTokens,
      cachedInputTokens: Number(aggregate.cached_input_tokens ?? 0) +
        deltas.cachedInputTokens,
      reasoningTokens: Number(aggregate.reasoning_tokens ?? 0) +
        deltas.reasoningTokens,
      startedRequests: Number(aggregate.started_requests ?? 0) +
        deltas.startedRequests,
      completedRequests: Number(aggregate.completed_requests ?? 0) +
        deltas.completedRequests,
      reportedRequests: Number(aggregate.reported_requests ?? 0) +
        deltas.reportedRequests,
      estimatedRequests: Number(aggregate.estimated_requests ?? 0) +
        deltas.estimatedRequests,
      observedPolicyRequests: observedPolicy + deltas.observedPolicyRequests,
    };
    if (
      Object.values(next).some((value) => !Number.isSafeInteger(value) || value < 0) ||
      next.startedRequests < next.completedRequests ||
      next.completedRequests < next.reportedRequests
    ) {
      throw counterReconciliationError(reconciliation);
    }

    database.prepare(
      `UPDATE learn_job_token_usage
       SET input_tokens = ?, output_tokens = ?, total_tokens = ?,
           cached_input_tokens = ?, reasoning_tokens = ?,
           started_requests = ?, completed_requests = ?,
           reported_requests = ?, estimated_requests = ?,
           request_model = CASE
             WHEN policy_observed_requests = 0 THEN ? ELSE request_model END,
           reasoning_effort = CASE
             WHEN policy_observed_requests = 0 THEN ? ELSE reasoning_effort END,
           reasoning_summary = CASE
             WHEN policy_observed_requests = 0 THEN ? ELSE reasoning_summary END,
           policy_observed_requests = ?, usage_updated_at = ?
       WHERE job_id = ?`,
    ).run(
      next.inputTokens,
      next.outputTokens,
      next.totalTokens,
      next.cachedInputTokens,
      next.reasoningTokens,
      next.startedRequests,
      next.completedRequests,
      next.reportedRequests,
      next.estimatedRequests,
      evidence.model,
      evidence.reasoningEffort,
      evidence.reasoningSummary,
      next.observedPolicyRequests,
      updatedAt,
      jobId,
    );
    database.prepare(
      `UPDATE learn_token_usage_request_lifecycles
       SET input_tokens = ?, output_tokens = ?, total_tokens = ?,
           cached_input_tokens = ?, reasoning_tokens = ?,
           started_requests = ?, completed_requests = ?,
           reported_requests = ?, estimated_requests = ?,
           updated_at = ?
       WHERE job_id = ? AND request_id = ? AND request_hash = ?`,
    ).run(
      usage.inputTokens,
      usage.outputTokens,
      usage.totalTokens,
      usage.cachedInputTokens,
      usage.reasoningTokens,
      reconciliation.providerCallCount,
      reconciliation.providerCallCount,
      reconciliation.reportedCallCount,
      reconciliation.estimatedCallCount,
      updatedAt,
      jobId,
      lifecycleRequestId,
      reconciliation.requestHash,
    );
    if (!alreadyAccounted) {
      database.prepare(
        `INSERT INTO learn_token_usage_receipt_accounting (
         receipt_id, lifecycle_request_id, request_hash, job_id,
         input_tokens, output_tokens, total_tokens,
         cached_input_tokens, reasoning_tokens,
         request_model, reasoning_effort, reasoning_summary,
         provider_call_count, reported_call_count, estimated_call_count,
         observed_dispatch_count, http_completion_observed, applied_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        reconciliation.receiptId,
        lifecycleRequestId,
        reconciliation.requestHash,
        jobId,
        usage.inputTokens,
        usage.outputTokens,
        usage.totalTokens,
        usage.cachedInputTokens,
        usage.reasoningTokens,
        evidence.model,
        evidence.reasoningEffort,
        evidence.reasoningSummary,
        reconciliation.providerCallCount,
        reconciliation.reportedCallCount,
        reconciliation.estimatedCallCount,
        dispatchCount,
        httpCompletionObserved ? 1 : 0,
        updatedAt,
      );
    }
    return !alreadyAccounted;
  }).immediate();
}

/** Remove one exact tracked HTTP lifecycle after the server positively proves
 * that no durable receipt (and therefore no provider generation) existed.
 * The lifecycle can contain the initial POST plus its sole same-id missing-
 * receipt recovery; both are HTTP phantoms of the same absent generation.
 * This is intentionally narrower than ordinary reconciliation: non-zero
 * usage, more than the bounded two HTTP attempts, or prior receipt accounting
 * is ambiguity. */
export function discardPersistedLearnTokenUsageForProvenMissingReceipt(
  database: Database.Database,
  jobId: string,
  requestId: string,
  requestHash: string,
  updatedAt: string,
): boolean {
  assertReceiptIdentity(requestId, requestHash);
  return database.transaction(() => {
    const lifecycle = exactRequestLifecycle(database, jobId, requestId);
    if (!lifecycle) return false;
    const phantomCallCount = lifecycle.started_requests;
    if (
      lifecycle.request_hash !== requestHash ||
      (phantomCallCount !== 1 && phantomCallCount !== 2) ||
      lifecycle.completed_requests !== phantomCallCount ||
      lifecycle.reported_requests !== 0 ||
      lifecycle.estimated_requests !== 0 ||
      lifecycle.input_tokens !== 0 ||
      lifecycle.output_tokens !== 0 ||
      lifecycle.total_tokens !== 0 ||
      lifecycle.cached_input_tokens !== 0 ||
      lifecycle.reasoning_tokens !== 0 ||
      database.prepare(
        `SELECT 1 FROM learn_token_usage_receipt_accounting
         WHERE job_id = ? AND lifecycle_request_id = ? LIMIT 1`,
      ).get(jobId, requestId)
    ) {
      throw new Error(
        "Proven-missing Learn receipt conflicts with its tracked lifecycle",
      );
    }
    const aggregate = database.prepare(
      "SELECT * FROM learn_job_token_usage WHERE job_id = ?",
    ).get(jobId) as LearnJobTokenUsageRow | undefined;
    if (
      !aggregate ||
      Number(aggregate.started_requests ?? 0) < phantomCallCount ||
      Number(aggregate.completed_requests ?? 0) < phantomCallCount ||
      Number(aggregate.policy_observed_requests ?? 0) < phantomCallCount
    ) {
      throw new Error(
        "Proven-missing Learn receipt cannot reconcile aggregate counters",
      );
    }
    const removed = database.prepare(
      `DELETE FROM learn_token_usage_request_lifecycles
       WHERE job_id = ? AND request_id = ? AND request_hash = ?`,
    ).run(jobId, requestId, requestHash);
    if (removed.changes !== 1) {
      throw new Error("Proven-missing Learn receipt lifecycle was not removed");
    }
    database.prepare(
      `UPDATE learn_job_token_usage
       SET started_requests = started_requests - ?,
           completed_requests = completed_requests - ?,
           policy_observed_requests = policy_observed_requests - ?,
           usage_updated_at = ?
       WHERE job_id = ?`,
    ).run(
      phantomCallCount,
      phantomCallCount,
      phantomCallCount,
      updatedAt,
      jobId,
    );
    return true;
  }).immediate();
}

function requestPolicyFromRow(
  row: LearnJobTokenUsageRow,
): LearnModelRequestPolicyReceipt | undefined {
  const observedCalls = Math.max(0, Number(row.policy_observed_requests ?? 0));
  if (observedCalls === 0) return undefined;
  const model = boundedPolicyField(row.request_model, MODEL_EVIDENCE_MAX_LENGTH);
  const reasoningEffort = boundedPolicyField(
    row.reasoning_effort,
    REASONING_EVIDENCE_MAX_LENGTH,
  );
  const reasoningSummary = boundedPolicyField(
    row.reasoning_summary,
    REASONING_EVIDENCE_MAX_LENGTH,
  );
  return {
    model,
    reasoningEffort,
    reasoningSummary,
    observedCalls,
    consistent: Boolean(model && reasoningEffort && reasoningSummary) &&
      Number(row.policy_mismatch_requests ?? 0) === 0,
  };
}

export function persistedLearnTokenUsageForJob(
  database: Database.Database,
  jobId: string,
): LearnTokenUsage {
  const row = database
    .prepare("SELECT * FROM learn_job_token_usage WHERE job_id = ?")
    .get(jobId) as LearnJobTokenUsageRow | undefined;
  if (!row) return emptyLearnTokenUsage();

  const startedCalls = Number(row.started_requests ?? 0);
  const completedCalls = Number(row.completed_requests ?? 0);
  const reportedCalls = Number(row.reported_requests ?? 0);
  const requestPolicy = requestPolicyFromRow(row);
  return {
    inputTokens: Number(row.input_tokens ?? 0),
    outputTokens: Number(row.output_tokens ?? 0),
    totalTokens: Number(row.total_tokens ?? 0),
    cachedInputTokens: Number(row.cached_input_tokens ?? 0),
    reasoningTokens: Number(row.reasoning_tokens ?? 0),
    estimated: Number(row.estimated_requests ?? 0) > 0,
    startedCalls,
    completedCalls,
    reportedCalls,
    unreportedCalls: Math.max(0, completedCalls - reportedCalls),
    inFlightCalls: Math.max(0, startedCalls - completedCalls),
    ...(requestPolicy ? { requestPolicy } : {}),
  };
}

export function recordPersistedLearnTokenUsageEvent(
  database: Database.Database,
  jobId: string,
  event: LearnTokenUsageEvent,
  updatedAt: string,
): void {
  const apply = () => {
    database.prepare(
      `INSERT OR IGNORE INTO learn_job_token_usage (job_id, usage_updated_at)
       VALUES (?, ?)`,
    ).run(jobId, updatedAt);

    if (event.type === "started") {
      if (event.requestIdentity) {
        insertEmptyExactLifecycle(
          database,
          jobId,
          event.requestIdentity,
          event.requestEvidence,
          updatedAt,
        );
        const exactUpdate = database.prepare(
          `UPDATE learn_token_usage_request_lifecycles
           SET started_requests = started_requests + 1,
               updated_at = ?
           WHERE job_id = ? AND request_id = ? AND request_hash = ?`,
        ).run(
          updatedAt,
          jobId,
          event.requestIdentity.clientRequestId,
          event.requestIdentity.clientRequestHash,
        );
        if (exactUpdate.changes !== 1) {
          throw new Error("Learn token usage exact request start was not persisted");
        }
      }
      if (!event.requestEvidence) {
        database.prepare(
          `UPDATE learn_job_token_usage
           SET started_requests = started_requests + 1,
               usage_updated_at = ?
           WHERE job_id = ?`,
        ).run(updatedAt, jobId);
        return;
      }
      const evidence = durableRequestEvidence(event.requestEvidence);
      database.prepare(
        `UPDATE learn_job_token_usage
         SET started_requests = started_requests + 1,
             request_model = CASE
               WHEN policy_observed_requests = 0 THEN ? ELSE request_model END,
             reasoning_effort = CASE
               WHEN policy_observed_requests = 0 THEN ? ELSE reasoning_effort END,
             reasoning_summary = CASE
               WHEN policy_observed_requests = 0 THEN ? ELSE reasoning_summary END,
             policy_mismatch_requests = policy_mismatch_requests + CASE
               WHEN policy_observed_requests = 0 OR (
                 request_model IS ? AND
                 reasoning_effort IS ? AND
                 reasoning_summary IS ?
               ) THEN 0 ELSE 1 END,
             policy_observed_requests = policy_observed_requests + 1,
             usage_updated_at = ?
         WHERE job_id = ?`,
      ).run(
        evidence.model,
        evidence.reasoningEffort,
        evidence.reasoningSummary,
        evidence.model,
        evidence.reasoningEffort,
        evidence.reasoningSummary,
        updatedAt,
        jobId,
      );
      return;
    }

    const usage = event.usage;
    if (event.requestIdentity) {
      assertRequestIdentity(event.requestIdentity);
      const lifecycle = exactRequestLifecycle(
        database,
        jobId,
        event.requestIdentity.clientRequestId,
      );
      if (!lifecycle) {
        throw new Error("Learn token usage exact request completion has no start");
      }
      if (event.requestEvidence) {
        assertExactLifecycleBinding(
          lifecycle,
          event.requestIdentity.clientRequestHash,
          event.requestEvidence,
        );
      } else if (lifecycle.request_hash !== event.requestIdentity.clientRequestHash) {
        throw new Error(
          `Learn token usage request identity conflict for ${event.requestIdentity.clientRequestId}`,
        );
      }
      const exactUpdate = database.prepare(
        `UPDATE learn_token_usage_request_lifecycles
         SET input_tokens = input_tokens + ?,
             output_tokens = output_tokens + ?,
             total_tokens = total_tokens + ?,
             cached_input_tokens = cached_input_tokens + ?,
             reasoning_tokens = reasoning_tokens + ?,
             completed_requests = completed_requests + 1,
             reported_requests = reported_requests + ?,
             estimated_requests = estimated_requests + ?,
             updated_at = ?
         WHERE job_id = ? AND request_id = ? AND request_hash = ?
           AND completed_requests < started_requests`,
      ).run(
        usage?.inputTokens ?? 0,
        usage?.outputTokens ?? 0,
        usage?.totalTokens ?? 0,
        usage?.cachedInputTokens ?? 0,
        usage?.reasoningTokens ?? 0,
        usage ? 1 : 0,
        usage?.estimated ? 1 : 0,
        updatedAt,
        jobId,
        event.requestIdentity.clientRequestId,
        event.requestIdentity.clientRequestHash,
      );
      if (exactUpdate.changes !== 1) {
        throw new Error("Learn token usage exact request completion was not persisted");
      }
    }
    database.prepare(
      `UPDATE learn_job_token_usage
       SET input_tokens = input_tokens + ?,
           output_tokens = output_tokens + ?,
           total_tokens = total_tokens + ?,
           cached_input_tokens = cached_input_tokens + ?,
           reasoning_tokens = reasoning_tokens + ?,
           completed_requests = completed_requests + 1,
           reported_requests = reported_requests + ?,
           estimated_requests = estimated_requests + ?,
           usage_updated_at = ?
       WHERE job_id = ?`,
    ).run(
      usage?.inputTokens ?? 0,
      usage?.outputTokens ?? 0,
      usage?.totalTokens ?? 0,
      usage?.cachedInputTokens ?? 0,
      usage?.reasoningTokens ?? 0,
      usage ? 1 : 0,
      usage?.estimated ? 1 : 0,
      updatedAt,
      jobId,
    );
  };

  if (database.inTransaction) {
    apply();
  } else {
    database.transaction(apply).immediate();
  }
}

/**
 * Close request lifecycles that can no longer emit their normal `completed`
 * event because startup recovery proved the owning worker was abandoned.
 *
 * A completed request counter records that the lifecycle is terminal, not that
 * the provider returned usage. Keep reported_requests and every token counter
 * unchanged so the closed calls surface as unreported instead of fabricating a
 * token estimate. The conditional update makes recovery idempotent.
 */
export function reconcilePersistedLearnTokenUsageForTerminalJob(
  database: Database.Database,
  jobId: string,
  updatedAt: string,
): number {
  const result = database.prepare(
    `UPDATE learn_job_token_usage
     SET completed_requests = started_requests,
         usage_updated_at = ?
     WHERE job_id = ?
       AND completed_requests < started_requests`,
  ).run(updatedAt, jobId);
  return result.changes;
}

/**
 * Startup maintenance for jobs terminalized by an older process that did not
 * yet reconcile request lifecycles. The age fence is essential: it prevents a
 * just-cancelled worker from racing this sweep while its normal completion
 * observer is still unwinding. Status reads remain pure; only the recovery
 * worker invokes this mutation.
 */
export function reconcilePersistedLearnTokenUsageForStaleTerminalJobs(
  database: Database.Database,
  terminalBefore: string,
  updatedAt: string,
): string[] {
  const rows = database.prepare(
    `UPDATE learn_job_token_usage
     SET completed_requests = started_requests,
         usage_updated_at = ?
     WHERE completed_requests < started_requests
       AND job_id IN (
         SELECT id
         FROM learn_jobs
         WHERE status IN ('failed', 'cancelled', 'complete')
           AND updated_at <= ?
       )
     RETURNING job_id`,
  ).all(updatedAt, terminalBefore) as Array<{ job_id: string }>;
  return rows.map((row) => row.job_id);
}
