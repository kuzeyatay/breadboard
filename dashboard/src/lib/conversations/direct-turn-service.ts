// The turn pipeline used when Agent mode is off: the message goes straight to
// the provider.
//
// `turn-service.ts` is the agent pipeline — planner, capability broker, runtime
// session, tools, memory, artifacts. None of that applies here. This path exists
// so a user who has switched Agent mode off gets what that promises: their
// message and this conversation's transcript sent to the chosen model, and the
// answer streamed back. No tools are offered, no filesystem or Garden is
// reached, no capability decision is made or persisted, and the Hermes runtime
// is not called at all.
//
// What it still does, because those are Breadboard's own responsibilities rather
// than the runtime's: reserve the turn in the canonical conversation store so the
// transcript survives a reload, and finish that turn with the answer, its token
// usage, and a marker saying which backend produced it.

import "server-only";

import OpenAI from "openai";
import type {
  EasyInputMessage,
  ResponseCreateParamsStreaming,
  ResponseStreamEvent,
} from "openai/resources/responses/responses";
import { DEFAULT_MODEL } from "../ai-models.ts";
import {
  normalizeAssistantReasoningEffort,
  toOpenAiReasoningEffort,
} from "../assistant-reasoning.ts";
import {
  attachmentOrderManifest,
  chatMessageAttachments,
  type ChatAttachment,
} from "../chat-attachments.ts";
import {
  chatTokenUsageFromResponse,
  type ChatTokenUsage,
} from "../chat-token-usage.ts";
import { resolveChatmockBaseUrl } from "../chatmock-server.ts";
import { modelAttachmentPromptText } from "../model-attachments.ts";
import { createEmDashFilter } from "../prose-punctuation.ts";
import {
  assistantTextFromOutputItem,
  createResponseTextRecovery,
  reasoningTextFromOutputItem,
} from "../responses-stream-text.ts";
import type { HermesSurface } from "../hermes/config.ts";
import { ApiError } from "../hermes/route-core.ts";
import {
  getRuntimeSessionByConversation,
  recordAuditEvent,
} from "../hermes/runtime-store.ts";
import { getActiveRuntimeRun } from "../hermes/run-store.ts";
import { cogniviaSection } from "../cognivia/index.ts";
import { directModeSection } from "../hermes/direct-mode.ts";
import {
  readerComprehensionPrompt,
  responseStylePrompt,
} from "../hermes/system-prompts.ts";
import {
  evidenceCalibrationSection,
  suppliedEvidenceText,
} from "../hermes/evidence-calibration.ts";
import {
  completeAssistantMessage,
  failAssistantMessage,
  listRecentConversationMessages,
  reserveConversationTurn,
  retryAssistantMessage,
  isPreDispatchReservedAssistant,
  ConversationStoreError,
  type ConversationRow,
} from "./store.ts";
import {
  generateAndApplyConversationTitle,
  shouldGenerateConversationTitleForTurn,
} from "./title-service.ts";
import { scheduleMemoryProfileSynthesisForConversation } from "./memory-profile.ts";
import type { CurrentLocationSnapshot } from "../current-location.ts";
import { renderCurrentLocationContext } from "../hermes/current-location-context.ts";

export const DIRECT_BACKEND = "direct-provider";

interface ActiveDirectProviderTurn {
  clientMessageId: string;
  controller: AbortController;
  stopRequested: boolean;
}

const directProviderGlobal = globalThis as typeof globalThis & {
  __breadboardActiveDirectProviderTurns?: Map<number, ActiveDirectProviderTurn>;
};
const activeDirectProviderTurns =
  directProviderGlobal.__breadboardActiveDirectProviderTurns ??=
    new Map<number, ActiveDirectProviderTurn>();

/**
 * Stop is the one operation that owns provider cancellation. Closing a page or
 * its response stream only removes a viewer; the server keeps consuming and
 * persisting the turn so another view can observe it later.
 */
export function abortDirectProviderTurn(
  conversationId: number,
): { clientMessageId: string } | null {
  const active = activeDirectProviderTurns.get(conversationId);
  if (!active) return null;
  active.stopRequested = true;
  active.controller.abort(new DOMException("Stopped by the user.", "AbortError"));
  return { clientMessageId: active.clientMessageId };
}

/** History depth sent to the provider. The store caps this at 30. */
const HISTORY_MESSAGES = 20;

export interface StartDirectTurnInput {
  request: Request;
  conversation: ConversationRow;
  clientMessageId: string;
  text: string;
  surface: HermesSurface;
  model?: unknown;
  reasoningEffort?: unknown;
  attachments?: ChatAttachment[];
  retry?: boolean;
  /** Groups a regenerated answer with the one it was regenerated from. */
  branchGroupId?: string;
  /** Internal result hand-back from a delegated agent, not a person's message. */
  internalAgentContinuation?: boolean;
  /** Client-observed beginning of the response, persisted for restored clocks. */
  responseStartedAt?: string;
  /**
   * The user had Concise on for this message. The legacy transport field
   * keeps older clients compatible while the product name changes.
   * so it has to reach the runtime-less pipeline too: a style that only applied
   * with Agent mode on would silently stop working when they switched it off.
   */
  adhdMode?: boolean;
  currentLocation?: CurrentLocationSnapshot;
}

type DirectStreamEvent =
  | { type: "runtime"; backend: typeof DIRECT_BACKEND; model: string }
  | { type: "delta"; text: string }
  | { type: "thinking"; text: string }
  | { type: "usage"; usage: ChatTokenUsage }
  | { type: "error"; message: string };

/**
 * The system prompt for a runtime-less turn.
 *
 * It states the shape of this turn rather than describing capability the model
 * does not have here. Without that, a plain provider turn answers as though it
 * still had the agent's tools — offering to read a folder, save a note, or
 * remember something — and the user is told an action happened that nothing
 * carried out.
 */
function directSystemPrompt(
  directMode: boolean,
  currentLocationContext = "",
  userText = "",
  suppliedEvidence = "",
): string {
  return [
    responseStylePrompt(),
    directMode ? directModeSection() : "",
    // A mental-health turn is answered as a CBT copilot wherever it is
    // answered, including here, where there is no runtime behind the model.
    cogniviaSection({ userText }) ?? "",
    // Claim strength has to track the evidence here too. There are no tools on
    // this turn, so the section composes with no allowed tools and tells the
    // model to say an unverifiable criterion is unverified rather than to
    // browse for it.
    evidenceCalibrationSection({ userText, suppliedEvidence }) ?? "",
    [
      "# direct_provider_turn",
      "Agent mode is switched off for this message, so you are answering as the model alone.",
      "You have no tools in this turn: no filesystem, terminal, web, Garden, artifact, memory, connection, skill, or subagent access, and nothing you say can start one.",
      "Answer from this conversation and your own knowledge. If the request genuinely needs an action rather than an answer, say plainly that it needs Agent mode switched back on, and give whatever part of the answer you can without it.",
      "A message beginning with a `/token` is a skill, connection, prompt, or agent the user picked from the palette. Nothing resolved it for this turn, so read it as the name of what they wanted, say it needs Agent mode on, and answer the rest of the message normally.",
      "Never claim to have read, written, run, saved, sent, or remembered anything.",
    ].join("\n"),
    currentLocationContext,
    // This stays last even with Concise on. Brevity may remove irrelevant
    // detail, never the explanation that makes the remaining answer usable.
    readerComprehensionPrompt(),
  ].filter(Boolean).join("\n\n");
}

function recentUserRequests(
  conversation: ConversationRow,
  clientMessageId: string,
): string[] {
  return listRecentConversationMessages(conversation.id, HISTORY_MESSAGES)
    .filter(
      (message) =>
        message.client_message_id !== clientMessageId &&
        message.role === "user" &&
        message.content.trim().length > 0,
    )
    .slice(-8)
    .map((message) => message.content);
}

function historyInput(
  conversation: ConversationRow,
  clientMessageId: string,
): EasyInputMessage[] {
  return listRecentConversationMessages(conversation.id, HISTORY_MESSAGES)
    .filter(
      (message) =>
        message.client_message_id !== clientMessageId &&
        message.content.trim().length > 0 &&
        (message.role === "user" || message.status === "complete"),
    )
    .map((message) =>
      message.role === "assistant"
        ? {
            type: "message",
            role: "assistant",
            phase: "final_answer",
            content: message.content,
          }
        : { type: "message", role: "user", content: message.content },
    );
}

/** The newest user message, carrying whatever was attached to it. */
function currentUserInput(
  text: string,
  attachments: readonly ChatAttachment[],
): EasyInputMessage {
  // "The third screenshot" or "the second pdf" must resolve to the file in
  // that position; the blocks and image parts below keep the user's order but
  // nothing else says which came first, and image parts carry no filename.
  const manifest = attachmentOrderManifest(attachments);
  const attachedBlocks = attachments
    .flatMap((attachment) =>
      attachment.type === "text" || attachment.type === "document"
        ? [`--- Attached file: ${attachment.name} ---\n${attachment.text}`]
        : attachment.type === "model"
          ? [
              `--- Attached file: ${attachment.name} ---\n${modelAttachmentPromptText(attachment)}`,
            ]
          : // Agent mode off has no tools, so the analyzer cannot run here. Said
            // plainly rather than left out: a song that reaches the model as
            // nothing at all is a song the model answers about from its title.
            attachment.type === "audio"
            ? [
                `--- Attached audio: ${attachment.name} ---\nYou cannot hear this file, and no ` +
                  `analysis of it is available in this mode. Say so rather than describing how it ` +
                  `sounds; turning agent mode on lets Breadboard measure it.`,
              ]
            : [],
    );
  const attachedText = [...(manifest ? [manifest] : []), ...attachedBlocks].join(
    "\n\n",
  );
  const images = attachments.filter(
    (attachment): attachment is Extract<ChatAttachment, { type: "image" }> =>
      attachment.type === "image",
  );
  if (!images.length) {
    return {
      type: "message",
      role: "user",
      content: attachedText ? `${attachedText}\n\n---\n\n${text}` : text,
    };
  }
  return {
    type: "message",
    role: "user",
    content: [
      {
        type: "input_text",
        text: attachedText ? `${attachedText}\n\n---\n\n${text}` : text,
      },
      ...images.map((image) => ({
        type: "input_image" as const,
        image_url: image.dataUrl,
        detail: "auto" as const,
      })),
    ],
  };
}

function selectedModel(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : DEFAULT_MODEL;
}

/**
 * Reserve the turn, stream the provider's answer, and finish the turn with what
 * actually arrived. The returned stream is the response body; the conversation
 * store is written by the stream itself, so an aborted read still persists the
 * partial answer rather than leaving a pending assistant message behind.
 */
export async function startDirectProviderTurn(
  input: StartDirectTurnInput,
): Promise<Response> {
  if (input.surface !== input.conversation.surface) {
    throw new ApiError(
      403,
      "surface_scope_mismatch",
      "This conversation is bound to a different assistant surface.",
    );
  }
  // A live agent run owns the assistant slot and its own event stream. Sending a
  // provider turn into the same conversation would interleave two answers.
  const runtimeSession = getRuntimeSessionByConversation(input.conversation.id);
  if (runtimeSession && getActiveRuntimeRun(runtimeSession.id)) {
    throw new ApiError(
      409,
      "run_already_active",
      "This chat is still working on the previous message. Stop it or wait for it to finish.",
    );
  }

  const attachments = input.attachments ?? [];
  let reservation;
  try {
    reservation = reserveConversationTurn({
      conversation: input.conversation,
      clientMessageId: input.clientMessageId,
      surface: input.surface,
      content: input.text,
      metadata: {
        backend: DIRECT_BACKEND,
        attachmentNames: attachments.map((attachment) => attachment.name),
        attachments: chatMessageAttachments(attachments),
        ...(input.responseStartedAt
          ? { responseStartedAt: input.responseStartedAt }
          : {}),
        ...(input.branchGroupId ? { branchGroupId: input.branchGroupId } : {}),
        ...(input.internalAgentContinuation
          ? { internalAgentContinuation: true }
          : {}),
      },
    });
  } catch (error) {
    throw error instanceof ConversationStoreError
      ? new ApiError(error.status, error.code, error.message)
      : error;
  }
  const preDispatchReserved =
    !reservation.isNew &&
    isPreDispatchReservedAssistant(reservation.assistantMessage);
  if (shouldGenerateConversationTitleForTurn({
    currentTitle: reservation.conversation.title,
    userOrderIndex: reservation.userMessage.order_index,
    reservationIsNew: reservation.isNew,
    preDispatchReserved,
  })) {
    const { baseURL } = resolveChatmockBaseUrl(input.request);
    const titledConversation = await generateAndApplyConversationTitle({
      conversation: reservation.conversation,
      firstPrompt: input.text,
      model: input.model,
      baseUrl: baseURL,
    });
    if (titledConversation) {
      reservation = { ...reservation, conversation: titledConversation };
      input = { ...input, conversation: titledConversation };
    }
  }
  if (!reservation.isNew) {
    const assistant = reservation.assistantMessage;
    if (assistant.status === "pending") {
      throw new ApiError(
        409,
        "turn_already_pending",
        "That message is already being answered.",
      );
    }
    if (assistant.status === "complete") {
      throw new ApiError(
        409,
        "turn_already_complete",
        "That message was already answered.",
      );
    }
    if (!input.retry) {
      throw new ApiError(
        409,
        "turn_requires_retry",
        "This failed turn requires an explicit retry.",
      );
    }
    retryAssistantMessage(
      input.conversation.id,
      input.clientMessageId,
      undefined,
      {
        ...(input.responseStartedAt
          ? { responseStartedAt: input.responseStartedAt }
          : {}),
        ...(input.branchGroupId ? { branchGroupId: input.branchGroupId } : {}),
      },
    );
  }

  const model = selectedModel(input.model);
  const effort = normalizeAssistantReasoningEffort(input.reasoningEffort);
  const startedAtMs = Date.now();

  const finish = (
    status: "complete" | "failed" | "aborted",
    content: string,
    usage: ChatTokenUsage | null,
    error?: string,
  ) => {
    const metadata = {
      backend: DIRECT_BACKEND,
      model,
      responseDurationMs: Math.max(0, Date.now() - startedAtMs),
      ...(input.branchGroupId ? { branchGroupId: input.branchGroupId } : {}),
    };
    try {
      if (status === "complete") {
        completeAssistantMessage({
          conversationId: input.conversation.id,
          clientMessageId: input.clientMessageId,
          content,
          metadata,
          ...(usage ? { tokenUsage: usage } : {}),
        });
        scheduleMemoryProfileSynthesisForConversation({
          conversationId: input.conversation.id,
          outcome: "completed",
        });
      } else {
        failAssistantMessage({
          conversationId: input.conversation.id,
          clientMessageId: input.clientMessageId,
          status,
          content,
          ...(error ? { error } : {}),
          metadata,
        });
      }
    } catch {
      // The turn may already be terminal (a racing abort). The stored answer is
      // the one that was written first either way.
    }
  };

  // This controller is server-owned. A browser response is merely one viewer;
  // only the explicit session abort route is allowed to stop the provider.
  const providerAbort = new AbortController();
  const activeDirectTurn: ActiveDirectProviderTurn = {
    clientMessageId: input.clientMessageId,
    controller: providerAbort,
    stopRequested: false,
  };
  activeDirectProviderTurns.set(input.conversation.id, activeDirectTurn);
  const releaseDirectTurn = () => {
    if (activeDirectProviderTurns.get(input.conversation.id) === activeDirectTurn) {
      activeDirectProviderTurns.delete(input.conversation.id);
    }
  };

  let stream: AsyncIterable<ResponseStreamEvent>;
  try {
    const { baseURL } = resolveChatmockBaseUrl(input.request);
    const client = new OpenAI({
      baseURL,
      apiKey: process.env.OPENAI_API_KEY || "local",
    });
    const requestBody = {
      model,
      instructions: directSystemPrompt(
        input.adhdMode === true,
        input.internalAgentContinuation
          ? ""
          : renderCurrentLocationContext({
              request: input.text,
              priorRequests: recentUserRequests(
                input.conversation,
                input.clientMessageId,
              ),
              location: input.currentLocation,
            }),
        input.text,
        suppliedEvidenceText(attachments),
      ),
      input: [
        ...historyInput(input.conversation, input.clientMessageId),
        currentUserInput(input.text, attachments),
      ],
      stream: true,
      store: false,
      ...(effort !== "none"
        ? {
            reasoning: {
              effort: toOpenAiReasoningEffort(effort),
              summary: "auto" as const,
            },
          }
        : {}),
    } satisfies ResponseCreateParamsStreaming;
    stream = (await client.responses.create(requestBody, {
      signal: providerAbort.signal,
    })) as AsyncIterable<ResponseStreamEvent>;
  } catch (error) {
    const stopped = activeDirectTurn.stopRequested;
    const message =
      error instanceof Error
        ? error.message
        : "The model provider could not be reached.";
    finish(stopped ? "aborted" : "failed", "", null, stopped ? "cancelled_by_user" : message);
    releaseDirectTurn();
    recordAuditEvent({
      eventType: "direct_provider.failed",
      userId: input.conversation.user_id,
      payload: {
        conversationPublicId: input.conversation.public_id,
        surface: input.surface,
        model,
      },
    });
    throw new ApiError(
      stopped ? 409 : 502,
      stopped ? "direct_provider_stopped" : "direct_provider_unavailable",
      stopped ? "The answer was stopped." : message,
    );
  }

  recordAuditEvent({
    eventType: "direct_provider.message_submitted",
    userId: input.conversation.user_id,
    payload: {
      conversationPublicId: input.conversation.public_id,
      clientMessageId: input.clientMessageId,
      surface: input.surface,
      model,
      reasoningEffort: effort,
    },
  });

  const encoder = new TextEncoder();
  let settled = false;
  let writable = true;
  // Outside the stream so a cancelled turn stores the text that did arrive rather
  // than an empty message — the same thing the agent pipeline does on abort.
  let answer = "";
  let usage: ChatTokenUsage | null = null;
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emDash = createEmDashFilter();
      let failure: string | null = null;

      // A reader that went away closes the stream under us. The answer still has
      // to be accumulated and stored, so a failed write only stops writing.
      const emit = (event: DirectStreamEvent) => {
        if (!writable) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
        } catch {
          writable = false;
        }
      };
      const emitAnswer = (text: string) => {
        const filtered = emDash.push(text);
        if (!filtered) return;
        answer += filtered;
        emit({ type: "delta", text: filtered });
      };

      emit({ type: "runtime", backend: DIRECT_BACKEND, model });
      // Providers that deliver a message only as a finished item rather than as
      // deltas would otherwise store an empty answer. See responses-stream-text.
      const answerRecovery = createResponseTextRecovery();
      const thinkingRecovery = createResponseTextRecovery();
      try {
        for await (const event of stream) {
          if (event.type === "response.output_text.delta") {
            answerRecovery.recordStreamed(event.output_index, event.delta);
            emitAnswer(event.delta);
          } else if (
            event.type === "response.reasoning_summary_text.delta" ||
            event.type === "response.reasoning_text.delta"
          ) {
            thinkingRecovery.recordStreamed(event.output_index, event.delta);
            emit({ type: "thinking", text: event.delta });
          } else if (event.type === "response.output_item.done") {
            const missingThinking = thinkingRecovery.missingFrom(
              event.output_index,
              reasoningTextFromOutputItem(event.item),
            );
            if (missingThinking) {
              emit({ type: "thinking", text: missingThinking });
            }
            const missingAnswer = answerRecovery.missingFrom(
              event.output_index,
              assistantTextFromOutputItem(event.item),
            );
            if (missingAnswer) emitAnswer(missingAnswer);
          } else if (
            event.type === "response.completed" ||
            event.type === "response.incomplete"
          ) {
            usage = chatTokenUsageFromResponse(event.response) ?? usage;
          } else if (event.type === "response.failed") {
            usage = chatTokenUsageFromResponse(event.response) ?? usage;
            const response = event.response as unknown as {
              error?: { message?: unknown };
            };
            failure =
              typeof response.error?.message === "string"
                ? response.error.message
                : "The model provider ended the response with an error.";
          }
        }
      } catch (error) {
        if (!activeDirectTurn.stopRequested) {
          failure =
            error instanceof Error
              ? error.message
              : "The response stream ended unexpectedly.";
        }
      }

      const held = emDash.flush();
      if (held) {
        answer += held;
        emit({ type: "delta", text: held });
      }
      if (usage) {
        emit({
          type: "usage",
          usage: {
            ...usage,
            responseDurationMs: Math.max(0, Date.now() - startedAtMs),
          },
        });
      }
      if (failure) emit({ type: "error", message: failure });
      if (!settled) {
        settled = true;
        // A stream that failed with text already on screen is a partial answer,
        // not a lost turn: it is stored as what arrived so a reload shows the
        // same transcript the user just read.
        finish(
          activeDirectTurn.stopRequested
            ? "aborted"
            : failure && !answer.trim()
              ? "failed"
              : "complete",
          answer,
          usage,
          activeDirectTurn.stopRequested
            ? "cancelled_by_user"
            : failure ?? undefined,
        );
      }
      releaseDirectTurn();
      if (!writable) return;
      try {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch {
        writable = false;
      }
    },
    cancel() {
      // The browser stopped reading because its viewer navigated or reloaded.
      // `start()` keeps draining the provider and writing the durable answer.
      // Explicit Stop reaches `abortDirectProviderTurn` through the abort API.
      writable = false;
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Breadboard-AI-Backend": DIRECT_BACKEND,
    },
  });
}
