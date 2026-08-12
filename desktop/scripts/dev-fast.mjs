#!/usr/bin/env node

// Build the production-like Next standalone server once, copy the static files
// it intentionally leaves outside the trace, then launch the normal desktop
// supervisor with that server instead of an on-demand compiler.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dashboard = path.join(repoRoot, "dashboard");
const build = spawnSync(
  process.execPath,
  [path.join(repoRoot, "desktop", "scripts", "build-dashboard.mjs")],
  { cwd: repoRoot, stdio: "inherit", env: process.env },
);
if (build.status !== 0) process.exit(build.status ?? 1);

const standaloneDashboard = path.join(
  dashboard,
  ".next-desktop",
  "standalone",
  "dashboard",
);
fs.cpSync(
  path.join(dashboard, ".next-desktop", "static"),
  path.join(standaloneDashboard, ".next-desktop", "static"),
  { recursive: true, force: true },
);
if (fs.existsSync(path.join(dashboard, "public"))) {
  fs.cpSync(
    path.join(dashboard, "public"),
    path.join(standaloneDashboard, "public"),
    { recursive: true, force: true },
  );
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
