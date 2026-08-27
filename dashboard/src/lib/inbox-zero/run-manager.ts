// One Inbox Zero run: an instruction carried out against the user's mailbox,
// streamed into the chat.
//
// The work belongs to Inbox Zero's own assistant. What this module owns is
// everything between that and a Breadboard chat: run identity and ownership, the
// event trail the card renders, and the terminal result the transcript stores.
//
// The tool trail is kept deliberately visible. This agent sends replies and
// archives mail, so "what did it actually touch" is not a debugging detail — it
// is the thing the user needs to see to trust the answer.

import { randomUUID } from "node:crypto";

import { newChatId, runAssistantTurn, summarizeToolValue } from "./client.ts";
import { instruction } from "./identity.ts";
import {
  ensureInboxZeroReady,
  withInboxZeroStackLease,
} from "./runtime-service.ts";
import type { SetupStatus } from "./contract.ts";
import { promptWithContext } from "../conversations/agent-context.ts";

export interface InboxZeroEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

export interface InboxZeroTerminalResult {
  outcome: "completed" | "failed" | "aborted";
  content: string;
}

type RunStatus = "queued" | "running" | "completed" | "failed" | "aborted";

/** The visible phases of a run, in the order they happen. */
export type RunStage = "connecting" | "working" | "answering";

export interface InboxZeroAction {
  tool: string;
  /** A short, human reading of what the tool was asked to do. */
  detail: string;
  at: string;
}

export interface InboxZeroRunSummary {
  runId: string;
  status: RunStatus;
  stage: RunStage;
  task: string;
  startedAt: string;
  mailbox: string | null;
  actions: InboxZeroAction[];
}

interface RunState {
  runId: string;
  userId: number;
  task: string;
  status: RunStatus;
  stage: RunStage;
  sequence: number;
  events: InboxZeroEvent[];
  startedAt: number;
  mailbox: string | null;
  parts: Map<string, string>;
  partOrder: string[];
  answerChars: number;
  actions: InboxZeroAction[];
  abort: AbortController;
  aborted: boolean;
  terminalResult?: InboxZeroTerminalResult;
  terminalHandler?: (result: InboxZeroTerminalResult) => void;
}

const runtimeGlobal = globalThis as typeof globalThis & {
  __breadboardInboxZeroRuns?: Map<string, RunState>;
  /** One Inbox Zero conversation per Breadboard chat session, so follow-ups
   *  land in the same thread of context the assistant already has. */
  __breadboardInboxZeroChats?: Map<string, string>;
};
const runs = runtimeGlobal.__breadboardInboxZeroRuns ?? new Map<string, RunState>();
runtimeGlobal.__breadboardInboxZeroRuns = runs;
const chats = runtimeGlobal.__breadboardInboxZeroChats ?? new Map<string, string>();
runtimeGlobal.__breadboardInboxZeroChats = chats;

const MAX_EVENTS = 3_000;
const MAX_ANSWER_CHARS = 60_000;
const MAX_ACTIONS = 100;
/** Bound retained upstream conversation ids and evict least-recently used entries. */
const MAX_CHAT_CONTEXTS = 1_024;
/** A mailbox turn is interactive work, not a research project. */
const RUN_TIMEOUT_MS = 10 * 60_000;
const RETENTION_MS = 2 * 60 * 60_000;

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

function summary(run: RunState): InboxZeroRunSummary {
  return {
    runId: run.runId,
    status: run.status,
    stage: run.stage,
    task: run.task,
    startedAt: new Date(run.startedAt).toISOString(),
    mailbox: run.mailbox,
    actions: run.actions,
  };
}

/**
 * The streamed answer. Parts are joined with a blank line rather than
 * concatenated: the assistant emits a separate text part either side of a tool
 * call, and running them together produces "I'll check now.I checked."
 */
function answerText(run: RunState): string {
  return run.partOrder
    .map((id) => (run.parts.get(id) ?? "").trim())
    .filter(Boolean)
    .join("\n\n")
    .slice(0, MAX_ANSWER_CHARS);
}

function setStage(run: RunState, stage: RunStage): void {
  if (run.stage === stage) return;
  run.stage = stage;
  emit(run, "run.stage", { stage });
}

function publishTerminal(run: RunState, result: InboxZeroTerminalResult): void {
  if (run.terminalResult) return;
  run.terminalResult = result;
  try {
    run.terminalHandler?.(result);
  } catch {
    // The run stays replayable even when transcript persistence fails.
  }
}

function finish(
  run: RunState,
  outcome: InboxZeroTerminalResult["outcome"],
  content: string,
): void {
  if (reachedTerminal(run)) return;
  run.status = outcome;
  emit(run, `run.${outcome}`, { content: content.slice(0, 8_000), actions: run.actions.length });
  publishTerminal(run, { outcome, content });
  const timer = setTimeout(() => runs.delete(run.runId), RETENTION_MS);
  timer.unref?.();
}

/**
 * A tool call, phrased for someone reading the card.
 *
 * Inbox Zero's tool names are already close to English (`archiveThread`,
 * `draftEmail`), so this splits the camel case rather than maintaining a
 * translation table that would silently fall behind upstream's tool set.
 */
function describeTool(toolName: string, input: unknown): InboxZeroAction {
  const words = toolName
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
  const argument = summarizeToolValue(input);
  return {
    tool: toolName,
    detail: argument ? `${words} — ${argument.slice(0, 300)}` : words,
    at: new Date().toISOString(),
  };
}

export interface StartRunInput {
  userId: number;
  /** Runtime identity. Present only inside the disposable worker. */
  runtimeJobId?: string;
  /** Durable per-conversation upstream id minted by the authenticated facade. */
  runtimeChatId?: string;
  task: string;
  /** Ties follow-up turns to the same Inbox Zero conversation. */
  conversationKey?: string;
  preferredEmail?: string;
  /** False restricts the turn to reading and drafting. See `instruction`. */
  allowActions: boolean;
  chatmockBaseUrl: string;
  chatmockApiKey: string;
  model: string;
  conversationPublicId?: string;
  /** The chat this was launched from, so a request can refer back to it. */
  conversationContext?: string;
}


export function startRun(input: StartRunInput): InboxZeroRunSummary {
  const run: RunState = {
    runId: input.runtimeJobId ?? randomUUID(),
    userId: input.userId,
    task: input.task,
    status: "queued",
    stage: "connecting",
    sequence: 0,
    events: [],
    startedAt: Date.now(),
    mailbox: null,
    parts: new Map(),
    partOrder: [],
    answerChars: 0,
    actions: [],
    abort: new AbortController(),
    aborted: false,
  };
  runs.set(run.runId, run);
  emit(run, "run.started", { task: run.task });
  void execute(run, input);
  return summary(run);
}

async function execute(run: RunState, input: StartRunInput): Promise<void> {
  const timeout = setTimeout(() => {
    if (!reachedTerminal(run)) {
      run.abort.abort();
      finish(run, "failed", "Inbox Zero did not answer in time.");
    }
  }, RUN_TIMEOUT_MS);
  timeout.unref?.();

  try {
    const scope = {
      userId: run.userId,
      runId: run.runId,
      ...(input.conversationPublicId
        ? { conversationPublicId: input.conversationPublicId }
        : {}),
    };
    await withInboxZeroStackLease(scope, "active-mailbox-run", async () => {
      if (run.aborted) return;
      run.status = "running";
      emit(run, "run.connecting", {});
      const ready = await ensureInboxZeroReady(
        scope,
        {
          chatmockBaseUrl: input.chatmockBaseUrl,
          chatmockApiKey: input.chatmockApiKey,
          model: input.model,
          ...(input.preferredEmail ? { preferredEmail: input.preferredEmail } : {}),
        },
        run.abort.signal,
      );
      if (!ready.ok || !ready.session) {
        emit(run, "run.setup_required", { ...ready.setup });
        finish(run, "failed", setupMessage(ready.setup));
        return;
      }
      if (run.aborted) {
        finish(run, "aborted", "Stopped before it reached the mailbox.");
        return;
      }
      if (!ready.baseUrl) throw new Error("Inbox Zero did not return its sealed endpoint.");

      run.mailbox = ready.session.identity.email;
      emit(run, "run.connected", { mailbox: run.mailbox });
      setStage(run, "working");

      // Scope the upstream conversation again at the owner boundary. A caller
      // accidentally reusing a chat-session key can never join another user's
      // mailbox context.
      const key = `${run.userId}:${input.conversationKey ?? run.runId}`;
      const chatId = input.runtimeChatId ?? chats.get(key) ?? newChatId();
      if (!input.runtimeChatId) {
        chats.delete(key);
        chats.set(key, chatId);
        while (chats.size > MAX_CHAT_CONTEXTS) {
          const oldest = chats.keys().next().value;
          if (oldest === undefined) break;
          chats.delete(oldest);
        }
      }

      let streamError: string | null = null;
      await runAssistantTurn(
        {
          config: { baseUrl: ready.baseUrl },
          session: ready.session,
          chatId,
          message: promptWithContext(
            instruction(run.task, input.allowActions),
            input.conversationContext,
          ),
          signal: run.abort.signal,
        },
        {
          onText: (partId, delta) => {
            const boundedDelta = delta.slice(0, Math.max(0, MAX_ANSWER_CHARS - run.answerChars));
            if (!boundedDelta) return;
            if (!run.parts.has(partId)) {
              run.parts.set(partId, "");
              run.partOrder.push(partId);
            }
            run.answerChars += boundedDelta.length;
            run.parts.set(partId, `${run.parts.get(partId) ?? ""}${boundedDelta}`);
            setStage(run, "answering");
            emit(run, "run.text", { partId, delta: boundedDelta });
          },
          onToolCall: (toolName, toolInput) => {
            if (run.actions.length >= MAX_ACTIONS) return;
            const action = describeTool(toolName, toolInput);
            run.actions.push(action);
            setStage(run, "working");
            emit(run, "run.action", { ...action });
          },
          onToolResult: (toolName, output) => {
            emit(run, "run.action_result", {
              tool: toolName,
              summary: summarizeToolValue(output).slice(0, 400),
            });
          },
          onError: (message) => {
            streamError = message.slice(0, 600);
            emit(run, "run.error", { message: streamError });
          },
        },
      );

      if (run.aborted) {
        finish(run, "aborted", answerText(run) || "Stopped.");
        return;
      }
      const answer = answerText(run);
      if (streamError && !answer) {
        finish(run, "failed", streamError);
        return;
      }
      finish(
        run,
        "completed",
        answer || "Inbox Zero finished the turn without writing an answer.",
      );
    });
  } catch (error) {
    if (run.aborted) {
      finish(run, "aborted", answerText(run) || "Stopped.");
      return;
    }
    finish(run, "failed", failureMessage(error));
  } finally {
    clearTimeout(timeout);
  }
}

/** The setup state, written as the next thing to do rather than as a code. */
function setupMessage(setup: SetupStatus): string {
  return setup.url ? `${setup.message}\n\nOpen ${setup.url} to finish.` : setup.message;
}

function failureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("inbox_zero_chat_failed_403")) {
    return "Inbox Zero refused the request for that mailbox. Check that it is still connected.";
  }
  if (message.startsWith("inbox_zero_chat_failed_401")) {
    return "Inbox Zero rejected the session. Reconnect it from its settings.";
  }
  if (message.startsWith("inbox_zero_chat_failed")) {
    return `Inbox Zero returned an error: ${message.replace(/^inbox_zero_chat_failed_/, "HTTP ")}`;
  }
  return message.slice(0, 600);
}

export function getRun(userId: number, runId: string): InboxZeroRunSummary {
  return summary(requireRun(userId, runId));
}

export function getEventsSince(
  userId: number,
  runId: string,
  since: number,
): InboxZeroEvent[] {
  return requireRun(userId, runId).events.filter(
    (event) => event.sequenceNumber > since,
  );
}

export function isTerminal(userId: number, runId: string): boolean {
  return reachedTerminal(requireRun(userId, runId));
}

export function abortRun(userId: number, runId: string): InboxZeroRunSummary {
  const run = requireRun(userId, runId);
  if (!reachedTerminal(run)) {
    run.aborted = true;
    run.abort.abort();
    finish(run, "aborted", answerText(run) || "Stopped.");
  }
  return summary(run);
}

/**
 * Register the handler that writes the run's result into the transcript. If the
 * run already finished — a fast turn can beat the caller here — the handler is
 * invoked immediately rather than never.
 */
export function onTerminal(
  userId: number,
  runId: string,
  handler: (result: InboxZeroTerminalResult) => void,
): void {
  const run = requireRun(userId, runId);
  run.terminalHandler = handler;
  if (run.terminalResult) handler(run.terminalResult);
}

/** Worker-only entrypoint selected by the fixed Runtime adapter. */
export function startRuntimeWorkerRun(
  input: StartRunInput & { runtimeJobId: string; runtimeChatId: string },
): InboxZeroRunSummary {
  if (
    !/^[A-Za-z0-9_-]{1,128}$/u.test(input.runtimeJobId) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      input.runtimeChatId,
    )
  ) {
    throw new Error("Inbox Zero Runtime identity is invalid.");
  }
  return startRun(input);
}

export const getRuntimeWorkerEventsSince = getEventsSince;
export const isRuntimeWorkerTerminal = isTerminal;
export const abortRuntimeWorkerRun = abortRun;
