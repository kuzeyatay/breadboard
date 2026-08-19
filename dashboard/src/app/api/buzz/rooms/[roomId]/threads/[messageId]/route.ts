import { NextResponse } from "next/server";

import { apiErrorResponse, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import {
  readRoomThread,
  resolveResponders,
  startMemberReply,
} from "@/lib/buzz/agent-bridge.ts";
import { getMessage, postMessage } from "@/lib/buzz/instance.ts";
import {
  requireBuzzUser,
  requireRoomAndSelf,
  requireString,
} from "@/lib/buzz/route-helpers.ts";
import { ApiError } from "@/lib/hermes/route-helpers.ts";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ roomId: string; messageId: string }> },
) {
  try {
    const { userId, displayName } = await requireBuzzUser();
    const { roomId, messageId } = await params;
    const { room } = requireRoomAndSelf(userId, roomId, displayName);

    const parentId = Number(messageId);
    const root = getMessage(parentId);
    if (!root || root.roomId !== room.id) {
      throw new ApiError(404, "message_not_found", "Message not found.");
    }
    return NextResponse.json({ root, replies: readRoomThread(room.id, parentId) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** Reply inside a thread. Same rules as the spine, scoped to one root. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ roomId: string; messageId: string }> },
) {
  try {
    const { userId, displayName } = await requireBuzzUser();
    const { roomId, messageId } = await params;
    const { room, self, members } = requireRoomAndSelf(userId, roomId, displayName);

    const parentId = Number(messageId);
    const root = getMessage(parentId);
    if (!root || root.roomId !== room.id) {
      throw new ApiError(404, "message_not_found", "Message not found.");
    }

    const body = await readJsonBody(request);
    const text = requireString(body.body, "body", 12000);
    const clientMessageId = requireString(body.clientMessageId, "clientMessageId", 128);

    const message = postMessage(room.id, {
      clientMessageId,
      memberId: self.id,
      authorKind: "human",
      authorName: self.displayName,
      authorHandle: self.handle,
      body: text,
      parentId,
    });

    const started = [];
    for (const responder of resolveResponders(members, text)) {
      const result = await startMemberReply({
        room,
        memberId: responder.id,
        trigger: message,
        clientMessageId: `${clientMessageId}:${responder.handle}`,
      });
      started.push({
        memberId: responder.id,
        handle: responder.handle,
        messageId: result.message.id,
        accepted: result.accepted,
      });
    }

    return NextResponse.json({ message, started }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
