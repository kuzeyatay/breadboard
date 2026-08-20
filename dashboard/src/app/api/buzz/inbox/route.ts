import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/hermes/route-helpers.ts";
import { listAgentSeats, listUnreadMessages } from "@/lib/buzz/instance.ts";
import { requireBuzzUser } from "@/lib/buzz/route-helpers.ts";

export const dynamic = "force-dynamic";

/**
 * The two rail views that read across rooms rather than inside one: what is
 * waiting, and which agents are seated where.
 *
 * They travel together because both are read the moment the rail opens either
 * of them, and both are small — one request keeps the two views from
 * disagreeing about a room that changed between them.
 */
export async function GET() {
  try {
    const { userId } = await requireBuzzUser();
    return NextResponse.json({
      unread: listUnreadMessages(userId, 60),
      agents: listAgentSeats(userId),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
