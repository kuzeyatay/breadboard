import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  computeInventoryContractSha256,
  computeSourceSha256,
  importParityEvidence,
  PARITY_EVIDENCE_KIND,
  PARITY_EVIDENCE_MAX_AGE_MS,
  PARITY_EVIDENCE_SCHEMA_VERSION,
  recordParityEvidenceReceipt,
  sealParityEvidenceReceipt,
  validateRecordedParityEvidence,
} from "./parity-evidence-contract.mjs";
import {
  openParityEvidencePackageRun,
} from "./parity-evidence-observation.mjs";
import {
  getPackageVerifierReceiptDiagnostics,
  packageVerificationBinding,
  recordPackageVerifierReceipt,
} from "./package-verifier-receipt.mjs";

const EVIDENCE_TYPES = ["electron", "service", "worker", "output", "cancellation", "recovery"];
const qaDir = path.dirname(fileURLToPath(import.meta.url));
const observationModuleUrl = pathToFileURL(path.join(qaDir, "parity-evidence-observation.mjs")).href;
const ID_SHA = "A".repeat(64);

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeText(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, "utf8");
}

function createVerifiedPackage(repoRoot) {
  writeText(
    path.join(repoRoot, "desktop", "scripts", "verify-package.mjs"),
    "console.log('[verify-package] OK');\n",
  );
  writeText(path.join(repoRoot, "desktop", "electron-builder.yml"), "asar: true\nextraResources: []\n");
  for (const manifestName of ["services.json", "workers.json"]) {
    const value = manifestName === "services.json" ? { version: 4, services: [] } : { version: 2, workers: [] };
    writeJson(path.join(repoRoot, "desktop", "runtime-v2", "manifests", manifestName), value);
    writeJson(
      path.join(repoRoot, "package", "win-unpacked", "resources", "runtime-v2", "manifests", manifestName),
      value,
    );
  }
  const packageRoot = path.join(repoRoot, "package", "win-unpacked");
  for (const [relativePath, content] of [
    ["Breadboard.exe", "packaged Breadboard executable\n"],
    ["resources/app.asar", "packaged app asar\n"],
    ["resources/app-services/dashboard/scripts/runtime-v2-dashboard.mjs", "export {};\n"],
    ["resources/runtimes/node/node.exe", "node runtime\n"],
    ["resources/runtimes/bun/bun.exe", "bun runtime\n"],
    ["resources/runtimes/python/python.exe", "python runtime\n"],
    ["resources/bin/codex.exe", "codex runtime\n"],
    ["resources/bin/runtime-supervisor.exe", "runtime supervisor\n"],
    ["resources/bin/breadboard-runtime.exe", "runtime v2\n"],
    ["resources/app-services/test-service/runtime.js", "service closure\n"],
  ]) {
    writeText(path.join(packageRoot, ...relativePath.split("/")), content);
  }
  const executablePath = path.join(packageRoot, "Breadboard.exe");
  const packageVerifierReceiptPath = ".qa-results/package-verifier/package-receipt.json";
  const recorded = recordPackageVerifierReceipt({
    repoRoot,
    receiptPath: packageVerifierReceiptPath,
    executablePath,
    runId: "package-verifier-run-1",
  });
  return {
    packageRoot,
    appAsarPath: path.join(packageRoot, "resources", "app.asar"),
    extraResourcePath: path.join(packageRoot, "resources", "app-services", "test-service", "runtime.js"),
    executablePath,
    packageVerifierReceiptPath,
    packageVerification: packageVerificationBinding(recorded),
  };
}

function claimsFor(type, capabilityId, blocked) {
  if (blocked) {
    return {
      electron: {
        uiEntryPoint: "Agents page -> Test capability",
        selectedCapabilityId: capabilityId,
        normalEntryPointUsed: true,
        realRequestSubmitted: true,
        selectionObserved: true,
        truthfulBlockedPresentationObserved: true,
      },
      service: {
        requiredRuntimeId: "service:test",
        runtimeBoundaryObserved: true,
        unrelatedServicesUnaffected: true,
        noFallbackObserved: true,
      },
      worker: {
        expectedWorkerKind: "worker:test",
        dispatchBoundaryObserved: true,
        orphanCount: 0,
        noFallbackObserved: true,
      },
      output: {
        expectedOutputKind: "truthful-blocker",
        placeholderAbsent: true,
        truthfulBlockedResultObserved: true,
      },
      cancellation: {
        cancellationContractObserved: true,
        orphanCount: 0,
        noFallbackObserved: true,
      },
      recovery: {
        recoveryContractObserved: true,
        noDuplicationObserved: true,
        truthfulBlockedStateRetained: true,
      },
    }[type];
  }
  return {
    electron: {
      uiEntryPoint: "Agents page -> Test capability",
      selectedCapabilityId: capabilityId,
      normalEntryPointUsed: true,
      realRequestSubmitted: true,
      selectionObserved: true,
      semanticAssertionsPassed: true,
    },
    service: { applicability: "NOT_APPLICABLE", inventoryContractObserved: true, noServiceExpected: true },
    worker: { applicability: "NOT_APPLICABLE", inventoryContractObserved: true, noWorkerExpected: true },
    output: { applicability: "NOT_APPLICABLE", inventoryContractObserved: true, noOutputExpected: true },
    cancellation: {
      applicability: "NOT_APPLICABLE",
      inventoryContractObserved: true,
      cancellationNotSupported: true,
    },
    recovery: {
      applicability: "NOT_APPLICABLE",
      inventoryContractObserved: true,
      recoveryNotSupported: true,
      reasonCode: "SOURCE_PROVEN_NOT_SUPPORTED",
      sourceProvenPreMigrationSemantics: true,
    },
  }[type];
}

async function fixture(
  t,
  {
    preMigrationStatus = "SOURCE_PRESENT",
    blocked = false,
    blocker = {
      prerequisiteType: "CREDENTIAL",
      prerequisiteId: "test-credential",
      code: "MISSING_CREDENTIAL",
      summary: "The same credential was absent before migration.",
    },
  } = {},
) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-parity-evidence-"));
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  const inventoryPath = path.join(repoRoot, "qa", "runtime-v2", "feature-parity.json");
  const sourcePath = path.join(repoRoot, "src", "capability.ts");
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.writeFileSync(sourcePath, "export const capability = 'real';\n", "utf8");
  const row = {
    capabilityId: "workflow:test-capability",
    sourceIdentity: "workflow:test-capability",
    displayName: "Test capability",
    credentialRequirements: ["test-credential"],
    providerRequirements: [],
    externalSoftwareRequirements: [],
    preMigrationStatus,
    preMigrationEvidence: ["src/capability.ts:1"],
    postMigrationStatus: "NOT RUN",
    postMigrationEvidence: [],
    selectionEvidence: { preMigration: ["src/capability.ts:1"], postMigration: [] },
    serviceWorkerEvidence: { preMigration: ["src/capability.ts:1"], postMigration: [] },
    outputArtifactEvidence: { preMigration: ["src/capability.ts:1"], postMigration: [] },
    cancellationEvidence: { preMigration: ["src/capability.ts:1"], postMigration: [] },
    recoveryEvidence: { preMigration: ["src/capability.ts:1"], postMigration: [] },
    result: "NOT RUN",
    sourceRefs: ["src/capability.ts:1"],
    sourceSha256: computeSourceSha256(repoRoot, ["src/capability.ts:1"]),
    baselineContractSha256: "A".repeat(64),
  };
  const inventory = {
    schemaVersion: 2,
    contractVersion: "runtime-v2-feature-parity-v2",
    capabilityCount: 1,
    sourceCatalogs: {},
    capabilities: [row],
  };
  writeJson(inventoryPath, inventory);

  const runDir = path.join(repoRoot, ".qa-results", "parity-run-1");
  fs.mkdirSync(runDir, { recursive: true });
  const producerPath = "qa/electron/specs/critical/parity-importer.spec.ts";
  const producerFile = path.join(repoRoot, ...producerPath.split("/"));
  fs.mkdirSync(path.dirname(producerFile), { recursive: true });
  fs.writeFileSync(
    producerFile,
    [
      `import { recordParityEvidenceObservation, recordParityEvidenceFailure } from ${JSON.stringify(observationModuleUrl)};`,
      "export function emitObservation(options) { return recordParityEvidenceObservation(options); }",
      "export function emitFailure(options) { return recordParityEvidenceFailure(options); }",
      "",
    ].join("\n"),
    "utf8",
  );
  const producer = await import(`${pathToFileURL(producerFile).href}?fixture=${Date.now()}-${Math.random()}`);
  const verifiedPackage = createVerifiedPackage(repoRoot);
  const { executablePath } = verifiedPackage;
  const packageRunContext = openParityEvidencePackageRun({
    repoRoot,
    packageVerifierReceiptPath: verifiedPackage.packageVerifierReceiptPath,
    executablePath,
    runId: "parity-run-1",
  });
  const startedAtMs = Date.now();
  const supportingArtifactPath = ".qa-results/parity-run-1/actual-workflow.json";
  writeJson(path.join(repoRoot, ...supportingArtifactPath.split("/")), {
    actualElectronWorkflow: true,
    capabilityId: row.capabilityId,
  });
  const evidence = {};
  for (const type of EVIDENCE_TYPES) {
    const recorded = producer.emitObservation({
      repoRoot,
      observationPath: `.qa-results/parity-run-1/${type}-observation.json`,
      producerPath,
      packageRunContext,
      runId: "parity-run-1",
      capabilityId: row.capabilityId,
      evidenceType: type,
      workflowIdentity: {
        electronRunId: "electron-run-1",
        workflowId: "workflow-1",
        conversationIdSha256: ID_SHA,
      },
      operationId: `${type}-operation`,
      startedAt: new Date(startedAtMs).toISOString(),
      finishedAt: new Date().toISOString(),
      claims: claimsFor(type, row.capabilityId, blocked),
      supportingArtifactPaths: [supportingArtifactPath],
      ...(blocked ? { blocker } : {}),
    });
    evidence[type] = [recorded.reference];
  }
  const finishedAtMs = Date.now();
  const receiptPath = path.join(runDir, "parity-receipt.json");

  function receiptRow(overrides = {}) {
    return {
      capabilityId: row.capabilityId,
      result: blocked ? "BLOCKED" : "PASS",
      executionDisposition: blocked
        ? "MATCHING_BASELINE_PREREQUISITE_BLOCKED"
        : "REAL_WORKFLOW_COMPLETED",
      fallbackUsed: false,
      workflowIdentity: {
        electronRunId: "electron-run-1",
        workflowId: "workflow-1",
        conversationIdSha256: ID_SHA,
      },
      ...(blocked ? { blocker } : {}),
      evidence: structuredClone(evidence),
      ...overrides,
    };
  }

  function writeReceipt({ rows = [receiptRow()], startedAt = startedAtMs, finishedAt = finishedAtMs } = {}) {
    const currentInventory = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));
    const receipt = sealParityEvidenceReceipt({
      schemaVersion: PARITY_EVIDENCE_SCHEMA_VERSION,
      kind: PARITY_EVIDENCE_KIND,
      runId: "parity-run-1",
      electronRunId: "electron-run-1",
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date(finishedAt).toISOString(),
      inventory: {
        path: "qa/runtime-v2/feature-parity.json",
        schemaVersion: 2,
        capabilityCount: currentInventory.capabilityCount,
        contractSha256: computeInventoryContractSha256(currentInventory),
      },
      executable: JSON.parse(
        fs.readFileSync(path.join(runDir, "electron-observation.json"), "utf8"),
      ).executable,
      packageVerification: verifiedPackage.packageVerification,
      rows,
    });
    writeJson(receiptPath, receipt);
    return receipt;
  }

  return {
    repoRoot,
    inventoryPath,
    receiptPath,
    sourcePath,
    executablePath,
    packageRoot: verifiedPackage.packageRoot,
    appAsarPath: verifiedPackage.appAsarPath,
    extraResourcePath: verifiedPackage.extraResourcePath,
    packageVerifierReceiptPath: verifiedPackage.packageVerifierReceiptPath,
    packageVerification: verifiedPackage.packageVerification,
    packageRunContext,
    producer,
    producerPath,
    supportingArtifactPath,
    blocker,
    row,
    evidence,
    startedAtMs,
    finishedAtMs,
    receiptRow,
    writeReceipt,
  };
}

test("a sealed PASS receipt atomically updates only post-migration fields", async (t) => {
  const f = await fixture(t);
  f.writeReceipt();
  const before = JSON.parse(fs.readFileSync(f.inventoryPath, "utf8"));
  const frozenBefore = computeInventoryContractSha256(before);
  const beforeImport = getPackageVerifierReceiptDiagnostics();
  const result = importParityEvidence({
    repoRoot: f.repoRoot,
    inventoryPath: f.inventoryPath,
    receiptPath: f.receiptPath,
    nowMs: f.finishedAtMs + 1,
  });
  const afterImport = getPackageVerifierReceiptDiagnostics();
  assert.equal(
    afterImport.fullPackageTreeSnapshotCount - beforeImport.fullPackageTreeSnapshotCount,
    2,
  );
  assert.deepEqual(result.importedCapabilityIds, [f.row.capabilityId]);
  const after = JSON.parse(fs.readFileSync(f.inventoryPath, "utf8"));
  assert.equal(computeInventoryContractSha256(after), frozenBefore);
  assert.equal(after.capabilities[0].result, "PASS");
  assert.equal(after.capabilities[0].postMigrationStatus, "PASS");
  assert.equal(after.capabilities[0].selectionEvidence.postMigration.length, 1);
  assert.equal(after.capabilities[0].serviceWorkerEvidence.postMigration.length, 2);
  assert.equal(after.capabilities[0].postMigrationEvidence.length, 7);
  const beforePersistentValidation = getPackageVerifierReceiptDiagnostics();
  assert.equal(validateRecordedParityEvidence({ inventory: after, repoRoot: f.repoRoot }).ok, true);
  const afterPersistentValidation = getPackageVerifierReceiptDiagnostics();
  assert.equal(
    afterPersistentValidation.fullPackageTreeSnapshotCount -
      beforePersistentValidation.fullPackageTreeSnapshotCount,
    1,
  );
});

test("check-only validates without populating the inventory", async (t) => {
  const f = await fixture(t);
  f.writeReceipt();
  const before = fs.readFileSync(f.inventoryPath, "utf8");
  const result = importParityEvidence({
    repoRoot: f.repoRoot,
    inventoryPath: f.inventoryPath,
    receiptPath: f.receiptPath,
    nowMs: f.finishedAtMs + 1,
    checkOnly: true,
  });
  assert.equal(result.checkOnly, true);
  assert.equal(fs.readFileSync(f.inventoryPath, "utf8"), before);
});

test("the receipt recorder derives a sealed PASS batch only from runner observations", async (t) => {
  const f = await fixture(t);
  const observationPaths = EVIDENCE_TYPES.flatMap((type) => f.evidence[type].map((reference) => reference.path));
  const prohibitedReceipt = path.join(f.repoRoot, ".qa-results", "mock", "parity-receipt.json");
  assert.throws(
    () => recordParityEvidenceReceipt({
      repoRoot: f.repoRoot,
      inventoryPath: f.inventoryPath,
      receiptPath: ".qa-results/mock/parity-receipt.json",
      observationPaths,
      executablePath: f.executablePath,
      packageVerifierReceiptPath: f.packageVerifierReceiptPath,
    }),
    /prohibited mock\/canned\/lower-capability path/,
  );
  assert.equal(fs.existsSync(prohibitedReceipt), false);
  const beforeReceiptPublication = getPackageVerifierReceiptDiagnostics();
  const recorded = recordParityEvidenceReceipt({
    repoRoot: f.repoRoot,
    inventoryPath: f.inventoryPath,
    receiptPath: path.relative(f.repoRoot, f.receiptPath).replaceAll("\\", "/"),
    observationPaths,
    executablePath: f.executablePath,
    packageVerifierReceiptPath: f.packageVerifierReceiptPath,
  });
  const afterReceiptPublication = getPackageVerifierReceiptDiagnostics();
  assert.equal(
    afterReceiptPublication.fullPackageTreeSnapshotCount -
      beforeReceiptPublication.fullPackageTreeSnapshotCount,
    2,
  );
  assert.equal(recorded.receipt.rows.length, 1);
  assert.equal(recorded.receipt.rows[0].result, "PASS");
  assert.deepEqual(recorded.receipt.rows[0].evidence.electron, f.evidence.electron);
  assert.throws(
    () => recordParityEvidenceReceipt({
      repoRoot: f.repoRoot,
      inventoryPath: f.inventoryPath,
      receiptPath: recorded.reference.path,
      observationPaths,
      executablePath: f.executablePath,
      packageVerifierReceiptPath: f.packageVerifierReceiptPath,
    }),
    /already exists/,
  );
  importParityEvidence({
    repoRoot: f.repoRoot,
    inventoryPath: f.inventoryPath,
    receiptPath: f.receiptPath,
  });
  const inventory = JSON.parse(fs.readFileSync(f.inventoryPath, "utf8"));
  assert.equal(inventory.capabilities[0].result, "PASS");
  assert.equal(validateRecordedParityEvidence({ inventory, repoRoot: f.repoRoot }).ok, true);
});

test("a package mutation during a guarded run cannot reach batch publication", async (t) => {
  const f = await fixture(t);
  const observationPaths = EVIDENCE_TYPES.flatMap((type) =>
    f.evidence[type].map((reference) => reference.path));
  const executableBefore = fs.readFileSync(f.executablePath);
  fs.appendFileSync(f.extraResourcePath, "tampered during guarded run\n", "utf8");
  assert.deepEqual(fs.readFileSync(f.executablePath), executableBefore);
  const before = getPackageVerifierReceiptDiagnostics();
  assert.throws(
    () => recordParityEvidenceReceipt({
      repoRoot: f.repoRoot,
      inventoryPath: f.inventoryPath,
      receiptPath: path.relative(f.repoRoot, f.receiptPath).replaceAll("\\", "/"),
      observationPaths,
      executablePath: f.executablePath,
      packageVerifierReceiptPath: f.packageVerifierReceiptPath,
    }),
    /package closure|win-unpacked tree/i,
  );
  const after = getPackageVerifierReceiptDiagnostics();
  assert.equal(after.fullPackageTreeSnapshotCount - before.fullPackageTreeSnapshotCount, 1);
  assert.equal(fs.existsSync(f.receiptPath), false);
});

test("a runner-recorded FAIL remains non-accepting and imports only failure evidence", async (t) => {
  const f = await fixture(t);
  const failure = f.producer.emitFailure({
    repoRoot: f.repoRoot,
    observationPath: ".qa-results/parity-run-1/failure-observation.json",
    producerPath: f.producerPath,
    packageRunContext: f.packageRunContext,
    runId: "parity-run-1",
    capabilityId: f.row.capabilityId,
    workflowIdentity: {
      electronRunId: "electron-run-1",
      workflowId: "workflow-1",
      conversationIdSha256: ID_SHA,
    },
    operationId: "failure-operation",
    startedAt: new Date(f.startedAtMs).toISOString(),
    finishedAt: new Date().toISOString(),
    failureCode: "ASSERTION_FAILED",
    failureSummary: "The real Electron workflow returned the wrong selected capability.",
    claims: {
      uiEntryPoint: "Agents page -> Test capability",
      selectedCapabilityId: f.row.capabilityId,
      normalEntryPointUsed: true,
      realRequestSubmitted: true,
      selectionObserved: true,
      failureObserved: true,
      truthfulFailurePresentationObserved: true,
    },
    supportingArtifactPaths: [f.supportingArtifactPath],
  });
  const recorded = recordParityEvidenceReceipt({
    repoRoot: f.repoRoot,
    inventoryPath: f.inventoryPath,
    receiptPath: path.relative(f.repoRoot, f.receiptPath).replaceAll("\\", "/"),
    observationPaths: [failure.reference.path],
    executablePath: f.executablePath,
    packageVerifierReceiptPath: f.packageVerifierReceiptPath,
  });
  assert.equal(recorded.receipt.rows[0].result, "FAIL");
  assert.deepEqual(recorded.receipt.rows[0].failure, {
    code: "ASSERTION_FAILED",
    summary: "The real Electron workflow returned the wrong selected capability.",
  });
  importParityEvidence({ repoRoot: f.repoRoot, inventoryPath: f.inventoryPath, receiptPath: f.receiptPath });
  const inventory = JSON.parse(fs.readFileSync(f.inventoryPath, "utf8"));
  const row = inventory.capabilities[0];
  assert.equal(row.result, "FAIL");
  assert.equal(row.postMigrationStatus, "FAIL");
  assert.equal(row.postMigrationEvidence.length, 2);
  assert.equal(row.selectionEvidence.postMigration.length, 1);
  assert.deepEqual(row.serviceWorkerEvidence.postMigration, []);
  assert.deepEqual(row.outputArtifactEvidence.postMigration, []);
  assert.deepEqual(row.cancellationEvidence.postMigration, []);
  assert.deepEqual(row.recoveryEvidence.postMigration, []);
  assert.equal(validateRecordedParityEvidence({ inventory, repoRoot: f.repoRoot }).ok, true);
});

test("stale, tampered, and missing evidence receipts fail without a partial update", async (t) => {
  await t.test("unbounded run cannot make old evidence look fresh", async (t) => {
    const f = await fixture(t);
    f.writeReceipt({ startedAt: f.finishedAtMs - 13 * 60 * 60_000 });
    assert.throws(
      () => importParityEvidence({ repoRoot: f.repoRoot, inventoryPath: f.inventoryPath, receiptPath: f.receiptPath }),
      /duration exceeds/,
    );
  });
  await t.test("stale", async (t) => {
    const f = await fixture(t);
    f.writeReceipt();
    const before = fs.readFileSync(f.inventoryPath, "utf8");
    assert.throws(
      () => importParityEvidence({
        repoRoot: f.repoRoot,
        inventoryPath: f.inventoryPath,
        receiptPath: f.receiptPath,
        nowMs: f.finishedAtMs + PARITY_EVIDENCE_MAX_AGE_MS + 1,
      }),
      /stale/,
    );
    assert.equal(fs.readFileSync(f.inventoryPath, "utf8"), before);
  });
  await t.test("receipt content changed after sealing", async (t) => {
    const f = await fixture(t);
    const receipt = f.writeReceipt();
    receipt.runId = "altered-run";
    writeJson(f.receiptPath, receipt);
    assert.throws(
      () => importParityEvidence({ repoRoot: f.repoRoot, inventoryPath: f.inventoryPath, receiptPath: f.receiptPath }),
      /contentSha256/,
    );
  });
  await t.test("evidence content changed after hashing", async (t) => {
    const f = await fixture(t);
    f.writeReceipt();
    fs.appendFileSync(path.join(f.repoRoot, ...f.supportingArtifactPath.split("/")), "tampered\n", "utf8");
    assert.throws(
      () => importParityEvidence({ repoRoot: f.repoRoot, inventoryPath: f.inventoryPath, receiptPath: f.receiptPath }),
      /supportingArtifacts\[0\] identity no longer matches/,
    );
  });
  await t.test("same executable with a changed app.asar package closure", async (t) => {
    const f = await fixture(t);
    f.writeReceipt();
    const beforeInventory = fs.readFileSync(f.inventoryPath, "utf8");
    const executableBefore = fs.readFileSync(f.executablePath);
    fs.appendFileSync(f.appAsarPath, "tampered app code\n", "utf8");
    assert.deepEqual(fs.readFileSync(f.executablePath), executableBefore);
    assert.throws(
      () => importParityEvidence({ repoRoot: f.repoRoot, inventoryPath: f.inventoryPath, receiptPath: f.receiptPath }),
      /app\.asar|package closure|critical artifact/i,
    );
    assert.equal(fs.readFileSync(f.inventoryPath, "utf8"), beforeInventory);
  });
  await t.test("evidence file removed", async (t) => {
    const f = await fixture(t);
    f.writeReceipt();
    fs.rmSync(path.join(f.repoRoot, f.evidence.recovery[0].path));
    assert.throws(
      () => importParityEvidence({ repoRoot: f.repoRoot, inventoryPath: f.inventoryPath, receiptPath: f.receiptPath }),
      /does not identify an existing regular file/,
    );
  });
});

test("unknown and duplicate capability rows are rejected as an atomic batch", async (t) => {
  await t.test("unknown row", async (t) => {
    const f = await fixture(t);
    const unknown = f.receiptRow({ capabilityId: "workflow:unknown" });
    f.writeReceipt({ rows: [unknown] });
    const before = fs.readFileSync(f.inventoryPath, "utf8");
    assert.throws(
      () => importParityEvidence({ repoRoot: f.repoRoot, inventoryPath: f.inventoryPath, receiptPath: f.receiptPath }),
      /unknown capability/,
    );
    assert.equal(fs.readFileSync(f.inventoryPath, "utf8"), before);
  });
  await t.test("duplicate row", async (t) => {
    const f = await fixture(t);
    const row = f.receiptRow();
    f.writeReceipt({ rows: [row, structuredClone(row)] });
    assert.throws(
      () => importParityEvidence({ repoRoot: f.repoRoot, inventoryPath: f.inventoryPath, receiptPath: f.receiptPath }),
      /unique and sorted|duplicates capability/,
    );
  });
});

test("all six evidence classes are mandatory and duplicates are rejected", async (t) => {
  await t.test("missing class", async (t) => {
    const f = await fixture(t);
    const row = f.receiptRow();
    row.evidence.cancellation = [];
    f.writeReceipt({ rows: [row] });
    assert.throws(
      () => importParityEvidence({ repoRoot: f.repoRoot, inventoryPath: f.inventoryPath, receiptPath: f.receiptPath }),
      /requires actual cancellation evidence/,
    );
  });
  await t.test("duplicate reference", async (t) => {
    const f = await fixture(t);
    const row = f.receiptRow();
    row.evidence.output.push(structuredClone(row.evidence.output[0]));
    f.writeReceipt({ rows: [row] });
    assert.throws(
      () => importParityEvidence({ repoRoot: f.repoRoot, inventoryPath: f.inventoryPath, receiptPath: f.receiptPath }),
      /duplicate output evidence/,
    );
  });
});

test("BLOCKED requires both a matching baseline status and an authenticated legacy package receipt", async (t) => {
  const blockedRow = (f) => f.receiptRow({
    result: "BLOCKED",
    executionDisposition: "MATCHING_BASELINE_PREREQUISITE_BLOCKED",
    blocker: {
      code: "MISSING_CREDENTIAL",
      summary: "The same credential was absent before migration.",
      prerequisiteType: "CREDENTIAL",
      prerequisiteId: "test-credential",
    },
  });
  await t.test("new blocker is rejected", async (t) => {
    const f = await fixture(t, { blocked: true });
    f.writeReceipt({ rows: [blockedRow(f)] });
    assert.throws(
      () => importParityEvidence({ repoRoot: f.repoRoot, inventoryPath: f.inventoryPath, receiptPath: f.receiptPath }),
      /newly BLOCKED/,
    );
  });
  await t.test("a matching but unauthenticated baseline status still cannot authorize BLOCKED", async (t) => {
    const f = await fixture(t, { preMigrationStatus: "BLOCKED", blocked: true });
    f.writeReceipt({ rows: [blockedRow(f)] });
    const before = fs.readFileSync(f.inventoryPath, "utf8");
    assert.throws(
      () => importParityEvidence({ repoRoot: f.repoRoot, inventoryPath: f.inventoryPath, receiptPath: f.receiptPath }),
      /sealed pre-migration installed-Electron package-closure receipt/,
    );
    assert.equal(fs.readFileSync(f.inventoryPath, "utf8"), before);
  });
  await t.test("unrelated prerequisite is rejected", async (t) => {
    const mismatchedBlocker = {
      prerequisiteType: "CREDENTIAL",
      prerequisiteId: "some-other-credential",
      code: "MISSING_CREDENTIAL",
      summary: "An unrelated credential was absent.",
    };
    const f = await fixture(t, {
      preMigrationStatus: "BLOCKED",
      blocked: true,
      blocker: mismatchedBlocker,
    });
    const row = blockedRow(f);
    row.blocker = mismatchedBlocker;
    f.writeReceipt({ rows: [row] });
    assert.throws(
      () => importParityEvidence({ repoRoot: f.repoRoot, inventoryPath: f.inventoryPath, receiptPath: f.receiptPath }),
      /does not match a frozen pre-migration prerequisite/,
    );
  });
});

test("source drift and duplicate imports are fail-closed", async (t) => {
  await t.test("source SHA changed", async (t) => {
    const f = await fixture(t);
    f.writeReceipt();
    fs.appendFileSync(f.sourcePath, "export const drift = true;\n", "utf8");
    assert.throws(
      () => importParityEvidence({ repoRoot: f.repoRoot, inventoryPath: f.inventoryPath, receiptPath: f.receiptPath }),
      /source files no longer match/,
    );
  });
  await t.test("same receipt cannot overwrite a completed row", async (t) => {
    const f = await fixture(t);
    f.writeReceipt();
    importParityEvidence({ repoRoot: f.repoRoot, inventoryPath: f.inventoryPath, receiptPath: f.receiptPath });
    assert.throws(
      () => importParityEvidence({ repoRoot: f.repoRoot, inventoryPath: f.inventoryPath, receiptPath: f.receiptPath }),
      /duplicate\/overwrite imports are forbidden/,
    );
  });
});

test("recorded parity validation detects evidence changed after import", async (t) => {
  const f = await fixture(t);
  f.writeReceipt();
  importParityEvidence({ repoRoot: f.repoRoot, inventoryPath: f.inventoryPath, receiptPath: f.receiptPath });
  const inventory = JSON.parse(fs.readFileSync(f.inventoryPath, "utf8"));
  fs.appendFileSync(path.join(f.repoRoot, ...f.supportingArtifactPath.split("/")), "tampered\n", "utf8");
  const validation = validateRecordedParityEvidence({ inventory, repoRoot: f.repoRoot });
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some((error) => /supportingArtifacts\[0\] identity no longer matches/.test(error)));
});

test("recorded parity validation rehashes the full package closure after import", async (t) => {
  const f = await fixture(t);
  f.writeReceipt();
  importParityEvidence({ repoRoot: f.repoRoot, inventoryPath: f.inventoryPath, receiptPath: f.receiptPath });
  const inventory = JSON.parse(fs.readFileSync(f.inventoryPath, "utf8"));
  const executableBefore = fs.readFileSync(f.executablePath);
  fs.appendFileSync(f.extraResourcePath, "tampered non-critical resource\n", "utf8");
  assert.deepEqual(fs.readFileSync(f.executablePath), executableBefore);
  const validation = validateRecordedParityEvidence({ inventory, repoRoot: f.repoRoot });
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some((error) => /package closure|win-unpacked tree/i.test(error)));
});

test("the checked-in JSON schema and package scripts expose the fail-closed workflow", () => {
  const qaDir = path.dirname(fileURLToPath(import.meta.url));
  const schema = JSON.parse(fs.readFileSync(path.join(qaDir, "parity-evidence-receipt.schema.json"), "utf8"));
  assert.equal(schema.properties.schemaVersion.const, PARITY_EVIDENCE_SCHEMA_VERSION);
  assert.equal(schema.properties.kind.const, PARITY_EVIDENCE_KIND);
  assert.ok(schema.required.includes("packageVerification"));
  assert.equal(schema.$defs.packageVerification.properties.receipt.$ref, "#/$defs/reference");
  const packageManifest = JSON.parse(fs.readFileSync(path.resolve(qaDir, "..", "..", "package.json"), "utf8"));
  assert.equal(packageManifest.scripts["qa:runtime-v2:parity:import"], "node qa/runtime-v2/import-parity-evidence.mjs");
  assert.equal(packageManifest.scripts["qa:runtime-v2:parity:record"], "node qa/runtime-v2/record-parity-evidence.mjs");
  assert.equal(
    packageManifest.scripts["qa:runtime-v2:package:record"],
    "node qa/runtime-v2/record-package-verifier-receipt.mjs",
  );
  assert.equal(
    packageManifest.scripts["qa:runtime-v2:parity:import:test"],
    "node --test qa/runtime-v2/package-verifier-receipt.test.mjs qa/runtime-v2/parity-evidence-observation.test.mjs qa/runtime-v2/parity-evidence-contract.test.mjs",
  );
});
