import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import {
  assertMandatoryServiceRegistration,
  buildRuntimePassClaims,
} from "./packaged-parity-runtime-evidence.mjs";

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex").toUpperCase();
}

function job({
  jobId,
  state = "succeeded",
  workerKind = "worker-a",
  jobType = "job-a",
  workerInstanceId = `${jobId}-instance`,
  rootPid,
  cancellationRequested = 0,
  createdAt = 2_100,
  events,
}) {
  const terminalEvent = state === "cancelled" ? "cancelled" : "complete";
  return {
    jobId,
    jobType,
    workerKind,
    state,
    attempt: 1,
    workerInstanceId,
    createdAt,
    startedAt: createdAt + 10,
    finishedAt: createdAt + 100,
    cancellationRequested,
    events: events ?? [
      {
        eventType: terminalEvent,
        payload: { state },
        attempt: 1,
        workerInstanceId,
        createdAt: createdAt + 90,
      },
      {
        eventType: "completion-confirmed",
        payload: {
          treeExited: true,
          peakAccountingComplete: true,
          rootPid,
          peakPrivateCommitBytes: 64 * 1024 * 1024,
        },
        attempt: 1,
        workerInstanceId,
        createdAt: createdAt + 100,
      },
    ],
  };
}

function snapshot({ jobs = [], processIds = [], listeners, services, leases, capturedAtMs = 2_500 } = {}) {
  return {
    capturedAtMs,
    jobs,
    processIds,
    services: services ?? [
      {
        serviceId: "gbrain",
        required: 1,
        lifecycleState: "ready",
        generation: 1,
        createdAt: 1_100,
        updatedAt: 2_200,
      },
    ],
    leases: leases ?? [
      {
        leaseId: "lease-gbrain-1",
        serviceId: "gbrain",
        generation: 1,
        lifecycleState: "active",
        createdAt: 2_050,
        updatedAt: 2_100,
      },
    ],
    listeners: listeners ?? [
      {
        serviceId: "gbrain",
        port: 8_731,
        ownerPids: [550],
        runtimeOwned: true,
      },
    ],
  };
}

function applicablePlan(overrides = {}) {
  return {
    capabilityId: "tool-family:synthetic-runtime-proof",
    services: [{ serviceId: "gbrain", requirement: "required", startupPolicy: "eager" }],
    workers: [{ workerKind: "worker-a", jobTypes: ["job-a"], gracefulCancellationMs: 5_000 }],
    cancellation: { supported: true, contract: "Stop terminates the run." },
    ...overrides,
  };
}

function applicableEvidence(overrides = {}) {
  const completed = job({ jobId: "job-complete", rootPid: 4_321 });
  const cancelled = job({
    jobId: "job-cancelled",
    state: "cancelled",
    rootPid: 4_322,
    cancellationRequested: 1,
    createdAt: 2_700,
  });
  return {
    plan: applicablePlan(),
    before: snapshot({ jobs: [], capturedAtMs: 2_000 }),
    after: snapshot({ jobs: [completed], processIds: [550] }),
    cancellationBefore: snapshot({ jobs: [completed], capturedAtMs: 2_600 }),
    cancellationAfter: snapshot({ jobs: [completed, cancelled], processIds: [550], capturedAtMs: 3_000 }),
    packageOpenedAtMs: 1_000,
    workflowStartedAtMs: 2_000,
    cancellationUi: { requested: true, terminalVisible: true, controlCleared: true },
    ...overrides,
  };
}

test("runtime PASS claims require service ownership, a fresh completed worker tree, and durable cancellation", () => {
  const claims = buildRuntimePassClaims(applicableEvidence());

  assert.deepEqual(claims.service, [{
    applicability: "APPLICABLE",
    serviceId: "gbrain",
    runtimeOwned: true,
    startOrLeaseObserved: true,
    singleInstanceObserved: true,
    readyObserved: true,
  }]);
  assert.deepEqual(claims.worker, [{
    applicability: "APPLICABLE",
    workerKind: "worker-a",
    jobIdSha256: sha256("job-complete"),
    workerInstanceIdSha256: sha256("job-complete-instance"),
    freshProcessObserved: true,
    terminalExitObserved: true,
    descendantsCleaned: true,
  }]);
  assert.deepEqual(claims.cancellation, {
    applicability: "APPLICABLE",
    cancellationRequested: true,
    terminalCancellationObserved: true,
    visibleResultObserved: true,
    descendantsCleaned: true,
  });
});

test("manifest-proven non-applicability is explicit for service, worker, and cancellation", () => {
  const plan = applicablePlan({
    services: [],
    workers: [],
    cancellation: { supported: false, contract: "Not applicable." },
  });
  const empty = snapshot({ jobs: [], services: [], leases: [], listeners: [], processIds: [] });
  const claims = buildRuntimePassClaims({
    plan,
    before: empty,
    after: empty,
    cancellationBefore: empty,
    cancellationAfter: empty,
    packageOpenedAtMs: 1_000,
    workflowStartedAtMs: 2_000,
    cancellationUi: null,
  });

  assert.deepEqual(claims.service, [{
    applicability: "NOT_APPLICABLE",
    inventoryContractObserved: true,
    noServiceExpected: true,
  }]);
  assert.deepEqual(claims.worker, [{
    applicability: "NOT_APPLICABLE",
    inventoryContractObserved: true,
    noWorkerExpected: true,
  }]);
  assert.deepEqual(claims.cancellation, {
    applicability: "NOT_APPLICABLE",
    inventoryContractObserved: true,
    cancellationNotSupported: true,
  });
});

test("runtime PASS rejects absent, duplicate, or non-runtime service listener ownership", () => {
  for (const listeners of [
    [],
    [{ serviceId: "gbrain", port: 8_731, ownerPids: [550, 551], runtimeOwned: true }],
    [{ serviceId: "gbrain", port: 8_731, ownerPids: [550], runtimeOwned: false }],
  ]) {
    const evidence = applicableEvidence();
    evidence.after = snapshot({ jobs: evidence.after.jobs, processIds: [550], listeners });
    assert.throws(
      () => buildRuntimePassClaims(evidence),
      /lacks exactly one Runtime-owned loopback listener/u,
    );
  }
});

test("runtime PASS rejects missing worker completion authority and a surviving root PID", () => {
  const missingComplete = applicableEvidence();
  const incompleteJob = job({ jobId: "job-complete", rootPid: 4_321 });
  incompleteJob.events = incompleteJob.events.filter(({ eventType }) => eventType !== "complete");
  missingComplete.after = snapshot({ jobs: [incompleteJob], processIds: [550] });
  assert.throws(() => buildRuntimePassClaims(missingComplete), /lacks its exact worker complete event/u);

  const liveRoot = applicableEvidence();
  liveRoot.after = snapshot({ jobs: liveRoot.after.jobs, processIds: [550, 4_321] });
  assert.throws(() => buildRuntimePassClaims(liveRoot), /still has its authoritative root PID/u);

  const duplicateTreeAuthority = applicableEvidence();
  const duplicate = structuredClone(duplicateTreeAuthority.after.jobs[0]);
  duplicate.events.push(structuredClone(duplicate.events.find(({ eventType }) => eventType === "completion-confirmed")));
  duplicateTreeAuthority.after = snapshot({ jobs: [duplicate], processIds: [550] });
  assert.throws(
    () => buildRuntimePassClaims(duplicateTreeAuthority),
    /requires exactly one authoritative completion-confirmed event/u,
  );
});

test("runtime PASS rejects reused or conflicting worker jobs", () => {
  const reused = applicableEvidence();
  reused.before = snapshot({ jobs: reused.after.jobs });
  assert.throws(
    () => buildRuntimePassClaims(reused),
    /requires exactly one new succeeded job; observed 0/u,
  );

  const conflict = applicableEvidence();
  conflict.after = snapshot({
    jobs: [
      ...conflict.after.jobs,
      job({ jobId: "job-wrong-worker", workerKind: "worker-b", rootPid: 4_399 }),
    ],
    processIds: [550],
  });
  assert.throws(() => buildRuntimePassClaims(conflict), /used a different worker/u);
});

test("runtime PASS rejects cancellation without both visible UI state and durable worker intent", () => {
  const invisible = applicableEvidence({
    cancellationUi: { requested: true, terminalVisible: false, controlCleared: true },
  });
  assert.throws(
    () => buildRuntimePassClaims(invisible),
    /lacks visible user cancellation and terminal UI evidence/u,
  );

  const noIntent = applicableEvidence();
  const cancelled = job({
    jobId: "job-cancelled",
    state: "cancelled",
    rootPid: 4_322,
    cancellationRequested: 0,
    createdAt: 2_700,
  });
  noIntent.cancellationAfter = snapshot({
    jobs: [...noIntent.cancellationBefore.jobs, cancelled],
    processIds: [550],
    capturedAtMs: 3_000,
  });
  assert.throws(() => buildRuntimePassClaims(noIntent), /lacks durable cancellation intent/u);
});

test("mandatory service registration includes GBrain and rejects optional, absent, or unready eager services", () => {
  const manifest = {
    services: [
      { id: "gbrain", requirement: "required", startupPolicy: "eager" },
      { id: "on-demand-a", requirement: "required", startupPolicy: "on-demand" },
    ],
  };
  const services = [
    { serviceId: "gbrain", required: 1, lifecycleState: "ready", generation: 1, createdAt: 1, updatedAt: 2 },
    { serviceId: "on-demand-a", required: 1, lifecycleState: "stopped", generation: 0, createdAt: 1, updatedAt: 2 },
  ];
  const evidence = snapshot({ services, jobs: [], leases: [], listeners: [], processIds: [] });

  assert.deepEqual(assertMandatoryServiceRegistration(manifest, evidence), ["gbrain", "on-demand-a"]);
  assert.throws(
    () => assertMandatoryServiceRegistration({ services: manifest.services.slice(1) }, evidence),
    /omits GBrain/u,
  );
  assert.throws(
    () => assertMandatoryServiceRegistration({
      services: [{ ...manifest.services[0], requirement: "optional" }],
    }, evidence),
    /not mandatory in the packaged manifest/u,
  );
  assert.throws(
    () => assertMandatoryServiceRegistration(manifest, snapshot({
      services: services.slice(0, 1),
      jobs: [],
      leases: [],
      listeners: [],
      processIds: [],
    })),
    /on-demand-a is not registered mandatory/u,
  );
  assert.throws(
    () => assertMandatoryServiceRegistration(manifest, snapshot({
      services: [{ ...services[0], lifecycleState: "starting" }, services[1]],
      jobs: [],
      leases: [],
      listeners: [],
      processIds: [],
    })),
    /eager mandatory service gbrain is not ready/u,
  );
});
