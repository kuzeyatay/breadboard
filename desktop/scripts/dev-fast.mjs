#!/usr/bin/env node

// Build the production-like Next standalone server once, copy the static files
// it intentionally leaves outside the trace, then launch the normal desktop
// supervisor with that server instead of an on-demand compiler.
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertWindowsCommitHeadroom } from "./commit-preflight.mjs";
import {
  availableDashboardBuild,
  recoverInterruptedDashboardBuild,
  refreshStandaloneDashboardAssets,
  reusableDashboardBuild,
} from "./dashboard-build-cache.mjs";
import {
  claimDashboardBuildLease,
  claimLeanDesktopLease,
  duplicateLeanDesktopWarning,
  releaseDashboardBuildLease,
  releaseLeanDesktopLease,
} from "./lean-desktop-lease.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
let leanLease;
try {
  const claim = claimLeanDesktopLease({ repoRoot });
  if (!claim.acquired) {
    process.stderr.write(`[desktop] ${duplicateLeanDesktopWarning(claim.existing)}\n`);
    process.exit(2);
  }
  leanLease = claim.record;
  if (claim.staleReplaced) {
    process.stdout.write("[desktop] replaced a stale lean desktop lease\n");
  }
} catch (error) {
  process.stderr.write(
    `[desktop] ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(2);
}
process.once("exit", () => {
  releaseLeanDesktopLease(repoRoot, leanLease);
});

// A direct packaging/QA build may be running without a lean launcher. Secure
// its output lease before recovery can remove what looks like a partial build.
const dashboardLease = claimDashboardBuildLease({ repoRoot });
if (!dashboardLease.acquired) {
  process.stderr.write(`[desktop] ${duplicateLeanDesktopWarning(dashboardLease.existing)}\n`);
  process.exit(2);
}
process.once("exit", () => releaseDashboardBuildLease(repoRoot, dashboardLease.record));

recoverInterruptedDashboardBuild(repoRoot);
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
    {
      cwd: repoRoot,
      stdio: "inherit",
      env: { ...process.env, BREADBOARD_DASHBOARD_BUILD_CLAIM_ID: dashboardLease.record.claimId },
      windowsHide: true,
    },
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
  if (status !== 0 || reserveCrossed) recoverInterruptedDashboardBuild(repoRoot);
  return reserveCrossed ? 2 : status;
}

const cached = forceRebuild
  ? { reusable: false, reason: "a rebuild was requested" }
  : reusableDashboardBuild(repoRoot);
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
    const previous = availableDashboardBuild(repoRoot);
    if (!previous.available) {
      process.stderr.write(
        `[desktop] ${error instanceof Error ? error.message : String(error)} ` +
        `No compatible standalone dashboard is available (${previous.reason}). ` +
        "Lean mode will not start a hot compiler. Free memory and rerun, or use desktop:dev:hot explicitly.\n",
      );
      process.exit(2);
    }
    admitted = false;
    process.stderr.write(
      `[desktop] ${error instanceof Error ? error.message : String(error)} ` +
      `Reusing the last complete standalone dashboard${previous.builtAt ? ` from ${previous.builtAt}` : ""}; ` +
      "recent dashboard source changes will not appear until a rebuild has enough headroom.\n",
    );
    refreshStandaloneDashboardAssets(repoRoot);
  }
  if (admitted) {
    const buildStatus = await runDashboardBuild();
    if (buildStatus !== 0) process.exit(buildStatus);
  }
}

releaseDashboardBuildLease(repoRoot, dashboardLease.record);

const npmCli = process.env.npm_execpath?.trim();
if (!npmCli) {
  process.stderr.write("[desktop] npm did not provide npm_execpath; cannot launch the desktop supervisor.\n");
  process.exit(1);
}
// Node 24 on Windows rejects direct `.cmd` execution with `shell:false` as
// EINVAL. Invoke npm's JavaScript entry through the current Node executable so
// the child remains shell-free, hidden, and owned by this exact process tree.
const child = spawn(process.execPath, [
  npmCli,
  "--prefix",
  "desktop",
  "run",
  "dev",
  "--",
  "--breadboard-internal-lean-dashboard",
], {
  cwd: repoRoot,
  stdio: "inherit",
  shell: false,
  env: {
    ...process.env,
    BREADBOARD_DESKTOP_DASHBOARD_MODE: "standalone",
  },
});
child.once("error", (error) => {
  process.stderr.write(`[desktop] Fast mode could not start: ${error.message}\n`);
  process.exitCode = 1;
});
child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
