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
  void fetch(`${base}/events?since=0`)
    .then(async (response) => {
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        events?: unknown;
      };
      if (!response.ok) {
        source.close();
        onUnavailable(
          data.error === "run_not_found" ? "run_not_found" : "stream_unavailable",
        );
        return;
      }
      const events = Array.isArray(data.events)
        ? (data.events as AgentRunStreamEvent[])
        : [];
      const ending = events.filter((event) =>
        RUN_STREAM_TERMINAL_EVENTS.has(event?.type),
      );
      if (!ending.length) return;
      // The stream ended because the run did. Hand the card the ending it was
      // disconnected before seeing, then stop: there is nothing further to
      // reconnect for.
      for (const event of ending) replayEnding?.(event);
      source.close();
    })
    .catch(() => undefined);
}
