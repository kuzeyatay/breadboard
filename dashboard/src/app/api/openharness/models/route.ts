import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { getAgentRuntime } from "@/lib/agent-runtime/runtime.ts";
import { apiErrorResponse, requireEnabled } from "@/lib/openharness/route-helpers.ts";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireUserId();
    requireEnabled();
    const models = await getAgentRuntime().listModels();
    return NextResponse.json({ models });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
