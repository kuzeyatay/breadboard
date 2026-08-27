import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";

const PROTOCOL_VERSION = 1;
const START_MANIFEST_FILE = "start.json";
const MAX_START_MANIFEST_BYTES = 32 * 1024;
const MAX_CHECKPOINT_BYTES = 1024 * 1024;
const MAX_MODEL_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_MODEL_REQUEST_BYTES = 4 * 1024 * 1024;
const MAX_ASSISTANT_TEXT_CHARS = 64 * 1024;
const MAX_TOOL_CALLS_PER_STEP = 32;
const MAX_TOOL_RESULT_CHARS = 8_000;
const MAX_EVENTS = 5_000;
const MAX_SCREENSHOTS = 512;
const MAX_SCREENSHOT_BYTES = 16 * 1024 * 1024;
const MAX_SCREENSHOT_TOTAL_BYTES = 512 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 60_000;
const MODEL_TIMEOUT_MS = 120_000;
const CLOSE_TIMEOUT_MS = 15_000;
const SCREENSHOT_TIMEOUT_MS = 15_000;
const APPROVAL_POLL_MS = 200;
const IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/u;
const ACTION_ID = /^act_[0-9a-f]{32}$/u;
const SCREENSHOT_ID = /^[0-9]{1,6}$/u;
const APPROVAL_MODES = new Set(["sensitive_actions", "every_action", "none"]);
const ENGINES = new Set(["chrome", "lightpanda"]);
const TERMINAL_STATUSES = new Set(["completed", "failed", "aborted"]);
const SENSITIVE = /^(click|dblclick|type|fill|press|keyboard|select|check|uncheck|drag|hover|focus|eval|find|mouse|set|network|cookies|storage|tab|pushstate|close)\b/i;
const ALLOWED_COMMANDS = new Set([
  "open",
  "read",
  "click",
  "dblclick",
  "type",
  "fill",
  "press",
  "keyboard",
  "hover",
  "focus",
  "check",
  "uncheck",
  "select",
  "drag",
  "scroll",
  "scrollintoview",
  "wait",
  "screenshot",
  "snapshot",
  "eval",
  "back",
  "forward",
  "reload",
  "get",
  "is",
  "find",
  "mouse",
  "set",
  "network",
  "cookies",
  "storage",
  "tab",
  "console",
  "errors",
  "highlight",
  "a11y",
  "pushstate",
  "vitals",
  "react",
  "close",
]);
const RESERVED_OPTIONS = new Set([
  "--session",
  "--namespace",
  "--profile",
  "--restore",
  "--restore-save",
  "--restore-check-url",
  "--restore-check-text",
  "--restore-check-fn",
  "--session-name",
  "--state",
  "--auto-connect",
  "--executable-path",
  "--extension",
  "--init-script",
  "--enable",
  "--args",
  "--proxy",
  "--proxy-bypass",
  "--ignore-https-errors",
  "--allow-file-access",
  "--provider",
  "-p",
  "--device",
  "--cdp",
  "--download-path",
  "--screenshot-dir",
  "--headed",
  "--webgpu",
  "--allowed-domains",
  "--action-policy",
  "--confirm-actions",
  "--confirm-interactive",
  "--engine",
  "--config",
]);

const BREAD_ASSISTANT_IDENTITY = [
  "You are Bread, the Breadboard assistant.",
  "Your name is Bread; Breadboard is the application and Hermes is the agent runtime, not your name.",
  "If asked who you are, identify yourself as Bread. If asked which model powers you, report the authoritative resolved model separately.",
].join(" ");

const SYSTEM_PROMPT = `${BREAD_ASSISTANT_IDENTITY}\n\nYou control a web browser through the agent-browser CLI on Bread's behalf.

RULES:
- You MUST use the agent_browser tool for every browser action. Never claim you did something without calling the tool.
- One command per tool call. Do not chain with && or ;. Do not add --json.
- Discover interactive elements with 'agent-browser snapshot -i' — it lists elements with @refs (e.g. @e3). Use those refs with click/type.
- Common commands: open <url>, snapshot -i, snapshot, click @ref, type @ref <text>, press <key>, eval "<js>", back, screenshot.
- Screenshots are captured automatically and shown to the user — do not embed image markdown.
- If a request is outside a browser's capabilities, say so honestly instead of pretending.
- When the task is complete, reply with a short plain-text summary and DO NOT call the tool.`;

const AGENT_BROWSER_TOOL = {
  type: "function",
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

function fail(message) {
  throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function samePath(left, right) {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function pathWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function readBoundedJson(filePath, maximumBytes, label) {
  const metadata = fs.lstatSync(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    fail(`${label} is not a direct regular file.`);
  }
  if (metadata.size < 1 || metadata.size > maximumBytes) {
    fail(`${label} is outside its bounded size.`);
  }
  const bytes = fs.readFileSync(filePath);
  if (bytes.byteLength !== metadata.size || bytes.byteLength > maximumBytes) {
    fail(`${label} changed while it was being read.`);
  }
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    fail(`${label} is not valid JSON.`);
  }
}

function validateIdentity(value) {
  if (
    !hasExactKeys(value, ["jobId", "attempt", "workerInstanceId"]) ||
    !IDENTIFIER.test(value.jobId) ||
    !Number.isSafeInteger(value.attempt) ||
    value.attempt < 1 ||
    !IDENTIFIER.test(value.workerInstanceId)
  ) {
    fail("The Agent Browser worker identity is invalid.");
  }
  return {
    jobId: value.jobId,
    attempt: value.attempt,
    workerInstanceId: value.workerInstanceId,
  };
}

function validateExecutionScope(value) {
  if (
    !hasExactKeys(value, ["userId", "gardenId", "conversationId"]) ||
    !Number.isSafeInteger(value.userId) ||
    value.userId < 1 ||
    value.gardenId !== null ||
    typeof value.conversationId !== "string" ||
    Buffer.byteLength(value.conversationId, "utf8") > 256 ||
    !/^abr_[0-9a-f]{32}$/u.test(value.conversationId)
  ) {
    fail("Agent Browser requires exact authenticated user and agent authority.");
  }
  return {
    userId: value.userId,
    gardenId: null,
    conversationId: value.conversationId,
  };
}

function boundedString(value, maximumBytes, { empty = false } = {}) {
  return (
    typeof value === "string" &&
    (empty || value.length > 0) &&
    Buffer.byteLength(value, "utf8") <= maximumBytes &&
    !/\u0000/u.test(value)
  );
}

function validHttpUrl(value) {
  if (!boundedString(value, 2_048)) return false;
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      !parsed.username &&
      !parsed.password &&
      !parsed.hash
    );
  } catch {
    return false;
  }
}

function validateDirectFile(filePath, label, basenamePattern) {
  if (!boundedString(filePath, 4_096) || !path.isAbsolute(filePath)) {
    fail(`${label} path is invalid.`);
  }
  const metadata = fs.lstatSync(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    fail(`${label} is not a direct regular file.`);
  }
  if (!basenamePattern.test(path.basename(filePath))) {
    fail(`${label} has an unexpected executable name.`);
  }
  return fs.realpathSync.native(filePath);
}

function validateOptionalProfile(filePath) {
  if (filePath === null) return null;
  if (!boundedString(filePath, 4_096) || !path.isAbsolute(filePath)) {
    fail("The Agent Browser profile path is invalid.");
  }
  const metadata = fs.lstatSync(filePath);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    fail("The Agent Browser profile is not a direct directory.");
  }
  return fs.realpathSync.native(filePath);
}

export function validateRuntimeV2AgentBrowserRequest(value) {
  if (
    !hasExactKeys(value, [
      "task",
      "provider",
      "model",
      "modelBaseUrl",
      "maxSteps",
      "timeoutMs",
      "approvalMode",
      "allowedDomains",
      "engine",
      "agentBrowserEntry",
      "browserExecutable",
      "profilePath",
    ]) ||
    !boundedString(value.task, 8_000) ||
    !value.task.trim() ||
    !boundedString(value.provider, 64) ||
    !boundedString(value.model, 128) ||
    !validHttpUrl(value.modelBaseUrl) ||
    !Number.isSafeInteger(value.maxSteps) ||
    value.maxSteps < 1 ||
    value.maxSteps > 200 ||
    !Number.isSafeInteger(value.timeoutMs) ||
    value.timeoutMs < 5_000 ||
    value.timeoutMs > 30 * 60 * 1_000 ||
    !APPROVAL_MODES.has(value.approvalMode) ||
    !Array.isArray(value.allowedDomains) ||
    value.allowedDomains.length > 100 ||
    value.allowedDomains.some((domain) => !boundedString(domain, 253)) ||
    !ENGINES.has(value.engine)
  ) {
    fail("The Runtime V2 Agent Browser request is invalid.");
  }
  return {
    task: value.task.trim(),
    provider: value.provider,
    model: value.model,
    modelBaseUrl: value.modelBaseUrl.replace(/\/$/u, ""),
    maxSteps: value.maxSteps,
    timeoutMs: value.timeoutMs,
    approvalMode: value.approvalMode,
    allowedDomains: value.allowedDomains.map((domain) => domain.trim().toLowerCase()),
    engine: value.engine,
    agentBrowserEntry: validateDirectFile(
      value.agentBrowserEntry,
      "The agent-browser entrypoint",
      /^agent-browser\.js$/iu,
    ),
    browserExecutable: validateDirectFile(
      value.browserExecutable,
      "The browser executable",
      /^(?:chrome|msedge|microsoft-edge|chromium|chromium-browser|google-chrome|google-chrome-stable)(?:\.exe)?$/iu,
    ),
    profilePath: validateOptionalProfile(value.profilePath),
  };
}

function validateCurrentRuntimeWorker(options) {
  if (
    process.argv.length !== 3 ||
    process.argv[2] !== START_MANIFEST_FILE ||
    !isRecord(options) ||
    !hasExactKeys(options, [
      "identity",
      "executionScope",
      "dataRoot",
      "workspacePath",
      "checkpointPath",
      "request",
      "signal",
      "onFirstCheckpoint",
      "onApprovalWait",
    ])
  ) {
    fail("Agent Browser direct execution requires a sealed Runtime V2 worker launch.");
  }
  const identity = validateIdentity(options.identity);
  const executionScope = validateExecutionScope(options.executionScope);
  const launchDirectory = fs.realpathSync.native(path.resolve(process.cwd()));
  const manifest = readBoundedJson(
    path.join(launchDirectory, START_MANIFEST_FILE),
    MAX_START_MANIFEST_BYTES,
    "The Runtime V2 worker start manifest",
  );
  if (
    !hasExactKeys(manifest, [
      "protocolVersion",
      "identity",
      "executionScope",
      "inputManifestPath",
      "inputBlobs",
      "workspacePath",
      "checkpointPath",
      "resultPath",
    ]) ||
    manifest.protocolVersion !== PROTOCOL_VERSION
  ) {
    fail("Agent Browser direct execution received an invalid start manifest.");
  }
  const manifestIdentity = validateIdentity(manifest.identity);
  const manifestScope = validateExecutionScope(manifest.executionScope);
  if (
    JSON.stringify(manifestIdentity) !== JSON.stringify(identity) ||
    JSON.stringify(manifestScope) !== JSON.stringify(executionScope)
  ) {
    fail("Agent Browser direct execution is fenced to another worker attempt.");
  }
  const dataRoot = fs.realpathSync.native(path.resolve(options.dataRoot));
  const expectedAttempt = path.join(
    dataRoot,
    "runtime",
    "jobs",
    identity.jobId,
    "attempts",
    String(identity.attempt),
    identity.workerInstanceId,
  );
  const expectedWorkspace = path.join(expectedAttempt, "workspace");
  const expectedCheckpoint = path.join(
    dataRoot,
    "runtime",
    "jobs",
    identity.jobId,
    "checkpoint.json",
  );
  const historicalDashboardRoot = path.join(dataRoot, "dashboard");
  const artifactDataRoot = fs.existsSync(path.join(historicalDashboardRoot, "package.json"))
    ? historicalDashboardRoot
    : dataRoot;
  const artifactRootPath = path.join(
    artifactDataRoot,
    "agent-browser-artifacts",
    identity.jobId,
  );
  if (
    !samePath(launchDirectory, expectedAttempt) ||
    !samePath(options.workspacePath, expectedWorkspace) ||
    !samePath(options.checkpointPath, expectedCheckpoint) ||
    !pathWithin(dataRoot, expectedWorkspace) ||
    !pathWithin(dataRoot, expectedCheckpoint) ||
    !pathWithin(artifactDataRoot, artifactRootPath)
  ) {
    fail("Agent Browser direct execution escaped its fenced job workspace.");
  }
  const workspaceMetadata = fs.lstatSync(expectedWorkspace);
  if (!workspaceMetadata.isDirectory() || workspaceMetadata.isSymbolicLink()) {
    fail("Agent Browser requires a direct private worker workspace.");
  }
  if (!(options.signal instanceof AbortSignal)) {
    fail("Agent Browser direct execution requires a cancellation signal.");
  }
  if (typeof options.onFirstCheckpoint !== "function") {
    fail("Agent Browser direct execution requires a checkpoint fence.");
  }
  if (typeof options.onApprovalWait !== "function") {
    fail("Agent Browser direct execution requires an approval-wait fence.");
  }
  return {
    identity,
    executionScope,
    dataRoot,
    workspacePath: expectedWorkspace,
    checkpointPath: expectedCheckpoint,
    artifactRootPath,
    request: validateRuntimeV2AgentBrowserRequest(options.request),
    signal: options.signal,
    onFirstCheckpoint: options.onFirstCheckpoint,
    onApprovalWait: options.onApprovalWait,
  };
}

function atomicReplace(filePath, bytes, maximumBytes, label) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > maximumBytes) {
    fail(`${label} exceeded its bounded envelope.`);
  }
  const parent = path.dirname(filePath);
  const parentMetadata = fs.lstatSync(parent);
  if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink()) {
    fail(`${label} parent is unavailable.`);
  }
  const temporaryPath = `${filePath}.pending.${process.pid}.${randomUUID()}`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporaryPath, "wx", 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function delay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function tokenize(input) {
  const tokens = [];
  const expression = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = expression.exec(input)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return tokens;
}

export function sealRuntimeV2AgentBrowserCommand(command) {
  if (!boundedString(command, 8_000) || /[\r\n]/u.test(command)) {
    fail("The Agent Browser command is invalid.");
  }
  // Keep the historical one-statement behavior while retaining shell-free argv.
  const single = command.split("&&")[0].split(";")[0].trim();
  const stripped = single.replace(/^agent-browser\s+/u, "");
  const words = tokenize(stripped).filter((word) => word !== "--json");
  const verb = words[0]?.toLowerCase();
  if (!verb || !ALLOWED_COMMANDS.has(verb)) {
    fail("The Agent Browser command is outside the sealed browser-action surface.");
  }
  for (const word of words) {
    const option = word.toLowerCase();
    if (
      RESERVED_OPTIONS.has(option) ||
      [...RESERVED_OPTIONS].some((reserved) => option.startsWith(`${reserved}=`))
    ) {
      fail("The Agent Browser command attempted to override its Runtime authority.");
    }
  }
  if (verb === "close" && words.some((word) => word.toLowerCase() === "--all")) {
    fail("The Agent Browser command cannot close a sibling Runtime session.");
  }
  if (
    (verb === "cookies" && words.some((word) => word.toLowerCase() === "--curl")) ||
    (verb === "network" && words[1]?.toLowerCase() === "har")
  ) {
    fail("The Agent Browser command cannot read or write arbitrary worker files.");
  }
  if (["open", "read", "a11y", "vitals", "pushstate"].includes(verb)) {
    const target = words[1] ?? "";
    if (
      /^(?:file|data|javascript):/iu.test(target) ||
      path.isAbsolute(target) ||
      /^[A-Za-z]:[\\/]/u.test(target)
    ) {
      fail("The Agent Browser command cannot navigate to a local worker file.");
    }
  }
  return words;
}

function classifyCommand(command) {
  const stripped = command
    .replace(/^agent-browser\s+/u, "")
    .replace(/^--session\s+\S+\s+/u, "")
    .trim();
  const [verb, ...rest] = stripped.split(/\s+/u);
  return {
    action: verb || "command",
    target: rest.join(" "),
    sensitive: SENSITIVE.test(stripped),
  };
}

function needsApproval(mode, sensitive) {
  if (mode === "none") return false;
  if (mode === "every_action") return true;
  return sensitive;
}

function riskOf(action) {
  if (/^(eval|download|upload|submit)$/iu.test(action)) return "high";
  if (/^(click|type|fill|press|select|check|set)$/iu.test(action)) return "medium";
  return "low";
}

async function readBoundedResponseJson(response, maximumBytes) {
  if (!response.body) fail("The model endpoint returned no body.");
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        fail("The model response exceeded its bounded envelope.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("The model endpoint returned invalid JSON.");
  }
}

function childEnvironment(current, timeoutMs) {
  const isolatedHome = path.join(current.workspacePath, "runtime-home");
  const temporary = path.join(current.workspacePath, "tmp");
  const applicationData = path.join(isolatedHome, "app-data");
  const localApplicationData = path.join(isolatedHome, "local-app-data");
  const toolScreenshots = path.join(current.workspacePath, "tool-screenshots");
  const downloads = path.join(current.workspacePath, "downloads");
  for (const directory of [
    isolatedHome,
    temporary,
    applicationData,
    localApplicationData,
    toolScreenshots,
    downloads,
  ]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  return {
    ...(process.platform === "win32"
      ? {
          SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
          ComSpec: process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe",
        }
      : {
          ...(process.env.DISPLAY ? { DISPLAY: process.env.DISPLAY } : {}),
          ...(process.env.WAYLAND_DISPLAY
            ? { WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY }
            : {}),
          ...(process.env.XDG_RUNTIME_DIR
            ? { XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR }
            : {}),
          ...(process.env.LD_LIBRARY_PATH
            ? { LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH }
            : {}),
        }),
    PATH: process.env.PATH ?? process.env.Path ?? "",
    LANG: process.env.LANG ?? "C.UTF-8",
    ELECTRON_RUN_AS_NODE: "1",
    NO_COLOR: "1",
    HOME: isolatedHome,
    USERPROFILE: isolatedHome,
    APPDATA: applicationData,
    LOCALAPPDATA: localApplicationData,
    TMP: temporary,
    TEMP: temporary,
    AGENT_BROWSER_SESSION: current.identity.jobId,
    AGENT_BROWSER_NAMESPACE: current.identity.jobId,
    AGENT_BROWSER_EXECUTABLE_PATH: current.request.browserExecutable,
    AGENT_BROWSER_ENGINE: current.request.engine,
    AGENT_BROWSER_IDLE_TIMEOUT_MS: String(Math.max(30_000, timeoutMs)),
    AGENT_BROWSER_MAX_OUTPUT: String(MAX_TOOL_RESULT_CHARS),
    AGENT_BROWSER_SCREENSHOT_DIR: toolScreenshots,
    AGENT_BROWSER_DOWNLOAD_PATH: downloads,
    ...(current.request.profilePath
      ? { AGENT_BROWSER_PROFILE: current.request.profilePath }
      : {}),
  };
}

function runChild(current, args, timeoutMs) {
  return new Promise((resolve) => {
    if (current.signal.aborted) {
      resolve("");
      return;
    }
    const child = spawn(process.execPath, args, {
      env: childEnvironment(current, timeoutMs),
      cwd: current.workspacePath,
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    current.children.add(child);
    let output = "";
    let errorOutput = "";
    let settled = false;
    const append = (target, chunk) =>
      target.length >= MAX_TOOL_RESULT_CHARS
        ? target
        : `${target}${chunk}`.slice(0, MAX_TOOL_RESULT_CHARS);
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      output = append(output, chunk);
    });
    child.stderr?.on("data", (chunk) => {
      errorOutput = append(errorOutput, chunk);
    });
    const terminate = () => {
      try {
        child.kill();
      } catch {
        // Rust still owns the complete descendant tree.
      }
    };
    const timer = setTimeout(terminate, timeoutMs);
    const onAbort = () => terminate();
    current.signal.addEventListener("abort", onAbort, { once: true });
    const settle = (text) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      current.signal.removeEventListener("abort", onAbort);
      current.children.delete(child);
      resolve(text);
    };
    child.once("error", (error) => settle(`Command failed: ${error.message}`));
    child.once("close", () => {
      const text = (output.trim() || errorOutput.trim() || "(no output)")
        .replace(/\x1b\[[0-9;]*m/gu, "")
        .slice(0, MAX_TOOL_RESULT_CHARS);
      settle(text);
    });
  });
}

function decisionPath(current, actionId) {
  if (!ACTION_ID.test(actionId)) fail("The approval action identity is invalid.");
  const approvals = path.join(current.artifactRootPath, "approvals");
  const candidate = path.join(approvals, `${actionId}.json`);
  if (!pathWithin(approvals, candidate) || path.dirname(candidate) !== approvals) {
    fail("The approval decision escaped its durable run mailbox.");
  }
  return candidate;
}

function readApprovalDecision(current, actionId) {
  const filePath = decisionPath(current, actionId);
  if (!fs.existsSync(filePath)) return null;
  let value;
  try {
    value = readBoundedJson(filePath, 2_048, "The approval decision");
  } catch {
    // An exclusive writer may still be finishing its bounded file. Poll again.
    return null;
  }
  if (
    !hasExactKeys(value, [
      "protocolVersion",
      "jobId",
      "attempt",
      "workerInstanceId",
      "actionId",
      "decision",
      "decidedAt",
    ]) ||
    value.protocolVersion !== PROTOCOL_VERSION ||
    value.jobId !== current.identity.jobId ||
    value.attempt !== current.identity.attempt ||
    value.workerInstanceId !== current.identity.workerInstanceId ||
    value.actionId !== actionId ||
    (value.decision !== "approve" && value.decision !== "reject") ||
    typeof value.decidedAt !== "string" ||
    !Number.isFinite(Date.parse(value.decidedAt))
  ) {
    fail("The approval decision did not match its worker fence.");
  }
  return value.decision;
}

function screenshotDirectory(current) {
  const directory = path.join(current.artifactRootPath, "screenshots");
  if (!pathWithin(current.artifactRootPath, directory)) {
    fail("The screenshot directory escaped its durable artifact root.");
  }
  return directory;
}

function projectionBytes(current) {
  while (true) {
    const projection = {
      protocolVersion: PROTOCOL_VERSION,
      identity: current.identity,
      scope: {
        userId: current.executionScope.userId,
        agentId: current.executionScope.conversationId,
      },
      status: current.status,
      pendingApproval: current.pendingApproval,
      events: current.events,
    };
    const bytes = Buffer.from(`${JSON.stringify(projection)}\n`, "utf8");
    if (bytes.byteLength <= MAX_CHECKPOINT_BYTES) return { projection, bytes };
    if (current.events.length <= 1) {
      fail("The Agent Browser checkpoint exceeded its bounded envelope.");
    }
    current.events.shift();
  }
}

function persistProjection(current) {
  const { bytes } = projectionBytes(current);
  atomicReplace(
    current.checkpointPath,
    bytes,
    MAX_CHECKPOINT_BYTES,
    "The Agent Browser checkpoint",
  );
  fs.mkdirSync(current.artifactRootPath, { recursive: true });
  const artifactRootMetadata = fs.lstatSync(current.artifactRootPath);
  if (!artifactRootMetadata.isDirectory() || artifactRootMetadata.isSymbolicLink()) {
    fail("The durable Agent Browser artifact root is invalid.");
  }
  atomicReplace(
    path.join(current.artifactRootPath, "run.json"),
    bytes,
    MAX_CHECKPOINT_BYTES,
    "The durable Agent Browser run artifact",
  );
  if (!current.checkpointPublished) {
    current.checkpointPublished = true;
    current.onFirstCheckpoint();
  }
}

function emit(current, type, payload = {}) {
  current.sequence += 1;
  current.events.push({
    sequenceNumber: current.sequence,
    type,
    payload,
    at: new Date().toISOString(),
  });
  if (current.events.length > MAX_EVENTS) {
    current.events.splice(0, current.events.length - MAX_EVENTS);
  }
  persistProjection(current);
}

function stopScreenshotPoller(current) {
  if (current.screenshotTimer) {
    clearInterval(current.screenshotTimer);
    current.screenshotTimer = null;
  }
  if (current.screenshotChild) {
    try {
      current.screenshotChild.kill();
    } catch {
      // Rust retains final tree authority.
    }
    current.screenshotChild = null;
  }
}

function captureScreenshot(current) {
  if (current.screenshotCapture) return current.screenshotCapture;
  if (
    current.signal.aborted ||
    TERMINAL_STATUSES.has(current.status) ||
    current.screenshotIndex >= MAX_SCREENSHOTS ||
    current.screenshotTotalBytes >= MAX_SCREENSHOT_TOTAL_BYTES
  ) {
    return Promise.resolve(false);
  }
  const directory = screenshotDirectory(current);
  fs.mkdirSync(directory, { recursive: true });
  const directoryMetadata = fs.lstatSync(directory);
  if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()) {
    fail("The durable Agent Browser screenshot directory is invalid.");
  }
  const pendingCapture = new Promise((resolve) => {
    const next = current.screenshotIndex + 1;
    const temporary = path.join(directory, `capture-${next}.png`);
    let child;
    try {
      child = spawn(
        process.execPath,
        [
          current.request.agentBrowserEntry,
          "screenshot",
          temporary,
          "--session",
          current.identity.jobId,
          "--json",
        ],
        {
          env: childEnvironment(current, current.request.timeoutMs),
          cwd: current.workspacePath,
          windowsHide: true,
          shell: false,
          stdio: "ignore",
        },
      );
    } catch {
      fs.rmSync(temporary, { force: true });
      resolve(false);
      return;
    }
    current.screenshotChild = child;
    current.children.add(child);
    let finished = false;
    const timeout = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // Rust retains final tree authority.
      }
    }, SCREENSHOT_TIMEOUT_MS);
    const onAbort = () => {
      try {
        child.kill();
      } catch {
        // Rust retains final tree authority.
      }
    };
    current.signal.addEventListener("abort", onAbort, { once: true });
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      current.signal.removeEventListener("abort", onAbort);
      current.children.delete(child);
      if (current.screenshotChild === child) current.screenshotChild = null;
      let captured = false;
      try {
        const metadata = fs.lstatSync(temporary);
        if (
          metadata.isFile() &&
          !metadata.isSymbolicLink() &&
          metadata.size > 0 &&
          metadata.size <= MAX_SCREENSHOT_BYTES &&
          metadata.size !== current.screenshotLastSize &&
          current.screenshotTotalBytes + metadata.size <= MAX_SCREENSHOT_TOTAL_BYTES
        ) {
          const screenshotId = String(next);
          if (!SCREENSHOT_ID.test(screenshotId)) fail("The screenshot identity is invalid.");
          fs.renameSync(temporary, path.join(directory, `s${screenshotId}.png`));
          current.screenshotLastSize = metadata.size;
          current.screenshotTotalBytes += metadata.size;
          current.screenshotIndex = next;
          emit(current, "observation.screenshot", { screenshotId });
          captured = true;
        }
      } catch {
        // No complete bounded screenshot is available yet.
      } finally {
        fs.rmSync(temporary, { force: true });
        resolve(captured);
      }
    };
    child.once("error", finish);
    child.once("close", finish);
  });
  const trackedCapture = pendingCapture.finally(() => {
    if (current.screenshotCapture === trackedCapture) {
      current.screenshotCapture = null;
    }
  });
  current.screenshotCapture = trackedCapture;
  return trackedCapture;
}

function startScreenshotPoller(current) {
  current.screenshotTimer = setInterval(() => {
    void captureScreenshot(current);
  }, 2_500);
}

function trimModelHistory(messages) {
  const byteLength = () => Buffer.byteLength(JSON.stringify(messages), "utf8");
  while (messages.length > 3 && byteLength() > MAX_MODEL_REQUEST_BYTES / 2) {
    const nextAssistant = messages.findIndex(
      (message, index) => index > 2 && message?.role === "assistant",
    );
    if (nextAssistant < 0) break;
    messages.splice(2, nextAssistant - 2);
  }
}

async function chatCompletion(current, messages) {
  const controller = new AbortController();
  const onAbort = () => controller.abort(current.signal.reason);
  current.signal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);
  try {
    trimModelHistory(messages);
    const body = JSON.stringify({
      model: current.request.model,
      messages,
      tools: [AGENT_BROWSER_TOOL],
      tool_choice: "auto",
    });
    if (Buffer.byteLength(body, "utf8") > MAX_MODEL_REQUEST_BYTES) {
      fail("The model request exceeded its bounded envelope.");
    }
    const response = await fetch(`${current.request.modelBaseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer local",
      },
      body,
      signal: controller.signal,
    });
    if (!response.ok) fail(`model endpoint returned ${response.status}`);
    const data = await readBoundedResponseJson(response, MAX_MODEL_RESPONSE_BYTES);
    const message = data?.choices?.[0]?.message;
    if (!isRecord(message)) fail("model returned no message");
    return {
      message,
      usage: {
        inputTokens: data?.usage?.prompt_tokens,
        outputTokens: data?.usage?.completion_tokens,
        totalTokens: data?.usage?.total_tokens,
      },
    };
  } finally {
    clearTimeout(timer);
    current.signal.removeEventListener("abort", onAbort);
  }
}

async function executeCommand(current, words) {
  if (words[0]?.toLowerCase() === "screenshot") {
    return "Screenshot capture is automatic and is shown in the run timeline.";
  }
  return runChild(
    current,
    [
      current.request.agentBrowserEntry,
      "--session",
      current.identity.jobId,
      ...words,
    ],
    COMMAND_TIMEOUT_MS,
  );
}

async function requestApproval(current, info) {
  const actionId = `act_${randomBytes(16).toString("hex")}`;
  current.status = "awaiting_approval";
  current.pendingApproval = {
    actionId,
    action: info.action,
    target: info.target,
    explanation: `agent-browser wants to run: ${info.command}`,
    risk: riskOf(info.action),
    requestedAt: new Date().toISOString(),
  };
  emit(current, "approval.requested", current.pendingApproval);
  current.onApprovalWait();
  while (true) {
    if (current.signal.aborted) {
      throw current.signal.reason ?? new DOMException("Aborted", "AbortError");
    }
    const decision = readApprovalDecision(current, actionId);
    if (decision) {
      current.pendingApproval = null;
      current.status = "running";
      emit(
        current,
        decision === "approve" ? "approval.approved" : "approval.rejected",
        { actionId },
      );
      return decision;
    }
    await delay(APPROVAL_POLL_MS, current.signal);
  }
}

async function closeSession(current) {
  if (current.signal.aborted) return;
  await runChild(
    current,
    [
      current.request.agentBrowserEntry,
      "close",
      "--session",
      current.identity.jobId,
    ],
    CLOSE_TIMEOUT_MS,
  );
}

function finalizeProjection(current, status, payload) {
  if (TERMINAL_STATUSES.has(current.status)) return;
  stopScreenshotPoller(current);
  current.pendingApproval = null;
  current.status = status;
  emit(current, "agent.thinking", {
    state: "completed",
    durationMs: Math.max(0, Date.now() - Date.parse(current.createdAt)),
    summary: status === "completed" ? "Finished the task" : `Run ${status}`,
  });
  emit(
    current,
    status === "completed"
      ? "run.completed"
      : status === "aborted"
        ? "run.aborted"
        : "run.failed",
    payload,
  );
}

async function drive(current) {
  const artifactBase = path.dirname(current.artifactRootPath);
  fs.mkdirSync(artifactBase, { recursive: true });
  const artifactBaseMetadata = fs.lstatSync(artifactBase);
  if (!artifactBaseMetadata.isDirectory() || artifactBaseMetadata.isSymbolicLink()) {
    fail("The Agent Browser durable artifact base is invalid.");
  }
  fs.mkdirSync(current.artifactRootPath, { recursive: true });
  for (const directory of [current.artifactRootPath]) {
    const metadata = fs.lstatSync(directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      fail("The Agent Browser durable artifact authority is invalid.");
    }
  }
  const approvalDirectory = path.join(current.artifactRootPath, "approvals");
  fs.mkdirSync(approvalDirectory, { recursive: true });
  const approvalMetadata = fs.lstatSync(approvalDirectory);
  if (!approvalMetadata.isDirectory() || approvalMetadata.isSymbolicLink()) {
    fail("The Agent Browser approval mailbox is invalid.");
  }
  current.status = "running";
  emit(current, "run.started", {
    task: current.request.task,
    operator: "browser",
  });
  startScreenshotPoller(current);
  const deadline = Date.now() + current.request.timeoutMs;
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: current.request.task },
  ];
  const usageTotals = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    calls: 0,
    estimated: false,
  };
  let finalText = "";
  let lastActionLabel = "";
  try {
    for (let step = 0; step < current.request.maxSteps; step += 1) {
      if (current.signal.aborted) {
        return { status: "aborted", payload: {} };
      }
      if (Date.now() > deadline) {
        return {
          status: "completed",
          payload: { summary: finalText || "Time limit reached." },
        };
      }
      emit(current, "agent.thinking", {
        state: "active",
        summary: lastActionLabel
          ? `Reviewing the result of ${lastActionLabel} and planning the next step`
          : "Planning the first browser action",
      });
      const { message: assistant, usage } = await chatCompletion(current, messages);
      if (current.signal.aborted) return { status: "aborted", payload: {} };
      usageTotals.calls += 1;
      usageTotals.inputTokens += Number.isFinite(usage.inputTokens) ? usage.inputTokens : 0;
      usageTotals.outputTokens += Number.isFinite(usage.outputTokens) ? usage.outputTokens : 0;
      usageTotals.totalTokens += Number.isFinite(usage.totalTokens)
        ? usage.totalTokens
        : (Number.isFinite(usage.inputTokens) ? usage.inputTokens : 0) +
          (Number.isFinite(usage.outputTokens) ? usage.outputTokens : 0);
      if (usage.totalTokens === undefined && usage.inputTokens === undefined) {
        usageTotals.estimated = true;
      }
      emit(current, "agent.usage", { ...usageTotals });
      const text = typeof assistant.content === "string" ? assistant.content.trim() : "";
      if (text) {
        finalText = text.slice(0, 64 * 1024);
        emit(current, "run.status", { message: finalText });
      }
      const toolCalls = (Array.isArray(assistant.tool_calls)
        ? assistant.tool_calls.slice(0, MAX_TOOL_CALLS_PER_STEP)
        : []
      ).map((call) => {
        const callId = boundedString(call?.id, 256) ? call.id : randomUUID();
        let command = "";
        if (call?.function?.name === "agent_browser") {
          try {
            const parsed = JSON.parse(call.function.arguments || "{}");
            if (typeof parsed?.command === "string") {
              command = parsed.command.slice(0, 8_000);
            }
          } catch {
            command = "";
          }
        }
        return {
          callId,
          command,
          messageCall: {
            id: callId,
            type: "function",
            function: {
              name: "agent_browser",
              arguments: JSON.stringify({ command }),
            },
          },
        };
      });
      messages.push({
        role: "assistant",
        content:
          typeof assistant.content === "string"
            ? assistant.content.slice(0, MAX_ASSISTANT_TEXT_CHARS)
            : "",
        tool_calls: toolCalls.map((call) => call.messageCall),
      });
      if (toolCalls.length === 0) {
        return {
          status: "completed",
          payload: { summary: finalText || "Task complete." },
        };
      }
      for (const call of toolCalls) {
        if (current.signal.aborted) return { status: "aborted", payload: {} };
        const { callId, command } = call;
        if (!command) {
          messages.push({
            role: "tool",
            tool_call_id: callId,
            content: "No command provided.",
          });
          continue;
        }
        const sealedWords = sealRuntimeV2AgentBrowserCommand(command);
        const { action, target, sensitive } = classifyCommand(sealedWords.join(" "));
        lastActionLabel = `${action}${target ? ` ${target}` : ""}`.trim().slice(0, 80);
        emit(current, "action.proposed", { action, target, command });
        const url = /https?:\/\/\S+/u.exec(command)?.[0];
        if (url) emit(current, "observation.page", { url: url.slice(0, 2_048) });
        if (needsApproval(current.request.approvalMode, sensitive)) {
          const decision = await requestApproval(current, { action, target, command });
          if (current.signal.aborted) return { status: "aborted", payload: {} };
          if (decision === "reject") {
            emit(current, "action.completed", {
              summary: "rejected by user",
              action,
              target,
            });
            messages.push({
              role: "tool",
              tool_call_id: callId,
              content:
                "The user rejected this action. Do not retry it; choose a different approach or stop.",
            });
            continue;
          }
        }
        const result = await executeCommand(current, sealedWords);
        if (current.signal.aborted) return { status: "aborted", payload: {} };
        emit(current, "action.completed", {
          summary: result.split(/\r?\n/u)[0]?.slice(0, 200) || "done",
          action,
          target,
        });
        // A completed browser action must have an opportunity to publish its
        // corresponding durable observation before the model can finish the
        // run. The interval remains useful during long waits, but it is not a
        // correctness boundary for the user-visible screenshot timeline.
        await captureScreenshot(current);
        messages.push({ role: "tool", tool_call_id: callId, content: result });
      }
    }
    return {
      status: "completed",
      payload: { summary: finalText || "Step limit reached." },
    };
  } catch (error) {
    if (current.signal.aborted || error?.name === "AbortError") {
      return { status: "aborted", payload: {} };
    }
    return {
      status: "failed",
      payload: {
        message:
          error && typeof error.message === "string"
            ? error.message.slice(0, 8 * 1024)
            : "run failed",
      },
    };
  } finally {
    stopScreenshotPoller(current);
    await closeSession(current).catch(() => undefined);
  }
}

export function createSealedRuntimeV2AgentBrowserExecutor(options) {
  const validated = validateCurrentRuntimeWorker(options);
  const current = {
    ...validated,
    createdAt: new Date().toISOString(),
    status: "queued",
    sequence: 0,
    events: [],
    pendingApproval: null,
    checkpointPublished: false,
    children: new Set(),
    screenshotTimer: null,
    screenshotChild: null,
    screenshotCapture: null,
    screenshotIndex: 0,
    screenshotLastSize: -1,
    screenshotTotalBytes: 0,
  };
  return {
    run: () => drive(current),
    finalize(status, payload) {
      if (!TERMINAL_STATUSES.has(status)) fail("The Agent Browser outcome is invalid.");
      finalizeProjection(current, status, isRecord(payload) ? payload : {});
    },
    projection() {
      return structuredClone(projectionBytes(current).projection);
    },
    terminateChildren() {
      stopScreenshotPoller(current);
      for (const child of current.children) {
        try {
          child.kill();
        } catch {
          // Rust is the final process-tree owner.
        }
      }
    },
  };
}
