import path from "node:path";
import { createRequire } from "node:module";

import {
  loadDashboardEnv,
  loadRootEnv,
} from "./scripts/load-root-env.mjs";

const repoRoot = path.resolve(import.meta.dirname);
loadRootEnv(repoRoot);
loadDashboardEnv(repoRoot);

const require = createRequire(import.meta.url);
const { RuntimeProcess } = require("./desktop/dist/main/runtime-process.js");

const appData = process.env.APPDATA?.trim();
if (!appData) throw new Error("APPDATA is required to launch Runtime V2.");

const dataRoot = path.join(appData, "breadboard-desktop", "Data");
const runtimeOptions = {
  binDir: path.join(repoRoot, "desktop", "resources", "bin"),
  bootstrap: {
    mode: "lean",
    appRoot: repoRoot,
    runtimeRoot: path.join(repoRoot, "desktop", "build-resources"),
    dataRoot,
    configRoot: path.join(dataRoot, "config"),
  },
  startupTimeoutMs: 120_000,
  onLog: (source, line) => {
    process.stderr.write(`[runtime:${source}] ${line}\n`);
  },
};

let stopping = false;
let activeRuntime = null;
let resolveShutdown;
const shutdownRequested = new Promise((resolve) => {
  resolveShutdown = resolve;
});

function requestShutdown() {
  if (stopping) return;
  stopping = true;
  resolveShutdown();
}

process.once("SIGINT", requestShutdown);
process.once("SIGTERM", requestShutdown);

let restartAttempt = 0;
while (!stopping) {
  let resolveUnexpectedExit;
  const unexpectedExit = new Promise((resolve) => {
    resolveUnexpectedExit = resolve;
  });
  const runtime = new RuntimeProcess({
    ...runtimeOptions,
    onUnexpectedExit: (exit) => resolveUnexpectedExit(exit),
  });
  activeRuntime = runtime;
  try {
    const ready = await runtime.start();
    restartAttempt = 0;
    process.stdout.write(
      `${JSON.stringify({
        event: "runtime-ready",
        runtimePid: ready.runtimePid,
        controlBaseUrl: ready.controlBaseUrl,
        controlToken: ready.controlToken,
        dashboardUrl: ready.dashboardUrl,
      })}\n`,
    );
    const outcome = await Promise.race([
      unexpectedExit.then((exit) => ({ type: "unexpected-exit", exit })),
      shutdownRequested.then(() => ({ type: "shutdown" })),
    ]);
    if (outcome.type === "shutdown") {
      await runtime.stop();
      break;
    }
    process.stderr.write(
      `[runtime] unexpected exit; restarting Runtime V2: ${JSON.stringify(outcome.exit)}\n`,
    );
  } catch (error) {
    if (stopping) break;
    process.stderr.write(
      `[runtime] startup failed; retrying: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  } finally {
    if (activeRuntime === runtime) activeRuntime = null;
  }

  restartAttempt += 1;
  const delayMs = Math.min(30_000, 1_000 * 2 ** Math.min(restartAttempt - 1, 5));
  await Promise.race([
    new Promise((resolve) => setTimeout(resolve, delayMs)),
    shutdownRequested,
  ]);
}

if (activeRuntime && activeRuntime.state === "ready") {
  await activeRuntime.stop();
}
