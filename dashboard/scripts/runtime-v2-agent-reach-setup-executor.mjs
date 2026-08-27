import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const MAX_COMMAND_OUTPUT_BYTES = 32 * 1024;
const MAX_DOWNLOAD_BYTES = 768 * 1024 * 1024;
const MAX_SOURCE_BYTES = 128 * 1024 * 1024;
const MAX_SOURCE_FILES = 20_000;
const COMMAND_TIMEOUT_MS = 10 * 60_000;
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;
const CORE_INSTALL_TIMEOUT_MS = 15 * 60_000;
const VERIFY_TIMEOUT_MS = 60_000;

export const AGENT_REACH_INSTALL_TARGETS = Object.freeze([
  "exa",
  "yt-dlp",
  "bili-cli",
  "twitter-cli",
  "rdt-cli",
  "opencli",
  "gh",
  "ffmpeg",
]);
export const AGENT_REACH_CREDENTIAL_KEYS = Object.freeze([
  "proxy",
  "github-token",
  "groq-key",
  "openai-key",
  "twitter-cookies",
  "youtube-cookies",
  "xhs-cookies",
]);
export const AGENT_REACH_COOKIE_BROWSERS = Object.freeze([
  "chrome",
  "edge",
  "firefox",
  "brave",
  "opera",
]);
export const AGENT_REACH_COOKIE_PLATFORMS = Object.freeze(["bilibili", "xueqiu"]);

const INSTALL_RECIPES = Object.freeze({
  exa: [
    { kind: "npm", packages: ["mcporter"] },
    { kind: "mcporter", name: "exa", url: "https://mcp.exa.ai/mcp" },
  ],
  "yt-dlp": [
    { kind: "pip", packages: ["yt-dlp[default]"] },
    {
      kind: "config-line",
      file: [".config", "yt-dlp", "config"],
      line: "--js-runtimes node",
      marker: "--js-runtimes",
    },
  ],
  "bili-cli": [{ kind: "pip", packages: ["bilibili-cli"] }],
  "twitter-cli": [{ kind: "pip", packages: ["twitter-cli"] }],
  "rdt-cli": [
    {
      kind: "pip",
      packages: [
        "git+https://github.com/public-clis/rdt-cli.git@5e4fb3720d5c174e976cd425ccc3b879d52cac66",
      ],
    },
  ],
  opencli: [{ kind: "npm", packages: ["@jackwener/opencli"] }],
  gh: [
    {
      kind: "archive",
      githubRepo: "cli/cli",
      assetName: "gh_{version}_windows_amd64.zip",
      binaries: ["gh.exe"],
    },
  ],
  ffmpeg: [
    {
      kind: "archive",
      url: "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip",
      binaries: ["ffmpeg.exe", "ffprobe.exe"],
    },
    {
      kind: "bundled-file",
      source: ["agent_reach", "scripts", "transcribe_xiaoyuzhou.sh"],
      destination: [".agent-reach", "tools", "xiaoyuzhou", "transcribe.sh"],
    },
  ],
});

function fail(message, status = 500, code = "agent_reach_setup_failed") {
  throw Object.assign(new Error(message), { status, code });
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactRecord(value, keys) {
  return isRecord(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function samePath(left, right, platform = process.platform) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function pathWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function directPath(candidate, kind, label, platform = process.platform) {
  const resolved = path.resolve(candidate);
  const metadata = fs.lstatSync(resolved, { throwIfNoEntry: false });
  if (!metadata || metadata.isSymbolicLink() || !metadata[kind]()) {
    fail(`${label} is unavailable.`, 404, "agent_reach_setup_source_unavailable");
  }
  const canonical = fs.realpathSync.native(resolved);
  if (!samePath(canonical, resolved, platform)) {
    fail(`${label} is indirect.`, 400, "agent_reach_setup_path_indirect");
  }
  return canonical;
}

function ensureDirectDirectory(directory, parent, label, platform = process.platform) {
  if (!pathWithin(parent, directory)) fail(`${label} escaped Runtime data.`);
  const metadata = fs.lstatSync(directory, { throwIfNoEntry: false });
  if (!metadata) fs.mkdirSync(directory, { mode: 0o700 });
  directPath(directory, "isDirectory", label, platform);
}

function ensureDirectTree(root, directory, label, platform = process.platform) {
  if (!pathWithin(root, directory)) fail(`${label} escaped Runtime data.`);
  let current = root;
  for (const segment of path.relative(root, directory).split(path.sep).filter(Boolean)) {
    const next = path.join(current, segment);
    const existing = fs.lstatSync(next, { throwIfNoEntry: false });
    if (!existing) fs.mkdirSync(next, { mode: 0o700 });
    directPath(next, "isDirectory", label, platform);
    current = next;
  }
}

function resolveOnPath(name, env, platform = process.platform) {
  if (path.isAbsolute(name)) {
    try {
      return directPath(name, "isFile", `The ${path.basename(name)} executable`, platform);
    } catch {
      return null;
    }
  }
  const pathValue = env.PATH ?? env.Path ?? "";
  const extensions = platform === "win32"
    ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
    : [""];
  for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
    if (!path.isAbsolute(directory)) continue;
    for (const extension of extensions) {
      const candidate = path.join(directory, `${name}${extension}`);
      try {
        return directPath(candidate, "isFile", `The ${name} executable`, platform);
      } catch {
        // Keep looking only inside the closed Runtime PATH.
      }
    }
  }
  return null;
}

function quoteForCmd(value) {
  return `"${value.replace(/(\\*)"/gu, '$1$1\\"').replace(/(\\+)$/u, "$1$1")}"`;
}

function commandPlan(command, args, env, platform) {
  const resolved = resolveOnPath(command, env, platform);
  if (!resolved) return null;
  if (platform === "win32" && /\.(cmd|bat)$/iu.test(resolved)) {
    if (args.some((value) => /%[A-Za-z_][A-Za-z0-9_]*%/u.test(value))) {
      fail("Environment expansion is not allowed in Agent Reach setup arguments.");
    }
    const comspec = resolveOnPath(env.ComSpec ?? env.COMSPEC ?? "cmd.exe", env, platform);
    if (!comspec) return null;
    return {
      command: comspec,
      argv: ["/d", "/s", "/c", `"${[resolved, ...args].map(quoteForCmd).join(" ")}"`],
      verbatim: true,
    };
  }
  return { command: resolved, argv: args, verbatim: false };
}

function appendTail(current, chunk) {
  const combined = `${current}${chunk}`;
  return Buffer.byteLength(combined, "utf8") <= MAX_COMMAND_OUTPUT_BYTES
    ? combined
    : Buffer.from(combined, "utf8").subarray(-MAX_COMMAND_OUTPUT_BYTES).toString("utf8");
}

function safeEnvironment(env, layout, { browserAccess = false, dockerAccess = false } = {}) {
  const allowed = [
    "PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "ComSpec", "COMSPEC",
    "PROGRAMDATA",
    "PROGRAMFILES", "PROGRAMFILES(X86)", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY",
    "http_proxy", "https_proxy", "no_proxy", "SSL_CERT_FILE", "SSL_CERT_DIR",
  ];
  const result = {};
  for (const name of allowed) {
    if (typeof env[name] === "string" && env[name]) result[name] = env[name];
  }
  const browserHome = env.BREADBOARD_AGENT_REACH_BROWSER_HOME?.trim() ||
    env.USERPROFILE?.trim() || env.HOME?.trim();
  const selectedHome = browserAccess && browserHome ? path.resolve(browserHome) : layout.home;
  result.HOME = selectedHome;
  result.USERPROFILE = selectedHome;
  result.TEMP = layout.temp;
  result.TMP = layout.temp;
  result.TMPDIR = layout.temp;
  result.APPDATA = browserAccess && env.APPDATA
    ? env.APPDATA
    : layout.appData;
  result.LOCALAPPDATA = browserAccess && env.LOCALAPPDATA
    ? env.LOCALAPPDATA
    : layout.localAppData;
  result.XDG_CONFIG_HOME = path.join(layout.home, ".config");
  result.XDG_CACHE_HOME = layout.cache;
  result.XDG_DATA_HOME = path.join(layout.home, ".local", "share");
  result.NO_COLOR = "1";
  result.FORCE_COLOR = "0";
  result.CI = "1";
  result.ELECTRON_RUN_AS_NODE = "1";
  result.PYTHONIOENCODING = "utf-8";
  result.PYTHONUTF8 = "1";
  result.PYTHONDONTWRITEBYTECODE = "1";
  result.PYTHONNOUSERSITE = "1";
  result.PIP_DISABLE_PIP_VERSION_CHECK = "1";
  result.PIP_CACHE_DIR = path.join(layout.cache, "pip");
  result.UV_CACHE_DIR = path.join(layout.cache, "uv");
  result.npm_config_audit = "false";
  result.npm_config_fund = "false";
  result.npm_config_update_notifier = "false";
  result.npm_config_prefix = layout.npmPrefix;
  result.npm_config_cache = path.join(layout.cache, "npm");
  result.AGENT_REACH_CONFIG_PATH = path.join(layout.home, ".agent-reach", "config.yaml");
  const pathKey = Object.hasOwn(result, "Path") ? "Path" : "PATH";
  const prefix = [layout.venvBin, layout.toolsBin, npmBin(layout, layout.platform)];
  if (dockerAccess && env.DOCKER_CLI_PATH?.trim()) {
    const docker = directPath(
      env.DOCKER_CLI_PATH.trim(),
      "isFile",
      "The trusted Docker CLI",
      layout.platform,
    );
    prefix.push(path.dirname(docker));
  }
  result[pathKey] = [...prefix, result[pathKey] ?? ""].filter(Boolean).join(path.delimiter);
  return result;
}

export function runAgentReachSetupCommand(command, args, options) {
  const plan = commandPlan(command, args, options.env, options.platform ?? process.platform);
  if (!plan) {
    return Promise.resolve({ code: null, stdout: "", stderr: `${path.basename(command)} is unavailable.`, timedOut: false });
  }
  if (options.signal.aborted) {
    return Promise.reject(options.signal.reason ?? new DOMException("Aborted", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    let child;
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const finish = (value, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(stopTimer);
      options.signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(value);
    };
    const stop = () => {
      try { child?.kill(); } catch { /* Native is the final tree reaper. */ }
      stopTimer = setTimeout(() => {
        child?.stdout?.destroy();
        child?.stderr?.destroy();
        child?.unref?.();
        finish({ code: null, stdout, stderr, timedOut });
      }, 5_000);
      stopTimer.unref?.();
    };
    const abort = () => stop();
    let timer;
    let stopTimer;
    try {
      child = (options.spawnImpl ?? spawn)(plan.command, plan.argv, {
        cwd: options.cwd,
        env: options.env,
        shell: false,
        detached: false,
        windowsHide: true,
        windowsVerbatimArguments: plan.verbatim,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      finish(null, error);
      return;
    }
    child.stdout?.on("data", (chunk) => { stdout = appendTail(stdout, chunk); });
    child.stderr?.on("data", (chunk) => { stderr = appendTail(stderr, chunk); });
    child.once("error", (error) => finish(null, error));
    child.once("close", (code) => {
      if (options.signal.aborted) {
        finish(null, options.signal.reason ?? new DOMException("Aborted", "AbortError"));
      } else {
        finish({ code, stdout, stderr, timedOut });
      }
    });
    timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, options.timeoutMs);
    timer.unref?.();
    options.signal.addEventListener("abort", abort, { once: true });
    if (options.signal.aborted) abort();
  });
}

function cleanOutput(result) {
  return `${result.stdout}\n${result.stderr}`
    .replace(/\x1b\[[0-9;]*m/gu, "")
    .trim()
    .slice(-8_000);
}

function parseDoctorChannels(stdout) {
  const start = stdout.indexOf("{");
  if (start < 0) return [];
  let parsed;
  try {
    parsed = JSON.parse(stdout.slice(start));
  } catch {
    return [];
  }
  if (!isRecord(parsed)) return [];
  const channels = [];
  for (const [channel, raw] of Object.entries(parsed).slice(0, 100)) {
    if (!/^[a-z0-9_-]{1,80}$/u.test(channel) || !isRecord(raw)) continue;
    const status = ["ok", "warn", "off", "error"].includes(raw.status)
      ? raw.status
      : "error";
    channels.push({
      channel,
      name: typeof raw.name === "string" ? raw.name.slice(0, 200) : channel,
      status,
      message: typeof raw.message === "string" ? raw.message.slice(0, 2_000) : "",
      tier: Number.isSafeInteger(raw.tier) && raw.tier >= 0 && raw.tier <= 10 ? raw.tier : 0,
      backends: Array.isArray(raw.backends)
        ? raw.backends
          .filter((backend) => typeof backend === "string")
          .slice(0, 20)
          .map((backend) => backend.slice(0, 200))
        : [],
      activeBackend: typeof raw.active_backend === "string"
        ? raw.active_backend.slice(0, 200)
        : null,
    });
  }
  return channels;
}

function layoutFor(context) {
  const runtimeRoot = path.join(context.dataRoot, "runtime-v2");
  const toolchains = path.join(runtimeRoot, "toolchains");
  const services = path.join(runtimeRoot, "services");
  for (const [directory, parent, label] of [
    [runtimeRoot, context.dataRoot, "The Runtime V2 root"],
    [toolchains, runtimeRoot, "The Runtime V2 toolchain root"],
    [services, runtimeRoot, "The Runtime V2 service root"],
  ]) ensureDirectDirectory(directory, parent, label, context.platform);
  const toolchainRoot = path.join(toolchains, "agent-reach");
  const serviceRoot = path.join(services, "agent-reach");
  ensureDirectDirectory(toolchainRoot, toolchains, "The Agent Reach toolchain root", context.platform);
  ensureDirectDirectory(serviceRoot, services, "The Agent Reach service root", context.platform);
  const home = path.join(serviceRoot, "home");
  const appData = path.join(home, "AppData", "Roaming");
  const localAppData = path.join(home, "AppData", "Local");
  const cache = path.join(toolchainRoot, "cache");
  const temp = path.join(context.workspacePath, "tmp");
  const npmPrefix = path.join(toolchainRoot, "npm");
  const toolsBin = path.join(toolchainRoot, "tools", "bin");
  for (const [directory, parent, label] of [
    [home, serviceRoot, "The Agent Reach private home"],
    [cache, toolchainRoot, "The Agent Reach tool cache"],
    [npmPrefix, toolchainRoot, "The Agent Reach npm root"],
  ]) ensureDirectDirectory(directory, parent, label, context.platform);
  for (const [directory, root, label] of [
    [appData, home, "The Agent Reach private roaming-data directory"],
    [localAppData, home, "The Agent Reach private local-data directory"],
    [temp, context.workspacePath, "The Agent Reach private temporary directory"],
    [path.join(home, ".config"), home, "The Agent Reach private config directory"],
    [path.join(home, ".local", "share"), home, "The Agent Reach private data directory"],
  ]) ensureDirectTree(root, directory, label, context.platform);
  const toolsRoot = path.dirname(toolsBin);
  ensureDirectDirectory(toolsRoot, toolchainRoot, "The Agent Reach portable-tool root", context.platform);
  ensureDirectDirectory(toolsBin, toolsRoot, "The Agent Reach portable-tool bin", context.platform);
  const venv = path.join(serviceRoot, ".venv");
  return {
    platform: context.platform,
    runtimeRoot,
    toolchainRoot,
    serviceRoot,
    sourceRoot: path.join(toolchainRoot, "source"),
    venv,
    venvBin: path.join(venv, context.platform === "win32" ? "Scripts" : "bin"),
    python: path.join(venv, context.platform === "win32" ? "Scripts/python.exe" : "bin/python"),
    home,
    appData,
    localAppData,
    cache,
    temp,
    npmPrefix,
    toolsBin,
  };
}

function npmBin(layout, platform) {
  return platform === "win32" ? layout.npmPrefix : path.join(layout.npmPrefix, "bin");
}

function copySourceEntry(source, destination, relative, state) {
  const metadata = fs.lstatSync(source);
  if (metadata.isSymbolicLink()) fail("The Agent Reach source contains an indirect entry.");
  if (metadata.isDirectory()) {
    fs.mkdirSync(destination, { mode: 0o700 });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      if ([".git", ".venv", "__pycache__", ".pytest_cache"].includes(entry.name)) continue;
      copySourceEntry(
        path.join(source, entry.name),
        path.join(destination, entry.name),
        `${relative}/${entry.name}`,
        state,
      );
    }
    return;
  }
  if (!metadata.isFile()) fail("The Agent Reach source contains an unsupported entry.");
  state.files += 1;
  state.bytes += metadata.size;
  if (state.files > MAX_SOURCE_FILES || state.bytes > MAX_SOURCE_BYTES) {
    fail("The staged Agent Reach source exceeded its bound.");
  }
  const bytes = fs.readFileSync(source);
  if (bytes.byteLength !== metadata.size) fail("The Agent Reach source changed while staging.");
  state.hash.update(relative).update("\0").update(bytes).update("\0");
  fs.writeFileSync(destination, bytes, { flag: "wx", mode: metadata.mode & 0o777 });
}

function sourceFingerprint(sourceRoot, platform) {
  const hash = crypto.createHash("sha256");
  const state = { files: 0, bytes: 0, hash };
  const walk = (source, relative) => {
    const metadata = fs.lstatSync(source);
    if (metadata.isSymbolicLink()) fail("The Agent Reach source contains an indirect entry.");
    if (metadata.isDirectory()) {
      for (const entry of fs.readdirSync(source, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name))) {
        if ([".git", ".venv", "__pycache__", ".pytest_cache"].includes(entry.name)) continue;
        walk(path.join(source, entry.name), relative ? `${relative}/${entry.name}` : entry.name);
      }
      return;
    }
    if (!metadata.isFile()) fail("The Agent Reach source contains an unsupported entry.");
    state.files += 1;
    state.bytes += metadata.size;
    if (state.files > MAX_SOURCE_FILES || state.bytes > MAX_SOURCE_BYTES) {
      fail("The staged Agent Reach source exceeded its bound.");
    }
    const bytes = fs.readFileSync(source);
    hash.update(relative).update("\0").update(bytes).update("\0");
  };
  for (const entry of ["pyproject.toml", "uv.lock", "README.md", "agent_reach"]) {
    directPath(
      path.join(sourceRoot, entry),
      entry === "agent_reach" ? "isDirectory" : "isFile",
      `The Agent Reach ${entry} source`,
      platform,
    );
    walk(path.join(sourceRoot, entry), entry);
  }
  return hash.digest("hex");
}

function readSourceMarker(sourceRoot) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(sourceRoot, ".breadboard-source.json"), "utf8"));
    return exactRecord(value, ["protocolVersion", "fingerprint"]) &&
      value.protocolVersion === 1 && /^[a-f0-9]{64}$/u.test(value.fingerprint)
      ? value.fingerprint
      : null;
  } catch {
    return null;
  }
}

function stageSource(context, layout) {
  const appSource = directPath(
    path.join(context.appRoot, "agent-reach"),
    "isDirectory",
    "The staged Agent Reach repository",
    context.platform,
  );
  const fingerprint = sourceFingerprint(appSource, context.platform);
  const existing = fs.lstatSync(layout.sourceRoot, { throwIfNoEntry: false });
  if (
    existing?.isDirectory() &&
    !existing.isSymbolicLink() &&
    samePath(fs.realpathSync.native(layout.sourceRoot), layout.sourceRoot, context.platform) &&
    readSourceMarker(layout.sourceRoot) === fingerprint
  ) return fingerprint;
  if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) {
    fail("The Agent Reach managed source is indirect.");
  }
  const staging = path.join(layout.toolchainRoot, `.source-stage-${crypto.randomUUID()}`);
  const backup = path.join(layout.toolchainRoot, `.source-backup-${crypto.randomUUID()}`);
  fs.mkdirSync(staging, { mode: 0o700 });
  try {
    const state = { files: 0, bytes: 0, hash: crypto.createHash("sha256") };
    for (const entry of ["pyproject.toml", "uv.lock", "README.md", "agent_reach"]) {
      copySourceEntry(
        path.join(appSource, entry),
        path.join(staging, entry),
        entry,
        state,
      );
    }
    const copiedFingerprint = state.hash.digest("hex");
    if (copiedFingerprint !== fingerprint) fail("The Agent Reach source changed while staging.");
    fs.writeFileSync(
      path.join(staging, ".breadboard-source.json"),
      `${JSON.stringify({ protocolVersion: 1, fingerprint })}\n`,
      { flag: "wx", mode: 0o600 },
    );
    if (existing) fs.renameSync(layout.sourceRoot, backup);
    try {
      fs.renameSync(staging, layout.sourceRoot);
    } catch (error) {
      if (fs.existsSync(backup)) fs.renameSync(backup, layout.sourceRoot);
      throw error;
    }
    fs.rmSync(backup, { recursive: true, force: true });
    return fingerprint;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
    if (fs.existsSync(layout.sourceRoot)) {
      fs.rmSync(backup, { recursive: true, force: true });
    }
  }
}

function readVenvMarker(layout) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(layout.venv, ".breadboard-source.json"), "utf8"));
    return value?.fingerprint ?? null;
  } catch {
    return null;
  }
}

async function ensureCore(context, layout, fingerprint) {
  const env = safeEnvironment(context.env, layout);
  const existingVenv = fs.lstatSync(layout.venv, { throwIfNoEntry: false });
  if (existingVenv) {
    directPath(
      layout.venv,
      "isDirectory",
      "The Agent Reach managed environment",
      context.platform,
    );
  }
  if (!fs.existsSync(layout.python)) {
    const uv = resolveOnPath("uv", env, context.platform);
    const python = resolveOnPath("python", env, context.platform) ??
      resolveOnPath("python3", env, context.platform);
    const created = uv
      ? await runAgentReachSetupCommand(uv, ["venv", "--python", "3.12", layout.venv], {
          cwd: layout.toolchainRoot,
          env: { ...env, UV_LINK_MODE: "copy" },
          signal: context.signal,
          timeoutMs: COMMAND_TIMEOUT_MS,
          spawnImpl: context.spawnImpl,
          platform: context.platform,
        })
      : python
        ? await runAgentReachSetupCommand(python, ["-m", "venv", layout.venv], {
            cwd: layout.toolchainRoot,
            env,
            signal: context.signal,
            timeoutMs: COMMAND_TIMEOUT_MS,
            spawnImpl: context.spawnImpl,
            platform: context.platform,
          })
        : null;
    if (!created || created.code !== 0 || !fs.existsSync(layout.python)) {
      return { ok: false, output: cleanOutput(created ?? { stdout: "", stderr: "Python is unavailable." }) };
    }
  }
  directPath(
    layout.venv,
    "isDirectory",
    "The Agent Reach managed environment",
    context.platform,
  );
  directPath(
    layout.python,
    "isFile",
    "The Agent Reach managed Python executable",
    context.platform,
  );
  if (readVenvMarker(layout) !== fingerprint) {
    const uv = resolveOnPath("uv", env, context.platform);
    const installed = uv
      ? await runAgentReachSetupCommand(
          uv,
          ["sync", "--frozen", "--no-dev", "--project", layout.sourceRoot],
          {
            cwd: layout.sourceRoot,
            env: {
              ...env,
              UV_LINK_MODE: "copy",
              UV_PROJECT_ENVIRONMENT: layout.venv,
            },
            signal: context.signal,
            timeoutMs: CORE_INSTALL_TIMEOUT_MS,
            spawnImpl: context.spawnImpl,
            platform: context.platform,
          },
        )
      : await runAgentReachSetupCommand(
          layout.python,
          ["-m", "pip", "install", "--upgrade", layout.sourceRoot],
          {
            cwd: layout.sourceRoot,
            env,
            signal: context.signal,
            timeoutMs: CORE_INSTALL_TIMEOUT_MS,
            spawnImpl: context.spawnImpl,
            platform: context.platform,
          },
        );
    if (installed.code !== 0) return { ok: false, output: cleanOutput(installed) };
    const verified = await runAgentReachSetupCommand(
      layout.python,
      ["-m", "agent_reach.cli", "version"],
      {
        cwd: layout.sourceRoot,
        env,
        signal: context.signal,
        timeoutMs: VERIFY_TIMEOUT_MS,
        spawnImpl: context.spawnImpl,
        platform: context.platform,
      },
    );
    if (verified.code !== 0) return { ok: false, output: cleanOutput(verified) };
    const marker = path.join(layout.venv, ".breadboard-source.json");
    const existingMarker = fs.lstatSync(marker, { throwIfNoEntry: false });
    if (existingMarker && (!existingMarker.isFile() || existingMarker.isSymbolicLink())) {
      fail("The Agent Reach environment marker is indirect.");
    }
    fs.writeFileSync(
      marker,
      `${JSON.stringify({ protocolVersion: 1, fingerprint })}\n`,
      { mode: 0o600 },
    );
  }
  return { ok: true, output: "Agent Reach is ready." };
}

async function pipInstall(context, layout, packages) {
  const env = safeEnvironment(context.env, layout);
  const uv = resolveOnPath("uv", env, context.platform);
  const result = uv
    ? await runAgentReachSetupCommand(uv, ["pip", "install", "--python", layout.python, "--upgrade", ...packages], {
        cwd: layout.sourceRoot,
        env: { ...env, UV_LINK_MODE: "copy" },
        signal: context.signal,
        timeoutMs: COMMAND_TIMEOUT_MS,
        spawnImpl: context.spawnImpl,
        platform: context.platform,
      })
    : await runAgentReachSetupCommand(layout.python, ["-m", "pip", "install", "--upgrade", ...packages], {
        cwd: layout.sourceRoot,
        env,
        signal: context.signal,
        timeoutMs: COMMAND_TIMEOUT_MS,
        spawnImpl: context.spawnImpl,
        platform: context.platform,
      });
  return { ok: result.code === 0, output: cleanOutput(result) };
}

async function npmInstall(context, layout, packages) {
  const env = safeEnvironment(context.env, layout);
  const result = await runAgentReachSetupCommand(
    "npm",
    ["install", "--global", "--prefix", layout.npmPrefix, "--no-audit", "--no-fund", ...packages],
    {
      cwd: layout.toolchainRoot,
      env,
      signal: context.signal,
      timeoutMs: COMMAND_TIMEOUT_MS,
      spawnImpl: context.spawnImpl,
      platform: context.platform,
    },
  );
  return { ok: result.code === 0, output: cleanOutput(result) };
}

async function mcporterAdd(context, layout, step) {
  const env = safeEnvironment(context.env, layout);
  const result = await runAgentReachSetupCommand(
    context.platform === "win32"
      ? path.join(layout.npmPrefix, "mcporter.cmd")
      : path.join(layout.npmPrefix, "bin", "mcporter"),
    ["config", "add", step.name, step.url, "--scope", "home"],
    {
      cwd: layout.home,
      env,
      signal: context.signal,
      timeoutMs: COMMAND_TIMEOUT_MS,
      spawnImpl: context.spawnImpl,
      platform: context.platform,
    },
  );
  const output = cleanOutput(result);
  return { ok: result.code === 0 || /already exists/iu.test(output), output };
}

function configLine(layout, step) {
  const target = path.join(layout.home, ...step.file);
  if (!pathWithin(layout.home, target)) fail("The Agent Reach config path escaped its private home.");
  ensureDirectTree(layout.home, path.dirname(target), "The Agent Reach config directory");
  const existingMetadata = fs.lstatSync(target, { throwIfNoEntry: false });
  if (existingMetadata && (!existingMetadata.isFile() || existingMetadata.isSymbolicLink())) {
    fail("The Agent Reach config file is indirect.");
  }
  const existing = existingMetadata ? fs.readFileSync(target, "utf8") : "";
  if (existing.includes(step.marker)) return { ok: true, output: `${step.marker} is already configured.` };
  fs.writeFileSync(target, `${existing}${existing && !existing.endsWith("\n") ? "\n" : ""}${step.line}\n`, {
    mode: 0o600,
  });
  return { ok: true, output: `${step.marker} was configured.` };
}

function bundledFile(context, layout, step) {
  const source = directPath(
    path.join(layout.sourceRoot, ...step.source),
    "isFile",
    "The Agent Reach bundled helper",
    context.platform,
  );
  const destination = path.join(layout.home, ...step.destination);
  if (!pathWithin(layout.home, destination)) fail("The Agent Reach helper escaped its private home.");
  ensureDirectTree(layout.home, path.dirname(destination), "The Agent Reach helper directory");
  const existing = fs.lstatSync(destination, { throwIfNoEntry: false });
  if (existing && (!existing.isFile() || existing.isSymbolicLink())) {
    fail("The Agent Reach helper destination is indirect.");
  }
  fs.copyFileSync(source, destination);
  if (context.platform !== "win32") fs.chmodSync(destination, 0o700);
  return { ok: true, output: "The podcast transcription helper was installed." };
}

async function downloadToFile(url, destination, context) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Download timed out", "TimeoutError")),
    DOWNLOAD_TIMEOUT_MS,
  );
  timeout.unref?.();
  const forward = () => controller.abort(context.signal.reason);
  context.signal.addEventListener("abort", forward, { once: true });
  try {
    const response = await context.fetchImpl(url, { redirect: "follow", signal: controller.signal });
    if (!response.ok || !response.body) return { ok: false, output: `Download failed (${response.status}).` };
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_DOWNLOAD_BYTES) {
      return { ok: false, output: "The download exceeded its size limit." };
    }
    let bytes = 0;
    const bound = new Transform({
      transform(chunk, _encoding, callback) {
        bytes += chunk.byteLength;
        callback(bytes > MAX_DOWNLOAD_BYTES ? new Error("The download exceeded its size limit.") : null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(response.body), bound, fs.createWriteStream(destination, { flags: "wx", mode: 0o600 }), {
      signal: controller.signal,
    });
    return { ok: true, output: `Downloaded ${bytes} bytes.` };
  } catch (error) {
    if (context.signal.aborted) throw context.signal.reason ?? new DOMException("Aborted", "AbortError");
    return { ok: false, output: error instanceof Error ? error.message.slice(0, 4_000) : "The download failed." };
  } finally {
    clearTimeout(timeout);
    context.signal.removeEventListener("abort", forward);
  }
}

async function archiveInstall(context, layout, step) {
  if (context.platform !== "win32") {
    fail("Install this tool with your operating system package manager.", 409, "manual_install_required");
  }
  let url = step.url ?? "";
  if (!url) {
    const response = await context.fetchImpl(`https://github.com/${step.githubRepo}/releases/latest`, {
      redirect: "follow",
      signal: AbortSignal.any([context.signal, AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)]),
    });
    response.body?.cancel().catch(() => undefined);
    const tag = response.url.split("/").pop() ?? "";
    if (!response.ok || !/^v?[A-Za-z0-9_.+-]+$/u.test(tag)) {
      return { ok: false, output: "The latest GitHub release could not be resolved." };
    }
    const asset = step.assetName
      .replaceAll("{tag}", tag)
      .replaceAll("{version}", tag.replace(/^v/u, ""));
    url = `https://github.com/${step.githubRepo}/releases/download/${tag}/${asset}`;
  }
  const staging = path.join(context.workspacePath, `archive-${crypto.randomUUID()}`);
  fs.mkdirSync(staging, { mode: 0o700 });
  const archive = path.join(staging, "download.zip");
  const extracted = path.join(staging, "extracted");
  fs.mkdirSync(extracted, { mode: 0o700 });
  try {
    const downloaded = await downloadToFile(url, archive, context);
    if (!downloaded.ok) return downloaded;
    const systemRoot = context.env.SystemRoot ?? context.env.SYSTEMROOT;
    const tar = systemRoot ? path.join(systemRoot, "System32", "tar.exe") : null;
    if (!tar) return { ok: false, output: "Windows archive support is unavailable." };
    const unpacked = await runAgentReachSetupCommand(tar, ["-xf", archive, "-C", extracted], {
      cwd: staging,
      env: safeEnvironment(context.env, layout),
      signal: context.signal,
      timeoutMs: COMMAND_TIMEOUT_MS,
      spawnImpl: context.spawnImpl,
      platform: context.platform,
    });
    if (unpacked.code !== 0) return { ok: false, output: cleanOutput(unpacked) };
    const wanted = new Set(step.binaries.map((name) => name.toLowerCase()));
    const found = new Map();
    let entries = 0;
    const walk = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        entries += 1;
        if (entries > MAX_SOURCE_FILES) fail("The downloaded archive contained too many entries.");
        const candidate = path.join(directory, entry.name);
        const metadata = fs.lstatSync(candidate);
        if (metadata.isSymbolicLink()) fail("The downloaded archive contained an indirect entry.");
        if (metadata.isDirectory()) walk(candidate);
        else if (metadata.isFile() && wanted.has(entry.name.toLowerCase())) {
          found.set(entry.name.toLowerCase(), candidate);
        }
      }
    };
    walk(extracted);
    const missing = step.binaries.filter((name) => !found.has(name.toLowerCase()));
    if (missing.length) return { ok: false, output: `The archive did not contain ${missing.join(", ")}.` };
    for (const [name, source] of found) {
      const destination = path.join(layout.toolsBin, name);
      const existing = fs.lstatSync(destination, { throwIfNoEntry: false });
      if (existing && (!existing.isFile() || existing.isSymbolicLink())) {
        fail("The Agent Reach portable-tool destination is indirect.");
      }
      fs.copyFileSync(source, destination);
    }
    return { ok: true, output: `Installed ${[...found.keys()].join(", ")}.` };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

async function installTarget(request, context, layout) {
  const output = [];
  for (const step of INSTALL_RECIPES[request.target]) {
    let result;
    if (step.kind === "pip") result = await pipInstall(context, layout, step.packages);
    else if (step.kind === "npm") result = await npmInstall(context, layout, step.packages);
    else if (step.kind === "mcporter") result = await mcporterAdd(context, layout, step);
    else if (step.kind === "config-line") result = configLine(layout, step);
    else if (step.kind === "bundled-file") result = bundledFile(context, layout, step);
    else result = await archiveInstall(context, layout, step);
    if (result.output) output.push(result.output);
    if (!result.ok) return { ok: false, output: output.join("\n").slice(-16_000) };
  }
  return { ok: true, output: output.join("\n").slice(-16_000) };
}

async function configureCredential(request, context, layout) {
  if (!context.inputPath) fail("The sealed Agent Reach credential is unavailable.", 400, "credential_input_missing");
  const helper = directPath(
    path.join(context.dashboardScriptsRoot, "runtime-v2-agent-reach-configure.py"),
    "isFile",
    "The Agent Reach credential helper",
    context.platform,
  );
  const result = await runAgentReachSetupCommand(
    layout.python,
    [helper, "configure", request.key, context.inputPath],
    {
      cwd: layout.sourceRoot,
      env: safeEnvironment(context.env, layout, {
        dockerAccess: request.key === "xhs-cookies",
      }),
      signal: context.signal,
      timeoutMs: COMMAND_TIMEOUT_MS,
      spawnImpl: context.spawnImpl,
      platform: context.platform,
    },
  );
  return { ok: result.code === 0, output: cleanOutput(result) };
}

async function importCookies(request, context, layout) {
  const helper = directPath(
    path.join(context.dashboardScriptsRoot, "runtime-v2-agent-reach-configure.py"),
    "isFile",
    "The Agent Reach browser-import helper",
    context.platform,
  );
  const result = await runAgentReachSetupCommand(
    layout.python,
    [helper, "import-cookies", request.browser, request.platform],
    {
      cwd: layout.sourceRoot,
      env: safeEnvironment(context.env, layout, { browserAccess: true }),
      signal: context.signal,
      timeoutMs: COMMAND_TIMEOUT_MS,
      spawnImpl: context.spawnImpl,
      platform: context.platform,
    },
  );
  return { ok: result.code === 0, output: cleanOutput(result) };
}

async function doctorStatus(context, layout) {
  const appSource = path.join(context.appRoot, "agent-reach", "agent_reach", "cli.py");
  const managedSource = path.join(layout.sourceRoot, "agent_reach", "cli.py");
  const isDirectFile = (candidate) => {
    try {
      directPath(candidate, "isFile", "The Agent Reach health source", context.platform);
      return true;
    } catch {
      return false;
    }
  };
  const cloned = isDirectFile(appSource) || isDirectFile(managedSource);
  if (!isDirectFile(managedSource)) {
    return {
      ok: true,
      output: "",
      available: false,
      cloned,
      reason: cloned
        ? "Agent Reach is present but its managed Runtime environment has not been prepared."
        : "The Agent Reach source is unavailable in this Breadboard installation.",
      channels: [],
    };
  }
  if (!isDirectFile(layout.python)) {
    return {
      ok: true,
      output: "",
      available: false,
      cloned: true,
      reason: "Agent Reach is staged but its managed Runtime environment is not prepared.",
      channels: [],
    };
  }
  const result = await runAgentReachSetupCommand(
    layout.python,
    ["-m", "agent_reach.cli", "doctor", "--json"],
    {
      cwd: layout.sourceRoot,
      env: safeEnvironment(context.env, layout),
      signal: context.signal,
      timeoutMs: VERIFY_TIMEOUT_MS,
      spawnImpl: context.spawnImpl,
      platform: context.platform,
    },
  );
  return {
    ok: true,
    output: result.code === 0 ? "" : cleanOutput(result),
    available: true,
    cloned: true,
    reason: null,
    channels: parseDoctorChannels(result.stdout),
  };
}

export function validateAgentReachSetupRequest(value) {
  if (!isRecord(value) || value.protocolVersion !== 1 || typeof value.operation !== "string") {
    fail("The Agent Reach setup request is invalid.", 400, "agent_reach_setup_request_invalid");
  }
  if (
    value.operation === "doctor" &&
    exactRecord(value, ["protocolVersion", "operation", "force"]) &&
    typeof value.force === "boolean"
  ) return value;
  if (
    value.operation === "install" &&
    exactRecord(value, ["protocolVersion", "operation", "target"]) &&
    AGENT_REACH_INSTALL_TARGETS.includes(value.target)
  ) return value;
  if (
    value.operation === "configure" &&
    exactRecord(value, ["protocolVersion", "operation", "key"]) &&
    AGENT_REACH_CREDENTIAL_KEYS.includes(value.key)
  ) return value;
  if (
    value.operation === "import-cookies" &&
    exactRecord(value, ["protocolVersion", "operation", "browser", "platform"]) &&
    AGENT_REACH_COOKIE_BROWSERS.includes(value.browser) &&
    AGENT_REACH_COOKIE_PLATFORMS.includes(value.platform)
  ) return value;
  fail("The Agent Reach setup request is invalid.", 400, "agent_reach_setup_request_invalid");
}

export function expectedAgentReachSetupInputCount(request) {
  return validateAgentReachSetupRequest(request).operation === "configure" ? 1 : 0;
}

export async function executeAgentReachSetup(request, options) {
  const canonical = validateAgentReachSetupRequest(request);
  if (!(options?.signal instanceof AbortSignal)) fail("Agent Reach setup requires cancellation authority.");
  const context = {
    dataRoot: directPath(options.dataRoot, "isDirectory", "The Runtime data root"),
    appRoot: directPath(options.appRoot, "isDirectory", "The Breadboard application root"),
    workspacePath: directPath(options.workspacePath, "isDirectory", "The private setup workspace"),
    dashboardScriptsRoot: directPath(
      options.dashboardScriptsRoot,
      "isDirectory",
      "The staged dashboard worker scripts",
    ),
    inputPath: options.inputPath ?? null,
    env: options.env ?? process.env,
    signal: options.signal,
    spawnImpl: options.spawnImpl ?? spawn,
    fetchImpl: options.fetchImpl ?? fetch,
    platform: options.platform ?? process.platform,
  };
  const layout = layoutFor(context);
  if (canonical.operation === "doctor") return doctorStatus(context, layout);
  const fingerprint = stageSource(context, layout);
  const core = await ensureCore(context, layout, fingerprint);
  if (!core.ok) return core;
  if (canonical.operation === "install") return installTarget(canonical, context, layout);
  if (canonical.operation === "configure") return configureCredential(canonical, context, layout);
  return importCookies(canonical, context, layout);
}

export function agentReachSetupFailure(error) {
  return {
    ok: false,
    output: "",
    error: {
      code: typeof error?.code === "string" ? error.code.slice(0, 128) : "agent_reach_setup_failed",
      status: Number.isSafeInteger(error?.status) && error.status >= 400 && error.status <= 599
        ? error.status
        : 500,
      message: error instanceof Error ? error.message.slice(0, 8_000) : "Agent Reach setup failed.",
    },
  };
}
