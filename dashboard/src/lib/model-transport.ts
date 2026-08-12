// What to say — and what to do — when a request never reaches the model.
//
// A transport failure has no HTTP status and no body to unwrap, and undici's
// message for every one of them is the bare string "fetch failed". Shown to a
// person that is nothing to act on: no subject, no service, no cause, and it
// reads like a bug in Breadboard rather than a model endpoint that went away.
// The distinguishing detail lives in the error's `cause` chain, so this module
// translates it and names the endpoint that failed.
//
// It also owns the one recovery worth attempting on its own. The usual cause on
// a machine running the local stack is the gateway restarting under its
// supervisor: whatever is in flight dies with the process and the same request
// succeeds a few seconds later. Re-sending is safe because a request that never
// arrived was never acted on — and even when it did arrive, a completion has no
// side effects on this side of the wire: tools run locally, after the answer.
// Costs tokens at worst, which is the cheaper of the two mistakes.
//
// Only transport failures are retried. An HTTP status is the upstream's own
// decision and re-sending argues with it.

/** How a dropped connection reads to someone who has to fix it. */
const REASONS: ReadonlyArray<[readonly string[], string]> = [
  [["ECONNREFUSED"], "nothing is listening there"],
  [["ENOTFOUND", "EAI_AGAIN"], "that host could not be resolved"],
  [["EHOSTUNREACH", "ENETUNREACH"], "that host could not be reached"],
  [
    ["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"],
    "it stopped responding",
  ],
  [
    ["ECONNRESET", "ECONNABORTED", "EPIPE", "UND_ERR_SOCKET"],
    "the connection dropped part-way through",
  ],
];

/** undici's own wording when the socket, not the request, is what failed. */
const TRANSPORT_MESSAGES = /^(fetch failed|failed to fetch|network error|terminated)\.?$/i;

/** Waits before re-sending. Spans a local service restarting under a supervisor. */
export const TRANSPORT_RETRY_DELAYS_MS: readonly number[] = [1_500, 4_000];

/**
 * The code the failure is really about.
 *
 * Every layer wraps the one below it — a `TypeError` around a `SocketError`
 * around an OS errno — and only the innermost one distinguishes "nothing is
 * listening" from "it hung up on us", so the chain is walked rather than read at
 * the top. `AggregateError` (a host that resolved to several addresses, all
 * refused) keeps its codes in `errors` instead of `cause`.
 */
export function transportFailureCode(error: unknown): string {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current && typeof current === "object"; depth += 1) {
    const record = current as { code?: unknown; cause?: unknown; errors?: unknown };
    if (typeof record.code === "string" && record.code) return record.code;
    if (Array.isArray(record.errors) && record.errors.length) {
      const nested = transportFailureCode(record.errors[0]);
      if (nested) return nested;
    }
    current = record.cause;
  }
  return "";
}

/**
 * Did this request fail before the model could answer it?
 *
 * An abort is deliberate — the run was stopped, or a deadline passed — so it is
 * not a transport failure however it is spelled, and it must never be retried.
 */
export function isTransportFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError" || error.name === "TimeoutError") return false;
  if (transportFailureCode(error) === "ABORT_ERR") return false;
  return Boolean(transportFailureCode(error)) || TRANSPORT_MESSAGES.test(error.message.trim());
}

/** The failure as a clause, ready to follow "…:" and precede "at <endpoint>". */
export function transportFailureReason(code: string): string {
  for (const [codes, reason] of REASONS) {
    if (codes.includes(code)) return reason;
  }
  return "the connection failed";
}

/**
 * The whole sentence a person reads: what was being attempted, what went wrong,
 * which endpoint it went wrong at, and what to do about it. The code is kept in
 * parentheses — useless to most readers, decisive for the one debugging it.
 */
export function describeTransportFailure(
  error: unknown,
  options: { endpoint: string; lead: string; recovery?: string },
): string {
  const code = transportFailureCode(error);
  const recovery =
    options.recovery ?? "Check that the model service is running, then try again.";
  return `${options.lead}: ${transportFailureReason(code)} at ${options.endpoint}. ${recovery}${
    code ? ` (${code})` : ""
  }`;
}

/**
 * The wait between attempts.
 *
 * Deliberately a *referenced* timer, unlike the retention timers elsewhere in
 * the agents: this one is a request in progress, and a process free to exit
 * during it abandons the very work the retry exists to save. It is bounded by
 * the schedule above and resolves either way, so nothing is held open for long.
 */
function pause(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
  });
}

/**
 * Send, and send again if the request never arrived.
 *
 * Stops immediately on anything that is not a transport failure, and on the
 * caller's own abort — a stopped run must not spend another four seconds
 * waiting to re-ask a question nobody is listening for any more. The last
 * failure is what propagates, so the message the reader gets describes the
 * attempt that actually gave up.
 */
export async function withTransportRetry<T>(
  send: () => Promise<T>,
  options: { signal?: AbortSignal; delaysMs?: readonly number[] } = {},
): Promise<T> {
  const delays = options.delaysMs ?? TRANSPORT_RETRY_DELAYS_MS;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await send();
    } catch (error) {
      const canRetry =
        attempt < delays.length && isTransportFailure(error) && !options.signal?.aborted;
      if (!canRetry) throw error;
      await pause(delays[attempt] ?? 0, options.signal);
      if (options.signal?.aborted) throw error;
    }
  }
}
