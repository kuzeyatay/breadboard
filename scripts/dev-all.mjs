#!/usr/bin/env node
// Cross-platform "start everything" dev orchestrator.
//
// Launches ChatMock (8765), Quartz (8081), OpenHarness (4096), and the dashboard
// (3000) together, prefixing each service's output. Preserves the existing
// per-service commands; OpenHarness is skipped gracefully if Bun is missing so
// the rest of the stack still comes up (OPENHARNESS_ENABLED can be false).

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

const services = [
  { name: "chatmock", cmd: process.execPath, args: [path.join(repoRoot, "scripts", "start-chatmock.mjs")] },
  { name: "quartz", cmd: process.execPath, args: [path.join(repoRoot, "scripts", "start-quartz.mjs")] },
  { name: "openharness", cmd: process.execPath, args: [path.join(repoRoot, "scripts", "start-openharness.mjs")] },
  { name: "dashboard", cmd: npm, args: ["--prefix", path.join(repoRoot, "dashboard"), "run", "dev"] },
];

const children = [];

function prefix(name, chunk) {
  const text = chunk.toString();
  for (const line of text.split(/\r?\n/)) {
    if (line.trim()) process.stdout.write(`[${name}] ${line}\n`);
  }
}

for (const service of services) {
  const child = spawn(service.cmd, service.args, { cwd: repoRoot, env: process.env });
  child.stdout.on("data", (chunk) => prefix(service.name, chunk));
  child.stderr.on("data", (chunk) => prefix(service.name, chunk));
  child.on("error", (error) => process.stdout.write(`[${service.name}] failed to start: ${error.message}\n`));
  children.push(child);
}

function shutdown() {
  for (const child of children) child.kill("SIGTERM");
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
