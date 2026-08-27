// In-memory run manager for the Vibe Trading agent.
//
// Unlike the ChatMock-driven agents, Breadboard does not run a tool loop here.
// The cloned project owns a complete finance-research agent — its own loop, its
// own tools (market data, factors, backtests, hypotheses, shadow accounts), its
// own session store and its own event bus — and there would be no point
// reimplementing any of it. Breadboard starts that service (./service.ts),
// points it at ChatMock, opens one session per run, and translates its SSE
// stream into the same event shape every other agent's inline card reads.
//
// Runs are ephemeral; what they produce is not. Events live here and the SSE
// route replays them, but the sessions, run directories and artifacts stay in
// the clone's own state directory. Runtime V2 owns and starts the service as a
// job dependency; this worker only uses its injected authenticated endpoint.

import { randomUUID } from "node:crypto";
import { vibeTradingRunLabel } from "./identity.ts";
import type { VibeTradingService } from "./service.ts";
import type { VibeTradingSettings } from "./settings.ts";
import { promptWithContext } from "../conversations/agent-context.ts";
import { resolveManagedServiceEndpoint } from "../runtime-v2/managed-service-endpoint.ts";

export interface VibeTradingEvent {
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
  events: VibeTradingEvent[];
  aborted: boolean;
  /** The clone's session, once it exists — what a cancel is addressed to. */
  session: { url: string; apiKey: string; sessionId: string } | null;
  /** Closes the open SSE connection the moment the run reaches a terminal state. */
  streaming: AbortController;
  /** Streamed answer text, as the authority until the attempt reports its own. */
  answer: string;
  /** Pending answer text not yet flushed as an event. */
  pending: string;
  flushTimer: ReturnType<typeof setTimeout> | null;
  toolCalls: number;
  createdAt: number;
}

const globalRuns = globalThis as typeof globalThis & {
  __breadboardVibeTradingRuns?: Map<string, RunState>;
};
const runs = globalRuns.__breadboardVibeTradingRuns ?? new Map<string, RunState>();
globalRuns.__breadboardVibeTradingRuns = runs;

const MAX_EVENTS = 5_000;
const MAX_ANSWER_CHARS = 400_000;
const MAX_SERVICE_RESPONSE_BYTES = 2 * 1024 * 1024;
const RETENTION_MS = 30 * 60 * 1000;
// A backtest over a decade of bars, or a multi-symbol factor sweep, is genuinely
// long: the clone's own loop runs up to 50 iterations with real network fetches
// behind most of them.
const RUN_TIMEOUT_MS = 90 * 60 * 1000;
// `send_message` hands the loop to a background task and answers immediately, so
// this only has to cover the handoff — a longer budget would just delay the
// report when the service has wedged.
const DISPATCH_TIMEOUT_MS = 120_000;
const ANSWER_FLUSH_MS = 400;
const REQUEST_TIMEOUT_MS = 30_000;
// One reconnect per dropped stream, a handful of times, so a transient blip does
// not end an otherwise healthy run.
const MAX_STREAM_ATTEMPTS = 5;

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

// ---- answer streaming -------------------------------------------------------

/**
 * The clone streams its answer a token at a time. One event per token would
 * blow through the event cap on a long report and flood the SSE route, so
 * deltas are coalesced and flushed on a timer.
 */
function pushAnswer(run: RunState, delta: string): void {
  if (!delta) return;
  const remaining = Math.max(0, MAX_ANSWER_CHARS - run.answer.length);
  const accepted = remaining ? delta.slice(0, remaining) : "";
  if (!accepted) return;
  run.answer += accepted;
  run.pending += accepted;
  if (run.flushTimer) return;
  const timer = setTimeout(() => {
    run.flushTimer = null;
    flushAnswer(run);
  }, ANSWER_FLUSH_MS);
  timer.unref?.();
  run.flushTimer = timer;
}

function flushAnswer(run: RunState): void {
  if (run.flushTimer) {
    clearTimeout(run.flushTimer);
    run.flushTimer = null;
  }
  if (!run.pending) return;
  emit(run, "answer.delta", { text: run.pending });
  run.pending = "";
}

// ---- the clone's HTTP surface ----------------------------------------------

async function call(
  service: { url: string; apiKey: string },
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(new URL(path, service.url), {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${service.apiKey}`,
      ...(init.headers ?? {}),
    },
    signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

async function readBoundedJson(response: Response, maximumBytes: number): Promise<unknown> {
  const declared = response.headers.get("content-length");
  if (
    declared !== null &&
    (!/^\d+$/u.test(declared) || Number(declared) > maximumBytes)
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("Vibe Trading returned more data than this run accepts.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Vibe Trading returned no response body.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("Vibe Trading returned more data than this run accepts.");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(
      Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total).toString("utf8"),
    );
  } catch {
    throw new Error("Vibe Trading returned invalid JSON.");
  }
}

async function createSession(service: VibeTradingService, task: string): Promise<string> {
  const response = await call(service, "/sessions", {
    method: "POST",
    body: JSON.stringify({ title: vibeTradingRunLabel(task) }),
  });
  if (!response.ok) {
    throw new Error(`Vibe Trading refused to open a session (${response.status}).`);
  }
  const body = (await readBoundedJson(response, 64 * 1024)) as { session_id?: unknown };
  const sessionId = text(body.session_id);
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(sessionId)) {
    throw new Error("Vibe Trading opened a session without a valid id.");
  }
  return sessionId;
}

/**
 * The assistant's own record of the turn, read back when the attempt reported no
 * summary of its own. The clone formats this message itself, so it is the
 * closest thing to a canonical answer.
 */
async function lastAssistantMessage(
  service: { url: string; apiKey: string },
  sessionId: string,
): Promise<string> {
  try {
    const response = await call(service, `/sessions/${sessionId}/messages?limit=50`);
    if (!response.ok) return "";
    const body = await readBoundedJson(response, MAX_SERVICE_RESPONSE_BYTES);
    if (!Array.isArray(body)) return "";
    for (let index = body.length - 1; index >= 0; index -= 1) {
      const message = record(body[index]);
      if (message.role === "assistant" && text(message.content).trim()) {
        return text(message.content).slice(0, MAX_ANSWER_CHARS);
      }
    }
  } catch {
    // The service may already be gone; the streamed answer stands.
  }
  return "";
}

// ---- lifecycle --------------------------------------------------------------

export interface StartRunInput {
  userId: number;
  task: string;
  /** The chat's model, used unless the settings pin one. */
  model: string;
  reasoningEffort: string;
  /** ChatMock's OpenAI-compatible base URL, already resolved for this request. */
  baseUrl: string;
  settings: VibeTradingSettings;
  /** The chat this was launched from, so a request can refer back to it. */
  conversationContext?: string;
}

export interface RuntimeWorkerStartRunInput extends StartRunInput {
  /** Fenced Runtime identity. It is never selected by a renderer. */
  runtimeJobId: string;
  /** Captured by the trusted server before submission and shown by the card. */
  coldStart: boolean;
}

function preparedWorkerService(input: StartRunInput): VibeTradingService {
  const endpoint = resolveManagedServiceEndpoint("vibe-trading");
  if (!endpoint) {
    throw new Error("The Runtime-injected Vibe Trading service is unavailable.");
  }
  const model = input.settings.model.trim() || input.model.trim();
  if (!model) throw new Error("Vibe Trading has no model to run on.");
  return {
    url: endpoint.url,
    apiKey: endpoint.apiKey,
    model,
    startedAt: Date.now(),
  };
}

/** Legacy test seam. Product routes submit through runtime-run-manager.ts. */
export async function startRun(
  input: StartRunInput,
): Promise<{ runId: string; status: RunStatus }> {
  return startLocalRun(
    `vtrun_${randomUUID().replaceAll("-", "")}`,
    input,
    preparedWorkerService(input),
    false,
  );
}

/** Fixed disposable-worker entrypoint. Next.js must never call this export. */
export function startRuntimeWorkerRun(
  input: RuntimeWorkerStartRunInput,
): { runId: string; status: RunStatus } {
  if (
    !Number.isSafeInteger(input.userId) ||
    input.userId < 1 ||
    !/^[A-Za-z0-9_-]{1,128}$/u.test(input.runtimeJobId)
  ) {
    throw new Error("The Vibe Trading Runtime worker input is invalid.");
  }
  return startLocalRun(
    input.runtimeJobId,
    input,
    preparedWorkerService(input),
    input.coldStart,
  );
}

function startLocalRun(
  runId: string,
  input: StartRunInput,
  service: VibeTradingService,
  coldStart: boolean,
): { runId: string; status: RunStatus } {
  const run: RunState = {
    runId,
    userId: input.userId,
    task: input.task,
    status: "queued",
    sequence: 0,
    events: [],
    aborted: false,
    session: null,
    streaming: new AbortController(),
    answer: "",
    pending: "",
    flushTimer: null,
    toolCalls: 0,
    createdAt: Date.now(),
  };
  runs.set(runId, run);

  const timer = setTimeout(() => {
    if (["completed", "failed", "aborted"].includes(run.status)) return;
    run.aborted = true;
    void cancelUpstream(run).finally(() => {
      finish(run, "failed", { error: "The research ran past its time limit and was stopped." });
    });
  }, RUN_TIMEOUT_MS);
  timer.unref?.();

  void drive(run, input, service, coldStart)
    .catch((error: unknown) => {
      if (run.aborted) return;
      finish(run, "failed", {
        error: error instanceof Error ? error.message : "The Vibe Trading run failed.",
        detail: "",
      });
    })
    .finally(() => {
      clearTimeout(timer);
    });

  return { runId, status: "queued" };
}

async function drive(
  run: RunState,
  input: StartRunInput,
  service: VibeTradingService,
  coldStart: boolean,
): Promise<void> {
  run.status = "running";
  emit(run, "run.started", {
    task: run.task,
    label: vibeTradingRunLabel(run.task),
    model: input.settings.model || input.model,
  });

  emit(run, "service.starting", {});
  if (run.aborted) return;
  emit(run, "service.ready", {
    model: service.model,
    startedAt: service.startedAt,
    coldStart,
  });

  const sessionId = await createSession(service, run.task);
  if (run.aborted) return;
  run.session = { url: service.url, apiKey: service.apiKey, sessionId };
  emit(run, "session.opened", { sessionId });

  // The stream is opened before the message is sent: the event bus registers a
  // subscriber when the stream begins, and anything published before that is
  // only recoverable through a replay this run has no id for yet.
  const streaming = streamEvents(run, sessionId);

  const response = await call(service, `/sessions/${sessionId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      content: promptWithContext(run.task, input.conversationContext),
    }),
    signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    // `finish` closes the stream this run opened above, so the failure path does
    // not leave a connection reading an idle session.
    throw new Error(
      response.status === 409
        ? "That Vibe Trading session is already running a turn."
        : `Vibe Trading refused the request (${response.status}).`,
    );
  }

  await streaming;

  // The stream ended without a terminal attempt event — the process died, or the
  // connection could not be re-established. Whatever landed is still worth
  // keeping, so read the session back before deciding this failed.
  if (!["completed", "failed", "aborted"].includes(run.status)) {
    const stored = await lastAssistantMessage(run.session, sessionId);
    const answer = stored.trim() || run.answer.trim();
    if (answer) {
      finish(run, "completed", { summary: answer, toolCalls: run.toolCalls });
    } else {
      finish(run, "failed", {
        error: "The Vibe Trading event stream ended before an answer arrived.",
        detail: "",
      });
    }
  }
}

/**
 * Read the clone's SSE stream until the attempt reaches a terminal state.
 * Reconnects with `Last-Event-ID` when the connection drops mid-run, because a
 * long backtest can outlive a single HTTP connection.
 */
async function streamEvents(run: RunState, sessionId: string): Promise<void> {
  let lastEventId = "";
  for (let attempt = 0; attempt < MAX_STREAM_ATTEMPTS; attempt += 1) {
    if (run.aborted || ["completed", "failed", "aborted"].includes(run.status)) return;
    const service = run.session;
    if (!service) return;
    try {
      const response = await fetch(
        new URL(`/sessions/${sessionId}/events?replay=active`, service.url),
        {
          headers: {
            accept: "text/event-stream",
            authorization: `Bearer ${service.apiKey}`,
            ...(lastEventId ? { "Last-Event-ID": lastEventId } : {}),
          },
          // The stream stays open for the whole run — the clone sends a
          // heartbeat every 30s — so the only things that close it are the run
          // reaching a terminal state and the overall run timeout.
          signal: AbortSignal.any([
            run.streaming.signal,
            AbortSignal.timeout(RUN_TIMEOUT_MS),
          ]),
        },
      );
      if (!response.ok || !response.body) {
        throw new Error(`the event stream returned ${response.status}`);
      }
      lastEventId = await consume(run, response.body, lastEventId);
      if (["completed", "failed", "aborted"].includes(run.status)) return;
    } catch {
      if (run.aborted || ["completed", "failed", "aborted"].includes(run.status)) return;
      // Fall through to the next attempt; a run whose reconnects are all spent
      // is resolved by the caller from the session's stored messages.
    }
  }
}

/** Parse one SSE connection's frames until it closes or the run finishes. */
async function consume(
  run: RunState,
  body: ReadableStream<Uint8Array>,
  startId: string,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lastEventId = startId;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const parsed = parseFrame(frame);
        if (parsed) {
          if (parsed.id) lastEventId = parsed.id;
          handleEvent(run, parsed.event, parsed.data);
        }
        if (["completed", "failed", "aborted"].includes(run.status)) {
          return lastEventId;
        }
        boundary = buffer.indexOf("\n\n");
      }
      // A frame this long is not one the clone emits; holding it only grows
      // memory on a stream that has stopped being SSE.
      if (buffer.length > 4_000_000) buffer = "";
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // The stream is already gone.
    }
  }
  return lastEventId;
}

/**
 * One SSE frame from the clone. Exported because the wire format is the seam
 * between two projects: a change on either side has to fail a test here rather
 * than silently produce a run card that never fills in.
 */
export function parseFrame(
  frame: string,
): { id: string; event: string; data: Record<string, unknown> } | null {
  let id = "";
  let event = "message";
  const dataLines: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("id:")) id = line.slice(3).trim();
    else if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
  }
  if (!dataLines.length) return null;
  try {
    return { id, event, data: record(JSON.parse(dataLines.join("\n"))) };
  } catch {
    return null;
  }
}

/** Translate one of the clone's events into this run's own event stream. */
function handleEvent(run: RunState, type: string, data: Record<string, unknown>): void {
  if (type === "heartbeat") return;

  if (type === "attempt.started") {
    emit(run, "agent.thinking", { summary: "Reading the request and planning the work" });
    return;
  }

  if (type === "reasoning_delta") {
    // The clone sends this as an incremental summary; only the newest line is
    // worth showing, and it is a status line rather than part of the answer.
    const summary = (text(data.delta) || text(data.text) || text(data.summary))
      .split(/\r?\n/)
      .filter(Boolean)
      .at(-1);
    if (summary) emit(run, "agent.thinking", { summary: summary.slice(0, 200) });
    return;
  }

  if (type === "text_delta") {
    pushAnswer(run, text(data.delta));
    return;
  }

  if (type === "tool_call") {
    run.toolCalls += 1;
    const tool = text(data.tool, "tool");
    emit(run, "step.started", {
      kind: "tool",
      callId: text(data.call_id),
      display: tool,
      detail: describeArguments(data.arguments),
      blocked: data.blocked === true,
    });
    return;
  }

  if (type === "tool_result") {
    emit(run, "step.completed", {
      kind: "tool",
      callId: text(data.call_id),
      display: text(data.tool, "tool"),
      status: text(data.status, "ok"),
      elapsedMs: count(data.elapsed_ms),
      detail: text(data.preview).split(/\r?\n/).filter(Boolean).slice(0, 2).join(" ").slice(0, 200),
    });
    return;
  }

  if (type === "tool_progress" || type === "tool_heartbeat") {
    const tool = text(data.tool);
    const message = text(data.message) || text(data.stage);
    const total = count(data.total);
    emit(run, "step.progress", {
      display: tool,
      detail: total
        ? `${message || "working"} · ${count(data.current)}/${total}`
        : message || `${Math.round(count(data.elapsed_s))}s`,
    });
    return;
  }

  if (type === "compact") {
    emit(run, "agent.thinking", { summary: "Compacting the working context" });
    return;
  }

  if (type === "mcp.warning") {
    emit(run, "agent.warning", { message: text(data.message).slice(0, 300) });
    return;
  }

  if (type === "attempt.completed") {
    flushAnswer(run);
    const summary = (text(data.summary).trim() || run.answer.trim()).slice(
      0,
      MAX_ANSWER_CHARS,
    );
    finish(run, "completed", {
      summary: summary || "Vibe Trading finished without an answer.",
      model: text(data.model).slice(0, 256),
      provider: text(data.provider).slice(0, 128),
      runDir: text(data.run_dir).slice(0, 1_024),
      toolCalls: run.toolCalls,
      upstreamElapsedMs: count(data.elapsed_ms),
    });
    return;
  }

  if (type === "attempt.cancelled") {
    flushAnswer(run);
    finish(run, "aborted", {
      summary: run.answer.trim() || "Vibe Trading stopped before it answered.",
      toolCalls: run.toolCalls,
    });
    return;
  }

  if (type === "attempt.failed") {
    flushAnswer(run);
    finish(run, "failed", {
      error: text(data.error, "The research failed.").slice(0, 2_000),
      summary: run.answer.trim(),
      toolCalls: run.toolCalls,
    });
  }
}

/** A one-line rendering of a tool call's arguments for the run card. */
export function describeArguments(value: unknown): string {
  const args = record(value);
  const parts = Object.entries(args)
    .filter(([, item]) => item !== null && item !== undefined && item !== "")
    .slice(0, 4)
    .map(([key, item]) => `${key}=${String(item).slice(0, 60)}`);
  return parts.join(" ").slice(0, 200);
}

function finish(run: RunState, status: RunStatus, payload: Record<string, unknown>): void {
  if (["completed", "failed", "aborted"].includes(run.status)) return;
  flushAnswer(run);
  run.status = status;
  // Nothing more will be read from the clone, so drop the open connection rather
  // than leave it reading an idle session until the run timeout.
  try {
    run.streaming.abort();
  } catch {
    // Already closed.
  }
  emit(run, status === "completed" ? "run.completed" : status === "aborted" ? "run.aborted" : "run.failed", {
    ...payload,
    elapsedSec: (Date.now() - run.createdAt) / 1_000,
  });
  scheduleCleanup(run);
}

function scheduleCleanup(run: RunState): void {
  const timer = setTimeout(() => runs.delete(run.runId), RETENTION_MS);
  timer.unref?.();
}

/** Ask the clone to stop the in-flight loop for this run's session. */
async function cancelUpstream(run: RunState): Promise<void> {
  const service = run.session;
  if (!service) return;
  try {
    await call(service, `/sessions/${service.sessionId}/cancel`, { method: "POST" });
  } catch {
    // The service may already be gone; the run is ending either way.
  }
}

// ---- read/control API -------------------------------------------------------

export function getEventsSince(userId: number, runId: string, since = 0): VibeTradingEvent[] {
  return requireRun(userId, runId).events.filter((event) => event.sequenceNumber > since);
}

export function isTerminal(userId: number, runId: string): boolean {
  return ["completed", "failed", "aborted"].includes(requireRun(userId, runId).status);
}

export async function abortRun(userId: number, runId: string): Promise<boolean> {
  const run = requireRun(userId, runId);
  if (["completed", "failed", "aborted"].includes(run.status)) return false;
  run.aborted = true;
  await cancelUpstream(run);
  finish(run, "aborted", {
    // Whatever landed before the stop is still worth keeping.
    summary: run.answer.trim() || "Vibe Trading stopped before it answered.",
    toolCalls: run.toolCalls,
  });
  return true;
}

/** Protocol controls consumed only by the fixed Runtime V2 adapter. */
export const getRuntimeWorkerEventsSince = getEventsSince;
export const isRuntimeWorkerTerminal = isTerminal;
export const abortRuntimeWorkerRun = abortRun;

/** Test seam: a disposable production worker has one run and exits. */
export function resetVibeTradingRuns(): void {
  for (const run of runs.values()) {
    if (run.flushTimer) clearTimeout(run.flushTimer);
    run.streaming.abort();
  }
  runs.clear();
}
