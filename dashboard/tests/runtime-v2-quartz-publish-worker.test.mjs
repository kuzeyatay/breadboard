import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  loadRuntimeV2QuartzPublishLaunch,
  parseRuntimeV2QuartzStopRecord,
} from "../scripts/runtime-v2-quartz-publish-worker.mjs";

const dashboardRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repoRoot = path.dirname(dashboardRoot);

function fixture(scope = { userId: 7, gardenId: null, conversationId: null }) {
  const dataRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "breadboard-quartz-worker-test-"),
  );
  const identity = {
    jobId: "job_quartz_test",
    attempt: 1,
    workerInstanceId: "worker_quartz_test",
  };
  const jobRoot = path.join(dataRoot, "runtime", "jobs", identity.jobId);
  const attemptRoot = path.join(
    jobRoot,
    "attempts",
    String(identity.attempt),
    identity.workerInstanceId,
  );
  fs.mkdirSync(path.join(attemptRoot, "workspace"), { recursive: true });
  fs.writeFileSync(
    path.join(jobRoot, "input.json"),
    `${JSON.stringify({
      operation: "publish",
      reasons: ["update garden test"],
      concurrency: 1,
      timeoutMs: 10_000,
      buildEnvironment: { DASHBOARD_URL: "http://127.0.0.1:3000" },
    })}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(attemptRoot, "start.json"),
    `${JSON.stringify({
      protocolVersion: 1,
      identity,
      executionScope: scope,
      inputManifestPath: `runtime/jobs/${identity.jobId}/input.json`,
      inputBlobs: [],
      workspacePath: `runtime/jobs/${identity.jobId}/attempts/1/${identity.workerInstanceId}/workspace`,
      checkpointPath: `runtime/jobs/${identity.jobId}/checkpoint.json`,
      resultPath: `runtime/jobs/${identity.jobId}/result.json`,
    })}\n`,
    "utf8",
  );
  return { dataRoot, attemptRoot, identity };
}

function installFakeQuartz(current) {
  const quartzRoot = path.join(current.dataRoot, "quartz");
  const quartzCliDirectory = path.join(quartzRoot, "quartz");
  fs.mkdirSync(path.join(quartzRoot, "content"), { recursive: true });
  fs.mkdirSync(quartzCliDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(quartzRoot, "package.json"),
    '{"private":true,"type":"module"}\n',
    "utf8",
  );
  fs.writeFileSync(
    path.join(quartzCliDirectory, "bootstrap-cli.mjs"),
    [
      'import fs from "node:fs";',
      'import path from "node:path";',
      'const output = process.argv.find((value) => value.startsWith("--output="))?.slice(9);',
      'if (!output) throw new Error("missing output");',
      'fs.mkdirSync(output, { recursive: true });',
      'fs.writeFileSync(path.join(output, "index.html"), "published", "utf8");',
    ].join("\n"),
    "utf8",
  );
}

function readNextSourceTree(directory) {
  let source = "";
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      source += readNextSourceTree(absolute);
    } else if (/\.(?:ts|tsx|mjs)$/u.test(entry.name)) {
      source += `\n/* ${absolute} */\n${fs.readFileSync(absolute, "utf8")}`;
    }
  }
  return source;
}

test("Quartz worker accepts only authenticated user-global Runtime authority", () => {
  const valid = fixture();
  const scoped = fixture({ userId: 7, gardenId: "garden-1", conversationId: null });
  const internal = fixture({ userId: null, gardenId: null, conversationId: null });
  try {
    const launch = loadRuntimeV2QuartzPublishLaunch(
      ["start.json"],
      valid.attemptRoot,
    );
    assert.deepEqual(launch.executionScope, {
      userId: 7,
      gardenId: null,
      conversationId: null,
    });
    assert.deepEqual(launch.request.reasons, ["update garden test"]);
    assert.throws(
      () => loadRuntimeV2QuartzPublishLaunch(["start.json"], scoped.attemptRoot),
      /user-global authority/u,
    );
    assert.throws(
      () => loadRuntimeV2QuartzPublishLaunch(["start.json"], internal.attemptRoot),
      /user-global authority/u,
    );
  } finally {
    for (const item of [valid, scoped, internal]) {
      fs.rmSync(item.dataRoot, { recursive: true, force: true });
    }
  }
});

test("Quartz worker stop input is exact and bounded", () => {
  assert.deepEqual(parseRuntimeV2QuartzStopRecord('{"type":"stop","force":false}\n'), {
    type: "stop",
    force: false,
  });
  for (const invalid of [
    '{"type":"stop","force":true}\n',
    '{"type":"stop","force":false,"jobId":"forged"}\n',
    '{"type":"stop","force":false}',
    "{}\n",
  ]) {
    assert.throws(() => parseRuntimeV2QuartzStopRecord(invalid), /stop record/u);
  }
});

test("a fresh Quartz Runtime worker publishes one bounded result and exits", async () => {
  const current = fixture();
  installFakeQuartz(current);
  const workerPath = path.join(
    dashboardRoot,
    "scripts",
    "runtime-v2-quartz-publish-worker.mjs",
  );
  try {
    const child = spawn(process.execPath, [workerPath, "start.json"], {
      cwd: current.attemptRoot,
      env:
        process.platform === "win32"
          ? {
              SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
              BREADBOARD_QUARTZ_SOURCE_ROOT: path.join(current.dataRoot, "quartz"),
            }
          : { BREADBOARD_QUARTZ_SOURCE_ROOT: path.join(current.dataRoot, "quartz") },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdin.end();
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout = `${stdout}${chunk}`;
    });
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-64 * 1024);
    });
    const exit = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error("The fresh Quartz worker did not exit."));
      }, 10_000);
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("close", (code, signal) => {
        clearTimeout(timeout);
        resolve({ code, signal });
      });
    });
    assert.deepEqual(exit, { code: 0, signal: null }, stderr);
    const events = stdout
      .trim()
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    assert.equal(events[0]?.type, "ready");
    assert.equal(events.at(-1)?.type, "complete");
    assert.ok(
      events.every(
        (event, index) =>
          event.sequence === index + 1 &&
          JSON.stringify(event.identity) === JSON.stringify(current.identity),
      ),
    );
    const result = JSON.parse(
      fs.readFileSync(
        path.join(
          current.dataRoot,
          "runtime",
          "jobs",
          current.identity.jobId,
          "result.json",
        ),
        "utf8",
      ),
    );
    assert.deepEqual(result.identity, current.identity);
    assert.equal(result.completionSequence, events.at(-1).sequence);
    assert.deepEqual(
      {
        published: result.result.published,
        reasonCount: result.result.reasonCount,
      },
      { published: true, reasonCount: 1 },
    );
    assert.equal(
      fs.readFileSync(
        path.join(current.dataRoot, "quartz", "public", "index.html"),
        "utf8",
      ),
      "published",
    );
  } finally {
    fs.rmSync(current.dataRoot, { recursive: true, force: true });
  }
});

test("Next has no Quartz compiler spawn or fallback after Runtime V2 cutover", () => {
  const compatibility = fs.readFileSync(
    path.join(dashboardRoot, "src", "lib", "quartz-publish.ts"),
    "utf8",
  );
  const worker = fs.readFileSync(
    path.join(dashboardRoot, "scripts", "runtime-v2-quartz-publish-worker.mjs"),
    "utf8",
  );
  const executor = fs.readFileSync(
    path.join(dashboardRoot, "scripts", "runtime-v2-quartz-publish-executor.mjs"),
    "utf8",
  );
  const nextSource = readNextSourceTree(path.join(dashboardRoot, "src"));
  assert.doesNotMatch(
    compatibility,
    /node:child_process|\bspawn\s*\(|bootstrap-cli\.mjs|\.breadboard-quartz-publish\.lock/u,
  );
  assert.match(compatibility, /submitRuntimeJob/u);
  assert.match(compatibility, /gardenId:\s*null/u);
  assert.match(compatibility, /conversationId:\s*null/u);
  assert.match(compatibility, /jobType:\s*"quartz-publish"/u);
  assert.match(worker, /createSealedRuntimeV2QuartzPublishExecutor/u);
  assert.match(worker, /cancellationAcknowledged/u);
  assert.match(executor, /from "node:child_process"/u);
  assert.match(executor, /process\.argv\.length !== 3/u);
  assert.match(executor, /--output=/u);
  assert.doesNotMatch(nextSource, /bootstrap-cli\.mjs/u);
  assert.doesNotMatch(nextSource, /runtime-v2-quartz-publish-executor/u);
});

test("Quartz publish is a fresh bounded disposable manifest worker and is packaged", () => {
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(repoRoot, "desktop", "runtime-v2", "manifests", "workers.json"),
      "utf8",
    ),
  );
  const worker = manifest.workers.find(
    ({ kind }) => kind === "quartz-publish-node",
  );
  assert.ok(worker);
  assert.deepEqual(worker.jobTypes, ["quartz-publish"]);
  assert.deepEqual(worker.capabilityIds, ["workflow:quartz-publishing"]);
  assert.equal(worker.maximumConcurrency, 1);
  assert.equal(worker.minimumInputBlobs, 0);
  assert.equal(worker.maximumInputBlobs, 0);
  assert.equal(worker.workspacePolicy, "private-per-job");
  assert.equal(worker.exitAfterJob, true);
  assert.equal(
    worker.allowedEntrypoint,
    "dashboard/scripts/runtime-v2-quartz-publish-worker.mjs",
  );

  const staging = fs.readFileSync(
    path.join(repoRoot, "desktop", "scripts", "prepare-app-resources.mjs"),
    "utf8",
  );
  assert.match(staging, /"runtime-v2-quartz-publish-worker\.mjs"/u);
  assert.match(staging, /"runtime-v2-quartz-publish-executor\.mjs"/u);
});
