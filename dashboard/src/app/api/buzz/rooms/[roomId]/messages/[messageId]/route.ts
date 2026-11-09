import db from "@/lib/db";
import { startMemberReply, stopRoomWork } from "@/lib/buzz/agent-bridge.ts";
import { NextResponse } from "next/server";

import { apiErrorResponse, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { ApiError } from "@/lib/hermes/route-helpers.ts";
import {
  editMessage,
  getMessage,
  softDeleteMessage,
  toggleReaction,
} from "@/lib/buzz/instance.ts";
import { requireBuzzUser, requireRoomAndSelf, requireString, requireWritableRoom, roomPermissions, presentRoomMessage } from "@/lib/buzz/route-helpers.ts";
import { canDeleteMessage } from "@/lib/buzz/permissions.ts";

export const dynamic = "force-dynamic";

/** Edit your own message, or add and remove a reaction on anyone's. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ roomId: string; messageId: string }> },
) {
  try {
    const { userId, displayName } = await requireBuzzUser();
    const { roomId, messageId } = await params;
    const { room, self } = requireRoomAndSelf(userId, roomId, displayName);
    requireWritableRoom(room);

    const message = getMessage(Number(messageId));
    if (!message || message.roomId !== room.id) {
      throw new ApiError(404, "message_not_found", "Message not found.");
    }

    const body = await readJsonBody(request);

    if (typeof body.emoji === "string" && body.emoji.length > 0) {
      toggleReaction(message.id, self.id, body.emoji.slice(0, 16));
      return NextResponse.json({ ok: true });
    }

    if (typeof body.body === "string") {
      // An agent's message is a record of what it said. Only the person's own
      // lines can be rewritten.
      if (message.memberId !== self.id || message.authorKind !== "human" || message.deletedAt !== null) {
        throw new ApiError(403, "not_your_message", "You can only edit your own messages.");
      }
      editMessage(message.id, requireString(body.body, "body", 12000));
      return NextResponse.json({ message: presentRoomMessage(getMessage(message.id)!, userId) });
    }

    throw new ApiError(400, "invalid_request", "Nothing to change.");
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ roomId: string; messageId: string }> },
) {
  try {
    const { userId, displayName } = await requireBuzzUser();
    const { roomId, messageId } = await params;
    const { room, self } = requireRoomAndSelf(userId, roomId, displayName);

    const message = getMessage(Number(messageId));
    if (!message || message.roomId !== room.id) {
      throw new ApiError(404, "message_not_found", "Message not found.");
    }
    if (!canDeleteMessage(message, self.id, roomPermissions(userId, room).canManage)) {
      throw new ApiError(403, "cannot_delete_message", "You can only delete your own messages.");
    }
    softDeleteMessage(message.id);
    return NextResponse.json({ message: presentRoomMessage(getMessage(message.id)!, userId) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** Regenerate/stop uses the caller's account; only the requester can grant access. */
export async function POST(request: Request, { params }: { params: Promise<{ roomId: string; messageId: string }> }) {
  try {
    const { userId, displayName } = await requireBuzzUser();
    const { roomId, messageId } = await params;
    const { room } = requireRoomAndSelf(userId, roomId, displayName);
    requireWritableRoom(room);
    const message = getMessage(Number(messageId));
    if (!message || message.roomId !== room.id || message.authorKind !== "agent" || message.deletedAt) throw new ApiError(404, "message_not_found", "Agent response not found.");
    const body = await readJsonBody(request);
    if (!["regenerate", "approve", "stop"].includes(String(body.action))) throw new ApiError(400, "invalid_action", "Choose regenerate or stop.");
    const ownsRequest = message.metadata?.actingUserId === userId;
    if (!ownsRequest && (body.action === "approve" || !roomPermissions(userId, room).canManage)) throw new ApiError(403, "not_your_run", "Only the requester or a room manager can change this response.");
    if (body.action === "stop") {
      if (typeof message.metadata?.conversationId === "number") await stopRoomWork(room.id, message.metadata.conversationId);
      db.prepare("UPDATE buzz_room_messages SET status = 'aborted', body = CASE WHEN body = '' THEN 'The agent was stopped.' ELSE body END WHERE id = ?").run(message.id);
      return NextResponse.json({ message: presentRoomMessage(getMessage(message.id)!, userId) });
    }
    const trigger = getMessage(Number(message.metadata?.respondingTo));
    if (!trigger || trigger.deletedAt || trigger.roomId !== room.id || !message.memberId) throw new ApiError(409, "trigger_missing", "The original message or agent is no longer in this room.");
    const pending = message.metadata?.pendingPermissions;
    const confirmedPermissionIds = body.action === "approve" && Array.isArray(pending)
      ? pending.flatMap(item => item && typeof item === "object" && typeof item.id === "string" ? [item.id] : []) : undefined;
    if (body.action === "approve" && !confirmedPermissionIds?.length) throw new ApiError(409, "permission_expired", "Regenerate this response to request permission again.");
    const claimed = db.prepare("UPDATE buzz_room_messages SET status = 'pending' WHERE id = ? AND status IN ('complete','failed','aborted')").run(message.id);
    if (!claimed.changes) throw new ApiError(409, "run_busy", "This agent is already responding.");
    try {
      const result = await startMemberReply({ room, memberId: message.memberId, trigger, clientMessageId: message.clientMessageId, actingUserId: userId, request, replaceMessageId: message.id, confirmedPermissionIds });
      return NextResponse.json({ message: result.message });
    } catch (error) {
      db.prepare("UPDATE buzz_room_messages SET status = 'failed' WHERE id = ?").run(message.id);
      throw error;
    }
  } catch (error) { return apiErrorResponse(error); }
}
