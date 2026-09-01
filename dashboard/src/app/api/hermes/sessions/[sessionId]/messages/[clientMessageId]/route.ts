import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import {
  ApiError,
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
  requireString,
} from "@/lib/hermes/route-helpers.ts";
import {
  getConversationForUser,
  getConversationMessageByClientId,
  listConversationMessages,
} from "@/lib/conversations/store.ts";
import {
  deleteConversationMessages,
  planConversationTurnDeletion,
} from "@/lib/conversations/turn-delete.ts";
import {
  projectConversationBranchMessages,
  runtimeMessagesForBranch,
} from "@/lib/conversations/branch-history.ts";
import {
  addAssistantContentVersion,
  presentMessageVersions,
} from "@/lib/conversations/message-versions.ts";
import {
  cancelExternalAgentRun,
  listRunningExternalAgentRuns,
} from "@/lib/conversations/external-agent-cancel.ts";
import {
  deleteArtifact,
  listArtifactIdsForMessages,
} from "@/lib/hermes/artifact-store.ts";
import { resolveConversationRuntime } from "@/lib/hermes/session-service.ts";
import { getRuntimeSessionByConversation } from "@/lib/hermes/runtime-store.ts";
import { getActiveRuntimeRun } from "@/lib/hermes/run-store.ts";
import { reclaimAbandonedRunForSession } from "@/lib/hermes/run-recovery.ts";

export const dynamic = "force-dynamic";

/**
 * PATCH: save a human edit as a new version of one completed assistant answer.
 *
 * The model's wording remains version zero. Besides making an accidental edit
 * reversible, that also keeps the evidence ledger honest: it describes the
 * model's text, not the wording a person changed afterwards.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ sessionId: string; clientMessageId: string }> },
) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const { sessionId, clientMessageId } = await params;
    const body = await readJsonBody(request);
    const content = requireString(body.content, "content", 120_000);
    const expectedContent = requireString(
      body.expectedContent,
      "expectedContent",
      120_000,
    );
    const conversation = getConversationForUser(sessionId, userId);
    const assistant = getConversationMessageByClientId(
      conversation.id,
      clientMessageId,
      "assistant",
    );
    if (!assistant) {
      throw new ApiError(
        404,
        "message_not_found",
        "That response no longer exists.",
      );
    }

    const runtime = getRuntimeSessionByConversation(conversation.id);
    if (runtime) {
      reclaimAbandonedRunForSession(runtime.id);
      if (getActiveRuntimeRun(runtime.id)) {
        throw new ApiError(
          409,
          "run_already_active",
          "This chat is still working. Stop it or wait for it to finish.",
        );
      }
    }

    const state = addAssistantContentVersion({
      conversationId: conversation.id,
      messageId: assistant.id,
      expectedContent,
      content,
      origin: "manual",
    });

    // Keep the runtime's next answer grounded in the text now on screen. The
    // edit itself is already durable if recreation is temporarily unavailable.
    let runtimeReset = !runtime;
    if (runtime) {
      try {
        const visibleTranscript = projectConversationBranchMessages(
          listConversationMessages(conversation.id, {
            limit: 500,
            includePending: false,
          }),
        );
        await resolveConversationRuntime({
          conversation,
          surface: conversation.surface,
          activeGardenSlug: runtime.garden_id,
          activePageSlug: runtime.page_slug,
          forceRecreate: true,
          historyOverride: runtimeMessagesForBranch(visibleTranscript),
        });
        runtimeReset = true;
      } catch {
        runtimeReset = false;
      }
    }

    return NextResponse.json({
      content: state.versions[state.activeIndex].content,
      versions: presentMessageVersions(state),
      runtimeReset,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/**
 * DELETE: remove one exchange — the message and the answer it produced.
 *
 * Three things remember a turn, and a delete that only did the first would be a
 * delete in name only:
 *
 *  1. The durable transcript. `planConversationTurnDeletion` works out what has
 *     to go, including the branch variants that would otherwise resurface in
 *     place of the deleted exchange.
 *  2. Whatever that turn still has running. An external agent run outlives the
 *     row that launched it, and the row is the only thing that knows the run
 *     belongs to this chat, so it is stopped while the row can still be read.
 *  3. The agent runtime, which holds the conversation in its own context. It is
 *     re-seeded from the transcript that remains, so the next question is
 *     answered by a session that never saw the deleted turn — otherwise the
 *     chat would keep referring to a message that is no longer on screen.
 *
 * The files the answer produced go with it. The transcript row is what an
 * artifact hangs from, and losing it would not remove the artifact — it would
 * move it into the unassigned pile at the end of the chat, which is the one
 * outcome a delete must not produce.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string; clientMessageId: string }> },
) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const { sessionId, clientMessageId } = await params;
    const conversation = getConversationForUser(sessionId, userId);

    const runtime = getRuntimeSessionByConversation(conversation.id);
    if (runtime) {
      // A turn whose event pump died leaves a run row nothing will ever finish;
      // clearing it first keeps that debris from blocking an unrelated delete.
      reclaimAbandonedRunForSession(runtime.id);
      if (getActiveRuntimeRun(runtime.id)) {
        throw new ApiError(
          409,
          "run_already_active",
          "This chat is still working. Stop it or wait for it to finish.",
        );
      }
    }

    const plan = planConversationTurnDeletion({
      conversation,
      clientMessageId,
    });

    const doomed = new Set(plan.messageIds);
    const running = listRunningExternalAgentRuns(conversation.id).filter((run) =>
      doomed.has(run.messageId),
    );
    await Promise.all(
      running.map((run) => cancelExternalAgentRun(userId, run.kind, run.runId)),
    );

    // Read before the delete, act after it: the pointer these artifacts are
    // found by is about to be nulled by the foreign key, but removing the
    // message is the promise made to the reader and goes first.
    const artifactIds = listArtifactIdsForMessages(plan.messageIds);
    const deleted = deleteConversationMessages(plan.messageIds);
    for (const artifactId of artifactIds) {
      await deleteArtifact({
        artifactId,
        userId,
        conversationPublicId: conversation.public_id,
      }).catch(() => {
        // An artifact already gone, or whose stored files refuse to go, must
        // not turn a completed delete into an error.
      });
    }

    // Best effort, and deliberately after the commit: the transcript is
    // authoritative, so a runtime that cannot be re-seeded right now must not
    // undo a delete the reader has already been shown. It is reported instead.
    let runtimeReset = false;
    if (runtime) {
      try {
        await resolveConversationRuntime({
          conversation,
          surface: conversation.surface,
          activeGardenSlug: runtime.garden_id,
          activePageSlug: runtime.page_slug,
          forceRecreate: true,
          historyOverride: runtimeMessagesForBranch(plan.remaining),
        });
        runtimeReset = true;
      } catch {
        runtimeReset = false;
      }
    }

    return NextResponse.json({
      deleted: true,
      messageCount: deleted,
      artifactCount: artifactIds.length,
      stoppedRuns: running.length,
      runtimeReset,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
