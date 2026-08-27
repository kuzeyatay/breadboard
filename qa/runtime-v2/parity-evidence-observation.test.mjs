import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  PARITY_EVIDENCE_OBSERVATION_KIND,
  PARITY_EVIDENCE_OBSERVATION_MAX_AGE_MS,
  PARITY_EVIDENCE_OBSERVATION_MAX_DURATION_MS,
  PARITY_EVIDENCE_OBSERVATION_SCHEMA_VERSION,
  closeParityEvidencePackageRun,
  openParityEvidencePackageRun,
  recordParityEvidenceObservation,
  validateParityEvidenceObservation,
} from "./parity-evidence-observation.mjs";
import {
  getPackageVerifierReceiptDiagnostics,
  recordPackageVerifierReceipt,
} from "./package-verifier-receipt.mjs";

const qaDir = path.dirname(fileURLToPath(import.meta.url));
const observationModuleUrl = pathToFileURL(path.join(qaDir, "parity-evidence-observation.mjs")).href;
const SHA = "A".repeat(64);

function writeFile(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, "utf8");
}

function createVerifiedPackage(repoRoot) {
  writeFile(
    path.join(repoRoot, "desktop", "scripts", "verify-package.mjs"),
    "console.log('[verify-package] OK');\n",
  );
  writeFile(path.join(repoRoot, "desktop", "electron-builder.yml"), "asar: true\nextraResources: []\n");
  for (const manifestName of ["services.json", "workers.json"]) {
    const content = `${JSON.stringify(
      manifestName === "services.json" ? { version: 4, services: [] } : { version: 2, workers: [] },
    )}\n`;
    writeFile(path.join(repoRoot, "desktop", "runtime-v2", "manifests", manifestName), content);
    writeFile(path.join(repoRoot, "package", "win-unpacked", "resources", "runtime-v2", "manifests", manifestName), content);
  }
  const packageRoot = path.join(repoRoot, "package", "win-unpacked");
  const critical = {
    executablePath: path.join(packageRoot, "Breadboard.exe"),
    appAsarPath: path.join(packageRoot, "resources", "app.asar"),
  };
  for (const [relativePath, content] of [
    ["Breadboard.exe", "packaged-electron-binary\n"],
    ["resources/app.asar", "packaged-app-asar\n"],
    ["resources/app-services/dashboard/scripts/runtime-v2-dashboard.mjs", "export {};\n"],
    ["resources/runtimes/node/node.exe", "node-runtime\n"],
    ["resources/runtimes/bun/bun.exe", "bun-runtime\n"],
    ["resources/runtimes/python/python.exe", "python-runtime\n"],
    ["resources/bin/codex.exe", "codex-runtime\n"],
    ["resources/bin/runtime-supervisor.exe", "supervisor-runtime\n"],
    ["resources/bin/breadboard-runtime.exe", "runtime-v2-binary\n"],
    ["resources/app-services/test-service/runtime.js", "service-extra-resource\n"],
  ]) {
    writeFile(path.join(packageRoot, ...relativePath.split("/")), content);
  }
  const receiptPath = ".qa-results/package-verifier/package-receipt.json";
  recordPackageVerifierReceipt({
    repoRoot,
    receiptPath,
    executablePath: critical.executablePath,
    runId: "package-verifier-run-1",
  });
  return { packageRoot, receiptPath, ...critical };
}

async function fixture(t) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-parity-observation-"));
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  const producerPath = "qa/electron/specs/critical/parity-observer.spec.ts";
  const producerFile = path.join(repoRoot, ...producerPath.split("/"));
  writeFile(
    producerFile,
    [
      `import { recordParityEvidenceObservation, recordParityEvidenceFailure } from ${JSON.stringify(observationModuleUrl)};`,
      "export function emitObservation(options) { return recordParityEvidenceObservation(options); }",
      "export function emitFailure(options) { return recordParityEvidenceFailure(options); }",
      "",
    ].join("\n"),
  );
  const producer = await import(`${pathToFileURL(producerFile).href}?fixture=${Date.now()}-${Math.random()}`);
  const verifiedPackage = createVerifiedPackage(repoRoot);
  const { executablePath } = verifiedPackage;
  const packageRunContext = openParityEvidencePackageRun({
    repoRoot,
    packageVerifierReceiptPath: verifiedPackage.receiptPath,
    executablePath,
    runId: "parity-run-1",
  });
  const startedAt = new Date().toISOString();
  const supportingArtifactPath = ".qa-results/parity-run/electron-artifact.json";
  writeFile(
    path.join(repoRoot, ...supportingArtifactPath.split("/")),
    `${JSON.stringify({ actualElectronWorkflow: true, capabilityId: "workflow:test" })}\n`,
  );
  const finishedAt = new Date().toISOString();
  const workflowIdentity = {
    electronRunId: "electron-run-1",
    workflowId: "workflow-1",
    conversationIdSha256: SHA,
  };
  const claims = {
    uiEntryPoint: "Agents page -> Test capability",
    selectedCapabilityId: "workflow:test",
    normalEntryPointUsed: true,
    realRequestSubmitted: true,
    selectionObserved: true,
    semanticAssertionsPassed: true,
    followUp: {
      applicability: "APPLICABLE",
      sameConversationObserved: true,
      priorContextObserved: true,
    },
  };
  const base = {
    repoRoot,
    observationPath: ".qa-results/parity-run/electron-observation.json",
    producerPath,
    packageRunContext,
    runId: "parity-run-1",
    capabilityId: "workflow:test",
    evidenceType: "electron",
    workflowIdentity,
    operationId: "operation-1",
    startedAt,
    finishedAt,
    claims,
    supportingArtifactPaths: [supportingArtifactPath],
  };
  return {
    repoRoot,
    producerPath,
    producerFile,
    producer,
    executablePath,
    packageVerifierReceiptPath: verifiedPackage.receiptPath,
    packageRunContext,
    packageRoot: verifiedPackage.packageRoot,
    appAsarPath: verifiedPackage.appAsarPath,
    supportingArtifactPath,
    workflowIdentity,
    base,
  };
}

function expectedBinding(observation) {
  const expected = {
    runId: observation.runId,
    capabilityId: observation.capabilityId,
    evidenceType: observation.evidenceType,
    result: observation.result,
    executionDisposition: observation.executionDisposition,
    runtimeMode: observation.runtimeMode,
    workflowIdentity: observation.workflowIdentity,
    operationId: observation.operationId,
    packageVerification: observation.packageVerification,
  };
  if (observation.blocker) expected.blocker = observation.blocker;
  if (observation.result === "FAIL") {
    expected.failureCode = observation.failureCode;
    expected.failureSummary = observation.failureSummary;
  }
  return expected;
}

test("allowlisted spec records an immutable, packaged PASS observation and validator rechecks it", async (t) => {
  const f = await fixture(t);
  const result = f.producer.emitObservation(f.base);
  assert.equal(result.observation.result, "PASS");
  assert.equal(result.observation.executionDisposition, "REAL_WORKFLOW_COMPLETED");
  assert.equal(result.observation.runtimeMode, "packaged-electron");
  assert.equal(result.observation.executable.fileName, "Breadboard.exe");
  assert.equal(result.observation.packageVerification.receipt.path, f.packageVerifierReceiptPath);
  assert.equal(result.observation.producer.path, f.producerPath);
  assert.equal(result.reference.path, f.base.observationPath);
  const validated = validateParityEvidenceObservation({
    repoRoot: f.repoRoot,
    observationPath: result.reference.path,
    expectedFileIdentity: result.reference,
    expected: expectedBinding(result.observation),
    executablePath: f.executablePath,
  });
  assert.equal(validated.observation.contentSha256, result.observation.contentSha256);
  assert.deepEqual(validated.reference, result.reference);
  assert.throws(() => f.producer.emitObservation(f.base), /already exists|immutable observations/);
  fs.rmSync(f.executablePath);
  assert.throws(
    () => validateParityEvidenceObservation({
      repoRoot: f.repoRoot,
      observationPath: result.reference.path,
      expectedFileIdentity: result.reference,
      expected: expectedBinding(result.observation),
      expectedExecutableIdentity: result.observation.executable,
    }),
    /package closure|critical artifact|Breadboard\.exe|does not identify an existing regular file/i,
  );
  assert.throws(
    () => validateParityEvidenceObservation({
      repoRoot: f.repoRoot,
      observation: result.observation,
      expected: expectedBinding(result.observation),
      executablePath: f.executablePath,
      expectedExecutableIdentity: result.observation.executable,
    }),
    /exactly one executablePath or expectedExecutableIdentity/,
  );
});

test("Electron PASS follow-up claims require a real same-session second turn with prior context", async (t) => {
  const f = await fixture(t);
  const invalidClaims = {
    ...f.base.claims,
    followUp: {
      applicability: "APPLICABLE",
      sameConversationObserved: true,
      priorContextObserved: false,
    },
  };
  assert.throws(
    () => f.producer.emitObservation({
      ...f.base,
      observationPath: ".qa-results/parity-run/invalid-follow-up.json",
      operationId: "invalid-follow-up",
      claims: invalidClaims,
    }),
    /followUp\.priorContextObserved must be true/u,
  );

  const notApplicable = f.producer.emitObservation({
    ...f.base,
    observationPath: ".qa-results/parity-run/no-follow-up.json",
    operationId: "no-follow-up",
    claims: {
      ...f.base.claims,
      followUp: {
        applicability: "NOT_APPLICABLE",
        inventoryContractObserved: true,
        followUpNotSupported: true,
      },
    },
  });
  assert.equal(notApplicable.observation.claims.followUp.applicability, "NOT_APPLICABLE");
});

test("recovery non-applicability requires a typed source-proven pre-migration reason", async (t) => {
  const f = await fixture(t);
  assert.throws(
    () => f.producer.emitObservation({
      ...f.base,
      evidenceType: "recovery",
      observationPath: ".qa-results/parity-run/untyped-recovery-na.json",
      operationId: "untyped-recovery-na",
      claims: {
        applicability: "NOT_APPLICABLE",
        inventoryContractObserved: true,
        recoveryNotSupported: true,
      },
    }),
    /recovery PASS claims fields/u,
  );
});

test("recovery PASS accepts only complete source-failure and stored-selection restart claims", async (t) => {
  const f = await fixture(t);
  const sourceClaims = {
    applicability: "APPLICABLE",
    recoveryKind: "SOURCE_SELECTION_FAIL_CLOSED",
    selectedIdentitySha256: SHA,
    unresolvableSelectionInjected: true,
    truthfulFailurePresentationObserved: true,
    selectionCleared: true,
    noFallbackObserved: true,
    sourceContextRestored: true,
    sameConversationObserved: true,
    priorContextObserved: true,
    noDuplicationObserved: true,
  };
  const source = f.producer.emitObservation({
    ...f.base,
    evidenceType: "recovery",
    observationPath: ".qa-results/parity-run/source-selection-recovery.json",
    operationId: "source-selection-recovery",
    claims: sourceClaims,
  });
  assert.equal(source.observation.claims.recoveryKind, "SOURCE_SELECTION_FAIL_CLOSED");

  const restartClaims = {
    applicability: "APPLICABLE",
    recoveryKind: "STORED_SELECTION_APP_RESTART",
    selectedIdentitySha256: "B".repeat(64),
    appRestartObserved: true,
    storedSelectionRestored: true,
    postRestartRequestUsedSelection: true,
    sameConversationObserved: true,
    priorContextObserved: true,
    noDuplicationObserved: true,
    contextPreserved: true,
  };
  const restart = f.producer.emitObservation({
    ...f.base,
    evidenceType: "recovery",
    observationPath: ".qa-results/parity-run/stored-selection-recovery.json",
    operationId: "stored-selection-recovery",
    claims: restartClaims,
  });
  assert.equal(restart.observation.claims.recoveryKind, "STORED_SELECTION_APP_RESTART");

  assert.throws(
    () => f.producer.emitObservation({
      ...f.base,
      evidenceType: "recovery",
      observationPath: ".qa-results/parity-run/incomplete-source-selection-recovery.json",
      operationId: "incomplete-source-selection-recovery",
      claims: { ...sourceClaims, priorContextObserved: false },
    }),
    /priorContextObserved must be true/u,
  );
  assert.throws(
    () => f.producer.emitObservation({
      ...f.base,
      evidenceType: "recovery",
      observationPath: ".qa-results/parity-run/incomplete-stored-selection-recovery.json",
      operationId: "incomplete-stored-selection-recovery",
      claims: { ...restartClaims, postRestartRequestUsedSelection: false },
    }),
    /postRestartRequestUsedSelection must be true/u,
  );
});

test("same Breadboard.exe cannot hide a tampered app.asar package closure", async (t) => {
  const f = await fixture(t);
  const result = f.producer.emitObservation(f.base);
  const executableBefore = fs.readFileSync(f.executablePath);
  fs.appendFileSync(f.appAsarPath, "tampered-app-code\n", "utf8");
  assert.deepEqual(fs.readFileSync(f.executablePath), executableBefore);
  assert.throws(
    () => validateParityEvidenceObservation({
      repoRoot: f.repoRoot,
      observationPath: result.reference.path,
      expectedFileIdentity: result.reference,
      expected: expectedBinding(result.observation),
      executablePath: f.executablePath,
    }),
    /app\.asar|package closure|critical packaged artifacts|critical artifact/i,
  );
  const duringRun = f.producer.emitObservation({
    ...f.base,
    observationPath: ".qa-results/parity-run/tampered-package-observation.json",
    operationId: "tampered-package-operation",
  });
  assert.equal(duringRun.observation.packageVerification.closureSha256, result.observation.packageVerification.closureSha256);
  assert.throws(
    () => openParityEvidencePackageRun({
      repoRoot: f.repoRoot,
      packageVerifierReceiptPath: f.packageVerifierReceiptPath,
      executablePath: f.executablePath,
      runId: f.base.runId,
    }),
    /app\.asar|package closure|critical packaged artifacts|critical artifact/i,
  );
});

test("one opaque package-run guard records N observations with O(1) full package scans", async (t) => {
  const f = await fixture(t);
  const beforeOpen = getPackageVerifierReceiptDiagnostics();
  const packageRunContext = openParityEvidencePackageRun({
    repoRoot: f.repoRoot,
    packageVerifierReceiptPath: f.packageVerifierReceiptPath,
    executablePath: f.executablePath,
    runId: f.base.runId,
  });
  const afterOpen = getPackageVerifierReceiptDiagnostics();
  assert.equal(
    afterOpen.fullPackageTreeSnapshotCount - beforeOpen.fullPackageTreeSnapshotCount,
    1,
  );
  const startedAt = new Date().toISOString();
  const finishedAt = new Date().toISOString();

  const observationCount = 25;
  for (let index = 0; index < observationCount; index += 1) {
    f.producer.emitObservation({
      ...f.base,
      packageRunContext,
      startedAt,
      finishedAt,
      observationPath: `.qa-results/parity-run/performance-${index}.json`,
      operationId: `performance-operation-${index}`,
    });
  }
  const afterObservations = getPackageVerifierReceiptDiagnostics();
  assert.equal(
    afterObservations.fullPackageTreeSnapshotCount - afterOpen.fullPackageTreeSnapshotCount,
    0,
  );
  assert.equal(
    afterObservations.criticalArtifactOnlySnapshotCount - afterOpen.criticalArtifactOnlySnapshotCount,
    0,
  );
  assert.throws(
    () => f.producer.emitObservation({
      ...f.base,
      packageRunContext,
      runId: "another-parity-run",
      observationPath: ".qa-results/parity-run/cross-run-context.json",
      operationId: "cross-run-context-operation",
    }),
    /does not match repoRoot and runId/,
  );
  closeParityEvidencePackageRun(packageRunContext);
  assert.throws(
    () => f.producer.emitObservation({
      ...f.base,
      packageRunContext,
      observationPath: ".qa-results/parity-run/closed-context.json",
      operationId: "closed-context-operation",
    }),
    /forged, closed, or belongs to another process/,
  );
  assert.throws(
    () => f.producer.emitObservation({
      ...f.base,
      packageRunContext: Object.freeze(structuredClone(f.packageRunContext)),
      observationPath: ".qa-results/parity-run/forged-context.json",
      operationId: "forged-context-operation",
    }),
    /forged, closed, or belongs to another process/,
  );
});

test("a package-run guard rejects a workflow that began before package authority opened", async (t) => {
  const f = await fixture(t);
  const startedAt = new Date(Date.now() - 1_000).toISOString();
  const packageRunContext = openParityEvidencePackageRun({
    repoRoot: f.repoRoot,
    packageVerifierReceiptPath: f.packageVerifierReceiptPath,
    executablePath: f.executablePath,
    runId: f.base.runId,
  });
  t.after(() => closeParityEvidencePackageRun(packageRunContext));
  assert.throws(
    () => f.producer.emitObservation({
      ...f.base,
      packageRunContext,
      observationPath: ".qa-results/parity-run/pre-context-workflow.json",
      operationId: "pre-context-workflow-operation",
      startedAt,
      finishedAt: new Date().toISOString(),
    }),
    /workflow started before the packageRunContext established the verified package authority/,
  );
});

test("an open guard rejects a changed sealed package-receipt identity without a package scan", async (t) => {
  const f = await fixture(t);
  const receiptPath = path.join(f.repoRoot, ...f.packageVerifierReceiptPath.split("/"));
  fs.chmodSync(receiptPath, 0o600);
  fs.appendFileSync(receiptPath, "tampered-receipt\n", "utf8");
  const before = getPackageVerifierReceiptDiagnostics();
  assert.throws(
    () => f.producer.emitObservation({
      ...f.base,
      observationPath: ".qa-results/parity-run/tampered-receipt.json",
      operationId: "tampered-receipt-operation",
    }),
    /packageRunContext receipt identity no longer matches/,
  );
  const after = getPackageVerifierReceiptDiagnostics();
  assert.equal(after.fullPackageTreeSnapshotCount - before.fullPackageTreeSnapshotCount, 0);
  assert.equal(after.criticalArtifactOnlySnapshotCount - before.criticalArtifactOnlySnapshotCount, 0);
});

test("recording is rejected outside the declared allowlisted spec caller", async (t) => {
  const f = await fixture(t);
  assert.throws(
    () => recordParityEvidenceObservation({ ...f.base, observationPath: ".qa-results/parity-run/direct.json" }),
    /not called from the declared allowlisted producer/,
  );
  assert.equal(fs.existsSync(path.join(f.repoRoot, ".qa-results", "parity-run", "direct.json")), false);
});

test("every non-Electron PASS evidence type enforces its own exact claims", async (t) => {
  const f = await fixture(t);
  const cases = {
    service: {
      applicability: "APPLICABLE",
      serviceId: "service:test",
      runtimeOwned: true,
      startOrLeaseObserved: true,
      singleInstanceObserved: true,
      readyObserved: true,
    },
    worker: {
      applicability: "APPLICABLE",
      workerKind: "worker:test",
      jobIdSha256: SHA,
      workerInstanceIdSha256: "B".repeat(64),
      freshProcessObserved: true,
      terminalExitObserved: true,
      descendantsCleaned: true,
    },
    output: {
      applicability: "APPLICABLE",
      outputKind: "artifact:test",
      outputIdSha256: "C".repeat(64),
      expectedOutputObserved: true,
      nonPlaceholderObserved: true,
      openBehaviorObserved: true,
    },
    cancellation: {
      applicability: "APPLICABLE",
      cancellationRequested: true,
      terminalCancellationObserved: true,
      visibleResultObserved: true,
      descendantsCleaned: true,
    },
    recovery: {
      applicability: "APPLICABLE",
      recoveryKind: "DASHBOARD_RESTART",
      reconnected: true,
      noDuplicationObserved: true,
      contextPreserved: true,
    },
  };
  for (const [evidenceType, claims] of Object.entries(cases)) {
    const result = f.producer.emitObservation({
      ...f.base,
      evidenceType,
      claims,
      observationPath: `.qa-results/parity-run/${evidenceType}-observation.json`,
    });
    assert.equal(result.observation.evidenceType, evidenceType);
    assert.equal(result.observation.result, "PASS");
  }
});

test("BLOCKED is derived only from a structured prerequisite blocker", async (t) => {
  const f = await fixture(t);
  const blocker = {
    prerequisiteType: "CREDENTIAL",
    prerequisiteId: "provider:test",
    code: "MISSING_CREDENTIAL",
    summary: "The same provider credential is absent from the baseline environment.",
  };
  const result = f.producer.emitObservation({
    ...f.base,
    observationPath: ".qa-results/parity-run/blocked-observation.json",
    blocker,
    claims: {
      uiEntryPoint: "Agents page -> Test capability",
      selectedCapabilityId: "workflow:test",
      normalEntryPointUsed: true,
      realRequestSubmitted: true,
      selectionObserved: true,
      truthfulBlockedPresentationObserved: true,
    },
  });
  assert.equal(result.observation.result, "BLOCKED");
  assert.equal(result.observation.executionDisposition, "MATCHING_BASELINE_PREREQUISITE_BLOCKED");
  assert.deepEqual(result.observation.blocker, blocker);
  assert.throws(
    () => validateParityEvidenceObservation({
      repoRoot: f.repoRoot,
      observation: result.observation,
      expected: { ...expectedBinding(result.observation), blocker: { ...blocker, prerequisiteId: "provider:other" } },
      executablePath: f.executablePath,
    }),
    /expected binding/,
  );
});

test("FAIL recorder preserves a non-accepting real Electron failure", async (t) => {
  const f = await fixture(t);
  const failure = f.producer.emitFailure({
    repoRoot: f.repoRoot,
    observationPath: ".qa-results/parity-run/failure-observation.json",
    producerPath: f.producerPath,
    packageRunContext: f.packageRunContext,
    runId: f.base.runId,
    capabilityId: f.base.capabilityId,
    workflowIdentity: f.workflowIdentity,
    operationId: f.base.operationId,
    startedAt: f.base.startedAt,
    finishedAt: f.base.finishedAt,
    failureCode: "ASSERTION_FAILED",
    failureSummary: "The real Electron workflow returned the wrong selected capability.",
    claims: {
      uiEntryPoint: "Agents page -> Test capability",
      selectedCapabilityId: "workflow:test",
      normalEntryPointUsed: true,
      realRequestSubmitted: true,
      selectionObserved: true,
      failureObserved: true,
      truthfulFailurePresentationObserved: true,
    },
    supportingArtifactPaths: [f.supportingArtifactPath],
  });
  assert.equal(failure.observation.result, "FAIL");
  assert.equal(failure.observation.executionDisposition, "REAL_WORKFLOW_FAILED");
  assert.equal(failure.observation.evidenceType, "electron");
  assert.equal(failure.observation.failureCode, "ASSERTION_FAILED");
  assert.doesNotThrow(() => validateParityEvidenceObservation({
    repoRoot: f.repoRoot,
    observationPath: failure.reference.path,
    expectedFileIdentity: failure.reference,
    expected: expectedBinding(failure.observation),
    executablePath: f.executablePath,
  }));
});

test("cross-run, capability, type, operation, and workflow binding mismatches are rejected", async (t) => {
  const f = await fixture(t);
  const result = f.producer.emitObservation(f.base);
  const mutations = [
    { runId: "another-run" },
    { capabilityId: "workflow:other" },
    { evidenceType: "service" },
    { operationId: "other-operation" },
    { workflowIdentity: { ...f.workflowIdentity, workflowId: "other-workflow" } },
  ];
  for (const mutation of mutations) {
    assert.throws(
      () => validateParityEvidenceObservation({
        repoRoot: f.repoRoot,
        observation: result.observation,
        expected: { ...expectedBinding(result.observation), ...mutation },
        executablePath: f.executablePath,
      }),
      /expected binding/,
    );
  }
});

test("observation, producer, executable, and supporting-artifact tampering fail closed", async (t) => {
  await t.test("sealed content", async (t) => {
    const f = await fixture(t);
    const result = f.producer.emitObservation(f.base);
    const changed = structuredClone(result.observation);
    changed.contentSha256 = "B".repeat(64);
    assert.throws(
      () => validateParityEvidenceObservation({
        repoRoot: f.repoRoot,
        observation: changed,
        expected: expectedBinding(result.observation),
        executablePath: f.executablePath,
      }),
      /contentSha256/,
    );
  });
  await t.test("producer source", async (t) => {
    const f = await fixture(t);
    const result = f.producer.emitObservation(f.base);
    fs.appendFileSync(f.producerFile, "// tampered\n", "utf8");
    assert.throws(
      () => validateParityEvidenceObservation({
        repoRoot: f.repoRoot,
        observation: result.observation,
        expected: expectedBinding(result.observation),
        executablePath: f.executablePath,
      }),
      /producer source identity/,
    );
  });
  await t.test("packaged executable", async (t) => {
    const f = await fixture(t);
    const result = f.producer.emitObservation(f.base);
    fs.appendFileSync(f.executablePath, "tampered\n", "utf8");
    assert.throws(
      () => validateParityEvidenceObservation({
        repoRoot: f.repoRoot,
        observation: result.observation,
        expected: expectedBinding(result.observation),
        executablePath: f.executablePath,
      }),
      /executable identity/,
    );
  });
  await t.test("supporting artifact", async (t) => {
    const f = await fixture(t);
    const result = f.producer.emitObservation(f.base);
    fs.appendFileSync(
      path.join(f.repoRoot, ...f.supportingArtifactPath.split("/")),
      "tampered\n",
      "utf8",
    );
    assert.throws(
      () => validateParityEvidenceObservation({
        repoRoot: f.repoRoot,
        observation: result.observation,
        expected: expectedBinding(result.observation),
        executablePath: f.executablePath,
      }),
      /identity no longer matches/,
    );
  });
});

test("stale observations and workflows longer than twelve hours are rejected", async (t) => {
  const f = await fixture(t);
  const result = f.producer.emitObservation(f.base);
  const recordedAtMs = Date.parse(result.observation.timestamps.recordedAt);
  assert.throws(
    () => validateParityEvidenceObservation({
      repoRoot: f.repoRoot,
      observation: result.observation,
      expected: expectedBinding(result.observation),
      executablePath: f.executablePath,
      nowMs: recordedAtMs + PARITY_EVIDENCE_OBSERVATION_MAX_AGE_MS + 1,
    }),
    /stale/,
  );
  assert.doesNotThrow(() => validateParityEvidenceObservation({
    repoRoot: f.repoRoot,
    observation: result.observation,
    expected: expectedBinding(result.observation),
    expectedExecutableIdentity: result.observation.executable,
    nowMs: recordedAtMs + PARITY_EVIDENCE_OBSERVATION_MAX_AGE_MS + 1,
    enforceFreshness: false,
  }));
  assert.throws(
    () => f.producer.emitObservation({
      ...f.base,
      observationPath: ".qa-results/parity-run/too-long.json",
      startedAt: new Date(Date.now() - PARITY_EVIDENCE_OBSERVATION_MAX_DURATION_MS - 60_000).toISOString(),
      finishedAt: new Date().toISOString(),
    }),
    /duration exceeds/,
  );
});

test("type-specific claims and evidence-root paths are fail closed", async (t) => {
  const f = await fixture(t);
  assert.throws(
    () => f.producer.emitObservation({
      ...f.base,
      observationPath: ".qa-results/parity-run/wrong-claims.json",
      claims: {
        applicability: "NOT_APPLICABLE",
        inventoryContractObserved: true,
        noServiceExpected: true,
      },
    }),
    /electron PASS claims fields/,
  );
  assert.throws(
    () => f.producer.emitObservation({
      ...f.base,
      observationPath: ".qa-results/parity-run/outside-artifact.json",
      supportingArtifactPaths: [f.producerPath],
    }),
    /must live under/,
  );
});

test("checked-in schema exposes the strict observation and FAIL contracts", () => {
  const schema = JSON.parse(
    fs.readFileSync(path.join(qaDir, "parity-evidence-observation.schema.json"), "utf8"),
  );
  assert.equal(schema.properties.schemaVersion.const, PARITY_EVIDENCE_OBSERVATION_SCHEMA_VERSION);
  assert.equal(schema.properties.kind.const, PARITY_EVIDENCE_OBSERVATION_KIND);
  assert.deepEqual(schema.properties.result.enum, ["PASS", "BLOCKED", "FAIL"]);
  assert.equal(schema.properties.runtimeMode.const, "packaged-electron");
  assert.ok(schema.required.includes("packageVerification"));
  assert.equal(schema.$defs.packageVerification.properties.receipt.$ref, "#/$defs/fileReference");
  assert.equal(schema.properties.supportingArtifacts.minItems, 1);
  assert.equal(schema.properties.supportingArtifacts.maxItems, 128);
  assert.equal(
    schema.$defs.passElectronClaims.properties.followUp.$ref,
    "#/$defs/passFollowUpClaims",
  );
  assert.ok(schema.$defs.notApplicableRecovery.required.includes("reasonCode"));
  assert.ok(
    schema.$defs.notApplicableRecovery.required.includes("sourceProvenPreMigrationSemantics"),
  );
  assert.ok(schema.$defs.claimConditionFailureElectron);
});
