import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { getAgentRuntime } from "@/lib/agent-runtime/runtime.ts";
import { readHermesConfig } from "@/lib/hermes/config.ts";
import { apiErrorResponse } from "@/lib/hermes/route-helpers.ts";

export const dynamic = "force-dynamic";

// Combined, secret-free diagnostic for the complete interactive runtime.
export async function GET() {
  try {
    await requireUserId();
    const config = readHermesConfig();
    const chatmock = await chatmockStatus();
    const runtime = getAgentRuntime();
    if (!runtime.enabled) {
      return NextResponse.json(statusPayload(config.mode, chatmock, "disabled"));
    }

    try {
      const [health, agents, models] = await Promise.all([
        runtime.health(),
        runtime.listAgents(),
        runtime.listModels(),
      ]);
      const available = new Set(agents.map((agent) => agent.name));
      const providerHealthy = models.some((model) => model.providerId === "chatmock");
      return NextResponse.json({
        enabled: true,
        healthy: health.healthy && providerHealthy,
        version: health.version,
        chatmock,
        hermes: health.healthy ? "healthy" : "unhealthy",
        runtime: runtime.kind,
        provider: providerHealthy ? "chatmock" : "unavailable",
        dashboardMode: config.mode,
        terminalAgent:
          runtime.kind === "hermes" || available.has(config.agents.terminal)
            ? "available"
            : "unavailable",
        gardenAgent:
          runtime.kind === "hermes" || available.has(config.agents.garden)
            ? "available"
            : "unavailable",
        quartzAgent:
          runtime.kind === "hermes" || available.has(config.agents.quartz)
            ? "available"
            : "unavailable",
        capabilityScout:
          runtime.kind === "hermes" ||
          available.has(config.agents.capabilityScout)
            ? "available"
            : "unavailable",
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
  hermes: "disabled" | "unhealthy",
) {
  return {
    enabled: mode !== "legacy",
    healthy: false,
    chatmock,
    hermes,
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
