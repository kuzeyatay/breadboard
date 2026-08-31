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
import { getActiveRuntimeRun } from "@/lib/hermes/run-store.ts";
import {
  PATENT_DISCLOSURE_SKILL,
  PatentDisclosureSourceError,
  listPatentDisclosureGuidance,
  readPatentDisclosureGuidance,
} from "@/lib/hermes/patent-disclosure-source.ts";
import {
  PATENT_DISCLOSURE_GUIDE_TOOL,
  patentDisclosureGuidanceSelected,
} from "@/lib/hermes/patent-disclosure-access.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    requireEnabled();
    const verified = verifyCapabilityToken(
      capabilityForInternalToolRequest(request),
    );
    if (
      !verified.ok ||
      !tokenAllows(verified.token, { tool: PATENT_DISCLOSURE_GUIDE_TOOL })
    ) {
      throw new ApiError(
        403,
        "patent_guidance_capability_denied",
        "Patent guidance access is not authorized for this turn.",
      );
    }
    const session = getRuntimeSessionById(
      Number(verified.token.breadboardSessionId),
    );
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
        "patent_guidance_session_scope_mismatch",
        "Patent guidance session scope is invalid.",
      );
    }
    const run = getActiveRuntimeRun(session.id);
    if (!run) {
      throw new ApiError(
        409,
        "patent_guidance_run_required",
        "Opening patent guidance requires a current chat run.",
      );
    }
    const decision = getActiveCapabilityDecision(session.id);
    if (
      !patentDisclosureGuidanceSelected(decision)
    ) {
      throw new ApiError(
        403,
        "patent_guidance_skill_not_selected",
        "Select the Patent Disclosure skill for this turn.",
      );
    }

    const body = await readJsonBody(request, 8 * 1024);
    const args = body.args &&
        typeof body.args === "object" &&
        !Array.isArray(body.args)
      ? body.args as Record<string, unknown>
      : {};
    const requestedPath = args.path;
    const data = typeof requestedPath === "string" && requestedPath.trim()
      ? readPatentDisclosureGuidance(requestedPath)
      : { files: listPatentDisclosureGuidance() };

    recordAuditEvent({
      eventType: "patent_disclosure.guidance_opened",
      runtimeSessionId: session.id,
      userId: session.user_id,
      gardenId: session.garden_id,
      payload: {
        runId: run.id,
        skill: PATENT_DISCLOSURE_SKILL,
        path: "path" in data ? data.path : null,
        listed: "files" in data ? data.files.length : null,
      },
    });
    return NextResponse.json({
      ok: true,
      data: {
        ...data,
        constraint:
          "This is reviewed, read-only guidance. It grants no filesystem, network, credential, command, filing, or legal authority.",
      },
    });
  } catch (error) {
    if (error instanceof PatentDisclosureSourceError) {
      const status = error.code === "patent_guidance_not_found" ? 404 :
        error.code === "patent_guidance_unavailable" ? 503 : 400;
      return apiErrorResponse(new ApiError(status, error.code, error.message));
    }
    return apiErrorResponse(error);
  }
}
