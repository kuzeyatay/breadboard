import { AgentStreamDisconnectedError } from "../../app/components/hermes/agent-stream-watchdog.ts";

export interface GardenTurnObserver {
  clientMessageId: string;
  recover: () => void;
}

/** An older answer or a poll taken before dispatch cannot finish a new turn. */
export function gardenTurnCompletedOnServer(
  session: {
    active?: boolean;
    messages: readonly {
      role: string;
      clientMessageId?: string;
      responseCompletedAt?: string;
      textSelection?: { mode: string };
    }[];
  },
  clientMessageId: string,
): boolean {
  // Highlight answers can outlive the main turn or be appended after it.
  // Its own durable completion is authoritative, even while the rail is active.
  const last = session.messages.findLast(message => message.textSelection?.mode !== "inline");
  return last?.role === "assistant" &&
    last.clientMessageId === clientMessageId &&
    typeof last.responseCompletedAt === "string" &&
    Number.isFinite(Date.parse(last.responseCompletedAt));
}

/** Consume the Garden's one-data-line SSE frames until its terminal marker.
 * HTTP EOF alone is a lost viewer, not proof that the assistant finished.
 */
export async function* readGardenResponseData(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let rejectAborted: (reason: unknown) => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => { rejectAborted = reject; });
  // Observe rejection even when abort happens while the consumer handles a frame.
  void aborted.catch(() => {});
  const onAbort = () => rejectAborted(signal?.reason ?? new DOMException("Aborted", "AbortError"));
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await Promise.race([reader.read(), aborted]);
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = done ? "" : (lines.pop() ?? "");
      for (const line of lines) {
        signal?.throwIfAborted();
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).replace(/^ /, "").replace(/\r$/, "");
        yield payload;
        if (payload === "[DONE]") return;
      }
      if (done) throw new AgentStreamDisconnectedError();
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    // A proxy can hold the connection open after [DONE]. Retire this viewer
    // without waiting for network cleanup or stopping the server-owned run.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
