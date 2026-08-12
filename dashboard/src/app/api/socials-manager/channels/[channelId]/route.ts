import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { getSocialsManagerStore } from "@/lib/socials-manager/instance.ts";
import { SocialsManagerError } from "@/lib/socials-manager/store.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ channelId: string }> },
) {
  try {
    const userId = await requireUserId();
    const channelId = Number((await params).channelId);
    if (!Number.isInteger(channelId) || channelId <= 0) {
      return NextResponse.json({ ok: false, error: "invalid_channel" }, { status: 400 });
    }
    getSocialsManagerStore().deleteChannel(userId, channelId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    if (error instanceof SocialsManagerError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
