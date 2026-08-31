import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import {
  openExecutiveBridgePath,
  openExecutiveHealth,
  openExecutivePython,
  resolveOpenExecutiveRoot,
} from "./runtime.ts";

export interface OpenExecutiveEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

type RunStatus = "queued" | "running" | "completed" | "failed" | "aborted";

interface RunState {
  runId: string;
  userId: number;
  task: string;
  status: RunStatus;
  sequence: number;
  events: OpenExecutiveEvent[];
  child: ChildProcessWithoutNullStreams | null;
  aborted: boolean;
  output: string;
  stderr: string;
  createdAt: number;
}

const globalRuns = globalThis as typeof globalThis & {
  __breadboardOpenExecutiveRuns?: Map<string, RunState>;
};
const runs = globalRuns.__breadboardOpenExecutiveRuns ?? new Map<string, RunState>();
globalRuns.__breadboardOpenExecutiveRuns = runs;

const RETENTION_MS = 30 * 60 * 1_000;
const MAX_EVENTS = 4_000;
const MAX_OUTPUT = 400_000;

function emit(run: RunState, type: string, payload: Record<string, unknown> = {}): void {
  run.events.push({
    sequenceNumber: ++run.sequence,
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

function cleanupLater(run: RunState): void {
  const timer = setTimeout(() => runs.delete(run.runId), RETENTION_MS);
  timer.unref?.();
}

function runCompleted(run: RunState): boolean {
  return run.status === "completed";
}

export interface StartRunInput {
  userId: number;
  requestId?: string;
  task: string;
  model: string;
  reasoningEffort: string;
  baseUrl: string;
  maxIterations: number;
  committeeReview: boolean;
  conversationContext?: string;
}

export interface OpenExecutiveRuntimeWorkerRunInput extends StartRunInput {
  runtimeJobId?: string;
  runtimeDataRoot: string;
  apiKey: string;
}

export function startRuntimeWorkerRun(
  input: OpenExecutiveRuntimeWorkerRunInput,
): { runId: string; status: RunStatus } {
  const runId = input.runtimeJobId ?? `oerun_${randomUUID().replaceAll("-", "")}`;
  const run: RunState = {
    runId,
    userId: input.userId,
    task: input.task,
    status: "queued",
    sequence: 0,
    events: [],
    child: null,
    aborted: false,
    output: "",
    stderr: "",
    createdAt: Date.now(),
  };
  runs.set(runId, run);
  void drive(run, input).catch((error: unknown) => {
    if (run.aborted) return;
    run.status = "failed";
    emit(run, "run.failed", {
      summary: error instanceof Error ? error.message : "Open Executive could not complete this task.",
      elapsedSec: (Date.now() - run.createdAt) / 1_000,
    });
    cleanupLater(run);
  });
  return { runId, status: "queued" };
}

async function drive(
  run: RunState,
  input: OpenExecutiveRuntimeWorkerRunInput,
): Promise<void> {
  const runtime = resolveOpenExecutiveRoot();
  const python = openExecutivePython();
  const bridge = openExecutiveBridgePath();
  const health = openExecutiveHealth();
  if (!runtime || !python || !bridge || !health.available) {
    throw new Error(health.reason ?? "Open Executive is not ready.");
  }

  const stateRoot = path.join(
    input.runtimeDataRoot,
    "runtime-v2",
    "openexecutive",
    "users",
    String(input.userId),
  );
  await mkdir(stateRoot, { recursive: true });
  run.status = "running";
  emit(run, "run.started", {
    task: run.task,
    model: input.model,
    committeeReview: input.committeeReview,
  });

  const child = spawn(python, [bridge], {
    cwd: runtime.root,
    windowsHide: true,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      PYTHONIOENCODING: "utf-8",
      PYTHONUTF8: "1",
      PYTHONUNBUFFERED: "1",
      NO_COLOR: "1",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  run.child = child;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  let buffer = "";
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/u);
    buffer = lines.pop() ?? "";
    for (const line of lines) consumeBridgeLine(run, line);
  });
  child.stderr.on("data", (chunk: string) => {
    run.stderr = `${run.stderr}${chunk}`.slice(-32_000);
  });

  child.stdin.end(
    JSON.stringify({
      root: runtime.root,
      stateRoot,
      task: input.task,
      conversationContext: input.conversationContext ?? "",
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      maxIterations: input.maxIterations,
      committeeReview: input.committeeReview,
    }),
  );

  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  run.child = null;
  if (buffer.trim()) consumeBridgeLine(run, buffer);
  if (run.aborted || runCompleted(run)) return;
  if (code !== 0) {
    const detail = run.stderr.split(/\r?\n/u).filter(Boolean).at(-1)?.trim();
    throw new Error(detail || `Open Executive exited with code ${code ?? "unknown"}.`);
  }
  finish(run, run.output || "Open Executive finished without a response.");
}

function consumeBridgeLine(run: RunState, line: string): void {
  if (!line.trim() || run.aborted) return;
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return;
  }
  const type = typeof event.type === "string" ? event.type : "";
  if (type === "progress") {
    emit(run, "executive.progress", {
      stage: typeof event.stage === "string" ? event.stage : "working",
      summary: typeof event.summary === "string" ? event.summary : "Consulting the executive team",
    });
  }
  if (type === "delta" && typeof event.text === "string") {
    if (run.output.length < MAX_OUTPUT) run.output += event.text;
    emit(run, "executive.delta", { text: event.text });
  }
  if (type === "completed") {
    const summary =
      typeof event.summary === "string" && event.summary.trim()
        ? event.summary.trim()
        : run.output.trim();
    finish(run, summary || "Open Executive finished without a response.");
  }
}

function finish(run: RunState, summary: string): void {
  if (run.aborted || run.status === "completed") return;
  run.status = "completed";
  emit(run, "run.completed", {
    summary,
    elapsedSec: (Date.now() - run.createdAt) / 1_000,
  });
  cleanupLater(run);
}

export function getRuntimeWorkerEventsSince(
  userId: number,
  runId: string,
  since = 0,
): OpenExecutiveEvent[] {
  return requireRun(userId, runId).events.filter((event) => event.sequenceNumber > since);
}

export function isRuntimeWorkerTerminal(userId: number, runId: string): boolean {
  return ["completed", "failed", "aborted"].includes(requireRun(userId, runId).status);
}

export function abortRuntimeWorkerRun(userId: number, runId: string): boolean {
  const run = requireRun(userId, runId);
  if (["completed", "failed", "aborted"].includes(run.status)) return false;
  run.aborted = true;
  run.status = "aborted";
  try {
    run.child?.kill();
  } catch {
    // The process may already have exited.
  }
  run.child = null;
  emit(run, "run.aborted", {
    summary: "Open Executive stopped.",
    elapsedSec: (Date.now() - run.createdAt) / 1_000,
  });
  cleanupLater(run);
  return true;
}

export async function startRun(
  input: StartRunInput,
): Promise<{ runId: string; status: RunStatus }> {
  const { startOuterAgentRun } = await import("../runtime-v2/outer-agent-run.ts");
  return startOuterAgentRun({
    kind: "openexecutive",
    userId: input.userId,
    requestId: input.requestId,
    requestPayload: {
      task: input.task,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      baseUrl: input.baseUrl,
      maxIterations: input.maxIterations,
      committeeReview: input.committeeReview,
      conversationContext: input.conversationContext ?? "",
    },
  }) as Promise<{ runId: string; status: RunStatus }>;
}

export async function getEventsSince(
  userId: number,
  runId: string,
  since = 0,
): Promise<OpenExecutiveEvent[]> {
  const { readOuterAgentRunView } = await import("../runtime-v2/outer-agent-run.ts");
  const view = await readOuterAgentRunView("openexecutive", userId, runId, since);
  return view.events as OpenExecutiveEvent[];
}

export async function isTerminal(userId: number, runId: string): Promise<boolean> {
  const { readOuterAgentRunView } = await import("../runtime-v2/outer-agent-run.ts");
  return (await readOuterAgentRunView("openexecutive", userId, runId, 0)).terminal;
}

export async function abortRun(userId: number, runId: string): Promise<boolean> {
  const { abortOuterAgentRun } = await import("../runtime-v2/outer-agent-run.ts");
  return abortOuterAgentRun("openexecutive", userId, runId);
}
