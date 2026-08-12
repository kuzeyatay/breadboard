import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import * as service from "@/lib/deep-research/service.ts";
import { deepResearchErrorResponse } from "@/lib/deep-research/route-helpers.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    await requireUserId();
    const result = await service.health();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return deepResearchErrorResponse(error);
  }
}
