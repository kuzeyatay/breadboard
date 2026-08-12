// `workflow_run` — a super-agent turn running one of the user's own automations.
//
// The Workflows page and the composer's automation picker already run a local n8n
// workflow through `/api/workflows/local/<id>/run`. That path is user-driven: a
// person picks the automation. This one is the agent-driven equivalent for a
// super-agent turn, and it reuses the same execution code so a workflow behaves
// identically whichever side started it.
//
// What it can reach is exactly the loopback n8n instance Breadboard supervises,
// authenticated with Breadboard's own service account. The agent supplies only a
// workflow id and the text going into the trigger.

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
import { ensureN8nSession, n8nJson } from "@/lib/workflows/n8n.ts";
import { runLocalWorkflow } from "@/lib/workflows/execution.ts";
import { RouteError } from "@/lib/server-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const TOOL = "workflow_run";
const MAX_INPUT_LENGTH = 20_000;

export async function POST(request: Request) {
  let runtimeSessionId: number | null = null;
  try {
    requireEnabled();
    const verified = verifyCapabilityToken(
      capabilityForInternalToolRequest(request),
    );
    if (!verified.ok || !tokenAllows(verified.token, { tool: TOOL })) {
      throw new ApiError(
        403,
        "workflow_capability_denied",
        "Running an automation is not authorized for this turn.",
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
        "workflow_session_scope_mismatch",
        "Automation session scope is invalid.",
      );
    }
    const run = getActiveRuntimeRun(session.id);
    if (!run) {
      throw new ApiError(
        409,
        "workflow_run_required",
        "Running an automation requires a current chat run.",
      );
    }
    const decision = getActiveCapabilityDecision(session.id);
    if (!decision || !decision.allowedTools.includes(TOOL)) {
      throw new ApiError(
        403,
        "workflow_capability_denied",
        "Running an automation is not authorized for this turn.",
      );
    }

    const body = await readJsonBody(request, 64 * 1024);
    const args =
      body.args && typeof body.args === "object" && !Array.isArray(body.args)
        ? (body.args as Record<string, unknown>)
        : {};
    const workflowId =
      typeof args.workflowId === "string" ? args.workflowId.trim() : "";
    if (!/^[a-z0-9_-]{1,128}$/i.test(workflowId)) {
      throw new ApiError(
        400,
        "workflow_id_required",
        "A valid automation id is required.",
      );
    }
    const input =
      typeof args.input === "string" ? args.input.slice(0, MAX_INPUT_LENGTH) : "";

    recordAuditEvent({
      eventType: "workflow.run_started",
      runtimeSessionId: session.id,
      userId: session.user_id,
      gardenId: session.garden_id,
      payload: { runId: run.id, workflowId },
    });
    const n8n = await ensureN8nSession();
    const workflow = await n8nJson(
      `/rest/workflows/${encodeURIComponent(workflowId)}`,
      { method: "GET", session: n8n },
    );
    const result = await runLocalWorkflow(workflow, input, n8n);
    recordAuditEvent({
      eventType: "workflow.run_completed",
      runtimeSessionId: session.id,
      userId: session.user_id,
      gardenId: session.garden_id,
      payload: {
        runId: run.id,
        workflowId,
        status: result.status,
        executionId: result.executionId,
      },
    });
    return NextResponse.json({ ok: true, data: result });
  } catch (error) {
    if (runtimeSessionId !== null) {
      recordAuditEvent({
        eventType: "workflow.run_failed",
        runtimeSessionId,
        payload: {
          reason:
            error instanceof ApiError
              ? error.code
              : error instanceof RouteError
                ? "workflow_service_error"
                : "workflow_failed",
        },
      });
    }
    // The workflow library speaks in RouteError; the tool boundary speaks in
    // ApiError, and the model needs the reason rather than a bare 500.
    if (error instanceof RouteError) {
      return apiErrorResponse(
        new ApiError(error.status, "workflow_service_error", error.message),
      );
    }
    return apiErrorResponse(error);
  }
}
