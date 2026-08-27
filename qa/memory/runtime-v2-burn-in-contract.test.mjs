import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  RUNTIME_V2_BURN_IN,
  RUNTIME_V2_OPERATION_DEFINITIONS,
  resolveRuntimeV2BurnInSettleWindowMs,
  validateRuntimeV2BurnInReceipt,
} from "./runtime-v2-burn-in-contract.mjs";

const serviceManifest = JSON.parse(fs.readFileSync(
  new URL("../../desktop/runtime-v2/manifests/services.json", import.meta.url),
  "utf8",
));
const expectedMandatoryServiceIds = serviceManifest.services
  .filter(({ requirement }) => requirement === "required")
  .map(({ id }) => id)
  .sort();
const expectedEagerRequiredServiceIds = serviceManifest.services
  .filter(({ requirement, startupPolicy }) => requirement === "required" && startupPolicy === "eager")
  .map(({ id }) => id)
  .sort();

function operation(kind, ordinal, phase = "sequential") {
  const definition = RUNTIME_V2_OPERATION_DEFINITIONS[kind];
  const kindOffset = { learn: 0, ingestion: 100, artifact: 200 }[kind];
  const phaseOffset = phase === "sequential" ? 0 : 1_000;
  const identity = phaseOffset + kindOffset + ordinal;
  return {
    operationId: `${phase}-${kind}-${ordinal}`,
    phase,
    kind,
    ordinal,
    jobType: definition.jobType,
    workerKind: definition.workerKind,
    capabilityId: definition.capabilityId,
    jobId: `job-${identity}`,
    rootWorkerPid: 10_000 + identity,
    workerInstanceId: `worker-${identity}`,
    descendantPids: [20_000 + identity],
    survivingDescendantPids: [],
    treeExited: true,
    peakPrivateMb: { worker: 320, dashboard: 640, renderer: 180, services: 220 },
    minimumFreeCommitMb: 12_000,
    settledCommitMb: 20_000,
    settledOwnedPrivateMb: 1_500,
    settledOwnedProcessCount: 8,
    orphanCount: 0,
    classification: "PASS",
    exitLatencyMs: 250,
    idleStopLatencyMs: null,
    serviceIds: ["gbrain"],
    duplicateServiceIds: [],
    evidence: {
      electron: true,
      windowsSampler: "GetPerformanceInfo",
      runtimeStore: "runtime-v2-sqlite",
    },
  };
}

function validReceipt() {
  const jobIds = [];
  const sequential = Object.fromEntries(
    Object.keys(RUNTIME_V2_OPERATION_DEFINITIONS).map((kind) => [
      kind,
      Array.from({ length: 10 }, (_, index) => operation(kind, index + 1)),
    ]),
  );
  for (const items of Object.values(sequential)) {
    jobIds.push(...items.map(({ jobId }) => jobId));
  }
  const mixedCycles = Array.from({ length: 5 }, (_, index) => {
    const cycle = index + 1;
    const operations = Object.fromEntries(
      Object.keys(RUNTIME_V2_OPERATION_DEFINITIONS).map((kind) => [
        kind,
        operation(kind, cycle, `mixed-${cycle}`),
      ]),
    );
    jobIds.push(...Object.values(operations).map(({ jobId }) => jobId));
    return {
      cycle,
      classification: "PASS",
      surfaceEvidence: {
        gardenChat: true,
        retrieval: true,
        quartzBuild: true,
        actualElectronUi: true,
      },
      conditionalEvidence: {
        browserAgent: "PASS",
        postiz: "PASS",
      },
      operations,
      minimumFreeCommitMb: 12_000,
      settledCommitMb: 20_000,
      settledOwnedPrivateMb: 1_500,
      settledOwnedProcessCount: 8,
      serviceIds: ["chatmock", "dashboard", "quartz"],
      orphanCount: 0,
      duplicateServiceIds: [],
    };
  });
  return {
    schemaVersion: 1,
    workloadProject: "runtime-v2-burn-in",
    runtimeMode: "actual-electron",
    metricSource: "GetPerformanceInfo",
    runId: "runtime-v2-burn-in-contract-test",
    startedAt: "2026-08-26T00:00:00.000Z",
    finishedAt: "2026-08-26T06:01:00.000Z",
    outcome: "PASS",
    acceptance: {
      requiredDurationMs: 21_600_000,
      sequentialRepetitions: 10,
      mixedCycles: 5,
      ordinaryFreeCommitFloorMb: 8_192,
      priorDangerStateMb: 2_900,
      sequentialGrowthFloorMb: 512,
      mixedGrowthFloorMb: 768,
      growthPercent: 0.10,
      postMixedSampleMs: 300_000,
      defaultSettleWindowMs: 30_000,
      measurementCadenceMs: 1_000,
      settleWindowMs: 30_000,
      serviceIdleTtlMs: 600_000,
    },
    stackEvidence: {
      classification: "PASS",
      electron: true,
      runtimeLaunchMode: "lean",
      dashboardMode: "standalone",
      runtimeOwner: "rust-runtime-v2",
      runtimePid: 9_001,
      runtimeProcessName: "breadboard-runtime",
    },
    serviceEvidence: {
      authority: "runtime-v2-services-receipt",
      pointerPath: "C:\\breadboard\\.qa-results\\runtime-v2-services\\latest-success.json",
      pointerSha256: "A".repeat(64),
      receiptPath: "C:\\breadboard\\.qa-results\\runtime-v2-services\\service-run\\receipt.json",
      receiptSha256: "B".repeat(64),
      runId: "service-run",
      suite: "burn",
      runtimeMode: "packaged",
      outcome: "PASS",
      startedAt: "2026-08-25T14:00:00.000Z",
      finishedAt: "2026-08-25T23:30:00.000Z",
      validatedAt: "2026-08-25T23:45:00.000Z",
      maximumAgeMs: 21_600_000,
      serviceCount: 32,
      gbrainIncluded: true,
      executable: {
        path: "C:\\breadboard\\release\\win-unpacked\\Breadboard.exe",
        bytes: 188_000_000,
        sha256: "C".repeat(64),
      },
      sourceIdentity: {
        serviceManifestSha256: "D".repeat(64),
        executionInventorySha256: "E".repeat(64),
        runnerSha256: "F".repeat(64),
        contractSha256: "0".repeat(64),
        implementationClosureSha256: "1".repeat(64),
      },
    },
    serviceCoverage: {
      classification: "PASS",
      mandatoryServiceIds: [...RUNTIME_V2_BURN_IN.mandatoryServiceIds],
      eagerRequiredServiceIds: [...RUNTIME_V2_BURN_IN.eagerRequiredServiceIds],
      observedServiceIds: [...RUNTIME_V2_BURN_IN.observedServiceIds],
      manifestWideEvidenceAuthority: "runtime-v2-services-receipt",
      services: RUNTIME_V2_BURN_IN.observedServiceIds.map((serviceId, index) => ({
        serviceId,
        observedPids: [9_101 + index],
      })),
      missingObservedServiceIds: [],
      gbrainBackend: "gbrain",
    },
    sequential,
    mixedCycles,
    admissionDenial: {
      classification: "PASS",
      reserveUnavailableObserved: true,
      heavyweightSubmissionAttempted: true,
      jobId: "job-admission-denied",
      jobState: "resource_exhausted",
      failureCode: "ADMISSION_HEADROOM_UNAVAILABLE",
      requiredHeadroomMb: 12_288,
      availableHeadroomMb: 10_240,
      minimumFreeCommitMb: 10_240,
    },
    cancellation: {
      classification: "PASS",
      jobId: "job-cancelled",
      workerInstanceId: "worker-cancelled",
      rootWorkerPid: 40_001,
      descendantPids: [40_002],
      survivingDescendantPids: [],
      terminalState: "cancelled",
      treeExited: true,
      orphanCount: 0,
      reclaimLatencyMs: 900,
      minimumFreeCommitMb: 11_500,
    },
    restart: {
      classification: "PASS",
      beforeRuntimePid: 50_001,
      afterRuntimePid: 50_002,
      priorOwnedPids: [50_001, 50_003],
      survivingPriorOwnedPids: [],
      jobIdsBefore: [...jobIds],
      jobIdsAfter: [...jobIds],
      lostJobIds: [],
      duplicateJobIds: [],
      minimumFreeCommitMb: 11_400,
      orphanCount: 0,
    },
    idleStop: {
      classification: "PASS",
      serviceId: "gbrain",
      servicePid: 60_001,
      lifecycleState: "available-but-stopped",
      configuredIdleTtlMs: 600_000,
      idleStopLatencyMs: 601_000,
      privateMbBefore: 500,
      privateMbAfter: 300,
      survivingDescendantPids: [],
      minimumFreeCommitMb: 11_300,
      orphanCount: 0,
    },
    postMixedSample: {
      classification: "PASS",
      durationMs: 300_000,
      sampleCount: 301,
      minimumFreeCommitMb: 11_000,
      settledCommitMb: 20_000,
      settledOwnedPrivateMb: 1_500,
      settledOwnedProcessCount: 8,
      orphanCount: 0,
    },
    browserAgent: Array.from({ length: 5 }, (_, index) => ({
      cycle: index + 1,
      classification: "PASS",
      availability: {
        probe: "/api/agent-browser/agents",
        checkedAt: "2026-08-26T00:30:00.000Z",
        httpStatus: 200,
        probeLatencyMs: 25,
        runtimeAvailable: true,
        agentId: "agent-browser-default",
        agentRuntimeState: "available",
        reasonCode: null,
        detail: "",
      },
      actualElectronUi: true,
      jobId: `job-agent-browser-${index + 1}`,
      workerInstanceId: `worker-agent-browser-${index + 1}`,
      rootWorkerPid: 80_001 + index * 10,
      browserPids: [80_003 + index * 10],
      descendantPids: [80_002 + index * 10, 80_003 + index * 10, 80_004 + index * 10],
      survivingDescendantPids: [],
      treeExited: true,
      peakTreePrivateMb: 720,
      minimumFreeCommitMb: 11_100,
      settledCommitMb: 20_100,
      settledOwnedPrivateMb: 1_510,
      settledOwnedProcessCount: 8,
      orphanCount: 0,
      reclaimLatencyMs: 1_200,
      duplicateServiceIds: [],
    })),
    postiz: Array.from({ length: 5 }, (_, index) => ({
      cycle: index + 1,
      classification: "PASS",
      reasonCode: null,
      routeProbe: {
        probe: "/api/socials-manager/stack?probe=docker",
        checkedAt: "2026-08-26T00:45:00.000Z",
        httpStatus: 200,
        probeLatencyMs: 1_250,
        mode: "stack",
        state: "stopped",
        reachable: false,
        reason: "",
      },
      engineProbe: {
        checkedAt: "2026-08-26T00:45:01.250Z",
        timeoutMs: 15_000,
        attemptLimit: 8,
        totalTimeoutMs: 120_000,
        probeDurationMs: 45,
        reasonCode: null,
        attempts: [
          {
            engine: "docker",
            executable: "docker.exe",
            code: 0,
            durationMs: 20,
            timedOut: false,
            errorCode: null,
            detail: "Docker version 28",
          },
          {
            engine: "docker",
            executable: "docker.exe",
            capability: "compose",
            code: 0,
            durationMs: 25,
            timedOut: false,
            errorCode: null,
            detail: "Docker Compose version v2",
          },
        ],
        engine: "docker",
        daemonRunningAtBaseline: false,
        daemonProbeDurationMs: 35,
        daemonProbeErrorCode: null,
        daemonProbeDetail: "",
      },
      activation: {
        httpStatus: 200,
        actionLatencyMs: 20_000,
        actionTimeoutMs: 180_000,
        readyPollTimeoutMs: 600_000,
        ready: true,
        state: "ready",
        ownership: "breadboard",
        reason: "",
      },
      activationCleanup: null,
      actualRuntimeActivation: true,
      serviceId: "postiz-coordinator",
      servicePid: 90_001 + index * 10,
      ownership: "breadboard",
      configuredStackIdleTtlMs: 1_500_000,
      configuredServiceIdleTtlMs: 60_000,
      idleStopLatencyMs: 61_500,
      privateMbBefore: 480,
      privateMbAfter: 0,
      containersActive: ["abc123|breadboard-postiz-app-1", "def456|breadboard-postiz-db-1"],
      containersAfter: [],
      volumesBefore: ["breadboard-postiz-db"],
      volumesActive: ["breadboard-postiz-db", "breadboard-postiz-uploads"],
      volumesAfter: ["breadboard-postiz-db", "breadboard-postiz-uploads"],
      coordinatorDescendantPids: [90_002 + index * 10],
      survivingCoordinatorPids: [],
      treeExited: true,
      minimumFreeCommitMb: 10_950,
      settledCommitMb: 20_050,
      orphanCount: 0,
      duplicateServiceIds: [],
    })),
    endurance: {
      classification: "PASS",
      requiredDurationMs: 21_600_000,
      durationMs: 21_600_000,
      settleDurationMs: 30_000,
      sampleCount: 4_321,
      firstSampleAt: Date.parse("2026-08-26T00:00:00.000Z") + 100,
      lastSampleAt: Date.parse("2026-08-26T00:00:00.000Z") + 21_600_000,
      initialSampleDelayMs: 100,
      maximumSampleGapMs: 5_100,
      allowedSampleGapMs: 21_000,
      minimumFreeCommitMb: 10_900,
      peakCommitTotalMb: 30_000,
      settledCommitMb: 20_000,
      settledOwnedPrivateMb: 1_500,
      settledOwnedProcessCount: 8,
      orphanCount: 0,
      duplicateServiceIds: [],
    },
    quit: {
      classification: "PASS",
      ownedRootPids: [50_002, 70_001],
      survivingOwnedPids: [],
      ownedProcessCount: 0,
      minimumFreeCommitMb: 11_200,
      orphanCount: 0,
    },
    orphanCount: 0,
    duplicateServiceIds: [],
  };
}

function blockBrowserAgent(receipt) {
  receipt.outcome = "BLOCKED";
  receipt.mixedCycles[0].classification = "BLOCKED";
  receipt.mixedCycles[0].conditionalEvidence.browserAgent = "BLOCKED";
  receipt.browserAgent[0] = {
    cycle: 1,
    classification: "BLOCKED",
    availability: {
      probe: "/api/agent-browser/agents",
      checkedAt: "2026-08-26T00:30:00.000Z",
      httpStatus: 200,
      probeLatencyMs: 20,
      runtimeAvailable: false,
      agentId: "agent-browser-default",
      agentRuntimeState: "unavailable",
      reasonCode: "AGENT_BROWSER_NOT_INSTALLED",
      detail: "agent-browser is not installed",
    },
    actualElectronUi: false,
    jobId: null,
    workerInstanceId: null,
    rootWorkerPid: null,
    browserPids: [],
    descendantPids: [],
    survivingDescendantPids: [],
    treeExited: false,
    peakTreePrivateMb: null,
    minimumFreeCommitMb: null,
    settledCommitMb: null,
    settledOwnedPrivateMb: null,
    settledOwnedProcessCount: null,
    orphanCount: null,
    reclaimLatencyMs: null,
    duplicateServiceIds: [],
  };
}

function blockPostizEngine(receipt) {
  receipt.outcome = "BLOCKED";
  receipt.mixedCycles[0].classification = "BLOCKED";
  receipt.mixedCycles[0].conditionalEvidence.postiz = "BLOCKED";
  receipt.postiz[0] = {
    cycle: 1,
    classification: "BLOCKED",
    reasonCode: "CONTAINER_ENGINE_NOT_INSTALLED",
    routeProbe: {
      probe: "/api/socials-manager/stack?probe=docker",
      checkedAt: "2026-08-26T00:45:00.000Z",
      httpStatus: 200,
      probeLatencyMs: 1_250,
      mode: "stack",
      state: "stopped",
      reachable: false,
      reason: "container engine unavailable",
    },
    engineProbe: {
      checkedAt: "2026-08-26T00:45:01.250Z",
      timeoutMs: 15_000,
      attemptLimit: 8,
      totalTimeoutMs: 120_000,
      probeDurationMs: 5,
      reasonCode: "CONTAINER_ENGINE_NOT_INSTALLED",
      attempts: [{
        engine: "docker",
        executable: "docker.exe",
        code: null,
        durationMs: 5,
        timedOut: false,
        errorCode: "ENOENT",
        detail: "not found",
      }],
    },
    activation: null,
    activationCleanup: null,
    actualRuntimeActivation: false,
    serviceId: "postiz-coordinator",
    servicePid: null,
    ownership: null,
    configuredStackIdleTtlMs: null,
    configuredServiceIdleTtlMs: 60_000,
    idleStopLatencyMs: null,
    privateMbBefore: null,
    privateMbAfter: null,
    containersActive: [],
    containersAfter: [],
    volumesBefore: null,
    volumesActive: [],
    volumesAfter: [],
    coordinatorDescendantPids: [],
    survivingCoordinatorPids: [],
    treeExited: false,
    minimumFreeCommitMb: null,
    settledCommitMb: null,
    orphanCount: null,
    duplicateServiceIds: [],
  };
}

function blockBreadboardPostizActivation(receipt) {
  receipt.outcome = "BLOCKED";
  receipt.mixedCycles[0].classification = "BLOCKED";
  receipt.mixedCycles[0].conditionalEvidence.postiz = "BLOCKED";
  const run = receipt.postiz[0];
  run.classification = "BLOCKED";
  run.reasonCode = "POSTIZ_ACTIVATION_UNAVAILABLE";
  run.activation = {
    httpStatus: 200,
    actionLatencyMs: 180_000,
    actionTimeoutMs: 180_000,
    readyPollTimeoutMs: 600_000,
    ready: false,
    state: "starting",
    ownership: "breadboard",
    reason: "readiness deadline elapsed",
  };
  run.activationCleanup = {
    httpStatus: 200,
    actionLatencyMs: 2_000,
    actionTimeoutMs: 180_000,
    stopped: true,
    reason: "",
  };
  run.actualRuntimeActivation = true;
  run.ownership = "breadboard";
  run.idleStopLatencyMs = null;
  run.privateMbAfter = null;
  run.containersAfter = [];
  run.survivingCoordinatorPids = [];
  run.treeExited = true;
  run.orphanCount = 0;
}

function errorsFor(mutator) {
  const receipt = validReceipt();
  mutator(receipt);
  const result = validateRuntimeV2BurnInReceipt(receipt);
  assert.equal(result.ok, false);
  return result.errors.join("\n");
}

test("accepts an exact completion-quality actual-Electron receipt", () => {
  const result = validateRuntimeV2BurnInReceipt(validReceipt());
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});

test("rejects missing receipts and every non-passing disposition", () => {
  assert.match(validateRuntimeV2BurnInReceipt(null).errors[0], /missing/i);
  for (const disposition of ["BLOCKED", "NOT_RUN", "SKIPPED", "FAIL"]) {
    assert.match(
      errorsFor((receipt) => { receipt.sequential.learn[0].classification = disposition; }),
      /not passing/i,
    );
  }
});

test("requires exactly 10 sequential repetitions and 5 mixed cycles", () => {
  assert.match(errorsFor((receipt) => { receipt.sequential.ingestion.pop(); }), /exactly 10/);
  assert.match(errorsFor((receipt) => { receipt.mixedCycles.pop(); }), /exactly 5/);
});

test("requires a measured six-hour minimum instead of treating six hours as a timeout", () => {
  assert.match(
    errorsFor((receipt) => { receipt.finishedAt = "2026-08-26T05:59:59.999Z"; }),
    /mandatory six hours/,
  );
  assert.match(
    errorsFor((receipt) => { receipt.endurance.durationMs = 21_599_999; }),
    /21600000 ms/,
  );
  assert.match(
    errorsFor((receipt) => { receipt.endurance.maximumSampleGapMs = 21_001; }),
    /cadence allowance/,
  );
  assert.match(
    errorsFor((receipt) => { receipt.endurance.initialSampleDelayMs = 21_001; }),
    /initialSampleDelayMs/,
  );
  assert.match(
    errorsFor((receipt) => { receipt.endurance.sampleCount = 2; }),
    /sampleCount cannot cover its duration/,
  );
  assert.match(
    errorsFor((receipt) => { receipt.endurance.maximumSampleGapMs = 1; }),
    /maximumSampleGapMs is inconsistent/,
  );
});

test("requires lean Rust ownership, the manifest-wide mandate, and observed real GBrain and Quartz", () => {
  assert.match(
    errorsFor((receipt) => { receipt.stackEvidence.runtimeOwner = "next-server"; }),
    /rust-runtime-v2/,
  );
  assert.match(
    errorsFor((receipt) => {
      receipt.serviceCoverage.services
        .find(({ serviceId }) => serviceId === "gbrain").observedPids = [];
    }),
    /no observed listener owner/,
  );
  assert.match(
    errorsFor((receipt) => { receipt.serviceCoverage.gbrainBackend = "fallback"; }),
    /real GBrain backend/,
  );
  assert.match(
    errorsFor((receipt) => { receipt.serviceCoverage.manifestWideEvidenceAuthority = "burn-only"; }),
    /all-service packaged receipt/,
  );
});

test("requires a fresh cryptographic packaged all-service/GBrain receipt binding", () => {
  assert.match(
    errorsFor((receipt) => { delete receipt.serviceEvidence; }),
    /all-service receipt binding is missing/i,
  );
  assert.match(
    errorsFor((receipt) => { receipt.serviceEvidence.receiptSha256 = "tampered"; }),
    /receiptSha256.*SHA-256/i,
  );
  assert.match(
    errorsFor((receipt) => { receipt.serviceEvidence.outcome = "FAIL"; }),
    /successful packaged burn receipt/i,
  );
  assert.match(
    errorsFor((receipt) => { receipt.serviceEvidence.serviceCount = 31; }),
    /all 32 mandatory services including GBrain/i,
  );
  assert.match(
    errorsFor((receipt) => {
      receipt.serviceEvidence.finishedAt = "2026-08-25T17:59:59.999Z";
    }),
    /stale or has invalid time bounds/i,
  );
  assert.match(
    errorsFor((receipt) => { receipt.serviceEvidence.executable.sha256 = "0".repeat(63); }),
    /packaged artifact path, size, or SHA-256/i,
  );
});

test("requires Garden Chat retrieval and Quartz evidence in every mixed cycle", () => {
  assert.match(
    errorsFor((receipt) => { receipt.mixedCycles[3].surfaceEvidence.retrieval = false; }),
    /surfaceEvidence\.retrieval/,
  );
  assert.match(
    errorsFor((receipt) => { delete receipt.mixedCycles[0].surfaceEvidence; }),
    /surfaceEvidence is missing/,
  );
});

test("requires closed browser-agent and Postiz dispositions", () => {
  assert.match(errorsFor((receipt) => { delete receipt.browserAgent; }), /browserAgent must contain exactly 5/i);
  assert.match(errorsFor((receipt) => { delete receipt.postiz; }), /postiz must contain exactly 5/i);
  assert.match(
    errorsFor((receipt) => { receipt.browserAgent[0].survivingDescendantPids = [80_003]; }),
    /complete Chromium process tree/,
  );
  assert.match(
    errorsFor((receipt) => { receipt.postiz[0].volumesAfter.pop(); }),
    /preserve exact Docker volume identities/,
  );
  assert.match(
    errorsFor((receipt) => {
      receipt.postiz[0].survivingCoordinatorPids = [90_002];
      receipt.postiz[0].treeExited = false;
    }),
    /left the Runtime coordinator process tree alive/,
  );
});

test("requires browser and Postiz lifecycle evidence in every mixed cycle", () => {
  assert.match(
    errorsFor((receipt) => { receipt.browserAgent.pop(); }),
    /browserAgent must contain exactly 5/,
  );
  assert.match(
    errorsFor((receipt) => { receipt.postiz[3].cycle = 3; }),
    /postiz\[3\]\.cycle is out of order/,
  );
  assert.match(
    errorsFor((receipt) => { receipt.mixedCycles[2].conditionalEvidence.browserAgent = "BLOCKED"; }),
    /conditionalEvidence\.browserAgent is not correlated/,
  );
  assert.match(
    errorsFor((receipt) => { receipt.browserAgent[4].rootWorkerPid = receipt.browserAgent[3].rootWorkerPid; }),
    /reused a root worker PID/,
  );
  assert.match(
    errorsFor((receipt) => { receipt.postiz[1].volumesAfter = []; }),
    /preserve exact Docker volume identities|lost a Docker volume/,
  );
});

test("records external browser-agent unavailability as truthful BLOCKED, never PASS", () => {
  const receipt = validReceipt();
  blockBrowserAgent(receipt);
  const result = validateRuntimeV2BurnInReceipt(receipt);
  assert.equal(result.ok, false);
  const errors = result.errors.join("\n");
  assert.match(errors, /Receipt outcome is BLOCKED, not PASS/);
  assert.match(errors, /browserAgent\[0\] is not passing \(BLOCKED\)/);
  assert.doesNotMatch(errors, /lacks an exact external prerequisite reason|masquerades/);

  receipt.outcome = "PASS";
  assert.match(
    validateRuntimeV2BurnInReceipt(receipt).errors.join("\n"),
    /requires a truthful BLOCKED receipt outcome/,
  );
});

test("records exact bounded Postiz engine unavailability and fails partial BLOCKED evidence", () => {
  const receipt = validReceipt();
  blockPostizEngine(receipt);
  const result = validateRuntimeV2BurnInReceipt(receipt);
  assert.equal(result.ok, false);
  const errors = result.errors.join("\n");
  assert.match(errors, /Receipt outcome is BLOCKED, not PASS/);
  assert.match(errors, /postiz\[0\] is not passing \(BLOCKED\)/);
  assert.doesNotMatch(errors, /attempts must contain|reasonCode does not match/);

  receipt.postiz[0].engineProbe.attempts = [];
  assert.match(
    validateRuntimeV2BurnInReceipt(receipt).errors.join("\n"),
    /attempts must contain bounded CLI\/Compose evidence/,
  );
});

test("requires partial Breadboard-owned Postiz activation to stop without deleting volumes", () => {
  const receipt = validReceipt();
  blockBreadboardPostizActivation(receipt);
  const structurallyBlocked = validateRuntimeV2BurnInReceipt(receipt).errors.join("\n");
  assert.doesNotMatch(structurallyBlocked, /partial activation resources alive|changed Docker volume/);

  receipt.postiz[0].containersAfter = ["abc123|breadboard-postiz-app-1"];
  assert.match(
    validateRuntimeV2BurnInReceipt(receipt).errors.join("\n"),
    /left Breadboard-owned partial activation resources alive/,
  );
  receipt.postiz[0].containersAfter = [];
  receipt.postiz[0].volumesAfter.pop();
  assert.match(
    validateRuntimeV2BurnInReceipt(receipt).errors.join("\n"),
    /partial-activation cleanup changed Docker volume identities/,
  );
});

test("requires all operation identities, peaks, cleanup, and Windows evidence", () => {
  assert.match(errorsFor((receipt) => { delete receipt.sequential.artifact[0].capabilityId; }), /capabilityId/);
  assert.match(errorsFor((receipt) => { delete receipt.sequential.artifact[0].peakPrivateMb.renderer; }), /renderer/);
  assert.match(errorsFor((receipt) => { receipt.sequential.artifact[0].survivingDescendantPids = [99]; }), /left worker descendants/);
  assert.match(errorsFor((receipt) => { receipt.sequential.artifact[0].evidence.electron = false; }), /actual Electron/);
  assert.match(errorsFor((receipt) => { receipt.sequential.artifact[0].ordinal = 2; }), /ordinal is out of order/);
  assert.match(errorsFor((receipt) => { receipt.mixedCycles[0].operations.learn.phase = "mixed-2"; }), /does not match its mixed cycle/);
});

test("enforces free-commit and exact zero-orphan thresholds", () => {
  assert.match(errorsFor((receipt) => { receipt.sequential.learn[0].minimumFreeCommitMb = 8_192; }), /above 8192/);
  assert.match(errorsFor((receipt) => { receipt.mixedCycles[0].minimumFreeCommitMb = 8_192; }), /above 8192/);
  assert.match(errorsFor((receipt) => { receipt.restart.minimumFreeCommitMb = 8_192; }), /above 8192/);
  assert.match(errorsFor((receipt) => { receipt.mixedCycles[2].orphanCount = 1; }), /exactly zero/);
  assert.match(errorsFor((receipt) => { receipt.duplicateServiceIds = ["gbrain"]; }), /duplicate services/);
});

test("enforces sequential and mixed settled-baseline growth limits", () => {
  assert.match(
    errorsFor((receipt) => { receipt.sequential.learn[9].settledOwnedPrivateMb = 2_013; }),
    /cycle 10.*max\(512 MB, 10%\)/,
  );
  assert.match(
    errorsFor((receipt) => { receipt.mixedCycles[4].settledOwnedPrivateMb = 2_269; }),
    /Final mixed-cycle.*max\(768 MB, 10%\)/,
  );
});

test("rejects monotonic settled growth and growing process counts", () => {
  assert.match(
    errorsFor((receipt) => {
      receipt.sequential.ingestion.forEach((item, index) => { item.settledOwnedPrivateMb = 1_000 + index; });
    }),
    /monotonic settled owned-memory rise/,
  );
  assert.match(
    errorsFor((receipt) => { receipt.mixedCycles[4].settledOwnedProcessCount = 9; }),
    /process count grew/,
  );
});

test("requires fresh job, PID, and worker instance identity for every finite operation", () => {
  assert.match(
    errorsFor((receipt) => {
      receipt.sequential.learn[1].rootWorkerPid = receipt.sequential.learn[0].rootWorkerPid;
    }),
    /reused a root worker PID/,
  );
  assert.match(
    errorsFor((receipt) => {
      receipt.mixedCycles[1].operations.artifact.workerInstanceId =
        receipt.mixedCycles[0].operations.artifact.workerInstanceId;
    }),
    /reused a worker instance ID/,
  );
});

test("requires real reserve denial, complete-tree cancellation, and restart parity", () => {
  assert.match(errorsFor((receipt) => { receipt.admissionDenial.jobState = "succeeded"; }), /resource_exhausted/);
  assert.match(errorsFor((receipt) => { receipt.cancellation.survivingDescendantPids = [42]; }), /complete process tree/);
  assert.match(errorsFor((receipt) => { receipt.restart.jobIdsAfter.pop(); }), /identity changed/);
});

test("requires configured settle and TTL evidence, five-minute sampling, idle reclaim, and zero-process quit", () => {
  assert.match(errorsFor((receipt) => { delete receipt.acceptance.settleWindowMs; }), /settleWindowMs/);
  assert.match(errorsFor((receipt) => { receipt.idleStop.privateMbAfter = 500; }), /did not return private memory/);
  assert.match(errorsFor((receipt) => { receipt.postMixedSample.durationMs = 299_999; }), /at least five minutes/);
  assert.match(errorsFor((receipt) => { receipt.quit.ownedProcessCount = 1; }), /left owned processes/);
});

test("does not invent a peak-memory cap beyond the objective", () => {
  const receipt = validReceipt();
  receipt.sequential.artifact[0].peakPrivateMb.worker = 100_000;
  const result = validateRuntimeV2BurnInReceipt(receipt);
  assert.equal(result.ok, true);
});

test("exports the exact objective thresholds", () => {
  assert.deepEqual(RUNTIME_V2_BURN_IN, {
    schemaVersion: 1,
    workloadProject: "runtime-v2-burn-in",
    requiredDurationMs: 21_600_000,
    sequentialRepetitions: 10,
    mixedCycles: 5,
    ordinaryFreeCommitFloorMb: 8_192,
    priorDangerStateMb: 2_900,
    sequentialGrowthFloorMb: 512,
    mixedGrowthFloorMb: 768,
    growthPercent: 0.10,
    postMixedSampleMs: 300_000,
    defaultSettleWindowMs: 30_000,
    sampleGapOverheadMs: 20_000,
    mandatoryServiceIds: expectedMandatoryServiceIds,
    eagerRequiredServiceIds: expectedEagerRequiredServiceIds,
    observedServiceIds: ["chatmock", "dashboard", "gbrain", "quartz"],
    manifestWideEvidenceAuthority: "runtime-v2-services-receipt",
  });
  assert.equal(RUNTIME_V2_BURN_IN.mandatoryServiceIds.length, 32);
  assert.equal(RUNTIME_V2_BURN_IN.mandatoryServiceIds.includes("gbrain"), true);
});

test("the documented burn-in command resolves a settle window without external environment", () => {
  assert.equal(resolveRuntimeV2BurnInSettleWindowMs(undefined), 30_000);
  assert.equal(resolveRuntimeV2BurnInSettleWindowMs(""), 30_000);
  assert.equal(resolveRuntimeV2BurnInSettleWindowMs("45000"), 45_000);
  assert.throws(() => resolveRuntimeV2BurnInSettleWindowMs("0"), /between 1000 and 1800000/);
  assert.throws(() => resolveRuntimeV2BurnInSettleWindowMs("30s"), /whole number/);
});
