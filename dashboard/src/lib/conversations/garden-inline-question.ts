import { chatMessageAttachments, type ChatAttachment } from "../chat-attachments.ts";
import type { ChatTextSelectionReference } from "../chat-text-selection.ts";
import { normalizeChatTokenUsage, type ChatTokenUsage } from "../chat-token-usage.ts";
import { applyGardenStableTextEvent } from "../hermes/garden-stable-stream.ts";
import { readGardenResponseData } from "../hermes/garden-response-stream.ts";
import { abortGardenTurnCheckpoint, reserveGardenTurnCheckpoint } from "./garden-turn-client.ts";
import type { VerificationSummary } from "../hermes/evidence.ts";

export interface InlineQuestionMessage {
  id?: string;
  clientMessageId: string;
  role: "user" | "assistant";
  content: string;
  textSelection: ChatTextSelectionReference;
  createdAt: string;
  pending?: boolean;
  failed?: boolean;
  interrupted?: boolean;
  thinking?: string;
  sources?: string[];
  usage?: ChatTokenUsage;
  verification?: VerificationSummary;
  responseDurationMs?: number;
  responseCompletedAt?: string;
}

/** Preserve side turns when the main stream publishes an older transcript snapshot. */
export function preserveInlineQuestionMessages<T extends {
  role: string; clientMessageId?: string; id?: string;
  textSelection?: { mode: string };
}>(incoming: T[], current: T[]): T[] {
  const key = (message: T) => `${message.clientMessageId ?? message.id}:${message.role}`;
  const inline = new Map(current.filter(message => message.textSelection?.mode === "inline").map(message => [key(message), message]));
  const merged = incoming.map(message => {
    const latest = inline.get(key(message));
    inline.delete(key(message));
    return latest ?? message;
  });
  return [...merged, ...inline.values()];
}

/** A poll may complete a detached side stream while the main stream stays live. */
export function reconcileInlineQuestionMessages<T extends {
  role: string; clientMessageId?: string; id?: string; pending?: boolean;
  responseCompletedAt?: string; failed?: boolean; interrupted?: boolean;
  textSelection?: { mode: string };
}>(local: T[], saved: T[]): T[] {
  const key = (message: T) => `${message.clientMessageId ?? message.id}:${message.role}`;
  const current = new Map(local.map(message => [key(message), message]));
  const updates = saved.filter(message => message.textSelection?.mode === "inline" && (
    !current.has(key(message)) || message.responseCompletedAt || message.failed || message.interrupted
  ));
  return preserveInlineQuestionMessages(local, updates);
}

/** A highlight has its own stream and controller, never the main chat's activity hook. */
export async function runGardenInlineQuestion(input: {
  sessionId: number;
  clusterSlug: string;
  clientMessageId: string;
  question: string;
  selection: ChatTextSelectionReference;
  sourceResponse?: string;
  attachments: readonly ChatAttachment[];
  model: string;
  reasoningEffort: string;
  selectedDocumentSlugs: string[];
  signal: AbortSignal;
  publish: (messages: InlineQuestionMessage[]) => void;
}): Promise<void> {
  const startedAt = performance.now();
  const user = {
    clientMessageId: input.clientMessageId, role: "user" as const,
    content: input.question, createdAt: new Date().toISOString(),
    textSelection: input.selection, selectedText: input.selection.quote,
    attachments: chatMessageAttachments(input.attachments),
    attachmentNames: input.attachments.map(item => item.name),
  };
  const answer: InlineQuestionMessage = { ...user, role: "assistant", content: "", pending: true };
  const publish = () => input.publish([{ ...user }, { ...answer }]);
  publish();
  let reserved = false;
  try {
    const checkpoint = await reserveGardenTurnCheckpoint(input.sessionId, input.clientMessageId, user);
    Object.assign(user, { id: checkpoint.userMessageId });
    answer.id = checkpoint.assistantMessageId;
    reserved = true;
    if (input.signal.aborted) await abortGardenTurnCheckpoint(input.sessionId, input.clientMessageId);
    input.signal.throwIfAborted();
    publish();
    const selection = input.selection;
    const response = await fetch("/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: input.signal,
      body: JSON.stringify({
        clusterSlug: input.clusterSlug, chatSessionId: input.sessionId,
        clientMessageId: input.clientMessageId,
        messages: [{ role: "user", content: input.question }],
        model: input.model, reasoningEffort: input.reasoningEffort,
        attachments: input.attachments, selectedDocumentSlugs: input.selectedDocumentSlugs,
        textSelection: selection,
        selectedTextContext: {
          requestId: selection.id, highlightId: selection.id, mode: "inline",
          text: selection.quote, prefix: selection.prefix, suffix: selection.suffix,
          sourceMessageId: selection.sourceMessageId, sourceResponse: input.sourceResponse,
        },
      }),
    });
    if (!response.ok || !response.body) {
      const body = await response.json().catch(() => ({}));
      throw new Error(typeof body.error === "string" ? body.error : body.error?.message ?? "Could not answer this highlight.");
    }
    for await (const payload of readGardenResponseData(response.body, input.signal)) {
      if (payload === "[DONE]") break;
      const event = JSON.parse(payload);
      if (["delta", "thinking", "replace", "provisional", "segment"].includes(event.type)) {
        Object.assign(answer, applyGardenStableTextEvent(answer, event));
      } else if (event.type === "sources") answer.sources = event.sources;
      else if (event.type === "usage") answer.usage = normalizeChatTokenUsage(event.usage) ?? undefined;
      else if (event.type === "verification") answer.verification = event.verification;
      else if (event.type === "error") throw new Error(event.error ?? "Could not answer this highlight.");
      publish();
    }
    answer.pending = false;
    answer.responseDurationMs = Math.round(performance.now() - startedAt);
    answer.responseCompletedAt = new Date().toISOString();
    publish();
  } catch (error) {
    if (!reserved) throw error; // The caller restores the unsaved question and files.
    answer.pending = false;
    answer.interrupted = input.signal.aborted;
    answer.failed = !answer.interrupted;
    answer.content ||= answer.interrupted ? "Stopped." : error instanceof Error ? error.message : "Could not answer this highlight.";
    answer.responseDurationMs = Math.round(performance.now() - startedAt);
    publish();
  }
}
