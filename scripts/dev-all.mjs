#!/usr/bin/env node
// Ordered full-stack launcher: provider -> harness -> Quartz -> dashboard.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRootEnv } from "./load-root-env.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadRootEnv(repoRoot);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const configuredMode = process.env.OPENHARNESS_MODE?.trim().toLowerCase();
const explicitlyDisabled = /^(0|false|no|off)$/i.test(process.env.OPENHARNESS_ENABLED?.trim() ?? "");
const mode = configuredMode === "preferred" || configuredMode === "legacy" || configuredMode === "required"
  ? configuredMode
  : explicitlyDisabled ? "legacy" : "required";
const password = process.env.OPENHARNESS_PASSWORD || "breadboard-local-dev";
const username = process.env.OPENHARNESS_USERNAME || "breadboard";
const runtimeEnv = {
  ...process.env,
  OPENHARNESS_ENABLED: process.env.OPENHARNESS_ENABLED || "true",
  OPENHARNESS_MODE: mode,
  OPENHARNESS_BASE_URL: process.env.OPENHARNESS_BASE_URL || "http://127.0.0.1:4096",
  OPENHARNESS_PASSWORD: password,
  OPENHARNESS_USERNAME: username,
  CHATMOCK_BASE_URL: process.env.CHATMOCK_BASE_URL || "http://127.0.0.1:8765/v1",
  CHATMOCK_API_KEY: process.env.CHATMOCK_API_KEY || process.env.OPENAI_API_KEY || "local",
  CHATMOCK_MODEL: process.env.CHATMOCK_MODEL || "gpt-5.6-sol",
  BREADBOARD_DASHBOARD_URL: process.env.BREADBOARD_DASHBOARD_URL || "http://localhost:3000",
};
const children = [];

function prefix(name, chunk) {
  for (const line of chunk.toString().split(/\r?\n/)) {
    if (line.trim()) process.stdout.write(`[${name}] ${line}\n`);
  }
}

function startService(name, command, args) {
  const child = spawn(command, args, { cwd: repoRoot, env: runtimeEnv });
  child.stdout.on("data", (chunk) => prefix(name, chunk));
  child.stderr.on("data", (chunk) => prefix(name, chunk));
  child.on("error", (error) => prefix(name, `failed to start: ${error.message}`));
  children.push(child);
  return child;
}

async function waitFor(url, options = {}, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(2_000) });
      if (response.ok) return response;
    } catch {
      // Service is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function authHeaders() {
  return { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` };
}

async function main() {
  startService("chatmock", process.execPath, [path.join(repoRoot, "scripts", "start-chatmock.mjs")]);
  await waitFor("http://127.0.0.1:8765/health");
  process.stdout.write("[stack] ChatMock healthy\n");

  if (mode !== "legacy") {
    startService("openharness", process.execPath, [path.join(repoRoot, "scripts", "start-openharness.mjs")]);
    try {
      await waitFor("http://127.0.0.1:4096/global/health", { headers: authHeaders() });
      const providers = await waitFor("http://127.0.0.1:4096/config/providers", { headers: authHeaders() });
      if (!(await providers.text()).includes("chatmock")) {
        throw new Error("OpenHarness did not load the ChatMock provider");
      }
      process.stdout.write("[stack] OpenHarness healthy; ChatMock provider available\n");
    } catch (error) {
      if (mode === "required") throw error;
      process.stderr.write(
        `[stack] OpenHarness unavailable in preferred mode; dashboard will expose audited fallback state: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }

  // Scriberr (video transcription) is optional: start it when enabled, but
  // never block the rest of the stack on it — the dashboard reports a specific
  // "Scriberr unavailable" state until it becomes healthy.
  const scriberrAutostart = !/^(0|false|no|off)$/i.test(process.env.SCRIBERR_AUTOSTART?.trim() ?? "");
  const scriberrPort = /^\d+$/.test(process.env.SCRIBERR_PORT ?? "") ? process.env.SCRIBERR_PORT : "8091";
  const scriberrBaseUrl = (process.env.SCRIBERR_BASE_URL || `http://127.0.0.1:${scriberrPort}`).replace(/\/+$/, "");
  if (scriberrAutostart) {
    startService("scriberr", process.execPath, [path.join(repoRoot, "scripts", "start-scriberr.mjs")]);
    try {
      await waitFor(`${scriberrBaseUrl}/health`, {}, 30_000);
      process.stdout.write("[stack] Scriberr healthy\n");
    } catch {
      process.stderr.write(
        "[stack] Scriberr not reachable yet; video transcription stays unavailable until it is up.\n",
      );
    }
  }

  startService("quartz", process.execPath, [path.join(repoRoot, "scripts", "start-quartz.mjs")]);
  startService("dashboard", npm, ["--prefix", path.join(repoRoot, "dashboard"), "run", "dev"]);
  process.stdout.write(`[stack] Runtime mode: ${mode}; dashboard OpenHarness feature: ${mode === "legacy" ? "disabled" : "enabled"}\n`);
}

function shutdown() {
  for (const child of children) child.kill("SIGTERM");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
main().catch((error) => {
  process.stderr.write(`[stack] ${error instanceof Error ? error.message : String(error)}\n`);
  shutdown();
});
