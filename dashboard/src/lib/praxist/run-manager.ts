import path from "node:path";
import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import {
  resolvePraxistTaskProject,
  runPraxistCli,
  runtimeReadiness,
} from "./runtime.ts";

export interface PraxistEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

type RunStatus = "queued" | "running" | "completed" | "failed" | "aborted";

interface RunState {
  runId: string;
  userId: number;
  taskPath: string;
  workspace: string;
  runDir: string;
  stateDir: string;
  status: RunStatus;
  sequence: number;
  events: PraxistEvent[];
  abortController: AbortController;
  aborted: boolean;
  praxistRunId: string | null;
  lastProgress: string;
  createdAt: number;
}

const globalRuns = globalThis as typeof globalThis & {
  __breadboardPraxistRuns?: Map<string, RunState>;
};
const runs = globalRuns.__breadboardPraxistRuns ?? new Map<string, RunState>();
globalRuns.__breadboardPraxistRuns = runs;

const MAX_EVENTS = 5_000;
const RETENTION_MS = 10 * 60 * 1_000;
const POLL_MS = 1_000;

function emit(run: RunState, type: string, payload: Record<string, unknown> = {}): void {
  run.sequence += 1;
  run.events.push({ sequenceNumber: run.sequence, type, payload, at: new Date().toISOString() });
  if (run.events.length > MAX_EVENTS) run.events.splice(0, run.events.length - MAX_EVENTS);
}

function requireRun(userId: number, runId: string): RunState {
  const run = runs.get(runId);
  if (!run || run.userId !== userId) throw new Error("run_not_found");
  return run;
}

function scheduleCleanup(run: RunState): void {
  const timer = setTimeout(() => runs.delete(run.runId), RETENTION_MS);
  timer.unref?.();
}

function finish(run: RunState, status: RunStatus, payload: Record<string, unknown>): void {
  if (["completed", "failed", "aborted"].includes(run.status)) return;
  run.status = status;
  emit(run, status === "completed" ? "run.completed" : status === "aborted" ? "run.aborted" : "run.failed", {
    ...payload,
    taskPath: run.taskPath,
    runDir: run.runDir,
    elapsedSec: (Date.now() - run.createdAt) / 1_000,
  });
  scheduleCleanup(run);
}

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed = JSON.parse(await readFile(/* turbopackIgnore: true */ file, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function summaryMarkdown(summary: Record<string, unknown>, runDir: string): string {
  const findings = object(summary.finding_summary);
  const accepted = numberValue(findings.accepted) ?? numberValue(summary.findings_total);
  const generations = numberValue(summary.generations_completed);
  const maximum = numberValue(summary.max_generations);
  const duration = numberValue(summary.total_duration_seconds);
  const lines = [
    "## Praxist research run",
    "",
    `- Status: ${String(summary.status ?? "completed")}`,
    `- Task: ${String(summary.task_name ?? summary.task_id ?? "prepared task project")}`,
  ];
  if (generations !== null) {
    lines.push(`- Generations: ${generations}${maximum === null ? "" : ` / ${maximum}`}`);
  }
  if (accepted !== null) lines.push(`- Accepted findings: ${accepted}`);
  if (duration !== null) lines.push(`- Duration: ${Math.round(duration)} seconds`);
  if (summary.exit_condition) lines.push(`- Exit condition: ${String(summary.exit_condition)}`);
  const frontier = object(summary.frontier_summary);
  const frontierText = typeof frontier.summary === "string"
    ? frontier.summary.trim()
    : typeof summary.summary === "string"
      ? summary.summary.trim()
      : "";
  if (frontierText) lines.push("", frontierText.slice(0, 30_000));
  lines.push("", `Artifacts: \`${runDir}\``);
  return lines.join("\n");
}

function progressPayload(status: Record<string, unknown>): Record<string, unknown> {
  return {
    phase: status.phase ?? status.status ?? "researching",
    generation: status.current_generation ?? status.generation ?? null,
    maxGenerations: status.max_generations ?? null,
    findings: status.findings_total ?? object(status.finding_summary).accepted ?? null,
    peers: status.active_peers ?? status.peers_active ?? null,
    exitCondition: status.exit_condition ?? null,
  };
}

async function publishArtifacts(run: RunState): Promise<void> {
  const candidates = [
    "run_summary.json",
    "run_report.md",
    "orchestrator_status.final.json",
    "frontier.jsonl",
    "findings.jsonl",
  ];
  const present = new Set(await readdir(/* turbopackIgnore: true */ run.runDir).catch(() => []));
  for (const name of candidates) {
    if (!present.has(name)) continue;
    const artifactPath = path.join(run.runDir, name);
    const metadata = await stat(/* turbopackIgnore: true */ artifactPath).catch(() => null);
    if (!metadata?.isFile()) continue;
    emit(run, "artifact.ready", {
      artifact: { name, path: artifactPath, sizeBytes: metadata.size },
    });
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function drive(run: RunState, input: RuntimeWorkerStartInput): Promise<void> {
  const readiness = runtimeReadiness();
  if (!readiness.available || !readiness.runtime) {
    throw new Error(`${readiness.reason ?? "Praxist is unavailable"} Setup: ${readiness.setupCommand}`);
  }
  const runtime = readiness.runtime;
  await mkdir(run.workspace, { recursive: true });
  await mkdir(run.stateDir, { recursive: true });
  emit(run, "run.started", { taskPath: run.taskPath, model: input.model });
  emit(run, "praxist.starting", { phase: "validating task project" });
  run.status = "running";

  const environment = {
    OPENAI_API_KEY: input.apiKey,
    OPENAI_BASE_URL: input.baseUrl,
    PRAXIST_STATE_DIR: run.stateDir,
  };
  const launched = await runPraxistCli(runtime, [
    "start",
    "--task-path", run.taskPath,
    "--run-dir", run.runDir,
    "--agent-system", "codex_sdk",
    "--runtime", "agent_runtime:codex_sdk",
    "--model-provider", "model_provider:openai_compatible",
    "--model", input.model,
    "--startup-timeout", "45",
    "--json",
  ], { env: environment, timeoutMs: 60_000, signal: run.abortController.signal });
  if (run.aborted) return;
  if (launched.code !== 0) {
    throw new Error((launched.stderr || launched.stdout || "Praxist could not start.").trim());
  }
  const entry = (() => {
    const start = launched.stdout.indexOf("{");
    if (start < 0) return null;
    try { return JSON.parse(launched.stdout.slice(start)) as Record<string, unknown>; }
    catch { return null; }
  })();
  if (!entry || typeof entry.run_id !== "string" || typeof entry.pid !== "number") {
    throw new Error("Praxist returned an invalid start receipt.");
  }
  run.praxistRunId = entry.run_id;
  emit(run, "praxist.launched", {
    phase: object(entry.extra).startup_state ?? entry.state ?? "running",
    praxistRunId: entry.run_id,
    pid: entry.pid,
    runDir: run.runDir,
  });

  while (!run.aborted) {
    const summary = await readJson(path.join(run.runDir, "run_summary.json"));
    if (summary) {
      await publishArtifacts(run);
      const successful = summary.status === "succeeded" || summary.exit_code === 0;
      if (successful) {
        finish(run, "completed", {
          summary: summaryMarkdown(summary, run.runDir),
          praxistRunId: run.praxistRunId,
          generations: summary.generations_completed ?? null,
          findings: object(summary.finding_summary).accepted ?? summary.findings_total ?? null,
        });
      } else {
        finish(run, "failed", {
          error: String(summary.error_message ?? summary.error ?? summary.exit_condition ?? "Praxist research failed."),
          summary: summaryMarkdown(summary, run.runDir),
          praxistRunId: run.praxistRunId,
        });
      }
      return;
    }
    const status = await readJson(path.join(run.runDir, "orchestrator_status.json"));
    if (status) {
      const payload = progressPayload(status);
      const fingerprint = JSON.stringify(payload);
      if (fingerprint !== run.lastProgress) {
        run.lastProgress = fingerprint;
        emit(run, "praxist.progress", payload);
      }
    }
    if (Date.now() - run.createdAt > 60_000 && !processAlive(entry.pid)) {
      const logFile = typeof entry.log_file === "string" ? entry.log_file : "";
      const log = logFile ? await readFile(/* turbopackIgnore: true */ logFile, "utf8").catch(() => "") : "";
      throw new Error(log.trim().slice(-8_000) || "The Praxist process exited without a run summary.");
    }
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, POLL_MS);
      timer.unref?.();
    });
  }
}

export interface StartRunInput {
  userId: number;
  requestId?: string;
  taskPath: string;
  model: string;
  baseUrl: string;
}

interface RuntimeWorkerStartInput extends StartRunInput {
  runtimeJobId: string;
  runtimeWorkspacePath: string;
  apiKey: string;
}

export function startRuntimeWorkerRun(input: RuntimeWorkerStartInput): { runId: string; status: RunStatus } {
  if (
    !/^[A-Za-z0-9_-]{1,128}$/u.test(input.runtimeJobId) ||
    !path.isAbsolute(input.runtimeWorkspacePath) ||
    !input.apiKey ||
    Buffer.byteLength(input.apiKey, "utf8") > 4_096 ||
    /[\u0000\r\n]/u.test(input.apiKey)
  ) throw new Error("The Praxist Runtime worker input is invalid.");
  const taskPath = resolvePraxistTaskProject(input.taskPath);
  const workspace = path.resolve(input.runtimeWorkspacePath);
  const run: RunState = {
    runId: input.runtimeJobId,
    userId: input.userId,
    taskPath,
    workspace,
    runDir: path.join(workspace, "research-run"),
    stateDir: path.join(workspace, "praxist-state"),
    status: "queued",
    sequence: 0,
    events: [],
    abortController: new AbortController(),
    aborted: false,
    praxistRunId: null,
    lastProgress: "",
    createdAt: Date.now(),
  };
  runs.set(run.runId, run);
  void drive(run, input).catch((error: unknown) => {
    if (!run.aborted) finish(run, "failed", {
      error: error instanceof Error ? error.message : "The Praxist run failed.",
    });
  });
  return { runId: run.runId, status: "queued" };
}

export function getRuntimeWorkerEventsSince(userId: number, runId: string, since = 0): PraxistEvent[] {
  return requireRun(userId, runId).events.filter((event) => event.sequenceNumber > since);
}

export function isRuntimeWorkerTerminal(userId: number, runId: string): boolean {
  return ["completed", "failed", "aborted"].includes(requireRun(userId, runId).status);
}

export async function abortRuntimeWorkerRun(userId: number, runId: string): Promise<boolean> {
  const run = requireRun(userId, runId);
  if (["completed", "failed", "aborted"].includes(run.status)) return false;
  run.aborted = true;
  run.abortController.abort(new DOMException("Praxist stopped", "AbortError"));
  const readiness = runtimeReadiness();
  if (readiness.runtime && run.praxistRunId) {
    await runPraxistCli(readiness.runtime, ["stop", run.praxistRunId], {
      env: { PRAXIST_STATE_DIR: run.stateDir },
      timeoutMs: 20_000,
    }).catch(() => undefined);
  }
  finish(run, "aborted", { summary: "Praxist research stopped.", praxistRunId: run.praxistRunId });
  return true;
}

export async function startRun(input: StartRunInput): Promise<{ runId: string; status: RunStatus }> {
  const { startOuterAgentRun } = await import("../runtime-v2/outer-agent-run.ts");
  return startOuterAgentRun({
    kind: "praxist",
    userId: input.userId,
    requestId: input.requestId,
    requestPayload: {
      taskPath: resolvePraxistTaskProject(input.taskPath),
      model: input.model,
      baseUrl: input.baseUrl,
    },
  }) as Promise<{ runId: string; status: RunStatus }>;
}

export async function getEventsSince(userId: number, runId: string, since = 0): Promise<PraxistEvent[]> {
  const { readOuterAgentRunView } = await import("../runtime-v2/outer-agent-run.ts");
  return (await readOuterAgentRunView("praxist", userId, runId, since)).events as PraxistEvent[];
}

export async function isTerminal(userId: number, runId: string): Promise<boolean> {
  const { readOuterAgentRunView } = await import("../runtime-v2/outer-agent-run.ts");
  return (await readOuterAgentRunView("praxist", userId, runId, 0)).terminal;
}

export async function abortRun(userId: number, runId: string): Promise<boolean> {
  const { abortOuterAgentRun } = await import("../runtime-v2/outer-agent-run.ts");
  return abortOuterAgentRun("praxist", userId, runId);
}
