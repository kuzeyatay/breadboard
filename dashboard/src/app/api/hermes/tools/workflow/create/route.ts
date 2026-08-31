// `workflow_create` — direct, explicit workflow authoring by Hermes.
//
// Unsolicited automation ideas still go through workflow_propose. This route is
// the other case: the user asked Hermes to create a workflow now. The route
// verifies that intent from the active run, compiles the model's bounded step
// definition through the native registry, and saves it in the same owner-scoped
// table read by the Workflows capability page.

import { NextResponse } from "next/server";

import { conversationIsTemporary, getConversationById } from "@/lib/conversations/store.ts";
import { tokenAllows, verifyCapabilityToken } from "@/lib/hermes/capability-token.ts";
import {
  ApiError,
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
} from "@/lib/hermes/route-helpers.ts";
import { getActiveRuntimeRun } from "@/lib/hermes/run-store.ts";
import {
  getActiveCapabilityDecision,
  getRuntimeSessionById,
  listAuditEvents,
  recordAuditEvent,
  runtimeExternalSessionId,
} from "@/lib/hermes/runtime-store.ts";
import { capabilityForInternalToolRequest } from "@/lib/hermes/tool-service-auth.ts";
import {
  buildAuthoredWorkflowState,
  explicitlyRequestsWorkflowCreation,
  workflowAuthoringCatalog,
  WorkflowAuthoringError,
  type AuthoredWorkflowDefinition,
} from "@/lib/workflows/authoring.ts";
import { createWorkflow, getWorkflow, type WorkflowRecord } from "@/lib/workflows/store.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TOOL = "workflow_create";

function parseAuditPayload(row: Record<string, unknown>): Record<string, unknown> | null {
  if (typeof row.payload !== "string") return null;
  try {
    const parsed = JSON.parse(row.payload) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function priorWorkflowId(input: {
  runtimeSessionId: number;
  runId: string;
  toolCallId: string | null;
}): { id: string; warnings: string[] } | null {
  if (!input.toolCallId) return null;
  for (const row of listAuditEvents(input.runtimeSessionId).toReversed()) {
    if (row.event_type !== "workflow.tool.create") continue;
    const payload = parseAuditPayload(row);
    if (
      payload?.runId !== input.runId ||
      payload.toolCallId !== input.toolCallId ||
      typeof payload.workflowId !== "string"
    ) {
      continue;
    }
    return {
      id: payload.workflowId,
      warnings: Array.isArray(payload.warnings)
        ? payload.warnings.filter((item): item is string => typeof item === "string")
        : [],
    };
  }
  return null;
}

function blockCount(workflow: WorkflowRecord): number {
  const blocks = (workflow.state as { blocks?: unknown } | null)?.blocks;
  return blocks && typeof blocks === "object" ? Object.keys(blocks).length : 0;
}

function workflowResponse(workflow: WorkflowRecord, warnings: string[], reused = false) {
  return NextResponse.json({
    ok: true,
    data: {
      workflow: {
        id: workflow.id,
        name: workflow.name,
        description: workflow.description,
        source: workflow.source,
        blockCount: blockCount(workflow),
        url: `/workflows?workflow=${encodeURIComponent(workflow.id)}`,
      },
      warnings,
      ...(reused ? { reused: true } : {}),
      note: reused
        ? "This tool call already saved the workflow; returning the same registered workflow."
        : "Saved and registered in the Workflows capability page.",
    },
  });
}

export async function POST(request: Request) {
  let runtimeSessionId: number | null = null;
  try {
    requireEnabled();
    const verified = verifyCapabilityToken(capabilityForInternalToolRequest(request));
    if (!verified.ok || !tokenAllows(verified.token, { tool: TOOL })) {
      throw new ApiError(403, "workflow_create_denied", "Creating a workflow is not authorized for this turn.");
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
      throw new ApiError(403, "workflow_create_scope_mismatch", "Workflow authoring session scope is invalid.");
    }
    const run = getActiveRuntimeRun(session.id);
    if (!run) {
      throw new ApiError(409, "workflow_create_run_required", "Creating a workflow requires a current chat run.");
    }
    const decision = getActiveCapabilityDecision(session.id);
    if (!decision || !decision.allowedTools.includes(TOOL)) {
      throw new ApiError(403, "workflow_create_denied", "Creating a workflow is not authorized for this turn.");
    }

    const body = await readJsonBody(request, 256 * 1024);
    const args =
      body.args && typeof body.args === "object" && !Array.isArray(body.args)
        ? (body.args as Record<string, unknown>)
        : {};
    const toolCallId = typeof body.toolCallId === "string" ? body.toolCallId.slice(0, 200) : null;
    const action = args.action === "catalog" ? "catalog" : "create";
    if (action === "catalog") {
      return NextResponse.json({
        ok: true,
        data: {
          blocks: workflowAuthoringCatalog(),
          note: "Use these exact block types and input ids in workflow_create. Omitted edges connect steps in order.",
        },
      });
    }

    if (!explicitlyRequestsWorkflowCreation(run.instruction)) {
      throw new ApiError(
        409,
        "workflow_create_intent_required",
        "The user did not explicitly ask to create or save a workflow. Use workflow_propose for an unsolicited idea.",
      );
    }
    if (conversationIsTemporary(getConversationById(session.conversation_id))) {
      throw new ApiError(409, "temporary_chat", "A temporary chat cannot create a durable workflow.");
    }

    const name = typeof args.name === "string" ? args.name.trim().slice(0, 200) : "";
    if (!name) throw new ApiError(400, "workflow_name_required", "name is required.");
    const prior = priorWorkflowId({
      runtimeSessionId: session.id,
      runId: run.id,
      toolCallId,
    });
    if (prior) {
      const workflow = getWorkflow(session.user_id, prior.id);
      if (workflow) return workflowResponse(workflow, prior.warnings, true);
    }
    const definition: AuthoredWorkflowDefinition = {
      steps: Array.isArray(args.steps) ? (args.steps as AuthoredWorkflowDefinition["steps"]) : [],
      ...(Array.isArray(args.edges)
        ? { edges: args.edges as NonNullable<AuthoredWorkflowDefinition["edges"]> }
        : {}),
    };
    const authored = buildAuthoredWorkflowState(definition);
    const workflow = createWorkflow(session.user_id, {
      name,
      description: typeof args.description === "string" ? args.description : "",
      state: authored.state,
    });
    recordAuditEvent({
      eventType: "workflow.tool.create",
      runtimeSessionId: session.id,
      userId: session.user_id,
      gardenId: session.garden_id,
      payload: {
        runId: run.id,
        toolCallId,
        workflowId: workflow.id,
        name: workflow.name,
        blockCount: Object.keys(authored.state.blocks).length,
        warnings: authored.warnings,
      },
    });
    return workflowResponse(workflow, authored.warnings);
  } catch (error) {
    if (error instanceof WorkflowAuthoringError) {
      return apiErrorResponse(new ApiError(400, "invalid_workflow_definition", error.message));
    }
    if (runtimeSessionId !== null) {
      recordAuditEvent({
        eventType: "workflow.tool.create_failed",
        runtimeSessionId,
        payload: { reason: error instanceof ApiError ? error.code : "workflow_create_failed" },
      });
    }
    return apiErrorResponse(error);
  }
}
