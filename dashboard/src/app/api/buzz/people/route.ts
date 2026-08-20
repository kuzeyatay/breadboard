import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/hermes/route-helpers.ts";
import { searchAccounts } from "@/lib/organizations/store.ts";
import { listMembers } from "@/lib/buzz/instance.ts";
import { requireBuzzUser, requireRoom } from "@/lib/buzz/route-helpers.ts";

export const dynamic = "force-dynamic";

/**
 * People who could be brought into a room.
 *
 * Real accounts, searched against the account table — not the room's community.
 * Adding someone to a room is how they join the community now, so a picker
 * that could only offer people already in it would never be able to add
 * anybody. Whoever is already in the room is filtered out here rather than in
 * the browser, so the list never offers a click that would answer 409.
 */
export async function GET(request: Request) {
  try {
    const { userId } = await requireBuzzUser();
    const url = new URL(request.url);
    const query = url.searchParams.get("q") ?? "";
    const roomPublicId = url.searchParams.get("roomId");

    // Membership of the room is what makes its roster readable, so the room is
    // resolved through the same guard every other Buzz route uses.
    const seated = roomPublicId
      ? listMembers(requireRoom(userId, roomPublicId).id)
          .map((member) => member.userId)
          .filter((id): id is number => id !== null)
      : [];

    return NextResponse.json({
      query: query.trim(),
      people: searchAccounts(query, { excludeUserIds: seated, limit: 20 }),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
