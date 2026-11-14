import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { blenderConnectionStatus, updateBlenderConnection } from "@/lib/hermes/blender-connection.ts";
import { apiErrorResponse, readJsonBody, requireEnabled } from "@/lib/hermes/route-helpers.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const userId = await requireUserId();
    requireEnabled();
    return NextResponse.json(blenderConnectionStatus(userId));
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    return NextResponse.json(await updateBlenderConnection(userId, await readJsonBody(request, 4096)));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
