/** One original request plus one replay whose recovery must be proven. A
 * second failure is new diagnostic evidence, not permission to run a ladder
 * of identical model calls. */
export const MODEL_TRANSPORT_MAX_ATTEMPTS = 2;
export const MODEL_TRANSPORT_RETRY_INTERVAL_MS = 0;
export const MODEL_TRANSPORT_ATTEMPT_DELAYS_MS = [0, 0] as const;

/** The complete quiet period before the final scheduled transport attempt.
 * Callers that impose a bounded logical-request deadline can derive it from
 * this value instead of silently pre-empting the retry contract. */
export const MODEL_TRANSPORT_TOTAL_DELAY_MS = MODEL_TRANSPORT_ATTEMPT_DELAYS_MS
  .reduce<number>((total, delayMs) => total + delayMs, 0);

export interface ModelTransportAttempt {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  /** Why this retry is being attempted. Absent only for the first request. */
  retryCause?: ModelTransportRetryCause;
  /** Durable/diagnostic identity of the positive state that allowed replay. */
  recoveryReceiptId?: string;
  recoveryEvidence?: string;
}

export type ModelTransportRetryCause = "connection_failure";

export interface ModelTransportRecoveryReceipt {
  id: string;
  evidence: string;
}

export interface ModelTransportRecoveryFailure {
  recovered: false;
  probeCount: number;
  outcome: string;
  httpStatus?: number;
}

export type ModelTransportRecoveryVerification =
  | ModelTransportRecoveryReceipt
  | ModelTransportRecoveryFailure;

export type ModelTransportRejectionCause =
  | "unqualified_http_502"
  | "partial_response"
  | "replay_disabled"
  | "recovery_unverified"
  | "attempts_exhausted"
  | "not_retryable";

export interface ModelTransportRejection {
  attempt: number;
  maxAttempts: number;
  rejectionCause: ModelTransportRejectionCause;
  retryCause?: ModelTransportRetryCause;
  httpStatus?: number;
  recoveryProbeCount?: number;
  recoveryProbeOutcome?: string;
  recoveryProbeHttpStatus?: number;
}

export interface ModelTransportRetryOptions {
  signal?: AbortSignal | null;
  /** Model POST consumers must use `never`: a downstream refusal can be
   * observed after an upstream accepted the logical request. */
  replayPolicy?: "never" | "verified_preaccept";
  sleep?: (delayMs: number, signal?: AbortSignal | null) => Promise<void>;
  /** Control-plane gate, intentionally distinct from observational callbacks.
   * A thrown cancellation/conflict prevents the next outbound request. */
  assertCanAttempt?: (attempt: ModelTransportAttempt) => void;
  onDelay?: (attempt: ModelTransportAttempt) => void | Promise<void>;
  onAttempt?: (attempt: ModelTransportAttempt) => void | Promise<void>;
  /**
   * Verify service recovery only after an exact operating-system ECONNREFUSED
   * proof. The retry boundary never calls this for resets, timeouts, partial
   * responses, aborts, generic connection failures, or mixed aggregates.
   */
  verifyConnectionRecovery?: (input: {
    attempt: number;
    maxAttempts: number;
    error: unknown;
    signal?: AbortSignal | null;
  }) => Promise<ModelTransportRecoveryVerification | null | undefined>;
  onRejected?: (rejection: ModelTransportRejection) => void | Promise<void>;
}

/** Backward-compatible names for callers that predate connection-error retries. */
export const HTTP_502_MAX_ATTEMPTS = MODEL_TRANSPORT_MAX_ATTEMPTS;
export const HTTP_502_RETRY_INTERVAL_MS = MODEL_TRANSPORT_RETRY_INTERVAL_MS;
export const HTTP_502_ATTEMPT_DELAYS_MS = MODEL_TRANSPORT_ATTEMPT_DELAYS_MS;
export const HTTP_502_TOTAL_DELAY_MS = MODEL_TRANSPORT_TOTAL_DELAY_MS;
export type Http502Attempt = ModelTransportAttempt;
export type Http502RetryOptions = ModelTransportRetryOptions;

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}

/** Telemetry is observational. A throwing or asynchronously rejecting callback
 * must never suppress a model request, replace its exact failure, or authorize
 * another attempt. */
function notifyModelTransportObserver<T>(
  observer: ((event: T) => void | Promise<void>) | undefined,
  event: T,
): void {
  if (!observer) return;
  try {
    const result = observer(event);
    if (result && typeof result.then === "function") {
      void result.catch(() => undefined);
    }
  } catch {
    // Deliberately ignore observer failures.
  }
}

async function waitForRetry(delayMs: number, signal?: AbortSignal | null): Promise<void> {
  if (delayMs <= 0) return;
  if (signal?.aborted) throw abortReason(signal);
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      reject(abortReason(signal!));
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function httpStatusFromError(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const direct = (error as { status?: unknown }).status;
  if (typeof direct === "number") return direct;
  const response = (error as { response?: unknown }).response;
  if (response && typeof response === "object") {
    const nested = (response as { status?: unknown }).status;
    if (typeof nested === "number") return nested;
  }
  return undefined;
}

const RETRYABLE_CONNECTION_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EPIPE",
  "ECONNABORTED",
  "ENETRESET",
]);
const RETRYABLE_CONNECTION_MESSAGE =
  /\bconnection error\b|\bfetch failed\b|\beconnrefused\b|\beconnreset\b|\bepipe\b|\bbroken pipe\b|\bsocket hang up\b/i;
const PARTIAL_RESPONSE_MESSAGE =
  /\bresponse ended prematurely\b|\bpremature response\b|\bchunked encoding\b|\bpartial (?:output|response)\b/i;
const CANCELLATION_MESSAGE =
  /\b(?:request|operation|job) (?:was )?(?:cancelled|canceled|aborted)\b/i;
const TIMEOUT_MESSAGE = /\b(?:timed out|timeout)\b/i;
// Some subscription gateways wrap an explicit spent-session response in 502.
// Require both a quota/limit marker and a reset/retry marker. A provider reset
// is terminal even if a gateway wrapped it in the status used by receipts.
const PROVIDER_QUOTA_OR_LIMIT_MESSAGE =
  /\b(?:session|usage|rate)\s+limit\b|\b(?:insufficient[_\s-]?quota|quota|credits?)\s+(?:is\s+)?(?:exhausted|exceeded|depleted)\b/i;
const PROVIDER_QUOTA_RESET_MESSAGE =
  /\breset(?:s|ting)?\b|\btry\s+again\b|\bretry(?:ing)?\b/i;

interface ErrorDetail {
  code: string;
  name: string;
  message: string;
  status?: number;
  leaf: boolean;
}

/** Read the wrapper, cause, and AggregateError branches without trusting any
 * single SDK/runtime error shape. The bound and seen set keep malformed cause
 * graphs from turning error handling into another failure. */
function errorDetails(error: unknown): ErrorDetail[] {
  const pending: unknown[] = [error];
  const seen = new Set<object>();
  const details: ErrorDetail[] = [];

  while (pending.length > 0 && details.length < 24) {
    const current = pending.shift();
    if (typeof current === "string") {
      details.push({ code: "", name: "", message: current, leaf: true });
      continue;
    }
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);

    const record = current as {
      cause?: unknown;
      code?: unknown;
      errors?: unknown;
      message?: unknown;
      name?: unknown;
    };
    const children: unknown[] = [];
    if (record.cause !== undefined) children.push(record.cause);
    if (Array.isArray(record.errors)) children.push(...record.errors);
    details.push({
      code: typeof record.code === "string" ? record.code : "",
      name: typeof record.name === "string" ? record.name : "",
      message: typeof record.message === "string" ? record.message : "",
      status: httpStatusFromError(current),
      leaf: children.length === 0,
    });
    pending.push(...children);
  }

  return details;
}

function isCancellation(details: ErrorDetail[]): boolean {
  return details.some(({ code, name, message }) => {
    const normalizedCode = code.toUpperCase();
    const normalizedName = name.toLowerCase();
    return (
      normalizedCode === "ABORT_ERR" ||
      normalizedCode === "ERR_CANCELED" ||
      normalizedCode === "ERR_CANCELLED" ||
      normalizedName.includes("abort") ||
      normalizedName.includes("cancel") ||
      CANCELLATION_MESSAGE.test(message)
    );
  });
}

function isTimeout(details: ErrorDetail[]): boolean {
  return details.some(({ code, name, message }) => (
    code.toUpperCase() === "ETIMEDOUT" ||
    name.toLowerCase().includes("timeout") ||
    TIMEOUT_MESSAGE.test(message)
  ));
}

function hasExplicitProviderQuotaReset(details: ErrorDetail[]): boolean {
  return details.some(({ message }) => (
    PROVIDER_QUOTA_OR_LIMIT_MESSAGE.test(message) &&
    PROVIDER_QUOTA_RESET_MESSAGE.test(message)
  ));
}

function hasCompetingAmbiguousConnectionBranch(details: ErrorDetail[]): boolean {
  return details.some(({ code, message }) =>
    ["ECONNRESET", "EPIPE", "ECONNABORTED", "ENETRESET"].includes(
      code.toUpperCase(),
    ) ||
    /\beconnreset\b|\bepipe\b|\bbroken pipe\b|\bsocket hang up\b/i.test(message),
  );
}

/**
 * The only connection outcome a later health check can make safely replayable:
 * every leaf carries the exact operating-system ECONNREFUSED code, proving no
 * listener accepted the request. A mixed AggregateError or any response,
 * reset, abort, timeout, partial-output, or quota branch fails closed.
 */
export function isStrictPreAcceptConnectionRefusal(error: unknown): boolean {
  const details = errorDetails(error);
  if (
    details.length === 0 ||
    details.some(({ status }) => status !== undefined) ||
    isCancellation(details) ||
    isTimeout(details) ||
    hasExplicitProviderQuotaReset(details) ||
    hasCompetingAmbiguousConnectionBranch(details) ||
    details.some(({ message }) => PARTIAL_RESPONSE_MESSAGE.test(message))
  ) {
    return false;
  }
  const leaves = details.filter(({ leaf }) => leaf);
  return (
    leaves.length > 0 &&
    leaves.every(({ code }) => code.toUpperCase() === "ECONNREFUSED")
  );
}

/** Deep wrapper/cause/AggregateError classification for failures whose exact
 * request outcome is unknown. Learn checks its durable cancellation state
 * before using this classifier so intentional job cancellation is not logged
 * as a transport ambiguity. */
export function isAmbiguousModelTransportFailure(error: unknown): boolean {
  const details = errorDetails(error);
  if (details.length === 0 || isStrictPreAcceptConnectionRefusal(error)) {
    return false;
  }
  const hasHttpResponse = details.some(({ status }) => status !== undefined);
  // A standalone HTTP response has a determinate result. If an AggregateError
  // or SDK wrapper also carries a distinct status-free reset/timeout leaf, that
  // competing branch remains ambiguous and must still reach Learn's ledger.
  const ambiguityDetails = hasHttpResponse
    ? details.filter(({ status, leaf }) => status === undefined && leaf)
    : details;
  return (
    isCancellation(ambiguityDetails) ||
    isTimeout(ambiguityDetails) ||
    ambiguityDetails.some(({ message }) => PARTIAL_RESPONSE_MESSAGE.test(message)) ||
    ambiguityDetails.some(({ code, message }) =>
      RETRYABLE_CONNECTION_CODES.has(code.toUpperCase()) ||
      RETRYABLE_CONNECTION_MESSAGE.test(message),
    )
  );
}

/** Whether an error belongs to the model request boundary rather than to
 * semantic validation of a returned model candidate. This deliberately
 * excludes cancellation so callers can preserve their owned abort identity. */
export function isModelTransportBoundaryFailure(error: unknown): boolean {
  const details = errorDetails(error);
  if (details.length === 0 || isCancellation(details)) return false;
  return (
    details.some(({ status }) => status !== undefined) ||
    isTimeout(details) ||
    hasExplicitProviderQuotaReset(details) ||
    details.some(({ message }) => PARTIAL_RESPONSE_MESSAGE.test(message)) ||
    details.some(({ code, message }) =>
      RETRYABLE_CONNECTION_CODES.has(code.toUpperCase()) ||
      RETRYABLE_CONNECTION_MESSAGE.test(message),
    )
  );
}

export interface ModelTransportFailureEvidence {
  causes: Array<{
    code?: string;
    name?: string;
    message?: string;
    httpStatus?: number;
    leaf: boolean;
  }>;
}

/** Serializable, cycle-safe evidence from the exact wrapper/cause graph. */
export function modelTransportFailureEvidence(
  error: unknown,
): ModelTransportFailureEvidence {
  return {
    causes: errorDetails(error).map(({ code, name, message, status, leaf }) => ({
      ...(code ? { code } : {}),
      ...(name ? { name } : {}),
      ...(message ? { message } : {}),
      ...(status !== undefined ? { httpStatus: status } : {}),
      leaf,
    })),
  };
}

/** Whether a provider expressly says that the selected model is quota-limited
 * until a reset/retry point, even when a gateway incorrectly wraps it in 502.
 * This is terminal at the Learn transport boundary: replaying the same model
 * cannot restore its session and must not spend the generic outage budget. */
export function isExplicitProviderQuotaResetError(error: unknown): boolean {
  return hasExplicitProviderQuotaReset(errorDetails(error));
}

/** Classify connection-shaped failures for terminal evidence. Replay still
 * requires the stricter exact-leaf ECONNREFUSED predicate plus a positive
 * request-bound recovery verification. Aborts, timeouts, partial responses,
 * resets, and every HTTP response remain terminal. */
export function modelTransportRetryCause(
  error: unknown,
): ModelTransportRetryCause | undefined {
  const details = errorDetails(error);
  if (details.length === 0 || isCancellation(details)) return undefined;
  if (hasExplicitProviderQuotaReset(details)) return undefined;
  if (isTimeout(details)) return undefined;
  if (details.some(({ message }) => PARTIAL_RESPONSE_MESSAGE.test(message))) {
    return undefined;
  }

  const responseStatus = details.find(({ status }) => status !== undefined)?.status;
  if (responseStatus !== undefined) {
    return undefined;
  }

  return details.some(({ code, message }) => (
    RETRYABLE_CONNECTION_CODES.has(code.toUpperCase()) ||
    RETRYABLE_CONNECTION_MESSAGE.test(message)
  ))
    ? "connection_failure"
    : undefined;
}

export function isRetryableModelTransportError(error: unknown): boolean {
  return modelTransportRetryCause(error) !== undefined;
}

function terminalRejectionCause(
  error: unknown,
  retryCause?: ModelTransportRetryCause,
): ModelTransportRejectionCause {
  if (retryCause === "connection_failure") return "recovery_unverified";
  const details = errorDetails(error);
  if (details.some(({ message }) => PARTIAL_RESPONSE_MESSAGE.test(message))) {
    return "partial_response";
  }
  if (details.some(({ status }) => status === 502)) return "unqualified_http_502";
  return "not_retryable";
}

function isRecoveryFailure(
  value: ModelTransportRecoveryVerification | null | undefined,
): value is ModelTransportRecoveryFailure {
  return Boolean(
    value &&
    "recovered" in value &&
    value.recovered === false,
  );
}

/** Run a bounded generic transport operation. Model POST consumers set
 * `replayPolicy: "never"`; the optional verified-refusal replay exists only for
 * boundaries that can prove a downstream refusal also means non-acceptance by
 * the authoritative upstream. Provider bodies/headers never authorize replay. */
export async function retryModelTransport<T>(
  operation: (attempt: ModelTransportAttempt) => Promise<T>,
  options: ModelTransportRetryOptions = {},
): Promise<T> {
  const sleep = options.sleep ?? waitForRetry;
  const replayEnabled = options.replayPolicy === "verified_preaccept";
  const attemptDelays = replayEnabled
    ? MODEL_TRANSPORT_ATTEMPT_DELAYS_MS
    : ([0] as const);
  const maxAttempts = attemptDelays.length;
  let retryCause: ModelTransportRetryCause | undefined;
  let recoveryReceipt: ModelTransportRecoveryReceipt | undefined;
  let recoveryFailure: ModelTransportRecoveryFailure | undefined;
  for (let index = 0; index < attemptDelays.length; index += 1) {
    if (options.signal?.aborted) throw abortReason(options.signal);
    const attempt: ModelTransportAttempt = {
      attempt: index + 1,
      maxAttempts,
      delayMs: attemptDelays[index],
      ...(retryCause ? { retryCause } : {}),
      ...(recoveryReceipt
        ? {
            recoveryReceiptId: recoveryReceipt.id,
            recoveryEvidence: recoveryReceipt.evidence,
          }
        : {}),
    };
    if (index > 0) {
      notifyModelTransportObserver(options.onDelay, attempt);
    }
    if (attempt.delayMs > 0) {
      await sleep(attempt.delayMs, options.signal);
      if (options.signal?.aborted) throw abortReason(options.signal);
    }
    options.assertCanAttempt?.(attempt);
    notifyModelTransportObserver(options.onAttempt, attempt);
    try {
      return await operation(attempt);
    } catch (error) {
      // Once the operation itself has rejected, that exact object is the
      // authoritative outcome. A concurrently observed abort must not replace
      // it with `signal.reason` (or accidentally authorize another attempt).
      if (options.signal?.aborted) throw error;
      retryCause = modelTransportRetryCause(error);
      if (!retryCause) {
        notifyModelTransportObserver(options.onRejected, {
          attempt: attempt.attempt,
          maxAttempts: attempt.maxAttempts,
          rejectionCause: terminalRejectionCause(error),
          ...(httpStatusFromError(error) !== undefined
            ? { httpStatus: httpStatusFromError(error) }
            : {}),
        });
        throw error;
      }
      if (!replayEnabled) {
        notifyModelTransportObserver(options.onRejected, {
          attempt: attempt.attempt,
          maxAttempts: attempt.maxAttempts,
          rejectionCause: "replay_disabled",
          retryCause,
          ...(httpStatusFromError(error) !== undefined
            ? { httpStatus: httpStatusFromError(error) }
            : {}),
        });
        throw error;
      }
      if (attempt.attempt === attempt.maxAttempts) {
        notifyModelTransportObserver(options.onRejected, {
          attempt: attempt.attempt,
          maxAttempts: attempt.maxAttempts,
          rejectionCause: "attempts_exhausted",
          retryCause,
          ...(httpStatusFromError(error) !== undefined
            ? { httpStatus: httpStatusFromError(error) }
            : {}),
        });
        throw error;
      }

      // A recovery authorization can come only from the configured verifier,
      // and the verifier is reachable only when exact leaf ECONNREFUSED proves
      // that no listener accepted the original request. Arbitrary provider
      // bodies/headers are never trusted as replay authorization.
      recoveryReceipt = undefined;
      recoveryFailure = undefined;
      if (
        retryCause === "connection_failure" &&
        isStrictPreAcceptConnectionRefusal(error)
      ) {
        try {
          const verification = await options.verifyConnectionRecovery?.({
            attempt: attempt.attempt,
            maxAttempts: attempt.maxAttempts,
            error,
            signal: options.signal,
          }) ?? undefined;
          if (isRecoveryFailure(verification)) {
            recoveryFailure = verification;
          } else {
            recoveryReceipt = verification;
          }
        } catch {
          recoveryFailure = {
            recovered: false,
            probeCount: 0,
            outcome: "observation_failed",
          };
        }
      }
      if (!recoveryReceipt) {
        notifyModelTransportObserver(options.onRejected, {
          attempt: attempt.attempt,
          maxAttempts: attempt.maxAttempts,
          rejectionCause: "recovery_unverified",
          retryCause,
          ...(httpStatusFromError(error) !== undefined
            ? { httpStatus: httpStatusFromError(error) }
            : {}),
          ...(recoveryFailure
            ? {
                recoveryProbeCount: recoveryFailure.probeCount,
                recoveryProbeOutcome: recoveryFailure.outcome,
                ...(recoveryFailure.httpStatus !== undefined
                  ? { recoveryProbeHttpStatus: recoveryFailure.httpStatus }
                  : {}),
              }
            : {}),
        });
        throw error;
      }
    }
  }
  throw new Error("Model transport retry schedule did not run");
}

/** @deprecated Use retryModelTransport; both names require recovery evidence. */
export function retryHttp502<T>(
  operation: (attempt: ModelTransportAttempt) => Promise<T>,
  options: ModelTransportRetryOptions = {},
): Promise<T> {
  return retryModelTransport(operation, options);
}
