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
import { createArtifact, presentArtifact, renderArtifact } from "@/lib/hermes/artifact-store.ts";
import { getConversationById, listRecentConversationMessages } from "@/lib/conversations/store.ts";
import { directoryForWorkspaceKey } from "@/lib/hermes/workspace.ts";
import { readHermesConfig } from "@/lib/hermes/config.ts";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server.ts";
import { selectedModelForUser } from "@/lib/selected-model.ts";
import { WatchServiceError } from "@/lib/hermes/watch-service.ts";
import {
  attachedSources,
  convertToMarkdown,
  TO_MARKDOWN_SKILLS,
  TO_MARKDOWN_TOOL,
  ToMarkdownError,
} from "@/lib/to-markdown.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** What the model reads back; the whole file is in the artifact. */
const PREVIEW_CHARS = 4000;

function filenameFor(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return `${slug || "converted"}.md`;
}

/**
 * Convert one attachment or URL to a Markdown artifact.
 *
 * Like the audio tool, no path is taken from the request: an attachment is
 * named by its filename and resolved from this conversation's own messages.
 */
export async function POST(request: Request) {
  let runtimeSessionId: number | null = null;
  try {
    requireEnabled();
    const verified = verifyCapabilityToken(capabilityForInternalToolRequest(request));
    if (!verified.ok || !tokenAllows(verified.token, { tool: TO_MARKDOWN_TOOL })) {
      throw new ApiError(403, "to_markdown_capability_denied", "Markdown conversion is not authorized.");
    }
    runtimeSessionId = Number(verified.token.breadboardSessionId);
    const session = getRuntimeSessionById(runtimeSessionId);
    if (
      !session ||
      session.user_id === null ||
      session.conversation_id === null ||
      (session.surface !== "dashboard_terminal" && session.surface !== "garden_chat") ||
      runtimeExternalSessionId(session) !== verified.token.hermesSessionId ||
      verified.token.conversationId !== session.conversation_id
    ) {
      throw new ApiError(403, "to_markdown_session_scope_mismatch", "Markdown conversion is available only in an authenticated chat session.");
    }
    const conversation = getConversationById(session.conversation_id);
    if (!conversation) {
      throw new ApiError(403, "to_markdown_conversation_missing", "The conversation is unavailable.");
    }
    const run = getActiveRuntimeRun(session.id);
    if (!run) throw new ApiError(409, "to_markdown_run_required", "Markdown conversion requires a current run.");
    const decision = getActiveCapabilityDecision(session.id);
    const skill = TO_MARKDOWN_SKILLS.find((slug) => decision?.selectedConditionalSkills.includes(slug));
    if (!decision || !decision.allowedTools.includes(TO_MARKDOWN_TOOL) || !skill) {
      throw new ApiError(403, "to_markdown_skill_not_selected", "Select one of the *-to-markdown skills for this turn.");
    }

    const body = await readJsonBody(request, 16 * 1024);
    const args = body.args && typeof body.args === "object" && !Array.isArray(body.args)
      ? (body.args as Record<string, unknown>)
      : {};
    const source = typeof args.source === "string" ? args.source.trim().slice(0, 2000) : "";
    if (!source) throw new ApiError(400, "to_markdown_source_required", "Pass `source`: a URL or an attached filename.");
    const title = typeof args.title === "string" ? args.title.trim().slice(0, 240) : "";

    // The model this chat turn runs on, i.e. the one picked in the chat selector.
    const dispatch = parseRuntimeRunDispatch(run);
    const model = dispatch.model?.modelID || dispatch.modelIdentity?.modelID || selectedModelForUser(session.user_id);

    recordAuditEvent({
      eventType: "to_markdown.started",
      runtimeSessionId: session.id,
      userId: session.user_id,
      payload: { runId: run.id, skill, sourceKind: /^https?:\/\//i.test(source) ? "url" : "attachment" },
    });
    const result = await convertToMarkdown({
      source,
      title,
      userId: session.user_id,
      conversationId: conversation.public_id,
      attachments: attachedSources(session.user_id, listRecentConversationMessages(session.conversation_id, 12)),
      model,
      baseURL: resolveChatmockBaseUrl(request).baseURL,
      workspaceRoot: session.active_directory ?? directoryForWorkspaceKey(readHermesConfig(), session.workspace_key),
      signal: request.signal,
    });

    const markdown = `# ${result.title}\n\n${result.markdown.trim()}\n`;
    const artifact = await renderArtifact({
      artifact: createArtifact({
        userId: session.user_id,
        runtimeSessionId: session.id,
        hermesSessionId: runtimeExternalSessionId(session)!,
        conversationId: session.conversation_id,
        clusterId: session.cluster_id,
        runId: run.id,
        assistantMessageId: null,
        toolCallId: typeof body.toolCallId === "string" ? body.toolCallId.slice(0, 200) : null,
        surface: session.surface,
        kind: "markdown",
        rendererId: "markdown",
        title: result.title,
        filename: filenameFor(result.title),
        content: markdown,
        metadata: { sourceSkill: skill, source, method: result.method },
        sourceSkill: skill,
        sourceHermesTool: TO_MARKDOWN_TOOL,
      }),
      runId: run.id,
      assistantMessageId: null,
    });
    recordAuditEvent({
      eventType: "to_markdown.completed",
      runtimeSessionId: session.id,
      userId: session.user_id,
      payload: { runId: run.id, artifactId: artifact.id, characters: markdown.length, method: result.method },
    });
    return NextResponse.json({
      ok: true,
      data: {
        artifact: presentArtifact(artifact),
        method: result.method,
        characters: markdown.length,
        preview: markdown.slice(0, PREVIEW_CHARS),
        truncatedPreview: markdown.length > PREVIEW_CHARS,
      },
    });
  } catch (error) {
    if (runtimeSessionId !== null) {
      recordAuditEvent({
        eventType: "to_markdown.failed",
        runtimeSessionId,
        payload: {
          reason: error instanceof ToMarkdownError || error instanceof WatchServiceError || error instanceof ApiError
            ? error.code
            : "to_markdown_failed",
        },
      });
    }
    if (error instanceof ToMarkdownError) {
      return apiErrorResponse(new ApiError(error.status, error.code, error.message));
    }
    if (error instanceof WatchServiceError) {
      return apiErrorResponse(new ApiError(502, error.code, error.message));
    }
    if (error instanceof Error && !(error instanceof ApiError)) {
      // Reader and parser failures carry a usable message; say it rather than a bare 500.
      return apiErrorResponse(new ApiError(502, "to_markdown_failed", error.message.slice(0, 800)));
    }
    return apiErrorResponse(error);
  }
}
