import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { aceStepStatus } from "@/lib/acestep/service.ts";
import { musicRouteError } from "@/lib/music-producer/route-error.ts";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET() {
  try {
    const userId = await requireUserId();
    return NextResponse.json({ ok: true, ...(await aceStepStatus(userId)) });
  }
  catch (error) {
    return musicRouteError(error);
  }
}
