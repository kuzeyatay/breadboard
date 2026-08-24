import path from "node:path";

import { NextResponse } from "next/server";

import db from "@/lib/db";
import { editDocument } from "@/lib/genoffice/agent-query.ts";
import { convertPdfDocument } from "@/lib/genoffice/pdf-query.ts";
import { GenOfficeError } from "@/lib/genoffice/types.ts";
import {
  createImportedArtifact,
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
import { officeWorkspaceFor, prepareOfficeExport } from "@/lib/office/agent-query.ts";

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
    const willWrite = toolName === "pdf_to_docx" || (Array.isArray(args.patches) && args.patches.length > 0);
    const run = willWrite ? getActiveRuntimeRun(session.id) : null;
    if (willWrite && !run) {
      throw new ApiError(409, "document_run_required", `${toolName} requires a current Hermes run.`);
    }
    const result = toolName === "document_edit"
      ? await editDocument(workspace, args)
      : await convertPdfDocument(workspace, args);
    const patchResult = "operation" in result && result.operation === "patch" ? result : null;
    const conversionResult = "operation" in result ? null : result;

    let data: unknown = result;
    const producesArtifact = patchResult !== null || conversionResult !== null;
    if (producesArtifact) {
      if (!run) {
        throw new ApiError(409, "document_run_required", `${toolName} requires a current Hermes run.`);
      }
      const output = result as Extract<typeof result, { outputPath: string }>;
      const relativeOutput = pathRelative(workspace, output.outputPath);
      const staged = await prepareOfficeExport(workspace, {
        file: relativeOutput,
        title: output.title,
      });
      try {
        const dispatch = parseRuntimeRunDispatch(run);
        const artifact = createImportedArtifact({
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
          toolCallId: typeof body.toolCallId === "string" ? body.toolCallId.slice(0, 200) : null,
          surface: session.surface as "dashboard_terminal" | "garden_chat",
          kind: staged.kind,
          title: staged.title,
          filename: staged.filename,
          metadata: {
            genoffice: true,
            sourceFile: result.file,
            ...(conversionResult
              ? { pdfToDocx: true, pages: conversionResult.pages, warnings: conversionResult.warnings }
              : { documentEdit: true, patched: patchResult!.patched }),
          },
          sourceSkill: "office",
          sourceHermesTool: toolName,
          authorizedRoot: workspace,
          filePath: staged.filePath,
          previewFilePath: staged.previewFilePath,
        });
        data = {
          ...result,
          outputPath: relativeOutput,
          artifact: presentArtifact(artifact),
          previewRendered: staged.previewFilePath !== null,
        };
      } finally {
        staged.cleanup();
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
        operation: "operation" in result ? result.operation : "convert",
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
    if (error instanceof GenOfficeError || error instanceof ArtifactStoreError) {
      return apiErrorResponse(new ApiError(error.status, error.code, error.message));
    }
    return apiErrorResponse(error);
  }
}

function pathRelative(workspace: string, filePath: string): string {
  return path.relative(workspace, filePath).replaceAll("\\", "/");
}
