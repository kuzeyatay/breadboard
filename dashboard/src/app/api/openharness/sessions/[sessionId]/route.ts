import { NextResponse } from "next/server";
import db from "@/lib/db";
import { requireUserId } from "@/lib/server-auth";
import {
  apiErrorResponse,
  requireEnabled,
  ApiError,
} from "@/lib/openharness/route-helpers.ts";
import {
  deleteConversation,
  getConversationForUser,
} from "@/lib/conversations/store.ts";
import {
  deleteRuntimeSession,
  listRuntimeSessionsForConversation,
  recordAuditEvent,
} from "@/lib/openharness/runtime-store.ts";
import { getActiveRuntimeRun } from "@/lib/openharness/run-store.ts";

export const dynamic = "force-dynamic";

/**
 * DELETE: remove one chat from the user's history.
 *
 * Breadboard owns the durable transcript, so this is the authoritative delete:
 * the conversation row cascades its messages, memory state and artifacts, and
 * the runtime-session rows are cleared afterwards. Runtime live sessions are
 * disposable and are not contacted — a dropped session is reconstructible and
 * there is nothing left to reconstruct it for.
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

    // Deleting mid-run would strand a live runtime turn writing into rows that
    // no longer exist. The caller stops the run first.
    for (const runtimeSession of runtimeSessions) {
      if (getActiveRuntimeRun(runtimeSession.id)) {
        throw new ApiError(
          409,
          "run_active",
          "Stop the active response before deleting this chat.",
        );
      }
    }

    for (const runtimeSession of runtimeSessions) {
      recordAuditEvent({
        eventType: "conversation.deleted",
        runtimeSessionId: runtimeSession.id,
        userId,
        gardenId: runtimeSession.garden_id,
        payload: { surface: runtimeSession.surface },
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

    return NextResponse.json({ deleted: true, id: sessionId });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
