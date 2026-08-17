// In-memory run manager for the Stock Analyst agent.
//
// Unlike the ChatMock-driven agents, Breadboard does not run a tool loop here.
// The cloned project owns a complete equity-analysis agent — its own loop, its
// own sixteen tools (quotes, K-lines, chip distribution, indices, sector
// rankings, news, backtest summaries), its own fifteen strategy skills, its own
// multi-stage orchestrator and its own session store — and there would be no
// point reimplementing any of it. Breadboard starts that backend (./service.ts),
// points it at ChatMock, asks one question, and translates the progress stream
// into the same event shape every other agent's inline card reads.
//
// The clone's stream is one POST whose response body is the SSE: there is no
// separate stream to reconnect to, because reconnecting would mean asking the
// question again. A dropped connection therefore ends the run, and whatever the
// session already stored is read back before deciding it failed.

import { randomUUID } from "node:crypto";
import { chatmockApiKeyValue } from "../agent-browser/provider.ts";
import { ensureService, serviceLog, type StockAnalystService } from "./service.ts";
import { invalidateHealth } from "./runtime.ts";
import type { StockAnalystSettings } from "./settings.ts";
import { stockAnalystRunLabel } from "./identity.ts";
import { promptWithContext } from "../conversations/agent-context.ts";

export interface StockAnalystEvent {
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
  events: StockAnalystEvent[];
  aborted: boolean;
  /** The clone's session and request, once they exist — what a cancel addresses. */
  session: { url: string; sessionId: string; requestId: string } | null;
  /** Closes the open request the moment the run reaches a terminal state. */
  streaming: AbortController;
  toolCalls: number;
  createdAt: number;
}

const globalRuns = globalThis as typeof globalThis & {
  __breadboardStockAnalystRuns?: Map<string, RunState>;
};
const runs = globalRuns.__breadboardStockAnalystRuns ?? new Map<string, RunState>();
globalRuns.__breadboardStockAnalystRuns = runs;

const MAX_EVENTS = 2_000;
const RETENTION_MS = 30 * 60 * 1000;
// The full-report depth runs six staged agents, each with its own model calls
// and network fetches behind them, and the clone's own per-stage budget is
// generous. This is the outer bound, not the expectation.
const RUN_TIMEOUT_MS = 45 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30_000;

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

// ---- the clone's HTTP surface ----------------------------------------------

async function call(
  service: { url: string },
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(new URL(path, service.url), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

/**
 * The assistant's own record of the turn, read back when the stream ended
 * without a terminal event. The clone persists every chat turn, so this is the
 * closest thing to a canonical answer once the connection is gone.
 */
async function lastAssistantMessage(
  service: { url: string },
  sessionId: string,
): Promise<string> {
  try {
    const response = await call(service, `/api/v1/agent/chat/sessions/${sessionId}?limit=50`);
    if (!response.ok) return "";
    const body = record(await response.json());
    const messages = Array.isArray(body.messages) ? body.messages : [];
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = record(messages[index]);
      if (message.role === "assistant" && text(message.content).trim()) {
        return text(message.content);
      }
    }
  } catch {
    // The service may already be gone; the failure report stands.
  }
  return "";
}

// ---- lifecycle --------------------------------------------------------------

export interface StartRunInput {
  userId: number;
  task: string;
  /** The chat's model, used unless the settings pin one. */
  model: string;
  /** ChatMock's OpenAI-compatible base URL, already resolved for this request. */
  baseUrl: string;
  settings: StockAnalystSettings;
  /**
   * Durable memory about the user, already selected and rendered by
   * `conversations/agent-memory-context.ts`. Empty when nothing qualified.
   * This backend takes a single string, so the block is prefixed to the
   * question at the HTTP boundary and kept out of `run.task` — the card, the
   * label and the saved message all show what the user actually asked.
   */
  memoryContext: string;
  /** The chat this was launched from, so a question can refer back to it. */
  conversationContext?: string;
}

export function startRun(input: StartRunInput): { runId: string; status: RunStatus } {
  const runId = `sarun_${randomUUID().replaceAll("-", "")}`;
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
    toolCalls: 0,
    createdAt: Date.now(),
  };
  runs.set(runId, run);

  const timer = setTimeout(() => {
    if (["completed", "failed", "aborted"].includes(run.status)) return;
    run.aborted = true;
    void cancelUpstream(run);
    finish(run, "failed", { error: "The analysis ran past its time limit and was stopped." });
  }, RUN_TIMEOUT_MS);
  timer.unref?.();

  void drive(run, input)
    .catch((error: unknown) => {
      if (run.aborted) return;
      finish(run, "failed", {
        error: error instanceof Error ? error.message : "The Stock Analyst run failed.",
        detail: serviceLog(),
      });
    })
    .finally(() => clearTimeout(timer));

  return { runId, status: "queued" };
}

async function drive(run: RunState, input: StartRunInput): Promise<void> {
  run.status = "running";
  emit(run, "run.started", {
    task: run.task,
    label: stockAnalystRunLabel(run.task),
    model: input.settings.model || input.model,
    depth: input.settings.depth,
  });

  emit(run, "service.starting", {});
  const service = await ensureService({
    baseUrl: input.baseUrl,
    apiKey: chatmockApiKeyValue(),
    model: input.model,
    settings: input.settings,
  });
  if (run.aborted) return;
  emit(run, "service.ready", {
    model: service.model,
    // A service that was already up is the normal case after the first run, and
    // it is the single most useful thing to know when a run feels slow.
    startedAt: service.startedAt,
    coldStart: Date.now() - service.startedAt < 10_000,
  });

  const sessionId = randomUUID();
  const requestId = randomUUID();
  run.session = { url: service.url, sessionId, requestId };

  const response = await streamRequest(
    run,
    service,
    sessionId,
    requestId,
    input.memoryContext,
    input.conversationContext ?? "",
  );
  await consume(run, response);

  // The stream ended without a terminal event — the backend died, or the
  // connection dropped. Whatever the turn stored is still worth keeping, so read
  // the session back before deciding this failed.
  if (!["completed", "failed", "aborted"].includes(run.status)) {
    const stored = await lastAssistantMessage(service, sessionId);
    if (stored.trim()) {
      finish(run, "completed", { summary: stored, toolCalls: run.toolCalls });
    } else {
      finish(run, "failed", {
        error: "The Stock Analyst progress stream ended before an answer arrived.",
        detail: serviceLog(),
      });
    }
  }
}

async function streamRequest(
  run: RunState,
  service: StockAnalystService,
  sessionId: string,
  requestId: string,
  memoryContext: string,
  conversationContext: string,
): Promise<Response> {
  const response = await fetch(new URL("/api/v1/agent/chat/stream", service.url), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify({
      message: promptWithContext(
        memoryContext ? `${memoryContext}\n\n${run.task}` : run.task,
        conversationContext,
      ),
      session_id: sessionId,
      request_id: requestId,
    }),
    // The whole turn is this one response, so it stays open for the run.
    signal: AbortSignal.any([run.streaming.signal, AbortSignal.timeout(RUN_TIMEOUT_MS)]),
  });
  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Stock Analyst refused the question (${response.status}). ${detail.slice(0, 300)}`.trim(),
    );
  }
  return response;
}

/** Parse the clone's SSE frames until the stream closes or the run finishes. */
async function consume(run: RunState, response: Response): Promise<void> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = parseFrame(frame);
        if (data) handleEvent(run, text(data.type), data);
        if (["completed", "failed", "aborted"].includes(run.status)) return;
        boundary = buffer.indexOf("\n\n");
      }
      // A frame this long is not one the clone emits; holding it only grows
      // memory on a stream that has stopped being SSE.
      if (buffer.length > 8_000_000) buffer = "";
    }
  } catch {
    // A dropped connection is resolved by the caller from the stored session.
  } finally {
    try {
      await reader.cancel();
    } catch {
      // The stream is already gone.
    }
  }
}

/**
 * One SSE frame from the clone. Exported because the wire format is the seam
 * between two projects: a change on either side has to fail a test here rather
 * than silently produce a run card that never fills in.
 *
 * The clone sends data-only frames — the event name lives in the JSON's `type`
 * field, not in an `event:` line — which is what its own docs describe.
 */
export function parseFrame(frame: string): Record<string, unknown> | null {
  const dataLines: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
  }
  if (!dataLines.length) return null;
  try {
    return record(JSON.parse(dataLines.join("\n")));
  } catch {
    return null;
  }
}

/**
 * A stage of the clone's multi-agent pipeline, named for a reader.
 *
 * The stream carries the orchestrator's own agent names — the six in
 * `src/agent/agents/` plus one `skill_<id>` per strategy specialist in the
 * panel depth. They are terse internal ids, and the pipeline is the thing a
 * viewer is actually watching.
 */
const STAGE_LABELS: Record<string, string> = {
  agent_loop: "Analysis",
  technical: "Technical analysis",
  intel: "News and sentiment",
  risk: "Risk review",
  decision: "Decision",
  portfolio: "Position review",
};

export function stageLabel(stage: string): string {
  const known = STAGE_LABELS[stage];
  if (known) return known;
  // A strategy specialist, e.g. `skill_chan_theory` in the panel depth.
  const skill = /^(?:skill|strategy)_(.+)$/.exec(stage);
  if (skill) return `${skill[1].replaceAll("_", " ")} strategy`;
  return stage.replaceAll("_", " ");
}

/**
 * The clone's fixed progress lines, which are Chinese regardless of
 * `REPORT_LANGUAGE` — that setting governs the report it writes, not the status
 * strings hard-coded in its agent loop. Only these four are fixed; anything
 * else (a "「tool」finished" line, for instance) is passed through as written.
 */
const STATUS_TRANSLATIONS: Array<[RegExp, string]> = [
  [/^正在制定分析路径/, "Planning the analysis"],
  [/^正在生成最终分析/, "Writing the analysis"],
  [/^正在准备分析/, "Preparing the analysis"],
  [/^正在整理分析结果/, "Organising the results"],
];

export function statusLine(message: string): string {
  const trimmed = message.trim();
  for (const [pattern, english] of STATUS_TRANSLATIONS) {
    if (pattern.test(trimmed)) return english;
  }
  return trimmed;
}

/** Translate one of the clone's progress events into this run's event stream. */
function handleEvent(run: RunState, type: string, data: Record<string, unknown>): void {
  if (type === "accepted") {
    emit(run, "agent.thinking", { summary: "Reading the question and choosing tools" });
    return;
  }

  if (type === "thinking" || type === "generating") {
    const summary = statusLine(text(data.message));
    if (summary) emit(run, "agent.thinking", { summary: summary.slice(0, 200) });
    return;
  }

  if (type === "stage_start") {
    const stage = text(data.stage);
    emit(run, "step.started", {
      kind: "stage",
      callId: `stage:${stage}`,
      display: stageLabel(stage),
      detail: "",
    });
    return;
  }

  if (type === "stage_done") {
    const stage = text(data.stage);
    emit(run, "step.completed", {
      kind: "stage",
      callId: `stage:${stage}`,
      display: stageLabel(stage),
      status: text(data.status, "completed") === "completed" ? "ok" : text(data.status),
      elapsedMs: Math.round(count(data.duration) * 1_000),
      detail: "",
    });
    return;
  }

  if (type === "tool_start") {
    run.toolCalls += 1;
    const tool = text(data.tool, "tool");
    emit(run, "step.started", {
      kind: "tool",
      callId: `tool:${count(data.step)}:${tool}`,
      display: tool,
      detail: "",
    });
    return;
  }

  if (type === "tool_done") {
    const tool = text(data.tool, "tool");
    emit(run, "step.completed", {
      kind: "tool",
      callId: `tool:${count(data.step)}:${tool}`,
      display: tool,
      status: data.success === false ? "failed" : "ok",
      elapsedMs: Math.round(count(data.duration) * 1_000),
      detail: "",
    });
    return;
  }

  if (type === "pipeline_timeout" || type === "pipeline_budget_skipped") {
    // The clone degrades rather than fails here: the stages that did run still
    // produce an answer, so this is a warning on a run that continues.
    emit(run, "agent.warning", {
      message:
        type === "pipeline_timeout"
          ? `The ${stageLabel(text(data.stage))} stage ran out of time; the answer is based on the stages that finished.`
          : `The ${stageLabel(text(data.stage))} stage was skipped to stay inside the time budget.`,
    });
    return;
  }

  if (type === "done") {
    const summary = text(data.content).trim();
    if (data.success === false) {
      finish(run, "failed", {
        error: text(data.error, "The analysis failed.").slice(0, 2_000),
        summary,
        toolCalls: run.toolCalls,
      });
      return;
    }
    finish(run, "completed", {
      summary: summary || "Stock Analyst finished without an answer.",
      totalSteps: count(data.total_steps),
      toolCalls: run.toolCalls,
    });
    return;
  }

  if (type === "error") {
    finish(run, "failed", {
      error: text(data.message, "The analysis failed.").slice(0, 2_000),
      code: text(data.error_code),
      toolCalls: run.toolCalls,
    });
  }
}

function finish(run: RunState, status: RunStatus, payload: Record<string, unknown>): void {
  if (["completed", "failed", "aborted"].includes(run.status)) return;
  run.status = status;
  // Nothing more will be read from the clone, so drop the open request rather
  // than leave it reading a finished turn.
  try {
    run.streaming.abort();
  } catch {
    // Already closed.
  }
  emit(
    run,
    status === "completed" ? "run.completed" : status === "aborted" ? "run.aborted" : "run.failed",
    { ...payload, elapsedSec: (Date.now() - run.createdAt) / 1_000 },
  );
  // A finished run may have started or lost the service; the settings dialog
  // reads that from health.
  invalidateHealth();
  scheduleCleanup(run);
}

function scheduleCleanup(run: RunState): void {
  const timer = setTimeout(() => runs.delete(run.runId), RETENTION_MS);
  timer.unref?.();
}

/**
 * Ask the clone to stop the in-flight turn.
 *
 * Its cancel endpoint only knows about requests running on the experimental
 * local-Codex backend, so on the litellm backend Breadboard runs it answers 404
 * and the executor thread finishes its current step in the background. Stopping
 * therefore ends the run *here* — the card stops, the turn is recorded as
 * aborted — and the backend quietly completes whatever call it was on. That is
 * one wasted model call at worst, and it is honest about what the clone can do.
 */
async function cancelUpstream(run: RunState): Promise<void> {
  const session = run.session;
  if (!session) return;
  try {
    await call(session, `/api/v1/agent/chat/stream/${session.requestId}/cancel`, {
      method: "POST",
    });
  } catch {
    // The service may already be gone; the run is ending either way.
  }
}

// ---- read/control API -------------------------------------------------------

export function getEventsSince(userId: number, runId: string, since = 0): StockAnalystEvent[] {
  return requireRun(userId, runId).events.filter((event) => event.sequenceNumber > since);
}

export function isTerminal(userId: number, runId: string): boolean {
  return ["completed", "failed", "aborted"].includes(requireRun(userId, runId).status);
}

export function abortRun(userId: number, runId: string): boolean {
  const run = requireRun(userId, runId);
  if (["completed", "failed", "aborted"].includes(run.status)) return false;
  run.aborted = true;
  void cancelUpstream(run);
  finish(run, "aborted", {
    summary: "Stock Analyst stopped before it answered.",
    toolCalls: run.toolCalls,
  });
  return true;
}
