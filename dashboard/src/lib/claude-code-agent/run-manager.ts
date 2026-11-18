import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import os from "node:os";
// Runtime paths stay out of Next's build trace; plain fs/path/spawn here made it trace the whole repo.
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { externalRuntimeSpawn as spawn } from "../external-runtime-process.ts";
import type { ChatTokenUsage } from "../chat-token-usage.ts";
import { repositoryRoot } from "../runtime-paths.ts";
import { tierAllows, type AutonomyTier } from "../hermes/autonomy.ts";
import { CLAUDE_CODE_AGENT_NAME } from "./identity.ts";

export interface ClaudeCodeEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

type RunStatus = "running" | "completed" | "failed" | "aborted";

export interface ClaudeCodeTerminalResult {
  outcome: "completed" | "failed" | "aborted";
  content: string;
  usage?: ChatTokenUsage;
}

interface RunState {
  runId: string;
  userId: number;
  status: RunStatus;
  sequence: number;
  events: ClaudeCodeEvent[];
  child: ChildProcessWithoutNullStreams | null;
  stderr: string;
  answer: string;
  lastText: string;
  toolCount: number;
  toolNames: Map<string, { tool: string; title: string }>;
  startedAt: number;
  usage?: ChatTokenUsage;
  terminalResult?: ClaudeCodeTerminalResult;
  terminalHandler?: (result: ClaudeCodeTerminalResult) => void;
  cleanup: () => void;
}

const store = globalThis as typeof globalThis & { __breadboardClaudeCodeRuns?: Map<string, RunState> };
const runs = store.__breadboardClaudeCodeRuns ?? new Map<string, RunState>();
store.__breadboardClaudeCodeRuns = runs;

const MAX_EVENTS = 5_000;
const RETENTION_MS = 30 * 60 * 1000;

/** Where the official CLI installs itself; the same list ChatMock and the Runtime probe. */
export function claudeExecutable(env: NodeJS.ProcessEnv = process.env): string | null {
  const name = process.platform === "win32" ? "claude.exe" : "claude";
  const home = env.USERPROFILE?.trim() || env.HOME?.trim() || os.homedir();
  const candidates = [
    env.CLAUDE_CLI_PATH?.trim(),
    path.join(home, ".local", "bin", name),
    env.APPDATA ? path.join(env.APPDATA, "SPB_Data", ".local", "bin", name) : "",
    env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "Programs", "claude", name) : "",
    process.platform !== "win32" ? path.join(home, ".claude", "local", "claude") : "",
    process.platform !== "win32" ? "/usr/local/bin/claude" : "",
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) ?? null;
}

function hermesRuntime(env: NodeJS.ProcessEnv = process.env): { python: string; appDirectory: string } | null {
  const appDirectory = path.resolve(env.BREADBOARD_HERMES_APP_DIR?.trim() || path.join(repositoryRoot(), "hermes-agent"));
  const venv = path.join(appDirectory, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const python = env.BREADBOARD_HERMES_PYTHON?.trim() || (fs.existsSync(venv) ? venv : "");
  if (!python || !fs.existsSync(path.join(appDirectory, "plugins", "breadboard", "claude_code_mcp.py"))) return null;
  return { python, appDirectory };
}

export function availability(): { available: boolean; reason?: string } {
  if (!claudeExecutable()) return { available: false, reason: "Claude Code is not installed. Set it up in Settings under Models." };
  if (!hermesRuntime()) return { available: false, reason: "Breadboard tools are unavailable for Claude Code on this install." };
  return { available: true };
}

/**
 * Breadboard's permission settings, said in Claude Code's terms. Breadboard
 * tools are always offered: the dashboard gates each call as it does for Hermes.
 * Claude Code's own tools follow YOLO and the autonomy tier.
 */
export function permissionArgs(yoloMode: boolean, tier: AutonomyTier): { args: string[]; note: string } {
  const breadboard = "mcp__breadboard";
  if (yoloMode && tierAllows(tier, "destructive")) {
    return { args: ["--permission-mode", "bypassPermissions"], note: "You may read, edit and run commands without asking." };
  }
  if (yoloMode && tierAllows(tier, "write")) {
    return {
      args: ["--permission-mode", "acceptEdits", "--allowedTools", `Read Glob Grep Edit Write WebSearch WebFetch ${breadboard}`, "--disallowedTools", "Bash"],
      note: "You may read and edit files and search the web. Running commands is not allowed.",
    };
  }
  return {
    args: ["--permission-mode", "default", "--allowedTools", `Read Glob Grep ${breadboard}`, "--disallowedTools", "Bash Edit Write NotebookEdit WebFetch WebSearch"],
    note: "You may only read and search files. Editing files and running commands is not allowed, because the user has not given Breadboard permission to act without asking. Say what you would change instead.",
  };
}

function emit(run: RunState, type: string, payload: Record<string, unknown> = {}): void {
  run.sequence += 1;
  run.events.push({ sequenceNumber: run.sequence, type, payload, at: new Date().toISOString() });
  if (run.events.length > MAX_EVENTS) run.events.shift();
}

function finish(run: RunState, result: ClaudeCodeTerminalResult): void {
  if (run.terminalResult) return;
  run.terminalResult = result;
  run.cleanup();
  try { run.terminalHandler?.(result); } catch { /* the stream still replays the result */ }
  setTimeout(() => runs.delete(run.runId), RETENTION_MS).unref?.();
}

function short(value: unknown, max = 2_000): string {
  if (typeof value === "string") return value.slice(0, max);
  if (value === undefined || value === null) return "";
  return JSON.stringify(value).slice(0, max);
}

function toolTitle(name: string, input: Record<string, unknown>): string {
  return short(input.command ?? input.file_path ?? input.pattern ?? input.query ?? input.url ?? input.path ?? "", 400);
}

/** One line of `claude -p --output-format stream-json`. */
export function ingestClaudeEvent(run: RunState, value: Record<string, unknown>): void {
  const message = (value.message ?? {}) as { content?: unknown };
  const content = Array.isArray(message.content) ? message.content as Array<Record<string, unknown>> : [];
  if (value.type === "assistant") {
    for (const block of content) {
      if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
        // Text before a tool call is narration; the last text is the answer.
        if (run.lastText) emit(run, "reasoning.completed", { text: run.lastText });
        run.lastText = block.text.trim();
      } else if (block.type === "thinking" && typeof block.thinking === "string" && block.thinking.trim()) {
        emit(run, "reasoning.completed", { text: block.thinking.trim().slice(0, 8_000) });
      } else if (block.type === "tool_use") {
        const name = short(block.name, 120);
        const tool = name.startsWith("mcp__breadboard__") ? name.slice("mcp__breadboard__".length) : name;
        run.toolNames.set(short(block.id, 200), { tool, title: toolTitle(name, (block.input ?? {}) as Record<string, unknown>) });
        if (run.lastText) { emit(run, "reasoning.completed", { text: run.lastText }); run.lastText = ""; }
      }
    }
  } else if (value.type === "user") {
    for (const block of content) {
      if (block.type !== "tool_result") continue;
      const known = run.toolNames.get(short(block.tool_use_id, 200)) ?? { tool: "tool", title: "" };
      const summary = Array.isArray(block.content)
        ? (block.content as Array<Record<string, unknown>>).map((part) => short(part.text, 2_000)).join("\n")
        : short(block.content);
      run.toolCount += 1;
      emit(run, "tool.completed", { ...known, summary: summary.slice(0, 2_000), status: block.is_error ? "failed" : "completed" });
    }
  } else if (value.type === "result") {
    const usage = (value.usage ?? {}) as Record<string, unknown>;
    const input = Number(usage.input_tokens) || 0;
    const output = Number(usage.output_tokens) || 0;
    run.usage = {
      inputTokens: input, outputTokens: output, totalTokens: input + output,
      cachedInputTokens: Number(usage.cache_read_input_tokens) || 0, reasoningTokens: 0, estimated: false,
    };
    emit(run, "agent.usage", { ...run.usage });
    if (typeof value.result === "string" && value.result.trim()) run.answer = value.result.trim();
    if (value.is_error === true) run.stderr = `${run.stderr}\n${short(value.result) || short(value.subtype)}`;
  }
}

/** One stream-json user turn: the images first, then the instruction. */
export function userMessage(prompt: string, images: readonly string[]) {
  const content: Array<Record<string, unknown>> = [];
  for (const dataUrl of images) {
    const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/s.exec(dataUrl);
    if (match) content.push({ type: "image", source: { type: "base64", media_type: match[1], data: match[2] } });
  }
  content.push({ type: "text", text: prompt });
  return { type: "user", message: { role: "user", content } };
}

export interface StartClaudeCodeRunInput {
  userId: number;
  task: string;
  prompt: string;
  /** Image data URLs from the chat; other attachment kinds are not forwarded. */
  images?: readonly string[];
  /** Breadboard's goal for this chat; Claude Code works until its own /goal check passes. */
  goal?: string | null;
  model: string | null;
  workingDirectory: string;
  runtimeSessionId: string;
  yoloMode: boolean;
  autonomyTier: AutonomyTier;
}

export function startRun(input: StartClaudeCodeRunInput): { runId: string; status: RunStatus } {
  const executable = claudeExecutable();
  const hermes = hermesRuntime();
  if (!executable || !hermes) throw new Error(availability().reason ?? "Claude Code is unavailable.");
  const secret = process.env.BREADBOARD_HERMES_TOOL_SECRET?.trim() || process.env.HERMES_TOOL_SECRET?.trim();
  if (!secret) throw new Error("Breadboard tool authentication is not configured.");

  // The MCP config carries the tool secret, so it lives in a private folder for the run only.
  const configDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-claude-"));
  const configPath = path.join(configDirectory, "mcp.json");
  fs.writeFileSync(configPath, JSON.stringify({
    mcpServers: {
      breadboard: {
        type: "stdio",
        command: hermes.python,
        args: ["-m", "plugins.breadboard.claude_code_mcp"],
        env: {
          PYTHONPATH: hermes.appDirectory,
          PYTHONIOENCODING: "utf-8",
          BREADBOARD_MCP_SESSION_ID: input.runtimeSessionId,
          BREADBOARD_HERMES_TOOL_SECRET: secret,
          BREADBOARD_INTERNAL_URL: process.env.BREADBOARD_INTERNAL_URL?.trim() || `http://127.0.0.1:${process.env.PORT || "3000"}`,
        },
      },
    },
  }), { mode: 0o600 });

  // `/goal` must be the whole message, so the chat context goes in a file beside it.
  let contextNote = "";
  if (input.goal) {
    const contextPath = path.join(configDirectory, "conversation.md");
    fs.writeFileSync(contextPath, input.prompt, { mode: 0o600 });
    contextNote = ` The request and earlier conversation behind your goal are in ${contextPath}; read it first.`;
  }
  const permissions = permissionArgs(input.yoloMode, input.autonomyTier);
  const args = [
    "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
    "--mcp-config", configPath, "--strict-mcp-config",
    ...permissions.args,
    "--append-system-prompt",
    `You are running inside Breadboard, the user's personal workspace app. Breadboard's own tools (gardens, notes, memory, calendar, browser, files and more) are available as mcp__breadboard__* tools; prefer them for anything about the user's Breadboard data. ${permissions.note}${contextNote}`,
    ...(input.model ? ["--model", input.model] : []),
  ];
  const runId = `ccrun_${randomUUID().replaceAll("-", "")}`;
  const child = spawn(executable, args, {
    cwd: input.workingDirectory, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env: process.env,
  });
  const run: RunState = {
    runId, userId: input.userId, status: "running", sequence: 0, events: [], child, stderr: "",
    answer: "", lastText: "", toolCount: 0, toolNames: new Map(), startedAt: Date.now(),
    cleanup: () => fs.rmSync(configDirectory, { recursive: true, force: true }),
  };
  runs.set(runId, run);
  const text = input.goal ? `/goal ${input.goal.replace(/\s+/g, " ").trim()}` : input.prompt;
  child.stdin.end(`${JSON.stringify(userMessage(text, input.images ?? []))}\n`);
  emit(run, "run.started", { model: input.model ?? "default", permissionMode: permissions.args[1], ...(input.goal ? { goal: input.goal } : {}) });

  let buffer = "";
  const ingestLine = (line: string) => {
    if (!line.trim()) return;
    try {
      const value = JSON.parse(line) as unknown;
      if (value && typeof value === "object" && !Array.isArray(value)) ingestClaudeEvent(run, value as Record<string, unknown>);
    } catch { /* not a protocol line */ }
  };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    lines.forEach(ingestLine);
  });
  child.stderr.on("data", (chunk: string) => { run.stderr = `${run.stderr}${chunk}`.slice(-32_000); });
  child.on("error", (error) => {
    run.child = null;
    if (run.status !== "running") return;
    run.status = "failed";
    emit(run, "run.failed", { error: error.message });
    finish(run, { outcome: "failed", content: error.message, usage: run.usage });
  });
  // `close` waits for stdout to drain, so the answer is whole before the run ends.
  child.on("close", (code) => {
    run.child = null;
    ingestLine(buffer);
    buffer = "";
    if (run.status !== "running") return;
    const elapsedSec = Math.max(0, (Date.now() - run.startedAt) / 1_000);
    const answer = run.answer || run.lastText;
    if (code === 0 && answer) {
      run.status = "completed";
      emit(run, "text.completed", { text: answer });
      emit(run, "run.completed", { summary: answer, elapsedSec, toolCount: run.toolCount });
      finish(run, { outcome: "completed", content: answer, usage: run.usage });
      return;
    }
    const error = run.stderr.trim().split(/\r?\n/).slice(-1)[0] || `${CLAUDE_CODE_AGENT_NAME} exited with code ${code ?? "unknown"}`;
    run.status = "failed";
    emit(run, "run.failed", { error, elapsedSec, toolCount: run.toolCount });
    finish(run, { outcome: "failed", content: error, usage: run.usage });
  });
  return { runId, status: run.status };
}

function requireRun(userId: number, runId: string): RunState {
  const run = runs.get(runId);
  if (!run || run.userId !== userId) throw new Error("run_not_found");
  return run;
}

export async function readRunView(userId: number, runId: string, since = 0) {
  const run = requireRun(userId, runId);
  return { events: run.events.filter((event) => event.sequenceNumber > since), terminal: run.status !== "running", status: null };
}

export function setRunTerminalHandler(userId: number, runId: string, handler: (result: ClaudeCodeTerminalResult) => void): void {
  const run = requireRun(userId, runId);
  run.terminalHandler = handler;
  if (run.terminalResult) handler(run.terminalResult);
}

export function getEventsSince(userId: number, runId: string, since = 0): ClaudeCodeEvent[] {
  return requireRun(userId, runId).events.filter((event) => event.sequenceNumber > since);
}

export async function abortRun(userId: number, runId: string): Promise<boolean> {
  const run = requireRun(userId, runId);
  if (run.status !== "running") return false;
  run.status = "aborted";
  try { run.child?.kill(); } catch { /* already gone */ }
  const summary = `${CLAUDE_CODE_AGENT_NAME} task stopped.`;
  emit(run, "run.aborted", { summary });
  finish(run, { outcome: "aborted", content: summary, usage: run.usage });
  return true;
}
