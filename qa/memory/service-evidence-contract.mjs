import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const SERVICE_EVIDENCE_LATEST_SUCCESS_SCHEMA_VERSION = 1;
export const SERVICE_EVIDENCE_MAX_AGE_MS = 6 * 60 * 60_000;
export const SERVICE_EVIDENCE_FUTURE_TOLERANCE_MS = 5 * 60_000;
export const SERVICE_EVIDENCE_AUTHORITY = "runtime-v2-services-receipt";

const SHA256_PATTERN = /^[0-9A-F]{64}$/u;
const LATEST_SUCCESS_KIND = "breadboard-runtime-v2-service-evidence-latest-success";

export const SERVICE_EVIDENCE_IMPLEMENTATION_PATHS = Object.freeze([
  "dashboard/src/app/api/internal/runtime-service-evidence/route.ts",
  "dashboard/src/lib/recall/runtime-service.ts",
  "dashboard/src/lib/runtime-v2/packaged-service-evidence-auth.ts",
  "dashboard/src/lib/runtime-v2/packaged-service-evidence.ts",
  "dashboard/src/lib/supervisor-control.ts",
  "desktop/src/main/runtime-process.ts",
  "native/runtime-core/src/process_owner.rs",
  "native/runtime-core/src/service_environment.rs",
  "native/runtime-supervisor/src/main.rs",
  "qa/memory/windows-sampler.ps1",
]);

export function sha256File(file) {
  const hash = createHash("sha256");
  const descriptor = fs.openSync(file, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex").toUpperCase();
}

export function serviceEvidenceImplementationClosureSha256(repoRoot) {
  const resolvedRoot = path.resolve(repoRoot);
  const hash = createHash("sha256");
  for (const relativePath of SERVICE_EVIDENCE_IMPLEMENTATION_PATHS) {
    const normalizedPath = relativePath.replaceAll("\\", "/");
    const bytes = fs.readFileSync(path.join(resolvedRoot, ...normalizedPath.split("/")));
    hash.update(`${Buffer.byteLength(normalizedPath, "utf8")}:`, "utf8");
    hash.update(normalizedPath, "utf8");
    hash.update(`${bytes.byteLength}:`, "utf8");
    hash.update(bytes);
  }
  return hash.digest("hex").toUpperCase();
}

export function serviceEvidenceResultRoot(repoRoot) {
  return path.join(path.resolve(repoRoot), ".qa-results", "runtime-v2-services");
}

export function serviceEvidenceLatestSuccessPath(repoRoot) {
  return path.join(serviceEvidenceResultRoot(repoRoot), "latest-success.json");
}

export function serviceEvidenceSourceIdentity(repoRoot) {
  const resolvedRoot = path.resolve(repoRoot);
  return Object.freeze({
    serviceManifestSha256: sha256File(path.join(resolvedRoot, "desktop", "runtime-v2", "manifests", "services.json")),
    executionInventorySha256: sha256File(path.join(resolvedRoot, "qa", "runtime-v2", "execution-inventory.json")),
    runnerSha256: sha256File(path.join(resolvedRoot, "qa", "memory", "run-service-evidence.mjs")),
    contractSha256: sha256File(path.join(resolvedRoot, "qa", "memory", "service-evidence-contract.mjs")),
    implementationClosureSha256: serviceEvidenceImplementationClosureSha256(resolvedRoot),
  });
}

function validSha256(value) {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function samePath(left, right) {
  const resolvedLeft = path.resolve(left);
  const resolvedRight = path.resolve(right);
  return process.platform === "win32"
    ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
    : resolvedLeft === resolvedRight;
}

function validArtifactIdentity(value) {
  return (
    record(value) &&
    typeof value.path === "string" &&
    path.isAbsolute(value.path) &&
    path.extname(value.path).toLowerCase() === ".exe" &&
    Number.isSafeInteger(value.bytes) &&
    value.bytes > 0 &&
    validSha256(value.sha256)
  );
}

function validSourceIdentity(value) {
  return (
    record(value) &&
    [
      value.serviceManifestSha256,
      value.executionInventorySha256,
      value.runnerSha256,
      value.contractSha256,
      value.implementationClosureSha256,
    ].every(validSha256)
  );
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function expectedReceiptPath(repoRoot, runId) {
  if (
    typeof runId !== "string" ||
    runId.length === 0 ||
    path.basename(runId) !== runId ||
    runId === "." ||
    runId === ".."
  ) {
    throw new Error("Service evidence receipt has an invalid run identity.");
  }
  return path.join(serviceEvidenceResultRoot(repoRoot), runId, "receipt.json");
}

export const SERVICE_EVIDENCE_GATES = Object.freeze([
  "cold-start",
  "startup-ready",
  "steady",
  "request-peak",
  "descendants",
  "cancel",
  "restart",
  "shutdown",
  "post-idle",
]);
const SERVICE_EVIDENCE_SUITES = new Set(["smoke", "burn", "cancel", "restart", "all"]);

const SERVICE_STATES = new Set([
  "pending",
  "healthy",
  "degraded",
  "stopped",
  "available-but-stopped",
  "starting",
  "ready",
  "busy",
  "resource-blocked",
  "installation-unavailable",
  "failed",
  "stopping",
]);

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function expectedPolicy(service) {
  return service.id === "recall" ? "recall-reconcile" : "lease";
}

export function manifestEvidenceDefinitions(serviceManifest) {
  if (!record(serviceManifest) || !Array.isArray(serviceManifest.services)) {
    throw new TypeError("Runtime V2 service manifest is invalid.");
  }
  return serviceManifest.services.map((service) => {
    if (!record(service) || typeof service.id !== "string") {
      throw new TypeError("Runtime V2 service manifest contains an invalid service.");
    }
    return Object.freeze({ id: service.id, policy: expectedPolicy(service) });
  });
}

function manifestServiceIds(serviceManifest, predicate, label) {
  if (!record(serviceManifest) || !Array.isArray(serviceManifest.services)) {
    throw new TypeError("Runtime V2 service manifest is invalid.");
  }
  const ids = [];
  for (const service of serviceManifest.services) {
    if (!record(service) || typeof service.id !== "string" || service.id.length === 0) {
      throw new TypeError(`Runtime V2 service manifest contains an invalid ${label} service.`);
    }
    if (predicate(service)) ids.push(service.id);
  }
  ids.sort();
  if (new Set(ids).size !== ids.length) {
    throw new TypeError(`Runtime V2 service manifest contains duplicate ${label} service IDs.`);
  }
  return Object.freeze(ids);
}

export function manifestMandatoryServiceIds(serviceManifest) {
  return manifestServiceIds(
    serviceManifest,
    (service) => service.requirement === "required",
    "mandatory",
  );
}

export function manifestEagerRequiredServiceIds(serviceManifest) {
  return manifestServiceIds(
    serviceManifest,
    (service) => service.requirement === "required" && service.startupPolicy === "eager",
    "eager required",
  );
}

export function parseEvidenceDefinitions(source) {
  const match = source.match(
    /PACKAGED_SERVICE_EVIDENCE_DEFINITIONS\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\s*as const/u,
  );
  if (!match) throw new Error("Packaged service evidence definition block is missing.");
  return [...match[1].matchAll(/\{\s*id:\s*"([a-z0-9-]+)",\s*policy:\s*"(lease|recall-reconcile)"\s*\}/gu)]
    .map((entry) => ({ id: entry[1], policy: entry[2] }));
}

export function validateServiceEvidenceSource({
  serviceManifest,
  evidenceSource,
  routeSource,
  authSource,
  nativeEnvironmentSource,
  electronRuntimeSource,
  runnerSource,
  windowsSamplerSource,
  packageManifest,
  supervisorControlSource,
}) {
  const errors = [];
  const expected = manifestEvidenceDefinitions(serviceManifest);
  const actual = parseEvidenceDefinitions(evidenceSource);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push("Packaged service evidence definitions drifted from services.json.");
  }
  if (!actual.some((definition) => definition.id === "gbrain" && definition.policy === "lease")) {
    errors.push("GBrain is not an explicit lease-controlled packaged evidence service.");
  }
  for (const gate of SERVICE_EVIDENCE_GATES) {
    if (!routeSource.includes("PACKAGED_SERVICE_EVIDENCE_DEFINITIONS") && gate === "cold-start") {
      errors.push("Packaged service evidence route does not use the closed definition list.");
    }
  }
  for (const [source, label] of [
    [nativeEnvironmentSource, "native Runtime environment gate"],
    [electronRuntimeSource, "Electron Runtime environment gate"],
  ]) {
    if (!source.includes('"BREADBOARD_MEMORY_DIAGNOSTIC_TOKEN"')) {
      errors.push(`${label} omits BREADBOARD_MEMORY_DIAGNOSTIC_TOKEN.`);
    }
  }
  if (!nativeEnvironmentSource.includes('"BREADBOARD_PACKAGED_SERVICE_EVIDENCE_ENDPOINTS"')) {
    errors.push("native Runtime environment gate omits the trusted evidence endpoint map.");
  }
  for (const required of [
    "BREADBOARD_PACKAGED_SERVICE_EVIDENCE",
    "authorizedPackagedServiceEvidenceRequest",
    "SERVICE_NOT_EVIDENCE_CONTROLLED",
    "packagedServiceEvidenceEndpoints",
  ]) {
    if (!routeSource.includes(required)) {
      errors.push(`Packaged service evidence route omits ${required}.`);
    }
  }
  for (const required of [
    "PACKAGED_SERVICE_EVIDENCE_TOKEN_PATTERN = /^[0-9a-f]{64}$/",
    'request.headers.get("host")',
    "expectedHost = `127.0.0.1:${port}`",
    'protocol !== "http:"',
    "timingSafeEqual",
  ]) {
    if (!authSource.includes(required)) {
      errors.push(`Packaged service evidence auth omits ${required}.`);
    }
  }
  if (
    routeSource.includes("request.text()") ||
    !routeSource.includes("request.body.getReader()") ||
    !routeSource.includes("total > MAX_REQUEST_BYTES") ||
    !routeSource.includes("reader.cancel(")
  ) {
    errors.push("Packaged service evidence route does not stream-enforce its 1024-byte body cap.");
  }
  if (
    !supervisorControlSource.includes("export async function releaseSupervisorLeaseStrict") ||
    !supervisorControlSource.includes('typeof result.released !== "boolean"') ||
    !supervisorControlSource.includes("return result.released")
  ) {
    errors.push("Supervisor control omits strict acknowledged evidence-lease release.");
  }
  if (
    !supervisorControlSource.includes("export async function readSupervisedServiceSnapshots") ||
    !evidenceSource.includes("readSupervisedServiceSnapshots(") ||
    evidenceSource.includes("Promise.all(\n    PACKAGED_SERVICE_EVIDENCE_DEFINITIONS")
  ) {
    errors.push("Packaged evidence status polling does not use one bounded Runtime status read.");
  }
  if (
    !/if \(lease\) \{\s*await releaseSupervisorLeaseStrict\(lease\);\s*state\(\)\.leases\.delete\(serviceId\);/u.test(
      evidenceSource,
    ) ||
    !/leaseState\.leases\.set\(serviceId, lease\);\s*if \(signal\?\.aborted\)/u.test(
      evidenceSource,
    )
  ) {
    errors.push("Packaged evidence lease authority can be discarded before acknowledged release.");
  }
  for (const required of [
    "for (const definition of definitions)",
    "SERVICE_EVIDENCE_GATES",
    "inventoryEvidenceDefinitions(executionInventory, manifest)",
    "mandatoryServiceIds: manifestMandatoryServiceIds(manifest)",
    "EXTERNAL_PROCESS_NOT_RUNTIME_OWNED",
    "publishLatestSuccessfulServiceEvidence({",
    "sha256: sha256File(executable)",
    "serviceEvidenceSourceIdentity(repoRoot)",
    "receipt.outcome === \"PASS\" && suite === \"burn\"",
  ]) {
    if (!runnerSource.includes(required)) {
      errors.push(`All-service evidence runner omits ${required}.`);
    }
  }
  if (runnerSource.includes('args.get("--service")') || runnerSource.includes("--service=")) {
    errors.push("All-service evidence runner exposes a service-subset escape hatch.");
  }
  if (
    !windowsSamplerSource.includes("Get-NetTCPConnection -State Listen") ||
    !windowsSamplerSource.includes("ownerPid") ||
    !windowsSamplerSource.includes("sample-with-listeners") ||
    !runnerSource.includes('this.child.stdin.write("sample-with-listeners\\n")')
  ) {
    errors.push("Windows sampler omits listener-to-process ownership evidence.");
  }
  const scripts = record(packageManifest) && record(packageManifest.scripts)
    ? packageManifest.scripts
    : {};
  if (
    scripts["qa:memory:services:validate"] !==
    "node --test qa/memory/service-evidence-contract.test.mjs && npm --prefix dashboard exec tsc -- --noEmit -p dashboard/tsconfig.packaged-service-evidence.json"
  ) {
    errors.push("package.json omits the focused service evidence source/type validation gate.");
  }
  for (const suite of ["smoke", "burn", "cancel", "restart", "all"]) {
    const command = scripts[`qa:memory:services:${suite}`];
    if (command !== `node qa/memory/run-service-evidence.mjs --suite=${suite}`) {
      errors.push(`package.json omits the exact all-service ${suite} evidence gate.`);
    }
  }
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

export function inventoryEvidenceDefinitions(executionInventory, serviceManifest) {
  if (!record(executionInventory) || !Array.isArray(executionInventory.entries)) {
    throw new TypeError("Runtime V2 execution inventory is invalid.");
  }
  const managedIds = new Set(manifestEvidenceDefinitions(serviceManifest).map(({ id }) => id));
  const definitions = [];
  const seen = new Set();
  for (const entry of executionInventory.entries) {
    if (!record(entry) || typeof entry.runtime_id !== "string") continue;
    const runtimeId = entry.runtime_id;
    let disposition = null;
    if (runtimeId === "service:background-coordinator") {
      disposition = "retired-no-process";
    } else if (runtimeId.startsWith("service:")) {
      const id = runtimeId.slice("service:".length);
      if (!managedIds.has(id)) {
        throw new Error(`${runtimeId}: execution-inventory service has no managed manifest entry.`);
      }
      disposition = "live-managed-service";
    } else if (runtimeId.startsWith("schedule:")) {
      disposition = "native-schedule-owner";
    } else if (runtimeId.startsWith("external:")) {
      disposition = "external-prerequisite";
    } else {
      continue;
    }
    if (seen.has(runtimeId)) throw new Error(`${runtimeId}: duplicate execution-inventory owner.`);
    seen.add(runtimeId);
    definitions.push(Object.freeze({ runtimeId, disposition }));
  }
  for (const id of managedIds) {
    if (!seen.has(`service:${id}`)) {
      throw new Error(`service:${id}: managed manifest service is absent from execution inventory.`);
    }
  }
  return Object.freeze(definitions);
}

function validMeasurement(value) {
  return (
    record(value) &&
    typeof value.sampledAt === "number" &&
    Number.isSafeInteger(value.sampledAt) &&
    typeof value.commitTotalMb === "number" &&
    Number.isFinite(value.commitTotalMb) &&
    value.commitTotalMb >= 0 &&
    typeof value.commitLimitMb === "number" &&
    Number.isFinite(value.commitLimitMb) &&
    value.commitLimitMb >= value.commitTotalMb &&
    typeof value.freeCommitMb === "number" &&
    Number.isFinite(value.freeCommitMb) &&
    value.freeCommitMb >= 0 &&
    typeof value.privateBytes === "number" &&
    Number.isSafeInteger(value.privateBytes) &&
    value.privateBytes >= 0 &&
    typeof value.workingSetBytes === "number" &&
    Number.isSafeInteger(value.workingSetBytes) &&
    value.workingSetBytes >= 0 &&
    typeof value.processCount === "number" &&
    Number.isSafeInteger(value.processCount) &&
    value.processCount >= 0 &&
    typeof value.descendantCount === "number" &&
    Number.isSafeInteger(value.descendantCount) &&
    value.descendantCount >= 0
  );
}

export function validateServiceEvidenceReceipt(
  receipt,
  serviceManifest,
  executionInventory,
  { expectedSourceIdentity = null } = {},
) {
  const errors = [];
  const expected = manifestEvidenceDefinitions(serviceManifest);
  let mandatoryServiceIds = [];
  try {
    mandatoryServiceIds = manifestMandatoryServiceIds(serviceManifest);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Mandatory service coverage is invalid.");
  }
  if (!record(receipt) || receipt.schemaVersion !== 1 || receipt.runtimeMode !== "packaged") {
    return Object.freeze({
      ok: false,
      errors: Object.freeze(["Service evidence receipt is not packaged schema version 1."]),
    });
  }
  if (!SERVICE_EVIDENCE_SUITES.has(receipt.suite)) {
    errors.push("Service evidence receipt has an invalid all-service suite.");
  }
  if (receipt.outcome !== "PASS" && receipt.outcome !== "FAIL") {
    errors.push("Service evidence receipt outcome must be PASS or FAIL.");
  }
  try {
    expectedReceiptPath(".", receipt.runId);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Service evidence receipt has an invalid run identity.");
  }
  const startedAt = Date.parse(receipt.startedAt);
  const finishedAt = Date.parse(receipt.finishedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt) || finishedAt < startedAt) {
    errors.push("Service evidence receipt has invalid time bounds.");
  }
  if (!validArtifactIdentity(receipt.executable)) {
    errors.push("Service evidence receipt has no valid packaged executable identity.");
  }
  if (!validSourceIdentity(receipt.sourceIdentity)) {
    errors.push("Service evidence receipt has no valid current-source identity.");
  } else if (expectedSourceIdentity && !sameJson(receipt.sourceIdentity, expectedSourceIdentity)) {
    errors.push("Service evidence receipt was not produced by the current all-service implementation sources.");
  }
  if (!Array.isArray(receipt.services)) {
    return Object.freeze({
      ok: false,
      errors: Object.freeze(["Service evidence receipt has no service results."]),
    });
  }
  let expectedOwnership;
  try {
    expectedOwnership = inventoryEvidenceDefinitions(executionInventory, serviceManifest);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Execution inventory coverage is invalid.");
    expectedOwnership = [];
  }
  if (JSON.stringify(receipt.ownershipCoverage) !== JSON.stringify(expectedOwnership)) {
    errors.push(
      "Service evidence receipt does not classify every managed service, native schedule, retired owner, and external prerequisite.",
    );
  }
  const actualIds = receipt.services.map((service) => service?.serviceId);
  const expectedIds = expected.map((service) => service.id);
  if (JSON.stringify(receipt.mandatoryServiceIds) !== JSON.stringify(mandatoryServiceIds)) {
    errors.push("Service evidence receipt does not declare the exact sorted mandatory service set.");
  }
  if (!mandatoryServiceIds.includes("gbrain")) {
    errors.push("GBrain is absent from the mandatory service manifest.");
  }
  if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
    errors.push("Service evidence receipt does not cover every manifest service in order.");
  }
  for (const [index, definition] of expected.entries()) {
    const service = receipt.services[index];
    if (!record(service) || service.serviceId !== definition.id) continue;
    if (service.policy !== definition.policy) {
      errors.push(`${definition.id}: evidence policy does not match the manifest.`);
    }
    if (!SERVICE_STATES.has(service.initialState) || !SERVICE_STATES.has(service.finalState)) {
      errors.push(`${definition.id}: receipt has an invalid Runtime service state.`);
    }
    if (!Array.isArray(service.gates)) {
      errors.push(`${definition.id}: receipt has no gate results.`);
      continue;
    }
    const gateNames = service.gates.map((gate) => gate?.gate);
    if (JSON.stringify(gateNames) !== JSON.stringify(SERVICE_EVIDENCE_GATES)) {
      errors.push(`${definition.id}: receipt does not cover every mandatory gate in order.`);
      continue;
    }
    for (const gate of service.gates) {
      if (!record(gate) || (gate.status !== "pass" && gate.status !== "fail")) {
        errors.push(`${definition.id}: a gate was skipped or has an invalid disposition.`);
        continue;
      }
      if (gate.status === "pass" && !validMeasurement(gate.measurement)) {
        errors.push(`${definition.id}/${gate.gate}: passing gate has no valid Windows measurement.`);
      }
      if (gate.status === "fail" && (typeof gate.reason !== "string" || gate.reason.length === 0)) {
        errors.push(`${definition.id}/${gate.gate}: failing gate has no scoped reason.`);
      }
    }
  }
  const hasFailedGate = receipt.services.some((service) =>
    Array.isArray(service?.gates) && service.gates.some((gate) => gate?.status === "fail"),
  );
  if ((receipt.outcome === "PASS") === hasFailedGate) {
    errors.push("Service evidence receipt outcome disagrees with its gate results.");
  }
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

function readBoundedJson(file, label) {
  const stat = fs.statSync(file, { throwIfNoEntry: false });
  if (!stat?.isFile()) throw new Error(`${label} does not exist: ${file}`);
  if (stat.size < 2 || stat.size > 16 * 1024 * 1024) {
    throw new Error(`${label} has an invalid size.`);
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${label} is malformed JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function validatedReceiptBinding({
  repoRoot,
  receiptPath,
  serviceManifest,
  executionInventory,
  nowMs,
}) {
  const resolvedReceiptPath = path.resolve(receiptPath);
  const receipt = readBoundedJson(resolvedReceiptPath, "Packaged service evidence receipt");
  const currentSourceIdentity = serviceEvidenceSourceIdentity(repoRoot);
  const validation = validateServiceEvidenceReceipt(receipt, serviceManifest, executionInventory, {
    expectedSourceIdentity: currentSourceIdentity,
  });
  if (!validation.ok) {
    throw new Error(`Packaged service evidence receipt is invalid: ${validation.errors.join("; ")}`);
  }
  if (receipt.runtimeMode !== "packaged" || receipt.suite !== "burn" || receipt.outcome !== "PASS") {
    throw new Error("Packaged service evidence prerequisite must be a successful packaged burn receipt.");
  }
  const requiredIds = manifestMandatoryServiceIds(serviceManifest);
  if (
    requiredIds.length !== 32 ||
    !requiredIds.includes("gbrain") ||
    receipt.services.length !== requiredIds.length ||
    !receipt.services.some(({ serviceId }) => serviceId === "gbrain") ||
    receipt.services.some(({ gates }) =>
      !Array.isArray(gates) ||
      gates.length !== SERVICE_EVIDENCE_GATES.length ||
      gates.some(({ status }) => status !== "pass"))
  ) {
    throw new Error("Packaged service evidence prerequisite lacks complete all-32-service/GBrain PASS coverage.");
  }
  const canonicalReceiptPath = expectedReceiptPath(repoRoot, receipt.runId);
  if (!samePath(resolvedReceiptPath, canonicalReceiptPath)) {
    throw new Error("Packaged service evidence receipt escaped its immutable run directory.");
  }
  const finishedAtMs = Date.parse(receipt.finishedAt);
  if (finishedAtMs > nowMs + SERVICE_EVIDENCE_FUTURE_TOLERANCE_MS) {
    throw new Error("Packaged service evidence receipt is dated in the future.");
  }
  if (nowMs - finishedAtMs > SERVICE_EVIDENCE_MAX_AGE_MS) {
    throw new Error(
      `Packaged service evidence receipt is stale; maximum age is ${SERVICE_EVIDENCE_MAX_AGE_MS} ms.`,
    );
  }
  const executablePath = path.resolve(receipt.executable.path);
  const executableStat = fs.statSync(executablePath, { throwIfNoEntry: false });
  if (
    !executableStat?.isFile() ||
    executableStat.size !== receipt.executable.bytes ||
    sha256File(executablePath) !== receipt.executable.sha256
  ) {
    throw new Error("Packaged service evidence executable identity no longer matches the measured artifact.");
  }
  return Object.freeze({
    authority: SERVICE_EVIDENCE_AUTHORITY,
    receiptPath: resolvedReceiptPath,
    receiptSha256: sha256File(resolvedReceiptPath),
    runId: receipt.runId,
    suite: receipt.suite,
    runtimeMode: receipt.runtimeMode,
    outcome: receipt.outcome,
    startedAt: receipt.startedAt,
    finishedAt: receipt.finishedAt,
    validatedAt: new Date(nowMs).toISOString(),
    maximumAgeMs: SERVICE_EVIDENCE_MAX_AGE_MS,
    serviceCount: receipt.services.length,
    gbrainIncluded: true,
    executable: Object.freeze({ ...receipt.executable, path: executablePath }),
    sourceIdentity: Object.freeze({ ...receipt.sourceIdentity }),
  });
}

function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

export function publishLatestSuccessfulServiceEvidence({
  repoRoot,
  receiptPath,
  serviceManifest,
  executionInventory,
  nowMs = Date.now(),
}) {
  const binding = validatedReceiptBinding({
    repoRoot,
    receiptPath,
    serviceManifest,
    executionInventory,
    nowMs,
  });
  const pointerPath = serviceEvidenceLatestSuccessPath(repoRoot);
  const pointer = {
    schemaVersion: SERVICE_EVIDENCE_LATEST_SUCCESS_SCHEMA_VERSION,
    kind: LATEST_SUCCESS_KIND,
    publishedAt: new Date(nowMs).toISOString(),
    receiptPath: binding.receiptPath,
    receiptSha256: binding.receiptSha256,
    runId: binding.runId,
    finishedAt: binding.finishedAt,
    executable: binding.executable,
    sourceIdentity: binding.sourceIdentity,
  };
  atomicWriteJson(pointerPath, pointer);
  return readLatestSuccessfulServiceEvidence({
    repoRoot,
    serviceManifest,
    executionInventory,
    nowMs,
  });
}

export function readLatestSuccessfulServiceEvidence({
  repoRoot,
  serviceManifest,
  executionInventory,
  nowMs = Date.now(),
}) {
  const pointerPath = serviceEvidenceLatestSuccessPath(repoRoot);
  const pointer = readBoundedJson(pointerPath, "Canonical packaged service evidence pointer");
  if (
    pointer.schemaVersion !== SERVICE_EVIDENCE_LATEST_SUCCESS_SCHEMA_VERSION ||
    pointer.kind !== LATEST_SUCCESS_KIND ||
    typeof pointer.receiptPath !== "string" ||
    !path.isAbsolute(pointer.receiptPath) ||
    !validSha256(pointer.receiptSha256) ||
    typeof pointer.runId !== "string" ||
    !validArtifactIdentity(pointer.executable) ||
    !validSourceIdentity(pointer.sourceIdentity)
  ) {
    throw new Error("Canonical packaged service evidence pointer is malformed.");
  }
  const publishedAtMs = Date.parse(pointer.publishedAt);
  const pointerFinishedAtMs = Date.parse(pointer.finishedAt);
  if (
    !Number.isFinite(publishedAtMs) ||
    !Number.isFinite(pointerFinishedAtMs) ||
    publishedAtMs < pointerFinishedAtMs ||
    publishedAtMs > nowMs + SERVICE_EVIDENCE_FUTURE_TOLERANCE_MS
  ) {
    throw new Error("Canonical packaged service evidence pointer has invalid time bounds.");
  }
  const binding = validatedReceiptBinding({
    repoRoot,
    receiptPath: pointer.receiptPath,
    serviceManifest,
    executionInventory,
    nowMs,
  });
  if (
    pointer.receiptSha256 !== binding.receiptSha256 ||
    pointer.runId !== binding.runId ||
    pointer.finishedAt !== binding.finishedAt ||
    !sameJson(pointer.executable, binding.executable) ||
    !sameJson(pointer.sourceIdentity, binding.sourceIdentity)
  ) {
    throw new Error("Canonical packaged service evidence pointer does not match its immutable receipt.");
  }
  return Object.freeze({
    ...binding,
    pointerPath,
    pointerSha256: sha256File(pointerPath),
  });
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
