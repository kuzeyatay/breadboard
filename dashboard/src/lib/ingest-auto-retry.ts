// Retrying a document upload that failed for a reason retrying can fix.
//
// Uploads now refuse rather than publishing a source whose summary is really
// the document's first 300 characters, which means a failure a person used to
// never see is now a failed row they have to notice and resume by hand. Most
// of those failures are machinery: ChatMock restarting under the job, a worker
// torn down mid-run, a runtime job that died. Resubmitting fixes them outright
// and costs almost nothing the second time, because the knowledge checkpoint
// is keyed by the document's own bytes — a book that failed on section 40 of
// 50 resumes at 40 rather than paying for the first 39 again.
//
// It is deliberately not "retry until it works". The one failure most likely
// to greet a retry loop here is a model that is out of credits, and replaying
// that burns the weekly window without ever succeeding. So this follows the
// same rules [[learn-auto-resume]] settled on:
//
//   - Only a cause retrying can fix is retried. Anything unrecognised is left
//     alone, because an unknown failure is where a retry loop does its damage.
//   - The same cause is retried a bounded number of times. A transient fault
//     that repeats is not transient; it is a defect wearing a transient's
//     clothes, and it needs a person.
//   - A document is retried a bounded number of times in total, however varied
//     the causes.
//   - Each retry waits longer than the last, so a service that is restarting
//     gets time to come back instead of being hammered while it does.
//
// When the budget runs out the upload fails exactly as it does today: the
// retained blob and its Resume button are untouched, so giving up
// automatically still leaves the manual path open.

/** How a failure responds to being retried. */
export type IngestFailureKind =
  /** Machinery. Resubmitting runs the job again from its checkpoint. */
  | "transient"
  /** Retrying reproduces it, or costs money to fail the same way. */
  | "permanent"
  /** Not recognised: left for a person, never retried. */
  | "unknown";

/**
 * Causes a retry repairs. The worker sanitizes every failure to a fixed
 * sentence before it crosses the boundary, so these match whole messages
 * rather than guessing at free text.
 */
const TRANSIENT_CAUSES: ReadonlyArray<{ cause: string; pattern: RegExp }> = [
  { cause: "concept-extraction", pattern: /building its summary and concepts failed/i },
  { cause: "runtime-job-failed", pattern: /^\s*Runtime job execution failed\.\s*$/i },
  { cause: "status-unrecovered", pattern: /Upload status could not be recovered/i },
];

/** Causes a retry cannot repair. Named so they are never "unknown". */
const PERMANENT_CAUSES: ReadonlyArray<{ cause: string; pattern: RegExp }> = [
  { cause: "provider-quota", pattern: /rate-limited or out of credits/i },
  { cause: "disk-exhausted", pattern: /\bENOSPC\b|no space left on device/i },
];

export interface IngestFailureClassification {
  kind: IngestFailureKind;
  /** Stable id for the cause, so repeats of one cause can be counted. */
  cause: string;
}

export function classifyIngestFailure(input: {
  message: string;
  /** The recovery record's own verdict, which outranks the message text. */
  failureKind?: "provider-quota" | "runtime" | null;
  /** The error event's code, when it carried one. */
  code?: string | null;
  /** The error event's own verdict on whether trying again could work. */
  retryable?: boolean | null;
}): IngestFailureClassification {
  // Structured evidence outranks pattern matching on the sentence a producer
  // chose to show. An event that says it is not retryable is taken at its
  // word: a memory-headroom denial fails the same way until something else on
  // the machine changes, and no amount of asking again changes it.
  if (input.failureKind === "provider-quota") {
    return { kind: "permanent", cause: "provider-quota" };
  }
  if (input.code === "BREADBOARD_RESOURCE_EXHAUSTED") {
    return { kind: "permanent", cause: "resource-exhausted" };
  }
  if (input.retryable === false) {
    return { kind: "permanent", cause: "declared-not-retryable" };
  }
  const text = String(input.message ?? "");
  for (const { cause, pattern } of PERMANENT_CAUSES) {
    if (pattern.test(text)) return { kind: "permanent", cause };
  }
  for (const { cause, pattern } of TRANSIENT_CAUSES) {
    if (pattern.test(text)) return { kind: "transient", cause };
  }
  return { kind: "unknown", cause: "unrecognised" };
}

/** Retries allowed for one cause before it stops counting as transient. */
export const MAX_RETRIES_PER_CAUSE = 3;
/** Retries allowed for one document in total, across every cause. */
export const MAX_RETRIES_PER_DOCUMENT = 5;
/**
 * How long to wait before each retry, by the number already made. A service
 * restarting under the job needs seconds; one that is still down after a
 * minute is not going to be fixed by asking again sooner.
 */
export const RETRY_DELAYS_MS: readonly number[] = [5_000, 20_000, 60_000];

export function ingestRetryDelayMs(retriesAlready: number): number {
  const index = Math.min(Math.max(retriesAlready, 0), RETRY_DELAYS_MS.length - 1);
  return RETRY_DELAYS_MS[index]!;
}

export interface IngestAutoRetryLedger {
  /** Identifies the document across attempts, not any one failed job. */
  documentKey: string;
  /** Retries performed, by cause. */
  byCause: Record<string, number>;
  total: number;
  lastRetryAt?: string;
}

export interface IngestAutoRetryInput {
  ledger: IngestAutoRetryLedger;
  failureMessage: string;
  failureKind?: "provider-quota" | "runtime" | null;
  /** The error event's code and retryable flag, when it carried them. */
  code?: string | null;
  retryable?: boolean | null;
  /**
   * Whether the worker kept the document for a resume. Without it there is
   * nothing to resubmit — the browser may hold an empty placeholder File from
   * an earlier resume — so the retry would upload zero bytes.
   */
  recoveryRetained: boolean;
  /** A person cancelling the task outranks any budget still left. */
  canceled?: boolean;
}

export interface IngestAutoRetryDecision {
  retry: boolean;
  cause: string;
  kind: IngestFailureKind;
  /** Milliseconds to wait first; 0 when not retrying. */
  delayMs: number;
  /** Why, in the words a person reading the upload row needs. */
  reason: string;
}

export function ingestAutoRetryDecision(
  input: IngestAutoRetryInput,
): IngestAutoRetryDecision {
  const { kind, cause } = classifyIngestFailure({
    message: input.failureMessage,
    failureKind: input.failureKind,
    code: input.code,
    retryable: input.retryable,
  });
  const seen = input.ledger.byCause[cause] ?? 0;
  const no = (reason: string): IngestAutoRetryDecision => ({
    retry: false, cause, kind, delayMs: 0, reason,
  });

  if (input.canceled) return no("The upload was cancelled.");
  if (kind === "permanent") {
    return no(`${cause} is not fixed by trying again, and every attempt costs a real model call.`);
  }
  if (kind === "unknown") {
    return no("The failure was not recognised, so it is left for a person to read.");
  }
  if (!input.recoveryRetained) {
    return no("The document was not retained, so there is nothing to resubmit.");
  }
  if (seen >= MAX_RETRIES_PER_CAUSE) {
    return no(
      `${cause} has already been retried ${seen} times; a fault that keeps returning is a defect, not a transient.`,
    );
  }
  if (input.ledger.total >= MAX_RETRIES_PER_DOCUMENT) {
    return no(`This document has already been retried ${input.ledger.total} times.`);
  }
  return {
    retry: true,
    cause,
    kind,
    delayMs: ingestRetryDelayMs(seen),
    reason: `${cause} is repaired by running the job again from its checkpoint.`,
  };
}

/** The ledger after a retry is performed. */
export function withRecordedIngestRetry(
  ledger: IngestAutoRetryLedger,
  cause: string,
  at = new Date(),
): IngestAutoRetryLedger {
  return {
    ...ledger,
    byCause: { ...ledger.byCause, [cause]: (ledger.byCause[cause] ?? 0) + 1 },
    total: ledger.total + 1,
    lastRetryAt: at.toISOString(),
  };
}

export function emptyIngestAutoRetryLedger(documentKey: string): IngestAutoRetryLedger {
  return { documentKey, byCause: {}, total: 0 };
}

/**
 * Identifies one document across its retries. The recovery id changes on every
 * failure, so counting against it would reset the budget each time and make
 * "bounded" mean nothing. Size is deliberately not part of it: a retry carries
 * an empty placeholder File, because the bytes are replayed from the server's
 * retained copy rather than re-uploaded, so size is 0 from the second attempt
 * on. Two same-named documents in one garden therefore share a budget, which
 * can only ever cause fewer retries than intended.
 */
export function ingestDocumentKey(input: {
  clusterSlug: string;
  filename: string;
}): string {
  return `${input.clusterSlug} ${input.filename}`;
}
