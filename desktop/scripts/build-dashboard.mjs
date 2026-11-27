// Runs the dashboard's desktop production build (Next standalone output into
// .next-desktop) with the right environment on any platform.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { availableParallelism } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  beginDashboardBuild,
  completeDashboardBuild,
  dashboardBuildPaths,
  recoverInterruptedDashboardBuild,
  refreshStandaloneDashboardAssets,
  writeDashboardBuildManifest,
} from "./dashboard-build-cache.mjs";
import { assertWindowsCommitHeadroom, dashboardBuildMemoryPlan } from "./commit-preflight.mjs";
import { isTransientDashboardBuildFailure } from "./dashboard-build-retry.mjs";
import { assertSafeDashboardTraces } from "./dashboard-trace-safety.mjs";
import { verifyLiveKitRuntime } from "./verify-livekit-runtime.mjs";
import {
  claimDashboardBuildLease,
  duplicateLeanDesktopWarning,
  releaseDashboardBuildLease,
} from "./lean-desktop-lease.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dashboardDir = path.join(repoRoot, "dashboard");
const nextBin = path.join(dashboardDir, "node_modules", "next", "dist", "bin", "next");
const traceGuard = path.join(repoRoot, "desktop", "scripts", "next-trace-guard.cjs");

// Packaging and QA also invoke this file directly. Secure dev-fast's output
// lease before provisioning or rotating output so a second build cannot
// remove manifests while Next is collecting page data.
const buildLease = claimDashboardBuildLease({ repoRoot });
if (!buildLease.acquired) {
  process.stderr.write(`[desktop] ${duplicateLeanDesktopWarning(buildLease.existing)}\n`);
  process.exit(2);
}
if (!buildLease.inherited) {
  process.once("exit", () => releaseDashboardBuildLease(repoRoot, buildLease.record));
}

// This file is also called directly by packaging and Electron QA, outside the
// lean development launcher. Keep resource admission at the heavy boundary so
// no caller can accidentally bypass the Windows commit reserve.
const buildMemory = dashboardBuildMemoryPlan();
const dashboardBuildHeapMb = buildMemory.heapMb;
assertWindowsCommitHeadroom({
  operation: "standalone dashboard build",
  estimateMb: buildMemory.estimateMb,
});

// Page-data collectors import server modules in parallel. Give each worker
// empty build-only storage rather than opening user data or racing migrations.
const buildDataParent = path.join(repoRoot, ".runtime", "dashboard-build-data");
fs.mkdirSync(buildDataParent, { recursive: true });
const buildDataRoot = fs.mkdtempSync(path.join(buildDataParent, "attempt-"));

// The vendored mem0 engine has to exist before the build, not after: file
// tracing can only follow `import("mem0ai/oss")` into the package if the clone
// is built, and an unbuilt one is traced as nothing at all — the packaged app
// would then ship without semantic recall and no build step would have failed.
// `--if-needed` is a no-op once it is there.
const mem0 = spawnSync(
  process.execPath,
  [path.join(repoRoot, "scripts", "setup-mem0.mjs"), process.env.BREADBOARD_SOURCE_REPAIR_BUILD === "1" ? "--verify-only" : "--if-needed"],
  { cwd: repoRoot, stdio: "inherit" },
);
if (mem0.status !== 0) {
  console.error(
    "[desktop] mem0 provisioning failed; refusing to build a dashboard without semantic memory.",
  );
  process.exit(mem0.status ?? 1);
}

// GenOffice Docs is deliberately a static iframe bundle, outside Next's route
// graph, so opening a document cannot compile a new route and refresh the chat.
// Rebuild it before every desktop dashboard build instead of trusting a stale
// generated public directory from the checkout.
const genofficeEditor = spawnSync(
  process.execPath,
  [path.join(dashboardDir, "scripts", "build-genoffice-editor.mjs")],
  { cwd: dashboardDir, stdio: "inherit" },
);
if (genofficeEditor.status !== 0) process.exit(genofficeEditor.status ?? 1);
const clapWorklet = spawnSync(process.execPath, [path.join(dashboardDir, 'scripts', 'build-clap-worklet.mjs')],
  { cwd: dashboardDir, stdio: 'inherit', windowsHide: true });
if (clapWorklet.status !== 0) process.exit(clapWorklet.status ?? 1);
const assistantWidgets = spawnSync(process.execPath, [path.join(dashboardDir, 'scripts', 'build-assistant-widgets.mjs')],
  { cwd: dashboardDir, stdio: 'inherit', windowsHide: true });
if (assistantWidgets.status !== 0) process.exit(assistantWidgets.status ?? 1);
const quartzReader = spawnSync(process.execPath, [path.join(dashboardDir, 'scripts', 'build-quartz-reader.mjs')],
  { cwd: dashboardDir, stdio: 'inherit', windowsHide: true });
if (quartzReader.status !== 0) process.exit(quartzReader.status ?? 1);

// Turbopack keeps the route graph in its Rust worker instead of retaining the
// whole graph in V8. Keep the existing one-time ceiling for Next's JavaScript
// orchestration and output tracing; the lean runtime remains independently
// bounded, and dev-fast's commit monitor still protects the Windows reserve.
const maxDashboardBuildAttempts = 2;
const capturedOutputLimit = 256 * 1024;
// Limit simultaneous native compiler work during the Windows build peak.
// Next's page-data workers run later and have a separate limit in next.config.ts.
const nativeThreads = String(Math.min(4, availableParallelism()));

function appendCapturedOutput(current, chunk) {
  const combined = current + chunk.toString();
  return combined.length <= capturedOutputLimit
    ? combined
    : combined.slice(combined.length - capturedOutputLimit);
}

function runDashboardBuildAttempt() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [
      `--max-old-space-size=${dashboardBuildHeapMb}`,
      "--require",
      traceGuard,
      nextBin,
      "build",
      "--turbopack",
    ], {
      cwd: dashboardDir,
      stdio: ["inherit", "pipe", "pipe"],
      env: {
        ...process.env,
        ...(process.platform === "win32" ? {
          RAYON_NUM_THREADS: process.env.RAYON_NUM_THREADS ?? nativeThreads,
          TOKIO_WORKER_THREADS: process.env.TOKIO_WORKER_THREADS ?? nativeThreads,
        } : {}),
        BREADBOARD_DESKTOP_BUILD: "1",
        BREADBOARD_BUILD_DATA_ROOT: buildDataRoot,
        BREADBOARD_NEXT_DIST_DIR: ".next-desktop",
      },
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      output = appendCapturedOutput(output, chunk);
    });
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
      output = appendCapturedOutput(output, chunk);
    });
    child.once("error", (error) => resolve({
      status: 1,
      output: `${output}\n${error.stack ?? error}`,
    }));
    child.once("exit", (status, signal) => resolve({
      status: status ?? 1,
      output: signal ? `${output}\nNext build exited on signal ${signal}` : output,
    }));
  });
}

let result;
for (let attempt = 1; attempt <= maxDashboardBuildAttempts; attempt += 1) {
  try {
    beginDashboardBuild(repoRoot);
  } catch (error) {
    if (
      error?.code !== "BREADBOARD_DASHBOARD_OUTPUT_LOCKED" &&
      error?.code !== "BREADBOARD_DASHBOARD_OUTPUT_IN_USE"
    ) throw error;
    process.stderr.write(`[desktop] ${error.message}\n`);
    process.exit(2);
  }
  result = await runDashboardBuildAttempt();
  if (result.status === 0) break;

  recoverInterruptedDashboardBuild(repoRoot);
  const retryable = isTransientDashboardBuildFailure(result.output);
  if (!retryable || attempt === maxDashboardBuildAttempts) {
    process.exit(result.status ?? 1);
  }
  console.warn(
    `[desktop] Next hit a transient managed-output filesystem failure; retrying dashboard build (${attempt + 1}/${maxDashboardBuildAttempts}).`,
  );
}

/**
 * sharp's .node loads libvips through the Windows loader, which tracing cannot
 * follow. Without those DLLs every route that imports sharp answers 500 on an
 * installed copy (ERR_DLOPEN_FAILED) while development keeps working.
 */
function verifySharpNativeLibraries(standaloneDashboard) {
  const lib = path.join(standaloneDashboard, "node_modules", "@img", "sharp-win32-x64", "lib");
  if (!fs.existsSync(path.join(lib, "sharp-win32-x64.node"))) return;
  const names = fs.readdirSync(lib);
  const missing = ["libvips-42.dll", "libvips-cpp-"].filter(
    (prefix) => !names.some((name) => name.startsWith(prefix) && name.endsWith(".dll")),
  );
  if (missing.length) {
    throw new Error(
      `Standalone dashboard ships sharp without its native libraries (${missing.join(", ")}) in ${lib}. ` +
        "Check outputFileTracingIncludes in dashboard/next.config.ts.",
    );
  }
  console.log(`[desktop] sharp native libraries present: ${names.filter((name) => name.endsWith(".dll")).join(", ")}`);
  // pdf-parse resolves @napi-rs/canvas from the standalone tree; without it
  // every PDF fails with "DOMMatrix is not defined".
  for (const relative of [
    "node_modules/@napi-rs/canvas/index.js",
    "node_modules/@napi-rs/canvas-win32-x64-msvc/skia.win32-x64-msvc.node",
    "node_modules/@napi-rs/canvas-win32-x64-msvc/icudtl.dat",
  ]) {
    if (!fs.existsSync(path.join(standaloneDashboard, relative))) {
      throw new Error(`Standalone dashboard is missing ${relative}; PDF parsing would fail on installed copies.`);
    }
  }
}

/**
 * The installer cannot write a file whose full path reaches Windows' 260
 * character MAX_PATH, and it drops it silently. Installed at
 * %LOCALAPPDATA%\Programs\Breadboard, a standalone file sits behind
 * "C:\Users\<name>\AppData\Local\Programs\Breadboard\resources\app-services\
 * dashboard-standalone\dashboard\" (98 characters plus the user name). Nested
 * duplicate @opentelemetry packages once crossed that line and LiveKit failed
 * with "Cannot find module" on installed copies only. Budget for 20-character
 * user names.
 */
const MAX_STANDALONE_RELATIVE_PATH = 259 - (98 + 20);
function verifyStandalonePathLengths(standaloneDashboard) {
  const tooLong = [];
  const walk = (directory, relative) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const child = relative ? `${relative}\\${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(directory, entry.name), child);
      else if (child.length > MAX_STANDALONE_RELATIVE_PATH) tooLong.push(child);
    }
  };
  walk(standaloneDashboard, "");
  if (tooLong.length) {
    throw new Error(
      `${tooLong.length} standalone dashboard file(s) exceed ${MAX_STANDALONE_RELATIVE_PATH} characters and would ` +
        `be dropped by the Windows installer (MAX_PATH). Deduplicate the nesting packages (npm overrides). First: ` +
        tooLong.sort((a, b) => b.length - a.length).slice(0, 5).join(", "),
    );
  }
}

// Next intentionally leaves static/public assets beside standalone output.
// Complete the runnable tree here so every caller (lean dev, QA, packaging)
// gets the same production-like artifact rather than each copying a subset.
try {
  assertSafeDashboardTraces(repoRoot);
  refreshStandaloneDashboardAssets(repoRoot);
  console.log(verifyLiveKitRuntime(dashboardBuildPaths(repoRoot).standaloneDashboard));
  verifySharpNativeLibraries(dashboardBuildPaths(repoRoot).standaloneDashboard);
  verifyStandalonePathLengths(dashboardBuildPaths(repoRoot).standaloneDashboard);
  writeDashboardBuildManifest(repoRoot);
  completeDashboardBuild(repoRoot);
} catch (error) {
  recoverInterruptedDashboardBuild(repoRoot);
  throw error;
}
