import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { ChatTokenUsage } from "../chat-token-usage.ts";
import { resource2SkillAvailability } from "./runtime.ts";
import type { Resource2SkillDomain } from "./identity.ts";
import {
  createWorkspace,
  scanArtifacts,
  type Resource2SkillArtifact,
} from "./workspace.ts";
import { promptWithContext } from "../conversations/agent-context.ts";

export interface Resource2SkillEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

export interface Resource2SkillTerminalResult {
  outcome: "completed" | "failed" | "aborted";
  content: string;
  usage?: ChatTokenUsage;
}

type RunStatus = "queued" | "running" | "completed" | "failed" | "aborted";

interface RunState {
  runId: string;
  userId: number;
  brief: string;
  domain: Resource2SkillDomain;
  status: RunStatus;
  sequence: number;
  events: Resource2SkillEvent[];
  child: ChildProcess | null;
  stderr: string;
  startedAt: number;
  artifacts: Resource2SkillArtifact[];
  summary: string;
  terminalResult?: Resource2SkillTerminalResult;
  terminalHandler?: (result: Resource2SkillTerminalResult) => void;
}

const stateGlobal = globalThis as typeof globalThis & { __breadboardResource2SkillRuns?: Map<string, RunState> };
const runs = stateGlobal.__breadboardResource2SkillRuns ?? new Map<string, RunState>();
stateGlobal.__breadboardResource2SkillRuns = runs;

function emit(run: RunState, type: string, payload: Record<string, unknown> = {}): void {
  run.events.push({ sequenceNumber: ++run.sequence, type, payload, at: new Date().toISOString() });
  if (run.events.length > 4_000) run.events.splice(0, run.events.length - 4_000);
}

function publish(run: RunState, result: Resource2SkillTerminalResult): void {
  if (run.terminalResult) return;
  run.terminalResult = result;
  try { run.terminalHandler?.(result); } catch { /* transcript persistence remains retryable */ }
}

function requireRun(userId: number, runId: string): RunState {
  const run = runs.get(runId);
  if (!run || run.userId !== userId) throw new Error("run_not_found");
  return run;
}

function refreshArtifacts(run: RunState): void {
  const next = scanArtifacts(run.runId);
  const current = new Map(run.artifacts.map((item) => [item.id, item.modifiedAt]));
  if (next.length === run.artifacts.length && next.every((item) => current.get(item.id) === item.modifiedAt)) return;
  run.artifacts = next;
  emit(run, "artifacts.updated", { artifacts: next });
}

function ingest(run: RunState, value: Record<string, unknown>): void {
  const event = typeof value.event === "string" ? value.event : "";
  if (!event) return;
  if (event === "run.started") {
    run.status = "running";
    emit(run, "run.started", { model: value.model, domain: run.domain });
    return;
  }
  if (event === "model.call") {
    emit(run, "stage.changed", { stage: "planning" });
    emit(run, "model.call", { model: value.model, reasoning: value.reasoning });
    return;
  }
  if (event === "tool.started") {
    emit(run, "stage.changed", { stage: "building" });
    emit(run, "tool.started", { tool: value.tool });
    return;
  }
  if (event === "tool.completed") {
    emit(run, "tool.completed", { tool: value.tool, status: value.status, summary: value.summary });
    refreshArtifacts(run);
    return;
  }
  if (event === "run.completed") {
    run.summary = typeof value.summary === "string" ? value.summary : "Resource2Skill completed the artifact.";
    return;
  }
  if (event === "run.failed") {
    run.summary = typeof value.error === "string" ? value.error : "Resource2Skill could not complete the artifact.";
  }
}

function finish(run: RunState, code: number | null): void {
  refreshArtifacts(run);
  const elapsedSec = (Date.now() - run.startedAt) / 1_000;
  if (code === 0) {
    const summary = run.summary || `Created ${run.artifacts.length} ${run.domain} output${run.artifacts.length === 1 ? "" : "s"}.`;
    run.status = "completed";
    emit(run, "run.completed", { summary, elapsedSec, domain: run.domain, artifacts: run.artifacts });
    publish(run, { outcome: "completed", content: summary });
    return;
  }
  const error = run.summary || run.stderr.trim().split(/\r?\n/).at(-1) || `Resource2Skill exited with ${code ?? "an unknown status"}.`;
  run.status = "failed";
  emit(run, "run.failed", { error, elapsedSec, domain: run.domain, artifacts: run.artifacts });
  publish(run, { outcome: "failed", content: error });
}

export function startRun(input: {
  userId: number;
  brief: string;
  task: string;
  domain: Resource2SkillDomain;
  model: string;
  reasoningEffort: string;
  maxIterations?: number;
  baseUrl: string;
  apiKey: string;
  /**
   * The chat this was launched from. Reaches the bridge inside the `--task`
   * argument, so the route keeps it short: a command line has a hard length
   * limit on Windows and this shares it with every other flag.
   */
  conversationContext?: string;
}): { runId: string; status: RunStatus } {
  const runtime = resource2SkillAvailability();
  if (!runtime.available || !runtime.root || !runtime.python) throw new Error(runtime.reason ?? "Resource2Skill is unavailable.");
  const runId = `r2srun_${randomUUID().replaceAll("-", "")}`;
  const run: RunState = {
    runId, userId: input.userId, brief: input.brief, domain: input.domain, status: "queued",
    sequence: 0, events: [], child: null, stderr: "", startedAt: Date.now(), artifacts: [], summary: "",
  };
  runs.set(runId, run);
  const workspace = createWorkspace({
    runId,
    userId: input.userId,
    brief: input.brief.slice(0, 20_000),
    domain: input.domain,
    createdAt: new Date().toISOString(),
  });
  const child = spawn(runtime.python, [
    runtime.bridge,
    "--root", runtime.root,
    "--workspace", workspace,
    "--domain", input.domain,
    "--task", promptWithContext(input.task, input.conversationContext),
    "--model", input.model,
    "--reasoning", input.reasoningEffort,
    "--max-iter", String(Math.max(1, Math.min(input.maxIterations ?? 60, 120))),
  ], {
    cwd: runtime.root,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CHATMOCK_BASE_URL: input.baseUrl, CHATMOCK_API_KEY: input.apiKey, CHATMOCK_MODEL: input.model, NO_COLOR: "1", PYTHONUNBUFFERED: "1" },
  });
  run.child = child;
  let stdout = "";
  child.stdout!.setEncoding("utf8");
  child.stderr!.setEncoding("utf8");
  child.stdout!.on("data", (chunk: string) => {
    stdout += chunk;
    const lines = stdout.split(/\r?\n/);
    stdout = lines.pop() ?? "";
    for (const line of lines) {
      try { ingest(run, JSON.parse(line) as Record<string, unknown>); } catch { /* ignore non-protocol output */ }
    }
  });
  child.stderr!.on("data", (chunk: string) => {
    run.stderr = `${run.stderr}${chunk}`.slice(-48_000);
    const line = chunk.trim().split(/\r?\n/).at(-1);
    if (line) emit(run, "log", { text: line.slice(0, 1_000) });
  });
  child.on("error", (error) => {
    if (run.status === "aborted") return;
    run.status = "failed";
    emit(run, "run.failed", { error: error.message });
    publish(run, { outcome: "failed", content: error.message });
  });
  child.on("exit", (code) => {
    run.child = null;
    if (run.status !== "aborted" && run.status !== "failed") finish(run, code);
    else if (run.status !== "aborted" && !run.terminalResult) finish(run, code);
  });
  return { runId, status: run.status };
}

export function getEventsSince(userId: number, runId: string, since = 0): Resource2SkillEvent[] {
  return requireRun(userId, runId).events.filter((event) => event.sequenceNumber > since);
}

export function isTerminal(userId: number, runId: string): boolean {
  return ["completed", "failed", "aborted"].includes(requireRun(userId, runId).status);
}

export function liveArtifacts(userId: number, runId: string): Resource2SkillArtifact[] | null {
  const run = runs.get(runId);
  return run?.userId === userId ? run.artifacts : null;
}

export function setRunTerminalHandler(userId: number, runId: string, handler: (result: Resource2SkillTerminalResult) => void): void {
  const run = requireRun(userId, runId);
  run.terminalHandler = handler;
  if (run.terminalResult) handler(run.terminalResult);
}

export function abortRun(userId: number, runId: string): boolean {
  const run = requireRun(userId, runId);
  if (["completed", "failed", "aborted"].includes(run.status)) return false;
  run.status = "aborted";
  try { run.child?.kill(); } catch { /* already exited */ }
  refreshArtifacts(run);
  const summary = "Resource2Skill run stopped.";
  emit(run, "run.aborted", { summary, artifacts: run.artifacts });
  publish(run, { outcome: "aborted", content: summary });
  return true;
}
