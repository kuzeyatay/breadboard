import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { getOpenHarnessGateway } from "@/lib/openharness/gateway.ts";
import { apiErrorResponse, requireEnabled } from "@/lib/openharness/route-helpers.ts";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireUserId();
    requireEnabled();
    const models = await getOpenHarnessGateway().listModels();
    return NextResponse.json({ models });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
