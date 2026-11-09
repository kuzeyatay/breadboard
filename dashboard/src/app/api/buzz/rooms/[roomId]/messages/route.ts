import { NextResponse } from "next/server";

import { ApiError, apiErrorResponse, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import {
  readRoomSpine,
  resolveResponders,
  startMemberReply,
} from "@/lib/buzz/agent-bridge.ts";
import {
  listMembers,
  markRoomRead,
  getMessage,
  reactionsForRoom,
} from "@/lib/buzz/instance.ts";
import {
  requireBuzzUser,
  requireRoomAndSelf,
  requireString,
  postHumanMessage,
  roomPermissions,
  presentRoomMessage,
} from "@/lib/buzz/route-helpers.ts";

export const dynamic = "force-dynamic";

/**
 * The room's spine, its members, and its reactions in one response.
 *
 * The client polls this while anything is still being written, so it is
 * deliberately one round trip rather than three.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  try {
    const { userId, displayName } = await requireBuzzUser();
    const { roomId } = await params;
    const { room, self } = requireRoomAndSelf(userId, roomId, displayName);

    // Reconciles any in-flight agent answer before reading.
    const before = new URL(request.url).searchParams.get("before");
    const beforeId = before === null ? undefined : Number(before);
    if (beforeId !== undefined && (!Number.isSafeInteger(beforeId) || beforeId < 1)) {
      throw new ApiError(400, "invalid_cursor", "Invalid message cursor.");
    }
    const page = await readRoomSpine(room.id, 51, beforeId);
    const hasOlder = page.length > 50;
    const messages = hasOlder ? page.slice(1) : page;
    const reactions = reactionsForRoom(room.id, self.id);

    return NextResponse.json({
      room: {
        publicId: room.publicId,
        slug: room.slug,
        name: room.name,
        topic: room.topic,
        purpose: room.purpose,
        kind: room.kind,
        visibility: room.visibility,
      },
      selfMemberId: self.id,
      permissions: roomPermissions(userId, room),
      hasOlder,
      nextCursor: hasOlder ? messages[0]?.id ?? null : null,
      members: listMembers(room.id),
      messages: messages.map((message) => ({
        ...presentRoomMessage(message, userId),
        reactions: reactions.get(message.id) ?? [],
      })),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/**
 * Post a message and start whichever members it wakes.
 *
 * The replies are started here rather than by the browser so that closing the
 * tab mid-send cannot leave a message nobody ever answers.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  try {
    const { userId, displayName } = await requireBuzzUser();
    const { roomId } = await params;
    const { room, self, members } = requireRoomAndSelf(userId, roomId, displayName);
    const body = await readJsonBody(request);

    const text = requireString(body.body, "body", 12000);
    const clientMessageId = requireString(body.clientMessageId, "clientMessageId", 128);
    if (body.parentId != null) throw new ApiError(400, "use_thread", "Post replies through their thread.");
    const message = postHumanMessage(room, self, text, clientMessageId);
    markRoomRead(room.id, userId, message.id);

    const responders = resolveResponders(members, text);
    const started = [];
    for (const responder of responders) {
      const result = await startMemberReply({
        room,
        memberId: responder.id,
        trigger: message,
        clientMessageId: `${clientMessageId}:${responder.handle}`,
        actingUserId: userId,
        request,
      });
      started.push({
        memberId: responder.id,
        handle: responder.handle,
        messageId: result.message.id,
        accepted: result.accepted,
        reason: result.reason ?? null,
      });
    }

    return NextResponse.json({ message, started }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** Only the visible room advances its read marker, never a background poll. */
export async function PATCH(request: Request, { params }: { params: Promise<{ roomId: string }> }) {
  try {
    const { userId, displayName } = await requireBuzzUser();
    const { roomId } = await params;
    const { room } = requireRoomAndSelf(userId, roomId, displayName);
    const body = await readJsonBody(request);
    const message = typeof body.readThrough === "number" ? getMessage(body.readThrough) : null;
    if (!message || message.roomId !== room.id) throw new ApiError(400, "invalid_read_marker", "Message not found in this room.");
    markRoomRead(room.id, userId, message.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
