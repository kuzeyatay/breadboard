import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { CONFIGURABLE_AGENTS, describeAgentSettings } from "@/lib/agent-settings/catalog.ts";
import { readAgentSettings } from "@/lib/agent-settings/store.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Every configurable agent with what this user has set, for the settings index. */
export async function GET() {
  try {
    const userId = await requireUserId();
    const agents = CONFIGURABLE_AGENTS.map((agent) => {
      const stored = readAgentSettings(userId, agent);
      return {
        id: agent.id,
        name: agent.name,
        command: agent.command,
        summary: agent.summary,
        fieldCount: agent.fields.length,
        configured: stored.configured,
        updatedAt: stored.updatedAt,
        summaryOfValues: describeAgentSettings(agent, stored.values),
      };
    });
    return NextResponse.json({ ok: true, agents });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "agent_settings_failed" }, { status: 500 });
  }
}
