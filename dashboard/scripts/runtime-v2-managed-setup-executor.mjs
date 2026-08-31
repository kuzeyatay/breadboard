import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

export const MANAGED_SETUP_OPERATIONS = Object.freeze({
  "audio-analyzer": Object.freeze(["check", "download", "install"]),
  "bolt-slides": Object.freeze(["install-dependencies"]),
  "career-ops": Object.freeze(["install", "browsers", "scaffold"]),
  "claude-code": Object.freeze(["status", "logout"]),
  comfyui: Object.freeze(["install"]),
  "deep-tutor": Object.freeze(["install", "reinstall", "remove"]),
  "deer-flow": Object.freeze(["install", "reinstall", "remove"]),
  "google-images": Object.freeze(["check", "install"]),
  hyperframes: Object.freeze(["install-cli"]),
  legal: Object.freeze(["install", "reinstall", "remove"]),
  matraix: Object.freeze(["install-runtime"]),
  "money-printer": Object.freeze(["install", "reinstall", "remove"]),
  openmontage: Object.freeze(["install-dependencies", "install-remotion"]),
  openexecutive: Object.freeze(["install", "reinstall", "remove"]),
  openscience: Object.freeze(["install"]),
  openwork: Object.freeze(["prepare-server"]),
  resource2skill: Object.freeze(["install-runtime", "install-web", "install-blender"]),
  shorts: Object.freeze(["install", "reinstall", "remove"]),
  "stock-analyst": Object.freeze(["install", "reinstall", "remove"]),
  subsai: Object.freeze(["build-subtitles", "remove-subtitles"]),
  tradingagents: Object.freeze(["install", "reinstall", "remove"]),
  "vibe-trading": Object.freeze(["install", "reinstall", "remove"]),
  wardrobe: Object.freeze(["install"]),
});

export const AUDIO_ANALYZER_VERSION = "v1.0.0";
export const GOOGLE_IMAGES_BUILD_ENTRY = path.join("src", "index.js");

const AUDIO_RELEASE_BASE =
  `https://github.com/JuzzyDee/audio-analyzer-rs/releases/download/${AUDIO_ANALYZER_VERSION}`;
const AUDIO_ASSETS = Object.freeze({
  "win32-x64": Object.freeze({
    file: "audio-analyzer-x86_64-pc-windows-msvc.zip",
    sha256: "591b503019f87f3abe99e9a1f6b97791052814006131e26ae6e3678a38a428bb",
  }),
  "darwin-arm64": Object.freeze({
    file: "audio-analyzer-aarch64-apple-darwin.tar.gz",
    sha256: "da30a7d12d8c775026cf646d0dbf31b8c3bcb42864fd8685ecad8cd75e791395",
  }),
  "darwin-x64": Object.freeze({
    file: "audio-analyzer-x86_64-apple-darwin.tar.gz",
    sha256: "d53b2d2f15f4be2ca738c71922b7b6bd2d70c090a6b72a565c76358574960ad2",
  }),
  "linux-x64": Object.freeze({
    file: "audio-analyzer-x86_64-unknown-linux-gnu.tar.gz",
    sha256: "0ab8b0954dfa30cdd29b05302715b3a90cf4051c971b85683fc8e528fcce0b8c",
  }),
});

const MAX_COMMAND_LOG_BYTES = 32 * 1024;
const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;
const INSTALL_TIMEOUT_MS = 40 * 60_000;
const VENV_TIMEOUT_MS = 5 * 60_000;
const VERIFY_TIMEOUT_MS = 6 * 60_000;
const AUDIO_BUILD_TIMEOUT_MS = 45 * 60_000;
const AUDIO_PROBE_TIMEOUT_MS = 60_000;
const GOOGLE_INSTALL_TIMEOUT_MS = 20 * 60_000;
const NPM_TOOL_INSTALL_TIMEOUT_MS = 20 * 60_000;
const LARGE_PYTHON_INSTALL_TIMEOUT_MS = 45 * 60_000;
const CLAUDE_ACCOUNT_TIMEOUT_MS = 20_000;

function fail(message, status = 500, code = "setup_failed") {
  throw Object.assign(new Error(message), { status, code });
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function directPath(candidate, kind, label) {
  const resolved = path.resolve(candidate);
  const metadata = fs.lstatSync(resolved, { throwIfNoEntry: false });
  if (!metadata || metadata.isSymbolicLink() || !metadata[kind]()) {
    fail(`${label} is unavailable.`, 404, "setup_source_unavailable");
  }
  const canonical = fs.realpathSync.native(resolved);
  const same = process.platform === "win32"
    ? canonical.toLowerCase() === resolved.toLowerCase()
    : canonical === resolved;
  if (!same) fail(`${label} must be a direct path.`, 400, "setup_path_indirect");
  return canonical;
}

function pathWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function ensureDirectDirectory(directory, label) {
  const metadata = fs.lstatSync(directory, { throwIfNoEntry: false });
  if (!metadata) {
    fs.mkdirSync(directory);
    return;
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    fail(`${label} must be a direct directory.`, 400, "setup_path_indirect");
  }
}

function inheritedToolEnvironment(env) {
  const allowed = [
    "PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "ComSpec", "COMSPEC",
    "TEMP", "TMP", "TMPDIR", "USERPROFILE", "HOME", "HOMEDRIVE", "HOMEPATH",
    "APPDATA", "LOCALAPPDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "ProgramW6432",
    "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy",
    "SSL_CERT_FILE", "SSL_CERT_DIR", "CARGO_HOME", "RUSTUP_HOME", "UV_CACHE_DIR",
    "PIP_CACHE_DIR", "npm_config_cache",
  ];
  const result = {};
  for (const name of allowed) {
    if (typeof env[name] === "string" && env[name]) result[name] = env[name];
  }
  result.NO_COLOR = "1";
  result.FORCE_COLOR = "0";
  result.CI = "1";
  result.npm_config_audit = "false";
  result.npm_config_fund = "false";
  result.npm_config_update_notifier = "false";
  result.PIP_DISABLE_PIP_VERSION_CHECK = "1";
  result.PYTHONDONTWRITEBYTECODE = "1";
  result.PYTHONIOENCODING = "utf-8";
  result.PYTHONUTF8 = "1";
  return result;
}

function appendTail(current, chunk, maximum = MAX_COMMAND_LOG_BYTES) {
  const value = `${current}${String(chunk)}`;
  return Buffer.byteLength(value, "utf8") <= maximum
    ? value
    : Buffer.from(value, "utf8").subarray(-maximum).toString("utf8");
}

export function runManagedSetupCommand(command, args, options) {
  const {
    cwd,
    signal,
    timeoutMs,
    env,
    platform = process.platform,
    spawnImpl = spawn,
    onOutput,
  } = options;
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    let stdout = "";
    let stderr = "";
    const shell = platform === "win32" && /\.(?:cmd|bat)$/iu.test(command);
    const child = spawnImpl(command, args, {
      cwd,
      env,
      detached: false,
      windowsHide: true,
      windowsVerbatimArguments: false,
      shell,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.setEncoding?.("utf8");
    child.stderr?.setEncoding?.("utf8");
    child.stdout?.on?.("data", (chunk) => {
      stdout = appendTail(stdout, chunk);
      onOutput?.(String(chunk), "stdout");
    });
    child.stderr?.on?.("data", (chunk) => {
      stderr = appendTail(stderr, chunk);
      onOutput?.(String(chunk), "stderr");
    });
    const terminate = () => {
      try {
        child.kill();
      } catch {
        // The Rust job owns the complete tree and applies the forced bound.
      }
    };
    const abort = () => terminate();
    signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);
    timer.unref?.();
    const finish = (error, code, exitSignal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (signal.aborted) {
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      } else if (error) {
        reject(error);
      } else {
        resolve({ code, signal: exitSignal, timedOut, stdout, stderr });
      }
    };
    child.once("error", (error) => finish(error, null, null));
    child.once("close", (code, exitSignal) => finish(null, code, exitSignal));
  });
}

function commandTail(result, lines = 25) {
  return `${result.stdout}\n${result.stderr}`
    .replace(/\x1b\[[0-9;]*m/gu, "")
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean)
    .slice(-lines)
    .join("\n")
    .slice(-MAX_COMMAND_LOG_BYTES);
}

function resolveOnPath(executable, env, platform = process.platform) {
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const directories = (env[pathKey] ?? "").split(path.delimiter).filter(Boolean);
  const extensions = platform === "win32"
    ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
    : [""];
  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${executable}${extension}`);
      const metadata = fs.statSync(candidate, { throwIfNoEntry: false });
      if (metadata?.isFile()) return candidate;
    }
  }
  return null;
}

function candidateRoot(appRoot, env, envName, directory, markers) {
  const configured = typeof env[envName] === "string" && env[envName].trim()
    ? path.resolve(env[envName].trim())
    : null;
  const candidates = configured ? [configured] : [path.join(appRoot, directory)];
  for (const candidate of candidates) {
    try {
      const root = directPath(candidate, "isDirectory", `${directory} setup root`);
      if (markers.every((marker) => fs.existsSync(path.join(root, ...marker)))) return root;
    } catch {
      // Report one stable missing-clone result below.
    }
  }
  fail(`${directory} was not found in this Breadboard installation.`, 404, "setup_clone_missing");
}

function pythonInVenv(venv, platform = process.platform) {
  const candidate = platform === "win32"
    ? path.join(venv, "Scripts", "python.exe")
    : path.join(venv, "bin", "python");
  return fs.statSync(candidate, { throwIfNoEntry: false })?.isFile() ? candidate : null;
}

function fixedClaudeCommand(context) {
  const executable = context.platform === "win32" ? "claude.exe" : "claude";
  const home = context.env.USERPROFILE?.trim() || context.env.HOME?.trim();
  const appData = context.env.APPDATA?.trim();
  const localAppData = context.env.LOCALAPPDATA?.trim();
  const configured = context.env.CLAUDE_CLI_PATH?.trim();
  const candidates = [
    configured ? path.resolve(configured) : null,
    home ? path.join(path.resolve(home), ".local", "bin", executable) : null,
    home && context.platform !== "win32"
      ? path.join(path.resolve(home), ".claude", "local", "claude")
      : null,
    appData && context.platform === "win32"
      ? path.join(path.resolve(appData), "SPB_Data", ".local", "bin", executable)
      : null,
    localAppData && context.platform === "win32"
      ? path.join(path.resolve(localAppData), "Programs", "claude", executable)
      : null,
    appData && context.platform === "win32"
      ? path.join(path.resolve(appData), "npm", "claude.cmd")
      : null,
    context.platform === "darwin" ? "/opt/homebrew/bin/claude" : null,
    context.platform !== "win32" ? "/usr/local/bin/claude" : null,
    resolveOnPath("claude", context.env, context.platform),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const canonical = fs.realpathSync.native(candidate);
      if (fs.statSync(canonical).isFile()) return canonical;
    } catch {
      // Try the next fixed, trusted location.
    }
  }
  return null;
}

function claudeAccountEnvironment(env) {
  const allowed = [
    "PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "ComSpec", "COMSPEC",
    "TEMP", "TMP", "TMPDIR", "USERPROFILE", "HOME", "HOMEDRIVE", "HOMEPATH",
    "APPDATA", "LOCALAPPDATA", "XDG_CONFIG_HOME", "LANG", "LC_ALL",
    "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
    "http_proxy", "https_proxy", "all_proxy", "no_proxy",
    "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS",
  ];
  const result = {};
  for (const name of allowed) {
    if (typeof env[name] === "string" && env[name]) result[name] = env[name];
  }
  result.NO_COLOR = "1";
  result.FORCE_COLOR = "0";
  result.CI = "1";
  return result;
}

function boundedClaudeText(value) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 1_024) : null;
}

function claudeStatusResult(value) {
  const payload = isRecord(value) ? value : {};
  const loggedIn = payload.loggedIn === true;
  return {
    installed: true,
    loggedIn,
    authMethod: boundedClaudeText(payload.authMethod),
    email: boundedClaudeText(payload.email),
    subscriptionType: boundedClaudeText(payload.subscriptionType),
    error: loggedIn ? null : "Claude Code is not signed in.",
  };
}

async function claudeAccountOperation(action, context) {
  const command = fixedClaudeCommand(context);
  if (!command) {
    const message = "Claude Code is not installed.";
    if (action === "status") {
      return {
        ok: true,
        message,
        detail: JSON.stringify({
          installed: false,
          loggedIn: false,
          authMethod: null,
          email: null,
          subscriptionType: null,
          error: message,
        }),
      };
    }
    return { ok: false, message, detail: "" };
  }
  const result = await runManagedSetupCommand(
    command,
    action === "status" ? ["auth", "status", "--json"] : ["auth", "logout"],
    {
      cwd: context.dataRoot,
      env: claudeAccountEnvironment(context.env),
      signal: context.signal,
      timeoutMs: CLAUDE_ACCOUNT_TIMEOUT_MS,
      spawnImpl: context.spawnImpl,
      platform: context.platform,
    },
  );
  if (action === "logout") {
    return result.code === 0
      ? { ok: true, message: "Claude Code is signed out.", detail: "" }
      : { ok: false, message: "Claude Code could not sign out.", detail: "" };
  }
  try {
    return {
      ok: true,
      message: "Claude Code account status checked.",
      detail: JSON.stringify(claudeStatusResult(JSON.parse(result.stdout))),
    };
  } catch {
    return {
      ok: true,
      message: "Claude Code did not return a valid account status.",
      detail: JSON.stringify({
        installed: true,
        loggedIn: false,
        authMethod: null,
        email: null,
        subscriptionType: null,
        error: "Claude Code is not signed in.",
      }),
    };
  }
}

function serviceEnvironment(dataRoot, serviceId) {
  const runtimeRoot = path.resolve(dataRoot, "runtime-v2");
  const servicesRoot = path.join(runtimeRoot, "services");
  const serviceRoot = path.join(servicesRoot, serviceId);
  const target = path.join(serviceRoot, ".venv");
  if (!pathWithin(dataRoot, serviceRoot) || !pathWithin(dataRoot, target) || path.basename(target) !== ".venv") {
    fail("The managed Python environment path is invalid.", 400, "setup_path_invalid");
  }
  ensureDirectDirectory(runtimeRoot, "The Runtime V2 state root");
  ensureDirectDirectory(servicesRoot, "The Runtime V2 services root");
  ensureDirectDirectory(serviceRoot, `The ${serviceId} service state root`);
  return target;
}

function removeEnvironment(dataRoot, serviceId) {
  const target = serviceEnvironment(dataRoot, serviceId);
  const metadata = fs.lstatSync(target, { throwIfNoEntry: false });
  if (!metadata) return false;
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    fail("The managed Python environment is not a direct directory.", 400, "setup_path_indirect");
  }
  fs.rmSync(target, { recursive: true, force: true });
  return true;
}

async function createPythonEnvironment({
  root,
  venv,
  env,
  signal,
  spawnImpl,
  pythonVersion = "3.12",
  requireUv = false,
}) {
  const uv = resolveOnPath("uv", env);
  let uvFailure = null;
  if (uv) {
    const result = await runManagedSetupCommand(
      uv,
      ["venv", "--python", pythonVersion, venv],
      {
        cwd: root,
        env: { ...inheritedToolEnvironment(env), UV_LINK_MODE: "copy" },
        signal,
        timeoutMs: VENV_TIMEOUT_MS,
        spawnImpl,
      },
    );
    if (result.code === 0 && pythonInVenv(venv)) return pythonInVenv(venv);
    uvFailure = result;
  }
  if (requireUv) {
    if (uvFailure) {
      return {
        ok: false,
        message: uvFailure.timedOut
          ? "Creating the Python environment did not finish in time."
          : "The Python environment could not be created.",
        detail: commandTail(uvFailure),
      };
    }
    fail(
      "This environment needs uv to select a compatible Python. Install uv, then try again.",
      409,
      "setup_uv_missing",
    );
  }
  const python = resolveOnPath("python", env) ?? resolveOnPath("python3", env);
  if (!python) {
    fail(
      "No supported Python or uv installation was found on this machine.",
      409,
      "setup_python_missing",
    );
  }
  const result = await runManagedSetupCommand(
    python,
    ["-m", "venv", venv],
    {
      cwd: root,
      env: inheritedToolEnvironment(env),
      signal,
      timeoutMs: VENV_TIMEOUT_MS,
      spawnImpl,
    },
  );
  if (result.code !== 0 || !pythonInVenv(venv)) {
    return {
      ok: false,
      message: "The Python environment could not be created.",
      detail: commandTail(result),
    };
  }
  return pythonInVenv(venv);
}

async function installPythonRequirements({
  root,
  python,
  requirementArgs,
  verifyArgs,
  verifyCwd = root,
  verifyEnv = {},
  verifyNeedle = "ok",
  env,
  signal,
  spawnImpl,
  label,
}) {
  const uv = resolveOnPath("uv", env);
  const toolEnv = inheritedToolEnvironment(env);
  const steps = Array.isArray(requirementArgs[0]) ? requirementArgs : [requirementArgs];
  for (const step of steps) {
    const result = uv
      ? await runManagedSetupCommand(
          uv,
          ["pip", "install", "--python", python, ...step],
          {
            cwd: root,
            env: { ...toolEnv, UV_LINK_MODE: "copy" },
            signal,
            timeoutMs: INSTALL_TIMEOUT_MS,
            spawnImpl,
          },
        )
      : await runManagedSetupCommand(
          python,
          ["-m", "pip", "install", ...step],
          {
            cwd: root,
            env: toolEnv,
            signal,
            timeoutMs: INSTALL_TIMEOUT_MS,
            spawnImpl,
          },
        );
    if (result.code !== 0) {
      return {
        ok: false,
        message: result.timedOut
          ? "The install did not finish in time."
          : `${label} dependencies could not be installed.`,
        detail: commandTail(result),
      };
    }
  }
  const verify = await runManagedSetupCommand(python, verifyArgs, {
    cwd: verifyCwd,
    env: { ...toolEnv, ...verifyEnv },
    signal,
    timeoutMs: VERIFY_TIMEOUT_MS,
    spawnImpl,
  });
  if (verify.code !== 0 || !verify.stdout.includes(verifyNeedle)) {
    return {
      ok: false,
      message: `The install finished but ${label} still does not start.`,
      detail: commandTail(verify),
    };
  }
  return null;
}

async function deerFlowSetup(action, context) {
  const root = candidateRoot(
    context.appRoot,
    context.env,
    "DEER_FLOW_ROOT",
    "deer-flow",
    [["backend", "app", "gateway", "app.py"], ["backend", "pyproject.toml"]],
  );
  const backend = path.join(root, "backend");
  const venv = serviceEnvironment(context.dataRoot, "deer-flow");
  if (action === "remove") {
    return {
      ok: true,
      message: removeEnvironment(context.dataRoot, "deer-flow")
        ? "Environment removed."
        : "There was no environment to remove.",
      detail: "",
    };
  }
  if (action === "reinstall" && !pythonInVenv(venv)) {
    fail("There is no environment to repair yet. Build it first.", 409, "setup_not_installed");
  }
  const uv = resolveOnPath("uv", context.env);
  if (!uv) {
    fail(
      "DeerFlow's backend is a uv workspace, so building it needs uv. Install uv, then try again.",
      409,
      "setup_uv_missing",
    );
  }
  const result = await runManagedSetupCommand(uv, ["sync", "--frozen", "--all-packages"], {
    cwd: backend,
    env: {
      ...inheritedToolEnvironment(context.env),
      UV_LINK_MODE: "copy",
      UV_PROJECT_ENVIRONMENT: venv,
    },
    signal: context.signal,
    timeoutMs: INSTALL_TIMEOUT_MS,
    spawnImpl: context.spawnImpl,
  });
  const python = pythonInVenv(venv);
  if (result.code !== 0 || !python) {
    return {
      ok: false,
      message: result.timedOut
        ? "The install did not finish in time."
        : "The DeerFlow environment could not be built.",
      detail: commandTail(result),
    };
  }
  const verify = await runManagedSetupCommand(
    python,
    ["-c", "import app.gateway.app, uvicorn; print('ok')"],
    {
      cwd: backend,
      env: { ...inheritedToolEnvironment(context.env), PYTHONPATH: backend },
      signal: context.signal,
      timeoutMs: VERIFY_TIMEOUT_MS,
      spawnImpl: context.spawnImpl,
    },
  );
  if (verify.code !== 0 || !verify.stdout.includes("ok")) {
    return {
      ok: false,
      message: "The install finished but the DeerFlow Gateway still does not import.",
      detail: commandTail(verify),
    };
  }
  return { ok: true, message: "DeerFlow is installed and ready.", detail: "" };
}

async function vibeTradingSetup(action, context) {
  const root = candidateRoot(
    context.appRoot,
    context.env,
    "VIBE_TRADING_ROOT",
    "Vibe-Trading",
    [["pyproject.toml"], ["agent", "api_server.py"], ["agent", "src", "agent", "loop.py"]],
  );
  const venv = serviceEnvironment(context.dataRoot, "vibe-trading");
  if (action === "remove") {
    return {
      ok: true,
      message: removeEnvironment(context.dataRoot, "vibe-trading")
        ? "Environment removed."
        : "There was no environment to remove.",
      detail: "",
    };
  }
  if (action === "reinstall" && !pythonInVenv(venv)) {
    fail("There is no environment to repair yet. Build it first.", 409, "setup_not_installed");
  }
  let python = pythonInVenv(venv);
  if (!python) {
    const created = await createPythonEnvironment({
      root,
      venv,
      env: context.env,
      signal: context.signal,
      spawnImpl: context.spawnImpl,
      pythonVersion: "3.11",
      requireUv: true,
    });
    if (isRecord(created)) return created;
    python = created;
  }
  const agentDirectory = path.join(root, "agent");
  const failed = await installPythonRequirements({
    root,
    python,
    requirementArgs: [
      ["--require-hashes", "-r", "requirements-lock.txt"],
      ["--no-build-isolation", "--no-deps", root],
    ],
    verifyArgs: ["-c", "import api_server, uvicorn; print('ok')"],
    verifyCwd: agentDirectory,
    env: context.env,
    signal: context.signal,
    spawnImpl: context.spawnImpl,
    label: "Vibe Trading",
  });
  return failed ?? { ok: true, message: "Vibe Trading is installed and ready.", detail: "" };
}

async function stockAnalystSetup(action, context) {
  const root = candidateRoot(
    context.appRoot,
    context.env,
    "STOCK_ANALYST_ROOT",
    "daily_stock_analysis",
    [["main.py"], ["server.py"], ["api", "app.py"], ["api", "v1", "endpoints", "agent.py"]],
  );
  const venv = serviceEnvironment(context.dataRoot, "stock-analyst");
  if (action === "remove") {
    return {
      ok: true,
      message: removeEnvironment(context.dataRoot, "stock-analyst")
        ? "Environment removed."
        : "There was no environment to remove.",
      detail: "",
    };
  }
  if (action === "reinstall" && !pythonInVenv(venv)) {
    fail("There is no environment to repair yet. Build it first.", 409, "setup_not_installed");
  }
  let python = pythonInVenv(venv);
  if (!python) {
    const created = await createPythonEnvironment({
      root,
      venv,
      env: context.env,
      signal: context.signal,
      spawnImpl: context.spawnImpl,
    });
    if (isRecord(created)) return created;
    python = created;
  }
  const state = path.join(context.dataRoot, "runtime-v2", "stock-analyst");
  fs.mkdirSync(path.join(state, "data"), { recursive: true });
  fs.mkdirSync(path.join(state, "logs"), { recursive: true });
  const failed = await installPythonRequirements({
    root,
    python,
    requirementArgs: ["--require-hashes", "-r", "requirements.lock"],
    verifyArgs: ["-c", "import uvicorn, api.app; print('ok')"],
    verifyEnv: {
      ENV_FILE: path.join(state, "probe.env"),
      DATABASE_PATH: path.join(state, "data", "stock_analysis.db"),
      LOG_DIR: path.join(state, "logs"),
    },
    env: context.env,
    signal: context.signal,
    spawnImpl: context.spawnImpl,
    label: "Stock Analyst",
  });
  return failed ?? { ok: true, message: "Stock Analyst is installed and ready.", detail: "" };
}

const LEGAL_RUNTIME_PACKAGES = Object.freeze([
  "openai",
  "pdfplumber",
  "markitdown",
  "openpyxl",
  "pandas",
  "python-docx",
  "python-pptx",
  "docxtpl",
  "lxml",
  "defusedxml",
  "diff-match-patch",
  "pypandoc-binary",
]);

const PYTHON_CLONE_SETUPS = Object.freeze({
  "deep-tutor": Object.freeze({
    envName: "DEEP_TUTOR_ROOT",
    directory: "DeepTutor",
    markers: Object.freeze([
      Object.freeze(["deeptutor", "app", "facade.py"]),
      Object.freeze(["deeptutor_cli", "main.py"]),
      Object.freeze(["pyproject.toml"]),
    ]),
    pythonVersion: "3.12",
    requireUv: true,
    requirementArgs: (root) => [root, "mcp>=1.26.0,<2.0.0"],
    verifyArgs: Object.freeze([
      "-c",
      "import importlib.util as u; from deeptutor.app import DeepTutorApp; print('ok mcp' if u.find_spec('mcp') else 'ok')",
    ]),
    verifyNeedle: "ok mcp",
    installFailure: "The tutor could not be installed.",
    verifyFailure: "The install finished but the tutor or its MCP client still does not import.",
    success: "Deep Tutor is installed and ready.",
  }),
  legal: Object.freeze({
    envName: "HARVEY_LABS_ROOT",
    directory: "harvey-labs",
    markers: Object.freeze([
      Object.freeze(["harness", "agent_loop.py"]),
      Object.freeze(["harness", "tools.py"]),
      Object.freeze(["harness", "system_prompt.md"]),
      Object.freeze(["sandbox", "sandbox.py"]),
    ]),
    pythonVersion: "3.13",
    requireUv: false,
    requirementArgs: () => [...LEGAL_RUNTIME_PACKAGES],
    verifyArgs: Object.freeze([
      "-c",
      [
        "from harness.agent_loop import run_agent",
        "from harness.tools import get_all_tool_definitions",
        "import docx, pptx, openpyxl, pdfplumber, markitdown",
        "print('ok')",
      ].join("\n"),
    ]),
    verifyNeedle: "ok",
    sourceOnPath: true,
    installFailure: "The harness libraries could not be installed.",
    verifyFailure: "The install finished but the harness still does not import.",
    success: "The Legal Agent is installed and ready.",
  }),
  openexecutive: Object.freeze({
    envName: "OPENEXECUTIVE_ROOT",
    directory: "OpenExecutive",
    markers: Object.freeze([
      Object.freeze(["packages", "core", "pyproject.toml"]),
      Object.freeze(["packages", "core", "uv.lock"]),
      Object.freeze([
        "packages",
        "core",
        "openexecutive",
        "orchestrator",
        "executive.py",
      ]),
    ]),
    pythonVersion: "3.12",
    requireUv: true,
    requirementArgs: (root) => [path.join(root, "packages", "core")],
    verifyArgs: Object.freeze([
      "-c",
      "import openexecutive; from openexecutive.orchestrator.executive import Executive; print('ok')",
    ]),
    verifyNeedle: "ok",
    installFailure: "Open Executive could not be installed.",
    verifyFailure: "The install finished but Open Executive still does not import.",
    success: "Open Executive is installed and ready.",
  }),
  shorts: Object.freeze({
    envName: "SHORTS_ROOT",
    directory: "AI-Youtube-Shorts-Generator",
    markers: Object.freeze([
      Object.freeze(["shorts_generator", "pipeline.py"]),
      Object.freeze(["shorts_generator", "local", "clipper.py"]),
      Object.freeze(["main.py"]),
      Object.freeze(["requirements-local.txt"]),
    ]),
    pythonVersion: "3.12",
    requireUv: false,
    requirementArgs: (root) => ["-r", path.join(root, "requirements-local.txt")],
    verifyArgs: Object.freeze([
      "-c",
      "import shorts_generator, yt_dlp, faster_whisper, cv2, openai; print('ok')",
    ]),
    verifyNeedle: "ok",
    sourceOnPath: true,
    installFailure: "The dependencies could not be installed.",
    verifyFailure: "The install finished but the dependencies still do not import.",
    success:
      "Shorts is ready. The first run also downloads a Whisper model, which takes a few minutes more.",
  }),
  tradingagents: Object.freeze({
    envName: "TRADINGAGENTS_ROOT",
    directory: "tradingagents",
    markers: Object.freeze([
      Object.freeze(["tradingagents", "graph", "trading_graph.py"]),
      Object.freeze(["tradingagents", "default_config.py"]),
      Object.freeze(["pyproject.toml"]),
    ]),
    pythonVersion: "3.12",
    requireUv: false,
    requirementArgs: (root) => [root],
    verifyArgs: Object.freeze(["-c", "import tradingagents; print('ok')"]),
    verifyNeedle: "ok",
    installFailure: "The framework could not be installed.",
    verifyFailure: "The install finished but the package still does not import.",
    success: "TradingAgents is installed and ready.",
  }),
});

async function managedPythonCloneSetup(operation, action, context) {
  const spec = PYTHON_CLONE_SETUPS[operation];
  if (!spec) fail("The managed Python setup is unavailable.");
  const root = candidateRoot(
    context.appRoot,
    context.env,
    spec.envName,
    spec.directory,
    spec.markers,
  );
  const venv = serviceEnvironment(context.dataRoot, operation);
  if (action === "remove") {
    return {
      ok: true,
      message: removeEnvironment(context.dataRoot, operation)
        ? "Environment removed."
        : "There was no environment to remove.",
      detail: "",
    };
  }
  if (action === "reinstall" && !pythonInVenv(venv)) {
    fail("There is no environment to repair yet. Build it first.", 409, "setup_not_installed");
  }

  let python = pythonInVenv(venv);
  const uv = resolveOnPath("uv", context.env, context.platform);
  if (spec.uvSync && uv) {
    const result = await runManagedSetupCommand(
      uv,
      ["sync", "--frozen", "--python", spec.pythonVersion],
      {
        cwd: root,
        env: {
          ...inheritedToolEnvironment(context.env),
          UV_LINK_MODE: "copy",
          UV_PROJECT_ENVIRONMENT: venv,
        },
        signal: context.signal,
        timeoutMs: INSTALL_TIMEOUT_MS,
        spawnImpl: context.spawnImpl,
        platform: context.platform,
      },
    );
    python = pythonInVenv(venv);
    if (result.code !== 0 || !python) {
      return {
        ok: false,
        message: result.timedOut
          ? "The install did not finish in time."
          : "uv could not install the project's pinned dependencies.",
        detail: commandTail(result),
      };
    }
  } else {
    if (!python) {
      const created = await createPythonEnvironment({
        root,
        venv,
        env: context.env,
        signal: context.signal,
        spawnImpl: context.spawnImpl,
        pythonVersion: spec.pythonVersion,
        requireUv: spec.requireUv,
      });
      if (isRecord(created)) return created;
      python = created;
    }
    const failed = await installPythonRequirements({
      root,
      python,
      requirementArgs: spec.requirementArgs(root),
      verifyArgs: spec.verifyArgs,
      verifyEnv: spec.sourceOnPath ? { PYTHONPATH: root } : {},
      verifyNeedle: spec.verifyNeedle,
      env: context.env,
      signal: context.signal,
      spawnImpl: context.spawnImpl,
      label: operation,
    });
    if (failed) {
      if (failed.message.includes("dependencies could not be installed")) {
        failed.message = spec.installFailure;
      } else if (failed.message.includes("still does not start")) {
        failed.message = spec.verifyFailure;
      }
      return failed;
    }
    return { ok: true, message: spec.success, detail: "" };
  }

  const verify = await runManagedSetupCommand(python, spec.verifyArgs, {
    cwd: root,
    env: {
      ...inheritedToolEnvironment(context.env),
      ...(spec.sourceOnPath ? { PYTHONPATH: root } : {}),
    },
    signal: context.signal,
    timeoutMs: VERIFY_TIMEOUT_MS,
    spawnImpl: context.spawnImpl,
    platform: context.platform,
  });
  if (verify.code !== 0 || !verify.stdout.includes(spec.verifyNeedle)) {
    return { ok: false, message: spec.verifyFailure, detail: commandTail(verify) };
  }
  return { ok: true, message: spec.success, detail: "" };
}

const MONEY_PRINTER_RUNTIME_MARKERS = Object.freeze([
  Object.freeze(["app", "asgi.py"]),
  Object.freeze(["app", "services", "task.py"]),
  Object.freeze(["config.example.toml"]),
  Object.freeze(["requirements.txt"]),
  Object.freeze(["pyproject.toml"]),
  Object.freeze(["uv.lock"]),
]);

function moneyPrinterSource(context) {
  return candidateRoot(
    context.appRoot,
    {},
    "MONEY_PRINTER_ROOT",
    "MoneyPrinterTurbo",
    MONEY_PRINTER_RUNTIME_MARKERS,
  );
}

function moneyPrinterRuntimeRoot(context) {
  const destination = path.join(
    context.dataRoot,
    "runtime-v2",
    "toolchains",
    "money-printer",
  );
  if (!pathWithin(context.dataRoot, destination)) {
    fail("The MoneyPrinter runtime escaped Runtime data.");
  }
  return destination;
}

function verifyMoneyPrinterRuntime(root) {
  const runtime = directPath(root, "isDirectory", "The MoneyPrinter runtime");
  for (const marker of MONEY_PRINTER_RUNTIME_MARKERS) {
    directPath(
      path.join(runtime, ...marker),
      "isFile",
      `The MoneyPrinter ${marker.join("/")} source`,
    );
  }
  return runtime;
}

function ensureMoneyPrinterRuntime(context) {
  const destination = moneyPrinterRuntimeRoot(context);
  if (fs.lstatSync(destination, { throwIfNoEntry: false })) {
    return verifyMoneyPrinterRuntime(destination);
  }
  const source = moneyPrinterSource(context);
  const staging = path.join(
    path.dirname(destination),
    `.money-printer-stage-${crypto.randomUUID()}`,
  );
  if (!pathWithin(context.dataRoot, staging)) {
    fail("The MoneyPrinter staging root escaped Runtime data.");
  }
  fs.mkdirSync(path.dirname(staging), { recursive: true });
  try {
    copyFilteredDirectTree(
      source,
      staging,
      {
        bytes: 0,
        files: 0,
        maximumBytes: 512 * 1024 * 1024,
        maximumFiles: 40_000,
      },
      new Set([".git", ".venv", ".runtime", "__pycache__", "node_modules", "storage", "config.toml"]),
      "The MoneyPrinter runtime source",
    );
    const config = path.join(source, "config.toml");
    if (fs.lstatSync(config, { throwIfNoEntry: false })) {
      copyDirectTree(
        config,
        path.join(staging, "config.toml"),
        { bytes: 0, files: 0, maximumBytes: 2 * 1024 * 1024, maximumFiles: 1 },
        "The MoneyPrinter user config",
      );
    }
    const storage = path.join(source, "storage");
    if (fs.lstatSync(storage, { throwIfNoEntry: false })) {
      copyDirectTree(
        storage,
        path.join(staging, "storage"),
        { bytes: 0, files: 0, maximumBytes: 20 * 1024 * 1024 * 1024, maximumFiles: 100_000 },
        "The MoneyPrinter user storage",
      );
    }
    verifyMoneyPrinterRuntime(staging);
    replaceDirectDirectory(staging, destination, "The MoneyPrinter runtime");
    return verifyMoneyPrinterRuntime(destination);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

async function moneyPrinterSetup(action, context) {
  const venv = serviceEnvironment(context.dataRoot, "money-printer");
  if (action === "remove") {
    return {
      ok: true,
      message: removeEnvironment(context.dataRoot, "money-printer")
        ? "Environment removed."
        : "There was no environment to remove.",
      detail: "",
    };
  }
  if (action === "reinstall" && !pythonInVenv(venv, context.platform)) {
    fail("There is no environment to repair yet. Build it first.", 409, "setup_not_installed");
  }
  const root = ensureMoneyPrinterRuntime(context);
  let python = pythonInVenv(venv, context.platform);
  const uv = resolveOnPath("uv", context.env, context.platform);
  if (uv) {
    const installed = await runManagedSetupCommand(
      uv,
      ["sync", "--frozen", "--python", "3.12"],
      {
        cwd: root,
        env: {
          ...inheritedToolEnvironment(context.env),
          UV_LINK_MODE: "copy",
          UV_PROJECT_ENVIRONMENT: venv,
        },
        signal: context.signal,
        timeoutMs: LARGE_PYTHON_INSTALL_TIMEOUT_MS,
        spawnImpl: context.spawnImpl,
        platform: context.platform,
      },
    );
    python = pythonInVenv(venv, context.platform);
    if (installed.code !== 0 || !python) {
      return {
        ok: false,
        message: installed.timedOut
          ? "The install did not finish in time."
          : "uv could not install MoneyPrinter's pinned dependencies.",
        detail: commandTail(installed),
      };
    }
  } else {
    if (!python) {
      const created = await createPythonEnvironment({
        root,
        venv,
        env: context.env,
        signal: context.signal,
        spawnImpl: context.spawnImpl,
        pythonVersion: "3.12",
      });
      if (isRecord(created)) return created;
      python = created;
    }
    const failed = await installPythonRequirements({
      root,
      python,
      requirementArgs: ["-r", path.join(root, "requirements.txt")],
      verifyArgs: ["-c", "import app.asgi, uvicorn; print('ok')"],
      verifyEnv: { PYTHONPATH: root },
      env: context.env,
      signal: context.signal,
      spawnImpl: context.spawnImpl,
      label: "MoneyPrinter",
    });
    if (failed) return failed;
    return { ok: true, message: "MoneyPrinter is installed and ready.", detail: "" };
  }
  const verify = await runManagedSetupCommand(
    python,
    ["-c", "import app.asgi, uvicorn; print('ok')"],
    {
      cwd: root,
      env: { ...inheritedToolEnvironment(context.env), PYTHONPATH: root },
      signal: context.signal,
      timeoutMs: VERIFY_TIMEOUT_MS,
      spawnImpl: context.spawnImpl,
      platform: context.platform,
    },
  );
  return verify.code === 0 && verify.stdout.includes("ok")
    ? { ok: true, message: "MoneyPrinter is installed and ready.", detail: "" }
    : {
        ok: false,
        message: "The install finished but the API server still does not import.",
        detail: commandTail(verify),
      };
}

async function matraixSetup(context) {
  const root = candidateRoot(
    context.appRoot,
    context.env,
    "MATRAIX_ROOT",
    "MatrAIx-Persona-8B",
    [
      ["environment", "runtime", "harbor"],
      ["src", "matraix", "cli.py"],
      ["pyproject.toml"],
      ["packages", "playground", "pyproject.toml"],
    ],
  );
  const bridge = directPath(
    path.join(context.appRoot, "scripts", "matraix-bridge.py"),
    "isFile",
    "The MatrAIx bridge",
  );
  if (!resolveOnPath("uv", context.env, context.platform)) {
    fail(
      "uv is required to build MatrAIx's environment (it pins Python 3.12). Install uv, then try again.",
      409,
      "setup_uv_missing",
    );
  }
  const venv = serviceEnvironment(context.dataRoot, "matraix");
  let python = pythonInVenv(venv, context.platform);
  if (!python) {
    const created = await createPythonEnvironment({
      root,
      venv,
      env: context.env,
      signal: context.signal,
      spawnImpl: context.spawnImpl,
      pythonVersion: "3.12",
      requireUv: true,
    });
    if (isRecord(created)) return created;
    python = created;
  }
  const failed = await installPythonRequirements({
    root,
    python,
    requirementArgs: [root, path.join(root, "packages", "playground")],
    verifyArgs: [bridge, "--root", root, "--check"],
    verifyNeedle: "check.ok",
    env: context.env,
    signal: context.signal,
    spawnImpl: context.spawnImpl,
    label: "MatrAIx",
  });
  if (failed) {
    if (failed.message.includes("dependencies could not be installed")) {
      failed.message = "MatrAIx's environment could not be installed.";
    }
    return failed;
  }
  return { ok: true, message: "MatrAIx is ready.", detail: "" };
}

async function subsaiSetup(action, context) {
  const root = candidateRoot(
    context.appRoot,
    context.env,
    "SUBSAI_ROOT",
    "subsai",
    [
      ["src", "subsai", "cli.py"],
      ["src", "subsai", "configs.py"],
      ["pyproject.toml"],
    ],
  );
  if (action === "remove-subtitles") {
    return {
      ok: true,
      message: removeEnvironment(context.dataRoot, "subsai")
        ? "The subtitle environment was removed."
        : "There was no subtitle environment to remove.",
      detail: "",
    };
  }
  const uv = resolveOnPath("uv", context.env, context.platform);
  if (!uv) {
    fail(
      "uv was not found, and it is what builds this environment. Install uv and try again.",
      409,
      "setup_uv_missing",
    );
  }
  const venv = serviceEnvironment(context.dataRoot, "subsai");
  let python = pythonInVenv(venv, context.platform);
  if (!python) {
    const created = await createPythonEnvironment({
      root,
      venv,
      env: context.env,
      signal: context.signal,
      spawnImpl: context.spawnImpl,
      pythonVersion: "3.11",
      requireUv: true,
    });
    if (isRecord(created)) return created;
    python = created;
  }
  const toolEnvironment = {
    ...inheritedToolEnvironment(context.env),
    UV_LINK_MODE: "copy",
  };
  const dependencies = await runManagedSetupCommand(
    uv,
    [
      "pip", "install",
      "--python", python,
      "--index-strategy", "unsafe-best-match",
      "--extra-index-url", "https://download.pytorch.org/whl/cpu",
      "torch==2.2.0",
      "numpy<2",
      "faster-whisper",
      "pysubs2~=1.6.0",
      "ffsubsync~=0.4.24",
      "dl_translate==0.3.0",
      "ffmpeg-python>=0.2.0",
      "tqdm",
    ],
    {
      cwd: root,
      env: toolEnvironment,
      signal: context.signal,
      timeoutMs: LARGE_PYTHON_INSTALL_TIMEOUT_MS,
      spawnImpl: context.spawnImpl,
      platform: context.platform,
    },
  );
  if (dependencies.code !== 0) {
    return {
      ok: false,
      message: dependencies.timedOut
        ? "The subtitle install did not finish in time."
        : "The subtitle engine could not be installed.",
      detail: commandTail(dependencies),
    };
  }
  const ownPackage = await runManagedSetupCommand(
    uv,
    ["pip", "install", "--python", python, "--no-deps", root],
    {
      cwd: root,
      env: toolEnvironment,
      signal: context.signal,
      timeoutMs: INSTALL_TIMEOUT_MS,
      spawnImpl: context.spawnImpl,
      platform: context.platform,
    },
  );
  if (ownPackage.code !== 0) {
    return {
      ok: false,
      message: "subsai itself could not be installed into the environment.",
      detail: commandTail(ownPackage),
    };
  }
  const verified = await runManagedSetupCommand(
    python,
    ["-c", "import subsai, faster_whisper, torch; print('ok')"],
    {
      cwd: root,
      env: inheritedToolEnvironment(context.env),
      signal: context.signal,
      timeoutMs: VERIFY_TIMEOUT_MS,
      spawnImpl: context.spawnImpl,
      platform: context.platform,
    },
  );
  if (verified.code !== 0 || !verified.stdout.includes("ok")) {
    return {
      ok: false,
      message: "The subtitle install finished but its runtime still does not import.",
      detail: commandTail(verified),
    };
  }
  fs.writeFileSync(
    path.join(venv, "breadboard-models.json"),
    `${JSON.stringify(["guillaumekln/faster-whisper"], null, 2)}\n`,
    { flag: "w", mode: 0o600 },
  );
  return {
    ok: true,
    message: "Subtitles are ready. The first run also downloads the speech model.",
    detail: "",
  };
}

async function boltSlidesSetup(context) {
  const root = candidateRoot(
    context.appRoot,
    context.env,
    "BOLT_SLIDES_ROOT",
    "bolt-slides",
    [
      ["package.json"],
      ["package-lock.json"],
      ["index.html"],
      ["src", "deck", "Deck.tsx"],
      ["src", "styles", "tokens.css"],
    ],
  );
  const destination = path.join(
    context.dataRoot,
    "runtime-v2",
    "toolchains",
    "bolt-slides",
  );
  const staging = path.join(
    context.dataRoot,
    "runtime-v2",
    "toolchains",
    `.bolt-slides-stage-${crypto.randomUUID()}`,
  );
  if (!pathWithin(context.dataRoot, destination) || !pathWithin(context.dataRoot, staging)) {
    fail("The Bolt Slides toolchain escaped Runtime data.");
  }
  fs.mkdirSync(path.dirname(staging), { recursive: true });
  fs.mkdirSync(staging);
  try {
    const state = { bytes: 0, files: 0, maximumBytes: 2 * 1024 * 1024, maximumFiles: 2 };
    for (const name of ["package.json", "package-lock.json"]) {
      copyDirectTree(
        path.join(root, name),
        path.join(staging, name),
        state,
        "The Bolt Slides package closure",
      );
    }
    const npm = context.platform === "win32" ? "npm.cmd" : "npm";
    const installed = await runManagedSetupCommand(
      npm,
      ["ci", "--no-audit", "--no-fund", "--loglevel", "error"],
      {
        cwd: staging,
        env: inheritedToolEnvironment(context.env),
        signal: context.signal,
        timeoutMs: NPM_TOOL_INSTALL_TIMEOUT_MS,
        spawnImpl: context.spawnImpl,
        platform: context.platform,
      },
    );
    const requiredPackages = [
      "vite",
      "react",
      "react-dom",
      "framer-motion",
      "@vitejs/plugin-react",
    ];
    const missing = requiredPackages.filter((name) => {
      const manifest = path.join(staging, "node_modules", ...name.split("/"), "package.json");
      const metadata = fs.lstatSync(manifest, { throwIfNoEntry: false });
      return !metadata?.isFile() || metadata.isSymbolicLink();
    });
    const vite = path.join(staging, "node_modules", "vite", "bin", "vite.js");
    if (installed.code !== 0 || missing.length || !fs.statSync(vite, { throwIfNoEntry: false })?.isFile()) {
      return {
        ok: false,
        message: "Bolt Slides' dependencies could not be installed.",
        detail: missing.length ? `Missing: ${missing.join(", ")}` : commandTail(installed),
      };
    }
    const verified = await runManagedSetupCommand(process.execPath, [vite, "--version"], {
      cwd: staging,
      env: inheritedToolEnvironment(context.env),
      signal: context.signal,
      timeoutMs: VERIFY_TIMEOUT_MS,
      spawnImpl: context.spawnImpl,
      platform: context.platform,
    });
    if (verified.code !== 0) {
      return {
        ok: false,
        message: "Bolt Slides' dependencies were installed but Vite did not start.",
        detail: commandTail(verified),
      };
    }
    replaceDirectDirectory(staging, destination, "The Bolt Slides toolchain");
    return { ok: true, message: "Bolt Slides is ready.", detail: "" };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

async function wardrobeSetup(context) {
  const root = candidateRoot(
    context.appRoot,
    context.env,
    "WARDROBE_ROOT",
    "wardrobe",
    [
      ["package.json"],
      ["package-lock.json"],
      ["index.html"],
      ["vite.config.mjs"],
      ["scripts", "import-job-api.mjs"],
      ["src"],
      ["public"],
    ],
  );
  const toolchainsRoot = path.join(context.dataRoot, "runtime-v2", "toolchains");
  const destination = path.join(toolchainsRoot, "wardrobe");
  const staging = path.join(toolchainsRoot, `.wardrobe-stage-${crypto.randomUUID()}`);
  if (!pathWithin(context.dataRoot, destination) || !pathWithin(context.dataRoot, staging)) {
    fail("The Wardrobe runtime escaped Runtime data.");
  }
  fs.mkdirSync(toolchainsRoot, { recursive: true });
  fs.mkdirSync(staging);
  try {
    const state = { bytes: 0, files: 0, maximumBytes: 128 * 1024 * 1024, maximumFiles: 20_000 };
    for (const relative of [
      "package.json",
      "package-lock.json",
      "index.html",
      "vite.config.mjs",
      "scripts",
      "src",
      "public",
    ]) {
      copyDirectTree(
        path.join(root, relative),
        path.join(staging, relative),
        state,
        "The Wardrobe runtime source",
      );
    }
    const npm = context.platform === "win32" ? "npm.cmd" : "npm";
    const installed = await runManagedSetupCommand(
      npm,
      ["ci", "--no-audit", "--no-fund", "--loglevel", "error"],
      {
        cwd: staging,
        env: inheritedToolEnvironment(context.env),
        signal: context.signal,
        timeoutMs: NPM_TOOL_INSTALL_TIMEOUT_MS,
        spawnImpl: context.spawnImpl,
        platform: context.platform,
      },
    );
    const vite = path.join(staging, "node_modules", "vite", "bin", "vite.js");
    const sharp = path.join(staging, "node_modules", "sharp", "package.json");
    if (
      installed.code !== 0 ||
      !fs.statSync(vite, { throwIfNoEntry: false })?.isFile() ||
      !fs.statSync(sharp, { throwIfNoEntry: false })?.isFile()
    ) {
      return {
        ok: false,
        message: "Wardrobe could not be installed.",
        detail: commandTail(installed),
      };
    }
    const verified = await runManagedSetupCommand(process.execPath, [vite, "--version"], {
      cwd: staging,
      env: inheritedToolEnvironment(context.env),
      signal: context.signal,
      timeoutMs: VERIFY_TIMEOUT_MS,
      spawnImpl: context.spawnImpl,
      platform: context.platform,
    });
    if (verified.code !== 0) {
      return {
        ok: false,
        message: "Wardrobe was installed but Vite did not start.",
        detail: commandTail(verified),
      };
    }
    replaceDirectDirectory(staging, destination, "The Wardrobe runtime");
    return { ok: true, message: "Wardrobe's dependencies are installed.", detail: "" };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

const CAREER_OPS_SCAFFOLD = Object.freeze([
  Object.freeze({ target: "config/profile.yml", template: "config/profile.example.yml" }),
  Object.freeze({ target: "modes/_profile.md", template: "modes/_profile.template.md" }),
  Object.freeze({ target: "modes/_custom.md", template: "modes/_custom.template.md" }),
  Object.freeze({ target: "modes/_brief.md", template: "modes/_brief.template.md" }),
  Object.freeze({ target: "cv.md", template: "examples/cv-example.md" }),
  Object.freeze({ target: "portals.yml", template: "templates/portals.example.yml" }),
]);

const CAREER_OPS_DURABLE_PATHS = Object.freeze([
  "config/profile.yml",
  "modes/_profile.md",
  "modes/_custom.md",
  "modes/_brief.md",
  "cv.md",
  "portals.yml",
  "data",
  "reports",
  "output",
]);

function careerOpsSource(context) {
  return candidateRoot(
    context.appRoot,
    context.env,
    "CAREER_OPS_ROOT",
    "career-ops",
    [
      ["doctor.mjs"],
      ["package.json"],
      ["package-lock.json"],
      ["modes"],
      [".agents", "skills", "career-ops", "SKILL.md"],
    ],
  );
}

function careerOpsRuntimeRoot(context) {
  const destination = path.join(
    context.dataRoot,
    "runtime-v2",
    "toolchains",
    "career-ops",
  );
  if (!pathWithin(context.dataRoot, destination)) {
    fail("The Career Ops runtime escaped Runtime data.");
  }
  return destination;
}

function copyCareerOpsSource(source, staging) {
  const state = {
    bytes: 0,
    files: 0,
    maximumBytes: 256 * 1024 * 1024,
    maximumFiles: 30_000,
  };
  copyFilteredDirectTree(
    source,
    staging,
    state,
    new Set([".git", "node_modules", ".runtime"]),
    "The Career Ops source",
  );
}

function overlayCareerOpsState(existing, staging) {
  const metadata = fs.lstatSync(existing, { throwIfNoEntry: false });
  if (!metadata) return;
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    fail("The Career Ops runtime is indirect.");
  }
  const state = {
    bytes: 0,
    files: 0,
    maximumBytes: 512 * 1024 * 1024,
    maximumFiles: 50_000,
  };
  for (const relative of CAREER_OPS_DURABLE_PATHS) {
    const source = path.join(existing, ...relative.split("/"));
    const sourceMetadata = fs.lstatSync(source, { throwIfNoEntry: false });
    if (!sourceMetadata) continue;
    const destination = path.join(staging, ...relative.split("/"));
    fs.rmSync(destination, { recursive: true, force: true });
    copyDirectTree(source, destination, state, "Career Ops user state");
  }
}

function stageCareerOpsRuntime(context) {
  const source = careerOpsSource(context);
  const destination = careerOpsRuntimeRoot(context);
  const staging = path.join(
    path.dirname(destination),
    `.career-ops-stage-${crypto.randomUUID()}`,
  );
  if (!pathWithin(context.dataRoot, staging)) {
    fail("The Career Ops staging root escaped Runtime data.");
  }
  fs.mkdirSync(path.dirname(staging), { recursive: true });
  copyCareerOpsSource(source, staging);
  overlayCareerOpsState(destination, staging);
  return { destination, staging };
}

async function careerOpsSetup(action, context) {
  const destination = careerOpsRuntimeRoot(context);
  if (action === "browsers") {
    const runtime = directPath(destination, "isDirectory", "The Career Ops runtime");
    const playwright = directPath(
      path.join(runtime, "node_modules", "playwright", "cli.js"),
      "isFile",
      "The Career Ops Playwright launcher",
    );
    const browserRoot = path.join(
      context.dataRoot,
      "runtime-v2",
      "toolchains",
      "career-ops-browsers",
    );
    if (!pathWithin(context.dataRoot, browserRoot)) {
      fail("The Career Ops browser cache escaped Runtime data.");
    }
    fs.mkdirSync(browserRoot, { recursive: true });
    const installed = await runManagedSetupCommand(
      process.execPath,
      [playwright, "install", "chromium"],
      {
        cwd: runtime,
        env: {
          ...inheritedToolEnvironment(context.env),
          PLAYWRIGHT_BROWSERS_PATH: browserRoot,
        },
        signal: context.signal,
        timeoutMs: NPM_TOOL_INSTALL_TIMEOUT_MS,
        spawnImpl: context.spawnImpl,
        platform: context.platform,
      },
    );
    const browserReady = installed.code === 0 && fs.readdirSync(browserRoot)
      .some((name) => name.toLowerCase().startsWith("chromium"));
    return browserReady
      ? {
          ok: true,
          message: "The scanning browser is installed. Portal scans and URL extraction work now.",
          detail: "",
        }
      : {
          ok: false,
          message: "The browser install did not finish. The output below says why.",
          detail: commandTail(installed),
        };
  }

  if (action === "scaffold") {
    if (!fs.existsSync(destination)) {
      const staged = stageCareerOpsRuntime(context);
      try {
        replaceDirectDirectory(staged.staging, staged.destination, "The Career Ops runtime");
      } finally {
        fs.rmSync(staged.staging, { recursive: true, force: true });
      }
    }
    const runtime = directPath(destination, "isDirectory", "The Career Ops runtime");
    const created = [];
    const skipped = [];
    for (const entry of CAREER_OPS_SCAFFOLD) {
      const target = path.join(runtime, ...entry.target.split("/"));
      const template = directPath(
        path.join(runtime, ...entry.template.split("/")),
        "isFile",
        `The ${entry.target} template`,
      );
      if (!pathWithin(runtime, target)) fail("A Career Ops scaffold path escaped its runtime.");
      if (fs.existsSync(target)) {
        skipped.push(entry.target);
        continue;
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(template, target, fs.constants.COPYFILE_EXCL);
      created.push(entry.target);
    }
    return {
      ok: true,
      message: created.length
        ? `Created ${created.join(", ")}. They are starting points — replace the example CV and profile with the user's own.`
        : "Every candidate file already exists; nothing was overwritten.",
      detail: skipped.length ? `Left alone: ${skipped.join(", ")}` : "",
    };
  }

  const staged = stageCareerOpsRuntime(context);
  try {
    const npm = context.platform === "win32" ? "npm.cmd" : "npm";
    const installed = await runManagedSetupCommand(
      npm,
      ["ci", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel", "error"],
      {
        cwd: staged.staging,
        env: inheritedToolEnvironment(context.env),
        signal: context.signal,
        timeoutMs: NPM_TOOL_INSTALL_TIMEOUT_MS,
        spawnImpl: context.spawnImpl,
        platform: context.platform,
      },
    );
    const yaml = path.join(staged.staging, "node_modules", "js-yaml", "package.json");
    if (installed.code !== 0 || !fs.statSync(yaml, { throwIfNoEntry: false })?.isFile()) {
      return {
        ok: false,
        message: "The dependency install did not finish. The output below says why.",
        detail: commandTail(installed),
      };
    }
    replaceDirectDirectory(staged.staging, staged.destination, "The Career Ops runtime");
    return { ok: true, message: "career-ops's dependencies are installed.", detail: "" };
  } finally {
    fs.rmSync(staged.staging, { recursive: true, force: true });
  }
}

const OPENMONTAGE_RUNTIME_MARKERS = Object.freeze([
  Object.freeze(["AGENT_GUIDE.md"]),
  Object.freeze(["requirements.txt"]),
  Object.freeze(["tools", "tool_registry.py"]),
  Object.freeze(["remotion-composer", "package.json"]),
  Object.freeze(["remotion-composer", "package-lock.json"]),
]);

function openMontageSource(context) {
  return candidateRoot(
    context.appRoot,
    {},
    "OPENMONTAGE_ROOT",
    "OpenMontage",
    OPENMONTAGE_RUNTIME_MARKERS,
  );
}

function openMontageRuntimeRoot(context) {
  const destination = path.join(
    context.dataRoot,
    "runtime-v2",
    "toolchains",
    "openmontage",
  );
  if (!pathWithin(context.dataRoot, destination)) {
    fail("The OpenMontage runtime escaped Runtime data.");
  }
  return destination;
}

function verifyOpenMontageRuntime(root) {
  const runtime = directPath(root, "isDirectory", "The OpenMontage runtime");
  for (const marker of OPENMONTAGE_RUNTIME_MARKERS) {
    directPath(
      path.join(runtime, ...marker),
      "isFile",
      `The OpenMontage ${marker.join("/")} source`,
    );
  }
  return runtime;
}

function ensureOpenMontageRuntime(context) {
  const destination = openMontageRuntimeRoot(context);
  const existing = fs.lstatSync(destination, { throwIfNoEntry: false });
  if (existing) return verifyOpenMontageRuntime(destination);

  const source = openMontageSource(context);
  const staging = path.join(
    path.dirname(destination),
    `.openmontage-stage-${crypto.randomUUID()}`,
  );
  if (!pathWithin(context.dataRoot, staging)) {
    fail("The OpenMontage staging root escaped Runtime data.");
  }
  fs.mkdirSync(path.dirname(staging), { recursive: true });
  try {
    copyFilteredDirectTree(
      source,
      staging,
      {
        bytes: 0,
        files: 0,
        maximumBytes: 512 * 1024 * 1024,
        maximumFiles: 40_000,
      },
      new Set([".git", ".venv", ".runtime", ".cache", "__pycache__", "node_modules", "projects"]),
      "The OpenMontage runtime source",
    );
    verifyOpenMontageRuntime(staging);
    replaceDirectDirectory(staging, destination, "The OpenMontage runtime");
    return verifyOpenMontageRuntime(destination);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

async function openMontageSetup(action, context) {
  const root = ensureOpenMontageRuntime(context);
  if (action === "install-remotion") {
    const composer = directPath(
      path.join(root, "remotion-composer"),
      "isDirectory",
      "The OpenMontage Remotion source",
    );
    const npm = context.platform === "win32" ? "npm.cmd" : "npm";
    const installed = await runManagedSetupCommand(
      npm,
      ["ci", "--no-audit", "--no-fund", "--loglevel", "error"],
      {
        cwd: composer,
        env: inheritedToolEnvironment(context.env),
        signal: context.signal,
        timeoutMs: NPM_TOOL_INSTALL_TIMEOUT_MS,
        spawnImpl: context.spawnImpl,
        platform: context.platform,
      },
    );
    const remotion = fs.lstatSync(
      path.join(composer, "node_modules", "remotion", "package.json"),
      { throwIfNoEntry: false },
    );
    if (installed.code !== 0 || !remotion?.isFile() || remotion.isSymbolicLink()) {
      return {
        ok: false,
        message: "Remotion could not be installed.",
        detail: commandTail(installed),
      };
    }
    return { ok: true, message: "Installed the Remotion composition runtime.", detail: "" };
  }

  const venv = serviceEnvironment(context.dataRoot, "openmontage");
  let python = pythonInVenv(venv, context.platform);
  if (!python) {
    const created = await createPythonEnvironment({
      root,
      venv,
      env: context.env,
      signal: context.signal,
      spawnImpl: context.spawnImpl,
    });
    if (isRecord(created)) return created;
    python = created;
  }
  const failed = await installPythonRequirements({
    root,
    python,
    requirementArgs: ["-r", path.join(root, "requirements.txt")],
    verifyArgs: [
      "-c",
      "import yaml, pydantic, jsonschema, dotenv, PIL, numpy, requests; print('ok')",
    ],
    env: context.env,
    signal: context.signal,
    spawnImpl: context.spawnImpl,
    label: "OpenMontage",
  });
  if (failed) return failed;
  fs.writeFileSync(
    path.join(venv, "breadboard-runtime.json"),
    `${JSON.stringify({ ready: true }, null, 2)}\n`,
    { flag: "w", mode: 0o600 },
  );
  return { ok: true, message: "Installed OpenMontage's Python dependencies.", detail: "" };
}

async function createResource2SkillEnvironment(context, root, venv) {
  const uv = resolveOnPath("uv", context.env, context.platform);
  let result;
  if (uv) {
    result = await runManagedSetupCommand(uv, ["venv", "--python", "3.11", venv], {
      cwd: root,
      env: { ...inheritedToolEnvironment(context.env), UV_LINK_MODE: "copy" },
      signal: context.signal,
      timeoutMs: VENV_TIMEOUT_MS,
      spawnImpl: context.spawnImpl,
      platform: context.platform,
    });
  } else if (context.platform === "win32") {
    const launcher = resolveOnPath("py", context.env, context.platform);
    if (!launcher) {
      fail("Python 3.11 is required. Install it or install uv, then retry.", 409, "setup_python_missing");
    }
    result = await runManagedSetupCommand(
      launcher,
      ["-3.11", "-m", "venv", venv],
      {
        cwd: root,
        env: inheritedToolEnvironment(context.env),
        signal: context.signal,
        timeoutMs: VENV_TIMEOUT_MS,
        spawnImpl: context.spawnImpl,
        platform: context.platform,
      },
    );
  } else {
    const launcher = resolveOnPath("python3.11", context.env, context.platform);
    if (!launcher) {
      fail("Python 3.11 is required. Install it or install uv, then retry.", 409, "setup_python_missing");
    }
    result = await runManagedSetupCommand(launcher, ["-m", "venv", venv], {
      cwd: root,
      env: inheritedToolEnvironment(context.env),
      signal: context.signal,
      timeoutMs: VENV_TIMEOUT_MS,
      spawnImpl: context.spawnImpl,
      platform: context.platform,
    });
  }
  const python = pythonInVenv(venv, context.platform);
  if (result.code !== 0 || !python) {
    return {
      ok: false,
      message: "The Resource2Skill Python 3.11 environment could not be created.",
      detail: commandTail(result),
    };
  }
  return python;
}

async function resource2SkillSetup(action, context) {
  const root = candidateRoot(
    context.appRoot,
    {},
    "RESOURCE2SKILL_ROOT",
    "Resource2Skill",
    [["cli.py"], ["core", "agent_executor.py"], ["requirements.txt"]],
  );
  const bridge = directPath(
    path.join(context.appRoot, "scripts", "resource2skill-bridge.py"),
    "isFile",
    "The Resource2Skill bridge",
  );
  const venv = serviceEnvironment(context.dataRoot, "resource2skill");
  const browserRoot = path.join(
    context.dataRoot,
    "runtime-v2",
    "services",
    "resource2skill",
    "browsers",
  );
  if (!pathWithin(context.dataRoot, browserRoot)) {
    fail("The Resource2Skill browser cache escaped Runtime data.");
  }
  let python = pythonInVenv(venv, context.platform);
  if (!python) {
    const created = await createResource2SkillEnvironment(context, root, venv);
    if (isRecord(created)) return created;
    python = created;
  }
  const uv = resolveOnPath("uv", context.env, context.platform);
  const toolEnvironment = {
    ...inheritedToolEnvironment(context.env),
    UV_LINK_MODE: "copy",
  };
  const install = async (args) => uv
    ? runManagedSetupCommand(uv, ["pip", "install", "--python", python, ...args], {
        cwd: root,
        env: toolEnvironment,
        signal: context.signal,
        timeoutMs: INSTALL_TIMEOUT_MS,
        spawnImpl: context.spawnImpl,
        platform: context.platform,
      })
    : runManagedSetupCommand(python, ["-m", "pip", "install", ...args], {
        cwd: root,
        env: toolEnvironment,
        signal: context.signal,
        timeoutMs: INSTALL_TIMEOUT_MS,
        spawnImpl: context.spawnImpl,
        platform: context.platform,
      });
  const requirements = await install(["-r", path.join(root, "requirements.txt")]);
  if (requirements.code !== 0) {
    return {
      ok: false,
      message: "Resource2Skill dependencies could not be installed.",
      detail: commandTail(requirements),
    };
  }
  if (action === "install-blender") {
    const blender = await install(["bpy"]);
    if (blender.code !== 0) {
      return { ok: false, message: "Blender support could not be installed.", detail: commandTail(blender) };
    }
    const blenderProbe = await runManagedSetupCommand(python, ["-c", "import bpy; print('ok')"], {
      cwd: root,
      env: toolEnvironment,
      signal: context.signal,
      timeoutMs: VERIFY_TIMEOUT_MS,
      spawnImpl: context.spawnImpl,
      platform: context.platform,
    });
    if (blenderProbe.code !== 0 || !blenderProbe.stdout.includes("ok")) {
      return { ok: false, message: "Blender support was installed but does not import.", detail: commandTail(blenderProbe) };
    }
    fs.writeFileSync(path.join(venv, "breadboard-blender.json"), '{"ready":true}\n', {
      flag: "w",
      mode: 0o600,
    });
  }
  if (action === "install-web") {
    fs.mkdirSync(browserRoot, { recursive: true });
    const web = await runManagedSetupCommand(
      python,
      ["-m", "playwright", "install", "chromium"],
      {
        cwd: root,
        env: { ...toolEnvironment, PLAYWRIGHT_BROWSERS_PATH: browserRoot },
        signal: context.signal,
        timeoutMs: NPM_TOOL_INSTALL_TIMEOUT_MS,
        spawnImpl: context.spawnImpl,
        platform: context.platform,
      },
    );
    if (
      web.code !== 0 ||
      !fs.readdirSync(browserRoot).some((name) => name.toLowerCase().startsWith("chromium"))
    ) {
      return { ok: false, message: "Web support could not install Chromium.", detail: commandTail(web) };
    }
  }
  const workspace = path.join(venv, ".check");
  fs.mkdirSync(workspace, { recursive: true });
  const checked = await runManagedSetupCommand(
    python,
    [
      bridge,
      "--check",
      "--root", root,
      "--workspace", workspace,
      "--domain", "web",
      "--task", "check",
    ],
    {
      cwd: root,
      env: {
        ...toolEnvironment,
        PLAYWRIGHT_BROWSERS_PATH: browserRoot,
      },
      signal: context.signal,
      timeoutMs: VERIFY_TIMEOUT_MS,
      spawnImpl: context.spawnImpl,
      platform: context.platform,
    },
  );
  if (checked.code !== 0 || !checked.stdout.includes("check.completed")) {
    return {
      ok: false,
      message: "Resource2Skill was installed but its bridge did not start.",
      detail: commandTail(checked),
    };
  }
  const versionMatch = /"python"\s*:\s*"(3\.11\.[^"]*)"/u.exec(checked.stdout);
  const version = versionMatch?.[1] ?? "3.11";
  fs.writeFileSync(
    path.join(venv, "breadboard-runtime.json"),
    `${JSON.stringify({ ready: true, version }, null, 2)}\n`,
    { flag: "w", mode: 0o600 },
  );
  return { ok: true, message: "Resource2Skill is ready.", detail: "" };
}

function audioNames(platform = process.platform) {
  const extension = platform === "win32" ? ".exe" : "";
  return [`mcp-server${extension}`, `cli${extension}`];
}

function audioPlan(context) {
  const binDirectory = path.join(context.dataRoot, "runtime-v2", "audio-analyzer", "bin");
  if (!pathWithin(context.dataRoot, binDirectory)) fail("The audio install root escaped Runtime data.");
  const configuredRoot = context.env.AUDIO_ANALYZER_ROOT?.trim();
  const cloneRoot = configuredRoot
    ? path.resolve(configuredRoot)
    : path.join(context.appRoot, "audio-analyzer-rs");
  return {
    binDirectory,
    cloneRoot,
    binaries: audioNames(context.platform),
  };
}

async function probeAudio(plan, context) {
  const server = path.join(plan.binDirectory, plan.binaries[0]);
  const metadata = fs.lstatSync(server, { throwIfNoEntry: false });
  if (!metadata?.isFile() || metadata.isSymbolicLink() || metadata.size < 1) return false;
  const request = `${JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "breadboard-runtime-setup", version: "1" },
    },
  })}\n`;
  if (context.signal.aborted) return false;
  return await new Promise((resolve, reject) => {
    let settled = false;
    let stdout = "";
    let timer = null;
    const child = context.spawnImpl(server, [], {
      cwd: plan.binDirectory,
      env: inheritedToolEnvironment(context.env),
      detached: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdout?.setEncoding?.("utf8");
    child.stdout?.on?.("data", (chunk) => {
      stdout = appendTail(stdout, chunk, 64 * 1024);
      if (stdout.includes('"serverInfo"')) terminate(true);
    });
    const done = (value, error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      context.signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(value);
    };
    const terminate = (success = false) => {
      try { child.kill(); } catch { /* already gone */ }
      if (success) done(true);
    };
    const abort = () => {
      terminate();
      done(false, context.signal.reason ?? new DOMException("Aborted", "AbortError"));
    };
    context.signal.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => terminate(false), AUDIO_PROBE_TIMEOUT_MS);
    timer.unref?.();
    child.once("error", () => done(false));
    child.once("close", () => done(stdout.includes('"serverInfo"')));
    child.stdin?.end?.(request);
  });
}

function readZip(buffer) {
  const files = new Map();
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end -= 1;
  if (end < 0) fail("The audio release archive has no zip directory.");
  const count = buffer.readUInt16LE(end + 10);
  let cursor = buffer.readUInt32LE(end + 16);
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) {
      fail("The audio release zip directory is corrupt.");
    }
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    cursor += 46 + nameLength + extraLength + commentLength;
    if (name.includes("..") || path.isAbsolute(name) || name.includes("\\")) continue;
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      fail("The audio release zip header is corrupt.");
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const endOfData = start + compressedSize;
    if (endOfData > buffer.length) fail("The audio release zip is truncated.");
    const raw = buffer.subarray(start, endOfData);
    if (method === 0) files.set(path.posix.basename(name), Buffer.from(raw));
    else if (method === 8) files.set(path.posix.basename(name), zlib.inflateRawSync(raw));
    else fail(`Unsupported audio zip compression method ${method}.`);
  }
  return files;
}

function readTarGz(buffer) {
  const tar = zlib.gunzipSync(buffer, { maxOutputLength: MAX_DOWNLOAD_BYTES });
  const files = new Map();
  for (let offset = 0; offset + 512 <= tar.length; ) {
    const name = tar.toString("utf8", offset, offset + 100).replace(/\0.*$/u, "");
    if (!name) break;
    const size = Number.parseInt(
      tar.toString("utf8", offset + 124, offset + 136).replace(/\0.*$/u, "").trim() || "0",
      8,
    );
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_DOWNLOAD_BYTES) {
      fail("The audio release tar contains an invalid member.");
    }
    const type = tar.toString("utf8", offset + 156, offset + 157);
    const start = offset + 512;
    if ((type === "0" || type === "\0") && !name.includes("..") && !path.isAbsolute(name)) {
      files.set(path.posix.basename(name), Buffer.from(tar.subarray(start, start + size)));
    }
    offset = start + Math.ceil(size / 512) * 512;
  }
  return files;
}

async function boundedDownload(url, context) {
  const response = await context.fetchImpl(url, {
    redirect: "follow",
    signal: AbortSignal.any([context.signal, AbortSignal.timeout(10 * 60_000)]),
  });
  if (!response.ok || !response.body) {
    fail(`The audio release download failed with HTTP ${response.status}.`, 502, "setup_download_failed");
  }
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_DOWNLOAD_BYTES) {
    fail("The audio release download exceeded its bound.", 502, "setup_download_too_large");
  }
  const chunks = [];
  let total = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_DOWNLOAD_BYTES) {
      await reader.cancel().catch(() => undefined);
      fail("The audio release download exceeded its bound.", 502, "setup_download_too_large");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

function atomicInstallFiles(binDirectory, binaries, members, platform) {
  const parent = path.dirname(binDirectory);
  fs.mkdirSync(parent, { recursive: true });
  directPath(parent, "isDirectory", "The audio install parent");
  const staging = fs.mkdtempSync(path.join(parent, ".audio-install-"));
  const backup = fs.mkdtempSync(path.join(parent, ".audio-backup-"));
  const replaced = [];
  try {
    for (const name of binaries) {
      const contents = members.get(name);
      if (!contents?.length) fail(`The audio release did not contain ${name}.`);
      const target = path.join(staging, name);
      fs.writeFileSync(target, contents, { flag: "wx", mode: 0o755 });
      if (platform !== "win32") fs.chmodSync(target, 0o755);
    }
    fs.mkdirSync(binDirectory, { recursive: true });
    directPath(binDirectory, "isDirectory", "The audio install directory");
    for (const name of binaries) {
      const destination = path.join(binDirectory, name);
      const existing = fs.lstatSync(destination, { throwIfNoEntry: false });
      if (existing) {
        if (!existing.isFile() || existing.isSymbolicLink()) {
          fail(`The existing audio ${name} is not a direct regular file.`);
        }
        fs.renameSync(destination, path.join(backup, name));
      }
      fs.renameSync(path.join(staging, name), path.join(binDirectory, name));
      replaced.push(name);
    }
  } catch (error) {
    for (const name of replaced.reverse()) {
      fs.rmSync(path.join(binDirectory, name), { force: true });
      const previous = path.join(backup, name);
      if (fs.existsSync(previous)) fs.renameSync(previous, path.join(binDirectory, name));
    }
    for (const name of binaries) {
      const previous = path.join(backup, name);
      const destination = path.join(binDirectory, name);
      if (fs.existsSync(previous) && !fs.existsSync(destination)) {
        fs.renameSync(previous, destination);
      }
    }
    throw error;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
    fs.rmSync(backup, { recursive: true, force: true });
  }
}

async function downloadAudio(plan, context) {
  const asset = AUDIO_ASSETS[`${context.platform}-${context.arch}`];
  if (!asset) {
    fail(
      `No published audio-analyzer build exists for ${context.platform}-${context.arch}.`,
      409,
      "setup_platform_unsupported",
    );
  }
  const bytes = await boundedDownload(`${AUDIO_RELEASE_BASE}/${asset.file}`, context);
  const digest = crypto.createHash("sha256").update(bytes).digest("hex");
  if (digest !== asset.sha256) {
    fail("The audio release checksum did not match; nothing was installed.", 502, "setup_checksum_mismatch");
  }
  const members = asset.file.endsWith(".zip") ? readZip(bytes) : readTarGz(bytes);
  atomicInstallFiles(plan.binDirectory, plan.binaries, members, context.platform);
}

async function buildAudio(plan, context) {
  const manifest = path.join(plan.cloneRoot, "Cargo.toml");
  if (!fs.statSync(manifest, { throwIfNoEntry: false })?.isFile()) return false;
  const cargo = resolveOnPath("cargo", context.env, context.platform);
  if (!cargo) return false;
  const cargoTarget = path.join(
    context.dataRoot,
    "runtime-v2",
    "toolchains",
    "audio-analyzer",
    "cargo-target",
  );
  if (!pathWithin(context.dataRoot, cargoTarget)) {
    fail("The audio build directory escaped Runtime data.");
  }
  fs.mkdirSync(cargoTarget, { recursive: true });
  const result = await runManagedSetupCommand(cargo, ["build", "--release", "--locked"], {
    cwd: directPath(plan.cloneRoot, "isDirectory", "The audio-analyzer source root"),
    env: { ...inheritedToolEnvironment(context.env), CARGO_TARGET_DIR: cargoTarget },
    signal: context.signal,
    timeoutMs: AUDIO_BUILD_TIMEOUT_MS,
    spawnImpl: context.spawnImpl,
    platform: context.platform,
  });
  if (result.code !== 0) return false;
  const members = new Map();
  for (const name of plan.binaries) {
    const built = path.join(cargoTarget, "release", name);
    const metadata = fs.lstatSync(built, { throwIfNoEntry: false });
    if (!metadata?.isFile() || metadata.isSymbolicLink() || metadata.size < 1) return false;
    members.set(name, fs.readFileSync(built));
  }
  atomicInstallFiles(plan.binDirectory, plan.binaries, members, context.platform);
  return true;
}

async function audioSetup(action, context) {
  const plan = audioPlan(context);
  const ready = await probeAudio(plan, context);
  if (action === "check") {
    return {
      ok: ready,
      message: ready
        ? `Audio analyzer ${AUDIO_ANALYZER_VERSION} is ready.`
        : "The audio analyzer is not installed or did not start.",
      detail: "",
    };
  }
  if (ready && action !== "download") {
    return { ok: true, message: `Audio analyzer ${AUDIO_ANALYZER_VERSION} is ready.`, detail: "" };
  }
  const built = action === "download" ? false : await buildAudio(plan, context);
  if (!built) await downloadAudio(plan, context);
  if (!(await probeAudio(plan, context))) {
    return {
      ok: false,
      message: "The audio analyzer was installed but its server did not start.",
      detail: "",
    };
  }
  return { ok: true, message: `Audio analyzer ${AUDIO_ANALYZER_VERSION} is ready.`, detail: "" };
}

function googleImagesSourceRoot(context) {
  const configured = context.env.BREADBOARD_GOOGLE_IMAGES_ROOT?.trim();
  const root = configured ? path.resolve(configured) : path.join(context.appRoot, "mcp-google-images-search");
  const direct = directPath(root, "isDirectory", "The Google image-search clone");
  directPath(path.join(direct, "package.json"), "isFile", "The Google image-search manifest");
  directPath(path.join(direct, "package-lock.json"), "isFile", "The Google image-search lockfile");
  directPath(path.join(direct, "tsconfig.json"), "isFile", "The Google image-search TypeScript config");
  directPath(path.join(direct, "src"), "isDirectory", "The Google image-search source");
  return direct;
}

function googleImagesRuntimeRoot(context) {
  const root = path.join(context.dataRoot, "runtime-v2", "toolchains", "google-images");
  if (!pathWithin(context.dataRoot, root)) fail("The Google image-search install root escaped Runtime data.");
  return root;
}

function copyDirectTree(source, destination, state, label = "The setup source") {
  const metadata = fs.lstatSync(source);
  if (metadata.isSymbolicLink()) fail(`${label} contains an indirect path.`);
  if (metadata.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true });
    for (const name of fs.readdirSync(source)) {
      copyDirectTree(path.join(source, name), path.join(destination, name), state, label);
    }
    return;
  }
  if (!metadata.isFile()) fail(`${label} contains an unsupported entry.`);
  state.bytes += metadata.size;
  state.files += 1;
  if (
    state.bytes > (state.maximumBytes ?? 16 * 1024 * 1024) ||
    state.files > (state.maximumFiles ?? 2_000)
  ) {
    fail(`${label} closure exceeded its bound.`);
  }
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
}

function copyFilteredDirectTree(
  source,
  destination,
  state,
  excludedNames,
  label = "The setup source",
) {
  const metadata = fs.lstatSync(source);
  if (metadata.isSymbolicLink()) fail(`${label} contains an indirect path.`);
  if (metadata.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true });
    for (const name of fs.readdirSync(source)) {
      if (excludedNames.has(name)) continue;
      copyFilteredDirectTree(
        path.join(source, name),
        path.join(destination, name),
        state,
        excludedNames,
        label,
      );
    }
    return;
  }
  if (!metadata.isFile()) fail(`${label} contains an unsupported entry.`);
  state.bytes += metadata.size;
  state.files += 1;
  if (
    state.bytes > (state.maximumBytes ?? 128 * 1024 * 1024) ||
    state.files > (state.maximumFiles ?? 20_000)
  ) {
    fail(`${label} closure exceeded its bound.`);
  }
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
}

function stageGoogleImagesSource(source, staging) {
  fs.mkdirSync(staging);
  const state = { bytes: 0, files: 0 };
  for (const relative of ["package.json", "package-lock.json", "tsconfig.json", "src"]) {
    copyDirectTree(
      path.join(source, relative),
      path.join(staging, relative),
      state,
    );
  }
}

function replaceDirectDirectory(staging, destination, label = "The managed install") {
  const parent = path.dirname(destination);
  const backup = path.join(parent, `.managed-backup-${crypto.randomUUID()}`);
  const existing = fs.lstatSync(destination, { throwIfNoEntry: false });
  if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) {
    fail(`${label} root is not a direct directory.`);
  }
  let movedExisting = false;
  try {
    if (existing) {
      fs.renameSync(destination, backup);
      movedExisting = true;
    }
    fs.renameSync(staging, destination);
  } catch (error) {
    if (!fs.existsSync(destination) && movedExisting && fs.existsSync(backup)) {
      fs.renameSync(backup, destination);
    }
    throw error;
  }
  if (movedExisting) {
    try {
      fs.rmSync(backup, { recursive: true, force: true });
    } catch {
      // The verified install is authoritative; a stale backup is recoverable
      // and must not turn a completed setup into a false failure.
    }
  }
}

const COMFYUI_ACTIVE_PHASES = new Set([
  "preparing",
  "environment",
  "tooling",
  "acceleration",
  "dependencies",
]);
const COMFYUI_SOURCE_EXCLUSIONS = new Set([
  ".ci",
  ".git",
  ".github",
  ".mypy_cache",
  ".pytest_cache",
  ".runtime",
  ".venv",
  "__pycache__",
  "input",
  "models",
  "node_modules",
  "output",
  "script_examples",
  "temp",
  "tests",
  "tests-unit",
  "user",
]);

function comfyUiSourceRoot(context) {
  // Never accept COMFYUI_ROOT here. Runtime supplies that variable for the
  // installed data-root copy, while setup authority is the fixed, reviewed
  // source staged with Breadboard.
  const root = directPath(
    path.join(context.appRoot, "comfyui"),
    "isDirectory",
    "The staged ComfyUI source",
  );
  for (const relative of ["main.py", "requirements.txt", "folder_paths.py", "server.py"]) {
    directPath(path.join(root, relative), "isFile", `The ComfyUI ${relative} source`);
  }
  return root;
}

function comfyUiRuntimeRoot(context) {
  const root = path.join(context.dataRoot, "runtime-v2", "toolchains", "comfyui");
  if (!pathWithin(context.dataRoot, root)) {
    fail("The ComfyUI runtime root escaped Runtime data.", 400, "setup_path_invalid");
  }
  return root;
}

function prepareComfyUiDataRoot(context) {
  const root = path.join(context.dataRoot, "comfyui");
  if (!pathWithin(context.dataRoot, root)) {
    fail("The ComfyUI data root escaped Runtime data.", 400, "setup_path_invalid");
  }
  ensureDirectDirectory(root, "The ComfyUI data root");
  for (const name of ["custom_nodes", "input", "models", "output", "temp", "user"]) {
    ensureDirectDirectory(path.join(root, name), `The ComfyUI ${name} directory`);
  }
  return root;
}

function stageComfyUiSource(source, destination, context) {
  const parent = path.dirname(destination);
  ensureDirectDirectory(path.dirname(parent), "The Runtime V2 root");
  ensureDirectDirectory(parent, "The Runtime V2 toolchains root");
  const staging = path.join(parent, `.comfyui-stage-${crypto.randomUUID()}`);
  if (!pathWithin(context.dataRoot, staging)) {
    fail("The ComfyUI staging root escaped Runtime data.", 400, "setup_path_invalid");
  }
  fs.mkdirSync(staging);
  try {
    copyFilteredDirectTree(
      source,
      staging,
      {
        bytes: 0,
        files: 0,
        maximumBytes: 256 * 1024 * 1024,
        maximumFiles: 50_000,
      },
      COMFYUI_SOURCE_EXCLUSIONS,
      "The ComfyUI source",
    );
    for (const relative of ["main.py", "requirements.txt", "folder_paths.py", "server.py"]) {
      directPath(path.join(staging, relative), "isFile", `The staged ComfyUI ${relative}`);
    }
    replaceDirectDirectory(staging, destination, "The ComfyUI runtime");
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function createComfyUiStatusWriter(venv) {
  const serviceRoot = path.dirname(venv);
  const statusPath = path.join(serviceRoot, "startup-status.json");
  const startedAt = new Date().toISOString();
  const state = {
    phase: "preparing",
    message: "Preparing the local image generator.",
    startedAt,
    updatedAt: startedAt,
    pid: process.pid,
    step: 0,
    totalSteps: 4,
    detail: null,
    progress: null,
  };
  let heartbeat = null;

  const persist = () => {
    state.updatedAt = new Date().toISOString();
    const existing = fs.lstatSync(statusPath, { throwIfNoEntry: false });
    if (existing && (!existing.isFile() || existing.isSymbolicLink())) {
      fail("The ComfyUI setup status path is indirect.", 400, "setup_path_indirect");
    }
    const temporary = `${statusPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    const payload = `${JSON.stringify(state)}\n`;
    fs.writeFileSync(temporary, payload, { flag: "wx", mode: 0o600 });
    try {
      try {
        fs.renameSync(temporary, statusPath);
      } catch (error) {
        if (!existing || !["EACCES", "EBUSY", "EEXIST", "EPERM"].includes(error?.code)) {
          throw error;
        }
        fs.rmSync(statusPath, { force: true });
        fs.renameSync(temporary, statusPath);
      }
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  };
  const write = (phase, message, extra = {}) => {
    Object.assign(state, {
      phase,
      message: String(message).slice(0, 8_000),
      ...extra,
    });
    persist();
    if (COMFYUI_ACTIVE_PHASES.has(phase)) {
      if (!heartbeat) {
        heartbeat = setInterval(persist, 5_000);
        heartbeat.unref?.();
      }
    } else if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };
  const stop = () => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
  };
  return { state, persist, write, stop };
}

function createComfyUiOutputObserver(status) {
  const buffers = { stdout: "", stderr: "" };
  let lastProgressWrite = 0;
  const describeArtifact = (filename) => {
    let decoded = filename;
    try {
      decoded = decodeURIComponent(filename);
    } catch {
      // Keep the bounded package filename when pip printed invalid escaping.
    }
    decoded = decoded.replace(/\.(?:whl|tar\.gz|zip)$/iu, "");
    const match = /^([A-Za-z0-9._]+?)-(\d[^-]*)/u.exec(decoded);
    return (match ? `${match[1]} ${match[2]}` : decoded).slice(0, 1_024);
  };
  const observeLine = (line) => {
    const progress = /^\s*Progress\s+(\d+)\s+of\s+(\d+)\s*$/u.exec(line);
    if (progress) {
      const receivedBytes = Number(progress[1]);
      const totalBytes = Number(progress[2]);
      if (Number.isSafeInteger(receivedBytes) && Number.isSafeInteger(totalBytes) && totalBytes > 0) {
        status.state.progress = {
          receivedBytes: Math.min(receivedBytes, totalBytes),
          totalBytes,
        };
        const now = Date.now();
        if (now - lastProgressWrite >= 1_000) {
          lastProgressWrite = now;
          status.persist();
        }
      }
      return;
    }
    const downloading = /^\s*Downloading\s+(\S+)/u.exec(line);
    if (downloading) {
      status.state.detail = describeArtifact(downloading[1]);
      status.state.progress = null;
      status.persist();
    } else if (/^\s*Installing collected packages:/u.test(line)) {
      status.state.detail = "Unpacking the downloaded packages";
      status.state.progress = null;
      status.persist();
    }
  };
  return (chunk, stream) => {
    buffers[stream] = `${buffers[stream]}${chunk}`.slice(-16 * 1024);
    let newline = buffers[stream].indexOf("\n");
    while (newline >= 0) {
      observeLine(buffers[stream].slice(0, newline).replace(/\r$/u, ""));
      buffers[stream] = buffers[stream].slice(newline + 1);
      newline = buffers[stream].indexOf("\n");
    }
  };
}

async function detectComfyUiGpu(context) {
  const executable = resolveOnPath("nvidia-smi", context.env, context.platform);
  if (!executable) return null;
  const probe = await runManagedSetupCommand(
    executable,
    ["--query-gpu=name", "--format=csv,noheader"],
    {
      cwd: context.dataRoot,
      env: inheritedToolEnvironment(context.env),
      signal: context.signal,
      timeoutMs: 30_000,
      spawnImpl: context.spawnImpl,
      platform: context.platform,
    },
  );
  if (probe.code !== 0) return null;
  return probe.stdout.trim().split(/\r?\n/u)[0]?.slice(0, 256) || null;
}

async function comfyUiSetup(context) {
  const source = comfyUiSourceRoot(context);
  const runtime = comfyUiRuntimeRoot(context);
  const venv = serviceEnvironment(context.dataRoot, "comfyui");
  const status = createComfyUiStatusWriter(venv);
  const outputObserver = createComfyUiOutputObserver(status);
  const toolEnv = {
    ...inheritedToolEnvironment(context.env),
    PIP_NO_INPUT: "1",
    PYTHONNOUSERSITE: "1",
    UV_LINK_MODE: "copy",
  };
  const command = (executable, args, timeoutMs) => runManagedSetupCommand(
    executable,
    args,
    {
      cwd: runtime,
      env: toolEnv,
      signal: context.signal,
      timeoutMs,
      spawnImpl: context.spawnImpl,
      platform: context.platform,
      onOutput: outputObserver,
    },
  );
  const failed = (message, result) => {
    const detail = commandTail(result);
    status.write("error", message, { detail: detail || null, progress: null });
    return { ok: false, message, detail };
  };

  try {
    status.write("preparing", "Preparing the local image generator.", {
      step: 0,
      totalSteps: 4,
      detail: null,
      progress: null,
    });
    stageComfyUiSource(source, runtime, context);
    prepareComfyUiDataRoot(context);

    let python = pythonInVenv(venv, context.platform);
    if (python && fs.existsSync(path.join(venv, ".breadboard-comfyui-ready"))) {
      const ready = await command(
        python,
        ["-s", "-c", "import torch; import server; print('ok')"],
        VERIFY_TIMEOUT_MS,
      );
      if (ready.code === 0 && ready.stdout.includes("ok")) {
        status.write("installed", "ComfyUI is already installed.", {
          step: 4,
          totalSteps: 4,
          detail: null,
          progress: null,
        });
        return { ok: true, message: "ComfyUI is already installed.", detail: commandTail(ready) };
      }
    }

    if (!python) {
      const partial = fs.lstatSync(venv, { throwIfNoEntry: false });
      if (partial) {
        if (!partial.isDirectory() || partial.isSymbolicLink()) {
          fail("The ComfyUI environment is indirect.", 400, "setup_path_indirect");
        }
        fs.rmSync(venv, { recursive: true, force: true });
      }
      const uv = resolveOnPath("uv", context.env, context.platform);
      if (!uv) {
        fail(
          "uv is required to prepare ComfyUI. Install uv, then try again.",
          409,
          "setup_uv_missing",
        );
      }
      status.write("environment", "Preparing an isolated Python 3.12 environment for ComfyUI.", {
        step: 1,
        detail: null,
        progress: null,
      });
      const environment = await command(
        uv,
        ["venv", "--seed", "--python", "3.12", venv],
        VENV_TIMEOUT_MS,
      );
      python = pythonInVenv(venv, context.platform);
      if (environment.code !== 0 || !python) {
        return failed("The ComfyUI Python environment could not be created.", environment);
      }
    }

    const pip = (args, timeoutMs) => command(
      python,
      [
        "-s",
        "-m",
        "pip",
        "install",
        "--disable-pip-version-check",
        "--no-input",
        "--progress-bar",
        "raw",
        ...args,
      ],
      timeoutMs,
    );

    status.write("tooling", "Updating the Python package installer.", {
      step: 2,
      detail: null,
      progress: null,
    });
    const tooling = await pip(["--upgrade", "pip"], VENV_TIMEOUT_MS);
    if (tooling.code !== 0) {
      return failed("The ComfyUI package installer could not be updated.", tooling);
    }

    const gpuName = await detectComfyUiGpu(context);
    status.write(
      "acceleration",
      gpuName
        ? `Installing GPU acceleration for ${gpuName}.`
        : "Installing PyTorch for the CPU. Rendering will be slow without a GPU.",
      { step: 3, detail: null, progress: null },
    );
    const torch = await pip(
      gpuName
        ? [
            "torch",
            "torchvision",
            "--index-url",
            "https://download.pytorch.org/whl/cu128",
          ]
        : ["torch", "torchvision"],
      LARGE_PYTHON_INSTALL_TIMEOUT_MS,
    );
    if (torch.code !== 0) return failed("PyTorch could not be installed for ComfyUI.", torch);

    status.write("dependencies", "Installing the ComfyUI dependencies.", {
      step: 4,
      detail: null,
      progress: null,
    });
    const dependencies = await pip(
      ["-r", path.join(runtime, "requirements.txt")],
      LARGE_PYTHON_INSTALL_TIMEOUT_MS,
    );
    if (dependencies.code !== 0) {
      return failed("The ComfyUI dependencies could not be installed.", dependencies);
    }
    const verification = await command(
      python,
      ["-s", "-c", "import torch; import server; print('ok')"],
      VERIFY_TIMEOUT_MS,
    );
    if (verification.code !== 0 || !verification.stdout.includes("ok")) {
      return failed("ComfyUI was installed but its runtime verification failed.", verification);
    }
    const marker = path.join(venv, ".breadboard-comfyui-ready");
    const markerMetadata = fs.lstatSync(marker, { throwIfNoEntry: false });
    if (markerMetadata && (!markerMetadata.isFile() || markerMetadata.isSymbolicLink())) {
      fail("The ComfyUI readiness marker is indirect.", 400, "setup_path_indirect");
    }
    fs.writeFileSync(marker, `${new Date().toISOString()}\n`, { mode: 0o600 });
    status.write("installed", "ComfyUI is installed and ready to start.", {
      step: 4,
      detail: null,
      progress: null,
    });
    return {
      ok: true,
      message: "ComfyUI is installed and ready to start.",
      detail: commandTail(verification),
    };
  } catch (error) {
    const interrupted = context.signal.aborted || error?.name === "AbortError";
    status.write(
      interrupted ? "interrupted" : "error",
      interrupted
        ? "Image generator setup was stopped before it finished."
        : `ComfyUI setup failed: ${error instanceof Error ? error.message : String(error)}`,
      { detail: null, progress: null },
    );
    throw error;
  } finally {
    status.stop();
  }
}

async function googleImagesSetup(action, context) {
  const root = googleImagesRuntimeRoot(context);
  const entry = path.join(root, GOOGLE_IMAGES_BUILD_ENTRY);
  const installedEntry = fs.lstatSync(entry, { throwIfNoEntry: false });
  const ready = installedEntry?.isFile() === true && !installedEntry.isSymbolicLink();
  if (action === "check") {
    return {
      ok: ready,
      message: ready ? "Google image search is ready." : "Google image search is not built yet.",
      detail: "",
    };
  }
  const source = googleImagesSourceRoot(context);
  const parent = path.dirname(root);
  fs.mkdirSync(parent, { recursive: true });
  const staging = path.join(parent, `.google-images-stage-${crypto.randomUUID()}`);
  try {
    stageGoogleImagesSource(source, staging);
    const npm = context.platform === "win32" ? "npm.cmd" : "npm";
    const toolEnv = inheritedToolEnvironment(context.env);
    const install = await runManagedSetupCommand(
      npm,
      ["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
      {
        cwd: staging,
        env: toolEnv,
        signal: context.signal,
        timeoutMs: GOOGLE_INSTALL_TIMEOUT_MS,
        spawnImpl: context.spawnImpl,
        platform: context.platform,
      },
    );
    if (install.code !== 0) {
      return {
        ok: false,
        message: "Google image-search dependencies could not be installed.",
        detail: commandTail(install),
      };
    }
    const build = await runManagedSetupCommand(npm, ["run", "build:tsc"], {
      cwd: staging,
      env: toolEnv,
      signal: context.signal,
      timeoutMs: GOOGLE_INSTALL_TIMEOUT_MS,
      spawnImpl: context.spawnImpl,
      platform: context.platform,
    });
    const stagedEntry = path.join(staging, GOOGLE_IMAGES_BUILD_ENTRY);
    const stagedMetadata = fs.lstatSync(stagedEntry, { throwIfNoEntry: false });
    if (build.code !== 0 || !stagedMetadata?.isFile() || stagedMetadata.isSymbolicLink()) {
      return {
        ok: false,
        message: "Google image search could not be compiled.",
        detail: commandTail(build),
      };
    }
    replaceDirectDirectory(staging, root, "The Google image-search install");
    return { ok: true, message: "Google image search is ready.", detail: "" };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function readPinnedPackageVersion(root, relativeManifest, label) {
  const manifestPath = directPath(
    path.join(root, ...relativeManifest),
    "isFile",
    `${label} manifest`,
  );
  const metadata = fs.statSync(manifestPath);
  if (metadata.size < 2 || metadata.size > 128 * 1024) {
    fail(`${label} manifest exceeded its bound.`);
  }
  let value;
  try {
    value = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    fail(`${label} manifest is invalid.`);
  }
  const version = isRecord(value) && typeof value.version === "string"
    ? value.version.trim()
    : "";
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(version)) {
    fail(`${label} does not declare a pinned version.`, 409, "setup_version_unavailable");
  }
  return version;
}

async function installManagedNpmTool({
  context,
  packageName,
  version,
  destinationName,
  entrySegments,
  label,
  childEnvironment = {},
}) {
  const destination = path.join(context.dataRoot, destinationName);
  if (!pathWithin(context.dataRoot, destination)) fail(`${label} install root escaped Runtime data.`);
  const staging = path.join(
    context.dataRoot,
    `.${destinationName}-stage-${crypto.randomUUID()}`,
  );
  fs.mkdirSync(staging);
  try {
    const npm = context.platform === "win32" ? "npm.cmd" : "npm";
    const installed = await runManagedSetupCommand(
      npm,
      [
        "install",
        `${packageName}@${version}`,
        "--prefix",
        staging,
        "--no-audit",
        "--no-fund",
        "--loglevel",
        "error",
      ],
      {
        cwd: staging,
        env: { ...inheritedToolEnvironment(context.env), ...childEnvironment },
        signal: context.signal,
        timeoutMs: NPM_TOOL_INSTALL_TIMEOUT_MS,
        spawnImpl: context.spawnImpl,
        platform: context.platform,
      },
    );
    const entry = path.join(staging, ...entrySegments);
    const metadata = fs.lstatSync(entry, { throwIfNoEntry: false });
    if (installed.code !== 0 || !metadata?.isFile() || metadata.isSymbolicLink()) {
      return {
        ok: false,
        message: `${label} could not be installed.`,
        detail: commandTail(installed),
      };
    }
    const verified = await runManagedSetupCommand(process.execPath, [entry, "--version"], {
      cwd: staging,
      env: { ...inheritedToolEnvironment(context.env), ...childEnvironment },
      signal: context.signal,
      timeoutMs: VERIFY_TIMEOUT_MS,
      spawnImpl: context.spawnImpl,
      platform: context.platform,
    });
    if (verified.code !== 0) {
      return {
        ok: false,
        message: `${label} was installed but did not start.`,
        detail: commandTail(verified),
      };
    }
    replaceDirectDirectory(staging, destination, `${label} install`);
    return { ok: true, message: `${label} ${version} is installed.`, detail: "" };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

async function hyperframesSetup(context) {
  const root = candidateRoot(
    context.appRoot,
    context.env,
    "HYPERFRAMES_ROOT",
    "hyperframes",
    [["skills", "hyperframes", "SKILL.md"], ["packages", "cli", "package.json"]],
  );
  const version = readPinnedPackageVersion(
    root,
    ["packages", "cli", "package.json"],
    "HyperFrames CLI",
  );
  const result = await installManagedNpmTool({
    context,
    packageName: "hyperframes",
    version,
    destinationName: "hyperframes-cli",
    entrySegments: ["node_modules", "hyperframes", "bin", "hyperframes.mjs"],
    label: "HyperFrames CLI",
    childEnvironment: { HYPERFRAMES_NO_TELEMETRY: "1" },
  });
  if (result.ok) result.message = `Installed the HyperFrames CLI (${version}).`;
  return result;
}

async function ensureOpenscienceWorkspace(context) {
  const workspace = path.join(context.dataRoot, "openscience-workspace");
  if (!pathWithin(context.dataRoot, workspace)) fail("The OpenScience workspace escaped Runtime data.");
  fs.mkdirSync(workspace, { recursive: true });
  directPath(workspace, "isDirectory", "The OpenScience workspace");
  const manifest = path.join(workspace, "package.json");
  const existingManifest = fs.lstatSync(manifest, { throwIfNoEntry: false });
  if (existingManifest && (!existingManifest.isFile() || existingManifest.isSymbolicLink())) {
    fail("The OpenScience workspace manifest is indirect.");
  }
  if (!existingManifest) {
    fs.writeFileSync(
      manifest,
      `${JSON.stringify({
        name: "openscience-workspace",
        private: true,
        description:
          "Breadboard's OpenScience research workspace. This package root prevents package-manager traversal.",
      }, null, 2)}\n`,
      { flag: "wx", mode: 0o600 },
    );
  }
  const gitRoot = path.join(workspace, ".git");
  const gitMetadata = fs.lstatSync(gitRoot, { throwIfNoEntry: false });
  if (gitMetadata) {
    if (!gitMetadata.isDirectory() || gitMetadata.isSymbolicLink()) {
      fail("The OpenScience workspace repository root is indirect.");
    }
    return null;
  }
  const git = resolveOnPath("git", context.env, context.platform);
  if (!git) {
    return {
      ok: false,
      message:
        "Git was not found, so the OpenScience workspace could not be isolated safely.",
      detail: "",
    };
  }
  const initialized = await runManagedSetupCommand(git, ["init"], {
    cwd: workspace,
    env: inheritedToolEnvironment(context.env),
    signal: context.signal,
    timeoutMs: 60_000,
    spawnImpl: context.spawnImpl,
    platform: context.platform,
  });
  if (initialized.code !== 0) {
    return {
      ok: false,
      message: "The OpenScience workspace could not be isolated safely.",
      detail: commandTail(initialized),
    };
  }
  const initializedMetadata = fs.lstatSync(gitRoot, { throwIfNoEntry: false });
  if (
    !initializedMetadata?.isDirectory() ||
    initializedMetadata.isSymbolicLink()
  ) {
    return {
      ok: false,
      message: "Git did not create an isolated OpenScience workspace.",
      detail: "",
    };
  }
  return null;
}

async function openscienceSetup(context) {
  const root = candidateRoot(
    context.appRoot,
    context.env,
    "OPENSCIENCE_ROOT",
    "openscience",
    [["backend", "cli", "package.json"]],
  );
  const version = readPinnedPackageVersion(
    root,
    ["backend", "cli", "package.json"],
    "OpenScience CLI",
  );
  const result = await installManagedNpmTool({
    context,
    packageName: "@synsci/openscience",
    version,
    destinationName: "openscience-cli",
    entrySegments: ["node_modules", "@synsci", "openscience", "bin", "openscience"],
    label: "OpenScience",
    childEnvironment: { OPENSCIENCE_DISABLE_AUTOUPDATE: "1" },
  });
  if (!result.ok) return result;
  const workspaceFailure = await ensureOpenscienceWorkspace(context);
  if (workspaceFailure) return workspaceFailure;
  result.message = `Installed OpenScience ${version}.`;
  return result;
}

function openworkFingerprint(root) {
  const parts = [];
  const walk = (directory, prefix) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const absolute = path.join(directory, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(absolute, relative);
      else if (entry.isFile()) parts.push(`${relative}:${fs.statSync(absolute).size}`);
      else fail("The OpenWork source contains an indirect entry.");
    }
  };
  walk(path.join(root, "apps", "server", "src"), "src");
  for (const file of ["apps/server/package.json", "constants.json"]) {
    parts.push(`${file}:${fs.statSync(path.join(root, ...file.split("/"))).size}`);
  }
  return parts.join("|");
}

function writeOpenworkManifest(cloneRoot, staging) {
  const source = path.join(cloneRoot, "apps", "server", "package.json");
  const metadata = fs.statSync(source);
  if (!metadata.isFile() || metadata.size > 128 * 1024) {
    fail("The OpenWork server manifest is unavailable.");
  }
  const parsed = JSON.parse(fs.readFileSync(source, "utf8"));
  if (!isRecord(parsed) || (parsed.dependencies !== undefined && !isRecord(parsed.dependencies))) {
    fail("The OpenWork server manifest is invalid.");
  }
  const dependencies = {
    ...(parsed.dependencies ?? {}),
    "@openwork/paths": "file:../../packages/paths",
    "@openwork/types": "file:../../packages/types",
  };
  const output = { ...parsed, dependencies, private: true };
  delete output.devDependencies;
  delete output.scripts;
  fs.writeFileSync(
    path.join(staging, "apps", "server", "package.json"),
    `${JSON.stringify(output, null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  return typeof parsed.version === "string" ? parsed.version.slice(0, 128) : "";
}

async function openworkSetup(context) {
  const root = candidateRoot(
    context.appRoot,
    context.env,
    "OPENWORK_ROOT",
    "openwork",
    [
      ["apps", "server", "src", "cli.ts"],
      ["apps", "server", "package.json"],
      ["packages", "paths"],
      ["packages", "types"],
      ["constants.json"],
    ],
  );
  const configuredBun = context.env.OPENWORK_BUN_PATH?.trim() || context.env.BUN_PATH?.trim();
  const bunName = context.platform === "win32" ? "bun.exe" : "bun";
  const home = context.env.USERPROFILE?.trim() || context.env.HOME?.trim();
  const bunCandidates = [
    configuredBun ? path.resolve(configuredBun) : null,
    resolveOnPath("bun", context.env, context.platform),
    home ? path.join(path.resolve(home), ".bun", "bin", bunName) : null,
  ];
  const bun = bunCandidates.find((candidate) => {
    if (!candidate) return false;
    const metadata = fs.lstatSync(candidate, { throwIfNoEntry: false });
    return Boolean(metadata?.isFile() && !metadata.isSymbolicLink());
  });
  if (!bun) {
    return {
      ok: false,
      message:
        "Bun was not found. The OpenWork server uses bun:sqlite, so install Bun and try again.",
      detail: "",
    };
  }
  const bunProbe = await runManagedSetupCommand(bun, ["--version"], {
    cwd: root,
    env: inheritedToolEnvironment(context.env),
    signal: context.signal,
    timeoutMs: 30_000,
    spawnImpl: context.spawnImpl,
    platform: context.platform,
  });
  if (bunProbe.code !== 0) {
    return { ok: false, message: "Bun was found but did not start.", detail: commandTail(bunProbe) };
  }
  const destination = path.join(context.dataRoot, "openwork-runtime");
  const staging = path.join(context.dataRoot, `.openwork-stage-${crypto.randomUUID()}`);
  if (!pathWithin(context.dataRoot, destination) || !pathWithin(context.dataRoot, staging)) {
    fail("The OpenWork runtime escaped Runtime data.");
  }
  fs.mkdirSync(staging);
  try {
    const state = { bytes: 0, files: 0, maximumBytes: 128 * 1024 * 1024, maximumFiles: 20_000 };
    copyDirectTree(
      path.join(root, "apps", "server", "src"),
      path.join(staging, "apps", "server", "src"),
      state,
      "The OpenWork server source",
    );
    copyDirectTree(
      path.join(root, "packages", "paths"),
      path.join(staging, "packages", "paths"),
      state,
      "The OpenWork paths package",
    );
    copyDirectTree(
      path.join(root, "packages", "types"),
      path.join(staging, "packages", "types"),
      state,
      "The OpenWork types package",
    );
    copyDirectTree(
      path.join(root, "constants.json"),
      path.join(staging, "constants.json"),
      state,
      "The OpenWork constants",
    );
    const version = writeOpenworkManifest(root, staging);
    const npm = context.platform === "win32" ? "npm.cmd" : "npm";
    const server = path.join(staging, "apps", "server");
    const installed = await runManagedSetupCommand(
      npm,
      ["install", "--no-audit", "--no-fund", "--omit=dev", "--loglevel", "error"],
      {
        cwd: server,
        env: inheritedToolEnvironment(context.env),
        signal: context.signal,
        timeoutMs: NPM_TOOL_INSTALL_TIMEOUT_MS,
        spawnImpl: context.spawnImpl,
        platform: context.platform,
      },
    );
    const entry = path.join(server, "src", "cli.ts");
    const sdk = path.join(server, "node_modules", "@opencode-ai", "sdk");
    if (
      installed.code !== 0 ||
      !fs.statSync(entry, { throwIfNoEntry: false })?.isFile() ||
      !fs.statSync(sdk, { throwIfNoEntry: false })?.isDirectory()
    ) {
      return {
        ok: false,
        message: "The OpenWork server could not be prepared.",
        detail: commandTail(installed),
      };
    }
    fs.writeFileSync(
      path.join(staging, "breadboard-source.json"),
      `${JSON.stringify({
        fingerprint: openworkFingerprint(root),
        preparedAt: new Date().toISOString(),
      }, null, 2)}\n`,
      { flag: "wx", mode: 0o600 },
    );
    replaceDirectDirectory(staging, destination, "The OpenWork server runtime");
    return {
      ok: true,
      message: `OpenWork server${version ? ` ${version}` : ""} is ready.`,
      detail: commandTail(installed),
    };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

export function validateManagedSetupRequest(value) {
  if (
    !isRecord(value) ||
    Object.keys(value).sort().join(",") !== "action,operation,protocolVersion" ||
    value.protocolVersion !== 1 ||
    typeof value.operation !== "string" ||
    typeof value.action !== "string" ||
    !Object.hasOwn(MANAGED_SETUP_OPERATIONS, value.operation) ||
    !MANAGED_SETUP_OPERATIONS[value.operation].includes(value.action)
  ) {
    fail("The managed setup request is invalid.", 400, "setup_request_invalid");
  }
  return value;
}

export async function executeManagedSetup(request, options) {
  const canonical = validateManagedSetupRequest(request);
  if (!options || typeof options !== "object") fail("Managed setup context is invalid.");
  const dataRoot = directPath(options.dataRoot, "isDirectory", "The Runtime data root");
  const appRoot = directPath(options.appRoot, "isDirectory", "The Breadboard application root");
  const context = {
    dataRoot,
    appRoot,
    env: options.env ?? process.env,
    signal: options.signal,
    spawnImpl: options.spawnImpl ?? spawn,
    fetchImpl: options.fetchImpl ?? fetch,
    platform: options.platform ?? process.platform,
    arch: options.arch ?? process.arch,
  };
  if (!(context.signal instanceof AbortSignal)) fail("Managed setup requires cancellation authority.");
  if (canonical.operation === "audio-analyzer") return audioSetup(canonical.action, context);
  if (canonical.operation === "claude-code") {
    return claudeAccountOperation(canonical.action, context);
  }
  if (canonical.operation === "google-images") return googleImagesSetup(canonical.action, context);
  if (canonical.operation === "hyperframes") return hyperframesSetup(context);
  if (canonical.operation === "openscience") return openscienceSetup(context);
  if (canonical.operation === "openwork") return openworkSetup(context);
  if (canonical.operation === "bolt-slides") return boltSlidesSetup(context);
  if (canonical.operation === "wardrobe") return wardrobeSetup(context);
  if (canonical.operation === "career-ops") return careerOpsSetup(canonical.action, context);
  if (canonical.operation === "comfyui") return comfyUiSetup(context);
  if (canonical.operation === "openmontage") return openMontageSetup(canonical.action, context);
  if (canonical.operation === "resource2skill") {
    return resource2SkillSetup(canonical.action, context);
  }
  if (canonical.operation === "matraix") return matraixSetup(context);
  if (canonical.operation === "subsai") return subsaiSetup(canonical.action, context);
  if (canonical.operation === "deer-flow") return deerFlowSetup(canonical.action, context);
  if (canonical.operation === "vibe-trading") return vibeTradingSetup(canonical.action, context);
  if (canonical.operation === "stock-analyst") return stockAnalystSetup(canonical.action, context);
  if (canonical.operation === "money-printer") return moneyPrinterSetup(canonical.action, context);
  if (Object.hasOwn(PYTHON_CLONE_SETUPS, canonical.operation)) {
    return managedPythonCloneSetup(canonical.operation, canonical.action, context);
  }
  fail("The managed setup operation is unavailable.", 400, "setup_operation_unknown");
}

export function managedSetupFailure(error) {
  return {
    ok: false,
    message: error instanceof Error ? error.message.slice(0, 8_000) : "Setup failed.",
    detail: "",
    error: {
      code: typeof error?.code === "string" ? error.code.slice(0, 128) : "setup_failed",
      status: Number.isSafeInteger(error?.status) && error.status >= 400 && error.status <= 599
        ? error.status
        : 500,
    },
  };
}
