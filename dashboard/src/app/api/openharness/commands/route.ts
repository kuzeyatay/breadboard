import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import {
  registryItemsForUser,
  type CommandHubItem,
  type CommandResolutionContext,
} from "@/lib/openharness/commands.ts";
import { OPENHARNESS_SURFACES, type OpenHarnessSurface } from "@/lib/openharness/config.ts";
import {
  getAgentRuntime,
  getAgentRuntimeByKind,
} from "@/lib/agent-runtime/runtime.ts";
import {
  apiErrorResponse,
  requireEnabled,
} from "@/lib/openharness/route-helpers.ts";
import {
  getActiveCapabilityDecision,
} from "@/lib/openharness/runtime-store.ts";
import { authorizeRuntimeReference } from "@/lib/openharness/session-service.ts";
import {
  listMcpConnections,
  runtimeMcpConfig,
} from "@/lib/openharness/mcp-connections.ts";
import { decideCapabilityMode } from "@/lib/openharness/capability-policy.ts";
import { loadAgencyAgentsCatalog } from "@/lib/openharness/agency-agents.ts";

export const dynamic = "force-dynamic";

function requestedSurface(value: string | null): OpenHarnessSurface {
  return value && (OPENHARNESS_SURFACES as readonly string[]).includes(value)
    ? (value as OpenHarnessSurface)
    : "dashboard_terminal";
}

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const url = new URL(request.url);
    const requestedSessionId = url.searchParams.get("sessionId");
    const session = requestedSessionId
      ? authorizeRuntimeReference(userId, requestedSessionId)
      : null;
    const surface = session?.row.surface ?? requestedSurface(url.searchParams.get("surface"));
    const activeDecision = session
      ? getActiveCapabilityDecision(session.row.id)
      : null;
    const outcome = url.searchParams.get("outcome")?.trim().slice(0, 4_000) ?? "";
    const previewDecision = session && outcome
      ? decideCapabilityMode({
          surface,
          userId,
          requestedOutcome: outcome,
          authorizedRoot: session.activeDirectory,
        })
      : null;
    const context: CommandResolutionContext = {
      surface,
      mode:
        activeDecision?.mode === "scoped_implementation" ||
        previewDecision?.mode === "scoped_implementation"
          ? "scoped_implementation"
          : activeDecision?.mode ?? previewDecision?.mode ?? "knowledge",
      requestedOutcome: outcome || activeDecision?.requestedOutcome,
      runtimeKind: session?.runtimeKind,
    };
    const items = registryItemsForUser(userId, context);
    const agencyCatalog = surface === "quartz_ai" ? null : loadAgencyAgentsCatalog();
    const connections = listMcpConnections(userId);
    const connectionItems = items.filter((item) => item.kind === "mcp");
    let connectionNotice: string | null = null;

    if (connections.some((connection) => connection.enabled)) {
      try {
        const runtime = session
          ? getAgentRuntimeByKind(session.runtimeKind)
          : getAgentRuntime();
        const directory =
          session?.activeDirectory ?? runtime.managementDirectory(userId);
        for (const connection of connections.filter((candidate) => candidate.enabled)) {
          await runtime
            .addMcpConnection(
              directory,
              connection.slug,
              runtimeMcpConfig(connection),
              userId,
            )
            .catch(() => null);
        }
        const discovery = await runtime.listCapabilities(directory, userId);
        for (const item of connectionItems) {
          const status = discovery.mcp[item.slug];
          item.connected = status?.status === "connected";
          item.healthy = item.enabled && item.connected;
          item.unavailableReason = item.healthy
            ? undefined
            : status?.status === "failed"
              ? status.error
              : status?.status
                ? status.status.replaceAll("_", " ")
                : "Not connected";
          if (item.connected) item.trustLabel = "Connected";
        }
      } catch {
        connectionNotice = "Connections could not be checked. Try again.";
        for (const item of connectionItems) {
          item.connected = false;
          item.healthy = false;
          item.unavailableReason = "Connection status unavailable";
        }
      }
    }

    const groups = {
      skills: items.filter((item): item is CommandHubItem => item.kind === "skill"),
      mcp: connectionItems,
      prompts: items.filter((item): item is CommandHubItem => item.kind === "prompt"),
      agents: items.filter((item): item is CommandHubItem => item.kind === "agent"),
    };
    return NextResponse.json({
      groups,
      capability: {
        mode: context.mode,
        expiresAt: activeDecision?.expiresAt ?? null,
        taskScoped: context.mode === "scoped_implementation",
      },
      notices: {
        connections: connectionNotice,
        agents: agencyCatalog?.message ?? null,
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
