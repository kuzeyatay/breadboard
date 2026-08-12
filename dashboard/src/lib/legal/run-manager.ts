// In-memory run manager for the Legal Agent.
//
// Breadboard does not drive the tool loop here: Harvey LAB's harness owns it,
// and reimplementing a loop that already exists would only guarantee the two
// drift apart. Breadboard starts `scripts/legal-bridge.py` inside the clone's
// environment, points the harness's OpenAI adapter at ChatMock, and turns the
// bridge's NDJSON into the same event stream every other agent publishes.
//
// Runs are ephemeral: events live here and the SSE route replays them from a
// cursor. What survives is the composed answer, saved with the chat turn, and
// the deliverables, saved as artifacts of the conversation that asked for them.

import { randomUUID } from "node:crypto";
import { type ChildProcess, spawn } from "node:child_process";
import { chatmockApiKeyValue } from "../agent-browser/provider.ts";
import type { ChatAttachment } from "../chat-attachments.ts";
import {
  closeLegalArtifactContext,
  openLegalArtifactContext,
  saveLegalArtifact,
  type LegalArtifactContext,
} from "./artifact.ts";
import { legalRunLabel, type LegalRequest } from "./identity.ts";
import {
  bridgeScriptPath,
  invalidateHealth,
  legalEnv,
  resolveLegalRoot,
  venvPython,
} from "./runtime.ts";
import type { LegalSettings } from "./settings.ts";
import {
  prepareWorkspace,
  readOutputFile,
  removeWorkspace,
  type LegalWorkspace,
} from "./workspace.ts";

export interface LegalEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

type RunStatus = "queued" | "running" | "completed" | "failed" | "aborted";

interface DeliverableRow {
  path: string;
  bytes: number;
  artifactId: string | null;
}

interface RunState {
  runId: string;
  userId: number;
  request: LegalRequest;
  workspace: LegalWorkspace;
  artifactContext: LegalArtifactContext | null;
  /** Set when the chat could not be resolved, so the run can say so. */
  artifactProblems: string[];
  status: RunStatus;
  sequence: number;
  events: LegalEvent[];
  child: ChildProcess | null;
  aborted: boolean;
  answer: string;
  deliverables: DeliverableRow[];
  createdAt: number;
}

const globalRuns = globalThis as typeof globalThis & {
  __breadboardLegalRuns?: Map<string, RunState>;
};
const runs = globalRuns.__breadboardLegalRuns ?? new Map<string, RunState>();
globalRuns.__breadboardLegalRuns = runs;

const MAX_EVENTS = 5_000;
const MAX_ANSWER_CHARS = 400_000;
const MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;
// A review of a full data room is genuinely long, and the workspace has to
// outlast a tab switch so a returning card can still download from it.
const RETENTION_MS = 60 * 60 * 1000;
const RUN_TIMEOUT_MS = 120 * 60 * 1000;

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

/**
 * The markdown that becomes the assistant's message. The card streams the
 * answer live, but this is what survives a reload, so it carries the whole
 * response rather than a summary of it — and names the deliverables, because a
 * memo the person cannot find is a memo that was not delivered.
 */
export function composeAnswer(
  answer: string,
  deliverables: readonly DeliverableRow[],
  problems: readonly string[],
): string {
  const parts: string[] = [];
  const body = answer.trim();
  if (body) parts.push(body);
  const kept = deliverables.filter((file) => file.artifactId);
  if (kept.length) {
    parts.push(
      `**Delivered:** ${kept.map((file) => file.path).join(", ")}`,
    );
  }
  for (const problem of problems) parts.push(`_${problem}_`);
  if (!parts.length) {
    parts.push("The Legal Agent finished without producing a response.");
  }
  return parts.join("\n\n").slice(0, MAX_ANSWER_CHARS);
}

export interface StartRunInput {
  userId: number;
  request: LegalRequest;
  settings: LegalSettings;
  attachments: readonly ChatAttachment[];
  /** The chat's model, used unless the request pins its own. */
  model: string;
  /** The chat's reasoning effort, used when the request follows the chat. */
  reasoningEffort: string;
  /** ChatMock's OpenAI-compatible base URL, already resolved for this request. */
  baseUrl: string;
  conversationPublicId: string;
  /**
   * Durable memory about the user, already selected and rendered by
   * `conversations/agent-memory-context.ts`. Empty when nothing qualified.
   * It reaches the harness as a system-prompt section, never as the assignment.
   */
  memoryContext: string;
}

export function startRun(input: StartRunInput): { runId: string; status: RunStatus } {
  const runtime = resolveLegalRoot();
  if (!runtime) throw new Error("The harvey-labs clone was not found next to the dashboard.");
  const python = venvPython(runtime.root);
  if (!python) {
    throw new Error(
      "The Legal Agent has no Python environment yet. Build its environment from its settings first.",
    );
  }
  const bridge = bridgeScriptPath();
  if (!bridge) throw new Error("Breadboard's legal bridge script is missing.");

  const runId = `legal_${randomUUID().replaceAll("-", "")}`;
  const workspace = prepareWorkspace({
    runId,
    userId: input.userId,
    attachments: input.attachments,
  });
  const artifactContext = input.conversationPublicId
    ? openLegalArtifactContext({
        userId: input.userId,
        conversationPublicId: input.conversationPublicId,
        task: input.request.task,
        agentRunId: runId,
      })
    : null;

  const run: RunState = {
    runId,
    userId: input.userId,
    request: input.request,
    workspace,
    artifactContext,
    artifactProblems: artifactContext
      ? []
      : [
          "This run's deliverables could not be filed against the chat, so they are only downloadable from the card below.",
        ],
    status: "queued",
    sequence: 0,
    events: [],
    child: null,
    aborted: false,
    answer: "",
    deliverables: [],
    createdAt: Date.now(),
  };
  runs.set(runId, run);

  for (const problem of workspace.skipped) run.artifactProblems.push(problem);

  try {
    drive(run, input, { python, bridge, root: runtime.root });
  } catch (error) {
    run.status = "failed";
    emit(run, "run.failed", {
      error: error instanceof Error ? error.message : "The assignment could not start.",
      elapsedSec: 0,
    });
    closeLegalArtifactContext(run.artifactContext, "failed");
    scheduleCleanup(run);
  }
  return { runId, status: run.status === "failed" ? "failed" : "queued" };
}

function drive(
  run: RunState,
  input: StartRunInput,
  paths: { python: string; bridge: string; root: string },
): void {
  const job = {
    task: run.request.task,
    cloneRoot: paths.root,
    workspaceDir: run.workspace.workspaceDir,
    documentsDir: run.workspace.documentsDir,
    outputDir: run.workspace.outputDir,
    model: input.model,
    // "Follow the chat" is the default; an effort pinned in settings or typed
    // as a flag wins for this run only.
    reasoningEffort: run.request.effort || input.reasoningEffort || "",
    baseUrl: input.baseUrl.replace(/\/$/, ""),
    apiKey: chatmockApiKeyValue(),
    maxTurns: run.request.maxTurns,
    shellTimeout: input.settings.shellTimeout,
    skills: run.request.skills,
    allowShell: run.request.allowShell,
    // Background about the user, if any survived selection. The bridge renders
    // it as its own system-prompt section so it can never read as the brief.
    userContext: input.memoryContext,
    // What was staged, so the assignment can name each original, say what is
    // in it, and say which ones can be rewritten in place rather than leaving
    // the agent to infer any of that from a directory listing.
    documents: run.workspace.staged.map((document) => ({
      filename: document.filename,
      extracted: document.extractedFilename,
      figures: document.figureFilenames,
      description: document.description,
      editable: document.editable,
    })),
  };

  const child = spawn(paths.python, [paths.bridge], {
    cwd: paths.root,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: legalEnv({ HARVEY_LABS_ROOT: paths.root }),
  });
  run.child = child;
  run.status = "running";
  emit(run, "run.started", {
    label: legalRunLabel(run.request),
    model: input.model,
    maxTurns: run.request.maxTurns,
    skills: run.request.skills,
    allowShell: run.request.allowShell,
    documents: run.workspace.documents,
  });

  const timer = setTimeout(() => {
    if (["completed", "failed", "aborted"].includes(run.status)) return;
    run.aborted = true;
    try {
      child.kill();
    } catch {
      // Already gone.
    }
    finish(run, "failed", { error: "The assignment ran past its time limit and was stopped." });
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
    finish(run, "failed", { error: `The assignment could not start: ${error.message}` });
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
          ? "The assignment ended without producing a response."
          : `The assignment stopped unexpectedly (exit ${code ?? "unknown"}).`,
      detail,
    });
  });

  try {
    child.stdin?.write(`${JSON.stringify(job)}\n`);
    child.stdin?.end();
  } catch (error) {
    finish(run, "failed", {
      error: error instanceof Error ? error.message : "The assignment could not be sent.",
    });
  }
}

/** Translate one bridge event into the run's own event stream. */
function handleBridgeLine(run: RunState, line: string): void {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return; // Not an event — library chatter on stdout.
  }
  const type = text(event.type);

  if (type === "started") {
    emit(run, "harness.started", {
      model: text(event.model),
      documentCount: count(event.documentCount),
      skills: Array.isArray(event.skills) ? event.skills : [],
      tools: Array.isArray(event.tools) ? event.tools : [],
      // Both degrade the run rather than stopping it, so the card says so
      // instead of the person wondering why a Word file read oddly.
      pandoc: event.pandoc === true,
      shell: event.shell === true,
    });
    return;
  }

  if (type === "turn") {
    emit(run, "turn.started", { turn: count(event.turn) });
    return;
  }

  if (type === "text") {
    const body = text(event.text);
    if (body) emit(run, "agent.text", { turn: count(event.turn), text: body });
    return;
  }

  if (type === "usage") {
    emit(run, "agent.usage", {
      inputTokens: count(event.inputTokens),
      outputTokens: count(event.outputTokens),
      turns: count(event.turns),
    });
    return;
  }

  if (type === "tool") {
    const phase = text(event.phase);
    emit(run, phase === "start" ? "step.started" : "step.completed", {
      callId: text(event.callId),
      tool: text(event.name, "tool"),
      status: text(event.status, "ok"),
      detail: text(event.detail),
    });
    return;
  }

  if (type === "completed") {
    run.answer = text(event.answer);
    const files = Array.isArray(event.files) ? event.files : [];
    storeDeliverables(run, files);
    finish(run, "completed", {
      summary: composeAnswer(run.answer, run.deliverables, run.artifactProblems),
      files: run.deliverables,
      turns: count(event.turns),
      inputTokens: count(event.inputTokens),
      outputTokens: count(event.outputTokens),
      finishedCleanly: event.finishedCleanly === true,
      contextOverflow: event.contextOverflow === true,
    });
    return;
  }

  if (type === "failed") {
    finish(run, "failed", {
      error: text(event.error, "The assignment failed."),
      detail: text(event.detail).split(/\r?\n/).slice(-8).join("\n"),
    });
  }
}

/** Move every produced file into the artifact store, then announce the set. */
function storeDeliverables(run: RunState, files: unknown[]): void {
  for (const entry of files) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const relativePath = text(record.path);
    if (!relativePath) continue;
    const bytes = count(record.bytes);
    const row: DeliverableRow = { path: relativePath, bytes, artifactId: null };
    run.deliverables.push(row);

    if (!run.artifactContext) continue;
    if (bytes > MAX_ARTIFACT_BYTES) {
      run.artifactProblems.push(`${relativePath} is too large to keep as an artifact.`);
      continue;
    }
    const buffer = readOutputFile(run.workspace.outputDir, relativePath);
    if (!buffer) {
      run.artifactProblems.push(`${relativePath} could not be read back.`);
      continue;
    }
    const stored = saveLegalArtifact({
      context: run.artifactContext,
      path: relativePath,
      bytes: buffer,
    });
    if (stored.ok) {
      row.artifactId = stored.artifact.id;
    } else {
      run.artifactProblems.push(stored.reason);
    }
  }
  if (run.deliverables.length) {
    emit(run, "artifacts", { files: run.deliverables });
  }
}

function finish(run: RunState, status: RunStatus, payload: Record<string, unknown>): void {
  if (["completed", "failed", "aborted"].includes(run.status)) return;
  run.status = status;
  emit(run, status === "completed" ? "run.completed" : "run.failed", {
    ...payload,
    artifactProblems: run.artifactProblems,
    elapsedSec: (Date.now() - run.createdAt) / 1_000,
  });
  closeLegalArtifactContext(run.artifactContext, status === "completed" ? "completed" : "failed");
  // A finished run may have built caches the health probe reports on.
  invalidateHealth();
  scheduleCleanup(run);
}

function scheduleCleanup(run: RunState): void {
  const timer = setTimeout(() => {
    runs.delete(run.runId);
    // The deliverables are artifacts by now; the scratch tree is not worth
    // keeping, and a data room's worth of extracted text is not small.
    removeWorkspace(run.workspace.root);
  }, RETENTION_MS);
  timer.unref?.();
}

export function getEventsSince(userId: number, runId: string, since = 0): LegalEvent[] {
  return requireRun(userId, runId).events.filter((event) => event.sequenceNumber > since);
}

export function isTerminal(userId: number, runId: string): boolean {
  return ["completed", "failed", "aborted"].includes(requireRun(userId, runId).status);
}

/** Read one deliverable back for the card's download link. */
export function readDeliverable(
  userId: number,
  runId: string,
  relativePath: string,
): { buffer: Buffer; filename: string } | null {
  const run = requireRun(userId, runId);
  const known = run.deliverables.find((file) => file.path === relativePath);
  if (!known) return null;
  const buffer = readOutputFile(run.workspace.outputDir, relativePath);
  if (!buffer) return null;
  return { buffer, filename: relativePath.split("/").filter(Boolean).pop() ?? "deliverable" };
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
  // Whatever was written before the stop is still work, so it is kept the same
  // way a completed run's output is.
  const partial = readPartialAnswer(run);
  if (partial) run.answer = partial;
  emit(run, "run.aborted", {
    summary: run.answer
      ? composeAnswer(run.answer, run.deliverables, run.artifactProblems)
      : "The assignment was stopped before anything was written.",
    artifactProblems: run.artifactProblems,
    elapsedSec: (Date.now() - run.createdAt) / 1_000,
  });
  closeLegalArtifactContext(run.artifactContext, "aborted");
  scheduleCleanup(run);
  return true;
}

/** `response.md` as it stood when the run was stopped, if it was started. */
function readPartialAnswer(run: RunState): string {
  const buffer = readOutputFile(run.workspace.outputDir, "response.md");
  return buffer ? buffer.toString("utf8").slice(0, MAX_ANSWER_CHARS).trim() : "";
}
