#!/usr/bin/env node

// Build the production-like Next standalone server once, copy the static files
// it intentionally leaves outside the trace, then launch the normal desktop
// supervisor with that server instead of an on-demand compiler.
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertWindowsCommitHeadroom } from "./commit-preflight.mjs";
import {
  refreshStandaloneDashboardAssets,
  reusableDashboardBuild,
} from "./dashboard-build-cache.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const forceRebuild = process.argv.includes("--rebuild");
const rawBuildEstimate = process.env.BREADBOARD_LEAN_BUILD_ESTIMATE_MB?.trim();
if (rawBuildEstimate && !/^\d+$/.test(rawBuildEstimate)) {
  process.stderr.write("[desktop] BREADBOARD_LEAN_BUILD_ESTIMATE_MB must be a whole number.\n");
  process.exit(2);
}
const buildEstimateMb = rawBuildEstimate ? Number(rawBuildEstimate) : 11_264;
if (!Number.isSafeInteger(buildEstimateMb) || buildEstimateMb < 4_096 || buildEstimateMb > 16_384) {
  process.stderr.write("[desktop] BREADBOARD_LEAN_BUILD_ESTIMATE_MB must be between 4096 and 16384.\n");
  process.exit(2);
}

async function runDashboardBuild() {
  const build = spawn(
    process.execPath,
    [path.join(repoRoot, "desktop", "scripts", "build-dashboard.mjs")],
    { cwd: repoRoot, stdio: "inherit", env: process.env, windowsHide: true },
  );
  let reserveCrossed = false;
  let sampling = false;
  const monitor = setInterval(() => {
    if (sampling || reserveCrossed || build.exitCode !== null) return;
    sampling = true;
    try {
      assertWindowsCommitHeadroom({ operation: "lean dashboard build", estimateMb: 0 });
    } catch (error) {
      reserveCrossed = true;
      process.stderr.write(
        `[desktop] ${error instanceof Error ? error.message : String(error)} Stopping the build tree; no retry.\n`,
      );
      if (process.platform === "win32" && build.pid) {
        spawnSync("taskkill.exe", ["/PID", String(build.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
      } else {
        build.kill("SIGTERM");
      }
    } finally {
      sampling = false;
    }
  }, 3_000);

  const status = await new Promise((resolve) => {
    build.once("error", () => resolve(1));
    build.once("exit", (code) => resolve(code ?? 1));
  });
  clearInterval(monitor);
  return reserveCrossed ? 2 : status;
}

const cached = forceRebuild
  ? { reusable: false, reason: "a rebuild was requested" }
  : reusableDashboardBuild(repoRoot);
let dashboardMode = "standalone";
if (cached.reusable) {
  process.stdout.write("[desktop] reusing unchanged standalone dashboard build\n");
  // Public assets do not alter the server graph, so keep them current without
  // paying the webpack compilation peak.
  refreshStandaloneDashboardAssets(repoRoot);
} else {
  process.stdout.write(`[desktop] standalone dashboard rebuild required: ${cached.reason}\n`);
  let admitted = true;
  try {
    assertWindowsCommitHeadroom({ operation: "lean dashboard build", estimateMb: buildEstimateMb });
  } catch (error) {
    if (forceRebuild) {
      process.stderr.write(`[desktop] ${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(2);
    }
    admitted = false;
    dashboardMode = "bounded-hot";
    process.stderr.write(
      `[desktop] ${error instanceof Error ? error.message : String(error)} ` +
      "Starting the bounded on-demand dashboard instead; no full build was launched.\n",
    );
  }
  if (admitted) {
    const buildStatus = await runDashboardBuild();
    if (buildStatus !== 0) process.exit(buildStatus);
  }
}

const npmCli = process.env.npm_execpath?.trim();
if (!npmCli) {
  process.stderr.write("[desktop] npm did not provide npm_execpath; cannot launch the desktop supervisor.\n");
  process.exit(1);
}
const explicitDashboardBudget = [
  "BREADBOARD_DASHBOARD_DEV_HEAP_MB",
  "BREADBOARD_DASHBOARD_TREE_SOFT_LIMIT_MB",
  "BREADBOARD_DASHBOARD_TREE_HARD_LIMIT_MB",
].some((key) => process.env[key]?.trim());
const boundedHotBudget = dashboardMode === "bounded-hot" && !explicitDashboardBudget
  ? {
      BREADBOARD_DASHBOARD_DEV_HEAP_MB: "4096",
      BREADBOARD_DASHBOARD_TREE_SOFT_LIMIT_MB: "6144",
      BREADBOARD_DASHBOARD_TREE_HARD_LIMIT_MB: "7168",
    }
  : {};
// Node 24 on Windows rejects direct `.cmd` execution with `shell:false` as
// EINVAL. Invoke npm's JavaScript entry through the current Node executable so
// the child remains shell-free, hidden, and owned by this exact process tree.
const child = spawn(process.execPath, [npmCli, "--prefix", "desktop", "run", "dev"], {
  cwd: repoRoot,
  stdio: "inherit",
  shell: false,
  env: {
    ...process.env,
    ...boundedHotBudget,
    BREADBOARD_DESKTOP_DASHBOARD_MODE: dashboardMode,
  },
});
child.once("error", (error) => {
  process.stderr.write(`[desktop] Fast mode could not start: ${error.message}\n`);
  process.exitCode = 1;
});
child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
