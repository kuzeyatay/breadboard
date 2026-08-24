import type Database from "better-sqlite3";
import {
  emptyLearnTokenUsage,
  type LearnModelRequestEvidence,
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
  database.prepare(
    `INSERT OR IGNORE INTO learn_job_token_usage (job_id, usage_updated_at)
     VALUES (?, ?)`,
  ).run(jobId, updatedAt);

  if (event.type === "started") {
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
