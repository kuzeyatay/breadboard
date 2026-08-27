import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  SERVICE_EVIDENCE_GATES,
  SERVICE_EVIDENCE_IMPLEMENTATION_PATHS,
  SERVICE_EVIDENCE_MAX_AGE_MS,
  inventoryEvidenceDefinitions,
  manifestEvidenceDefinitions,
  manifestMandatoryServiceIds,
  publishLatestSuccessfulServiceEvidence,
  readLatestSuccessfulServiceEvidence,
  serviceEvidenceLatestSuccessPath,
  serviceEvidenceSourceIdentity,
  sha256File,
  validateServiceEvidenceReceipt,
  validateServiceEvidenceSource,
} from "./service-evidence-contract.mjs";

const qaDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(qaDir, "..", "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const manifest = JSON.parse(read("desktop/runtime-v2/manifests/services.json"));
const inventory = JSON.parse(read("qa/runtime-v2/execution-inventory.json"));

function receiptProvenance(suite = "all") {
  return {
    schemaVersion: 1,
    runId: `service-evidence-${suite}`,
    runtimeMode: "packaged",
    suite,
    startedAt: "2026-08-26T00:00:00.000Z",
    finishedAt: "2026-08-26T01:00:00.000Z",
    executable: {
      path: "C:\\breadboard\\release\\win-unpacked\\Breadboard.exe",
      bytes: 188_000_000,
      sha256: "A".repeat(64),
    },
    sourceIdentity: {
      serviceManifestSha256: "B".repeat(64),
      executionInventorySha256: "C".repeat(64),
      runnerSha256: "D".repeat(64),
      contractSha256: "E".repeat(64),
      implementationClosureSha256: "F".repeat(64),
    },
  };
}

function serviceEvidenceSandbox() {
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-service-binding-test-"));
  const copies = [
    ["desktop/runtime-v2/manifests/services.json", "desktop/runtime-v2/manifests/services.json"],
    ["qa/runtime-v2/execution-inventory.json", "qa/runtime-v2/execution-inventory.json"],
    ["qa/memory/run-service-evidence.mjs", "qa/memory/run-service-evidence.mjs"],
    ["qa/memory/service-evidence-contract.mjs", "qa/memory/service-evidence-contract.mjs"],
    ...SERVICE_EVIDENCE_IMPLEMENTATION_PATHS.map((relativePath) => [relativePath, relativePath]),
  ];
  for (const [source, destination] of copies) {
    const target = path.join(sandboxRoot, destination);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, source), target);
  }
  const executablePath = path.join(sandboxRoot, "release", "Breadboard.exe");
  fs.mkdirSync(path.dirname(executablePath), { recursive: true });
  fs.writeFileSync(executablePath, "packaged-breadboard-test-artifact", "utf8");
  const nowMs = Date.parse("2026-08-26T12:00:00.000Z");
  const runId = "2026-08-26T11-00-00-000Z-1234";
  const receiptPath = path.join(
    sandboxRoot,
    ".qa-results",
    "runtime-v2-services",
    runId,
    "receipt.json",
  );
  const measurement = {
    sampledAt: nowMs - 60_000,
    commitTotalMb: 1024,
    commitLimitMb: 4096,
    freeCommitMb: 3072,
    privateBytes: 100,
    workingSetBytes: 80,
    processCount: 1,
    descendantCount: 0,
  };
  const receipt = {
    schemaVersion: 1,
    runId,
    runtimeMode: "packaged",
    suite: "burn",
    startedAt: "2026-08-26T02:00:00.000Z",
    finishedAt: "2026-08-26T11:59:00.000Z",
    outcome: "PASS",
    executable: {
      path: executablePath,
      bytes: fs.statSync(executablePath).size,
      sha256: sha256File(executablePath),
    },
    sourceIdentity: serviceEvidenceSourceIdentity(sandboxRoot),
    mandatoryServiceIds: manifestMandatoryServiceIds(manifest),
    ownershipCoverage: inventoryEvidenceDefinitions(inventory, manifest),
    services: manifestEvidenceDefinitions(manifest).map((definition) => ({
      serviceId: definition.id,
      policy: definition.policy,
      initialState: "available-but-stopped",
      finalState: "available-but-stopped",
      gates: SERVICE_EVIDENCE_GATES.map((gate) => ({ gate, status: "pass", measurement })),
    })),
  };
  const writeReceipt = () => {
    fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  };
  return {
    sandboxRoot,
    nowMs,
    receipt,
    receiptPath,
    executablePath,
    writeReceipt,
    cleanup: () => fs.rmSync(sandboxRoot, { recursive: true, force: true }),
  };
}

test("the packaged receipt authority derives all 32 mandatory services including GBrain", () => {
  const ids = manifestMandatoryServiceIds(manifest);
  assert.equal(ids.length, 32);
  assert.equal(ids.includes("gbrain"), true);
  assert.deepEqual(ids, [...ids].sort());
});

test("packaged evidence source covers every manifest service and explicitly leases GBrain", () => {
  const result = validateServiceEvidenceSource({
    serviceManifest: manifest,
    evidenceSource: read("dashboard/src/lib/runtime-v2/packaged-service-evidence.ts"),
    routeSource: read("dashboard/src/app/api/internal/runtime-service-evidence/route.ts"),
    authSource: read("dashboard/src/lib/runtime-v2/packaged-service-evidence-auth.ts"),
    nativeEnvironmentSource: read("native/runtime-core/src/service_environment.rs"),
    electronRuntimeSource: read("desktop/src/main/runtime-process.ts"),
    runnerSource: read("qa/memory/run-service-evidence.mjs"),
    windowsSamplerSource: read("qa/memory/windows-sampler.ps1"),
    packageManifest: JSON.parse(read("package.json")),
    supervisorControlSource: read("dashboard/src/lib/supervisor-control.ts"),
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});

test("ownership coverage reconciles all 44 service-cutover owners and every external boundary", () => {
  const definitions = inventoryEvidenceDefinitions(inventory, manifest);
  assert.equal(
    definitions.filter(({ disposition }) => disposition !== "external-prerequisite").length,
    44,
  );
  assert.equal(
    definitions.filter(({ disposition }) => disposition === "live-managed-service").length,
    manifest.services.length,
  );
  assert.equal(
    definitions.filter(({ disposition }) => disposition === "external-prerequisite").length,
    13,
  );
  assert.deepEqual(
    definitions.find(({ runtimeId }) => runtimeId === "service:gbrain"),
    { runtimeId: "service:gbrain", disposition: "live-managed-service" },
  );
});

test("diagnostic request bodies are stream-capped before full buffering", () => {
  const route = read("dashboard/src/app/api/internal/runtime-service-evidence/route.ts");
  assert.doesNotMatch(route, /request\.text\(\)/u);
  assert.match(route, /request\.body\.getReader\(\)/u);
  assert.match(route, /total > MAX_REQUEST_BYTES/u);
  assert.match(route, /await reader\.cancel\(/u);
});

test("evidence leases survive errors and accept Runtime's idempotent released-false tombstone", () => {
  const evidence = read("dashboard/src/lib/runtime-v2/packaged-service-evidence.ts");
  const supervisor = read("dashboard/src/lib/supervisor-control.ts");
  assert.match(supervisor, /export async function releaseSupervisorLeaseStrict/u);
  assert.match(supervisor, /typeof result\.released !== "boolean"/u);
  assert.match(supervisor, /return result\.released/u);
  assert.match(
    evidence,
    /if \(lease\) \{\s*await releaseSupervisorLeaseStrict\(lease\);\s*state\(\)\.leases\.delete\(serviceId\);/u,
  );
  assert.match(
    evidence,
    /leaseState\.leases\.set\(serviceId, lease\);\s*if \(signal\?\.aborted\)/u,
  );
});

test("all-service status polling uses one Runtime status response", () => {
  const evidence = read("dashboard/src/lib/runtime-v2/packaged-service-evidence.ts");
  const supervisor = read("dashboard/src/lib/supervisor-control.ts");
  assert.match(supervisor, /export async function readSupervisedServiceSnapshots/u);
  assert.match(evidence, /readSupervisedServiceSnapshots\(/u);
  assert.doesNotMatch(
    evidence,
    /Promise\.all\(\s*PACKAGED_SERVICE_EVIDENCE_DEFINITIONS/u,
  );
});

test("every suite is manifest-wide and exposes no service filter", () => {
  const runner = read("qa/memory/run-service-evidence.mjs");
  assert.match(runner, /for \(const definition of definitions\)/u);
  assert.match(runner, /const allowedArguments = new Set\(\["--help", "--suite", "--executable"\]\)/u);
  assert.doesNotMatch(runner, /args\.get\("--service"\)/u);
  for (const suite of ["smoke", "burn", "cancel", "restart", "all"]) {
    assert.equal(
      JSON.parse(read("package.json")).scripts[`qa:memory:services:${suite}`],
      `node qa/memory/run-service-evidence.mjs --suite=${suite}`,
    );
  }
});

test("receipt validation rejects skipped gates and missing services", () => {
  const definitions = manifestEvidenceDefinitions(manifest);
  const receipt = {
    ...receiptProvenance(),
    outcome: "PASS",
    mandatoryServiceIds: manifestMandatoryServiceIds(manifest),
    ownershipCoverage: inventoryEvidenceDefinitions(inventory, manifest),
    services: definitions.slice(0, 1).map((definition) => ({
      serviceId: definition.id,
      policy: definition.policy,
      initialState: "ready",
      finalState: "ready",
      gates: SERVICE_EVIDENCE_GATES.map((gate) => ({ gate, status: "skipped" })),
    })),
  };
  const result = validateServiceEvidenceReceipt(receipt, manifest, inventory);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /does not cover every manifest service/);
  assert.match(result.errors.join("\n"), /skipped|invalid disposition/);
});

test("receipt validation accepts exact all-service Windows measurements", () => {
  const definitions = manifestEvidenceDefinitions(manifest);
  const measurement = {
    sampledAt: Date.now(),
    commitTotalMb: 1024,
    commitLimitMb: 4096,
    freeCommitMb: 3072,
    privateBytes: 100,
    workingSetBytes: 80,
    processCount: 1,
    descendantCount: 0,
  };
  const receipt = {
    ...receiptProvenance(),
    outcome: "PASS",
    mandatoryServiceIds: manifestMandatoryServiceIds(manifest),
    ownershipCoverage: inventoryEvidenceDefinitions(inventory, manifest),
    services: definitions.map((definition) => ({
      serviceId: definition.id,
      policy: definition.policy,
      initialState: "available-but-stopped",
      finalState: "available-but-stopped",
      gates: SERVICE_EVIDENCE_GATES.map((gate) => ({
        gate,
        status: "pass",
        measurement,
      })),
    })),
  };
  const result = validateServiceEvidenceReceipt(receipt, manifest, inventory);
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});

test("receipt validation rejects an unknown outcome even when gates fail", () => {
  const definitions = manifestEvidenceDefinitions(manifest);
  const receipt = {
    ...receiptProvenance(),
    outcome: "BANANA",
    mandatoryServiceIds: manifestMandatoryServiceIds(manifest),
    ownershipCoverage: inventoryEvidenceDefinitions(inventory, manifest),
    services: definitions.map((definition) => ({
      serviceId: definition.id,
      policy: definition.policy,
      initialState: "failed",
      finalState: "failed",
      gates: SERVICE_EVIDENCE_GATES.map((gate) => ({ gate, status: "fail", reason: "test" })),
    })),
  };
  const result = validateServiceEvidenceReceipt(receipt, manifest, inventory);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /outcome must be PASS or FAIL/);
});

test("receipt validation rejects a mandatory list that omits GBrain", () => {
  const definitions = manifestEvidenceDefinitions(manifest);
  const receipt = {
    ...receiptProvenance(),
    outcome: "FAIL",
    mandatoryServiceIds: manifestMandatoryServiceIds(manifest).filter((id) => id !== "gbrain"),
    ownershipCoverage: inventoryEvidenceDefinitions(inventory, manifest),
    services: definitions.map((definition) => ({
      serviceId: definition.id,
      policy: definition.policy,
      initialState: "failed",
      finalState: "failed",
      gates: SERVICE_EVIDENCE_GATES.map((gate) => ({ gate, status: "fail", reason: "test" })),
    })),
  };
  const result = validateServiceEvidenceReceipt(receipt, manifest, inventory);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /exact sorted mandatory service set/);
});

test("canonical latest-success publication is atomic, burn-only, fresh, and cryptographically bound", () => {
  const sandbox = serviceEvidenceSandbox();
  try {
    assert.throws(
      () => readLatestSuccessfulServiceEvidence({
        repoRoot: sandbox.sandboxRoot,
        serviceManifest: manifest,
        executionInventory: inventory,
        nowMs: sandbox.nowMs,
      }),
      /pointer.*does not exist/i,
    );

    sandbox.receipt.outcome = "FAIL";
    sandbox.writeReceipt();
    assert.throws(
      () => publishLatestSuccessfulServiceEvidence({
        repoRoot: sandbox.sandboxRoot,
        receiptPath: sandbox.receiptPath,
        serviceManifest: manifest,
        executionInventory: inventory,
        nowMs: sandbox.nowMs,
      }),
      /invalid|successful packaged burn/i,
    );
    assert.equal(fs.existsSync(serviceEvidenceLatestSuccessPath(sandbox.sandboxRoot)), false);

    sandbox.receipt.outcome = "PASS";
    sandbox.writeReceipt();
    const binding = publishLatestSuccessfulServiceEvidence({
      repoRoot: sandbox.sandboxRoot,
      receiptPath: sandbox.receiptPath,
      serviceManifest: manifest,
      executionInventory: inventory,
      nowMs: sandbox.nowMs,
    });
    assert.equal(binding.outcome, "PASS");
    assert.equal(binding.suite, "burn");
    assert.equal(binding.runtimeMode, "packaged");
    assert.equal(binding.serviceCount, 32);
    assert.equal(binding.gbrainIncluded, true);
    assert.equal(binding.receiptSha256, sha256File(sandbox.receiptPath));
    assert.equal(binding.executable.sha256, sha256File(sandbox.executablePath));

    const pointerPath = serviceEvidenceLatestSuccessPath(sandbox.sandboxRoot);
    const malformedPointer = JSON.parse(fs.readFileSync(pointerPath, "utf8"));
    malformedPointer.receiptSha256 = "not-a-digest";
    fs.writeFileSync(pointerPath, `${JSON.stringify(malformedPointer)}\n`, "utf8");
    assert.throws(
      () => readLatestSuccessfulServiceEvidence({
        repoRoot: sandbox.sandboxRoot,
        serviceManifest: manifest,
        executionInventory: inventory,
        nowMs: sandbox.nowMs,
      }),
      /pointer is malformed/i,
    );
    publishLatestSuccessfulServiceEvidence({
      repoRoot: sandbox.sandboxRoot,
      receiptPath: sandbox.receiptPath,
      serviceManifest: manifest,
      executionInventory: inventory,
      nowMs: sandbox.nowMs,
    });

    fs.appendFileSync(sandbox.receiptPath, " ", "utf8");
    assert.throws(
      () => readLatestSuccessfulServiceEvidence({
        repoRoot: sandbox.sandboxRoot,
        serviceManifest: manifest,
        executionInventory: inventory,
        nowMs: sandbox.nowMs,
      }),
      /pointer does not match|receipt is malformed/i,
    );
  } finally {
    sandbox.cleanup();
  }
});

test("canonical latest-success read rejects stale, incomplete, non-burn, and changed-artifact evidence", () => {
  for (const mutate of [
    (sandbox) => { sandbox.receipt.suite = "smoke"; },
    (sandbox) => { sandbox.receipt.runtimeMode = "actual-electron"; },
    (sandbox) => { sandbox.receipt.services = sandbox.receipt.services.filter(({ serviceId }) => serviceId !== "gbrain"); },
  ]) {
    const sandbox = serviceEvidenceSandbox();
    try {
      mutate(sandbox);
      sandbox.writeReceipt();
      assert.throws(
        () => publishLatestSuccessfulServiceEvidence({
          repoRoot: sandbox.sandboxRoot,
          receiptPath: sandbox.receiptPath,
          serviceManifest: manifest,
          executionInventory: inventory,
          nowMs: sandbox.nowMs,
        }),
        /invalid|successful packaged burn|all-32-service\/GBrain/i,
      );
      assert.equal(fs.existsSync(serviceEvidenceLatestSuccessPath(sandbox.sandboxRoot)), false);
    } finally {
      sandbox.cleanup();
    }
  }

  const stale = serviceEvidenceSandbox();
  try {
    stale.writeReceipt();
    publishLatestSuccessfulServiceEvidence({
      repoRoot: stale.sandboxRoot,
      receiptPath: stale.receiptPath,
      serviceManifest: manifest,
      executionInventory: inventory,
      nowMs: stale.nowMs,
    });
    assert.throws(
      () => readLatestSuccessfulServiceEvidence({
        repoRoot: stale.sandboxRoot,
        serviceManifest: manifest,
        executionInventory: inventory,
        nowMs: stale.nowMs + SERVICE_EVIDENCE_MAX_AGE_MS + 1,
      }),
      /stale/i,
    );
    fs.appendFileSync(stale.executablePath, "changed", "utf8");
    assert.throws(
      () => readLatestSuccessfulServiceEvidence({
        repoRoot: stale.sandboxRoot,
        serviceManifest: manifest,
        executionInventory: inventory,
        nowMs: stale.nowMs,
      }),
      /executable identity no longer matches/i,
    );
    fs.writeFileSync(stale.executablePath, "packaged-breadboard-test-artifact", "utf8");
    fs.appendFileSync(
      path.join(stale.sandboxRoot, "qa", "memory", "run-service-evidence.mjs"),
      "\n// changed after successful evidence\n",
      "utf8",
    );
    assert.throws(
      () => readLatestSuccessfulServiceEvidence({
        repoRoot: stale.sandboxRoot,
        serviceManifest: manifest,
        executionInventory: inventory,
        nowMs: stale.nowMs,
      }),
      /current all-service implementation sources/i,
    );
    fs.copyFileSync(
      path.join(root, "qa", "memory", "run-service-evidence.mjs"),
      path.join(stale.sandboxRoot, "qa", "memory", "run-service-evidence.mjs"),
    );
    fs.appendFileSync(
      path.join(
        stale.sandboxRoot,
        "dashboard",
        "src",
        "lib",
        "runtime-v2",
        "packaged-service-evidence-auth.ts",
      ),
      "\n// changed after successful evidence\n",
      "utf8",
    );
    assert.throws(
      () => readLatestSuccessfulServiceEvidence({
        repoRoot: stale.sandboxRoot,
        serviceManifest: manifest,
        executionInventory: inventory,
        nowMs: stale.nowMs,
      }),
      /current all-service implementation sources/i,
    );
  } finally {
    stale.cleanup();
  }
});
