#!/usr/bin/env node
// Focused launcher for the Recall capture engine (the screenpipe recorder).
//
// This is the dev-stack twin of the desktop supervisor's `screenpipe` service.
// It deliberately refuses to record by default: capture is opt-in per user in
// Settings → Recall, and this script only starts the engine when RECALL_CAPTURE
// says so. Without that, it exits 0 having started nothing — the same shape as
// scripts/start-gbrain.mjs when GBrain is disabled, so `dev-all` stays quiet
// rather than silently recording a developer's screen.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRootEnv } from "./load-root-env.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadRootEnv(repoRoot);

const enabled = /^(1|true|yes|on)$/i.test((process.env.RECALL_ENABLED ?? "true").trim());
const capture = /^(1|true|yes|on)$/i.test((process.env.RECALL_CAPTURE ?? "").trim());

if (!enabled) {
  process.stdout.write("[recall] RECALL_ENABLED is off; capture engine not started.\n");
  process.exit(0);
}
if (!capture) {
  process.stdout.write(
    "[recall] RECALL_CAPTURE is not set; nothing is recorded. " +
      "Start capture from Settings → Recall, or set RECALL_CAPTURE=true to run it here.\n",
  );
  process.exit(0);
}

const home = (process.env.RECALL_HOME ?? "").trim() || path.join(os.homedir(), ".breadboard", "recall");
const dataDir = (process.env.RECALL_DATA_DIR ?? "").trim() || path.join(home, "data");

const PLATFORM_PACKAGES = {
  "darwin-arm64": "@screenpipe/cli-darwin-arm64",
  "darwin-x64": "@screenpipe/cli-darwin-x64",
  "linux-x64": "@screenpipe/cli-linux-x64",
  "win32-x64": "@screenpipe/cli-win32-x64",
};

const platformPackage = PLATFORM_PACKAGES[`${process.platform}-${process.arch}`];
if (!platformPackage) {
  process.stderr.write(
    `[recall] no capture engine is published for ${process.platform}-${process.arch}.\n`,
  );
  process.exit(0);
}

const binary = path.join(
  home,
  "cli",
  "node_modules",
  ...platformPackage.split("/"),
  "bin",
  process.platform === "win32" ? "screenpipe.exe" : "screenpipe",
);

if (!fs.existsSync(binary)) {
  process.stderr.write(
    "[recall] the capture engine is not installed. Install it from Settings → Recall.\n",
  );
  process.exit(0);
}

function port() {
  const raw = (process.env.RECALL_BASE_URL ?? "").trim();
  if (!raw) return "3030";
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`).port || "3030";
  } catch {
    return "3030";
  }
}

// Exclusions come from the same list the settings tab writes, passed here as a
// JSON array so the dev launcher honours the user's privacy choices too.
function excludedWindows() {
  const raw = (process.env.RECALL_EXCLUDED_WINDOWS ?? "").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string" && item.trim()) : [];
  } catch {
    return raw
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
}

const args = ["record", "--port", port(), "--data-dir", dataDir];
if (/^(1|true|yes|on)$/i.test((process.env.RECALL_DISABLE_AUDIO ?? "").trim())) {
  args.push("--disable-audio");
}
for (const window of excludedWindows()) args.push("--ignored-windows", window);

fs.mkdirSync(dataDir, { recursive: true });

const child = spawn(binary, args, {
  cwd: home,
  env: { ...process.env, SCREENPIPE_DISTRIBUTION: "breadboard" },
  stdio: "inherit",
});
child.on("error", (error) => {
  process.stderr.write(`[recall] failed to spawn the capture engine: ${error.message}\n`);
  process.exit(0);
});
child.on("exit", (code) => process.exit(code ?? 0));

function shutdown() {
  child.kill("SIGTERM");
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
