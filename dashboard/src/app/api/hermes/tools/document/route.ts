import path from "node:path";

import { NextResponse } from "next/server";

import db from "@/lib/db";
import {
  createImportedArtifact,
  getArtifactById,
  presentArtifact,
  ArtifactStoreError,
} from "@/lib/hermes/artifact-store.ts";
import { tokenAllows, verifyCapabilityToken } from "@/lib/hermes/capability-token.ts";
import {
  ApiError,
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
} from "@/lib/hermes/route-helpers.ts";
import { getActiveRuntimeRun, parseRuntimeRunDispatch } from "@/lib/hermes/run-store.ts";
import {
  getActiveCapabilityDecision,
  getRuntimeSessionById,
  recordAuditEvent,
  runtimeExternalSessionId,
} from "@/lib/hermes/runtime-store.ts";
import { capabilityForInternalToolRequest } from "@/lib/hermes/tool-service-auth.ts";
import { DOCUMENT_TOOLS, DOCUMENT_WRITE_TOOLS } from "@/lib/hermes/tool-scopes.ts";
import { OfficeCliError, officeWorkspaceFor } from "@/lib/office/contract.ts";
import {
  promoteRuntimeOfficeOutput,
  runDocumentEditViaRuntime,
  runPdfToDocxViaRuntime,
} from "@/lib/office/runtime-v2.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function assistantMessageId(conversationId: number, clientMessageId: string | undefined): number | null {
  if (!clientMessageId) return null;
  const row = db.prepare(`
    SELECT id FROM conversation_messages
    WHERE conversation_id = ? AND client_message_id = ? AND role = 'assistant'
  `).get(conversationId, clientMessageId) as { id: number } | undefined;
  return row?.id ?? null;
}

function completedDocumentWrite(input: {
  userId: number;
  runtimeSessionId: number;
  conversationId: number;
  runId: string;
  toolName: string;
  toolCallId: string | null;
}): unknown | null {
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
      AND source_hermes_tool = ?
      AND status = 'ready'
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `).get(
    input.userId,
    input.runtimeSessionId,
    input.conversationId,
    input.runId,
    input.toolCallId,
    input.toolName,
  ) as { id: string } | undefined;
  if (!row) return null;
  const artifact = getArtifactById(row.id);
  if (!artifact) return null;
  const presented = presentArtifact(artifact);
  const saved = presented.metadata.documentToolResult;
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return null;
  return { ...saved, artifact: presented };
}

export async function POST(request: Request) {
  let runtimeSessionId: number | null = null;
  let toolName = "";
  try {
    requireEnabled();
    const rawToken = capabilityForInternalToolRequest(request);
    const body = await readJsonBody(request, 512 * 1024);
    toolName = typeof body.tool === "string" ? body.tool : "";
    if (!DOCUMENT_TOOLS.includes(toolName as (typeof DOCUMENT_TOOLS)[number])) {
      throw new ApiError(400, "document_unknown_tool", "Unknown document tool.");
    }

    const verified = verifyCapabilityToken(rawToken);
    if (!verified.ok || !tokenAllows(verified.token, { tool: toolName })) {
      throw new ApiError(403, "document_capability_denied", "Document conversion and editing tools are not authorized.");
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
      throw new ApiError(403, "document_session_scope_mismatch", "Document session scope is invalid.");
    }
    const decision = getActiveCapabilityDecision(session.id);
    if (decision && !decision.allowedTools.includes(toolName)) {
      throw new ApiError(403, "document_tool_not_granted", "Document tools are not available on this turn.");
    }

    const args = body.args && typeof body.args === "object" && !Array.isArray(body.args)
      ? body.args as Record<string, unknown>
      : {};
    const workspace = officeWorkspaceFor(session);
    const conversation = db.prepare(
      "SELECT public_id FROM conversations WHERE id = ? AND user_id = ?",
    ).get(session.conversation_id, session.user_id) as { public_id: string } | undefined;
    if (!conversation?.public_id) {
      throw new ApiError(403, "document_conversation_scope_mismatch", "Document conversation scope is invalid.");
    }
    const willWrite = toolName === "pdf_to_docx" || (Array.isArray(args.patches) && args.patches.length > 0);
    const run = willWrite ? getActiveRuntimeRun(session.id) : null;
    if (willWrite && !run) {
      throw new ApiError(409, "document_run_required", `${toolName} requires a current Hermes run.`);
    }
    const toolCallId = typeof body.toolCallId === "string" ? body.toolCallId.slice(0, 200) : null;
    const scope = {
      userId: session.user_id,
      gardenId: session.garden_id,
      conversationId: conversation.public_id,
    };
    const recovered = run && willWrite
      ? completedDocumentWrite({
          userId: session.user_id,
          runtimeSessionId: session.id,
          conversationId: session.conversation_id,
          runId: run.id,
          toolName,
          toolCallId,
        })
      : null;

    let data: unknown;
    let operationForAudit = "inspect";
    if (recovered) {
      data = recovered;
      operationForAudit = toolName === "pdf_to_docx" ? "convert" : "patch";
    } else {
      const operation = toolName === "document_edit"
        ? await runDocumentEditViaRuntime(scope, workspace, args, {
            idempotencySeed: `${run?.id ?? "inspect"}:${toolCallId ?? toolName}`,
            signal: request.signal,
          })
        : await runPdfToDocxViaRuntime(scope, workspace, args, {
            idempotencySeed: `${run!.id}:${toolCallId ?? toolName}`,
            signal: request.signal,
          });
      if (!("cleanup" in operation)) {
        operationForAudit = operation.operation;
        data = operation;
      } else {
        const staged = operation;
        const result = staged.result;
        operationForAudit = "operation" in result ? result.operation : "convert";
        data = result;
        if (!run) {
          staged.cleanup();
          throw new ApiError(409, "document_run_required", `${toolName} requires a current Hermes run.`);
        }
        try {
          const outputPath = promoteRuntimeOfficeOutput(workspace, staged);
          const relativeOutput = pathRelative(workspace, outputPath);
          const exposedResult = {
            ...result,
            outputPath: relativeOutput,
            previewRendered: staged.previewFilePath !== null,
          };
          const dispatch = parseRuntimeRunDispatch(run);
          const artifact = await createImportedArtifact({
            userId: session.user_id,
            runtimeSessionId: session.id,
            hermesSessionId: runtimeExternalSessionId(session)!,
            conversationId: session.conversation_id,
            clusterId: session.cluster_id,
            runId: run.id,
            assistantMessageId: assistantMessageId(
              session.conversation_id,
              dispatch.clientMessageId,
            ),
            toolCallId,
            surface: session.surface as "dashboard_terminal" | "garden_chat",
            kind: result.kind,
            title: result.title,
            filename: result.filename,
            metadata: {
              genoffice: true,
              sourceFile: result.file,
              documentToolResult: exposedResult,
              ...("pages" in result
                ? { pdfToDocx: true, pages: result.pages, warnings: result.warnings }
                : { documentEdit: true, patched: result.patched }),
            },
            sourceSkill: "office",
            sourceHermesTool: toolName,
            authorizedRoot: path.dirname(staged.filePath),
            filePath: staged.filePath,
            previewFilePath: staged.previewFilePath,
            signal: request.signal,
          });
          data = {
            ...exposedResult,
            artifact: presentArtifact(artifact),
          };
        } finally {
          staged.cleanup();
        }
      }
    }

    recordAuditEvent({
      eventType: "document.tool_completed",
      runtimeSessionId: session.id,
      userId: session.user_id,
      gardenId: session.garden_id,
      payload: {
        tool: toolName,
        write: DOCUMENT_WRITE_TOOLS.includes(toolName),
        operation: operationForAudit,
      },
    });
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (runtimeSessionId !== null) {
      recordAuditEvent({
        eventType: "document.tool_failed",
        runtimeSessionId,
        payload: {
          tool: toolName,
          error: error instanceof Error ? error.message : "unknown",
        },
      });
    }
    if (error instanceof OfficeCliError || error instanceof ArtifactStoreError) {
      return apiErrorResponse(new ApiError(error.status, error.code, error.message));
    }
    return apiErrorResponse(error);
  }
}

function pathRelative(workspace: string, filePath: string): string {
  return path.relative(workspace, filePath).replaceAll("\\", "/");
}
