import { NextResponse } from "next/server";

import { apiErrorResponse, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { ApiError } from "@/lib/hermes/route-helpers.ts";
import { loadAgencyAgentsCatalog } from "@/lib/hermes/agency-agents.ts";
import { addMember, listMembers } from "@/lib/buzz/instance.ts";
import { requireBuzzUser, requireRoom, requireString } from "@/lib/buzz/route-helpers.ts";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  try {
    const { userId } = await requireBuzzUser();
    const { roomId } = await params;
    const room = requireRoom(userId, roomId);
    return NextResponse.json({ members: listMembers(room.id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/**
 * Bring an agent persona into the room.
 *
 * The persona has to exist in the roster: a member is a real agent with a
 * brief, not a name someone typed.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  try {
    const { userId } = await requireBuzzUser();
    const { roomId } = await params;
    const room = requireRoom(userId, roomId);
    const body = await readJsonBody(request);
    const slug = requireString(body.personaSlug, "personaSlug", 120);

    const catalog = loadAgencyAgentsCatalog();
    const persona = catalog.agents.find((agent) => agent.slug === slug);
    if (!persona) {
      throw new ApiError(404, "persona_not_found", "That specialist is not in the roster.");
    }
    if (listMembers(room.id).some((member) => member.personaSlug === slug)) {
      throw new ApiError(409, "already_a_member", `${persona.name} is already in this room.`);
    }

    const member = addMember(room.id, {
      kind: "agent",
      personaSlug: persona.slug,
      displayName: persona.name,
      handle: persona.slug,
      accent: persona.color ?? persona.divisionColor,
      respondTo:
        body.respondTo === "always" || body.respondTo === "never"
          ? body.respondTo
          : "mention",
    });
    return NextResponse.json({ member }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
