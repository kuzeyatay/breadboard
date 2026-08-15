// Ruflo hive-mind runs.
//
// A run has two phases, both owned by Breadboard so the process handling,
// streaming, and abort semantics match every other agent on the Agents page:
//
//   1. PLAN     — the Ruflo CLI spawns a queen-led hive in the Garden's
//                 repository and writes its coordination prompt to
//                 `.hive-mind/sessions/`. We run it with `--dry-run` so Ruflo
//                 never spawns Claude Code itself (its own launcher shells out
//                 through `which`, which does not exist on Windows).
//   2. EXECUTE  — Breadboard spawns Claude Code on that prompt with the Ruflo
//                 MCP server attached, so the queen actually has the
//                 `mcp__ruflo__*` coordination, memory, and consensus tools the
//                 prompt tells it to use. Claude Code's `stream-json` output is
//                 translated into the same event vocabulary the other inline
//                 run cards consume.

import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  resolveClaudeExecutable,
  resolveRufloLauncher,
  runtimeAvailability,
  type RufloLauncher,
} from "./runtime.ts";
import { finalizeRunSnapshot } from "../agent-edits/snapshot.ts";
import type { ChatMessageAttachment } from "../chat-attachments.ts";

export interface RufloEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

type RunStatus = "queued" | "planning" | "running" | "completed" | "failed" | "aborted";

export interface RufloSwarmPlan {
  swarmId: string;
  queenType: string;
  consensus: string;
  topology: string;
  workerCount: number;
  workerTypes: string[];
  promptFile: string;
}

interface RunState {
  runId: string;
  userId: number;
  objective: string;
  repositoryPath: string;
  repositoryName: string;
  gardenSlug: string;
  status: RunStatus;
  sequence: number;
  events: RufloEvent[];
  child: ChildProcess | null;
  stderr: string;
  output: string[];
  /** Claude Code's own final answer, preferred over the streamed text parts. */
  finalResult: string;
  startedAt: number;
  toolCount: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  plan: RufloSwarmPlan | null;
  cleanup: (() => void) | null;
}

const globalRuns = globalThis as typeof globalThis & {
  __breadboardRufloRuns?: Map<string, RunState>;
};
const runs = globalRuns.__breadboardRufloRuns ?? new Map<string, RunState>();
globalRuns.__breadboardRufloRuns = runs;

const MAX_EVENTS = 5_000;
const MAX_STDERR = 32_000;
const MAX_OUTPUT_PARTS = 200;
const MAX_PLAN_STDOUT = 200_000;
const PLAN_TIMEOUT_MS = 10 * 60_000;
const MAX_IMAGE_ATTACHMENTS = 4;
const MAX_IMAGE_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const DEFAULT_WORKER_COUNT = 6;
export const MIN_WORKER_COUNT = 1;
export const MAX_WORKER_COUNT = 12;

export const QUEEN_TYPES = ["strategic", "tactical", "adaptive"] as const;
export const CONSENSUS_STRATEGIES = [
  "byzantine",
  "raft",
  "gossip",
  "crdt",
  "quorum",
] as const;
export const TOPOLOGIES = [
  "hierarchical-mesh",
  "hierarchical",
  "mesh",
  "adaptive",
] as const;

const ANSI = /\[[0-9;]*[A-Za-z]/g;

export function stripAnsi(value: string): string {
  return value.replace(ANSI, "");
}

/** Ruflo prints its hive summary as a decorated list; read it back field by field. */
export function parseSwarmPlan(stdout: string): Omit<RufloSwarmPlan, "promptFile"> & {
  promptFile: string;
} {
  const clean = stripAnsi(stdout);
  const field = (label: string): string => {
    const match = new RegExp(`${label}:\\s*([^\\r\\n]+)`, "i").exec(clean);
    return match ? match[1].trim() : "";
  };
  const workerCount = Number.parseInt(field("Worker Count"), 10);
  const workerTypes = field("Worker Types")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const promptMatch =
    /(?:Hive Mind prompt saved to|Full prompt saved to|Prompt saved to):\s*([^\r\n]+)/i.exec(
      clean,
    );
  return {
    swarmId: field("Swarm ID") || "unknown",
    queenType: field("Queen Type") || "strategic",
    consensus: field("Consensus") || "byzantine",
    // `hive-mind spawn` does not echo the topology back; the caller supplies
    // the requested one rather than letting a default overwrite it.
    topology: field("Topology"),
    workerCount: Number.isFinite(workerCount) && workerCount > 0 ? workerCount : 0,
    workerTypes,
    promptFile: promptMatch ? promptMatch[1].trim() : "",
  };
}

export function clampWorkerCount(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;
  if (!Number.isFinite(parsed)) return DEFAULT_WORKER_COUNT;
  return Math.min(MAX_WORKER_COUNT, Math.max(MIN_WORKER_COUNT, Math.trunc(parsed)));
}

function pick<T extends string>(
  allowed: readonly T[],
  value: unknown,
  fallback: T,
): T {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return (allowed as readonly string[]).includes(normalized)
    ? (normalized as T)
    : fallback;
}

export type RufloImageAttachment = Extract<
  ChatMessageAttachment,
  { type: "image" }
>;

export function materializeRufloImageAttachments(
  repositoryPath: string,
  attachments: readonly RufloImageAttachment[],
): { paths: string[]; cleanup: () => void } {
  if (attachments.length === 0) {
    return { paths: [], cleanup: () => undefined };
  }

  const repositoryRoot = path.resolve(repositoryPath);
  const temporaryDirectory = mkdtempSync(
    path.join(repositoryRoot, ".breadboard-ruflo-"),
  );
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    const resolved = path.resolve(temporaryDirectory);
    const expectedPrefix = `${repositoryRoot}${path.sep}.breadboard-ruflo-`;
    if (resolved.startsWith(expectedPrefix)) {
      rmSync(resolved, { recursive: true, force: true });
    }
  };

  try {
    const paths = attachments
      .slice(0, MAX_IMAGE_ATTACHMENTS)
      .map((attachment, index) => {
        const match = attachment.dataUrl.match(
          /^data:image\/(png|jpeg|webp|gif);base64,([a-z0-9+/=\s]+)$/i,
        );
        if (!match) throw new Error("invalid_image_attachment");
        const bytes = Buffer.from(match[2].replace(/\s/g, ""), "base64");
        if (bytes.length === 0 || bytes.length > MAX_IMAGE_ATTACHMENT_BYTES) {
          throw new Error("image_attachment_too_large");
        }
        const extension =
          match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase();
        const filePath = path.join(
          temporaryDirectory,
          `screenshot-${index + 1}.${extension}`,
        );
        writeFileSync(filePath, bytes, { flag: "wx" });
        return filePath;
      });
    return { paths, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}

/** Add the materialized screenshots to the objective Ruflo gives its queen. */
export function rufloImageInstruction(
  repositoryPath: string,
  paths: readonly string[],
): string {
  if (paths.length === 0) return "";
  const relativePaths = paths.map((filePath) =>
    path.relative(repositoryPath, filePath),
  );
  return [
    "The user attached screenshot images for this task.",
    "Before making changes, use Claude Code's Read tool to inspect each image:",
    ...relativePaths.map((filePath) => `- ${filePath}`),
    "Treat these files as read-only run inputs. Breadboard removes them automatically when the run finishes.",
  ].join("\n");
}

/**
 * Claude Code only loads `mcp__ruflo__*` tools when it is handed an MCP config.
 * Generate one per run from the resolved launcher and keep it outside the
 * user's repository so a swarm never leaves stray config behind.
 */
function writeMcpConfig(runId: string, launcher: RufloLauncher): {
  configPath: string;
  cleanup: () => void;
} {
  const directory = path.join(os.tmpdir(), "breadboard-ruflo", runId);
  mkdirSync(directory, { recursive: true });
  const configPath = path.join(directory, "ruflo.mcp.json");
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        mcpServers: {
          ruflo: {
            command: launcher.command,
            args: [...launcher.args, "mcp", "start"],
            env: { CLAUDE_FLOW_HEADLESS: "true" },
          },
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  let cleaned = false;
  return {
    configPath,
    cleanup: () => {
      if (cleaned) return;
      cleaned = true;
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

/**
 * Closing the undo bracket here, rather than when a browser notices, keeps
 * edits the user makes after the run out of the run's own diff.
 */
const TERMINAL_EVENTS = new Set(["run.completed", "run.failed", "run.aborted"]);

function emit(run: RunState, type: string, payload: Record<string, unknown> = {}): void {
  if (TERMINAL_EVENTS.has(type)) {
    finalizeRunSnapshot(run.runId, run.repositoryPath);
  }
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

function boundedText(value: unknown, max = 2_000): string {
  if (typeof value === "string") return value.slice(0, max);
  if (value === undefined || value === null) return "";
  return JSON.stringify(value).slice(0, max);
}

function tokenCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : 0;
}

function toolSummary(input: unknown): string {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return boundedText(input, 400);
  }
  const record = input as Record<string, unknown>;
  for (const key of ["command", "file_path", "pattern", "path", "query", "prompt", "description"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 400);
  }
  return boundedText(record, 400);
}

function emitUsage(run: RunState): void {
  emit(run, "agent.usage", {
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    cachedInputTokens: run.cachedInputTokens,
    reasoningTokens: run.reasoningTokens,
    totalTokens: run.inputTokens + run.outputTokens + run.reasoningTokens,
    estimated: false,
  });
}

function ingestUsage(run: RunState, value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const usage = value as Record<string, unknown>;
  const input = tokenCount(usage.input_tokens);
  const output = tokenCount(usage.output_tokens);
  const cached =
    tokenCount(usage.cache_read_input_tokens) +
    tokenCount(usage.cache_creation_input_tokens);
  if (!input && !output && !cached) return false;
  run.inputTokens += input;
  run.outputTokens += output;
  run.cachedInputTokens += cached;
  return true;
}

/** Translate one Claude Code `stream-json` frame into Breadboard run events. */
function ingestClaudeFrame(run: RunState, frame: Record<string, unknown>): void {
  if (frame.type === "system" && frame.subtype === "init") {
    const servers = Array.isArray(frame.mcp_servers) ? frame.mcp_servers : [];
    emit(run, "hive.connected", {
      model: boundedText(frame.model, 120),
      mcpServers: servers
        .map((server) =>
          server && typeof server === "object"
            ? `${boundedText((server as Record<string, unknown>).name, 60)}:${boundedText((server as Record<string, unknown>).status, 30)}`
            : "",
        )
        .filter(Boolean)
        .slice(0, 12),
    });
    return;
  }

  if (frame.type === "assistant" && frame.message && typeof frame.message === "object") {
    const message = frame.message as Record<string, unknown>;
    const content = Array.isArray(message.content) ? message.content : [];
    for (const raw of content) {
      if (!raw || typeof raw !== "object") continue;
      const block = raw as Record<string, unknown>;
      if (block.type === "text") {
        const text = boundedText(block.text, 100_000).trim();
        if (!text) continue;
        run.output.push(text);
        if (run.output.length > MAX_OUTPUT_PARTS) run.output.shift();
        emit(run, "text.completed", { text });
      } else if (block.type === "thinking") {
        const text = boundedText(block.thinking, 4_000).trim();
        if (text) emit(run, "reasoning.completed", { text });
      } else if (block.type === "tool_use") {
        run.toolCount += 1;
        const tool = boundedText(block.name, 120) || "tool";
        emit(run, "tool.completed", {
          tool,
          status: "completed",
          // `mcp__ruflo__hive-mind_consensus` is a coordination call, not a
          // file edit; the card renders the two differently.
          swarm: tool.startsWith("mcp__"),
          summary: toolSummary(block.input),
        });
      }
    }
    if (ingestUsage(run, message.usage)) emitUsage(run);
    return;
  }

  if (frame.type === "result") {
    if (ingestUsage(run, frame.usage)) emitUsage(run);
    const text = boundedText(frame.result, 100_000).trim();
    if (text) run.finalResult = text;
  }
}

export interface StartRunInput {
  userId: number;
  objective: string;
  instruction?: string;
  skill?: { id: string; slug: string; contentHash?: string };
  workers?: unknown;
  queenType?: unknown;
  consensus?: unknown;
  topology?: unknown;
  repositoryPath: string;
  repositoryName: string;
  gardenSlug: string;
  attachments?: readonly RufloImageAttachment[];
}

export function startRun(input: StartRunInput): { runId: string; status: RunStatus } {
  const availability = runtimeAvailability();
  const launcher = resolveRufloLauncher();
  const claude = resolveClaudeExecutable();
  if (!availability.available || !launcher || !claude) {
    throw new Error(availability.reason ?? "Ruflo runtime unavailable");
  }

  const workers = clampWorkerCount(input.workers);
  const queenType = pick(QUEEN_TYPES, input.queenType, "strategic");
  const consensus = pick(CONSENSUS_STRATEGIES, input.consensus, "byzantine");
  const topology = pick(TOPOLOGIES, input.topology, "hierarchical-mesh");
  const baseObjective = input.instruction?.trim() || input.objective.trim();

  const runId = `rfrun_${randomUUID().replaceAll("-", "")}`;
  const run: RunState = {
    runId,
    userId: input.userId,
    objective: input.objective,
    repositoryPath: input.repositoryPath,
    repositoryName: input.repositoryName,
    gardenSlug: input.gardenSlug,
    status: "queued",
    sequence: 0,
    events: [],
    child: null,
    stderr: "",
    output: [],
    finalResult: "",
    startedAt: Date.now(),
    toolCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    plan: null,
    cleanup: null,
  };
  runs.set(runId, run);

  let materialized: ReturnType<typeof materializeRufloImageAttachments>;
  try {
    materialized = materializeRufloImageAttachments(
      input.repositoryPath,
      input.attachments ?? [],
    );
  } catch (error) {
    runs.delete(runId);
    throw error;
  }
  const attachmentContext = rufloImageInstruction(
    input.repositoryPath,
    materialized.paths,
  );
  // Ruflo 3.34 reads only the first line of a multiline `--objective`. Keep the
  // planner copy on one line, then append the full readable form directly to
  // Claude's prompt below so this does not depend on the CLI preserving it.
  const objective = attachmentContext
    ? [baseObjective, attachmentContext]
        .map((part) => part.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join(" ")
    : baseObjective;

  let mcp: ReturnType<typeof writeMcpConfig>;
  try {
    mcp = writeMcpConfig(runId, launcher);
  } catch (error) {
    materialized.cleanup();
    runs.delete(runId);
    throw error;
  }
  run.cleanup = () => {
    mcp.cleanup();
    materialized.cleanup();
  };
  const cleanup = () => {
    run.cleanup?.();
    run.cleanup = null;
  };

  const fail = (error: string) => {
    cleanup();
    if (run.status === "aborted") return;
    run.status = "failed";
    emit(run, "run.failed", {
      error,
      elapsedSec: Math.max(0, (Date.now() - run.startedAt) / 1_000),
      toolCount: run.toolCount,
    });
  };

  run.status = "planning";
  emit(run, "run.started", {
    objective: input.objective,
    repository: run.repositoryName,
    gardenSlug: run.gardenSlug,
    rufloVersion: launcher.version,
    launcher: launcher.source,
    queenType,
    consensus,
    topology,
    requestedWorkers: workers,
    attachmentCount: materialized.paths.length,
    ...(input.skill
      ? {
          skill: {
            id: input.skill.id,
            slug: input.skill.slug,
            contentHash: input.skill.contentHash,
          },
        }
      : {}),
  });

  /**
   * Run one Ruflo CLI step in the repository, collecting its stdout. Ruflo's
   * own progress output is human-readable text, so the caller parses it rather
   * than streaming it.
   */
  const runPlannerStep = (
    args: readonly string[],
    failureMessage: string,
    onSuccess: (stdout: string) => void,
  ) => {
    const child = spawn(launcher.command, [...launcher.args, ...args], {
      cwd: run.repositoryPath,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        CLAUDE_FLOW_HEADLESS: "true",
        CI: "1",
        NO_COLOR: "1",
        FORCE_COLOR: "0",
      },
    });
    run.child = child;

    let stdout = "";
    let settled = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout = `${stdout}${chunk}`.slice(-MAX_PLAN_STDOUT);
    });
    child.stderr.on("data", (chunk: string) => {
      run.stderr = `${run.stderr}${chunk}`.slice(-MAX_STDERR);
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill();
      } catch {
        // The planner may have exited between the check and the kill.
      }
      fail("Ruflo took too long to plan the swarm.");
    }, PLAN_TIMEOUT_MS);

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (run.child === child) run.child = null;
      fail(error.message);
    });

    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (run.child === child) run.child = null;
      if (run.status === "aborted") {
        cleanup();
        return;
      }
      if (code !== 0) {
        // Ruflo reports its own failures on stdout as `[ERROR] …`; stderr
        // mostly carries npm install noise, so prefer the former.
        const rufloError = /^\[ERROR\]\s*(.+)$/m.exec(stripAnsi(stdout));
        fail(
          rufloError?.[1]?.trim() ||
            stripAnsi(run.stderr).trim().split(/\r?\n/).filter(Boolean).at(-1) ||
            `${failureMessage} (exit code ${code ?? "unknown"}).`,
        );
        return;
      }
      onSuccess(stdout);
    });
  };

  // `hive-mind spawn` refuses to run against an uninitialized hive, so the run
  // always initializes first. Init is idempotent and keeps the hive's memory in
  // the repository between runs, which is the point of a Ruflo swarm.
  const spawnPlanner = () => {
    emit(run, "swarm.planning", {
      summary:
        launcher.source === "registry"
          ? `Preparing the Ruflo ${launcher.version} hive in ${run.repositoryName}. The first run also downloads the CLI.`
          : `Preparing the Ruflo ${launcher.version} hive in ${run.repositoryName}.`,
    });
    runPlannerStep(
      [
        "hive-mind",
        "init",
        "--topology",
        topology,
        "--consensus",
        consensus,
        "--max-agents",
        String(workers),
      ],
      "Ruflo could not initialize the hive",
      () => {
        if (run.status === "aborted") {
          cleanup();
          return;
        }
        planSwarm();
      },
    );
  };

  const planSwarm = () => {
    emit(run, "swarm.planning", {
      summary: `Spawning ${workers} ${queenType} workers under ${consensus} consensus.`,
    });
    runPlannerStep(
      [
        "hive-mind",
        "spawn",
        "--count",
        String(workers),
        "--claude",
        "--objective",
        objective,
        "--queen-type",
        queenType,
        "--consensus",
        consensus,
        "--topology",
        topology,
        "--non-interactive",
        "--dry-run",
        `--mcp-config=${mcp.configPath}`,
      ],
      "Ruflo could not plan the swarm",
      (stdout) => {
        const parsed = parseSwarmPlan(stdout);
        if (!parsed.promptFile) {
          fail("Ruflo planned the swarm but did not report its coordination prompt.");
          return;
        }
        const promptFile = path.resolve(run.repositoryPath, parsed.promptFile);
        let prompt = "";
        try {
          prompt = readFileSync(promptFile, "utf8");
        } catch {
          fail("Ruflo's coordination prompt could not be read.");
          return;
        }
        if (!prompt.trim()) {
          fail("Ruflo produced an empty coordination prompt.");
          return;
        }

        run.plan = {
          ...parsed,
          promptFile,
          workerCount: parsed.workerCount || workers,
          topology: parsed.topology || topology,
        };
        emit(run, "swarm.configured", {
          swarmId: run.plan.swarmId,
          queenType: run.plan.queenType,
          consensus: run.plan.consensus,
          topology: run.plan.topology,
          workerCount: run.plan.workerCount,
          workerTypes: run.plan.workerTypes,
        });
        const executorPrompt = [prompt, attachmentContext]
          .filter(Boolean)
          .join("\n\n");
        spawnExecutor(executorPrompt);
      },
    );
  };

  const spawnExecutor = (prompt: string) => {
    const skipPermissions =
      process.env.RUFLO_DANGEROUSLY_SKIP_PERMISSIONS?.trim() === "1";
    const model = process.env.RUFLO_CLAUDE_MODEL?.trim();
    const child = spawn(
      claude,
      [
        "--print",
        "--output-format",
        "stream-json",
        "--verbose",
        `--mcp-config=${mcp.configPath}`,
        ...(model ? ["--model", model] : []),
        ...(skipPermissions
          ? ["--dangerously-skip-permissions"]
          : ["--permission-mode", "acceptEdits"]),
      ],
      {
        cwd: run.repositoryPath,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, CLAUDE_FLOW_HEADLESS: "true" },
      },
    ) as ChildProcessWithoutNullStreams;
    child.stdin.end(prompt);
    run.child = child;
    run.status = "running";
    emit(run, "swarm.started", {
      swarmId: run.plan?.swarmId ?? "unknown",
      permissionMode: skipPermissions ? "bypass" : "acceptEdits",
    });

    let childErrored = false;
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      const lines = stdout.split(/\r?\n/);
      stdout = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const value = JSON.parse(line) as unknown;
          if (value && typeof value === "object" && !Array.isArray(value)) {
            ingestClaudeFrame(run, value as Record<string, unknown>);
          }
        } catch {
          // Claude Code writes occasional non-JSON bootstrap lines to stdout.
        }
      }
    });
    child.stderr.on("data", (chunk: string) => {
      run.stderr = `${run.stderr}${chunk}`.slice(-MAX_STDERR);
    });
    child.on("error", (error) => {
      childErrored = true;
      if (run.child === child) run.child = null;
      fail(error.message);
    });
    child.on("exit", (code) => {
      if (run.child === child) run.child = null;
      if (childErrored) return;
      if (run.status === "aborted" || run.status === "failed") {
        cleanup();
        return;
      }
      cleanup();
      const elapsedSec = Math.max(0, (Date.now() - run.startedAt) / 1_000);
      if (code === 0) {
        run.status = "completed";
        emit(run, "run.completed", {
          summary:
            run.finalResult.trim() ||
            run.output.join("\n\n").trim() ||
            "The Ruflo swarm finished.",
          elapsedSec,
          toolCount: run.toolCount,
          swarmId: run.plan?.swarmId ?? "unknown",
          workerCount: run.plan?.workerCount ?? workers,
          repository: run.repositoryName,
        });
        return;
      }
      run.status = "failed";
      emit(run, "run.failed", {
        error:
          stripAnsi(run.stderr).trim().split(/\r?\n/).filter(Boolean).at(-1) ||
          `The Ruflo swarm exited with code ${code ?? "unknown"}.`,
        elapsedSec,
        toolCount: run.toolCount,
      });
    });
  };

  try {
    spawnPlanner();
  } catch (error) {
    cleanup();
    runs.delete(runId);
    throw error;
  }

  return { runId, status: run.status };
}

export function getEventsSince(userId: number, runId: string, since = 0): RufloEvent[] {
  return requireRun(userId, runId).events.filter(
    (event) => event.sequenceNumber > since,
  );
}

export function isTerminal(userId: number, runId: string): boolean {
  return ["completed", "failed", "aborted"].includes(
    requireRun(userId, runId).status,
  );
}

export function abortRun(userId: number, runId: string): boolean {
  const run = requireRun(userId, runId);
  if (["completed", "failed", "aborted"].includes(run.status)) return false;
  run.status = "aborted";
  try {
    run.child?.kill();
  } catch {
    // The child may have exited between the state check and the kill.
  }
  run.cleanup?.();
  run.cleanup = null;
  emit(run, "run.aborted", { summary: "Ruflo swarm stopped." });
  return true;
}
