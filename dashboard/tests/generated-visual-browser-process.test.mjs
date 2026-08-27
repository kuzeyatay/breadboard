import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  generatedVisualBrowserAttemptDurationBoundMs,
  runObservedGeneratedVisualBrowserProcess,
} from "../src/lib/generated-visual-browser-process.ts";
import {
  isCurrentOwnedWindowsRoot,
  PROCESS_SNAPSHOT_TIMEOUT_MS,
  terminateOwnedBrowserTree,
  TREE_CLOSE_TIMEOUT_MS,
  TREE_KILLER_TIMEOUT_MS,
  TREE_QUIESCENCE_TIMEOUT_MS,
} from "../scripts/runtime-v2-interactive-visualizer-executor.mjs";

function temporaryRoot(t, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("the attempt bound covers an in-flight initial snapshot at tiny deadlines", () => {
  assert.equal(
    generatedVisualBrowserAttemptDurationBoundMs(0),
    (2 * PROCESS_SNAPSHOT_TIMEOUT_MS) +
      TREE_KILLER_TIMEOUT_MS +
      TREE_QUIESCENCE_TIMEOUT_MS +
      TREE_CLOSE_TIMEOUT_MS +
      1_000,
  );
  assert.equal(generatedVisualBrowserAttemptDurationBoundMs(25_000), 48_000);
});

test("one large stdout chunk preserves DOM markers outside its trailing diagnostic window", async (t) => {
  const root = temporaryRoot(t, "breadboard-generated-browser-chunk");
  const childScript = path.join(root, "large-dom-chunk.mjs");
  fs.writeFileSync(
    childScript,
    `
      const body = '<!doctype html><html><body data-child-env="' +
        String(process.env.BREADBOARD_CHILD_ENV_SENTINEL ?? '') + '">' +
        'x'.repeat(32 * 1024) + '</body></html>';
      process.stdout.write(body);
      setInterval(() => {}, 1_000);
    `,
    "utf8",
  );

  const result = await runObservedGeneratedVisualBrowserProcess({
    executable: process.execPath,
    args: [childScript],
    timeoutMs: 5_000,
    env: { BREADBOARD_CHILD_ENV_SENTINEL: "isolated" },
  });

  assert.equal(result.status, 0, JSON.stringify(result));
  assert.equal(result.completion, "observed_dom");
  assert.equal(result.cleanupConfirmed, true);
  assert.match(result.stdout, /<body data-child-env="isolated">/u);
  assert.match(result.stdout, /<\/html>$/u);
  assert.ok(
    result.durationMs < generatedVisualBrowserAttemptDurationBoundMs(5_000),
    JSON.stringify(result),
  );
  assert.ok(
    ["taskkill-tree", "lineage-quiescence", "process-group"].includes(
      result.cleanupMethod,
    ),
    JSON.stringify(result),
  );
});

test("DOM markers split across output chunks are recognized with bounded overlap", async (t) => {
  const root = temporaryRoot(t, "breadboard-generated-browser-split");
  const childScript = path.join(root, "split-dom-markers.mjs");
  fs.writeFileSync(
    childScript,
    `
      process.stdout.write('<!doctype html><html><bo');
      setTimeout(() => process.stdout.write('dy data-split="true">ok</body></ht'), 10);
      setTimeout(() => process.stdout.write('ml>'), 20);
      setInterval(() => {}, 1_000);
    `,
    "utf8",
  );
  const result = await runObservedGeneratedVisualBrowserProcess({
    executable: process.execPath,
    args: [childScript],
    timeoutMs: 5_000,
  });
  assert.equal(result.status, 0, JSON.stringify(result));
  assert.equal(result.completion, "observed_dom");
  assert.equal(result.cleanupConfirmed, true);
  assert.match(result.stdout, /<body data-split="true">/u);
  assert.match(result.stdout, /<\/html>$/u);
});

test("the first terminal cause remains authoritative while cleanup proof is pending", async (t) => {
  const root = temporaryRoot(t, "breadboard-generated-browser-terminal");
  const idleScript = path.join(root, "idle.mjs");
  const overflowScript = path.join(root, "overflow.mjs");
  const exitScript = path.join(root, "exit.mjs");
  fs.writeFileSync(idleScript, "setInterval(() => {}, 1_000);\n", "utf8");
  fs.writeFileSync(
    overflowScript,
    "process.stdout.write('x'.repeat(16 * 1024 * 1024 + 1)); setInterval(() => {}, 1_000);\n",
    "utf8",
  );
  fs.writeFileSync(exitScript, "process.exit(0);\n", "utf8");

  for (const fixture of [
    {
      expected: "deadline",
      script: idleScript,
      timeoutMs: 5,
      errorCode: "ETIMEDOUT",
      timedOut: true,
    },
    {
      expected: "output_overflow",
      script: overflowScript,
      timeoutMs: 5_000,
      errorCode: "ENOBUFS",
      timedOut: false,
    },
    {
      expected: "process_exit",
      script: exitScript,
      timeoutMs: 5_000,
      errorCode: undefined,
      timedOut: false,
    },
  ]) {
    const controller = new AbortController();
    const latched = [];
    const result = await runObservedGeneratedVisualBrowserProcess({
      executable: process.execPath,
      args: [fixture.script],
      timeoutMs: fixture.timeoutMs,
      signal: controller.signal,
      onTerminalLatched(completion) {
        latched.push(completion);
        controller.abort(new Error("late cancellation must not replace the winner"));
      },
    });
    assert.deepEqual(latched, [fixture.expected]);
    assert.equal(result.completion, fixture.expected, JSON.stringify(result));
    if (fixture.errorCode !== undefined) {
      assert.equal(result.error?.code, fixture.errorCode, JSON.stringify(result));
    } else {
      assert.ok(
        result.error === undefined || result.error.code === "ECLEANUP",
        JSON.stringify(result),
      );
      assert.equal(result.status, 0, JSON.stringify(result));
      assert.equal(result.signal, null, JSON.stringify(result));
      assert.equal(result.browserExitedNaturally, true, JSON.stringify(result));
      if (!result.cleanupConfirmed) {
        assert.equal(result.error?.code, "ECLEANUP", JSON.stringify(result));
      }
    }
    assert.equal(result.timedOut, fixture.timedOut, JSON.stringify(result));
    assert.notEqual(result.error?.code, "ECANCELLED");
  }
});

test("a non-direct executable fails closed without falling back to a raw spawn", async (t) => {
  const root = temporaryRoot(t, "breadboard-generated-browser-wrapper");
  const executionMarker = path.join(root, "must-not-exist.txt");
  const result = await runObservedGeneratedVisualBrowserProcess({
    executable: path.join(root, "missing-browser.exe"),
    args: [executionMarker],
    timeoutMs: 1_000,
  });

  assert.equal(result.status, null);
  assert.equal(result.completion, "spawn_error");
  assert.equal(result.error?.code, "EWRAPPER");
  assert.equal(result.cleanupMethod, "none");
  assert.equal(result.cleanupConfirmed, true);
  assert.equal(fs.existsSync(executionMarker), false);
});

test("an already-aborted invocation has an exact no-process cleanup receipt", async () => {
  const controller = new AbortController();
  controller.abort(new Error("cancelled before launch"));
  const result = await runObservedGeneratedVisualBrowserProcess({
    executable: process.execPath,
    args: ["unused.mjs"],
    timeoutMs: 1_000,
    signal: controller.signal,
  });

  assert.equal(result.completion, "cancelled");
  assert.equal(result.error?.code, "ECANCELLED");
  assert.equal(result.cleanupMethod, "none");
  assert.equal(result.cleanupConfirmed, true);
});

test("PID reuse and cleanup-time rows never become tree-kill authority", async () => {
  const original = { pid: 2401, parentPid: 1, creationMs: 10, name: "node.exe" };
  const reused = { ...original, creationMs: 20 };
  const unrelatedChild = {
    pid: 2402,
    parentPid: reused.pid,
    creationMs: 21,
    name: "node.exe",
  };
  assert.equal(isCurrentOwnedWindowsRoot(2401, [original], [reused]), false);

  let fallbackKillCalled = false;
  let treeKillCalls = 0;
  const child = {
    pid: 2401,
    exitCode: null,
    signalCode: null,
    kill() {
      fallbackKillCalled = true;
      return true;
    },
  };
  const cleanup = await terminateOwnedBrowserTree(
    child,
    "win32",
    {},
    path.join(os.tmpdir(), "injected-taskkill.exe"),
    {
      initialRows: null,
      powershell: path.join(os.tmpdir(), "injected-powershell.exe"),
      processSnapshot: async () => [reused, unrelatedChild],
      treeKiller: async () => {
        treeKillCalls += 1;
        return { succeeded: true, code: 0, output: "must not run" };
      },
    },
  );
  assert.equal(cleanup.confirmed, false);
  assert.equal(cleanup.rootIdentityConfirmed, false);
  assert.equal(cleanup.method, "process-kill");
  assert.equal(treeKillCalls, 0);
  assert.equal(fallbackKillCalled, true);
});
