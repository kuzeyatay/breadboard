import { NextResponse } from "next/server";

import { capabilityForInternalToolRequest } from "@/lib/hermes/tool-service-auth.ts";
import { tokenAllows, verifyCapabilityToken } from "@/lib/hermes/capability-token.ts";
import {
  getActiveCapabilityDecision,
  getRuntimeSessionById,
  recordAuditEvent,
  runtimeExternalSessionId,
} from "@/lib/hermes/runtime-store.ts";
import { ApiError, apiErrorResponse, readJsonBody, requireEnabled } from "@/lib/hermes/route-helpers.ts";
import { REPOSITORY_TOOLS } from "@/lib/hermes/tool-scopes.ts";
import { createGardenRepository } from "@/lib/code-index/create-repository.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TOOL = "garden_create_repository";

/** Internal, capability-scoped endpoint behind `garden_create_repository`. */
export async function POST(request: Request) {
  try {
    requireEnabled();
    const verified = verifyCapabilityToken(capabilityForInternalToolRequest(request));
    if (!verified.ok || !tokenAllows(verified.token, { tool: TOOL })) {
      throw new ApiError(403, "repository_capability_denied", "Creating a repository is not authorized.");
    }
    const session = getRuntimeSessionById(Number(verified.token.breadboardSessionId));
    if (
      !session ||
      session.user_id === null ||
      !["dashboard_terminal", "garden_chat"].includes(session.surface) ||
      runtimeExternalSessionId(session) !== verified.token.hermesSessionId
    ) {
      throw new ApiError(403, "repository_session_scope_mismatch", "Repository session scope is invalid.");
    }
    const decision = getActiveCapabilityDecision(session.id);
    if (decision && !decision.allowedTools.includes(TOOL)) {
      throw new ApiError(403, "repository_tool_not_granted", "Creating a repository is not available on this turn.");
    }
    const body = await readJsonBody(request, 8 * 1024);
    if (!(REPOSITORY_TOOLS as readonly string[]).includes(String(body.tool))) {
      throw new ApiError(400, "repository_unknown_tool", "Unknown repository tool.");
    }
    // The Garden comes from the session, never from the model.
    const clusterId = verified.token.activeGardenId ?? session.cluster_id;
    if (!clusterId) {
      return NextResponse.json({ ok: false, error: "No Garden is open in this chat, so there is nothing to connect a repository to. Ask the user to open a Garden first." });
    }
    const args = body.args && typeof body.args === "object" ? (body.args as Record<string, unknown>) : {};
    const name = typeof args.name === "string" ? args.name.slice(0, 80) : undefined;
    try {
      const created = await createGardenRepository({ userId: session.user_id, clusterId, name });
      recordAuditEvent({ runtimeSessionId: session.id, eventType: "tool.garden_create_repository", payload: { path: created.path } });
      return NextResponse.json({
        ok: true, path: created.path, garden: created.garden,
        summary: `Created a Git repository at ${created.path} and connected it to the ${created.garden} Garden. From the next message on, code work in this Garden goes to Codex inside that repository.`,
      });
    } catch (error) {
      return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "The repository could not be created." });
    }
  } catch (error) {
    return apiErrorResponse(error);
  }
}
