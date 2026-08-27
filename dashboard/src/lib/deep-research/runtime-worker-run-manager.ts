// Worker-local Deep Research coordinator.
//
// A fresh Runtime V2 worker owns one finite attempt and mirrors the bundled
// sidecar's bounded durable event log into Runtime checkpoints. The worker has
// only the service-specific loopback URL/secret injected by Rust: it cannot
// lease services, choose executables, or start a process.

import {
  DeepResearchClient,
  DeepResearchServiceError,
  type RunEvent,
  type RunSummary,
} from "./client.ts";

export interface DeepResearchWorkerEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

type RunStatus = "queued" | "running" | "completed" | "failed" | "aborted";

interface RunState {
  runId: string;
  userId: number;
  request: DeepResearchWorkerRequest;
  status: RunStatus;
  sequence: number;
  upstreamSequence: number;
  events: DeepResearchWorkerEvent[];
  aborted: boolean;
  polling: AbortController;
  abortPromise: Promise<void> | null;
  createdAt: number;
}

export interface DeepResearchWorkerRequest {
  query: string;
  breadth: number;
  depth: number;
  output: "report" | "answer";
  memoryContext: string;
  conversationContext: string;
}

export interface StartDeepResearchRuntimeWorkerInput extends DeepResearchWorkerRequest {
  userId: number;
  runtimeJobId: string;
}

const runs = new Map<string, RunState>();
const EVENT_TYPE = /^[a-z][a-z0-9_.-]{0,79}$/u;
const TERMINAL = new Set(["run.completed", "run.failed", "run.aborted"]);
const MAX_EVENTS = 5_000;
const MAX_EVENT_PAYLOAD_BYTES = 4 * 1024 * 1024;
const RETENTION_MS = 30 * 60 * 1_000;
const RUN_TIMEOUT_MS = 55 * 60 * 1_000;
const POLL_MS = 1_000;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function requireRun(userId: number, runId: string): RunState {
  const run = runs.get(runId);
  if (!run || run.userId !== userId) throw new Error("run_not_found");
  return run;
}

function isTerminalStatus(status: RunStatus): boolean {
  return status === "completed" || status === "failed" || status === "aborted";
}

function serviceClient(): DeepResearchClient {
  return new DeepResearchClient();
}

function sealedPayload(value: unknown): Record<string, unknown> {
  const payload = record(value);
  const encoded = JSON.stringify(payload);
  if (Buffer.byteLength(encoded, "utf8") > MAX_EVENT_PAYLOAD_BYTES) {
    throw new Error("Deep Research returned an event larger than this run accepts.");
  }
  return record(JSON.parse(encoded));
}

function appendEvent(
  run: RunState,
  type: string,
  payload: Record<string, unknown>,
  at = new Date().toISOString(),
): void {
  if (isTerminalStatus(run.status)) return;
  run.sequence += 1;
  run.events.push({ sequenceNumber: run.sequence, type, payload, at });
  if (run.events.length > MAX_EVENTS) {
    run.events.splice(0, run.events.length - MAX_EVENTS);
  }
  if (type === "run.completed") run.status = "completed";
  else if (type === "run.failed") run.status = "failed";
  else if (type === "run.aborted") run.status = "aborted";
  if (isTerminalStatus(run.status)) scheduleCleanup(run);
}

function appendUpstreamEvent(run: RunState, value: RunEvent): void {
  if (
    !Number.isSafeInteger(value.sequenceNumber) ||
    value.sequenceNumber <= run.upstreamSequence ||
    typeof value.type !== "string" ||
    !EVENT_TYPE.test(value.type) ||
    typeof value.at !== "string" ||
    !Number.isFinite(Date.parse(value.at))
  ) {
    throw new Error("Deep Research returned an invalid event stream.");
  }
  run.upstreamSequence = value.sequenceNumber;
  appendEvent(run, value.type, sealedPayload(value.payload), value.at);
}

function validateSummary(run: RunState, summary: RunSummary): RunSummary {
  if (
    summary.runId !== run.runId ||
    summary.ownerUserId !== run.userId ||
    !["running", "completed", "failed", "aborted"].includes(summary.status)
  ) {
    throw new Error("Deep Research returned a run outside this worker's authority.");
  }
  return summary;
}

async function pullEvents(run: RunState, client: DeepResearchClient): Promise<number> {
  const incoming = await client.eventsSince(run.runId, run.userId, run.upstreamSequence);
  if (!Array.isArray(incoming) || incoming.length > MAX_EVENTS) {
    throw new Error("Deep Research returned too many events.");
  }
  for (const event of incoming) appendUpstreamEvent(run, event);
  return incoming.length;
}

function terminalPayload(summary: RunSummary): Record<string, unknown> {
  return {
    learningCount: summary.learningCount,
    sourceCount: summary.sourceCount,
    evidenceCount: summary.evidenceCount ?? 0,
    warningCount: summary.warningCount ?? 0,
    ...(summary.coverage ? { coverage: summary.coverage } : {}),
    ...(summary.budget ? { budget: summary.budget } : {}),
    ...(summary.failure?.code ? { error: summary.failure.code } : {}),
    ...(summary.failure?.message ? { message: summary.failure.message.slice(0, 1_000) } : {}),
  };
}

function appendTerminalSummary(run: RunState, summary: RunSummary): void {
  if (isTerminalStatus(run.status) || summary.status === "running") return;
  if (summary.result && summary.status === "completed") {
    appendEvent(run, "run.result", {
      output: summary.output,
      result: summary.result.slice(0, 2_000_000),
    }, summary.completedAt ?? new Date().toISOString());
  }
  appendEvent(
    run,
    summary.status === "completed"
      ? "run.completed"
      : summary.status === "aborted"
        ? "run.aborted"
        : "run.failed",
    terminalPayload(summary),
    summary.completedAt ?? new Date().toISOString(),
  );
}

function publicFailure(error: unknown): { error: string; message: string } {
  const code = error instanceof DeepResearchServiceError ? error.code : "service_error";
  const message = code === "search_not_configured"
    ? "Deep Research does not have a search backend configured."
    : code === "model_not_configured"
      ? "Deep Research does not have a model configured."
      : code === "too_many_runs"
        ? "Deep Research is already running as many jobs as it can."
        : "The Deep Research service could not complete this run.";
  return { error: code.slice(0, 100), message };
}

async function waitForPoll(run: RunState): Promise<void> {
  if (run.polling.signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, POLL_MS);
    timer.unref?.();
    run.polling.signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

async function drive(run: RunState): Promise<void> {
  const client = serviceClient();
  run.status = "running";
  const summary = validateSummary(run, await client.createRun({
    runId: run.runId,
    ownerUserId: run.userId,
    query: run.request.query,
    breadth: run.request.breadth,
    depth: run.request.depth,
    output: run.request.output,
    userContext: [run.request.memoryContext, run.request.conversationContext]
      .filter((section) => section.trim())
      .join("\n\n"),
  }));
  await pullEvents(run, client);
  appendTerminalSummary(run, summary);

  while (!isTerminalStatus(run.status)) {
    if (run.aborted) {
      await run.abortPromise;
      return;
    }
    const received = await pullEvents(run, client);
    if (isTerminalStatus(run.status)) return;
    if (received === 0) {
      const current = validateSummary(run, await client.getRun(run.runId, run.userId));
      if (current.status !== "running") {
        await pullEvents(run, client);
        appendTerminalSummary(run, current);
        return;
      }
    }
    await waitForPoll(run);
  }
}

async function abortUpstream(run: RunState): Promise<void> {
  const client = serviceClient();
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const summary = validateSummary(run, await client.abort(run.runId, run.userId));
      await pullEvents(run, client).catch(() => 0);
      appendTerminalSummary(run, summary);
      if (run.status !== "aborted" && !TERMINAL.has(run.events.at(-1)?.type ?? "")) {
        appendEvent(run, "run.aborted", terminalPayload(summary));
      }
      return;
    } catch (error) {
      lastError = error;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 1_000);
        timer.unref?.();
      });
    }
  }
  // Do not publish a false cancellation acknowledgement. Rust will reap the
  // worker after its grace window; the service remains a Runtime-owned tree.
  throw lastError;
}

function scheduleCleanup(run: RunState): void {
  const timer = setTimeout(() => runs.delete(run.runId), RETENTION_MS);
  timer.unref?.();
}

export function startRuntimeWorkerRun(
  input: StartDeepResearchRuntimeWorkerInput,
): { runId: string; status: RunStatus } {
  if (!/^[A-Za-z0-9_-]{1,64}$/u.test(input.runtimeJobId)) {
    throw new Error("Deep Research Runtime identity is invalid.");
  }
  if (runs.has(input.runtimeJobId)) {
    throw new Error("Deep Research Runtime identity was reused.");
  }
  const run: RunState = {
    runId: input.runtimeJobId,
    userId: input.userId,
    request: {
      query: input.query,
      breadth: input.breadth,
      depth: input.depth,
      output: input.output,
      memoryContext: input.memoryContext,
      conversationContext: input.conversationContext,
    },
    status: "queued",
    sequence: 0,
    upstreamSequence: 0,
    events: [],
    aborted: false,
    polling: new AbortController(),
    abortPromise: null,
    createdAt: Date.now(),
  };
  runs.set(run.runId, run);

  const timeout = setTimeout(() => {
    if (isTerminalStatus(run.status)) return;
    run.aborted = true;
    run.polling.abort();
    run.abortPromise ??= abortUpstream(run);
    void run.abortPromise.catch(() => undefined);
  }, RUN_TIMEOUT_MS);
  timeout.unref?.();

  void drive(run)
    .catch((error: unknown) => {
      if (run.aborted || isTerminalStatus(run.status)) return;
      appendEvent(run, "run.failed", publicFailure(error));
    })
    .finally(() => clearTimeout(timeout));
  return { runId: run.runId, status: "queued" };
}

export function getRuntimeWorkerEventsSince(
  userId: number,
  runId: string,
  since = 0,
): DeepResearchWorkerEvent[] {
  return requireRun(userId, runId).events.filter((event) => event.sequenceNumber > since);
}

export function isRuntimeWorkerTerminal(userId: number, runId: string): boolean {
  return isTerminalStatus(requireRun(userId, runId).status);
}

export async function abortRuntimeWorkerRun(userId: number, runId: string): Promise<boolean> {
  const run = requireRun(userId, runId);
  if (isTerminalStatus(run.status) || run.aborted) return false;
  run.aborted = true;
  run.polling.abort();
  run.abortPromise = abortUpstream(run);
  await run.abortPromise;
  return true;
}
