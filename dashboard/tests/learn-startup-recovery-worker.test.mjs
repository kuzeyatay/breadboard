import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nativeServiceEnginePath = path.join(
  path.dirname(dashboardRoot),
  "native",
  "runtime-cli",
  "src",
  "service_engine.rs",
);
const launcherPath = path.join(
  dashboardRoot,
  "src",
  "lib",
  "learn-recovery-background.ts",
);
const runtimeWorkerPath = path.join(
  dashboardRoot,
  "scripts",
  "runtime-v2-learn-worker.mjs",
);
const nativeControlPath = path.join(
  path.dirname(dashboardRoot),
  "native",
  "runtime-cli",
  "src",
  "control.rs",
);
const nativeServiceEngineSource = fs.readFileSync(nativeServiceEnginePath, "utf8");
const launcherSource = fs.readFileSync(launcherPath, "utf8");
const runtimeWorkerSource = fs.readFileSync(runtimeWorkerPath, "utf8");
const nativeControlSource = fs.readFileSync(nativeControlPath, "utf8");
const STATE_KEY = "__breadboardLearnRecoveryRuntimeTestState";

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
        name: "learn-recovery-runtime-test-stubs",
        setup(build) {
          build.onResolve({ filter: /^server-only$/ }, () => ({
            path: "server-only",
            namespace: "learn-recovery-stub",
          }));
          build.onResolve({ filter: /^@\/lib\/supervisor-control$/ }, () => ({
            path: "supervisor-control",
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
                      export function submitRuntimeLearnRecoveryJob(idempotencyKey) {
                        const state = globalThis[${JSON.stringify(STATE_KEY)}];
                        state.calls.push(idempotencyKey);
                        return new Promise((resolve, reject) => {
                          state.pending.push({ resolve, reject });
                        });
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

test("the native Runtime scheduler owns the bounded Learn recovery cadence", () => {
  assert.match(
    nativeServiceEngineSource,
    /RuntimeScheduleRegistration::fixed\("learn-recovery", 0, 60_000\)/u,
  );
  assert.match(
    nativeServiceEngineSource,
    /occurrence\.schedule_id == "learn-recovery"[\s\S]*?registry\.submit_job/u,
  );
  assert.match(
    nativeServiceEngineSource,
    /occurrence\.schedule_id == "learn-recovery"[\s\S]*?\("learn", serde_json::json!\(\{ "operation": "recovery" \}\)\)/u,
  );
  assert.equal(
    fs.existsSync(path.join(dashboardRoot, "src", "instrumentation-node.ts")),
    false,
    "Next.js must not own recovery timers or a duplicate scheduler",
  );
});

test("Learn recovery is one native-owned finite job, not a detached child", () => {
  assert.match(launcherSource, /submitRuntimeLearnRecoveryJob/u);
  assert.match(launcherSource, /learn-recovery-v2:/u);
  assert.doesNotMatch(launcherSource, /submitRuntimeJob|jobType|requestPayload/u);
  assert.doesNotMatch(
    launcherSource,
    /node:child_process|\b(?:fork|spawn)\s*\(|detached\s*:|\.unref\(\)/u,
  );
  assert.match(runtimeWorkerSource, /value\.operation === "recovery"/u);
  assert.match(runtimeWorkerSource, /scope\.userId !== null/u);
  assert.match(runtimeWorkerSource, /learnModule\.recoverAbandonedLearnJobs/u);
  assert.match(runtimeWorkerSource, /events\.complete/u);
  assert.match(nativeControlSource, /\/v1\/internal\/jobs\/learn-recovery/u);
  assert.match(
    nativeControlSource,
    /trusted_internal_context\("learn-recovery", None, None\)/u,
  );
  assert.match(nativeControlSource, /job_type: "learn"\.into\(\)/u);
  assert.match(
    nativeControlSource,
    /request_payload: serde_json::json!\(\{ "operation": "recovery" \}\)/u,
  );
});

test("recovery submissions use one fixed internal generation and are single-flight", async () => {
  const priorContentPath = process.env.QUARTZ_CONTENT_PATH;
  process.env.QUARTZ_CONTENT_PATH = path.join(dashboardRoot, "test-content");
  globalThis[STATE_KEY] = { calls: [], pending: [] };
  try {
    const {
      launchAbandonedLearnRecoveryWorker,
      learnRecoveryGenerationForTests,
    } = await loadLauncher();
    assert.equal(
      learnRecoveryGenerationForTests(300_001),
      learnRecoveryGenerationForTests(599_999),
    );

    const first = launchAbandonedLearnRecoveryWorker();
    const concurrent = launchAbandonedLearnRecoveryWorker();
    assert.strictEqual(concurrent, first);
    assert.equal(globalThis[STATE_KEY].calls.length, 1);
    assert.match(
      globalThis[STATE_KEY].calls[0],
      /^learn-recovery-v2:\d+$/u,
    );

    globalThis[STATE_KEY].pending[0].resolve({ jobId: "job_recovery" });
    await first;
    await Promise.resolve();

    const next = launchAbandonedLearnRecoveryWorker();
    assert.equal(globalThis[STATE_KEY].calls.length, 2);
    globalThis[STATE_KEY].pending[1].resolve({ jobId: "job_recovery" });
    await next;
  } finally {
    if (priorContentPath === undefined) delete process.env.QUARTZ_CONTENT_PATH;
    else process.env.QUARTZ_CONTENT_PATH = priorContentPath;
    delete globalThis[STATE_KEY];
  }
});
