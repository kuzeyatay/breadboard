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

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
};

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
    console.error("Breadboard runs without OpenHarness when OPENHARNESS_ENABLED=false.");
  } else {
    console.error(error.message);
  }
  process.exit(1);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code) => process.exit(code ?? 0));
