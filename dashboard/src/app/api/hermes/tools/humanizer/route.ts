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
import { HUMANIZER_TOOLS } from "@/lib/hermes/tool-scopes.ts";
import {
  humanizerDevice,
  humanizerMode,
  humanizerModel,
  humanizerRevision,
  HUMANIZER_MAX_TEXT_CHARS,
} from "@/lib/humanizer/config.ts";
import { describeWarnings, scoreReview } from "@/lib/humanizer/review.ts";
import { humanizerHealth, humanizerRewrite } from "@/lib/humanizer/service.ts";
import { SupervisorResourceExhaustedError } from "@/lib/supervisor-control.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Internal server-to-server endpoint for the Hermes `humanize_*` tools. Not a
 * browser API: it authenticates with the same short-lived capability token the
 * gateway mints, which pins the user, the surface and the conversation.
 *
 * This is the agent's door to the same local rewriter the "Rewrite naturally"
 * action uses, and it is deliberately the *narrower* of the two. The action
 * rewrites a stored answer and can adopt the result as a new version; this
 * returns text and nothing else. No message is edited, no note is written, no
 * version is created. The model gets a rewrite, both prose scores and an honest
 * account of what the preservation gates refused, and it is the model's job to
 * put that in front of the person.
 *
 * Everything the sidecar needs — its address, its bearer, its model id, its
 * cache — stays on this side. The tool arguments carry text and nothing else,
 * so there is no argument by which a model could point the rewriter somewhere
 * new.
 */

/** One rewrite can be a whole answer; two would be a conversation's worth. */
const MAX_TOOL_BODY_BYTES = 512 * 1024;

function requestId(): string {
  return `tool${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

export async function POST(request: Request) {
  let runtimeSessionId: number | null = null;
  let toolName = "";
  try {
    requireEnabled();
    const rawToken = capabilityForInternalToolRequest(request);
    const body = await readJsonBody(request, MAX_TOOL_BODY_BYTES);
    toolName = typeof body.tool === "string" ? body.tool : "";
    if (!HUMANIZER_TOOLS.includes(toolName as (typeof HUMANIZER_TOOLS)[number])) {
      throw new ApiError(400, "humanizer_unknown_tool", "Unknown humanizer tool.");
    }

    const verified = verifyCapabilityToken(rawToken);
    if (!verified.ok || !tokenAllows(verified.token, { tool: toolName })) {
      throw new ApiError(403, "humanizer_capability_denied", "Humanizer tools are not authorized.");
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
        "humanizer_session_scope_mismatch",
        "Humanizer session scope is invalid.",
      );
    }
    const decision = getActiveCapabilityDecision(session.id);
    if (decision && !decision.allowedTools.includes(toolName)) {
      throw new ApiError(
        403,
        "humanizer_tool_not_granted",
        "Humanizer tools are not available on this turn.",
      );
    }

    const args =
      body.args && typeof body.args === "object" && !Array.isArray(body.args)
        ? (body.args as Record<string, unknown>)
        : {};

    let data: unknown;
    if (toolName === "humanize_status") {
      const health = await humanizerHealth();
      const state =
        humanizerMode() === "disabled"
          ? "disabled"
          : health.status === "unreachable"
            ? "unavailable"
            : health.status === "degraded"
              ? "error"
              : health.modelState === "not_installed"
                ? "not_installed"
                : "ready";
      data = {
        state,
        ready: state === "ready",
        modelId: health.modelId || humanizerModel(),
        modelRevision: health.modelRevision || humanizerRevision(),
        requestedDevice: humanizerDevice(),
        device: health.device,
        busy: health.busy,
        // Sentences, because this is the thing the model has to relay when it
        // cannot do what was asked. A status code alone gets paraphrased into
        // something less true.
        summary:
          state === "ready"
            ? `The local rewriter is ready (${health.modelId} on ${health.device}).`
            : state === "not_installed"
              ? "The rewriting model has not been downloaded on this machine. It is an explicit opt-in: `npm run setup:humanizer -- --download-model`."
              : state === "disabled"
                ? "Local rewriting is switched off in this installation's settings."
                : state === "error"
                  ? "The local rewriter is installed but not usable right now."
                  : "The local rewriter is not running on this machine. It is an optional local service: `npm run setup:humanizer`, then start Breadboard again.",
      };
    } else {
      const text = typeof args.text === "string" ? args.text : "";
      if (!text.trim()) {
        throw new ApiError(
          400,
          "humanizer_missing_text",
          "Pass the passage to rewrite as `text`.",
        );
      }
      if (text.length > HUMANIZER_MAX_TEXT_CHARS) {
        throw new ApiError(
          413,
          "humanizer_text_too_long",
          `That passage is ${text.length} characters; the rewriter takes at most ${HUMANIZER_MAX_TEXT_CHARS}. Rewrite it a section at a time.`,
        );
      }

      const result = await humanizerRewrite({ requestId: requestId(), text });
      if (!result.ok) {
        // Every one of these is a state the model should describe rather than
        // retry blindly, so the reason travels as a code plus a sentence.
        throw new ApiError(
          result.reason === "busy" ? 429 : result.reason === "unavailable" ? 503 : 409,
          `humanizer_${result.reason}`,
          result.detail,
        );
      }

      const scores = scoreReview(result.originalText, result.rewrittenText);
      const warnings = describeWarnings(
        result.preservation.warnings,
        result.chunks.reverted,
      );
      data = {
        originalText: result.originalText,
        rewrittenText: result.rewrittenText,
        unchanged: result.originalText === result.rewrittenText,
        chunks: result.chunks,
        scores: {
          original: scores.original.score,
          rewrite: scores.rewrite.score,
          delta: scores.delta,
          originalBand: scores.original.band,
          rewriteBand: scores.rewrite.band,
          tied: scores.tied,
          worsened: scores.worsened,
          note: scores.tied
            ? "Breadboard's deterministic pattern heuristic found no measurable score difference. This does not mean the texts are identical, and these scores are not comparable to an AI-detector probability."
            : "Breadboard's scores come from a deterministic style-pattern heuristic, not an AI-detector probability.",
        },
        preservation: {
          passed: result.preservation.passed,
          revertedSections: result.chunks.reverted,
          headline: warnings.headline,
          details: warnings.details,
        },
        model: { id: result.modelId, revision: result.modelRevision, device: result.device },
      };
    }

    recordAuditEvent({
      eventType: "humanizer.tool_completed",
      runtimeSessionId: session.id,
      userId: session.user_id,
      gardenId: session.garden_id,
      // Counts and codes only. The passage itself is never written down, here
      // or in the sidecar — see humanizer-service/breadboard_humanizer/server.py.
      payload: { tool: toolName },
    });
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (runtimeSessionId !== null) {
      recordAuditEvent({
        eventType: "humanizer.tool_failed",
        runtimeSessionId,
        payload: {
          tool: toolName,
          reason: error instanceof ApiError ? error.code : "humanizer_tool_failed",
        },
      });
    }
    if (error instanceof SupervisorResourceExhaustedError) {
      return NextResponse.json(
        { error: error.message, ...error.result },
        { status: 503 },
      );
    }
    return apiErrorResponse(error);
  }
}
