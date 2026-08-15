export const MODEL_TRANSPORT_MAX_ATTEMPTS = 6;
export const MODEL_TRANSPORT_RETRY_INTERVAL_MS = 4 * 60 * 1000;

/** Delay before each attempt. Attempts 1-3 are adjacent; attempts 4-6 each
 * begin after a four-minute quiet period. */
export const MODEL_TRANSPORT_ATTEMPT_DELAYS_MS = [
  0,
  0,
  0,
  MODEL_TRANSPORT_RETRY_INTERVAL_MS,
  MODEL_TRANSPORT_RETRY_INTERVAL_MS,
  MODEL_TRANSPORT_RETRY_INTERVAL_MS,
] as const;

export interface ModelTransportAttempt {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  /** Why this retry is being attempted. Absent only for the first request. */
  retryCause?: ModelTransportRetryCause;
}

export type ModelTransportRetryCause = "http_502" | "connection_failure";

export interface ModelTransportRetryOptions {
  signal?: AbortSignal | null;
  sleep?: (delayMs: number, signal?: AbortSignal | null) => Promise<void>;
  onDelay?: (attempt: ModelTransportAttempt) => void;
  onAttempt?: (attempt: ModelTransportAttempt) => void;
}

/** Backward-compatible names for callers that predate connection-error retries. */
export const HTTP_502_MAX_ATTEMPTS = MODEL_TRANSPORT_MAX_ATTEMPTS;
export const HTTP_502_RETRY_INTERVAL_MS = MODEL_TRANSPORT_RETRY_INTERVAL_MS;
export const HTTP_502_ATTEMPT_DELAYS_MS = MODEL_TRANSPORT_ATTEMPT_DELAYS_MS;
export type Http502Attempt = ModelTransportAttempt;
export type Http502RetryOptions = ModelTransportRetryOptions;

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted", "AbortError");
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

const RETRYABLE_CONNECTION_CODES = new Set(["ECONNREFUSED", "ECONNRESET"]);
const RETRYABLE_CONNECTION_MESSAGE =
  /\bconnection error\b|\beconnrefused\b|\beconnreset\b|\bsocket hang(?:\s+)?up\b|\bresponse ended prematurely\b|\bpremature response\b/i;
const CANCELLATION_MESSAGE =
  /\b(?:request|operation|job) (?:was )?(?:cancelled|canceled|aborted)\b/i;
const TIMEOUT_MESSAGE = /\b(?:timed out|timeout)\b/i;

interface ErrorDetail {
  code: string;
  name: string;
  message: string;
  status?: number;
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
      details.push({ code: "", name: "", message: current });
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
    details.push({
      code: typeof record.code === "string" ? record.code : "",
      name: typeof record.name === "string" ? record.name : "",
      message: typeof record.message === "string" ? record.message : "",
      status: httpStatusFromError(current),
    });
    if (record.cause !== undefined) pending.push(record.cause);
    if (Array.isArray(record.errors)) pending.push(...record.errors);
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

/** Only failures that mean ChatMock disappeared between request and response
 * are replayable. If an HTTP response exists, 502 is the sole retryable
 * status. Aborts and timeouts remain caller-owned terminal outcomes. */
export function modelTransportRetryCause(
  error: unknown,
): ModelTransportRetryCause | undefined {
  const details = errorDetails(error);
  if (details.length === 0 || isCancellation(details)) return undefined;

  const responseStatus = details.find(({ status }) => status !== undefined)?.status;
  if (responseStatus !== undefined) {
    return responseStatus === 502 ? "http_502" : undefined;
  }
  if (isTimeout(details)) return undefined;

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

/** Retry one logical model request after a transient ChatMock transport
 * failure. The operation is called with the same inputs by its caller; these
 * transport attempts never become semantic-repair attempts. */
export async function retryModelTransport<T>(
  operation: (attempt: ModelTransportAttempt) => Promise<T>,
  options: ModelTransportRetryOptions = {},
): Promise<T> {
  const sleep = options.sleep ?? waitForRetry;
  let retryCause: ModelTransportRetryCause | undefined;
  for (let index = 0; index < MODEL_TRANSPORT_ATTEMPT_DELAYS_MS.length; index += 1) {
    if (options.signal?.aborted) throw abortReason(options.signal);
    const attempt: ModelTransportAttempt = {
      attempt: index + 1,
      maxAttempts: MODEL_TRANSPORT_MAX_ATTEMPTS,
      delayMs: MODEL_TRANSPORT_ATTEMPT_DELAYS_MS[index],
      ...(retryCause ? { retryCause } : {}),
    };
    if (attempt.delayMs > 0) {
      options.onDelay?.(attempt);
      await sleep(attempt.delayMs, options.signal);
      if (options.signal?.aborted) throw abortReason(options.signal);
    }
    options.onAttempt?.(attempt);
    try {
      return await operation(attempt);
    } catch (error) {
      if (options.signal?.aborted) throw abortReason(options.signal);
      retryCause = modelTransportRetryCause(error);
      if (!retryCause || attempt.attempt === attempt.maxAttempts) {
        throw error;
      }
    }
  }
  throw new Error("Model transport retry schedule did not run");
}

/** @deprecated Use retryModelTransport; this now also retries the narrowly
 * recognized connection failures handled by the Learn transport boundary. */
export function retryHttp502<T>(
  operation: (attempt: ModelTransportAttempt) => Promise<T>,
  options: ModelTransportRetryOptions = {},
): Promise<T> {
  return retryModelTransport(operation, options);
}
