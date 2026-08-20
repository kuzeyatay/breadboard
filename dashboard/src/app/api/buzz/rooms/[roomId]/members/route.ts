import { NextResponse } from "next/server";

import { apiErrorResponse, readJsonBody, ApiError } from "@/lib/hermes/route-helpers.ts";
import { loadAgencyAgentsCatalog } from "@/lib/hermes/agency-agents.ts";
import {
  addOrganizationMember,
  getAccount,
  listOrganizations,
  memberRole,
} from "@/lib/organizations/store.ts";
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
 * Bring someone into the room — a colleague from the owning organization, or
 * an agent persona from the roster.
 *
 * Both go through one endpoint because a room does not distinguish them: they
 * become peers in the same member list, addressed the same way. The only
 * difference is where the identity is checked, and neither can be invented by
 * the caller — a person must already be in the organization, an agent must
 * already be in the roster.
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
    const existing = listMembers(room.id);

    // ── a colleague ────────────────────────────────────────────────────────
    if (body.userId !== undefined) {
      const invitedId = Number(body.userId);
      if (!Number.isInteger(invitedId) || invitedId <= 0) {
        throw new ApiError(400, "invalid_request", "That is not an account.");
      }
      if (existing.some((member) => member.userId === invitedId)) {
        throw new ApiError(409, "already_a_member", "They are already here.");
      }

      const organization = listOrganizations(userId).find(
        (candidate) => candidate.id === room.organizationId,
      );
      const colleague = organization?.members.find(
        (member) => member.userId === invitedId,
      );

      /*
       * Someone from outside the community joins it by being added to one of
       * its rooms.
       *
       * A room's transcript is readable through organization membership, so a
       * room member who is not an organization member would be added to a room
       * they cannot open. Bringing them in is therefore part of adding them —
       * and since the invite screen was removed from the profile, it is the
       * only path there is. `addOrganizationMember` checks that the caller is
       * an admin of the organization, so this widens who can be added, never
       * who can do the adding.
       */
      const account = colleague ?? getAccount(invitedId);
      if (!account) {
        throw new ApiError(404, "no_such_account", "That is not an account.");
      }
      if (!colleague) {
        // `addOrganizationMember` enforces this too, but it signals with an
        // `OrganizationError`, which `describeError` does not know and would
        // answer as an unexplained 500. Checking first turns "you cannot do
        // that" into a sentence the picker can show.
        const role = memberRole(room.organizationId, userId);
        if (role !== "owner" && role !== "admin") {
          throw new ApiError(
            403,
            "not_an_admin",
            `Only an admin of ${organization?.name ?? "this community"} can bring someone new into it.`,
          );
        }
        addOrganizationMember(room.organizationId, userId, invitedId);
      }

      const member = addMember(room.id, {
        kind: "human",
        userId: invitedId,
        displayName: account.username,
        handle: account.username,
        accent: "#04a5e5",
      });
      return NextResponse.json({ member }, { status: 201 });
    }

    // ── an agent ───────────────────────────────────────────────────────────
    const slug = requireString(body.personaSlug, "personaSlug", 120);
    const catalog = loadAgencyAgentsCatalog();
    const persona = catalog.agents.find((agent) => agent.slug === slug);
    if (!persona) {
      throw new ApiError(404, "persona_not_found", "That specialist is not in the roster.");
    }
    if (existing.some((member) => member.personaSlug === slug)) {
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
