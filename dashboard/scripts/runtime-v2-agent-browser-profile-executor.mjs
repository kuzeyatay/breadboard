import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/u;
const OPENCLI_EXTENSION_VERSION = "1.0.22";
const PROFILE_CLAIM_TIMEOUT_MS = 12_000;
const PROFILE_CLAIM_POLL_MS = 500;
const GRACEFUL_CLOSE_MS = 8_000;

function fail(message, code = "agent_browser_profile_failed") {
  throw Object.assign(new Error(message), { code });
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

function directFile(candidate, label, platform = process.platform) {
  const resolved = path.resolve(candidate);
  const metadata = fs.lstatSync(resolved, { throwIfNoEntry: false });
  if (!metadata?.isFile() || metadata.isSymbolicLink() ||
      !samePath(fs.realpathSync.native(resolved), resolved, platform)) {
    fail(`${label} is unavailable.`, "agent_browser_profile_source_unavailable");
  }
  return resolved;
}

function directDirectory(candidate, label, platform = process.platform) {
  const resolved = path.resolve(candidate);
  const metadata = fs.lstatSync(resolved, { throwIfNoEntry: false });
  if (!metadata?.isDirectory() || metadata.isSymbolicLink() ||
      !samePath(fs.realpathSync.native(resolved), resolved, platform)) {
    fail(`${label} is unavailable.`, "agent_browser_profile_path_unavailable");
  }
  return resolved;
}

function ensureDirectTree(root, target, label, platform = process.platform) {
  const canonicalRoot = directDirectory(root, "The Runtime data root", platform);
  const resolved = path.resolve(target);
  if (!pathWithin(canonicalRoot, resolved)) fail(`${label} escaped Runtime data.`);
  let current = canonicalRoot;
  for (const segment of path.relative(canonicalRoot, resolved).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const metadata = fs.lstatSync(current, { throwIfNoEntry: false });
    if (!metadata) fs.mkdirSync(current, { mode: 0o700 });
    directDirectory(current, label, platform);
  }
  return resolved;
}

function normalizeUrl(value) {
  if (value === null) return null;
  if (typeof value !== "string" || !value.trim() || value.trim() !== value) {
    fail("The browser profile start URL is invalid.", "agent_browser_profile_request_invalid");
  }
  let parsed;
  try { parsed = new URL(value); } catch {
    fail("The browser profile start URL is invalid.", "agent_browser_profile_request_invalid");
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.href !== value || Buffer.byteLength(value, "utf8") > 2_048) {
    fail("The browser profile start URL is invalid.", "agent_browser_profile_request_invalid");
  }
  return value;
}

export function validateAgentBrowserProfileRequest(value) {
  if (!exactRecord(value, ["protocolVersion", "operation", "startUrl"]) ||
      value.protocolVersion !== 1 || value.operation !== "open") {
    fail("The browser profile request is invalid.", "agent_browser_profile_request_invalid");
  }
  return { protocolVersion: 1, operation: "open", startUrl: normalizeUrl(value.startUrl) };
}

export function validateAgentBrowserProfileExecutionScope(value) {
  if (!exactRecord(value, ["userId", "gardenId", "conversationId"]) ||
      !Number.isSafeInteger(value.userId) || value.userId < 1 ||
      value.gardenId !== null || value.conversationId !== null) {
    fail("Browser profile work requires authenticated user-global scope.");
  }
  return value;
}

function browserEnvironment(env) {
  const result = {};
  for (const name of [
    "SystemRoot", "WINDIR", "SystemDrive", "USERPROFILE", "HOME", "APPDATA",
    "LOCALAPPDATA", "PROGRAMDATA", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL",
    "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "SSL_CERT_FILE",
    "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS",
  ]) {
    const value = env[name]?.trim();
    if (value) result[name] = value;
  }
  return result;
}

function atomicMarker(markerPath, value) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  if (bytes.byteLength > 8 * 1024) fail("The browser profile marker exceeded its bound.");
  const parent = directDirectory(path.dirname(markerPath), "The browser profile state root");
  const existing = fs.lstatSync(markerPath, { throwIfNoEntry: false });
  if (existing && (!existing.isFile() || existing.isSymbolicLink())) {
    fail("The browser profile marker is indirect.");
  }
  const pending = path.join(parent, `.agent-browser-signin.${process.pid}.pending`);
  let descriptor;
  try {
    descriptor = fs.openSync(pending, "wx", 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(pending, markerPath);
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(pending, { force: true });
    throw error;
  }
}

function forgetOwnedMarker(markerPath, identity) {
  try {
    const metadata = fs.lstatSync(markerPath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 8 * 1024) return;
    const value = JSON.parse(fs.readFileSync(markerPath, "utf8"));
    if (value?.jobId === identity.jobId && value?.attempt === identity.attempt &&
        value?.workerInstanceId === identity.workerInstanceId) {
      fs.rmSync(markerPath, { force: true });
    }
  } catch { /* already absent or replaced by a newer owner */ }
}

function installedExtension(dataRoot) {
  const directory = path.join(
    dataRoot, "browser-extensions", "opencli", OPENCLI_EXTENSION_VERSION,
  );
  try {
    directDirectory(directory, "The staged OpenCLI extension");
    const manifest = directFile(path.join(directory, "manifest.json"), "The OpenCLI extension manifest");
    const parsed = JSON.parse(fs.readFileSync(manifest, "utf8"));
    return parsed?.name === "OpenCLI" && parsed?.version === OPENCLI_EXTENSION_VERSION
      ? directory
      : null;
  } catch { return null; }
}

async function readBridgeStatus(fetchImpl = fetch) {
  try {
    const response = await fetchImpl("http://127.0.0.1:19825/status", {
      headers: { "X-OpenCLI": "1" },
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return null;
    const value = await response.json();
    if (value?.ok !== true || !Array.isArray(value.profiles)) return null;
    const contextIds = value.profiles
      .map((entry) => typeof entry?.contextId === "string" && IDENTIFIER.test(entry.contextId)
        ? entry.contextId
        : null)
      .filter(Boolean);
    return { contextIds, profileRequired: value.profileRequired === true };
  } catch { return null; }
}

function quoteForCmd(value) {
  return `"${value.replace(/(\\*)"/gu, "$1$1\\\"").replace(/(\\+)$/gu, "$1$1")}"`;
}

async function runFixedOpenCli(args, env = process.env, spawnImpl = spawn) {
  const configured = env.BREADBOARD_AGENT_BROWSER_PROFILE_OPENCLI_PATH?.trim();
  if (!configured || !path.isAbsolute(configured)) return false;
  let executable;
  try { executable = directFile(configured, "The managed OpenCLI executable"); } catch { return false; }
  const toolPath = env.BREADBOARD_AGENT_BROWSER_PROFILE_TOOL_PATH?.trim();
  const childEnv = {
    ...browserEnvironment(env),
    ...(toolPath ? { PATH: toolPath } : {}),
    ...(env.PATHEXT?.trim() ? { PATHEXT: env.PATHEXT.trim() } : {}),
  };
  let command = executable;
  let argv = args;
  let windowsVerbatimArguments = false;
  if (process.platform === "win32" && /\.(?:cmd|bat)$/iu.test(executable)) {
    const comspec = env.ComSpec?.trim() || env.COMSPEC?.trim();
    if (!comspec || !path.isAbsolute(comspec)) return false;
    try { command = directFile(comspec, "The trusted command processor"); } catch { return false; }
    argv = ["/d", "/s", "/c", `"${[executable, ...args].map(quoteForCmd).join(" ")}"`];
    windowsVerbatimArguments = true;
  }
  return await new Promise((resolve) => {
    const child = spawnImpl(command, argv, {
      detached: false,
      stdio: "ignore",
      windowsHide: true,
      shell: false,
      windowsVerbatimArguments,
      env: childEnv,
    });
    const timeout = setTimeout(() => { try { child.kill(); } catch { /* native reaping remains */ } }, 10_000);
    timeout.unref?.();
    child.once("error", () => { clearTimeout(timeout); resolve(false); });
    child.once("close", (code) => { clearTimeout(timeout); resolve(code === 0); });
  });
}

function rememberedContextId(dataRoot) {
  try {
    const file = path.join(dataRoot, "agent-browser-bridge.json");
    const metadata = fs.lstatSync(file);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 8 * 1024) return null;
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return typeof value?.contextId === "string" && IDENTIFIER.test(value.contextId)
      ? value.contextId
      : null;
  } catch { return null; }
}

function rememberContextId(dataRoot, contextId) {
  const target = path.join(dataRoot, "agent-browser-bridge.json");
  atomicMarker(target, { contextId, at: new Date().toISOString() });
}

async function claimProfile(dataRoot, before, signal, options = {}) {
  const remembered = rememberedContextId(dataRoot);
  const known = new Set(before?.contextIds ?? []);
  const deadline = Date.now() + (options.timeoutMs ?? PROFILE_CLAIM_TIMEOUT_MS);
  let selected = null;
  while (!signal.aborted && Date.now() <= deadline) {
    const status = await (options.readStatus ?? readBridgeStatus)();
    if (status) {
      if (remembered && status.contextIds.includes(remembered)) selected = remembered;
      else {
        const fresh = status.contextIds.filter((contextId) => !known.has(contextId));
        if (fresh.length === 1) selected = fresh[0];
        if (fresh.length > 1) return;
      }
      if (selected) break;
      if (status.contextIds.length === 1 && !status.profileRequired) return;
    }
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, PROFILE_CLAIM_POLL_MS);
      timer.unref?.();
    });
  }
  if (!selected || signal.aborted) return;
  const run = options.runOpenCli ?? ((args) => runFixedOpenCli(args));
  if (!await run(["profile", "rename", selected, "breadboard"])) return;
  if (!await run(["profile", "use", "breadboard"])) return;
  rememberContextId(dataRoot, selected);
}

function waitForSpawn(child) {
  if (typeof child.pid === "number") return Promise.resolve();
  return new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
}

function waitForClose(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
}

async function gracefulClose(child, env, spawnImpl = spawn) {
  if (typeof child.pid !== "number") return;
  if (process.platform !== "win32") {
    try { child.kill("SIGTERM"); } catch { /* native reaper follows */ }
    return;
  }
  const systemRoot = env.SystemRoot?.trim() || env.WINDIR?.trim();
  if (!systemRoot) return;
  let taskkill;
  try { taskkill = directFile(path.join(systemRoot, "System32", "taskkill.exe"), "The trusted taskkill executable"); }
  catch { return; }
  await new Promise((resolve) => {
    const closer = spawnImpl(taskkill, ["/PID", String(child.pid)], {
      detached: false,
      stdio: "ignore",
      windowsHide: true,
      env: { SystemRoot: systemRoot, WINDIR: systemRoot },
    });
    const timeout = setTimeout(resolve, GRACEFUL_CLOSE_MS);
    timeout.unref?.();
    closer.once("error", () => { clearTimeout(timeout); resolve(); });
    closer.once("close", () => { clearTimeout(timeout); resolve(); });
  });
}

/** Own the visible Chromium process until the person closes it or Runtime cancels it. */
export async function executeAgentBrowserProfileOperation(launch, signal, options = {}) {
  validateAgentBrowserProfileRequest(launch.request);
  validateAgentBrowserProfileExecutionScope(launch.executionScope);
  const env = options.env ?? process.env;
  const spawnImpl = options.spawnImpl ?? spawn;
  const browserValue = env.BREADBOARD_AGENT_BROWSER_PROFILE_BROWSER_PATH?.trim();
  if (!browserValue || !path.isAbsolute(browserValue)) {
    fail("No trusted browser is configured.", "browser_not_found");
  }
  const browser = directFile(browserValue, "The trusted profile browser");
  const profile = ensureDirectTree(
    launch.dataRoot,
    path.join(launch.dataRoot, "agent-browser-profile"),
    "The browser profile",
  );
  const markerPath = path.join(launch.dataRoot, "agent-browser-signin.json");
  const before = await (options.readStatus ?? readBridgeStatus)();
  const extension = installedExtension(launch.dataRoot);
  const args = [
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    ...(extension ? [`--load-extension=${extension}`] : []),
    ...(launch.request.startUrl ? [launch.request.startUrl] : []),
  ];
  const child = spawnImpl(browser, args, {
    detached: false,
    stdio: "ignore",
    windowsHide: false,
    shell: false,
    env: browserEnvironment(env),
  });
  await waitForSpawn(child);
  if (typeof child.pid !== "number") fail("The profile browser did not report a process ID.");
  const startedAt = new Date().toISOString();
  const marker = {
    protocolVersion: 1,
    jobId: launch.identity.jobId,
    attempt: launch.identity.attempt,
    workerInstanceId: launch.identity.workerInstanceId,
    userId: launch.executionScope.userId,
    pid: child.pid,
    startedAt,
    executable: browser,
  };
  atomicMarker(markerPath, marker);
  options.checkpoint?.({ status: "open", ...marker });
  void claimProfile(launch.dataRoot, before, signal, {
    readStatus: options.readStatus,
    runOpenCli: options.runOpenCli,
    timeoutMs: options.claimTimeoutMs,
  }).catch(() => undefined);
  const close = waitForClose(child);
  const onAbort = () => { void gracefulClose(child, env, spawnImpl); };
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) onAbort();
  try {
    const terminal = await close;
    return {
      status: signal.aborted ? "cancelled" : "closed",
      startedAt,
      finishedAt: new Date().toISOString(),
      exitCode: Number.isSafeInteger(terminal.code) ? terminal.code : null,
      exitSignal: typeof terminal.signal === "string" ? terminal.signal.slice(0, 64) : null,
    };
  } finally {
    signal.removeEventListener("abort", onAbort);
    forgetOwnedMarker(markerPath, launch.identity);
  }
}
