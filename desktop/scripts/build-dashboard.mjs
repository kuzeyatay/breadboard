// Runs the dashboard's desktop production build (Next standalone output into
// .next-desktop) with the right environment on any platform.
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  beginDashboardBuild,
  completeDashboardBuild,
  recoverInterruptedDashboardBuild,
  refreshStandaloneDashboardAssets,
  writeDashboardBuildManifest,
} from "./dashboard-build-cache.mjs";
import { assertWindowsCommitHeadroom } from "./commit-preflight.mjs";
import { isTransientDashboardBuildFailure } from "./dashboard-build-retry.mjs";
import { assertSafeDashboardTraces } from "./dashboard-trace-safety.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dashboardDir = path.join(repoRoot, "dashboard");
const nextBin = path.join(dashboardDir, "node_modules", "next", "dist", "bin", "next");
const traceGuard = path.join(repoRoot, "desktop", "scripts", "next-trace-guard.cjs");

// This file is also called directly by packaging and Electron QA, outside the
// lean development launcher. Keep resource admission at the heavy boundary so
// no caller can accidentally bypass the Windows commit reserve.
assertWindowsCommitHeadroom({
  operation: "standalone dashboard build",
  estimateMb: 11_264,
});

// The vendored mem0 engine has to exist before the build, not after: file
// tracing can only follow `import("mem0ai/oss")` into the package if the clone
// is built, and an unbuilt one is traced as nothing at all — the packaged app
// would then ship without semantic recall and no build step would have failed.
// `--if-needed` is a no-op once it is there.
const mem0 = spawnSync(
  process.execPath,
  [path.join(repoRoot, "scripts", "setup-mem0.mjs"), "--if-needed"],
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

// Turbopack keeps the route graph in its Rust worker instead of retaining the
// whole graph in V8. Keep the existing one-time ceiling for Next's JavaScript
// orchestration and output tracing; the lean runtime remains independently
// bounded, and dev-fast's commit monitor still protects the Windows reserve.
const dashboardBuildHeapMb = 8_192;
const maxDashboardBuildAttempts = 2;
const capturedOutputLimit = 256 * 1024;

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
        BREADBOARD_DESKTOP_BUILD: "1",
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
  beginDashboardBuild(repoRoot);
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

// Next intentionally leaves static/public assets beside standalone output.
// Complete the runnable tree here so every caller (lean dev, QA, packaging)
// gets the same production-like artifact rather than each copying a subset.
try {
  assertSafeDashboardTraces(repoRoot);
  refreshStandaloneDashboardAssets(repoRoot);
  writeDashboardBuildManifest(repoRoot);
  completeDashboardBuild(repoRoot);
} catch (error) {
  recoverInterruptedDashboardBuild(repoRoot);
  throw error;
}
