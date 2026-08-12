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
import { MAP_TOOLS } from "@/lib/hermes/tool-scopes.ts";
import { MapServiceError } from "@/lib/map/errors.ts";
import { executeMapOperation, isMapOperation } from "@/lib/map/operations.ts";
import { isMapEnabled } from "@/lib/map/config.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Internal server-to-server endpoint for the Hermes `map_*` tools.
 *
 * It authenticates with the same short-lived capability token every other tool
 * route uses, then executes the shared map service and writes the structured
 * result into Breadboard's geographic state. What comes back to Hermes is a
 * compact view of exactly the records that were stored — the map UI reads the
 * same rows, so an answer and a screen are the same data twice, not two
 * independent renderings of a place name.
 *
 * Nothing here accepts geometry, coordinates for a route, or a place name to be
 * trusted: those arrive only as ids Breadboard itself resolved.
 */
export async function POST(request: Request) {
  let runtimeSessionId: number | null = null;
  let toolName = "";
  try {
    requireEnabled();
    if (!isMapEnabled()) {
      throw new ApiError(503, "map_disabled", "Breadboard's map services are disabled.");
    }
    const rawToken = capabilityForInternalToolRequest(request);
    const body = await readJsonBody(request, 64 * 1024);
    toolName = typeof body.tool === "string" ? body.tool : "";
    if (!MAP_TOOLS.includes(toolName as (typeof MAP_TOOLS)[number]) || !isMapOperation(toolName)) {
      throw new ApiError(400, "map_unknown_tool", "Unknown map tool.");
    }

    const verified = verifyCapabilityToken(rawToken);
    if (!verified.ok || !tokenAllows(verified.token, { tool: toolName })) {
      throw new ApiError(403, "map_capability_denied", "The map tools are not authorized.");
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
      throw new ApiError(403, "map_session_scope_mismatch", "Map session scope is invalid.");
    }
    const decision = getActiveCapabilityDecision(session.id);
    if (decision && !decision.allowedTools.includes(toolName)) {
      throw new ApiError(403, "map_tool_not_granted", "The map tools are not available on this turn.");
    }

    const args =
      body.args && typeof body.args === "object" && !Array.isArray(body.args)
        ? (body.args as Record<string, unknown>)
        : {};

    const outcome = await executeMapOperation(toolName, args, {
      userId: session.user_id,
      conversationId: session.conversation_id,
    });

    recordAuditEvent({
      eventType: "map.tool_completed",
      runtimeSessionId: session.id,
      userId: session.user_id,
      gardenId: session.garden_id,
      payload: {
        tool: toolName,
        // Only what the state moved to, never the geometry or the arguments.
        revision: outcome.context?.revision ?? null,
        empty: outcome.data.empty === true,
      },
    });
    return NextResponse.json({ ok: true, data: outcome.data });
  } catch (error) {
    if (runtimeSessionId !== null) {
      recordAuditEvent({
        eventType: "map.tool_failed",
        runtimeSessionId,
        payload: {
          tool: toolName,
          reason:
            error instanceof MapServiceError
              ? error.code
              : error instanceof ApiError
                ? error.code
                : "map_tool_failed",
        },
      });
    }
    if (error instanceof MapServiceError) {
      // The message is the sentence the model should repeat. Returning it
      // rather than a generic failure is what keeps "I couldn't verify that"
      // available as an answer instead of leaving only a guess.
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status },
      );
    }
    return apiErrorResponse(error);
  }
}
