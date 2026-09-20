// Resuming a Learn run that failed for a reason resuming can fix.
//
// Learn is a long job - a module can take a day of wall clock - and it dies
// from two very different kinds of cause. Some are accidents of machinery: a
// council receipt left unsettled by a restart, a web transport that stopped
// without recovering, a build lease still held by the previous run's rollback,
// a worker the supervisor tore down. Resubmitting fixes those outright,
// because the accepted pages replay from their receipts and the run continues
// where it stopped. Others are the run telling you the output is wrong: a
// lesson that cannot pass its quality gates, a plan that does not match its
// sources. Resubmitting those changes nothing - the same prompt meets the same
// reviewer and fails the same way - and every attempt costs real model calls.
//
// Until now only the first kind was ever hit in practice, and a person noticed
// the failure and resubmitted by hand, over thirty times for one module
// (telecom-1, 2026-09-17). This decides the same thing without them.
//
// The rules that keep it honest:
//   - Only a cause resuming can fix is resumed. Anything unrecognised is left
//     alone, because an unknown failure is exactly where a retry loop does
//     its damage.
//   - The same cause is resumed a bounded number of times. A transient fault
//     that repeats is not transient; it is a defect wearing a transient's
//     clothes, and it needs a person.
//   - A run is resumed a bounded number of times in total, however varied the
//     causes.
//   - A resume waits for the previous run's lease to clear, so it cannot race
//     the rollback that is still tidying up after the failure.

/** How a failure responds to being resumed. */
export type LearnFailureKind =
  /** Machinery. Resubmitting continues the run. */
  | "transient"
  /** The output did not pass. Resubmitting reproduces it. */
  | "content"
  /** Not recognised: left for a person, never resumed. */
  | "unknown";

/** Causes a resume repairs, each with the evidence that identifies it. */
const TRANSIENT_CAUSES: ReadonlyArray<{ cause: string; pattern: RegExp }> = [
  { cause: "lease-held", pattern: /Another Learn operation \([^)]*\) is already changing this garden/i },
  { cause: "model-transport", pattern: /Model transport stopped without verified recovery/i },
  { cause: "council-receipt-unproven", pattern: /Council receipt attempt does not prove one exact ordinary model call/i },
  { cause: "council-checkpoint-unauthorized", pattern: /checkpoint is request_failed; no model request was authorized/i },
  { cause: "council-receipt-expired", pattern: /(expired|orphaned|stale) (started )?receipt/i },
  { cause: "runtime-job-failed", pattern: /Runtime (job execution failed|could not complete the Learn operation)/i },
  { cause: "worker-torn-down", pattern: /\b(WORKER_FAILED|JOB_INTERRUPTED|SERVICE_DEPENDENCY_UNAVAILABLE)\b/ },
  // The runtime reaped the worker for memory, fifty minutes into a critic pass
  // that was otherwise going well (telecom-1, 2026-09-18, 7 GB free commit on
  // a 31 GB machine). Nothing about the content changed; once headroom
  // returns the run continues from its accepted pages.
  { cause: "worker-resource-exhausted", pattern: /WORKER_RESOURCE_EXHAUSTED|exhausted its enforced resource limit|\bresource_exhausted\b/i },
  { cause: "http-502", pattern: /\b502\b|bad gateway/i },
];

/** Causes a resume cannot repair. Named so they are never "unknown". */
const CONTENT_CAUSES: ReadonlyArray<{ cause: string; pattern: RegExp }> = [
  { cause: "lesson-quality-gates", pattern: /failed quality gates after \d+ attempts/i },
  { cause: "missing-lesson-pages", pattern: /missing lesson pages for existing units/i },
  { cause: "plan-mismatch", pattern: /requires? a new plan|requiresReplan/i },
  { cause: "disk-exhausted", pattern: /\bENOSPC\b|no space left on device/i },
  { cause: "model-unavailable", pattern: /signed out|not signed in to chatgpt\.com|usage limit|quota/i },
];

export interface LearnFailureClassification {
  kind: LearnFailureKind;
  /** Stable id for the cause, so repeats of one cause can be counted. */
  cause: string;
}

export function classifyLearnFailure(message: string): LearnFailureClassification {
  const text = String(message ?? "");
  // Content causes win a tie: "failed quality gates" inside a run that also
  // mentions a transport hiccup is still a page that did not pass.
  for (const { cause, pattern } of CONTENT_CAUSES) {
    if (pattern.test(text)) return { kind: "content", cause };
  }
  for (const { cause, pattern } of TRANSIENT_CAUSES) {
    if (pattern.test(text)) return { kind: "transient", cause };
  }
  return { kind: "unknown", cause: "unrecognised" };
}

/** Resumes allowed for one cause before it stops counting as transient. */
export const MAX_RESUMES_PER_CAUSE = 3;
/** Resumes allowed for one run in total, across every cause. */
export const MAX_RESUMES_PER_RUN = 25;
/** A run that has dispatched no model call for this long has stalled. */
export const STALL_WITHOUT_MODEL_CALL_MS = 15 * 60 * 1000;

export interface LearnAutoResumeLedger {
  gardenSlug: string;
  /** Resumes performed, by cause. */
  byCause: Record<string, number>;
  total: number;
  lastResumeAt?: string;
}

export interface LearnAutoResumeInput {
  ledger: LearnAutoResumeLedger;
  failureMessage: string;
  /** True while the previous run's build lease is still held. */
  leaseHeld: boolean;
}

export interface LearnAutoResumeDecision {
  resume: boolean;
  cause: string;
  kind: LearnFailureKind;
  /** Why, in the words a person reading the event log needs. */
  reason: string;
}

export function learnAutoResumeDecision(input: LearnAutoResumeInput): LearnAutoResumeDecision {
  const { kind, cause } = classifyLearnFailure(input.failureMessage);
  const seen = input.ledger.byCause[cause] ?? 0;
  const base = { cause, kind };

  if (kind === "content") {
    return { ...base, resume: false, reason: `${cause} is a result, not an accident; resuming would reproduce it.` };
  }
  if (kind === "unknown") {
    return { ...base, resume: false, reason: "The failure was not recognised, so it is left for a person to read." };
  }
  if (seen >= MAX_RESUMES_PER_CAUSE) {
    return {
      ...base,
      resume: false,
      reason: `${cause} has already been resumed ${seen} times; a fault that keeps returning is a defect, not a transient.`,
    };
  }
  if (input.ledger.total >= MAX_RESUMES_PER_RUN) {
    return { ...base, resume: false, reason: `This run has already been resumed ${input.ledger.total} times.` };
  }
  if (input.leaseHeld) {
    return {
      ...base,
      resume: false,
      reason: "The previous run still holds the build lease; the resume waits for it to clear rather than racing its rollback.",
    };
  }
  return { ...base, resume: true, reason: `${cause} is repaired by continuing the run from its accepted pages.` };
}

/** The ledger after a resume is performed. */
export function withRecordedLearnAutoResume(
  ledger: LearnAutoResumeLedger,
  cause: string,
  at = new Date(),
): LearnAutoResumeLedger {
  return {
    ...ledger,
    byCause: { ...ledger.byCause, [cause]: (ledger.byCause[cause] ?? 0) + 1 },
    total: ledger.total + 1,
    lastResumeAt: at.toISOString(),
  };
}

export function emptyLearnAutoResumeLedger(gardenSlug: string): LearnAutoResumeLedger {
  return { gardenSlug, byCause: {}, total: 0 };
}

export interface LearnStallInput {
  /** The job's reported state, as the status route gives it. */
  status: string;
  /** Model calls started so far, and when that count was last seen to move. */
  startedCalls: number;
  lastCallStartedAt: number;
  /** Calls still outstanding: a live call is not a stall, however long. */
  inFlightCalls: number;
  now: number;
}

/**
 * A run that is alive but no longer working. The worker keeps heartbeating, so
 * nothing fails and nothing progresses - the job simply stops dispatching
 * (telecom-1 11.3, 2026-09-17: a web turn was lost, the transport gave up as
 * "not_retryable", and the run sat at the same call count until it was
 * cancelled by hand). Only a run with no call outstanding can be stalled;
 * while one is in flight the right answer is to keep waiting.
 */
export function learnRunHasStalled(input: LearnStallInput): boolean {
  if (input.status !== "generating_learning_pages") return false;
  if (input.inFlightCalls > 0) return false;
  return input.now - input.lastCallStartedAt >= STALL_WITHOUT_MODEL_CALL_MS;
}
