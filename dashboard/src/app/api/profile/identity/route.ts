import { NextResponse } from "next/server";

import { readUserIdentity, updateUserIdentity } from "@/lib/profile/identity-store.ts";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = await requireUserId();
    return NextResponse.json({ identity: readUserIdentity(userId) });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const userId = await requireUserId();
    // An unreadable body is an empty patch, which leaves the name as it was.
    // Clearing a name is done by sending it as "", never by sending nothing.
    const body = (await request.json().catch(() => ({}))) as unknown;
    return NextResponse.json({ identity: updateUserIdentity(userId, body) });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
