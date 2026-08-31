// In-memory run manager for the Classroom agent.
//
// Breadboard does not drive a tool loop here: OpenMAIC owns the whole
// generation — the outline, every scene, the teacher and peer agents, the
// player. What Breadboard owns is what the clone cannot know by itself: which
// model to generate on (the chat's, through ChatMock), which documents are in
// scope (the message's attachments), which conversation the classroom belongs
// to, and the run card that shows it happening.
//
// A run is one generation job on the OpenMAIC server: POST it, poll it every
// few seconds, and turn each poll into an event the card can render. The job
// cannot be cancelled on the server — OpenMAIC has no route for that — so a
// stop here ends the polling and says so, and the classroom, if it finishes
// anyway, stays on disk where the link route can still find it.
//
// Runs are ephemeral: events live here and the SSE route replays them. The
// summary is persisted with the chat turn; the classroom persists in the
// runtime's `data/` and as an artifact of the conversation.

import { randomUUID } from "node:crypto";
import type { ChatAttachment } from "../chat-attachments.ts";
import { promptWithContext } from "../conversations/agent-context.ts";
import {
  closeClassroomArtifactContext,
  openClassroomArtifactContext,
  saveClassroomArtifact,
} from "./artifact.ts";
import {
  readClassroom,
  readClassroomJob,
  startClassroomJob,
  type ClassroomJobSnapshot,
} from "./client.ts";
import {
  classroomOpenPath,
  describeClassroomRequest,
  type ClassroomRequest,
} from "./identity.ts";
import { classroomAvailability } from "./runtime.ts";
import { ensureService } from "./service.ts";

export interface ClassroomEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

export type ClassroomRunStatus = "queued" | "running" | "completed" | "failed" | "aborted";

interface RunState {
  runId: string;
  userId: number;
  request: ClassroomRequest;
  status: ClassroomRunStatus;
  sequence: number;
  events: ClassroomEvent[];
  aborted: boolean;
  createdAt: number;
  jobId: string;
  classroomId: string;
}

const globalRuns = globalThis as typeof globalThis & {
  __breadboardClassroomRuns?: Map<string, RunState>;
};
const runs = globalRuns.__breadboardClassroomRuns ?? new Map<string, RunState>();
globalRuns.__breadboardClassroomRuns = runs;

const MAX_EVENTS = 2_000;
const RETENTION_MS = 30 * 60 * 1000;
// A narrated, illustrated classroom is dozens of model calls plus media; the
// server's own job store gives up on a silent job after thirty minutes.
const RUN_TIMEOUT_MS = 45 * 60 * 1000;
const MIN_POLL_MS = 2_000;
const MAX_POLL_MS = 15_000;
/** How much attached text reaches the outline stage. */
const MAX_MATERIAL_CHARS = 400_000;
const MAX_MATERIAL_IMAGES = 12;
const TERMINAL = new Set<ClassroomRunStatus>(["completed", "failed", "aborted"]);

function emit(run: RunState, type: string, payload: Record<string, unknown> = {}): void {
  run.sequence += 1;
  run.events.push({
    sequenceNumber: run.sequence,
    type,
    payload,
    at: new Date().toISOString(),
  });
  if (run.events.length > MAX_EVENTS) run.events.splice(0, run.events.length - MAX_EVENTS);
}

function requireRun(userId: number, runId: string): RunState {
  const run = runs.get(runId);
  if (!run || run.userId !== userId) throw new Error("run_not_found");
  return run;
}

function scheduleCleanup(run: RunState): void {
  const timer = setTimeout(() => runs.delete(run.runId), RETENTION_MS);
  timer.unref?.();
}

function finish(run: RunState, status: ClassroomRunStatus, payload: Record<string, unknown>): void {
  if (TERMINAL.has(run.status)) return;
  run.status = status;
  emit(run, status === "completed" ? "run.completed" : "run.failed", {
    ...payload,
    elapsedSec: (Date.now() - run.createdAt) / 1_000,
  });
  scheduleCleanup(run);
}

/**
 * The attachments as OpenMAIC's `pdfContent`: extracted text from documents
 * and pasted text, page images and photographs as data URLs. The name is the
 * clone's — it reads the field the same way whatever the file was.
 */
export function materialFromAttachments(
  attachments: readonly ChatAttachment[],
): { text: string; images: string[] } | null {
  const sections: string[] = [];
  const images: string[] = [];
  let budget = MAX_MATERIAL_CHARS;
  for (const attachment of attachments) {
    if (attachment.type === "document" || attachment.type === "text") {
      const body = attachment.text.trim();
      if (!body || budget <= 0) continue;
      const slice = body.slice(0, budget);
      budget -= slice.length;
      sections.push(`## ${attachment.name}\n\n${slice}`);
    } else if (attachment.type === "image" && images.length < MAX_MATERIAL_IMAGES) {
      images.push(attachment.dataUrl);
    }
  }
  if (!sections.length && !images.length) return null;
  return { text: sections.join("\n\n"), images };
}

/** The label a card and a transcript keep for a run. */
export function classroomRunLabel(request: ClassroomRequest): string {
  const brief = request.brief.trim();
  return brief.length > 120 ? `${brief.slice(0, 117)}…` : brief;
}

/** The markdown a finished run leaves in the chat. */
export function classroomSummary(input: {
  classroomId: string;
  scenesCount: number;
  request: ClassroomRequest;
  artifactSaved: boolean;
  note?: string;
}): string {
  const openPath = classroomOpenPath(input.classroomId);
  const scenes = `${input.scenesCount} scene${input.scenesCount === 1 ? "" : "s"}`;
  const lines = [
    `**Classroom ready** — ${scenes}, ${describeClassroomRequest(input.request)}.`,
    "",
    `[Open the classroom](${openPath})`,
  ];
  if (input.artifactSaved) {
    lines.push("", "The lesson is filed as an artifact of this chat.");
  }
  if (input.note) lines.push("", input.note);
  return lines.join("\n");
}

export interface ClassroomRuntimeWorkerRunInput {
  userId: number;
  runtimeJobId?: string;
  request: ClassroomRequest;
  attachments: readonly ChatAttachment[];
  /** The chat's model — the classroom is generated on the same one. */
  model: string;
  /** ChatMock's OpenAI-compatible base URL, already resolved for this request. */
  baseUrl: string;
  /** The chat the run was launched from; the classroom is filed there. */
  conversationPublicId?: string;
  /** The chat so far, so "make a lesson out of that" resolves. */
  conversationContext?: string;
}

/** Fixed Runtime worker entrypoint. Next.js routes must call `startRun`. */
export function startRuntimeWorkerRun(
  input: ClassroomRuntimeWorkerRunInput,
): { runId: string; status: ClassroomRunStatus } {
  const availability = classroomAvailability();
  if (!availability.available) {
    throw new Error(availability.reason ?? "Classroom is not available.");
  }
  const runId = input.runtimeJobId ?? `clrun_${randomUUID().replaceAll("-", "")}`;
  const run: RunState = {
    runId,
    userId: input.userId,
    request: input.request,
    status: "queued",
    sequence: 0,
    events: [],
    aborted: false,
    createdAt: Date.now(),
    jobId: "",
    classroomId: "",
  };
  runs.set(runId, run);
  emit(run, "run.queued", {
    label: classroomRunLabel(input.request),
    description: describeClassroomRequest(input.request),
    model: input.model,
  });
  void drive(run, input).catch((error: unknown) => {
    finish(run, "failed", {
      error: error instanceof Error ? error.message : "The classroom could not be generated.",
    });
  });
  return { runId, status: run.status };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function progressPayload(job: ClassroomJobSnapshot): Record<string, unknown> {
  return {
    step: job.step,
    progress: job.progress,
    message: job.message,
    scenesGenerated: job.scenesGenerated,
    totalScenes: job.totalScenes,
  };
}

async function drive(run: RunState, input: ClassroomRuntimeWorkerRunInput): Promise<void> {
  const deadline = run.createdAt + RUN_TIMEOUT_MS;
  emit(run, "service.starting", {});
  const service = await ensureService({ upstreamUrl: input.baseUrl, model: input.model });
  if (run.aborted) return;
  run.status = "running";
  emit(run, "service.ready", { baseUrl: service.baseUrl });

  const material = materialFromAttachments(input.attachments);
  const started = await startClassroomJob(service.baseUrl, {
    requirement: promptWithContext(run.request.brief, input.conversationContext),
    ...(material ? { pdfContent: material } : {}),
    enableTTS: run.request.tts,
    enableImageGeneration: run.request.images,
    enableWebSearch: run.request.webSearch,
    agentMode: run.request.agentMode,
  });
  if (run.aborted) return;
  run.jobId = started.jobId;
  emit(run, "classroom.queued", {
    jobId: started.jobId,
    materialChars: material?.text.length ?? 0,
    materialImages: material?.images.length ?? 0,
  });

  const pollMs = Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, started.pollIntervalMs));
  let lastSignature = "";
  let consecutiveFailures = 0;
  for (;;) {
    await sleep(pollMs);
    if (run.aborted) return;
    if (Date.now() > deadline) {
      finish(run, "failed", {
        error: "The classroom ran past its time limit. OpenMAIC may still finish it; check its own page.",
      });
      return;
    }
    let job: ClassroomJobSnapshot;
    try {
      job = await readClassroomJob(service.baseUrl, run.jobId);
      consecutiveFailures = 0;
    } catch (error) {
      consecutiveFailures += 1;
      if (consecutiveFailures < 5) continue;
      finish(run, "failed", {
        error: `OpenMAIC stopped answering while the classroom was generating: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      });
      return;
    }
    const signature = `${job.status}|${job.step}|${job.progress}|${job.scenesGenerated}|${job.message}`;
    if (signature !== lastSignature) {
      lastSignature = signature;
      emit(run, "classroom.progress", progressPayload(job));
    }
    if (!job.done) continue;
    if (job.status === "failed" || !job.result) {
      finish(run, "failed", {
        error: job.error || job.message || "OpenMAIC could not generate the classroom.",
      });
      return;
    }
    await complete(run, input, service.baseUrl, job.result);
    return;
  }
}

async function complete(
  run: RunState,
  input: ClassroomRuntimeWorkerRunInput,
  baseUrl: string,
  result: { classroomId: string; scenesCount: number },
): Promise<void> {
  run.classroomId = result.classroomId;
  const openPath = classroomOpenPath(result.classroomId);
  emit(run, "classroom.ready", {
    classroomId: result.classroomId,
    openPath,
    scenesCount: result.scenesCount,
  });

  // Filed as an artifact of the chat that asked for it. Best effort, and said
  // plainly when it cannot be: the classroom itself is already on disk.
  let artifactSaved = false;
  let note: string | undefined;
  if (input.conversationPublicId) {
    const context = openClassroomArtifactContext({
      userId: run.userId,
      conversationPublicId: input.conversationPublicId,
      label: `Classroom: ${classroomRunLabel(run.request)}`,
      agentRunId: run.runId,
    });
    if (context) {
      try {
        const document = await readClassroom(baseUrl, result.classroomId);
        const artifact = saveClassroomArtifact({
          context,
          document,
          brief: run.request.brief,
          openPath,
        });
        artifactSaved = true;
        emit(run, "artifact.saved", { artifactId: artifact.id, title: artifact.title });
        closeClassroomArtifactContext(context, "completed");
      } catch (error) {
        closeClassroomArtifactContext(context, "failed");
        note = `The lesson could not be filed as an artifact: ${
          error instanceof Error ? error.message : "unknown error"
        }.`;
        emit(run, "artifact.failed", { error: note });
      }
    } else {
      note = "The lesson was not filed as an artifact: this chat has no runtime session.";
    }
  }

  finish(run, "completed", {
    summary: classroomSummary({
      classroomId: result.classroomId,
      scenesCount: result.scenesCount,
      request: run.request,
      artifactSaved,
      note,
    }),
    classroomId: result.classroomId,
    openPath,
    scenesCount: result.scenesCount,
  });
}

export function getRuntimeWorkerEventsSince(
  userId: number,
  runId: string,
  since = 0,
): ClassroomEvent[] {
  return requireRun(userId, runId).events.filter((event) => event.sequenceNumber > since);
}

export function isRuntimeWorkerTerminal(userId: number, runId: string): boolean {
  return TERMINAL.has(requireRun(userId, runId).status);
}

export function abortRuntimeWorkerRun(userId: number, runId: string): boolean {
  const run = requireRun(userId, runId);
  if (TERMINAL.has(run.status)) return false;
  run.aborted = true;
  run.status = "aborted";
  emit(run, "run.aborted", {
    summary: run.jobId
      ? "The classroom run was stopped. OpenMAIC has no way to cancel a job in flight, so it may still finish the lesson on its own; it is not filed here."
      : "The classroom run was stopped before generation started.",
    elapsedSec: (Date.now() - run.createdAt) / 1_000,
  });
  scheduleCleanup(run);
  return true;
}

export interface StartRunInput {
  userId: number;
  requestId?: string;
  request: ClassroomRequest;
  attachments: readonly ChatAttachment[];
  model: string;
  baseUrl: string;
  conversationPublicId?: string;
  conversationContext?: string;
}

/**
 * Public facade, in the shape every agent's route calls. The run executes in
 * this process today; moving it to a Runtime V2 worker is a change to this
 * function and nothing above it.
 */
export async function startRun(
  input: StartRunInput,
): Promise<{ runId: string; status: ClassroomRunStatus }> {
  return startRuntimeWorkerRun({
    userId: input.userId,
    runtimeJobId: input.requestId ? `clrun_${input.requestId.replace(/[^A-Za-z0-9]/g, "")}` : undefined,
    request: input.request,
    attachments: input.attachments,
    model: input.model,
    baseUrl: input.baseUrl,
    conversationPublicId: input.conversationPublicId,
    conversationContext: input.conversationContext,
  });
}

export async function getEventsSince(
  userId: number,
  runId: string,
  since = 0,
): Promise<ClassroomEvent[]> {
  return getRuntimeWorkerEventsSince(userId, runId, since);
}

export async function isTerminal(userId: number, runId: string): Promise<boolean> {
  return isRuntimeWorkerTerminal(userId, runId);
}

export async function abortRun(userId: number, runId: string): Promise<boolean> {
  return abortRuntimeWorkerRun(userId, runId);
}
