// Dashboard-side ViMax façade. The complete production manager is loaded only
// by the fixed disposable Runtime V2 worker; this process owns no model/media
// pipeline and no child process.

import { randomUUID } from "node:crypto";

import {
  runCinemaAgentJob,
  type CinemaRunEvent,
  type CinemaRunStatus,
} from "../runtime-v2/cinema-agent-job.ts";
import type { VimaxRequest } from "./identity.ts";

export interface VimaxRunEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

type RunStatus = CinemaRunStatus;

interface RunState {
  runId: string;
  userId: number;
  brief: string;
  status: RunStatus;
  sequence: number;
  remoteSequence: number;
  events: VimaxRunEvent[];
  aborted: boolean;
  controller: AbortController;
}

const globalRuns = globalThis as typeof globalThis & {
  __breadboardRuntimeV2VimaxRuns?: Map<string, RunState>;
};
const runs = globalRuns.__breadboardRuntimeV2VimaxRuns ?? new Map<string, RunState>();
globalRuns.__breadboardRuntimeV2VimaxRuns = runs;

const MAX_EVENTS = 2_000;
const RETENTION_MS = 15 * 60 * 1000;

function emit(run: RunState, type: string, payload: Record<string, unknown> = {}): void {
  if (run.aborted && type !== "run.aborted") return;
  run.sequence += 1;
  run.events.push({ sequenceNumber: run.sequence, type, payload, at: new Date().toISOString() });
  if (run.events.length > MAX_EVENTS) run.events.splice(0, run.events.length - MAX_EVENTS);
}

function accept(run: RunState, events: readonly CinemaRunEvent[], status: CinemaRunStatus): void {
  if (run.aborted) return;
  for (const event of events) {
    if (event.sequenceNumber <= run.remoteSequence) continue;
    run.remoteSequence = event.sequenceNumber;
    emit(run, event.type, { ...event.payload });
  }
  run.status = status;
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
    remoteSequence: 0,
    events: [],
    aborted: false,
    controller: new AbortController(),
  };
  runs.set(runId, run);
  void drive(run, input).catch((error: unknown) => {
    if (run.aborted || ["completed", "failed", "aborted"].includes(run.status)) return;
    run.status = "failed";
    emit(run, "run.failed", {
      error: error instanceof Error ? error.message : "The ViMax run failed.",
    });
    schedule(run);
  });
  return { runId, status: "queued" };
}

async function drive(run: RunState, input: StartVimaxRunInput): Promise<void> {
  const outcome = await runCinemaAgentJob({
    kind: "vimax",
    userId: input.userId,
    conversationId: input.conversationPublicId,
    runId: run.runId,
    requestPayload: {
      operation: "run",
      runId: run.runId,
      conversationPublicId: input.conversationPublicId,
      brief: input.brief,
      parsed: input.parsed,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      baseUrl: input.baseUrl,
      conversationContext: input.conversationContext ?? "",
    },
    signal: run.controller.signal,
    onEvents: (events, status) => accept(run, events, status),
  });
  if (run.aborted) return;
  if (outcome.status === "completed" && run.status !== "completed") {
    run.status = "failed";
    emit(run, "run.failed", { error: "The ViMax worker completed without its final event." });
  } else if (outcome.status === "failed" && run.status !== "failed") {
    run.status = "failed";
    emit(run, "run.failed", { error: outcome.failureMessage ?? "The ViMax run failed." });
  } else if (outcome.status === "aborted" && run.status !== "aborted") {
    run.status = "aborted";
    emit(run, "run.aborted", { summary: "The ViMax run was stopped." });
  }
  if (["completed", "failed", "aborted"].includes(run.status)) schedule(run);
}

function schedule(run: RunState): void {
  setTimeout(() => runs.delete(run.runId), RETENTION_MS).unref?.();
}

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
