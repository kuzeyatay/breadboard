export const AGENT_STREAM_CONNECT_TIMEOUT_MS = 15_000;
export const AGENT_STREAM_FIRST_ACTIVITY_TIMEOUT_MS = 90_000;
export const AGENT_STREAM_INACTIVITY_TIMEOUT_MS = 5 * 60_000;
export const AGENT_STREAM_RECONNECT_DELAYS_MS = [
  500,
  1_000,
  2_000,
  4_000,
  8_000,
  16_000,
] as const;

export type AgentStreamTimeoutKind =
  | "connect_timeout"
  | "first_activity_timeout"
  | "inactivity_timeout";

const TIMEOUT_MESSAGES: Record<AgentStreamTimeoutKind, string> = {
  connect_timeout:
    "Breadboard could not connect to the agent. Please try the message again.",
  first_activity_timeout:
    "The agent stopped responding before Breadboard received the answer. The turn was stopped so you can try again.",
  inactivity_timeout:
    "The agent connection stopped updating. The turn was stopped so you can try again.",
};

export class AgentStreamTimeoutError extends Error {
  readonly code: AgentStreamTimeoutKind;

  constructor(code: AgentStreamTimeoutKind) {
    super(TIMEOUT_MESSAGES[code]);
    this.name = "AgentStreamTimeoutError";
    this.code = code;
  }
}

export class AgentStreamDisconnectedError extends Error {
  constructor(message = "The agent connection closed before the response completed.") {
    super(message);
    this.name = "AgentStreamDisconnectedError";
  }
}

export function isAgentStreamTimeoutError(
  value: unknown,
): value is AgentStreamTimeoutError {
  return value instanceof AgentStreamTimeoutError;
}

export function isRecoverableAgentStreamDisconnect(value: unknown): boolean {
  if (value instanceof AgentStreamDisconnectedError) return true;
  if (!(value instanceof Error) || value.name === "AbortError") return false;
  // `AbortSignal.timeout()` rejects fetch with a TimeoutError. Treat that like
  // the browser's other transport failures; the caller still owns the bounded
  // retry policy, while explicit user cancellation remains AbortError above.
  if (value.name === "TimeoutError") return true;
  return /failed to fetch|load failed|network error|network request failed/i.test(
    value.message,
  );
}

export function agentStreamReconnectDelay(attempt: number): number | null {
  if (!Number.isInteger(attempt) || attempt < 0) return null;
  return AGENT_STREAM_RECONNECT_DELAYS_MS[attempt] ?? null;
}

export async function waitForAgentStreamReconnect(
  delayMs: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function agentStreamTimeout(input: {
  connected: boolean;
  sawTurnActivity: boolean;
  waitingForPermission: boolean;
}): { timeoutMs: number; kind: AgentStreamTimeoutKind } | null {
  if (!input.connected) {
    return {
      timeoutMs: AGENT_STREAM_CONNECT_TIMEOUT_MS,
      kind: "connect_timeout",
    };
  }
  if (input.waitingForPermission) return null;
  if (!input.sawTurnActivity) {
    return {
      timeoutMs: AGENT_STREAM_FIRST_ACTIVITY_TIMEOUT_MS,
      kind: "first_activity_timeout",
    };
  }
  return {
    timeoutMs: AGENT_STREAM_INACTIVITY_TIMEOUT_MS,
    kind: "inactivity_timeout",
  };
}

export function isAgentStreamTurnActivity(
  eventType: unknown,
  payload: Record<string, unknown>,
): boolean {
  if (typeof eventType !== "string") return false;
  return (
    eventType !== "session.status" ||
    payload.status === "busy" ||
    payload.status === "waiting"
  );
}

export async function withAgentStreamTimeout<T>(
  operation: Promise<T>,
  timeout: { timeoutMs: number; kind: AgentStreamTimeoutKind } | null,
): Promise<T> {
  if (!timeout) return operation;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new AgentStreamTimeoutError(timeout.kind)),
          timeout.timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
