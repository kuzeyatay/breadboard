import { NextResponse } from "next/server";
import { apiErrorResponse, readJsonBody, requireEnabled, ApiError } from "@/lib/hermes/route-helpers.ts";
import { capabilityForInternalToolRequest } from "@/lib/hermes/tool-service-auth.ts";
import { verifyCapabilityToken } from "@/lib/hermes/capability-token.ts";
import {
  getActiveCapabilityDecision,
  getRuntimeSessionById,
  persistCapabilityDecision,
  recordAuditEvent,
  runtimeExternalSessionId,
} from "@/lib/hermes/runtime-store.ts";
import { getActiveRuntimeRun, parseRuntimeRunDispatch } from "@/lib/hermes/run-store.ts";
import { getConversationById } from "@/lib/conversations/store.ts";
import { listMcpConnections } from "@/lib/hermes/mcp-connections.ts";
import { openableSkills } from "@/lib/hermes/super-agent.ts";
import type { HermesSurface } from "@/lib/hermes/config.ts";
import { decideEscalation, escalationSkillFor, widenedDecision } from "@/lib/hermes/capability-escalation.ts";

export const dynamic = "force-dynamic";

// The decision layer's server half; see lib/hermes/capability-escalation.ts.
// Only the Breadboard Hermes plugin calls this, with the tool service secret,
// when the model calls a tool this turn switched off. `grant` follows Hermes's
// approval gate (a card, or YOLO's bypass), which the model cannot skip.
export async function POST(request: Request) {
  try {
    requireEnabled();
    const verified = verifyCapabilityToken(capabilityForInternalToolRequest(request));
    if (!verified.ok) throw new ApiError(403, "capability_request_denied", "This request is not authorized.");
    const session = getRuntimeSessionById(Number(verified.token.breadboardSessionId));
    const conversation = session?.conversation_id ? getConversationById(session.conversation_id) : null;
    if (!session || !session.user_id || verified.token.surface !== session.surface ||
      verified.token.userId !== session.user_id || conversation?.user_id !== session.user_id ||
      verified.token.conversationId !== session.conversation_id ||
      runtimeExternalSessionId(session) !== verified.token.hermesSessionId) {
      throw new ApiError(403, "capability_request_session_denied", "Only an authenticated Breadboard conversation can request tools.");
    }
    const run = getActiveRuntimeRun(session.id);
    if (!run) throw new ApiError(409, "capability_request_run_required", "A current conversation run is required.");

    const body = await readJsonBody(request, 64 * 1024);
    const tool = typeof body.tool === "string" ? body.tool.trim() : "";
    const phase = body.phase === "grant" ? "grant" : "check";
    const args = body.args && typeof body.args === "object" && !Array.isArray(body.args)
      ? body.args as Record<string, unknown> : {};
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(tool)) throw new ApiError(400, "capability_request_invalid", "A tool name is required.");

    const surface = session.surface as HermesSurface;
    const openable = surface === "quartz_ai" ? [] : openableSkills(
      surface,
      listMcpConnections(session.user_id, true).map((connection) => connection.slug),
    ).map((skill) => skill.slug);
    const dispatch = parseRuntimeRunDispatch(run);
    const decision = getActiveCapabilityDecision(session.id);
    const verdict = decideEscalation({
      surface,
      tool,
      args,
      surfaceTools: verified.token.allowedTools,
      dispatch,
      decision,
      openableSkillSlugs: openable,
      notifiable: conversation.temporary === 0 && !conversation.buzz_room_id &&
        (conversation.origin_label ?? "") !== "Voice",
    });
    if (phase === "check" || verdict.status !== "grantable") return NextResponse.json(verdict);
    if (!decision) throw new ApiError(409, "capability_request_decision_missing", "This turn has no capability decision to widen.");

    const skill = escalationSkillFor(tool, args, openable);
    persistCapabilityDecision(session.id, widenedDecision(decision, tool, skill));
    recordAuditEvent({
      eventType: "capability.escalated",
      runtimeSessionId: session.id,
      userId: session.user_id,
      gardenId: session.garden_id,
      payload: { runId: run.id, tool, skill: skill || null, yoloMode: dispatch.teamApproval === true, label: verdict.label },
    });
    return NextResponse.json({ status: "granted" });
  } catch (error) { return apiErrorResponse(error); }
}
