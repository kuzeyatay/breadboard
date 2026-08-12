// In-memory run manager for the Agent Reach agent. Breadboard drives the loop
// itself: it calls ChatMock (OpenAI-compatible) with two tools — run one
// allowlisted upstream command, and read a file that command wrote — and
// executes each proposed command against a per-run workspace.
//
// Driving the loop here rather than shelling out to an agent framework is what
// makes the command policy in ./commands.ts enforceable: every command passes
// through parseCommand before any process is spawned, and nothing is ever handed
// to a shell.
//
// Runs are ephemeral: events live here and the SSE route replays them.

import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chatmockApiKeyValue } from "../agent-browser/provider.ts";
import { confinePath, parseCommand } from "./commands.ts";
import { planSpawn, type SpawnPlanResult } from "./spawn-plan.ts";
import { buildSystemPrompt } from "./skill-prompt.ts";
import {
  agentReachEnv,
  doctor,
  resolveAgentReachRuntime,
  runtimeAvailability,
  type AgentReachRuntime,
  type ChannelHealth,
} from "./runtime.ts";

export interface AgentReachEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

type RunStatus = "queued" | "running" | "completed" | "failed" | "aborted";

interface RunState {
  runId: string;
  userId: number;
  task: string;
  workspace: string;
  status: RunStatus;
  sequence: number;
  events: AgentReachEvent[];
  child: ChildProcess | null;
  aborted: boolean;
  finalText: string;
  createdAt: number;
}

const globalRuns = globalThis as typeof globalThis & {
  __breadboardAgentReachRuns?: Map<string, RunState>;
};
const runs = globalRuns.__breadboardAgentReachRuns ?? new Map<string, RunState>();
globalRuns.__breadboardAgentReachRuns = runs;

const MAX_EVENTS = 5_000;
const MAX_TOOL_RESULT_CHARS = 24_000;
const MAX_FILE_CHARS = 40_000;
const COMMAND_TIMEOUT_MS = 180_000;
const MODEL_TIMEOUT_MS = 180_000;
const RUN_ROOT = path.join(os.tmpdir(), "breadboard-agent-reach");
const RETENTION_MS = 10 * 60 * 1000;

const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "agent_reach",
      description:
        "Run one Agent Reach upstream command to fetch internet content. One command per call; no shell chaining, redirection, or --json wrappers of your own.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description:
              'The command to run, e.g. \'curl -s "https://r.jina.ai/https://example.com"\', \'yt-dlp --dump-json "URL"\', \'gh search repos "query" --limit 5\', \'agent-reach doctor --json\'.',
          },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "read_output_file",
      description:
        "Read a file a previous command wrote into this run's workspace (subtitle .vtt, transcript .md, downloaded JSON). Replaces `cat`.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path as passed to the earlier command, e.g. '/tmp/VIDEOID.en.vtt'.",
          },
        },
        required: ["path"],
      },
    },
  },
];

/**
 * Split ChatMock's inlined reasoning off the answer. The non-streaming
 * completions endpoint returns the reasoning summary as a `<think>` block ahead
 * of the reply; the transcript should show the answer, and the block is worth
 * keeping only as the live progress line.
 */
export function splitReasoning(content: string): { thinking: string; answer: string } {
  const thinking: string[] = [];
  const answer = content
    .replace(/<think>([\s\S]*?)<\/think>/gi, (_match, body: string) => {
      thinking.push(body.trim());
      return "";
    })
    // An unterminated block means the reply was cut off mid-reasoning.
    .replace(/<think>[\s\S]*$/i, (match) => {
      thinking.push(match.slice(7).trim());
      return "";
    })
    .trim();
  return { thinking: thinking.join("\n").trim(), answer };
}

// ---- event plumbing ---------------------------------------------------------

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

// ---- command execution ------------------------------------------------------

/**
 * Resolve what a parsed command should really spawn. `agent-reach` goes through
 * the resolved runtime (venv script or venv python) rather than trusting a
 * global installation; everything else is looked up on PATH — which includes the
 * clone's `.venv` bin directory, so its bundled tools are found first.
 */
function spawnTarget(
  runtime: AgentReachRuntime,
  executable: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): SpawnPlanResult {
  if (executable === "agent-reach") {
    return { command: runtime.command, argv: [...runtime.baseArgs, ...args], verbatim: false };
  }
  return planSpawn(
    executable,
    args,
    env,
    (name) =>
      `${name} is not installed on this machine. Run \`agent-reach doctor --json\` to see which backends are live, and use one of those instead.`,
  );
}

function execute(
  run: RunState,
  runtime: AgentReachRuntime,
  executable: string,
  args: string[],
): Promise<string> {
  const env = agentReachEnv(runtime);
  const target = spawnTarget(runtime, executable, args, env);
  if ("error" in target) return Promise.resolve(target.error);
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(target.command, target.argv, {
        cwd: run.workspace,
        windowsHide: true,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsVerbatimArguments: target.verbatim,
      });
    } catch (error) {
      resolve(`Command could not start: ${error instanceof Error ? error.message : "unknown error"}`);
      return;
    }
    run.child = child;
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      if (stdout.length < MAX_TOOL_RESULT_CHARS * 2) stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      if (stderr.length < 8_000) stderr += chunk;
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        // Already gone.
      }
    }, COMMAND_TIMEOUT_MS);
    const settle = (text: string) => {
      clearTimeout(timer);
      if (run.child === child) run.child = null;
      resolve(text.slice(0, MAX_TOOL_RESULT_CHARS));
    };
    child.on("error", (error) => {
      settle(
        /ENOENT/i.test(error.message)
          ? `${executable} is not installed on this machine. Run \`agent-reach doctor --json\` to see which backends are live, and use one of those instead.`
          : `Command failed: ${error.message}`,
      );
    });
    child.on("exit", (code) => {
      if (timedOut) {
        settle(`Command timed out after ${COMMAND_TIMEOUT_MS / 1_000}s.`);
        return;
      }
      const clean = (value: string) => value.replace(/\x1b\[[0-9;]*m/g, "").trim();
      const out = clean(stdout);
      const err = clean(stderr);
      if (out) {
        settle(code === 0 ? out : `${out}\n\n(exit code ${code})\n${err}`.trim());
        return;
      }
      settle(err || (code === 0 ? "(command produced no output)" : `Command exited with code ${code}.`));
    });
  });
}

async function readOutputFile(run: RunState, requested: string): Promise<string> {
  const resolved = confinePath(requested, run.workspace);
  if (!resolved) return "That path is outside this run's workspace.";
  try {
    const content = await readFile(resolved, "utf8");
    return content.slice(0, MAX_FILE_CHARS) || "(the file is empty)";
  } catch {
    return `No file at ${requested}. Only files written by an earlier command in this run can be read.`;
  }
}

// ---- ChatMock ---------------------------------------------------------------

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
}

async function complete(
  baseUrl: string,
  model: string,
  reasoningEffort: string,
  messages: ChatMessage[],
): Promise<{ message: ChatMessage; usage: ChatUsage }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${chatmockApiKeyValue()}`,
      },
      body: JSON.stringify({
        model,
        messages,
        tools: TOOLS,
        tool_choice: "auto",
        reasoning_effort: reasoningEffort,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`ChatMock returned ${response.status}`);
    }
    const data = (await response.json()) as {
      choices?: Array<{ message?: ChatMessage }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const message = data.choices?.[0]?.message;
    if (!message) throw new Error("ChatMock returned no message");
    return {
      message,
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---- lifecycle --------------------------------------------------------------

export interface StartRunInput {
  userId: number;
  task: string;
  model: string;
  reasoningEffort: string;
  baseUrl: string;
  maxSteps?: number;
}

export function startRun(input: StartRunInput): { runId: string; status: RunStatus } {
  const availability = runtimeAvailability();
  if (!availability.available) throw new Error(availability.reason ?? "runtime_unavailable");

  const runId = `arrun_${randomUUID().replaceAll("-", "")}`;
  const run: RunState = {
    runId,
    userId: input.userId,
    task: input.task,
    workspace: path.join(RUN_ROOT, runId),
    status: "queued",
    sequence: 0,
    events: [],
    child: null,
    aborted: false,
    finalText: "",
    createdAt: Date.now(),
  };
  runs.set(runId, run);
  void drive(run, input).catch((error: unknown) => {
    if (run.aborted) return;
    run.status = "failed";
    emit(run, "run.failed", {
      error: error instanceof Error ? error.message : "The Agent Reach run failed.",
    });
  });
  return { runId, status: "queued" };
}

async function drive(run: RunState, input: StartRunInput): Promise<void> {
  await mkdir(run.workspace, { recursive: true });
  if (run.aborted) return;

  const runtime = resolveAgentReachRuntime();
  if (!runtime) throw new Error("The Agent Reach runtime disappeared before the run started.");

  emit(run, "run.started", { task: run.task, model: input.model });
  run.status = "running";

  let channels: ChannelHealth[] = [];
  emit(run, "doctor.started", {});
  try {
    channels = await doctor();
  } catch {
    // A failed probe is not fatal: the prompt says so and the run continues on
    // the zero-config channels.
  }
  if (run.aborted) return;
  emit(run, "doctor.completed", {
    channels: channels.map((channel) => ({
      channel: channel.channel,
      status: channel.status,
      activeBackend: channel.activeBackend,
      tier: channel.tier,
    })),
  });

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt({
        root: runtime.root,
        channels,
        workspace: run.workspace,
      }),
    },
    { role: "user", content: run.task },
  ];

  const usage = { inputTokens: 0, outputTokens: 0, calls: 0 };
  const maxSteps = Math.min(Math.max(input.maxSteps ?? 16, 1), 40);

  for (let step = 0; step < maxSteps; step += 1) {
    if (run.aborted) return;
    emit(run, "agent.thinking", {
      state: "active",
      step: step + 1,
      summary: step === 0 ? "Choosing a platform and backend" : "Reviewing what came back",
    });

    const { message, usage: turnUsage } = await complete(
      input.baseUrl,
      input.model,
      input.reasoningEffort,
      messages,
    );
    if (run.aborted) return;

    usage.calls += 1;
    usage.inputTokens += turnUsage.inputTokens;
    usage.outputTokens += turnUsage.outputTokens;
    emit(run, "agent.usage", { ...usage });

    const { thinking, answer } = splitReasoning(message.content ?? "");
    if (answer) run.finalText = answer;
    if (thinking) {
      emit(run, "agent.thinking", {
        state: "active",
        step: step + 1,
        summary: thinking.split(/\r?\n/).filter(Boolean).at(-1)?.slice(0, 200) ?? "",
      });
    }
    messages.push({
      role: "assistant",
      content: message.content ?? "",
      tool_calls: message.tool_calls,
    });

    const toolCalls = message.tool_calls ?? [];
    if (!toolCalls.length) {
      finish(run, "completed", {
        summary: run.finalText || "Agent Reach finished without an answer.",
        ...usage,
      });
      return;
    }

    for (const call of toolCalls) {
      if (run.aborted) return;
      let parsedArguments: Record<string, unknown> = {};
      try {
        parsedArguments = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
      } catch {
        parsedArguments = {};
      }

      if (call.function.name === "read_output_file") {
        const requested = typeof parsedArguments.path === "string" ? parsedArguments.path : "";
        emit(run, "fetch.started", { kind: "file", display: `read ${requested}` });
        const content = requested
          ? await readOutputFile(run, requested)
          : "No path was provided.";
        emit(run, "fetch.completed", {
          kind: "file",
          display: `read ${requested}`,
          chars: content.length,
        });
        messages.push({ role: "tool", tool_call_id: call.id, content });
        continue;
      }

      const raw = typeof parsedArguments.command === "string" ? parsedArguments.command : "";
      const decision = parseCommand(raw, run.workspace);
      if (!decision.ok) {
        emit(run, "fetch.refused", { command: raw.slice(0, 400), reason: decision.reason });
        messages.push({ role: "tool", tool_call_id: call.id, content: decision.reason });
        continue;
      }

      const { executable, args, display } = decision.command;
      emit(run, "fetch.started", {
        kind: "command",
        tool: executable,
        // Read the URL off the parsed argv, not the raw line — the raw line
        // still carries the quoting the model wrote around it.
        url: args.find((arg) => /^https?:\/\//i.test(arg)) ?? null,
        display,
      });
      const result = await execute(run, runtime, executable, args);
      if (run.aborted) return;
      emit(run, "fetch.completed", {
        kind: "command",
        tool: executable,
        display,
        chars: result.length,
        preview: result.split(/\r?\n/).slice(0, 2).join(" ").slice(0, 200),
      });
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }

  finish(run, "completed", {
    summary: run.finalText || "Agent Reach reached its step limit before answering.",
    ...usage,
  });
}

function finish(run: RunState, status: RunStatus, payload: Record<string, unknown>): void {
  run.status = status;
  emit(run, status === "completed" ? "run.completed" : "run.failed", {
    ...payload,
    elapsedSec: (Date.now() - run.createdAt) / 1_000,
  });
  setTimeout(() => {
    runs.delete(run.runId);
    void rm(run.workspace, { recursive: true, force: true }).catch(() => undefined);
  }, RETENTION_MS);
}

// ---- read/control API -------------------------------------------------------

export function getEventsSince(userId: number, runId: string, since = 0): AgentReachEvent[] {
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
  emit(run, "run.aborted", { summary: "Agent Reach stopped." });
  setTimeout(() => {
    runs.delete(run.runId);
    void rm(run.workspace, { recursive: true, force: true }).catch(() => undefined);
  }, RETENTION_MS);
  return true;
}
