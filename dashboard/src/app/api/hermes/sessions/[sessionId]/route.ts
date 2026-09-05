import { NextResponse } from "next/server";
import db from "@/lib/db";
import { requireUserId } from "@/lib/server-auth";
import {
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
  ApiError,
} from "@/lib/hermes/route-helpers.ts";
import {
  deleteConversation,
  getConversationForUser,
  presentConversation,
  renameConversation,
  setConversationHighlight,
  setConversationPinned,
} from "@/lib/conversations/store.ts";
import { HERMES_SURFACES, type HermesSurface } from "@/lib/hermes/config.ts";
import { presentHermesSessionDetail } from "@/lib/hermes/session-presentation.ts";
import { isChatHighlight } from "@/lib/conversations/highlights.ts";
import {
  deleteRuntimeSession,
  listRuntimeSessionsForConversation,
  recordAuditEvent,
} from "@/lib/hermes/runtime-store.ts";
import { cancelRuntimeSessionWork } from "@/lib/hermes/session-cancel.ts";
import { cancelRunningExternalAgentRuns } from "@/lib/conversations/external-agent-cancel.ts";
import { reconcileMaxResearchConversation } from "@/lib/max-research/conversation-persistence.ts";

export const dynamic = "force-dynamic";

function requestedSurface(value: string | null): HermesSurface {
  if (value && (HERMES_SURFACES as readonly string[]).includes(value)) {
    return value as HermesSurface;
  }
  throw new ApiError(400, "invalid_surface", "A valid surface is required.");
}

/** Load only the transcript the reader selected; history lists stay summary-only. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const { sessionId } = await params;
    const surface = requestedSurface(new URL(request.url).searchParams.get("surface"));
    const conversation = getConversationForUser(sessionId, userId);
    if (surface !== "dashboard_terminal" && conversation.surface !== surface) {
      throw new ApiError(404, "session_not_found", "This chat is no longer available.");
    }
    await reconcileMaxResearchConversation(userId, conversation.id);
    return NextResponse.json({ session: presentHermesSessionDetail(conversation) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/**
 * PATCH: rename, pin or highlight one chat.
 *
 * All three are sidebar affordances, so all three stay deliberately small: a
 * rename never touches the transcript, and pinning and highlighting are marks
 * on the row that do not count as activity. None reaches the agent runtime.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const { sessionId } = await params;
    const body = await readJsonBody(request);
    let conversation = getConversationForUser(sessionId, userId);

    if (body.title !== undefined) {
      const title = typeof body.title === "string" ? body.title.trim() : "";
      if (!title) {
        throw new ApiError(400, "invalid_title", "A chat needs a name.");
      }
      conversation = renameConversation(conversation, title.slice(0, 200));
    }

    if (body.pinned !== undefined) {
      if (typeof body.pinned !== "boolean") {
        throw new ApiError(400, "invalid_pinned", "Pinned must be true or false.");
      }
      conversation = setConversationPinned(conversation, body.pinned);
    }

    if (body.highlight !== undefined) {
      // null clears the mark. Anything else has to name a color in the shared
      // palette, so the rail can never be handed a slug it cannot paint.
      if (body.highlight !== null && !isChatHighlight(body.highlight)) {
        throw new ApiError(
          400,
          "invalid_highlight",
          "A highlight must be one of the palette colors, or null.",
        );
      }
      conversation = setConversationHighlight(conversation, body.highlight);
    }

    return NextResponse.json({ session: presentConversation(conversation) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/**
 * DELETE: remove one chat from the user's history.
 *
 * Breadboard owns the durable transcript, so this is the authoritative delete:
 * the conversation row cascades its messages, memory state and artifacts, and
 * the runtime-session rows are cleared afterwards.
 *
 * Deleting a chat also stops what that chat is doing. A runtime turn, the
 * terminal command it started, and any external agent run it launched are all
 * live processes that only the transcript remembers — once these rows are gone
 * nothing can reach them again, so they are cancelled first, while the rows
 * that name them still exist. This is why the delete cancels rather than
 * refusing mid-run: asking someone to stop a run before they may throw the
 * chat away is a rule about our bookkeeping, not about what they wanted.
 *
 * Audit events and garden proposals reference the runtime session with
 * ON DELETE SET NULL, so the record that work happened survives the chat.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const { sessionId } = await params;
    const conversation = getConversationForUser(sessionId, userId);
    const runtimeSessions = listRuntimeSessionsForConversation(conversation.id);

    // Agent runs are found by reading the transcript, so this has to happen
    // before the cascade takes the messages that hold their run ids.
    const agentRuns = await cancelRunningExternalAgentRuns(userId, conversation.id);
    const cancelledRunIds: string[] = [];
    for (const runtimeSession of runtimeSessions) {
      const stopped = await cancelRuntimeSessionWork(userId, runtimeSession);
      if (stopped.cancelledRunId) cancelledRunIds.push(stopped.cancelledRunId);
    }

    for (const runtimeSession of runtimeSessions) {
      recordAuditEvent({
        eventType: "conversation.deleted",
        runtimeSessionId: runtimeSession.id,
        userId,
        gardenId: runtimeSession.garden_id,
        payload: {
          surface: runtimeSession.surface,
          cancelledRuns: cancelledRunIds.length,
          cancelledAgentRuns: agentRuns.filter((run) => run.stopped).length,
        },
      });
    }

    // The conversation is the canonical owner, so it goes first; its cascade
    // takes the messages, memory state and artifacts. The runtime-session rows
    // only reference it with ON DELETE SET NULL, so they have to be removed by
    // id or they linger forever with a null conversation.
    db.transaction(() => {
      deleteConversation(conversation);
      for (const runtimeSession of runtimeSessions) {
        deleteRuntimeSession(runtimeSession.id);
      }
    })();

    return NextResponse.json({
      deleted: true,
      id: sessionId,
      cancelled: {
        runs: cancelledRunIds.length,
        agentRuns: agentRuns.filter((run) => run.stopped).length,
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
