// In-memory run manager for the God's Eye agent.
//
// Breadboard does not drive the globe: the clone owns the rendering, the live
// layers, and the share-link restore. What Breadboard owns is what the clone
// cannot know by itself — turning a sentence into a camera position and sensor
// style (the chat's model, through ChatMock, decides that), keeping the dev
// server alive, and the run card that frames the resulting view.
//
// A run is short: start the server if it is down, resolve the view, answer.
// The view travels with the saved summary as a private marker
// (`attachGodsEyeView`), so a reloaded card can re-aim the globe without the
// run manager remembering anything.

import { randomUUID } from "node:crypto";
import { promptWithContext } from "../conversations/agent-context.ts";
import { godsEyeRunLabel } from "./identity.ts";
import { godsEyeAvailability } from "./runtime.ts";
import { ensureService } from "./service.ts";
import {
  attachGodsEyeView,
  godsEyeOpenPath,
  GODS_EYE_STYLES,
  normalizeGodsEyeView,
  type GodsEyeView,
} from "./view.ts";

export interface GodsEyeEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

export type GodsEyeRunStatus = "queued" | "running" | "completed" | "failed" | "aborted";

interface RunState {
  runId: string;
  userId: number;
  task: string;
  status: GodsEyeRunStatus;
  sequence: number;
  events: GodsEyeEvent[];
  aborted: boolean;
  controller: AbortController;
  createdAt: number;
}

const globalRuns = globalThis as typeof globalThis & {
  __breadboardGodsEyeRuns?: Map<string, RunState>;
};
const runs = globalRuns.__breadboardGodsEyeRuns ?? new Map<string, RunState>();
globalRuns.__breadboardGodsEyeRuns = runs;

const MAX_EVENTS = 500;
const RETENTION_MS = 30 * 60 * 1_000;
const MODEL_TIMEOUT_MS = 120_000;
const TERMINAL = new Set<GodsEyeRunStatus>(["completed", "failed", "aborted"]);

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

function finish(run: RunState, status: GodsEyeRunStatus, payload: Record<string, unknown>): void {
  if (TERMINAL.has(run.status)) return;
  run.status = status;
  emit(run, status === "completed" ? "run.completed" : "run.failed", {
    ...payload,
    elapsedSec: (Date.now() - run.createdAt) / 1_000,
  });
  scheduleCleanup(run);
}

const VIEW_PROMPT = `You aim God's Eye View, a photorealistic 3D globe with live aircraft, ships, satellites, earthquakes, fires, and public cameras. Turn the user's request into one camera view.

Answer with ONE JSON object and nothing else:
{"label": string, "lat": number, "lon": number, "altM": number, "headingDeg": number, "pitchDeg": number, "style": "${GODS_EYE_STYLES.join("|")}", "summary": string}

- label: what the view is of, in a few words.
- lat/lon: the place the request names, from your geographic knowledge. If it names none, pick the most relevant place and say so in the summary.
- altM: camera altitude in meters. 400–2000 sees a few blocks, 2000–15000 a city, 50000–400000 a region, 1000000+ a continent. Watching air or sea traffic needs at least a regional altitude.
- pitchDeg: -90 is straight down; -30 to -45 is a natural oblique look.
- style: flir for thermal or heat, nvg for night vision, crt for retro, noir, snow, anime when asked; otherwise normal.
- summary: one or two present-tense sentences on what this view shows and which live layers (aircraft, vessels, satellites, quakes, fires, cameras) are worth watching there. No markdown headings.`;

/** The model's answer, holding a view and a sentence about it. */
export function parseViewAnswer(
  content: string,
): { view: GodsEyeView; summary: string } | null {
  const stripped = content.replace(/<think>[\s\S]*?(<\/think>|$)/gi, "").trim();
  // The object may arrive bare, fenced, or inside prose; take the first
  // balanced candidate that validates.
  const candidates = stripped.match(/\{[\s\S]*\}/g) ?? [];
  for (const candidate of [stripped, ...candidates]) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      const view = normalizeGodsEyeView(parsed);
      if (!view) continue;
      const summary =
        typeof parsed.summary === "string" && parsed.summary.trim()
          ? parsed.summary.trim().slice(0, 2_000)
          : `Holding over ${view.label}.`;
      return { view, summary };
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

/** The markdown a finished run leaves in the chat, view attached invisibly. */
export function godsEyeSummary(input: { view: GodsEyeView; summary: string }): string {
  const lines = [
    `**On station over ${input.view.label}.** ${input.summary}`,
    "",
    `[Open the live view](${godsEyeOpenPath(input.view)})`,
  ];
  return attachGodsEyeView(lines.join("\n"), input.view);
}

async function resolveView(
  run: RunState,
  input: GodsEyeRuntimeWorkerRunInput,
): Promise<{ view: GodsEyeView; summary: string }> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  run.controller.signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);
  try {
    const response = await fetch(`${input.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.apiKey ?? "chatmock"}`,
      },
      body: JSON.stringify({
        model: input.model,
        messages: [
          { role: "system", content: VIEW_PROMPT },
          { role: "user", content: promptWithContext(run.task, input.conversationContext) },
        ],
        reasoning_effort: "low",
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`ChatMock returned ${response.status}`);
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = data.choices?.[0]?.message?.content ?? "";
    const answer = parseViewAnswer(content);
    if (!answer) {
      throw new Error("The model did not return a usable view for this request.");
    }
    return answer;
  } finally {
    clearTimeout(timer);
    run.controller.signal.removeEventListener("abort", abort);
  }
}

export interface GodsEyeRuntimeWorkerRunInput {
  userId: number;
  runtimeJobId?: string;
  task: string;
  /** The chat's model — the view is resolved on the same one. */
  model: string;
  /** ChatMock's OpenAI-compatible base URL, already resolved for this request. */
  baseUrl: string;
  apiKey?: string;
  /** The chat so far, so "zoom in on that" resolves. */
  conversationContext?: string;
  conversationPublicId?: string;
}

/** Fixed Runtime worker entrypoint. Next.js routes must call `startRun`. */
export function startRuntimeWorkerRun(
  input: GodsEyeRuntimeWorkerRunInput,
): { runId: string; status: GodsEyeRunStatus } {
  const availability = godsEyeAvailability();
  if (!availability.available) {
    throw new Error(availability.reason ?? "God's Eye is not available.");
  }
  const runId = input.runtimeJobId ?? `gerun_${randomUUID().replaceAll("-", "")}`;
  const run: RunState = {
    runId,
    userId: input.userId,
    task: input.task,
    status: "queued",
    sequence: 0,
    events: [],
    aborted: false,
    controller: new AbortController(),
    createdAt: Date.now(),
  };
  runs.set(runId, run);
  emit(run, "run.queued", { label: godsEyeRunLabel(input.task), model: input.model });
  void drive(run, input).catch((error: unknown) => {
    finish(run, "failed", {
      error: error instanceof Error ? error.message : "The view could not be resolved.",
    });
  });
  return { runId, status: run.status };
}

async function drive(run: RunState, input: GodsEyeRuntimeWorkerRunInput): Promise<void> {
  emit(run, "service.starting", {});
  await ensureService();
  if (run.aborted) return;
  run.status = "running";
  emit(run, "service.ready", {});

  emit(run, "view.resolving", {});
  const answer = await resolveView(run, input);
  if (run.aborted) return;
  emit(run, "view.resolved", { view: answer.view });

  finish(run, "completed", {
    summary: godsEyeSummary(answer),
    view: answer.view,
    openPath: godsEyeOpenPath(answer.view),
  });
}

export function getRuntimeWorkerEventsSince(
  userId: number,
  runId: string,
  since = 0,
): GodsEyeEvent[] {
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
  run.controller.abort();
  emit(run, "run.aborted", {
    summary: "God's Eye was stopped before it framed the view.",
    elapsedSec: (Date.now() - run.createdAt) / 1_000,
  });
  scheduleCleanup(run);
  return true;
}

export interface StartRunInput {
  userId: number;
  requestId?: string;
  task: string;
  model: string;
  baseUrl: string;
  apiKey?: string;
  conversationContext?: string;
  conversationPublicId?: string;
}

/**
 * Public facade, in the shape every agent's route calls. The run executes in
 * this process today; moving it to a Runtime V2 worker is a change to this
 * function and nothing above it.
 */
export async function startRun(
  input: StartRunInput,
): Promise<{ runId: string; status: GodsEyeRunStatus }> {
  return startRuntimeWorkerRun({
    userId: input.userId,
    runtimeJobId: input.requestId
      ? `gerun_${input.requestId.replace(/[^A-Za-z0-9]/g, "")}`
      : undefined,
    task: input.task,
    model: input.model,
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    conversationContext: input.conversationContext,
    conversationPublicId: input.conversationPublicId,
  });
}

export async function getEventsSince(
  userId: number,
  runId: string,
  since = 0,
): Promise<GodsEyeEvent[]> {
  return getRuntimeWorkerEventsSince(userId, runId, since);
}

export async function isTerminal(userId: number, runId: string): Promise<boolean> {
  return isRuntimeWorkerTerminal(userId, runId);
}

export async function abortRun(userId: number, runId: string): Promise<boolean> {
  return abortRuntimeWorkerRun(userId, runId);
}
