import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import {
  SupervisorResourceExhaustedError,
  RuntimeJobControlError,
  acquireServiceLease,
  cancelRuntimeJob,
  inspectRuntimeJob,
  readSupervisedServiceSnapshot,
  replayRuntimeJobEvents,
  releaseSupervisorLease,
  submitRuntimeJob,
  withCapabilityLease,
  withServiceLease,
} from "../src/lib/supervisor-control.ts";

async function controlHarness(handler) {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push({
      url: request.url,
      authorization: request.headers.authorization,
      userId: request.headers["x-breadboard-user-id"],
      gardenId: request.headers["x-breadboard-garden-id"],
      conversationId: request.headers["x-breadboard-conversation-id"],
      body: body ? JSON.parse(body) : {},
    });
    const result = await handler(request, requests.at(-1));
    response.writeHead(result.status ?? 200, { "content-type": "application/json" });
    response.end(JSON.stringify(result.body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const env = {
    BREADBOARD_SUPERVISOR_CONTROL_URL: `http://127.0.0.1:${address.port}`,
    BREADBOARD_SUPERVISOR_CONTROL_TOKEN: "0123456789abcdef0123456789abcdef",
  };
  return {
    env,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function runtimeJobSnapshot(overrides = {}) {
  return {
    jobId: "job_1",
    jobType: "learn",
    workerKind: "learn-node",
    resourceClass: "large-generation",
    state: "queued",
    stage: null,
    attempt: 0,
    workerInstanceId: null,
    gardenId: "garden-1",
    conversationId: "conversation-1",
    createdAt: 100,
    startedAt: null,
    updatedAt: 100,
    finishedAt: null,
    lastHeartbeatAt: null,
    lastWorkerSequence: 0,
    progressCurrent: 0,
    progressTotal: 0,
    failureCode: null,
    failureMessage: null,
    cancellationRequested: false,
    ...overrides,
  };
}

function runtimeJobEvent(eventType, payload, fence, overrides = {}) {
  return {
    sequence: 1,
    jobId: "job_1",
    ...fence,
    eventType,
    payload,
    createdAt: 100,
    ...overrides,
  };
}

function runtimeJobEventReplayBody(event) {
  return {
    type: "runtime-job-events",
    protocolVersion: 1,
    jobId: "job_1",
    after: 0,
    nextAfter: event.sequence,
    terminal: false,
    hasMore: false,
    events: [event],
  };
}

const RUNTIME_ZERO_FENCE = {
  attempt: 0,
  workerInstanceId: null,
  workerSequence: null,
};
const RUNTIME_ATTEMPT_FENCE = {
  attempt: 1,
  workerInstanceId: "worker_1",
  workerSequence: null,
};
const WORKER_FENCE = {
  attempt: 1,
  workerInstanceId: "worker_1",
  workerSequence: 1,
};

const RUNTIME_JOB_EVENT_MATRIX = [
  ["queued", { state: "queued" }, RUNTIME_ZERO_FENCE],
  ["admitted", { state: "admitted" }, RUNTIME_ZERO_FENCE],
  ["worker-assigned", { state: "starting" }, RUNTIME_ATTEMPT_FENCE],
  ["reservation-settled", {}, RUNTIME_ATTEMPT_FENCE],
  ["reservation-released", {}, RUNTIME_ZERO_FENCE],
  ["cancellation-requested", { state: "cancelling" }, RUNTIME_ZERO_FENCE],
  ["completion-confirmed", { state: "succeeded" }, RUNTIME_ATTEMPT_FENCE],
  ["worker-ready", { state: "running" }, WORKER_FENCE],
  ["worker-heartbeat", { stage: "working" }, WORKER_FENCE],
  [
    "worker-progress",
    { stage: "generating", progressCurrent: 1, progressTotal: 2 },
    WORKER_FENCE,
  ],
  ["worker-checkpoint", { artifactKind: "checkpoint" }, WORKER_FENCE],
  ["worker-artifact", { artifactKind: "document" }, WORKER_FENCE],
  ["worker-complete", {}, WORKER_FENCE],
  [
    "worker-failed",
    {
      state: "failed",
      failureCode: "WORKER_FAILED",
      failureMessage: "Runtime job execution failed.",
    },
    WORKER_FENCE,
  ],
  [
    "worker-cancellation-acknowledged",
    { state: "cancelling" },
    WORKER_FENCE,
  ],
  ["job-starting", { state: "starting" }, RUNTIME_ATTEMPT_FENCE],
  ["job-running", { state: "running" }, RUNTIME_ATTEMPT_FENCE],
  ["job-checkpointing", { state: "checkpointing" }, RUNTIME_ATTEMPT_FENCE],
  ["job-cancelling", { state: "cancelling" }, RUNTIME_ZERO_FENCE],
  ["job-cancelled", { state: "cancelled" }, RUNTIME_ZERO_FENCE],
  ["job-succeeded", { state: "succeeded" }, RUNTIME_ATTEMPT_FENCE],
  ["job-failed", { state: "failed" }, RUNTIME_ATTEMPT_FENCE],
  ["job-resource-exhausted", { state: "resource_exhausted" }, RUNTIME_ZERO_FENCE],
  ["job-interrupted", { state: "interrupted" }, RUNTIME_ZERO_FENCE],
  ["job-uncertain", { state: "uncertain" }, RUNTIME_ATTEMPT_FENCE],
];

test("a service lease stays active for the operation and releases on cancellation", async () => {
  let active = false;
  const harness = await controlHarness(async (request) => {
    if (request.url === "/v1/services/hermes/lease") {
      active = true;
      return { body: { ok: true, leaseId: "11111111-1111-1111-1111-111111111111", serviceId: "hermes" } };
    }
    if (request.url === "/v1/leases/11111111-1111-1111-1111-111111111111/release") {
      active = false;
      return { body: { ok: true, released: true } };
    }
    return { status: 404, body: { ok: false } };
  });
  try {
    await assert.rejects(
      withServiceLease("hermes", "cancelled-stream", async () => {
        assert.equal(active, true);
        throw new DOMException("client disconnected", "AbortError");
      }, harness.env),
      (error) => error?.name === "AbortError",
    );
    assert.equal(active, false);
    assert.deepEqual(harness.requests.map((request) => request.url), [
      "/v1/services/hermes/lease",
      "/v1/leases/11111111-1111-1111-1111-111111111111/release",
    ]);
    assert.ok(harness.requests.every((request) => request.authorization === "Bearer 0123456789abcdef0123456789abcdef"));
    assert.ok(harness.requests.every((request) => !request.url.includes("0123456789abcdef0123456789abcdef")));
  } finally {
    await harness.close();
  }
});

test("commit admission denial remains structured and is never retried", async () => {
  const harness = await controlHarness(async () => ({
    status: 503,
    body: {
      code: "BREADBOARD_RESOURCE_EXHAUSTED",
      resource: "windows_commit",
      requiredHeadroomMb: 8192,
      availableHeadroomMb: 5376,
      reserveHeadroomMb: 4096,
      incomingEstimateMb: 3072,
      overlapHeadroomMb: 1024,
      denialReason: "headroom",
      retryable: false,
      state: "critical",
    },
  }));
  try {
    await assert.rejects(
      acquireServiceLease("ui-tars", "browser-run", harness.env),
      (error) => {
        assert.ok(error instanceof SupervisorResourceExhaustedError);
        assert.equal(error.result.availableHeadroomMb, 5376);
        assert.equal(error.result.reserveHeadroomMb, 4096);
        assert.equal(error.result.incomingEstimateMb, 3072);
        assert.equal(error.result.overlapHeadroomMb, 1024);
        assert.equal(error.result.denialReason, "headroom");
        assert.equal(error.result.retryable, false);
        assert.match(
          error.message,
          /4096 MB reserve \+ 3072 MB incoming estimate \+ 1024 MB overlap/,
        );
        return true;
      },
    );
    assert.equal(harness.requests.length, 1);
  } finally {
    await harness.close();
  }
});

test("an active heavyweight denial is explained as concurrency, not impossible headroom", async () => {
  const harness = await controlHarness(async () => ({
    status: 503,
    body: {
      code: "BREADBOARD_RESOURCE_EXHAUSTED",
      resource: "windows_commit",
      requiredHeadroomMb: 0,
      availableHeadroomMb: 16384,
      reserveHeadroomMb: 4096,
      incomingEstimateMb: 0,
      overlapHeadroomMb: 0,
      denialReason: "active_heavyweight",
      retryable: false,
      state: "normal",
    },
  }));
  try {
    await assert.rejects(
      acquireServiceLease("ui-tars", "blocked-by-heavy-work", harness.env),
      (error) => {
        assert.ok(error instanceof SupervisorResourceExhaustedError);
        assert.equal(error.result.denialReason, "active_heavyweight");
        assert.match(error.message, /another heavyweight operation is already active/i);
        assert.doesNotMatch(error.message, /needs 0 MB/i);
        return true;
      },
    );
  } finally {
    await harness.close();
  }
});

test("a local-pressure denial does not masquerade as insufficient commit headroom", async () => {
  const harness = await controlHarness(async () => ({
    status: 503,
    body: {
      code: "BREADBOARD_RESOURCE_EXHAUSTED",
      resource: "windows_commit",
      requiredHeadroomMb: 8192,
      availableHeadroomMb: 16384,
      reserveHeadroomMb: 4096,
      incomingEstimateMb: 4096,
      overlapHeadroomMb: 0,
      denialReason: "pressure",
      retryable: false,
      state: "constrained",
    },
  }));
  try {
    await assert.rejects(
      acquireServiceLease("ui-tars", "blocked-by-local-pressure", harness.env),
      (error) => {
        assert.ok(error instanceof SupervisorResourceExhaustedError);
        assert.equal(error.result.denialReason, "pressure");
        assert.match(error.message, /memory pressure prevents new work/i);
        assert.match(error.message, /16384 MB/);
        assert.doesNotMatch(error.message, /needs 8192 MB/i);
        return true;
      },
    );
  } finally {
    await harness.close();
  }
});

test("a worker release carries its recorded PID for deferred OS-exit fencing", async () => {
  const leaseId = "22222222-2222-2222-2222-222222222222";
  const harness = await controlHarness(async (request, observed) => {
    assert.equal(request.url, `/v1/leases/${leaseId}/release`);
    assert.deepEqual(observed.body, { afterOwnerPidExit: 424242 });
    return {
      body: {
        ok: true,
        released: false,
        deferred: true,
        ownerPid: 424242,
      },
    };
  });
  try {
    await releaseSupervisorLease(leaseId, harness.env, {
      afterOwnerPidExit: 424242,
    });
    assert.equal(harness.requests.length, 1);
    await assert.rejects(
      releaseSupervisorLease(leaseId, harness.env, { afterOwnerPidExit: 0 }),
      /positive safe integer/,
    );
    assert.equal(harness.requests.length, 1);
  } finally {
    await harness.close();
  }
});

test("bare dashboard development degrades to a local no-op lease", async () => {
  let ran = false;
  const result = await withCapabilityLease("document-ingestion", "ingest", async () => {
    ran = true;
    return 42;
  }, {});
  assert.equal(ran, true);
  assert.equal(result, 42);
});

test("authenticated control responses are rejected above the byte ceiling", async () => {
  const harness = await controlHarness(async () => ({
    body: {
      leaseId: "33333333-3333-3333-3333-333333333333",
      serviceId: "hermes",
      padding: "x".repeat(70 * 1024),
    },
  }));
  try {
    await assert.rejects(
      acquireServiceLease("hermes", "bounded-response", harness.env),
      /65536-byte limit/,
    );
    assert.equal(harness.requests.length, 1);
  } finally {
    await harness.close();
  }
});

test("passive service status uses the same bounded authenticated response path", async () => {
  const harness = await controlHarness(async (request) => {
    assert.equal(request.method, "GET");
    assert.equal(request.url, "/v1/status");
    return {
      body: {
        services: [
          { id: "hermes", state: "available-but-stopped" },
        ],
      },
    };
  });
  try {
    assert.deepEqual(
      await readSupervisedServiceSnapshot("hermes", harness.env),
      { id: "hermes", state: "available-but-stopped" },
    );
    assert.equal(harness.requests.length, 1);
  } finally {
    await harness.close();
  }
});

test("control authority rejects DNS hostnames even when they resolve to loopback", async () => {
  await assert.rejects(
    acquireServiceLease("hermes", "literal-loopback-only", {
      BREADBOARD_SUPERVISOR_CONTROL_URL: "http://localhost:7739",
      BREADBOARD_SUPERVISOR_CONTROL_TOKEN: "0123456789abcdef0123456789abcdef",
    }),
    /must use HTTP on loopback/,
  );
});

test("partial or weak control authority configuration fails closed", async () => {
  await assert.rejects(
    acquireServiceLease("hermes", "missing-token", {
      BREADBOARD_SUPERVISOR_CONTROL_URL: "http://127.0.0.1:7739",
    }),
    /configuration is incomplete/,
  );
  await assert.rejects(
    acquireServiceLease("hermes", "weak-token", {
      BREADBOARD_SUPERVISOR_CONTROL_URL: "http://127.0.0.1:7739",
      BREADBOARD_SUPERVISOR_CONTROL_TOKEN: "too-short",
    }),
    /control token is invalid/,
  );
});

test("Runtime V2 submission carries server-derived scope and accepts only the exact sanitized snapshot", async () => {
  const authority = {
    userId: 42,
    gardenId: "garden-1",
    conversationId: "conversation-1",
  };
  const harness = await controlHarness(async (request, observed) => {
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/v1/jobs");
    assert.equal(observed.userId, "42");
    assert.equal(observed.gardenId, "garden-1");
    assert.equal(observed.conversationId, "conversation-1");
    assert.deepEqual(observed.body, {
      jobType: "learn",
      gardenId: "garden-1",
      conversationId: "conversation-1",
      idempotencyKey: "request-1",
      requestPayload: { sourceIds: ["source-1"] },
    });
    return {
      status: 202,
      body: {
        type: "runtime-job",
        protocolVersion: 1,
        job: runtimeJobSnapshot(),
      },
    };
  });
  try {
    const job = await submitRuntimeJob(
      authority,
      {
        jobType: "learn",
        idempotencyKey: "request-1",
        requestPayload: { sourceIds: ["source-1"] },
      },
      harness.env,
    );
    assert.equal(job.jobId, "job_1");
    assert.equal(job.state, "queued");
    assert.equal(harness.requests.length, 1);
  } finally {
    await harness.close();
  }
});

test("Runtime V2 inspect and cancel never put ownership or authority in the URL or body", async () => {
  const authority = { userId: 7, gardenId: null, conversationId: null };
  const harness = await controlHarness(async (request, observed) => {
    assert.equal(observed.userId, "7");
    assert.equal(observed.gardenId, undefined);
    assert.equal(observed.conversationId, undefined);
    assert.deepEqual(observed.body, {});
    return {
      body: {
        type: "runtime-job",
        protocolVersion: 1,
        job: runtimeJobSnapshot({ gardenId: null, conversationId: null }),
      },
    };
  });
  try {
    await inspectRuntimeJob(authority, "job_1", harness.env);
    await cancelRuntimeJob(authority, "job_1", harness.env);
    assert.deepEqual(
      harness.requests.map((request) => request.url),
      ["/v1/jobs/job_1", "/v1/jobs/job_1/cancel"],
    );
    assert.ok(harness.requests.every((request) => !request.url.includes("user")));
  } finally {
    await harness.close();
  }
});

test("Runtime V2 event replay enforces one job, a strict cursor, and a bounded page", async () => {
  const authority = { userId: 42, gardenId: "garden-1", conversationId: null };
  const harness = await controlHarness(async (request) => {
    assert.equal(request.method, "GET");
    assert.equal(request.url, "/v1/jobs/job_1/events?after=3&limit=2");
    return {
      body: {
        type: "runtime-job-events",
        protocolVersion: 1,
        jobId: "job_1",
        after: 3,
        nextAfter: 5,
        terminal: false,
        hasMore: false,
        events: [
          {
            sequence: 4,
            jobId: "job_1",
            attempt: 1,
            workerInstanceId: "worker_1",
            workerSequence: 1,
            eventType: "worker-ready",
            payload: { state: "running" },
            createdAt: 101,
          },
          {
            sequence: 5,
            jobId: "job_1",
            attempt: 1,
            workerInstanceId: "worker_1",
            workerSequence: 2,
            eventType: "worker-progress",
            payload: { stage: "generating", progressCurrent: 1, progressTotal: 2 },
            createdAt: 102,
          },
        ],
      },
    };
  });
  try {
    const replay = await replayRuntimeJobEvents(authority, "job_1", 3, 2, harness.env);
    assert.equal(replay.events.length, 2);
    assert.equal(replay.nextAfter, 5);
    assert.equal(replay.hasMore, false);
  } finally {
    await harness.close();
  }
});

test("Runtime V2 accepts the exact payload and fence matrix for all public event types", async () => {
  const authority = { userId: 42, gardenId: null, conversationId: null };
  let responseEvent = runtimeJobEvent(
    "queued",
    { state: "queued" },
    RUNTIME_ZERO_FENCE,
  );
  const harness = await controlHarness(async () => ({
    body: runtimeJobEventReplayBody(responseEvent),
  }));
  const currentFenceTypes = new Set([
    "reservation-released",
    "cancellation-requested",
    "job-cancelling",
    "job-cancelled",
    "job-resource-exhausted",
    "job-interrupted",
  ]);
  try {
    for (const [eventType, payload, fence] of RUNTIME_JOB_EVENT_MATRIX) {
      responseEvent = runtimeJobEvent(eventType, payload, fence);
      const replay = await replayRuntimeJobEvents(
        authority,
        "job_1",
        0,
        1,
        harness.env,
      );
      assert.equal(replay.events[0].eventType, eventType);
      assert.deepEqual(replay.events[0].payload, payload);

      if (currentFenceTypes.has(eventType)) {
        responseEvent = runtimeJobEvent(eventType, payload, RUNTIME_ATTEMPT_FENCE);
        const attemptedReplay = await replayRuntimeJobEvents(
          authority,
          "job_1",
          0,
          1,
          harness.env,
        );
        assert.equal(attemptedReplay.events[0].attempt, 1);
      }
    }
  } finally {
    await harness.close();
  }
});

test("Runtime V2 rejects missing, extra, and wrong event payload fields", async () => {
  const authority = { userId: 42, gardenId: null, conversationId: null };
  let responseEvent = runtimeJobEvent(
    "queued",
    { state: "queued" },
    RUNTIME_ZERO_FENCE,
  );
  const harness = await controlHarness(async () => ({
    body: runtimeJobEventReplayBody(responseEvent),
  }));
  try {
    for (const [eventType, payload, fence] of RUNTIME_JOB_EVENT_MATRIX) {
      const payloadKeys = Object.keys(payload);
      if (payloadKeys.length > 0) {
        const missing = { ...payload };
        delete missing[payloadKeys[0]];
        responseEvent = runtimeJobEvent(eventType, missing, fence);
        await assert.rejects(
          replayRuntimeJobEvents(authority, "job_1", 0, 1, harness.env),
          /invalid job event payload/,
          `${eventType} accepted a missing required payload field`,
        );
      }

      const extra = "stage" in payload
        ? { ...payload, artifactKind: "document" }
        : { ...payload, stage: "working" };
      responseEvent = runtimeJobEvent(eventType, extra, fence);
      await assert.rejects(
        replayRuntimeJobEvents(authority, "job_1", 0, 1, harness.env),
        /invalid job event payload/,
        `${eventType} accepted an extra payload field`,
      );

      if ("state" in payload) {
        const wrongState = payload.state === "running" ? "failed" : "running";
        responseEvent = runtimeJobEvent(
          eventType,
          { ...payload, state: wrongState },
          fence,
        );
        await assert.rejects(
          replayRuntimeJobEvents(authority, "job_1", 0, 1, harness.env),
          /invalid job event payload/,
          `${eventType} accepted the wrong fixed state`,
        );
      }
    }

    responseEvent = runtimeJobEvent(
      "worker-failed",
      {
        state: "failed",
        failureCode: "WORKER_FAILED",
        failureMessage: "provider secret should not be public",
      },
      WORKER_FENCE,
    );
    await assert.rejects(
      replayRuntimeJobEvents(authority, "job_1", 0, 1, harness.env),
      /invalid job event payload/,
    );

    responseEvent = runtimeJobEvent(
      "worker-failed",
      {
        state: "failed",
        failureCode: "VENDOR_PRIVATE_FAILURE",
        failureMessage: "Runtime job execution failed.",
      },
      WORKER_FENCE,
    );
    await assert.rejects(
      replayRuntimeJobEvents(authority, "job_1", 0, 1, harness.env),
      /invalid job event payload/,
    );

    responseEvent = runtimeJobEvent(
      "worker-artifact",
      { artifactKind: "provider-private-kind" },
      WORKER_FENCE,
    );
    await assert.rejects(
      replayRuntimeJobEvents(authority, "job_1", 0, 1, harness.env),
      /invalid job event payload/,
    );
  } finally {
    await harness.close();
  }
});

test("Runtime V2 rejects worker/runtime origin swaps and malformed fence tuples", async () => {
  const authority = { userId: 42, gardenId: null, conversationId: null };
  let responseEvent = runtimeJobEvent(
    "queued",
    { state: "queued" },
    RUNTIME_ZERO_FENCE,
  );
  const harness = await controlHarness(async () => ({
    body: runtimeJobEventReplayBody(responseEvent),
  }));
  try {
    for (const [eventType, payload, fence] of RUNTIME_JOB_EVENT_MATRIX) {
      const wrongOriginFence = fence === WORKER_FENCE
        ? RUNTIME_ATTEMPT_FENCE
        : WORKER_FENCE;
      responseEvent = runtimeJobEvent(eventType, payload, wrongOriginFence);
      await assert.rejects(
        replayRuntimeJobEvents(authority, "job_1", 0, 1, harness.env),
        /invalid job event fence/,
        `${eventType} accepted the wrong event origin fence`,
      );
    }

    for (const [eventType, payload] of RUNTIME_JOB_EVENT_MATRIX.slice(0, 2)) {
      responseEvent = runtimeJobEvent(eventType, payload, RUNTIME_ATTEMPT_FENCE);
      await assert.rejects(
        replayRuntimeJobEvents(authority, "job_1", 0, 1, harness.env),
        /invalid job event fence/,
        `${eventType} accepted a nonzero runtime fence`,
      );
    }

    for (const [eventType, payload, fence] of RUNTIME_JOB_EVENT_MATRIX) {
      if (fence !== RUNTIME_ATTEMPT_FENCE) continue;
      responseEvent = runtimeJobEvent(eventType, payload, RUNTIME_ZERO_FENCE);
      await assert.rejects(
        replayRuntimeJobEvents(authority, "job_1", 0, 1, harness.env),
        /invalid job event fence/,
        `${eventType} accepted a missing attempt fence`,
      );
    }

    responseEvent = runtimeJobEvent(
      "reservation-released",
      {},
      { attempt: 0, workerInstanceId: "worker_1", workerSequence: null },
    );
    await assert.rejects(
      replayRuntimeJobEvents(authority, "job_1", 0, 1, harness.env),
      /invalid job event fence/,
    );

    responseEvent = runtimeJobEvent(
      "worker-heartbeat",
      { stage: "working" },
      { attempt: 0, workerInstanceId: null, workerSequence: 1 },
    );
    await assert.rejects(
      replayRuntimeJobEvents(authority, "job_1", 0, 1, harness.env),
      /invalid job event fence/,
    );
  } finally {
    await harness.close();
  }
});

test("Runtime V2 snapshots accept only fixed public stages", async () => {
  const authority = { userId: 42, gardenId: null, conversationId: null };
  let responseStage = "working";
  const harness = await controlHarness(async () => ({
    body: {
      type: "runtime-job",
      protocolVersion: 1,
      job: runtimeJobSnapshot({
        gardenId: null,
        conversationId: null,
        stage: responseStage,
      }),
    },
  }));
  try {
    for (const publicStage of [
      "preparing",
      "working",
      "generating",
      "waiting-external",
      "processing",
      "persisting",
      "finalizing",
      "cancelling",
    ]) {
      responseStage = publicStage;
      const job = await inspectRuntimeJob(authority, "job_1", harness.env);
      assert.equal(job.stage, publicStage);
    }

    for (const privateStage of [
      "generate",
      "C:\\private\\runtime\\job.json",
      "provider-secret=do-not-publish",
    ]) {
      responseStage = privateStage;
      await assert.rejects(
        inspectRuntimeJob(authority, "job_1", harness.env),
        /invalid job snapshot/,
      );
    }
  } finally {
    await harness.close();
  }
});

test("Runtime V2 snapshots accept only runtime-owned failure classifications", async () => {
  const authority = { userId: 42, gardenId: null, conversationId: null };
  let failure = {
    state: "failed",
    failureCode: "RUNTIME_JOB_FAILED",
    failureMessage: "Runtime job execution failed.",
  };
  const harness = await controlHarness(async () => ({
    body: {
      type: "runtime-job",
      protocolVersion: 1,
      job: runtimeJobSnapshot({
        gardenId: null,
        conversationId: null,
        ...failure,
      }),
    },
  }));
  try {
    for (const accepted of [
      ["failed", "RUNTIME_JOB_FAILED"],
      ["failed", "WORKER_FAILED"],
      ["resource_exhausted", "BREADBOARD_RESOURCE_EXHAUSTED"],
      ["interrupted", "JOB_INTERRUPTED"],
      ["uncertain", "JOB_UNCERTAIN"],
    ]) {
      failure = {
        state: accepted[0],
        failureCode: accepted[1],
        failureMessage: "Runtime job execution failed.",
      };
      const job = await inspectRuntimeJob(authority, "job_1", harness.env);
      assert.equal(job.failureCode, accepted[1]);
    }

    for (const rejected of [
      {
        state: "failed",
        failureCode: "VENDOR_PRIVATE_FAILURE",
        failureMessage: "Runtime job execution failed.",
      },
      {
        state: "failed",
        failureCode: "RUNTIME_JOB_FAILED",
        failureMessage: "provider secret should not be public",
      },
      {
        state: "running",
        failureCode: "RUNTIME_JOB_FAILED",
        failureMessage: "Runtime job execution failed.",
      },
      {
        state: "failed",
        failureCode: "RUNTIME_JOB_FAILED",
        failureMessage: null,
      },
    ]) {
      failure = rejected;
      await assert.rejects(
        inspectRuntimeJob(authority, "job_1", harness.env),
        /invalid job snapshot/,
      );
    }
  } finally {
    await harness.close();
  }
});

test("Runtime V2 replay rejects raw path and secret stage text", async () => {
  const authority = { userId: 42, gardenId: null, conversationId: null };
  let responseEvent = runtimeJobEvent(
    "worker-heartbeat",
    { stage: "working" },
    WORKER_FENCE,
  );
  const harness = await controlHarness(async () => ({
    body: runtimeJobEventReplayBody(responseEvent),
  }));
  try {
    for (const privateStage of [
      "generate",
      "C:\\private\\runtime\\job.json",
      "provider-secret=do-not-publish",
    ]) {
      responseEvent = runtimeJobEvent(
        "worker-heartbeat",
        { stage: privateStage },
        WORKER_FENCE,
      );
      await assert.rejects(
        replayRuntimeJobEvents(authority, "job_1", 0, 1, harness.env),
        /invalid job event payload/,
      );
    }

    responseEvent = runtimeJobEvent(
      "worker-progress",
      {
        stage: "/srv/runtime/jobs/job_1/workspace",
        progressCurrent: 1,
        progressTotal: 2,
      },
      WORKER_FENCE,
    );
    await assert.rejects(
      replayRuntimeJobEvents(authority, "job_1", 0, 1, harness.env),
      /invalid job event payload/,
    );
  } finally {
    await harness.close();
  }
});

test("Runtime V2 event payloads reject raw worker paths and identities", async () => {
  const authority = { userId: 42, gardenId: "garden-1", conversationId: null };
  const harness = await controlHarness(async () => ({
    body: {
      type: "runtime-job-events",
      protocolVersion: 1,
      jobId: "job_1",
      after: 0,
      nextAfter: 1,
      terminal: false,
      hasMore: false,
      events: [
        {
          sequence: 1,
          jobId: "job_1",
          attempt: 1,
          workerInstanceId: "worker_1",
          workerSequence: 1,
          eventType: "worker-artifact",
          payload: {
            artifactKind: "document",
            path: "runtime/jobs/job_1/workspace/private-output.pdf",
          },
          createdAt: 100,
        },
      ],
    },
  }));
  try {
    await assert.rejects(
      replayRuntimeJobEvents(authority, "job_1", 0, 1, harness.env),
      /invalid job event payload/,
    );
  } finally {
    await harness.close();
  }
});

test("Runtime V2 responses stay bound to the requested job, type, and page size", async () => {
  const authority = { userId: 42, gardenId: "garden-1", conversationId: null };
  const wrongJob = await controlHarness(async () => ({
    body: {
      type: "runtime-job",
      protocolVersion: 1,
      job: runtimeJobSnapshot({ jobId: "job_2", conversationId: null }),
    },
  }));
  try {
    await assert.rejects(
      inspectRuntimeJob(authority, "job_1", wrongJob.env),
      /outside the requested binding/,
    );
  } finally {
    await wrongJob.close();
  }

  const wrongSubmissionType = await controlHarness(async () => ({
    status: 202,
    body: {
      type: "runtime-job",
      protocolVersion: 1,
      job: runtimeJobSnapshot({
        jobType: "ingestion",
        conversationId: null,
      }),
    },
  }));
  try {
    await assert.rejects(
      submitRuntimeJob(
        authority,
        { jobType: "learn", idempotencyKey: "request-1", requestPayload: {} },
        wrongSubmissionType.env,
      ),
      /outside the requested binding/,
    );
  } finally {
    await wrongSubmissionType.close();
  }

  const wrongCancellationJob = await controlHarness(async () => ({
    body: {
      type: "runtime-job",
      protocolVersion: 1,
      job: runtimeJobSnapshot({ jobId: "job_2", conversationId: null }),
    },
  }));
  try {
    await assert.rejects(
      cancelRuntimeJob(authority, "job_1", wrongCancellationJob.env),
      /outside the requested binding/,
    );
  } finally {
    await wrongCancellationJob.close();
  }

  const oversizedPage = await controlHarness(async () => ({
    body: {
      type: "runtime-job-events",
      protocolVersion: 1,
      jobId: "job_1",
      after: 0,
      nextAfter: 2,
      terminal: false,
      hasMore: true,
      events: [
        {
          sequence: 1,
          jobId: "job_1",
          attempt: 0,
          workerInstanceId: null,
          workerSequence: null,
          eventType: "queued",
          payload: { state: "queued" },
          createdAt: 100,
        },
        {
          sequence: 2,
          jobId: "job_1",
          attempt: 0,
          workerInstanceId: null,
          workerSequence: null,
          eventType: "admitted",
          payload: { state: "admitted" },
          createdAt: 101,
        },
      ],
    },
  }));
  try {
    await assert.rejects(
      replayRuntimeJobEvents(authority, "job_1", 0, 1, oversizedPage.env),
      /invalid event replay/,
    );
  } finally {
    await oversizedPage.close();
  }
});

test("Runtime V2 authority scopes use one header-safe grammar", async () => {
  for (const userId of [0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(
      inspectRuntimeJob(
        { userId, gardenId: null, conversationId: null },
        "job_1",
        {},
      ),
      /user ID must be a positive safe integer/,
    );
  }
  await assert.rejects(
    inspectRuntimeJob(
      { userId: 42, gardenId: " garden-1 ", conversationId: null },
      "job_1",
      {},
    ),
    /garden scope is invalid/,
  );
  await assert.rejects(
    inspectRuntimeJob(
      { userId: 42, gardenId: "gärden-1", conversationId: null },
      "job_1",
      {},
    ),
    /garden scope is invalid/,
  );
});

test("Runtime V2 submission rejects values JSON would silently change or omit", async () => {
  const authority = { userId: 42, gardenId: null, conversationId: null };
  for (const requestPayload of [undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
    await assert.rejects(
      submitRuntimeJob(
        authority,
        { jobType: "learn", idempotencyKey: "request-1", requestPayload },
        {},
      ),
      /request payload/,
    );
  }
  await assert.rejects(
    submitRuntimeJob(
      authority,
      { jobType: "learn", idempotencyKey: "request\u0085key", requestPayload: {} },
      {},
    ),
    /idempotency key is invalid/,
  );
});

test("Runtime V2 resource denial stays structured and is issued once", async () => {
  const authority = { userId: 42, gardenId: null, conversationId: null };
  const harness = await controlHarness(async () => ({
    status: 503,
    body: {
      type: "runtime-error",
      protocolVersion: 1,
      code: "BREADBOARD_RESOURCE_EXHAUSTED",
      message: "Windows commit reserve cannot be preserved.",
      retryable: false,
      resource: "windows_commit",
      requiredHeadroomMb: 8192,
      availableHeadroomMb: 5632,
    },
  }));
  try {
    await assert.rejects(
      submitRuntimeJob(
        authority,
        { jobType: "learn", idempotencyKey: "request-1", requestPayload: {} },
        harness.env,
      ),
      (error) => {
        assert.ok(error instanceof RuntimeJobControlError);
        assert.equal(error.code, "BREADBOARD_RESOURCE_EXHAUSTED");
        assert.equal(error.availableHeadroomMb, 5632);
        assert.equal(error.retryable, false);
        return true;
      },
    );
    assert.equal(harness.requests.length, 1);
  } finally {
    await harness.close();
  }
});

test("Runtime V2 rejects forged headroom evidence on non-resource errors", async () => {
  const authority = { userId: 42, gardenId: null, conversationId: null };
  const harness = await controlHarness(async () => ({
    status: 404,
    body: {
      type: "runtime-error",
      protocolVersion: 1,
      code: "JOB_NOT_FOUND",
      message: "The requested job was not found.",
      retryable: false,
      resource: "windows_commit",
      requiredHeadroomMb: 8192,
      availableHeadroomMb: 5632,
    },
  }));
  try {
    await assert.rejects(
      inspectRuntimeJob(authority, "job_1", harness.env),
      (error) => {
        assert.ok(error instanceof RuntimeJobControlError);
        assert.equal(error.code, "RUNTIME_INTERNAL_ERROR");
        assert.equal(error.resource, null);
        return true;
      },
    );
  } finally {
    await harness.close();
  }
});

test("Runtime V2 jobs fail closed when authority is absent or a response leaks internal paths", async () => {
  const authority = { userId: 42, gardenId: null, conversationId: null };
  await assert.rejects(
    inspectRuntimeJob(authority, "job_1", {}),
    (error) => error instanceof RuntimeJobControlError && error.code === "RUNTIME_UNAVAILABLE",
  );

  const harness = await controlHarness(async () => ({
    body: {
      type: "runtime-job",
      protocolVersion: 1,
      job: {
        ...runtimeJobSnapshot({ gardenId: null, conversationId: null }),
        workspacePath: "runtime/jobs/job_1/workspace",
      },
    },
  }));
  try {
    await assert.rejects(
      inspectRuntimeJob(authority, "job_1", harness.env),
      /invalid job snapshot/,
    );
  } finally {
    await harness.close();
  }
});
