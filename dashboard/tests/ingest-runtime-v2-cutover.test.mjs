import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function ssePayloads(response) {
  const text = await response.text();
  return text
    .split("\n\n")
    .map((block) => block.replace(/^data:\s?/u, "").trim())
    .filter(Boolean);
}

test("the ingestion route is a thin Runtime V2 compatibility adapter", () => {
  const route = fs.readFileSync(
    path.join(dashboardRoot, "src", "app", "api", "ingest", "route.ts"),
    "utf8",
  );
  assert.match(route, /requireUserId/u);
  assert.match(route, /parseIngestUpload/u);
  assert.match(route, /submitRuntimeJob/u);
  assert.match(route, /inputUploads:\s*\[\{ uploadId:/u);
  assert.match(route, /createRuntimeIngestSseResponse/u);
  assert.doesNotMatch(
    route,
    /runIngest|withCapabilityLease|child_process|\bspawn\s*\(|\bfork\s*\(|adm-zip|pdf-parse|arrayBuffer\s*\(/u,
  );
  assert.doesNotMatch(
    route,
    /requestPayload[\s\S]{0,300}(?:"bytes"\s*:|buffer\s*:|base64\s*:|filePath\s*:)/iu,
  );

  const compatibility = fs.readFileSync(
    path.join(
      dashboardRoot,
      "src",
      "lib",
      "runtime-v2",
      "ingest-compatibility.ts",
    ),
    "utf8",
  );
  assert.match(compatibility, /replayRuntimeJobEvents/u);
  assert.match(compatibility, /readRuntimeJobOutput/u);
  assert.match(compatibility, /JOB_OUTPUT_NOT_READY/u);
  assert.match(compatibility, /data: \[DONE\]/u);
  assert.doesNotMatch(compatibility, /child_process|runIngest|withCapabilityLease/u);
});

test("post-validation Runtime failures preserve one error then one DONE SSE terminal", async () => {
  process.env.BREADBOARD_LEARN_SOURCE_ROOT = path.join(dashboardRoot, "src");
  await import("../scripts/learn-worker-import-hook.mjs");
  const { createIngestErrorSseResponse } = await import(
    "../src/lib/runtime-v2/ingest-compatibility.ts"
  );
  const event = {
    type: "error",
    error: "Windows commit reserve cannot be preserved.",
    code: "BREADBOARD_RESOURCE_EXHAUSTED",
    resource: "windows_commit",
    requiredHeadroomMb: 8192,
    availableHeadroomMb: 5632,
    retryable: false,
    durationMs: 17,
    tokenUsage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      estimated: false,
      startedCalls: 0,
      completedCalls: 0,
      reportedCalls: 0,
      unreportedCalls: 0,
      inFlightCalls: 0,
      model: "selected-model",
    },
  };
  const response = createIngestErrorSseResponse(event);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/event-stream");
  const payloads = await ssePayloads(response);
  assert.equal(payloads.length, 2);
  assert.deepEqual(JSON.parse(payloads[0]), event);
  assert.equal(payloads[1], "[DONE]");
});

test("terminal admission denial preserves closed Windows commit evidence", async () => {
  process.env.BREADBOARD_LEARN_SOURCE_ROOT = path.join(dashboardRoot, "src");
  await import("../scripts/learn-worker-import-hook.mjs");
  const { createRuntimeIngestSseResponse } = await import(
    "../src/lib/runtime-v2/ingest-compatibility.ts"
  );
  const evidence = {
    resource: "windows_commit",
    requiredHeadroomMb: 8192,
    availableHeadroomMb: 4096,
    retryable: false,
  };
  const job = {
    jobId: "job_ingest_denied",
    jobType: "document-ingestion",
    workerKind: "document-ingestion-node",
    resourceClass: "document-processing",
    state: "resource_exhausted",
    stage: null,
    attempt: 0,
    workerInstanceId: null,
    gardenId: "garden-1",
    conversationId: null,
    createdAt: 100,
    startedAt: null,
    updatedAt: 101,
    finishedAt: 101,
    lastHeartbeatAt: null,
    lastWorkerSequence: 0,
    progressCurrent: 0,
    progressTotal: 0,
    failureCode: "BREADBOARD_RESOURCE_EXHAUSTED",
    failureMessage: "Runtime job execution failed.",
    resourceExhaustion: evidence,
    cancellationRequested: false,
  };
  const response = createRuntimeIngestSseResponse({
    authority: { userId: 42, gardenId: "garden-1", conversationId: null },
    job,
    model: "selected-model",
    startedAt: Date.now(),
    control: {
      async replay(_authority, _jobId, after) {
        return {
          jobId: job.jobId,
          after,
          nextAfter: after,
          terminal: true,
          hasMore: false,
          events: [],
        };
      },
      async inspect() {
        return job;
      },
      async readOutput() {
        throw new Error("terminal admission denial has no worker output");
      },
    },
  });
  const payloads = await ssePayloads(response);
  assert.equal(payloads.length, 2);
  assert.deepEqual(
    {
      ...JSON.parse(payloads[0]),
      durationMs: 0,
      tokenUsage: null,
    },
    {
      type: "error",
      error: "Runtime job execution failed.",
      code: "BREADBOARD_RESOURCE_EXHAUSTED",
      ...evidence,
      durationMs: 0,
      tokenUsage: null,
    },
  );
  assert.equal(payloads[1], "[DONE]");
});

test("an arbitrary worker failure checkpoint cannot disclose internal details", async () => {
  process.env.BREADBOARD_LEARN_SOURCE_ROOT = path.join(dashboardRoot, "src");
  await import("../scripts/learn-worker-import-hook.mjs");
  const { createRuntimeIngestSseResponse } = await import(
    "../src/lib/runtime-v2/ingest-compatibility.ts"
  );
  const identity = {
    jobId: "job_ingest_private_failure",
    attempt: 1,
    workerInstanceId: "worker_ingest_private_failure",
  };
  const privateDetail =
    "C:\\Users\\private-user\\Documents\\secret.pdf failed at provider.internal:8443";
  const job = {
    jobId: identity.jobId,
    jobType: "document-ingestion",
    workerKind: "document-ingestion-node",
    resourceClass: "document-processing",
    state: "failed",
    stage: "finalizing",
    attempt: identity.attempt,
    workerInstanceId: identity.workerInstanceId,
    gardenId: "garden-1",
    conversationId: null,
    createdAt: 100,
    startedAt: 101,
    updatedAt: 102,
    finishedAt: 102,
    lastHeartbeatAt: 101,
    lastWorkerSequence: 2,
    progressCurrent: 1,
    progressTotal: 4,
    failureCode: "INGEST_WORKER_FAILED",
    failureMessage: "Runtime job execution failed.",
    resourceExhaustion: null,
    cancellationRequested: false,
  };
  const response = createRuntimeIngestSseResponse({
    authority: { userId: 42, gardenId: "garden-1", conversationId: null },
    job,
    model: "selected-model",
    startedAt: Date.now(),
    control: {
      async replay(_authority, _jobId, after) {
        return {
          jobId: identity.jobId,
          after,
          nextAfter: 1,
          terminal: true,
          hasMore: false,
          events: [{
            sequence: 1,
            jobId: identity.jobId,
            attempt: identity.attempt,
            workerInstanceId: identity.workerInstanceId,
            workerSequence: 1,
            eventType: "worker-checkpoint",
            payload: {},
            createdAt: 101,
          }],
        };
      },
      async inspect() {
        return job;
      },
      async readOutput(_authority, _jobId, kind) {
        assert.equal(kind, "checkpoint");
        return {
          jobId: identity.jobId,
          kind,
          content: {
            protocolVersion: 1,
            identity,
            stage: "finalizing",
            step: "Finishing document ingestion…",
            tokenUsage: null,
            failure: { error: privateDetail, visionError: privateDetail },
            revision: 1,
            updatedAt: 102,
          },
        };
      },
    },
  });
  const payloads = await ssePayloads(response);
  assert.equal(payloads.length, 2);
  const event = JSON.parse(payloads[0]);
  assert.equal(event.type, "error");
  assert.equal(event.error, "Upload failed");
  assert.doesNotMatch(JSON.stringify(event), /private-user|secret\.pdf|provider\.internal/u);
  assert.equal(payloads[1], "[DONE]");
});

test("terminal inspect drains the completion event committed after the first replay", async () => {
  process.env.BREADBOARD_LEARN_SOURCE_ROOT = path.join(dashboardRoot, "src");
  await import("../scripts/learn-worker-import-hook.mjs");
  const { createRuntimeIngestSseResponse } = await import(
    "../src/lib/runtime-v2/ingest-compatibility.ts"
  );
  const identity = {
    jobId: "job_ingest_race",
    attempt: 1,
    workerInstanceId: "worker_ingest_race",
  };
  const baseJob = {
    jobId: identity.jobId,
    jobType: "document-ingestion",
    workerKind: "document-ingestion-node",
    resourceClass: "document-processing",
    state: "running",
    stage: "processing",
    attempt: identity.attempt,
    workerInstanceId: identity.workerInstanceId,
    gardenId: "garden-1",
    conversationId: null,
    createdAt: 100,
    startedAt: 101,
    updatedAt: 102,
    finishedAt: null,
    lastHeartbeatAt: 102,
    lastWorkerSequence: 1,
    progressCurrent: 1,
    progressTotal: 4,
    failureCode: null,
    failureMessage: null,
    resourceExhaustion: null,
    cancellationRequested: false,
  };
  const terminalJob = {
    ...baseJob,
    state: "succeeded",
    stage: "finalizing",
    updatedAt: 104,
    finishedAt: 104,
    lastWorkerSequence: 2,
    progressCurrent: 4,
  };
  const tokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    estimated: false,
    startedCalls: 0,
    completedCalls: 0,
    reportedCalls: 0,
    unreportedCalls: 0,
    inFlightCalls: 0,
    model: "selected-model",
  };
  let replayCalls = 0;
  const waits = [];
  const outputKinds = [];
  const response = createRuntimeIngestSseResponse({
    authority: { userId: 42, gardenId: "garden-1", conversationId: null },
    job: baseJob,
    model: "selected-model",
    startedAt: Date.now(),
    control: {
      async replay(_authority, _jobId, after) {
        replayCalls += 1;
        if (replayCalls === 1) {
          return {
            jobId: identity.jobId,
            after,
            nextAfter: after,
            terminal: false,
            hasMore: false,
            events: [],
          };
        }
        if (replayCalls === 2) {
          return {
            jobId: identity.jobId,
            after,
            nextAfter: 1,
            terminal: false,
            hasMore: false,
            events: [{
              sequence: 1,
              jobId: identity.jobId,
              attempt: identity.attempt,
              workerInstanceId: identity.workerInstanceId,
              workerSequence: 2,
              eventType: "worker-complete",
              payload: {},
              createdAt: 103,
            }],
          };
        }
        return {
          jobId: identity.jobId,
          after,
          nextAfter: 1,
          terminal: true,
          hasMore: false,
          events: [],
        };
      },
      async inspect() {
        return terminalJob;
      },
      async readOutput(_authority, _jobId, kind) {
        outputKinds.push(kind);
        if (kind === "checkpoint") {
          return {
            jobId: identity.jobId,
            kind,
            content: {
              protocolVersion: 1,
              identity,
              stage: "finalizing",
              step: "Finishing up…",
              tokenUsage,
              failure: null,
              revision: 2,
              updatedAt: 103,
            },
          };
        }
        return {
          jobId: identity.jobId,
          kind,
          content: {
            protocolVersion: 1,
            identity,
            completionSequence: 2,
            result: {
              success: true,
              filename: "source.md",
              slug: "source",
              sourceRelPath: "garden-1/sources/source.md",
              wordCount: 2,
              topicCount: 0,
              imageCount: 0,
              mapGenerated: false,
              durationMs: 3,
              tokenUsage,
            },
          },
        };
      },
      async wait(milliseconds) {
        waits.push(milliseconds);
      },
    },
  });
  const payloads = await ssePayloads(response);
  assert.equal(replayCalls, 3);
  assert.deepEqual(waits, [200]);
  assert.deepEqual(
    outputKinds,
    ["result"],
    "assignment must not authorize a checkpoint read before worker-checkpoint",
  );
  assert.equal(JSON.parse(payloads.at(-2)).type, "result");
  assert.equal(payloads.at(-1), "[DONE]");
});

test("an already-succeeded cancel disposition does not authorize a client abort", async () => {
  process.env.BREADBOARD_LEARN_SOURCE_ROOT = path.join(dashboardRoot, "src");
  await import("../scripts/learn-worker-import-hook.mjs");
  const { runtimeIngestCancellationDisposition } = await import(
    "../src/lib/runtime-v2/ingest-cancellation.ts"
  );
  const succeeded = {
    jobId: "job_ingest_already_done",
    state: "succeeded",
    cancellationRequested: false,
  };
  assert.deepEqual(runtimeIngestCancellationDisposition(succeeded), {
    jobId: succeeded.jobId,
    state: "succeeded",
    accepted: false,
  });
  assert.equal(
    runtimeIngestCancellationDisposition({
      ...succeeded,
      state: "cancelling",
      cancellationRequested: true,
    }).accepted,
    true,
  );
});

test("existing upload clients provide trusted stream metadata and explicit cancellation", () => {
  for (const relativePath of [
    path.join("src", "app", "gardens", "[clusterSlug]", "workspace-client.tsx"),
    path.join("src", "app", "dashboard", "dashboard-client.tsx"),
  ]) {
    const source = fs.readFileSync(path.join(dashboardRoot, relativePath), "utf8");
    assert.match(source, /X-Breadboard-Ingest-Cluster-Slug/u);
    assert.match(source, /X-Breadboard-Ingest-File-Size/u);
    assert.match(source, /X-Breadboard-Ingest-Request-Id/u);
    assert.match(source, /beginRuntimeIngestRecovery/u);
    assert.match(source, /bindRuntimeIngestResponse/u);
    assert.match(source, /cancelPendingRuntimeIngest/u);
    assert.match(source, /recoverRuntimeIngest/u);
    assert.match(source, /runtimeIngestRecoveries/u);
    const requestIdentity = source.indexOf("const requestId = crypto.randomUUID()");
    const persisted = source.indexOf("beginRuntimeIngestRecovery({", requestIdentity);
    const submitted = source.indexOf('fetch("/api/ingest"', persisted);
    assert.ok(requestIdentity >= 0 && requestIdentity < persisted);
    assert.ok(persisted < submitted, "recovery identity must persist before POST");
    assert.doesNotMatch(
      source,
      /The upload finished before cancellation could be accepted/u,
    );
    assert.doesNotMatch(
      source,
      /formData\.append\("file", file\);\s*formData\.append\("clusterSlug"/u,
    );
  }

  const workspaceSource = fs.readFileSync(
    path.join(
      dashboardRoot,
      "src",
      "app",
      "gardens",
      "[clusterSlug]",
      "workspace-client.tsx",
    ),
    "utf8",
  );
  assert.match(
    workspaceSource,
    /if \(runtimeIngestRecoveryRecord\(requestId\)\) \{\s*continueSyllabusRecovery\(\);\s*return;\s*\}/u,
  );
});

test("reattach, lookup, and pending-cancel routes close authority and job-kind validation", () => {
  const eventsRoute = fs.readFileSync(
    path.join(
      dashboardRoot,
      "src",
      "app",
      "api",
      "ingest",
      "jobs",
      "[jobId]",
      "events",
      "route.ts",
    ),
    "utf8",
  );
  assert.match(eventsRoute, /requireOwnedClusterFromSlug/u);
  assert.match(eventsRoute, /inspectRuntimeJob/u);
  assert.match(eventsRoute, /isRuntimeDocumentIngestionJob/u);
  assert.match(eventsRoute, /createRuntimeIngestSseResponse/u);
  assert.doesNotMatch(
    eventsRoute,
    /runIngest|withCapabilityLease|child_process|\bspawn\s*\(/u,
  );

  const lookupRoute = fs.readFileSync(
    path.join(
      dashboardRoot,
      "src",
      "app",
      "api",
      "ingest",
      "jobs",
      "lookup",
      "route.ts",
    ),
    "utf8",
  );
  assert.match(lookupRoute, /requireOwnedClusterFromSlug/u);
  assert.match(lookupRoute, /runtimeIngestIdempotencyKey/u);
  assert.match(lookupRoute, /lookupRuntimeJobByIdempotencyKey/u);
  assert.match(lookupRoute, /isRuntimeDocumentIngestionJob/u);
  assert.doesNotMatch(lookupRoute, /request\.json/u);

  const pendingCancelRoute = fs.readFileSync(
    path.join(
      dashboardRoot,
      "src",
      "app",
      "api",
      "ingest",
      "jobs",
      "cancel-pending",
      "route.ts",
    ),
    "utf8",
  );
  assert.match(pendingCancelRoute, /requireOwnedClusterFromSlug/u);
  assert.match(pendingCancelRoute, /runtimeIngestIdempotencyKey/u);
  assert.match(pendingCancelRoute, /lookupRuntimeJobByIdempotencyKey/u);
  assert.match(pendingCancelRoute, /isRuntimeDocumentIngestionJob/u);
  assert.match(pendingCancelRoute, /cancelRuntimeJobByIdempotencyKey/u);
  assert.match(pendingCancelRoute, /JOB_NOT_FOUND/u);
  assert.doesNotMatch(pendingCancelRoute, /request\.json/u);
});

test("ingestion recovery persists only bounded nonsecret identity until terminal", async () => {
  const values = new Map();
  const previousStorage = globalThis.sessionStorage;
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key),
    },
  });
  try {
    const recovery = await import(
      "../src/lib/runtime-v2/ingest-recovery-client.ts"
    );
    const record = recovery.beginRuntimeIngestRecovery({
      requestId: "request_1",
      clusterSlug: "garden-1",
      filename: "source.md",
      fileKey: "source.md-12",
      startedAt: 100,
    });
    assert.equal(record.jobId, null);
    assert.equal(record.purpose, "documents");
    assert.doesNotMatch(JSON.stringify(record), /token|authorization|cookie/iu);

    const response = new Response(null, {
      headers: {
        "X-Breadboard-Runtime-Job-Id": "job_1",
        "X-Breadboard-Ingest-Model": encodeURIComponent("model-1"),
        "X-Breadboard-Ingest-Started-At": "101",
      },
    });
    const bound = recovery.bindRuntimeIngestResponse("request_1", response);
    assert.equal(bound.jobId, "job_1");
    assert.equal(bound.model, "model-1");
    assert.equal(recovery.runtimeIngestRecoveries().length, 1);

    recovery.forgetRuntimeIngestRecovery("request_1");
    assert.deepEqual(recovery.runtimeIngestRecoveries(), []);
  } finally {
    if (previousStorage === undefined) delete globalThis.sessionStorage;
    else {
      Object.defineProperty(globalThis, "sessionStorage", {
        configurable: true,
        value: previousStorage,
      });
    }
  }
});

test("cancel between durable submit and response headers resolves by idempotency", async () => {
  const values = new Map();
  const previousStorage = globalThis.sessionStorage;
  const previousFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key),
    },
  });
  try {
    const recovery = await import(
      "../src/lib/runtime-v2/ingest-recovery-client.ts"
    );
    recovery.beginRuntimeIngestRecovery({
      requestId: "request_race",
      clusterSlug: "garden-1",
      filename: "race.md",
      fileKey: "race.md-10",
      startedAt: 100,
    });
    const calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return Response.json({
        jobId: "job_race",
        state: "cancelling",
        accepted: true,
      });
    };
    assert.equal(
      await recovery.cancelPendingRuntimeIngest("request_race"),
      true,
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "/api/ingest/jobs/cancel-pending");
    assert.equal(
      calls[0].init.headers["X-Breadboard-Ingest-Request-Id"],
      "request_race",
    );
    assert.deepEqual(
      {
        jobId: recovery.runtimeIngestRecoveryRecord("request_race").jobId,
        cancelRequested:
          recovery.runtimeIngestRecoveryRecord("request_race").cancelRequested,
      },
      { jobId: "job_race", cancelRequested: true },
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousStorage === undefined) delete globalThis.sessionStorage;
    else {
      Object.defineProperty(globalThis, "sessionStorage", {
        configurable: true,
        value: previousStorage,
      });
    }
  }
});

test("cancel before submission installs a durable tombstone and retires the browser record", async () => {
  const values = new Map();
  const previousStorage = globalThis.sessionStorage;
  const previousFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key),
    },
  });
  try {
    const recovery = await import(
      "../src/lib/runtime-v2/ingest-recovery-client.ts"
    );
    recovery.beginRuntimeIngestRecovery({
      requestId: "request_before_submit",
      clusterSlug: "garden-1",
      filename: "pending.md",
      fileKey: "pending.md-10",
      startedAt: 100,
    });
    globalThis.fetch = async () => Response.json({
      jobId: null,
      state: "pending",
      accepted: true,
    });
    assert.equal(
      await recovery.cancelPendingRuntimeIngest("request_before_submit"),
      true,
    );
    assert.equal(
      recovery.runtimeIngestRecoveryRecord("request_before_submit"),
      null,
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousStorage === undefined) delete globalThis.sessionStorage;
    else {
      Object.defineProperty(globalThis, "sessionStorage", {
        configurable: true,
        value: previousStorage,
      });
    }
  }
});

test("closed pending-cancel quota retains cancellation recovery metadata", async () => {
  const values = new Map();
  const previousStorage = globalThis.sessionStorage;
  const previousFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key),
    },
  });
  try {
    const recovery = await import(
      "../src/lib/runtime-v2/ingest-recovery-client.ts"
    );
    recovery.beginRuntimeIngestRecovery({
      requestId: "request_quota",
      clusterSlug: "garden-1",
      filename: "quota.md",
      fileKey: "quota.md-10",
      startedAt: 100,
    });
    globalThis.fetch = async () => Response.json(
      { code: "JOB_CANCELLATION_QUOTA_EXCEEDED" },
      { status: 429 },
    );
    await assert.rejects(
      recovery.cancelPendingRuntimeIngest("request_quota"),
      /cancellation is unavailable/u,
    );
    assert.deepEqual(
      recovery.runtimeIngestRecoveryRecord("request_quota"),
      {
        protocolVersion: 1,
        requestId: "request_quota",
        jobId: null,
        clusterSlug: "garden-1",
        filename: "quota.md",
        fileKey: "quota.md-10",
        purpose: "documents",
        startedAt: 100,
        model: null,
        cancelRequested: true,
      },
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousStorage === undefined) delete globalThis.sessionStorage;
    else {
      Object.defineProperty(globalThis, "sessionStorage", {
        configurable: true,
        value: previousStorage,
      });
    }
  }
});

test("reload reattaches the durable SSE replay and clears only after terminal", async () => {
  const values = new Map();
  const previousStorage = globalThis.sessionStorage;
  const previousFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key),
    },
  });
  try {
    const recovery = await import(
      "../src/lib/runtime-v2/ingest-recovery-client.ts"
    );
    recovery.beginRuntimeIngestRecovery({
      requestId: "request_reload",
      clusterSlug: "garden-1",
      filename: "reload.md",
      fileKey: "reload.md-10",
      startedAt: 100,
    });
    const record = recovery.bindRuntimeIngestRecovery("request_reload", {
      jobId: "job_reload",
      model: "model-1",
    });
    const calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(
        'data: {"type":"progress","step":"Saving…"}\n\n' +
          'data: {"type":"result","success":true,"slug":"reload"}\n\n' +
          "data: [DONE]\n\n",
        {
          headers: {
            "Content-Type": "text/event-stream",
            "X-Breadboard-Runtime-Job-Id": "job_reload",
            "X-Breadboard-Runtime-Job-State": "running",
          },
        },
      );
    };
    const events = [];
    const outcome = await recovery.recoverRuntimeIngest(
      record,
      (event) => events.push(event),
      { lookupWaitMs: 100, retryIntervalMs: 0 },
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "/api/ingest/jobs/job_reload/events");
    assert.equal(events.length, 2);
    assert.equal(outcome.terminalEvent.type, "result");
    assert.equal(recovery.runtimeIngestRecoveryRecord("request_reload"), null);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousStorage === undefined) delete globalThis.sessionStorage;
    else {
      Object.defineProperty(globalThis, "sessionStorage", {
        configurable: true,
        value: previousStorage,
      });
    }
  }
});

test("a terminal cancel disposition resolves and retires recovery metadata", async () => {
  const values = new Map();
  const previousStorage = globalThis.sessionStorage;
  const previousFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key),
    },
  });
  try {
    const recovery = await import(
      "../src/lib/runtime-v2/ingest-recovery-client.ts"
    );
    recovery.beginRuntimeIngestRecovery({
      requestId: "request_finished",
      clusterSlug: "garden-1",
      filename: "finished.md",
      fileKey: "finished.md-10",
      startedAt: 100,
    });
    const record = recovery.bindRuntimeIngestRecovery("request_finished", {
      jobId: "job_finished",
    });
    globalThis.fetch = async () => Response.json({
      jobId: "job_finished",
      state: "succeeded",
      accepted: false,
    });
    assert.equal(await recovery.cancelRuntimeIngestRecovery(record), true);
    assert.equal(recovery.runtimeIngestRecoveryRecord("request_finished"), null);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousStorage === undefined) delete globalThis.sessionStorage;
    else {
      Object.defineProperty(globalThis, "sessionStorage", {
        configurable: true,
        value: previousStorage,
      });
    }
  }
});

test("recovery SSE parsing is buffer-bounded and cancels a rejected reader", async () => {
  const recovery = await import(
    "../src/lib/runtime-v2/ingest-recovery-client.ts"
  );
  let canceled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(65 * 1024).fill(0x61));
    },
    cancel() {
      canceled = true;
    },
  });
  await assert.rejects(
    recovery.readRuntimeIngestEventStream(
      new Response(body, {
        headers: { "X-Breadboard-Runtime-Job-State": "running" },
      }),
      () => undefined,
    ),
    /bounded buffer/,
  );
  assert.equal(canceled, true);
});
