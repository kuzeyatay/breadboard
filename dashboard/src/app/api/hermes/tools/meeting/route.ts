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
import { MEETING_TOOLS } from "@/lib/hermes/tool-scopes.ts";
import { AgentCallError, agentCallApiKey, sendSignInCode, verifySignInCode } from "@/lib/meetings/agentcall.ts";
import { joinMeeting, leaveMeeting, meetingLook, meetingSay, meetingStatus, MeetingError } from "@/lib/meetings/meeting-sessions.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const text = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";

/** Internal endpoint behind the meeting_* tools: Bread in Meet, Zoom and Teams via AgentCall. */
export async function POST(request: Request) {
  let runtimeSessionId: number | null = null;
  try {
    requireEnabled();
    const body = await readJsonBody(request, 32 * 1024);
    const tool = typeof body.tool === "string" ? body.tool : "";
    if (!(MEETING_TOOLS as readonly string[]).includes(tool)) {
      throw new ApiError(400, "meeting_unknown_tool", "Unknown meeting tool.");
    }
    const verified = verifyCapabilityToken(capabilityForInternalToolRequest(request));
    if (!verified.ok || !tokenAllows(verified.token, { tool })) {
      throw new ApiError(403, "meeting_capability_denied", "Meetings are not authorized.");
    }
    runtimeSessionId = Number(verified.token.breadboardSessionId);
    const session = getRuntimeSessionById(runtimeSessionId);
    if (!session || session.user_id === null || !["dashboard_terminal", "garden_chat"].includes(session.surface)
      || runtimeExternalSessionId(session) !== verified.token.hermesSessionId) {
      throw new ApiError(403, "meeting_session_scope_mismatch", "Meeting session scope is invalid.");
    }
    const decision = getActiveCapabilityDecision(session.id);
    if (decision && !decision.allowedTools.includes(tool)) {
      throw new ApiError(403, "meeting_tool_not_granted", "Meetings are not available on this turn.");
    }
    const userId = session.user_id;
    const args = body.args && typeof body.args === "object" && !Array.isArray(body.args) ? body.args as Record<string, unknown> : {};
    const callId = text(args.call_id, 120) || undefined;
    recordAuditEvent({ runtimeSessionId: session.id, eventType: `tool.${tool}`, payload: { callId: callId ?? null } });

    switch (tool) {
      case "meeting_account": {
        const action = text(args.action, 20) || "status";
        if (action === "status") return NextResponse.json({ ok: true, data: { connected: Boolean(agentCallApiKey()) } });
        const email = text(args.email, 254);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, "meeting_email_invalid", "Give the email address for the AgentCall account.");
        if (action === "send_code") {
          await sendSignInCode(email);
          return NextResponse.json({ ok: true, data: { sent: true, next: "Ask the user for the six-digit code AgentCall emailed, then call meeting_account with action verify." } });
        }
        if (action === "verify") {
          const code = text(args.code, 12);
          if (!/^\d{6}$/.test(code)) throw new ApiError(400, "meeting_code_invalid", "The code is six digits.");
          return NextResponse.json({ ok: true, data: { connected: true, ...(await verifySignInCode(email, code)) } });
        }
        throw new ApiError(400, "meeting_account_action_invalid", "action is status, send_code or verify.");
      }
      case "meeting_join": {
        const url = text(args.url, 2000);
        if (!url) throw new ApiError(400, "meeting_url_required", "Give the meeting link.");
        const languages = Array.isArray(args.languages)
          ? args.languages.filter((item): item is string => typeof item === "string" && /^[a-z]{2}(-[A-Z]{2})?$/.test(item))
          : undefined;
        return NextResponse.json({ ok: true, data: await joinMeeting({ userId, meetUrl: url, brief: text(args.brief, 6000), languages }) });
      }
      case "meeting_status":
        return NextResponse.json({ ok: true, data: await meetingStatus(userId, { callId, lines: typeof args.lines === "number" ? args.lines : undefined }) });
      case "meeting_say":
        return NextResponse.json({ ok: true, data: meetingSay(userId, { text: text(args.text, 4000), chat: args.chat === true, callId }) });
      case "meeting_look":
        return NextResponse.json({ ok: true, data: { screenshot: { dataUrl: await meetingLook(userId, callId) } } });
      case "meeting_leave":
        return NextResponse.json({ ok: true, data: await leaveMeeting(userId, callId) });
    }
    throw new ApiError(400, "meeting_unknown_tool", "Unknown meeting tool.");
  } catch (error) {
    if (error instanceof MeetingError || error instanceof AgentCallError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    if (runtimeSessionId !== null && !(error instanceof ApiError)) {
      recordAuditEvent({ runtimeSessionId, eventType: "tool.meeting.error", payload: { message: error instanceof Error ? error.message : String(error) } });
    }
    return apiErrorResponse(error);
  }
}
