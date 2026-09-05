import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  atomicWrite,
  canonicalRuntimeV2IngestBlobPath,
  createRuntimeV2IngestionEventWriter,
  loadRuntimeV2DocumentIngestionLaunch,
  openCanonicalRuntimeV2IngestBlob,
  parseRuntimeV2IngestionStopRecord,
  serializeRuntimeV2DocumentIngestionResult,
  shouldCleanupCreatedIngestionAssets,
  validateRuntimeV2DocumentIngestionRequest,
} from "../scripts/runtime-v2-document-ingestion-worker.mjs";

const dashboardRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repoRoot = path.resolve(dashboardRoot, "..");

test("a terminal event write failure preserves assets after the garden commit", () => {
  assert.equal(shouldCleanupCreatedIngestionAssets("committed"), false);
  assert.equal(shouldCleanupCreatedIngestionAssets("active"), false);
  assert.equal(shouldCleanupCreatedIngestionAssets("rolled-back"), true);
  assert.equal(shouldCleanupCreatedIngestionAssets("none"), true);
});

test("ingestion checkpoints are deleted only after the garden transaction commits", () => {
  const worker = fs.readFileSync(
    path.join(dashboardRoot, "scripts", "runtime-v2-document-ingestion-worker.mjs"),
    "utf8",
  );
  const runIngestCall = worker.indexOf("const value = await ingestModule.runIngest({");
  const deferredArgument = worker.indexOf("deferredCheckpointCleanupPaths,", runIngestCall);
  const commit = worker.indexOf("knowledgeWriteTransaction.commit();", deferredArgument);
  const cleanup = worker.indexOf("for (const checkpointPath of deferredCheckpointCleanupPaths.splice(0))", commit);

  assert.ok(runIngestCall >= 0, "expected Runtime V2 to call the ingest executor");
  assert.ok(deferredArgument > runIngestCall, "expected checkpoint cleanup to be deferred");
  assert.ok(commit > deferredArgument, "expected the external commit after ingestion");
  assert.ok(cleanup > commit, "checkpoint deletion must happen only after commit");
});

test("atomic output writes retry transient Windows rename failures", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "runtime-v2-atomic-write-"),
  );
  const outputPath = path.join(directory, "checkpoint.json");
  fs.writeFileSync(outputPath, "old\n", "utf8");
  const waits = [];
  let renameAttempts = 0;

  try {
    atomicWrite(outputPath, Buffer.from("new\n", "utf8"), true, {
      renameSync(source, destination) {
        renameAttempts += 1;
        if (renameAttempts < 3) {
          const error = new Error("operation not permitted");
          error.code = "EPERM";
          throw error;
        }
        fs.renameSync(source, destination);
      },
      waitSync(milliseconds) {
        waits.push(milliseconds);
      },
    });

    assert.equal(fs.readFileSync(outputPath, "utf8"), "new\n");
    assert.equal(renameAttempts, 3);
    assert.deepEqual(waits, [10, 25]);
    assert.deepEqual(fs.readdirSync(directory).sort(), ["checkpoint.json"]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("atomic output writes retry a transient lock while syncing the installed file", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "runtime-v2-atomic-fsync-"),
  );
  const outputPath = path.join(directory, "checkpoint.json");
  fs.writeFileSync(outputPath, "old\n", "utf8");
  const waits = [];
  let fsyncAttempts = 0;

  try {
    atomicWrite(outputPath, Buffer.from("new\n", "utf8"), true, {
      fsyncOutputFile() {
        fsyncAttempts += 1;
        if (fsyncAttempts < 3) {
          const error = new Error("resource busy or locked");
          error.code = "EBUSY";
          throw error;
        }
      },
      waitSync(milliseconds) {
        waits.push(milliseconds);
      },
    });

    assert.equal(fs.readFileSync(outputPath, "utf8"), "new\n");
    assert.equal(fsyncAttempts, 3);
    assert.deepEqual(waits, [10, 25]);
    assert.deepEqual(fs.readdirSync(directory).sort(), ["checkpoint.json"]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function pathWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function fixture() {
  const dataRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "runtime-v2-ingest-worker-"),
  );
  const identity = {
    jobId: "job_ingest_1",
    attempt: 2,
    workerInstanceId: "worker_ingest_1",
  };
  const executionScope = {
    userId: 42,
    gardenId: "garden-1",
    conversationId: null,
  };
  const bytes = Buffer.from(
    "# Runtime V2\n\nA canonical staged document.\n",
    "utf8",
  );
  const blobId = "blob_0123456789abcdef0123456789abcdef";
  const inputBlob = {
    blobId,
    relativePath: `runtime/jobs/${identity.jobId}/inputs/${blobId}/payload`,
    sizeBytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    displayName: "runtime-v2.md",
    mediaType: "text/markdown",
  };
  const blobPath = canonicalRuntimeV2IngestBlobPath(dataRoot, inputBlob);
  const jobRoot = path.join(dataRoot, "runtime", "jobs", identity.jobId);
  const attemptRoot = path.join(
    jobRoot,
    "attempts",
    String(identity.attempt),
    identity.workerInstanceId,
  );
  fs.mkdirSync(path.join(attemptRoot, "workspace"), { recursive: true });
  fs.mkdirSync(path.dirname(blobPath), { recursive: true });
  fs.writeFileSync(blobPath, bytes);
  const request = {
    sourceLabel: null,
    isHandwriting: false,
    parseWithVlm: false,
    parseWithAnydoc: false,
    vlmTask: "doc_parse",
    generateMap: false,
    model: "selected-model",
    chatmockBaseUrl: null,
    maximumUploadBytes: 512 * 1024 * 1024,
  };
  fs.writeFileSync(path.join(jobRoot, "input.json"), JSON.stringify(request));
  fs.writeFileSync(
    path.join(attemptRoot, "start.json"),
    JSON.stringify({
      protocolVersion: 1,
      identity,
      executionScope,
      inputManifestPath: `runtime/jobs/${identity.jobId}/input.json`,
      inputBlobs: [inputBlob],
      workspacePath:
        `runtime/jobs/${identity.jobId}/attempts/${identity.attempt}/` +
        `${identity.workerInstanceId}/workspace`,
      checkpointPath: `runtime/jobs/${identity.jobId}/checkpoint.json`,
      resultPath: `runtime/jobs/${identity.jobId}/result.json`,
    }),
  );
  const quartzRoot = path.join(dataRoot, "quartz");
  const quartzCliDirectory = path.join(quartzRoot, "quartz");
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
      `const failNext = ${JSON.stringify(path.join(quartzRoot, ".test-fail-next"))};`,
      'if (fs.existsSync(failNext)) { fs.rmSync(failNext); console.error("synthetic Quartz failure"); process.exit(23); }',
      'const output = process.argv.find((value) => value.startsWith("--output="))?.slice(9);',
      'if (!output) throw new Error("missing bounded Quartz output");',
      'fs.mkdirSync(output, { recursive: true });',
      'fs.writeFileSync(path.join(output, "index.html"), "published", "utf8");',
    ].join("\n"),
    "utf8",
  );
  return {
    attemptRoot,
    blobPath,
    bytes,
    dataRoot,
    executionScope,
    identity,
    inputBlob,
    request,
  };
}

function nextAttempt(current) {
  const identity = {
    jobId: current.identity.jobId,
    attempt: current.identity.attempt + 1,
    workerInstanceId: `worker_ingest_${current.identity.attempt + 1}`,
  };
  const jobRoot = path.join(
    current.dataRoot,
    "runtime",
    "jobs",
    identity.jobId,
  );
  const attemptRoot = path.join(
    jobRoot,
    "attempts",
    String(identity.attempt),
    identity.workerInstanceId,
  );
  fs.mkdirSync(path.join(attemptRoot, "workspace"), { recursive: true });
  fs.writeFileSync(
    path.join(attemptRoot, "start.json"),
    JSON.stringify({
      protocolVersion: 1,
      identity,
      executionScope: current.executionScope,
      inputManifestPath: `runtime/jobs/${identity.jobId}/input.json`,
      inputBlobs: [current.inputBlob],
      workspacePath:
        `runtime/jobs/${identity.jobId}/attempts/${identity.attempt}/` +
        `${identity.workerInstanceId}/workspace`,
      checkpointPath: `runtime/jobs/${identity.jobId}/checkpoint.json`,
      resultPath: `runtime/jobs/${identity.jobId}/result.json`,
    }),
  );
  return { ...current, attemptRoot, identity };
}

async function runWorkerProcess(current, faultPoint = null) {
  const workerPath = path.join(
    dashboardRoot,
    "scripts",
    "runtime-v2-document-ingestion-worker.mjs",
  );
  const env =
    process.platform === "win32"
      ? {
          SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
          BREADBOARD_RUNTIME_V2_FAULT_INJECTION: "test-only",
          BREADBOARD_RUNTIME_V2_TEST_QUARTZ_SOURCE_ROOT: path.join(
            current.dataRoot,
            "quartz",
          ),
        }
      : {
          BREADBOARD_RUNTIME_V2_FAULT_INJECTION: "test-only",
          BREADBOARD_RUNTIME_V2_TEST_QUARTZ_SOURCE_ROOT: path.join(
            current.dataRoot,
            "quartz",
          ),
        };
  if (faultPoint) {
    env.BREADBOARD_RUNTIME_V2_INGEST_FAULT_POINT = faultPoint;
  }
  const child = spawn(process.execPath, [workerPath, "start.json"], {
    cwd: current.attemptRoot,
    env,
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
    if (Buffer.byteLength(stdout, "utf8") > 1024 * 1024) child.kill();
  });
  child.stderr.on("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-64 * 1024);
  });
  const exit = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(
        new Error(
          "The fault-injected ingestion worker did not exit within 10 seconds.",
        ),
      );
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
  return {
    ...exit,
    stderr,
    events: stdout
      .trim()
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line)),
  };
}

test("Runtime V2 ingestion launch accepts only its fenced start and scoped blob identity", () => {
  const current = fixture();
  try {
    const launch = loadRuntimeV2DocumentIngestionLaunch(
      ["start.json"],
      current.attemptRoot,
    );
    assert.deepEqual(launch.identity, current.identity);
    assert.deepEqual(launch.executionScope, current.executionScope);
    assert.equal(launch.request.sourceLabel, "upload");
    assert.equal(
      canonicalRuntimeV2IngestBlobPath(launch.dataRoot, launch.inputBlob),
      current.blobPath,
    );
    assert.throws(
      () =>
        loadRuntimeV2DocumentIngestionLaunch(
          ["other.json"],
          current.attemptRoot,
        ),
      /exactly the fixed start\.json argument/u,
    );

    const inputPath = path.join(
      current.dataRoot,
      "runtime",
      "jobs",
      current.identity.jobId,
      "input.json",
    );
    fs.writeFileSync(
      inputPath,
      JSON.stringify({
        ...current.request,
        filePath: "C:\\private\\document.pdf",
      }),
    );
    assert.throws(
      () =>
        loadRuntimeV2DocumentIngestionLaunch(
          ["start.json"],
          current.attemptRoot,
        ),
      /canonical document-ingestion request is invalid/u,
    );
  } finally {
    fs.rmSync(current.dataRoot, { recursive: true, force: true });
  }
});

test("Runtime V2 ingestion opens one regular blob by scoped identity and verifies metadata", async () => {
  const current = fixture();
  try {
    const launch = loadRuntimeV2DocumentIngestionLaunch(
      ["start.json"],
      current.attemptRoot,
    );
    const opened = openCanonicalRuntimeV2IngestBlob(launch);
    try {
      const first = await opened.file.readBuffer();
      const second = await opened.file.readBuffer();
      assert.deepEqual(first, current.bytes);
      assert.equal(
        first,
        second,
        "the staged bytes are materialized at most once",
      );
      assert.equal(opened.file.name, "runtime-v2.md");
      assert.equal(Object.hasOwn(opened.file, "path"), false);
    } finally {
      opened.close();
    }

    const startPath = path.join(current.attemptRoot, "start.json");
    const start = JSON.parse(fs.readFileSync(startPath, "utf8"));
    fs.writeFileSync(
      startPath,
      JSON.stringify({
        ...start,
        inputBlobs: [{ ...current.inputBlob, sha256: "0".repeat(64) }],
      }),
    );
    const mismatched = loadRuntimeV2DocumentIngestionLaunch(
      ["start.json"],
      current.attemptRoot,
    );
    assert.throws(
      () => openCanonicalRuntimeV2IngestBlob(mismatched),
      /digest does not match/u,
    );
  } finally {
    fs.rmSync(current.dataRoot, { recursive: true, force: true });
  }
});

test("Runtime V2 ingestion request binds authority and model access to closed fields", () => {
  const current = fixture();
  try {
    const external = validateRuntimeV2DocumentIngestionRequest(
      {
        ...current.request,
        generateMap: true,
        chatmockBaseUrl: "https://models.example.com/v1",
      },
      current.executionScope,
    );
    assert.equal(external.chatmockBaseUrl, "https://models.example.com/v1");
    assert.throws(
      () =>
        validateRuntimeV2DocumentIngestionRequest(
          {
            ...current.request,
            generateMap: true,
            chatmockBaseUrl: "https://user:secret@models.example.com/v1",
          },
          current.executionScope,
        ),
      /normalized HTTP\(S\) \/v1/u,
    );
    assert.throws(
      () =>
        validateRuntimeV2DocumentIngestionRequest(current.request, {
          ...current.executionScope,
          gardenId: null,
        }),
      /authenticated user and garden scope/u,
    );
    assert.throws(
      () =>
        validateRuntimeV2DocumentIngestionRequest(
          {
            ...current.request,
            blob: { blobId: "caller-selected" },
          },
          current.executionScope,
        ),
      /canonical document-ingestion request is invalid/u,
    );
  } finally {
    fs.rmSync(current.dataRoot, { recursive: true, force: true });
  }
});

test("Runtime V2 ingestion uses the exact stop and bounded durable result envelopes", () => {
  const current = fixture();
  try {
    assert.deepEqual(
      parseRuntimeV2IngestionStopRecord('{"type":"stop","force":false}\n'),
      { type: "stop", force: false },
    );
    for (const invalid of [
      '{"type":"stop","force":true}\n',
      '{"type":"stop","force":false,"extra":1}\n',
      '{"type":"stop","force":false}',
      "{}\n",
    ]) {
      assert.throws(
        () => parseRuntimeV2IngestionStopRecord(invalid),
        /stop record/u,
      );
    }
    const bytes = serializeRuntimeV2DocumentIngestionResult({
      identity: current.identity,
      completionSequence: 8,
      value: { success: true, sourceRelPath: "garden-1/sources/runtime-v2.md" },
    });
    assert.deepEqual(JSON.parse(bytes.toString("utf8")), {
      protocolVersion: 1,
      identity: current.identity,
      completionSequence: 8,
      result: {
        success: true,
        sourceRelPath: "garden-1/sources/runtime-v2.md",
      },
    });
    const privateWarnings = serializeRuntimeV2DocumentIngestionResult({
      identity: current.identity,
      completionSequence: 9,
      value: {
        success: true,
        visionError: "provider.internal:8443 rejected C:\\private\\scan.pdf",
        screenshotWarning: "C:\\private\\renderer.exe failed",
        mapGenerationWarning: "private model gateway rejected the request",
      },
    });
    const safeResult = JSON.parse(privateWarnings.toString("utf8")).result;
    assert.deepEqual(safeResult, {
      success: true,
      visionError: "Vision processing was incomplete for this document.",
      screenshotWarning:
        "Some document content or page previews could not be processed.",
      mapGenerationWarning:
        "Map generation failed, so the source was saved without extracted lesson topics. You can retry with Learn after upload.",
    });
    assert.doesNotMatch(
      privateWarnings.toString("utf8"),
      /provider\.internal|private\\\\scan|renderer\.exe|gateway/u,
    );
  } finally {
    fs.rmSync(current.dataRoot, { recursive: true, force: true });
  }
});

test("Runtime V2 ingestion heartbeats continue while the executor main thread is blocked", async () => {
  // Use the production event writer in a child so its fd-1 protocol output is
  // isolated from node:test's TAP stream. The busy loop models synchronous
  // hashing, archive extraction, and document parsers on a large input.
  assert.equal(typeof createRuntimeV2IngestionEventWriter, "function");
  const workerModuleUrl = pathToFileURL(
    path.join(
      dashboardRoot,
      "scripts",
      "runtime-v2-document-ingestion-worker.mjs",
    ),
  ).href;
  const probe = `
    import { createRuntimeV2IngestionEventWriter } from ${JSON.stringify(workerModuleUrl)};
    const identity = {
      jobId: "job_heartbeat_probe",
      attempt: 1,
      workerInstanceId: "worker_heartbeat_probe",
    };
    const events = createRuntimeV2IngestionEventWriter(identity, {
      heartbeatIntervalMs: 20,
    });
    events.ready();
    const heartbeat = events.startHeartbeat();
    await heartbeat.ready;
    const blockedUntil = Date.now() + 220;
    while (Date.now() < blockedUntil) {}
    await heartbeat.stop();
    events.complete("runtime/jobs/job_heartbeat_probe/result.json");
  `;
  const child = spawn(
    process.execPath,
    ["--input-type=module", "--eval", probe],
    {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
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
  const exit = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("The heartbeat blocking probe did not exit."));
    }, 5_000);
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
  assert.ok(
    events.filter(({ type }) => type === "heartbeat").length >= 3,
    JSON.stringify(events),
  );
  assert.equal(events.at(-1)?.type, "complete");
  assert.ok(events.every((event, index) => event.sequence === index + 1));
});

test("a real Runtime V2 ingestion worker handles one staged document and exits", async () => {
  const current = fixture();
  const workerPath = path.join(
    dashboardRoot,
    "scripts",
    "runtime-v2-document-ingestion-worker.mjs",
  );
  try {
    fs.mkdirSync(path.join(current.dataRoot, "quartz", "content", "garden-1"), {
      recursive: true,
    });
    const child = spawn(process.execPath, [workerPath, "start.json"], {
      cwd: current.attemptRoot,
      env:
        process.platform === "win32"
          ? {
              SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
              BREADBOARD_RUNTIME_V2_FAULT_INJECTION: "test-only",
              BREADBOARD_RUNTIME_V2_TEST_QUARTZ_SOURCE_ROOT: path.join(
                current.dataRoot,
                "quartz",
              ),
            }
          : {
              BREADBOARD_RUNTIME_V2_FAULT_INJECTION: "test-only",
              BREADBOARD_RUNTIME_V2_TEST_QUARTZ_SOURCE_ROOT: path.join(
                current.dataRoot,
                "quartz",
              ),
            },
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
      if (Buffer.byteLength(stdout, "utf8") > 1024 * 1024) child.kill();
    });
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-64 * 1024);
    });
    const exit = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill();
        reject(
          new Error(
            "The finite ingestion worker did not exit within 10 seconds.",
          ),
        );
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
    assert.ok(events.some(({ type }) => type === "progress"));
    assert.ok(events.some(({ type }) => type === "checkpoint"));
    assert.equal(events.at(-1)?.type, "complete");
    assert.ok(
      events.every(
        (event, index) =>
          event.sequence === index + 1 &&
          JSON.stringify(event.identity) === JSON.stringify(current.identity),
      ),
    );
    const resultPath = path.join(
      current.dataRoot,
      "runtime",
      "jobs",
      current.identity.jobId,
      "result.json",
    );
    assert.equal(
      JSON.parse(fs.readFileSync(resultPath, "utf8")).result.success,
      true,
    );
    const checkpoint = JSON.parse(
      fs.readFileSync(
        path.join(
          current.dataRoot,
          "runtime",
          "jobs",
          current.identity.jobId,
          "checkpoint.json",
        ),
        "utf8",
      ),
    );
    assert.ok(checkpoint.revision >= 1);
    assert.equal(checkpoint.tokenUsage.model, "selected-model");
    assert.equal(checkpoint.failure, null);
    assert.equal(
      fs.existsSync(current.blobPath),
      true,
      "Rust retains input until tree exit",
    );
  } finally {
    fs.rmSync(current.dataRoot, { recursive: true, force: true });
  }
});

test("a committed ingestion republishes on a fresh worker after Quartz fails", async () => {
  const first = fixture();
  try {
    const clusterDir = path.join(
      first.dataRoot,
      "quartz",
      "content",
      "garden-1",
    );
    fs.mkdirSync(clusterDir, { recursive: true });
    fs.writeFileSync(
      path.join(first.dataRoot, "quartz", ".test-fail-next"),
      "fail once",
      "utf8",
    );

    const failedPublish = await runWorkerProcess(first);
    assert.deepEqual(
      { code: failedPublish.code, signal: failedPublish.signal },
      { code: 1, signal: null },
      failedPublish.stderr,
    );
    const jobRoot = path.join(
      first.dataRoot,
      "runtime",
      "jobs",
      first.identity.jobId,
    );
    assert.equal(fs.existsSync(path.join(jobRoot, "result.json")), true);
    assert.equal(fs.existsSync(path.join(jobRoot, "ingestion-commit.json")), true);
    assert.equal(
      fs.readdirSync(path.join(clusterDir, "sources")).filter(
        (name) => name.endsWith(".md") && name !== "_index.md",
      ).length,
      1,
    );

    const second = nextAttempt(first);
    const recovered = await runWorkerProcess(second);
    assert.deepEqual(
      { code: recovered.code, signal: recovered.signal },
      { code: 0, signal: null },
      recovered.stderr,
    );
    assert.equal(recovered.events.at(-1)?.type, "complete");
    assert.equal(
      fs.readFileSync(
        path.join(first.dataRoot, "quartz", "public", "index.html"),
        "utf8",
      ),
      "published",
    );
    assert.equal(
      fs.readdirSync(path.join(clusterDir, "sources")).filter(
        (name) => name.endsWith(".md") && name !== "_index.md",
      ).length,
      1,
    );
  } finally {
    fs.rmSync(first.dataRoot, { recursive: true, force: true });
  }
});

for (const faultPoint of [
  "after-garden-mutations",
  "after-result-prepare",
  "after-result-write",
  "after-garden-commit",
  "after-terminal-event",
]) {
  test(`a fresh worker reconciles an abrupt exit at ${faultPoint}`, async () => {
    const first = fixture();
    try {
      const clusterDir = path.join(
        first.dataRoot,
        "quartz",
        "content",
        "garden-1",
      );
      fs.mkdirSync(clusterDir, { recursive: true });
      const interrupted = await runWorkerProcess(first, faultPoint);
      assert.deepEqual(
        { code: interrupted.code, signal: interrupted.signal },
        { code: 86, signal: null },
        interrupted.stderr,
      );

      const second = nextAttempt(first);
      const reconciled = await runWorkerProcess(second);
      assert.deepEqual(
        { code: reconciled.code, signal: reconciled.signal },
        { code: 0, signal: null },
        reconciled.stderr,
      );
      assert.equal(reconciled.events.at(-1)?.type, "complete");
      assert.ok(
        reconciled.events.every(
          (event, index) =>
            event.sequence === index + 1 &&
            JSON.stringify(event.identity) === JSON.stringify(second.identity),
        ),
      );
      const result = JSON.parse(
        fs.readFileSync(
          path.join(
            first.dataRoot,
            "runtime",
            "jobs",
            first.identity.jobId,
            "result.json",
          ),
          "utf8",
        ),
      );
      assert.deepEqual(result.identity, second.identity);
      assert.equal(result.result.success, true);
      const sourceFiles = fs
        .readdirSync(path.join(clusterDir, "sources"))
        .filter((name) => name.endsWith(".md") && name !== "_index.md");
      assert.equal(sourceFiles.length, 1, sourceFiles.join(", "));

      const transactionRoot = path.join(
        first.dataRoot,
        "runtime",
        "ingestion-transactions",
      );
      const gardenRegistry = fs.readdirSync(transactionRoot);
      assert.equal(gardenRegistry.length, 1);
      assert.deepEqual(
        fs.readdirSync(path.join(transactionRoot, gardenRegistry[0])),
        [],
      );
      const tombstone = JSON.parse(
        fs.readFileSync(
          path.join(
            first.dataRoot,
            "runtime",
            "jobs",
            first.identity.jobId,
            "ingestion-commit.json",
          ),
          "utf8",
        ),
      );
      assert.equal(tombstone.state, "committed");
      assert.equal(tombstone.transactionId, first.identity.jobId);
    } finally {
      fs.rmSync(first.dataRoot, { recursive: true, force: true });
    }
  });
}

test("a real Runtime V2 ingestion worker acknowledges cancellation and leaves cleanup to Rust", async () => {
  const current = fixture();
  const workerPath = path.join(
    dashboardRoot,
    "scripts",
    "runtime-v2-document-ingestion-worker.mjs",
  );
  try {
    const largerBytes = Buffer.alloc(8 * 1024 * 1024, 0x61);
    fs.writeFileSync(current.blobPath, largerBytes);
    const startPath = path.join(current.attemptRoot, "start.json");
    const start = JSON.parse(fs.readFileSync(startPath, "utf8"));
    fs.writeFileSync(
      startPath,
      JSON.stringify({
        ...start,
        inputBlobs: [
          {
            ...current.inputBlob,
            sha256: createHash("sha256").update(largerBytes).digest("hex"),
            sizeBytes: largerBytes.byteLength,
          },
        ],
      }),
    );
    fs.mkdirSync(path.join(current.dataRoot, "quartz", "content", "garden-1"), {
      recursive: true,
    });
    const child = spawn(process.execPath, [workerPath, "start.json"], {
      cwd: current.attemptRoot,
      env:
        process.platform === "win32"
          ? { SystemRoot: process.env.SystemRoot ?? "C:\\Windows" }
          : {},
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let stopSent = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout = `${stdout}${chunk}`;
      if (!stopSent && stdout.includes('"type":"ready"')) {
        stopSent = true;
        child.stdin.write('{"type":"stop","force":false}\n');
      }
      if (Buffer.byteLength(stdout, "utf8") > 1024 * 1024) child.kill();
    });
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-64 * 1024);
    });
    const exit = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill();
        reject(
          new Error(
            "The cancelled ingestion worker did not exit within 10 seconds.",
          ),
        );
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
    assert.equal(stopSent, true);
    assert.ok(
      events.some(({ type }) => type === "cancellation-acknowledged"),
      JSON.stringify(events),
    );
    assert.equal(
      events.some(({ type }) => type === "complete"),
      false,
    );
    assert.equal(
      events.some(({ type }) => type === "failed"),
      false,
    );
    assert.equal(fs.existsSync(current.blobPath), true);
    assert.equal(
      fs.existsSync(
        path.join(
          current.dataRoot,
          "runtime",
          "jobs",
          current.identity.jobId,
          "result.json",
        ),
      ),
      false,
    );
  } finally {
    fs.rmSync(current.dataRoot, { recursive: true, force: true });
  }
});

test("Runtime V2 document ingestion is registered as one finite staged worker", () => {
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(repoRoot, "desktop", "runtime-v2", "manifests", "workers.json"),
      "utf8",
    ),
  );
  const worker = manifest.workers.find(
    ({ kind }) => kind === "document-ingestion-node",
  );
  assert.ok(worker);
  assert.deepEqual(worker.jobTypes, ["document-ingestion"]);
  assert.equal(
    worker.allowedEntrypoint,
    "dashboard/scripts/runtime-v2-document-ingestion-worker.mjs",
  );
  assert.equal(worker.maximumConcurrency, 1);
  assert.equal(worker.workspacePolicy, "private-per-job");
  assert.equal(worker.exitAfterJob, true);

  const source = fs.readFileSync(
    path.join(
      dashboardRoot,
      "scripts",
      "runtime-v2-document-ingestion-worker.mjs",
    ),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /node:child_process|\b(?:fork|spawn)\s*\(|detached\s*:|process\.send|process\.on\(["']message/u,
  );
  assert.match(source, /ingestModule\.runIngest/u);
  assert.doesNotMatch(source, /ingestModule\.POST|fetch\([^)]*\/api\/ingest/u);
  assert.match(source, /QUARTZ_AUTO_PUBLISH = "0"/u);
  assert.match(source, /VLM_OCR_AUTO_START = "0"/u);
  assert.match(source, /canonicalRuntimeV2IngestBlobPath/u);
  assert.match(source, /createRuntimeV2WorkerEventWriter/u);
  assert.match(source, /completionSequence/u);
  assert.match(
    source,
    /publishQuartzAfterMutation\([\s\S]{0,240}gardenSlug:\s*launch\.executionScope\.gardenId/u,
    "a committed upload must invalidate the exact Garden topology before publishing",
  );
  const eventWriterSource = fs.readFileSync(
    path.join(dashboardRoot, "scripts", "runtime-v2-worker-events.mjs"),
    "utf8",
  );
  assert.match(eventWriterSource, /cancellation-acknowledged/u);

  const routeSource = fs.readFileSync(
    path.join(dashboardRoot, "src", "app", "api", "ingest", "route.ts"),
    "utf8",
  );
  assert.doesNotMatch(
    routeSource,
    /runIngest|withCapabilityLease|adm-zip|pdf-parse|child_process|ingest-executor/u,
  );
  assert.match(routeSource, /submitRuntimeJob/u);
  assert.match(routeSource, /inputUploads/u);
  const executorSource = fs.readFileSync(
    path.join(dashboardRoot, "src", "lib", "runtime-v2", "ingest-executor.ts"),
    "utf8",
  );
  assert.match(executorSource, /export async function runIngest/u);
  assert.doesNotMatch(executorSource, /export async function POST/u);
  const staging = fs.readFileSync(
    path.join(repoRoot, "desktop", "scripts", "prepare-app-resources.mjs"),
    "utf8",
  );
  assert.match(staging, /"runtime-v2-document-ingestion-worker\.mjs"/u);
  assert.match(staging, /"runtime-v2-worker-events\.mjs"/u);
  assert.match(staging, /worker-src/u);
  for (const dependency of [
    "@firecrawl/anydoc",
    "adm-zip",
    "katex",
    "openai",
    "pdf-parse",
  ]) {
    assert.match(
      staging,
      new RegExp(`"${dependency.replace("/", "\\/")}"`, "u"),
    );
  }
});

test("the real ingestion executor source closure imports outside the Next request adapter", async () => {
  const previousSourceRoot = process.env.BREADBOARD_LEARN_SOURCE_ROOT;
  process.env.BREADBOARD_LEARN_SOURCE_ROOT = path.join(dashboardRoot, "src");
  try {
    await import("../scripts/learn-worker-import-hook.mjs");
    const ingestModule = await import(
      pathToFileURL(
        path.join(
          dashboardRoot,
          "src",
          "lib",
          "runtime-v2",
          "ingest-executor.ts",
        ),
      ).href
    );
    assert.equal(typeof ingestModule.runIngest, "function");
  } finally {
    if (previousSourceRoot === undefined) {
      delete process.env.BREADBOARD_LEARN_SOURCE_ROOT;
    } else {
      process.env.BREADBOARD_LEARN_SOURCE_ROOT = previousSourceRoot;
    }
  }
});

test("the shared executor performs a real bounded text ingestion without a model", async () => {
  const dataRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "runtime-v2-real-ingest-"),
  );
  const previousGlobalDatabase = globalThis.db;
  const contentPath = path.join(dataRoot, "quartz", "content");
  const sourceBytes = Buffer.from(
    "# Runtime V2 ingestion\n\nThis ordinary source is persisted by the real document pipeline.\n",
    "utf8",
  );
  const previous = {
    dataRoot: process.env.BREADBOARD_DATA_DIR,
    publish: process.env.QUARTZ_AUTO_PUBLISH,
    content: process.env.QUARTZ_CONTENT_PATH,
    sourceRoot: process.env.BREADBOARD_LEARN_SOURCE_ROOT,
  };
  fs.mkdirSync(path.join(contentPath, "garden-1"), { recursive: true });
  process.env.BREADBOARD_DATA_DIR = dataRoot;
  process.env.QUARTZ_AUTO_PUBLISH = "0";
  process.env.QUARTZ_CONTENT_PATH = contentPath;
  process.env.BREADBOARD_LEARN_SOURCE_ROOT = path.join(dashboardRoot, "src");
  try {
    await import("../scripts/learn-worker-import-hook.mjs");
    const ingestModule = await import(
      pathToFileURL(
        path.join(
          dashboardRoot,
          "src",
          "lib",
          "runtime-v2",
          "ingest-executor.ts",
        ),
      ).href
    );
    const createdFilePaths = [];
    const createdMarkdownPaths = [];
    const result = await ingestModule.runIngest({
      request: new Request("http://127.0.0.1/runtime-v2/ingest"),
      contentPath,
      file: {
        name: "ordinary-source.md",
        type: "text/markdown",
        size: sourceBytes.byteLength,
        async readBuffer() {
          return sourceBytes;
        },
        async text() {
          return sourceBytes.toString("utf8");
        },
      },
      normalizedClusterSlug: "garden-1",
      filename: "ordinary-source.md",
      ext: "md",
      nameWithoutExt: "ordinary-source",
      source: "upload",
      model: "",
      isHandwriting: false,
      parseWithVlm: false,
      parseWithAnydoc: false,
      vlmTask: "doc_parse",
      generateMap: false,
      createdFilePaths,
      createdMarkdownPaths,
      emit: () => undefined,
    });
    assert.equal(result.success, true);
    assert.equal(result.filename, "ordinary-source.md");
    assert.equal(typeof result.sourceRelPath, "string");
    assert.ok(createdMarkdownPaths.length > 0);
    assert.ok(
      createdMarkdownPaths.every((created) => pathWithin(dataRoot, created)),
    );
  } finally {
    for (const [name, value] of Object.entries({
      BREADBOARD_DATA_DIR: previous.dataRoot,
      QUARTZ_AUTO_PUBLISH: previous.publish,
      QUARTZ_CONTENT_PATH: previous.content,
      BREADBOARD_LEARN_SOURCE_ROOT: previous.sourceRoot,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    // Topology invalidation deliberately runs even when Quartz publication is
    // disabled, so this direct in-process executor test opens the temporary
    // application database. Release that test-owned singleton before removing
    // its data root on Windows.
    if (
      globalThis.db !== previousGlobalDatabase &&
      globalThis.db?.open
    ) {
      globalThis.db.close();
      delete globalThis.db;
    }
    fs.rmSync(dataRoot, {
      recursive: true,
      force: true,
      maxRetries: process.platform === "win32" ? 8 : 0,
      retryDelay: 50,
    });
  }
});
