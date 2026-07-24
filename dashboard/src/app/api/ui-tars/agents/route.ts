import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import * as service from "@/lib/ui-tars/service.ts";
import * as store from "@/lib/ui-tars/store.ts";
import { validateAgentConfiguration, defaultAgentConfiguration } from "@/lib/ui-tars/config.ts";
import { uiTarsErrorResponse, readBody } from "@/lib/ui-tars/route-helpers.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/ui-tars/agents — the Agents-page data (redacted; no secrets).
export async function GET() {
  try {
    const userId = await requireUserId();
    const page = await service.agentsPage(userId);
    return NextResponse.json({ ok: true, ...page });
  } catch (error) {
    return uiTarsErrorResponse(error);
  }
}

// POST /api/ui-tars/agents — create a runtime agent. Credential (if provided) is
// stored server-side only and never echoed back.
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await readBody(request);
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "UI-TARS Browser Operator";
    const validation = validateAgentConfiguration(body.configuration ?? defaultAgentConfiguration());
    if (!validation.ok || !validation.value) {
      return NextResponse.json({ ok: false, error: "invalid_configuration", details: validation.errors }, { status: 400 });
    }
    const agent = store.createAgent(userId, {
      name,
      description: typeof body.description === "string" ? body.description : "",
      configuration: validation.value,
    });
    if (typeof body.providerApiKey === "string" && body.providerApiKey) {
      service.updateSecret(userId, agent.id, body.providerApiKey);
    }
    return NextResponse.json({ ok: true, agent: store.presentAgent(agent) }, { status: 201 });
  } catch (error) {
    return uiTarsErrorResponse(error);
  }
}
