// Storing a ViMax film as a Breadboard artifact.
//
// The whole production is the artifact's source — story, characters, scenes,
// shots, frame decompositions and the video prompt each shot would render
// from — so reopening a film never needs the model again, and a follow-up
// change forks a new version of the same artifact rather than creating a
// second, unrelated one.
//
// Drawn frames are separate image artifacts referenced by id, the way the Socials Manager
// stores post artwork: the production stays a small readable document, and each
// frame is independently viewable, downloadable and reusable.

import fs from "node:fs";
import {
  artifactDeliveryFile,
  createArtifact,
  createImportedArtifact,
  getArtifactById,
  listArtifactsForUser,
  readArtifactSource,
  renderArtifact,
  setArtifactOriginatingMessage,
  updateArtifactContent,
  type ArtifactRow,
} from "../hermes/artifact-store.ts";
import { importArtifactImage } from "../hermes/artifact-image-service.ts";
import { drawImageBytes, type ImagePlan } from "./image-backend.ts";
import { beginRuntimeRun, finishRuntimeRun } from "../hermes/run-store.ts";
import {
  getRuntimeSessionByConversation,
  runtimeExternalSessionId,
} from "../hermes/runtime-store.ts";
import { getConversationForUser } from "../conversations/store.ts";
import { findExternalAgentAssistantMessage } from "../conversations/external-agent-turns.ts";
import { parseStoredProduction } from "./schemas.ts";
import { renderProductionVideo } from "./video.ts";
import { productionDuration } from "./types.ts";
import type { VimaxProduction, VimaxShot, VimaxVideoRef } from "./types.ts";
import type { DrawnImage } from "./pipeline.ts";

export const VIMAX_PRODUCTION_RENDERER = "vimax-production";
export const VIMAX_PRODUCTION_TOOL = "vimax_produce_film";

export interface VimaxArtifactContext {
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
  /**
   * The chat turn this run belongs to, so the film renders under that response.
   * Null only if the turn was never stored — the artifact still belongs to the
   * conversation, it just has no message to sit under.
   */
  assistantMessageId: number | null;
}

/**
 * The assistant turn this run belongs to, looked up again if it was not there
 * when the run started.
 *
 * It usually is not: the chat surface posts the run first and writes the turn
 * once it has a run id, so a context opened at dispatch sees no message yet.
 * Resolving once at open time therefore left the film with no message to sit
 * under, and its card floated free of the reply that produced it.
 */
function assistantMessageFor(context: VimaxArtifactContext): number | null {
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

/**
 * Resolve everything the artifact store needs from the conversation this run
 * was dispatched in, and open a run for the artifacts to hang off. Returns null
 * when the conversation has no runtime session yet.
 */
export function openVimaxArtifactContext(input: {
  userId: number;
  conversationPublicId: string;
  brief: string;
  /** The ViMax run id, which is how its chat turn is addressed. */
  agentRunId: string;
}): VimaxArtifactContext | null {
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

export function closeVimaxArtifactContext(
  context: VimaxArtifactContext | null,
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

/**
 * The outcome of drawing one image. A failure carries its reason and whether
 * trying the next frame is worth it: a quota that has run out will refuse
 * every remaining frame too, and hammering it turns a failed run into a slow
 * failed run. This used to return null for every failure, which is how a run
 * produced a text-only film without ever saying why.
 */
export type DrawOutcome =
  | { ok: true; image: DrawnImage }
  | { ok: false; reason: string; exhausted: boolean };

/**
 * Draw one image for a production and keep it as a durable image artifact.
 *
 * Never throws: imagery is best-effort, and a provider that refuses one frame
 * must not cost the film that is otherwise complete — but the reason always
 * comes back so the run can report it.
 */
export async function drawProductionImage(input: {
  context: VimaxArtifactContext;
  baseUrl: string;
  /** The run's drawing plan, so the provider is only interrogated once. */
  plan: ImagePlan;
  prompt: string;
  title: string;
  kind: "portrait" | "frame";
  referenceArtifactId?: string | null;
  productionArtifactId?: string | null;
  signal?: AbortSignal;
}): Promise<DrawOutcome> {
  try {
    let sourceImage: { dataUrl: string } | null = null;
    if (input.referenceArtifactId) {
      try {
        const reference = getArtifactById(input.referenceArtifactId);
        if (reference && reference.user_id === input.context.userId) {
          const file = artifactDeliveryFile(reference);
          sourceImage = {
            dataUrl: `data:${file.mimeType};base64,${fs.readFileSync(file.absolutePath).toString("base64")}`,
          };
        }
      } catch {
        // An unreadable reference only costs consistency, not the frame.
        sourceImage = null;
      }
    }

    const attempt = await drawImageBytes({
      baseUrl: input.baseUrl,
      plan: input.plan,
      prompt: input.prompt,
      reference: sourceImage,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if (!attempt.ok) {
      return {
        ok: false,
        reason: attempt.failure.reason,
        exhausted: attempt.failure.exhausted,
      };
    }
    const generated = attempt.drawn;
    const extension = generated.mimeType === "image/jpeg" ? "jpg"
      : generated.mimeType === "image/webp" ? "webp"
      : "png";
    const artifact = await importArtifactImage({
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
      buffer: generated.buffer,
      title: input.title.slice(0, 240),
      filename: `${input.kind}-${Date.now()}.${extension}`,
      assistantMessageId: assistantMessageFor(input.context),
      parentArtifactId: input.productionArtifactId ?? null,
      metadata: {
        vimaxImageKind: input.kind,
        vimaxPrompt: input.prompt.slice(0, 2_000),
        vimaxDrawnBy: generated.backend,
      },
      sourceTool: sourceImage ? "artifact_image_edit" : "artifact_image_generate",
    });
    return {
      ok: true,
      image: { artifactId: artifact.id, width: null, height: null, backend: generated.backend },
    };
  } catch (error) {
    // Only storage can throw here — drawing reports its own failures — and a
    // store that cannot keep this frame will not keep the next one either.
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "The frame could not be stored.",
      exhausted: true,
    };
  }
}

/**
 * Encode the film and store it as a real video artifact.
 *
 * The player inside the production artifact is not something you can send
 * anyone; this is. Returns null with a reason when there is nothing to encode
 * or ffmpeg could not do it — a film without a video file is still a film.
 */
export async function publishProductionVideo(input: {
  context: VimaxArtifactContext;
  production: VimaxProduction;
  productionArtifactId?: string | null;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}): Promise<{ ok: true; video: VimaxVideoRef } | { ok: false; reason: string }> {
  // Only shots that actually have a drawn frame can be filmed.
  const frames: Array<{ shot: VimaxShot; imagePath: string }> = [];
  for (const shot of input.production.shots) {
    const image = shot.firstFrame.image;
    if (!image) continue;
    try {
      const artifact = getArtifactById(image.artifactId);
      if (!artifact || artifact.user_id !== input.context.userId) continue;
      frames.push({ shot, imagePath: artifactDeliveryFile(artifact).absolutePath });
    } catch {
      // A frame whose file has gone is simply not in the cut.
    }
  }
  if (frames.length === 0) {
    return {
      ok: false,
      reason: "No frames were drawn, so there was nothing to film.",
    };
  }

  const rendered = await renderProductionVideo({
    production: input.production,
    frames,
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.onProgress ? { onProgress: input.onProgress } : {}),
  });
  if (!rendered.ok) return { ok: false, reason: rendered.reason };

  try {
    const artifact = await createImportedArtifact({
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
      authorizedRoot: rendered.workspace,
      filePath: rendered.filePath,
      parentArtifactId: input.productionArtifactId ?? null,
      metadata: {
        vimaxFilm: true,
        vimaxProductionId: input.production.id,
        vimaxShotCount: rendered.shotCount,
        vimaxDurationSeconds: Math.round(rendered.durationSeconds),
      },
      sourceHermesTool: VIMAX_PRODUCTION_TOOL,
    });
    return {
      ok: true,
      video: {
        artifactId: artifact.id,
        filename: artifact.filename,
        durationSeconds: rendered.durationSeconds,
        width: rendered.width,
        height: rendered.height,
        shotCount: rendered.shotCount,
      },
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "The film could not be stored.",
    };
  } finally {
    try {
      fs.rmSync(rendered.workspace, { recursive: true, force: true });
    } catch {
      // A leftover temporary directory is not worth failing a finished film.
    }
  }
}

function safeFilename(title: string): string {
  return (
    title
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .toLowerCase() || "vimax-film"
  );
}

function artifactMetadata(production: VimaxProduction): Record<string, unknown> {
  return {
    vimaxProduction: true,
    vimaxProductionId: production.id,
    vimaxMode: production.mode,
    vimaxStyle: production.style,
    vimaxSceneCount: production.scenes.length,
    vimaxShotCount: production.shots.length,
    vimaxCharacterCount: production.characters.length,
    vimaxDrawnFrameCount: production.renderPlan.drawnFrameCount,
    vimaxDurationSeconds: Math.round(productionDuration(production)),
    vimaxStatus: production.status,
  };
}

/** The most recent ViMax film in this conversation, if any. */
export function latestVimaxArtifact(input: {
  userId: number;
  conversationPublicId: string;
}): ArtifactRow | null {
  try {
    return (
      listArtifactsForUser({
        userId: input.userId,
        conversationPublicId: input.conversationPublicId,
      }).find(
        (row) => row.renderer_id === VIMAX_PRODUCTION_RENDERER && row.status !== "archived",
      ) ?? null
    );
  } catch {
    return null;
  }
}

/** Read a stored production back. Returns null when it cannot be trusted. */
export function readStoredProduction(artifact: ArtifactRow): VimaxProduction | null {
  try {
    const source = readArtifactSource(artifact);
    const parsed = parseStoredProduction(JSON.parse(source) as unknown);
    return parsed.ok ? parsed.value : null;
  } catch {
    return null;
  }
}

export async function publishProduction(input: {
  context: VimaxArtifactContext;
  production: VimaxProduction;
  /** Fork a new version of this artifact instead of creating a fresh one. */
  previousArtifactId?: string | null;
}): Promise<ArtifactRow | null> {
  const content = `${JSON.stringify(input.production, null, 2)}\n`;
  const metadata = artifactMetadata(input.production);
  const title = `ViMax: ${input.production.title}`.slice(0, 240);
  const assistantMessageId = assistantMessageFor(input.context);

  try {
    const existing = input.previousArtifactId ? getArtifactById(input.previousArtifactId) : null;
    const artifact =
      existing && existing.user_id === input.context.userId && existing.status !== "archived"
        ? updateArtifactContent({
            artifact: existing,
            content,
            mode: "fork",
            runId: input.context.runId,
            assistantMessageId,
            metadata,
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
            rendererId: VIMAX_PRODUCTION_RENDERER,
            title,
            filename: "vimax-production.json",
            content,
            metadata,
            sourceHermesTool: VIMAX_PRODUCTION_TOOL,
          });

    // A revision forks the same artifact, so its one card follows the turn that
    // asked for the change rather than staying under the original film.
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

/** Compact description of a stored film, used to interpret a follow-up. */
export function summariseProductionForModel(production: VimaxProduction): string {
  return [
    `Title: ${production.title}`,
    `Logline: ${production.logline}`,
    `Style: ${production.style}`,
    `Mode: ${production.mode}`,
    `Scenes: ${production.scenes.length}, shots: ${production.shots.length}, runtime: ${Math.round(
      productionDuration(production),
    )}s`,
    "Characters:",
    ...production.characters.map(
      (character) =>
        `- ${character.identifier}${character.isVisible ? "" : " (never seen)"}: ${character.staticFeatures}`,
    ),
    "Scenes:",
    ...production.scenes.map((scene) => `- ${scene.idx}. ${scene.heading}`),
  ].join("\n");
}
