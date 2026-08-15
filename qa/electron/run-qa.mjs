#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const forwarded = [];
const env = { ...process.env };
let skipDesktopBuild = false;

for (const argument of process.argv.slice(2)) {
  if (argument === "--headed") {
    env.BREADBOARD_QA_HEADED = "1";
  } else if (argument === "--trace") {
    env.BREADBOARD_QA_TRACE = "1";
  } else if (argument === "--preserve-runtime") {
    env.BREADBOARD_QA_PRESERVE_RUNTIME = "1";
  } else if (argument === "--skip-desktop-build") {
    skipDesktopBuild = true;
  } else {
    forwarded.push(argument);
  }
}

if (!skipDesktopBuild) {
  const npmCliCandidates = [
    process.env.npm_execpath,
    path.resolve(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  ].filter((candidate) => typeof candidate === "string" && fs.existsSync(candidate));
  const npmCli = npmCliCandidates[0];
  if (!npmCli) {
    throw new Error("Could not resolve npm-cli.js for the desktop build");
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
