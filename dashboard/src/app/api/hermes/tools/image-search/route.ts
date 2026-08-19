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
import {
  ImageSearchServiceError,
  searchImages,
  type ImageSearchInput,
} from "@/lib/hermes/image-search-service.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Internal server-to-server endpoint for the Hermes `image_search` tool. Not a
 * browser API: it authenticates with the same short-lived capability token the
 * gateway mints, which pins the user, the surface and the conversation.
 *
 * The tool is a read over Google's public image index, served by the vendored
 * mcp-google-images-search MCP server — there is no user-owned state behind it,
 * so like the world monitor it needs no permission handshake.
 */
export async function POST(request: Request) {
  let runtimeSessionId: number | null = null;
  try {
    requireEnabled();
    const rawToken = capabilityForInternalToolRequest(request);
    const verified = verifyCapabilityToken(rawToken);
    if (!verified.ok || !tokenAllows(verified.token, { tool: "image_search" })) {
      throw new ApiError(403, "image_search_capability_denied", "Image search is not authorized.");
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
        "image_search_session_scope_mismatch",
        "Image search session scope is invalid.",
      );
    }
    const decision = getActiveCapabilityDecision(session.id);
    if (decision && !decision.allowedTools.includes("image_search")) {
      throw new ApiError(
        403,
        "image_search_tool_not_granted",
        "Image search is not available on this turn.",
      );
    }

    const body = await readJsonBody(request, 32 * 1024);
    const args =
      body.args && typeof body.args === "object" && !Array.isArray(body.args)
        ? (body.args as Record<string, unknown>)
        : {};

    const data = await searchImages(args as unknown as ImageSearchInput);

    recordAuditEvent({
      eventType: "imageSearch.tool_completed",
      runtimeSessionId: session.id,
      userId: session.user_id,
      gardenId: session.garden_id,
      payload: { query: data.query, itemsReturned: data.itemsReturned },
    });
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (runtimeSessionId !== null) {
      recordAuditEvent({
        eventType: "imageSearch.tool_failed",
        runtimeSessionId,
        payload: {
          reason:
            error instanceof ImageSearchServiceError || error instanceof ApiError
              ? error.code
              : "image_search_failed",
        },
      });
    }
    if (error instanceof ImageSearchServiceError) {
      const status =
        error.code === "image_search_runtime_unavailable" ||
        error.code === "image_search_unconfigured"
          ? 503
          : error.code === "image_search_launch_failed"
            ? 502
            : error.code === "image_search_invalid_arguments"
              ? 400
              : 502;
      return apiErrorResponse(new ApiError(status, error.code, error.message));
    }
    return apiErrorResponse(error);
  }
}
