// Executing a scheduled chat job.
//
// Ordinary tasks work exactly like a person: open a chat and send the saved
// prompt. Conditional notifications first run in an off-the-record conversation
// and only publish a clean copy when the agent proves the watched objective is
// met. A daily availability check can therefore stay invisible for months
// instead of adding a failed "not yet" chat every morning.
//
// The assistant's reply is consumed by the server-owned event pump, so the answer
// lands in the durable transcript whether or not anyone has the app open.

import {
  appendConversationAssistantMessage,
  completeAssistantMessage,
  createConversation,
  deleteConversation,
  getConversationMessageByClientId,
  reserveConversationTurn,
  type ConversationMessageRow,
  type ConversationRow,
} from "../conversations/store.ts";
import { startConversationTurn } from "../conversations/turn-service.ts";
import {
  trackScheduledChatFinished,
  trackScheduledChatStarted,
} from "../plan/agent-tracking.ts";
import {
  startSessionEventPump,
  waitForSessionEventPump,
} from "../hermes/event-stream.ts";
import { getRuntimeRun } from "../hermes/run-store.ts";
import { requireEnabled } from "../hermes/route-core.ts";
import {
  authorizeGardenAccess,
  resolveConversationRuntime,
} from "../hermes/session-service.ts";
import type { ScheduledChatJobRow } from "./store.ts";
import { scheduledReminderText } from "./types.ts";
import {
  readScheduledObjectiveDecision,
  scheduledChatOpensOnlyWhenMet,
  scheduledObjectiveEvaluationPrompt,
  type ScheduledObjectiveDecision,
} from "./conversation-policy.ts";

export interface ScheduledChatRunResult {
  status: "ok" | "failed";
  conversationId: string | null;
  /** Null for ordinary tasks; conditional watches report the private decision. */
  objectiveDecision: ScheduledObjectiveDecision | null;
  error?: string;
}

export interface ScheduledChatRunOptions {
  /** Keep the schedule's execution lease until the assistant turn settles. */
  waitForCompletion?: boolean;
}

function chatTitle(job: ScheduledChatJobRow): string {
  return `${job.prompt}`.trim().slice(0, 120) || "Scheduled chat";
}

function parsedJson(value: string | null): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

/** Copy a successful private evaluation into the user's visible history. */
function publishObjectiveConversation(input: {
  job: ScheduledChatJobRow;
  gardenId: number | null;
  answer: ConversationMessageRow;
  content: string;
}): ConversationRow {
  const conversation = createConversation({
    userId: input.job.user_id,
    title: chatTitle(input.job),
    surface: input.job.surface,
    scopeKind: input.gardenId === null ? "global" : "garden",
    defaultGardenId: input.gardenId,
    scheduledChatJobId: input.job.id,
  });
  try {
    const clientMessageId = `schedule-result-${input.job.id}-${Date.now()}`;
    reserveConversationTurn({
      conversation,
      clientMessageId,
      surface: input.job.surface,
      content: input.job.prompt,
      metadata: { scheduledObjectiveMet: true },
    });
    completeAssistantMessage({
      conversationId: conversation.id,
      clientMessageId,
      content: input.content || "The scheduled objective is now complete.",
      metadata: { scheduledObjectiveMet: true },
      sources: parsedJson(input.answer.sources),
      tokenUsage: parsedJson(input.answer.token_usage),
    });
    return conversation;
  } catch (error) {
    // Publication is all-or-nothing from the history's point of view. A
    // partially copied conversation would recreate the empty-chat bug this
    // decision layer exists to prevent.
    try {
      deleteConversation(conversation);
    } catch {
      // Preserve the publication failure; scheduler history still records it.
    }
    throw error;
  }
}

/**
 * Deliver a reminder inside Breadboard without starting an agent turn. This is
 * both the normal destination when no phone link exists and the guaranteed
 * fallback when Telegram or WhatsApp rejects the send at fire time.
 */
function publishReminderConversation(input: {
  job: ScheduledChatJobRow;
  content: string;
  deliveryError?: string | null;
}): ConversationRow {
  const conversation = createConversation({
    userId: input.job.user_id,
    title: chatTitle(input.job),
    surface: "dashboard_terminal",
    scopeKind: "global",
    scheduledChatJobId: input.job.id,
  });
  try {
    appendConversationAssistantMessage({
      conversation,
      clientMessageId: `schedule-reminder-${input.job.id}-${Date.now()}`,
      surface: "dashboard_terminal",
      content: input.content,
      metadata: {
        scheduledReminder: true,
        deliveryChannel: input.job.delivery_channel,
        deliveryFallback: Boolean(input.deliveryError),
        ...(input.deliveryError ? { deliveryError: input.deliveryError.slice(0, 500) } : {}),
      },
    });
    return conversation;
  } catch (error) {
    try {
      deleteConversation(conversation);
    } catch {
      // Preserve the reminder publication failure.
    }
    throw error;
  }
}

/**
 * Open the chat and dispatch the prompt. Resolves once the turn has been accepted
 * by the runtime; the answer continues streaming into the conversation after that.
 */
export async function runScheduledChatJob(
  job: ScheduledChatJobRow,
  options: ScheduledChatRunOptions = {},
): Promise<ScheduledChatRunResult> {
  const gardenSlug = job.surface === "garden_chat" ? job.garden_slug : null;
  if (job.surface === "garden_chat" && !gardenSlug) {
    return {
      status: "failed",
      conversationId: null,
      objectiveDecision: null,
      error: "This schedule has no garden.",
    };
  }

  let conversationId: string | null = null;
  let workingConversation: ConversationRow | null = null;
  const waitsForObjective = scheduledChatOpensOnlyWhenMet(
    job.conversation_policy,
  );
  // One card per firing, not per schedule: a daily job that has run for a month
  // should read as a month of work on the board, not one card rewritten thirty
  // times. The clock is read once so the start and the finish agree on the id.
  const runId = `schedule-${job.id}-${new Date().toISOString()}`;
  trackScheduledChatStarted({
    userId: job.user_id,
    jobId: job.id,
    runId,
    title: chatTitle(job),
  });

  try {
    if (job.delivery_mode === "reminder") {
      const reminder = scheduledReminderText(job.prompt);
      let phoneError: string | null = null;
      if (job.delivery_channel) {
        try {
          const { sendOwnerText } = await import("../hermes/messaging-service.ts");
          const delivered = await sendOwnerText({
            channel: job.delivery_channel,
            userId: job.user_id,
            text: reminder,
            kind: "reminder",
          });
          conversationId = delivered.continuationConversationId;
        } catch (cause) {
          phoneError = cause instanceof Error
            ? cause.message
            : `${job.delivery_channel} could not deliver the reminder.`;
        }
      }
      if (!conversationId) {
        conversationId = publishReminderConversation({
          job,
          content: reminder,
          deliveryError: phoneError,
        }).public_id;
      }
      trackScheduledChatFinished({
        userId: job.user_id,
        runId,
        outcome: "completed",
        summary: phoneError
          ? `Phone delivery failed; reminder opened in chat. ${phoneError}`
          : job.delivery_channel
            ? `Reminder delivered through ${job.delivery_channel}.`
            : "Reminder opened in chat.",
      });
      return { status: "ok", conversationId, objectiveDecision: null };
    }

    // Fail before creating anything when the runtime is off, so a stopped
    // runtime leaves a recorded failure instead of an empty chat.
    requireEnabled();

    // Re-authorize on every run: a garden can be deleted or unshared between the
    // moment a schedule is created and the moment it fires.
    const garden = gardenSlug ? authorizeGardenAccess(job.user_id, gardenSlug) : null;

    const conversation = createConversation({
      userId: job.user_id,
      title: chatTitle(job),
      surface: job.surface,
      scopeKind: garden ? "garden" : "global",
      defaultGardenId: garden?.clusterId ?? null,
      scheduledChatJobId: job.id,
      temporary: waitsForObjective,
    });
    workingConversation = conversation;
    conversationId = conversation.public_id;

    // Mirror the browser's ordering: attach the pump that persists the assistant
    // turn before the prompt is dispatched, so no early output can be missed.
    const runtime = await resolveConversationRuntime({
      conversation,
      surface: job.surface,
      activeGardenSlug: garden?.slug ?? null,
      activePageSlug: null,
    });
    startSessionEventPump(runtime);

    const clientMessageId = `schedule-${job.id}-${Date.now()}`;
    const result = await startConversationTurn({
      conversation,
      clientMessageId,
      text: waitsForObjective
        ? scheduledObjectiveEvaluationPrompt(job.prompt)
        : job.prompt,
      surface: job.surface,
      surfaceContext: garden ? { activeGardenSlug: garden.slug } : undefined,
      model: job.model,
      reasoningEffort: job.reasoning_effort,
    });

    if (result.accepted) {
      if (options.waitForCompletion || waitsForObjective) {
        await waitForSessionEventPump(runtime);
        const finishedRun = getRuntimeRun(result.run.id);
        if (!finishedRun || finishedRun.status !== "completed") {
          return failed(
            finishedRun?.status === "cancelled"
              ? "The scheduled chat was stopped."
              : "The scheduled chat did not complete.",
          );
        }
      }
      if (waitsForObjective) {
        const answer = getConversationMessageByClientId(
          conversation.id,
          clientMessageId,
          "assistant",
        );
        if (!answer || answer.status !== "complete") {
          return failed("The scheduled check finished without a usable answer.");
        }
        const objective = readScheduledObjectiveDecision(answer.content);
        if (objective.decision === null) {
          return failed("The scheduled check did not make an objective decision.");
        }
        if (objective.decision === "pending") {
          deleteConversation(conversation);
          workingConversation = null;
          conversationId = null;
          trackScheduledChatFinished({
            userId: job.user_id,
            runId,
            outcome: "completed",
            summary: "Checked; the objective is not met yet.",
          });
          return {
            status: "ok",
            conversationId: null,
            objectiveDecision: "pending",
          };
        }

        const published = publishObjectiveConversation({
          job,
          gardenId: garden?.clusterId ?? null,
          answer,
          content: objective.visibleContent,
        });
        deleteConversation(conversation);
        workingConversation = null;
        conversationId = published.public_id;
        trackScheduledChatFinished({
          userId: job.user_id,
          runId,
          outcome: "completed",
          summary: "The watched objective was met and a chat was opened.",
        });
        return {
          status: "ok",
          conversationId,
          objectiveDecision: "met",
        };
      }
      trackScheduledChatFinished({ userId: job.user_id, runId, outcome: "completed" });
      return { status: "ok", conversationId, objectiveDecision: null };
    }
    if ("blocked" in result) {
      return failed(
        "The prompt needs a permission decision, so it cannot run unattended.",
      );
    }
    if ("clarified" in result) return failed(result.message);
    return failed("The runtime did not accept this turn.");
  } catch (cause) {
    return failed(
      cause instanceof Error ? cause.message : "The scheduled chat could not start.",
    );
  }

  function failed(error: string): ScheduledChatRunResult {
    if (waitsForObjective && workingConversation) {
      try {
        deleteConversation(workingConversation);
      } catch {
        // Cleanup must not replace the useful scheduler failure reason.
      }
      workingConversation = null;
      conversationId = null;
    }
    trackScheduledChatFinished({
      userId: job.user_id,
      runId,
      outcome: "failed",
      summary: error,
    });
    return { status: "failed", conversationId, objectiveDecision: null, error };
  }
}
