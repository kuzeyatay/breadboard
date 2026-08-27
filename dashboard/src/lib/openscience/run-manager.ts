// One OpenScience run: a research session in the workspace, streamed into the
// chat.
//
// The work belongs to the wrapped runtime — it plans, reads literature, writes
// code, runs experiments and writes up the result. What this module owns is
// everything between that and a Breadboard chat: run identity and ownership,
// the event trail the card renders, the terminal result the transcript stores,
// and the files the run left behind.
//
// Progress comes from the server's event stream. Only events carrying this
// run's own `sessionID` are considered — the Runtime-owned service is shared
// across runs, while this module lives in one fresh disposable worker.

import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import type { ChatTokenUsage } from "../chat-token-usage.ts";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import {
  abortSession,
  createSession,
  listMessages,
  prompt,
  respondToPermission,
  type Connection,
  type MessageRecord,
} from "./client.ts";
import { PROVIDER_ID } from "./contract.ts";
import { preparedService } from "./runtime-worker-service.ts";
import { runInstruction, sessionTitle, type PromptOptions } from "./prompt.ts";
import { promptWithContext } from "../conversations/agent-context.ts";

export interface OpenscienceEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

export interface OpenscienceTerminalResult {
  outcome: "completed" | "failed" | "aborted";
  content: string;
  usage?: ChatTokenUsage;
}

type RunStatus = "queued" | "running" | "completed" | "failed" | "aborted";

/** The visible phases of a run, in the order they happen. */
export type RunStage = "starting" | "working" | "delivering";

export interface Deliverable {
  /** Workspace-relative path, which is also the id the download route takes. */
  path: string;
  size: number;
}

export interface OpenscienceRunSummary {
  runId: string;
  status: RunStatus;
  stage: RunStage;
  task: string;
  startedAt: string;
  sessionId: string | null;
  deliverables: Deliverable[];
}

interface RunState {
  runId: string;
  userId: number;
  conversationPublicId?: string;
  task: string;
  /** The chat this run was launched from, rendered once by the route. */
  conversationContext: string;
  model: string;
  variant: string;
  options: PromptOptions;
  status: RunStatus;
  stage: RunStage;
  sequence: number;
  events: OpenscienceEvent[];
  startedAt: number;
  sessionId: string | null;
  connection: Connection | null;
  workspace: string;
  /** Accumulated assistant text, keyed by the runtime's part id. */
  parts: Map<string, string>;
  partOrder: string[];
  partCharacters: number;
  pendingAnswer: string;
  answerFlushTimer: ReturnType<typeof setTimeout> | null;
  /** Role per message id, so the person's own prompt stays out of the answer. */
  messageRoles: Map<string, string>;
  toolCount: number;
  /** Files present before the turn, so only this run's are reported. */
  knownFiles: Set<string>;
  deliverables: Deliverable[];
  abort: AbortController;
  aborted: boolean;
  usage?: ChatTokenUsage;
  terminalResult?: OpenscienceTerminalResult;
  terminalHandler?: (result: OpenscienceTerminalResult) => void;
}

const runtimeGlobal = globalThis as typeof globalThis & {
  __breadboardOpenscienceRuns?: Map<string, RunState>;
};
const runs = runtimeGlobal.__breadboardOpenscienceRuns ?? new Map<string, RunState>();
runtimeGlobal.__breadboardOpenscienceRuns = runs;

const MAX_EVENTS = 5_000;
const MAX_ANSWER_CHARS = 200_000;
const MAX_DELIVERABLES = 60;
const MAX_TEXT_PARTS = 2_000;
const MAX_UPSTREAM_FRAME_CHARS = 1024 * 1024;
const ANSWER_FLUSH_MS = 250;
/** A turn producing nothing at all for this long has stalled. */
const STREAM_IDLE_TIMEOUT_MS = 30 * 60_000;
/** A complete scientific turn can include experiments and long tool calls. */
const RUN_TIMEOUT_MS = 90 * 60_000;
/** Runs outlive a plausible tab switch; research turns are long. */
const RETENTION_MS = 6 * 60 * 60_000;

/** Directories that are machinery rather than research output. */
const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "__pycache__",
  ".ruff_cache",
  ".pytest_cache",
  ".mypy_cache",
  ".ipynb_checkpoints",
  ".venv",
  "venv",
  ".openscience",
]);

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

function reachedTerminal(run: RunState): boolean {
  return run.status === "completed" || run.status === "failed" || run.status === "aborted";
}

function requireRun(userId: number, runId: string): RunState {
  const run = runs.get(runId);
  if (!run || run.userId !== userId) throw new Error("run_not_found");
  return run;
}

function summary(run: RunState): OpenscienceRunSummary {
  return {
    runId: run.runId,
    status: run.status,
    stage: run.stage,
    task: run.task,
    startedAt: new Date(run.startedAt).toISOString(),
    sessionId: run.sessionId,
    deliverables: run.deliverables,
  };
}

/**
 * The streamed answer. Parts are joined with a blank line rather than
 * concatenated: the runtime emits a separate text part either side of a tool
 * call, and running them together produces "I'll run it now.I ran it."
 */
function answerText(run: RunState): string {
  return run.partOrder
    .map((id) => (run.parts.get(id) ?? "").trim())
    .filter(Boolean)
    .join("\n\n")
    .slice(0, MAX_ANSWER_CHARS);
}

function flushAnswer(run: RunState): void {
  if (run.answerFlushTimer) {
    clearTimeout(run.answerFlushTimer);
    run.answerFlushTimer = null;
  }
  while (run.pendingAnswer) {
    const text = run.pendingAnswer.slice(0, 8_000);
    run.pendingAnswer = run.pendingAnswer.slice(text.length);
    emit(run, "assistant.delta", { text });
  }
}

function queueAnswer(run: RunState, delta: string): void {
  if (!delta) return;
  run.pendingAnswer += delta;
  if (run.pendingAnswer.length >= 8_000) {
    flushAnswer(run);
    return;
  }
  if (run.answerFlushTimer) return;
  const timer = setTimeout(() => {
    run.answerFlushTimer = null;
    flushAnswer(run);
  }, ANSWER_FLUSH_MS);
  timer.unref?.();
  run.answerFlushTimer = timer;
}

function publishTerminal(run: RunState, result: OpenscienceTerminalResult): void {
  if (run.terminalResult) return;
  run.terminalResult = result;
  try {
    run.terminalHandler?.(result);
  } catch {
    // The run stays replayable even when transcript persistence fails.
  }
}

function scheduleCleanup(runId: string): void {
  const timer = setTimeout(() => runs.delete(runId), RETENTION_MS);
  timer.unref?.();
}

function finish(
  run: RunState,
  outcome: OpenscienceTerminalResult["outcome"],
  content: string,
): void {
  if (reachedTerminal(run)) return;
  flushAnswer(run);
  const boundedContent = content.slice(0, MAX_ANSWER_CHARS);
  run.status = outcome;
  emit(run, `run.${outcome}`, {
    content: boundedContent,
    deliverables: run.deliverables.length,
  });
  publishTerminal(run, {
    outcome,
    content: boundedContent,
    ...(run.usage ? { usage: run.usage } : {}),
  });
  scheduleCleanup(run.runId);
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

/** Every file in the workspace, relative to it, ignoring machinery. */
function walkWorkspace(root: string): Map<string, number> {
  const found = new Map<string, number>();
  const visit = (directory: string, depth: number): void => {
    if (depth > 8 || found.size > 5_000) return;
    let entries: Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        visit(path.join(directory, entry.name), depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const absolute = path.join(directory, entry.name);
      try {
        const stats = fs.statSync(absolute);
        found.set(path.relative(root, absolute).split(path.sep).join("/"), stats.size);
      } catch {
        // A file that vanished mid-walk is not a deliverable.
      }
    }
  };
  visit(root, 0);
  return found;
}

/**
 * What the run left behind: the workspace as it is now, minus what was already
 * there. The workspace is durable and shared, so reporting everything in it
 * would attach last week's figures to today's answer.
 */
function collectDeliverables(run: RunState): void {
  const current = walkWorkspace(run.workspace);
  for (const [relative, size] of current) {
    if (run.knownFiles.has(relative)) continue;
    run.knownFiles.add(relative);
    if (run.deliverables.length >= MAX_DELIVERABLES) break;
    run.deliverables.push({ path: relative, size });
    emit(run, "deliverable.ready", { path: relative, size });
  }
}

function usageFrom(messages: readonly MessageRecord[]): ChatTokenUsage | undefined {
  const totals = messages.reduce(
    (accumulated, message) => {
      const tokens = message.info?.tokens;
      if (!tokens) return accumulated;
      return {
        input: accumulated.input + (tokens.input ?? 0),
        output: accumulated.output + (tokens.output ?? 0),
        reasoning: accumulated.reasoning + (tokens.reasoning ?? 0),
        cached: accumulated.cached + (tokens.cache?.read ?? 0),
      };
    },
    { input: 0, output: 0, reasoning: 0, cached: 0 },
  );
  if (!totals.input && !totals.output && !totals.reasoning) return undefined;
  return {
    inputTokens: totals.input,
    outputTokens: totals.output,
    totalTokens: totals.input + totals.output,
    cachedInputTokens: totals.cached,
    reasoningTokens: totals.reasoning,
  };
}

interface ServerEvent {
  type?: string;
  properties?: Record<string, unknown>;
}

function partOf(event: ServerEvent): Record<string, unknown> | null {
  const part = event.properties?.part;
  return part && typeof part === "object" ? (part as Record<string, unknown>) : null;
}

/**
 * How an unattended run answers a permission request.
 *
 * The runtime's own defaults already allow the ordinary tools and ask only for
 * the three that reach outside this turn's own work. Reading another directory
 * or starting an MCP server is exactly what a workspace-scoped research run
 * should not do unasked, so those are refused and said out loud in the card;
 * the loop guard is allowed, because refusing it would kill a long but
 * legitimate experiment.
 */
function permissionResponse(permission: string): "once" | "reject" {
  return permission === "external_directory" || permission === "mcp" ? "reject" : "once";
}

/**
 * Subscribe to the runtime's events.
 *
 * Opening the stream is separate from consuming it because the turn is sent
 * asynchronously: the prompt has to go out *after* the subscription exists, or
 * the first tool calls of a fast turn land before anyone is listening and the
 * answer arrives with its beginning missing.
 */
async function openStream(
  run: RunState,
  baseUrl: string,
): Promise<ReadableStreamDefaultReader<Uint8Array>> {
  const response = await fetch(new URL("/event", baseUrl), {
    headers: { accept: "text/event-stream" },
    signal: run.abort.signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`The OpenScience event stream was refused (${response.status}).`);
  }
  return response.body.getReader();
}

async function followSession(
  run: RunState,
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<void> {
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
        let event: ServerEvent;
        try {
          event = JSON.parse(line.slice(5).trim()) as ServerEvent;
        } catch {
          continue;
        }
        const properties = event.properties ?? {};
        if (properties.sessionID && properties.sessionID !== run.sessionId) continue;
        lastActivity = Date.now();

        if (event.type === "message.updated") {
          const info = properties.info as Record<string, unknown> | undefined;
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
          // The person's own prompt streams back as a text part of the user
          // message. Only assistant parts belong in the answer.
          if (run.messageRoles.get(messageId) !== "assistant") continue;

          if (part.type === "text" && typeof part.text === "string") {
            const isNewPart = !run.parts.has(id);
            if (isNewPart) {
              if (run.partOrder.length >= MAX_TEXT_PARTS) continue;
              run.partOrder.push(id);
            }
            const previous = run.parts.get(id) ?? "";
            const available = Math.max(
              0,
              MAX_ANSWER_CHARS - (run.partCharacters - previous.length),
            );
            const next = part.text.slice(0, available);
            run.parts.set(id, next);
            run.partCharacters += next.length - previous.length;
            const delta = next.startsWith(previous)
              ? next.slice(previous.length)
              : next;
            // The card appends deltas verbatim, so the blank line `answerText`
            // puts between parts has to be streamed too.
            const separator = isNewPart && run.partOrder.length > 1 ? "\n\n" : "";
            if (delta) {
              queueAnswer(run, `${separator}${delta}`);
            }
            continue;
          }

          if (part.type === "tool") {
            const state = part.state as Record<string, unknown> | undefined;
            const status = typeof state?.status === "string" ? state.status : "";
            const tool = typeof part.tool === "string" ? part.tool : "tool";
            if (status === "completed") {
              run.toolCount += 1;
              emit(run, "tool.used", {
                tool,
                title: String(state?.title ?? "").slice(0, 200),
              });
            } else if (status === "error") {
              emit(run, "tool.failed", {
                tool,
                detail: errorText(state?.error).slice(0, 300),
              });
            }
            continue;
          }

          if (part.type === "step-finish") {
            const tokens = part.tokens as Record<string, unknown> | undefined;
            if (tokens) {
              const input = Number(tokens.input ?? 0);
              const output = Number(tokens.output ?? 0);
              const reasoning = Number(tokens.reasoning ?? 0);
              const cache = tokens.cache as Record<string, unknown> | undefined;
              const cached = Number(cache?.read ?? 0);
              const previous = run.usage ?? {
                inputTokens: 0,
                outputTokens: 0,
                totalTokens: 0,
                cachedInputTokens: 0,
                reasoningTokens: 0,
              };
              run.usage = {
                inputTokens: previous.inputTokens + input,
                outputTokens: previous.outputTokens + output,
                totalTokens: previous.totalTokens + input + output,
                cachedInputTokens: (previous.cachedInputTokens ?? 0) + cached,
                reasoningTokens: (previous.reasoningTokens ?? 0) + reasoning,
              };
            }
            // Files appear as the run works, so the card can show them before
            // the turn ends rather than all at once at the finish.
            collectDeliverables(run);
          }
          continue;
        }

        // The runtime carries two permission systems at once: the newer one
        // asks with `permission.asked` and names the capability `permission`,
        // the older publishes `permission.updated` and names it `type`. Both
        // are answered on the same endpoint, and an unanswered request stalls
        // the turn, so both shapes are handled rather than whichever one this
        // build happened to use.
        if (event.type === "permission.asked" || event.type === "permission.updated") {
          const permission = String(properties.permission ?? properties.type ?? "");
          const permissionId = String(properties.id ?? "");
          const answer = permissionResponse(permission);
          emit(run, "permission.answered", { permission, response: answer });
          if (run.connection && permissionId && run.sessionId) {
            await respondToPermission(run.connection, run.sessionId, permissionId, answer);
          }
          continue;
        }

        if (event.type === "session.error") {
          const detail = errorText(properties.error);
          finish(run, "failed", detail || "The run failed inside OpenScience.");
          return;
        }

        if (event.type === "session.idle") return;
      }
      if (buffer.length > MAX_UPSTREAM_FRAME_CHARS) {
        throw new Error("The OpenScience event stream exceeded its frame bound.");
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

export interface StartInput {
  userId: number;
  task: string;
  model: string;
  reasoningEffort: string;
  options: PromptOptions;
  /** Durable chat ownership for standalone OpenScience runs. */
  conversationPublicId?: string;
  /** The chat this was launched from, so a goal can refer back to it. */
  conversationContext?: string;
}

export interface RuntimeWorkerStartInput extends StartInput {
  /** Fenced identity supplied by Runtime V2, never selected by a renderer. */
  runtimeJobId: string;
  conversationPublicId: string;
}

async function execute(run: RunState): Promise<void> {
  try {
    emit(run, "service.starting", {});
    const service = await preparedService({
      userId: run.userId,
      runId: run.runId,
      ...(run.conversationPublicId
        ? { conversationPublicId: run.conversationPublicId }
        : {}),
    });
    if (!service.models.includes(run.model)) {
      throw new Error("The prepared OpenScience service does not declare this model.");
    }
    run.connection = { baseUrl: service.baseUrl };
    run.workspace = service.workspacePath;
    emit(run, "service.ready", { workspace: service.workspacePath });

    // Snapshot the workspace before the turn so only this run's files are
    // reported back to the chat.
    for (const relative of walkWorkspace(run.workspace).keys()) run.knownFiles.add(relative);

    if (run.aborted) {
      finish(run, "aborted", "The run was stopped before it started.");
      return;
    }

    const session = await createSession(run.connection, sessionTitle(run.task));
    run.sessionId = session.id;
    run.status = "running";
    run.stage = "working";
    emit(run, "session.created", { sessionId: session.id });

    // Subscribe first, then send: the turn is accepted asynchronously and its
    // early events would otherwise arrive before anyone was listening.
    const reader = await openStream(run, service.baseUrl);
    await prompt(run.connection, {
      sessionId: session.id,
      agent: run.options.harness,
      providerId: PROVIDER_ID,
      model: run.model,
      variant: run.variant,
      text: promptWithContext(
        runInstruction(run.task, run.options),
        run.conversationContext,
      ),
      signal: run.abort.signal,
    });

    await followSession(run, reader);
    if (reachedTerminal(run)) return;

    flushAnswer(run);
    run.stage = "delivering";
    emit(run, "stage", { stage: run.stage });

    const messages = await listMessages(run.connection, session.id);
    run.usage = usageFrom(messages) ?? run.usage;
    collectDeliverables(run);

    // The streamed text is the answer; the transcript is only consulted when
    // nothing streamed, which is how a turn that failed upstream is caught.
    const streamed = answerText(run);
    const assistant = messages.filter((message) => message.info?.role === "assistant");
    const transcript = assistant
      .flatMap((message) => message.parts ?? [])
      .filter((part) => part.type === "text" && part.text)
      .map((part) => part.text ?? "")
      .join("")
      .trim();
    const content = streamed || transcript;

    if (!content) {
      // An empty answer is never a success. The runtime leaves the assistant
      // message with no parts and no error when the provider refuses the
      // request — a ChatMock rate limit looks exactly like a silent, instant
      // reply — so the failure is reported here or it reads as a blank answer.
      const detail = assistant.map((message) => errorText(message.info?.error)).find(Boolean);
      finish(
        run,
        "failed",
        detail
          ? `OpenScience produced no answer: ${detail}`
          : "OpenScience produced no answer. The model returned nothing — usually the provider refused the request (rate limit or quota).",
      );
      return;
    }

    finish(run, "completed", content);
  } catch (error) {
    if (run.aborted) {
      finish(run, "aborted", answerText(run) || "The run was stopped.");
      return;
    }
    finish(
      run,
      "failed",
      error instanceof Error ? error.message : "The OpenScience run failed.",
    );
  }
}

function startLocalRun(runId: string, input: StartInput): OpenscienceRunSummary {
  if (runs.has(runId)) throw new Error("The OpenScience Runtime identity was reused.");
  const run: RunState = {
    runId,
    userId: input.userId,
    ...(input.conversationPublicId
      ? { conversationPublicId: input.conversationPublicId }
      : {}),
    task: input.task,
    conversationContext: input.conversationContext ?? "",
    model: input.model,
    variant: input.reasoningEffort,
    options: input.options,
    status: "queued",
    stage: "starting",
    sequence: 0,
    events: [],
    startedAt: Date.now(),
    sessionId: null,
    connection: null,
    workspace: "",
    parts: new Map(),
    partOrder: [],
    partCharacters: 0,
    pendingAnswer: "",
    answerFlushTimer: null,
    messageRoles: new Map(),
    toolCount: 0,
    knownFiles: new Set(),
    deliverables: [],
    abort: new AbortController(),
    aborted: false,
  };
  runs.set(run.runId, run);
  emit(run, "run.started", {
    task: run.task.slice(0, 2_000),
    model: run.model,
    harness: run.options.harness,
  });
  const timer = setTimeout(() => {
    if (reachedTerminal(run)) return;
    run.aborted = true;
    run.abort.abort(new DOMException("OpenScience timed out", "AbortError"));
    if (run.connection && run.sessionId) {
      void abortSession(run.connection, run.sessionId);
    }
    finish(run, "failed", answerText(run) || "The OpenScience run exceeded its time limit.");
  }, RUN_TIMEOUT_MS);
  timer.unref?.();
  void execute(run).finally(() => clearTimeout(timer));
  return summary(run);
}

/** Compatibility seam for the already-disposable Max Research coordinator. */
export function startRun(input: StartInput & Record<string, unknown>): OpenscienceRunSummary {
  return startLocalRun(`osrun_${randomUUID().replaceAll("-", "")}`, input);
}

/** Fixed entrypoint used only by the fresh outer-openscience Runtime worker. */
export function startRuntimeWorkerRun(
  input: RuntimeWorkerStartInput,
): OpenscienceRunSummary {
  if (
    !Number.isSafeInteger(input.userId) ||
    input.userId < 1 ||
    !/^[A-Za-z0-9_-]{1,128}$/u.test(input.runtimeJobId) ||
    !/^conv_[A-Za-z0-9_-]{24}$/u.test(input.conversationPublicId)
  ) {
    throw new Error("The OpenScience Runtime worker input is invalid.");
  }
  return startLocalRun(input.runtimeJobId, input);
}

export function getRun(userId: number, runId: string): OpenscienceRunSummary {
  return summary(requireRun(userId, runId));
}

export function getEventsSince(
  userId: number,
  runId: string,
  since: number,
): OpenscienceEvent[] {
  return requireRun(userId, runId).events.filter((event) => event.sequenceNumber > since);
}

export function isTerminal(userId: number, runId: string): boolean {
  const run = runs.get(runId);
  if (!run || run.userId !== userId) return true;
  return reachedTerminal(run);
}

export function abortRuntimeWorkerRun(userId: number, runId: string): void {
  const run = requireRun(userId, runId);
  if (isTerminal(userId, runId)) return;
  run.aborted = true;
  run.abort.abort(new DOMException("OpenScience stopped", "AbortError"));
  if (run.connection && run.sessionId) {
    void abortSession(run.connection, run.sessionId);
  }
  finish(run, "aborted", answerText(run) || "The run was stopped.");
}

export async function abortRun(userId: number, runId: string): Promise<void> {
  abortRuntimeWorkerRun(userId, runId);
}

export const getRuntimeWorkerEventsSince = getEventsSince;
export const isRuntimeWorkerTerminal = isTerminal;

/**
 * One of the run's files, read back for download.
 *
 * The path is never taken from the caller on trust: it has to be one this run
 * reported, and the resolved location has to still sit inside the workspace, so
 * a crafted id cannot walk out of it.
 */
export function readDeliverable(
  userId: number,
  runId: string,
  relativePath: string,
): { bytes: Buffer; path: string } {
  const run = requireRun(userId, runId);
  const known = run.deliverables.find((item) => item.path === relativePath);
  if (!known) throw new Error("deliverable_not_found");
  const absolute = path.resolve(run.workspace, relativePath);
  const root = path.resolve(run.workspace);
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
    throw new Error("deliverable_not_found");
  }
  return { bytes: fs.readFileSync(absolute), path: relativePath };
}

/**
 * Register the handler that writes the finished turn into the chat transcript.
 * A run that has already finished calls it at once, so a handler attached after
 * a fast run still gets its result.
 */
export function onTerminal(
  userId: number,
  runId: string,
  handler: (result: OpenscienceTerminalResult) => void,
): void {
  const run = requireRun(userId, runId);
  run.terminalHandler = handler;
  if (run.terminalResult) handler(run.terminalResult);
}
