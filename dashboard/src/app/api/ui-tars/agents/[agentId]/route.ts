import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import * as service from "@/lib/ui-tars/service.ts";
import * as store from "@/lib/ui-tars/store.ts";
import { applyConfigurationPatch, validateAgentConfiguration } from "@/lib/ui-tars/config.ts";
import { uiTarsErrorResponse, readBody } from "@/lib/ui-tars/route-helpers.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const userId = await requireUserId();
    const { agentId } = await params;
    const agent = service.requireAgent(userId, agentId);
    return NextResponse.json({ ok: true, agent: store.presentAgent(agent) });
  } catch (error) {
    return uiTarsErrorResponse(error);
  }
}

// PATCH — update name/description/enabled/configuration and (write-only) the
// provider credential. Omitting providerApiKey preserves the stored secret;
// passing null removes it; a non-empty string replaces it. The stored value is
// never returned.
export async function PATCH(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const userId = await requireUserId();
    const { agentId } = await params;
    const current = service.requireAgent(userId, agentId);
    const body = await readBody(request);

    const patch: { name?: string; description?: string; enabled?: boolean; configuration?: ReturnType<typeof validateAgentConfiguration>["value"] } = {};
    if (typeof body.name === "string") patch.name = body.name;
    if (typeof body.description === "string") patch.description = body.description;
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;

    if (body.configuration !== undefined) {
      const currentConfig =
        validateAgentConfiguration(JSON.parse(current.configuration_json)).value ?? undefined;
      if (!currentConfig) {
        return NextResponse.json({ ok: false, error: "invalid_stored_configuration" }, { status: 500 });
      }
      const merged = applyConfigurationPatch(currentConfig, body.configuration);
      if (!merged.ok || !merged.value) {
        return NextResponse.json({ ok: false, error: "invalid_configuration", details: merged.errors }, { status: 400 });
      }
      patch.configuration = merged.value;
    }

    const updated = service.updateAgentConfig(userId, agentId, patch);

    // Credential handling is explicit and write-only.
    if ("providerApiKey" in body) {
      service.updateSecret(userId, agentId, body.providerApiKey as string | null);
    }
    // Re-read to reflect the (possibly changed) secretConfigured flag.
    const fresh = service.requireAgent(userId, agentId);
    return NextResponse.json({ ok: true, agent: store.presentAgent(fresh), _updatedName: updated.name });
  } catch (error) {
    return uiTarsErrorResponse(error);
  }
}
