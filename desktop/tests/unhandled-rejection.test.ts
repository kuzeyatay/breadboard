import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AppLifecycle,
  DESKTOP_RUNTIME_EXIT_TIMEOUTS,
  installUnhandledRejectionGuard,
  type UnhandledRejectionActions,
} from "../src/main/app-lifecycle";

test("closing the desktop has a short bounded Runtime drain", () => {
  assert.deepEqual(DESKTOP_RUNTIME_EXIT_TIMEOUTS, {
    controlRequestTimeoutMs: 2_000,
    gracefulShutdownTimeoutMs: 5_000,
    forcedShutdownTimeoutMs: 3_000,
  });
  assert.ok(
    Object.values(DESKTOP_RUNTIME_EXIT_TIMEOUTS).reduce(
      (total, timeout) => total + timeout,
      0,
    ) <= 10_000,
    "the invisible post-window shutdown must not keep the launcher alive for more than ten seconds",
  );
});

function harness(overrides: Partial<UnhandledRejectionActions> = {}) {
  let listener: ((reason: unknown) => void) | null = null;
  const diagnostics: string[] = [];
  const calls: string[] = [];
  installUnhandledRejectionGuard(
    (registered) => {
      listener = registered;
    },
    {
      writeDiagnostic: (line) => {
        calls.push("log");
        diagnostics.push(line);
      },
      killAllNow: () => {
        calls.push("kill");
      },
      exit: (code) => {
        calls.push(`exit:${code}`);
      },
      ...overrides,
    },
  );
  assert.ok(listener, "guard should subscribe an unhandled-rejection listener");
  return {
    reject: (reason: unknown) => listener!(reason),
    diagnostics,
    calls,
  };
}

test("AppLifecycle installs the rejection guard before run starts", () => {
  const existing = new Set(process.listeners("unhandledRejection"));
  // Construction is deliberately enough: a rejection during the first await
  // in run() must already have a product-side observer.
  const lifecycle = new AppLifecycle("unused-in-constructor", false);
  const added = process
    .listeners("unhandledRejection")
    .filter((listener) => !existing.has(listener));
  try {
    assert.equal(added.length, 1);
    assert.ok(lifecycle);
  } finally {
    for (const listener of added) {
      process.removeListener("unhandledRejection", listener);
    }
  }
});

test("unhandled rejection is diagnosed before child cleanup and non-zero exit", () => {
  const guard = harness();
  guard.reject(new Error("rejected startup task"));

  assert.deepEqual(guard.calls, ["log", "kill", "exit:1"]);
  assert.equal(guard.diagnostics.length, 1);
  assert.match(guard.diagnostics[0] ?? "", /^\[desktop\] unhandled rejection:/);
  assert.match(guard.diagnostics[0] ?? "", /rejected startup task/);
});

test("logging failure cannot prevent emergency cleanup and exit", () => {
  const guard = harness({
    writeDiagnostic: () => {
      throw new Error("log unavailable");
    },
  });
  guard.reject("background promise failed");

  assert.deepEqual(guard.calls, ["kill", "exit:1"]);
});

test("non-Error object rejections are classified without serializing their fields", () => {
  const guard = harness();
  guard.reject({ token: "must-not-be-written", status: 500 });

  assert.doesNotMatch(guard.diagnostics[0] ?? "", /must-not-be-written|token/);
  assert.match(guard.diagnostics[0] ?? "", /non-Error \[object Object\]/);
});
