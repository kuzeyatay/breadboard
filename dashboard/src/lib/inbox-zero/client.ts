// Talking to a running Inbox Zero.
//
// The one endpoint that matters is `POST /api/chat`: the app's own email
// assistant, with every tool it owns — searching threads, reading messages,
// drafting and sending replies, archiving, labelling, unsubscribing, writing
// automation rules. Breadboard does not reimplement any of that. It hands over
// the instruction and renders what comes back.
//
// The response is an AI SDK v6 UI message stream over SSE. Text arrives as
// `text-delta` parts keyed by a part id; tool activity arrives as
// `tool-input-available` / `tool-output-available`. Both are surfaced: the text
// becomes the answer, the tool names become the visible trail of what the agent
// actually did, which is the difference between "it says it archived them" and
// "it archived them".

import { randomUUID } from "node:crypto";

import { EMAIL_ACCOUNT_HEADER, type InboxZeroSession } from "./contract.ts";

export interface StreamHandlers {
  onText: (partId: string, delta: string) => void;
  onToolCall: (toolName: string, input: unknown) => void;
  onToolResult: (toolName: string, output: unknown) => void;
  onError: (message: string) => void;
}

export interface ChatRequest {
  config: { baseUrl: string };
  session: InboxZeroSession;
  /** Stable per conversation, so Inbox Zero keeps its own thread of context. */
  chatId: string;
  message: string;
  signal: AbortSignal;
}

function headers(session: InboxZeroSession): Record<string, string> {
  return {
    "content-type": "application/json",
    cookie: session.cookie,
    [EMAIL_ACCOUNT_HEADER]: session.identity.emailAccountId,
  };
}

/** A new conversation id. Kept per Breadboard run so runs do not bleed together. */
export function newChatId(): string {
  return randomUUID();
}

/**
 * Confirm the minted session is accepted before spending a turn on it.
 *
 * A rejected cookie and an empty mailbox fail in very different ways — one is a
 * Breadboard bug, the other is the user not having finished signing in — so the
 * caller gets to tell them apart.
 */
export async function verifySession(
  config: { baseUrl: string },
  session: InboxZeroSession,
): Promise<{ ok: boolean; status: number }> {
  try {
    const response = await fetch(`${config.baseUrl}/api/user/me`, {
      headers: headers(session),
      signal: AbortSignal.timeout(15_000),
      redirect: "manual",
    });
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

const MAX_TOOL_VALUE_CHARS = 2_000;
const MAX_ERROR_BODY_BYTES = 8 * 1024;
const MAX_STREAM_BYTES = 2 * 1024 * 1024;
const MAX_SSE_FRAME_CHARS = 256 * 1024;

async function readBoundedText(response: Response, maximumBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let output = "";
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel().catch(() => undefined);
      return output;
    }
    output += decoder.decode(value, { stream: true });
  }
  return `${output}${decoder.decode()}`;
}

/** Tool arguments and results are shown, so they are trimmed to a readable size. */
export function summarizeToolValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.slice(0, MAX_TOOL_VALUE_CHARS);
  try {
    return JSON.stringify(value).slice(0, MAX_TOOL_VALUE_CHARS);
  } catch {
    return "";
  }
}

/**
 * Send one instruction to the assistant and drive its stream to completion.
 *
 * Errors are reported through `onError` rather than thrown when the stream
 * itself carried them: a turn that ran three tools and then failed is a
 * different thing from a turn that never started, and the card should show the
 * work that did happen.
 */
export async function runAssistantTurn(request: ChatRequest, handlers: StreamHandlers): Promise<void> {
  const response = await fetch(`${request.config.baseUrl}/api/chat`, {
    method: "POST",
    headers: headers(request.session),
    signal: request.signal,
    body: JSON.stringify({
      id: request.chatId,
      message: {
        id: randomUUID(),
        role: "user",
        parts: [{ type: "text", text: request.message }],
      },
    }),
  });

  if (!response.ok || !response.body) {
    const detail = await readBoundedText(response, MAX_ERROR_BODY_BYTES).catch(() => "");
    throw new Error(
      `inbox_zero_chat_failed_${response.status}${detail ? `: ${detail.slice(0, 400)}` : ""}`,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const toolNames = new Map<string, string>();
  let buffer = "";
  let receivedBytes = 0;

  const handleFrame = (frame: string): void => {
    // An SSE frame can carry several `data:` lines; the protocol here uses one.
    const payload = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("");
    if (!payload || payload === "[DONE]") return;
    let part: Record<string, unknown>;
    try {
      part = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = typeof part.type === "string" ? part.type : "";
    if (type === "text-delta") {
      const id = typeof part.id === "string" ? part.id : "answer";
      const delta = typeof part.delta === "string" ? part.delta : "";
      if (delta) handlers.onText(id, delta);
      return;
    }
    if (type === "tool-input-available" || type === "tool-input-start") {
      const callId = typeof part.toolCallId === "string" ? part.toolCallId : "";
      const name = typeof part.toolName === "string" ? part.toolName : "";
      if (callId && name) toolNames.set(callId, name);
      if (type === "tool-input-available" && name) handlers.onToolCall(name, part.input);
      return;
    }
    if (type === "tool-output-available") {
      const callId = typeof part.toolCallId === "string" ? part.toolCallId : "";
      handlers.onToolResult(toolNames.get(callId) ?? "tool", part.output);
      return;
    }
    if (type === "error" || type === "tool-output-error") {
      const message =
        typeof part.errorText === "string"
          ? part.errorText
          : typeof part.error === "string"
            ? part.error
            : "The assistant reported an error.";
      handlers.onError(message);
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    receivedBytes += value.byteLength;
    if (receivedBytes > MAX_STREAM_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error("inbox_zero_chat_response_too_large");
    }
    buffer += decoder.decode(value, { stream: true });
    if (buffer.length > MAX_SSE_FRAME_CHARS && !buffer.includes("\n\n")) {
      await reader.cancel().catch(() => undefined);
      throw new Error("inbox_zero_chat_frame_too_large");
    }
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      handleFrame(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
    }
    if (buffer.length > MAX_SSE_FRAME_CHARS) {
      await reader.cancel().catch(() => undefined);
      throw new Error("inbox_zero_chat_frame_too_large");
    }
  }
  if (buffer.trim()) handleFrame(buffer);
}
