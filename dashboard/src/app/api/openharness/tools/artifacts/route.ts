import { NextResponse } from "next/server";
import { apiErrorResponse, readJsonBody, requireEnabled, ApiError } from "@/lib/openharness/route-helpers.ts";
import { capabilityForInternalToolRequest } from "@/lib/openharness/tool-service-auth.ts";
import { tokenAllows, verifyCapabilityToken } from "@/lib/openharness/capability-token.ts";
import {
  getActiveCapabilityDecision,
  getRuntimeSessionById,
  recordAuditEvent,
  runtimeExternalSessionId,
} from "@/lib/openharness/runtime-store.ts";
import { getActiveRuntimeRun, parseRuntimeRunDispatch } from "@/lib/openharness/run-store.ts";
import { listMcpConnections } from "@/lib/openharness/mcp-connections.ts";
import db from "@/lib/db";
import {
  addArtifactProvenance,
  createArtifact,
  getArtifactById,
  listArtifactsForUser,
  presentArtifact,
  readArtifactSource,
  renderArtifact,
  updateArtifactContent,
  ArtifactStoreError,
  type ArtifactRow,
} from "@/lib/openharness/artifact-store.ts";
import { ARTIFACT_KINDS, type ArtifactKind } from "@/lib/openharness/artifact-types.ts";
import { availableArtifactRenderers } from "@/lib/openharness/artifact-renderers.ts";

export const dynamic = "force-dynamic";
const ACTIONS = new Set([
  "artifact_create", "artifact_read", "artifact_update", "artifact_append",
  "artifact_render", "artifact_finalize", "artifact_list", "artifact_fork",
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
        verified.token.openHarnessSessionId ||
      verified.token.conversationId !== session.conversation_id
    ) {
      throw new ApiError(403, "artifact_session_scope_mismatch", "Artifact session scope is invalid.");
    }
    const run = getActiveRuntimeRun(session.id);
    if (!run) throw new ApiError(409, "artifact_run_required", "Artifact tools require a current OpenHarness run.");
    const args = body.args && typeof body.args === "object" && !Array.isArray(body.args)
      ? body.args as Record<string, unknown>
      : {};
    const dispatch = parseRuntimeRunDispatch(run);
    const activeDecision = getActiveCapabilityDecision(session.id);
    const selectedMcpServers = new Set(activeDecision?.selectedConnections ?? []);
    const selectedSkills = new Set(activeDecision?.selectedConditionalSkills ?? []);
    const assistantMessage = dispatch.clientMessageId
      ? db.prepare(`
          SELECT id FROM conversation_messages
          WHERE conversation_id = ? AND client_message_id = ? AND role = 'assistant'
        `).get(session.conversation_id, dispatch.clientMessageId) as { id: number } | undefined
      : undefined;
    const toolCallId = text(body.toolCallId, 200) ?? null;

    let result: unknown;
    if (action === "artifact_list") {
      result = {
        artifacts: listArtifactsForUser({
          userId: session.user_id,
          conversationPublicId: dispatch.conversationPublicId,
        }).map(presentArtifact),
        renderers: availableArtifactRenderers(),
      };
    } else if (action === "artifact_create") {
      const kind = artifactKind(args.kind);
      const rendererId = requiredText(args.renderer, "renderer", 40);
      const provenance = validateMcpProvenance(
        session.user_id,
        args.provenance,
        selectedMcpServers,
      );
      const sourceSkill = validateSourceSkill(args.sourceSkill, selectedSkills);
      let artifact = createArtifact({
        userId: session.user_id,
        runtimeSessionId: session.id,
        openHarnessSessionId: runtimeExternalSessionId(session)!,
        conversationId: session.conversation_id,
        clusterId: session.cluster_id,
        runId: run.id,
        assistantMessageId: assistantMessage?.id ?? null,
        toolCallId,
        surface: session.surface as "dashboard_terminal" | "garden_chat",
        kind,
        rendererId,
        title: requiredText(args.title, "title", 240),
        filename: text(args.filename, 160),
        mimeType: text(args.mimeType, 160),
        content: content(args.content),
        metadata: record(args.metadata),
        sourceSkill,
        sourceMcpServer: provenance?.server,
        sourceMcpTool: provenance?.tool,
        sourceOpenHarnessTool: action,
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
      if (args.render === true) {
        artifact = await renderArtifact({ artifact, runId: run.id, assistantMessageId: assistantMessage?.id ?? null });
      }
      result = { artifact: presentArtifact(artifact) };
    } else {
      const artifact = authorizedArtifact(
        requiredText(args.artifactId, "artifactId", 100),
        session.user_id,
        session.conversation_id,
        session.cluster_id,
      );
      if (action === "artifact_read") {
        result = { artifact: presentArtifact(artifact), content: readArtifactSource(artifact) };
      } else if (action === "artifact_update" || action === "artifact_append" || action === "artifact_fork") {
        const provenance = validateMcpProvenance(session.user_id, args.provenance, selectedMcpServers);
        const sourceSkill = validateSourceSkill(args.sourceSkill, selectedSkills);
        const updated = updateArtifactContent({
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
    if (error instanceof ArtifactStoreError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    return apiErrorResponse(error);
  }
}

function authorizedArtifact(id: string, userId: number, conversationId: number, clusterId: number | null): ArtifactRow {
  const artifact = getArtifactById(id);
  if (
    !artifact || artifact.user_id !== userId || artifact.conversation_id !== conversationId ||
    artifact.cluster_id !== clusterId
  ) {
    throw new ApiError(404, "artifact_not_found", "Artifact not found.");
  }
  return artifact;
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
  const server = requiredText(candidate.mcpServer, "mcpServer", 100);
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
