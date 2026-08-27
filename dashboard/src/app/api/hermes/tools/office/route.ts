import path from "node:path";

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
  getArtifactById,
  presentArtifact,
  ArtifactStoreError,
} from "@/lib/hermes/artifact-store.ts";
import { OfficeCliError, officeWorkspaceFor } from "@/lib/office/contract.ts";
import {
  prepareOfficeExportViaRuntime,
  runOfficeCommandViaRuntime,
} from "@/lib/office/runtime-v2.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function completedOfficeExport(input: {
  userId: number;
  runtimeSessionId: number;
  conversationId: number;
  runId: string;
  toolCallId: string | null;
}): unknown | null {
  // A tool-call id is the stable publication fence. Returning its already
  // promoted artifact makes a retried request independent of the disposable
  // worker workspace and Runtime job-retention window.
  if (input.toolCallId === null) return null;
  const row = db.prepare(`
    SELECT id
    FROM hermes_artifacts
    WHERE user_id = ?
      AND runtime_session_id = ?
      AND conversation_id = ?
      AND originating_run_id = ?
      AND originating_tool_call_id = ?
      AND source_skill = 'office'
      AND source_hermes_tool = 'office_export'
      AND status = 'ready'
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `).get(
    input.userId,
    input.runtimeSessionId,
    input.conversationId,
    input.runId,
    input.toolCallId,
  ) as { id: string } | undefined;
  if (!row) return null;
  const artifact = getArtifactById(row.id);
  if (!artifact) return null;
  const presented = presentArtifact(artifact);
  const file = typeof presented.metadata.officeFile === "string"
    ? presented.metadata.officeFile
    : artifact.filename;
  const previewRendered = typeof presented.metadata.officePreviewRendered === "boolean"
    ? presented.metadata.officePreviewRendered
    : Boolean(artifact.preview_location && artifact.preview_location !== artifact.output_location);
  return { artifact: presented, file, previewRendered };
}

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
    const conversation = db.prepare(
      "SELECT public_id FROM conversations WHERE id = ? AND user_id = ?",
    ).get(session.conversation_id, session.user_id) as { public_id: string } | undefined;
    if (!conversation?.public_id) {
      throw new ApiError(403, "office_conversation_scope_mismatch", "Office conversation scope is invalid.");
    }
    const officeScope = {
      userId: session.user_id,
      gardenId: session.garden_id,
      conversationId: conversation.public_id,
    };
    const toolCallId =
      typeof body.toolCallId === "string" ? body.toolCallId.slice(0, 200) : null;

    let data: unknown;
    if (toolName === "office_run") {
      data = await runOfficeCommandViaRuntime(
        { ...officeScope, runtimeSessionId: session.id },
        workspace,
        args,
        { idempotencySeed: toolCallId, signal: request.signal },
      );
    } else {
      const run = getActiveRuntimeRun(session.id);
      if (!run) {
        throw new ApiError(409, "office_run_required", "office_export requires a current Hermes run.");
      }
      const recovered = completedOfficeExport({
        userId: session.user_id,
        runtimeSessionId: session.id,
        conversationId: session.conversation_id,
        runId: run.id,
        toolCallId,
      });
      if (recovered) {
        data = recovered;
      } else {
        const dispatch = parseRuntimeRunDispatch(run);
        const assistantMessage = dispatch.clientMessageId
          ? db.prepare(`
              SELECT id FROM conversation_messages
              WHERE conversation_id = ? AND client_message_id = ? AND role = 'assistant'
            `).get(session.conversation_id, dispatch.clientMessageId) as { id: number } | undefined
          : undefined;
        const staged = await prepareOfficeExportViaRuntime(
          officeScope,
          workspace,
          args,
          { idempotencySeed: `${run.id}:${toolCallId ?? "office-export"}`, signal: request.signal },
        );
        try {
          const artifact = await createImportedArtifact({
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
            metadata: {
              officeExport: true,
              officeFile: staged.relativeFile,
              officePreviewRendered: staged.previewFilePath !== null,
            },
            sourceSkill: "office",
            sourceHermesTool: "office_export",
            authorizedRoot: path.dirname(staged.filePath),
            filePath: staged.filePath,
            previewFilePath: staged.previewFilePath,
            signal: request.signal,
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
