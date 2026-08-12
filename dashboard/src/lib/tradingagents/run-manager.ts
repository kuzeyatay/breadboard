// In-memory run manager for the TradingAgents agent.
//
// Unlike the other ChatMock-driven agents, Breadboard does not drive a tool loop
// here: the cloned framework owns the whole multi-agent graph, and there is no
// point in reimplementing it. Breadboard starts the bridge (scripts/
// tradingagents-bridge.py) inside the clone's environment, points the framework
// at ChatMock through its `openai_compatible` provider, and turns the bridge's
// NDJSON into the same event stream the other agents publish.
//
// Runs are ephemeral: events live here and the SSE route replays them. The
// finished report is persisted with the chat turn, and the framework writes its
// own markdown tree under the results directory.

import { randomUUID } from "node:crypto";
import { type ChildProcess, spawn } from "node:child_process";
import { chatmockApiKeyValue } from "../agent-browser/provider.ts";
import { credentialEnv } from "./credentials.ts";
import {
  tradingAgentsRunLabel,
  type TradingAgentsRequest,
} from "./identity.ts";
import {
  bridgeScriptPath,
  invalidateHealth,
  resolveTradingAgentsRoot,
  tradingAgentsEnv,
  venvPython,
} from "./runtime.ts";
import { dataVendorsFor, type TradingAgentsSettings } from "./settings.ts";

export interface TradingAgentsEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

type RunStatus = "queued" | "running" | "completed" | "failed" | "aborted";

interface ReportSection {
  section: string;
  label: string;
  content: string;
}

interface RunState {
  runId: string;
  userId: number;
  request: TradingAgentsRequest;
  status: RunStatus;
  sequence: number;
  events: TradingAgentsEvent[];
  child: ChildProcess | null;
  aborted: boolean;
  sections: Map<string, ReportSection>;
  createdAt: number;
}

const globalRuns = globalThis as typeof globalThis & {
  __breadboardTradingAgentsRuns?: Map<string, RunState>;
};
const runs = globalRuns.__breadboardTradingAgentsRuns ?? new Map<string, RunState>();
globalRuns.__breadboardTradingAgentsRuns = runs;

const MAX_EVENTS = 5_000;
const MAX_SECTION_CHARS = 120_000;
const MAX_REPORT_CHARS = 400_000;
const RETENTION_MS = 30 * 60 * 1000;
// A four-analyst run with three debate rounds is genuinely long: dozens of
// model calls and a vendor fetch behind most of them.
const RUN_TIMEOUT_MS = 90 * 60 * 1000;

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
 * The markdown that becomes the assistant's message. The card streams the same
 * sections live, but this is what survives a reload, so it carries the whole
 * report rather than a summary of it.
 */
export function composeReport(
  request: TradingAgentsRequest,
  rating: string,
  sections: ReportSection[],
): string {
  const parts: string[] = [];
  parts.push(`# ${request.ticker} — ${request.tradeDate}`);
  if (rating) parts.push(`**Rating: ${rating}**`);
  parts.push(
    `_Analysed by TradingAgents with ${request.analysts.length} analyst${
      request.analysts.length === 1 ? "" : "s"
    }, ${request.researchDepth} research round${request.researchDepth === 1 ? "" : "s"} and ${
      request.riskRounds
    } risk round${request.riskRounds === 1 ? "" : "s"}. Research output, not financial advice._`,
  );
  for (const section of sections) {
    parts.push(`## ${section.label}\n\n${section.content.trim()}`);
  }
  return parts.join("\n\n").slice(0, MAX_REPORT_CHARS);
}

export interface StartRunInput {
  userId: number;
  request: TradingAgentsRequest;
  settings: TradingAgentsSettings;
  /** The chat's model, used for any role the settings leave on "follow chat". */
  model: string;
  reasoningEffort: string;
  /** ChatMock's OpenAI-compatible base URL, already resolved for this request. */
  baseUrl: string;
}

export function startRun(input: StartRunInput): { runId: string; status: RunStatus } {
  const runtime = resolveTradingAgentsRoot();
  if (!runtime) throw new Error("The tradingagents clone was not found next to the dashboard.");
  const python = venvPython(runtime.root);
  if (!python) {
    throw new Error(
      "Trading Agent has no Python environment yet. Build its environment from its settings first.",
    );
  }
  const bridge = bridgeScriptPath();
  if (!bridge) throw new Error("Breadboard's Trading Agent bridge script is missing.");

  const runId = `tarun_${randomUUID().replaceAll("-", "")}`;
  const run: RunState = {
    runId,
    userId: input.userId,
    request: input.request,
    status: "queued",
    sequence: 0,
    events: [],
    child: null,
    aborted: false,
    sections: new Map(),
    createdAt: Date.now(),
  };
  runs.set(runId, run);

  try {
    drive(run, input, { python, bridge, root: runtime.root });
  } catch (error) {
    run.status = "failed";
    emit(run, "run.failed", {
      error: error instanceof Error ? error.message : "The analysis could not start.",
      elapsedSec: 0,
    });
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
    ticker: run.request.ticker,
    tradeDate: run.request.tradeDate,
    analysts: run.request.analysts,
    assetType: run.request.assetType,
    researchDepth: run.request.researchDepth,
    riskRounds: run.request.riskRounds,
    backendUrl: input.baseUrl.replace(/\/$/, ""),
    // "Follow the chat" is the default for both roles; a pinned model in
    // settings wins for that role only.
    deepModel: input.settings.deepModel || input.model,
    quickModel: input.settings.quickModel || input.model,
    reasoningEffort: input.settings.reasoningEffort || input.reasoningEffort || "",
    outputLanguage: input.settings.outputLanguage,
    dataVendors: dataVendorsFor(input.settings),
  };

  const child = spawn(paths.python, [paths.bridge], {
    cwd: paths.root,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: tradingAgentsEnv({
      TRADINGAGENTS_CLONE_ROOT: paths.root,
      // The framework's generic OpenAI-compatible provider reads this; ChatMock
      // ignores the value but the SDK refuses to start without one.
      OPENAI_COMPATIBLE_API_KEY: chatmockApiKeyValue(),
      ...credentialEnv(),
    }),
  });
  run.child = child;
  run.status = "running";
  emit(run, "run.started", {
    label: tradingAgentsRunLabel(run.request),
    ticker: run.request.ticker,
    tradeDate: run.request.tradeDate,
    analysts: run.request.analysts,
    researchDepth: run.request.researchDepth,
    riskRounds: run.request.riskRounds,
    deepModel: job.deepModel,
    quickModel: job.quickModel,
  });

  const timer = setTimeout(() => {
    if (["completed", "failed", "aborted"].includes(run.status)) return;
    run.aborted = true;
    try {
      child.kill();
    } catch {
      // Already gone.
    }
    finish(run, "failed", { error: "The analysis ran past its time limit and was stopped." });
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
    finish(run, "failed", { error: `The analysis could not start: ${error.message}` });
  });

  child.on("exit", (code) => {
    clearTimeout(timer);
    run.child = null;
    if (["completed", "failed", "aborted"].includes(run.status)) return;
    if (run.aborted) return;
    // The bridge reports its own failures as events; reaching here means it died
    // without saying why, so the stderr tail is the only explanation available.
    const detail = stderrTail.split(/\r?\n/).filter(Boolean).slice(-6).join("\n");
    finish(run, "failed", {
      error:
        code === 0
          ? "The analysis ended without producing a decision."
          : `The analysis stopped unexpectedly (exit ${code ?? "unknown"}).`,
      detail,
    });
  });

  try {
    child.stdin?.write(`${JSON.stringify(job)}\n`);
    child.stdin?.end();
  } catch (error) {
    finish(run, "failed", {
      error: error instanceof Error ? error.message : "The analysis request could not be sent.",
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
    emit(run, "graph.started", {
      deepModel: text(event.deepModel),
      quickModel: text(event.quickModel),
    });
    return;
  }

  if (type === "stage") {
    emit(run, "stage.updated", {
      stage: text(event.stage),
      status: text(event.status, "pending"),
      label: text(event.label),
    });
    return;
  }

  if (type === "report") {
    const section = text(event.section);
    const content = text(event.content).slice(0, MAX_SECTION_CHARS);
    if (!section || !content) return;
    run.sections.set(section, { section, label: text(event.label, section), content });
    emit(run, "report.section", {
      section,
      label: text(event.label, section),
      characters: content.length,
    });
    return;
  }

  if (type === "tools") {
    emit(run, "agent.usage", {
      llmCalls: count(event.llmCalls),
      toolCalls: count(event.calls),
      inputTokens: count(event.promptTokens),
      outputTokens: count(event.completionTokens),
    });
    return;
  }

  if (type === "completed") {
    // The completed event carries the merged final state, which is the
    // authority: a section can arrive empty mid-stream and be filled in later.
    const sections = Array.isArray(event.sections) ? event.sections : [];
    for (const item of sections) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const section = text(record.section);
      const content = text(record.content).slice(0, MAX_SECTION_CHARS);
      if (section && content) {
        run.sections.set(section, { section, label: text(record.label, section), content });
      }
    }
    const rating = text(event.rating);
    finish(run, "completed", {
      rating,
      reportPath: text(event.reportPath),
      summary: composeReport(run.request, rating, [...run.sections.values()]),
      llmCalls: count(event.llmCalls),
      toolCalls: count(event.toolCalls),
      inputTokens: count(event.promptTokens),
      outputTokens: count(event.completionTokens),
    });
    return;
  }

  if (type === "failed") {
    finish(run, "failed", {
      error: text(event.error, "The analysis failed."),
      detail: text(event.detail).split(/\r?\n/).slice(-8).join("\n"),
    });
  }
}

function finish(run: RunState, status: RunStatus, payload: Record<string, unknown>): void {
  if (["completed", "failed", "aborted"].includes(run.status)) return;
  run.status = status;
  emit(run, status === "completed" ? "run.completed" : "run.failed", {
    ...payload,
    elapsedSec: (Date.now() - run.createdAt) / 1_000,
  });
  // A finished run may have installed cache files the health probe reports on.
  invalidateHealth();
  scheduleCleanup(run);
}

function scheduleCleanup(run: RunState): void {
  const timer = setTimeout(() => runs.delete(run.runId), RETENTION_MS);
  timer.unref?.();
}

export function getEventsSince(userId: number, runId: string, since = 0): TradingAgentsEvent[] {
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
    // Whatever landed before the stop is still worth keeping.
    summary: run.sections.size
      ? composeReport(run.request, "", [...run.sections.values()])
      : "The analysis was stopped before any section finished.",
    elapsedSec: (Date.now() - run.createdAt) / 1_000,
  });
  scheduleCleanup(run);
  return true;
}
