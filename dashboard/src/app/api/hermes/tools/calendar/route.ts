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
import { CALENDAR_TOOLS } from "@/lib/hermes/tool-scopes.ts";
import { agenda, getEvent, listCalendars, searchEvents } from "@/lib/calendar/agent-query.ts";
import {
  createCalendarEvent,
  deleteCalendarEvent,
  updateCalendarEvent,
} from "@/lib/calendar/agent-actions.ts";
import { getCalendarStore } from "@/lib/calendar/instance.ts";
import { CalendarError } from "@/lib/calendar/store.ts";
import { rememberEventPeople } from "@/lib/contacts/calendar-capture.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Internal server-to-server endpoint for the Hermes `calendar_*` tools. Not a
 * browser API: it authenticates with the same short-lived capability token the
 * gateway mints, which pins the user, the surface and the conversation.
 *
 * The user id comes from the verified session rather than from the arguments,
 * so a tool call cannot name somebody else's calendar, and the store scopes
 * every read and write by it a second time. Subscribed calendars remain
 * read-only because CalendarStore rejects writes to them.
 */
export async function POST(request: Request) {
  let runtimeSessionId: number | null = null;
  let toolName = "";
  try {
    requireEnabled();
    const rawToken = capabilityForInternalToolRequest(request);
    const body = await readJsonBody(request, 64 * 1024);
    toolName = typeof body.tool === "string" ? body.tool : "";
    if (!CALENDAR_TOOLS.includes(toolName as (typeof CALENDAR_TOOLS)[number])) {
      throw new ApiError(400, "calendar_unknown_tool", "Unknown calendar tool.");
    }

    const verified = verifyCapabilityToken(rawToken);
    if (!verified.ok || !tokenAllows(verified.token, { tool: toolName })) {
      throw new ApiError(403, "calendar_capability_denied", "The calendar is not authorized.");
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
        "calendar_session_scope_mismatch",
        "Calendar session scope is invalid.",
      );
    }
    const decision = getActiveCapabilityDecision(session.id);
    if (decision && !decision.allowedTools.includes(toolName)) {
      throw new ApiError(
        403,
        "calendar_tool_not_granted",
        "The calendar is not available on this turn.",
      );
    }

    const args =
      body.args && typeof body.args === "object" && !Array.isArray(body.args)
        ? (body.args as Record<string, unknown>)
        : {};

    const data = executeCalendarTool(toolName, session.user_id, args);

    recordAuditEvent({
      eventType: "calendar.tool_completed",
      runtimeSessionId: session.id,
      userId: session.user_id,
      gardenId: session.garden_id,
      payload: { tool: toolName },
    });
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (runtimeSessionId !== null) {
      recordAuditEvent({
        eventType: "calendar.tool_failed",
        runtimeSessionId,
        payload: {
          tool: toolName,
          reason: error instanceof ApiError ? error.code : "calendar_tool_failed",
        },
      });
    }
    if (error instanceof CalendarError) {
      // "That calendar does not exist", "the range ends before it starts" — the
      // store's messages already say what to fix, so they are passed through
      // rather than reduced to a status the model can only retry against.
      return NextResponse.json(
        { ok: false, error: error.message, code: "calendar_invalid_query" },
        { status: error.status },
      );
    }
    return apiErrorResponse(error);
  }
}

function executeCalendarTool(
  tool: string,
  userId: number,
  args: Record<string, unknown>,
): unknown {
  const store = getCalendarStore();
  switch (tool) {
    case "calendar_list_calendars":
      return listCalendars(store, userId);
    case "calendar_agenda":
      return agenda(store, userId, args);
    case "calendar_search_events":
      return searchEvents(store, userId, args);
    case "calendar_get_event":
      return getEvent(store, userId, args);
    case "calendar_create_event": {
      const result = createCalendarEvent(store, userId, args);
      rememberEventPeople(userId, result.event);
      return result;
    }
    case "calendar_update_event": {
      const result = updateCalendarEvent(store, userId, args);
      rememberEventPeople(userId, result.event);
      return result;
    }
    case "calendar_delete_event":
      return deleteCalendarEvent(store, userId, args);
    default:
      throw new ApiError(400, "calendar_unknown_tool", `Unhandled tool ${tool}.`);
  }
}
