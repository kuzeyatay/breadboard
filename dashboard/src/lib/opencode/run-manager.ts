import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  spawn,
  spawnSync,
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import type { ChatMessageAttachment } from "../chat-attachments.ts";
import { finalizeRunSnapshot } from "../agent-edits/snapshot.ts";

export interface OpenCodeEvent {
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
  repositoryPath: string;
  repositoryName: string;
  gardenSlug: string;
  status: RunStatus;
  sequence: number;
  events: OpenCodeEvent[];
  child: ChildProcess | null;
  stderr: string;
  output: string[];
  startedAt: number;
  toolCount: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  runtimeError: string;
  sessionId: string;
  cleanup: (() => void) | null;
}

interface Launcher {
  command: string;
  prefix: string[];
  version: string;
}

const globalRuns = globalThis as typeof globalThis & {
  __breadboardOpenCodeRuns?: Map<string, RunState>;
};
const runs = globalRuns.__breadboardOpenCodeRuns ?? new Map<string, RunState>();
globalRuns.__breadboardOpenCodeRuns = runs;

const MAX_EVENTS = 5_000;
const MAX_STDERR = 32_000;
const MAX_OUTPUT_PARTS = 200;
const MAX_OPENCODE_IMAGES = 4;
const MAX_OPENCODE_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_LAUNCH_ATTEMPTS = 4;
const TRANSIENT_RETRY_DELAYS_MS = [2_000, 8_000, 20_000] as const;

export function isTransientOpenCodeFailure(value: string): boolean {
  return /(?:overload|too many requests|rate.?limit|\b429\b|\b502\b|\b503\b|\b504\b|temporar(?:y|ily) unavailable|capacity|service unavailable|gateway timeout)/i.test(
    value,
  );
}

function retryDelayMs(attempt: number): number {
  return (
    TRANSIENT_RETRY_DELAYS_MS[
      Math.min(Math.max(attempt - 1, 0), TRANSIENT_RETRY_DELAYS_MS.length - 1)
    ] ?? TRANSIENT_RETRY_DELAYS_MS[TRANSIENT_RETRY_DELAYS_MS.length - 1]
  );
}

function resumeInstruction(task: string): string {
  return [
    "The model provider interrupted the previous turn with a transient availability error.",
    "Continue the existing task from the current session and repository state.",
    "Do not repeat completed edits or rerun successful work unless verification requires it.",
    `Original task: ${task}`,
  ].join("\n");
}

type OpenCodeImageAttachment = Extract<
  ChatMessageAttachment,
  { type: "image" }
>;

function materializeImageAttachments(
  repositoryPath: string,
  attachments: readonly OpenCodeImageAttachment[],
): { paths: string[]; cleanup: () => void } {
  if (attachments.length === 0) return { paths: [], cleanup: () => undefined };
  const repositoryRoot = path.resolve(repositoryPath);
  const temporaryDirectory = mkdtempSync(
    path.join(repositoryRoot, ".breadboard-opencode-"),
  );
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    const resolved = path.resolve(temporaryDirectory);
    const expectedPrefix = `${repositoryRoot}${path.sep}.breadboard-opencode-`;
    if (resolved.startsWith(expectedPrefix)) {
      rmSync(resolved, { recursive: true, force: true });
    }
  };

  try {
    const paths = attachments.slice(0, MAX_OPENCODE_IMAGES).map((attachment, index) => {
      const match = attachment.dataUrl.match(
        /^data:image\/(png|jpeg|webp|gif);base64,([a-z0-9+/=\s]+)$/i,
      );
      if (!match) throw new Error("invalid_image_attachment");
      const bytes = Buffer.from(match[2].replace(/\s/g, ""), "base64");
      if (bytes.length === 0 || bytes.length > MAX_OPENCODE_IMAGE_BYTES) {
        throw new Error("image_attachment_too_large");
      }
      const extension = match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase();
      const filePath = path.join(temporaryDirectory, `screenshot-${index + 1}.${extension}`);
      writeFileSync(filePath, bytes, { flag: "wx" });
      return filePath;
    });
    return { paths, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}

function imageInstruction(repositoryPath: string, paths: readonly string[]): string {
  if (paths.length === 0) return "";
  const relativePaths = paths.map((filePath) => path.relative(repositoryPath, filePath));
  return [
    "The user attached screenshot images for this task.",
    "Inspect each image with OpenCode's image/file reader before making changes:",
    ...relativePaths.map((filePath) => `- ${filePath}`),
    "Treat these files as read-only run inputs. They are removed automatically when the run finishes.",
  ].join("\n");
}

function resolveOpenCodeRoot(env: NodeJS.ProcessEnv = process.env): string | null {
  const candidates = [
    env.OPENCODE_ROOT?.trim(),
    path.resolve(process.cwd(), "opencode"),
    path.resolve(process.cwd(), "..", "opencode"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  return (
    candidates.find((candidate) =>
      existsSync(path.join(candidate, "packages", "opencode", "package.json")),
    ) ?? null
  );
}

function resolveConfigPath(env: NodeJS.ProcessEnv = process.env): string | null {
  const candidates = [
    env.BREADBOARD_OPENCODE_CONFIG?.trim(),
    path.resolve(process.cwd(), "opencode-config", "opencode.json"),
    path.resolve(process.cwd(), "..", "opencode-config", "opencode.json"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

/**
 * OpenCode resolves `--model chatmock/<id>` against the `models` map its
 * config declares, and fails the run outright when the id is missing — the
 * failure surfaces as a bare "Unexpected server error". Breadboard's model
 * picker is a live ChatMock catalog (provider-prefixed ids like
 * `cliproxy/claude-opus-5` included), so the static map can never keep up.
 * Declaring the requested model per run is what keeps the two in step.
 */
export function withRequestedModel(
  config: Record<string, unknown>,
  model: string,
): { config: Record<string, unknown>; changed: boolean } {
  const providers =
    config.provider && typeof config.provider === "object" && !Array.isArray(config.provider)
      ? (config.provider as Record<string, unknown>)
      : null;
  const chatmock =
    providers?.chatmock && typeof providers.chatmock === "object" && !Array.isArray(providers.chatmock)
      ? (providers.chatmock as Record<string, unknown>)
      : null;
  const models =
    chatmock?.models && typeof chatmock.models === "object" && !Array.isArray(chatmock.models)
      ? (chatmock.models as Record<string, unknown>)
      : null;
  if (!models || !model || Object.hasOwn(models, model)) {
    return { config, changed: false };
  }

  // The `default` entry is the shape every ChatMock model shares: reasoning
  // variants for `--variant`, and image input for `--file` attachments.
  const template =
    models.default && typeof models.default === "object" && !Array.isArray(models.default)
      ? (models.default as Record<string, unknown>)
      : {
          reasoning: true,
          attachment: true,
          modalities: { input: ["text", "image"], output: ["text"] },
          variants: Object.fromEntries(
            ["none", "low", "medium", "high", "xhigh", "max"].map((effort) => [
              effort,
              { reasoningEffort: effort },
            ]),
          ),
        };

  return {
    config: {
      ...config,
      provider: {
        ...providers,
        chatmock: {
          ...chatmock,
          models: { ...models, [model]: { ...template, name: model } },
        },
      },
    },
    changed: true,
  };
}

function runConfigPath(
  basePath: string,
  model: string,
): { path: string; cleanup: () => void } {
  const noCleanup = { path: basePath, cleanup: () => undefined };
  let parsed: Record<string, unknown>;
  try {
    const value = JSON.parse(readFileSync(basePath, "utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return noCleanup;
    parsed = value as Record<string, unknown>;
  } catch {
    // An unreadable config is OpenCode's problem to report, not ours to mask.
    return noCleanup;
  }

  const { config, changed } = withRequestedModel(parsed, model);
  if (!changed) return noCleanup;

  // Outside the repository: a config file inside it would land in the run's
  // own undo snapshot and diff.
  const directory = mkdtempSync(path.join(tmpdir(), "breadboard-opencode-config-"));
  const filePath = path.join(directory, "opencode.json");
  writeFileSync(filePath, JSON.stringify(config, null, 2), "utf8");
  return {
    path: filePath,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

function clonedVersion(root: string): string {
  const parsed = JSON.parse(
    readFileSync(path.join(root, "packages", "opencode", "package.json"), "utf8"),
  ) as { version?: unknown };
  return typeof parsed.version === "string" && parsed.version.trim()
    ? parsed.version.trim()
    : "latest";
}

function commandWorks(command: string): boolean {
  const probe = spawnSync(command, ["--version"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 5_000,
  });
  return !probe.error && probe.status === 0;
}

function resolveLauncher(env: NodeJS.ProcessEnv = process.env): Launcher | null {
  const root = resolveOpenCodeRoot(env);
  if (!root) return null;
  const version = clonedVersion(root);
  const configured = env.OPENCODE_BIN?.trim();
  if (configured && commandWorks(configured)) {
    return { command: configured, prefix: [], version };
  }
  if (commandWorks("opencode")) {
    return { command: "opencode", prefix: [], version };
  }
  const bunx = process.platform === "win32" ? "bunx.exe" : "bunx";
  if (!commandWorks(bunx)) return null;
  return {
    command: bunx,
    prefix: ["--bun", `opencode-ai@${version}`],
    version,
  };
}

export function runtimeAvailability(env: NodeJS.ProcessEnv = process.env): {
  available: boolean;
  installed: boolean;
  reason?: string;
  version?: string;
} {
  const root = resolveOpenCodeRoot(env);
  if (!root) {
    return { available: false, installed: false, reason: "OpenCode clone was not found" };
  }
  if (!resolveConfigPath(env)) {
    return {
      available: false,
      installed: true,
      reason: "Breadboard's OpenCode configuration is missing",
    };
  }
  const launcher = resolveLauncher(env);
  if (!launcher) {
    return {
      available: false,
      installed: true,
      reason: "Install OpenCode or Bun so Breadboard can launch the cloned version",
    };
  }
  return { available: true, installed: true, version: launcher.version };
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

function runtimeErrorMessage(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 2_000);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return boundedText(value, 2_000);
  }
  const error = value as Record<string, unknown>;
  const data =
    error.data && typeof error.data === "object" && !Array.isArray(error.data)
      ? (error.data as Record<string, unknown>)
      : {};
  for (const candidate of [
    data.message,
    data.error,
    error.message,
    error.error,
    error.name,
  ]) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim().slice(0, 2_000);
    }
  }
  return boundedText(value, 2_000);
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : undefined;
}

function ingestOpenCodeEvent(run: RunState, value: Record<string, unknown>): void {
  const sessionId = boundedText(value.sessionID, 240).trim();
  if (/^[A-Za-z0-9_-]+$/.test(sessionId)) run.sessionId = sessionId;

  if (value.type === "text" && value.part && typeof value.part === "object") {
    const text = boundedText((value.part as Record<string, unknown>).text, 100_000).trim();
    if (!text) return;
    run.output.push(text);
    if (run.output.length > MAX_OUTPUT_PARTS) run.output.shift();
    emit(run, "text.completed", { text });
    return;
  }
  if (value.type === "reasoning" && value.part && typeof value.part === "object") {
    const text = boundedText((value.part as Record<string, unknown>).text, 4_000).trim();
    if (text) emit(run, "reasoning.completed", { text });
    return;
  }
  if (value.type === "tool_use" && value.part && typeof value.part === "object") {
    const part = value.part as Record<string, unknown>;
    const state =
      part.state && typeof part.state === "object"
        ? (part.state as Record<string, unknown>)
        : {};
    run.toolCount += 1;
    emit(run, "tool.completed", {
      tool: boundedText(part.tool, 120) || "tool",
      status: boundedText(state.status, 40) || "completed",
      title: boundedText(
        state.title ??
          (state.metadata && typeof state.metadata === "object"
            ? (state.metadata as Record<string, unknown>).title
            : undefined),
        240,
      ),
      summary: boundedText(state.output ?? state.error, 800),
    });
    return;
  }
  if (value.type === "step_start") {
    emit(run, "step.started");
    return;
  }
  if (value.type === "step_finish") {
    const part =
      value.part && typeof value.part === "object"
        ? (value.part as Record<string, unknown>)
        : {};
    const tokens =
      part.tokens && typeof part.tokens === "object"
        ? (part.tokens as Record<string, unknown>)
        : {};
    const reportedInput = tokenCount(tokens.input);
    const reportedOutput = tokenCount(tokens.output);
    const reportedReasoning = tokenCount(tokens.reasoning);
    const reportedTotal = tokenCount(tokens.total);
    if (
      reportedInput !== undefined ||
      reportedOutput !== undefined ||
      reportedReasoning !== undefined ||
      reportedTotal !== undefined
    ) {
      const inputTokens = reportedInput ?? 0;
      const outputTokens = reportedOutput ?? 0;
      const reasoningTokens = reportedReasoning ?? 0;
      const totalTokens =
        reportedTotal ?? inputTokens + outputTokens + reasoningTokens;
      run.inputTokens += inputTokens;
      run.outputTokens += outputTokens;
      run.reasoningTokens += reasoningTokens;
      run.totalTokens += totalTokens;
      emit(run, "agent.usage", {
        inputTokens: run.inputTokens,
        outputTokens: run.outputTokens,
        reasoningTokens: run.reasoningTokens,
        totalTokens: run.totalTokens,
        estimated: false,
      });
    }
    emit(run, "step.completed");
    return;
  }
  if (value.type === "error") {
    run.runtimeError = runtimeErrorMessage(value.error);
    emit(run, "runtime.error", { error: run.runtimeError });
  }
}

export function startRun(input: {
  userId: number;
  task: string;
  instruction?: string;
  skill?: {
    id: string;
    slug: string;
    contentHash?: string;
  };
  model: string;
  reasoningEffort: string;
  baseUrl: string;
  apiKey: string;
  repositoryPath: string;
  repositoryName: string;
  gardenSlug: string;
  attachments?: readonly OpenCodeImageAttachment[];
}): { runId: string; status: RunStatus } {
  const availability = runtimeAvailability();
  const launcher = resolveLauncher();
  const configPath = resolveConfigPath();
  if (!availability.available || !launcher || !configPath) {
    throw new Error(availability.reason ?? "OpenCode runtime unavailable");
  }

  const runId = `ocrun_${randomUUID().replaceAll("-", "")}`;
  const run: RunState = {
    runId,
    userId: input.userId,
    task: input.task,
    repositoryPath: input.repositoryPath,
    repositoryName: input.repositoryName,
    gardenSlug: input.gardenSlug,
    status: "queued",
    sequence: 0,
    events: [],
    child: null,
    stderr: "",
    output: [],
    startedAt: Date.now(),
    toolCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    runtimeError: "",
    sessionId: "",
    cleanup: null,
  };
  runs.set(runId, run);

  const runConfig = runConfigPath(configPath, input.model);

  let materialized: ReturnType<typeof materializeImageAttachments>;
  try {
    materialized = materializeImageAttachments(
      input.repositoryPath,
      input.attachments ?? [],
    );
  } catch (error) {
    runConfig.cleanup();
    runs.delete(runId);
    throw error;
  }
  const attachmentContext = imageInstruction(
    input.repositoryPath,
    materialized.paths,
  );
  const instruction = [input.instruction ?? input.task, attachmentContext]
    .filter(Boolean)
    .join("\n\n");

  run.cleanup = () => {
    materialized.cleanup();
    runConfig.cleanup();
  };
  const cleanup = () => {
    run.cleanup?.();
    run.cleanup = null;
  };
  const failureMessage = (code: number | null) =>
    run.runtimeError ||
    run.stderr.trim().split(/\r?\n/).slice(-1)[0] ||
    `OpenCode exited with code ${code ?? "unknown"}`;

  const launchAttempt = (attempt: number, resumeSessionId = "") => {
    run.stderr = "";
    run.runtimeError = "";
    const child = spawn(
      launcher.command,
      [
        ...launcher.prefix,
        "run",
        "--format",
        "json",
        "--thinking",
        "--auto",
        "--dir",
        input.repositoryPath,
        "--model",
        `chatmock/${input.model}`,
        "--agent",
        "breadboard",
        "--variant",
        input.reasoningEffort,
        ...(resumeSessionId ? ["--session", resumeSessionId] : []),
        ...(resumeSessionId
          ? []
          : materialized.paths.flatMap((filePath) => ["--file", filePath])),
      ],
      {
        cwd: input.repositoryPath,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          OPENCODE_CONFIG: runConfig.path,
          OPENCODE_DISABLE_AUTOUPDATE: "1",
          OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
          OPENCODE_DISABLE_PROJECT_CONFIG: "1",
          OPENCODE_PURE: "1",
          CHATMOCK_BASE_URL: input.baseUrl,
          CHATMOCK_API_KEY: input.apiKey,
          CHATMOCK_MODEL: input.model,
          BREADBOARD_OPENCODE_REPO: input.repositoryPath,
          CBM_ALLOWED_ROOT: input.repositoryPath,
        },
      },
    ) as ChildProcessWithoutNullStreams;
    child.stdin.end(resumeSessionId ? resumeInstruction(input.task) : instruction);
    run.child = child;

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
            ingestOpenCodeEvent(run, value as Record<string, unknown>);
          }
        } catch {
          // Package/bootstrap logs are not part of OpenCode's JSON event stream.
        }
      }
    });
    child.stderr.on("data", (chunk: string) => {
      run.stderr = `${run.stderr}${chunk}`.slice(-MAX_STDERR);
    });
    child.on("error", (error) => {
      childErrored = true;
      if (run.child === child) run.child = null;
      cleanup();
      if (run.status === "aborted") return;
      run.status = "failed";
      emit(run, "run.failed", { error: error.message });
    });
    child.on("exit", (code) => {
      if (run.child === child) run.child = null;
      if (childErrored) return;
      if (run.status === "aborted" || run.status === "failed") {
        cleanup();
        return;
      }
      const elapsedSec = Math.max(0, (Date.now() - run.startedAt) / 1_000);
      if (code === 0) {
        cleanup();
        const summary = run.output.join("\n\n").trim() || "OpenCode completed the task.";
        run.status = "completed";
        emit(run, "run.completed", {
          summary,
          elapsedSec,
          toolCount: run.toolCount,
          repository: run.repositoryName,
        });
        return;
      }

      const error = failureMessage(code);
      const resumeSessionId =
        isTransientOpenCodeFailure(error) && run.sessionId ? run.sessionId : "";
      const bootstrapRetry =
        attempt === 1 && run.toolCount === 0 && run.output.length === 0;
      if (
        attempt < MAX_LAUNCH_ATTEMPTS &&
        (Boolean(resumeSessionId) || bootstrapRetry)
      ) {
        const delayMs = resumeSessionId ? retryDelayMs(attempt) : 750;
        emit(run, "run.retrying", {
          attempt: attempt + 1,
          maxAttempts: MAX_LAUNCH_ATTEMPTS,
          delayMs,
          resumed: Boolean(resumeSessionId),
          error,
          summary: resumeSessionId
            ? `The model provider is temporarily overloaded. Resuming this OpenCode session in ${Math.ceil(delayMs / 1_000)}s…`
            : "The model request failed before OpenCode made changes. Retrying once…",
        });
        setTimeout(() => {
          if (run.status === "aborted") {
            cleanup();
            return;
          }
          try {
            launchAttempt(attempt + 1, resumeSessionId);
          } catch (retryError) {
            cleanup();
            run.status = "failed";
            emit(run, "run.failed", {
              error:
                retryError instanceof Error
                  ? retryError.message
                  : "OpenCode retry could not start.",
            });
          }
        }, delayMs);
        return;
      }

      cleanup();
      run.status = "failed";
      emit(run, "run.failed", {
        error,
        elapsedSec,
        toolCount: run.toolCount,
      });
    });
  };

  run.status = "running";
  emit(run, "run.started", {
    model: input.model,
    repository: input.repositoryName,
    gardenSlug: input.gardenSlug,
    opencodeVersion: launcher.version,
    memory: "codebase-memory-mcp",
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

  try {
    launchAttempt(1);
  } catch (error) {
    cleanup();
    runs.delete(runId);
    throw error;
  }

  return { runId, status: run.status };
}

export function getEventsSince(
  userId: number,
  runId: string,
  since = 0,
): OpenCodeEvent[] {
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
    // The child may have exited between the state check and kill.
  }
  run.cleanup?.();
  run.cleanup = null;
  emit(run, "run.aborted", { summary: "OpenCode task stopped." });
  return true;
}
