#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertWindowsCommitHeadroom } from "../../desktop/scripts/commit-preflight.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const forwarded = [];
const env = { ...process.env };
let skipDesktopBuild = false;
let dashboardMode = process.env.BREADBOARD_QA_DASHBOARD_MODE === "hot"
  ? "hot"
  : "standalone";

for (const argument of process.argv.slice(2)) {
  if (argument === "--headed") {
    env.BREADBOARD_QA_HEADED = "1";
  } else if (argument === "--trace") {
    env.BREADBOARD_QA_TRACE = "1";
  } else if (argument === "--no-trace") {
    env.BREADBOARD_QA_NO_TRACE = "1";
  } else if (argument === "--preserve-runtime") {
    env.BREADBOARD_QA_PRESERVE_RUNTIME = "1";
  } else if (argument === "--skip-desktop-build") {
    skipDesktopBuild = true;
  } else if (argument === "--hot-dashboard") {
    dashboardMode = "hot";
  } else {
    forwarded.push(argument);
  }
}
env.BREADBOARD_QA_DASHBOARD_MODE = dashboardMode;

if (!skipDesktopBuild) {
  const npmCliCandidates = [
    process.env.npm_execpath,
    path.resolve(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  ].filter((candidate) => typeof candidate === "string" && fs.existsSync(candidate));
  const npmCli = npmCliCandidates[0];
  if (!npmCli) {
    throw new Error("Could not resolve npm-cli.js for the desktop build");
  }
  if (dashboardMode === "standalone") {
    try {
      assertWindowsCommitHeadroom({ operation: "standalone Electron QA build", estimateMb: 6_144 });
    } catch (error) {
      process.stderr.write(`[qa] ${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(2);
    }
    const dashboardBuild = spawnSync(
      process.execPath,
      [path.join(repoRoot, "desktop", "scripts", "build-dashboard.mjs")],
      { cwd: repoRoot, env: process.env, stdio: "inherit", shell: false },
    );
    if (dashboardBuild.error) throw dashboardBuild.error;
    if (dashboardBuild.status !== 0) process.exit(dashboardBuild.status ?? 1);
  }
  const build = spawnSync(process.execPath, [npmCli, "--prefix", "desktop", "run", "build"], {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
    shell: false,
  });
  if (build.error) throw build.error;
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const playwrightCli = path.join(repoRoot, "node_modules", "@playwright", "test", "cli.js");
const run = spawnSync(
  process.execPath,
  [
    playwrightCli,
    "test",
    "--config",
    path.join(repoRoot, "qa", "electron", "playwright.config.ts"),
    ...forwarded,
  ],
  {
    cwd: repoRoot,
    env,
    stdio: "inherit",
    shell: false,
  },
);
if (run.error) throw run.error;
process.exit(run.status ?? 1);
