import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import * as service from "@/lib/agent-browser/service.ts";
import { agentBrowserErrorResponse } from "@/lib/agent-browser/route-helpers.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const userId = await requireUserId();
    const page = service.agentsPage(userId);
    return NextResponse.json({ ok: true, ...page });
  } catch (error) {
    return agentBrowserErrorResponse(error);
  }
}
