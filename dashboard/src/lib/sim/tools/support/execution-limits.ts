// Vendored from simstudioai/sim (Apache-2.0), apps/sim/lib/core/execution-limits
// — adapted for Breadboard: fixed limits sized to the Hermes tool route (the
// route's maxDuration is 120s and the Python caller times out at 130s), instead
// of sim's per-plan billing lookups.

/** Default per-request timeout for a tool HTTP call. */
export const DEFAULT_EXECUTION_TIMEOUT_MS = 60_000;

/** Hard ceiling for any tool execution inside one Hermes tool-route request. */
export function getMaxExecutionTimeout(): number {
  return 110_000;
}

export interface TimeoutAbortController {
  signal: AbortSignal;
  isTimedOut: () => boolean;
  cleanup: () => void;
  abort: () => void;
}

export function isTimeoutError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof Error) return error.name === "TimeoutError";
  if (typeof error === "object" && "name" in error) {
    return (error as { name: string }).name === "TimeoutError";
  }
  return false;
}

export function createTimeoutAbortController(
  timeoutMs?: number,
  parentSignal?: AbortSignal,
): TimeoutAbortController {
  const abortController = new AbortController();
  let isTimedOut = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const abortFromParent = () => {
    abortController.abort(parentSignal?.reason ?? new DOMException("user", "AbortError"));
  };

  if (timeoutMs) {
    timeoutId = setTimeout(() => {
      isTimedOut = true;
      abortController.abort(new DOMException("timeout", "AbortError"));
    }, timeoutMs);
  }
  if (parentSignal) {
    if (parentSignal.aborted) abortFromParent();
    else parentSignal.addEventListener("abort", abortFromParent, { once: true });
  }

  return {
    signal: abortController.signal,
    isTimedOut: () => isTimedOut,
    cleanup: () => {
      if (timeoutId) clearTimeout(timeoutId);
      parentSignal?.removeEventListener("abort", abortFromParent);
    },
    abort: () => abortController.abort(new DOMException("user", "AbortError")),
  };
}
