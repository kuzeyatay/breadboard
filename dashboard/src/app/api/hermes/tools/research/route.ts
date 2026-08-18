// `research_begin` / `research_record` / `research_status` — the coverage-driven
// research pipeline, reachable only from a Super agent turn.
//
// The route owns no research logic. It authenticates the call the way every
// other Breadboard tool route does, resolves the durable Hermes task to a
// conversation, and hands the arguments to lib/research. The reason the state
// is keyed by conversation rather than by run is that a delegated agent's
// result comes back as a fresh internal turn: a session that died with its run
// would lose its coverage matrix precisely when the follow-up needs it.

import { NextResponse } from "next/server";
import {
  ApiError,
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
} from "@/lib/hermes/route-helpers.ts";
import { capabilityForInternalToolRequest } from "@/lib/hermes/tool-service-auth.ts";
import {
  tokenAllows,
  verifyCapabilityToken,
} from "@/lib/hermes/capability-token.ts";
import {
  getActiveCapabilityDecision,
  getRuntimeSessionById,
  recordAuditEvent,
  runtimeExternalSessionId,
} from "@/lib/hermes/runtime-store.ts";
import { RESEARCH_TOOLS } from "@/lib/hermes/tool-scopes.ts";
import {
  beginResearch,
  recordResearch,
  researchStatus,
  ResearchSessionError,
} from "@/lib/research/session.ts";
import {
  recordBeginTelemetry,
  recordIngestTelemetry,
  recordStatusTelemetry,
  type TelemetryContext,
} from "@/lib/research/telemetry.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Bounded: a round of findings is large, an unbounded one is an attack. */
const MAX_BODY_BYTES = 512 * 1024;

function toolName(body: Record<string, unknown>): string {
  const name = typeof body.tool === "string" ? body.tool : "";
  if (!RESEARCH_TOOLS.includes(name as (typeof RESEARCH_TOOLS)[number])) {
    throw new ApiError(
      400,
      "research_tool_unknown",
      "Unknown research operation.",
    );
  }
  return name;
}

function argsOf(body: Record<string, unknown>): Record<string, unknown> {
  return body.args && typeof body.args === "object" && !Array.isArray(body.args)
    ? (body.args as Record<string, unknown>)
    : {};
}

export async function POST(request: Request) {
  let runtimeSessionId: number | null = null;
  try {
    requireEnabled();
    const rawToken = capabilityForInternalToolRequest(request);
    const verified = verifyCapabilityToken(rawToken);
    const body = await readJsonBody(request, MAX_BODY_BYTES);
    const tool = toolName(body);
    if (!verified.ok || !tokenAllows(verified.token, { tool })) {
      throw new ApiError(
        403,
        "research_capability_denied",
        "Research pipeline access is not authorized.",
      );
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
        "research_session_scope_mismatch",
        "Research session scope is invalid.",
      );
    }
    const decision = getActiveCapabilityDecision(session.id);
    if (!decision || !decision.allowedTools.includes(tool)) {
      throw new ApiError(
        403,
        "research_not_available",
        "The research pipeline is available only while Super agent is on.",
      );
    }
    const conversationId = session.conversation_id;
    const telemetry: TelemetryContext = {
      runtimeSessionId: session.id,
      userId: session.user_id,
      gardenId: session.garden_id,
      conversationId,
    };
    const args = argsOf(body);

    if (tool === "research_begin") {
      const result = beginResearch({
        conversationId,
        question: String(args.question ?? ""),
        ...(Array.isArray(args.requestedFields)
          ? {
              requestedFields: (args.requestedFields as unknown[])
                .filter(
                  (field): field is Record<string, unknown> =>
                    Boolean(field) && typeof field === "object",
                )
                .map((field) => ({
                  key: String(field.key ?? ""),
                  ...(typeof field.label === "string" ? { label: field.label } : {}),
                  ...(typeof field.priority === "number"
                    ? { priority: field.priority }
                    : {}),
                }))
                .filter((field) => field.key),
            }
          : {}),
        ...(typeof args.targetEntityDescription === "string"
          ? { targetEntityDescription: args.targetEntityDescription }
          : {}),
      });
      recordBeginTelemetry(telemetry, result);
      return NextResponse.json({ ok: true, data: result });
    }

    if (tool === "research_record") {
      const result = recordResearch({
        conversationId,
        ...(Array.isArray(args.entities)
          ? { entities: args.entities as never }
          : {}),
        ...(Array.isArray(args.evidence) ? { evidence: args.evidence as never } : {}),
        ...(Array.isArray(args.relationships)
          ? { relationships: args.relationships as never }
          : {}),
        ...(Array.isArray(args.searches) ? { searches: args.searches as never } : {}),
        ...(args.completedEnumerationRound === true
          ? { completedEnumerationRound: true }
          : {}),
      });
      recordIngestTelemetry(telemetry, result);
      return NextResponse.json({ ok: true, data: result });
    }

    const result = researchStatus({ conversationId });
    recordStatusTelemetry(telemetry, result);
    return NextResponse.json({ ok: true, data: result });
  } catch (error) {
    if (runtimeSessionId !== null) {
      recordAuditEvent({
        eventType: "research.tool_failed",
        runtimeSessionId,
        payload: {
          reason:
            error instanceof ResearchSessionError
              ? error.code
              : error instanceof ApiError
                ? error.code
                : "research_failed",
        },
      });
    }
    if (error instanceof ResearchSessionError) {
      return apiErrorResponse(
        new ApiError(
          error.code === "research_session_missing" ? 409 : 400,
          error.code,
          error.message,
        ),
      );
    }
    return apiErrorResponse(error);
  }
}
