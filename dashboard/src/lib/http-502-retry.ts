export const HTTP_502_MAX_ATTEMPTS = 6;
export const HTTP_502_RETRY_INTERVAL_MS = 4 * 60 * 1000;

/** Delay before each attempt. Attempts 1-3 are adjacent; attempts 4-6 each
 * begin after a four-minute quiet period. */
export const HTTP_502_ATTEMPT_DELAYS_MS = [
  0,
  0,
  0,
  HTTP_502_RETRY_INTERVAL_MS,
  HTTP_502_RETRY_INTERVAL_MS,
  HTTP_502_RETRY_INTERVAL_MS,
] as const;

export interface Http502Attempt {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
}

export interface Http502RetryOptions {
  signal?: AbortSignal | null;
  sleep?: (delayMs: number, signal?: AbortSignal | null) => Promise<void>;
  onDelay?: (attempt: Http502Attempt) => void;
  onAttempt?: (attempt: Http502Attempt) => void;
}

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

/** Retry one logical operation only when it rejects with HTTP status 502. */
export async function retryHttp502<T>(
  operation: (attempt: Http502Attempt) => Promise<T>,
  options: Http502RetryOptions = {},
): Promise<T> {
  const sleep = options.sleep ?? waitForRetry;
  for (let index = 0; index < HTTP_502_ATTEMPT_DELAYS_MS.length; index += 1) {
    const attempt: Http502Attempt = {
      attempt: index + 1,
      maxAttempts: HTTP_502_MAX_ATTEMPTS,
      delayMs: HTTP_502_ATTEMPT_DELAYS_MS[index],
    };
    if (attempt.delayMs > 0) {
      options.onDelay?.(attempt);
      await sleep(attempt.delayMs, options.signal);
    }
    options.onAttempt?.(attempt);
    try {
      return await operation(attempt);
    } catch (error) {
      if (httpStatusFromError(error) !== 502 || attempt.attempt === attempt.maxAttempts) {
        throw error;
      }
    }
  }
  throw new Error("HTTP 502 retry schedule did not run");
}
