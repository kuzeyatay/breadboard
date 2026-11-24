// `workflow_update` — Bread changes one of the user's saved workflows.
//
// "get" reads the workflow back in the same step/edge form workflow_create
// takes; "update" compiles a complete new definition through the same native
// registry and replaces the saved graph. The workflow must belong to the
// session's user and be a canvas workflow, and the active instruction must ask
// for a change. The editor, if open, notices the new version and reloads it.

import { NextResponse } from "next/server";

import { conversationIsTemporary, getConversationById, listRecentConversationMessages } from "@/lib/conversations/store.ts";
import { tokenAllows, verifyCapabilityToken } from "@/lib/hermes/capability-token.ts";
import { ApiError, apiErrorResponse, readJsonBody, requireEnabled } from "@/lib/hermes/route-helpers.ts";
import { getActiveRuntimeRun } from "@/lib/hermes/run-store.ts";
import {
  getActiveCapabilityDecision,
  getRuntimeSessionById,
  recordAuditEvent,
  runtimeExternalSessionId,
} from "@/lib/hermes/runtime-store.ts";
import { capabilityForInternalToolRequest } from "@/lib/hermes/tool-service-auth.ts";
import {
  buildAuthoredWorkflowState,
  explicitlyRequestsWorkflowEdit,
  WORKFLOW_AUTHORING_GUIDE,
  WorkflowAuthoringError,
  workflowStateToDefinition,
  type AuthoredWorkflowDefinition,
} from "@/lib/workflows/authoring.ts";
import { getWorkflow, updateWorkflow } from "@/lib/workflows/store.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TOOL = "workflow_update";

export async function POST(request: Request) {
  let runtimeSessionId: number | null = null;
  try {
    requireEnabled();
    const verified = verifyCapabilityToken(capabilityForInternalToolRequest(request));
    if (!verified.ok || !tokenAllows(verified.token, { tool: TOOL })) {
      throw new ApiError(403, "workflow_update_denied", "Changing a workflow is not authorized for this turn.");
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
      throw new ApiError(403, "workflow_update_scope_mismatch", "Workflow editing session scope is invalid.");
    }
    const run = getActiveRuntimeRun(session.id);
    if (!run) {
      throw new ApiError(409, "workflow_update_run_required", "Changing a workflow requires a current chat run.");
    }
    const decision = getActiveCapabilityDecision(session.id);
    if (!decision || !decision.allowedTools.includes(TOOL)) {
      throw new ApiError(403, "workflow_update_denied", "Changing a workflow is not authorized for this turn.");
    }

    const body = await readJsonBody(request, 256 * 1024);
    const args =
      body.args && typeof body.args === "object" && !Array.isArray(body.args)
        ? (body.args as Record<string, unknown>)
        : {};
    const workflowId = typeof args.workflowId === "string" ? args.workflowId.trim() : "";
    if (!workflowId) throw new ApiError(400, "workflow_id_required", "workflowId is required.");
    const workflow = getWorkflow(session.user_id, workflowId);
    if (!workflow) throw new ApiError(404, "workflow_not_found", "That workflow does not exist.");
    if (workflow.source === "demonstration") {
      throw new ApiError(
        409,
        "workflow_taught",
        "This workflow was taught by demonstration; it has no blocks to edit. The user changes it by re-teaching it.",
      );
    }

    const current = workflowStateToDefinition(workflow.state);
    if (args.action === "get") {
      return NextResponse.json({
        ok: true,
        data: {
          workflow: { id: workflow.id, name: workflow.name, description: workflow.description },
          definition: { steps: current.steps, edges: current.edges },
          ...(current.unsupported.length ? { notEditable: current.unsupported } : {}),
          guide: WORKFLOW_AUTHORING_GUIDE,
          note: "Send the complete new definition back with action 'update'. Steps you leave out are removed.",
        },
      });
    }

    const previousAssistant =
      listRecentConversationMessages(session.conversation_id, 6)
        .filter((message) => message.role === "assistant")
        .at(-1)?.content ?? "";
    if (!explicitlyRequestsWorkflowEdit(run.instruction, previousAssistant)) {
      throw new ApiError(
        409,
        "workflow_update_intent_required",
        "The user did not ask to change this workflow. Describe the change and let them ask for it.",
      );
    }
    if (conversationIsTemporary(getConversationById(session.conversation_id))) {
      throw new ApiError(409, "temporary_chat", "A temporary chat cannot change a saved workflow.");
    }
    if (!Array.isArray(args.steps)) {
      throw new ApiError(400, "workflow_steps_required", "steps is required: send every step the workflow should have.");
    }

    const definition: AuthoredWorkflowDefinition = {
      steps: args.steps as AuthoredWorkflowDefinition["steps"],
      ...(Array.isArray(args.edges) ? { edges: args.edges as NonNullable<AuthoredWorkflowDefinition["edges"]> } : {}),
    };
    const authored = buildAuthoredWorkflowState(definition);
    const name = typeof args.name === "string" && args.name.trim() ? args.name.trim().slice(0, 200) : undefined;
    const description = typeof args.description === "string" ? args.description : undefined;
    updateWorkflow(session.user_id, workflow.id, { name, description, state: authored.state });
    const blockCount = Object.keys(authored.state.blocks).length;
    recordAuditEvent({
      eventType: "workflow.tool.update",
      runtimeSessionId: session.id,
      userId: session.user_id,
      gardenId: session.garden_id,
      payload: { runId: run.id, workflowId: workflow.id, blockCount, warnings: authored.warnings },
    });
    return NextResponse.json({
      ok: true,
      data: {
        workflow: {
          id: workflow.id,
          name: name ?? workflow.name,
          blockCount,
          url: `/workflows?workflow=${encodeURIComponent(workflow.id)}`,
        },
        warnings: authored.warnings,
        ...(current.unsupported.length ? { dropped: current.unsupported } : {}),
        note: "Saved. The workflow editor, if open, shows the new version.",
      },
    });
  } catch (error) {
    if (error instanceof WorkflowAuthoringError) {
      return apiErrorResponse(new ApiError(400, "invalid_workflow_definition", error.message));
    }
    if (runtimeSessionId !== null) {
      recordAuditEvent({
        eventType: "workflow.tool.update_failed",
        runtimeSessionId,
        payload: { reason: error instanceof ApiError ? error.code : "workflow_update_failed" },
      });
    }
    return apiErrorResponse(error);
  }
}
