// In-memory run manager for the Career Ops agent. Breadboard drives the loop
// itself: it calls ChatMock (OpenAI-compatible) with five tools — run one of the
// clone's scripts, read a mode, read a file, list a directory, write a file —
// and executes each proposed call against the career-ops workspace.
//
// Driving the loop here rather than shelling out to an agent CLI is what makes
// the policy in ./commands.ts enforceable: every command passes through
// parseCommand before any process is spawned, every write passes through
// resolveWritablePath, and nothing is ever handed to a shell.
//
// Runs are ephemeral; the workspace they act on is not. Events live here and the
// SSE route replays them, but the tracker, reports and PDFs a run produces stay
// in the clone, which is the entire point of the tool.

import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { chatmockApiKeyValue } from "../agent-browser/provider.ts";
import {
  availableScripts,
  parseCommand,
  resolveReadablePath,
  resolveWritablePath,
} from "./commands.ts";
import { parseCareerOpsRequest } from "./identity.ts";
import { buildSystemPrompt, readMode } from "./skill-prompt.ts";
import {
  health,
  invalidateHealth,
  resolveCareerOpsRoot,
  runNode,
  type CareerOpsHealth,
} from "./runtime.ts";
import { promptWithContext } from "../conversations/agent-context.ts";

export interface CareerOpsEvent {
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
  root: string;
  status: RunStatus;
  sequence: number;
  events: CareerOpsEvent[];
  killChild: (() => void) | null;
  aborted: boolean;
  finalText: string;
  /** Workspace-relative paths this run wrote, in order. */
  written: string[];
  createdAt: number;
}

const globalRuns = globalThis as typeof globalThis & {
  __breadboardCareerOpsRuns?: Map<string, RunState>;
};
const runs = globalRuns.__breadboardCareerOpsRuns ?? new Map<string, RunState>();
globalRuns.__breadboardCareerOpsRuns = runs;

const MAX_EVENTS = 5_000;
const MAX_TOOL_RESULT_CHARS = 24_000;
const MAX_FILE_CHARS = 60_000;
const MAX_WRITE_CHARS = 400_000;
// Portal scans drive a real browser across dozens of career pages, so they are
// minutes-long by design. Everything else finishes in seconds.
const COMMAND_TIMEOUT_MS = 600_000;
const MODEL_TIMEOUT_MS = 300_000;
const RETENTION_MS = 30 * 60 * 1000;

const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "career_ops",
      description:
        "Run one career-ops script in the workspace, exactly as the mode instructions write it. One command per call; no shell chaining, redirection, or package managers.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description:
              "The command to run, e.g. 'node tracker.mjs', 'node set-status.mjs 42 Applied --on 2026-08-01', 'node generate-pdf.mjs cv.html output/cv.pdf'.",
          },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "read_mode",
      description:
        "Read the instructions for one career-ops router mode before doing its work, e.g. 'oferta', 'pdf', 'interview/plan'.",
      parameters: {
        type: "object",
        properties: {
          mode: { type: "string", description: "Mode name from the routing table." },
        },
        required: ["mode"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "read_file",
      description:
        "Read a file in the career-ops workspace — cv.md, config/profile.yml, data/applications.md, a report, docs/SCRIPTS.md, a template.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Workspace-relative path, e.g. 'data/applications.md'.",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_files",
      description: "List a directory in the career-ops workspace, e.g. 'reports' or 'output'.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Workspace-relative directory. Omit for the workspace root.",
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "write_file",
      description:
        "Write a file in the career-ops workspace — an evaluation report, a cover letter, a tailored cv.html, a profile file. Writes the whole file; there is no append.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Workspace-relative path, e.g. 'reports/042-company-role.md'.",
          },
          content: { type: "string", description: "The complete file contents." },
        },
        required: ["path", "content"],
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

// ---- workspace tools --------------------------------------------------------

async function readWorkspaceFile(run: RunState, requested: string): Promise<string> {
  const decision = resolveReadablePath(requested, run.root);
  if (!decision.ok) return decision.reason;
  try {
    const content = await readFile(decision.path.absolute, "utf8");
    if (!content.trim()) return "(the file is empty)";
    return content.length > MAX_FILE_CHARS
      ? `${content.slice(0, MAX_FILE_CHARS)}\n\n(truncated at ${MAX_FILE_CHARS} characters)`
      : content;
  } catch {
    return `There is no ${decision.path.relative} in this workspace. Use list_files to see what is there.`;
  }
}

async function listWorkspace(run: RunState, requested: string): Promise<string> {
  const decision = resolveReadablePath(requested || ".", run.root);
  if (!decision.ok) return decision.reason;
  try {
    const entries = await readdir(decision.path.absolute, { withFileTypes: true });
    if (!entries.length) return "(the directory is empty)";
    const rows = await Promise.all(
      entries
        .filter((entry) => entry.name !== "node_modules" && entry.name !== ".git")
        .slice(0, 400)
        .map(async (entry) => {
          if (entry.isDirectory()) return `${entry.name}/`;
          try {
            const info = await stat(path.join(decision.path.absolute, entry.name));
            return `${entry.name}  ${info.size.toLocaleString()} bytes`;
          } catch {
            return entry.name;
          }
        }),
    );
    return rows.join("\n");
  } catch {
    return `There is no ${decision.path.relative || "."} directory in this workspace.`;
  }
}

async function writeWorkspaceFile(
  run: RunState,
  requested: string,
  content: string,
): Promise<string> {
  const decision = resolveWritablePath(requested, run.root);
  if (!decision.ok) return decision.reason;
  if (content.length > MAX_WRITE_CHARS) return "That file is too large to write in one call.";
  try {
    await mkdir(path.dirname(decision.path.absolute), { recursive: true });
    await writeFile(decision.path.absolute, content, "utf8");
    if (!run.written.includes(decision.path.relative)) run.written.push(decision.path.relative);
    // The setup state can change the moment cv.md or profile.yml appears.
    if (/^(cv\.md|config\/profile\.yml|modes\/_profile\.md)$/.test(decision.path.relative)) {
      invalidateHealth();
    }
    return `Wrote ${decision.path.relative} (${content.length.toLocaleString()} characters).`;
  } catch (error) {
    return `Could not write ${decision.path.relative}: ${error instanceof Error ? error.message : "unknown error"}`;
  }
}

async function execute(run: RunState, args: string[]): Promise<string> {
  const result = await runNode(run.root, args, COMMAND_TIMEOUT_MS, {
    maxOutputChars: MAX_TOOL_RESULT_CHARS * 2,
    onChild: (kill) => {
      run.killChild = kill;
    },
  });
  run.killChild = null;
  if (result.timedOut) {
    return `The command timed out after ${COMMAND_TIMEOUT_MS / 60_000} minutes and was stopped.`;
  }
  const clean = (value: string) => value.replace(/\x1b\[[0-9;]*m/g, "").trim();
  const out = clean(result.stdout);
  const err = clean(result.stderr);
  if (out) {
    const text = result.code === 0 ? out : `${out}\n\n(exit code ${result.code})\n${err}`.trim();
    return text.slice(0, MAX_TOOL_RESULT_CHARS);
  }
  if (err) return err.slice(0, MAX_TOOL_RESULT_CHARS);
  return result.code === 0
    ? "(the command produced no output)"
    : `The command exited with code ${result.code}.`;
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
  /** The chat this was launched from, so a task can refer back to it. */
  conversationContext?: string;
}

export function startRun(input: StartRunInput): { runId: string; status: RunStatus } {
  const runtime = resolveCareerOpsRoot();
  if (!runtime) throw new Error("The career-ops clone was not found next to the dashboard.");

  const runId = `corun_${randomUUID().replaceAll("-", "")}`;
  const run: RunState = {
    runId,
    userId: input.userId,
    task: input.task,
    root: runtime.root,
    status: "queued",
    sequence: 0,
    events: [],
    killChild: null,
    aborted: false,
    finalText: "",
    written: [],
    createdAt: Date.now(),
  };
  runs.set(runId, run);
  void drive(run, input).catch((error: unknown) => {
    if (run.aborted) return;
    run.status = "failed";
    emit(run, "run.failed", {
      error: error instanceof Error ? error.message : "The Career Ops run failed.",
      elapsedSec: (Date.now() - run.createdAt) / 1_000,
    });
  });
  return { runId, status: "queued" };
}

async function drive(run: RunState, input: StartRunInput): Promise<void> {
  const request = parseCareerOpsRequest(run.task);
  emit(run, "run.started", { task: run.task, model: input.model, mode: request.mode });
  run.status = "running";

  emit(run, "workspace.checking", {});
  let snapshot: CareerOpsHealth;
  try {
    snapshot = await health();
  } catch {
    snapshot = {
      available: true,
      cloned: true,
      root: run.root,
      dependenciesInstalled: true,
      browsersInstalled: false,
      onboarding: null,
      modeCount: 0,
      trackedApplications: null,
      reason: null,
    };
  }
  if (run.aborted) return;
  if (!snapshot.dependenciesInstalled) {
    throw new Error(
      snapshot.reason ?? "career-ops's dependencies are not installed; install them from the Agents tab.",
    );
  }
  emit(run, "workspace.checked", {
    onboardingNeeded: snapshot.onboarding?.onboardingNeeded ?? false,
    missing: snapshot.onboarding?.missing ?? [],
    browsersInstalled: snapshot.browsersInstalled,
    trackedApplications: snapshot.trackedApplications,
  });

  const scripts = availableScripts(run.root);
  const { prompt, preloadedMode } = buildSystemPrompt({
    root: run.root,
    health: snapshot,
    mode: request.mode,
    scripts,
  });
  emit(run, "mode.resolved", { mode: request.mode, preloaded: Boolean(preloadedMode) });

  const messages: ChatMessage[] = [
    { role: "system", content: prompt },
    {
      role: "user",
      content: promptWithContext(request.task || run.task, input.conversationContext),
    },
  ];

  const usage = { inputTokens: 0, outputTokens: 0, calls: 0 };
  const maxSteps = Math.min(Math.max(input.maxSteps ?? 24, 1), 60);

  for (let step = 0; step < maxSteps; step += 1) {
    if (run.aborted) return;
    emit(run, "agent.thinking", {
      state: "active",
      step: step + 1,
      summary: step === 0 ? "Reading the workspace and the mode" : "Reviewing what came back",
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
        summary: run.finalText || "Career Ops finished without an answer.",
        written: run.written,
        ...usage,
      });
      return;
    }

    for (const call of toolCalls) {
      if (run.aborted) return;
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
      } catch {
        parsed = {};
      }
      const text = (key: string): string =>
        typeof parsed[key] === "string" ? (parsed[key] as string) : "";
      const result = await runTool(run, call.function.name, text);
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }

  finish(run, "completed", {
    summary: run.finalText || "Career Ops reached its step limit before answering.",
    written: run.written,
    ...usage,
  });
}

/** Execute one tool call and return the text the model sees. */
async function runTool(
  run: RunState,
  name: string,
  text: (key: string) => string,
): Promise<string> {
  if (name === "read_mode") {
    const mode = text("mode");
    emit(run, "step.started", { kind: "mode", display: `read mode ${mode}` });
    const body = mode ? readMode(run.root, mode) : null;
    emit(run, "step.completed", {
      kind: "mode",
      display: `read mode ${mode}`,
      detail: body ? `${body.length.toLocaleString()} characters` : "not found",
    });
    return (
      body ??
      `There is no \`${mode}\` mode in this clone. The routing table in the skill lists the modes it ships.`
    );
  }

  if (name === "read_file") {
    const requested = text("path");
    emit(run, "step.started", { kind: "read", display: `read ${requested}` });
    const content = requested ? await readWorkspaceFile(run, requested) : "No path was provided.";
    emit(run, "step.completed", {
      kind: "read",
      display: `read ${requested}`,
      detail: `${content.length.toLocaleString()} characters`,
    });
    return content;
  }

  if (name === "list_files") {
    const requested = text("path");
    const display = `list ${requested || "."}`;
    emit(run, "step.started", { kind: "read", display });
    const listing = await listWorkspace(run, requested);
    emit(run, "step.completed", {
      kind: "read",
      display,
      detail: `${listing.split("\n").length} entries`,
    });
    return listing;
  }

  if (name === "write_file") {
    const requested = text("path");
    const display = `write ${requested}`;
    emit(run, "step.started", { kind: "write", display });
    const outcome = requested
      ? await writeWorkspaceFile(run, requested, text("content"))
      : "No path was provided.";
    emit(run, "step.completed", { kind: "write", display, detail: outcome });
    return outcome;
  }

  if (name !== "career_ops") {
    return `${name} is not a tool this run has. Use career_ops, read_mode, read_file, list_files, or write_file.`;
  }

  const raw = text("command");
  const decision = parseCommand(raw, run.root);
  if (!decision.ok) {
    emit(run, "step.refused", { command: raw.slice(0, 400), reason: decision.reason });
    return decision.reason;
  }
  const { script, args, display } = decision.command;
  emit(run, "step.started", { kind: "command", script, display });
  const output = await execute(run, args);
  if (run.aborted) return output;
  emit(run, "step.completed", {
    kind: "command",
    script,
    display,
    detail: output.split(/\r?\n/).filter(Boolean).slice(0, 2).join(" ").slice(0, 200),
  });
  // A script can create the tracker or the profile, which changes the badge the
  // Agents tab shows.
  invalidateHealth();
  return output;
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
  // The workspace is the user's clone and must survive; only the event log is
  // ours to drop. `unref` so a pending timer never holds the process open.
  const timer = setTimeout(() => runs.delete(run.runId), RETENTION_MS);
  timer.unref?.();
}

// ---- read/control API -------------------------------------------------------

export function getEventsSince(userId: number, runId: string, since = 0): CareerOpsEvent[] {
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
    run.killChild?.();
  } catch {
    // It may have exited between the state check and the kill.
  }
  run.killChild = null;
  emit(run, "run.aborted", {
    summary: "Career Ops stopped.",
    written: run.written,
    elapsedSec: (Date.now() - run.createdAt) / 1_000,
  });
  scheduleCleanup(run);
  return true;
}
