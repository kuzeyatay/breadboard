import { NextResponse } from "next/server";

import { apiErrorResponse, readJsonBody, ApiError } from "@/lib/hermes/route-helpers.ts";
import { listOrganizations, memberRole } from "@/lib/organizations/store.ts";
import {
  createRoom,
  listMembers,
  listRoomsForUser,
  unreadCounts,
} from "@/lib/buzz/instance.ts";
import { requireBuzzUser, requireString } from "@/lib/buzz/route-helpers.ts";

export const dynamic = "force-dynamic";

/**
 * The community rail and the room rail in one response.
 *
 * A Buzz community is a Breadboard organization, so the rail is simply the
 * organizations this account belongs to, and every room names the one it lives
 * in. Rooms from every community come back together rather than one community
 * at a time, because the rail has to show unread badges for the communities the
 * reader is not currently looking at.
 */
export async function GET(request: Request) {
  try {
    const { userId } = await requireBuzzUser();
    const includeArchived =
      new URL(request.url).searchParams.get("archived") === "1";

    const organizations = listOrganizations(userId).map((organization) => ({
      id: organization.id,
      name: organization.name,
      role: organization.role,
      members: organization.members.map((member) => ({
        userId: member.userId,
        username: member.username,
      })),
    }));

    const unread = unreadCounts(userId);
    const rooms = listRoomsForUser(userId, includeArchived).map((room) => {
      const members = listMembers(room.id);
      return {
        publicId: room.publicId,
        organizationId: room.organizationId,
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
        peopleHandles: members
          .filter((member) => member.kind === "human")
          .map((member) => member.handle),
      };
    });

    return NextResponse.json({ organizations, rooms });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** Open a room inside one of the caller's organizations. */
export async function POST(request: Request) {
  try {
    const { userId } = await requireBuzzUser();
    const body = await readJsonBody(request);
    const name = requireString(body.name, "name", 80);

    const organizationId = Number(body.organizationId);
    if (!Number.isInteger(organizationId) || organizationId <= 0) {
      throw new ApiError(400, "invalid_request", "A community is required.");
    }
    // Membership is the permission. Answering 404 rather than 403 keeps the
    // organization id space unprobeable, matching how rooms answer.
    if (!memberRole(organizationId, userId)) {
      throw new ApiError(404, "organization_not_found", "Community not found.");
    }

    const room = createRoom(organizationId, userId, {
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
