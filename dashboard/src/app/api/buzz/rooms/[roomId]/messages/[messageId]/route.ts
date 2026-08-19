import { NextResponse } from "next/server";

import { apiErrorResponse, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { ApiError } from "@/lib/hermes/route-helpers.ts";
import {
  editMessage,
  getMessage,
  softDeleteMessage,
  toggleReaction,
} from "@/lib/buzz/instance.ts";
import { requireBuzzUser, requireRoomAndSelf } from "@/lib/buzz/route-helpers.ts";

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
      if (message.memberId !== self.id) {
        throw new ApiError(403, "not_your_message", "You can only edit your own messages.");
      }
      editMessage(message.id, body.body.slice(0, 12000));
      return NextResponse.json({ message: getMessage(message.id) });
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
    const { room } = requireRoomAndSelf(userId, roomId, displayName);

    const message = getMessage(Number(messageId));
    if (!message || message.roomId !== room.id) {
      throw new ApiError(404, "message_not_found", "Message not found.");
    }
    softDeleteMessage(message.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
