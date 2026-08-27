// Worker-local run manager for the DeerFlow agent.
//
// Unlike the ChatMock-driven agents, Breadboard does not run a tool loop here.
// The cloned harness owns a complete super agent — its own LangGraph lead agent,
// its own sandbox, subagent delegation, skills, memory and checkpointer — and
// there would be no point reimplementing any of it. Breadboard starts that
// Gateway (./service.ts), points its model profiles at ChatMock, opens one
// thread per run, and translates the Gateway's SSE stream into the same event
// shape every other agent's inline card reads.
//
// Runs are ephemeral inside one fresh Runtime V2 worker; what they produce is
// not. The worker translates the endpoint stream into a sealed durable
// projection, while Rust owns this worker and the DeerFlow Gateway dependency.
// This module is never imported by a Next route and receives neither provider
// secrets nor supervisor authority.
//
// One translation rule is load-bearing. Only assistant and tool messages are
// read off the `messages-tuple` stream. DeerFlow injects recalled memory and
// durable context as *hidden human messages*, and LangGraph fans those state
// writes out on the same stream — a denylist ("anything that is not a tool")
// publishes the agent's private context as if it were the answer. The clone
// documents that failure in its own IM channel layer; this is the same
// allowlist.

import { randomUUID } from "node:crypto";
import {
  closeDeerFlowArtifactContext,
  openDeerFlowArtifactContext,
  saveDeerFlowArtifact,
  type DeerFlowArtifactContext,
} from "./artifact.ts";
import { deerFlowRunLabel } from "./identity.ts";
import {
  preparedService,
  serviceLog,
  type DeerFlowWorkerService,
} from "./runtime-worker-service.ts";
import { runContext, type DeerFlowSettings } from "./settings.ts";
import { promptWithContext } from "../conversations/agent-context.ts";

export interface DeerFlowEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

export interface DeerFlowArtifact {
  /** Stable within the run; what the download route addresses. */
  id: string;
  /** The virtual path DeerFlow reports, e.g. `/mnt/user-data/outputs/plan.md`. */
  path: string;
  name: string;
  /** The Breadboard artifact it was kept as, when the chat could take it. */
  artifactId: string | null;
}

type RunStatus = "queued" | "running" | "completed" | "failed" | "aborted";

interface RunState {
  runId: string;
  userId: number;
  task: string;
  status: RunStatus;
  sequence: number;
  events: DeerFlowEvent[];
  aborted: boolean;
  /** The Gateway and thread this run lives in, once they exist. */
  thread: { url: string; threadId: string } | null;
  /** `/api/threads/{thread}/runs/{run}` — what a cancel is addressed to. */
  upstreamRunPath: string | null;
  /** Closes the open SSE connection the moment the run reaches a terminal state. */
  streaming: AbortController;
  /** Streamed answer text, used until the final checkpoint reports its own. */
  answer: string;
  /** Pending answer text not yet flushed as an event. */
  pending: string;
  flushTimer: ReturnType<typeof setTimeout> | null;
  /** How much of each streamed message id has already been taken. */
  seenMessages: Map<string, boolean>;
  /** Tool calls seen, by call id, so a result can be matched to its call. */
  toolCalls: Map<string, string>;
  toolCallCount: number;
  artifacts: DeerFlowArtifact[];
  /** The chat this run belongs to, so its files land under that turn. */
  artifactContext: DeerFlowArtifactContext | null;
  /** Files the run produced that the artifact store would not keep. */
  artifactProblems: string[];
  /**
   * The provider failure DeerFlow turned into a polite assistant message. It is
   * a failed run wearing an answer's clothes; see `handleMessage`.
   */
  fallbackError: string;
  createdAt: number;
}

const globalRuns = globalThis as typeof globalThis & {
  __breadboardDeerFlowRuns?: Map<string, RunState>;
};
const runs = globalRuns.__breadboardDeerFlowRuns ?? new Map<string, RunState>();
globalRuns.__breadboardDeerFlowRuns = runs;

const MAX_EVENTS = 5_000;
const MAX_ANSWER_CHARS = 400_000;
const RETENTION_MS = 30 * 60 * 1000;
// A DeerFlow turn is a full agent loop with sandbox work and possibly several
// delegated subagents behind it, each of which the harness gives 30 minutes.
const RUN_TIMEOUT_MS = 90 * 60 * 1000;
const ANSWER_FLUSH_MS = 400;
const REQUEST_TIMEOUT_MS = 30_000;
const ARTIFACT_READ_TIMEOUT_MS = 60_000;
const ARTIFACT_MAX_BYTES = 25 * 1024 * 1024;
// One rejoin per dropped stream, a handful of times, so a transient blip does
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

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const TERMINAL: readonly RunStatus[] = ["completed", "failed", "aborted"];

function isTerminalStatus(status: RunStatus): boolean {
  return TERMINAL.includes(status);
}

// ---- message reading --------------------------------------------------------

/**
 * The text of a LangChain message content field, which is either a plain string
 * or a list of typed blocks. Only text blocks are read: an image block carries a
 * base64 payload, not something to show in a chat.
 */
export function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      const entry = record(block);
      if (entry.type === "text") return text(entry.text);
      return "";
    })
    .join("");
}

/** A one-line rendering of a tool call's arguments for the run card. */
export function describeArguments(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 200);
  const args = record(value);
  return Object.entries(args)
    .filter(([, item]) => item !== null && item !== undefined && item !== "")
    .slice(0, 4)
    .map(([key, item]) => `${key}=${String(item).replace(/\s+/g, " ").slice(0, 60)}`)
    .join(" ")
    .slice(0, 200);
}

// ---- answer streaming -------------------------------------------------------

/**
 * DeerFlow streams its answer a token at a time. One event per token would blow
 * through the event cap on a long report and flood the SSE route, so deltas are
 * coalesced and flushed on a timer.
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

// ---- the Gateway's HTTP surface --------------------------------------------

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
 * The thread's final state: the answer DeerFlow itself checkpointed, and the
 * files it presented. Read once when the stream ends, because a checkpoint is
 * the canonical record of a turn and streamed deltas are only a live view of it.
 */
async function finalState(
  service: { url: string },
  threadId: string,
): Promise<{ answer: string; artifacts: string[] }> {
  try {
    const response = await call(service, `/api/threads/${encodeURIComponent(threadId)}/state`);
    if (!response.ok) return { answer: "", artifacts: [] };
    const body = record(await response.json());
    const values = record(body.values);
    const messages = Array.isArray(values.messages) ? values.messages : [];
    let answer = "";
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = record(messages[index]);
      if (message.type !== "ai") continue;
      // A tool-call turn has no prose of its own; the answer is the last message
      // that actually said something.
      const content = messageText(message.content).trim();
      if (content) {
        answer = content;
        break;
      }
    }
    const artifacts = Array.isArray(values.artifacts)
      ? values.artifacts.filter((entry): entry is string => typeof entry === "string")
      : [];
    return { answer, artifacts };
  } catch {
    // The Gateway may already be gone; the streamed answer stands.
    return { answer: "", artifacts: [] };
  }
}

// ---- lifecycle --------------------------------------------------------------

export interface StartRunInput {
  userId: number;
  /** The fenced Runtime job identity; also the only public run identity. */
  runtimeJobId: string;
  /** Observed by the trusted facade before Runtime admitted the dependency. */
  runtimeColdStart: boolean;
  task: string;
  model: string;
  reasoningEffort: string;
  settings: DeerFlowSettings;
  /** The chat the run was launched from, captured now rather than looked up later. */
  conversationPublicId: string;
  /** The chat this was launched from, so a request can refer back to it. */
  conversationContext?: string;
}

export function startRuntimeWorkerRun(
  input: StartRunInput,
): { runId: string; status: RunStatus } {
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(input.runtimeJobId)) {
    throw new Error("DeerFlow Runtime identity is invalid.");
  }
  const runId = input.runtimeJobId;
  if (runs.has(runId)) throw new Error("DeerFlow Runtime identity was reused.");
  const service = preparedService();
  const run: RunState = {
    runId,
    userId: input.userId,
    task: input.task,
    status: "queued",
    sequence: 0,
    events: [],
    aborted: false,
    thread: null,
    upstreamRunPath: null,
    streaming: new AbortController(),
    answer: "",
    pending: "",
    flushTimer: null,
    seenMessages: new Map(),
    toolCalls: new Map(),
    toolCallCount: 0,
    artifacts: [],
    artifactContext: input.conversationPublicId
      ? openDeerFlowArtifactContext({
          userId: input.userId,
          conversationPublicId: input.conversationPublicId,
          task: input.task,
          agentRunId: runId,
        })
      : null,
    artifactProblems: [],
    fallbackError: "",
    createdAt: Date.now(),
  };
  runs.set(runId, run);

  const timer = setTimeout(() => {
    if (isTerminalStatus(run.status)) return;
    run.aborted = true;
    void cancelUpstream(run).finally(() => {
      finish(run, "failed", { error: "The DeerFlow run ran past its time limit and was stopped." });
    });
  }, RUN_TIMEOUT_MS);
  timer.unref?.();

  void drive(run, input, service)
    .catch((error: unknown) => {
      if (run.aborted) return;
      finish(run, "failed", {
        error: error instanceof Error ? error.message : "The DeerFlow run failed.",
        detail: serviceLog(),
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
  service: DeerFlowWorkerService,
): Promise<void> {
  run.status = "running";
  emit(run, "run.started", {
    task: run.task,
    label: deerFlowRunLabel(run.task),
    model: input.model,
  });

  emit(run, "service.starting", {});
  if (run.aborted) return;
  emit(run, "service.ready", {
    startedAt: service.startedAt,
    coldStart: input.runtimeColdStart,
  });

  // One thread per run. DeerFlow's thread ids allow only `[A-Za-z0-9_-]`, and a
  // fresh one keeps a run's checkpoints, sandbox and outputs to itself; what is
  // meant to carry across runs — memory — is per user, not per thread.
  const threadId = `bb-${randomUUID().replaceAll("-", "")}`;
  run.thread = { url: service.url, threadId };
  emit(run, "thread.opened", { threadId });

  const body = JSON.stringify({
    assistant_id: "lead_agent",
    input: {
      messages: [
        {
          type: "human",
          content: promptWithContext(run.task, input.conversationContext),
        },
      ],
    },
    config: { configurable: { thread_id: threadId } },
    context: runContext(input.settings, {
      model: input.model,
      reasoningEffort: input.reasoningEffort,
    }),
    // `custom` carries the subagent lifecycle; `values` would re-send the whole
    // state on every super-step, and the final checkpoint is read once at the
    // end instead.
    stream_mode: ["messages-tuple", "custom"],
    // Breadboard's own abort is what stops a run. Without this the Gateway
    // cancels the moment this connection drops — which is what a reconnect
    // does, and a dropped connection would then end a healthy run.
    on_disconnect: "continue",
  });

  await streamRun(run, service, body);

  if (isTerminalStatus(run.status)) return;

  if (run.fallbackError) {
    finish(run, "failed", {
      error: run.fallbackError.slice(0, 2_000),
      summary: run.answer.trim(),
      toolCalls: run.toolCallCount,
    });
    return;
  }

  const stored = await finalState(service, threadId);
  await keepArtifacts(run, stored.artifacts);
  flushAnswer(run);
  const answer = stored.answer.trim() || run.answer.trim();
  if (answer) {
    finish(run, "completed", {
      summary: answer,
      toolCalls: run.toolCallCount,
      artifacts: run.artifacts,
      artifactProblems: run.artifactProblems,
    });
    return;
  }
  finish(run, "failed", {
    error: "The DeerFlow stream ended before an answer arrived.",
    detail: serviceLog(),
  });
}

/**
 * Open the run's stream and keep reading it until the Gateway says the run is
 * over.
 *
 * A DeerFlow turn can run for an hour behind one HTTP connection, so a dropped
 * connection is expected rather than exceptional. It is not the end of the run:
 * `on_disconnect: "continue"` keeps the Gateway working, and rejoining replays
 * from the last event this reader saw. The loop stops when the Gateway sends
 * `end`, or when the run is no longer active on its side.
 */
async function streamRun(
  run: RunState,
  service: DeerFlowWorkerService,
  body: string,
): Promise<void> {
  let lastEventId = "";
  for (let attempt = 0; attempt < MAX_STREAM_ATTEMPTS; attempt += 1) {
    if (run.aborted || isTerminalStatus(run.status)) return;

    let response: Response;
    if (attempt === 0) {
      response = await call(service, "/api/runs/stream", {
        method: "POST",
        headers: { accept: "text/event-stream" },
        body,
        // The stream stays open for the whole run — the Gateway heartbeats — so
        // the only things that close it are a terminal state and the timeout.
        signal: AbortSignal.any([run.streaming.signal, AbortSignal.timeout(RUN_TIMEOUT_MS)]),
      });
      if (!response.ok || !response.body) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error(`DeerFlow refused the request (${response.status}).`);
      }
      // Every run-creating route reports its own address here; it is what a
      // rejoin and a cancel are addressed to.
      run.upstreamRunPath = response.headers.get("content-location");
    } else {
      const runPath = run.upstreamRunPath;
      // Without the run's address there is nothing to rejoin, and a run that is
      // no longer active upstream has nothing left to say.
      if (!runPath || !(await upstreamActive(run))) return;
      response = await call(service, `${runPath}/join`, {
        headers: { accept: "text/event-stream", ...(lastEventId ? { "Last-Event-ID": lastEventId } : {}) },
        signal: AbortSignal.any([run.streaming.signal, AbortSignal.timeout(RUN_TIMEOUT_MS)]),
      });
      if (!response.ok || !response.body) return;
    }

    const result = await consume(run, response.body, lastEventId);
    lastEventId = result.lastEventId;
    if (result.ended) return;
  }
}

/** Whether the Gateway still considers this run to be going. */
async function upstreamActive(run: RunState): Promise<boolean> {
  const service = run.thread;
  const runPath = run.upstreamRunPath;
  if (!service || !runPath) return false;
  try {
    const response = await call(service, runPath);
    if (!response.ok) return false;
    const status = text(record(await response.json()).status);
    return status === "pending" || status === "running";
  } catch {
    // Unreachable means unknown, and an unknown run is not worth rejoining.
    return false;
  }
}

/** Parse the Gateway's SSE frames until it closes or the run finishes. */
async function consume(
  run: RunState,
  body: ReadableStream<Uint8Array>,
  startId: string,
): Promise<{ lastEventId: string; ended: boolean }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lastEventId = startId;
  let ended = false;
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
          // `end` is the Gateway's own statement that the run is over; anything
          // else that closes this connection is a drop worth rejoining.
          if (parsed.event === "end") ended = true;
          else handleEvent(run, parsed.event, parsed.data);
        }
        if (ended || isTerminalStatus(run.status)) return { lastEventId, ended: true };
        boundary = buffer.indexOf("\n\n");
      }
      // A frame this long is not one the Gateway emits; holding it only grows
      // memory on a stream that has stopped being SSE.
      if (buffer.length > 8_000_000) buffer = "";
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // The stream is already gone.
    }
  }
  return { lastEventId, ended };
}

/**
 * One SSE frame from the Gateway. Exported because the wire format is the seam
 * between two projects: a change on either side has to fail a test here rather
 * than silently produce a run card that never fills in.
 */
export function parseFrame(
  frame: string,
): { id: string; event: string; data: unknown } | null {
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
    return { id, event, data: JSON.parse(dataLines.join("\n")) };
  } catch {
    return null;
  }
}

/** Translate one Gateway event into this run's own event stream. */
function handleEvent(run: RunState, type: string, data: unknown): void {
  if (type === "messages") {
    const frame = Array.isArray(data) ? data : [];
    handleMessage(run, record(frame[0]));
    return;
  }

  if (type === "custom") {
    handleCustom(run, record(data));
    return;
  }

  if (type === "error") {
    const payload = record(data);
    flushAnswer(run);
    finish(run, "failed", {
      error: text(payload.message, "The DeerFlow run failed.").slice(0, 2_000),
      summary: run.answer.trim(),
      toolCalls: run.toolCallCount,
    });
    return;
  }

  if (type === "gap") {
    // The Gateway dropped retained events this reader had not read yet. The
    // checkpoint is still authoritative, so the run continues and the final
    // state fills in what the live view missed.
    emit(run, "agent.warning", {
      message: "Part of the live view was dropped. The result is read from the run's own record.",
    });
  }
}

/**
 * One message frame. Assistant and tool messages only — see the note at the top
 * of the file about what else rides this stream.
 */
function handleMessage(run: RunState, message: Record<string, unknown>): void {
  const type = text(message.type);

  if (type === "ai" || type === "AIMessageChunk") {
    const extra = record(message.additional_kwargs);
    // A provider failure does not surface as an error frame. DeerFlow's
    // LLMErrorHandlingMiddleware converts it into an ordinary assistant message
    // so the graph can end cleanly, and marks it — the marker is the only thing
    // that separates "the model apologised" from "the model failed", and
    // without reading it a rate-limited run reports success.
    if (extra.deerflow_error_fallback === true) {
      run.fallbackError =
        text(extra.error_detail) || text(extra.error_reason) || messageText(message.content);
      return;
    }
    const id = text(message.id);
    // A chunk stream is deltas; a whole `ai` message with an id already streamed
    // is the same text again, and appending it would double the answer.
    const streamed = id ? run.seenMessages.get(id) === true : false;
    if (type === "AIMessageChunk") {
      if (id) run.seenMessages.set(id, true);
      pushAnswer(run, messageText(message.content));
    } else if (!streamed) {
      pushAnswer(run, messageText(message.content));
    }

    const reasoning = record(message.additional_kwargs).reasoning_content;
    const summary = messageText(reasoning).split(/\r?\n/).filter(Boolean).at(-1);
    if (summary) emit(run, "agent.thinking", { summary: summary.slice(0, 200) });

    for (const entry of [
      ...(Array.isArray(message.tool_call_chunks) ? message.tool_call_chunks : []),
      ...(Array.isArray(message.tool_calls) ? message.tool_calls : []),
    ]) {
      const call = record(entry);
      const name = text(call.name);
      const callId = text(call.id);
      // A tool call arrives split across chunks: the name lands on the first one
      // and the arguments trickle in after it, so the row opens on the name.
      if (!name || !callId || run.toolCalls.has(callId)) continue;
      run.toolCalls.set(callId, name);
      run.toolCallCount += 1;
      emit(run, "step.started", {
        kind: "tool",
        callId,
        display: name,
        detail: describeArguments(call.args),
      });
    }
    return;
  }

  if (type === "tool") {
    const callId = text(message.tool_call_id);
    const name = text(message.name) || run.toolCalls.get(callId) || "tool";
    emit(run, "step.completed", {
      kind: "tool",
      callId,
      display: name,
      status: text(message.status, "success") === "error" ? "error" : "ok",
      detail: messageText(message.content).split(/\r?\n/).filter(Boolean).slice(0, 2).join(" ").slice(0, 200),
    });
  }
}

/** The subagent lifecycle, which DeerFlow publishes as custom events. */
function handleCustom(run: RunState, payload: Record<string, unknown>): void {
  const type = text(payload.type);
  const taskId = text(payload.task_id);

  // Not a subagent event: the model call itself is being retried, which on a
  // rate-limited provider is the difference between "slow" and "stuck".
  if (type === "llm_retry") {
    emit(run, "agent.warning", {
      message: text(payload.message, "The model is retrying.").slice(0, 300),
    });
    return;
  }
  if (!taskId) return;

  if (type === "task_started") {
    run.toolCallCount += 1;
    emit(run, "step.started", {
      kind: "subagent",
      callId: taskId,
      display: "subagent",
      detail: text(payload.description).slice(0, 200),
    });
    return;
  }

  if (type === "task_running") {
    const message = record(payload.message);
    const line = messageText(message.content).split(/\r?\n/).filter(Boolean).at(-1);
    emit(run, "step.progress", {
      callId: taskId,
      detail: (line ?? `step ${text(payload.message_index, "")}`).slice(0, 200),
    });
    return;
  }

  if (type === "task_completed" || type === "task_failed") {
    emit(run, "step.completed", {
      kind: "subagent",
      callId: taskId,
      display: "subagent",
      status: type === "task_failed" ? "error" : "ok",
      detail: (type === "task_failed"
        ? text(payload.error)
        : messageText(payload.result)
      )
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(0, 2)
        .join(" ")
        .slice(0, 200),
    });
  }
}

/** One presented file's bytes, read back through the Gateway. */
async function fetchArtifactBytes(
  service: { url: string },
  threadId: string,
  virtualPath: string,
): Promise<Buffer> {
  const relative = virtualPath.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");
  const response = await fetch(
    new URL(`/api/threads/${encodeURIComponent(threadId)}/artifacts/${relative}?download=true`, service.url),
    { signal: AbortSignal.timeout(ARTIFACT_READ_TIMEOUT_MS) },
  );
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("artifact_not_found");
  }
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > ARTIFACT_MAX_BYTES)) {
    await response.body.cancel().catch(() => undefined);
    throw new Error("artifact_too_large");
  }
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > ARTIFACT_MAX_BYTES) throw new Error("artifact_too_large");
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  return Buffer.concat(chunks, total);
}

/**
 * Keep the files a run presented as artifacts of the chat that asked for them.
 *
 * Best-effort by design: a file the store refuses is named in the run's output
 * rather than silently dropped, and never costs an answer that is otherwise
 * complete.
 */
async function keepArtifacts(run: RunState, paths: readonly string[]): Promise<void> {
  const known = new Set(run.artifacts.map((artifact) => artifact.path));
  for (const virtualPath of paths) {
    if (known.has(virtualPath)) continue;
    known.add(virtualPath);
    const entry: DeerFlowArtifact = {
      id: String(run.artifacts.length),
      path: virtualPath,
      name: virtualPath.split("/").filter(Boolean).pop() ?? virtualPath,
      artifactId: null,
    };
    run.artifacts.push(entry);

    if (!run.thread) continue;
    if (!run.artifactContext) {
      run.artifactProblems.push(
        `${entry.name} stayed in the run's workspace — this chat has no artifact store to keep it in.`,
      );
      continue;
    }
    try {
      const bytes = await fetchArtifactBytes(run.thread, run.thread.threadId, virtualPath);
      const saved = await saveDeerFlowArtifact({
        context: run.artifactContext,
        path: virtualPath,
        bytes,
      });
      if (saved.ok) entry.artifactId = saved.artifact.id;
      else run.artifactProblems.push(saved.reason);
    } catch (error) {
      run.artifactProblems.push(
        `${entry.name} could not be read back: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }
  if (run.artifacts.length) emit(run, "artifacts", { files: run.artifacts });
}

function finish(run: RunState, status: RunStatus, payload: Record<string, unknown>): void {
  if (isTerminalStatus(run.status)) return;
  flushAnswer(run);
  run.status = status;
  // Nothing more will be read from the Gateway, so drop the open connection
  // rather than leave it reading an idle thread until the run timeout.
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
  closeDeerFlowArtifactContext(run.artifactContext, status as "completed" | "failed" | "aborted");
  run.artifactContext = null;
  const timer = setTimeout(() => runs.delete(run.runId), RETENTION_MS);
  timer.unref?.();
}

/** Ask the Gateway to stop the in-flight run. */
async function cancelUpstream(run: RunState): Promise<void> {
  const service = run.thread;
  const runPath = run.upstreamRunPath;
  if (!service || !runPath) return;
  try {
    await call(service, `${runPath}/cancel?action=interrupt`, { method: "POST" });
  } catch {
    // The Gateway may already be gone; the run is ending either way.
  }
}

// ---- read/control API -------------------------------------------------------

export function getRuntimeWorkerEventsSince(
  userId: number,
  runId: string,
  since = 0,
): DeerFlowEvent[] {
  return requireRun(userId, runId).events.filter((event) => event.sequenceNumber > since);
}

export function isRuntimeWorkerTerminal(userId: number, runId: string): boolean {
  return isTerminalStatus(requireRun(userId, runId).status);
}

export function abortRuntimeWorkerRun(userId: number, runId: string): boolean {
  const run = requireRun(userId, runId);
  if (isTerminalStatus(run.status)) return false;
  run.aborted = true;
  // Begin the scoped upstream interrupt before closing the stream. The generic
  // worker adapter deliberately does not await domain abort hooks; keeping this
  // promise live lets Node deliver the interrupt while Rust begins its bounded
  // process-tree cancellation grace period.
  const cancellation = cancelUpstream(run);
  run.streaming.abort(new DOMException("DeerFlow was stopped", "AbortError"));
  void cancellation.finally(() => {
    finish(run, "aborted", {
      // Whatever landed before the stop is still worth keeping.
      summary: run.answer.trim() || "DeerFlow stopped before it answered.",
      toolCalls: run.toolCallCount,
      artifacts: run.artifacts,
    });
  });
  return true;
}
