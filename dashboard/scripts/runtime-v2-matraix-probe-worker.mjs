import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runRuntimeV2FiniteMcpWorker } from "./runtime-v2-finite-mcp-worker-core.mjs";

const ENTRYPOINT = fileURLToPath(import.meta.url);
const CHECK_TIMEOUT_MS = 120_000;
const CATALOG_TIMEOUT_MS = 180_000;
const MAX_CHECK_STDOUT_BYTES = 1024 * 1024;
const MAX_CATALOG_STDOUT_BYTES = 32 * 1024 * 1024;
const MAX_STDERR_BYTES = 16 * 1024;
const MAX_PATH_BYTES = 2_048;
const DEVELOPMENT_POOL = "persona/datasets/matraix-persona-dev-sample";
const PRODUCTION_POOL = "persona/datasets/matraix-persona-1m";
const PRODUCTION_POOL_COMMAND = [
  "huggingface-cli download MatrAIx2026/MatrAIx_Persona_1M_Public_Release",
  "--repo-type dataset",
  `--local-dir ${PRODUCTION_POOL}/release`,
].join(" ");

function fail(message) {
  throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactRecord(value, keys) {
  return isRecord(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function boundedText(value, maximumBytes) {
  return typeof value === "string" &&
    Buffer.byteLength(value, "utf8") <= maximumBytes &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
}

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function pathWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function directDirectory(candidate, root, message) {
  const resolved = path.resolve(candidate);
  if (!pathWithin(root, resolved)) fail(message);
  const metadata = fs.lstatSync(resolved);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    !samePath(fs.realpathSync.native(resolved), resolved)
  ) fail(message);
  return resolved;
}

function directFile(candidate, root, message) {
  const resolved = path.resolve(candidate);
  if (!pathWithin(root, resolved)) fail(message);
  const metadata = fs.lstatSync(resolved);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    !samePath(fs.realpathSync.native(resolved), resolved)
  ) fail(message);
  return resolved;
}

export function validateRuntimeV2MatraixProbeRequest(value) {
  if (
    !exactRecord(value, ["protocolVersion", "operation"]) ||
    value.protocolVersion !== 1 ||
    value.operation !== "status"
  ) fail("The canonical MatrAIx probe request is invalid.");
  return value;
}

export function validateRuntimeV2MatraixProbeScope(value) {
  if (
    !exactRecord(value, ["userId", "gardenId", "conversationId"]) ||
    !Number.isSafeInteger(value.userId) ||
    value.userId < 1 ||
    value.gardenId !== null ||
    value.conversationId !== null
  ) fail("The MatrAIx probe requires authenticated user-global scope.");
  return value;
}

export function validateRuntimeV2MatraixProbeEnvironment(environment) {
  if (
    !boundedText(environment.MATRAIX_ROOT, MAX_PATH_BYTES) ||
    !environment.MATRAIX_ROOT.trim() ||
    !path.isAbsolute(environment.MATRAIX_ROOT)
  ) fail("The sealed MatrAIx source root is unavailable.");
}

function optionalCheckout(candidate, appRoot) {
  if (!fs.existsSync(candidate)) return null;
  const root = directDirectory(candidate, appRoot, "The staged MatrAIx source is indirect.");
  const harbor = path.join(root, "environment", "runtime", "harbor");
  const cli = path.join(root, "src", "matraix", "cli.py");
  if (!fs.existsSync(harbor) || !fs.existsSync(cli)) return null;
  directDirectory(harbor, root, "The staged MatrAIx source is incomplete.");
  directFile(cli, root, "The staged MatrAIx source is incomplete.");
  return root;
}

function applicationLayout(launch) {
  const developmentDashboardRoot = path.dirname(path.dirname(ENTRYPOINT));
  const appRoot = path.dirname(developmentDashboardRoot);
  const development = fs.existsSync(
    path.join(developmentDashboardRoot, "src", "lib", "matraix", "runtime.ts"),
  );
  const packagedDashboardRoot = path.join(appRoot, "dashboard-standalone", "dashboard");
  const dashboardRoot = development ? developmentDashboardRoot : packagedDashboardRoot;
  const dataRoot = directDirectory(
    launch.dataRoot,
    launch.dataRoot,
    "The MatrAIx Runtime data root is indirect.",
  );
  const expectedRoot = path.join(appRoot, "MatrAIx-Persona-8B");
  if (!samePath(process.env.MATRAIX_ROOT, expectedRoot)) {
    fail("The MatrAIx source root is outside the sealed application closure.");
  }
  const root = optionalCheckout(expectedRoot, appRoot);
  const bridgeCandidate = path.join(appRoot, "scripts", "matraix-bridge.py");
  const bridge = fs.existsSync(bridgeCandidate)
    ? directFile(bridgeCandidate, appRoot, "The staged MatrAIx bridge is indirect.")
    : null;
  const venv = path.join(dataRoot, "runtime-v2", "services", "matraix", ".venv");
  const pythonCandidate = process.platform === "win32"
    ? path.join(venv, "Scripts", "python.exe")
    : path.join(venv, "bin", "python");
  const python = fs.existsSync(pythonCandidate)
    ? directFile(pythonCandidate, dataRoot, "The managed MatrAIx Python is indirect.")
    : null;
  const workspace = directDirectory(
    launch.workspacePath,
    dataRoot,
    "The private MatrAIx probe workspace is indirect.",
  );
  const privateRoot = path.join(workspace, "matraix-probe-process");
  const home = path.join(privateRoot, "home");
  const temporary = path.join(privateRoot, "tmp");
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  fs.mkdirSync(temporary, { recursive: true, mode: 0o700 });
  directDirectory(home, workspace, "The private MatrAIx probe home is indirect.");
  directDirectory(temporary, workspace, "The private MatrAIx probe temp is indirect.");
  process.env.BREADBOARD_DATA_DIR = dataRoot;
  process.env.BREADBOARD_REPO_ROOT = appRoot;
  process.env.MATRAIX_ROOT = expectedRoot;
  process.env.NODE_ENV = development ? "development" : "production";
  for (const name of [
    "CHATMOCK_API_KEY",
    "BREADBOARD_SUPERVISOR_CONTROL_TOKEN",
    "BREADBOARD_HERMES_SESSION_TOKEN",
    "BREADBOARD_HERMES_TOOL_SECRET",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "OPENAI_API_BASE",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "MATRAIX_WORKSPACE_ROOT",
  ]) delete process.env[name];
  process.chdir(dashboardRoot);
  return { appRoot, dataRoot, root, bridge, venv, python, home, temporary };
}

export function matraixProbeChildEnvironment(layout) {
  const env = {
    NODE_ENV: process.env.NODE_ENV ?? "production",
    HOME: layout.home,
    USERPROFILE: layout.home,
    TMP: layout.temporary,
    TEMP: layout.temporary,
    TMPDIR: layout.temporary,
    NO_COLOR: "1",
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
    PYTHONUNBUFFERED: "1",
  };
  for (const name of ["SystemRoot", "WINDIR"]) {
    if (process.env[name]) env[name] = process.env[name];
  }
  const systemDirectory = process.platform === "win32" && process.env.SystemRoot
    ? path.join(process.env.SystemRoot, "System32")
    : null;
  env.PATH = [path.dirname(layout.python), systemDirectory].filter(Boolean).join(path.delimiter);
  return env;
}

function appendBounded(current, chunk, maximumBytes) {
  const combined = `${current}${chunk}`;
  const bytes = Buffer.from(combined, "utf8");
  if (bytes.byteLength <= maximumBytes) return { value: combined, truncated: false };
  return {
    value: bytes.subarray(bytes.byteLength - maximumBytes).toString("utf8").replace(/^\uFFFD+/u, ""),
    truncated: true,
  };
}

function runPython(layout, args, signal, timeoutMs, maximumStdoutBytes) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(layout.python, args, {
        cwd: layout.root,
        windowsHide: true,
        env: matraixProbeChildEnvironment(layout),
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({
        code: null,
        stdout: "",
        stderr: error instanceof Error ? error.message : "spawn failed",
        timedOut: false,
        truncated: false,
      });
      return;
    }
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;
    let settled = false;
    const kill = () => {
      try { child.kill(); } catch { /* Already gone. */ }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);
    timer.unref?.();
    const finish = (code, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", kill);
      resolve({
        code,
        stdout,
        stderr: error ? `${stderr}${error.message}` : stderr,
        timedOut,
        truncated,
      });
    };
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      const appended = appendBounded(stdout, chunk, maximumStdoutBytes);
      stdout = appended.value;
      truncated ||= appended.truncated;
    });
    child.stderr?.on("data", (chunk) => {
      stderr = appendBounded(stderr, chunk, MAX_STDERR_BYTES).value;
    });
    child.once("error", (error) => finish(null, error));
    child.once("exit", (code) => finish(code, null));
    signal.addEventListener("abort", kill, { once: true });
    if (signal.aborted) kill();
  });
}

function lastJson(stdout) {
  const line = stdout.trim().split(/\r?\n/u).at(-1) ?? "";
  try {
    const value = JSON.parse(line);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function lastError(stderr) {
  return stderr.trim().split(/\r?\n/u).at(-1) ?? "";
}

function directPresence(candidate, root, message) {
  if (!fs.existsSync(candidate)) return false;
  directDirectory(candidate, root, message);
  return true;
}

function baseStatus(layout, input = {}) {
  const root = layout.root;
  return {
    ready: input.ready ?? false,
    reason: input.reason ?? "",
    clone: { found: Boolean(root), path: root ?? "" },
    python: {
      found: Boolean(input.python),
      path: input.python ?? "",
      version: input.pythonVersion ?? "",
      venv: layout.venv,
    },
    pools: [
      {
        pool: DEVELOPMENT_POOL,
        label: "Development sample",
        personas: input.personas ?? 0,
        present: Boolean(root) && directPresence(
          path.join(root, ...DEVELOPMENT_POOL.split("/")),
          root,
          "The MatrAIx development pool is indirect.",
        ),
      },
      {
        pool: PRODUCTION_POOL,
        label: "Persona 1M release",
        personas: 0,
        present: Boolean(root) && directPresence(
          path.join(root, ...PRODUCTION_POOL.split("/"), "release"),
          root,
          "The MatrAIx production pool is indirect.",
        ),
      },
    ],
    productionPoolCommand: PRODUCTION_POOL_COMMAND,
  };
}

export async function executeRuntimeV2MatraixProbe(
  launch,
  signal,
  progress,
  dependencies = { runPython },
) {
  validateRuntimeV2MatraixProbeRequest(launch.request);
  validateRuntimeV2MatraixProbeScope(launch.executionScope);
  validateRuntimeV2MatraixProbeEnvironment(process.env);
  progress.checkpoint({ stage: "preparing", percent: 10 });
  const layout = applicationLayout(launch);
  if (!layout.root) {
    return baseStatus(layout, {
      reason: "The MatrAIx clone was not found. Set MATRAIX_ROOT if it is not at ./MatrAIx-Persona-8B.",
    });
  }
  if (!layout.bridge) {
    return baseStatus(layout, { reason: "Breadboard's MatrAIx bridge is missing." });
  }
  if (!layout.python) {
    return baseStatus(layout, {
      reason: "MatrAIx is cloned but its Python environment is not installed. Open setup, or run npm run setup:matraix.",
    });
  }
  if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  progress.checkpoint({ stage: "checking", percent: 25 });
  const checked = await dependencies.runPython(
    layout,
    [layout.bridge, "--root", layout.root, "--check"],
    signal,
    CHECK_TIMEOUT_MS,
    MAX_CHECK_STDOUT_BYTES,
  );
  if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  const check = checked.truncated ? null : lastJson(checked.stdout);
  if (check?.event !== "check.ok") {
    const detail = lastError(checked.stderr);
    return baseStatus(layout, {
      python: layout.python,
      reason: `The MatrAIx environment is incomplete. ${detail}`.trim(),
    });
  }
  progress.checkpoint({ stage: "cataloging", percent: 55 });
  const cataloged = await dependencies.runPython(
    layout,
    [
      layout.bridge,
      "--root",
      layout.root,
      "--catalog",
      "--pool",
      DEVELOPMENT_POOL,
      "--top",
      "80",
    ],
    signal,
    CATALOG_TIMEOUT_MS,
    MAX_CATALOG_STDOUT_BYTES,
  );
  if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  const catalog = cataloged.truncated ? null : lastJson(cataloged.stdout);
  const personas = catalog?.event === "catalog" &&
      catalog.pool === DEVELOPMENT_POOL &&
      Array.isArray(catalog.dimensions) &&
      Number.isSafeInteger(catalog.count) &&
      catalog.count >= 0 &&
      catalog.count <= 10_000_000
    ? catalog.count
    : 0;
  const pythonVersion = String(check.python ?? "");
  progress.checkpoint({ stage: "complete", percent: 100 });
  return baseStatus(layout, {
    ready: true,
    python: layout.python,
    pythonVersion: boundedText(pythonVersion, 256) ? pythonVersion : "",
    personas,
  });
}

if (typeof process.argv[1] === "string" && samePath(process.argv[1], ENTRYPOINT)) {
  void runRuntimeV2FiniteMcpWorker({
    name: "runtime-v2-matraix-probe-worker",
    validateRequest: validateRuntimeV2MatraixProbeRequest,
    validateExecutionScope: validateRuntimeV2MatraixProbeScope,
    expectedInputCount: () => 0,
    execute: executeRuntimeV2MatraixProbe,
  });
}
