import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/hermes/route-helpers.ts";
import { searchAccounts } from "@/lib/organizations/store.ts";
import { listMembers } from "@/lib/buzz/instance.ts";
import { requireBuzzUser, requireRoom } from "@/lib/buzz/route-helpers.ts";
import { buzzBridge } from "@/lib/crumbs/service.ts";

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
    const room = roomPublicId ? requireRoom(userId, roomPublicId) : null;
    const seated = room
      ? listMembers(room.id)
          .map((member) => member.userId)
          .filter((id): id is number => id !== null)
      : [];

    // A room of an organization on Crumbs is joined by Crumbs account: members
    // are on other machines, where local accounts do not exist. Those people
    // carry `did`, and adding one sends it instead of a local account id.
    const remote = room ? await buzzBridge.findPeople(userId, room.id, query).catch(() => []) : [];
    return NextResponse.json({
      query: query.trim(),
      people: [
        ...searchAccounts(query, { excludeUserIds: seated, limit: 20 }),
        ...remote.map((person) => ({
          userId: 0,
          did: person.did,
          username: person.displayName ? `${person.displayName} (@${person.handle})` : `@${person.handle}`,
        })),
      ],
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
