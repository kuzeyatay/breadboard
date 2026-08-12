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
import { PLAN_TOOLS, PLAN_WRITE_TOOLS } from "@/lib/hermes/tool-scopes.ts";
import {
  board,
  commentTask,
  createTask,
  getTask,
  listProjects,
  moveTask,
  searchTasks,
  upcoming,
  updateTask,
} from "@/lib/plan/agent-query.ts";
import { getPlanStore } from "@/lib/plan/instance.ts";
import { PlanError } from "@/lib/plan/store.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Internal server-to-server endpoint for the Hermes `plan_*` tools. Not a
 * browser API: it authenticates with the same short-lived capability token the
 * gateway mints, which pins the user, the surface and the conversation.
 *
 * Unlike the calendar's tools these can write — the board is meant to be kept by
 * the assistant as well as by the user. Three things bound that:
 *
 *   * The user id comes from the verified session, never from the arguments, so
 *     a call cannot name somebody else's board.
 *   * The capability decision for the turn is revalidated here, so a tool the
 *     turn was not granted is refused at the data boundary as well as at the
 *     runtime.
 *   * Nothing destructive is reachable. There is no delete tool at all, and the
 *     writes that exist are all reversible with one drag.
 */
export async function POST(request: Request) {
  let runtimeSessionId: number | null = null;
  let toolName = "";
  try {
    requireEnabled();
    const rawToken = capabilityForInternalToolRequest(request);
    const body = await readJsonBody(request, 128 * 1024);
    toolName = typeof body.tool === "string" ? body.tool : "";
    if (!PLAN_TOOLS.includes(toolName as (typeof PLAN_TOOLS)[number])) {
      throw new ApiError(400, "plan_unknown_tool", "Unknown plan tool.");
    }

    const verified = verifyCapabilityToken(rawToken);
    if (!verified.ok || !tokenAllows(verified.token, { tool: toolName })) {
      throw new ApiError(403, "plan_capability_denied", "The plan board is not authorized.");
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
      throw new ApiError(403, "plan_session_scope_mismatch", "Plan session scope is invalid.");
    }
    const decision = getActiveCapabilityDecision(session.id);
    if (decision && !decision.allowedTools.includes(toolName)) {
      throw new ApiError(
        403,
        "plan_tool_not_granted",
        "The plan board is not available on this turn.",
      );
    }

    const args =
      body.args && typeof body.args === "object" && !Array.isArray(body.args)
        ? (body.args as Record<string, unknown>)
        : {};

    const data = executePlanTool(toolName, session.user_id, args);

    recordAuditEvent({
      eventType: "plan.tool_completed",
      runtimeSessionId: session.id,
      userId: session.user_id,
      gardenId: session.garden_id,
      // A write is worth being able to find later; the payload names which one.
      payload: { tool: toolName, write: PLAN_WRITE_TOOLS.includes(toolName) },
    });
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (runtimeSessionId !== null) {
      recordAuditEvent({
        eventType: "plan.tool_failed",
        runtimeSessionId,
        payload: {
          tool: toolName,
          reason: error instanceof ApiError ? error.code : "plan_tool_failed",
        },
      });
    }
    if (error instanceof PlanError) {
      // "There is no project called X. You have: …" — the store and the agent
      // layer already say what to fix, so they are passed through rather than
      // reduced to a status the model can only retry against.
      return NextResponse.json(
        { ok: false, error: error.message, code: "plan_invalid_request" },
        { status: error.status },
      );
    }
    return apiErrorResponse(error);
  }
}

function executePlanTool(
  tool: string,
  userId: number,
  args: Record<string, unknown>,
): unknown {
  const store = getPlanStore();
  switch (tool) {
    case "plan_list_projects":
      return listProjects(store, userId);
    case "plan_board":
      return board(store, userId, args);
    case "plan_search_tasks":
      return searchTasks(store, userId, args);
    case "plan_upcoming":
      return upcoming(store, userId, args);
    case "plan_get_task":
      return getTask(store, userId, args);
    case "plan_create_task":
      return createTask(store, userId, args);
    case "plan_update_task":
      return updateTask(store, userId, args);
    case "plan_move_task":
      return moveTask(store, userId, args);
    case "plan_comment_task":
      return commentTask(store, userId, args);
    default:
      throw new ApiError(400, "plan_unknown_tool", `Unhandled tool ${tool}.`);
  }
}
