import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

await import("../scripts/learn-worker-import-hook.mjs");
const runtime = await import("../src/lib/runtime-v2/thought-topology-job.ts");
const worker = await import("../scripts/runtime-v2-thought-topology-worker.mjs");

function snapshot(overrides = {}) {
  return {
    jobId: "job_topology_1",
    jobType: "thought-topology",
    workerKind: "thought-topology-node",
    resourceClass: "document-processing",
    state: "queued",
    gardenId: "new-garden",
    conversationId: null,
    attempt: 2,
    workerInstanceId: "worker_topology_1",
    lastWorkerSequence: 0,
    ...overrides,
  };
}

test("topology submission is Garden-authorized and revision-idempotent", async () => {
  let received;
  const control = {
    async submit(authority, submission) { received = { authority, submission }; return snapshot(); },
    async inspect() { throw new Error("not used"); },
    async readOutput() { throw new Error("not used"); },
  };
  await runtime.startThoughtTopologyRuntimeJob({ userId: 7, gardenId: "new-garden", clusterId: 12, revision: 4, queueJobId: 31, control });
  assert.deepEqual(received.authority, { userId: 7, gardenId: "new-garden", conversationId: null });
  assert.deepEqual(received.submission, {
    jobType: "thought-topology",
    idempotencyKey: "thought-topology-v2:12:queue:31",
    requestPayload: { protocolVersion: 1, operation: "build-thought-topology", clusterId: 12, revision: 4, queueJobId: 31 },
  });
});

test("wrong worker, job, resource, and Garden scope are rejected", async () => {
  for (const invalid of [
    { workerKind: "gbrain-sync-node" },
    { jobType: "gbrain-sync" },
    { resourceClass: "browser-automation" },
    { gardenId: "another-garden" },
  ]) {
    await assert.rejects(runtime.startThoughtTopologyRuntimeJob({
      userId: 7, gardenId: "new-garden", clusterId: 12, revision: 4, queueJobId: 31,
      control: { async submit() { return snapshot(invalid); }, async inspect() {}, async readOutput() {} },
    }), /outside the Thought Topology contract/);
  }
});

test("result envelope is fenced to the exact attempt and completion sequence", () => {
  const done = snapshot({ state: "succeeded", lastWorkerSequence: 9 });
  const valid = {
    protocolVersion: 1,
    identity: { jobId: done.jobId, attempt: done.attempt, workerInstanceId: done.workerInstanceId },
    completionSequence: 9,
    result: { status: "built", clusterId: 12, revision: 4, nodes: 6, edges: 3, mode: "semantic-vector", sourceRevision: "abc" },
  };
  assert.equal(runtime.validateThoughtTopologyRuntimeEnvelope(done, valid).status, "built");
  assert.throws(() => runtime.validateThoughtTopologyRuntimeEnvelope(done, { ...valid, completionSequence: 8 }), /worker fence/);
  assert.throws(() => runtime.validateThoughtTopologyRuntimeEnvelope(done, { ...valid, identity: { ...valid.identity, attempt: 3 } }), /worker fence/);
});

test("finite worker validates exact bounded requests, scope, and sealed loopback services", () => {
  assert.doesNotThrow(() => worker.validateRuntimeV2ThoughtTopologyRequest({ protocolVersion: 1, operation: "build-thought-topology", clusterId: 12, revision: 4, queueJobId: 31 }));
  assert.throws(() => worker.validateRuntimeV2ThoughtTopologyRequest({ protocolVersion: 1, operation: "build-thought-topology", clusterId: 12, revision: 4, queueJobId: 31, path: "C:\\private" }));
  assert.doesNotThrow(() => worker.validateRuntimeV2ThoughtTopologyScope({ userId: 7, gardenId: "new-garden", conversationId: null }));
  assert.throws(() => worker.validateRuntimeV2ThoughtTopologyScope({ userId: 7, gardenId: "new-garden", conversationId: "chat" }));
  assert.doesNotThrow(() => worker.validateThoughtTopologyWorkerEnvironment({
    GBRAIN_ADAPTER_URL: "http://127.0.0.1:7739",
    GBRAIN_ADAPTER_SECRET: "secret",
    OPENAI_BASE_URL: "http://127.0.0.1:7737/v1",
    OPENAI_API_KEY: "local",
  }));
  assert.throws(() => worker.validateThoughtTopologyWorkerEnvironment({
    GBRAIN_ADAPTER_URL: "https://remote.example/gbrain",
    GBRAIN_ADAPTER_SECRET: "secret",
    OPENAI_BASE_URL: "http://127.0.0.1:7737/v1",
    OPENAI_API_KEY: "local",
  }));
});

test("heavy scan, embedding, model, and atomic commit live only in worker source", () => {
  const state = fs.readFileSync(new URL("../src/lib/thought-topology/state.ts", import.meta.url), "utf8");
  const api = fs.readFileSync(new URL("../src/app/api/thought-topology/route.ts", import.meta.url), "utf8");
  const builder = fs.readFileSync(new URL("../src/lib/thought-topology/builder.ts", import.meta.url), "utf8");
  assert.doesNotMatch(state, /scanClusterKnowledge|createChatmockClient|GBrainClient/);
  assert.doesNotMatch(api, /scanClusterKnowledge|createChatmockClient|GBrainClient|commitThoughtTopology/);
  assert.match(builder, /scanClusterKnowledge/);
  assert.match(builder, /new GBrainClient/);
  assert.match(builder, /commitThoughtTopology/);
});

test("Runtime manifest binds the topology worker to GBrain and ChatMock", () => {
  const manifest = JSON.parse(fs.readFileSync(new URL("../../desktop/runtime-v2/manifests/workers.json", import.meta.url), "utf8"));
  const entry = manifest.workers.find((candidate) => candidate.kind === "thought-topology-node");
  assert.deepEqual(entry.jobTypes, ["thought-topology"]);
  assert.equal(entry.resourceClass, "document-processing");
  assert.deepEqual(entry.serviceDependencies.map((dependency) => dependency.serviceId).sort(), ["chatmock", "gbrain"]);
});

test("background topology builds publish bounded percentage progress", () => {
  const finiteWorker = fs.readFileSync(
    new URL("../scripts/runtime-v2-finite-mcp-worker-core.mjs", import.meta.url),
    "utf8",
  );
  const topologyWorker = fs.readFileSync(
    new URL("../scripts/runtime-v2-thought-topology-worker.mjs", import.meta.url),
    "utf8",
  );
  const route = fs.readFileSync(
    new URL("../src/app/api/thought-topology/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(finiteWorker, /events\.progress\("processing", value\.percent, 100\)/);
  assert.match(topologyWorker, /stage: "loading-garden", percent: 5/);
  assert.match(topologyWorker, /onProgress\(percent\)/);
  assert.match(route, /inspectRuntimeJobForStatus/);
  assert.match(route, /monotonicRuntimeProgress/);
  assert.match(route, /activeQueueRow/);
  assert.doesNotMatch(route, /pendingExplanations/);
  assert.match(route, /message: `\$\{action\} Thought Topology · \$\{progress\}%`/);
});
