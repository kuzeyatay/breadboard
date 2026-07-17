import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { getOpenHarnessGateway } from "@/lib/openharness/gateway.ts";
import { apiErrorResponse, requireEnabled } from "@/lib/openharness/route-helpers.ts";

export const dynamic = "force-dynamic";

// Lists the agents OpenHarness exposes. The browser only ever sees agent names;
// it cannot select an arbitrary agent for a session — the surface determines the
// agent server-side. This endpoint is informational (e.g. for the terminal UI).
export async function GET() {
  try {
    await requireUserId();
    requireEnabled();
    const agents = await getOpenHarnessGateway().listAgents();
    return NextResponse.json({
      agents: agents.map((agent) => ({ name: agent.name, description: agent.description })),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
