import { NextResponse } from "next/server";
import { apiErrorResponse, readJsonBody, requireEnabled, ApiError } from "@/lib/hermes/route-helpers.ts";
import { capabilityForInternalToolRequest } from "@/lib/hermes/tool-service-auth.ts";
import { humanizeStoredText } from "@/lib/humanizer/auto-server.ts";
import { tokenAllows, verifyCapabilityToken } from "@/lib/hermes/capability-token.ts";
import {
  getActiveCapabilityDecision,
  getRuntimeSessionById,
  recordAuditEvent,
  runtimeExternalSessionId,
} from "@/lib/hermes/runtime-store.ts";
import { getActiveRuntimeRun, parseRuntimeRunDispatch } from "@/lib/hermes/run-store.ts";
import { listMcpConnections } from "@/lib/hermes/mcp-connections.ts";
import db from "@/lib/db";
import {
  addArtifactProvenance,
  createArtifact,
  createImportedArtifact,
  presentArtifact,
  readArtifactSource,
  renderArtifact,
  updateArtifactContent,
  ArtifactStoreError,
} from "@/lib/hermes/artifact-store.ts";
import {
  describeAgentArtifactScope,
  getArtifactInAgentScope,
  listArtifactsInAgentScope,
  type AgentArtifactScope,
} from "@/lib/hermes/artifact-agent-scope.ts";
import { searchArtifactsForAgent } from "@/lib/hermes/artifact-agent-search.ts";
import { ARTIFACT_KINDS, type ArtifactKind } from "@/lib/hermes/artifact-types.ts";
import { artifactEditorMode } from "@/lib/hermes/artifact-editor-types.ts";
import { loadArtifactEditor, saveArtifactEditor, type ArtifactEditorPatch } from "@/lib/hermes/artifact-document-editor.ts";
import { availableArtifactRenderers } from "@/lib/hermes/artifact-renderers.ts";
import {
  cancelInteractiveVisualizer,
  createInteractiveVisualizer,
  generateInteractiveVisualizer,
  planInteractiveVisualizer,
  rollbackInteractiveVisualizer,
} from "@/lib/hermes/interactive-visualizer-service.ts";
import { interactiveVisualizerAvailable } from "@/lib/hermes/interactive-visualizer-config.ts";
import { selectedInteractiveVisualizerSkill } from "@/lib/hermes/interactive-visualizer-skills.ts";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server.ts";
import {
  ArtifactImageServiceError,
  generateArtifactImage,
  importArtifactImage,
} from "@/lib/hermes/artifact-image-service.ts";
import {
  readGoogleImageGenerationCredentials,
} from "@/lib/hermes/google-image-generation-credentials.ts";
import {
  generateGoogleImage,
  generatedImageFilename,
} from "@/lib/hermes/google-image-generation-service.ts";

export const dynamic = "force-dynamic";
const ACTIONS = new Set([
  "artifact_create", "artifact_import", "artifact_read", "artifact_update", "artifact_append",
  "artifact_render", "artifact_finalize", "artifact_list", "artifact_search", "artifact_fork",
  "artifact_image_generate",
  "interactive_visualizer_create",
  "interactive_visualizer_plan", "interactive_visualizer_generate",
  "interactive_visualizer_revise", "interactive_visualizer_rollback",
  "interactive_visualizer_cancel",
]);

export async function POST(request: Request) {
  try {
    requireEnabled();
    const rawToken = capabilityForInternalToolRequest(request);
    const verified = verifyCapabilityToken(rawToken);
    const body = await readJsonBody(request, 6 * 1024 * 1024);
    const action = typeof body.action === "string" && ACTIONS.has(body.action) ? body.action : "";
    if (!verified.ok || !action || !tokenAllows(verified.token, { tool: action })) {
      throw new ApiError(403, "artifact_capability_denied", "Artifact access is not authorized.");
    }
    const runtimeSessionId = Number(verified.token.breadboardSessionId);
    const session = getRuntimeSessionById(runtimeSessionId);
    if (
      !session || session.user_id === null || session.conversation_id === null ||
      !["dashboard_terminal", "garden_chat"].includes(session.surface) ||
      runtimeExternalSessionId(session) !==
        verified.token.hermesSessionId ||
      verified.token.conversationId !== session.conversation_id
    ) {
      throw new ApiError(403, "artifact_session_scope_mismatch", "Artifact session scope is invalid.");
    }
    const run = getActiveRuntimeRun(session.id);
    if (!run) throw new ApiError(409, "artifact_run_required", "Artifact tools require a current Hermes run.");
    const args = body.args && typeof body.args === "object" && !Array.isArray(body.args)
      ? body.args as Record<string, unknown>
      : {};
    const dispatch = parseRuntimeRunDispatch(run);
    const activeDecision = getActiveCapabilityDecision(session.id);
    const selectedMcpServers = new Set(activeDecision?.selectedConnections ?? []);
    const selectedSkills = new Set(activeDecision?.selectedConditionalSkills ?? []);
    const artifactScope: AgentArtifactScope = {
      userId: session.user_id,
      surface: session.surface as "dashboard_terminal" | "garden_chat",
      clusterId: session.cluster_id,
      gardenSlug: session.garden_id,
    };
    const assistantMessage = dispatch.clientMessageId
      ? db.prepare(`
          SELECT id FROM conversation_messages
          WHERE conversation_id = ? AND client_message_id = ? AND role = 'assistant'
        `).get(session.conversation_id, dispatch.clientMessageId) as { id: number } | undefined
      : undefined;
    const toolCallId = text(body.toolCallId, 200) ?? null;

    const visualizerAction = action.startsWith("interactive_visualizer_");
    const visualizerSkill = selectedInteractiveVisualizerSkill(selectedSkills);
    if (
      visualizerAction &&
      !interactiveVisualizerAvailable(session.surface, true)
    ) {
      throw new ApiError(
        503,
        "interactive_visualizer_disabled",
        "Interactive visualizers are disabled or their required browser publication gate is unavailable.",
      );
    }
    if (visualizerAction && !visualizerSkill) {
      throw new ApiError(
        403,
        "interactive_visualizer_skill_not_selected",
        "Select interactive-visualizer or interactive-visualizer-in-chat for this turn.",
      );
    }
    const visualizerContext = {
      userId: session.user_id,
      runtimeSessionId: session.id,
      hermesSessionId: runtimeExternalSessionId(session)!,
      conversationId: session.conversation_id,
      clusterId: session.cluster_id,
      runId: run.id,
      assistantMessageId: assistantMessage?.id ?? null,
      toolCallId,
      surface: session.surface as "dashboard_terminal" | "garden_chat",
      sourceSkill: visualizerSkill ?? "interactive-visualizer",
    };

    let result: unknown;
    if (action === "interactive_visualizer_create") {
      result = await createInteractiveVisualizer({
        context: visualizerContext,
        title: requiredText(args.title, "title", 240),
        plan: record(args.plan),
        packageValue: record(args.package),
      });
    } else if (action === "interactive_visualizer_plan") {
      result = planInteractiveVisualizer({
        context: visualizerContext,
        title: requiredText(args.title, "title", 240),
        plan: record(args.plan),
      });
    } else if (
      action === "interactive_visualizer_generate" ||
      action === "interactive_visualizer_revise"
    ) {
      const artifact = authorizedArtifact(
        requiredText(args.artifactId, "artifactId", 100),
        artifactScope,
      );
      result = await generateInteractiveVisualizer({
        context: visualizerContext,
        artifact,
        packageValue: record(args.package),
        operation: action === "interactive_visualizer_revise" ? "revise" : "create",
        revisionPrompt: text(args.revisionPrompt, 4_000),
      });
    } else if (action === "interactive_visualizer_rollback") {
      const artifact = authorizedArtifact(
        requiredText(args.artifactId, "artifactId", 100),
        artifactScope,
      );
      const version = Number(args.version);
      if (!Number.isInteger(version) || version <= 0) {
        throw new ApiError(400, "invalid_artifact_version", "A valid version is required.");
      }
      result = rollbackInteractiveVisualizer({
        context: visualizerContext,
        artifact,
        version,
      });
    } else if (action === "interactive_visualizer_cancel") {
      const artifact = authorizedArtifact(
        requiredText(args.artifactId, "artifactId", 100),
        artifactScope,
      );
      result = await cancelInteractiveVisualizer({
        context: visualizerContext,
        artifact,
      });
    } else if (action === "artifact_image_generate") {
      const prompt = requiredText(args.prompt, "prompt", 4_000);
      const title = text(args.title, 240) ?? generatedImageTitle(prompt);
      const conversationPublicId = requiredText(
        dispatch.conversationPublicId,
        "conversationPublicId",
        200,
      );
      const imageArtifactContext = {
        userId: session.user_id,
        conversationPublicId,
        runtimeSessionId: session.id,
        hermesSessionId: runtimeExternalSessionId(session)!,
        conversationId: session.conversation_id,
        clusterId: session.cluster_id,
        surface: session.surface as "dashboard_terminal" | "garden_chat",
        runId: run.id,
      };
      // Provider selection ends before persistence starts. An artifact-store
      // failure must never be mistaken for a provider failure or spend a
      // second image-generation request on an unrelated Gemini fallback.
      const generated = await generateImageWithProviderFallback({
        userId: session.user_id,
        baseURL: resolveChatmockBaseUrl(request).baseURL,
        prompt,
        signal: request.signal,
      });
      const artifact = await importArtifactImage({
        context: imageArtifactContext,
        buffer: generated.buffer,
        title,
        filename: generated.filename,
        assistantMessageId: assistantMessage?.id ?? null,
        toolCallId,
        sourceTool: "artifact_image_generate",
        metadata: {
          imageOperation: "generate",
          imagePrompt: prompt,
          generationVerified: true,
          ...generated.providerMetadata,
        },
      });
      result = {
        artifact: presentArtifact(artifact),
        verified: artifact.status === "ready" && Boolean(artifact.content_hash),
        ...(generated.fallback ? { fallback: generated.fallback } : {}),
      };
    } else if (action === "artifact_list") {
      const artifacts = listArtifactsInAgentScope(artifactScope);
      result = {
        scope: describeAgentArtifactScope(artifactScope),
        artifacts: artifacts.map(presentArtifact),
        renderers: availableArtifactRenderers(),
      };
    } else if (action === "artifact_search") {
      const requestedLimit = args.limit === undefined ? 20 : Number(args.limit);
      if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 50) {
        throw new ApiError(
          400,
          "artifact_search_limit_invalid",
          "Artifact search limit must be an integer from 1 to 50.",
        );
      }
      const contentOffset = args.contentOffset === undefined ? 0 : Number(args.contentOffset);
      if (!Number.isInteger(contentOffset) || contentOffset < 0 || contentOffset > 100_000) {
        throw new ApiError(
          400,
          "artifact_search_offset_invalid",
          "Artifact search contentOffset must be an integer from 0 to 100000.",
        );
      }
      result = {
        scope: describeAgentArtifactScope(artifactScope),
        ...(await searchArtifactsForAgent({
          artifacts: listArtifactsInAgentScope(artifactScope),
          query: requiredText(args.query, "search_query", 500),
          limit: requestedLimit,
          includeContent: args.includeContent !== false,
          contentOffset,
          signal: request.signal,
        })),
      };
    } else if (action === "artifact_create" || action === "artifact_import") {
      const kind = artifactKind(args.kind);
      const provenance = validateMcpProvenance(
        session.user_id,
        args.provenance,
        selectedMcpServers,
      );
      const sourceSkill = validateSourceSkill(args.sourceSkill, selectedSkills);
      const shared = {
        userId: session.user_id,
        runtimeSessionId: session.id,
        hermesSessionId: runtimeExternalSessionId(session)!,
        conversationId: session.conversation_id,
        clusterId: session.cluster_id,
        runId: run.id,
        assistantMessageId: assistantMessage?.id ?? null,
        toolCallId,
        surface: session.surface as "dashboard_terminal" | "garden_chat",
        kind,
        title: requiredText(args.title, "title", 240),
        filename: text(args.filename, 160),
        metadata: record(args.metadata),
        sourceSkill,
        sourceMcpServer: provenance?.server,
        sourceMcpTool: provenance?.tool,
        sourceHermesTool: action,
      };
      let artifact = action === "artifact_import"
        ? await createImportedArtifact({
            ...shared,
            authorizedRoot:
              session.active_directory ??
              (() => {
                throw new ApiError(
                  409,
                  "artifact_workspace_required",
                  "A server-authorized workspace is required to import generated files.",
                );
              })(),
            filePath: requiredText(args.path, "path", 1_000),
          })
        : createArtifact({
            ...shared,
            rendererId: requiredText(args.renderer, "renderer", 40),
            mimeType: text(args.mimeType, 160),
            // "Rewrite naturally", when the user has it on as a standing
            // preference. Markdown only: the rewriter takes prose apart with a
            // Markdown segmenter, and handing it an HTML or JSON body would be
            // handing it a document it cannot read. Failure here is silent and
            // returns the original - a rewrite must never cost somebody their
            // artifact.
            content:
              kind === "markdown"
                ? (
                    await humanizeStoredText(
                      session.user_id,
                      content(args.content),
                      "artifact",
                    )
                  ).text
                : content(args.content),
          });
      if (provenance) {
        addArtifactProvenance({
          artifactId: artifact.id,
          version: artifact.current_version,
          sourceKind: "mcp",
          sourceServer: provenance.server,
          sourceTool: provenance.tool,
          invocationId: provenance.invocationId,
          resourceMetadata: provenance.resourceMetadata,
        });
      }
      if (sourceSkill) {
        addArtifactProvenance({
          artifactId: artifact.id,
          version: artifact.current_version,
          sourceKind: "skill",
          sourceTool: sourceSkill,
        });
      }
      if (action === "artifact_create" && args.render === true) {
        artifact = await renderArtifact({
          artifact,
          runId: run.id,
          assistantMessageId: assistantMessage?.id ?? null,
          signal: request.signal,
        });
      }
      result = { artifact: presentArtifact(artifact) };
    } else {
      const artifact = authorizedArtifact(
        requiredText(args.artifactId, "artifactId", 100),
        artifactScope,
      );
      if (action === "artifact_read") {
        const presented = presentArtifact(artifact);
        result = artifactEditorMode(presented)
          ? await loadArtifactEditor(artifact, { signal: request.signal })
          : { artifact: presented, content: readArtifactSource(artifact) };
      } else if (action === "artifact_update" || action === "artifact_append" || action === "artifact_fork") {
        const provenance = validateMcpProvenance(session.user_id, args.provenance, selectedMcpServers);
        const sourceSkill = validateSourceSkill(args.sourceSkill, selectedSkills);
        const editorMode = artifactEditorMode(presentArtifact(artifact));
        const importedEditor = editorMode === "file-text" || editorMode === "office-blocks" || editorMode === "spreadsheet-cells";
        if (importedEditor && action !== "artifact_update") {
          throw new ArtifactStoreError(422, "artifact_editor_operation_unsupported", "Imported documents support artifact_update with content or anchored patches.");
        }
        const updated = importedEditor
          ? await saveArtifactEditor({
              artifact,
              expectedVersion: artifact.current_version,
              content: typeof args.content === "string" ? args.content : undefined,
              patches: Array.isArray(args.patches) ? args.patches as ArtifactEditorPatch[] : undefined,
            }, { signal: request.signal })
          : updateArtifactContent({
              artifact,
              content: content(args.content),
              mode: action === "artifact_append" ? "append" : action === "artifact_fork" ? "fork" : "replace",
              runId: run.id,
              assistantMessageId: assistantMessage?.id ?? null,
              toolCallId,
              metadata: record(args.metadata),
            });
        if (provenance) {
          addArtifactProvenance({
            artifactId: updated.id,
            version: updated.current_version,
            sourceKind: "mcp",
            sourceServer: provenance.server,
            sourceTool: provenance.tool,
            invocationId: provenance.invocationId,
            resourceMetadata: provenance.resourceMetadata,
          });
        }
        if (sourceSkill) {
          addArtifactProvenance({
            artifactId: updated.id,
            version: updated.current_version,
            sourceKind: "skill",
            sourceTool: sourceSkill,
          });
        }
        result = { artifact: presentArtifact(updated) };
      } else {
        const rendered = await renderArtifact({
          artifact,
          runId: run.id,
          assistantMessageId: assistantMessage?.id ?? null,
          signal: request.signal,
        });
        result = { artifact: presentArtifact(rendered) };
      }
    }

    recordAuditEvent({
      eventType: `artifact.tool.${action}`,
      runtimeSessionId: session.id,
      userId: session.user_id,
      gardenId: session.garden_id,
      payload: { runId: run.id, toolCallId, success: true },
    });
    return NextResponse.json({ ok: true, data: result });
  } catch (error) {
    if (
      error instanceof ArtifactStoreError ||
      error instanceof ArtifactImageServiceError
    ) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    return apiErrorResponse(error);
  }
}

function generatedImageTitle(prompt: string): string {
  const summary = prompt.replace(/\s+/g, " ").trim().slice(0, 72);
  return summary ? `Generated image — ${summary}` : "Generated image";
}

async function generateImageWithProviderFallback(input: {
  userId: number;
  baseURL: string;
  prompt: string;
  signal: AbortSignal;
}): Promise<{
  buffer: Buffer;
  filename: string;
  providerMetadata: Record<string, unknown>;
  fallback?: {
    provider: "google_image_generation";
    model: string;
    generationFailure: string;
    explanation: string;
  };
}> {
  try {
    const generated = await generateArtifactImage({
      baseURL: input.baseURL,
      prompt: input.prompt,
    });
    return {
      buffer: generated.buffer,
      filename: "generated-image.png",
      providerMetadata: {
        imageProvider: "chatgpt",
        ...(generated.providerItemId
          ? { providerItemId: generated.providerItemId }
          : {}),
      },
    };
  } catch (generationError) {
    if (input.signal.aborted) throw generationError;
    const generationFailure = imageGenerationFailureReason(generationError);
    try {
      const credentials = readGoogleImageGenerationCredentials(input.userId);
      const fallback = await generateGoogleImage({
        apiKey: credentials?.apiKey ?? "",
        prompt: input.prompt,
        signal: input.signal,
      });
      return {
        buffer: fallback.buffer,
        filename: generatedImageFilename(fallback.mimeType),
        providerMetadata: {
          imageProvider: "google",
          imageModel: fallback.model,
          primaryGenerationFailure: generationFailure,
          ...(fallback.interactionId
            ? { providerInteractionId: fallback.interactionId }
            : {}),
        },
        fallback: {
          provider: "google_image_generation",
          model: fallback.model,
          generationFailure,
          explanation: "ChatGPT image generation failed, so Google Gemini generated this image instead.",
        },
      };
    } catch (fallbackError) {
      if (input.signal.aborted) throw fallbackError;
      throw new ArtifactImageServiceError(
        503,
        "image_generation_fallback_unavailable",
        combinedImageGenerationFailureReason(generationFailure, fallbackError),
      );
    }
  }
}

function imageGenerationFailureReason(error: unknown): string {
  if (error instanceof ArtifactImageServiceError) {
    return error.message.trim();
  }
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return "ChatGPT image generation did not complete.";
}

function combinedImageGenerationFailureReason(
  generationFailure: string,
  fallbackError: unknown,
): string {
  const googleFailure =
    fallbackError instanceof Error
      ? fallbackError.message.trim()
      : "Google image generation did not complete.";
  return [
    `ChatGPT image generation failed: ${sentence(generationFailure)}`,
    `Google image generation fallback also failed: ${sentence(googleFailure)}`,
  ].join(" ");
}

function sentence(message: string): string {
  return /[.!?]$/u.test(message) ? message : `${message}.`;
}

function authorizedArtifact(id: string, scope: AgentArtifactScope) {
  return getArtifactInAgentScope(id, scope);
}

function artifactKind(value: unknown): ArtifactKind {
  if (typeof value === "string" && (ARTIFACT_KINDS as readonly string[]).includes(value)) return value as ArtifactKind;
  throw new ApiError(400, "invalid_artifact_kind", "A valid artifact kind is required.");
}

function requiredText(value: unknown, field: string, max: number): string {
  const result = text(value, max);
  if (!result) throw new ApiError(400, `artifact_${field}_required`, `${field} is required.`);
  return result;
}

function text(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
}

function content(value: unknown): string {
  if (typeof value !== "string") throw new ApiError(400, "artifact_content_required", "content must be text.");
  return value;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function validateSourceSkill(value: unknown, selectedSkills: Set<string>): string | null {
  const skill = text(value, 160) ?? null;
  if (skill && !selectedSkills.has(skill)) {
    throw new ApiError(403, "artifact_skill_not_selected", "The cited skill was not authorized for this run.");
  }
  return skill;
}

function validateMcpProvenance(userId: number, value: unknown, selectedServers: Set<string>): {
  server: string; tool: string; invocationId?: string; resourceMetadata?: Record<string, unknown>;
} | null {
  const candidate = record(value);
  if (!candidate) return null;
  // Provenance is only a citation when it actually names a server. A provenance
  // object with no mcpServer (e.g. attached to self-authored content like a PDF
  // summary) carries no MCP claim, so treat it as no provenance rather than erroring.
  const server = text(candidate.mcpServer, 100);
  if (!server) return null;
  const connection = listMcpConnections(userId, true).find((item) => item.slug === server);
  if (!connection) throw new ApiError(403, "artifact_mcp_not_authorized", "The cited MCP server is not enabled for this user.");
  if (!selectedServers.has(server)) {
    throw new ApiError(403, "artifact_mcp_not_selected", "The cited MCP server was not authorized for this run.");
  }
  return {
    server,
    tool: requiredText(candidate.mcpTool, "mcpTool", 160),
    invocationId: text(candidate.invocationId, 200),
    resourceMetadata: record(candidate.resourceMetadata),
  };
}
