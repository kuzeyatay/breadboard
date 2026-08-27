/**
 * Shared error handling for the inline agent cards' run streams.
 *
 * Every card watches its run over `EventSource`, and every run's route closes
 * the stream deliberately once the run is over — the controller is closed
 * right after the last event is flushed. The browser cannot tell that orderly
 * close apart from a dropped connection: both surface as `error`, and its
 * built-in retry reopens the stream a few seconds later. So a card whose only
 * response to `error` was "check whether the run still exists, and do nothing
 * if it does" reopened a finished run's stream for as long as the chat stayed
 * on screen, once per card in the transcript.
 *
 * Probing the run once is what separates the two cases the browser cannot:
 * a run that is gone gets the socket closed and its card told; a run that has
 * already ended gets its ending delivered and the socket closed; only a run
 * that is genuinely still working is left for `EventSource` to reconnect to.
 */

export interface AgentRunStreamEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

/** The events every run manager ends with, whichever way the run ended. */
export const RUN_STREAM_TERMINAL_EVENTS = new Set([
  "run.completed",
  "run.failed",
  "run.aborted",
]);

export type AgentRunStreamFailure = "run_not_found" | "stream_unavailable";

// `EventSource` can dispatch another error while the first terminal-state
// probe is still in flight. One probe per source prevents duplicate history
// downloads and, more importantly, duplicate replay of the terminal event.
// The WeakMap itself adds no persistent strong owner after the request chain
// releases its normal callback closure.
interface ActiveErrorProbe {
  controller: AbortController;
  timeout: ReturnType<typeof globalThis.setTimeout>;
}

const activeErrorProbes = new WeakMap<EventSource, ActiveErrorProbe>();
const consecutiveProbeFailures = new WeakMap<EventSource, number>();
const closedAgentRunStreams = new WeakSet<EventSource>();
const ERROR_PROBE_TIMEOUT_MS = 5_000;
const MAX_CONSECUTIVE_PROBE_FAILURES = 3;

/** Close a card-owned EventSource and abort any error probe it still owns. */
export function closeAgentRunStream(source: EventSource): void {
  closedAgentRunStreams.add(source);
  consecutiveProbeFailures.delete(source);
  const probe = activeErrorProbes.get(source);
  if (probe) {
    activeErrorProbes.delete(source);
    globalThis.clearTimeout(probe.timeout);
    probe.controller.abort(new DOMException("Run stream closed", "AbortError"));
  }
  source.close();
}

function markProbeFailure(
  source: EventSource,
  onUnavailable: (reason: AgentRunStreamFailure) => void,
): void {
  const failures = (consecutiveProbeFailures.get(source) ?? 0) + 1;
  if (failures < MAX_CONSECUTIVE_PROBE_FAILURES) {
    consecutiveProbeFailures.set(source, failures);
    return;
  }
  closeAgentRunStream(source);
  onUnavailable("stream_unavailable");
}

function selectLatestTerminalEvent(
  events: unknown[],
): AgentRunStreamEvent | undefined {
  let latest: AgentRunStreamEvent | undefined;
  for (const candidate of events) {
    if (!candidate || typeof candidate !== "object") continue;
    const event = candidate as Partial<AgentRunStreamEvent>;
    if (
      typeof event.type !== "string" ||
      !RUN_STREAM_TERMINAL_EVENTS.has(event.type) ||
      !Number.isSafeInteger(event.sequenceNumber) ||
      (event.sequenceNumber ?? -1) < 0 ||
      !event.payload ||
      typeof event.payload !== "object" ||
      Array.isArray(event.payload) ||
      typeof event.at !== "string"
    ) {
      continue;
    }
    const validated = event as AgentRunStreamEvent;
    if (!latest || validated.sequenceNumber > latest.sequenceNumber) {
      latest = validated;
    }
  }
  return latest;
}

/**
 * Called from an `EventSource`'s `onerror`. `replayEnding` receives the run's
 * terminal event when the probe finds one the card missed — only that event,
 * never the whole history, so a card that appends to a list cannot double it.
 */
export function resolveAgentRunStreamError({
  source,
  base,
  replayEnding,
  onUnavailable,
}: {
  source: EventSource;
  /** The run's route root, e.g. `/api/open-gym/runs/<id>`. */
  base: string;
  replayEnding?: (event: AgentRunStreamEvent) => void;
  onUnavailable: (reason: AgentRunStreamFailure) => void;
}): void {
  if (closedAgentRunStreams.has(source) || activeErrorProbes.has(source)) return;
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(
    () => controller.abort(new DOMException("Run-state probe timed out", "TimeoutError")),
    ERROR_PROBE_TIMEOUT_MS,
  );
  const probe = { controller, timeout };
  activeErrorProbes.set(source, probe);
  void fetch(`${base}/events?since=0`, { signal: controller.signal })
    .then(async (response) => {
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        events?: unknown;
      };
      if (!response.ok) {
        closeAgentRunStream(source);
        onUnavailable(
          data.error === "run_not_found" ? "run_not_found" : "stream_unavailable",
        );
        return;
      }
      const events = Array.isArray(data.events)
        ? data.events
        : [];
      const ending = selectLatestTerminalEvent(events);
      const hasMalformedTerminal = events.some(
        (event) =>
          Boolean(event) &&
          typeof event === "object" &&
          RUN_STREAM_TERMINAL_EVENTS.has(
            (event as { type?: unknown }).type as string,
          ),
      ) && !ending;
      if (hasMalformedTerminal || !Array.isArray(data.events)) {
        closeAgentRunStream(source);
        onUnavailable("stream_unavailable");
        return;
      }
      if (!ending) {
        // A valid live-run response proves the transient probe path recovered.
        consecutiveProbeFailures.delete(source);
        return;
      }
      // The stream ended because the run did. Hand the card the ending it was
      // disconnected before seeing, then stop: there is nothing further to
      // reconnect for.
      closeAgentRunStream(source);
      replayEnding?.(ending);
    })
    .catch(() => {
      // Route cleanup aborts the active request after marking the source
      // closed. Timeouts and network failures, by contrast, get a small retry
      // budget so transient drops recover without retrying forever.
      if (!closedAgentRunStreams.has(source)) {
        markProbeFailure(source, onUnavailable);
      }
    })
    .finally(() => {
      if (activeErrorProbes.get(source) === probe) {
        globalThis.clearTimeout(timeout);
        activeErrorProbes.delete(source);
      }
    });
}
