import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import esbuild from "esbuild";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const instrumentationPath = path.join(dashboardRoot, "src", "instrumentation-node.ts");
const launcherPath = path.join(
  dashboardRoot,
  "src",
  "lib",
  "learn-recovery-background.ts",
);
const workerPath = path.join(dashboardRoot, "scripts", "learn-recovery-worker.mjs");
const instrumentationSource = fs.readFileSync(instrumentationPath, "utf8");
const launcherSource = fs.readFileSync(launcherPath, "utf8");
const workerSource = fs.readFileSync(workerPath, "utf8");
const STATE_KEY = "__breadboardLearnRecoveryLauncherTestState";

async function loadLauncher() {
  const result = await esbuild.build({
    entryPoints: [launcherPath],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    write: false,
    plugins: [
      {
        name: "learn-recovery-launcher-test-stubs",
        setup(build) {
          build.onResolve({ filter: /^server-only$/ }, () => ({
            path: "server-only",
            namespace: "learn-recovery-stub",
          }));
          build.onResolve({ filter: /^node:child_process$/ }, () => ({
            path: "node:child_process",
            namespace: "learn-recovery-stub",
          }));
          build.onLoad(
            { filter: /.*/, namespace: "learn-recovery-stub" },
            (args) => ({
              loader: "js",
              contents:
                args.path === "server-only"
                  ? "export {};"
                  : `
                      import { EventEmitter } from "node:events";
                      export function spawn(command, args, options) {
                        const child = new EventEmitter();
                        child.pid = 4242;
                        child.unref = () => {
                          globalThis[${JSON.stringify(STATE_KEY)}].unrefCount += 1;
                        };
                        globalThis[${JSON.stringify(STATE_KEY)}].calls.push({
                          command,
                          args,
                          options,
                          child,
                        });
                        return child;
                      }
                    `,
            }),
          );
        },
      },
    ],
  });
  const encoded = Buffer.from(result.outputFiles[0].text).toString("base64");
  return import(`data:text/javascript;base64,${encoded}#learn-startup-recovery`);
}

test("Next instrumentation delegates Learn recovery without referencing the Learn monolith", () => {
  assert.match(
    instrumentationSource,
    /import \{ launchAbandonedLearnRecoveryWorker \} from "\.\/lib\/learn-recovery-background\.ts"/,
  );
  assert.match(instrumentationSource, /await launchAbandonedLearnRecoveryWorker\(\)/);
  assert.doesNotMatch(instrumentationSource, /learn\.ts|recoverAbandonedLearnJobs/);
  assert.match(instrumentationSource, /setTimeout\(\(\) => void sweep\(\), 0\)/);
  assert.match(
    instrumentationSource,
    /setInterval\(\(\) => void sweep\(\), 60 \* 1000\)/,
  );
});

test("the fixed detached worker imports and invokes the real recovery operation", () => {
  assert.match(launcherSource, /path\.join\(dashboardRoot, "scripts", "learn-recovery-worker\.mjs"\)/);
  assert.match(launcherSource, /detached:\s*true/);
  assert.match(launcherSource, /windowsHide:\s*true/);
  assert.match(launcherSource, /stdio:\s*\["ignore", logFd, logFd\]/);
  assert.match(launcherSource, /__breadboardLearnRecoveryWorker/);
  assert.match(workerSource, /process\.env\.QUARTZ_CONTENT_PATH\?\.trim\(\)/);
  assert.doesNotMatch(workerSource, /process\.argv/);
  assert.match(workerSource, /await import\("\.\.\/src\/lib\/learn\.ts"\)/);
  assert.match(workerSource, /await learn\.recoverAbandonedLearnJobs\(\{/);
  assert.match(workerSource, /acquireRecoveryLock/);
});

test("the recovery script executes the real Learn recovery module in a child process", async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "learn-recovery-worker-"));
  const dataRoot = path.join(temporaryRoot, "data");
  const contentRoot = path.join(temporaryRoot, "content");
  const runtimeRoot = path.join(temporaryRoot, "runtime");
  fs.mkdirSync(dataRoot, { recursive: true });
  fs.mkdirSync(contentRoot, { recursive: true });
  fs.mkdirSync(runtimeRoot, { recursive: true });

  try {
    const child = spawn(
      process.execPath,
      [
        "--experimental-strip-types",
        "--import",
        pathToFileURL(
          path.join(dashboardRoot, "scripts", "learn-worker-import-hook.mjs"),
        ).href,
        workerPath,
      ],
      {
        cwd: dashboardRoot,
        windowsHide: true,
        env: {
          ...process.env,
          BREADBOARD_DATA_DIR: dataRoot,
          BREADBOARD_LEARN_RECOVERY_RUNTIME_DIR: runtimeRoot,
          QUARTZ_CONTENT_PATH: contentRoot,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error("The real Learn recovery worker did not finish within 60 seconds."));
      }, 60_000);
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("exit", (code, signal) => {
        clearTimeout(timeout);
        resolve({ code, signal });
      });
    });

    assert.deepEqual(result, { code: 0, signal: null }, stderr);
    assert.match(stdout, /\[learn-recovery-worker\] Recovery sweep completed\./);
    assert.equal(fs.existsSync(path.join(runtimeRoot, "active.lock")), false);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("the launcher normalizes the authoritative content path and remains single-flight", async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "learn-recovery-launcher-"));
  const contentPath = path.join(temporaryRoot, "quartz", "content", "..");
  const previousDashboardRoot = process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR;
  const previousDataRoot = process.env.BREADBOARD_DATA_DIR;
  const previousContentPath = process.env.QUARTZ_CONTENT_PATH;
  globalThis[STATE_KEY] = { calls: [], unrefCount: 0 };

  process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR = dashboardRoot;
  process.env.BREADBOARD_DATA_DIR = temporaryRoot;
  process.env.QUARTZ_CONTENT_PATH = contentPath;

  try {
    const { launchAbandonedLearnRecoveryWorker } = await loadLauncher();
    const first = launchAbandonedLearnRecoveryWorker();
    const concurrent = launchAbandonedLearnRecoveryWorker();
    assert.strictEqual(concurrent, first);
    assert.equal(globalThis[STATE_KEY].calls.length, 1);

    const call = globalThis[STATE_KEY].calls[0];
    assert.equal(call.command, process.execPath);
    assert.equal(
      call.args.at(-1),
      path.join(dashboardRoot, "scripts", "learn-recovery-worker.mjs"),
    );
    assert.equal(call.args.includes(path.resolve(contentPath)), false);
    assert.equal(call.options.cwd, dashboardRoot);
    assert.equal(call.options.detached, true);
    assert.equal(call.options.windowsHide, true);
    assert.equal(call.options.env.QUARTZ_CONTENT_PATH, path.resolve(contentPath));
    assert.equal(call.options.stdio[0], "ignore");
    assert.equal(call.options.stdio[1], call.options.stdio[2]);
    assert.equal(globalThis[STATE_KEY].unrefCount, 1);

    call.child.emit("exit", 0, null);
    await first;
    await Promise.resolve();

    const next = launchAbandonedLearnRecoveryWorker();
    assert.equal(globalThis[STATE_KEY].calls.length, 2);
    globalThis[STATE_KEY].calls[1].child.emit("exit", 0, null);
    await next;
  } finally {
    for (const call of globalThis[STATE_KEY].calls) {
      call.child.emit("exit", 0, null);
    }
    if (previousDashboardRoot === undefined) {
      delete process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR;
    } else {
      process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR = previousDashboardRoot;
    }
    if (previousDataRoot === undefined) delete process.env.BREADBOARD_DATA_DIR;
    else process.env.BREADBOARD_DATA_DIR = previousDataRoot;
    if (previousContentPath === undefined) delete process.env.QUARTZ_CONTENT_PATH;
    else process.env.QUARTZ_CONTENT_PATH = previousContentPath;
    delete globalThis[STATE_KEY];
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
