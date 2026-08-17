// One OpenWork run: a session in the workspace, streamed into the chat.
//
// The work itself belongs to the wrapped runtime — OpenWork starts the turn and
// OpenCode executes it. What this module owns is everything between that and a
// Breadboard chat: run identity and ownership, the event trail the card
// renders, the terminal result the transcript stores, and the deliverables the
// run left in the workspace outbox.
//
// Progress comes from the *engine's* event stream, not the OpenWork server's.
// The server's `/workspace/:id/events` carries configuration-reload notices
// only — upstream's desktop app subscribes to OpenCode directly for the turn,
// and so does this. `session.idle` for the run's own session is the completion
// signal; text arrives as `message.part.updated`.

import { randomUUID } from "node:crypto";
import type { ChatTokenUsage } from "../chat-token-usage.ts";
import {
  abortSession,
  createSession,
  listArtifacts,
  listMessages,
  readArtifact,
  type OpenworkArtifact,
  type OpenworkConnection,
  type OpenworkMessage,
} from "./client.ts";
import { runInstruction, sessionTitle, type PromptOptions } from "./prompt.ts";
import { ensureService } from "./service.ts";
import { promptWithContext } from "../conversations/agent-context.ts";

export interface OpenworkEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

export interface OpenworkTerminalResult {
  outcome: "completed" | "failed" | "aborted";
  content: string;
  usage?: ChatTokenUsage;
}

type RunStatus = "queued" | "running" | "completed" | "failed" | "aborted";

/** The visible phases of a run, in the order they happen. */
export type RunStage = "starting" | "working" | "delivering";

export interface OpenworkRunSummary {
  runId: string;
  status: RunStatus;
  stage: RunStage;
  task: string;
  startedAt: string;
  sessionId: string | null;
  artifacts: OpenworkArtifact[];
}

interface RunState {
  runId: string;
  userId: number;
  task: string;
  /** The chat this run was launched from, rendered once by the route. */
  conversationContext: string;
  model: string;
  variant: string;
  status: RunStatus;
  stage: RunStage;
  sequence: number;
  events: OpenworkEvent[];
  startedAt: number;
  sessionId: string | null;
  connection: OpenworkConnection | null;
  /** Accumulated assistant text, keyed by the engine's part id. */
  parts: Map<string, string>;
  /** Ordering of the part ids, so the answer reads in the order it streamed. */
  partOrder: string[];
  /**
   * Role per engine message id. The stream carries the user's own prompt back
   * as a text part too, and the engine always announces a message before its
   * parts, so this is what keeps the question out of the answer.
   */
  messageRoles: Map<string, string>;
  toolCount: number;
  artifacts: OpenworkArtifact[];
  /** Outbox entries that already existed, so only this run's are reported. */
  knownArtifacts: Set<string>;
  abort: AbortController;
  aborted: boolean;
  usage?: ChatTokenUsage;
  terminalResult?: OpenworkTerminalResult;
  terminalHandler?: (result: OpenworkTerminalResult) => void;
}

const runtimeGlobal = globalThis as typeof globalThis & {
  __breadboardOpenworkRuns?: Map<string, RunState>;
};
const runs = runtimeGlobal.__breadboardOpenworkRuns ?? new Map<string, RunState>();
runtimeGlobal.__breadboardOpenworkRuns = runs;

const MAX_EVENTS = 5_000;
const MAX_ANSWER_CHARS = 200_000;
/** A turn that produces nothing at all for this long has stalled. */
const STREAM_IDLE_TIMEOUT_MS = 15 * 60_000;

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

/**
 * Whether the run has already reached a terminal state. Written as a helper
 * rather than an inline comparison so the check survives control flow: the
 * status is set inside `followSession` and `finish`, which the compiler cannot
 * see from the call site.
 */
function reachedTerminal(run: RunState): boolean {
  return run.status === "completed" || run.status === "failed" || run.status === "aborted";
}

function requireRun(userId: number, runId: string): RunState {
  const run = runs.get(runId);
  if (!run || run.userId !== userId) throw new Error("run_not_found");
  return run;
}

function summary(run: RunState): OpenworkRunSummary {
  return {
    runId: run.runId,
    status: run.status,
    stage: run.stage,
    task: run.task,
    startedAt: new Date(run.startedAt).toISOString(),
    sessionId: run.sessionId,
    artifacts: run.artifacts,
  };
}

/**
 * The streamed answer.
 *
 * Parts are joined with a blank line rather than concatenated: the engine emits
 * a separate text part either side of a tool call, and running them together
 * produced answers like "I'll create the file now.I created the file." — two
 * sentences with no boundary between them.
 */
function answerText(run: RunState): string {
  return run.partOrder
    .map((id) => (run.parts.get(id) ?? "").trim())
    .filter(Boolean)
    .join("\n\n")
    .slice(0, MAX_ANSWER_CHARS);
}

function publishTerminal(run: RunState, result: OpenworkTerminalResult): void {
  if (run.terminalResult) return;
  run.terminalResult = result;
  try {
    run.terminalHandler?.(result);
  } catch {
    // The run stays replayable even when transcript persistence fails.
  }
}

function finish(run: RunState, outcome: OpenworkTerminalResult["outcome"], content: string): void {
  if (reachedTerminal(run)) return;
  run.status = outcome;
  emit(run, `run.${outcome}`, {
    content: content.slice(0, 4_000),
    artifacts: run.artifacts.length,
  });
  publishTerminal(run, {
    outcome,
    content,
    ...(run.usage ? { usage: run.usage } : {}),
  });
}

function usageFrom(messages: readonly OpenworkMessage[]): ChatTokenUsage | undefined {
  const totals = messages.reduce(
    (accumulated, message) => {
      const tokens = message.tokens;
      if (!tokens) return accumulated;
      return {
        input: accumulated.input + (tokens.input ?? 0),
        output: accumulated.output + (tokens.output ?? 0),
        reasoning: accumulated.reasoning + (tokens.reasoning ?? 0),
      };
    },
    { input: 0, output: 0, reasoning: 0 },
  );
  if (!totals.input && !totals.output && !totals.reasoning) return undefined;
  return {
    inputTokens: totals.input,
    outputTokens: totals.output,
    totalTokens: totals.input + totals.output,
    cachedInputTokens: 0,
    reasoningTokens: totals.reasoning,
  };
}

function errorText(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const data = record.data as Record<string, unknown> | undefined;
    const message = data?.message ?? record.message ?? record.name;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return JSON.stringify(value).slice(0, 400);
}

/**
 * The outbox, minus whatever was already sitting there. A workspace is durable
 * and shared across runs, so reporting everything in it would attach last
 * week's documents to today's answer.
 */
async function collectArtifacts(run: RunState): Promise<void> {
  if (!run.connection) return;
  try {
    const items = await listArtifacts(run.connection);
    const fresh = items.filter((item) => !run.knownArtifacts.has(item.id));
    for (const item of fresh) {
      run.knownArtifacts.add(item.id);
      run.artifacts.push(item);
      emit(run, "artifact.ready", { id: item.id, path: item.path, size: item.size });
    }
  } catch {
    // A deliverable that cannot be listed still exists in the workspace; the
    // answer is not worth failing over it.
  }
}

interface EngineEvent {
  type?: string;
  properties?: Record<string, unknown>;
}

function partOf(event: EngineEvent): Record<string, unknown> | null {
  const part = event.properties?.part;
  return part && typeof part === "object" ? (part as Record<string, unknown>) : null;
}

/**
 * Follow the engine's event stream until this run's session goes idle.
 *
 * Only events carrying the run's own `sessionID` are considered: the engine is
 * shared, and a second chat's run would otherwise write its text into this
 * run's answer.
 */
async function followSession(run: RunState, engineUrl: string): Promise<void> {
  const response = await fetch(new URL("/event", engineUrl), {
    headers: { accept: "text/event-stream" },
    signal: run.abort.signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`The engine's event stream was refused (${response.status}).`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lastActivity = Date.now();

  const timer = setInterval(() => {
    if (Date.now() - lastActivity > STREAM_IDLE_TIMEOUT_MS) run.abort.abort();
  }, 30_000);

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        let event: EngineEvent;
        try {
          event = JSON.parse(line.slice(5).trim()) as EngineEvent;
        } catch {
          continue;
        }
        if (event.properties?.sessionID !== run.sessionId) continue;
        lastActivity = Date.now();

        if (event.type === "message.updated") {
          const info = event.properties?.info as Record<string, unknown> | undefined;
          if (typeof info?.id === "string" && typeof info.role === "string") {
            run.messageRoles.set(info.id, info.role);
          }
          continue;
        }

        if (event.type === "message.part.updated") {
          const part = partOf(event);
          const id = typeof part?.id === "string" ? part.id : "";
          if (!part || !id) continue;
          const messageId = typeof part.messageID === "string" ? part.messageID : "";
          // The user's own prompt streams back as a text part of the user
          // message. Only assistant parts belong in the answer.
          if (run.messageRoles.get(messageId) !== "assistant") continue;
          if (part.type === "text" && typeof part.text === "string") {
            const isNewPart = !run.parts.has(id);
            if (isNewPart) run.partOrder.push(id);
            const previous = run.parts.get(id) ?? "";
            run.parts.set(id, part.text);
            const delta = part.text.startsWith(previous)
              ? part.text.slice(previous.length)
              : part.text;
            // The card appends deltas verbatim, so the same blank line
            // `answerText` inserts between parts has to be streamed too.
            const separator = isNewPart && run.partOrder.length > 1 ? "\n\n" : "";
            if (delta) {
              emit(run, "assistant.delta", { text: `${separator}${delta}`.slice(0, 4_000) });
            }
          } else if (part.type === "tool") {
            const state = part.state as Record<string, unknown> | undefined;
            if (state?.status === "running" || state?.status === "completed") {
              run.toolCount += 1;
              emit(run, "tool.used", {
                tool: typeof part.tool === "string" ? part.tool : "tool",
                status: String(state.status),
              });
            }
          }
          continue;
        }

        if (event.type === "session.error") {
          const detail = errorText(event.properties?.error);
          finish(run, "failed", detail || "The run failed inside OpenWork.");
          return;
        }

        if (event.type === "session.idle") return;
      }
    }
  } finally {
    clearInterval(timer);
    try {
      await reader.cancel();
    } catch {
      // The stream is already gone.
    }
  }
}

async function execute(run: RunState, options: StartInput): Promise<void> {
  try {
    emit(run, "service.starting", {});
    const service = await ensureService({
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      model: run.model,
      prompt: options.prompt,
    });
    run.connection = {
      serverUrl: service.serverUrl,
      token: service.token,
      workspaceId: service.workspaceId,
    };
    emit(run, "service.ready", {
      workspaceId: service.workspaceId,
      workspacePath: service.workspacePath,
    });

    // Snapshot the outbox before the turn so only this run's deliverables are
    // reported back to the chat.
    try {
      for (const item of await listArtifacts(run.connection)) run.knownArtifacts.add(item.id);
    } catch {
      // An unreadable outbox means everything found later counts as new, which
      // is the safe direction to be wrong in.
    }

    if (run.aborted) {
      finish(run, "aborted", "The run was stopped before it started.");
      return;
    }

    const session = await createSession(run.connection, {
      title: sessionTitle(run.task),
      prompt: promptWithContext(runInstruction(run.task), run.conversationContext),
      model: run.model,
      variant: run.variant,
    });
    run.sessionId = session.id;
    run.status = "running";
    run.stage = "working";
    emit(run, "session.created", { sessionId: session.id, title: session.title });

    await followSession(run, service.engineUrl);
    if (reachedTerminal(run)) return;

    run.stage = "delivering";
    emit(run, "stage", { stage: run.stage });

    const messages = await listMessages(run.connection, session.id).catch(
      () => [] as OpenworkMessage[],
    );
    run.usage = usageFrom(messages);
    await collectArtifacts(run);

    // The streamed text is the answer; the transcript is only consulted when
    // nothing streamed, which is how a turn that failed upstream is caught.
    const streamed = answerText(run);
    const assistant = messages.filter((message) => message.role === "assistant");
    const transcript = assistant
      .flatMap((message) => message.parts)
      .filter((part) => part.type === "text" && part.text)
      .map((part) => part.text ?? "")
      .join("")
      .trim();
    const content = streamed || transcript;

    if (!content) {
      // An empty answer is never a success. The engine leaves the assistant
      // message with no parts and no error when the provider refuses the
      // request — a ChatMock 429 looks exactly like a silent, instant reply —
      // so the failure has to be reported here or it reads as a blank answer.
      const detail = assistant.map((message) => errorText(message.error)).find(Boolean);
      finish(
        run,
        "failed",
        detail
          ? `OpenWork produced no answer: ${detail}`
          : "OpenWork produced no answer. The model returned nothing — usually the provider refused the request (rate limit or quota).",
      );
      return;
    }

    finish(run, "completed", content);
  } catch (error) {
    if (run.aborted) {
      finish(run, "aborted", "The run was stopped.");
      return;
    }
    finish(
      run,
      "failed",
      error instanceof Error ? error.message : "The OpenWork run failed.",
    );
  }
}

export interface StartInput {
  userId: number;
  task: string;
  model: string;
  reasoningEffort: string;
  baseUrl: string;
  apiKey: string;
  /** The agent's stored preferences, resolved by the run route. */
  prompt: PromptOptions;
  /** The chat this was launched from, so a task can refer back to it. */
  conversationContext?: string;
}

export function startRun(input: StartInput): OpenworkRunSummary {
  const run: RunState = {
    runId: randomUUID(),
    userId: input.userId,
    task: input.task,
    conversationContext: input.conversationContext ?? "",
    model: input.model,
    variant: input.reasoningEffort,
    status: "queued",
    stage: "starting",
    sequence: 0,
    events: [],
    startedAt: Date.now(),
    sessionId: null,
    connection: null,
    parts: new Map(),
    partOrder: [],
    messageRoles: new Map(),
    toolCount: 0,
    artifacts: [],
    knownArtifacts: new Set(),
    abort: new AbortController(),
    aborted: false,
  };
  runs.set(run.runId, run);
  emit(run, "run.started", { task: run.task.slice(0, 2_000), model: run.model });
  void execute(run, input);
  return summary(run);
}

export function getRun(userId: number, runId: string): OpenworkRunSummary {
  return summary(requireRun(userId, runId));
}

export function getEventsSince(
  userId: number,
  runId: string,
  since: number,
): OpenworkEvent[] {
  return requireRun(userId, runId).events.filter((event) => event.sequenceNumber > since);
}

export function isTerminal(userId: number, runId: string): boolean {
  const run = runs.get(runId);
  if (!run || run.userId !== userId) return true;
  return reachedTerminal(run);
}

export async function abortRun(userId: number, runId: string): Promise<void> {
  const run = requireRun(userId, runId);
  if (isTerminal(userId, runId)) return;
  run.aborted = true;
  if (run.connection && run.sessionId) {
    await abortSession(run.connection, run.sessionId).catch(() => undefined);
  }
  run.abort.abort();
  finish(run, "aborted", answerText(run) || "The run was stopped.");
}

/**
 * One of the run's deliverables, fetched back through the workspace server.
 *
 * The bytes are never served from a path the caller supplies: the artifact id
 * has to be one this run reported, so a crafted id cannot walk out of the
 * outbox even though the server would also refuse it.
 */
export async function readRunArtifact(
  userId: number,
  runId: string,
  artifactId: string,
): Promise<{ bytes: Buffer; contentType: string; path: string }> {
  const run = requireRun(userId, runId);
  const artifact = run.artifacts.find((item) => item.id === artifactId);
  if (!artifact || !run.connection) throw new Error("artifact_not_found");
  const { bytes, contentType } = await readArtifact(run.connection, artifactId);
  return { bytes, contentType, path: artifact.path };
}

/**
 * Register the handler that writes the finished turn into the chat transcript.
 * A run that has already finished calls it at once, so a handler attached after
 * a fast run still gets its result.
 */
export function onTerminal(
  userId: number,
  runId: string,
  handler: (result: OpenworkTerminalResult) => void,
): void {
  const run = requireRun(userId, runId);
  run.terminalHandler = handler;
  if (run.terminalResult) handler(run.terminalResult);
}
