/**
 * Plain-language explanations for infrastructure failures.
 *
 * Raw transport text ("Failed to fetch", "fetch failed", "ECONNREFUSED",
 * "Unexpected token '<'") tells a person nothing and is what they saw while
 * Breadboard was being memory-killed and restarted. Each explanation says
 * what happened and what to do. Only a category is chosen from the raw
 * text; the raw text itself (which can hold paths or tokens) is never echoed.
 */

export type FailureKind =
  | "server_unreachable"
  | "offline"
  | "timeout"
  | "stream_cut"
  | "turn_interrupted"
  | "runtime_unreachable"
  | "out_of_memory"
  | "disk_full"
  | "database_busy"
  | "html_instead_of_json"
  | "rate_limited"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "too_large"
  | "server_error"
  | "service_unavailable";

export const FAILURE_EXPLANATIONS: Readonly<Record<FailureKind, string>> = {
  server_unreachable:
    "Breadboard's local server didn't answer. It is most likely restarting, which happens when the computer runs low on memory. Your work is saved; wait a few seconds and try again.",
  offline:
    "You appear to be offline, so this couldn't reach the internet. Check your connection and try again.",
  timeout:
    "This took too long to respond, so it was stopped. Breadboard or the service it uses may be overloaded; try again in a moment.",
  stream_cut:
    "The connection dropped while the answer was arriving, usually because Breadboard restarted. The answer may still finish in the background; reopen the chat in a moment to check.",
  turn_interrupted:
    "Bread's agent runtime stopped in the middle of this answer, usually because the computer ran low on memory. Breadboard will try to pick the task back up on its own; if nothing appears within a minute, press Retry.",
  runtime_unreachable:
    "Bread's agent runtime isn't running right now. It restarts on its own, usually within a minute, often after the computer ran low on memory. Try again shortly.",
  out_of_memory:
    "The computer ran out of memory and part of Breadboard was stopped to keep the system responsive. Close some heavy apps or browser tabs, then try again.",
  disk_full:
    "The disk is full, so Breadboard couldn't save this. Free up some disk space and try again.",
  database_busy:
    "Breadboard's database was busy with other work. Try again in a few seconds.",
  html_instead_of_json:
    "Breadboard returned a page instead of data, which usually means it was restarting or still starting up. Try again in a few seconds.",
  rate_limited:
    "Too many requests were sent in a short time. Wait a little and try again.",
  unauthorized:
    "You're signed out. Unlock or sign in to Breadboard again, then retry.",
  forbidden:
    "You don't have permission for this action.",
  not_found:
    "This item no longer exists. It may have been deleted or moved.",
  too_large:
    "This is too large to send. Try a smaller file or less text.",
  server_error:
    "Breadboard hit an unexpected error while doing this. Try again; if it keeps happening, restart Breadboard.",
  service_unavailable:
    "This part of Breadboard is temporarily unavailable, often while it starts up or recovers from low memory. Try again in a minute.",
};

const RAW_PATTERNS: ReadonlyArray<[RegExp, FailureKind]> = [
  [/\b(?:out of memory|ENOMEM|heap out of memory|JavaScript heap|allocation failed|resource[- _]exhausted)\b/i, "out_of_memory"],
  [/\b(?:ENOSPC|no space left|disk (?:is )?full|SQLITE_FULL)\b/i, "disk_full"],
  [/\b(?:SQLITE_BUSY|SQLITE_LOCKED|database is locked)\b/i, "database_busy"],
  [/interrupted before it (?:finished|could finish)|runtime stopped before returning a result|runtime_run_abandoned/i, "turn_interrupted"],
  [/agent runtime is unavailable|Breadboard tool service is unavailable|hermes.*(?:unavailable|not running)|Runtime job control is unavailable/i, "runtime_unreachable"],
  [/\b(?:timed? ?out|ETIMEDOUT|TimeoutError|operation was aborted due to timeout|deadline exceeded)\b/i, "timeout"],
  [/^(?:terminated|network error|ERR_INCOMPLETE_CHUNKED_ENCODING|BodyStreamBuffer was aborted|The network connection was lost\.?|socket hang up|ECONNRESET|premature close)$/i, "stream_cut"],
  [/^(?:Failed to fetch|fetch failed|Load failed|NetworkError when attempting to fetch resource\.?|ECONNREFUSED.*|connect ECONNREFUSED.*|net::ERR_CONNECTION_REFUSED)$/i, "server_unreachable"],
  [/Unexpected token '?<'?|is not valid JSON|Unexpected end of JSON input|<!DOCTYPE/i, "html_instead_of_json"],
  [/^(?:Internal server error|Bad gateway)\.?$/i, "server_error"],
  [/^(?:Service unavailable|Gateway timeout)\.?$/i, "service_unavailable"],
];

/** The category a raw failure text belongs to, or null when it is already prose. */
export function classifyFailureText(raw: unknown): FailureKind | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text) return null;
  for (const [pattern, kind] of RAW_PATTERNS) if (pattern.test(text)) return kind;
  return null;
}

export function failureKindForStatus(status: number): FailureKind | null {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 413) return "too_large";
  if (status === 429) return "rate_limited";
  if (status === 502 || status === 503) return "service_unavailable";
  if (status === 504 || status === 408) return "timeout";
  if (status >= 500) return "server_error";
  return null;
}

/**
 * Replace a raw infrastructure failure with its explanation. Text that is
 * already a sentence written for a person comes back unchanged.
 */
export function explainFailure(raw: unknown, fallback?: string): string {
  const text = raw instanceof Error ? raw.message : typeof raw === "string" ? raw : "";
  const kind = classifyFailureText(text);
  if (kind) return FAILURE_EXPLANATIONS[kind];
  return text.trim() || fallback || FAILURE_EXPLANATIONS.server_error;
}

/**
 * Inline <head> script: the browser reports every network failure as a bare
 * "Failed to fetch" TypeError, and hundreds of call sites show error.message
 * as is. Rewriting the error once at the source fixes all of them. The error
 * keeps its type and name (retry logic checks those) and its original in
 * `cause`. Aborts are untouched; a timeout keeps its name with a clear message.
 */
export const friendlyFetchScript = `(() => {
  const M = ${JSON.stringify({
    local: FAILURE_EXPLANATIONS.server_unreachable,
    offline: FAILURE_EXPLANATIONS.offline,
    remote: "Couldn't reach that website or service. It may be down, or the connection was blocked. Try again in a moment.",
    timeout: FAILURE_EXPLANATIONS.timeout,
    html: FAILURE_EXPLANATIONS.html_instead_of_json,
  })};
  const original = window.fetch;
  if (typeof original !== "function" || original.__breadboardFriendly) return;
  const isLocal = (input) => {
    try {
      const raw = typeof input === "string" ? input : input && input.url ? input.url : String(input);
      const url = new URL(raw, location.href);
      return url.origin === location.origin || url.hostname === "127.0.0.1" || url.hostname === "localhost";
    } catch { return true; }
  };
  const wrapped = function (input, init) {
    return original.apply(this, arguments).catch((error) => {
      if (error && error.name === "TimeoutError") {
        throw new DOMException(M.timeout, "TimeoutError");
      }
      if (!(error instanceof TypeError)) throw error;
      const message = isLocal(input) ? M.local : navigator.onLine === false ? M.offline : M.remote;
      throw new TypeError(message, { cause: error });
    });
  };
  wrapped.__breadboardFriendly = true;
  window.fetch = wrapped;
  const json = Response.prototype.json;
  Response.prototype.json = function () {
    const response = this;
    return json.call(response).catch((error) => {
      if (error instanceof SyntaxError) throw new SyntaxError(M.html, { cause: error });
      throw error;
    });
  };
})();`;
