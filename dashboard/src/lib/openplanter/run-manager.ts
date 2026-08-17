import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { promptWithContext } from "../conversations/agent-context.ts";

export interface OpenPlanterEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

type RunStatus = "queued" | "running" | "completed" | "failed" | "aborted";

interface ArtifactRecord {
  id: string;
  name: string;
  path: string;
  kind: string;
  size: number;
  preview: string;
}

interface RunState {
  runId: string;
  userId: number;
  task: string;
  workspace: string;
  status: RunStatus;
  sequence: number;
  events: OpenPlanterEvent[];
  child: ChildProcess | null;
  stderr: string;
  artifacts: Map<string, ArtifactRecord>;
}

const globalRuns = globalThis as typeof globalThis & {
  __breadboardOpenPlanterRuns?: Map<string, RunState>;
};
const runs = globalRuns.__breadboardOpenPlanterRuns ?? new Map<string, RunState>();
globalRuns.__breadboardOpenPlanterRuns = runs;

const MAX_EVENTS = 5_000;
const MAX_STDERR = 24_000;
const RUN_ROOT = path.join(os.tmpdir(), "breadboard-openplanter");

function resolveOpenPlanterRoot(env: NodeJS.ProcessEnv = process.env): string | null {
  const candidates = [
    env.OPENPLANTER_ROOT?.trim(),
    path.resolve(process.cwd(), "OpenPlanter"),
    path.resolve(process.cwd(), "..", "OpenPlanter"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => existsSync(path.join(candidate, "agent", "runtime.py"))) ?? null;
}

function pythonCommand(env: NodeJS.ProcessEnv = process.env): string {
  return env.OPENPLANTER_PYTHON?.trim() || (process.platform === "win32" ? "python" : "python3");
}

function runnerPath(): string {
  return path.resolve(process.cwd(), "scripts", "openplanter-chatmock-runner.py");
}

export function runtimeAvailability(env: NodeJS.ProcessEnv = process.env): {
  available: boolean;
  reason?: string;
  installed: boolean;
} {
  const root = resolveOpenPlanterRoot(env);
  if (!root) return { available: false, installed: false, reason: "OpenPlanter clone was not found" };
  if (!existsSync(runnerPath())) {
    return { available: false, installed: true, reason: "OpenPlanter ChatMock bridge is missing" };
  }
  const probe = spawnSync(pythonCommand(env), ["--version"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 5_000,
  });
  if (probe.error || probe.status !== 0) {
    return { available: false, installed: true, reason: "Python 3 is unavailable" };
  }
  return { available: true, installed: true };
}

function emit(run: RunState, type: string, payload: Record<string, unknown> = {}): void {
  run.sequence += 1;
  const event: OpenPlanterEvent = {
    sequenceNumber: run.sequence,
    type,
    payload,
    at: new Date().toISOString(),
  };
  run.events.push(event);
  if (run.events.length > MAX_EVENTS) run.events.splice(0, run.events.length - MAX_EVENTS);
}

function requireRun(userId: number, runId: string): RunState {
  const run = runs.get(runId);
  if (!run || run.userId !== userId) throw new Error("run_not_found");
  return run;
}

function ingestArtifacts(run: RunState, payload: Record<string, unknown>): void {
  const artifacts = Array.isArray(payload.artifacts) ? payload.artifacts : [];
  for (const raw of artifacts) {
    if (!raw || typeof raw !== "object") continue;
    const artifact = raw as Partial<ArtifactRecord>;
    if (
      typeof artifact.id !== "string" ||
      typeof artifact.path !== "string" ||
      typeof artifact.name !== "string"
    ) continue;
    run.artifacts.set(artifact.id, {
      id: artifact.id,
      name: artifact.name,
      path: artifact.path,
      kind: typeof artifact.kind === "string" ? artifact.kind : "text",
      size: typeof artifact.size === "number" ? artifact.size : 0,
      preview: typeof artifact.preview === "string" ? artifact.preview : "",
    });
  }
}


export function startRun(input: {
  userId: number;
  task: string;
  model: string;
  reasoningEffort: string;
  baseUrl: string;
  apiKey: string;
  /**
   * The chat this was launched from. Reaches the runner as part of the
   * `--task` argument, so the route keeps it short: a command line has a
   * hard length limit on Windows and this shares it with every other flag.
   */
  conversationContext?: string;
}): { runId: string; status: RunStatus } {
  const availability = runtimeAvailability();
  const root = resolveOpenPlanterRoot();
  if (!availability.available || !root) throw new Error(availability.reason ?? "runtime_unavailable");

  const runId = `oprun_${randomUUID().replaceAll("-", "")}`;
  const workspace = path.join(RUN_ROOT, runId);
  const run: RunState = {
    runId,
    userId: input.userId,
    task: input.task,
    workspace,
    status: "queued",
    sequence: 0,
    events: [],
    child: null,
    stderr: "",
    artifacts: new Map(),
  };
  runs.set(runId, run);
  void mkdir(workspace, { recursive: true }).then(() => {
    if (run.status === "aborted") return;
    const child = spawn(
      pythonCommand(),
      [
        runnerPath(),
        "--openplanter-root",
        root,
        "--workspace",
        workspace,
        "--task",
        promptWithContext(input.task, input.conversationContext),
        "--model",
        input.model,
        "--base-url",
        input.baseUrl,
        "--api-key",
        input.apiKey,
        "--reasoning-effort",
        input.reasoningEffort,
      ],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    run.child = child;
    run.status = "running";
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      const lines = stdout.split(/\r?\n/);
      stdout = lines.pop() ?? "";
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as { type?: unknown; payload?: unknown };
          if (typeof parsed.type !== "string") continue;
          const payload =
            parsed.payload && typeof parsed.payload === "object" && !Array.isArray(parsed.payload)
              ? (parsed.payload as Record<string, unknown>)
              : {};
          if (parsed.type === "artifacts.updated" || parsed.type === "run.completed") {
            ingestArtifacts(run, payload);
          }
          if (parsed.type === "run.completed") run.status = "completed";
          if (parsed.type === "run.failed") run.status = "failed";
          emit(run, parsed.type, payload);
        } catch {
          // Dependency logs on stdout are deliberately ignored; only NDJSON is public.
        }
      }
    });
    child.stderr.on("data", (chunk: string) => {
      run.stderr = `${run.stderr}${chunk}`.slice(-MAX_STDERR);
    });
    child.on("error", (error) => {
      if (run.status === "aborted") return;
      run.status = "failed";
      emit(run, "run.failed", { error: error.message });
    });
    child.on("exit", (code) => {
      run.child = null;
      if (run.status === "aborted" || run.status === "completed" || run.status === "failed") return;
      run.status = code === 0 ? "completed" : "failed";
      emit(
        run,
        run.status === "completed" ? "run.completed" : "run.failed",
        run.status === "completed"
          ? { summary: "OpenPlanter completed." }
          : { error: run.stderr.trim().split(/\r?\n/).slice(-1)[0] || `OpenPlanter exited with code ${code}` },
      );
    });
  }).catch((error: unknown) => {
    run.status = "failed";
    emit(run, "run.failed", { error: error instanceof Error ? error.message : "workspace_error" });
  });
  return { runId, status: "queued" };
}

export function getEventsSince(userId: number, runId: string, since = 0): OpenPlanterEvent[] {
  return requireRun(userId, runId).events.filter((event) => event.sequenceNumber > since);
}

export function isTerminal(userId: number, runId: string): boolean {
  return ["completed", "failed", "aborted"].includes(requireRun(userId, runId).status);
}

export function abortRun(userId: number, runId: string): boolean {
  const run = requireRun(userId, runId);
  if (["completed", "failed", "aborted"].includes(run.status)) return false;
  run.status = "aborted";
  try {
    run.child?.kill();
  } catch {
    // It may have exited between the state check and kill.
  }
  emit(run, "run.aborted", { summary: "OpenPlanter investigation stopped." });
  return true;
}

export async function readArtifact(
  userId: number,
  runId: string,
  artifactId: string,
): Promise<{ record: ArtifactRecord; content: Buffer }> {
  const run = requireRun(userId, runId);
  const record = run.artifacts.get(artifactId);
  if (!record) throw new Error("artifact_not_found");
  const sessionRoot = path.resolve(run.workspace, ".openplanter", "sessions");
  const candidates = Array.from(run.events)
    .reverse()
    .map((event) => event.payload.sessionId)
    .filter((value): value is string => typeof value === "string");
  const sessionId = candidates[0] ?? "";
  const base = path.resolve(sessionRoot, sessionId);
  const target = path.resolve(base, record.path);
  if (!sessionId || (!target.startsWith(`${base}${path.sep}`) && target !== base)) {
    throw new Error("artifact_not_found");
  }
  return { record, content: await readFile(target) };
}
