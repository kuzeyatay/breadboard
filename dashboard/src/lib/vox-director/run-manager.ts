// In-memory run manager for the Vox Director agent.
//
// A run is a production pipeline, not an agent loop:
//
//   plan -> style -> posters -> motion -> narration -> assembly -> artifacts
//
// Events are append-only and sequenced so the SSE route can replay from a
// cursor and a reconnecting card catches up rather than starting blank. The
// terminal event carries the whole summary, because that summary becomes the
// saved message and a card that only streamed its answer loses it on reload.
//
// Runs are ephemeral; the workspace and the artifacts are not. A run whose
// state has been cleaned up still has its film, because the film is an artifact
// and its files are on disk under an owner-checked directory.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import {
  normalizeChatTokenUsage,
  sumChatTokenUsage,
  type ChatTokenUsage,
} from "../chat-token-usage.ts";
import {
  closeVoxArtifactContext,
  latestVoxArtifact,
  openVoxArtifactContext,
  publishFilm,
  publishProduction,
  readStoredProduction,
  storePoster,
  type VoxArtifactContext,
} from "./artifact.ts";
import { produceFilm, VoxPipelineError, describeProduction } from "./pipeline.ts";
import { summariseProductionForModel } from "./prompts.ts";
import { VoxModelError } from "./model-client.ts";
import { killTree } from "./runtime.ts";
import {
  createWorkspace,
  removeWorkspace,
  resolveInWorkspace,
  runDirectory,
  writeJsonFile,
} from "./workspace.ts";
import { VOX_PRODUCTION_SCHEMA_VERSION } from "./schemas.ts";
import type { VoxProduction } from "./types.ts";
import type { VoxDirectorRequest } from "./identity.ts";

export interface VoxRunEvent {
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
  events: VoxRunEvent[];
  aborted: boolean;
  createdAt: number;
  controller: AbortController;
  /** Driver processes still running, so an abort takes them and their children. */
  children: Set<number>;
}

const globalRuns = globalThis as typeof globalThis & {
  __breadboardVoxDirectorRuns?: Map<string, RunState>;
};
const runs = globalRuns.__breadboardVoxDirectorRuns ?? new Map<string, RunState>();
globalRuns.__breadboardVoxDirectorRuns = runs;

const MAX_EVENTS = 3_000;
// A local production renders every frame on this machine, so the retention
// window has to outlast a long render plus a plausible tab switch.
const RETENTION_MS = 30 * 60 * 1000;

function emit(run: RunState, type: string, payload: Record<string, unknown> = {}): void {
  // Nothing follows the terminal event. A stage already in flight when the run
  // was stopped finishes failing a moment later, and its notice arriving after
  // `run.aborted` is a stream that contradicts its own ending.
  if (run.aborted && type !== "run.aborted") return;
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

export interface StartVoxRunInput {
  userId: number;
  conversationPublicId: string;
  brief: string;
  parsed: VoxDirectorRequest;
  model: string;
  reasoningEffort: string;
  baseUrl: string;
  /** The chat this was launched from, so a brief can refer back to it. */
  conversationContext?: string;
  /** Stored defaults that are not part of the parsed request. */
  checkpoint?: string | null;
  steps?: number;
  cfg?: number;
  voiceProfileId?: string | null;
  musicTrack?: string | null;
}

export function startRun(input: StartVoxRunInput): { runId: string; status: RunStatus } {
  if (!input.parsed.brief.trim()) throw new Error("empty_brief");
  const runId = `voxrun_${randomUUID().replaceAll("-", "")}`;
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
    children: new Set(),
  };
  runs.set(runId, run);
  void drive(run, input).catch((error: unknown) => {
    if (run.aborted) return;
    run.status = "failed";
    emit(run, "run.failed", { error: failureMessage(error) });
    schedule(run);
  });
  return { runId, status: "queued" };
}

function failureMessage(error: unknown): string {
  if (error instanceof VoxPipelineError || error instanceof VoxModelError) return error.message;
  if (error instanceof Error) return error.message;
  return "The Vox Director run failed.";
}

async function drive(run: RunState, input: StartVoxRunInput): Promise<void> {
  run.status = "running";
  emit(run, "run.started", {
    brief: run.brief,
    model: input.model,
    duration: input.parsed.duration,
    aspectRatio: input.parsed.aspectRatio,
    motion: input.parsed.motion,
    images: input.parsed.images,
    music: input.parsed.music,
    style: input.parsed.style ?? "",
  });

  const spent: ChatTokenUsage[] = [];
  const onUsage = (usage: unknown) => {
    const normalized = normalizeChatTokenUsage(usage);
    if (!normalized) return;
    spent.push(normalized);
    emit(run, "run.usage", { ...sumChatTokenUsage(spent) });
  };

  createWorkspace({ runId: run.runId, userId: run.userId, brief: run.brief });

  // The previous film in this conversation is shown to the story editor, so
  // "make that one shorter" has something to be shorter than. It is context
  // only: the new production is its own artifact. Forking the old one instead
  // turned a film about Concorde into version 3 of a film about the sky, with
  // the first film's title still on it and its own cut no longer openable.
  const previousArtifact = latestVoxArtifact({
    userId: run.userId,
    conversationPublicId: input.conversationPublicId,
  });
  const previousProduction = previousArtifact ? readStoredProduction(previousArtifact) : null;

  // Opened before the pipeline runs: posters are artifacts too, and they need a
  // run to hang off.
  const context: VoxArtifactContext | null = openVoxArtifactContext({
    userId: run.userId,
    conversationPublicId: input.conversationPublicId,
    brief: run.brief,
    agentRunId: run.runId,
  });

  let production: VoxProduction;
  try {
    production = await produceFilm({
      runId: run.runId,
      userId: run.userId,
      request: input.parsed,
      target: {
        baseUrl: input.baseUrl,
        model: input.model,
        reasoningEffort: input.reasoningEffort,
        signal: run.controller.signal,
        onUsage,
      },
      ...(input.conversationContext ? { conversationContext: input.conversationContext } : {}),
      ...(previousProduction
        ? { previousProduction: summariseProductionForModel(previousProduction) }
        : {}),
      checkpoint: input.checkpoint ?? null,
      steps: input.steps ?? 26,
      cfg: input.cfg ?? 6.5,
      voiceProfileId: input.voiceProfileId ?? null,
      musicTrack: input.musicTrack ?? null,
      hooks: {
        emit: (type, payload) => emit(run, type, payload ?? {}),
        signal: run.controller.signal,
        ...(context
          ? {
              storePoster: async (poster) =>
                storePoster({
                  context,
                  absolutePath: poster.absolutePath,
                  title: poster.title,
                  prompt: poster.prompt,
                  backend: poster.backend,
                  key: poster.key,
                }),
            }
          : {}),
      },
    });
  } catch (error) {
    closeVoxArtifactContext(context, run.aborted ? "aborted" : "failed");
    throw error;
  }
  if (run.aborted) {
    closeVoxArtifactContext(context, "aborted");
    return;
  }

  if (previousProduction) {
    production.revisions = [...previousProduction.revisions, run.brief].slice(-16);
  }

  // ---- the film becomes an ordinary video artifact ------------------------
  let videoArtifactId: string | null = null;
  let storageFailure = "";
  const workspace = runDirectory(run.runId);
  const filmRelative = production.renderPlan.video?.relativePath ?? "";
  const filmAbsolute = filmRelative ? resolveInWorkspace(run.runId, filmRelative) : "";

  if (context && filmAbsolute && fs.existsSync(filmAbsolute)) {
    const stored = publishFilm({
      context,
      production,
      absolutePath: filmAbsolute,
      workspaceRoot: workspace,
    });
    if (stored.ok) {
      videoArtifactId = stored.artifactId;
      if (production.renderPlan.video) production.renderPlan.video.artifactId = stored.artifactId;
      emit(run, "artifact.created", {
        kind: "video",
        artifactId: stored.artifactId,
        filename: stored.filename,
        durationSeconds: Math.round(production.renderPlan.video?.durationSeconds ?? 0),
      });
    } else {
      storageFailure = stored.reason;
      production.renderPlan.videoReason = stored.reason;
      emit(run, "artifact.failed", { reason: stored.reason });
    }
  } else if (!context) {
    storageFailure =
      "This run had no conversation to store its artifacts in, so the film is on disk in its run workspace and nowhere else.";
    emit(run, "artifact.failed", { reason: storageFailure });
  }

  // ---- the production document --------------------------------------------
  let artifactId: string | null = null;
  let artifactVersion = 1;
  try {
    if (context) {
      const artifact = await publishProduction({ context, production });
      artifactId = artifact?.id ?? null;
      artifactVersion = artifact?.current_version ?? 1;
      if (artifact) {
        emit(run, "artifact.created", {
          kind: "production",
          artifactId: artifact.id,
          title: artifact.title,
          version: artifact.current_version,
        });
      }
    }
  } finally {
    closeVoxArtifactContext(context, "completed");
  }

  // The on-disk record is refreshed with the artifact ids, so reopening a run
  // whose manager state is gone still finds its film.
  writeJsonFile(run.runId, "production.json", {
    schemaVersion: VOX_PRODUCTION_SCHEMA_VERSION,
    ...production,
  });

  const elapsedMs = Date.now() - run.createdAt;
  const shape = describeProduction(production);
  run.status = "completed";
  emit(run, "run.completed", {
    summary: chatSummary({ production, videoArtifactId, storageFailure }),
    title: production.title,
    logline: production.logline,
    theme: production.style.theme,
    styleRationale: production.style.rationale,
    arc: production.arc,
    beatCount: production.beats.length,
    shotCount: shape.shotCount,
    posterCount: shape.posterCount,
    headlines: production.beats.map((beat) => beat.title),
    runtimeSeconds: shape.runtime,
    imageBackend: production.renderPlan.imageBackend,
    imageNotice: production.renderPlan.imageBackendReason,
    motionBackend: production.renderPlan.motionBackend,
    motionNotice: production.renderPlan.motionBackendReason,
    narrationVoice: production.renderPlan.narrationVoice,
    musicSource: production.renderPlan.musicSource,
    musicNotice: production.renderPlan.musicReason,
    videoArtifactId,
    artifactId,
    artifactVersion,
    storageFailure,
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
  production: VoxProduction;
  videoArtifactId: string | null;
  storageFailure: string;
}): string {
  const { production } = input;
  const shape = describeProduction(production);
  const beats = `${production.beats.length} beat${production.beats.length === 1 ? "" : "s"}`;
  const cards = production.renderPlan.imageBackend === "title-card";

  return [
    `**${production.title}** — ${production.logline || production.brief}`,
    `${beats}, ${shape.shotCount} shots, about ${shape.runtime}s, in the ${production.style.theme} look. ${production.style.rationale}`.trim(),
    input.videoArtifactId
      ? `Narrated by ${production.renderPlan.narrationVoice} and rendered locally into an MP4 you can play and download on the card below.`
      : "",
    // What did not happen, and why — never a claim that it did. The backend's
    // own reason is the whole sentence; prefacing it with a fixed one said the
    // same thing twice.
    cards ? production.renderPlan.imageBackendReason : "",
    production.renderPlan.musicSource === "silence" ? production.renderPlan.musicReason : "",
    input.storageFailure
      ? `The film rendered but could not be attached to this conversation: ${input.storageFailure} It is still on disk in the run's workspace.`
      : "",
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

export function getEventsSince(userId: number, runId: string, since = 0): VoxRunEvent[] {
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
  // The signal takes the driver Python; this takes anything it started and had
  // not yet reaped, because a frame loop piping into ffmpeg has a child too.
  for (const pid of run.children) killTree(pid);
  run.children.clear();
  emit(run, "run.aborted", { summary: "The Vox Director run was stopped." });
  schedule(run);
  return true;
}

/** Only the verification path uses this: a run's workspace, deleted. */
export function discardRun(userId: number, runId: string): void {
  requireRun(userId, runId);
  removeWorkspace(runId);
}
