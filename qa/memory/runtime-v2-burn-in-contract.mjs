import fs from "node:fs";
import { fileURLToPath } from "node:url";

import {
  SERVICE_EVIDENCE_AUTHORITY,
  SERVICE_EVIDENCE_FUTURE_TOLERANCE_MS,
  SERVICE_EVIDENCE_MAX_AGE_MS,
  manifestEagerRequiredServiceIds,
  manifestMandatoryServiceIds,
  readJson,
} from "./service-evidence-contract.mjs";

const serviceManifest = readJson(fileURLToPath(new URL(
  "../../desktop/runtime-v2/manifests/services.json",
  import.meta.url,
)));
const mandatoryServiceIds = manifestMandatoryServiceIds(serviceManifest);
const eagerRequiredServiceIds = manifestEagerRequiredServiceIds(serviceManifest);
const observedServiceIds = Object.freeze(["chatmock", "dashboard", "gbrain", "quartz"].sort());
for (const serviceId of observedServiceIds) {
  if (!mandatoryServiceIds.includes(serviceId)) {
    throw new Error(`Runtime V2 burn-in observed service ${serviceId} is not mandatory.`);
  }
}
if (!mandatoryServiceIds.includes("gbrain")) {
  throw new Error("Runtime V2 mandatory service manifest omits GBrain.");
}

export const RUNTIME_V2_BURN_IN = Object.freeze({
  schemaVersion: 1,
  workloadProject: "runtime-v2-burn-in",
  requiredDurationMs: 6 * 60 * 60_000,
  sequentialRepetitions: 10,
  mixedCycles: 5,
  ordinaryFreeCommitFloorMb: 8_192,
  priorDangerStateMb: 2_900,
  sequentialGrowthFloorMb: 512,
  mixedGrowthFloorMb: 768,
  growthPercent: 0.10,
  postMixedSampleMs: 5 * 60_000,
  defaultSettleWindowMs: 30_000,
  sampleGapOverheadMs: 20_000,
  mandatoryServiceIds,
  eagerRequiredServiceIds,
  observedServiceIds,
  manifestWideEvidenceAuthority: "runtime-v2-services-receipt",
});

export const RUNTIME_V2_OPERATION_DEFINITIONS = Object.freeze({
  learn: Object.freeze({
    jobType: "learn",
    workerKind: "learn-node",
    capabilityId: "workflow:learn",
  }),
  ingestion: Object.freeze({
    jobType: "document-ingestion",
    workerKind: "document-ingestion-node",
    capabilityId: "tool-family:ingestion",
  }),
  artifact: Object.freeze({
    jobType: "office-artifact",
    workerKind: "office-artifact-node",
    capabilityId: "registry:artifact-renderers",
  }),
});

export function resolveRuntimeV2BurnInSettleWindowMs(raw) {
  if (raw === undefined || raw === "") return RUNTIME_V2_BURN_IN.defaultSettleWindowMs;
  if (typeof raw !== "string" || !/^\d+$/u.test(raw)) {
    throw new Error("BREADBOARD_RUNTIME_V2_BURN_IN_SETTLE_WINDOW_MS must be a whole number.");
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1_000 || value > 30 * 60_000) {
    throw new Error(
      "BREADBOARD_RUNTIME_V2_BURN_IN_SETTLE_WINDOW_MS must be between 1000 and 1800000.",
    );
  }
  return value;
}

const TERMINAL_STATES = new Set([
  "cancelled",
  "succeeded",
  "failed",
  "resource_exhausted",
  "interrupted",
  "uncertain",
]);
const NON_PASSING_DISPOSITIONS = new Set(["BLOCKED", "NOT_RUN", "SKIPPED"]);

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function own(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function finiteNonNegative(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validIsoDate(value) {
  return nonEmptyString(value) && Number.isFinite(Date.parse(value));
}

function validateDisposition(value, label, errors) {
  if (value !== "PASS") {
    const detail = NON_PASSING_DISPOSITIONS.has(value) ? ` (${value})` : "";
    errors.push(`${label} is not passing${detail}.`);
  }
}

function validatePidList(value, label, errors) {
  if (!Array.isArray(value) || value.some((pid) => !positiveInteger(pid))) {
    errors.push(`${label} must be an array of positive process IDs.`);
    return [];
  }
  if (new Set(value).size !== value.length) {
    errors.push(`${label} contains duplicate process IDs.`);
  }
  return value;
}

function validateStringList(value, label, errors) {
  if (!Array.isArray(value) || value.some((item) => !nonEmptyString(item))) {
    errors.push(`${label} must be an array of non-empty strings.`);
    return [];
  }
  if (new Set(value).size !== value.length) errors.push(`${label} contains duplicates.`);
  return value;
}

function sameStringList(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function validatePeakPrivateMb(value, label, errors) {
  if (!record(value)) {
    errors.push(`${label}.peakPrivateMb is missing.`);
    return;
  }
  for (const owner of ["worker", "dashboard", "renderer", "services"]) {
    if (!finiteNonNegative(value[owner])) {
      errors.push(`${label}.peakPrivateMb.${owner} must be a measured non-negative number.`);
    }
  }
}

function validateOrdinaryFreeCommit(value, label, errors) {
  if (
    !finiteNonNegative(value) ||
    value <= RUNTIME_V2_BURN_IN.ordinaryFreeCommitFloorMb
  ) {
    errors.push(
      `${label} must stay above ${RUNTIME_V2_BURN_IN.ordinaryFreeCommitFloorMb} MB.`,
    );
  }
}

function validateOperation(operation, kind, label, errors) {
  const definition = RUNTIME_V2_OPERATION_DEFINITIONS[kind];
  if (!record(operation)) {
    errors.push(`${label} is missing.`);
    return null;
  }
  validateDisposition(operation.classification, label, errors);
  for (const key of ["operationId", "jobId", "workerInstanceId"]) {
    if (!nonEmptyString(operation[key])) errors.push(`${label}.${key} is missing.`);
  }
  if (operation.kind !== kind) errors.push(`${label}.kind must be ${kind}.`);
  if (operation.jobType !== definition.jobType) {
    errors.push(`${label}.jobType must be ${definition.jobType}.`);
  }
  if (operation.workerKind !== definition.workerKind) {
    errors.push(`${label}.workerKind must be ${definition.workerKind}.`);
  }
  if (operation.capabilityId !== definition.capabilityId) {
    errors.push(`${label}.capabilityId must be ${definition.capabilityId}.`);
  }
  if (!positiveInteger(operation.rootWorkerPid)) {
    errors.push(`${label}.rootWorkerPid must be a positive process ID.`);
  }
  const descendants = validatePidList(operation.descendantPids, `${label}.descendantPids`, errors);
  if (descendants.includes(operation.rootWorkerPid)) {
    errors.push(`${label}.descendantPids must not repeat the root worker PID.`);
  }
  const survivors = validatePidList(
    operation.survivingDescendantPids,
    `${label}.survivingDescendantPids`,
    errors,
  );
  if (survivors.length !== 0) errors.push(`${label} left worker descendants alive.`);
  if (operation.treeExited !== true) errors.push(`${label} lacks complete-tree exit evidence.`);
  validatePeakPrivateMb(operation.peakPrivateMb, label, errors);
  validateOrdinaryFreeCommit(
    operation.minimumFreeCommitMb,
    `${label}.minimumFreeCommitMb`,
    errors,
  );
  for (const key of [
    "settledCommitMb",
    "settledOwnedPrivateMb",
    "exitLatencyMs",
  ]) {
    if (!finiteNonNegative(operation[key])) {
      errors.push(`${label}.${key} must be a measured non-negative number.`);
    }
  }
  if (!nonNegativeInteger(operation.settledOwnedProcessCount)) {
    errors.push(`${label}.settledOwnedProcessCount must be a measured process count.`);
  }
  if (!own(operation, "idleStopLatencyMs")) {
    errors.push(`${label}.idleStopLatencyMs is absent; use null only when no service was stopped.`);
  } else if (operation.idleStopLatencyMs !== null && !finiteNonNegative(operation.idleStopLatencyMs)) {
    errors.push(`${label}.idleStopLatencyMs must be null or a measured non-negative number.`);
  }
  if (operation.orphanCount !== 0) errors.push(`${label}.orphanCount must be exactly zero.`);
  const duplicateServiceIds = validateStringList(
    operation.duplicateServiceIds,
    `${label}.duplicateServiceIds`,
    errors,
  );
  if (duplicateServiceIds.length !== 0) errors.push(`${label} observed duplicate services.`);
  validateStringList(operation.serviceIds, `${label}.serviceIds`, errors);
  if (!record(operation.evidence)) {
    errors.push(`${label}.evidence is missing.`);
  } else {
    if (operation.evidence.electron !== true) errors.push(`${label} was not driven through actual Electron.`);
    if (operation.evidence.windowsSampler !== "GetPerformanceInfo") {
      errors.push(`${label} lacks GetPerformanceInfo Windows measurements.`);
    }
    if (operation.evidence.runtimeStore !== "runtime-v2-sqlite") {
      errors.push(`${label} lacks durable Runtime V2 store correlation.`);
    }
  }
  return operation;
}

function growthLimit(first, floor) {
  return first + Math.max(floor, first * RUNTIME_V2_BURN_IN.growthPercent);
}

function validateSeries(operations, kind, label, errors) {
  if (!Array.isArray(operations) || operations.length !== RUNTIME_V2_BURN_IN.sequentialRepetitions) {
    errors.push(
      `${label} must contain exactly ${RUNTIME_V2_BURN_IN.sequentialRepetitions} sequential operations.`,
    );
    return [];
  }
  const valid = operations.map((operation, index) =>
    validateOperation(operation, kind, `${label}[${index}]`, errors));
  for (const [index, operation] of valid.entries()) {
    if (!operation) continue;
    const ordinal = index + 1;
    if (operation.ordinal !== ordinal) errors.push(`${label}[${index}].ordinal is out of order.`);
    if (operation.phase !== "sequential") errors.push(`${label}[${index}].phase must be sequential.`);
    if (operation.operationId !== `sequential-${kind}-${ordinal}`) {
      errors.push(`${label}[${index}].operationId does not match its exact operation identity.`);
    }
  }
  const first = valid[0];
  const last = valid.at(-1);
  if (first && last) {
    const limit = growthLimit(first.settledOwnedPrivateMb, RUNTIME_V2_BURN_IN.sequentialGrowthFloorMb);
    if (!finiteNonNegative(last.settledOwnedPrivateMb) || last.settledOwnedPrivateMb > limit) {
      errors.push(
        `${label} cycle 10 settled owned memory exceeds cycle 1 plus max(512 MB, 10%).`,
      );
    }
    if (last.settledOwnedProcessCount > first.settledOwnedProcessCount) {
      errors.push(`${label} settled owned process count grew from cycle 1 to cycle 10.`);
    }
  }
  rejectMonotonicRise(valid, label, errors);
  return valid.filter(Boolean);
}

function rejectMonotonicRise(operations, label, errors) {
  if (operations.length < 2 || operations.some((value) => !value)) return;
  const values = operations.map((operation) => operation.settledOwnedPrivateMb);
  if (values.some((value) => !finiteNonNegative(value))) return;
  const neverDecreased = values.slice(1).every((value, index) => value >= values[index]);
  if (neverDecreased && values.at(-1) > values[0]) {
    errors.push(`${label} has a monotonic settled owned-memory rise.`);
  }
}

function validateAcceptance(acceptance, errors) {
  if (!record(acceptance)) {
    errors.push("Receipt acceptance configuration is missing.");
    return;
  }
  for (const [key, expected] of [
    ["sequentialRepetitions", RUNTIME_V2_BURN_IN.sequentialRepetitions],
    ["mixedCycles", RUNTIME_V2_BURN_IN.mixedCycles],
    ["ordinaryFreeCommitFloorMb", RUNTIME_V2_BURN_IN.ordinaryFreeCommitFloorMb],
    ["priorDangerStateMb", RUNTIME_V2_BURN_IN.priorDangerStateMb],
    ["sequentialGrowthFloorMb", RUNTIME_V2_BURN_IN.sequentialGrowthFloorMb],
    ["mixedGrowthFloorMb", RUNTIME_V2_BURN_IN.mixedGrowthFloorMb],
    ["growthPercent", RUNTIME_V2_BURN_IN.growthPercent],
    ["postMixedSampleMs", RUNTIME_V2_BURN_IN.postMixedSampleMs],
    ["defaultSettleWindowMs", RUNTIME_V2_BURN_IN.defaultSettleWindowMs],
    ["requiredDurationMs", RUNTIME_V2_BURN_IN.requiredDurationMs],
  ]) {
    if (acceptance[key] !== expected) errors.push(`acceptance.${key} must equal ${expected}.`);
  }
  for (const key of ["measurementCadenceMs", "settleWindowMs", "serviceIdleTtlMs"]) {
    if (!positiveInteger(acceptance[key])) {
      errors.push(`acceptance.${key} must be explicitly configured as a positive integer.`);
    }
  }
}

function validateStackEvidence(value, errors) {
  const label = "stackEvidence";
  if (!record(value)) {
    errors.push("Lean Rust-owned stack evidence is missing.");
    return;
  }
  validateDisposition(value.classification, label, errors);
  if (value.electron !== true) errors.push(`${label} was not actual Electron.`);
  if (value.runtimeLaunchMode !== "lean" || value.dashboardMode !== "standalone") {
    errors.push(`${label} did not use the standalone/lean dashboard stack.`);
  }
  if (value.runtimeOwner !== "rust-runtime-v2") {
    errors.push(`${label}.runtimeOwner must be rust-runtime-v2.`);
  }
  if (!positiveInteger(value.runtimePid)) errors.push(`${label}.runtimePid is missing.`);
  if (!/^breadboard-runtime(?:\.exe)?$/iu.test(value.runtimeProcessName ?? "")) {
    errors.push(`${label} did not identify the native Breadboard Runtime process.`);
  }
}

function validateServiceEvidenceBinding(value, burnStartedAt, errors) {
  const label = "serviceEvidence";
  if (!record(value)) {
    errors.push("Packaged all-service receipt binding is missing.");
    return;
  }
  const sha256 = (candidate) => typeof candidate === "string" && /^[0-9A-F]{64}$/u.test(candidate);
  const absolutePath = (candidate) =>
    typeof candidate === "string" &&
    (candidate.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(candidate));
  if (value.authority !== SERVICE_EVIDENCE_AUTHORITY) {
    errors.push(`${label}.authority must name the packaged all-service receipt.`);
  }
  for (const key of ["pointerPath", "receiptPath"]) {
    if (!absolutePath(value[key])) errors.push(`${label}.${key} must be an absolute evidence path.`);
  }
  for (const key of ["pointerSha256", "receiptSha256"]) {
    if (!sha256(value[key])) errors.push(`${label}.${key} must be an exact SHA-256 digest.`);
  }
  if (!nonEmptyString(value.runId)) errors.push(`${label}.runId is missing.`);
  if (value.suite !== "burn" || value.runtimeMode !== "packaged" || value.outcome !== "PASS") {
    errors.push(`${label} must bind a successful packaged burn receipt.`);
  }
  const serviceStartedAt = Date.parse(value.startedAt);
  const serviceFinishedAt = Date.parse(value.finishedAt);
  const validatedAt = Date.parse(value.validatedAt);
  const burnStartedAtMs = Date.parse(burnStartedAt);
  if (
    !Number.isFinite(serviceStartedAt) ||
    !Number.isFinite(serviceFinishedAt) ||
    !Number.isFinite(validatedAt) ||
    !Number.isFinite(burnStartedAtMs) ||
    serviceFinishedAt < serviceStartedAt ||
    validatedAt < serviceFinishedAt ||
    validatedAt - serviceFinishedAt > SERVICE_EVIDENCE_MAX_AGE_MS ||
    burnStartedAtMs - serviceFinishedAt > SERVICE_EVIDENCE_MAX_AGE_MS ||
    validatedAt > burnStartedAtMs + SERVICE_EVIDENCE_FUTURE_TOLERANCE_MS
  ) {
    errors.push(`${label} is stale or has invalid time bounds.`);
  }
  if (value.maximumAgeMs !== SERVICE_EVIDENCE_MAX_AGE_MS) {
    errors.push(`${label}.maximumAgeMs does not enforce the six-hour freshness window.`);
  }
  if (
    value.serviceCount !== RUNTIME_V2_BURN_IN.mandatoryServiceIds.length ||
    value.gbrainIncluded !== true
  ) {
    errors.push(`${label} does not bind all 32 mandatory services including GBrain.`);
  }
  if (
    !record(value.executable) ||
    !absolutePath(value.executable.path) ||
    !positiveInteger(value.executable.bytes) ||
    !sha256(value.executable.sha256)
  ) {
    errors.push(`${label}.executable lacks the packaged artifact path, size, or SHA-256.`);
  }
  if (
    !record(value.sourceIdentity) ||
    ![
      value.sourceIdentity?.serviceManifestSha256,
      value.sourceIdentity?.executionInventorySha256,
      value.sourceIdentity?.runnerSha256,
      value.sourceIdentity?.contractSha256,
      value.sourceIdentity?.implementationClosureSha256,
    ].every(sha256)
  ) {
    errors.push(`${label}.sourceIdentity does not bind the current all-service implementation sources.`);
  }
}

function validateServiceCoverage(value, errors) {
  const label = "serviceCoverage";
  if (!record(value)) {
    errors.push("Mandatory service coverage evidence is missing.");
    return;
  }
  validateDisposition(value.classification, label, errors);
  const mandatory = validateStringList(
    value.mandatoryServiceIds,
    `${label}.mandatoryServiceIds`,
    errors,
  );
  if (!sameStringList(mandatory, RUNTIME_V2_BURN_IN.mandatoryServiceIds)) {
    errors.push(`${label}.mandatoryServiceIds does not match the checked-in manifest.`);
  }
  const eagerRequired = validateStringList(
    value.eagerRequiredServiceIds,
    `${label}.eagerRequiredServiceIds`,
    errors,
  );
  if (!sameStringList(eagerRequired, RUNTIME_V2_BURN_IN.eagerRequiredServiceIds)) {
    errors.push(`${label}.eagerRequiredServiceIds does not match mandatory eager services.`);
  }
  const observed = validateStringList(value.observedServiceIds, `${label}.observedServiceIds`, errors);
  if (!sameStringList(observed, RUNTIME_V2_BURN_IN.observedServiceIds)) {
    errors.push(`${label}.observedServiceIds must include the burn-in core, real GBrain, and Quartz.`);
  }
  if (value.manifestWideEvidenceAuthority !== RUNTIME_V2_BURN_IN.manifestWideEvidenceAuthority) {
    errors.push(`${label}.manifestWideEvidenceAuthority must name the all-service packaged receipt.`);
  }
  const missing = validateStringList(
    value.missingObservedServiceIds,
    `${label}.missingObservedServiceIds`,
    errors,
  );
  if (missing.length !== 0) errors.push(`${label} is missing burn-in observed services.`);
  if (value.gbrainBackend !== "gbrain") errors.push(`${label} lacks real GBrain backend evidence.`);
  if (!Array.isArray(value.services) || value.services.length !== observed.length) {
    errors.push(`${label}.services must identify every burn-in observed service process.`);
    return;
  }
  const observedIds = [];
  for (const [index, service] of value.services.entries()) {
    const serviceLabel = `${label}.services[${index}]`;
    if (!record(service) || !nonEmptyString(service.serviceId)) {
      errors.push(`${serviceLabel}.serviceId is missing.`);
      continue;
    }
    observedIds.push(service.serviceId);
    const pids = validatePidList(service.observedPids, `${serviceLabel}.observedPids`, errors);
    if (pids.length === 0) errors.push(`${serviceLabel} has no observed listener owner.`);
  }
  if (!sameStringList(observedIds, observed)) {
    errors.push(`${label}.services does not exactly cover the burn-in observed service set.`);
  }
}

function boundedText(value, maximum = 500) {
  return typeof value === "string" && value.length <= maximum;
}

function validateBrowserAvailability(value, label, errors) {
  if (!record(value)) {
    errors.push("Agent Browser availability evidence is missing.");
    return;
  }
  if (value.probe !== "/api/agent-browser/agents") {
    errors.push(`${label}.probe does not identify the authenticated availability route.`);
  }
  if (!validIsoDate(value.checkedAt)) errors.push(`${label}.checkedAt is invalid.`);
  if (!Number.isSafeInteger(value.httpStatus) || value.httpStatus < 0 || value.httpStatus > 599) {
    errors.push(`${label}.httpStatus is invalid.`);
  }
  if (!finiteNonNegative(value.probeLatencyMs) || value.probeLatencyMs > 30_000) {
    errors.push(`${label}.probeLatencyMs is missing or unbounded.`);
  }
  if (typeof value.runtimeAvailable !== "boolean") {
    errors.push(`${label}.runtimeAvailable must be an observed boolean.`);
  }
  if (value.agentId !== null && !nonEmptyString(value.agentId)) {
    errors.push(`${label}.agentId must be null or a configured identity.`);
  }
  if (value.agentRuntimeState !== null && !nonEmptyString(value.agentRuntimeState)) {
    errors.push(`${label}.agentRuntimeState must be null or an observed state.`);
  }
  if (value.reasonCode !== null && !nonEmptyString(value.reasonCode)) {
    errors.push(`${label}.reasonCode must be null or exact.`);
  }
  if (!boundedText(value.detail)) errors.push(`${label}.detail is missing or exceeds its bound.`);
}

function validateBrowserAgent(value, expectedCycle, errors) {
  const label = `browserAgent[${expectedCycle - 1}]`;
  if (!record(value)) {
    errors.push(`${label} Agent Browser start/cancel disposition is missing.`);
    return;
  }
  if (value.cycle !== expectedCycle) errors.push(`${label}.cycle is out of order.`);
  validateDisposition(value.classification, label, errors);
  validateBrowserAvailability(value.availability, `${label}.availability`, errors);
  const availability = record(value.availability) ? value.availability : {};
  const blockedCodes = new Set([
    "AVAILABILITY_PROBE_FAILED",
    "AGENT_BROWSER_NOT_INSTALLED",
    "BROWSER_EXECUTABLE_NOT_FOUND",
    "AGENT_BROWSER_RUNTIME_UNAVAILABLE",
    "NO_CONFIGURED_AGENT",
    "CONFIGURED_AGENT_UNAVAILABLE",
  ]);
  if (value.classification === "BLOCKED") {
    if (!blockedCodes.has(availability.reasonCode)) {
      errors.push(`${label} BLOCKED disposition lacks an exact external prerequisite reason.`);
    }
    if (availability.httpStatus !== 200 && availability.reasonCode !== "AVAILABILITY_PROBE_FAILED") {
      errors.push(`${label} availability failure has the wrong reason code.`);
    }
    if (availability.httpStatus === 200 && availability.runtimeAvailable === false && ![
      "AGENT_BROWSER_NOT_INSTALLED",
      "BROWSER_EXECUTABLE_NOT_FOUND",
      "AGENT_BROWSER_RUNTIME_UNAVAILABLE",
    ].includes(availability.reasonCode)) {
      errors.push(`${label} unavailable runtime has the wrong reason code.`);
    }
    if (
      availability.httpStatus === 200 && availability.runtimeAvailable === true &&
      availability.agentId === null && availability.reasonCode !== "NO_CONFIGURED_AGENT"
    ) {
      errors.push(`${label} missing configured agent has the wrong reason code.`);
    }
    if (
      availability.httpStatus === 200 && availability.runtimeAvailable === true &&
      nonEmptyString(availability.agentId) && availability.agentRuntimeState !== "available" &&
      availability.reasonCode !== "CONFIGURED_AGENT_UNAVAILABLE"
    ) {
      errors.push(`${label} unavailable configured agent has the wrong reason code.`);
    }
    if (
      availability.httpStatus === 200 && availability.runtimeAvailable === true &&
      nonEmptyString(availability.agentId) && availability.agentRuntimeState === "available"
    ) {
      errors.push(`${label} cannot be BLOCKED when the configured runtime is available.`);
    }
    if (value.actualElectronUi !== false || value.treeExited !== false) {
      errors.push(`${label} BLOCKED disposition masquerades as executed UI cleanup.`);
    }
    for (const key of ["jobId", "workerInstanceId", "rootWorkerPid", "peakTreePrivateMb",
      "minimumFreeCommitMb", "settledCommitMb", "settledOwnedPrivateMb",
      "settledOwnedProcessCount", "orphanCount", "reclaimLatencyMs"]) {
      if (value[key] !== null) errors.push(`${label}.${key} must be null when no run was executed.`);
    }
    for (const key of ["browserPids", "descendantPids", "survivingDescendantPids", "duplicateServiceIds"]) {
      const items = key === "duplicateServiceIds"
        ? validateStringList(value[key], `${label}.${key}`, errors)
        : validatePidList(value[key], `${label}.${key}`, errors);
      if (items.length !== 0) errors.push(`${label}.${key} must be empty when blocked.`);
    }
    return;
  }
  if (value.classification !== "PASS") return;
  if (
    availability.httpStatus !== 200 ||
    availability.runtimeAvailable !== true ||
    availability.reasonCode !== null ||
    !nonEmptyString(availability.agentId) ||
    availability.agentRuntimeState !== "available"
  ) {
    errors.push(`${label} PASS lacks an available configured Agent Browser runtime.`);
  }
  if (value.actualElectronUi !== true) errors.push(`${label} did not start/cancel through the Electron UI.`);
  for (const key of ["jobId", "workerInstanceId"]) {
    if (!nonEmptyString(value[key])) errors.push(`${label}.${key} is missing.`);
  }
  if (!positiveInteger(value.rootWorkerPid)) errors.push(`${label}.rootWorkerPid is missing.`);
  const browserPids = validatePidList(value.browserPids, `${label}.browserPids`, errors);
  const descendants = validatePidList(value.descendantPids, `${label}.descendantPids`, errors);
  if (browserPids.length === 0) errors.push(`${label} did not observe a Chromium process.`);
  if (browserPids.some((pid) => !descendants.includes(pid))) {
    errors.push(`${label} Chromium identity is outside the Runtime-owned descendant tree.`);
  }
  const survivors = validatePidList(
    value.survivingDescendantPids,
    `${label}.survivingDescendantPids`,
    errors,
  );
  if (survivors.length !== 0 || value.treeExited !== true) {
    errors.push(`${label} did not reclaim the complete Chromium process tree.`);
  }
  for (const key of ["peakTreePrivateMb", "settledCommitMb", "settledOwnedPrivateMb", "reclaimLatencyMs"]) {
    if (!finiteNonNegative(value[key])) errors.push(`${label}.${key} is not measured.`);
  }
  if (!nonNegativeInteger(value.settledOwnedProcessCount)) {
    errors.push(`${label}.settledOwnedProcessCount is not measured.`);
  }
  validateOrdinaryFreeCommit(value.minimumFreeCommitMb, `${label}.minimumFreeCommitMb`, errors);
  if (value.orphanCount !== 0) errors.push(`${label}.orphanCount must be exactly zero.`);
  const duplicates = validateStringList(value.duplicateServiceIds, `${label}.duplicateServiceIds`, errors);
  if (duplicates.length !== 0) errors.push(`${label} observed duplicate services.`);
}

function validatePostizRouteProbe(value, label, errors) {
  if (!record(value)) {
    errors.push("Postiz authenticated route availability evidence is missing.");
    return;
  }
  if (value.probe !== "/api/socials-manager/stack?probe=docker") {
    errors.push(`${label}.probe does not identify the bounded Docker diagnostic route.`);
  }
  if (!validIsoDate(value.checkedAt)) errors.push(`${label}.checkedAt is invalid.`);
  if (!Number.isSafeInteger(value.httpStatus) || value.httpStatus < 0 || value.httpStatus > 599) {
    errors.push(`${label}.httpStatus is invalid.`);
  }
  if (!finiteNonNegative(value.probeLatencyMs) || value.probeLatencyMs > 30_000) {
    errors.push(`${label}.probeLatencyMs is missing or unbounded.`);
  }
  if (!nonEmptyString(value.mode) || !nonEmptyString(value.state) || typeof value.reachable !== "boolean") {
    errors.push(`${label} lacks exact mode/state/reachability.`);
  }
  if (!boundedText(value.reason)) errors.push(`${label}.reason is missing or exceeds its bound.`);
}

function validateContainerEngineProbe(value, label, requireAvailable, errors) {
  if (!record(value)) {
    errors.push(`${label} is missing.`);
    return;
  }
  if (
    !validIsoDate(value.checkedAt) ||
    value.timeoutMs !== 15_000 ||
    value.attemptLimit !== 8 ||
    value.totalTimeoutMs !== 120_000 ||
    !finiteNonNegative(value.probeDurationMs) ||
    value.probeDurationMs > value.totalTimeoutMs + 5_000
  ) {
    errors.push(`${label} lacks exact per-command/total probe bounds.`);
  }
  if (!Array.isArray(value.attempts) || value.attempts.length < 1 || value.attempts.length > 8) {
    errors.push(`${label}.attempts must contain bounded CLI/Compose evidence.`);
  } else {
    for (const [index, attempt] of value.attempts.entries()) {
      const attemptLabel = `${label}.attempts[${index}]`;
      if (!record(attempt) || !["docker", "podman"].includes(attempt.engine)) {
        errors.push(`${attemptLabel}.engine is invalid.`);
        continue;
      }
      if (!nonEmptyString(attempt.executable) || /[\\/]/u.test(attempt.executable)) {
        errors.push(`${attemptLabel}.executable must be a basename.`);
      }
      if (attempt.code !== null && !Number.isSafeInteger(attempt.code)) {
        errors.push(`${attemptLabel}.code is invalid.`);
      }
      if (!finiteNonNegative(attempt.durationMs) || attempt.durationMs > 30_000) {
        errors.push(`${attemptLabel}.durationMs is missing or unbounded.`);
      }
      if (typeof attempt.timedOut !== "boolean") errors.push(`${attemptLabel}.timedOut is missing.`);
      if (attempt.errorCode !== null && !nonEmptyString(attempt.errorCode)) {
        errors.push(`${attemptLabel}.errorCode is invalid.`);
      }
      if (!boundedText(attempt.detail)) errors.push(`${attemptLabel}.detail exceeds its bound.`);
    }
  }
  if (requireAvailable) {
    if (value.reasonCode !== null || !["docker", "podman"].includes(value.engine)) {
      errors.push(`${label} does not prove an available Compose-capable engine.`);
    }
    if (typeof value.daemonRunningAtBaseline !== "boolean") {
      errors.push(`${label}.daemonRunningAtBaseline is missing.`);
    }
    if (!finiteNonNegative(value.daemonProbeDurationMs) || value.daemonProbeDurationMs > 30_000) {
      errors.push(`${label}.daemonProbeDurationMs is missing or unbounded.`);
    }
    if (value.daemonProbeErrorCode !== null && !nonEmptyString(value.daemonProbeErrorCode)) {
      errors.push(`${label}.daemonProbeErrorCode is invalid.`);
    }
    if (!boundedText(value.daemonProbeDetail)) errors.push(`${label}.daemonProbeDetail exceeds its bound.`);
  } else if (!nonEmptyString(value.reasonCode)) {
    errors.push(`${label}.reasonCode is missing for an unavailable engine.`);
  }
}

function validatePostizActivation(value, label, errors) {
  if (!record(value)) {
    errors.push(`${label} is missing.`);
    return;
  }
  if (!Number.isSafeInteger(value.httpStatus) || value.httpStatus < 0 || value.httpStatus > 599) {
    errors.push(`${label}.httpStatus is invalid.`);
  }
  if (
    !finiteNonNegative(value.actionLatencyMs) ||
    value.actionLatencyMs > 185_000 ||
    value.actionTimeoutMs !== 180_000 ||
    value.readyPollTimeoutMs !== 600_000
  ) {
    errors.push(`${label} lacks exact bounded action/poll timing evidence.`);
  }
  if (typeof value.ready !== "boolean" || !nonEmptyString(value.state) || !nonEmptyString(value.ownership)) {
    errors.push(`${label} lacks ready/state/ownership evidence.`);
  }
  if (!boundedText(value.reason)) errors.push(`${label}.reason is missing or exceeds its bound.`);
}

function validatePostizActivationCleanup(value, label, errors) {
  if (!record(value)) {
    errors.push(`${label} is missing.`);
    return;
  }
  if (
    value.httpStatus !== 200 ||
    !finiteNonNegative(value.actionLatencyMs) ||
    value.actionLatencyMs > 185_000 ||
    value.actionTimeoutMs !== 180_000 ||
    value.stopped !== true ||
    !boundedText(value.reason)
  ) {
    errors.push(`${label} lacks an exact bounded Runtime stop receipt.`);
  }
}

function validatePostiz(value, expectedCycle, errors) {
  const label = `postiz[${expectedCycle - 1}]`;
  if (!record(value)) {
    errors.push(`${label} Postiz activation/idle-stop disposition is missing.`);
    return;
  }
  if (value.cycle !== expectedCycle) errors.push(`${label}.cycle is out of order.`);
  validateDisposition(value.classification, label, errors);
  validatePostizRouteProbe(value.routeProbe, `${label}.routeProbe`, errors);
  const routeProbe = record(value.routeProbe) ? value.routeProbe : {};
  const blockedCodes = new Set([
    "AVAILABILITY_PROBE_FAILED",
    "POSTIZ_STACK_DISABLED",
    "CONTAINER_COMPOSE_UNAVAILABLE",
    "CONTAINER_ENGINE_NOT_INSTALLED",
    "POSTIZ_ACTIVATION_UNAVAILABLE",
    "PREEXISTING_STACK_OWNERSHIP",
    "POSTIZ_OWNERSHIP_UNAVAILABLE",
  ]);
  if (value.classification === "BLOCKED") {
    if (!blockedCodes.has(value.reasonCode)) {
      errors.push(`${label} BLOCKED disposition lacks an exact prerequisite reason code.`);
      return;
    }
    const early = ["AVAILABILITY_PROBE_FAILED", "POSTIZ_STACK_DISABLED"].includes(value.reasonCode);
    const engineUnavailable = ["CONTAINER_COMPOSE_UNAVAILABLE", "CONTAINER_ENGINE_NOT_INSTALLED"]
      .includes(value.reasonCode);
    if (early) {
      if (
        (value.reasonCode === "AVAILABILITY_PROBE_FAILED" && routeProbe.httpStatus === 200) ||
        (value.reasonCode === "POSTIZ_STACK_DISABLED" &&
          (routeProbe.httpStatus !== 200 || routeProbe.mode === "stack"))
      ) {
        errors.push(`${label} early BLOCKED reason does not match its route probe.`);
      }
      if (value.engineProbe !== null || value.activation !== null || value.actualRuntimeActivation !== false) {
        errors.push(`${label} early BLOCKED disposition contains invented activation evidence.`);
      }
    } else if (engineUnavailable) {
      validateContainerEngineProbe(value.engineProbe, `${label}.engineProbe`, false, errors);
      if (value.engineProbe?.reasonCode !== value.reasonCode) {
        errors.push(`${label}.reasonCode does not match its engine probe.`);
      }
      if (value.activation !== null || value.actualRuntimeActivation !== false) {
        errors.push(`${label} engine-unavailable disposition masquerades as Runtime activation.`);
      }
    } else {
      validateContainerEngineProbe(value.engineProbe, `${label}.engineProbe`, true, errors);
      validatePostizActivation(value.activation, `${label}.activation`, errors);
      if (value.actualRuntimeActivation !== true) {
        errors.push(`${label} lacks the actual Runtime activation attempt.`);
      }
      if (value.reasonCode === "POSTIZ_ACTIVATION_UNAVAILABLE") {
        if (value.activation?.ready !== false || !nonEmptyString(value.activation?.reason)) {
          errors.push(`${label} unavailable activation lacks an exact bounded failure reason.`);
        }
      } else {
        if (value.activation?.ready !== true || value.activation?.state !== "ready") {
          errors.push(`${label} ownership block lacks a ready stack receipt.`);
        }
        if (value.reasonCode === "PREEXISTING_STACK_OWNERSHIP" && value.ownership !== "pre-existing") {
          errors.push(`${label} pre-existing ownership disposition is inconsistent.`);
        }
        if (value.ownership === "breadboard") {
          errors.push(`${label} ownership block cannot claim Breadboard ownership.`);
        }
        const containers = validateStringList(value.containersActive, `${label}.containersActive`, errors);
        const volumes = validateStringList(value.volumesActive, `${label}.volumesActive`, errors);
        if (containers.length === 0 || volumes.length === 0) {
          errors.push(`${label} ownership block lacks exact active container/volume identities.`);
        }
        if (!sameStringList(value.containersAfter, containers) || !sameStringList(value.volumesAfter, volumes)) {
          errors.push(`${label} ownership block changed external container/volume identities.`);
        }
        const volumesBefore = value.volumesBefore === null
          ? null
          : validateStringList(value.volumesBefore, `${label}.volumesBefore`, errors);
        if (volumesBefore && volumesBefore.some((identity) => !volumes.includes(identity))) {
          errors.push(`${label} ownership block lost a pre-existing volume identity.`);
        }
        if (!positiveInteger(value.servicePid) || !positiveInteger(value.configuredStackIdleTtlMs) ||
            !finiteNonNegative(value.privateMbBefore)) {
          errors.push(`${label} ownership block lacks exact coordinator process/TTL/memory evidence.`);
        }
        const survivors = validatePidList(
          value.survivingCoordinatorPids,
          `${label}.survivingCoordinatorPids`,
          errors,
        );
        const descendants = validatePidList(
          value.coordinatorDescendantPids,
          `${label}.coordinatorDescendantPids`,
          errors,
        );
        if (
          survivors.length === 0 ||
          !survivors.includes(value.servicePid) ||
          descendants.some((pid) => !survivors.includes(pid)) ||
          value.treeExited !== false
        ) {
          errors.push(`${label} ownership block does not truthfully record the preserved live coordinator tree.`);
        }
      }
    }
    if (early || engineUnavailable) {
      if (value.activationCleanup !== null) {
        errors.push(`${label}.activationCleanup must be null before Runtime activation.`);
      }
      for (const key of ["servicePid", "ownership", "configuredStackIdleTtlMs", "idleStopLatencyMs",
        "privateMbBefore", "privateMbAfter", "minimumFreeCommitMb", "settledCommitMb", "orphanCount"]) {
        if (value[key] !== null) errors.push(`${label}.${key} must be null before Runtime activation.`);
      }
      if (value.volumesBefore !== null) errors.push(`${label}.volumesBefore must be null before engine access.`);
      for (const key of ["containersActive", "containersAfter", "volumesActive", "volumesAfter",
        "coordinatorDescendantPids", "survivingCoordinatorPids", "duplicateServiceIds"]) {
        const values = ["coordinatorDescendantPids", "survivingCoordinatorPids"].includes(key)
          ? validatePidList(value[key], `${label}.${key}`, errors)
          : validateStringList(value[key], `${label}.${key}`, errors);
        if (values.length !== 0) errors.push(`${label}.${key} must be empty before Runtime activation.`);
      }
      if (value.treeExited !== false) errors.push(`${label}.treeExited must remain false when no tree ran.`);
    } else if (value.reasonCode === "POSTIZ_ACTIVATION_UNAVAILABLE") {
      if (value.servicePid !== null && !positiveInteger(value.servicePid)) {
        errors.push(`${label}.servicePid is invalid.`);
      }
      if (value.ownership !== "unknown" && value.ownership !== "pre-existing" &&
          value.ownership !== "breadboard") {
        errors.push(`${label}.ownership is invalid.`);
      }
      if (value.configuredStackIdleTtlMs !== null && !positiveInteger(value.configuredStackIdleTtlMs)) {
        errors.push(`${label}.configuredStackIdleTtlMs is invalid.`);
      }
      const volumesBefore = value.volumesBefore === null
        ? null
        : validateStringList(value.volumesBefore, `${label}.volumesBefore`, errors);
      const containersActive = validateStringList(
        value.containersActive,
        `${label}.containersActive`,
        errors,
      );
      const containersAfter = validateStringList(
        value.containersAfter,
        `${label}.containersAfter`,
        errors,
      );
      const volumesActive = validateStringList(value.volumesActive, `${label}.volumesActive`, errors);
      const volumesAfter = validateStringList(value.volumesAfter, `${label}.volumesAfter`, errors);
      const survivors = validatePidList(
        value.survivingCoordinatorPids,
        `${label}.survivingCoordinatorPids`,
        errors,
      );
      validatePidList(value.coordinatorDescendantPids, `${label}.coordinatorDescendantPids`, errors);
      if ((survivors.length === 0) !== (value.treeExited === true)) {
        errors.push(`${label}.treeExited does not match its unavailable coordinator tree.`);
      }
      if (value.ownership === "breadboard") {
        validatePostizActivationCleanup(
          value.activationCleanup,
          `${label}.activationCleanup`,
          errors,
        );
        if (containersAfter.length !== 0 || survivors.length !== 0 || value.treeExited !== true) {
          errors.push(`${label} left Breadboard-owned partial activation resources alive.`);
        }
        if (!sameStringList(volumesAfter, volumesActive)) {
          errors.push(`${label} partial-activation cleanup changed Docker volume identities.`);
        }
        if (volumesBefore && volumesBefore.some((identity) => !volumesAfter.includes(identity))) {
          errors.push(`${label} partial-activation cleanup lost a pre-existing Docker volume identity.`);
        }
        if (value.orphanCount !== 0) {
          errors.push(`${label} partial-activation cleanup left an owned orphan.`);
        }
      } else {
        if (value.activationCleanup !== null) {
          errors.push(`${label} must not stop a partial activation it does not own.`);
        }
        if (!sameStringList(containersAfter, containersActive) ||
            !sameStringList(volumesAfter, volumesActive)) {
          errors.push(`${label} changed partial activation resources without Breadboard ownership.`);
        }
      }
      validateOrdinaryFreeCommit(value.minimumFreeCommitMb, `${label}.minimumFreeCommitMb`, errors);
      if (!finiteNonNegative(value.settledCommitMb) || !nonNegativeInteger(value.orphanCount)) {
        errors.push(`${label} unavailable activation lacks settled process/memory evidence.`);
      }
      const duplicates = validateStringList(value.duplicateServiceIds, `${label}.duplicateServiceIds`, errors);
      if (duplicates.length !== 0) errors.push(`${label} unavailable activation observed duplicate services.`);
    } else {
      if (value.activationCleanup !== null) {
        errors.push(`${label} must not stop a pre-existing or externally owned stack.`);
      }
      validateOrdinaryFreeCommit(value.minimumFreeCommitMb, `${label}.minimumFreeCommitMb`, errors);
      if (!finiteNonNegative(value.settledCommitMb) || !nonNegativeInteger(value.orphanCount)) {
        errors.push(`${label} ownership block lacks settled process/memory evidence.`);
      }
      const duplicates = validateStringList(value.duplicateServiceIds, `${label}.duplicateServiceIds`, errors);
      if (duplicates.length !== 0) errors.push(`${label} ownership block observed duplicate services.`);
      if (value.idleStopLatencyMs !== null || value.privateMbAfter !== null) {
        errors.push(`${label} ownership block invents an idle-stop result.`);
      }
    }
    if (!positiveInteger(value.configuredServiceIdleTtlMs)) {
      errors.push(`${label}.configuredServiceIdleTtlMs is missing.`);
    }
    return;
  }
  if (value.classification !== "PASS") return;
  if (value.activationCleanup !== null) {
    errors.push(`${label}.activationCleanup must be null for ordinary idle-stop PASS evidence.`);
  }
  if (value.reasonCode !== null) errors.push(`${label}.reasonCode must be null for PASS.`);
  if (routeProbe.httpStatus !== 200 || routeProbe.mode !== "stack") {
    errors.push(`${label} PASS lacks the authenticated stack-mode availability probe.`);
  }
  validateContainerEngineProbe(value.engineProbe, `${label}.engineProbe`, true, errors);
  validatePostizActivation(value.activation, `${label}.activation`, errors);
  if (
    value.actualRuntimeActivation !== true ||
    value.activation?.httpStatus !== 200 ||
    value.activation?.ready !== true ||
    value.activation?.state !== "ready" ||
    value.activation?.ownership !== "breadboard" ||
    value.ownership !== "breadboard"
  ) {
    errors.push(`${label} PASS lacks an exact Breadboard-owned Runtime activation receipt.`);
  }
  if (value.serviceId !== "postiz-coordinator" || !positiveInteger(value.servicePid)) {
    errors.push(`${label} lacks exact Runtime coordinator identity.`);
  }
  for (const key of ["configuredStackIdleTtlMs", "configuredServiceIdleTtlMs"]) {
    if (!positiveInteger(value[key])) errors.push(`${label}.${key} is missing.`);
  }
  if (!finiteNonNegative(value.idleStopLatencyMs)) errors.push(`${label}.idleStopLatencyMs is not measured.`);
  if (!finiteNonNegative(value.privateMbBefore) || !finiteNonNegative(value.privateMbAfter)) {
    errors.push(`${label} lacks coordinator before/after private-memory evidence.`);
  } else if (value.privateMbAfter >= value.privateMbBefore) {
    errors.push(`${label} did not return coordinator private memory.`);
  }
  const containers = validateStringList(value.containersActive, `${label}.containersActive`, errors);
  if (containers.length === 0) errors.push(`${label} lacks exact active container identities.`);
  const containersAfter = validateStringList(value.containersAfter, `${label}.containersAfter`, errors);
  if (containersAfter.length !== 0) errors.push(`${label} left Postiz containers running.`);
  const volumesBefore = value.volumesBefore === null
    ? null
    : validateStringList(value.volumesBefore, `${label}.volumesBefore`, errors);
  const volumesActive = validateStringList(value.volumesActive, `${label}.volumesActive`, errors);
  const volumesAfter = validateStringList(value.volumesAfter, `${label}.volumesAfter`, errors);
  if (volumesActive.length === 0 || !sameStringList(volumesAfter, volumesActive)) {
    errors.push(`${label} did not preserve exact Docker volume identities.`);
  }
  if (volumesBefore && volumesBefore.some((identity) => !volumesAfter.includes(identity))) {
    errors.push(`${label} removed a pre-existing Docker volume identity.`);
  }
  const survivors = validatePidList(
    value.survivingCoordinatorPids,
    `${label}.survivingCoordinatorPids`,
    errors,
  );
  validatePidList(value.coordinatorDescendantPids, `${label}.coordinatorDescendantPids`, errors);
  if (survivors.length !== 0 || value.treeExited !== true) {
    errors.push(`${label} left the Runtime coordinator process tree alive.`);
  }
  validateOrdinaryFreeCommit(value.minimumFreeCommitMb, `${label}.minimumFreeCommitMb`, errors);
  if (!finiteNonNegative(value.settledCommitMb)) errors.push(`${label}.settledCommitMb is not measured.`);
  if (value.orphanCount !== 0) errors.push(`${label}.orphanCount must be exactly zero.`);
  const duplicates = validateStringList(value.duplicateServiceIds, `${label}.duplicateServiceIds`, errors);
  if (duplicates.length !== 0) errors.push(`${label} observed duplicate services.`);
}

function validateEndurance(value, acceptance, startedAt, errors) {
  const label = "endurance";
  if (!record(value)) {
    errors.push("Six-hour endurance evidence is missing.");
    return;
  }
  validateDisposition(value.classification, label, errors);
  if (value.requiredDurationMs !== RUNTIME_V2_BURN_IN.requiredDurationMs) {
    errors.push(`${label}.requiredDurationMs must be exactly 21600000.`);
  }
  if (!finiteNonNegative(value.durationMs) || value.durationMs < RUNTIME_V2_BURN_IN.requiredDurationMs) {
    errors.push(`${label}.durationMs must cover at least 21600000 ms.`);
  }
  if (!finiteNonNegative(value.settleDurationMs) || value.settleDurationMs < acceptance?.settleWindowMs) {
    errors.push(`${label}.settleDurationMs does not cover the configured settle window.`);
  }
  if (!positiveInteger(value.sampleCount) || value.sampleCount < 2) {
    errors.push(`${label}.sampleCount must contain repeated measurements.`);
  }
  if (!positiveInteger(value.firstSampleAt) || !positiveInteger(value.lastSampleAt)) {
    errors.push(`${label} lacks exact first/last sample timestamps.`);
  } else if (validIsoDate(startedAt)) {
    if (value.firstSampleAt - Date.parse(startedAt) !== value.initialSampleDelayMs) {
      errors.push(`${label}.initialSampleDelayMs does not match its timestamps.`);
    }
    if (value.lastSampleAt - Date.parse(startedAt) !== value.durationMs) {
      errors.push(`${label}.durationMs does not match its timestamps.`);
    }
  }
  const allowedGap = (acceptance?.measurementCadenceMs ?? 0) + RUNTIME_V2_BURN_IN.sampleGapOverheadMs;
  if (value.allowedSampleGapMs !== allowedGap) {
    errors.push(`${label}.allowedSampleGapMs does not match the bounded sampler allowance.`);
  }
  if (!finiteNonNegative(value.initialSampleDelayMs) || value.initialSampleDelayMs > allowedGap) {
    errors.push(`${label}.initialSampleDelayMs exceeds the configured cadence allowance.`);
  }
  if (!finiteNonNegative(value.maximumSampleGapMs) || value.maximumSampleGapMs > allowedGap) {
    errors.push(`${label}.maximumSampleGapMs exceeds the configured cadence allowance.`);
  }
  if (
    positiveInteger(value.sampleCount) &&
    finiteNonNegative(value.durationMs) &&
    finiteNonNegative(value.initialSampleDelayMs) &&
    allowedGap > 0
  ) {
    const sampledSpanMs = Math.max(0, value.durationMs - value.initialSampleDelayMs);
    const minimumSampleCount = Math.ceil(sampledSpanMs / allowedGap) + 1;
    if (value.sampleCount < minimumSampleCount) {
      errors.push(
        `${label}.sampleCount cannot cover its duration at the declared maximum cadence gap.`,
      );
    }
    if (value.sampleCount > 1 && finiteNonNegative(value.maximumSampleGapMs)) {
      const unavoidableMaximumGapMs = sampledSpanMs / (value.sampleCount - 1);
      if (value.maximumSampleGapMs + Number.EPSILON < unavoidableMaximumGapMs) {
        errors.push(
          `${label}.maximumSampleGapMs is inconsistent with its sample count and duration.`,
        );
      }
    }
  }
  validateOrdinaryFreeCommit(value.minimumFreeCommitMb, `${label}.minimumFreeCommitMb`, errors);
  for (const key of ["peakCommitTotalMb", "settledCommitMb", "settledOwnedPrivateMb"]) {
    if (!finiteNonNegative(value[key])) errors.push(`${label}.${key} is not measured.`);
  }
  if (!nonNegativeInteger(value.settledOwnedProcessCount)) {
    errors.push(`${label}.settledOwnedProcessCount is not measured.`);
  }
  if (value.orphanCount !== 0) errors.push(`${label}.orphanCount must be exactly zero.`);
  const duplicates = validateStringList(value.duplicateServiceIds, `${label}.duplicateServiceIds`, errors);
  if (duplicates.length !== 0) errors.push(`${label} observed duplicate services.`);
}

function validateAdmissionDenial(value, errors) {
  const label = "admissionDenial";
  if (!record(value)) {
    errors.push("Reserve-unavailable admission evidence is missing.");
    return;
  }
  validateDisposition(value.classification, label, errors);
  if (value.reserveUnavailableObserved !== true) errors.push(`${label} did not observe unavailable reserve.`);
  if (value.heavyweightSubmissionAttempted !== true) errors.push(`${label} did not attempt heavyweight admission.`);
  if (value.jobState !== "resource_exhausted") errors.push(`${label}.jobState must be resource_exhausted.`);
  if (!nonEmptyString(value.jobId) || !nonEmptyString(value.failureCode)) {
    errors.push(`${label} lacks durable job/failure identity.`);
  }
  for (const key of ["requiredHeadroomMb", "availableHeadroomMb", "minimumFreeCommitMb"]) {
    if (!finiteNonNegative(value[key])) errors.push(`${label}.${key} is not measured.`);
  }
  if (
    finiteNonNegative(value.requiredHeadroomMb) &&
    finiteNonNegative(value.availableHeadroomMb) &&
    value.availableHeadroomMb >= value.requiredHeadroomMb
  ) {
    errors.push(`${label} does not prove reserve-unavailable headroom.`);
  }
  if (
    finiteNonNegative(value.minimumFreeCommitMb) &&
    value.minimumFreeCommitMb <= RUNTIME_V2_BURN_IN.ordinaryFreeCommitFloorMb
  ) {
    errors.push(`${label} crossed the ordinary-operation free-commit floor.`);
  }
}

function validateCancellation(value, errors) {
  const label = "cancellation";
  if (!record(value)) {
    errors.push("Cancellation evidence is missing.");
    return;
  }
  validateDisposition(value.classification, label, errors);
  for (const key of ["jobId", "workerInstanceId"]) {
    if (!nonEmptyString(value[key])) errors.push(`${label}.${key} is missing.`);
  }
  if (!positiveInteger(value.rootWorkerPid)) errors.push(`${label}.rootWorkerPid is missing.`);
  validatePidList(value.descendantPids, `${label}.descendantPids`, errors);
  const survivors = validatePidList(value.survivingDescendantPids, `${label}.survivingDescendantPids`, errors);
  if (survivors.length !== 0) errors.push(`${label} did not reclaim the complete process tree.`);
  if (value.terminalState !== "cancelled" || value.treeExited !== true) {
    errors.push(`${label} lacks a terminal cancelled complete-tree receipt.`);
  }
  if (value.orphanCount !== 0) errors.push(`${label}.orphanCount must be exactly zero.`);
  if (!finiteNonNegative(value.reclaimLatencyMs)) errors.push(`${label}.reclaimLatencyMs is not measured.`);
  validateOrdinaryFreeCommit(value.minimumFreeCommitMb, `${label}.minimumFreeCommitMb`, errors);
}

function validateRestart(value, errors) {
  const label = "restart";
  if (!record(value)) {
    errors.push("Dashboard restart evidence is missing.");
    return;
  }
  validateDisposition(value.classification, label, errors);
  if (!positiveInteger(value.beforeRuntimePid) || !positiveInteger(value.afterRuntimePid)) {
    errors.push(`${label} lacks before/after Runtime process identity.`);
  } else if (value.beforeRuntimePid === value.afterRuntimePid) {
    errors.push(`${label} did not create a fresh Runtime process.`);
  }
  validatePidList(value.priorOwnedPids, `${label}.priorOwnedPids`, errors);
  const survivingPriorOwnedPids = validatePidList(
    value.survivingPriorOwnedPids,
    `${label}.survivingPriorOwnedPids`,
    errors,
  );
  if (survivingPriorOwnedPids.length !== 0) errors.push(`${label} left prior owned processes alive.`);
  const before = validateStringList(value.jobIdsBefore, `${label}.jobIdsBefore`, errors);
  const after = validateStringList(value.jobIdsAfter, `${label}.jobIdsAfter`, errors);
  const lost = validateStringList(value.lostJobIds, `${label}.lostJobIds`, errors);
  const duplicates = validateStringList(value.duplicateJobIds, `${label}.duplicateJobIds`, errors);
  if (lost.length !== 0) errors.push(`${label} lost durable jobs.`);
  if (duplicates.length !== 0) errors.push(`${label} duplicated durable jobs.`);
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    errors.push(`${label} before/after durable job identity changed.`);
  }
  if (value.orphanCount !== 0) errors.push(`${label}.orphanCount must be exactly zero.`);
  validateOrdinaryFreeCommit(value.minimumFreeCommitMb, `${label}.minimumFreeCommitMb`, errors);
}

function validateIdleStop(value, acceptance, errors) {
  const label = "idleStop";
  if (!record(value)) {
    errors.push("Idle service-stop evidence is missing.");
    return;
  }
  validateDisposition(value.classification, label, errors);
  if (!nonEmptyString(value.serviceId) || !positiveInteger(value.servicePid)) {
    errors.push(`${label} lacks exact service identity.`);
  }
  if (value.lifecycleState !== "available-but-stopped") {
    errors.push(`${label} did not return to available-but-stopped.`);
  }
  if (!positiveInteger(value.configuredIdleTtlMs) || value.configuredIdleTtlMs !== acceptance?.serviceIdleTtlMs) {
    errors.push(`${label}.configuredIdleTtlMs does not match the explicit acceptance TTL.`);
  }
  if (!finiteNonNegative(value.idleStopLatencyMs)) errors.push(`${label}.idleStopLatencyMs is not measured.`);
  if (!finiteNonNegative(value.privateMbBefore) || !finiteNonNegative(value.privateMbAfter)) {
    errors.push(`${label} lacks before/after private-memory measurements.`);
  } else if (value.privateMbAfter >= value.privateMbBefore) {
    errors.push(`${label} did not return private memory.`);
  }
  const survivors = validatePidList(value.survivingDescendantPids, `${label}.survivingDescendantPids`, errors);
  if (survivors.length !== 0) errors.push(`${label} left service descendants alive.`);
  if (value.orphanCount !== 0) errors.push(`${label}.orphanCount must be exactly zero.`);
  validateOrdinaryFreeCommit(value.minimumFreeCommitMb, `${label}.minimumFreeCommitMb`, errors);
}

function validatePostMixed(value, errors) {
  const label = "postMixedSample";
  if (!record(value)) {
    errors.push("Five-minute post-mixed sample is missing.");
    return;
  }
  validateDisposition(value.classification, label, errors);
  if (!finiteNonNegative(value.durationMs) || value.durationMs < RUNTIME_V2_BURN_IN.postMixedSampleMs) {
    errors.push(`${label}.durationMs must cover at least five minutes.`);
  }
  if (!positiveInteger(value.sampleCount) || value.sampleCount < 2) {
    errors.push(`${label}.sampleCount must contain repeated measurements.`);
  }
  for (const key of ["settledCommitMb", "settledOwnedPrivateMb"]) {
    if (!finiteNonNegative(value[key])) errors.push(`${label}.${key} is not measured.`);
  }
  if (!nonNegativeInteger(value.settledOwnedProcessCount)) {
    errors.push(`${label}.settledOwnedProcessCount is not measured.`);
  }
  if (value.orphanCount !== 0) errors.push(`${label}.orphanCount must be exactly zero.`);
  validateOrdinaryFreeCommit(value.minimumFreeCommitMb, `${label}.minimumFreeCommitMb`, errors);
}

function validateQuit(value, errors) {
  const label = "quit";
  if (!record(value)) {
    errors.push("Quit cleanup evidence is missing.");
    return;
  }
  validateDisposition(value.classification, label, errors);
  validatePidList(value.ownedRootPids, `${label}.ownedRootPids`, errors);
  const survivors = validatePidList(value.survivingOwnedPids, `${label}.survivingOwnedPids`, errors);
  if (survivors.length !== 0 || value.ownedProcessCount !== 0) {
    errors.push(`${label} left owned processes alive.`);
  }
  if (value.orphanCount !== 0) errors.push(`${label}.orphanCount must be exactly zero.`);
  validateOrdinaryFreeCommit(value.minimumFreeCommitMb, `${label}.minimumFreeCommitMb`, errors);
}

export function validateRuntimeV2BurnInReceipt(receipt) {
  const errors = [];
  let receiptElapsedMs = null;
  if (!record(receipt)) {
    return Object.freeze({ ok: false, errors: Object.freeze(["Runtime V2 burn-in receipt is missing."]) });
  }
  if (receipt.schemaVersion !== RUNTIME_V2_BURN_IN.schemaVersion) {
    errors.push("Runtime V2 burn-in receipt schema version is invalid.");
  }
  if (receipt.workloadProject !== RUNTIME_V2_BURN_IN.workloadProject) {
    errors.push("Receipt was not produced by the dedicated Runtime V2 burn-in workload.");
  }
  if (receipt.runtimeMode !== "actual-electron") errors.push("Receipt runtimeMode must be actual-electron.");
  if (receipt.metricSource !== "GetPerformanceInfo") errors.push("Receipt does not use Windows GetPerformanceInfo.");
  if (receipt.outcome !== "PASS") errors.push(`Receipt outcome is ${receipt.outcome ?? "missing"}, not PASS.`);
  if (!nonEmptyString(receipt.runId) || !validIsoDate(receipt.startedAt) || !validIsoDate(receipt.finishedAt)) {
    errors.push("Receipt lacks a valid run identity or time bounds.");
  } else {
    receiptElapsedMs = Date.parse(receipt.finishedAt) - Date.parse(receipt.startedAt);
    if (receiptElapsedMs < RUNTIME_V2_BURN_IN.requiredDurationMs) {
      errors.push("Receipt time bounds do not span the mandatory six hours.");
    }
  }
  validateAcceptance(receipt.acceptance, errors);
  validateStackEvidence(receipt.stackEvidence, errors);
  validateServiceEvidenceBinding(receipt.serviceEvidence, receipt.startedAt, errors);
  validateServiceCoverage(receipt.serviceCoverage, errors);
  if (
    record(receipt.serviceEvidence) &&
    record(receipt.serviceCoverage) &&
    receipt.serviceCoverage.manifestWideEvidenceAuthority !== receipt.serviceEvidence.authority
  ) {
    errors.push("Burn-in service coverage authority is not bound to its packaged service receipt.");
  }

  const browserAgentRuns = Array.isArray(receipt.browserAgent) ? receipt.browserAgent : [];
  if (browserAgentRuns.length !== RUNTIME_V2_BURN_IN.mixedCycles) {
    errors.push(`browserAgent must contain exactly ${RUNTIME_V2_BURN_IN.mixedCycles} mixed-cycle dispositions.`);
  }
  for (const [index, value] of browserAgentRuns.entries()) {
    validateBrowserAgent(value, index + 1, errors);
  }
  for (const [key, label] of [
    ["jobId", "job ID"],
    ["workerInstanceId", "worker instance ID"],
    ["rootWorkerPid", "root worker PID"],
  ]) {
    const values = browserAgentRuns
      .filter((value) => value?.classification === "PASS")
      .map((value) => value[key]);
    if (new Set(values).size !== values.length) {
      errors.push(`Agent Browser mixed cycles reused a ${label}.`);
    }
  }
  const postizRuns = Array.isArray(receipt.postiz) ? receipt.postiz : [];
  if (postizRuns.length !== RUNTIME_V2_BURN_IN.mixedCycles) {
    errors.push(`postiz must contain exactly ${RUNTIME_V2_BURN_IN.mixedCycles} mixed-cycle dispositions.`);
  }
  for (const [index, value] of postizRuns.entries()) {
    validatePostiz(value, index + 1, errors);
  }
  const passingPostizPids = postizRuns
    .filter((value) => value?.classification === "PASS")
    .map((value) => value.servicePid);
  if (new Set(passingPostizPids).size !== passingPostizPids.length) {
    errors.push("Postiz mixed cycles reused a coordinator PID after idle stop.");
  }
  for (let index = 1; index < postizRuns.length; index += 1) {
    const previous = postizRuns[index - 1];
    const current = postizRuns[index];
    if (previous?.classification !== "PASS" || current?.classification !== "PASS") continue;
    const priorVolumes = Array.isArray(previous.volumesAfter) ? previous.volumesAfter : [];
    const currentVolumes = Array.isArray(current.volumesAfter) ? current.volumesAfter : [];
    if (priorVolumes.some((identity) => !currentVolumes.includes(identity))) {
      errors.push(`postiz[${index}] lost a Docker volume preserved by the prior mixed cycle.`);
    }
  }

  const allOperations = [];
  if (!record(receipt.sequential)) {
    errors.push("Sequential workload evidence is missing.");
  } else {
    for (const kind of Object.keys(RUNTIME_V2_OPERATION_DEFINITIONS)) {
      allOperations.push(...validateSeries(receipt.sequential[kind], kind, `sequential.${kind}`, errors));
    }
  }

  if (!Array.isArray(receipt.mixedCycles) || receipt.mixedCycles.length !== RUNTIME_V2_BURN_IN.mixedCycles) {
    errors.push(`mixedCycles must contain exactly ${RUNTIME_V2_BURN_IN.mixedCycles} cycles.`);
  } else {
    const mixedSettled = [];
    const mixedCounts = [];
    for (const [cycleIndex, cycle] of receipt.mixedCycles.entries()) {
      const label = `mixedCycles[${cycleIndex}]`;
      if (!record(cycle)) {
        errors.push(`${label} is missing.`);
        continue;
      }
      validateDisposition(cycle.classification, label, errors);
      if (cycle.cycle !== cycleIndex + 1) errors.push(`${label}.cycle is out of order.`);
      if (!record(cycle.surfaceEvidence)) {
        errors.push(`${label}.surfaceEvidence is missing.`);
      } else {
        for (const key of ["gardenChat", "retrieval", "quartzBuild", "actualElectronUi"]) {
          if (cycle.surfaceEvidence[key] !== true) {
            errors.push(`${label}.surfaceEvidence.${key} must be true.`);
          }
        }
      }
      if (!record(cycle.conditionalEvidence)) {
        errors.push(`${label}.conditionalEvidence is missing.`);
      } else {
        const expectedBrowser = browserAgentRuns[cycleIndex]?.classification;
        const expectedPostiz = postizRuns[cycleIndex]?.classification;
        if (
          !["PASS", "BLOCKED"].includes(cycle.conditionalEvidence.browserAgent) ||
          cycle.conditionalEvidence.browserAgent !== expectedBrowser
        ) {
          errors.push(`${label}.conditionalEvidence.browserAgent is not correlated.`);
        }
        if (
          !["PASS", "BLOCKED"].includes(cycle.conditionalEvidence.postiz) ||
          cycle.conditionalEvidence.postiz !== expectedPostiz
        ) {
          errors.push(`${label}.conditionalEvidence.postiz is not correlated.`);
        }
        const expectedCycleClassification =
          expectedBrowser === "PASS" && expectedPostiz === "PASS" ? "PASS" : "BLOCKED";
        if (cycle.classification !== expectedCycleClassification) {
          errors.push(`${label}.classification does not match its conditional lifecycle evidence.`);
        }
      }
      if (!record(cycle.operations)) {
        errors.push(`${label}.operations is missing.`);
      } else {
        for (const kind of Object.keys(RUNTIME_V2_OPERATION_DEFINITIONS)) {
          const operation = validateOperation(cycle.operations[kind], kind, `${label}.operations.${kind}`, errors);
          if (operation) {
            if (operation.phase !== `mixed-${cycleIndex + 1}`) {
              errors.push(`${label}.operations.${kind}.phase does not match its mixed cycle.`);
            }
            if (operation.ordinal !== cycleIndex + 1) {
              errors.push(`${label}.operations.${kind}.ordinal does not match its mixed cycle.`);
            }
            if (operation.operationId !== `mixed-${cycleIndex + 1}-${kind}-${cycleIndex + 1}`) {
              errors.push(`${label}.operations.${kind}.operationId is not the exact mixed identity.`);
            }
            allOperations.push(operation);
          }
        }
        const actualKinds = Object.keys(cycle.operations).sort();
        const expectedKinds = Object.keys(RUNTIME_V2_OPERATION_DEFINITIONS).sort();
        if (JSON.stringify(actualKinds) !== JSON.stringify(expectedKinds)) {
          errors.push(`${label} must contain exactly Learn, ingestion, and artifact operations.`);
        }
      }
      if (!finiteNonNegative(cycle.settledOwnedPrivateMb)) {
        errors.push(`${label}.settledOwnedPrivateMb is not measured.`);
      } else mixedSettled.push(cycle.settledOwnedPrivateMb);
      validateOrdinaryFreeCommit(cycle.minimumFreeCommitMb, `${label}.minimumFreeCommitMb`, errors);
      if (!finiteNonNegative(cycle.settledCommitMb)) {
        errors.push(`${label}.settledCommitMb is not measured.`);
      }
      if (!nonNegativeInteger(cycle.settledOwnedProcessCount)) {
        errors.push(`${label}.settledOwnedProcessCount is not measured.`);
      } else mixedCounts.push(cycle.settledOwnedProcessCount);
      if (cycle.orphanCount !== 0) errors.push(`${label}.orphanCount must be exactly zero.`);
      const duplicates = validateStringList(cycle.duplicateServiceIds, `${label}.duplicateServiceIds`, errors);
      if (duplicates.length !== 0) errors.push(`${label} observed duplicate services.`);
      validateStringList(cycle.serviceIds, `${label}.serviceIds`, errors);
    }
    if (mixedSettled.length === RUNTIME_V2_BURN_IN.mixedCycles) {
      const limit = growthLimit(mixedSettled[0], RUNTIME_V2_BURN_IN.mixedGrowthFloorMb);
      if (mixedSettled.at(-1) > limit) {
        errors.push("Final mixed-cycle settled owned memory exceeds the first cycle plus max(768 MB, 10%).");
      }
      rejectMonotonicRise(
        mixedSettled.map((settledOwnedPrivateMb) => ({ settledOwnedPrivateMb })),
        "mixedCycles",
        errors,
      );
    }
    if (
      mixedCounts.length === RUNTIME_V2_BURN_IN.mixedCycles &&
      mixedCounts.at(-1) > mixedCounts[0]
    ) {
      errors.push("Mixed-cycle settled owned process count grew from the first to final cycle.");
    }
  }

  const jobIds = new Set();
  const rootWorkerPids = new Set();
  const workerInstanceIds = new Set();
  const operationIds = new Set();
  for (const operation of allOperations) {
    for (const [value, seen, label] of [
      [operation.operationId, operationIds, "operation ID"],
      [operation.jobId, jobIds, "job ID"],
      [operation.rootWorkerPid, rootWorkerPids, "root worker PID"],
      [operation.workerInstanceId, workerInstanceIds, "worker instance ID"],
    ]) {
      if (seen.has(value)) errors.push(`Finite operations reused a ${label}: ${value}.`);
      seen.add(value);
    }
  }

  validateAdmissionDenial(receipt.admissionDenial, errors);
  validateCancellation(receipt.cancellation, errors);
  validateRestart(receipt.restart, errors);
  validateIdleStop(receipt.idleStop, receipt.acceptance, errors);
  validatePostMixed(receipt.postMixedSample, errors);
  const conditionalClassifications = [...browserAgentRuns, ...postizRuns]
    .map((value) => value?.classification);
  const hasBlockedConditional = conditionalClassifications.includes("BLOCKED");
  if (hasBlockedConditional && receipt.outcome !== "BLOCKED") {
    errors.push("A blocked browser/Postiz prerequisite requires a truthful BLOCKED receipt outcome.");
  }
  if (!hasBlockedConditional && conditionalClassifications.every((value) => value === "PASS") &&
      receipt.outcome !== "PASS") {
    errors.push("Passing browser/Postiz evidence requires a PASS receipt outcome.");
  }
  validateEndurance(receipt.endurance, receipt.acceptance, receipt.startedAt, errors);
  if (
    receiptElapsedMs !== null &&
    finiteNonNegative(receipt.endurance?.durationMs) &&
    receipt.endurance.durationMs > receiptElapsedMs
  ) {
    errors.push("Endurance duration exceeds the receipt's actual time bounds.");
  }
  validateQuit(receipt.quit, errors);
  if (receipt.orphanCount !== 0) errors.push("Final receipt orphanCount must be exactly zero.");
  const duplicateServiceIds = validateStringList(
    receipt.duplicateServiceIds,
    "duplicateServiceIds",
    errors,
  );
  if (duplicateServiceIds.length !== 0) errors.push("Final receipt observed duplicate services.");

  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

export function readRuntimeV2BurnInReceipt(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function validateRuntimeV2BurnInSource({
  packageManifest,
  serviceManifest,
  playwrightConfigSource,
  runnerSource,
  fixtureSource,
  environmentSource,
  recorderSource,
  workloadSource,
  schema,
}) {
  const errors = [];
  const scripts = record(packageManifest) && record(packageManifest.scripts)
    ? packageManifest.scripts
    : {};
  const expectedCommand =
    "node qa/memory/run-memory-qa.mjs --mode=burn-in --launch-workload=true " +
    "--workload-project=runtime-v2-burn-in --workload-repeat-each=1 " +
    "--skip-desktop-build=true --duration-ms=21600000";
  if (scripts["qa:runtime-v2:burn-in"] !== expectedCommand) {
    errors.push("qa:runtime-v2:burn-in does not use the dedicated one-pass Electron project.");
  }
  if (
    scripts["qa:runtime-v2:burn-in:validate"] !==
    "node --test qa/memory/runtime-v2-burn-in-contract.test.mjs qa/memory/runtime-v2-burn-in-source.test.mjs"
  ) {
    errors.push("package.json omits the focused Runtime V2 burn-in source gate.");
  }
  if (
    scripts["preqa:runtime-v2:burn-in"] !==
    "npm run qa:runtime-v2:burn-in:validate && npm run qa:memory:services:validate"
  ) {
    errors.push("package.json does not fail fast through both burn-in and all-service source gates.");
  }
  let sourceMandatoryServiceIds = [];
  let sourceEagerRequiredServiceIds = [];
  try {
    sourceMandatoryServiceIds = manifestMandatoryServiceIds(serviceManifest);
    sourceEagerRequiredServiceIds = manifestEagerRequiredServiceIds(serviceManifest);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Runtime V2 service manifest is invalid.");
  }
  if (!sameStringList(sourceMandatoryServiceIds, RUNTIME_V2_BURN_IN.mandatoryServiceIds)) {
    errors.push("Burn-in mandatory-service contract drifted from services.json.");
  }
  if (!sameStringList(sourceEagerRequiredServiceIds, RUNTIME_V2_BURN_IN.eagerRequiredServiceIds)) {
    errors.push("Burn-in eager-service contract drifted from services.json.");
  }
  if (!sourceMandatoryServiceIds.includes("gbrain")) {
    errors.push("Burn-in mandatory-service contract omits GBrain.");
  }
  for (const required of [
    'name: "runtime-v2-burn-in"',
    "runtime-v2-burn-in\\/.*\\.spec\\.ts",
    "timeout: 9 * 60 * 60_000",
  ]) {
    if (!playwrightConfigSource.includes(required)) {
      errors.push(`Playwright config omits dedicated burn-in project source: ${required}.`);
    }
  }
  for (const required of [
    "validateRuntimeV2BurnInReceipt(receipt)",
    "readRuntimeV2BurnInReceipt(burnInReceiptPath)",
    'BREADBOARD_RUNTIME_V2_BURN_IN: "1"',
    "BREADBOARD_RUNTIME_V2_BURN_IN_RECEIPT_PATH",
    "BREADBOARD_RUNTIME_V2_BURN_IN_SETTLE_WINDOW_MS",
    "BREADBOARD_RUNTIME_V2_BURN_IN_SAMPLE_INTERVAL_MS",
    "BREADBOARD_RUNTIME_V2_BURN_IN_DURATION_MS",
    "readLatestSuccessfulServiceEvidence({",
    "BREADBOARD_RUNTIME_V2_SERVICE_EVIDENCE_BINDING",
    'BREADBOARD_QA_NO_TRACE: "1"',
    "randomBytes(32).toString(\"hex\")",
    "runtimeV2BurnInCompletionGraceMs",
    "durationMs !== RUNTIME_V2_BURN_IN.requiredDurationMs",
    'BREADBOARD_QA_DASHBOARD_MODE: "standalone"',
  ]) {
    if (!runnerSource.includes(required)) errors.push(`Memory QA runner omits ${required}.`);
  }
  if (!runnerSource.includes("resolveRuntimeV2BurnInSettleWindowMs(")) {
    errors.push("Runtime V2 burn-in omits its explicit self-contained default settle duration.");
  }
  const serviceEvidencePreflightIndex = runnerSource.indexOf("readLatestSuccessfulServiceEvidence({");
  const workloadSpawnIndex = runnerSource.indexOf("workload = spawn(");
  if (
    serviceEvidencePreflightIndex < 0 ||
    workloadSpawnIndex < 0 ||
    serviceEvidencePreflightIndex > workloadSpawnIndex
  ) {
    errors.push("Runtime V2 burn-in does not validate packaged service evidence before workload launch.");
  }
  for (const required of [
    "rendererProcessPid()",
    'GBRAIN_MODE: "required"',
    'allowCredentialEnv: runtimeV2BurnIn',
    "BREADBOARD_MEMORY_DIAGNOSTIC_TOKEN",
    "BREADBOARD_RUNTIME_V2_BURN_IN_DURATION_MS",
    'gbrainMode: runtimeV2BurnIn ? "required" : "disabled"',
    "BREADBOARD_RUNTIME_V2_SERVICE_EVIDENCE_BINDING",
  ]) {
    if (!fixtureSource.includes(required)) errors.push(`Electron fixture omits ${required}.`);
  }
  if (
    !environmentSource.includes('gbrainMode?: "disabled" | "required"') ||
    !environmentSource.includes('options.gbrainMode ?? "disabled"') ||
    !environmentSource.includes("gbrainMode,")
  ) {
    errors.push("QA environment does not seed the required real GBrain desktop mode for burn-in.");
  }
  for (const required of [
    'process.platform !== "win32"',
    'this.child!.stdin.write("sample-with-listeners\\n")',
    'require("better-sqlite3")',
    'event.event_type === "completion-confirmed"',
    "payload.peakAccountingComplete !== true",
    "payload.treeExited !== true",
    "const settledSample = await this.sampler.sample()",
    "this.assertNoDuplicateServices(sample",
    "idle_due_at",
    "const dynamicOwned = descendants",
    "minimumFreeCommitMb: this.minimumFreeCommitMb(samples)",
    "measureCancellation(",
    "measureAdmissionDenial(",
    "measureRestart(",
    "measureIdleStop(",
    "measurePostMixedSample(",
    "measureBrowserAgent(",
    "measurePostiz(",
    "const browserAgent = await actions.browserAgent()",
    "const postiz = await actions.postiz()",
    "browserAgentRuns",
    "postizRuns",
    "POSTIZ_ACTION_TIMEOUT_MS = 180_000",
    "POSTIZ_READY_POLL_TIMEOUT_MS = 10 * 60_000",
    "assertBoundedPostizStatus(status",
    "probeContainerEngine(",
    "listComposeIdentities(",
    '"agent-browser-run"',
    '"agent-browser-node"',
    "const treeExit = this.treeExitEvidence(terminal!)",
    'classification: "BLOCKED"',
    '"PREEXISTING_STACK_OWNERSHIP"',
    '"POSTIZ_ACTIVATION_UNAVAILABLE"',
    "const cleanup = await stopAction()",
    "activationCleanup",
    'service.lifecycle_state === "available_but_stopped"',
    'volumesAfter.join("\\0") !== volumesActive.join("\\0")',
    "const coordinatorDescendantPids = this.observedDescendants(coordinatorPid, allSamples)",
    "measureEndurance(",
    "measureQuit(",
    "requiredServiceCoverage(",
    "sortedManifestServiceIds(",
    "this.mandatoryServiceIds",
    "this.eagerRequiredServiceIds",
    "this.observedServiceIds",
    'manifestWideEvidenceAuthority: "runtime-v2-services-receipt"',
    "requiredServiceEvidenceBinding()",
    "this.assertServiceEvidenceBindingFiles(true)",
    "this.assertServiceEvidenceBindingFiles(false)",
    "serviceEvidence: this.serviceEvidence",
    "sha256File(file)",
    'runtimeProcessName: "breadboard-runtime"',
    "The gate will not fabricate memory pressure",
    "fs.renameSync(temporary, this.receiptPath)",
  ]) {
    if (!recorderSource.includes(required)) errors.push(`Burn-in recorder omits ${required}.`);
  }
  const mixedSequenceMarkers = [
    "await this.measureSurfaceAction(`mixed cycle ${cycle} Garden Chat retrieval`",
    'learn: await this.measureFiniteOperation("learn", `mixed-${cycle}`',
    'ingestion: await this.measureFiniteOperation("ingestion", `mixed-${cycle}`',
    'artifact: await this.measureFiniteOperation("artifact", `mixed-${cycle}`',
    "const browserAgent = await actions.browserAgent()",
    "await this.measureSurfaceAction(`mixed cycle ${cycle} Quartz build`",
    "const postiz = await actions.postiz()",
    "const settled = await this.sampler.sample()",
  ];
  let mixedSequenceCursor = recorderSource.indexOf("async measureMixedCycle(");
  for (const marker of mixedSequenceMarkers) {
    const markerIndex = recorderSource.indexOf(marker, mixedSequenceCursor + 1);
    if (markerIndex < 0) {
      errors.push(`Burn-in recorder does not execute the full ordered mixed cycle: ${marker}.`);
      break;
    }
    mixedSequenceCursor = markerIndex;
  }
  for (const forbidden of [
    /\b(?:sleep|delay)\s*\(/u,
    /classification:\s*["'](?:NOT_RUN|SKIPPED)["']/u,
    /status:\s*["'](?:BLOCKED|NOT_RUN|SKIPPED|SKIPPED_OPTIONAL)["']/u,
    /qa\.scenarios\.probe/u,
  ]) {
    if (forbidden.test(recorderSource) || forbidden.test(workloadSource)) {
      errors.push(`Dedicated burn-in contains a forbidden skip/mock timing path: ${forbidden}.`);
    }
  }
  if (/classification:\s*["']BLOCKED["']/u.test(workloadSource)) {
    errors.push("Dedicated burn-in contains a forbidden skip/mock timing path: workload BLOCKED literal.");
  }
  for (const required of [
    'test("actual Electron Runtime V2 completion burn-in"',
    "test.setTimeout(9 * 60 * 60_000)",
    'await recorder.measureSequential("ingestion", ordinal',
    'await recorder.measureSequential("learn", ordinal',
    'await recorder.measureSequential("artifact", ordinal',
    "ordinal <= 10",
    "cycle <= 5",
    "await recorder.measureMixedCycle(cycle",
    "browserAgent: async () =>",
    "postiz: async () =>",
    "await recorder.measurePostMixedSample()",
    "await recorder.measureBrowserAgent(",
    "probeBrowserAgentAvailability(page)",
    "startBrowserAgentFromUi(page)",
    "stopBrowserAgentFromUi(page)",
    '"/api/agent-browser/agents"',
    '"/agents:agent-browser',
    "await recorder.measurePostiz(",
    "probePostizStatus(page, true)",
    "activatePostizThroughRuntime(page)",
    "stopPostizThroughRuntime(page)",
    '"/api/socials-manager/stack"',
    'JSON.stringify({ action: "start" })',
    'JSON.stringify({ action: "stop" })',
    "window.setTimeout(() => controller.abort(), 180_000)",
    "await recorder.measureCancellation(",
    "await recorder.measureAdmissionDenial(",
    'await recorder.measureIdleStop("gbrain"',
    'fetch("/api/gbrain/sync"',
    'method: "POST"',
    "await recorder.measureQuit(",
    "await recorder.measureEndurance()",
    "recorder.writeReceipt()",
    "artifact_render",
    "uploadDocuments(page",
    "Rebuild garden",
    "verifyGardenRetrieval(",
    "verifyQuartzBuild(",
    'return { backend: "gbrain" }',
  ]) {
    if (!workloadSource.includes(required)) errors.push(`Actual-Electron workload omits ${required}.`);
  }
  for (const forbidden of [/test\.skip/u, /test\.fixme/u, /test\.fail/u, /requiredBlock/u]) {
    if (forbidden.test(workloadSource)) errors.push(`Actual-Electron workload has an escape hatch: ${forbidden}.`);
  }
  if (
    !record(schema) ||
    schema.$schema !== "https://json-schema.org/draft/2020-12/schema" ||
    !sameStringList(schema.properties?.outcome?.enum, ["PASS", "BLOCKED"]) ||
    schema.properties?.runtimeMode?.const !== "actual-electron" ||
    schema.properties?.stackEvidence?.$ref !== "#/$defs/stackEvidence" ||
    schema.properties?.serviceEvidence?.$ref !== "#/$defs/serviceEvidence" ||
    schema.properties?.serviceCoverage?.$ref !== "#/$defs/serviceCoverage" ||
    schema.properties?.browserAgent?.$ref !== "#/$defs/fiveBrowserAgentRuns" ||
    schema.properties?.postiz?.$ref !== "#/$defs/fivePostizRuns" ||
    schema.properties?.endurance?.$ref !== "#/$defs/endurance" ||
    schema.properties?.orphanCount?.const !== 0 ||
    schema.properties?.duplicateServiceIds?.maxItems !== 0 ||
    schema.$defs?.tenOperations?.minItems !== 10 ||
    schema.properties?.mixedCycles?.minItems !== 5 ||
    schema.$defs?.operation?.additionalProperties !== false ||
    schema.$defs?.operation?.properties?.minimumFreeCommitMb?.exclusiveMinimum !== 8192 ||
    schema.$defs?.cancellation?.properties?.minimumFreeCommitMb?.exclusiveMinimum !== 8192 ||
    schema.$defs?.restart?.properties?.minimumFreeCommitMb?.exclusiveMinimum !== 8192 ||
    schema.$defs?.idleStop?.properties?.minimumFreeCommitMb?.exclusiveMinimum !== 8192 ||
    schema.$defs?.browserAgent?.properties?.classification?.$ref !== "#/$defs/conditionalDisposition" ||
    schema.$defs?.browserAgent?.properties?.cycle?.maximum !== 5 ||
    schema.$defs?.fiveBrowserAgentRuns?.minItems !== 5 ||
    schema.$defs?.fiveBrowserAgentRuns?.maxItems !== 5 ||
    schema.$defs?.browserAvailability?.properties?.probeLatencyMs?.maximum !== 30000 ||
    schema.$defs?.postiz?.properties?.classification?.$ref !== "#/$defs/conditionalDisposition" ||
    schema.$defs?.postiz?.properties?.cycle?.maximum !== 5 ||
    schema.$defs?.postiz?.properties?.activationCleanup?.oneOf?.[1]?.$ref !==
      "#/$defs/postizActivationCleanup" ||
    schema.$defs?.fivePostizRuns?.minItems !== 5 ||
    schema.$defs?.fivePostizRuns?.maxItems !== 5 ||
    schema.$defs?.postiz?.properties?.coordinatorDescendantPids?.$ref !== "#/$defs/pidArray" ||
    schema.$defs?.containerEngineProbe?.properties?.timeoutMs?.const !== 15000 ||
    schema.$defs?.containerEngineProbe?.properties?.attemptLimit?.const !== 8 ||
    schema.$defs?.containerEngineProbe?.properties?.totalTimeoutMs?.const !== 120000 ||
    schema.$defs?.postizActivation?.properties?.actionTimeoutMs?.const !== 180000 ||
    schema.$defs?.postizActivation?.properties?.readyPollTimeoutMs?.const !== 600000 ||
    schema.$defs?.postizActivationCleanup?.properties?.stopped?.const !== true ||
    schema.$defs?.serviceEvidence?.properties?.authority?.const !== SERVICE_EVIDENCE_AUTHORITY ||
    schema.$defs?.serviceEvidence?.properties?.suite?.const !== "burn" ||
    schema.$defs?.serviceEvidence?.properties?.runtimeMode?.const !== "packaged" ||
    schema.$defs?.serviceEvidence?.properties?.outcome?.const !== "PASS" ||
    schema.$defs?.serviceEvidence?.properties?.maximumAgeMs?.const !== SERVICE_EVIDENCE_MAX_AGE_MS ||
    schema.$defs?.serviceEvidence?.properties?.serviceCount?.const !== mandatoryServiceIds.length ||
    schema.$defs?.serviceEvidence?.properties?.gbrainIncluded?.const !== true ||
    schema.$defs?.serviceEvidence?.properties?.executable?.$ref !== "#/$defs/serviceEvidenceArtifact" ||
    schema.$defs?.serviceEvidence?.properties?.sourceIdentity?.$ref !== "#/$defs/serviceEvidenceSourceIdentity" ||
    schema.$defs?.serviceEvidenceSourceIdentity?.additionalProperties !== false ||
    !schema.$defs?.serviceEvidenceSourceIdentity?.required?.includes("implementationClosureSha256") ||
    schema.$defs?.serviceEvidenceSourceIdentity?.properties?.implementationClosureSha256?.$ref !==
      "#/$defs/sha256" ||
    schema.$defs?.endurance?.properties?.requiredDurationMs?.const !== 21600000 ||
    schema.$defs?.endurance?.properties?.durationMs?.minimum !== 21600000 ||
    schema.$defs?.acceptance?.properties?.defaultSettleWindowMs?.const !== 30000 ||
    schema.$defs?.serviceCoverage?.properties?.missingObservedServiceIds?.maxItems !== 0 ||
    schema.$defs?.serviceCoverage?.properties?.mandatoryServiceIds?.minItems !==
      RUNTIME_V2_BURN_IN.mandatoryServiceIds.length ||
    schema.$defs?.serviceCoverage?.properties?.mandatoryServiceIds?.maxItems !==
      RUNTIME_V2_BURN_IN.mandatoryServiceIds.length ||
    !sameStringList(
      schema.$defs?.serviceCoverage?.properties?.mandatoryServiceIds?.prefixItems
        ?.map((item) => item?.const),
      RUNTIME_V2_BURN_IN.mandatoryServiceIds,
    ) ||
    schema.$defs?.serviceCoverage?.properties?.eagerRequiredServiceIds?.minItems !==
      RUNTIME_V2_BURN_IN.eagerRequiredServiceIds.length ||
    !sameStringList(
      schema.$defs?.serviceCoverage?.properties?.eagerRequiredServiceIds?.prefixItems
        ?.map((item) => item?.const),
      RUNTIME_V2_BURN_IN.eagerRequiredServiceIds,
    ) ||
    schema.$defs?.serviceCoverage?.properties?.observedServiceIds?.minItems !==
      RUNTIME_V2_BURN_IN.observedServiceIds.length ||
    !sameStringList(
      schema.$defs?.serviceCoverage?.properties?.observedServiceIds?.prefixItems
        ?.map((item) => item?.const),
      RUNTIME_V2_BURN_IN.observedServiceIds,
    ) ||
    schema.$defs?.serviceCoverage?.properties?.manifestWideEvidenceAuthority?.const !==
      RUNTIME_V2_BURN_IN.manifestWideEvidenceAuthority ||
    schema.$defs?.mixedCycle?.properties?.surfaceEvidence?.$ref !== "#/$defs/mixedSurfaceEvidence" ||
    schema.$defs?.mixedCycle?.properties?.conditionalEvidence?.$ref !== "#/$defs/mixedConditionalEvidence" ||
    schema.$defs?.mixedCycle?.properties?.minimumFreeCommitMb?.exclusiveMinimum !== 8192 ||
    schema.$defs?.quit?.properties?.minimumFreeCommitMb?.exclusiveMinimum !== 8192
  ) {
    errors.push("Machine-readable burn-in receipt schema omits exact structural acceptance constraints.");
  }
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}
