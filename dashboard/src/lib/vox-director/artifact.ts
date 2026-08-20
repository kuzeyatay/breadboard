// Storing a Vox Director production as Breadboard artifacts.
//
// Two things come out of a run and both belong to the chat that asked for them:
//
//   the film   — an ordinary **video** artifact, so it plays, downloads, and
//                opens in the existing video studio. There is no Vox-only
//                player, and Video Use can edit it like any other video.
//   the production — a data artifact holding the whole beat map, the resolved
//                poster prompts, the motion descriptions and every backend that
//                actually ran, so reopening a finished film never calls a model.
//
// Posters are separate image artifacts referenced by id, the way ViMax stores
// drawn frames: the production document stays small and readable, and each
// poster is independently viewable and reusable.

import fs from "node:fs";
import path from "node:path";
import {
  createArtifact,
  createImportedArtifact,
  listArtifactsForUser,
  readArtifactSource,
  renderArtifact,
  setArtifactOriginatingMessage,
  type ArtifactRow,
} from "../hermes/artifact-store.ts";
import { importArtifactImage } from "../hermes/artifact-image-service.ts";
import { beginRuntimeRun, finishRuntimeRun } from "../hermes/run-store.ts";
import {
  getRuntimeSessionByConversation,
  runtimeExternalSessionId,
} from "../hermes/runtime-store.ts";
import { getConversationForUser } from "../conversations/store.ts";
import { findExternalAgentAssistantMessage } from "../conversations/external-agent-turns.ts";
import { parseStoredProduction, VOX_PRODUCTION_SCHEMA_VERSION } from "./schemas.ts";
import { productionDuration } from "./types.ts";
import { safeFilename } from "./pipeline.ts";
import type { VoxProduction } from "./types.ts";

export const VOX_PRODUCTION_RENDERER = "vox-director-production";
export const VOX_PRODUCTION_TOOL = "vox_director_produce_film";

export interface VoxArtifactContext {
  userId: number;
  conversationPublicId: string;
  runtimeSessionId: number;
  hermesSessionId: string;
  conversationId: number;
  clusterId: number | null;
  surface: "dashboard_terminal" | "garden_chat";
  runId: string;
  /** This agent's run id, which is how its chat turn is addressed. */
  agentRunId: string;
  assistantMessageId: number | null;
}

/**
 * The assistant turn this run belongs to, looked up again if it was not there
 * when the run started — which it usually was not, because the chat surface
 * posts the run first and writes the turn once it has a run id.
 */
function assistantMessageFor(context: VoxArtifactContext): number | null {
  if (context.assistantMessageId !== null) return context.assistantMessageId;
  try {
    const found = findExternalAgentAssistantMessage({
      conversationId: context.conversationId,
      runId: context.agentRunId,
    });
    if (found) context.assistantMessageId = found.id;
    return context.assistantMessageId;
  } catch {
    return null;
  }
}

export function openVoxArtifactContext(input: {
  userId: number;
  conversationPublicId: string;
  brief: string;
  agentRunId: string;
}): VoxArtifactContext | null {
  try {
    const conversation = getConversationForUser(input.conversationPublicId, input.userId);
    if (conversation.surface !== "dashboard_terminal" && conversation.surface !== "garden_chat") {
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
      clusterId: conversation.surface === "garden_chat" ? conversation.default_garden_id : null,
      surface: conversation.surface,
      runId: run.id,
      agentRunId: input.agentRunId,
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

export function closeVoxArtifactContext(
  context: VoxArtifactContext | null,
  status: "completed" | "failed" | "aborted",
): void {
  if (!context) return;
  try {
    finishRuntimeRun(
      context.runId,
      status === "completed" ? "completed" : status === "aborted" ? "cancelled" : "error",
    );
  } catch {
    // A run row that cannot be closed must not take the film down with it.
  }
}

/** Store one poster as an ordinary image artifact. Returns its id, or null. */
export function storePoster(input: {
  context: VoxArtifactContext;
  absolutePath: string;
  title: string;
  prompt: string;
  backend: string;
  key: string;
}): string | null {
  try {
    const buffer = fs.readFileSync(input.absolutePath);
    const artifact = importArtifactImage({
      context: {
        userId: input.context.userId,
        conversationPublicId: input.context.conversationPublicId,
        runtimeSessionId: input.context.runtimeSessionId,
        hermesSessionId: input.context.hermesSessionId,
        conversationId: input.context.conversationId,
        clusterId: input.context.clusterId,
        surface: input.context.surface,
        runId: input.context.runId,
      },
      buffer,
      title: input.title.slice(0, 240),
      filename: `vox-poster-${input.key.replace(/[^a-z0-9_-]/gi, "-")}.png`,
      assistantMessageId: assistantMessageFor(input.context),
      metadata: {
        voxDirectorPoster: true,
        voxDirectorShot: input.key,
        voxDirectorPrompt: input.prompt.slice(0, 2_000),
        voxDirectorDrawnBy: input.backend,
      },
      sourceTool: "artifact_image_generate",
    });
    return artifact.id;
  } catch {
    return null;
  }
}

/**
 * Store the finished MP4 as an ordinary video artifact.
 *
 * `createImportedArtifact` with `kind: "video"` is the same door every other
 * video in Breadboard comes through, which is what makes the result playable in
 * the transcript, downloadable, and editable by Video Use — rather than needing
 * a viewer of its own.
 */
export function publishFilm(input: {
  context: VoxArtifactContext;
  production: VoxProduction;
  absolutePath: string;
  workspaceRoot: string;
  productionArtifactId?: string | null;
}): { ok: true; artifactId: string; filename: string } | { ok: false; reason: string } {
  try {
    const video = input.production.renderPlan.video;
    const artifact = createImportedArtifact({
      userId: input.context.userId,
      runtimeSessionId: input.context.runtimeSessionId,
      hermesSessionId: input.context.hermesSessionId,
      conversationId: input.context.conversationId,
      clusterId: input.context.clusterId,
      runId: input.context.runId,
      assistantMessageId: assistantMessageFor(input.context),
      toolCallId: null,
      surface: input.context.surface,
      kind: "video",
      title: `${input.production.title} — film`.slice(0, 240),
      filename: `${safeFilename(input.production.title)}.mp4`,
      // The workspace is the authorized root: the file being imported has to be
      // inside the run that produced it, and nowhere else.
      authorizedRoot: input.workspaceRoot,
      filePath: input.absolutePath,
      parentArtifactId: input.productionArtifactId ?? null,
      metadata: {
        voxDirectorFilm: true,
        voxDirectorProductionId: input.production.id,
        voxDirectorShotCount: video?.shotCount ?? 0,
        voxDirectorDurationSeconds: Math.round(video?.durationSeconds ?? 0),
        voxDirectorTheme: input.production.style.theme,
      },
      sourceHermesTool: VOX_PRODUCTION_TOOL,
    });
    return { ok: true, artifactId: artifact.id, filename: artifact.filename };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "The film could not be stored.",
    };
  }
}

function artifactMetadata(production: VoxProduction): Record<string, unknown> {
  return {
    voxDirectorProduction: true,
    voxDirectorTheme: production.style.theme,
    voxDirectorArc: production.arc,
    voxDirectorBeats: production.beats.length,
    voxDirectorShots: production.beats.reduce((sum, beat) => sum + beat.shots.length, 0),
    voxDirectorRuntimeSeconds: Math.round(productionDuration(production)),
    voxDirectorAspectRatio: production.aspectRatio,
    voxDirectorVideoArtifactId: production.renderPlan.video?.artifactId ?? null,
  };
}

/**
 * Publish one production.
 *
 * Every production is its own artifact. An earlier film in the same chat is
 * shown to the story editor as context, but it is never overwritten: two briefs
 * in one conversation are usually two different films, and folding the second
 * into a new version of the first leaves the first carrying someone else's
 * title with no way back to its own cut.
 */
export async function publishProduction(input: {
  context: VoxArtifactContext;
  production: VoxProduction;
}): Promise<ArtifactRow | null> {
  const content = `${JSON.stringify(
    { schemaVersion: VOX_PRODUCTION_SCHEMA_VERSION, ...input.production },
    null,
    2,
  )}\n`;
  const metadata = artifactMetadata(input.production);
  const title = `Vox Director: ${input.production.title}`.slice(0, 240);
  const assistantMessageId = assistantMessageFor(input.context);

  try {
    const artifact = createArtifact({
      userId: input.context.userId,
      runtimeSessionId: input.context.runtimeSessionId,
      hermesSessionId: input.context.hermesSessionId,
      conversationId: input.context.conversationId,
      clusterId: input.context.clusterId,
      runId: input.context.runId,
      assistantMessageId,
      surface: input.context.surface,
      kind: "data",
      rendererId: VOX_PRODUCTION_RENDERER,
      title,
      filename: "vox-director-production.json",
      content,
      metadata,
      sourceHermesTool: VOX_PRODUCTION_TOOL,
    });

    setArtifactOriginatingMessage({ artifactId: artifact.id, assistantMessageId });
    return await renderArtifact({
      artifact,
      runId: input.context.runId,
      assistantMessageId,
    });
  } catch {
    return null;
  }
}

/** The most recent film in this conversation, which a follow-up recuts. */
export function latestVoxArtifact(input: {
  userId: number;
  conversationPublicId: string;
}): ArtifactRow | null {
  try {
    const rows = listArtifactsForUser({
      userId: input.userId,
      conversationPublicId: input.conversationPublicId,
    });
    return (
      rows.find(
        (row) => row.renderer_id === VOX_PRODUCTION_RENDERER && row.status !== "archived",
      ) ?? null
    );
  } catch {
    return null;
  }
}

export function readStoredProduction(artifact: ArtifactRow): VoxProduction | null {
  try {
    const source = readArtifactSource(artifact);
    if (!source) return null;
    const parsed = parseStoredProduction(JSON.parse(source) as unknown);
    return parsed.ok ? parsed.value : null;
  } catch {
    return null;
  }
}

/** Where the film file sits, for the publish step. */
export function filmPath(workspaceRoot: string, relativePath: string): string {
  return path.join(workspaceRoot, relativePath);
}
