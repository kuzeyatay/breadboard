import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { clearStoppedMusicGate } from "@/lib/music-producer/provider-recovery.ts";
import { musicRouteError } from "@/lib/music-producer/route-error.ts";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const userId = await requireUserId(), body = await readJsonBody(request, 1024);
    if (body.action !== "clearStoppedGate" || Object.keys(body).length !== 1)
      throw Error("Invalid provider recovery action.");
    await clearStoppedMusicGate(userId);
    return NextResponse.json({ ok: true });
  }
  catch (error) {
    return musicRouteError(error);
  }
}
