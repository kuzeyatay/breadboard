import { chatMessageAttachments, type ChatAttachment } from "../chat-attachments.ts";
import type { ChatTextSelectionReference } from "../chat-text-selection.ts";
import { normalizeChatTokenUsage, type ChatTokenUsage } from "../chat-token-usage.ts";
import { applyGardenStableTextEvent } from "../hermes/garden-stable-stream.ts";
import { readGardenResponseData } from "../hermes/garden-response-stream.ts";
import { abortGardenTurnCheckpoint, fetchGardenChat, reserveGardenTurnCheckpoint } from "./garden-turn-client.ts";
import type { VerificationSummary } from "../hermes/evidence.ts";
import type { QuartzAssistantSelectionRequest } from "../quartz-assistant-selection.ts";

export interface InlineQuestionMessage {
  id?: string;
  clientMessageId: string;
  role: "user" | "assistant";
  content: string;
  textSelection: ChatTextSelectionReference;
  inlineSelection?: Pick<QuartzAssistantSelectionRequest, "requestId" | "highlightId" | "pageSlug">;
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

/** A saved terminal answer releases its own HTTP viewer and retry lock. */
export function retireCompletedInlineQuestionViewers<T extends {
  sessionId: number | null; clientMessageId: string;
  retired: boolean; viewerController: AbortController;
}>(runs: Map<string, T>, sessionId: number, messages: readonly {
  role: string; clientMessageId?: string; responseCompletedAt?: string;
  failed?: boolean; interrupted?: boolean;
}[]): void {
  for (const [key, run] of runs) {
    if (run.sessionId !== sessionId) continue;
    const answer = messages.findLast(message => message.role === 'assistant' && message.clientMessageId === run.clientMessageId);
    if (!answer || !(answer.failed || answer.interrupted ||
      (answer.responseCompletedAt && Number.isFinite(Date.parse(answer.responseCompletedAt))))) continue;
    // Set before abort: the reader's catch/finally must not replace this saved
    // answer with "Stopped" or hold up a retry on the same highlight.
    run.retired = true;
    runs.delete(key);
    run.viewerController.abort();
  }
}

/** A highlight has its own stream and controller, never the main chat's activity hook. */
export async function runGardenInlineQuestion(input: {
  sessionId: number;
  clusterSlug: string;
  clientMessageId: string;
  question: string;
  selection: ChatTextSelectionReference;
  sourceResponse?: string;
  /** Preserve the Quartz page anchor and page context alongside the runtime selection. */
  quartzSelection?: QuartzAssistantSelectionRequest;
  activeMarkdown?: { cluster: string; slug: string; title: string; content: string };
  superAgent?: boolean;
  yoloMode?: boolean;
  adhdMode?: boolean;
  personalize?: boolean;
  attachments: readonly ChatAttachment[];
  model: string;
  reasoningEffort: string;
  selectedDocumentSlugs: string[];
  signal: AbortSignal;
  /** Retire a stale HTTP viewer without issuing Stop to the server. */
  viewerSignal?: AbortSignal;
  publish: (messages: InlineQuestionMessage[]) => void;
}): Promise<void> {
  const startedAt = performance.now();
  const viewerSignal = input.viewerSignal ? AbortSignal.any([input.signal, input.viewerSignal]) : input.signal;
  const user = {
    clientMessageId: input.clientMessageId, role: "user" as const,
    content: input.question, createdAt: new Date().toISOString(),
    textSelection: input.selection, selectedText: input.selection.quote,
    ...(input.quartzSelection ? { inlineSelection: {
      requestId: input.quartzSelection.requestId,
      highlightId: input.quartzSelection.highlightId,
      pageSlug: input.quartzSelection.pageSlug,
    } } : {}),
    attachments: chatMessageAttachments(input.attachments),
    attachmentNames: input.attachments.map(item => item.name),
  };
  const answer: InlineQuestionMessage = { ...user, role: "assistant", content: "", pending: true };
  const publish = () => input.publish([{ ...user }, { ...answer }]);
  publish();
  let reserved = false;
  try {
    const checkpoint = await reserveGardenTurnCheckpoint(input.sessionId, input.clientMessageId, user, input.signal);
    Object.assign(user, { id: checkpoint.userMessageId });
    answer.id = checkpoint.assistantMessageId;
    reserved = true;
    if (input.signal.aborted) await abortGardenTurnCheckpoint(input.sessionId, input.clientMessageId);
    input.signal.throwIfAborted();
    publish();
    const selection = input.selection;
    const response = await fetchGardenChat(input.sessionId, input.clientMessageId, {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: viewerSignal,
      body: JSON.stringify({
        clusterSlug: input.clusterSlug, chatSessionId: input.sessionId,
        clientMessageId: input.clientMessageId,
        messages: [{ role: "user", content: input.question }],
        model: input.model, reasoningEffort: input.reasoningEffort,
        attachments: input.attachments, selectedDocumentSlugs: input.selectedDocumentSlugs,
        textSelection: selection,
        activeMarkdown: input.activeMarkdown,
        superAgent: input.superAgent, yoloMode: input.yoloMode,
        adhdMode: input.adhdMode, personalize: input.personalize,
        selectedTextContext: input.quartzSelection ?? {
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
    for await (const payload of readGardenResponseData(response.body, viewerSignal)) {
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
