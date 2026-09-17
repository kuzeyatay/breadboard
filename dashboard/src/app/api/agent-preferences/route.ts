import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { agentPreferenceCatalog } from "@/lib/agent-preferences/catalog";
import { readAgentPreferences, writeAgentPreferences } from "@/lib/agent-preferences/store";
import { AgentPreferencesError, validateAgentPreferences } from "@/lib/agent-preferences/preferences";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function failure(error: unknown) {
  const status = error instanceof RouteError ? error.status : error instanceof AgentPreferencesError || error instanceof SyntaxError ? 400 : 500;
  return NextResponse.json({ error: status < 500 ? (error as Error).message : "Agent preferences could not be saved or loaded. Please try again." }, { status });
}

export async function GET() {
  try {
    const userId = await requireUserId();
    return NextResponse.json({ settings: readAgentPreferences(userId), ...agentPreferenceCatalog() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}

export async function PUT(request: Request) {
  try {
    const userId = await requireUserId();
    const settings = validateAgentPreferences(await request.json());
    const known = new Set(agentPreferenceCatalog().agents.map((agent) => agent.command));
    // Preserve selections for temporarily missing personas, but reject new unknown commands.
    const previous = readAgentPreferences(userId);
    for (const task of previous.tasks) for (const command of task.agents) known.add(command);
    if (settings.tasks.some((task) => task.agents.some((command) => !known.has(command)))) {
      throw new AgentPreferencesError("An agent is no longer in the catalog. Reload the editor and choose an available agent.");
    }
    return NextResponse.json({ settings: writeAgentPreferences(userId, settings) });
  } catch (error) { return failure(error); }
}
