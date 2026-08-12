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
import { getActiveRuntimeRun, parseRuntimeRunDispatch } from "@/lib/hermes/run-store.ts";
import db from "@/lib/db";
import { OFFICE_TOOLS, OFFICE_WRITE_TOOLS } from "@/lib/hermes/tool-scopes.ts";
import {
  createImportedArtifact,
  presentArtifact,
  ArtifactStoreError,
} from "@/lib/hermes/artifact-store.ts";
import {
  OfficeCliError,
  officeWorkspaceFor,
  prepareOfficeExport,
  runOfficeCommand,
} from "@/lib/office/agent-query.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Internal server-to-server endpoint for the Hermes `office_*` tools. Not a
 * browser API: it authenticates with the same short-lived capability token the
 * gateway mints, which pins the user, the surface and the conversation.
 *
 * `office_run` executes one command of the pinned OfficeCLI binary. Three
 * things bound it:
 *
 *   * Every filesystem reference in the command is resolved against the turn's
 *     workspace and refused if it escapes — the same root `artifact_import`
 *     trusts, or a per-conversation document workspace when the session has
 *     none.
 *   * The command's subcommand must be on an explicit allowlist; server-mode
 *     subcommands (`mcp`, `watch`) and plugin management are refused by name.
 *   * The capability decision for the turn is revalidated here, so a tool the
 *     turn was not granted is refused at the data boundary as well as at the
 *     runtime.
 *
 * `office_export` registers a finished document as an artifact through
 * `createImportedArtifact` — magic-byte sniffing, workspace containment and
 * atomic copy included — with an OfficeCLI-rendered HTML snapshot as the
 * artifact's preview when one can be produced.
 */
export async function POST(request: Request) {
  let runtimeSessionId: number | null = null;
  let toolName = "";
  try {
    requireEnabled();
    const rawToken = capabilityForInternalToolRequest(request);
    const body = await readJsonBody(request, 256 * 1024);
    toolName = typeof body.tool === "string" ? body.tool : "";
    if (!OFFICE_TOOLS.includes(toolName as (typeof OFFICE_TOOLS)[number])) {
      throw new ApiError(400, "office_unknown_tool", "Unknown office tool.");
    }

    const verified = verifyCapabilityToken(rawToken);
    if (!verified.ok || !tokenAllows(verified.token, { tool: toolName })) {
      throw new ApiError(403, "office_capability_denied", "Office document tools are not authorized.");
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
      throw new ApiError(403, "office_session_scope_mismatch", "Office session scope is invalid.");
    }
    const decision = getActiveCapabilityDecision(session.id);
    if (decision && !decision.allowedTools.includes(toolName)) {
      throw new ApiError(
        403,
        "office_tool_not_granted",
        "Office document tools are not available on this turn.",
      );
    }

    const args =
      body.args && typeof body.args === "object" && !Array.isArray(body.args)
        ? (body.args as Record<string, unknown>)
        : {};
    const workspace = officeWorkspaceFor(session);

    let data: unknown;
    if (toolName === "office_run") {
      data = await runOfficeCommand(workspace, args);
    } else {
      const run = getActiveRuntimeRun(session.id);
      if (!run) {
        throw new ApiError(409, "office_run_required", "office_export requires a current Hermes run.");
      }
      const dispatch = parseRuntimeRunDispatch(run);
      const assistantMessage = dispatch.clientMessageId
        ? db.prepare(`
            SELECT id FROM conversation_messages
            WHERE conversation_id = ? AND client_message_id = ? AND role = 'assistant'
          `).get(session.conversation_id, dispatch.clientMessageId) as { id: number } | undefined
        : undefined;
      const toolCallId =
        typeof body.toolCallId === "string" ? body.toolCallId.slice(0, 200) : null;
      const staged = await prepareOfficeExport(workspace, args);
      try {
        const artifact = createImportedArtifact({
          userId: session.user_id,
          runtimeSessionId: session.id,
          hermesSessionId: runtimeExternalSessionId(session)!,
          conversationId: session.conversation_id,
          clusterId: session.cluster_id,
          runId: run.id,
          assistantMessageId: assistantMessage?.id ?? null,
          toolCallId,
          surface: session.surface as "dashboard_terminal" | "garden_chat",
          kind: staged.kind,
          title: staged.title,
          filename: staged.filename,
          metadata: { officeExport: true, officeFile: staged.relativeFile },
          sourceHermesTool: "office_export",
          authorizedRoot: workspace,
          filePath: staged.filePath,
          previewFilePath: staged.previewFilePath,
        });
        data = {
          artifact: presentArtifact(artifact),
          file: staged.relativeFile,
          previewRendered: staged.previewFilePath !== null,
        };
      } finally {
        staged.cleanup();
      }
    }

    recordAuditEvent({
      eventType: "office.tool_completed",
      runtimeSessionId: session.id,
      userId: session.user_id,
      gardenId: session.garden_id,
      // A write is worth being able to find later; the payload names which one.
      payload: { tool: toolName, write: OFFICE_WRITE_TOOLS.includes(toolName) },
    });
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (runtimeSessionId !== null) {
      recordAuditEvent({
        eventType: "office.tool_failed",
        runtimeSessionId,
        payload: {
          tool: toolName,
          reason: error instanceof ApiError ? error.code : "office_tool_failed",
        },
      });
    }
    if (error instanceof OfficeCliError) {
      // "report.docx does not exist in the workspace" already says what to
      // fix, so it is passed through rather than reduced to a status the model
      // can only retry against.
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status },
      );
    }
    if (error instanceof ArtifactStoreError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status },
      );
    }
    return apiErrorResponse(error);
  }
}
