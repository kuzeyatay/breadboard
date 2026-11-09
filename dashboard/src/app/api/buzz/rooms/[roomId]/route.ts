import { stopRoomWork } from "@/lib/buzz/agent-bridge.ts";
import { NextResponse } from "next/server";

import { apiErrorResponse, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { deleteRoom, setRoomArchived, updateRoom } from "@/lib/buzz/instance.ts";
import { requireBuzzUser, requireRoom, requireRoomManager, requireString } from "@/lib/buzz/route-helpers.ts";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  try {
    const { userId } = await requireBuzzUser();
    const { roomId } = await params;
    const room = requireRoom(userId, roomId);
    requireRoomManager(userId, room);
    const body = await readJsonBody(request);

    if (typeof body.archived === "boolean") {
      setRoomArchived(room.id, body.archived);
    }
    updateRoom(room.id, {
      ...(typeof body.name === "string" ? { name: requireString(body.name, "name", 80) } : {}),
      ...(typeof body.topic === "string" ? { topic: body.topic } : {}),
      ...(typeof body.purpose === "string" ? { purpose: body.purpose } : {}),
      ...(body.visibility === "public" || body.visibility === "private"
        ? { visibility: body.visibility }
        : {}),
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  try {
    const { userId } = await requireBuzzUser();
    const { roomId } = await params;
    const room = requireRoom(userId, roomId);
    requireRoomManager(userId, room);
    // Deleting a room takes its transcript and its members' private
    // conversations with it, by foreign key. That is the point: nothing about
    // a deleted room should survive in the chat history.
    await stopRoomWork(room.id);
    deleteRoom(room.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
