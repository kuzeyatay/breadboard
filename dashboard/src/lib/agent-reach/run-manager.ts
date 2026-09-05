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
import { mkdir, open, lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { confinePath, parseCommand } from "./commands.ts";
import {
  closeBridgeWindow,
  ensureBridgeWindow,
} from "../agent-browser/browser-profile-process.ts";
import { openCliProfileEnv } from "../agent-browser/opencli-profile.ts";
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
import { promptWithContext } from "../conversations/agent-context.ts";

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
  abortController: AbortController;
  aborted: boolean;
  finalText: string;
  createdAt: number;
  /** Whether this run opened the background browser and therefore owes a close. */
  openedBridgeWindow?: boolean;
  /**
   * Which browser profile OpenCLI should drive, resolved once per run.
   *
   * Undefined until the first command needs it. Resolved per run rather than
   * per command because it costs a loopback round trip and cannot change while
   * a run is in flight.
   */
  openCliEnv?: Record<string, string>;
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
/** Attempts per step, so one slow upstream call does not end a sixteen-step run. */
const MODEL_ATTEMPTS = 3;
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

async function execute(
  run: RunState,
  runtime: AgentReachRuntime,
  executable: string,
  args: string[],
): Promise<string> {
  // OpenCLI refuses to act when several browser profiles are connected and
  // none is named, which takes out every login-backed channel at once. This
  // names Breadboard's own, and resolves to nothing when there is no choice
  // to make.
  run.openCliEnv ??= await openCliProfileEnv();
  const env = {
    ...agentReachEnv(runtime),
    ...run.openCliEnv,
    TEMP: path.join(run.workspace, "tmp"),
    TMP: path.join(run.workspace, "tmp"),
    TMPDIR: path.join(run.workspace, "tmp"),
  };
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
  const withinWorkspace = (candidate: string) => {
    const relative = path.relative(path.resolve(run.workspace), path.resolve(candidate));
    return relative === "" || (
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    );
  };
  try {
    const metadata = await lstat(/* turbopackIgnore: true */ resolved);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      return `No direct file at ${requested}. Only files written by an earlier command in this run can be read.`;
    }
    const canonical = await realpath(/* turbopackIgnore: true */ resolved);
    if (!withinWorkspace(canonical)) return "That path is outside this run's workspace.";
    const handle = await open(/* turbopackIgnore: true */ canonical, "r");
    let content = "";
    try {
      const bytes = Buffer.alloc(MAX_FILE_CHARS * 4 + 1);
      const { bytesRead } = await handle.read(bytes, 0, bytes.byteLength, 0);
      content = bytes.subarray(0, bytesRead).toString("utf8");
    } finally {
      await handle.close();
    }
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
  apiKey: string,
  signal: AbortSignal,
  toolChoice: "auto" | "none" = "auto",
): Promise<{ message: ChatMessage; usage: ChatUsage }> {
  // Retried rather than fatal.
  //
  // One model call that times out or hits a transient upstream error used to
  // end the whole run — and this agent runs up to sixteen steps, so that threw
  // away every step before it. It showed up under concurrency: with two other
  // research agents calling the same ChatMock at once, a call ran past the
  // three-minute abort and the run failed at 192 seconds having found nothing.
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= MODEL_ATTEMPTS; attempt += 1) {
    try {
      return await completeOnce(
        baseUrl,
        model,
        reasoningEffort,
        messages,
        apiKey,
        signal,
        toolChoice,
      );
    } catch (error) {
      if (signal.aborted) {
        throw signal.reason ?? new DOMException("Aborted", "AbortError");
      }
      const failure =
        error instanceof Error ? error : new Error("The model call failed.");
      if (!isRetryableModelFailure(failure) || attempt === MODEL_ATTEMPTS) {
        throw failure;
      }
      lastError = failure;
      await abortableDelay(attempt * 5_000, signal);
    }
  }
  throw lastError ?? new Error("The model call failed.");
}

/** Transient by nature: worth another attempt, not worth ending a run over. */
function isRetryableModelFailure(error: Error): boolean {
  if (error.name === "AbortError" || /timed? out/i.test(error.message)) return true;
  return /ChatMock returned (408|429|5\d\d)/.test(error.message);
}

async function completeOnce(
  baseUrl: string,
  model: string,
  reasoningEffort: string,
  messages: ChatMessage[],
  apiKey: string,
  signal: AbortSignal,
  toolChoice: "auto" | "none" = "auto",
): Promise<{ message: ChatMessage; usage: ChatUsage }> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException("The model call timed out", "TimeoutError")),
    MODEL_TIMEOUT_MS,
  );
  timer.unref?.();
  const forwardAbort = () => controller.abort(signal.reason);
  if (signal.aborted) forwardAbort();
  else signal.addEventListener("abort", forwardAbort, { once: true });
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        tools: TOOLS,
        tool_choice: toolChoice,
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
    signal.removeEventListener("abort", forwardAbort);
  }
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    const abort = () => done(signal.reason ?? new DOMException("Aborted", "AbortError"));
    function done(error?: unknown) {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    }
    signal.addEventListener("abort", abort, { once: true });
    timer.unref?.();
  });
}

// ---- lifecycle --------------------------------------------------------------

export interface StartRunInput {
  userId: number;
  requestId?: string;
  task: string;
  model: string;
  reasoningEffort: string;
  baseUrl: string;
  maxSteps?: number;
  /** The chat this was launched from, so a task can refer back to it. */
  conversationContext?: string;
}

interface RuntimeWorkerStartRunInput extends StartRunInput {
  runtimeJobId: string;
  runtimeWorkspacePath: string;
  apiKey: string;
}

export function startRuntimeWorkerRun(
  input: RuntimeWorkerStartRunInput,
): { runId: string; status: RunStatus } {
  const availability = runtimeAvailability();
  if (!availability.available) throw new Error(availability.reason ?? "runtime_unavailable");
  if (
    !/^[A-Za-z0-9_-]{1,128}$/u.test(input.runtimeJobId) ||
    !path.isAbsolute(input.runtimeWorkspacePath) ||
    !input.apiKey ||
    Buffer.byteLength(input.apiKey, "utf8") > 4_096 ||
    /[\u0000\r\n]/u.test(input.apiKey)
  ) throw new Error("The Agent Reach Runtime worker input is invalid.");

  const runId = input.runtimeJobId;
  const run: RunState = {
    runId,
    userId: input.userId,
    task: input.task,
    workspace: path.resolve(input.runtimeWorkspacePath),
    status: "queued",
    sequence: 0,
    events: [],
    child: null,
    abortController: new AbortController(),
    aborted: false,
    finalText: "",
    createdAt: Date.now(),
  };
  runs.set(runId, run);
  void drive(run, input)
    .catch((error: unknown) => {
      if (run.aborted) return;
      finish(run, "failed", {
        error: error instanceof Error ? error.message : "The Agent Reach run failed.",
      });
    })
    // Every way out, including an abort: a browser left running off-screen
    // would hold the profile against the next Agent Browser run and against
    // anyone trying to sign in.
    .finally(() => {
      if (run.openedBridgeWindow) closeBridgeWindow();
    });
  return { runId, status: "queued" };
}

async function drive(run: RunState, input: RuntimeWorkerStartRunInput): Promise<void> {
  await mkdir(run.workspace, { recursive: true });
  await mkdir(path.join(run.workspace, "tmp"), { recursive: true });
  if (run.aborted) return;

  const runtime = resolveAgentReachRuntime();
  if (!runtime) throw new Error("The Agent Reach runtime disappeared before the run started.");

  // OpenCLI drives a browser; it does not start one. Without this, the six
  // login-backed channels worked only while somebody happened to have the
  // sign-in window open. Opened off-screen, and put away afterwards — but only
  // if this run is what opened it.
  run.openedBridgeWindow = ensureBridgeWindow().opened;

  emit(run, "run.started", { task: run.task, model: input.model });
  run.status = "running";

  let channels: ChannelHealth[] = [];
  emit(run, "doctor.started", {});
  try {
    channels = await doctor({ signal: run.abortController.signal });
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
    { role: "user", content: promptWithContext(run.task, input.conversationContext) },
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
      input.apiKey,
      run.abortController.signal,
    );
    if (run.aborted) return;

    usage.calls += 1;
    usage.inputTokens += turnUsage.inputTokens;
    usage.outputTokens += turnUsage.outputTokens;
    emit(run, "agent.usage", { ...usage });

    const { thinking, answer } = splitReasoning(message.content ?? "");
    // Text beside a tool call is commentary about the next step, not the
    // answer. Keeping it as the answer meant a run that hit its step limit
    // reported its first remark — "Using agent-reach, open web via Jina
    // Reader." — as its finding, after sixteen steps of real reading.
    if (answer && !(message.tool_calls ?? []).length) run.finalText = answer;
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

  // Out of steps with the answer unwritten. Everything it read is still in
  // the transcript, so ask for the write-up now, with tools withheld: a live
  // Max Research drive watched this agent fetch national energy-price tables
  // and a regulator's press release across sixteen steps and then hand back
  // nothing, because the loop ended on a tool call and no turn was left to
  // report. One more call costs seconds; the sixteen before it cost minutes.
  if (!run.finalText && !run.aborted) {
    emit(run, "agent.thinking", {
      state: "active",
      step: maxSteps + 1,
      summary: "Writing up what was found",
    });
    messages.push({
      role: "user",
      content:
        "You have used every step available. Do not call any more tools. Write your findings now from what you have already read: what you actually found and where you found it, quoting or paraphrasing sources and naming the page, thread, post or repository each came from. If something you tried returned nothing, say so plainly. Do not describe your plan or approach.",
    });
    try {
      const { message, usage: turnUsage } = await complete(
        input.baseUrl,
        input.model,
        input.reasoningEffort,
        messages,
        input.apiKey,
        run.abortController.signal,
        "none",
      );
      if (run.aborted) return;
      usage.calls += 1;
      usage.inputTokens += turnUsage.inputTokens;
      usage.outputTokens += turnUsage.outputTokens;
      emit(run, "agent.usage", { ...usage });
      const { answer } = splitReasoning(message.content ?? "");
      if (answer) run.finalText = answer;
    } catch (error) {
      if (run.aborted) return;
      emit(run, "agent.thinking", {
        state: "active",
        step: maxSteps + 1,
        summary: `The write-up call failed: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      });
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
  scheduleCleanup(run);
}

function scheduleCleanup(run: RunState): void {
  const retention = setTimeout(() => {
    runs.delete(run.runId);
  }, RETENTION_MS);
  retention.unref?.();
}

// ---- read/control API -------------------------------------------------------

export function getRuntimeWorkerEventsSince(
  userId: number,
  runId: string,
  since = 0,
): AgentReachEvent[] {
  return requireRun(userId, runId).events.filter((event) => event.sequenceNumber > since);
}

export function isRuntimeWorkerTerminal(userId: number, runId: string): boolean {
  return ["completed", "failed", "aborted"].includes(requireRun(userId, runId).status);
}

export function abortRuntimeWorkerRun(userId: number, runId: string): boolean {
  const run = requireRun(userId, runId);
  if (["completed", "failed", "aborted"].includes(run.status)) return false;
  run.aborted = true;
  run.status = "aborted";
  run.abortController.abort(new DOMException("Agent Reach stopped", "AbortError"));
  try {
    run.child?.kill();
  } catch {
    // It may have exited between the state check and the kill.
  }
  run.child = null;
  emit(run, "run.aborted", { summary: "Agent Reach stopped." });
  scheduleCleanup(run);
  return true;
}

/** Public durable facade. Runtime V2 owns the model loop and every tool child. */
export async function startRun(
  input: StartRunInput,
): Promise<{ runId: string; status: RunStatus }> {
  const { startOuterAgentRun } = await import("../runtime-v2/outer-agent-run.ts");
  return startOuterAgentRun({
    kind: "agent-reach",
    userId: input.userId,
    requestId: input.requestId,
    requestPayload: {
      task: input.task,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      baseUrl: input.baseUrl,
      maxSteps: input.maxSteps ?? 16,
      conversationContext: input.conversationContext ?? "",
    },
  }) as Promise<{ runId: string; status: RunStatus }>;
}

export async function getEventsSince(
  userId: number,
  runId: string,
  since = 0,
): Promise<AgentReachEvent[]> {
  const { readOuterAgentRunView } = await import("../runtime-v2/outer-agent-run.ts");
  const view = await readOuterAgentRunView("agent-reach", userId, runId, since);
  return view.events as AgentReachEvent[];
}

export async function isTerminal(userId: number, runId: string): Promise<boolean> {
  const { readOuterAgentRunView } = await import("../runtime-v2/outer-agent-run.ts");
  return (await readOuterAgentRunView("agent-reach", userId, runId, 0)).terminal;
}

export async function abortRun(userId: number, runId: string): Promise<boolean> {
  const { abortOuterAgentRun } = await import("../runtime-v2/outer-agent-run.ts");
  return abortOuterAgentRun("agent-reach", userId, runId);
}
