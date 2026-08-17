import { NextResponse } from "next/server";

import { readPersonProfile } from "@/lib/profile/person-profile.ts";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

/**
 * What the person popup reads. The static siblings of this segment
 * (navbar-shortcuts, device-location) still win the match, so no handle can
 * shadow them.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ username: string }> },
) {
  try {
    const viewerId = await requireUserId();
    const { username } = await params;
    const profile = readPersonProfile(viewerId, decodeURIComponent(username));
    if (!profile) {
      return NextResponse.json({ error: "There is no account by that name." }, { status: 404 });
    }
    return NextResponse.json({ profile });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
