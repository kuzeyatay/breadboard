import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { RUNTIME_AGENT_PROFILES } from "../src/lib/hermes/capability-combinations.ts";

const dashboardRoot = path.resolve(import.meta.dirname, "..");
const directories = {
  "parametric-cad": "cad",
  "hardware-blueprint": "hardware",
  formsmith: "shaper",
  "trading-agent": "tradingagents",
  "agent-tars": "ui-tars",
};
const managers = {
  "deep-research": "runtime-worker-run-manager.ts",
  "agent-tars": "runtime-worker-run-manager.ts",
  "meeting-notes": "runtime-worker-run-manager.ts",
  "parametric-cad": "runtime-worker-adapter.ts",
  "music-producer": "worker.ts",
};

// Import each real execution closure with the same loader as a Runtime worker.
// Mocking the managers or bundling them with esbuild misses Node-only failures
// such as value imports of erased TS types. No agent/model run is submitted.
for (const agent of RUNTIME_AGENT_PROFILES) {
  test(`${agent.name} execution modules load in a fresh Runtime worker`, { timeout: 30_000 }, async (t) => {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-agent-startup-"));
    t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
    const manager = path.join(dashboardRoot, "src", "lib", directories[agent.id] ?? agent.id,
      managers[agent.id] ?? "run-manager.ts");
    assert.ok(fs.existsSync(manager), `No execution module for ${agent.id}`);
    const child = spawn(process.execPath, [
      "--experimental-strip-types", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      "--import", pathToFileURL(path.join(dashboardRoot, "scripts", "learn-worker-import-hook.mjs")).href,
      "--input-type=module", "-e",
      `await import(${JSON.stringify(pathToFileURL(manager).href)}); process.exit(0);`,
    ], {
      cwd: dashboardRoot,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        NODE_ENV: "test",
        BREADBOARD_DATA_DIR: dataRoot,
        BREADBOARD_REPO_ROOT: path.dirname(dashboardRoot),
        BREADBOARD_DEVELOPMENT_DASHBOARD_DIR: dashboardRoot,
        BREADBOARD_LEARN_SOURCE_ROOT: path.join(dashboardRoot, "src"),
        QUARTZ_CONTENT_PATH: path.join(dataRoot, "quartz", "content"),
      },
    });
    const timer = setTimeout(() => child.kill(), 25_000);
    t.after(() => { clearTimeout(timer); if (child.exitCode === null) child.kill(); });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-16_384); });
    child.stdout.resume();
    const exit = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    clearTimeout(timer);
    assert.equal(exit.code, 0, `${agent.id}: ${stderr || exit.signal}`);
  });
}
