import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/hermes/route-helpers.ts";
import { listReceivedInvites } from "@/lib/organizations/store.ts";
import { listAgentSeats, listUnreadMessages } from "@/lib/buzz/instance.ts";
import { requireBuzzUser } from "@/lib/buzz/route-helpers.ts";

export const dynamic = "force-dynamic";

/**
 * The rail views that read across rooms rather than inside one: what is
 * waiting, which agents are seated where, and which communities have asked
 * the reader to join them.
 *
 * They travel together because they are read the moment the rail opens any of
 * them, and all are small — one request keeps the views from disagreeing about
 * a room that changed between them.
 *
 * Invitations ride along with the inbox rather than living on their own screen
 * because this is the only place a Buzz reader can act on one: a community
 * invitation is now what "add someone to a room" produces, so the invitee has
 * to meet it somewhere they already look.
 */
export async function GET() {
  try {
    const { userId } = await requireBuzzUser();
    return NextResponse.json({
      unread: listUnreadMessages(userId, 60),
      agents: listAgentSeats(userId),
      invites: listReceivedInvites(userId),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
