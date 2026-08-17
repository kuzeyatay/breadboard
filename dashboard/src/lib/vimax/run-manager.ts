// In-memory run manager for the ViMax agent.
//
// A run is ViMax's production pipeline, not an agent loop:
//
//   story -> screenplay -> characters -> storyboard -> frames -> imagery -> film
//
// Every stage is validated before the next one consumes it, and the run ends by
// publishing the whole production as one artifact. Runs are ephemeral: events
// live here and the SSE route replays them; the film itself is durable.

import { randomUUID } from "node:crypto";
import {
  normalizeChatTokenUsage,
  sumChatTokenUsage,
  type ChatTokenUsage,
} from "../chat-token-usage.ts";
import {
  closeVimaxArtifactContext,
  drawProductionImage,
  latestVimaxArtifact,
  openVimaxArtifactContext,
  publishProduction,
  publishProductionVideo,
  readStoredProduction,
  summariseProductionForModel,
  type VimaxArtifactContext,
} from "./artifact.ts";
import { planImageBackends } from "./image-backend.ts";
import { produceFilm } from "./pipeline.ts";
import { VimaxModelError } from "./model-client.ts";
import { productionDuration } from "./types.ts";
import type { VimaxProduction } from "./types.ts";
import type { VimaxRequest } from "./identity.ts";

export interface VimaxRunEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

type RunStatus = "queued" | "running" | "completed" | "failed" | "aborted";

interface RunState {
  runId: string;
  userId: number;
  brief: string;
  status: RunStatus;
  sequence: number;
  events: VimaxRunEvent[];
  aborted: boolean;
  createdAt: number;
  controller: AbortController;
}

const globalRuns = globalThis as typeof globalThis & {
  __breadboardVimaxRuns?: Map<string, RunState>;
};
const runs = globalRuns.__breadboardVimaxRuns ?? new Map<string, RunState>();
globalRuns.__breadboardVimaxRuns = runs;

const MAX_EVENTS = 2_000;
const RETENTION_MS = 15 * 60 * 1000;

function emit(run: RunState, type: string, payload: Record<string, unknown> = {}): void {
  run.sequence += 1;
  run.events.push({
    sequenceNumber: run.sequence,
    type,
    payload,
    at: new Date().toISOString(),
  });
  if (run.events.length > MAX_EVENTS) {
    run.events.splice(0, run.events.length - MAX_EVENTS);
  }
}

function requireRun(userId: number, runId: string): RunState {
  const run = runs.get(runId);
  if (!run || run.userId !== userId) throw new Error("run_not_found");
  return run;
}

export interface StartVimaxRunInput {
  userId: number;
  conversationPublicId: string;
  brief: string;
  parsed: VimaxRequest;
  model: string;
  reasoningEffort: string;
  baseUrl: string;
  /** The chat this was launched from, so a brief can refer back to it. */
  conversationContext?: string;
}

export function startRun(input: StartVimaxRunInput): { runId: string; status: RunStatus } {
  if (!input.parsed.brief.trim()) throw new Error("empty_brief");
  const runId = `vmxrun_${randomUUID().replaceAll("-", "")}`;
  const run: RunState = {
    runId,
    userId: input.userId,
    brief: input.parsed.brief,
    status: "queued",
    sequence: 0,
    events: [],
    aborted: false,
    createdAt: Date.now(),
    controller: new AbortController(),
  };
  runs.set(runId, run);
  void drive(run, input).catch((error: unknown) => {
    if (run.aborted) return;
    run.status = "failed";
    emit(run, "run.failed", {
      error:
        error instanceof VimaxModelError
          ? error.message
          : error instanceof Error && error.message === "no_shots_planned"
            ? "The storyboard came back empty, so there was no film to build."
            : error instanceof Error
              ? error.message
              : "The ViMax run failed.",
    });
    schedule(run);
  });
  return { runId, status: "queued" };
}

async function drive(run: RunState, input: StartVimaxRunInput): Promise<void> {
  run.status = "running";
  emit(run, "run.started", {
    brief: run.brief,
    model: input.model,
    mode: input.parsed.mode,
    style: input.parsed.style ?? "",
    aspectRatio: input.parsed.aspectRatio,
    images: input.parsed.images,
  });

  const spent: ChatTokenUsage[] = [];
  const onUsage = (usage: unknown) => {
    const normalized = normalizeChatTokenUsage(usage);
    if (!normalized) return;
    spent.push(normalized);
    emit(run, "run.usage", { ...sumChatTokenUsage(spent) });
  };

  // A previous film in this conversation is what a follow-up revises, so the
  // new production forks that artifact instead of starting a second one.
  const previousArtifact = latestVimaxArtifact({
    userId: input.userId,
    conversationPublicId: input.conversationPublicId,
  });
  const previousProduction = previousArtifact ? readStoredProduction(previousArtifact) : null;

  // The artifact context is opened before the pipeline runs, because drawn
  // frames are artifacts too and they need a run to hang off.
  const context: VimaxArtifactContext | null = openVimaxArtifactContext({
    userId: input.userId,
    conversationPublicId: input.conversationPublicId,
    brief: run.brief,
    agentRunId: run.runId,
  });

  // Which models on this machine can draw, decided once. The chat model is not
  // assumed to be one of them: its image tool may be quota-blocked while a
  // dedicated image model is free, and a run that only ever asked the chat
  // model is exactly how a film arrived as text.
  const imagePlan =
    context && input.parsed.images
      ? await planImageBackends({
          baseUrl: input.baseUrl,
          configuredModel: process.env.VIMAX_IMAGE_MODEL ?? null,
          generator: input.parsed.imageGenerator,
          signal: run.controller.signal,
        })
      : { models: [], responsesTool: true };
  if (context && input.parsed.images) {
    emit(run, "imagery.planned", {
      generator: input.parsed.imageGenerator,
      models: imagePlan.models,
      responsesTool: imagePlan.responsesTool,
    });
  }

  let production: VimaxProduction;
  try {
    production = await produceFilm({
      request: input.parsed,
      // A second prompt in the same conversation forks the existing film's
      // artifact, so the screenwriter is shown that film and revises it rather
      // than writing something unrelated into its next version.
      ...(previousProduction
        ? { previousFilm: summariseProductionForModel(previousProduction) }
        : {}),
      ...(input.conversationContext
        ? { conversationContext: input.conversationContext }
        : {}),
      target: {
        baseUrl: input.baseUrl,
        model: input.model,
        reasoningEffort: input.reasoningEffort,
        signal: run.controller.signal,
        onUsage,
      },
      hooks: {
        emit: (type, payload) => emit(run, type, payload),
        signal: run.controller.signal,
        ...(context && input.parsed.images
          ? {
              drawImage: (drawInput) =>
                drawProductionImage({
                  context,
                  baseUrl: input.baseUrl,
                  plan: imagePlan,
                  prompt: drawInput.prompt,
                  title: drawInput.title,
                  kind: drawInput.kind,
                  referenceArtifactId: drawInput.referenceArtifactId ?? null,
                  signal: run.controller.signal,
                }),
            }
          : {}),
      },
    });
  } catch (error) {
    closeVimaxArtifactContext(context, run.aborted ? "aborted" : "failed");
    throw error;
  }
  if (run.aborted) {
    closeVimaxArtifactContext(context, "aborted");
    return;
  }

  // A revision keeps the history of what was asked for, so the film carries its
  // own provenance rather than losing the brief that produced the first cut.
  if (previousProduction) {
    production.revisions = [...previousProduction.revisions, run.brief].slice(-16);
  }

  // The film itself: the drawn frames encoded into an MP4 with the storyboard's
  // own timings, so the result is something you can play and send, not only a
  // player inside one page. Nothing here can cost the production — a film that
  // cannot be encoded is still a film.
  if (context && production.renderPlan.drawnFrameCount > 0) {
    emit(run, "video.started", { frames: production.renderPlan.drawnFrameCount });
    const filmed = await publishProductionVideo({
      context,
      production,
      signal: run.controller.signal,
      onProgress: (done, total) => emit(run, "video.progress", { done, total }),
    });
    if (filmed.ok) {
      production.renderPlan.videoBackend = "ffmpeg-animatic";
      production.renderPlan.video = filmed.video;
      production.renderPlan.videoBackendReason =
        "The drawn frames were encoded into an MP4 with each shot held for its storyboard duration, its camera move applied, and the dialogue carried as a subtitle track.";
      production.status = "rendered";
      emit(run, "video.completed", {
        artifactId: filmed.video.artifactId,
        durationSeconds: Math.round(filmed.video.durationSeconds),
        shotCount: filmed.video.shotCount,
      });
    } else {
      production.renderPlan.videoBackendReason = filmed.reason;
      emit(run, "video.failed", { reason: filmed.reason });
    }
  } else if (!production.renderPlan.videoBackendReason) {
    production.renderPlan.videoBackendReason =
      production.renderPlan.imageBackendReason ||
      "No frames were drawn, so there was nothing to film.";
  }

  let artifactId: string | null = null;
  let artifactVersion = 1;
  try {
    if (context) {
      const artifact = await publishProduction({
        context,
        production,
        previousArtifactId: previousProduction ? previousArtifact?.id ?? null : null,
      });
      artifactId = artifact?.id ?? null;
      artifactVersion = artifact?.current_version ?? 1;
      if (artifact) {
        emit(run, "artifact.ready", {
          artifactId: artifact.id,
          title: artifact.title,
          version: artifact.current_version,
        });
      }
    }
  } finally {
    closeVimaxArtifactContext(context, "completed");
  }

  if (!artifactId) {
    emit(run, "artifact.unavailable", {
      reason:
        "The film was produced but could not be stored as an artifact in this conversation.",
    });
  }

  const elapsedMs = Date.now() - run.createdAt;
  run.status = "completed";
  emit(run, "run.completed", {
    summary: chatSummary({ production, artifactId, revising: Boolean(previousProduction) }),
    title: production.title,
    logline: production.logline,
    style: production.style,
    sceneCount: production.scenes.length,
    shotCount: production.shots.length,
    characterCount: production.characters.length,
    drawnFrameCount: production.renderPlan.drawnFrameCount,
    videoArtifactId: production.renderPlan.video?.artifactId ?? null,
    videoBackend: production.renderPlan.videoBackend,
    imageNotice: production.renderPlan.imageBackendReason ?? "",
    videoNotice: production.renderPlan.videoBackendReason,
    durationSeconds: Math.round(productionDuration(production)),
    headings: production.scenes.map((scene) => scene.heading),
    artifactId,
    artifactVersion,
    elapsedSec: elapsedMs / 1_000,
    usage: { ...sumChatTokenUsage(spent), responseDurationMs: elapsedMs },
  });
  schedule(run);
}

/**
 * The chat reply. Deliberately short: the film is the deliverable and its card
 * sits directly under this reply, so the transcript points at it rather than
 * restating it.
 */
function chatSummary(input: {
  production: VimaxProduction;
  artifactId: string | null;
  revising: boolean;
}): string {
  const { production } = input;
  const runtime = Math.round(productionDuration(production));
  const shape = `${production.scenes.length} scene${production.scenes.length === 1 ? "" : "s"}, ${
    production.shots.length
  } shot${production.shots.length === 1 ? "" : "s"}, about ${runtime}s`;
  const drawn = production.renderPlan.drawnFrameCount;

  return [
    `**${production.title}** — ${production.logline || shape}`,
    input.revising ? `Recut from the previous film. ${shape}, ${production.style} style.` : `${shape}, ${production.style} style.`,
    // What actually came out, and — when something did not — why.
    production.renderPlan.video
      ? `${drawn} frame${drawn === 1 ? "" : "s"} drawn and encoded into a ${Math.round(
          production.renderPlan.video.durationSeconds,
        )}s MP4 you can play and download on the card below.`
      : drawn > 0
        ? `${drawn} storyboard frame${drawn === 1 ? "" : "s"} drawn; press play on the card to watch the animatic. ${production.renderPlan.videoBackendReason}`.trim()
        : production.renderPlan.imageBackendReason ||
          "No frames could be drawn, so the film is written but not illustrated.",
    input.artifactId ? "" : "The film could not be attached to this conversation as an artifact.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function schedule(run: RunState): void {
  // Unreferenced so a finished run's retention window never keeps the process
  // alive on its own.
  setTimeout(() => runs.delete(run.runId), RETENTION_MS).unref?.();
}

// ---- read/control API -------------------------------------------------------

export function getEventsSince(userId: number, runId: string, since = 0): VimaxRunEvent[] {
  return requireRun(userId, runId).events.filter((event) => event.sequenceNumber > since);
}

export function isTerminal(userId: number, runId: string): boolean {
  return ["completed", "failed", "aborted"].includes(requireRun(userId, runId).status);
}

export function abortRun(userId: number, runId: string): boolean {
  const run = requireRun(userId, runId);
  if (["completed", "failed", "aborted"].includes(run.status)) return false;
  run.aborted = true;
  run.status = "aborted";
  run.controller.abort();
  emit(run, "run.aborted", { summary: "The ViMax run was stopped." });
  schedule(run);
  return true;
}
