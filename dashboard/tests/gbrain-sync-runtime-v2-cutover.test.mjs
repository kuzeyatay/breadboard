import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

await import("../scripts/learn-worker-import-hook.mjs");

const {
  runGBrainSyncViaRuntime,
  startGBrainSyncRuntimeJob,
} = await import("../src/lib/runtime-v2/gbrain-sync-job.ts");
const {
  validateRuntimeV2GBrainAdapterEnvironment,
  validateRuntimeV2GBrainSyncRequest,
  validateRuntimeV2GBrainSyncScope,
} = await import("../scripts/runtime-v2-gbrain-sync-worker.mjs");

function snapshot(overrides = {}) {
  return {
    jobId: "job_gbrain_1",
    jobType: "gbrain-sync",
    workerKind: "gbrain-sync-node",
    resourceClass: "document-processing",
    state: "queued",
    gardenId: "garden-one",
    conversationId: null,
    attempt: 1,
    workerInstanceId: "worker_gbrain_1",
    lastWorkerSequence: 0,
    ...overrides,
  };
}

test("queued sync submissions are authority scoped and deterministically idempotent", async () => {
  let received;
  const control = {
    async submit(authority, submission) {
      received = { authority, submission };
      return snapshot();
    },
    async inspect() { throw new Error("not used"); },
    async readOutput() { throw new Error("not used"); },
    async cancel() { throw new Error("not used"); },
  };
  const handle = await startGBrainSyncRuntimeJob({
    userId: 7,
    gardenId: "garden-one",
    clusterId: 12,
    queueJobId: 44,
    control,
  });
  assert.equal(handle.snapshot.jobId, "job_gbrain_1");
  assert.deepEqual(received.authority, {
    userId: 7,
    gardenId: "garden-one",
    conversationId: null,
  });
  assert.deepEqual(received.submission, {
    jobType: "gbrain-sync",
    idempotencyKey: "gbrain-sync-v2:queue:44",
    requestPayload: {
      protocolVersion: 1,
      operation: "sync-garden",
      clusterId: 12,
      queueJobId: 44,
    },
  });
});

test("completed indexing output is fenced to the exact Runtime attempt", async () => {
  const succeeded = snapshot({ state: "succeeded", lastWorkerSequence: 9 });
  const control = {
    async submit() { return succeeded; },
    async inspect() { throw new Error("not used"); },
    async readOutput() {
      return {
        kind: "result",
        content: {
          protocolVersion: 1,
          identity: {
            jobId: succeeded.jobId,
            attempt: succeeded.attempt,
            workerInstanceId: succeeded.workerInstanceId,
          },
          completionSequence: 9,
          result: {
            clusterId: 12,
            sourceId: "gbrain-src-cluster-12",
            status: "synced",
            pagesIndexed: 4,
            chunksIndexed: 11,
            mode: "hybrid",
            revision: "rev-1",
          },
        },
      };
    },
    async cancel() { throw new Error("not used"); },
  };
  const result = await runGBrainSyncViaRuntime({
    userId: 7,
    gardenId: "garden-one",
    clusterId: 12,
    queueJobId: null,
    control,
  });
  assert.deepEqual(result, {
    clusterId: 12,
    sourceId: "gbrain-src-cluster-12",
    status: "synced",
    pagesIndexed: 4,
    chunksIndexed: 11,
    mode: "hybrid",
    revision: "rev-1",
  });
});

test("request cancellation is forwarded to the authoritative Runtime job", async () => {
  const controller = new AbortController();
  let cancelled = 0;
  const queued = snapshot();
  const control = {
    async submit() {
      queueMicrotask(() => controller.abort(new DOMException("stop", "AbortError")));
      return queued;
    },
    async inspect() { return queued; },
    async readOutput() { throw new Error("not used"); },
    async cancel() {
      cancelled += 1;
      return snapshot({ state: "cancelled" });
    },
  };
  await assert.rejects(
    runGBrainSyncViaRuntime({
      userId: 7,
      gardenId: "garden-one",
      clusterId: 12,
      signal: controller.signal,
      control,
    }),
    (error) => error instanceof DOMException && error.name === "AbortError",
  );
  assert.equal(cancelled, 1);
});

test("the worker accepts only exact bounded garden-scoped requests", () => {
  assert.deepEqual(validateRuntimeV2GBrainSyncRequest({
    protocolVersion: 1,
    operation: "sync-garden",
    clusterId: 12,
    queueJobId: null,
  }), {
    protocolVersion: 1,
    operation: "sync-garden",
    clusterId: 12,
    queueJobId: null,
  });
  assert.deepEqual(validateRuntimeV2GBrainSyncScope({
    userId: 7,
    gardenId: "garden-one",
    conversationId: null,
  }), {
    userId: 7,
    gardenId: "garden-one",
    conversationId: null,
  });
  assert.throws(() => validateRuntimeV2GBrainSyncRequest({
    protocolVersion: 1,
    operation: "sync-garden",
    clusterId: 12,
    queueJobId: null,
    path: "C:\\arbitrary",
  }));
  assert.throws(() => validateRuntimeV2GBrainSyncScope({
    userId: 7,
    gardenId: null,
    conversationId: null,
  }));
});

test("the worker accepts only sealed loopback GBrain adapter endpoints", () => {
  assert.doesNotThrow(() => validateRuntimeV2GBrainAdapterEnvironment({
    GBRAIN_ADAPTER_URL: "http://[::1]:8765",
    GBRAIN_ADAPTER_SECRET: "test-secret",
  }));
  assert.throws(() => validateRuntimeV2GBrainAdapterEnvironment({
    GBRAIN_ADAPTER_URL: "https://gbrain.example.com:8765",
    GBRAIN_ADAPTER_SECRET: "test-secret",
  }));
});

test("Next retains no timer, full scan, adapter call, or direct execution fallback", () => {
  const facade = fs.readFileSync(new URL("../src/lib/gbrain/sync.ts", import.meta.url), "utf8");
  const compatibility = fs.readFileSync(
    new URL("../src/lib/gbrain/sync-worker.ts", import.meta.url),
    "utf8",
  );
  const executor = fs.readFileSync(
    new URL("../src/lib/gbrain/sync-executor.ts", import.meta.url),
    "utf8",
  );
  const route = fs.readFileSync(
    new URL("../src/app/api/gbrain/sync/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(facade, /runGBrainSyncViaRuntime/);
  assert.doesNotMatch(facade, /scanClusterKnowledge|new GBrainClient|setInterval|node:child_process/);
  assert.doesNotMatch(compatibility, /setInterval|scanClusterKnowledge|node:child_process/);
  assert.match(executor, /scanClusterKnowledge/);
  assert.match(executor, /registerSource/);
  assert.match(route, /request\.signal/);
});
