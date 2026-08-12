// In-memory run manager for the MoneyPrinter agent.
//
// Unlike the ChatMock-driven agents, Breadboard does not run a tool loop here.
// The cloned project owns the whole pipeline — write the script, pick the search
// terms, record the voiceover, time the subtitles, download the footage, cut the
// video — and there would be no point reimplementing any of it. Breadboard
// starts that service (./service.ts), points it at ChatMock, posts one task per
// run, and translates its progress into the same event shape every other agent's
// inline card reads.
//
// The clone reports progress as a single integer, set once before each stage
// begins. That number is the only thing it says about where a run has got to, so
// this module is where it becomes a sentence a person can read.
//
// Runs are ephemeral; what they produce is not. Events live here and the SSE
// route replays them; the finished cut becomes an artifact bound to the chat.

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { chatmockApiKeyValue } from "../agent-browser/provider.ts";
import {
  closeMoneyPrinterArtifactContext,
  openMoneyPrinterArtifactContext,
  publishTaskVideo,
  type PublishedVideo,
} from "./artifact.ts";
import { configuredFootageSources } from "./config-file.ts";
import { availableFootageSources } from "./credentials.ts";
import { moneyPrinterRunLabel, type MoneyPrinterRequest } from "./identity.ts";
import { ensureService, serviceLog, stopService } from "./service.ts";
import { invalidateHealth, tasksDirectory } from "./runtime.ts";
import { taskRequestBody } from "./settings.ts";

export interface MoneyPrinterEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

type RunStatus = "queued" | "running" | "completed" | "failed" | "aborted";

interface RunState {
  runId: string;
  userId: number;
  request: MoneyPrinterRequest;
  status: RunStatus;
  sequence: number;
  events: MoneyPrinterEvent[];
  aborted: boolean;
  /** The clone's task, once it exists — what a failure report names. */
  taskId: string | null;
  /** Stops the poll loop the moment the run reaches a terminal state. */
  polling: AbortController;
  createdAt: number;
}

const globalRuns = globalThis as typeof globalThis & {
  __breadboardMoneyPrinterRuns?: Map<string, RunState>;
};
const runs = globalRuns.__breadboardMoneyPrinterRuns ?? new Map<string, RunState>();
globalRuns.__breadboardMoneyPrinterRuns = runs;

const MAX_EVENTS = 2_000;
const RETENTION_MS = 30 * 60 * 1000;
// Downloading a dozen clips and re-encoding them at 1080p is genuinely long, and
// a run asking for several cuts multiplies the last stage.
const RUN_TIMEOUT_MS = 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 1_500;
/** The clone's own task states, from app/models/const.py. */
const TASK_STATE = { failed: -1, complete: 1, processing: 4 } as const;

/**
 * What the clone is doing at each progress mark. The numbers are the ones its
 * pipeline sets, in order, immediately before the stage they announce — so the
 * sentence describes the work that is starting, not the work that just finished.
 */
const STAGES: Array<{ at: number; label: string }> = [
  { at: 5, label: "Writing the script" },
  { at: 10, label: "Choosing what footage to search for" },
  { at: 20, label: "Recording the voiceover" },
  { at: 30, label: "Timing the subtitles" },
  { at: 40, label: "Finding and downloading footage" },
  { at: 50, label: "Cutting the video" },
];

export function stageForProgress(progress: number): string {
  let label = STAGES[0].label;
  for (const stage of STAGES) {
    if (progress >= stage.at) label = stage.label;
  }
  return label;
}

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

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** How many runs are still driving the shared service. */
function activeRunCount(): number {
  let active = 0;
  for (const run of runs.values()) {
    if (run.status === "queued" || run.status === "running") active += 1;
  }
  return active;
}

// ---- the clone's HTTP surface ----------------------------------------------

async function call(
  url: string,
  route: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(new URL(route, url), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

/**
 * Every response the clone sends is wrapped in `{status, data, message}`, and
 * `data` is omitted entirely when it is falsy — so an empty object here means
 * "nothing to report", not "malformed".
 */
async function envelope(response: Response): Promise<Record<string, unknown>> {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return record(body.data);
}

/**
 * The clips already sitting in the clone's own material folder, by filename.
 *
 * Read from the clone's own listing rather than from disk: it is the endpoint
 * that decides which extensions count, and it deliberately reports names rather
 * than paths because that is the only form the task pipeline will resolve.
 */
async function localMaterials(url: string): Promise<string[]> {
  try {
    const response = await call(url, "/api/v1/video_materials");
    if (!response.ok) return [];
    const files = (await envelope(response)).files;
    if (!Array.isArray(files)) return [];
    return files
      .map((entry) => text(record(entry).file) || text(record(entry).name))
      .filter(Boolean);
  } catch {
    // An empty list produces a clear refusal below; a thrown error here would
    // report a transport problem the run does not actually have.
    return [];
  }
}

async function createTask(
  url: string,
  request: MoneyPrinterRequest,
  materials: readonly string[],
): Promise<string> {
  const response = await call(url, "/api/v1/videos", {
    method: "POST",
    body: JSON.stringify(taskRequestBody(request, materials)),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      response.status === 429
        ? "MoneyPrinter is already cutting as many videos as it can at once. Try again when the current one finishes."
        : `MoneyPrinter refused the request (${response.status}). ${detail.slice(0, 300)}`.trim(),
    );
  }
  const taskId = text((await envelope(response)).task_id);
  if (!taskId) throw new Error("MoneyPrinter accepted the request without returning a task.");
  return taskId;
}

/**
 * Turn the clone's own video references into absolute paths inside its task
 * directory.
 *
 * The API reports each cut as `/tasks/<id>/final-1.mp4` — a URL path under its
 * static mount, not a filesystem path — and as a full URL when an `endpoint` is
 * configured. On Windows a leading slash makes `path.isAbsolute` say true of
 * that URL path, so the mount prefix is stripped before anything is treated as
 * absolute; without that every finished video resolved to `C:\tasks\…` and was
 * thrown away as outside the workspace.
 *
 * Anything that does not resolve back inside `storage/tasks` is dropped rather
 * than followed: the artifact store would refuse it anyway, and refusing here
 * says why.
 */
export function resolveTaskVideos(videos: unknown, tasksRoot: string): string[] {
  if (!Array.isArray(videos)) return [];
  const root = path.resolve(tasksRoot);
  const resolved: string[] = [];
  for (const entry of videos) {
    if (typeof entry !== "string" || !entry.trim()) continue;
    let reference = entry.trim();
    if (/^https?:\/\//i.test(reference)) {
      try {
        reference = decodeURIComponent(new URL(reference).pathname);
      } catch {
        continue;
      }
    }
    const mounted = /^[\\/]?tasks[\\/]/i.exec(reference);
    const candidate = mounted
      ? path.resolve(root, reference.slice(mounted[0].length))
      : path.isAbsolute(reference)
        ? path.resolve(reference)
        : path.resolve(root, reference);
    const inside = path.relative(root, candidate);
    if (!inside || inside.startsWith("..") || path.isAbsolute(inside)) continue;
    resolved.push(candidate);
  }
  return resolved;
}

// ---- lifecycle --------------------------------------------------------------

export interface StartRunInput {
  userId: number;
  conversationPublicId: string;
  request: MoneyPrinterRequest;
  /** The chat's model — what the clone writes the script with. */
  model: string;
  /** ChatMock's OpenAI-compatible base URL, already resolved for this request. */
  baseUrl: string;
}

export function startRun(input: StartRunInput): { runId: string; status: RunStatus } {
  if (!input.request.subject.trim()) throw new Error("empty_brief");
  const runId = `mptrun_${randomUUID().replaceAll("-", "")}`;
  const run: RunState = {
    runId,
    userId: input.userId,
    request: input.request,
    status: "queued",
    sequence: 0,
    events: [],
    aborted: false,
    taskId: null,
    polling: new AbortController(),
    createdAt: Date.now(),
  };
  runs.set(runId, run);

  const timer = setTimeout(() => {
    if (["completed", "failed", "aborted"].includes(run.status)) return;
    run.aborted = true;
    finish(run, "failed", {
      error: "The video ran past its time limit and was stopped.",
    });
  }, RUN_TIMEOUT_MS);
  timer.unref?.();

  void drive(run, input)
    .catch((error: unknown) => {
      if (run.aborted) return;
      finish(run, "failed", {
        error: error instanceof Error ? error.message : "The MoneyPrinter run failed.",
        detail: serviceLog(),
      });
    })
    .finally(() => clearTimeout(timer));

  return { runId, status: "queued" };
}

async function drive(run: RunState, input: StartRunInput): Promise<void> {
  run.status = "running";
  emit(run, "run.started", {
    subject: run.request.subject,
    label: moneyPrinterRunLabel(run.request.subject),
    model: input.model,
    aspect: run.request.aspect,
    source: run.request.source,
    voice: run.request.voice,
    scripted: Boolean(run.request.script),
  });

  emit(run, "service.starting", {});
  const service = await ensureService({
    baseUrl: input.baseUrl,
    apiKey: chatmockApiKeyValue(),
    model: input.model,
  });
  if (run.aborted) return;
  emit(run, "service.ready", {
    model: service.model,
    startedAt: service.startedAt,
    // A service that was already up is the normal case after the first run, and
    // it is the single most useful thing to know when a run feels slow.
    coldStart: Date.now() - service.startedAt < 10_000,
  });

  // A library whose key was never entered would fail deep into the run, after
  // the script has been written and the voiceover recorded. Substituting here
  // costs nothing and is reported rather than hidden.
  const usable = new Set<string>([
    ...availableFootageSources(),
    ...configuredFootageSources(service.root),
  ]);
  if (run.request.source !== "local" && !usable.has(run.request.source)) {
    const fallback = [...usable][0];
    emit(run, "source.substituted", {
      requested: run.request.source,
      using: fallback ?? "local",
      reason: fallback
        ? `No ${run.request.source} key is set, so the footage comes from ${fallback} instead.`
        : `No footage library has a key yet, so this run can only cut from clips already in ${path.basename(
            service.root,
          )}/storage/local_videos. Add a Pexels key in MoneyPrinter's settings to search the web.`,
    });
    run.request = { ...run.request, source: (fallback ?? "local") as MoneyPrinterRequest["source"] };
  }

  // Opened before the task is posted, because the video is an artifact and it
  // needs a run to hang off.
  const context = openMoneyPrinterArtifactContext({
    userId: run.userId,
    conversationPublicId: input.conversationPublicId,
    subject: run.request.subject,
    agentRunId: run.runId,
  });

  try {
    // Local runs cut from clips the person put in the clone themselves, and the
    // pipeline never goes looking for them — a request that names none fails at
    // the materials stage after the script and voiceover have already been paid
    // for, so it is refused up front instead.
    const materials =
      run.request.source === "local" ? await localMaterials(service.url) : [];
    if (run.request.source === "local" && materials.length === 0) {
      finish(run, "failed", {
        error:
          "There is no footage to cut from. Put video or image files in the clone's storage/local_videos folder, or add a Pexels key in MoneyPrinter's settings so runs can search the web.",
      });
      return;
    }
    if (materials.length) {
      emit(run, "materials.local", { count: materials.length });
    }

    const taskId = await createTask(service.url, run.request, materials);
    run.taskId = taskId;
    emit(run, "task.created", { taskId });

    const finished = await pollTask(run, service.url, taskId);
    if (run.aborted || ["completed", "failed", "aborted"].includes(run.status)) return;

    if (count(finished.state) === TASK_STATE.failed) {
      finish(run, "failed", {
        error: text(finished.error, "MoneyPrinter could not finish this video."),
        stage: text(finished.failed_stage),
        script: text(finished.script),
      });
      return;
    }

    const tasksRoot = tasksDirectory(service.root);
    const files = resolveTaskVideos(finished.videos, tasksRoot);
    if (files.length === 0) {
      finish(run, "failed", {
        error: "MoneyPrinter reported the video as finished but produced no file.",
        detail: serviceLog(),
      });
      return;
    }

    const published: PublishedVideo[] = [];
    const rejected: string[] = [];
    for (const [index, file] of files.entries()) {
      if (!context) break;
      const stored = publishTaskVideo({
        context,
        tasksRoot,
        filePath: file,
        subject: run.request.subject,
        index,
        total: files.length,
        metadata: {
          moneyPrinterTaskId: taskId,
          moneyPrinterAspect: run.request.aspect,
          moneyPrinterSource: run.request.source,
          moneyPrinterVoice: run.request.voice,
          moneyPrinterSubtitles: run.request.subtitles,
          moneyPrinterBytes: fileSize(file),
        },
      });
      if (stored.ok) {
        published.push(stored.video);
        emit(run, "video.ready", {
          artifactId: stored.video.artifactId,
          title: stored.video.title,
          filename: stored.video.filename,
        });
      } else {
        rejected.push(stored.reason);
      }
    }

    const notice = !context
      ? "The video was cut but could not be attached to this conversation as an artifact."
      : rejected[0] ?? "";
    if (notice) emit(run, "artifact.unavailable", { reason: notice });

    finish(run, "completed", {
      summary: chatSummary({
        request: run.request,
        script: text(finished.script),
        terms: finished.terms,
        published,
        notice,
        cutCount: files.length,
      }),
      script: text(finished.script),
      videoArtifactIds: published.map((video) => video.artifactId),
      taskId,
    });
  } finally {
    closeMoneyPrinterArtifactContext(context, artifactOutcome(run));
  }
}

/**
 * How the artifact run should be closed.
 *
 * Read through a function on purpose: `finish` reassigns `run.status` from
 * inside the caller's try block, which control-flow analysis cannot see, so
 * comparing the property inline would be narrowed to the value it was last
 * assigned there and close every context the same way.
 */
function artifactOutcome(run: RunState): "completed" | "failed" | "aborted" {
  if (run.status === "completed") return "completed";
  return run.status === "aborted" ? "aborted" : "failed";
}

function fileSize(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

/**
 * Follow one task to its terminal state, narrating each stage as the progress
 * number crosses it.
 */
async function pollTask(
  run: RunState,
  url: string,
  taskId: string,
): Promise<Record<string, unknown>> {
  let lastStage = "";
  let lastProgress = -1;
  let missing = 0;
  for (;;) {
    if (run.aborted || ["completed", "failed", "aborted"].includes(run.status)) return {};
    let task: Record<string, unknown> = {};
    try {
      const response = await call(url, `/api/v1/tasks/${encodeURIComponent(taskId)}`, {
        signal: AbortSignal.any([run.polling.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
      });
      if (response.status === 404) {
        // The state store is in memory, so a service that restarted mid-run has
        // genuinely lost the task. Two misses in a row is that, not a blip.
        missing += 1;
        if (missing >= 2) {
          throw new Error("The MoneyPrinter service restarted and lost this video.");
        }
      } else if (!response.ok) {
        throw new Error(`MoneyPrinter returned ${response.status} while reporting progress.`);
      } else {
        missing = 0;
        task = await envelope(response);
      }
    } catch (error) {
      if (run.aborted) return {};
      // A refused or timed-out poll on an otherwise healthy run is worth one
      // more attempt; a lost task is not.
      if (error instanceof Error && error.message.includes("lost this video")) throw error;
      missing += 1;
      if (missing >= 4) throw error;
    }

    const state = count(task.state);
    const progress = count(task.progress);
    if (progress !== lastProgress) {
      lastProgress = progress;
      emit(run, "task.progress", { progress });
    }
    const stage = stageForProgress(progress);
    if (stage !== lastStage && state === TASK_STATE.processing) {
      lastStage = stage;
      emit(run, "stage.started", { stage, progress });
    }
    if (state === TASK_STATE.complete || state === TASK_STATE.failed) return task;

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

/**
 * The chat reply. Deliberately short: the video is the deliverable and its card
 * sits directly under this reply, so the transcript points at it rather than
 * restating it — except for the narration, which is the one thing worth reading
 * without pressing play.
 */
function chatSummary(input: {
  request: MoneyPrinterRequest;
  script: string;
  terms: unknown;
  published: PublishedVideo[];
  notice: string;
  cutCount: number;
}): string {
  const { request } = input;
  const shape = [
    `${request.aspect}`,
    request.source === "local" ? "local footage" : `${request.source} footage`,
    request.subtitles ? "subtitled" : "no subtitles",
    request.music ? "with music" : "no music",
  ].join(" · ");
  const terms = Array.isArray(input.terms)
    ? input.terms.filter((term): term is string => typeof term === "string")
    : typeof input.terms === "string"
      ? input.terms.split(/[,，]/).map((term) => term.trim()).filter(Boolean)
      : [];

  return [
    input.published.length
      ? `**${moneyPrinterRunLabel(request.subject)}** — ${
          input.published.length > 1
            ? `${input.published.length} cuts`
            : "one cut"
        }, ${shape}. Play or download it on the card below.`
      : `**${moneyPrinterRunLabel(request.subject)}** — ${input.cutCount} cut${
          input.cutCount === 1 ? "" : "s"
        } finished, ${shape}.`,
    input.script.trim() ? `**Narration**\n\n${input.script.trim()}` : "",
    terms.length ? `_Footage searched for: ${terms.slice(0, 8).join(", ")}._` : "",
    input.notice,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function finish(run: RunState, status: RunStatus, payload: Record<string, unknown>): void {
  if (["completed", "failed", "aborted"].includes(run.status)) return;
  run.status = status;
  try {
    run.polling.abort();
  } catch {
    // Already closed.
  }
  emit(
    run,
    status === "completed" ? "run.completed" : status === "aborted" ? "run.aborted" : "run.failed",
    { ...payload, elapsedSec: (Date.now() - run.createdAt) / 1_000 },
  );
  // A finished run may have started or lost the service; the settings panel
  // reads that from health.
  invalidateHealth();
  scheduleCleanup(run);
}

function scheduleCleanup(run: RunState): void {
  const timer = setTimeout(() => runs.delete(run.runId), RETENTION_MS);
  timer.unref?.();
}

// ---- read/control API -------------------------------------------------------

export function getEventsSince(userId: number, runId: string, since = 0): MoneyPrinterEvent[] {
  return requireRun(userId, runId).events.filter((event) => event.sequenceNumber > since);
}

export function isTerminal(userId: number, runId: string): boolean {
  return ["completed", "failed", "aborted"].includes(requireRun(userId, runId).status);
}

/**
 * Stop a run.
 *
 * The clone has no way to cancel a task in flight: its own delete endpoint
 * refuses a busy task, and the pipeline runs on a thread pool inside the
 * service. So stopping the last run also stops the service, which is the only
 * thing that actually ends the work rather than hiding it. With another run
 * still going, the service stays up and this one simply stops being followed —
 * killing it would take somebody else's video with it.
 */
export function abortRun(userId: number, runId: string): boolean {
  const run = requireRun(userId, runId);
  if (["completed", "failed", "aborted"].includes(run.status)) return false;
  run.aborted = true;
  const alone = activeRunCount() <= 1;
  finish(run, "aborted", {
    summary: alone
      ? "The video was stopped."
      : "This video was stopped. Another one is still being cut, so the service is still running.",
    stoppedService: alone,
  });
  if (alone) void stopService();
  return true;
}
