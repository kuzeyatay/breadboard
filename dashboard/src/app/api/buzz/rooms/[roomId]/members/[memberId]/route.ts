import { NextResponse } from "next/server";

import { apiErrorResponse, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { ApiError } from "@/lib/hermes/route-helpers.ts";
import { getMember, removeMember, updateMember } from "@/lib/buzz/instance.ts";
import { requireBuzzUser, requireRoom } from "@/lib/buzz/route-helpers.ts";

export const dynamic = "force-dynamic";

function memberInRoom(memberId: number, roomDbId: number) {
  const member = getMember(memberId);
  if (!member || member.roomId !== roomDbId) {
    throw new ApiError(404, "member_not_found", "Member not found.");
  }
  return member;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ roomId: string; memberId: string }> },
) {
  try {
    const { userId } = await requireBuzzUser();
    const { roomId, memberId } = await params;
    const room = requireRoom(userId, roomId);
    const member = memberInRoom(Number(memberId), room.id);
    const body = await readJsonBody(request);

    updateMember(member.id, {
      ...(body.respondTo === "always" ||
      body.respondTo === "mention" ||
      body.respondTo === "never"
        ? { respondTo: body.respondTo }
        : {}),
      ...(typeof body.muted === "boolean" ? { muted: body.muted } : {}),
      ...(typeof body.model === "string" || body.model === null
        ? { model: body.model }
        : {}),
    });
    return NextResponse.json({ member: getMember(member.id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ roomId: string; memberId: string }> },
) {
  try {
    const { userId } = await requireBuzzUser();
    const { roomId, memberId } = await params;
    const room = requireRoom(userId, roomId);
    const member = memberInRoom(Number(memberId), room.id);
    if (member.kind === "human") {
      throw new ApiError(400, "cannot_leave", "You cannot remove yourself from your own room.");
    }
    removeMember(member.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
