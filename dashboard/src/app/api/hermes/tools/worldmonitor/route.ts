import { NextResponse } from "next/server";

import {
  ApiError,
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
} from "@/lib/hermes/route-helpers.ts";
import { capabilityForInternalToolRequest } from "@/lib/hermes/tool-service-auth.ts";
import { tokenAllows, verifyCapabilityToken } from "@/lib/hermes/capability-token.ts";
import {
  getActiveCapabilityDecision,
  getRuntimeSessionById,
  recordAuditEvent,
  runtimeExternalSessionId,
} from "@/lib/hermes/runtime-store.ts";
import { WORLDMONITOR_TOOLS } from "@/lib/hermes/tool-scopes.ts";
import {
  monitorCatalog,
  monitorClimate,
  monitorSearch,
  monitorSnapshot,
  WorldMonitorQueryError,
} from "@/lib/worldmonitor/agent-query.ts";
import {
  fetchWeatherForecast,
  WeatherForecastError,
} from "@/lib/weather/forecast.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Internal server-to-server endpoint for the Hermes `worldmonitor_*` tools. Not
 * a browser API: it authenticates with the same short-lived capability token
 * the gateway mints, which pins the user, the surface and the conversation.
 *
 * Every tool here is a read. The monitor has no user-owned state to change —
 * it aggregates public feeds and open observational archives — so there is no
 * permission handshake and no counterpart to Recall's `recall_control`.
 */
export async function POST(request: Request) {
  let runtimeSessionId: number | null = null;
  let toolName = "";
  try {
    requireEnabled();
    const rawToken = capabilityForInternalToolRequest(request);
    const body = await readJsonBody(request, 64 * 1024);
    toolName = typeof body.tool === "string" ? body.tool : "";
    if (!WORLDMONITOR_TOOLS.includes(toolName as (typeof WORLDMONITOR_TOOLS)[number])) {
      throw new ApiError(400, "worldmonitor_unknown_tool", "Unknown world monitor tool.");
    }

    const verified = verifyCapabilityToken(rawToken);
    if (!verified.ok || !tokenAllows(verified.token, { tool: toolName })) {
      throw new ApiError(403, "worldmonitor_capability_denied", "The world monitor is not authorized.");
    }
    runtimeSessionId = Number(verified.token.breadboardSessionId);
    const session = getRuntimeSessionById(runtimeSessionId);
    if (
      !session ||
      session.user_id === null ||
      session.conversation_id === null ||
      !["dashboard_terminal", "garden_chat"].includes(session.surface) ||
      runtimeExternalSessionId(session) !== verified.token.hermesSessionId ||
      verified.token.conversationId !== session.conversation_id
    ) {
      throw new ApiError(
        403,
        "worldmonitor_session_scope_mismatch",
        "World monitor session scope is invalid.",
      );
    }
    const decision = getActiveCapabilityDecision(session.id);
    if (decision && !decision.allowedTools.includes(toolName)) {
      throw new ApiError(
        403,
        "worldmonitor_tool_not_granted",
        "The world monitor is not available on this turn.",
      );
    }

    const args =
      body.args && typeof body.args === "object" && !Array.isArray(body.args)
        ? (body.args as Record<string, unknown>)
        : {};

    const data = await executeWorldMonitorTool(toolName, args, request.signal);

    recordAuditEvent({
      eventType: "worldmonitor.tool_completed",
      runtimeSessionId: session.id,
      userId: session.user_id,
      gardenId: session.garden_id,
      payload: { tool: toolName },
    });
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (runtimeSessionId !== null) {
      recordAuditEvent({
        eventType: "worldmonitor.tool_failed",
        runtimeSessionId,
        payload: {
          tool: toolName,
          reason: error instanceof ApiError ? error.code : "worldmonitor_tool_failed",
        },
      });
    }
    if (error instanceof WorldMonitorQueryError) {
      // A bad panel, level or hub id is the caller's to fix, and the message
      // says which value was wrong — so it is returned rather than flattened
      // into a generic failure the model can only retry blindly.
      return NextResponse.json(
        { ok: false, error: error.message, code: "worldmonitor_invalid_query" },
        { status: error.status },
      );
    }
    if (error instanceof WeatherForecastError) {
      const status = error.code === "weather_invalid_arguments" ? 400
        : error.code === "weather_location_not_found" || error.code === "weather_dates_unavailable" ? 404
          : error.code === "weather_aborted" ? 499
            : 502;
      return apiErrorResponse(new ApiError(status, error.code, error.message));
    }
    return apiErrorResponse(error);
  }
}

async function executeWorldMonitorTool(
  tool: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  switch (tool) {
    case "worldmonitor_catalog":
      return monitorCatalog({ region: args.region });
    case "worldmonitor_snapshot":
      return monitorSnapshot(args);
    case "worldmonitor_search":
      return monitorSearch(args);
    case "worldmonitor_climate":
      return monitorClimate(args);
    case "weather_forecast":
      return fetchWeatherForecast(args as unknown as { location: string; dates?: string[] }, { signal });
    default:
      throw new ApiError(400, "worldmonitor_unknown_tool", `Unhandled tool ${tool}.`);
  }
}
