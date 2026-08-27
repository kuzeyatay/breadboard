import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { canonicalRuntimeInput } from "./runtime-v2-finite-mcp-worker-core.mjs";

const ENTRYPOINT = fileURLToPath(import.meta.url);
const MAX_HTML_BYTES = 12 * 1024 * 1024;
const MAX_SCREENSHOT_BYTES = 64 * 1024 * 1024;
const MAX_CAPTURE_TEXT_BYTES = 160 * 1024;
const SLUG = /^[a-z0-9][a-z0-9-]{0,127}$/u;

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

function boundedScopeText(value) {
  return typeof value === "string" && value.trim() === value && value.length > 0 &&
    Buffer.byteLength(value, "utf8") <= 256 && !/\p{Cc}/u.test(value);
}

export function validateGeneratedVisualBrowserExecutionScope(value) {
  if (
    !exactRecord(value, ["userId", "gardenId", "conversationId"]) ||
    !Number.isSafeInteger(value.userId) || value.userId < 1 ||
    !boundedScopeText(value.gardenId) || value.conversationId !== null
  ) fail("Generated visual browser work requires exact garden scope.");
  return value;
}

export function validateGeneratedVisualBrowserRequest(value) {
  if (
    !exactRecord(value, [
      "protocolVersion", "operation", "slug", "width", "height",
      "reducedMotion", "screenshot", "timeoutMs",
    ]) ||
    value.protocolVersion !== 1 || value.operation !== "render-generated-visual" ||
    !SLUG.test(value.slug) ||
    !Number.isSafeInteger(value.width) || value.width < 240 || value.width > 4_096 ||
    !Number.isSafeInteger(value.height) || value.height < 240 || value.height > 4_096 ||
    typeof value.reducedMotion !== "boolean" ||
    typeof value.screenshot !== "boolean" ||
    !Number.isSafeInteger(value.timeoutMs) || value.timeoutMs < 5_000 || value.timeoutMs > 90_000
  ) fail("The generated visual browser request is invalid.");
  return value;
}

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function directFile(candidate) {
  try {
    const metadata = fs.lstatSync(candidate);
    return metadata.isFile() && !metadata.isSymbolicLink() &&
      samePath(fs.realpathSync.native(candidate), candidate);
  } catch {
    return false;
  }
}

export function findGeneratedVisualBrowser(
  env = process.env,
  platform = process.platform,
) {
  const configured = env.BREADBOARD_VISUAL_BROWSER_PATH?.trim();
  const candidates = configured
    ? [path.resolve(configured)]
    : platform === "win32"
      ? [
          "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
          "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
          "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        ]
      : [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
          "/usr/bin/chromium",
          "/usr/bin/chromium-browser",
          "/usr/bin/google-chrome",
        ];
  return candidates.find(directFile) ?? null;
}

function sourceLayout() {
  const dashboardMarkerRoot = path.dirname(path.dirname(ENTRYPOINT));
  const appRoot = path.dirname(dashboardMarkerRoot);
  const developmentSourceRoot = path.join(dashboardMarkerRoot, "src");
  const packagedDashboardRoot = path.join(appRoot, "dashboard-standalone", "dashboard");
  const packagedSourceRoot = path.join(packagedDashboardRoot, "worker-src");
  const development = directFile(path.join(
    developmentSourceRoot,
    "lib",
    "generated-visual-browser-process.ts",
  ));
  const sourceRoot = development ? developmentSourceRoot : packagedSourceRoot;
  const source = path.join(sourceRoot, "lib", "generated-visual-browser-process.ts");
  if (!directFile(source)) fail("The staged generated visual browser process closure is unavailable.");
  return { source };
}

async function observedBrowserRunner() {
  const loaded = await import(pathToFileURL(sourceLayout().source).href);
  if (typeof loaded.runObservedGeneratedVisualBrowserProcess !== "function") {
    fail("The generated visual browser process closure is invalid.");
  }
  return loaded.runObservedGeneratedVisualBrowserProcess;
}

function compactText(value, maximumBytes) {
  const text = typeof value === "string" ? value : "";
  if (Buffer.byteLength(text, "utf8") <= maximumBytes) return text;
  let suffix = text.slice(-Math.floor(maximumBytes / 2));
  while (Buffer.byteLength(suffix, "utf8") > Math.floor(maximumBytes / 2)) {
    suffix = suffix.slice(1_024);
  }
  let prefix = text.slice(0, Math.floor(maximumBytes / 2));
  while (Buffer.byteLength(prefix, "utf8") > Math.floor(maximumBytes / 2)) {
    prefix = prefix.slice(0, -1_024);
  }
  return `${prefix}\n...[bounded]...\n${suffix}`;
}

function compactDom(stdout) {
  const body = stdout.match(/<body\b[^>]*>/iu)?.[0] ?? "";
  const close = /<\/html>/iu.test(stdout) ? "</html>" : "";
  const compact = `${body}${close}`;
  return compact || compactText(stdout, MAX_CAPTURE_TEXT_BYTES);
}

function screenshotReceipt(launch, screenshotPath) {
  if (!directFile(screenshotPath)) return null;
  const metadata = fs.lstatSync(screenshotPath);
  if (metadata.size < 1 || metadata.size > MAX_SCREENSHOT_BYTES) return null;
  const relativePath = path.relative(launch.dataRoot, screenshotPath).split(path.sep).join("/");
  if (relativePath.startsWith("../") || path.isAbsolute(relativePath)) {
    fail("The generated visual screenshot escaped its Runtime fence.");
  }
  const bytes = fs.readFileSync(screenshotPath);
  if (bytes.byteLength !== metadata.size) fail("The generated visual screenshot changed while read.");
  return {
    relativePath,
    sizeBytes: bytes.byteLength,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
}

const CONFIRMED_BROWSER_CLEANUP_METHODS = new Set([
  "natural-exit",
  "natural-exit-lineage",
  "taskkill-tree",
  "lineage-quiescence",
  "process-group",
  "process-group-sigkill",
]);

export function generatedVisualBrowserScreenshotResultIsAuthoritative(result) {
  if (
    result?.status !== 0 || result.signal !== null || result.error != null ||
    result.timedOut !== false || result.cleanupConfirmed !== true ||
    !CONFIRMED_BROWSER_CLEANUP_METHODS.has(result.cleanupMethod)
  ) return false;
  return (
    result.completion === "observed_capture" &&
    result.browserExitedNaturally === false &&
    ["taskkill-tree", "lineage-quiescence", "process-group", "process-group-sigkill"]
      .includes(result.cleanupMethod)
  ) || (
    result.completion === "process_exit" &&
    result.browserExitedNaturally === true &&
    ["natural-exit", "natural-exit-lineage", "process-group"]
      .includes(result.cleanupMethod)
  );
}

export async function executeGeneratedVisualBrowserOperation(launch, signal) {
  const blob = launch.inputBlobs[0];
  if (
    blob.displayName !== "generated-visual-browser.html" ||
    blob.mediaType !== "text/html; charset=utf-8" ||
    blob.sizeBytes > MAX_HTML_BYTES
  ) fail("The generated visual browser HTML input is invalid.");
  const canonicalInput = canonicalRuntimeInput(launch, 0);
  const outputDir = path.join(launch.workspacePath, "generated-visual-browser-output");
  const profileDir = path.join(launch.workspacePath, "browser-profile");
  const homeDir = path.join(launch.workspacePath, "browser-home");
  const tempDir = path.join(launch.workspacePath, "browser-temp");
  const configDir = path.join(homeDir, ".config");
  const cacheDir = path.join(homeDir, ".cache");
  const dataDir = path.join(homeDir, ".local", "share");
  fs.mkdirSync(outputDir, { recursive: false });
  fs.mkdirSync(profileDir, { recursive: false });
  fs.mkdirSync(homeDir, { recursive: false });
  fs.mkdirSync(tempDir, { recursive: false });
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  const htmlPath = path.join(outputDir, "candidate.html");
  fs.copyFileSync(canonicalInput, htmlPath, fs.constants.COPYFILE_EXCL);
  const browser = findGeneratedVisualBrowser();
  if (!browser) {
    return {
      status: null,
      signal: null,
      stdout: "",
      stderr: "",
      error: { code: "ENOENT", message: "No configured Chromium or Microsoft Edge executable was found." },
      durationMs: 0,
      timedOut: false,
      completion: "spawn_error",
      browserExitedNaturally: false,
      cleanupMethod: "none",
      cleanupConfirmed: true,
      screenshot: null,
    };
  }
  const screenshotPath = launch.request.screenshot
    ? path.join(outputDir, "screenshot.png")
    : null;
  const args = [
    `--user-data-dir=${profileDir}`,
    "--headless=new",
    "--disable-gpu",
    "--disable-gpu-shader-disk-cache",
    "--disable-skia-graphite",
    "--disable-features=SkiaGraphiteUsePersistentCache",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-dev-shm-usage",
    "--no-first-run",
    ...(launch.request.reducedMotion ? ["--force-prefers-reduced-motion"] : []),
    `--window-size=${launch.request.width},${launch.request.height}`,
    "--virtual-time-budget=2500",
    "--dump-dom",
    ...(screenshotPath ? [`--screenshot=${screenshotPath}`] : []),
    pathToFileURL(htmlPath).href,
  ];
  const runObserved = await observedBrowserRunner();
  const systemRoot = process.env.SystemRoot?.trim() || process.env.WINDIR?.trim();
  const childEnv = {
    NODE_ENV: "production",
    HOME: homeDir,
    USERPROFILE: homeDir,
    APPDATA: configDir,
    LOCALAPPDATA: dataDir,
    TEMP: tempDir,
    TMP: tempDir,
    TMPDIR: tempDir,
    XDG_CACHE_HOME: cacheDir,
    XDG_CONFIG_HOME: configDir,
    XDG_DATA_HOME: dataDir,
    ...(systemRoot ? { SystemRoot: systemRoot, WINDIR: systemRoot } : {}),
  };
  const result = await runObserved({
    executable: browser,
    args,
    timeoutMs: launch.request.timeoutMs,
    signal,
    env: childEnv,
  });
  return {
    status: result.status,
    signal: result.signal,
    stdout: compactDom(result.stdout),
    stderr: compactText(result.stderr, MAX_CAPTURE_TEXT_BYTES),
    error: result.error
      ? {
          code: String(result.error.code ?? "EBROWSER"),
          message: compactText(String(result.error.message ?? "Browser invocation failed."), 4_096),
        }
      : null,
    durationMs: result.durationMs,
    timedOut: result.timedOut,
    completion: result.completion ?? null,
    browserExitedNaturally: result.browserExitedNaturally,
    cleanupMethod: result.cleanupMethod,
    cleanupConfirmed: result.cleanupConfirmed,
    screenshot: screenshotPath &&
        generatedVisualBrowserScreenshotResultIsAuthoritative(result)
      ? screenshotReceipt(launch, screenshotPath)
      : null,
  };
}
