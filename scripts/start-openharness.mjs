#!/usr/bin/env node
// Cross-platform launcher for the OpenHarness agent runtime.
//
// OpenHarness is Breadboard's interactive agent harness (a renamed OpenCode
// fork). It binds to 127.0.0.1:4096 and is protected with a server password.
// This launcher is focused on OpenHarness only; it never runs unauthenticated on
// a non-loopback interface.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRootEnv } from "./load-root-env.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadRootEnv(repoRoot);
const openharnessDir = path.join(repoRoot, "openharness");
const configDir = path.join(repoRoot, "openharness-config");
const port = process.env.OPENHARNESS_PORT || "4096";

if (!existsSync(openharnessDir)) {
  console.error(`OpenHarness directory not found at ${openharnessDir}`);
  process.exit(1);
}

const password = process.env.OPENHARNESS_PASSWORD || "breadboard-local-dev";
const env = {
  ...process.env,
  OPENCODE_SERVER_PASSWORD: password,
  OPENCODE_SERVER_USERNAME: process.env.OPENHARNESS_USERNAME || "breadboard",
  OPENCODE_CONFIG_DIR: configDir,
  BREADBOARD_INTERNAL_URL: process.env.BREADBOARD_INTERNAL_URL || "http://127.0.0.1:3000",
  OPENHARNESS_TOOL_SECRET: process.env.OPENHARNESS_TOOL_SECRET || password,
  CHATMOCK_BASE_URL: process.env.CHATMOCK_BASE_URL || "http://127.0.0.1:8765/v1",
  CHATMOCK_API_KEY: process.env.CHATMOCK_API_KEY || process.env.OPENAI_API_KEY || "local",
  CHATMOCK_MODEL: process.env.CHATMOCK_MODEL || "gpt-5.6-sol",
  OPENCODE_ENABLE_EXA: process.env.OPENCODE_ENABLE_EXA || "1",
  OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS:
    process.env.OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS || "true",
};

// Reuse an already-running instance instead of letting Bun fail to bind the
// port and die with an opaque ServeError (mirrors the Scriberr launcher).
async function probeExistingServer() {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/global/health`, {
      headers: {
        Authorization: `Basic ${Buffer.from(
          `${env.OPENCODE_SERVER_USERNAME}:${password}`,
        ).toString("base64")}`,
      },
      signal: AbortSignal.timeout(2_500),
    });
    return response.status;
  } catch {
    return null; // Nothing answering HTTP — the port is presumably free.
  }
}

const existingStatus = await probeExistingServer();
if (existingStatus === 200) {
  console.log(
    `[openharness] Already running and healthy on 127.0.0.1:${port} — reusing it.`,
  );
  process.exit(0);
}
if (existingStatus !== null) {
  console.error(
    `[openharness] Port ${port} is already in use (the existing server answered HTTP ${existingStatus}).`,
  );
  console.error(
    "[openharness] Stop the stale or differently-configured server (or another service on this port), or set OPENHARNESS_PORT to a free port, then retry.",
  );
  process.exit(1);
}

const bunCmd = process.platform === "win32" ? "bun.exe" : "bun";
const child = spawn(
  bunCmd,
  ["run", "packages/opencode/src/index.ts", "serve", "--port", port, "--hostname", "127.0.0.1"],
  { cwd: openharnessDir, env, stdio: "inherit" },
);

child.on("error", (error) => {
  if (error.code === "ENOENT") {
    console.error("Bun is not installed. OpenHarness requires Bun (bun@1.3.14+).");
    console.error("Install from https://bun.sh, then run `bun install` in ./openharness.");
    console.error("Use OPENHARNESS_MODE=legacy only when intentional prior behavior is required.");
  } else {
    console.error(error.message);
  }
  process.exit(1);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code) => process.exit(code ?? 0));
