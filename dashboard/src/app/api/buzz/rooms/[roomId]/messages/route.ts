import { NextResponse } from "next/server";

import { apiErrorResponse, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import {
  readRoomSpine,
  resolveResponders,
  startMemberReply,
} from "@/lib/buzz/agent-bridge.ts";
import {
  listMembers,
  markRoomRead,
  postMessage,
  reactionsForRoom,
} from "@/lib/buzz/instance.ts";
import {
  requireBuzzUser,
  requireRoomAndSelf,
  requireString,
} from "@/lib/buzz/route-helpers.ts";

export const dynamic = "force-dynamic";

/**
 * The room's spine, its members, and its reactions in one response.
 *
 * The client polls this while anything is still being written, so it is
 * deliberately one round trip rather than three.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  try {
    const { userId, displayName } = await requireBuzzUser();
    const { roomId } = await params;
    const { room, self } = requireRoomAndSelf(userId, roomId, displayName);

    // Reconciles any in-flight agent answer before reading.
    const messages = readRoomSpine(room.id);
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
      members: listMembers(room.id),
      messages: messages.map((message) => ({
        ...message,
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
    const parentId =
      typeof body.parentId === "number" && Number.isInteger(body.parentId)
        ? body.parentId
        : null;

    const message = postMessage(room.id, {
      clientMessageId,
      memberId: self.id,
      authorKind: "human",
      authorName: self.displayName,
      authorHandle: self.handle,
      body: text,
      parentId,
    });
    markRoomRead(room.id, userId, message.id);

    const responders = resolveResponders(members, text);
    const started = [];
    for (const responder of responders) {
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
        reason: result.reason ?? null,
      });
    }

    return NextResponse.json({ message, started }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
