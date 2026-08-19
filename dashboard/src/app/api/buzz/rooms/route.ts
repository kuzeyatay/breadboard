import { NextResponse } from "next/server";

import { apiErrorResponse, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { createRoom, listMembers, listRooms, unreadCounts } from "@/lib/buzz/instance.ts";
import { requireBuzzUser, requireString } from "@/lib/buzz/route-helpers.ts";

export const dynamic = "force-dynamic";

/** Every room this account has, with the badge counts the rail draws. */
export async function GET(request: Request) {
  try {
    const { userId } = await requireBuzzUser();
    const includeArchived =
      new URL(request.url).searchParams.get("archived") === "1";

    const unread = unreadCounts(userId);
    const rooms = listRooms(userId, includeArchived).map((room) => {
      const members = listMembers(room.id);
      return {
        publicId: room.publicId,
        slug: room.slug,
        name: room.name,
        topic: room.topic,
        kind: room.kind,
        visibility: room.visibility,
        archived: room.archivedAt !== null,
        unread: unread.get(room.id) ?? 0,
        memberCount: members.length,
        agentHandles: members
          .filter((member) => member.kind === "agent")
          .map((member) => member.handle),
      };
    });
    return NextResponse.json({ rooms });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { userId } = await requireBuzzUser();
    const body = await readJsonBody(request);
    const name = requireString(body.name, "name", 80);

    const room = createRoom(userId, {
      name,
      topic: typeof body.topic === "string" ? body.topic : "",
      purpose: typeof body.purpose === "string" ? body.purpose : "",
      kind: body.kind === "dm" ? "dm" : "channel",
      visibility: body.visibility === "private" ? "private" : "public",
    });
    return NextResponse.json({ room }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
