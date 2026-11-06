export interface GardenTurnCheckpointMessage {
  branchGroupId?: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
  internalAgentContinuation?: boolean;
  attachmentNames?: string[];
  attachments?: unknown[];
  focusedDocumentNames?: string[];
  selectedText?: string;
  inlineSelection?: unknown;
  /** Selected-text ("Ask in chat"/"Ask here") anchor for this question. */
  textSelection?: unknown;
  /** Stable Garden document references used to rebuild this turn on Retry. */
  focusedDocumentSlugs?: string[];
}

export interface GardenTurnCheckpoint {
  clientMessageId: string;
  userMessageId: string;
  assistantMessageId: string;
  conversationId: string | null;
}

const pendingChatSaves = new Map<number, Promise<void>>();
const transientSaveStatuses = new Set([408, 429, 500, 502, 503, 504]);

/** Retry the same snapshot, never the model request or a rejected edit. */
export function saveGardenChatSession(
  sessionId: number,
  snapshot: object,
): Promise<void> {
  // Serialize once: retries must carry exactly the snapshot that was queued.
  const body = JSON.stringify(snapshot);
  const save = (async () => {
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await fetch(`/api/chat-sessions/${sessionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body,
          signal: AbortSignal.timeout(35_000),
        });
      } catch (error) {
        if (attempt < 2 && error instanceof Error &&
          ["TypeError", "TimeoutError"].includes(error.name)) {
          await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
          continue;
        }
        throw new Error("Could not reach chat storage. Your response is still open; please try again.");
      }
      if (response.ok) return;
      if (attempt < 2 && transientSaveStatuses.has(response.status)) {
        // Consume the failed response before reusing the connection.
        await response.body?.cancel().catch(() => undefined);
        await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
        continue;
      }
      const failure = await response.json().catch(() => null);
      const reason = typeof failure?.error === "string" ? failure.error
        : typeof failure?.error?.message === "string" ? failure.error.message : null;
      throw new Error(reason?.trim() || `Chat storage returned an error (${response.status}).`);
    }
  })();
  pendingChatSaves.set(sessionId, save);
  const clear = () => {
    if (pendingChatSaves.get(sessionId) === save) pendingChatSaves.delete(sessionId);
  };
  void save.then(clear, clear);
  return save;
}

/** Reserve an adjacent user/assistant pair before any turn work is dispatched. */
export async function reserveGardenTurnCheckpoint(
  sessionId: number,
  clientMessageId: string,
  message: GardenTurnCheckpointMessage,
  signal?: AbortSignal,
): Promise<GardenTurnCheckpoint> {
  // A lost acknowledgement may already have committed the pair. Reuse the
  // exact body and turn id so recovery returns those rows instead of adding a
  // second question. Only the checkpoint is retried, never the model request.
  const requestBody = JSON.stringify({ clientMessageId, ...message });
  // A retry must finish before the next turn creates durable rows. Otherwise
  // its older transcript snapshot could overwrite the newly saved question.
  await pendingChatSaves.get(sessionId)?.catch(() => undefined);
  type CheckpointResponse = {
    error?: string | { message?: string };
    userMessage?: { id?: string; clientMessageId?: string };
    assistantMessage?: { id?: string; clientMessageId?: string };
    conversationId?: string;
  };
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    let response: Response;
    let body: CheckpointResponse;
    try {
      response = await fetch(`/api/chat-sessions/${sessionId}/turns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody,
        // Let an in-flight save finish even after Stop, so its caller can
        // cancel the acknowledged rows. Stop prevents subsequent attempts.
        signal: AbortSignal.timeout(90_000),
      });
      body = await response.json().catch(error => {
        if (error instanceof SyntaxError) return {};
        throw error;
      });
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof Error && ["TypeError", "TimeoutError"].includes(error.name)) {
        if (attempt < 2) {
          await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
          continue;
        }
        throw new Error("Could not reach chat storage. Your question is still open; please try again.");
      }
      throw error;
    }
    if (attempt < 2 && transientSaveStatuses.has(response.status)) {
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
      continue;
    }
    const userMessageId = body.userMessage?.id;
    const assistantMessageId = body.assistantMessage?.id;
    if (!response.ok || !userMessageId || !assistantMessageId) {
      const reason =
        typeof body.error === "string"
          ? body.error
          : typeof body.error?.message === "string"
            ? body.error.message
            : "Chat history could not be saved.";
      throw new Error(reason);
    }
    return {
      clientMessageId: body.userMessage?.clientMessageId ?? clientMessageId,
      userMessageId,
      assistantMessageId,
      conversationId: typeof body.conversationId === "string" ? body.conversationId : null,
    };
  }
}

/**
 * A saved turn is still owned while its viewer waits for response headers.
 * The server cannot heartbeat it until the chat route finishes loading and
 * authenticating, so bridge that gap using the already-open checkpoint route.
 * Once headers arrive, the server's detached response pump owns liveness.
 */
export async function fetchGardenChat(
  sessionId: number,
  clientMessageId: string,
  init: RequestInit,
): Promise<Response> {
  init.signal?.throwIfAborted();
  const heartbeatController = new AbortController();
  let renewing = false;
  const renew = async () => {
    if (renewing || heartbeatController.signal.aborted || init.signal?.aborted) return;
    renewing = true;
    try {
      await fetch(`/api/chat-sessions/${sessionId}/turns`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientMessageId }),
        signal: AbortSignal.any([
          heartbeatController.signal,
          AbortSignal.timeout(8_000),
          ...(init.signal ? [init.signal] : []),
        ]),
      });
    } catch {
      // A transient heartbeat failure does not decide the response's outcome.
    } finally {
      renewing = false;
    }
  };
  void renew();
  const timer = setInterval(() => { void renew(); }, 10_000);
  try {
    return await fetch("/api/chat", init);
  } finally {
    clearInterval(timer);
    heartbeatController.abort();
  }
}

/** Persist Stop before the runtime has necessarily announced its session id. */
export async function abortGardenTurnCheckpoint(
  sessionId: number,
  clientMessageId: string,
): Promise<void> {
  await fetch(`/api/chat-sessions/${sessionId}/turns`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientMessageId }),
  }).catch(() => undefined);
}
