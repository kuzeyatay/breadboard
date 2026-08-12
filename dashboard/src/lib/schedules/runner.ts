// Executing a scheduled chat job.
//
// A run is exactly what a person does by hand: open a brand-new chat on the
// surface the job was scheduled from, then send the saved prompt as the first
// message. It goes through the same authenticated pipeline (`startConversationTurn`)
// as the browser, so capability decisions, memory, grounding, and persistence are
// identical — there is no privileged scheduler-only path into the runtime.
//
// The assistant's reply is consumed by the server-owned event pump, so the answer
// lands in the durable transcript whether or not anyone has the app open.

import { createConversation } from "../conversations/store.ts";
import { startConversationTurn } from "../conversations/turn-service.ts";
import {
  trackScheduledChatFinished,
  trackScheduledChatStarted,
} from "../plan/agent-tracking.ts";
import { startSessionEventPump } from "../hermes/event-stream.ts";
import { requireEnabled } from "../hermes/route-core.ts";
import {
  authorizeGardenAccess,
  resolveConversationRuntime,
} from "../hermes/session-service.ts";
import type { ScheduledChatJobRow } from "./store.ts";

export interface ScheduledChatRunResult {
  status: "ok" | "failed";
  conversationId: string | null;
  error?: string;
}

function chatTitle(job: ScheduledChatJobRow): string {
  return `${job.title}`.slice(0, 120) || "Scheduled chat";
}

/**
 * Open the chat and dispatch the prompt. Resolves once the turn has been accepted
 * by the runtime; the answer continues streaming into the conversation after that.
 */
export async function runScheduledChatJob(
  job: ScheduledChatJobRow,
): Promise<ScheduledChatRunResult> {
  const gardenSlug = job.surface === "garden_chat" ? job.garden_slug : null;
  if (job.surface === "garden_chat" && !gardenSlug) {
    return { status: "failed", conversationId: null, error: "This schedule has no garden." };
  }

  let conversationId: string | null = null;
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
    });
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

    const result = await startConversationTurn({
      conversation,
      clientMessageId: `schedule-${job.id}-${Date.now()}`,
      text: job.prompt,
      surface: job.surface,
      surfaceContext: garden ? { activeGardenSlug: garden.slug } : undefined,
    });

    if (result.accepted) {
      // "Dispatched" is as far as this function sees: the answer streams into
      // the conversation after it returns. The card says the firing worked,
      // which is the thing a schedule can actually fail at.
      trackScheduledChatFinished({ userId: job.user_id, runId, outcome: "completed" });
      return { status: "ok", conversationId };
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
    trackScheduledChatFinished({
      userId: job.user_id,
      runId,
      outcome: "failed",
      summary: error,
    });
    return { status: "failed", conversationId, error };
  }
}
