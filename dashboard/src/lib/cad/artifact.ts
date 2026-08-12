// Storing a parametric CAD design as a Breadboard artifact.
//
// The artifact's source is the whole manifest — specification, source, measured
// geometry, validation and revision history — so reopening a design never needs
// the model again. Export bytes are not inlined: they live in CAD storage and
// the manifest references them by (projectId, revision, format), which the
// authenticated download route resolves against the database. No filesystem
// path and no credential ever reaches the renderer.
//
// A follow-up change forks a new version of the same artifact through the
// existing revision mechanism rather than creating a second, unrelated one.

import {
  createArtifact,
  getArtifactById,
  listArtifactsForUser,
  readArtifactSource,
  renderArtifact,
  setArtifactOriginatingMessage,
  updateArtifactContent,
  type ArtifactRow,
} from "../hermes/artifact-store.ts";
import { beginRuntimeRun, finishRuntimeRun } from "../hermes/run-store.ts";
import {
  getRuntimeSessionByConversation,
  runtimeExternalSessionId,
} from "../hermes/runtime-store.ts";
import { getConversationForUser } from "../conversations/store.ts";
import { findExternalAgentAssistantMessage } from "../conversations/external-agent-turns.ts";
import { parseStoredCadArtifact } from "./schemas.ts";
import {
  getCadProject,
  getCadRevision,
  listRevisionFiles,
  readRevisionParameters,
  revisionHistory,
  setCadProjectArtifact,
  type CadParameterValue,
} from "./project-store.ts";
import { CAD_ARTIFACT_SCHEMA_VERSION } from "./types.ts";
import type {
  CADDesignSpec,
  CADMeasurements,
  CADProvenance,
  CADStatus,
  CADValidationIssue,
  ParametricCADArtifact,
} from "./types.ts";
import type Database from "better-sqlite3";

export const PARAMETRIC_CAD_RENDERER = "parametric-cad";
export const PARAMETRIC_CAD_TOOL = "cad_generate_model";

export interface CadArtifactContext {
  userId: number;
  conversationPublicId: string;
  runtimeSessionId: number;
  hermesSessionId: string;
  conversationId: number;
  clusterId: number | null;
  surface: "dashboard_terminal" | "garden_chat";
  runId: string;
  /**
   * The chat turn this run belongs to, so its design renders under that
   * response. Null only if the turn was never stored.
   */
  assistantMessageId: number | null;
}

/**
 * Resolve everything the artifact store needs from the conversation this run
 * was dispatched in, and open a run for the artifacts to hang off. Returns null
 * when the conversation has no runtime session yet.
 */
export function openCadArtifactContext(input: {
  userId: number;
  conversationPublicId: string;
  brief: string;
  /** The CAD run id, which is how its chat turn is addressed. */
  agentRunId: string;
}): CadArtifactContext | null {
  try {
    const conversation = getConversationForUser(input.conversationPublicId, input.userId);
    if (
      conversation.surface !== "dashboard_terminal" &&
      conversation.surface !== "garden_chat"
    ) {
      return null;
    }
    const session = getRuntimeSessionByConversation(conversation.id);
    if (!session) return null;
    const hermesSessionId = runtimeExternalSessionId(session);
    if (!hermesSessionId) return null;

    const run = beginRuntimeRun({
      runtimeSessionId: session.id,
      instruction: input.brief.slice(0, 4_000),
      dispatch: {
        conversationPublicId: input.conversationPublicId,
        runtimeText: input.brief.slice(0, 4_000),
      },
    });

    return {
      userId: input.userId,
      conversationPublicId: input.conversationPublicId,
      runtimeSessionId: session.id,
      hermesSessionId,
      conversationId: conversation.id,
      clusterId:
        conversation.surface === "garden_chat" ? conversation.default_garden_id : null,
      surface: conversation.surface,
      runId: run.id,
      assistantMessageId:
        findExternalAgentAssistantMessage({
          conversationId: conversation.id,
          runId: input.agentRunId,
        })?.id ?? null,
    };
  } catch {
    return null;
  }
}

export function closeCadArtifactContext(
  context: CadArtifactContext | null,
  status: "completed" | "failed" | "aborted",
): void {
  if (!context) return;
  try {
    finishRuntimeRun(
      context.runId,
      status === "completed" ? "completed" : status === "aborted" ? "cancelled" : "error",
    );
  } catch {
    // A run that was already closed is not worth surfacing.
  }
}

/** Build the manifest for a project's current revision, from storage only. */
export function buildCadManifest(input: {
  projectId: string;
  revision?: number;
  disclaimers: string[];
  database?: Database.Database;
}): ParametricCADArtifact | null {
  const project = getCadProject(input.projectId, input.database);
  if (!project) return null;
  const revisionNumber =
    input.revision ?? project.current_revision ?? project.latest_revision;
  if (!revisionNumber) return null;
  const revision = getCadRevision(project.id, revisionNumber, input.database);
  if (!revision) return null;

  const designSpec = JSON.parse(revision.design_spec_json) as CADDesignSpec;
  const measurements = JSON.parse(revision.measurements_json) as CADMeasurements;
  const validation = JSON.parse(revision.validation_json) as {
    passed: boolean;
    checkedAt: string;
    issues: CADValidationIssue[];
  };
  const provenance = JSON.parse(revision.provenance_json) as CADProvenance;
  const files = listRevisionFiles(project.id, revisionNumber, input.database);
  const parameters = readRevisionParameters(project.id, revisionNumber, input.database) as Record<
    string,
    CadParameterValue
  >;

  return {
    schemaVersion: CAD_ARTIFACT_SCHEMA_VERSION,
    artifactType: "parametric-cad",
    projectId: project.id,
    revision: revisionNumber,
    title: designSpec.name,
    status: revision.status as CADStatus,
    designSpec,
    source: revision.source,
    entrypoint: revision.entrypoint,
    parameters,
    previewFile: files.find((file) => file.format === "glb") ?? null,
    exports: files,
    measurements,
    validation: {
      passed: validation.passed,
      checkedAt: validation.checkedAt,
      issues: validation.issues,
    },
    assumptions: designSpec.assumptions.map((assumption) => assumption.description),
    disclaimers: input.disclaimers,
    revisionHistory: revisionHistory(project.id, input.database),
    generationLog: JSON.parse(revision.generation_log_json) as Array<{
      at: string;
      stage: string;
      detail: string;
    }>,
    provenance,
  };
}

function artifactMetadata(manifest: ParametricCADArtifact): Record<string, unknown> {
  const issues = manifest.validation.issues;
  return {
    parametricCad: true,
    cadProjectId: manifest.projectId,
    cadRevision: manifest.revision,
    cadStatus: manifest.status,
    cadUnits: manifest.designSpec.units,
    cadProcess: manifest.designSpec.manufacturingProcess,
    cadSolidCount: manifest.measurements.solidCount,
    cadErrorCount: issues.filter((issue) => issue.severity === "error").length,
    cadWarningCount: issues.filter((issue) => issue.severity === "warning").length,
    cadBoundingBox: manifest.measurements.boundingBox,
    cadEngine: `${manifest.provenance.engine} ${manifest.provenance.engineVersion}`,
  };
}

/** The most recent CAD design in this conversation, if any. */
export function latestCadArtifact(input: {
  userId: number;
  conversationPublicId: string;
}): ArtifactRow | null {
  try {
    return (
      listArtifactsForUser({
        userId: input.userId,
        conversationPublicId: input.conversationPublicId,
      }).find(
        (row) => row.renderer_id === PARAMETRIC_CAD_RENDERER && row.status !== "archived",
      ) ?? null
    );
  } catch {
    return null;
  }
}

/** Read a stored design back. Returns null when it cannot be trusted. */
export function readStoredCadDesign(artifact: ArtifactRow): ParametricCADArtifact | null {
  try {
    const parsed = parseStoredCadArtifact(JSON.parse(readArtifactSource(artifact)) as unknown);
    return parsed.ok ? parsed.value : null;
  } catch {
    return null;
  }
}

export async function publishCadDesign(input: {
  context: CadArtifactContext;
  manifest: ParametricCADArtifact;
  /** Fork a new version of this artifact instead of creating a fresh one. */
  previousArtifactId?: string | null;
  database?: Database.Database;
}): Promise<ArtifactRow | null> {
  const content = `${JSON.stringify(input.manifest, null, 2)}\n`;
  const metadata = artifactMetadata(input.manifest);
  const title = `CAD: ${input.manifest.title}`.slice(0, 240);
  const assistantMessageId = input.context.assistantMessageId;

  try {
    const existing = input.previousArtifactId
      ? getArtifactById(input.previousArtifactId, input.database)
      : null;
    const artifact =
      existing && existing.user_id === input.context.userId && existing.status !== "archived"
        ? updateArtifactContent({
            artifact: existing,
            content,
            mode: "fork",
            runId: input.context.runId,
            assistantMessageId,
            metadata,
            ...(input.database ? { database: input.database } : {}),
          })
        : createArtifact({
            userId: input.context.userId,
            runtimeSessionId: input.context.runtimeSessionId,
            hermesSessionId: input.context.hermesSessionId,
            conversationId: input.context.conversationId,
            clusterId: input.context.clusterId,
            runId: input.context.runId,
            assistantMessageId,
            surface: input.context.surface,
            kind: "data",
            rendererId: PARAMETRIC_CAD_RENDERER,
            title,
            filename: "parametric-cad.json",
            content,
            metadata,
            sourceHermesTool: PARAMETRIC_CAD_TOOL,
            ...(input.database ? { database: input.database } : {}),
          });

    // A revision forks the same artifact, so its one card follows the turn that
    // asked for the change rather than staying under the original design.
    setArtifactOriginatingMessage({
      artifactId: artifact.id,
      assistantMessageId,
      ...(input.database ? { database: input.database } : {}),
    });
    setCadProjectArtifact({
      projectId: input.manifest.projectId,
      artifactId: artifact.id,
      ...(input.database ? { database: input.database } : {}),
    });

    return await renderArtifact({
      artifact,
      runId: input.context.runId,
      assistantMessageId,
      ...(input.database ? { database: input.database } : {}),
    });
  } catch {
    return null;
  }
}
