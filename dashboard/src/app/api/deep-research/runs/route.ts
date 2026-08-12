import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import * as service from "@/lib/deep-research/service.ts";
import { deepResearchErrorResponse, readBody } from "@/lib/deep-research/route-helpers.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await readBody(request);
    const run = await service.startRun(userId, body);
    return NextResponse.json({ ok: true, run });
  } catch (error) {
    return deepResearchErrorResponse(error);
  }
}
