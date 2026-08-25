import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { describe } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import esbuild from "esbuild";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backgroundEntry = path.join(dashboardRoot, "src", "lib", "learn-background.ts");
const workspacePath = path.join(
  dashboardRoot,
  "src",
  "app",
  "gardens",
  "[clusterSlug]",
  "workspace-client.tsx",
);
const STATE_KEY = "__breadboardLearnBackgroundHandoffTestState";

async function loadBackgroundHelper(platformOverride) {
  const result = await esbuild.build({
    entryPoints: [backgroundEntry],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    write: false,
    ...(platformOverride
      ? { define: { "process.platform": JSON.stringify(platformOverride) } }
      : {}),
    plugins: [
      {
        name: "learn-background-test-stubs",
        setup(build) {
          build.onResolve({ filter: /^server-only$/ }, () => ({
            path: "server-only",
            namespace: "learn-background-stub",
          }));
          build.onResolve({ filter: /^next\/server$/ }, () => ({
            path: "next/server",
            namespace: "learn-background-stub",
          }));
          build.onLoad(
            { filter: /.*/, namespace: "learn-background-stub" },
            (args) => ({
              loader: "js",
              contents:
                args.path === "next/server"
                  ? `
                      export function after(callback) {
                        globalThis[${JSON.stringify(STATE_KEY)}].callbacks.push(callback);
                      }
                    `
                  : "export {};",
            }),
          );
        },
      },
    ],
  });
  const encoded = Buffer.from(result.outputFiles[0].text).toString("base64");
  return import(
    `data:text/javascript;base64,${encoded}#learn-background-handoff-${platformOverride ?? "native"}`
  );
}

globalThis[STATE_KEY] = { callbacks: [] };
const { handOffDedicatedLearnTask, handOffLearnTask } = await loadBackgroundHelper();

function resetAfterCallbacks() {
  globalThis[STATE_KEY].callbacks.length = 0;
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

describe("handOffLearnTask runtime behavior", () => {
  test("production uses the explicitly configured dedicated worker and runtime root", async () => {
    resetAfterCallbacks();
    const temporaryRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "learn-worker-production-runtime-"),
    );
    const runtimeRoot = path.join(temporaryRoot, "desktop runtime with spaces", "learn-workers");
    const previousNodeEnv = process.env.NODE_ENV;
    const previousRoot = process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR;
    const previousWorkerRoot = process.env.BREADBOARD_LEARN_WORKER_DASHBOARD_ROOT;
    const previousSourceRoot = process.env.BREADBOARD_LEARN_SOURCE_ROOT;
    const previousRuntimeRoot = process.env.BREADBOARD_LEARN_WORKER_RUNTIME_DIR;
    process.env.NODE_ENV = "production";
    process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR = path.join(
      os.tmpdir(),
      "missing-production-learn-worker-assets",
    );
    process.env.BREADBOARD_LEARN_WORKER_DASHBOARD_ROOT = dashboardRoot;
    process.env.BREADBOARD_LEARN_SOURCE_ROOT = path.join(dashboardRoot, "src");
    process.env.BREADBOARD_LEARN_WORKER_RUNTIME_DIR = runtimeRoot;
    try {
      await assert.rejects(
        () => handOffDedicatedLearnTask(
          { operation: "plan" },
          "production configured-worker test",
        ),
        /missing its garden, user, or content path/,
      );
      assert.equal(
        fs.readdirSync(runtimeRoot).some((name) => name.endsWith(".ready.json")),
        true,
        "the real worker must write its failure receipt under the configured runtime root",
      );
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousRoot === undefined) {
        delete process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR;
      } else {
        process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR = previousRoot;
      }
      if (previousWorkerRoot === undefined) {
        delete process.env.BREADBOARD_LEARN_WORKER_DASHBOARD_ROOT;
      } else {
        process.env.BREADBOARD_LEARN_WORKER_DASHBOARD_ROOT = previousWorkerRoot;
      }
      if (previousSourceRoot === undefined) {
        delete process.env.BREADBOARD_LEARN_SOURCE_ROOT;
      } else {
        process.env.BREADBOARD_LEARN_SOURCE_ROOT = previousSourceRoot;
      }
      if (previousRuntimeRoot === undefined) {
        delete process.env.BREADBOARD_LEARN_WORKER_RUNTIME_DIR;
      } else {
        process.env.BREADBOARD_LEARN_WORKER_RUNTIME_DIR = previousRuntimeRoot;
      }
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  test("propagates a fast completion to the route", async () => {
    resetAfterCallbacks();
    const result = await handOffLearnTask(
      async () => ({ jobId: "job-fast" }),
      "fast task",
    );

    assert.deepEqual(result, {
      accepted: false,
      value: { jobId: "job-fast" },
    });
    assert.equal(globalThis[STATE_KEY].callbacks.length, 0);
  });

  test("propagates a fast failure so normal route error handling still runs", async () => {
    resetAfterCallbacks();
    const failure = new Error("validation failed before handoff");

    await assert.rejects(
      handOffLearnTask(async () => {
        throw failure;
      }, "fast failure"),
      (error) => error === failure,
    );
    assert.equal(globalThis[STATE_KEY].callbacks.length, 0);
  });

  test("returns accepted only after durable setup and resumes work inside Next after", async () => {
    resetAfterCallbacks();
    let durableJobCreated = false;
    let postBarrierWorkFinished = false;

    const result = await handOffLearnTask(async (yieldToResponse) => {
      durableJobCreated = true;
      await yieldToResponse("job-durable");
      for (let index = 0; index < 100; index += 1) {
        // Cached Learn stages combine synchronous work with already-resolved
        // awaits. This used to starve the timer-based handoff indefinitely.
        await Promise.resolve();
      }
      postBarrierWorkFinished = true;
      return { jobId: "job-late" };
    }, "long generation");
    assert.deepEqual(result, { accepted: true, jobId: "job-durable" });
    assert.equal(durableJobCreated, true);
    assert.equal(postBarrierWorkFinished, false);
    assert.equal(globalThis[STATE_KEY].callbacks.length, 1);

    await globalThis[STATE_KEY].callbacks[0]();
    assert.equal(postBarrierWorkFinished, true);
  });

  test("development worker protocol rejects malformed work before the in-process closure runs", async () => {
    resetAfterCallbacks();
    const previousRoot = process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR;
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR = dashboardRoot;
    process.env.NODE_ENV = "development";
    let inProcessClosureRan = false;
    try {
      await assert.rejects(
        handOffLearnTask(
          async () => {
            inProcessClosureRan = true;
            return null;
          },
          "malformed test task",
          { operation: "plan" },
        ),
        (error) =>
          error?.name === "Error" &&
          error.message ===
            "The Learn worker request is missing its garden, user, or content path.",
      );
    } finally {
      if (previousRoot === undefined) {
        delete process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR;
      } else {
        process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR = previousRoot;
      }
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
    assert.equal(inProcessClosureRan, false);
    assert.equal(globalThis[STATE_KEY].callbacks.length, 0);
  });

  test("development enforces one global heavy Learn worker", async () => {
    resetAfterCallbacks();
    const temporaryRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "learn-worker-concurrency-"),
    );
    const temporaryDashboard = path.join(temporaryRoot, "dashboard");
    const runtimeRoot = path.join(temporaryRoot, ".runtime", "learn-workers");
    fs.mkdirSync(path.join(temporaryDashboard, "scripts"), { recursive: true });
    fs.mkdirSync(path.join(temporaryDashboard, "src", "lib"), { recursive: true });
    fs.mkdirSync(runtimeRoot, { recursive: true });
    for (const file of [
      "scripts/learn-worker.mjs",
      "scripts/learn-worker-import-hook.mjs",
      "src/lib/learn.ts",
    ]) {
      fs.writeFileSync(path.join(temporaryDashboard, file), "\n", "utf8");
    }
    fs.writeFileSync(
      path.join(runtimeRoot, "learn-worker.active.json"),
      `${JSON.stringify({ pid: process.pid, nonce: "active-test-worker" })}\n`,
      "utf8",
    );

    const previousRoot = process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR;
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR = temporaryDashboard;
    process.env.NODE_ENV = "development";
    try {
      await assert.rejects(
        handOffLearnTask(
          async () => null,
          "concurrent worker test",
          {
            operation: "humanizer",
            gardenId: "generic-concurrency-garden",
            userId: 1,
            contentPath: temporaryRoot,
            enabled: true,
          },
        ),
        (error) =>
          error?.name === "LearnWorkerConflictError" &&
          /Another Learn worker is already active/.test(error.message),
      );
    } finally {
      if (previousRoot === undefined) delete process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR;
      else process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR = previousRoot;
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  test("ambiguous launching and invalid markers stay fail-closed", async () => {
    resetAfterCallbacks();
    const temporaryRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "learn-worker-ambiguous-launch-"),
    );
    const temporaryDashboard = path.join(temporaryRoot, "dashboard");
    const runtimeRoot = path.join(temporaryRoot, ".runtime", "learn-workers");
    fs.mkdirSync(path.join(temporaryDashboard, "scripts"), { recursive: true });
    fs.mkdirSync(path.join(temporaryDashboard, "src", "lib"), { recursive: true });
    fs.mkdirSync(runtimeRoot, { recursive: true });
    for (const file of [
      "scripts/learn-worker.mjs",
      "scripts/learn-worker-import-hook.mjs",
      "src/lib/learn.ts",
    ]) {
      fs.writeFileSync(path.join(temporaryDashboard, file), "\n", "utf8");
    }
    const markerPath = path.join(runtimeRoot, "learn-worker.active.json");
    const marker = {
      protocolVersion: 1,
      requestId: "ambiguous-launch-request",
      nonce: "ambiguous-launch-nonce",
      pid: 2_147_483_647,
      state: "launching",
    };
    fs.writeFileSync(markerPath, `${JSON.stringify(marker)}\n`, "utf8");
    const orphanedClaimPath = `${markerPath}.claim-1234-orphaned-nonce`;
    fs.writeFileSync(orphanedClaimPath, "complete candidate\n", "utf8");
    const orphanedTimestamp = new Date(Date.now() - 5 * 60_000);
    fs.utimesSync(orphanedClaimPath, orphanedTimestamp, orphanedTimestamp);

    const previousRoot = process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR;
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR = temporaryDashboard;
    process.env.NODE_ENV = "development";
    const request = {
      operation: "humanizer",
      gardenId: "ambiguous-launch-garden",
      userId: 1,
      contentPath: temporaryRoot,
      enabled: true,
    };
    try {
      await assert.rejects(
        handOffLearnTask(
          async () => null,
          "ambiguous launch test",
          request,
        ),
        (error) =>
          error?.name === "LearnWorkerConflictError" &&
          /Another Learn worker is already active/.test(error.message),
      );
      assert.deepEqual(JSON.parse(fs.readFileSync(markerPath, "utf8")), marker);
      assert.equal(fs.existsSync(orphanedClaimPath), false);

      fs.writeFileSync(markerPath, "{partial", "utf8");
      const oldTimestamp = new Date(Date.now() - 5 * 60_000);
      fs.utimesSync(markerPath, oldTimestamp, oldTimestamp);
      await assert.rejects(
        handOffLearnTask(async () => null, "invalid marker test", request),
        (error) =>
          error?.name === "LearnWorkerConflictError" &&
          /Another Learn worker is already active/.test(error.message),
      );
      assert.equal(fs.readFileSync(markerPath, "utf8"), "{partial");

      const malformedRunning = { state: "running", pid: 2_147_483_647 };
      fs.writeFileSync(markerPath, JSON.stringify(malformedRunning), "utf8");
      fs.utimesSync(markerPath, oldTimestamp, oldTimestamp);
      await assert.rejects(
        handOffLearnTask(async () => null, "malformed running marker test", request),
        (error) =>
          error?.name === "LearnWorkerConflictError" &&
          /Another Learn worker is already active/.test(error.message),
      );
      assert.deepEqual(
        JSON.parse(fs.readFileSync(markerPath, "utf8")),
        malformedRunning,
      );
    } finally {
      if (previousRoot === undefined) delete process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR;
      else process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR = previousRoot;
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  test("development IPC preserves a worker conflict's replacement-planning intent", async () => {
    resetAfterCallbacks();
    const fixtureParent = path.join(dashboardRoot, ".runtime");
    fs.mkdirSync(fixtureParent, { recursive: true });
    const temporaryRoot = fs.mkdtempSync(
      path.join(fixtureParent, "learn-worker-replan-conflict-"),
    );
    const temporaryDashboard = path.join(temporaryRoot, "dashboard");
    const attemptPath = path.join(temporaryRoot, "attempts.json");
    const installFixtureDashboard = () => {
      fs.mkdirSync(path.join(temporaryDashboard, "scripts"), { recursive: true });
      fs.mkdirSync(path.join(temporaryDashboard, "src", "lib"), { recursive: true });
      fs.copyFileSync(
        path.join(dashboardRoot, "scripts", "windows-breakaway-process.mjs"),
        path.join(temporaryDashboard, "scripts", "windows-breakaway-process.mjs"),
      );
      fs.writeFileSync(
        path.join(temporaryDashboard, "scripts", "learn-worker-import-hook.mjs"),
        "export {};\n",
        "utf8",
      );
      fs.writeFileSync(
        path.join(temporaryDashboard, "scripts", "learn-worker.mjs"),
        `
        import fs from "node:fs";

        const attemptPath = process.env.LEARN_WORKER_TEST_ATTEMPT_PATH;
        const attempts = fs.existsSync(attemptPath)
          ? JSON.parse(fs.readFileSync(attemptPath, "utf8"))
          : [];
        const attempt = attempts.length + 1;
        attempts.push({ attempt, pid: process.pid });
        fs.writeFileSync(attemptPath, JSON.stringify(attempts));

        const failure = (message) => ({
          protocolVersion: 1,
          type: "failed",
          requestId: message.requestId,
          operation: message.request.operation,
          gardenId: message.request.gardenId,
          error: {
            name: "LearnPipelineConflictError",
            message: "confirmed map model changed before worker preflight",
            requiresReplan: true,
          },
        });
        const completed = (message) => ({
          protocolVersion: 1,
          type: "completed",
          requestId: message.requestId,
          operation: message.request.operation,
          gardenId: message.request.gardenId,
          value: { replacement: true },
        });

        const startupIndex = process.argv.indexOf("--breadboard-learn-start-file");
        if (startupIndex >= 0) {
          const startupPath = process.argv[startupIndex + 1];
          const message = JSON.parse(fs.readFileSync(startupPath, "utf8"));
          fs.rmSync(startupPath, { force: true });
          const marker = JSON.parse(fs.readFileSync(message.concurrencyPath, "utf8"));
          fs.writeFileSync(message.concurrencyPath, JSON.stringify({
            ...marker,
            pid: process.pid,
            state: "running",
          }));
          const temporaryReceipt = message.receiptPath + "." + process.pid + ".tmp";
          const terminal = attempt === 1 ? failure(message) : completed(message);
          fs.writeFileSync(temporaryReceipt, JSON.stringify(terminal) + "\\n");
          fs.renameSync(temporaryReceipt, message.receiptPath);
          if (attempt === 1) setInterval(() => {}, 60_000);
          else {
            fs.rmSync(message.concurrencyPath, { force: true });
            process.exit(0);
          }
        } else {
          process.once("message", (message) => {
            const terminal = attempt === 1 ? failure(message) : completed(message);
            process.send(terminal, () => {
              if (attempt === 1) setInterval(() => {}, 60_000);
              else process.exit(0);
            });
          });
        }
      `,
        "utf8",
      );
      fs.writeFileSync(
        path.join(temporaryDashboard, "src", "lib", "learn.ts"),
        "\n",
        "utf8",
      );
    };
    installFixtureDashboard();

    const previousRoot = process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR;
    const previousNodeEnv = process.env.NODE_ENV;
    const previousAttemptPath = process.env.LEARN_WORKER_TEST_ATTEMPT_PATH;
    process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR = temporaryDashboard;
    process.env.NODE_ENV = "development";
    process.env.LEARN_WORKER_TEST_ATTEMPT_PATH = attemptPath;
    try {
      await assert.rejects(
        handOffLearnTask(
          async () => null,
          "worker replan conflict test",
          {
            operation: "humanizer",
            gardenId: "generic-replan-conflict-garden",
            userId: 1,
            contentPath: temporaryRoot,
            enabled: true,
          },
        ),
        (error) =>
          error?.name === "LearnWorkerConflictError" &&
          error.requiresReplan === true &&
          /confirmed map model changed/.test(error.message),
      );
      const [failedAttempt] = JSON.parse(fs.readFileSync(attemptPath, "utf8"));
      if (process.platform === "win32") {
        assert.equal(
          processIsAlive(failedAttempt.pid),
          false,
          "the failed Windows worker must exit before its conflict is returned",
        );
      }
      assert.equal(
        fs.existsSync(
          path.join(temporaryRoot, ".runtime", "learn-workers", "learn-worker.active.json"),
        ),
        false,
      );

      fs.rmSync(temporaryDashboard, { recursive: true, force: true });
      installFixtureDashboard();
      const replacement = await handOffLearnTask(
        async () => null,
        "worker replacement test",
        {
          operation: "humanizer",
          gardenId: "generic-replan-conflict-garden",
          userId: 1,
          contentPath: temporaryRoot,
          enabled: true,
        },
      );
      assert.deepEqual(replacement, {
        accepted: false,
        value: { replacement: true },
      });
      const attempts = JSON.parse(fs.readFileSync(attemptPath, "utf8"));
      assert.equal(attempts.length, 2);
      assert.notEqual(attempts[0].pid, attempts[1].pid);
    } finally {
      if (previousRoot === undefined) delete process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR;
      else process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR = previousRoot;
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousAttemptPath === undefined) delete process.env.LEARN_WORKER_TEST_ATTEMPT_PATH;
      else process.env.LEARN_WORKER_TEST_ATTEMPT_PATH = previousAttemptPath;
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
    assert.equal(globalThis[STATE_KEY].callbacks.length, 0);
  });

  test("the child-process path observes failed worker exit before allowing replacement", async () => {
    resetAfterCallbacks();
    const { handOffLearnTask: handOffChildProcessTask } =
      process.platform === "win32"
        ? await loadBackgroundHelper("linux")
        : { handOffLearnTask };
    const temporaryRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "learn-worker-child-exit-"),
    );
    const temporaryDashboard = path.join(temporaryRoot, "dashboard");
    const attemptPath = path.join(temporaryRoot, "attempts.json");
    const installFixtureDashboard = () => {
      fs.mkdirSync(path.join(temporaryDashboard, "scripts"), { recursive: true });
      fs.mkdirSync(path.join(temporaryDashboard, "src", "lib"), { recursive: true });
      fs.writeFileSync(
        path.join(temporaryDashboard, "scripts", "learn-worker-import-hook.mjs"),
        "export {};\n",
        "utf8",
      );
      fs.writeFileSync(
        path.join(temporaryDashboard, "src", "lib", "learn.ts"),
        "\n",
        "utf8",
      );
      fs.writeFileSync(
        path.join(temporaryDashboard, "scripts", "learn-worker.mjs"),
        `
          import fs from "node:fs";

          const attemptPath = process.env.LEARN_WORKER_TEST_ATTEMPT_PATH;
          const attempts = fs.existsSync(attemptPath)
            ? JSON.parse(fs.readFileSync(attemptPath, "utf8"))
            : [];
          attempts.push({ attempt: attempts.length + 1, pid: process.pid });
          fs.writeFileSync(attemptPath, JSON.stringify(attempts));
          process.once("message", (message) => {
            const first = attempts.length === 1;
            process.send({
              protocolVersion: 1,
              type: first ? "failed" : "completed",
              requestId: message.requestId,
              operation: message.request.operation,
              gardenId: message.request.gardenId,
              ...(first
                ? { error: { name: "SentinelChildError", message: "child failed" } }
                : { value: { replacement: true } }),
            }, () => {
              if (first) setInterval(() => {}, 60_000);
              else process.exit(0);
            });
          });
        `,
        "utf8",
      );
    };
    installFixtureDashboard();

    const previousRoot = process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR;
    const previousNodeEnv = process.env.NODE_ENV;
    const previousAttemptPath = process.env.LEARN_WORKER_TEST_ATTEMPT_PATH;
    process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR = temporaryDashboard;
    process.env.NODE_ENV = "development";
    process.env.LEARN_WORKER_TEST_ATTEMPT_PATH = attemptPath;
    const request = {
      operation: "humanizer",
      gardenId: "child-exit-garden",
      userId: 1,
      contentPath: temporaryRoot,
      enabled: true,
    };
    try {
      await assert.rejects(
        handOffChildProcessTask(async () => null, "child exit test", request),
        (error) =>
          error?.name === "SentinelChildError" && error.message === "child failed",
      );
      const [failedAttempt] = JSON.parse(fs.readFileSync(attemptPath, "utf8"));
      assert.equal(processIsAlive(failedAttempt.pid), false);
      const markerPath = path.join(
        temporaryRoot,
        ".runtime",
        "learn-workers",
        "learn-worker.active.json",
      );
      assert.equal(fs.existsSync(markerPath), false);

      fs.rmSync(temporaryDashboard, { recursive: true, force: true });
      installFixtureDashboard();
      const replacement = await handOffChildProcessTask(
        async () => null,
        "child replacement test",
        request,
      );
      assert.deepEqual(replacement, {
        accepted: false,
        value: { replacement: true },
      });
      assert.equal(JSON.parse(fs.readFileSync(attemptPath, "utf8")).length, 2);
    } finally {
      if (previousRoot === undefined) delete process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR;
      else process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR = previousRoot;
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousAttemptPath === undefined) delete process.env.LEARN_WORKER_TEST_ATTEMPT_PATH;
      else process.env.LEARN_WORKER_TEST_ATTEMPT_PATH = previousAttemptPath;
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  test(
    "a post-CreateProcess fault returns exact ownership before the marker is released",
    { skip: process.platform !== "win32" },
    async () => {
      resetAfterCallbacks();
      const temporaryRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), "learn-worker-post-create-fault-"),
      );
      const temporaryDashboard = path.join(temporaryRoot, "dashboard");
      const attemptPath = path.join(temporaryRoot, "attempt.txt");
      const pidPath = path.join(temporaryRoot, "created-pid.txt");
      fs.mkdirSync(path.join(temporaryDashboard, "scripts"), { recursive: true });
      fs.mkdirSync(path.join(temporaryDashboard, "src", "lib"), { recursive: true });
      fs.writeFileSync(
        path.join(temporaryDashboard, "scripts", "learn-worker-import-hook.mjs"),
        "export {};\n",
        "utf8",
      );
      fs.writeFileSync(
        path.join(temporaryDashboard, "src", "lib", "learn.ts"),
        "\n",
        "utf8",
      );
      fs.writeFileSync(
        path.join(temporaryDashboard, "scripts", "windows-breakaway-process.mjs"),
        `
          import fs from "node:fs";
          import { launchWindowsBreakawayProcess as launchReal } from ${JSON.stringify(
            pathToFileURL(
              path.join(dashboardRoot, "scripts", "windows-breakaway-process.mjs"),
            ).href,
          )};

          const attemptPath = ${JSON.stringify(attemptPath)};
          const pidPath = ${JSON.stringify(pidPath)};

          export function launchWindowsBreakawayProcess(options) {
            const attempt = fs.existsSync(attemptPath)
              ? Number(fs.readFileSync(attemptPath, "utf8")) + 1
              : 1;
            fs.writeFileSync(attemptPath, String(attempt));
            return launchReal(
              options,
              attempt === 1
                ? {
                    afterCreate({ pid }) {
                      fs.writeFileSync(pidPath, String(pid));
                      const error = new Error("sentinel post-create fault");
                      error.name = "SentinelPostCreateError";
                      throw error;
                    },
                  }
                : undefined,
            );
          }
        `,
        "utf8",
      );
      fs.writeFileSync(
        path.join(temporaryDashboard, "scripts", "learn-worker.mjs"),
        `
          import fs from "node:fs";

          const attempt = Number(fs.readFileSync(${JSON.stringify(attemptPath)}, "utf8"));
          if (attempt === 1) {
            setInterval(() => {}, 60_000);
          } else {
            const startupIndex = process.argv.indexOf("--breadboard-learn-start-file");
            const startupPath = process.argv[startupIndex + 1];
            const message = JSON.parse(fs.readFileSync(startupPath, "utf8"));
            fs.rmSync(startupPath, { force: true });
            const marker = JSON.parse(fs.readFileSync(message.concurrencyPath, "utf8"));
            fs.writeFileSync(message.concurrencyPath, JSON.stringify({
              ...marker,
              pid: process.pid,
              state: "running",
            }));
            fs.writeFileSync(message.receiptPath, JSON.stringify({
              protocolVersion: 1,
              type: "completed",
              requestId: message.requestId,
              operation: message.request.operation,
              gardenId: message.request.gardenId,
              value: { replacement: true },
            }) + "\\n");
          }
        `,
        "utf8",
      );

      const previousRoot = process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR;
      const previousNodeEnv = process.env.NODE_ENV;
      process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR = temporaryDashboard;
      process.env.NODE_ENV = "development";
      const request = {
        operation: "humanizer",
        gardenId: "post-create-fault-garden",
        userId: 1,
        contentPath: temporaryRoot,
        enabled: true,
      };
      try {
        await assert.rejects(
          handOffLearnTask(async () => null, "post-create fault test", request),
          (error) =>
            error?.name === "SentinelPostCreateError" &&
            error.message === "sentinel post-create fault",
        );
        const failedPid = Number(fs.readFileSync(pidPath, "utf8"));
        assert.equal(processIsAlive(failedPid), false);
        const markerPath = path.join(
          temporaryRoot,
          ".runtime",
          "learn-workers",
          "learn-worker.active.json",
        );
        assert.equal(fs.existsSync(markerPath), false);

        const replacement = await handOffLearnTask(
          async () => null,
          "post-create replacement test",
          request,
        );
        assert.deepEqual(replacement, {
          accepted: false,
          value: { replacement: true },
        });
        assert.equal(fs.readFileSync(attemptPath, "utf8"), "2");
      } finally {
        if (previousRoot === undefined) {
          delete process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR;
        } else {
          process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR = previousRoot;
        }
        if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previousNodeEnv;
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
      }
      assert.equal(globalThis[STATE_KEY].callbacks.length, 0);
    },
  );

  test(
    "a Windows termination failure closes its handle, preserves both errors, and keeps the slot fenced",
    { skip: process.platform !== "win32" },
    async () => {
      resetAfterCallbacks();
      const temporaryRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), "learn-worker-termination-failure-"),
      );
      const temporaryDashboard = path.join(temporaryRoot, "dashboard");
      const closePath = path.join(temporaryDashboard, "handle-closed");
      fs.mkdirSync(path.join(temporaryDashboard, "scripts"), { recursive: true });
      fs.mkdirSync(path.join(temporaryDashboard, "src", "lib"), { recursive: true });
      fs.writeFileSync(
        path.join(temporaryDashboard, "scripts", "learn-worker-import-hook.mjs"),
        "export {};\n",
        "utf8",
      );
      fs.writeFileSync(
        path.join(temporaryDashboard, "scripts", "learn-worker.mjs"),
        "\n",
        "utf8",
      );
      fs.writeFileSync(
        path.join(temporaryDashboard, "src", "lib", "learn.ts"),
        "\n",
        "utf8",
      );
      fs.writeFileSync(
        path.join(temporaryDashboard, "scripts", "windows-breakaway-process.mjs"),
        `
          import fs from "node:fs";
          import path from "node:path";

          export function launchWindowsBreakawayProcess({ args, cwd }) {
            const startupIndex = args.indexOf("--breadboard-learn-start-file");
            const startupPath = args[startupIndex + 1];
            const message = JSON.parse(fs.readFileSync(startupPath, "utf8"));
            fs.writeFileSync(message.receiptPath, JSON.stringify({
              protocolVersion: 1,
              type: "failed",
              requestId: message.requestId,
              operation: message.request.operation,
              gardenId: message.request.gardenId,
              error: {
                name: "SentinelWorkerError",
                message: "sentinel worker failure",
              },
            }) + "\\n");
            return {
              pid: process.pid,
              status() { return { alive: true, exitCode: null }; },
              waitForExit() { throw new Error("sentinel wait failure"); },
              terminateAndWait() { throw new Error("sentinel termination failure"); },
              kill() {},
              close() {
                fs.writeFileSync(path.join(cwd, "handle-closed"), "closed\\n");
              },
            };
          }
        `,
        "utf8",
      );

      const previousRoot = process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR;
      const previousNodeEnv = process.env.NODE_ENV;
      process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR = temporaryDashboard;
      process.env.NODE_ENV = "development";
      const request = {
        operation: "humanizer",
        gardenId: "termination-failure-garden",
        userId: 1,
        contentPath: temporaryRoot,
        enabled: true,
      };
      try {
        await assert.rejects(
          handOffLearnTask(async () => null, "termination failure test", request),
          (error) => {
            assert.ok(error instanceof AggregateError);
            assert.equal(error.errors.length, 2);
            assert.equal(error.errors[0].name, "SentinelWorkerError");
            assert.equal(error.errors[0].message, "sentinel worker failure");
            assert.equal(error.errors[1].message, "sentinel termination failure");
            return true;
          },
        );
        assert.equal(fs.existsSync(closePath), true);
        const markerPath = path.join(
          temporaryRoot,
          ".runtime",
          "learn-workers",
          "learn-worker.active.json",
        );
        assert.equal(fs.existsSync(markerPath), true);
        await assert.rejects(
          handOffLearnTask(async () => null, "fenced replacement test", request),
          (error) =>
            error?.name === "LearnWorkerConflictError" &&
            /Another Learn worker is already active/.test(error.message),
        );
      } finally {
        if (previousRoot === undefined) {
          delete process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR;
        } else {
          process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR = previousRoot;
        }
        if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previousNodeEnv;
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
      }
      assert.equal(globalThis[STATE_KEY].callbacks.length, 0);
    },
  );
});

test("worker promotion collision never overwrites a replacement marker", async () => {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "learn-worker-promotion-collision-"),
  );
  const temporaryDashboard = path.join(temporaryRoot, "dashboard");
  const contentPath = path.join(temporaryRoot, "content");
  const runtimeRoot = path.join(temporaryRoot, ".runtime", "learn-workers");
  const markerPath = path.join(runtimeRoot, "learn-worker.active.json");
  const startupPath = path.join(runtimeRoot, "learn-worker-collision.start.json");
  const receiptPath = path.join(runtimeRoot, "learn-worker-collision.ready.json");
  const hookPath = path.join(temporaryDashboard, "collision-hook.mjs");
  fs.mkdirSync(temporaryDashboard, { recursive: true });
  fs.mkdirSync(contentPath, { recursive: true });
  fs.mkdirSync(runtimeRoot, { recursive: true });

  const requestId = "promotion-collision-request";
  const nonce = "promotion-collision-nonce";
  const replacement = {
    protocolVersion: 1,
    requestId: "replacement-request",
    nonce: "replacement-nonce",
    pid: process.pid,
    state: "running",
  };
  fs.writeFileSync(
    markerPath,
    `${JSON.stringify({
      protocolVersion: 1,
      requestId,
      nonce,
      pid: process.pid,
      state: "launching",
    })}\n`,
    "utf8",
  );
  fs.writeFileSync(
    startupPath,
    `${JSON.stringify({
      protocolVersion: 1,
      type: "start",
      requestId,
      receiptPath,
      concurrencyPath: markerPath,
      concurrencyNonce: nonce,
      request: {
        operation: "humanizer",
        gardenId: "promotion-collision-garden",
        userId: 1,
        contentPath,
        enabled: true,
      },
    })}\n`,
    "utf8",
  );
  fs.writeFileSync(
    hookPath,
    `
      import fs from "node:fs";
      import path from "node:path";

      const markerPath = path.resolve(${JSON.stringify(markerPath)});
      const replacement = ${JSON.stringify(replacement)};
      const renameSync = fs.renameSync.bind(fs);
      fs.renameSync = (source, target) => {
        const resolvedSource = path.resolve(source);
        const resolvedTarget = path.resolve(target);
        if (
          resolvedSource.includes(".promoting-") &&
          resolvedTarget === markerPath
        ) {
          // Emulate POSIX rename-over-destination semantics on every host.
          fs.rmSync(markerPath, { force: true });
        }
        const result = renameSync(source, target);
        if (
          resolvedSource === markerPath &&
          resolvedTarget.includes(".promoting-")
        ) {
          fs.writeFileSync(markerPath, JSON.stringify(replacement) + "\\n", {
            flag: "wx",
          });
        }
        return result;
      };
    `,
    "utf8",
  );

  const child = spawn(
    process.execPath,
    [
      "--import",
      pathToFileURL(hookPath).href,
      path.join(dashboardRoot, "scripts", "learn-worker.mjs"),
      "--breadboard-learn-start-file",
      startupPath,
    ],
    {
      cwd: temporaryDashboard,
      windowsHide: true,
      env: { ...process.env, QUARTZ_CONTENT_PATH: contentPath },
      stdio: ["ignore", "ignore", "ignore"],
    },
  );
  try {
    const exit = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    assert.notEqual(exit.code, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(markerPath, "utf8")), replacement);
    assert.equal(
      fs.readdirSync(runtimeRoot).some((name) => name.includes(".promoting-")),
      false,
    );
  } finally {
    if (child.exitCode === null) child.kill();
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("durable workers honor a configured runtime root", async () => {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "learn-worker-configured-runtime-"),
  );
  const runtimeRoot = path.join(
    temporaryRoot,
    "desktop runtime with spaces",
    "learn-workers",
  );
  const contentPath = path.join(temporaryRoot, "content");
  const markerPath = path.join(runtimeRoot, "learn-worker.active.json");
  const startupPath = path.join(runtimeRoot, "learn-worker-configured.start.json");
  const receiptPath = path.join(runtimeRoot, "learn-worker-configured.ready.json");
  const requestId = "configured-runtime-request";
  const nonce = "configured-runtime-nonce";
  fs.mkdirSync(runtimeRoot, { recursive: true });
  fs.mkdirSync(contentPath, { recursive: true });
  fs.writeFileSync(
    markerPath,
    `${JSON.stringify({
      protocolVersion: 1,
      requestId,
      nonce,
      pid: process.pid,
      state: "launching",
    })}\n`,
    "utf8",
  );
  fs.writeFileSync(
    startupPath,
    `${JSON.stringify({
      protocolVersion: 1,
      type: "start",
      requestId,
      receiptPath,
      concurrencyPath: markerPath,
      concurrencyNonce: nonce,
      request: {
        operation: "humanizer",
        gardenId: "configured-runtime-garden",
        userId: 1,
        contentPath,
        enabled: "invalid-on-purpose",
      },
    })}\n`,
    "utf8",
  );

  const child = spawn(
    process.execPath,
    [
      path.join(dashboardRoot, "scripts", "learn-worker.mjs"),
      "--breadboard-learn-start-file",
      startupPath,
    ],
    {
      cwd: dashboardRoot,
      windowsHide: true,
      env: {
        ...process.env,
        BREADBOARD_LEARN_WORKER_RUNTIME_DIR: runtimeRoot,
        QUARTZ_CONTENT_PATH: contentPath,
      },
      stdio: ["ignore", "ignore", "ignore"],
    },
  );
  try {
    const exit = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    assert.deepEqual(exit, { code: 1, signal: null });
    assert.equal(fs.existsSync(startupPath), false);
    const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
    assert.equal(receipt.type, "failed");
    assert.equal(receipt.requestId, requestId);
    assert.match(receipt.error.message, /Learn humanizer request is invalid/i);
    assert.doesNotMatch(receipt.error.message, /outside its runtime root/i);
    const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
    assert.equal(marker.state, "running");
    assert.equal(marker.pid, child.pid);
  } finally {
    if (child.exitCode === null) child.kill();
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

describe("long Learn route handoff contracts", () => {
  const routes = [
    ["plan", "plan"],
    ["generate", "generate"],
    ["confirm", "confirm_generate"],
    ["regenerate", "repair"],
    ["rebuild", "rebuild"],
    ["humanizer", "humanizer"],
  ];

  for (const [action, workerOperation] of routes) {
    test(`${action} uses the isolated operation facade and returns an exact receipt`, () => {
      const routePath = path.join(
        dashboardRoot,
        "src",
        "app",
        "api",
        "gardens",
        "[gardenId]",
        "learn",
        action,
        "route.ts",
      );
      const source = fs.readFileSync(routePath, "utf8");

      assert.match(source, /executeLearnOperationForRoute/);
      assert.match(source, /from "breadboard-learn-operation-runtime"/);
      assert.doesNotMatch(source, /from "@\/lib\/(?:learn|knowledge)"/);
      assert.doesNotMatch(source, /\bgetLearnStatusSnapshot\s*\(|handOffLearnTask/);
      assert.match(
        source,
        new RegExp(`operation:\\s*"${workerOperation}"`),
        `${action} must give the detached worker an explicit operation contract`,
      );
      assert.match(
        source,
        /if \(execution\.accepted\) \{[\s\S]*?accepted: true,[\s\S]*?jobId: execution\.jobId \?\? null,[\s\S]*?\{ status: 202 \}[\s\S]*?\}/,
      );
    });
  }
});

test("development Learn workers are detached, IPC-gated, and load the same source pipeline", () => {
  const background = fs.readFileSync(backgroundEntry, "utf8");
  const worker = fs.readFileSync(
    path.join(dashboardRoot, "scripts", "learn-worker.mjs"),
    "utf8",
  );
  const windowsLauncher = fs.readFileSync(
    path.join(dashboardRoot, "scripts", "windows-breakaway-process.mjs"),
    "utf8",
  );
  const executor = fs.readFileSync(
    path.join(dashboardRoot, "src", "lib", "learn-operation-executor.ts"),
    "utf8",
  );
  const nextConfig = fs.readFileSync(
    path.join(dashboardRoot, "next.config.ts"),
    "utf8",
  );
  const hook = fs.readFileSync(
    path.join(dashboardRoot, "scripts", "learn-worker-import-hook.mjs"),
    "utf8",
  );
  const dashboardPackage = JSON.parse(
    fs.readFileSync(path.join(dashboardRoot, "package.json"), "utf8"),
  );
  const repositoryReadme = fs.readFileSync(
    path.join(dashboardRoot, "..", "README.md"),
    "utf8",
  );

  assert.match(background, /detached:\s*true/);
  assert.match(background, /stdio:\s*\["ignore", logFd, logFd, "ipc"\]/);
  assert.match(background, /message\.type === "failed"/);
  assert.match(background, /message\.type === "completed"/);
  assert.match(background, /LEARN_WORKER_PROTOCOL_VERSION = 1/);
  assert.match(background, /readWorkerReadyReceipt/);
  assert.match(background, /linkSync\(claimPath, markerPath\)/);
  assert.match(background, /--max-old-space-size=4096/);
  assert.match(background, /assertDedicatedWorkerNodeVersion\(\)/);
  assert.match(windowsLauncher, /CREATE_BREAKAWAY_FROM_JOB/);
  assert.match(windowsLauncher, /EXTENDED_STARTUPINFO_PRESENT/);
  assert.match(windowsLauncher, /PROC_THREAD_ATTRIBUTE_HANDLE_LIST/);
  assert.match(windowsLauncher, /UpdateProcThreadAttribute/);
  assert.match(worker, /const ready = response\(\{[\s\S]*?type:\s*"ready"[\s\S]*?jobId,/);
  assert.match(worker, /writeReadyReceipt/);
  assert.match(worker, /renameSync\(concurrencyPath, transitionPath\)/);
  assert.match(worker, /openSync\(concurrencyPath, "wx"\)/);
  assert.match(worker, /const keepalive = setInterval/);
  assert.match(worker, /executeAdmittedLearnOperation/);
  assert.doesNotMatch(worker, /getLearnStatusSnapshot/);
  assert.match(executor, /runLearnPipeline/);
  assert.match(executor, /runTextbookGeneration/);
  assert.match(executor, /runLearnRepairOperation/);
  assert.match(nextConfig, /learn-operation-runtime\.dev\.ts/);
  assert.match(nextConfig, /learn-operation-runtime\.production\.ts/);
  assert.match(hook, /registerHooks/);
  assert.match(hook, /specifier\.startsWith\("@\/"\)/);
  assert.equal(dashboardPackage.engines.node, "^22.15.0 || >=23.5.0");
  assert.match(repositoryReadme, /Node\.js 22\.15\+, 23\.5\+, or 24\+/);
});

test("detached planning requires an explicit selection and preserves a nullable syllabus", () => {
  const background = fs.readFileSync(backgroundEntry, "utf8");
  const worker = fs.readFileSync(
    path.join(dashboardRoot, "scripts", "learn-worker.mjs"),
    "utf8",
  );
  const planTypeStart = background.indexOf('operation: "plan";');
  const planTypeEnd = background.indexOf('operation: "generate";', planTypeStart);
  assert.ok(planTypeStart >= 0 && planTypeEnd > planTypeStart);
  const planType = background.slice(planTypeStart, planTypeEnd);
  assert.match(planType, /includedSourceIds: string\[\];/);
  assert.match(planType, /syllabusSourceId: string \| null;/);
  assert.doesNotMatch(planType, /includedSourceIds\?:|syllabusSourceId\?:/);

  const planValidationStart = worker.indexOf('case "plan":');
  const planValidationEnd = worker.indexOf('case "generate":', planValidationStart);
  assert.ok(planValidationStart >= 0 && planValidationEnd > planValidationStart);
  const planValidation = worker.slice(planValidationStart, planValidationEnd);
  assert.match(worker, /candidate === null/);
  assert.match(planValidation, /nonEmptyUniqueStringArray\(value\.includedSourceIds\)/);
  assert.match(planValidation, /nullableNonEmptyString\(value\.syllabusSourceId\)/);
  assert.match(
    planValidation,
    /sourceId\.trim\(\) === value\.syllabusSourceId\.trim\(\)/,
  );
  assert.match(background, /child\.send\([\s\S]*?\brequest,\s*[\s\S]*?\)/);
});

test("Learn pipelines reach the handoff only after durable state and before heavy work", () => {
  const source = fs.readFileSync(
    path.join(dashboardRoot, "src", "lib", "learn.ts"),
    "utf8",
  );
  const sliceFunction = (name, nextName) => {
    const start = source.indexOf(`export async function ${name}`);
    const end = nextName ? source.indexOf(nextName, start + 1) : source.length;
    assert.ok(start >= 0 && end > start, `${name} source must be discoverable`);
    return source.slice(start, end);
  };

  const planning = sliceFunction("runLearnPlanning", "export function confirmLearningMap");
  assert.ok(planning.indexOf("createLearnJob({") < planning.indexOf("await yieldToResponse?.(job.id)"));
  assert.ok(planning.indexOf("await yieldToResponse?.(job.id)") < planning.indexOf("await ensureSourceVisualsExtracted({"));

  const generation = sliceFunction("runTextbookGeneration", "export interface FullRebuildOptions");
  assert.ok(generation.indexOf("createLearnJob({") < generation.indexOf("await yieldToResponse?.(job.id)"));
  assert.ok(generation.indexOf("await yieldToResponse?.(job.id)") < generation.indexOf("createLearnBuildWorkspace({"));

  const repair = sliceFunction("runLearnRepairOperation", "export async function runLearnPipeline");
  assert.ok(repair.indexOf("createLearnJob({") < repair.indexOf("await yieldToResponse?.(job.id)"));
  assert.ok(repair.indexOf("await yieldToResponse?.(job.id)") < repair.indexOf("await executeLearnScopedRepair({"));
});

test("workspace treats accepted Learn work as started, never completed", () => {
  const source = fs.readFileSync(workspacePath, "utf8");
  const actionStart = source.indexOf("const postLearnAction = useCallback");
  const acceptedStart = source.indexOf("if (data.accepted === true) {", actionStart);
  const completedBranchStart = source.indexOf('if (endpoint === "clear") {', acceptedStart);
  assert.ok(acceptedStart >= 0 && completedBranchStart > acceptedStart);
  const acceptedBranch = source.slice(acceptedStart, completedBranchStart);

  assert.match(acceptedBranch, /await fetchLearnStatus\(\)/);
  assert.match(acceptedBranch, /Learning map generation started/);
  assert.match(acceptedBranch, /Issue repair started/);
  assert.match(acceptedBranch, /Garden rebuild started/);
  assert.match(acceptedBranch, /Lesson generation started/);
  assert.match(acceptedBranch, /return true/);

  assert.doesNotMatch(acceptedBranch, /fetchDocuments|setGraphRefreshVersion/);
  assert.doesNotMatch(
    acceptedBranch,
    /Learning map ready to review|Issues repaired|Garden rebuilt|Lessons generated/,
  );
});
