import { NextResponse } from "next/server";

import { apiErrorResponse, readJsonBody, ApiError } from "@/lib/hermes/route-helpers.ts";
import { loadAgencyAgentsCatalog } from "@/lib/hermes/agency-agents.ts";
import {
  getAccount,
  inviteAccount,
  listOrganizations,
  memberRole,
} from "@/lib/organizations/store.ts";
import { BREAD_NAME, isBreadSlug } from "@/lib/buzz/bread.ts";
import { addMember, ensureBreadMember, listMembers } from "@/lib/buzz/instance.ts";
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
 * the caller — an agent must already be in the roster, and a person must
 * already be in the organization or else be *invited* to it.
 *
 * That last case answers 202 rather than 201: nobody was seated, an invitation
 * was sent, and the seat follows if and when they accept it.
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
       * Someone from outside the community is invited to it, not enrolled in
       * it.
       *
       * This used to call `addOrganizationMember`, which put the account into
       * the organization outright — one person's click changed what another
       * person's account belongs to, with no say from them and no notice. A
       * community is shared state, so joining one is now the invitee's
       * decision: a pending row in `organization_invites`, answered from the
       * Buzz inbox.
       *
       * The seat therefore cannot be created yet. A room is readable through
       * organization membership, so seating someone who has not accepted would
       * put them in a room they cannot open. They are seated when they accept.
       */
      const account = colleague ?? getAccount(invitedId);
      if (!account) {
        throw new ApiError(404, "no_such_account", "That is not an account.");
      }
      if (!colleague) {
        // `inviteAccount` enforces this too, but it signals with an
        // `OrganizationError`, which `describeError` does not know and would
        // answer as an unexplained 500. Checking first turns "you cannot do
        // that" into a sentence the picker can show.
        const role = memberRole(room.organizationId, userId);
        if (role !== "owner" && role !== "admin") {
          throw new ApiError(
            403,
            "not_an_admin",
            `Only an admin of ${organization?.name ?? "this community"} can invite someone into it.`,
          );
        }
        inviteAccount(room.organizationId, userId, invitedId);
        return NextResponse.json(
          {
            invited: {
              userId: invitedId,
              username: account.username,
              community: organization?.name ?? "this community",
            },
          },
          { status: 202 },
        );
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

    // Bread is seated automatically, but it can be removed like any other
    // member — so it has to be addable again, and it is not in the catalog.
    if (isBreadSlug(slug)) {
      if (existing.some((member) => member.personaSlug === slug)) {
        throw new ApiError(409, "already_a_member", `${BREAD_NAME} is already in this room.`);
      }
      return NextResponse.json({ member: ensureBreadMember(room.id) }, { status: 201 });
    }

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
