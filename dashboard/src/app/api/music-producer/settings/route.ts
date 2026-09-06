import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { saveAceStepSettings } from "@/lib/acestep/config.ts";
import { musicRouteError } from "@/lib/music-producer/route-error.ts";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    saveAceStepSettings(userId, await readJsonBody(request, 8192));
    return NextResponse.json({ ok: true });
  }
  catch (error) {
    return musicRouteError(error);
  }
}
