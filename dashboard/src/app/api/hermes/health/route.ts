import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { getAgentRuntime } from "@/lib/agent-runtime/runtime.ts";
import { readHermesConfig } from "@/lib/hermes/config.ts";
import { apiErrorResponse } from "@/lib/hermes/route-helpers.ts";
import {
  acquireServiceLease,
  readSupervisedServiceSnapshot,
  releaseSupervisorLease,
  type SupervisorLease,
} from "@/lib/supervisor-control.ts";

export const dynamic = "force-dynamic";

// Combined, secret-free diagnostic for the complete interactive runtime.
//
// GET is deliberately passive. POST is the Terminal's connect/reconnect path:
// in the desktop app it asks the service supervisor to make Hermes ready before
// probing it. Keeping those meanings separate prevents an ordinary status poll
// from owning process lifecycle while ensuring the reconnect control actually
// reconnects something instead of just repeating the failed GET.
export async function GET() {
  return runtimeHealth(false);
}

export async function POST() {
  return runtimeHealth(true);
}

async function runtimeHealth(ensureRuntime: boolean) {
  let lease: SupervisorLease | null = null;
  try {
    await requireUserId();
    const config = readHermesConfig();
    const chatmock = await chatmockStatus();
    const runtime = getAgentRuntime();
    if (!runtime.enabled) {
      return NextResponse.json(statusPayload(config.mode, chatmock, "disabled"));
    }

    try {
      if (ensureRuntime) {
        // The desktop Runtime V2 supervisor is the only in-product process
        // owner. A null lease is the supported bare-dashboard development
        // case: probe an explicitly started Hermes instance, but never launch
        // a detached child from the Next server. `npm run dev` supplies the
        // supervisor. Focused dashboard development can run the separate,
        // explicit `npm run dev:hermes` developer process.
        lease = await acquireServiceLease("hermes", "terminal-reconnect");
      } else {
        const service = await readSupervisedServiceSnapshot("hermes");
        if (
          service &&
          (service.state === "pending" ||
            service.state === "starting" ||
            service.state === "stopped" ||
            service.state === "available-but-stopped")
        ) {
          return NextResponse.json({
            ...statusPayload(config.mode, chatmock, "available-but-stopped"),
            // A stopped on-demand service is available. This field is consumed
            // only by the existing Terminal shell; it does not expose process,
            // port, path, command, or control authority to the renderer.
            available: true,
            serviceState: "available-but-stopped",
            terminalAgent: "available",
            gardenAgent: "available",
            quartzAgent: "available",
            capabilityScout: "available",
          });
        }
      }
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
  } finally {
    await releaseSupervisorLease(lease);
  }
}

function statusPayload(
  mode: "required" | "preferred" | "legacy",
  chatmock: "healthy" | "unhealthy",
  hermes: "disabled" | "unhealthy" | "available-but-stopped",
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
