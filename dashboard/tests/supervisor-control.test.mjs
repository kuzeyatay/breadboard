import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import {
  SupervisorResourceExhaustedError,
  RuntimeJobControlError,
  abandonRuntimeJobInput,
  acquireServiceLease,
  cancelRuntimeJob,
  cancelRuntimeJobByIdempotencyKey,
  inspectRuntimeJob,
  inspectRuntimeJobForStatus,
  lookupRuntimeJobByIdempotencyKey,
  readRuntimeJobOutput,
  readSupervisedServiceSnapshot,
  replayRuntimeJobEvents,
  replayRuntimeJobEventsForStatus,
  releaseSupervisorLease,
  reserveRuntimeJobInput,
  submitRuntimeLearnRecoveryJob,
  submitRuntimeJob,
  uploadRuntimeJobInput,
  withCapabilityLease,
  withServiceLease,
} from "../src/lib/supervisor-control.ts";

test("read-only Runtime status requests use the short control deadline", async () => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const deadlines = [];
  globalThis.fetch = async (_url, options) =>
    await new Promise((_resolve, reject) => {
      const signal = options?.signal;
      const rejectAborted = () =>
        reject(new DOMException("status deadline elapsed", "AbortError"));
      if (signal?.aborted) rejectAborted();
      else signal?.addEventListener("abort", rejectAborted, { once: true });
    });
  globalThis.setTimeout = (callback, delay) => {
    deadlines.push(delay);
    queueMicrotask(callback);
    return 1;
  };
  globalThis.clearTimeout = () => {};
  const env = {
    BREADBOARD_SUPERVISOR_CONTROL_URL: "http://127.0.0.1:1",
    BREADBOARD_SUPERVISOR_CONTROL_TOKEN:
      "0123456789abcdef0123456789abcdef",
  };
  const authority = { userId: 42, gardenId: "garden-1", conversationId: null };
  try {
    await assert.rejects(
      inspectRuntimeJobForStatus(authority, "job_1", env),
      (error) => error?.name === "AbortError",
    );
    await assert.rejects(
      replayRuntimeJobEventsForStatus(authority, "job_1", 0, 100, env),
      (error) => error?.name === "AbortError",
    );
    await assert.rejects(
      inspectRuntimeJob(authority, "job_1", env),
      (error) => error?.name === "AbortError",
    );
    assert.deepEqual(deadlines, [5_000, 5_000, 4 * 60_000]);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

async function controlHarness(handler, options = {}) {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const bodyBytes = Buffer.concat(chunks);
    const contentType = request.headers["content-type"] ?? "";
    const body = bodyBytes.byteLength === 0
      ? {}
      : /^application\/json\b/iu.test(contentType)
        ? JSON.parse(bodyBytes.toString("utf8"))
        : bodyBytes;
    requests.push({
      url: request.url,
      authorization: request.headers.authorization,
      userId: request.headers["x-breadboard-user-id"],
      gardenId: request.headers["x-breadboard-garden-id"],
      conversationId: request.headers["x-breadboard-conversation-id"],
      contentLength: request.headers["content-length"],
      contentType,
      body,
    });
    const contractMatch = /^\/v1\/services\/([^/]+)\/lease-contract$/u.exec(
      request.url ?? "",
    );
    const result = contractMatch && request.method === "GET"
      ? options.serviceLeaseContract
        ? await options.serviceLeaseContract(request, requests.at(-1))
        : {
            body: {
              protocolVersion: 1,
              serviceId: contractMatch[1],
              acquireTimeoutMs: 250_000,
            },
          }
      : await handler(request, requests.at(-1));
    response.writeHead(result.status ?? 200, { "content-type": "application/json" });
    response.end(result.body === undefined ? undefined : JSON.stringify(result.body));
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
    resourceExhaustion: null,
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
const RUNTIME_RESOURCE_EXHAUSTION = {
  resource: "windows_commit",
  requiredHeadroomMb: 8192,
  availableHeadroomMb: 4096,
  retryable: false,
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
  ["worker-ready", { state: "cancelling" }, WORKER_FENCE],
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
  ["worker-failed", { state: "cancelling" }, WORKER_FENCE],
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
  [
    "job-resource-exhausted",
    {
      state: "resource_exhausted",
      resourceExhaustion: RUNTIME_RESOURCE_EXHAUSTION,
    },
    RUNTIME_ZERO_FENCE,
  ],
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
      "/v1/services/hermes/lease-contract",
      "/v1/services/hermes/lease",
      "/v1/leases/11111111-1111-1111-1111-111111111111/release",
    ]);
    assert.ok(harness.requests.every((request) => request.authorization === "Bearer 0123456789abcdef0123456789abcdef"));
    assert.ok(harness.requests.every((request) => !request.url.includes("0123456789abcdef0123456789abcdef")));
  } finally {
    await harness.close();
  }
});

test("Voicebox acquire uses its manifest-derived cold-start deadline", async () => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const deadlines = [];
  const calls = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), method: init?.method, aborted: init?.signal?.aborted });
    if (String(input).endsWith("/v1/services/voicebox/lease-contract")) {
      return Response.json({
        protocolVersion: 1,
        serviceId: "voicebox",
        acquireTimeoutMs: 1_810_000,
      });
    }
    return Response.json({
      ok: true,
      leaseId: "voicebox-cold-lease",
      serviceId: "voicebox",
    });
  };
  globalThis.setTimeout = (_callback, delay) => {
    deadlines.push(delay);
    return 1;
  };
  globalThis.clearTimeout = () => {};
  const env = {
    BREADBOARD_SUPERVISOR_CONTROL_URL: "http://127.0.0.1:43121",
    BREADBOARD_SUPERVISOR_CONTROL_TOKEN: "0123456789abcdef0123456789abcdef",
  };
  try {
    const lease = await acquireServiceLease("voicebox", "first-transcription", env);
    assert.equal(lease?.id, "voicebox-cold-lease");
    assert.deepEqual(deadlines, [5_000, 1_815_000]);
    assert.deepEqual(calls, [
      {
        url: "http://127.0.0.1:43121/v1/services/voicebox/lease-contract",
        method: "GET",
        aborted: false,
      },
      {
        url: "http://127.0.0.1:43121/v1/services/voicebox/lease",
        method: "POST",
        aborted: false,
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("service acquire fails closed before POST on a malformed deadline contract", async () => {
  const harness = await controlHarness(
    async () => {
      throw new Error("acquire POST must not run after a malformed contract");
    },
    {
      serviceLeaseContract: async () => ({
        body: {
          protocolVersion: 1,
          serviceId: "voicebox",
          acquireTimeoutMs: 1_810_000,
          startupTimeoutMs: 1_800_000,
        },
      }),
    },
  );
  try {
    await assert.rejects(
      acquireServiceLease("voicebox", "closed-contract", harness.env),
      /invalid service lease contract/u,
    );
    assert.equal(harness.requests.length, 1);
    assert.equal(harness.requests[0].url, "/v1/services/voicebox/lease-contract");
  } finally {
    await harness.close();
  }
});

test("service acquire rejects deadlines at or below the native grace floor", async () => {
  for (const acquireTimeoutMs of [1, 10_000]) {
    const harness = await controlHarness(
      async () => {
        throw new Error("acquire POST must not run below the native deadline floor");
      },
      {
        serviceLeaseContract: async () => ({
          body: {
            protocolVersion: 1,
            serviceId: "voicebox",
            acquireTimeoutMs,
          },
        }),
      },
    );
    try {
      await assert.rejects(
        acquireServiceLease("voicebox", "closed-deadline-floor", harness.env),
        /invalid service lease contract/u,
      );
      assert.equal(harness.requests.length, 1);
      assert.equal(harness.requests[0].url, "/v1/services/voicebox/lease-contract");
    } finally {
      await harness.close();
    }
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
    assert.equal(harness.requests.length, 2);
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
    assert.equal(harness.requests.length, 2);
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

test("Runtime V2 idempotency lookup carries authority only in trusted headers", async () => {
  const authority = {
    userId: 42,
    gardenId: "garden-1",
    conversationId: null,
  };
  const harness = await controlHarness(async (request, observed) => {
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/v1/jobs/lookup");
    assert.equal(observed.userId, "42");
    assert.equal(observed.gardenId, "garden-1");
    assert.equal(observed.conversationId, undefined);
    assert.deepEqual(observed.body, { idempotencyKey: "ingest-request_1" });
    assert.equal("gardenId" in observed.body, false);
    assert.equal("userId" in observed.body, false);
    return {
      body: {
        type: "runtime-job",
        protocolVersion: 1,
        job: runtimeJobSnapshot({
          jobType: "document-ingestion",
          workerKind: "document-ingestion-node",
          resourceClass: "document-processing",
          conversationId: null,
        }),
      },
    };
  });
  try {
    const job = await lookupRuntimeJobByIdempotencyKey(
      authority,
      "ingest-request_1",
      harness.env,
    );
    assert.equal(job.jobId, "job_1");
    assert.equal(harness.requests.length, 1);
  } finally {
    await harness.close();
  }
});

test("Runtime V2 idempotency cancellation sends the exact scoped request and accepts only terminal dispositions", async () => {
  const authority = {
    userId: 42,
    gardenId: "garden-1",
    conversationId: "conversation-1",
  };
  const dispositions = [
    { jobId: null, state: "pending", accepted: true },
    { jobId: "job_1", state: "cancelling", accepted: true },
    { jobId: "job_1", state: "cancelled", accepted: true },
    { jobId: "job_1", state: "succeeded", accepted: false },
    { jobId: "job_1", state: "failed", accepted: false },
    { jobId: "job_1", state: "resource_exhausted", accepted: false },
    { jobId: "job_1", state: "interrupted", accepted: false },
    { jobId: "job_1", state: "uncertain", accepted: false },
  ];
  let responseIndex = 0;
  const harness = await controlHarness(async (request, observed) => {
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/v1/jobs/cancel-by-idempotency");
    assert.equal(observed.authorization, "Bearer 0123456789abcdef0123456789abcdef");
    assert.equal(observed.userId, "42");
    assert.equal(observed.gardenId, "garden-1");
    assert.equal(observed.conversationId, "conversation-1");
    assert.match(observed.contentType, /^application\/json\b/iu);
    assert.deepEqual(observed.body, { idempotencyKey: "ingest-request_1" });
    return {
      body: {
        type: "runtime-job-idempotency-cancellation",
        protocolVersion: 1,
        ...dispositions[responseIndex++],
      },
    };
  });
  try {
    for (const expected of dispositions) {
      assert.deepEqual(
        await cancelRuntimeJobByIdempotencyKey(
          authority,
          "ingest-request_1",
          harness.env,
        ),
        expected,
      );
    }
    assert.equal(harness.requests.length, dispositions.length);
  } finally {
    await harness.close();
  }
});

test("Runtime V2 idempotency cancellation rejects active and internally inconsistent dispositions", async () => {
  const authority = { userId: 42, gardenId: "garden-1", conversationId: null };
  const invalidDispositions = [
    ...["queued", "admitted", "starting", "running", "checkpointing"].map(
      (state) => ({ jobId: "job_1", state, accepted: false }),
    ),
    { jobId: "job_1", state: "pending", accepted: true },
    { jobId: null, state: "pending", accepted: false },
    { jobId: "job_1", state: "cancelled", accepted: false },
    { jobId: "job_1", state: "succeeded", accepted: true },
  ];
  let responseIndex = 0;
  const harness = await controlHarness(async () => ({
    body: {
      type: "runtime-job-idempotency-cancellation",
      protocolVersion: 1,
      ...invalidDispositions[responseIndex++],
    },
  }));
  try {
    for (let index = 0; index < invalidDispositions.length; index += 1) {
      await assert.rejects(
        cancelRuntimeJobByIdempotencyKey(
          authority,
          "ingest-request_1",
          harness.env,
        ),
        /invalid idempotency cancellation disposition/,
      );
    }
  } finally {
    await harness.close();
  }
});

test("Runtime V2 idempotency cancellation preserves closed quota and collision errors", async () => {
  const authority = { userId: 42, gardenId: "garden-1", conversationId: null };
  const errors = [
    ["quota-key", 429, "JOB_CANCELLATION_QUOTA_EXCEEDED"],
    ["collision-key", 409, "JOB_CANCELLED_BEFORE_SUBMISSION"],
  ];
  let responseIndex = 0;
  const harness = await controlHarness(async (_request, observed) => {
    const [key, status, code] = errors[responseIndex++];
    assert.deepEqual(observed.body, { idempotencyKey: key });
    return {
      status,
      body: {
        type: "runtime-error",
        protocolVersion: 1,
        code,
        message: "The cancellation request was rejected.",
        retryable: false,
        resource: null,
        requiredHeadroomMb: null,
        availableHeadroomMb: null,
      },
    };
  });
  try {
    for (const [key, status, code] of errors) {
      await assert.rejects(
        cancelRuntimeJobByIdempotencyKey(authority, key, harness.env),
        (error) => {
          assert.ok(error instanceof RuntimeJobControlError);
          assert.equal(error.code, code);
          assert.equal(error.status, status);
          assert.equal(error.retryable, false);
          return true;
        },
      );
    }
  } finally {
    await harness.close();
  }
});

test("Runtime V2 Learn recovery uses only the dashboard bearer and fixed internal body", async () => {
  const harness = await controlHarness(async (request, observed) => {
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/v1/internal/jobs/learn-recovery");
    assert.equal(observed.authorization, "Bearer 0123456789abcdef0123456789abcdef");
    assert.equal(observed.userId, undefined);
    assert.equal(observed.gardenId, undefined);
    assert.equal(observed.conversationId, undefined);
    assert.match(observed.contentType, /^application\/json\b/iu);
    assert.deepEqual(observed.body, { idempotencyKey: "learn-recovery-v2:42" });
    return {
      status: 202,
      body: {
        type: "runtime-job",
        protocolVersion: 1,
        job: runtimeJobSnapshot({ gardenId: null, conversationId: null }),
      },
    };
  });
  try {
    const job = await submitRuntimeLearnRecoveryJob(
      "learn-recovery-v2:42",
      harness.env,
    );
    assert.equal(job.jobId, "job_1");
    assert.equal(job.jobType, "learn");

    for (const idempotencyKey of [
      "learn-recovery-v1:42",
      "learn-recovery-v2:-1",
      "learn-recovery-v2:42 ",
      "learn-recovery-v2:9007199254740992",
      "learn-recovery-v2:12345678901234567",
    ]) {
      await assert.rejects(
        submitRuntimeLearnRecoveryJob(idempotencyKey, harness.env),
        /Learn recovery idempotency key is invalid/,
      );
    }
    assert.equal(harness.requests.length, 1);
  } finally {
    await harness.close();
  }
});

test("Runtime V2 Learn recovery rejects forged envelopes, scopes, and job types", async () => {
  const responses = [
    {
      type: "runtime-job",
      protocolVersion: 1,
      job: runtimeJobSnapshot({ gardenId: null, conversationId: null }),
      forged: true,
    },
    {
      type: "runtime-job",
      protocolVersion: 1,
      job: runtimeJobSnapshot({ gardenId: "garden-1", conversationId: null }),
    },
    {
      type: "runtime-job",
      protocolVersion: 1,
      job: runtimeJobSnapshot({
        jobType: "document-ingestion",
        workerKind: "document-ingestion-node",
        resourceClass: "document-processing",
        gardenId: null,
        conversationId: null,
      }),
    },
  ];
  let responseIndex = 0;
  const harness = await controlHarness(async () => ({
    status: 202,
    body: responses[responseIndex++],
  }));
  try {
    for (let index = 0; index < responses.length; index += 1) {
      await assert.rejects(
        submitRuntimeLearnRecoveryJob(`learn-recovery-v2:${index + 1}`, harness.env),
        /invalid job response|invalid job snapshot|outside the requested binding/,
      );
    }
  } finally {
    await harness.close();
  }
});

test("Runtime V2 input reservation and raw upload stream bytes outside JSON", async () => {
  const authority = { userId: 42, gardenId: "garden-1", conversationId: null };
  const bytes = Buffer.alloc(3 * 1024 * 1024 + 19, 0x61);
  const harness = await controlHarness(async (request, observed) => {
    if (request.url === "/v1/job-inputs") {
      assert.equal(request.method, "POST");
      assert.deepEqual(observed.body, {
        gardenId: "garden-1",
        conversationId: null,
        displayName: "large.bin",
        mediaType: "application/octet-stream",
        declaredSizeBytes: bytes.byteLength,
      });
      return {
        status: 201,
        body: {
          uploadId: "upload_1",
          expiresAt: Date.now() + 60_000,
          maximumBytes: 2 * 1024 * 1024 * 1024,
        },
      };
    }
    assert.equal(request.url, "/v1/job-inputs/upload_1");
    assert.equal(request.method, "PUT");
    assert.equal(observed.contentType, "application/octet-stream");
    assert.equal(observed.contentLength, String(bytes.byteLength));
    assert.ok(Buffer.isBuffer(observed.body));
    assert.deepEqual(observed.body, bytes);
    return {
      body: {
        type: "runtime-job-input",
        protocolVersion: 1,
        uploadId: "upload_1",
        state: "sealed",
        sizeBytes: bytes.byteLength,
        sha256: "a".repeat(64),
      },
    };
  });
  try {
    const reservation = await reserveRuntimeJobInput(
      authority,
      {
        gardenId: "garden-1",
        conversationId: null,
        displayName: "large.bin",
        mediaType: "application/octet-stream",
        declaredSizeBytes: bytes.byteLength,
      },
      harness.env,
    );
    let offset = 0;
    let pulls = 0;
    const body = new ReadableStream({
      pull(controller) {
        pulls += 1;
        if (offset >= bytes.byteLength) {
          controller.close();
          return;
        }
        const end = Math.min(offset + 64 * 1024, bytes.byteLength);
        controller.enqueue(bytes.subarray(offset, end));
        offset = end;
      },
    });
    const sealed = await uploadRuntimeJobInput(
      authority,
      reservation,
      body,
      undefined,
      harness.env,
    );
    assert.equal(sealed.uploadId, "upload_1");
    assert.equal(sealed.sizeBytes, bytes.byteLength);
    assert.ok(pulls > 40, "raw upload should be pulled as bounded stream chunks");
    assert.equal(harness.requests.length, 2);
  } finally {
    await harness.close();
  }
});

test("Runtime V2 rejects nonpositive or already-expired input reservations", async () => {
  const authority = { userId: 42, gardenId: "garden-1", conversationId: null };
  let expiresAt = 0;
  const harness = await controlHarness(async () => ({
    status: 201,
    body: {
      uploadId: "upload_expired",
      expiresAt,
      maximumBytes: 1024,
    },
  }));
  const reserve = () => reserveRuntimeJobInput(
    authority,
    {
      gardenId: "garden-1",
      conversationId: null,
      displayName: "expired.bin",
      mediaType: "application/octet-stream",
      declaredSizeBytes: 1,
    },
    harness.env,
  );
  try {
    await assert.rejects(reserve(), /invalid job input reservation/);
    expiresAt = Date.now() - 1;
    await assert.rejects(reserve(), /invalid job input reservation/);
  } finally {
    await harness.close();
  }
});

test("Runtime V2 preserves the bounded upload-too-large classification", async () => {
  const authority = { userId: 42, gardenId: "garden-1", conversationId: null };
  const harness = await controlHarness(async () => ({
    status: 413,
    body: {
      type: "runtime-error",
      protocolVersion: 1,
      code: "JOB_INPUT_TOO_LARGE",
      message: "The job input exceeded its bounded upload reservation.",
      retryable: false,
      resource: null,
      requiredHeadroomMb: null,
      availableHeadroomMb: null,
    },
  }));
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    },
  });
  try {
    await assert.rejects(
      uploadRuntimeJobInput(
        authority,
        {
          uploadId: "upload_1",
          expiresAt: Date.now() + 60_000,
          maximumBytes: 3,
          displayName: "bounded.bin",
          mediaType: "application/octet-stream",
          declaredSizeBytes: 3,
        },
        body,
        undefined,
        harness.env,
      ),
      (error) => {
        assert.ok(error instanceof RuntimeJobControlError);
        assert.equal(error.code, "JOB_INPUT_TOO_LARGE");
        assert.equal(error.status, 413);
        assert.equal(error.retryable, false);
        return true;
      },
    );
  } finally {
    await harness.close();
  }
});

test("Runtime V2 preserves the closed input-quota classification", async () => {
  const authority = { userId: 42, gardenId: "garden-1", conversationId: null };
  const harness = await controlHarness(async () => ({
    status: 429,
    body: {
      type: "runtime-error",
      protocolVersion: 1,
      code: "JOB_INPUT_QUOTA_EXCEEDED",
      message: "The job input reservation quota is exhausted.",
      retryable: false,
      resource: null,
      requiredHeadroomMb: null,
      availableHeadroomMb: null,
    },
  }));
  try {
    await assert.rejects(
      reserveRuntimeJobInput(
        authority,
        {
          gardenId: "garden-1",
          conversationId: null,
          displayName: "quota.bin",
          mediaType: "application/octet-stream",
          declaredSizeBytes: 1,
        },
        harness.env,
      ),
      (error) => {
        assert.ok(error instanceof RuntimeJobControlError);
        assert.equal(error.code, "JOB_INPUT_QUOTA_EXCEEDED");
        assert.equal(error.retryable, false);
        return true;
      },
    );
  } finally {
    await harness.close();
  }
});

test("Runtime V2 job submission adopts only opaque upload references", async () => {
  const authority = { userId: 42, gardenId: "garden-1", conversationId: null };
  const harness = await controlHarness(async (_request, observed) => {
    assert.deepEqual(observed.body, {
      jobType: "document-ingestion",
      gardenId: "garden-1",
      conversationId: null,
      idempotencyKey: "ingest-1",
      inputUploads: [{ uploadId: "upload_1" }],
      requestPayload: { generateMap: false },
    });
    assert.doesNotMatch(JSON.stringify(observed.body), /sha256|sizeBytes|filePath|bytes/u);
    return {
      status: 202,
      body: {
        type: "runtime-job",
        protocolVersion: 1,
        job: runtimeJobSnapshot({
          jobType: "document-ingestion",
          workerKind: "document-ingestion-node",
          resourceClass: "document-processing",
          conversationId: null,
        }),
      },
    };
  });
  try {
    const job = await submitRuntimeJob(
      authority,
      {
        jobType: "document-ingestion",
        idempotencyKey: "ingest-1",
        inputUploads: [{ uploadId: "upload_1" }],
        requestPayload: { generateMap: false },
      },
      harness.env,
    );
    assert.equal(job.jobType, "document-ingestion");
  } finally {
    await harness.close();
  }
});

test("Runtime V2 bounded output retrieval keeps kind and job binding exact", async () => {
  const authority = { userId: 42, gardenId: "garden-1", conversationId: null };
  const harness = await controlHarness(async (request) => {
    assert.equal(request.url, "/v1/jobs/job_1/checkpoint");
    return {
      body: {
        type: "runtime-job-output",
        protocolVersion: 1,
        jobId: "job_1",
        kind: "checkpoint",
        content: { protocolVersion: 1, step: "Reading…" },
      },
    };
  });
  try {
    const output = await readRuntimeJobOutput(
      authority,
      "job_1",
      "checkpoint",
      harness.env,
    );
    assert.equal(output.kind, "checkpoint");
    assert.equal(output.content.step, "Reading…");
  } finally {
    await harness.close();
  }
});

test("Runtime V2 input abandonment is authenticated and carries no body", async () => {
  const authority = { userId: 42, gardenId: "garden-1", conversationId: null };
  const harness = await controlHarness(async (request, observed) => {
    assert.equal(request.url, "/v1/job-inputs/upload_1/abandon");
    assert.equal(request.method, "POST");
    assert.equal(observed.userId, "42");
    assert.equal(observed.gardenId, "garden-1");
    assert.deepEqual(observed.body, {});
    return { status: 200, body: { ok: true } };
  });
  try {
    await abandonRuntimeJobInput(authority, "upload_1", harness.env);
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
        const wrongState = payload.state === "queued" ? "failed" : "queued";
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

    failure = {
      state: "resource_exhausted",
      failureCode: "BREADBOARD_RESOURCE_EXHAUSTED",
      failureMessage: "Runtime job execution failed.",
      resourceExhaustion: RUNTIME_RESOURCE_EXHAUSTION,
    };
    assert.deepEqual(
      (await inspectRuntimeJob(authority, "job_1", harness.env)).resourceExhaustion,
      RUNTIME_RESOURCE_EXHAUSTION,
    );

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
      {
        state: "failed",
        failureCode: "RUNTIME_JOB_FAILED",
        failureMessage: "Runtime job execution failed.",
        resourceExhaustion: RUNTIME_RESOURCE_EXHAUSTION,
      },
      {
        state: "resource_exhausted",
        failureCode: "BREADBOARD_RESOURCE_EXHAUSTED",
        failureMessage: "Runtime job execution failed.",
        resourceExhaustion: {
          ...RUNTIME_RESOURCE_EXHAUSTION,
          requiredHeadroomMb: 0,
        },
      },
      {
        state: "resource_exhausted",
        failureCode: "BREADBOARD_RESOURCE_EXHAUSTED",
        failureMessage: "Runtime job execution failed.",
        resourceExhaustion: {
          ...RUNTIME_RESOURCE_EXHAUSTION,
          retryable: true,
        },
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
