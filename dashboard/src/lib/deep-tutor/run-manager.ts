// In-memory run manager for the Deep Tutor agent.
//
// Breadboard does not drive a tool loop here: the cloned DeepTutor owns the
// whole tutoring runtime — capabilities, the agent loop, the three memory
// layers, session state — and there is no point in reimplementing it. What
// Breadboard owns is everything the clone cannot know by itself: which model to
// answer on (the chat's), which material is in scope (the surface's), and which
// tutoring session this conversation belongs to.
//
// Runs are ephemeral: events live here and the SSE route replays them. The
// answer is persisted with the chat turn; the tutor's own memory and session
// history persist inside its home, which is what makes a second question a
// continuation rather than a fresh start.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { type ChildProcess, spawn } from "node:child_process";
import { chatmockApiKeyValue } from "../agent-browser/provider.ts";
import {
  TUTOR_CAPABILITY_LABELS,
  tutorRunLabel,
  type TutorRequest,
} from "./identity.ts";
import { provisionHome } from "./home.ts";
import { ensureIndex, knowledgeBaseForTurn, type IndexState } from "./knowledge-base.ts";
import { resolveScope, selectEagerMaterial, type ScopeInput, type TutorScope } from "./materials.ts";
import {
  bridgeScriptPath,
  deepTutorEnv,
  invalidateHealth,
  resolveDeepTutorRoot,
  venvPython,
} from "./runtime.ts";

export interface DeepTutorEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

type RunStatus = "queued" | "running" | "completed" | "failed" | "aborted";

interface RunState {
  runId: string;
  userId: number;
  request: TutorRequest;
  scope: TutorScope;
  status: RunStatus;
  sequence: number;
  events: DeepTutorEvent[];
  child: ChildProcess | null;
  aborted: boolean;
  /** Settled answer blocks, in the order the tutor produced them. */
  blocks: string[];
  home: string;
  /** The knowledge base this turn ran with, remembered with the session. */
  knowledgeBase: string;
  createdAt: number;
}

const globalRuns = globalThis as typeof globalThis & {
  __breadboardDeepTutorRuns?: Map<string, RunState>;
};
const runs = globalRuns.__breadboardDeepTutorRuns ?? new Map<string, RunState>();
globalRuns.__breadboardDeepTutorRuns = runs;

const MAX_EVENTS = 4_000;
const MAX_BLOCK_CHARS = 200_000;
const MAX_ANSWER_CHARS = 400_000;
const RETENTION_MS = 30 * 60 * 1000;
// A mastery path or a deep-research turn is genuinely long: many model calls,
// each of them a relayed upstream request.
const RUN_TIMEOUT_MS = 45 * 60 * 1000;

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

// --- session continuity ----------------------------------------------------

/**
 * The DeepTutor session this scope's conversation runs in.
 *
 * Stored in the tutoring home rather than in memory: a tutor that forgets the
 * thread every time the dev server restarts is not the product. One id per
 * home, because a home already *is* one learner in one scope.
 */
function sessionPointerFile(home: string): string {
  return path.join(home, "breadboard-session.json");
}

interface SessionPointer {
  sessionId: string;
  /**
   * The knowledge base the session was last told about. A session that started
   * before the index finished building has never heard that retrieval exists,
   * so the note is repeated exactly once — when this changes — rather than on
   * every turn or only on the first.
   */
  knowledgeBase: string;
}

function readSessionPointer(home: string): SessionPointer {
  try {
    const parsed = JSON.parse(fs.readFileSync(sessionPointerFile(home), "utf8")) as {
      sessionId?: unknown;
      knowledgeBase?: unknown;
    };
    return {
      sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : "",
      knowledgeBase: typeof parsed.knowledgeBase === "string" ? parsed.knowledgeBase : "",
    };
  } catch {
    return { sessionId: "", knowledgeBase: "" };
  }
}

function writeSessionPointer(home: string, pointer: SessionPointer): void {
  try {
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(
      sessionPointerFile(home),
      `${JSON.stringify({ ...pointer, updatedAt: new Date().toISOString() }, null, 2)}\n`,
      "utf8",
    );
  } catch {
    // Losing the pointer costs continuity, not the answer.
  }
}

function clearSessionId(home: string): void {
  try {
    fs.rmSync(sessionPointerFile(home), { force: true });
  } catch {
    // Nothing to clear.
  }
}

// --- the run ---------------------------------------------------------------

export interface StartRunInput {
  userId: number;
  request: TutorRequest;
  scope: ScopeInput;
  /** The chat's model — the tutor answers on the same one. */
  model: string;
  reasoningEffort: string;
  /** ChatMock's OpenAI-compatible base URL, already resolved for this request. */
  baseUrl: string;
}

export function startRun(input: StartRunInput): { runId: string; status: RunStatus } {
  const runtime = resolveDeepTutorRoot();
  if (!runtime) throw new Error("The DeepTutor clone was not found next to the dashboard.");
  const python = venvPython(runtime.root);
  if (!python) {
    throw new Error(
      "Deep Tutor has no Python environment yet. Build its environment from its settings first.",
    );
  }
  const bridge = bridgeScriptPath();
  if (!bridge) throw new Error("Breadboard's Deep Tutor bridge script is missing.");

  const scope = resolveScope(input.scope);
  const provisioned = provisionHome({
    userId: input.userId,
    scope,
    baseUrl: input.baseUrl,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    apiKey: chatmockApiKeyValue(),
    language: input.request.language,
  });

  const runId = `dtrun_${randomUUID().replaceAll("-", "")}`;
  const run: RunState = {
    runId,
    userId: input.userId,
    request: input.request,
    scope,
    status: "queued",
    sequence: 0,
    events: [],
    child: null,
    aborted: false,
    blocks: [],
    home: provisioned.home,
    knowledgeBase: "",
    createdAt: Date.now(),
  };
  runs.set(runId, run);

  try {
    drive(run, input, {
      python,
      bridge,
      root: runtime.root,
      materialsMounted: provisioned.materialsMounted,
    });
  } catch (error) {
    run.status = "failed";
    emit(run, "run.failed", {
      error: error instanceof Error ? error.message : "The tutoring turn could not start.",
      elapsedSec: 0,
    });
    scheduleCleanup(run);
  }
  return { runId, status: run.status === "failed" ? "failed" : "queued" };
}

function drive(
  run: RunState,
  input: StartRunInput,
  paths: { python: string; bridge: string; root: string; materialsMounted: boolean },
): void {
  if (run.request.fresh) clearSessionId(run.home);
  const pointer = readSessionPointer(run.home);
  const sessionId = pointer.sessionId;

  // Retrieval, when the Garden's index is genuinely current. A missing or
  // out-of-date index starts rebuilding here and is not waited for: this turn
  // answers from the file tools, and the next one gets `rag`.
  const knowledgeBase = run.request.useMaterial
    ? knowledgeBaseForTurn(run.userId, run.scope)
    : null;
  const index = run.request.useMaterial
    ? ensureIndex(run.userId, run.scope).state
    : null;

  // Eager attachments are how a turn is grounded before the first model call.
  // With retrieval available the tutor can fetch what it needs itself, so the
  // opening load shrinks to a couple of anchors instead of a dozen files.
  const attachments = run.request.useMaterial
    ? selectEagerMaterial(run.scope, run.request.message, knowledgeBase ? { maxFiles: 3 } : {})
    : [];

  run.knowledgeBase = knowledgeBase ?? "";

  const job = {
    home: run.home,
    capability: run.request.capability,
    message: composeMessage(run, {
      continuing: Boolean(sessionId),
      attachments,
      // Announce retrieval only when this session has not heard about it.
      knowledgeBase:
        knowledgeBase && knowledgeBase !== pointer.knowledgeBase ? knowledgeBase : null,
    }),
    sessionId,
    tools: run.request.tools,
    knowledgeBases: knowledgeBase ? [knowledgeBase] : [],
    language: run.request.language,
    config: capabilityConfig(run.request),
    attachments: attachments.map((item) => ({
      path: item.path,
      filename: item.filename,
      mimeType: item.mimeType,
    })),
    skills: [] as string[],
  };

  const child = spawn(paths.python, [paths.bridge], {
    cwd: paths.root,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: deepTutorEnv({
      DEEPTUTOR_CLONE_ROOT: paths.root,
      DEEPTUTOR_HOME: run.home,
    }),
  });
  run.child = child;
  run.status = "running";
  emit(run, "run.started", {
    label: tutorRunLabel(run.request),
    capability: run.request.capability,
    capabilityLabel: TUTOR_CAPABILITY_LABELS[run.request.capability],
    model: input.model,
    scopeKind: run.scope.kind,
    scopeLabel: run.scope.label,
    continuing: Boolean(sessionId),
  });
  emit(run, "materials.resolved", {
    scopeKind: run.scope.kind,
    scopeLabel: run.scope.label,
    rootCount: run.scope.roots.length,
    browsable: paths.materialsMounted,
    attached: attachments.map((item) => item.filename),
    ...indexPayload(index, knowledgeBase),
  });

  const timer = setTimeout(() => {
    if (["completed", "failed", "aborted"].includes(run.status)) return;
    run.aborted = true;
    try {
      child.kill();
    } catch {
      // Already gone.
    }
    finish(run, "failed", { error: "The tutoring turn ran past its time limit and was stopped." });
  }, RUN_TIMEOUT_MS);
  timer.unref?.();

  let stdoutBuffer = "";
  let stderrTail = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdoutBuffer += chunk;
    let newline = stdoutBuffer.indexOf("\n");
    while (newline >= 0) {
      const line = stdoutBuffer.slice(0, newline).trim();
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      if (line) handleBridgeLine(run, line);
      newline = stdoutBuffer.indexOf("\n");
    }
    // A single event should never be this long; if it is, the stream is not
    // NDJSON and holding on to it only grows memory.
    if (stdoutBuffer.length > 4_000_000) stdoutBuffer = "";
  });
  child.stderr?.on("data", (chunk: string) => {
    stderrTail = `${stderrTail}${chunk}`.slice(-8_000);
  });

  child.on("error", (error) => {
    clearTimeout(timer);
    if (run.aborted) return;
    finish(run, "failed", { error: `The tutoring turn could not start: ${error.message}` });
  });

  child.on("exit", (code) => {
    clearTimeout(timer);
    run.child = null;
    if (["completed", "failed", "aborted"].includes(run.status)) return;
    if (run.aborted) return;
    // The bridge reports its own failures as events; reaching here means it
    // died without saying why, so the stderr tail is the only explanation.
    const detail = stderrTail.split(/\r?\n/).filter(Boolean).slice(-6).join("\n");
    finish(run, "failed", {
      error:
        code === 0
          ? "The tutoring turn ended without an answer."
          : `The tutoring turn stopped unexpectedly (exit ${code ?? "unknown"}).`,
      detail,
    });
  });

  try {
    child.stdin?.write(`${JSON.stringify(job)}\n`);
    child.stdin?.end();
  } catch (error) {
    finish(run, "failed", {
      error: error instanceof Error ? error.message : "The tutoring request could not be sent.",
    });
  }
}

/** How the index is reported to the card, in the card's own vocabulary. */
function indexPayload(
  index: IndexState | null,
  knowledgeBase: string | null,
): Record<string, unknown> {
  if (!index) return { retrieval: "off" };
  if (knowledgeBase) {
    return {
      retrieval: "ready",
      indexedDocuments: index.documentCount,
      indexedChunks: index.chunkCount,
    };
  }
  if (index.phase === "unsupported") return { retrieval: "unsupported" };
  if (index.phase === "building") return { retrieval: "building" };
  if (index.phase === "failed") return { retrieval: "failed", indexError: index.error };
  return { retrieval: index.phase === "stale" ? "stale" : "missing" };
}

/**
 * What the tutor is actually asked.
 *
 * The scope preamble goes in once per tutoring session, not once per turn:
 * DeepTutor keeps the session's messages, so repeating "here is what you may
 * read" every time would pay for the same paragraph on every round of every
 * later turn. The attachment note is per-turn because the attachments are.
 */
function composeMessage(
  run: RunState,
  context: {
    continuing: boolean;
    attachments: Array<{ filename: string }>;
    knowledgeBase: string | null;
  },
): string {
  const notes: string[] = [];
  if (!context.continuing) notes.push(run.scope.summary);
  if (context.knowledgeBase) {
    // Said once per session: the retrieval tool is mounted for the whole
    // conversation, and a model that knows it can search by meaning stops
    // trying to guess which note a topic lives in.
    notes.push(
      `Everything in ${run.scope.label} is also indexed for search by meaning — use the rag tool to pull the passages that bear on a question.`,
    );
  }
  if (context.attachments.length) {
    const names = context.attachments.map((item) => item.filename).join(", ");
    notes.push(
      `Attached because they look relevant: ${names}. There is more where those came from — search the rest before assuming something is missing.`,
    );
  }
  if (!notes.length) return run.request.message;

  // The question goes first, and the standing context after it. DeepTutor runs
  // an automatic retrieval over the *whole* user message before the model gets
  // a turn, so a preamble on top makes the opening query mostly boilerplate —
  // which is exactly the query that decides what the first answer is grounded
  // in. Ordering it this way keeps the learner's own words at the front.
  return `${run.request.message}\n\n---\n\n${notes.join("\n\n")}`;
}

/** Per-capability config the clone validates against its request contracts. */
function capabilityConfig(request: TutorRequest): Record<string, unknown> {
  if (request.capability === "deep_question") {
    return { num_questions: request.questionCount };
  }
  return {};
}

/** Translate one bridge event into the run's own event stream. */
function handleBridgeLine(run: RunState, line: string): void {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return; // Not an event — library chatter that reached stdout.
  }
  const type = text(event.type);

  if (type === "started") {
    const sessionId = text(event.sessionId);
    if (sessionId) {
      writeSessionPointer(run.home, {
        sessionId,
        knowledgeBase: run.knowledgeBase,
      });
    }
    emit(run, "turn.started", { sessionId, turnId: text(event.turnId) });
    return;
  }

  if (type === "stage") {
    emit(run, "tutor.stage", {
      stage: text(event.stage),
      state: text(event.state, "start"),
      label: text(event.label),
    });
    return;
  }

  if (type === "thinking") {
    // Persisted as activity so a reopened transcript still shows the tutor
    // reasoned, even though the draft itself is never forwarded.
    emit(run, "reasoning.completed", { text: "Thinking through the next step." });
    return;
  }

  if (type === "tool") {
    const tool = text(event.tool, "tool");
    const status = text(event.status, "completed");
    if (status === "running") {
      emit(run, "tool.started", { tool, title: text(event.title) });
      return;
    }
    emit(run, "tool.completed", {
      tool,
      status,
      title: text(event.title),
      summary: text(event.summary),
    });
    return;
  }

  if (type === "block") {
    const body = text(event.text).slice(0, MAX_BLOCK_CHARS);
    if (!body.trim()) return;
    const role = text(event.role, "text");
    if (role !== "narration") run.blocks.push(body);
    emit(run, "block.settled", { role, text: body });
    return;
  }

  if (type === "note") {
    emit(run, "tutor.note", { text: text(event.text) });
    return;
  }

  if (type === "sources") {
    const sources = Array.isArray(event.sources) ? event.sources : [];
    if (sources.length) emit(run, "sources.found", { sources });
    return;
  }

  if (type === "ask") {
    emit(run, "tutor.asked", {
      // The bridge already answered empty on the learner's behalf; showing the
      // question explains an answer that suddenly hedges.
      questions: Array.isArray(event.questions) ? event.questions.slice(0, 6) : [],
    });
    return;
  }

  if (type === "usage") {
    emit(run, "agent.usage", {
      rounds: count(event.rounds),
      toolSteps: count(event.toolSteps),
      totalTokens: count(event.totalTokens),
      inputTokens: count(event.inputTokens),
      outputTokens: count(event.outputTokens),
      costUsd: count(event.costUsd),
    });
    return;
  }

  if (type === "completed") {
    const answer = text(event.answer) || composeAnswer(run);
    if (text(event.status) === "failed") {
      // The error event already said why. Keep whatever was written first.
      finish(run, "failed", {
        error: "The tutoring turn failed before it finished answering.",
        summary: answer,
      });
      return;
    }
    finish(run, "completed", { summary: answer || "The tutor finished without an answer." });
    return;
  }

  if (type === "failed") {
    finish(run, "failed", {
      error: text(event.error, "The tutoring turn failed."),
      detail: text(event.detail).split(/\r?\n/).slice(-8).join("\n"),
      summary: composeAnswer(run),
    });
  }
}

/** Whatever the tutor managed to say, for a run that ended before `completed`. */
export function composeAnswer(run: { blocks: string[] }): string {
  return run.blocks.join("\n\n").slice(0, MAX_ANSWER_CHARS);
}

function finish(run: RunState, status: RunStatus, payload: Record<string, unknown>): void {
  if (["completed", "failed", "aborted"].includes(run.status)) return;
  run.status = status;
  emit(run, status === "completed" ? "run.completed" : "run.failed", {
    ...payload,
    elapsedSec: (Date.now() - run.createdAt) / 1_000,
  });
  // A finished run may have built caches the health probe reports on.
  invalidateHealth();
  scheduleCleanup(run);
}

function scheduleCleanup(run: RunState): void {
  const timer = setTimeout(() => runs.delete(run.runId), RETENTION_MS);
  timer.unref?.();
}

export function getEventsSince(userId: number, runId: string, since = 0): DeepTutorEvent[] {
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
  try {
    run.child?.kill();
  } catch {
    // It may have exited between the state check and the kill.
  }
  run.child = null;
  emit(run, "run.aborted", {
    // Whatever the tutor said before the stop is still worth keeping.
    summary: composeAnswer(run) || "The tutoring turn was stopped before an answer.",
    elapsedSec: (Date.now() - run.createdAt) / 1_000,
  });
  scheduleCleanup(run);
  return true;
}
