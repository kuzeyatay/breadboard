import { createHash } from "node:crypto";

const TERMINAL_JOB_STATES = new Set([
  "cancelled",
  "succeeded",
  "failed",
  "resource_exhausted",
  "interrupted",
  "uncertain",
]);

function fail(message) {
  throw new Error(`Packaged parity runtime evidence rejected: ${message}`);
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex").toUpperCase();
}

function matchingEvents(job, eventType) {
  return job.events.filter((event) =>
    event.eventType === eventType &&
    event.attempt === job.attempt &&
    event.workerInstanceId === job.workerInstanceId);
}

function treeExitEvent(job) {
  const events = matchingEvents(job, "completion-confirmed");
  if (events.length !== 1) fail(`job ${job.jobId} requires exactly one authoritative completion-confirmed event.`);
  const payload = events[0].payload;
  if (
    payload?.treeExited !== true ||
    payload?.peakAccountingComplete !== true ||
    !Number.isSafeInteger(payload.rootPid) || payload.rootPid < 1 ||
    !Number.isSafeInteger(payload.peakPrivateCommitBytes) || payload.peakPrivateCommitBytes < 1
  ) {
    fail(`job ${job.jobId} completion-confirmed payload lacks complete tree/peak authority.`);
  }
  return events[0];
}

function newJobs(before, after) {
  const known = new Set(before.jobs.map(({ jobId }) => jobId));
  return after.jobs.filter(({ jobId }) => !known.has(jobId));
}

function exactWorkerJob(plan, worker, before, after, result) {
  const candidates = newJobs(before, after).filter((job) =>
    job.workerKind === worker.workerKind && worker.jobTypes.includes(job.jobType));
  const wantedState = result === "cancel" ? "cancelled" : "succeeded";
  const matches = candidates.filter(({ state }) => state === wantedState);
  if (matches.length !== 1) {
    fail(`${plan.capabilityId} ${worker.workerKind} requires exactly one new ${wantedState} job; observed ${matches.length}.`);
  }
  const job = matches[0];
  if (!TERMINAL_JOB_STATES.has(job.state) || job.attempt < 1 || !job.workerInstanceId) {
    fail(`${plan.capabilityId} job ${job.jobId} lacks a terminal, attempted worker identity.`);
  }
  const terminalEvent = result === "cancel" ? "cancelled" : "complete";
  if (matchingEvents(job, terminalEvent).length !== 1) {
    fail(`${plan.capabilityId} job ${job.jobId} lacks its exact worker ${terminalEvent} event.`);
  }
  if (
    job.createdAt < before.capturedAtMs ||
    job.createdAt > after.capturedAtMs
  ) {
    fail(`${plan.capabilityId} job ${job.jobId} was not created inside the measured workflow window.`);
  }
  const treeExit = treeExitEvent(job);
  if (!Array.isArray(after.processIds) || after.processIds.includes(treeExit.payload.rootPid)) {
    fail(`${plan.capabilityId} job ${job.jobId} still has its authoritative root PID after terminal exit.`);
  }
  if (result === "cancel" && job.cancellationRequested !== 1) {
    fail(`${plan.capabilityId} cancelled job ${job.jobId} lacks durable cancellation intent.`);
  }
  const conflicting = newJobs(before, after).filter((candidate) =>
    worker.jobTypes.includes(candidate.jobType) && candidate.workerKind !== worker.workerKind);
  if (conflicting.length > 0) {
    fail(`${plan.capabilityId} used a different worker for ${worker.jobTypes.join(",")}: ${conflicting.map(({ workerKind }) => workerKind).join(",")}.`);
  }
  return job;
}

function servicePassClaim(plan, expected, snapshot, packageOpenedAtMs, workflowStartedAtMs) {
  const service = snapshot.services.find(({ serviceId }) => serviceId === expected.serviceId);
  if (!service) fail(`${plan.capabilityId} runtime store omits service ${expected.serviceId}.`);
  if (service.required !== 1) fail(`${plan.capabilityId} service ${expected.serviceId} is not registered mandatory.`);
  if (service.lifecycleState !== "ready" || service.generation < 1) {
    fail(`${plan.capabilityId} service ${expected.serviceId} was not ready in a live generation.`);
  }
  const matchingLeases = snapshot.leases.filter(({ serviceId }) => serviceId === expected.serviceId);
  const leaseObserved = matchingLeases.some(({ createdAt, updatedAt }) =>
    createdAt >= workflowStartedAtMs || updatedAt >= workflowStartedAtMs);
  const startupObserved =
    expected.startupPolicy === "eager" &&
    service.createdAt >= packageOpenedAtMs &&
    service.updatedAt >= service.createdAt &&
    service.generation > 0;
  if (!leaseObserved && !startupObserved) {
    fail(`${plan.capabilityId} service ${expected.serviceId} has neither a workflow lease nor package-run startup authority.`);
  }
  const listener = snapshot.listeners.find(({ serviceId }) => serviceId === expected.serviceId);
  if (!listener || listener.ownerPids.length !== 1 || listener.runtimeOwned !== true) {
    fail(`${plan.capabilityId} service ${expected.serviceId} lacks exactly one Runtime-owned loopback listener.`);
  }
  return Object.freeze({
    applicability: "APPLICABLE",
    serviceId: expected.serviceId,
    runtimeOwned: true,
    startOrLeaseObserved: true,
    singleInstanceObserved: true,
    readyObserved: true,
  });
}

export function assertMandatoryServiceRegistration(serviceManifest, snapshot) {
  if (!Array.isArray(serviceManifest?.services) || serviceManifest.services.length === 0) {
    fail("service manifest is malformed or empty.");
  }
  const ids = serviceManifest.services.map(({ id }) => id).sort();
  if (!ids.includes("gbrain")) fail("mandatory service manifest omits GBrain.");
  for (const entry of serviceManifest.services) {
    if (entry.requirement !== "required") fail(`service ${entry.id} is not mandatory in the packaged manifest.`);
    const stored = snapshot.services.find(({ serviceId }) => serviceId === entry.id);
    if (!stored || stored.required !== 1) fail(`service ${entry.id} is not registered mandatory in the package-run store.`);
    if (entry.startupPolicy === "eager" && stored.lifecycleState !== "ready") {
      fail(`eager mandatory service ${entry.id} is not ready.`);
    }
  }
  return Object.freeze(ids);
}

export function buildRuntimePassClaims({
  plan,
  before,
  after,
  cancellationBefore,
  cancellationAfter,
  packageOpenedAtMs,
  workflowStartedAtMs,
  cancellationUi,
}) {
  const service = plan.services.length === 0
    ? [Object.freeze({ applicability: "NOT_APPLICABLE", inventoryContractObserved: true, noServiceExpected: true })]
    : plan.services.map((expected) => servicePassClaim(plan, expected, after, packageOpenedAtMs, workflowStartedAtMs));

  const worker = plan.workers.length === 0
    ? [Object.freeze({ applicability: "NOT_APPLICABLE", inventoryContractObserved: true, noWorkerExpected: true })]
    : plan.workers.map((expected) => {
        const job = exactWorkerJob(plan, expected, before, after, "complete");
        return Object.freeze({
          applicability: "APPLICABLE",
          workerKind: expected.workerKind,
          jobIdSha256: sha256(job.jobId),
          workerInstanceIdSha256: sha256(job.workerInstanceId),
          freshProcessObserved: true,
          terminalExitObserved: true,
          descendantsCleaned: true,
        });
      });

  let cancellation;
  if (!plan.cancellation.supported) {
    cancellation = Object.freeze({
      applicability: "NOT_APPLICABLE",
      inventoryContractObserved: true,
      cancellationNotSupported: true,
    });
  } else {
    if (
      cancellationUi?.requested !== true ||
      cancellationUi?.terminalVisible !== true ||
      cancellationUi?.controlCleared !== true
    ) {
      fail(`${plan.capabilityId} lacks visible user cancellation and terminal UI evidence.`);
    }
    if (plan.workers.length > 0) {
      for (const expected of plan.workers) {
        exactWorkerJob(plan, expected, cancellationBefore, cancellationAfter, "cancel");
      }
    }
    cancellation = Object.freeze({
      applicability: "APPLICABLE",
      cancellationRequested: true,
      terminalCancellationObserved: true,
      visibleResultObserved: true,
      descendantsCleaned: true,
    });
  }
  return Object.freeze({ service: Object.freeze(service), worker: Object.freeze(worker), cancellation });
}
