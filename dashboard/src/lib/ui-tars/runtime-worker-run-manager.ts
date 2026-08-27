// One fresh disposable Agent TARS Runtime V2 worker owns one complete run.
//
// The worker loads immutable private launch material from Runtime's own data
// root, creates or re-attaches to the same upstream adapter run using the
// Runtime job id, and mirrors only bounded normalized events. It stays alive
// while an action awaits external approval. Rust owns the held UI-TARS service
// dependency and the final worker/process-tree lifetime.

import { loadUITarsRunProfile } from "./run-profile.ts";
import {
  UITarsRuntimeWorkerClient,
  UITarsWorkerAdapterError,
  type UITarsAdapterEvent,
  type UITarsAdapterRunSummary,
} from "./runtime-worker-client.ts";

export interface UITarsRuntimeEvent {
  readonly sequenceNumber: number;
  readonly type: string;
  readonly payload: Record<string, unknown>;
  readonly at: string;
}

type WorkerStatus = "queued" | "running" | "completed" | "failed" | "aborted";

export interface StartUITarsRuntimeWorkerInput {
  readonly userId: number;
  readonly runtimeJobId: string;
  readonly runtimeDataRoot: string;
  readonly agentId: string;
  readonly task: string;
  readonly profileId: string;
}

interface RunState {
  readonly runId: string;
  readonly userId: number;
  readonly agentId: string;
  readonly task: string;
  readonly events: UITarsRuntimeEvent[];
  upstreamCursor: number;
  status: WorkerStatus;
  terminal: boolean;
  abortRequested: boolean;
  upstreamCreated: boolean;
  client: UITarsRuntimeWorkerClient | null;
  initialized: Promise<void>;
  resolveInitialized: () => void;
  abortPromise: Promise<void> | null;
}

const runtimeGlobal = globalThis as typeof globalThis & {
  __breadboardUITarsRuntimeRuns?: Map<string, RunState>;
};
const runs = runtimeGlobal.__breadboardUITarsRuntimeRuns ?? new Map<string, RunState>();
runtimeGlobal.__breadboardUITarsRuntimeRuns = runs;

const MAX_EVENTS = 5_000;
const MAX_EVENT_BYTES = 48 * 1024;
const POLL_MS = 200;
const ABORT_CONFIRM_TIMEOUT_MS = 10_000;
const TERMINAL_TYPES = new Set(["run.completed", "run.failed", "run.aborted"]);
const EVENT_TYPES = new Set([
  "run.queued",
  "run.started",
  "run.status",
  "agent.thinking",
  "agent.usage",
  "observation.screenshot",
  "observation.page",
  "action.proposed",
  "approval.requested",
  "approval.approved",
  "approval.rejected",
  "action.started",
  "action.completed",
  "action.failed",
  "artifact.created",
  "run.completed",
  "run.failed",
  "run.aborted",
  "runtime.disconnected",
]);

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function statusFromSummary(summary: UITarsAdapterRunSummary): WorkerStatus {
  if (summary.status === "completed") return "completed";
  if (summary.status === "aborted") return "aborted";
  if (summary.status === "failed" || summary.status === "runtime_lost") return "failed";
  return summary.status === "queued" ? "queued" : "running";
}

function markTerminal(run: RunState, status: Exclude<WorkerStatus, "queued" | "running">): void {
  if (run.terminal) return;
  run.status = status;
  run.terminal = true;
}

function validatePayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The Agent TARS adapter event payload is invalid.");
  }
  let bytes: number;
  try {
    bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    throw new Error("The Agent TARS adapter event payload is invalid.");
  }
  if (bytes > MAX_EVENT_BYTES) {
    throw new Error("The Agent TARS adapter event exceeded its bound.");
  }
  return value as Record<string, unknown>;
}

function appendEvent(run: RunState, candidate: UITarsAdapterEvent): void {
  if (candidate.sequenceNumber <= run.upstreamCursor) return;
  if (
    candidate.runId !== run.runId ||
    !Number.isSafeInteger(candidate.sequenceNumber) ||
    candidate.sequenceNumber < 1 ||
    !EVENT_TYPES.has(candidate.type) ||
    typeof candidate.at !== "string" ||
    !Number.isFinite(Date.parse(candidate.at))
  ) {
    throw new Error("The Agent TARS adapter event stream is invalid.");
  }
  const event: UITarsRuntimeEvent = {
    sequenceNumber: candidate.sequenceNumber,
    type: candidate.type,
    payload: validatePayload(candidate.payload),
    at: candidate.at,
  };
  run.upstreamCursor = event.sequenceNumber;
  run.events.push(event);
  if (run.events.length > MAX_EVENTS) run.events.shift();
  if (event.type === "run.completed") markTerminal(run, "completed");
  else if (event.type === "run.failed") markTerminal(run, "failed");
  else if (event.type === "run.aborted") markTerminal(run, "aborted");
}

function appendSynthetic(
  run: RunState,
  type: "run.failed" | "run.aborted" | "run.completed" | "runtime.disconnected",
  payload: Record<string, unknown>,
): void {
  if (run.terminal && TERMINAL_TYPES.has(type)) return;
  const event: UITarsRuntimeEvent = {
    sequenceNumber: run.upstreamCursor + 1,
    type,
    payload: validatePayload(payload),
    at: new Date().toISOString(),
  };
  run.upstreamCursor = event.sequenceNumber;
  run.events.push(event);
  if (run.events.length > MAX_EVENTS) run.events.shift();
  if (type === "run.completed") markTerminal(run, "completed");
  else if (type === "run.failed") markTerminal(run, "failed");
  else if (type === "run.aborted") markTerminal(run, "aborted");
}

function validateSummary(run: RunState, summary: UITarsAdapterRunSummary): void {
  if (
    summary.runId !== run.runId ||
    summary.ownerUserId !== run.userId ||
    summary.task !== run.task ||
    !["browser", "computer"].includes(summary.operatorType) ||
    !Number.isSafeInteger(summary.lastSequence) ||
    summary.lastSequence < 0
  ) {
    throw new Error("The Agent TARS adapter returned a mismatched run.");
  }
}

function finishFromSummary(run: RunState, summary: UITarsAdapterRunSummary): void {
  if (run.terminal) return;
  const status = statusFromSummary(summary);
  run.status = status;
  if (status === "completed") {
    appendSynthetic(run, "run.completed", { summary: "Task completed." });
  } else if (status === "aborted") {
    appendSynthetic(run, "run.aborted", {});
  } else if (status === "failed") {
    const runtimeLost = summary.status === "runtime_lost";
    const code = runtimeLost ? "runtime_lost" : summary.failure?.code ?? "failed";
    const message = runtimeLost
      ? summary.failure?.message || "The Agent TARS runtime disconnected."
      : summary.failure?.message || "Agent TARS could not complete the task.";
    if (runtimeLost && !run.events.some((event) => event.type === "runtime.disconnected")) {
      appendSynthetic(run, "runtime.disconnected", { code, message });
    }
    appendSynthetic(run, "run.failed", {
      code: String(code).slice(0, 80),
      message: String(message).slice(0, 2_000),
    });
  }
}

async function pollOnce(run: RunState): Promise<void> {
  if (!run.client || !run.upstreamCreated || run.terminal) return;
  const events = await run.client.eventsSince(run.runId, run.userId, run.upstreamCursor);
  if (!Array.isArray(events) || events.length > MAX_EVENTS) {
    throw new Error("The Agent TARS adapter event response is invalid.");
  }
  for (const event of events) appendEvent(run, event);
  if (run.terminal) return;
  const summary = await run.client.getRun(run.runId, run.userId);
  validateSummary(run, summary);
  finishFromSummary(run, summary);
}

function stableFailure(error: unknown): { code: string; message: string } {
  const code = error instanceof UITarsWorkerAdapterError ? error.code : "runtime_error";
  if (code === "run_not_found") {
    return {
      code: "runtime_lost",
      message: "Agent TARS stopped because its desktop runtime closed. Start a new run to continue.",
    };
  }
  if (code === "unavailable" || code === "timeout") {
    return { code: "runtime_unavailable", message: "The Agent TARS runtime is unavailable." };
  }
  return { code: code.slice(0, 80), message: "Agent TARS could not complete the task." };
}

async function performAbort(run: RunState): Promise<void> {
  await run.initialized;
  if (run.terminal) return;
  if (run.client && run.upstreamCreated) {
    try {
      // The terminal checkpoint is deliberately held until this authenticated
      // upstream abort attempt has settled.
      await run.client.abort(run.runId, run.userId);
    } catch (error) {
      if (!(error instanceof UITarsWorkerAdapterError) || error.code !== "run_not_found") {
        // Rust still reaps the held service tree after the cancellation grace.
      }
    }
    const deadline = Date.now() + ABORT_CONFIRM_TIMEOUT_MS;
    while (!run.terminal && Date.now() < deadline) {
      try {
        await pollOnce(run);
      } catch {
        break;
      }
      if (!run.terminal) await wait(100);
    }
  }
  if (!run.terminal) appendSynthetic(run, "run.aborted", {});
}

function ensureAbort(run: RunState): Promise<void> {
  run.abortRequested = true;
  run.abortPromise ??= performAbort(run);
  return run.abortPromise;
}

async function execute(run: RunState, input: StartUITarsRuntimeWorkerInput): Promise<void> {
  try {
    const profile = loadUITarsRunProfile(input.runtimeDataRoot, {
      profileId: input.profileId,
      ownerUserId: input.userId,
      agentId: input.agentId,
      task: input.task,
    });
    run.client = new UITarsRuntimeWorkerClient();
    if (run.abortRequested) {
      run.resolveInitialized();
      await ensureAbort(run);
      return;
    }

    let summary: UITarsAdapterRunSummary;
    try {
      summary = await run.client.getRun(run.runId, run.userId);
      validateSummary(run, summary);
    } catch (error) {
      if (!(error instanceof UITarsWorkerAdapterError) || error.code !== "run_not_found") {
        throw error;
      }
      summary = await run.client.createRun({
        runId: run.runId,
        ownerUserId: run.userId,
        task: run.task,
        configuration: profile.configuration,
        providerApiKey: profile.providerApiKey,
      });
      validateSummary(run, summary);
    }
    run.upstreamCreated = true;
    run.status = statusFromSummary(summary);
    run.resolveInitialized();
    if (run.abortRequested) {
      await ensureAbort(run);
      return;
    }

    while (!run.terminal) {
      await pollOnce(run);
      if (!run.terminal) await wait(POLL_MS);
      if (run.abortRequested) await ensureAbort(run);
    }
  } catch (error) {
    run.resolveInitialized();
    if (run.abortRequested) {
      await ensureAbort(run);
      return;
    }
    const failure = stableFailure(error);
    if (failure.code === "runtime_lost") {
      appendSynthetic(run, "runtime.disconnected", failure);
    }
    appendSynthetic(run, "run.failed", failure);
  }
}

export function startRuntimeWorkerRun(
  input: StartUITarsRuntimeWorkerInput,
): { readonly runId: string; readonly status: WorkerStatus } {
  if (
    !Number.isSafeInteger(input.userId) ||
    input.userId < 1 ||
    !/^[A-Za-z0-9_-]{1,128}$/u.test(input.runtimeJobId) ||
    !/^uta_[0-9a-f]{32}$/u.test(input.agentId) ||
    !/^utp_[0-9a-f]{32}$/u.test(input.profileId) ||
    typeof input.runtimeDataRoot !== "string" ||
    !input.runtimeDataRoot ||
    typeof input.task !== "string" ||
    !input.task.trim() ||
    input.task !== input.task.trim() ||
    input.task.length > 8_000
  ) {
    throw new Error("The Agent TARS Runtime worker input is invalid.");
  }
  if (runs.has(input.runtimeJobId)) {
    throw new Error("The Agent TARS Runtime identity was reused.");
  }
  let resolveInitialized: () => void = () => undefined;
  const initialized = new Promise<void>((resolve) => {
    resolveInitialized = resolve;
  });
  const run: RunState = {
    runId: input.runtimeJobId,
    userId: input.userId,
    agentId: input.agentId,
    task: input.task,
    events: [],
    upstreamCursor: 0,
    status: "queued",
    terminal: false,
    abortRequested: false,
    upstreamCreated: false,
    client: null,
    initialized,
    resolveInitialized,
    abortPromise: null,
  };
  runs.set(run.runId, run);
  void execute(run, input);
  return { runId: run.runId, status: run.status };
}

function requireRun(userId: number, runId: string): RunState {
  const run = runs.get(runId);
  if (!run || run.userId !== userId) throw new Error("run_not_found");
  return run;
}

export function getRuntimeWorkerEventsSince(
  userId: number,
  runId: string,
  since: number,
): UITarsRuntimeEvent[] {
  return requireRun(userId, runId).events.filter((event) => event.sequenceNumber > since);
}

export function isRuntimeWorkerTerminal(userId: number, runId: string): boolean {
  const run = runs.get(runId);
  return !run || run.userId !== userId || run.terminal;
}

export async function abortRuntimeWorkerRun(userId: number, runId: string): Promise<void> {
  await ensureAbort(requireRun(userId, runId));
}
