// In-memory orchestration for Formsmith's local ShapeR process. The event log
// is ephemeral; the GLB is imported into Breadboard before completion and is
// therefore durable across refreshes and restarts.

import { randomUUID } from "node:crypto";
import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  closeFormsmithArtifactContext,
  discardFormsmithWorkspace,
  openFormsmithArtifactContext,
  publishFormsmithMesh,
  type FormsmithArtifactContext,
} from "./artifact.ts";
import { formsmithRunLabel, type FormsmithRequest } from "./identity.ts";
import {
  resolveShapeRRoot,
  shapeRBridgePath,
  shapeREnv,
  shapeRPython,
  shapeRWorkspaceRoot,
} from "./runtime.ts";
import { resolveFormsmithUpload } from "./uploads.ts";

export interface FormsmithRunEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

type RunStatus = "queued" | "running" | "completed" | "failed" | "aborted";

interface RunState {
  runId: string;
  userId: number;
  request: FormsmithRequest;
  label: string;
  status: RunStatus;
  sequence: number;
  events: FormsmithRunEvent[];
  child: ChildProcess | null;
  aborted: boolean;
  workspace: string;
  context: FormsmithArtifactContext | null;
  createdAt: number;
}

const globals = globalThis as typeof globalThis & {
  __breadboardFormsmithRuns?: Map<string, RunState>;
};
const runs = globals.__breadboardFormsmithRuns ?? new Map<string, RunState>();
globals.__breadboardFormsmithRuns = runs;

const MAX_EVENTS = 500;
const RETENTION_MS = 30 * 60 * 1000;
const RUN_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const TERMINAL = new Set<RunStatus>(["completed", "failed", "aborted"]);

function emit(run: RunState, type: string, payload: Record<string, unknown> = {}): void {
  run.sequence += 1;
  run.events.push({
    sequenceNumber: run.sequence,
    type,
    payload,
    at: new Date().toISOString(),
  });
  if (run.events.length > MAX_EVENTS) run.events.splice(0, run.events.length - MAX_EVENTS);
}

function requireRun(userId: number, runId: string): RunState {
  const run = runs.get(runId);
  if (!run || run.userId !== userId) throw new Error("run_not_found");
  return run;
}

function activeRun(): RunState | null {
  return [...runs.values()].find((run) => !TERMINAL.has(run.status)) ?? null;
}

export function startFormsmithRun(input: {
  userId: number;
  conversationPublicId: string;
  request: FormsmithRequest;
}): { runId: string; status: RunStatus } {
  // ShapeR keeps several large models resident on one CUDA device. A second
  // simultaneous process is much more likely to OOM than to finish faster.
  if (activeRun()) throw new Error("Formsmith is already reconstructing another picture.");

  const runtime = resolveShapeRRoot();
  if (!runtime) throw new Error("The ShapeR checkout was not found next to Breadboard.");
  const python = shapeRPython(runtime.root);
  if (!python) {
    throw new Error("ShapeR's Python 3.10 environment is not ready. Follow ShapeR/INSTALL.md or set SHAPER_PYTHON.");
  }
  const bridge = shapeRBridgePath();
  if (!bridge) throw new Error("Breadboard's ShapeR bridge is missing.");
  const source = resolveFormsmithUpload(input.userId, input.request.uploadId);
  if (!source) throw new Error("That uploaded picture is no longer available. Choose it again.");

  const runId = `fmsrun_${randomUUID().replaceAll("-", "")}`;
  const workspace = path.join(shapeRWorkspaceRoot(), `run_${runId}`);
  fs.mkdirSync(workspace, { recursive: true });
  const run: RunState = {
    runId,
    userId: input.userId,
    request: input.request,
    label: formsmithRunLabel(input.request),
    status: "queued",
    sequence: 0,
    events: [],
    child: null,
    aborted: false,
    workspace,
    context: null,
    createdAt: Date.now(),
  };
  runs.set(runId, run);
  run.context = openFormsmithArtifactContext({
    userId: input.userId,
    conversationPublicId: input.conversationPublicId,
    label: run.label,
    agentRunId: runId,
  });

  try {
    drive(run, { python, bridge, root: runtime.root, source });
  } catch (error) {
    fail(run, error instanceof Error ? error.message : "The reconstruction could not start.");
  }
  return { runId, status: run.status === "failed" ? "failed" : "queued" };
}

function captionFromFilename(filename: string): string {
  const label = path.basename(filename, path.extname(filename)).replace(/[-_]+/g, " ").trim();
  return /[a-z]{3}/i.test(label) && !/^img\s*\d+$/i.test(label)
    ? `a detailed 3D object: ${label}`
    : "a detailed 3D object";
}

function drive(
  run: RunState,
  paths: { python: string; bridge: string; root: string; source: string },
): void {
  const child = spawn(paths.python, [paths.bridge], {
    cwd: paths.root,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: shapeREnv(paths.root),
  });
  run.child = child;
  run.status = "running";
  emit(run, "run.started", { label: run.label, filename: run.request.filename });

  const timer = setTimeout(() => {
    if (TERMINAL.has(run.status)) return;
    run.aborted = true;
    try { child.kill(); } catch { /* already exited */ }
    fail(run, "The reconstruction passed its two-hour limit and was stopped.");
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
    if (stdoutBuffer.length > 1_000_000) stdoutBuffer = "";
  });
  child.stderr?.on("data", (chunk: string) => {
    stderrTail = `${stderrTail}${chunk}`.slice(-12_000);
  });
  child.on("error", (error) => {
    clearTimeout(timer);
    if (!run.aborted) fail(run, `ShapeR could not start: ${error.message}`);
  });
  child.on("exit", (code) => {
    clearTimeout(timer);
    run.child = null;
    if (TERMINAL.has(run.status) || run.aborted) return;
    const detail = stderrTail.split(/\r?\n/).filter(Boolean).slice(-8).join("\n");
    fail(run, code === 0
      ? "ShapeR finished without returning a 3D model."
      : `ShapeR stopped unexpectedly (exit ${code ?? "unknown"}).${detail ? `\n${detail}` : ""}`);
  });

  child.stdin?.end(`${JSON.stringify({
    source: paths.source,
    workspace: run.workspace,
    shaperRoot: paths.root,
    preset: "speed",
    caption: captionFromFilename(run.request.filename),
  })}\n`);
}

function handleBridgeLine(run: RunState, line: string): void {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return;
  }
  const type = typeof event.event === "string" ? event.event : "";
  if (type === "stage.started" || type === "stage.completed") {
    emit(run, "stage.updated", {
      stage: typeof event.stage === "string" ? event.stage : "reconstruct",
      status: type === "stage.started" ? "running" : "completed",
    });
    return;
  }
  if (type === "result" && typeof event.mesh === "string") {
    complete(run, event.mesh, Number(event.sizeBytes) || 0);
    return;
  }
  if (type === "error") {
    fail(run, typeof event.message === "string" ? event.message : "ShapeR could not reconstruct the picture.");
  }
}

function complete(run: RunState, meshPath: string, sizeBytes: number): void {
  if (TERMINAL.has(run.status)) return;
  let artifactId: string | null = null;
  let artifactError: string | null = null;
  if (run.context) {
    try {
      artifactId = publishFormsmithMesh({
        context: run.context,
        workspace: run.workspace,
        meshPath,
        sourceFilename: run.request.filename,
      }).id;
    } catch (error) {
      artifactError = error instanceof Error ? error.message : "The GLB could not be attached.";
    }
  } else {
    artifactError = "This conversation had no artifact session, so the GLB could not be attached.";
  }
  closeFormsmithArtifactContext(run.context, "completed");
  run.context = null;
  discardFormsmithWorkspace(run.workspace);
  run.status = "completed";
  emit(run, "run.completed", {
    summary: artifactId
      ? `Formsmith reconstructed **${run.request.filename}** as a 3D model with ShapeR. The GLB is attached below.`
      : `ShapeR reconstructed **${run.request.filename}**, but Breadboard could not attach the GLB.${artifactError ? ` ${artifactError}` : ""}`,
    artifactId,
    sizeBytes,
    elapsedSec: (Date.now() - run.createdAt) / 1_000,
  });
  scheduleCleanup(run);
}

function fail(run: RunState, error: string): void {
  if (TERMINAL.has(run.status)) return;
  run.status = "failed";
  closeFormsmithArtifactContext(run.context, "failed");
  run.context = null;
  discardFormsmithWorkspace(run.workspace);
  emit(run, "run.failed", {
    error,
    elapsedSec: (Date.now() - run.createdAt) / 1_000,
  });
  scheduleCleanup(run);
}

function scheduleCleanup(run: RunState): void {
  const timer = setTimeout(() => runs.delete(run.runId), RETENTION_MS);
  timer.unref?.();
}

export function getFormsmithEventsSince(
  userId: number,
  runId: string,
  since = 0,
): FormsmithRunEvent[] {
  return requireRun(userId, runId).events.filter((event) => event.sequenceNumber > since);
}

export function isFormsmithTerminal(userId: number, runId: string): boolean {
  return TERMINAL.has(requireRun(userId, runId).status);
}

export function abortFormsmithRun(userId: number, runId: string): boolean {
  const run = requireRun(userId, runId);
  if (TERMINAL.has(run.status)) return false;
  run.aborted = true;
  run.status = "aborted";
  try { run.child?.kill(); } catch { /* already exited */ }
  run.child = null;
  closeFormsmithArtifactContext(run.context, "aborted");
  run.context = null;
  discardFormsmithWorkspace(run.workspace);
  emit(run, "run.aborted", {
    summary: "Formsmith stopped before the 3D reconstruction finished.",
    elapsedSec: (Date.now() - run.createdAt) / 1_000,
  });
  scheduleCleanup(run);
  return true;
}
