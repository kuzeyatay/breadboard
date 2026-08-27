import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (name) =>
  fs.readFileSync(path.join(dashboardRoot, "src", "lib", name, "run-manager.ts"), "utf8");

test("retrieval run cleanup timers do not keep the server alive", () => {
  const manager = source("agent-reach");
  assert.match(manager, /const retention = setTimeout\(\(\) => \{/);
  assert.match(manager, /runs\.delete\(run\.runId\);/);
  assert.match(manager, /retention\.unref\?\.\(\);/);
});

test("Agent Browser relies on the durable Runtime store instead of a Next retention timer", () => {
  const manager = source("agent-browser");
  assert.doesNotMatch(manager, /const retention = setTimeout\(\(\) => \{/);
  assert.match(manager, /store\.markRuntimeRunTerminal\(/);
  assert.match(manager, /readRuntimeJobOutput\(/);
});

test("heavy agent run registries evict terminal runs after a bounded replay window", () => {
  for (const name of [
    "codex",
    "opencode",
    "ruflo",
  ]) {
    const manager = source(name);
    assert.match(manager, /const TERMINAL_RETENTION_MS = 30 \* 60 \* 1000;/, name);
    assert.match(manager, /setTimeout\(\(\) =>/, name);
    assert.match(manager, /runs\.delete\(/, name);
    assert.match(manager, /timer\.unref\?\.\(\);/, name);
    assert.ok(
      (manager.match(/scheduleCleanup\(/g) ?? []).length >= 2,
      `${name} must invoke its cleanup scheduler from the terminal path`,
    );
  }
});

test("outer-agent state is disposable-worker-local instead of retained by Next", () => {
  const manifests = JSON.parse(
    fs.readFileSync(
      path.join(dashboardRoot, "..", "desktop", "runtime-v2", "manifests", "workers.json"),
      "utf8",
    ),
  ).workers;
  for (const name of ["hyperframes", "openmontage", "resource2skill"]) {
    const facade = fs.readFileSync(
      path.join(dashboardRoot, "src", "lib", name, "runtime-run-manager.ts"),
      "utf8",
    );
    const worker = source(name);
    const manifest = manifests.find((entry) => entry.kind === `outer-${name}-node`);
    assert.match(facade, /startOuterAgentRun/, name);
    assert.match(facade, new RegExp(`readOuterAgentRunView\\("${name}"`), name);
    assert.match(facade, new RegExp(`abortOuterAgentRun\\("${name}"`), name);
    assert.match(worker, /startRuntimeWorkerRun/, name);
    assert.equal(manifest.exitAfterJob, true, name);
  }
});

test("terminal compaction preserves the minimal descriptors used by artifact routes", () => {
  const openwork = fs.readFileSync(
    path.join(dashboardRoot, "src", "lib", "openwork", "runtime-run-manager.ts"),
    "utf8",
  );
  assert.match(openwork, /readOuterAgentRunView\("openwork"/);
  assert.match(openwork, /inspectOuterAgentRun\("openwork"/);
  assert.match(openwork, /resolveOpenworkRuntimeArtifact/);
  assert.match(openwork, /fs\.realpathSync\.native/);

  const openplanter = fs.readFileSync(
    path.join(dashboardRoot, "src", "lib", "openplanter", "runtime-run-manager.ts"),
    "utf8",
  );
  assert.match(openplanter, /readOuterAgentRunView\("openplanter"/);
  assert.match(openplanter, /inspectOuterAgentRun\("openplanter"/);
  assert.match(openplanter, /payload\.sessionId/);
  assert.match(openplanter, /fs\.realpathSync\.native/);
});
