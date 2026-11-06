import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { googleFlowConnectionStatus, updateGoogleFlowConnection } from "@/lib/hermes/google-flow-connection.ts";
import { apiErrorResponse, readJsonBody, requireEnabled } from "@/lib/hermes/route-helpers.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const userId = await requireUserId();
    requireEnabled();
    return NextResponse.json(googleFlowConnectionStatus(userId));
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    return NextResponse.json(await updateGoogleFlowConnection(userId, await readJsonBody(request, 4096)));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
