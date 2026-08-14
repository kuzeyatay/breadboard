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
import { listRecentConversationMessages } from "@/lib/conversations/store.ts";
import db from "@/lib/db";
import { WATERMARK_TOOLS, WATERMARK_WRITE_TOOLS } from "@/lib/hermes/tool-scopes.ts";
import {
  createImportedArtifact,
  presentArtifact,
  ArtifactStoreError,
} from "@/lib/hermes/artifact-store.ts";
import { cleanableAttachments, RECENT_MESSAGE_LOOKBACK } from "@/lib/watermarks/attachments.ts";
import {
  WatermarkError,
  auditWorkspace,
  cleanSource,
  inspectSource,
  watermarkWorkspaceFor,
} from "@/lib/watermarks/agent-query.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Internal server-to-server endpoint for the Hermes `watermark_*` tools. Not a
 * browser API: it authenticates with the same short-lived capability token the
 * gateway mints, which pins the user, the surface and the conversation.
 *
 * These tools run the vendored watermarks-remover scripts — stdlib Python that
 * strips invisible Unicode carriers, C2PA manifests, EXIF/XMP blocks and
 * document container properties. Three things bound them:
 *
 *   * Every path argument is resolved against the turn's workspace and refused
 *     if it escapes — the same root the Office and workspace tools work in.
 *   * An attachment is never addressed by path. The model names the file it was
 *     shown, and the bytes are found in the caller's own conversation, out of
 *     stores whose layout already proves whose the file is.
 *   * The capability decision for the turn is revalidated here, so a tool the
 *     turn was not granted is refused at the data boundary as well as at the
 *     runtime.
 *
 * A cleaned file is registered as an artifact through `createImportedArtifact`
 * so the user can actually open and download it — a cleaned copy the user
 * cannot retrieve is not a cleaned copy.
 */
export async function POST(request: Request) {
  let runtimeSessionId: number | null = null;
  let toolName = "";
  try {
    requireEnabled();
    const rawToken = capabilityForInternalToolRequest(request);
    const body = await readJsonBody(request, 512 * 1024);
    toolName = typeof body.tool === "string" ? body.tool : "";
    if (!WATERMARK_TOOLS.includes(toolName as (typeof WATERMARK_TOOLS)[number])) {
      throw new ApiError(400, "watermarks_unknown_tool", "Unknown watermark tool.");
    }

    const verified = verifyCapabilityToken(rawToken);
    if (!verified.ok || !tokenAllows(verified.token, { tool: toolName })) {
      throw new ApiError(403, "watermarks_capability_denied", "Watermark tools are not authorized.");
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
      throw new ApiError(403, "watermarks_session_scope_mismatch", "Watermark session scope is invalid.");
    }
    const decision = getActiveCapabilityDecision(session.id);
    if (decision && !decision.allowedTools.includes(toolName)) {
      throw new ApiError(
        403,
        "watermarks_tool_not_granted",
        "Watermark tools are not available on this turn.",
      );
    }

    const args =
      body.args && typeof body.args === "object" && !Array.isArray(body.args)
        ? (body.args as Record<string, unknown>)
        : {};
    const workspace = watermarkWorkspaceFor(session);
    // Only paid for when a source could be an attachment: the audit sweeps the
    // workspace and never looks at the transcript.
    const attachments =
      toolName === "watermark_audit"
        ? []
        : cleanableAttachments(
            session.user_id,
            listRecentConversationMessages(session.conversation_id, RECENT_MESSAGE_LOOKBACK),
          );

    let data: unknown;
    if (toolName === "watermark_inspect") {
      data = await inspectSource(workspace, args, attachments);
    } else if (toolName === "watermark_audit") {
      data = await auditWorkspace(workspace, args);
    } else {
      const staged = await cleanSource(workspace, args, attachments);
      try {
        // Inline text goes straight back as text; there is no file to deliver.
        if (staged.cleanedText !== undefined) {
          data = {
            source: staged.source,
            sourceKind: staged.sourceKind,
            changed: staged.changed,
            cleanedText: staged.cleanedText,
            report: staged.report,
          };
        } else {
          const run = getActiveRuntimeRun(session.id);
          const artifact =
            run && staged.artifactKind && staged.outputPath
              ? createImportedArtifact({
                  userId: session.user_id,
                  runtimeSessionId: session.id,
                  hermesSessionId: runtimeExternalSessionId(session)!,
                  conversationId: session.conversation_id,
                  clusterId: session.cluster_id,
                  runId: run.id,
                  assistantMessageId: assistantMessageIdFor(session, run),
                  toolCallId: typeof body.toolCallId === "string" ? body.toolCallId.slice(0, 200) : null,
                  surface: session.surface as "dashboard_terminal" | "garden_chat",
                  kind: staged.artifactKind,
                  title: staged.artifactTitle ?? "Cleaned file",
                  filename: staged.artifactFilename ?? "cleaned",
                  metadata: { watermarksCleaned: true, sourceFile: staged.source },
                  sourceHermesTool: "watermark_clean",
                  authorizedRoot: workspace,
                  filePath: staged.outputPath,
                })
              : null;
          data = {
            source: staged.source,
            sourceKind: staged.sourceKind,
            changed: staged.changed,
            outputFile: staged.outputFile,
            report: staged.report,
            ...(artifact ? { artifact: presentArtifact(artifact) } : {}),
          };
        }
      } finally {
        staged.cleanup();
      }
    }

    recordAuditEvent({
      eventType: "watermarks.tool_completed",
      runtimeSessionId: session.id,
      userId: session.user_id,
      gardenId: session.garden_id,
      // Stripping provenance is exactly the kind of thing worth being able to
      // find later, so the payload names which tool ran and whether it wrote.
      payload: { tool: toolName, write: WATERMARK_WRITE_TOOLS.includes(toolName) },
    });
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (runtimeSessionId !== null) {
      recordAuditEvent({
        eventType: "watermarks.tool_failed",
        runtimeSessionId,
        payload: {
          tool: toolName,
          reason: error instanceof ApiError ? error.code : "watermarks_tool_failed",
        },
      });
    }
    if (error instanceof WatermarkError) {
      // "draft.md does not exist in the workspace" already says what to fix, so
      // it is passed through rather than reduced to a status the model can only
      // retry against.
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

/** The assistant message this run is writing, so the artifact binds to it. */
function assistantMessageIdFor(
  session: { conversation_id: number | null },
  run: Parameters<typeof parseRuntimeRunDispatch>[0],
): number | null {
  const dispatch = parseRuntimeRunDispatch(run);
  if (!dispatch.clientMessageId) return null;
  const row = db.prepare(`
    SELECT id FROM conversation_messages
    WHERE conversation_id = ? AND client_message_id = ? AND role = 'assistant'
  `).get(session.conversation_id, dispatch.clientMessageId) as { id: number } | undefined;
  return row?.id ?? null;
}
