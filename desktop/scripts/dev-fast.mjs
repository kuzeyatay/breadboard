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
  try {
    assertWindowsCommitHeadroom({ operation: "lean dashboard build", estimateMb: 6_144 });
  } catch (error) {
    process.stderr.write(`[desktop] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  }
  const build = spawnSync(
    process.execPath,
    [path.join(repoRoot, "desktop", "scripts", "build-dashboard.mjs")],
    { cwd: repoRoot, stdio: "inherit", env: process.env },
  );
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const child = spawn(npm, ["--prefix", "desktop", "run", "dev"], {
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
