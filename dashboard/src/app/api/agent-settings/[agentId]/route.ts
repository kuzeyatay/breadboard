import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { findConfigurableAgent } from "@/lib/agent-settings/catalog.ts";
import {
  readAgentSettings,
  resetAgentSettings,
  writeAgentSettings,
  type StoredAgentSettings,
} from "@/lib/agent-settings/store.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function present(settings: StoredAgentSettings) {
  return NextResponse.json({ ok: true, settings });
}

function failure(error: unknown) {
  if (error instanceof SyntaxError) {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  if (error instanceof RouteError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  }
  return NextResponse.json({ ok: false, error: "agent_settings_failed" }, { status: 500 });
}

async function resolveAgent(params: Promise<{ agentId: string }>) {
  const { agentId } = await params;
  const agent = findConfigurableAgent(agentId);
  if (!agent) throw new RouteError(404, "unknown_agent");
  return agent;
}

export async function GET(_request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const userId = await requireUserId();
    return present(readAgentSettings(userId, await resolveAgent(params)));
  } catch (error) {
    return failure(error);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const userId = await requireUserId();
    const agent = await resolveAgent(params);
    const text = await request.text();
    if (text.length > 64 * 1024) {
      return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
    }
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    // Every value is normalized against the catalog before it is stored, so a
    // request that invents fields or sends nonsense saves the defaults for them
    // rather than being rejected.
    return present(writeAgentSettings(userId, agent, body.values));
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ agentId: string }> },
) {
  try {
    const userId = await requireUserId();
    return present(resetAgentSettings(userId, await resolveAgent(params)));
  } catch (error) {
    return failure(error);
  }
}
