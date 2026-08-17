import { NextResponse } from "next/server";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";
import { cancelInvite, respondToInvite } from "@/lib/organizations/store";

export const dynamic = "force-dynamic";

/** Accept or decline an invite addressed to the caller. */
export async function PATCH(request: Request) {
  try {
    const userId = await requireUserId();
    const body = (await request.json().catch(() => ({}))) as {
      inviteId?: unknown;
      accept?: unknown;
    };
    respondToInvite(Number(body.inviteId), userId, body.accept === true);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

/** Withdraw an invite the caller's organization sent. */
export async function DELETE(request: Request) {
  try {
    const userId = await requireUserId();
    const inviteId = Number(new URL(request.url).searchParams.get("inviteId"));
    cancelInvite(inviteId, userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
