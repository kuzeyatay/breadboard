import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { getOpenHarnessGateway } from "@/lib/openharness/gateway.ts";
import { readOpenHarnessConfig } from "@/lib/openharness/config.ts";
import { apiErrorResponse } from "@/lib/openharness/route-helpers.ts";

export const dynamic = "force-dynamic";

// Combined, secret-free diagnostic for the complete interactive runtime.
export async function GET() {
  try {
    await requireUserId();
    const config = readOpenHarnessConfig();
    const chatmock = await chatmockStatus();
    if (!config.enabled) {
      return NextResponse.json(statusPayload(config.mode, chatmock, "disabled"));
    }

    try {
      const gateway = getOpenHarnessGateway();
      const [health, agents, models] = await Promise.all([
        gateway.health(),
        gateway.listAgents(),
        gateway.listModels(),
      ]);
      const available = new Set(agents.map((agent) => agent.name));
      const providerHealthy = models.some((model) => model.providerId === "chatmock");
      return NextResponse.json({
        enabled: true,
        healthy: health.healthy && providerHealthy,
        version: health.version,
        chatmock,
        openharness: health.healthy ? "healthy" : "unhealthy",
        provider: providerHealthy ? "chatmock" : "unavailable",
        dashboardMode: config.mode,
        terminalAgent: available.has(config.agents.terminal) ? "available" : "unavailable",
        gardenAgent: available.has(config.agents.garden) ? "available" : "unavailable",
        quartzAgent: available.has(config.agents.quartz) ? "available" : "unavailable",
        capabilityScout: available.has(config.agents.capabilityScout) ? "available" : "unavailable",
      });
    } catch {
      return NextResponse.json(statusPayload(config.mode, chatmock, "unhealthy"));
    }
  } catch (error) {
    return apiErrorResponse(error);
  }
}

function statusPayload(
  mode: "required" | "preferred" | "legacy",
  chatmock: "healthy" | "unhealthy",
  openharness: "disabled" | "unhealthy",
) {
  return {
    enabled: mode !== "legacy",
    healthy: false,
    chatmock,
    openharness,
    provider: "unavailable",
    dashboardMode: mode,
    terminalAgent: "unavailable",
    gardenAgent: "unavailable",
    quartzAgent: "unavailable",
    capabilityScout: "unavailable",
  };
}

async function chatmockStatus(): Promise<"healthy" | "unhealthy"> {
  const configured = process.env.CHATMOCK_BASE_URL ?? process.env.OPENAI_BASE_URL ?? "http://127.0.0.1:8765/v1";
  const healthUrl = `${configured.replace(/\/+$/, "").replace(/\/v1$/, "")}/health`;
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(2_000) });
    return response.ok ? "healthy" : "unhealthy";
  } catch {
    return "unhealthy";
  }
}
