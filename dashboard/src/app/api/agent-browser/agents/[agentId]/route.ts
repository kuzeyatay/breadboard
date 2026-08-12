import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import * as service from "@/lib/agent-browser/service.ts";
import * as store from "@/lib/agent-browser/store.ts";
import { applyConfigurationPatch } from "@/lib/agent-browser/config.ts";
import { agentBrowserErrorResponse, readBody } from "@/lib/agent-browser/route-helpers.ts";
import { AgentBrowserServiceError } from "@/lib/agent-browser/service.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const userId = await requireUserId();
    const { agentId } = await params;
    const agent = service.requireAgent(userId, agentId);
    return NextResponse.json({ ok: true, agent: store.presentAgent(agent) });
  } catch (error) {
    return agentBrowserErrorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const userId = await requireUserId();
    const { agentId } = await params;
    const agent = service.requireAgent(userId, agentId);
    const body = await readBody(request);

    const patch: Parameters<typeof store.updateAgent>[2] = {};
    if (typeof body.name === "string") patch.name = body.name;
    if (typeof body.description === "string") patch.description = body.description;
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    if (body.configuration !== undefined) {
      const current = store.presentAgent(agent).configuration;
      const validated = applyConfigurationPatch(current, body.configuration);
      if (!validated.ok || !validated.value) {
        throw new AgentBrowserServiceError(400, "invalid_configuration");
      }
      patch.configuration = validated.value;
    }
    const updated = service.updateAgentConfig(userId, agentId, patch);
    return NextResponse.json({ ok: true, agent: updated });
  } catch (error) {
    return agentBrowserErrorResponse(error);
  }
}
