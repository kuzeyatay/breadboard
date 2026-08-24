// In-memory run manager for the agent-browser runtime. The Next.js server drives
// the agent loop itself: it calls ChatMock (OpenAI-compatible) with a single
// `agent_browser` tool (the same schema agent-browser's own `chat` uses), and
// executes each proposed command via the agent-browser CLI against a dedicated
// browser session. Because WE execute the tools, sensitive actions can be paused
// for real per-action approval before they touch the browser — true approve/
// reject that agent-browser's own `chat` subprocess cannot offer out of band.
//
// Runs are ephemeral: events + screenshots live here in memory and the SSE route
// replays them; only the agent CONFIG is persisted (SQLite).
//
// The CLI is always invoked as `node <agent-browser.js> ...` with argv passed as
// an array (never a shell string) so a model-proposed command cannot be
// interpreted by a shell.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { breadSystemPrompt } from "../assistant-identity.ts";
import { isChatmockProvider } from "../ui-tars/model-provider.ts";
import {
  SupervisorResourceExhaustedError,
  withCapabilityLease,
} from "../supervisor-control.ts";
import { publicId } from "./store.ts";
import { chatmockApiKeyValue } from "./provider.ts";
import { chatmockGatewayBase, type AgentBrowserConfiguration, type ApprovalMode } from "./config.ts";
import { activeProfileDir, resolveBrowserExecutable } from "./browser-profile.ts";

export { resolveBrowserExecutable };

export interface NormalizedEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

type RunStatus = "queued" | "running" | "awaiting_approval" | "completed" | "failed" | "aborted";

interface PendingApproval {
  actionId: string;
  resolve: (decision: "approve" | "reject") => void;
}

interface RunState {
  runId: string;
  userId: number;
  agentId: string;
  session: string;
  task: string;
  status: RunStatus;
  seq: number;
  events: NormalizedEvent[];
  screenshotDir: string;
  poller: NodeJS.Timeout | null;
  subscribers: Set<(event: NormalizedEvent) => void>;
  pending: PendingApproval | null;
  aborted: boolean;
  finalText: string;
  createdAt: string;
}

// In dev each route bundle gets its own instance of this module, so the map
// must live on globalThis — otherwise the events/approve/abort routes look at
// an empty map and treat every run the POST route starts as already gone.
const globalRuns = globalThis as typeof globalThis & {
  __breadboardAgentBrowserRuns?: Map<string, RunState>;
};
const runs = globalRuns.__breadboardAgentBrowserRuns ?? new Map<string, RunState>();
globalRuns.__breadboardAgentBrowserRuns = runs;
const MAX_EVENTS = 5_000;
const MAX_TOOL_RESULT_CHARS = 8_000;

// Screenshots are written to disk under a deterministic, runId-derived directory
// and served from there — never held only in per-process memory. This keeps them
// retrievable even when the screenshot request lands on a different worker than
// the one that owns the run's in-memory state.
const SCREENSHOTS_ROOT = path.join(os.tmpdir(), "breadboard-agent-browser");

function screenshotDirFor(runId: string): string {
  return path.join(SCREENSHOTS_ROOT, runId);
}

// The exact tool schema agent-browser's own chat loop exposes (single tool that
// runs an agent-browser command string).
const AGENT_BROWSER_TOOL = {
  type: "function" as const,
  function: {
    name: "agent_browser",
    description:
      "Execute an agent-browser command against the active browser session. One command per call; do not chain with && or ;. Do not add --json.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description:
            "The command to run, e.g. 'agent-browser open https://example.com', 'agent-browser snapshot -i', 'agent-browser click @e3', 'agent-browser type @e2 hello'.",
        },
      },
      required: ["command"],
    },
  },
};

const SYSTEM_PROMPT = breadSystemPrompt(`You control a web browser through the agent-browser CLI on Bread's behalf.

RULES:
- You MUST use the agent_browser tool for every browser action. Never claim you did something without calling the tool.
- One command per tool call. Do not chain with && or ;. Do not add --json.
- Discover interactive elements with 'agent-browser snapshot -i' — it lists elements with @refs (e.g. @e3). Use those refs with click/type.
- Common commands: open <url>, snapshot -i, snapshot, click @ref, type @ref <text>, press <key>, eval "<js>", back, screenshot.
- Screenshots are captured automatically and shown to the user — do not embed image markdown.
- If a request is outside a browser's capabilities, say so honestly instead of pretending.
- When the task is complete, reply with a short plain-text summary and DO NOT call the tool.`);

// ---- environment resolution -------------------------------------------------

export function resolveAgentBrowserEntry(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = env.AGENT_BROWSER_JS?.trim();
  if (explicit && existsSync(explicit)) return explicit;
  const roots: string[] = [];
  if (env.AGENT_BROWSER_HOME?.trim()) roots.push(env.AGENT_BROWSER_HOME.trim());
  if (env.APPDATA) roots.push(path.join(env.APPDATA, "npm", "node_modules", "agent-browser"));
  if (env.npm_config_prefix) roots.push(path.join(env.npm_config_prefix, "node_modules", "agent-browser"));
  roots.push("/usr/local/lib/node_modules/agent-browser", "/usr/lib/node_modules/agent-browser");
  for (const root of roots) {
    const entry = path.join(root, "bin", "agent-browser.js");
    if (existsSync(entry)) return entry;
  }
  return null;
}

export interface RuntimeAvailability {
  available: boolean;
  entry: string | null;
  browser: string | null;
  reason?: string;
}

export function runtimeAvailability(env: NodeJS.ProcessEnv = process.env): RuntimeAvailability {
  const entry = resolveAgentBrowserEntry(env);
  const browser = resolveBrowserExecutable(env);
  if (!entry) return { available: false, entry: null, browser, reason: "agent-browser is not installed" };
  if (!browser) return { available: false, entry, browser: null, reason: "no Chrome/Edge executable found" };
  return { available: true, entry, browser };
}

function childEnv(browser: string, timeoutMs: number): NodeJS.ProcessEnv {
  // The shared profile, once someone has signed into it from the profile page.
  // agent-browser hands it to Chromium as --user-data-dir, so the run opens
  // already logged into whatever that window logged into. Absent, the run gets
  // a blank browser, which is how this behaved before the profile existed.
  const profile = activeProfileDir();
  return {
    ...process.env,
    // The dashboard may run under Electron (execPath = electron); this makes it
    // behave as plain Node for our spawns. Harmless under a real Node parent.
    ELECTRON_RUN_AS_NODE: "1",
    NO_COLOR: "1",
    AGENT_BROWSER_EXECUTABLE_PATH: browser,
    AGENT_BROWSER_IDLE_TIMEOUT_MS: String(Math.max(30_000, timeoutMs)),
    ...(profile ? { AGENT_BROWSER_PROFILE: profile } : {}),
  };
}

// ---- event plumbing ---------------------------------------------------------

function emit(run: RunState, type: string, payload: Record<string, unknown> = {}): void {
  run.seq += 1;
  const event: NormalizedEvent = { sequenceNumber: run.seq, type, payload, at: new Date().toISOString() };
  run.events.push(event);
  if (run.events.length > MAX_EVENTS) run.events.splice(0, run.events.length - MAX_EVENTS);
  for (const subscriber of run.subscribers) {
    try {
      subscriber(event);
    } catch {
      /* a slow/broken subscriber never blocks the run */
    }
  }
}

const SENSITIVE = /^(click|type|fill|press|submit|select|check|uncheck|upload|drag|tap|hover|eval|download|clear|set)\b/i;

function classifyCommand(command: string): { action: string; target: string; sensitive: boolean } {
  const stripped = command.replace(/^agent-browser\s+/, "").replace(/^--session\s+\S+\s+/, "").trim();
  const [verb, ...rest] = stripped.split(/\s+/);
  return { action: verb || "command", target: rest.join(" "), sensitive: SENSITIVE.test(stripped) };
}

function needsApproval(mode: ApprovalMode, sensitive: boolean): boolean {
  if (mode === "none") return false;
  if (mode === "every_action") return true;
  return sensitive;
}

function riskOf(action: string): string {
  if (/^(eval|download|upload|submit)$/i.test(action)) return "high";
  if (/^(click|type|fill|press|select|check|set)$/i.test(action)) return "medium";
  return "low";
}

// ---- command execution ------------------------------------------------------

/** Minimal, shell-free tokenizer (handles single/double quotes). */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return tokens;
}

/** Run one agent-browser command against the run's session; return its output. */
function execCommand(
  entry: string,
  config: AgentBrowserConfiguration,
  browser: string,
  session: string,
  command: string,
): Promise<string> {
  // Only the first statement is honored (mirror agent-browser's chat executor).
  const single = command.split("&&")[0].split(";")[0].trim();
  const stripped = single.replace(/^agent-browser\s+/, "");
  const words = tokenize(stripped).filter((word) => word !== "--json");
  const hasSession = words.includes("--session");
  const args = [entry, ...(hasSession ? [] : ["--session", session]), ...words];

  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { env: childEnv(browser, config.timeoutMs), windowsHide: true });
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (out += chunk));
    child.stderr.on("data", (chunk: string) => (err += chunk));
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* gone */
      }
    }, 60_000);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve(`Command failed: ${error.message}`);
    });
    child.on("exit", () => {
      clearTimeout(timer);
      const text = (out.trim() || err.trim() || "(no output)").replace(/\x1b\[[0-9;]*m/g, "");
      resolve(text.slice(0, MAX_TOOL_RESULT_CHARS));
    });
  });
}

// ---- ChatMock completion ----------------------------------------------------

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

interface ChatUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

async function chatCompletion(
  config: AgentBrowserConfiguration,
  messages: ChatMessage[],
): Promise<{ message: ChatMessage; usage: ChatUsage }> {
  // ChatMock's port is assigned when the desktop app starts, so an endpoint
  // stored in an agent configuration goes stale after any restart. The server
  // environment is the source of truth on every call; only a non-ChatMock
  // provider keeps its explicitly configured endpoint.
  const base = (
    isChatmockProvider(config.provider) ? chatmockGatewayBase() : (config.endpoint ?? chatmockGatewayBase())
  ).replace(/\/$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${chatmockApiKeyValue()}` },
      body: JSON.stringify({ model: config.model, messages, tools: [AGENT_BROWSER_TOOL], tool_choice: "auto" }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`model endpoint returned ${response.status}`);
    const data = (await response.json()) as {
      choices?: Array<{ message?: ChatMessage }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const message = data.choices?.[0]?.message;
    if (!message) throw new Error("model returned no message");
    return {
      message,
      usage: {
        inputTokens: data.usage?.prompt_tokens,
        outputTokens: data.usage?.completion_tokens,
        totalTokens: data.usage?.total_tokens,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---- lifecycle --------------------------------------------------------------

export interface StartRunResult {
  runId: string;
  status: RunStatus;
}

export function startRun(input: {
  userId: number;
  agentId: string;
  task: string;
  config: AgentBrowserConfiguration;
}): StartRunResult {
  const availability = runtimeAvailability();
  if (!availability.available || !availability.entry || !availability.browser) {
    throw new Error(availability.reason ?? "agent-browser runtime unavailable");
  }
  const runId = publicId("abrun");
  const run: RunState = {
    runId,
    userId: input.userId,
    agentId: input.agentId,
    session: runId,
    task: input.task,
    status: "queued",
    seq: 0,
    events: [],
    screenshotDir: screenshotDirFor(runId),
    poller: null,
    subscribers: new Set(),
    pending: null,
    aborted: false,
    finalText: "",
    createdAt: new Date().toISOString(),
  };
  runs.set(runId, run);
  void driveRun(run, input.config, availability.entry, availability.browser);
  return { runId, status: "queued" };
}

async function driveRun(
  run: RunState,
  config: AgentBrowserConfiguration,
  entry: string,
  browser: string,
): Promise<void> {
  return withCapabilityLease("browser-agent", "browser-run", () =>
    driveRunWithLease(run, config, entry, browser),
  );
}

async function driveRunWithLease(
  run: RunState,
  config: AgentBrowserConfiguration,
  entry: string,
  browser: string,
): Promise<void> {
  await mkdir(run.screenshotDir, { recursive: true }).catch(() => undefined);
  emit(run, "run.started", { task: run.task, operator: "browser" });
  run.status = "running";
  startScreenshotPoller(run, entry, config, browser);

  const deadline = Date.now() + config.timeoutMs;
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: run.task },
  ];
  // Cumulative token usage across every model call this run.
  const usageTotals = { inputTokens: 0, outputTokens: 0, totalTokens: 0, calls: 0, estimated: false };
  let lastActionLabel = "";

  try {
    for (let step = 0; step < config.maxSteps; step += 1) {
      if (run.aborted) return;
      if (Date.now() > deadline) {
        finish(run, "completed", { summary: run.finalText || "Time limit reached." });
        return;
      }

      emit(run, "agent.thinking", {
        state: "active",
        summary: lastActionLabel
          ? `Reviewing the result of ${lastActionLabel} and planning the next step`
          : "Planning the first browser action",
      });
      const { message: assistant, usage } = await chatCompletion(config, messages);
      if (run.aborted) return;

      usageTotals.calls += 1;
      usageTotals.inputTokens += usage.inputTokens ?? 0;
      usageTotals.outputTokens += usage.outputTokens ?? 0;
      usageTotals.totalTokens +=
        usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
      if (usage.totalTokens === undefined && usage.inputTokens === undefined) usageTotals.estimated = true;
      emit(run, "agent.usage", { ...usageTotals });

      const text = (assistant.content ?? "").trim();
      if (text) {
        run.finalText = text;
        emit(run, "run.status", { message: text });
      }
      messages.push({ role: "assistant", content: assistant.content ?? "", tool_calls: assistant.tool_calls });

      const toolCalls = assistant.tool_calls ?? [];
      if (toolCalls.length === 0) {
        finish(run, "completed", { summary: run.finalText || "Task complete." });
        return;
      }

      for (const call of toolCalls) {
        if (run.aborted) return;
        let command = "";
        try {
          command = String((JSON.parse(call.function.arguments || "{}") as { command?: string }).command ?? "");
        } catch {
          command = "";
        }
        if (!command) {
          messages.push({ role: "tool", tool_call_id: call.id, content: "No command provided." });
          continue;
        }

        const { action, target, sensitive } = classifyCommand(command);
        lastActionLabel = `${action}${target ? ` ${target}` : ""}`.trim().slice(0, 80);
        emit(run, "action.proposed", { action, target, command });
        const url = /https?:\/\/\S+/.exec(command)?.[0];
        if (url) emit(run, "observation.page", { url });

        if (needsApproval(config.approvalMode, sensitive)) {
          const decision = await requestApproval(run, { action, target, command });
          if (run.aborted) return;
          if (decision === "reject") {
            emit(run, "action.completed", { summary: "rejected by user", action, target });
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: "The user rejected this action. Do not retry it; choose a different approach or stop.",
            });
            continue;
          }
        }

        const result = await execCommand(entry, config, browser, run.session, command);
        if (run.aborted) return;
        emit(run, "action.completed", { summary: result.split(/\r?\n/)[0]?.slice(0, 200) || "done", action, target });
        messages.push({ role: "tool", tool_call_id: call.id, content: result });
      }
    }
    finish(run, "completed", { summary: run.finalText || "Step limit reached." });
  } catch (error) {
    if (run.aborted) return;
    finish(run, "failed", {
      message: error instanceof Error ? error.message : "run failed",
      ...(error instanceof SupervisorResourceExhaustedError ? error.result : {}),
    });
  }
}

/** Emit approval.requested and wait until a route resolves the decision. */
function requestApproval(
  run: RunState,
  info: { action: string; target: string; command: string },
): Promise<"approve" | "reject"> {
  const actionId = publicId("act");
  run.status = "awaiting_approval";
  emit(run, "approval.requested", {
    actionId,
    action: info.action,
    target: info.target,
    explanation: `agent-browser wants to run: ${info.command}`,
    risk: riskOf(info.action),
    requestedAt: new Date().toISOString(),
  });
  return new Promise<"approve" | "reject">((resolve) => {
    run.pending = {
      actionId,
      resolve: (decision) => {
        run.pending = null;
        if (run.status === "awaiting_approval") run.status = "running";
        emit(run, decision === "approve" ? "approval.approved" : "approval.rejected", { actionId });
        resolve(decision);
      },
    };
  });
}

function startScreenshotPoller(
  run: RunState,
  entry: string,
  config: AgentBrowserConfiguration,
  browser: string,
): void {
  let index = 0;
  let lastSize = -1;
  let inFlight = false;
  run.poller = setInterval(() => {
    if (inFlight || (run.status !== "running" && run.status !== "awaiting_approval")) return;
    inFlight = true;
    const current = index + 1;
    // Capture to a temp name, then keep it on disk as s{id}.png only when it is a
    // new frame — the served path is deterministic from runId + id.
    const tmp = path.join(run.screenshotDir, `capture-${current}.png`);
    const shot = spawn(process.execPath, [entry, "screenshot", tmp, "--session", run.session, "--json"], {
      env: childEnv(browser, config.timeoutMs),
      windowsHide: true,
    });
    shot.on("error", () => {
      inFlight = false;
    });
    shot.on("exit", async () => {
      try {
        const bytes = await readFile(tmp);
        if (bytes.length > 0 && bytes.length !== lastSize) {
          lastSize = bytes.length;
          index = current;
          await writeFile(path.join(run.screenshotDir, `s${current}.png`), bytes).catch(() => undefined);
          emit(run, "observation.screenshot", { screenshotId: String(current) });
        }
        await rm(tmp, { force: true }).catch(() => undefined);
      } catch {
        /* no screenshot yet */
      } finally {
        inFlight = false;
      }
    });
  }, 2_500);
}

function finish(run: RunState, status: RunStatus, payload: Record<string, unknown>): void {
  if (run.poller) {
    clearInterval(run.poller);
    run.poller = null;
  }
  run.status = status;
  // Freeze the thinking timer with the run's total duration.
  emit(run, "agent.thinking", {
    state: "completed",
    durationMs: Math.max(0, Date.now() - Date.parse(run.createdAt)),
    summary: status === "completed" ? "Finished the task" : `Run ${status}`,
  });
  emit(run, status === "completed" ? "run.completed" : status === "aborted" ? "run.aborted" : "run.failed", payload);
  void closeSession(run).catch(() => undefined);
  // Keep screenshots + run readable for a grace period so a just-finished card
  // (and late reconnects) can still load them, then clean up together.
  setTimeout(() => {
    runs.delete(run.runId);
    void rm(run.screenshotDir, { recursive: true, force: true }).catch(() => undefined);
  }, 10 * 60 * 1000);
}

/** Best-effort: close the browser session so no daemon/browser leaks. */
function closeSession(run: RunState): Promise<void> {
  const availability = runtimeAvailability();
  if (!availability.entry || !availability.browser) return Promise.resolve();
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [availability.entry as string, "close", "--session", run.session],
      { env: childEnv(availability.browser as string, 30_000), windowsHide: true },
    );
    child.on("error", () => resolve());
    child.on("exit", () => resolve());
    setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* gone */
      }
      resolve();
    }, 15_000);
  });
}

// ---- read/control API (used by routes) --------------------------------------

function ownedRun(userId: number, runId: string): RunState | null {
  const run = runs.get(runId);
  if (!run || run.userId !== userId) return null;
  return run;
}

export function getEventsSince(userId: number, runId: string, since: number): NormalizedEvent[] {
  const run = ownedRun(userId, runId);
  if (!run) return [];
  return run.events.filter((event) => event.sequenceNumber > since);
}

export function isTerminal(userId: number, runId: string): boolean {
  const run = ownedRun(userId, runId);
  return !run || run.status === "completed" || run.status === "failed" || run.status === "aborted";
}

/**
 * Is any run still holding a browser? Asked before the profile is opened for a
 * sign-in or wiped, since both would be fighting a live run for the same
 * --user-data-dir.
 */
export function hasActiveRun(): boolean {
  for (const run of runs.values()) {
    if (run.status === "queued" || run.status === "running" || run.status === "awaiting_approval") return true;
  }
  return false;
}

/**
 * Read a screenshot from disk by its deterministic runId-derived path. Works
 * across workers/reloads (shared filesystem) and does not depend on in-memory
 * run state. `screenshotId` is constrained to digits, so it cannot traverse.
 */
export async function getScreenshot(runId: string, screenshotId: string): Promise<Buffer | null> {
  if (!/^[0-9]{1,6}$/.test(screenshotId) || !/^[A-Za-z0-9_-]{1,80}$/.test(runId)) return null;
  try {
    return await readFile(path.join(screenshotDirFor(runId), `s${screenshotId}.png`));
  } catch {
    return null;
  }
}

/** Resolve a pending approval. Returns false when there is nothing to decide. */
export function decideApproval(
  userId: number,
  runId: string,
  actionId: string,
  decision: "approve" | "reject",
): boolean {
  const run = ownedRun(userId, runId);
  if (!run || !run.pending || run.pending.actionId !== actionId) return false;
  run.pending.resolve(decision);
  return true;
}

export function abortRun(userId: number, runId: string): boolean {
  const run = ownedRun(userId, runId);
  if (!run) return false;
  if (run.status === "running" || run.status === "queued" || run.status === "awaiting_approval") {
    run.aborted = true;
    run.pending?.resolve("reject");
    finish(run, "aborted", {});
  }
  return true;
}
