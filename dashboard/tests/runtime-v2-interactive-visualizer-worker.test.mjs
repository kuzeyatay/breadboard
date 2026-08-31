import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  loadRuntimeV2InteractiveVisualizerLaunch,
  parseRuntimeV2InteractiveVisualizerStopRecord,
} from "../scripts/runtime-v2-interactive-visualizer-worker.mjs";
import {
  appendBoundedBrowserOutput,
  extendOwnedLineage,
  executeInteractiveVisualizerPublication,
  findInteractiveVisualizerBrowser,
  hasRenderedInteractiveVisualizerWebglFallback,
  isCurrentOwnedWindowsRoot,
  runInteractiveVisualizerBrowserProcess,
} from "../scripts/runtime-v2-interactive-visualizer-executor.mjs";
import * as custom from
  "../src/lib/hermes/interactive-visualizer-custom.ts";
import * as runtime from
  "../src/lib/hermes/interactive-visualizer-runtime.ts";
import * as validator from
  "../src/lib/hermes/interactive-visualizer-validator.ts";
import { validateInteractiveVisualizerRuntimeResult } from
  "../src/lib/hermes/interactive-visualizer-browser.ts";

const dashboardRoot = path.resolve(import.meta.dirname, "..");

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

function launchFixture() {
  const dataRoot = fs.mkdtempSync(path.join(
    os.tmpdir(),
    "breadboard-visualizer-worker-",
  ));
  const identity = {
    jobId: "job_visualizer_test",
    attempt: 1,
    workerInstanceId: "worker_visualizer_test",
  };
  const jobRoot = `runtime/jobs/${identity.jobId}`;
  const attemptRoot =
    `${jobRoot}/attempts/${identity.attempt}/${identity.workerInstanceId}`;
  const launchDirectory = path.join(dataRoot, ...attemptRoot.split("/"));
  const workspacePath = `${attemptRoot}/workspace`;
  const blobId = "blob_visualizer_source";
  const blobRelativePath = `${jobRoot}/inputs/${blobId}/payload`;
  const source = Buffer.from(JSON.stringify({
    protocolVersion: 1,
    plan: { schemaVersion: 1 },
    package: { schemaVersion: 1 },
  }), "utf8");
  fs.mkdirSync(path.join(dataRoot, ...workspacePath.split("/")), {
    recursive: true,
  });
  const blobPath = path.join(dataRoot, ...blobRelativePath.split("/"));
  fs.mkdirSync(path.dirname(blobPath), { recursive: true });
  fs.writeFileSync(blobPath, source);
  writeJson(path.join(dataRoot, ...jobRoot.split("/"), "input.json"), {
    protocolVersion: 1,
    operation: "compile-test",
    runtimeSessionId: 77,
  });
  const manifest = {
    protocolVersion: 1,
    identity,
    executionScope: {
      userId: 11,
      gardenId: "garden-one",
      conversationId: "conversation-one",
    },
    inputManifestPath: `${jobRoot}/input.json`,
    inputBlobs: [{
      blobId,
      relativePath: blobRelativePath,
      sizeBytes: source.byteLength,
      sha256: createHash("sha256").update(source).digest("hex"),
      displayName: "interactive-visualizer-source.json",
      mediaType: "application/vnd.breadboard.interactive-visualizer+json",
    }],
    workspacePath,
    checkpointPath: `${jobRoot}/checkpoint.json`,
    resultPath: `${jobRoot}/result.json`,
  };
  writeJson(path.join(launchDirectory, "start.json"), manifest);
  return { dataRoot, launchDirectory, manifest };
}

test("interactive visualizer launch accepts one exact fenced source blob", () => {
  const fixture = launchFixture();
  try {
    const launch = loadRuntimeV2InteractiveVisualizerLaunch(
      ["start.json"],
      fixture.launchDirectory,
    );
    assert.equal(launch.identity.jobId, "job_visualizer_test");
    assert.equal(launch.executionScope.conversationId, "conversation-one");
    assert.equal(launch.inputBlob.displayName, "interactive-visualizer-source.json");
    assert.equal(path.basename(launch.workspacePath), "workspace");
  } finally {
    fs.rmSync(fixture.dataRoot, { recursive: true, force: true });
  }
});

test("interactive visualizer launch rejects unfenced scope, paths, and blob counts", () => {
  for (const mutate of [
    (manifest) => { manifest.executionScope.conversationId = null; },
    (manifest) => { manifest.workspacePath = "runtime/jobs/other/workspace"; },
    (manifest) => { manifest.inputBlobs = []; },
    (manifest) => { manifest.inputBlobs[0].relativePath = "../outside"; },
  ]) {
    const fixture = launchFixture();
    try {
      mutate(fixture.manifest);
      writeJson(path.join(fixture.launchDirectory, "start.json"), fixture.manifest);
      assert.throws(
        () => loadRuntimeV2InteractiveVisualizerLaunch(
          ["start.json"],
          fixture.launchDirectory,
        ),
        /visualizer|scope|blob|identity-bound/i,
      );
    } finally {
      fs.rmSync(fixture.dataRoot, { recursive: true, force: true });
    }
  }
});

test("interactive visualizer cancellation accepts only the bounded graceful stop", () => {
  assert.deepEqual(
    parseRuntimeV2InteractiveVisualizerStopRecord(
      '{"type":"stop","force":false}\n',
    ),
    { type: "stop", force: false },
  );
  for (const line of [
    '{"type":"stop","force":true}\n',
    '{"type":"stop","force":false,"extra":1}\n',
    '{"type":"stop","force":false}\n{}\n',
    "not-json\n",
  ]) {
    assert.throws(
      () => parseRuntimeV2InteractiveVisualizerStopRecord(line),
      /stop record/i,
    );
  }
});

test("visualizer executor validates and rejects bad source before opening Chromium", async () => {
  const outputDir = fs.mkdtempSync(path.join(
    os.tmpdir(),
    "breadboard-visualizer-executor-",
  ));
  try {
    const result = await executeInteractiveVisualizerPublication({
      plan: { schemaVersion: 1 },
      packageValue: { schemaVersion: 1 },
      outputDir,
      modules: { custom, runtime, validator },
      timeoutMs: 5_000,
    });
    assert.equal(result.status, "validation-failed");
    assert.equal(result.validation.valid, false);
    assert.equal(result.outputPath, null);
    assert.equal(fs.existsSync(path.join(outputDir, "candidate.html")), false);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("Next visualizer path has no process owner and the worker owns one attached tree", () => {
  const client = fs.readFileSync(path.join(
    dashboardRoot,
    "src/lib/hermes/interactive-visualizer-browser.ts",
  ), "utf8");
  const service = fs.readFileSync(path.join(
    dashboardRoot,
    "src/lib/hermes/interactive-visualizer-service.ts",
  ), "utf8");
  const executor = fs.readFileSync(path.join(
    dashboardRoot,
    "scripts/runtime-v2-interactive-visualizer-executor.mjs",
  ), "utf8");
  const worker = fs.readFileSync(path.join(
    dashboardRoot,
    "scripts/runtime-v2-interactive-visualizer-worker.mjs",
  ), "utf8");
  assert.doesNotMatch(client, /node:child_process|\bspawn\(|taskkill|process\.kill/);
  assert.doesNotMatch(service, /node:child_process|\bspawn\(|taskkill|process\.kill/);
  assert.match(service, /runInteractiveVisualizerPublicationViaRuntime/);
  assert.match(executor, /node:child_process/);
  assert.match(executor, /taskkill\.exe/);
  assert.match(executor, /\["\/PID", String\(pid\), "\/T", "\/F"\]/);
  assert.match(executor, /detached:\s*platform !== "win32"/);
  assert.match(executor, /Rust's kill-on-close Job Object remains the production backstop/);
  assert.match(worker, /events\.complete\(launch\.resultRelativePath\)/);
  assert.match(worker, /cancellationAcknowledged/);
  assert.match(worker, /inputBlobs\.length !== 1/);
  assert.match(client, /CustomInteractiveVisualizerManifest/);
  assert.match(
    client,
    /value\.schemaVersion === 1 \|\| value\.schemaVersion === 2/,
  );
});

function durableReadyResult(schemaVersion) {
  const identity = {
    jobId: "job_gate_shape",
    attempt: 1,
    workerInstanceId: "worker_gate_shape",
  };
  const digest = "a".repeat(64);
  return {
    job: { ...identity, lastWorkerSequence: 13 },
    content: {
      protocolVersion: 1,
      identity,
      completionSequence: 13,
      result: {
        status: "ready",
        validation: {
          valid: true,
          checkedAt: "2026-08-30T10:36:00.000Z",
          astNodeCount: 10,
          sourceBytes: 100,
          imports: [],
          errors: [],
          warnings: [],
        },
        manifest: {
          schemaVersion,
          artifactType: "interactive-visualizer",
          title: "Coulomb Force Lab",
          description: "Two charges and the force between them.",
          accessibilityDescription: "Two labelled charges with force arrows.",
          mode: "2d",
          entry: "index.html",
          runtime: { id: "breadboard-interactive-visualizer", version: "2.0.0" },
        },
        sourceHash: digest,
        tests: {
          passed: true,
          checkedAt: "2026-08-30T10:36:20.000Z",
          viewports: ["375x667 light", "1280x800 dark"],
          checks: [{ name: "offline bundle", passed: true, detail: "ok" }],
          screenshotCreated: true,
        },
        bundleHash: digest,
        outputRelativePath:
          `runtime/jobs/${identity.jobId}/attempts/1/${identity.workerInstanceId}/workspace/interactive-visualizer-output/bundle.html`,
        customPackage: schemaVersion === 2,
      },
    },
  };
}

test("the Next gate accepts the schema-2 manifest the worker writes and names any defect", () => {
  // Regression: the worker browser-tested the Coulomb package as ready with a
  // schemaVersion 2 manifest and the gate rejected it as an "invalid
  // browser-test result" because it only knew schemaVersion 1.
  for (const schemaVersion of [1, 2]) {
    const { job, content } = durableReadyResult(schemaVersion);
    const accepted = validateInteractiveVisualizerRuntimeResult(job, content);
    assert.equal(accepted.status, "ready");
    assert.equal(accepted.manifest.schemaVersion, schemaVersion);
  }
  const foreign = durableReadyResult(2);
  foreign.content.result.manifest.schemaVersion = 3;
  assert.throws(
    () => validateInteractiveVisualizerRuntimeResult(foreign.job, foreign.content),
    /invalid browser-test result: manifest is not a supported visualizer manifest \(schemaVersion 3\)/,
  );
  const contradictory = durableReadyResult(2);
  contradictory.content.result.tests.passed = false;
  assert.throws(
    () => validateInteractiveVisualizerRuntimeResult(contradictory.job, contradictory.content),
    /status ready disagrees with tests\.passed=false/,
  );
  const pathless = durableReadyResult(2);
  pathless.content.result.outputRelativePath = null;
  assert.throws(
    () => validateInteractiveVisualizerRuntimeResult(pathless.job, pathless.content),
    /ready result has no bundle path/,
  );
});

test("historical parent PID reuse cannot admit an unrelated descendant", () => {
  const originalRoot = {
    pid: 4100,
    parentPid: 1,
    creationMs: 1_000,
    name: "node.exe",
    executable: "C:\\Program Files\\nodejs\\node.exe",
  };
  const reusedRoot = { ...originalRoot, creationMs: 9_000 };
  const unrelatedChild = {
    pid: 4101,
    parentPid: reusedRoot.pid,
    creationMs: 9_100,
    name: "unrelated.exe",
    executable: "C:\\unrelated.exe",
  };
  const known = new Map([[originalRoot.pid, originalRoot]]);

  extendOwnedLineage(known, [reusedRoot, unrelatedChild]);

  assert.equal(known.has(unrelatedChild.pid), false);
});

test("root PID reuse is fenced before taskkill", () => {
  const originalRoot = {
    pid: 4150,
    parentPid: 1,
    creationMs: 1_000,
    name: "node.exe",
    executable: "C:\\Program Files\\nodejs\\node.exe",
  };
  const reusedRoot = { ...originalRoot, creationMs: 9_000 };
  assert.equal(
    isCurrentOwnedWindowsRoot(
      originalRoot.pid,
      [originalRoot],
      [reusedRoot],
    ),
    false,
  );
  const executor = fs.readFileSync(path.join(
    dashboardRoot,
    "scripts/runtime-v2-interactive-visualizer-executor.mjs",
  ), "utf8");
  assert.match(
    executor,
    /const rootIdentityConfirmed =[\s\S]*?isCurrentOwnedWindowsRoot\(pid, admittedRows, finalRows\)[\s\S]*?const treeKill = taskkill && rootIdentityConfirmed/u,
  );
});

test("the same root creation identity remains eligible for descendant accounting", () => {
  const root = {
    pid: 4200,
    parentPid: 1,
    creationMs: 2_000,
    name: "node.exe",
    executable: "C:\\Program Files\\nodejs\\node.exe",
  };
  const child = {
    pid: 4201,
    parentPid: root.pid,
    creationMs: 2_100,
    name: "chrome.exe",
    executable: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  };
  const known = new Map([[root.pid, root]]);

  extendOwnedLineage(known, [root, child]);

  assert.equal(known.get(child.pid), child);
  assert.equal(isCurrentOwnedWindowsRoot(root.pid, [root], [root, child]), true);
});

test("close-path cancellation cannot escape before lineage cleanup", () => {
  const executor = fs.readFileSync(path.join(
    dashboardRoot,
    "scripts/runtime-v2-interactive-visualizer-executor.mjs",
  ), "utf8");
  const closeBranch = executor.match(
    /if \(terminal\.kind === "close"\) \{[\s\S]*?\n  \}/u,
  )?.[0] ?? "";
  assert.match(closeBranch, /await confirmNaturalBrowserClose/u);
  assert.match(
    closeBranch,
    /await confirmNaturalBrowserClose[\s\S]*?if \(signal\?\.aborted\)[\s\S]*?throwInteractiveVisualizerCancellation/u,
  );
  assert.doesNotMatch(
    closeBranch,
    /if \(terminal\.kind === "close"\) \{\s*if \(signal\?\.aborted\)/u,
  );
});

test("WebGL fallback proof requires rendered DOM and rejects source-only text", () => {
  const inertMarkup =
    '<html data-breadboard-webgl-fallback="rendered" data-breadboard-runtime-tests="failed">';
  const scriptOnly = `<html data-breadboard-runtime-tests="failed"><script>
    const inert = ${JSON.stringify(inertMarkup)};
  </script></html>`;
  const rendered = `<html data-breadboard-webgl-fallback="rendered" data-breadboard-runtime-tests="failed"><body>
    <p class="viz-fallback">3D rendering is unavailable on this device.</p>
  </body></html>`;
  const stderr = `${inertMarkup}<p class="viz-fallback">3D rendering is unavailable on this device.</p></html>`;

  assert.equal(
    hasRenderedInteractiveVisualizerWebglFallback({ stdout: scriptOnly, stderr }),
    false,
  );
  assert.equal(
    hasRenderedInteractiveVisualizerWebglFallback({ stdout: rendered }),
    true,
  );
  assert.equal(
    hasRenderedInteractiveVisualizerWebglFallback({
      stdout: rendered.replace(
        "data-breadboard-runtime-tests=\"failed\"",
        "data-breadboard-runtime-tests=\"failed\" data-breadboard-webgl=\"ready\"",
      ),
    }),
    false,
  );
  assert.equal(
    hasRenderedInteractiveVisualizerWebglFallback({
      stdout: rendered.replace(
        "runtime-tests=\"failed\"",
        "runtime-tests=\"passed\"",
      ),
    }),
    false,
  );
});

test("every real WebGL fallback branch sets the host-rendered marker", () => {
  for (const [relativePath, expectedBranches] of [
    ["src/lib/hermes/interactive-visualizer-custom.ts", 1],
    ["src/lib/hermes/interactive-visualizer-runtime.ts", 2],
  ]) {
    const source = fs.readFileSync(path.join(dashboardRoot, relativePath), "utf8");
    const fallbackIndexes = Array.from(
      source.matchAll(/3D rendering is unavailable on this device\./gu),
      (match) => match.index,
    );
    assert.equal(fallbackIndexes.length, expectedBranches, relativePath);
    for (const index of fallbackIndexes) {
      assert.match(
        source.slice(Math.max(0, index - 320), index),
        /breadboardWebglFallback\s*=\s*["']rendered["']/u,
        `${relativePath} fallback at ${index} lacks host marker authority`,
      );
    }
  }
});

function pidExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(
      error && typeof error === "object" && error.code !== "ESRCH",
    );
  }
}

async function waitForPidsToExit(pids, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (pids.some(pidExists) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return pids.filter(pidExists);
}

test("sequential responsive browser processes reclaim each exact descendant tree", {
  timeout: 30_000,
}, async () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    "breadboard-visualizer-tree-",
  ));
  const fixturePath = path.join(root, "browser-tree-fixture.mjs");
  fs.writeFileSync(fixturePath, `
    import { spawn } from "node:child_process";
    import fs from "node:fs";
    const descendant = spawn(process.execPath, [
      "-e",
      "setInterval(() => {}, 1000)",
    ], { windowsHide: true, stdio: "ignore" });
    fs.writeFileSync(process.argv[2], JSON.stringify([
      process.pid,
      descendant.pid,
    ]));
    process.stdout.write(
      '<html data-breadboard-runtime-tests="passed" ' +
      'data-breadboard-interaction-tests="passed"><body></body></html>',
    );
    setInterval(() => {}, 1000);
  `, "utf8");
  const allPids = [];
  try {
    for (let index = 0; index < 2; index += 1) {
      const pidPath = path.join(root, `tree-${index}.json`);
      const result = await runInteractiveVisualizerBrowserProcess({
        executable: process.execPath,
        args: [fixturePath, pidPath],
        timeoutMs: 10_000,
        completionKind: "dom",
      });
      const pids = JSON.parse(fs.readFileSync(pidPath, "utf8"));
      allPids.push(...pids);
      assert.equal(result.exitCode, 0);
      assert.equal(result.timedOut, false);
      assert.equal(result.cleanupConfirmed, true);
      assert.match(result.stdout, /<\/html>$/);
      assert.deepEqual(await waitForPidsToExit(pids), []);
    }
  } finally {
    const survivors = await waitForPidsToExit(allPids, 250);
    for (const pid of survivors) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // The assertion above reports any cleanup failure.
      }
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("browser discovery accepts only a configured direct file", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-browser-path-"));
  try {
    const browser = path.join(root, "browser.exe");
    fs.writeFileSync(browser, "not executed", "utf8");
    assert.equal(
      findInteractiveVisualizerBrowser(
        { BREADBOARD_VISUAL_BROWSER_PATH: browser },
        "win32",
      ),
      browser,
    );
    assert.equal(
      appendBoundedBrowserOutput("", "x".repeat(800_000)).length,
      750_000,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
