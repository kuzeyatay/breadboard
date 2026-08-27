#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const qaDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(qaDir, "..", "..");
const contractPath = path.join(repoRoot, "native", "runtime-protocol", "runtime-control-contract.json");
const rustPath = path.join(repoRoot, "native", "runtime-protocol", "src", "lib.rs");
const rustControlPath = path.join(repoRoot, "native", "runtime-cli", "src", "control.rs");
const rustServiceEnginePath = path.join(
  repoRoot,
  "native",
  "runtime-cli",
  "src",
  "service_engine.rs",
);
const rustDurableJobControlPath = path.join(repoRoot, "native", "runtime-cli", "src", "durable_job_control.rs");
const rustHostPath = path.join(repoRoot, "native", "runtime-cli", "src", "host.rs");
const rustWorkerDispatcherPath = path.join(
  repoRoot,
  "native",
  "runtime-cli",
  "src",
  "worker_dispatcher.rs",
);
const rustControlViewsPath = path.join(repoRoot, "native", "runtime-core", "src", "control_views.rs");
const rustInputUploadsPath = path.join(repoRoot, "native", "runtime-core", "src", "input_uploads.rs");
const rustPathsPath = path.join(repoRoot, "native", "runtime-core", "src", "paths.rs");
const rustRegistryPath = path.join(repoRoot, "native", "runtime-core", "src", "registry.rs");
const rustStorePath = path.join(repoRoot, "native", "runtime-core", "src", "store.rs");
const electronPath = path.join(repoRoot, "desktop", "src", "main", "runtime-process.ts");
const electronPathResolverPath = path.join(repoRoot, "desktop", "src", "main", "path-resolver.ts");
const nextPath = path.join(repoRoot, "dashboard", "src", "lib", "supervisor-control.ts");
const nextTransportPath = path.join(
  repoRoot,
  "dashboard",
  "src",
  "lib",
  "runtime-control-transport.ts",
);

const failures = [];

function fail(message) {
  failures.push(message);
}

function readText(absolutePath, label) {
  if (!fs.existsSync(absolutePath)) {
    fail(`missing ${label}: ${path.relative(repoRoot, absolutePath)}`);
    return "";
  }
  return fs.readFileSync(absolutePath, "utf8");
}

function readJson(absolutePath, label) {
  const text = readText(absolutePath, label);
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`invalid ${label}: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
}

function sameOrderedStrings(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function sameStringSet(actual, expected) {
  if (!Array.isArray(actual) || actual.some((value) => typeof value !== "string")) return false;
  return actual.length === new Set(actual).size && sameOrderedStrings([...actual].sort(), [...expected].sort());
}

function requireEqual(actual, expected, label) {
  if (actual !== expected) fail(`${label} must be ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}`);
}

function requireStrings(actual, expected, label, ordered = true) {
  const matches = ordered ? sameOrderedStrings(actual, expected) : sameStringSet(actual, expected);
  if (!matches) fail(`${label} must equal ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}`);
}

function sameJsonValue(actual, expected) {
  if (Object.is(actual, expected)) return true;
  if (Array.isArray(actual) || Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      Array.isArray(expected) &&
      actual.length === expected.length &&
      actual.every((value, index) => sameJsonValue(value, expected[index]))
    );
  }
  if (
    actual === null ||
    expected === null ||
    typeof actual !== "object" ||
    typeof expected !== "object"
  ) {
    return false;
  }
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  return (
    sameOrderedStrings(actualKeys, expectedKeys) &&
    actualKeys.every((key) => sameJsonValue(actual[key], expected[key]))
  );
}

function requireJson(actual, expected, label) {
  if (!sameJsonValue(actual, expected)) {
    fail(`${label} must equal ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}`);
  }
}

function requirePattern(source, pattern, label) {
  if (!pattern.test(source)) fail(label);
}

function requireAbsent(source, pattern, label) {
  if (pattern.test(source)) fail(label);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseIntegerExpression(expression, label) {
  const normalized = expression.replaceAll("_", "").trim();
  const factors = normalized.split("*").map((part) => part.trim());
  if (factors.length === 0 || factors.some((part) => !/^\d+$/.test(part))) {
    fail(`${label} is not a statically auditable integer expression: ${expression.trim()}`);
    return Number.NaN;
  }
  const value = factors.reduce((product, part) => product * Number(part), 1);
  if (!Number.isSafeInteger(value)) {
    fail(`${label} is not a safe integer`);
    return Number.NaN;
  }
  return value;
}

function sourceInteger(source, pattern, label) {
  const match = source.match(pattern);
  if (!match) {
    fail(`missing ${label}`);
    return Number.NaN;
  }
  return parseIntegerExpression(match[1], label);
}

function sourceStringArray(source, pattern, label) {
  const match = source.match(pattern);
  if (!match) {
    fail(`missing ${label}`);
    return [];
  }
  return [...match[1].matchAll(/["']([^"']+)["']/g)].map((item) => item[1]);
}

function sourceStringProperty(source, propertyName, label) {
  const match = source.match(new RegExp(`\\b${propertyName}\\s*:\\s*["']([^"']+)["']`));
  if (!match) {
    fail(`missing ${label}`);
    return "";
  }
  return match[1];
}

function sourceTopLevelObjectKeys(source) {
  const keys = [];
  let braceDepth = 0;
  for (const line of source.split(/\r?\n/)) {
    if (braceDepth === 0) {
      const match = line.match(/^\s*(?:"([^"]+)"|([A-Za-z_$][A-Za-z0-9_$]*))\s*:/);
      if (match) keys.push(match[1] ?? match[2]);
    }
    const withoutStrings = line.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, "");
    braceDepth += [...withoutStrings].filter((character) => character === "{").length;
    braceDepth -= [...withoutStrings].filter((character) => character === "}").length;
  }
  return keys;
}

function sourceBlock(source, startPattern, label) {
  const start = source.search(startPattern);
  if (start < 0) {
    fail(`missing ${label}`);
    return "";
  }
  const open = source.indexOf("{", start);
  if (open < 0) {
    fail(`missing ${label} body`);
    return "";
  }
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(open + 1, index);
  }
  fail(`unterminated ${label}`);
  return "";
}

function rustEnumWireValues(source, enumName, label) {
  const block = sourceBlock(source, new RegExp(`pub enum ${enumName}\\s*\\{`), label);
  return block
    .split(",")
    .map((item) => item.trim())
    .filter((item) => /^[A-Z][A-Za-z0-9]*$/.test(item))
    .map((item) => item.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase());
}

function rustEnumSnakeWireValues(source, enumName, label) {
  const block = sourceBlock(source, new RegExp(`pub enum ${enumName}\\s*\\{`), label);
  return block
    .split(",")
    .map((item) => item.trim())
    .filter((item) => /^[A-Z][A-Za-z0-9]*$/.test(item))
    .map((item) => item.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase());
}

function rustEnumExplicitRenameWireValues(source, enumName, label) {
  const block = sourceBlock(source, new RegExp(`pub enum ${enumName}\\s*\\{`), label);
  const values = [...block.matchAll(/#\[serde\(rename\s*=\s*"([^"]+)"\)\]\s*[A-Z][A-Za-z0-9]*/g)].map(
    (match) => match[1],
  );
  if (values.length === 0) fail(`${label} has no explicit serde wire names`);
  return values;
}

function snakeToCamel(value) {
  return value.replace(/_([a-z0-9])/g, (_match, character) => character.toUpperCase());
}

function pascalToKebab(value) {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

function pascalToSnake(value) {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

function wireToPascal(value) {
  return value
    .split(/[-_]/)
    .map((part) => `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join("");
}

function rustAliasedVariants(source, alias) {
  return [...source.matchAll(new RegExp(`\\b${alias}::([A-Z][A-Za-z0-9]*)`, "g"))].map(
    (match) => pascalToKebab(match[1]),
  );
}

function rustPublicStructWireFields(source, structName, label) {
  const block = sourceBlock(source, new RegExp(`pub struct ${structName}\\s*\\{`), label);
  return [...block.matchAll(/\bpub\s+([a-z][a-z0-9_]*):/g)].map((match) => snakeToCamel(match[1]));
}

const contract = readJson(contractPath, "runtime control contract");
const rust = readText(rustPath, "Rust runtime protocol source");
const rustControl = readText(rustControlPath, "Rust runtime control server source");
const rustServiceEngine = readText(rustServiceEnginePath, "Rust service engine source");
const rustDurableJobControl = readText(rustDurableJobControlPath, "Rust durable job control source");
const rustHost = readText(rustHostPath, "Rust authoritative host source");
const rustWorkerDispatcher = readText(
  rustWorkerDispatcherPath,
  "Rust worker dispatcher source",
);
const rustControlViews = readText(rustControlViewsPath, "Rust runtime control projection source");
const rustInputUploads = readText(rustInputUploadsPath, "Rust durable input upload source");
const rustPaths = readText(rustPathsPath, "Rust trusted path source");
const rustRegistry = readText(rustRegistryPath, "Rust launch registry source");
const rustStore = readText(rustStorePath, "Rust runtime durable store source");
const electron = readText(electronPath, "Electron runtime adapter source");
const electronPathResolver = readText(
  electronPathResolverPath,
  "Electron authoritative path resolver source",
);
const next = readText(nextPath, "Next runtime control adapter source");
const nextTransport = readText(nextTransportPath, "Next bounded runtime control transport source");

const bootstrapFields = [
  "type",
  "protocolVersion",
  "mode",
  "appRoot",
  "runtimeRoot",
  "dataRoot",
  "configRoot",
];
const readyFields = [
  "type",
  "protocolVersion",
  "runtimePid",
  "controlBaseUrl",
  "controlToken",
  "dashboardUrl",
  "services",
];
const statusFields = ["type", "protocolVersion", "runtimePid", "acceptingWork", "services"];
const serviceFields = [
  "id",
  "displayName",
  "required",
  "startupPolicy",
  "state",
  "lastError",
  "restarts",
  "adopted",
];
const jobSubmissionRequiredFields = ["jobType", "idempotencyKey", "requestPayload"];
const jobSubmissionOptionalFields = ["gardenId", "conversationId", "inputUploads"];
const jobSubmissionFields = [
  "jobType",
  "gardenId",
  "conversationId",
  "idempotencyKey",
  "inputUploads",
  "requestPayload",
];
const jobSubmissionForbiddenAuthorityFields = [
  "owner",
  "ownerPrincipal",
  "userId",
  "principal",
  "internalPrincipal",
  "jobId",
  "workerKind",
  "resourceClass",
  "inputManifestPath",
  "workspacePath",
  "checkpointPath",
  "resultPath",
];
const jobAuthorityRequiredHeaders = ["x-breadboard-user-id"];
const jobAuthorityOptionalHeaders = [
  "x-breadboard-garden-id",
  "x-breadboard-conversation-id",
];
const jobResponseFields = ["type", "protocolVersion", "job"];
const jobStatusFields = [
  "jobId",
  "jobType",
  "workerKind",
  "resourceClass",
  "state",
  "stage",
  "attempt",
  "workerInstanceId",
  "gardenId",
  "conversationId",
  "createdAt",
  "startedAt",
  "updatedAt",
  "finishedAt",
  "lastHeartbeatAt",
  "lastWorkerSequence",
  "progressCurrent",
  "progressTotal",
  "failureCode",
  "failureMessage",
  "resourceExhaustion",
  "cancellationRequested",
];
const jobStatusForbiddenFields = [
  "owner",
  "ownerPrincipal",
  "userId",
  "inputManifestPath",
  "workspacePath",
  "checkpointPath",
  "resultPath",
  "requestPayload",
  "requestDigest",
  "idempotencyKey",
  "executable",
  "args",
  "cwd",
  "env",
];
const jobEventsResponseFields = [
  "type",
  "protocolVersion",
  "jobId",
  "after",
  "nextAfter",
  "terminal",
  "hasMore",
  "events",
];
const jobEventFields = [
  "sequence",
  "jobId",
  "attempt",
  "workerInstanceId",
  "workerSequence",
  "eventType",
  "payload",
  "createdAt",
];
const jobEventPayloadFields = [
  "state",
  "stage",
  "progressCurrent",
  "progressTotal",
  "artifactKind",
  "failureCode",
  "failureMessage",
  "resourceExhaustion",
];
const jobEventTypes = [
  "queued",
  "admitted",
  "worker-assigned",
  "reservation-settled",
  "reservation-released",
  "cancellation-requested",
  "completion-confirmed",
  "worker-ready",
  "worker-heartbeat",
  "worker-progress",
  "worker-checkpoint",
  "worker-artifact",
  "worker-complete",
  "worker-failed",
  "worker-cancellation-acknowledged",
  "job-starting",
  "job-running",
  "job-checkpointing",
  "job-cancelling",
  "job-cancelled",
  "job-succeeded",
  "job-failed",
  "job-resource-exhausted",
  "job-interrupted",
  "job-uncertain",
];
const runtimeJobEventTypes = [
  "queued",
  "admitted",
  "worker-assigned",
  "reservation-settled",
  "reservation-released",
  "cancellation-requested",
  "completion-confirmed",
  "job-starting",
  "job-running",
  "job-checkpointing",
  "job-cancelling",
  "job-cancelled",
  "job-succeeded",
  "job-failed",
  "job-resource-exhausted",
  "job-interrupted",
  "job-uncertain",
];
const workerJobEventTypes = [
  "worker-ready",
  "worker-heartbeat",
  "worker-progress",
  "worker-checkpoint",
  "worker-artifact",
  "worker-complete",
  "worker-failed",
  "worker-cancellation-acknowledged",
];
const publicStages = [
  "preparing",
  "working",
  "generating",
  "waiting-external",
  "processing",
  "persisting",
  "finalizing",
  "cancelling",
];
const publicArtifactKinds = [
  "checkpoint",
  "artifact",
  "document",
  "image",
  "audio",
  "video",
  "model",
  "report",
  "archive",
  "page",
];
const publicFailureCodes = [
  "RUNTIME_JOB_FAILED",
  "WORKER_FAILED",
  "BREADBOARD_RESOURCE_EXHAUSTED",
  "JOB_INTERRUPTED",
  "JOB_UNCERTAIN",
];
const sanitizedRuntimeFailureMessage = "Runtime job execution failed.";
const jobEventFenceRules = {
  "runtime-zero": {
    attempt: "zero",
    workerInstanceId: "null",
    workerSequence: "null",
  },
  "runtime-attempt": {
    attempt: "positive-json-safe-integer",
    workerInstanceId: "runtime-identifier",
    workerSequence: "null",
  },
  "runtime-current": {
    alternatives: ["runtime-zero", "runtime-attempt"],
  },
  worker: {
    attempt: "positive-json-safe-integer",
    workerInstanceId: "runtime-identifier",
    workerSequence: "positive-json-safe-integer",
  },
};

function stateEventRule(origin, fence, state) {
  return {
    origin,
    fence,
    payload: { exactFields: ["state"], fixed: { state } },
  };
}

function emptyEventRule(origin, fence) {
  return { origin, fence, payload: { exactFields: [], fixed: {} } };
}

const jobEventRules = {
  queued: stateEventRule("runtime", "runtime-zero", "queued"),
  admitted: stateEventRule("runtime", "runtime-zero", "admitted"),
  "worker-assigned": stateEventRule("runtime", "runtime-attempt", "starting"),
  "reservation-settled": emptyEventRule("runtime", "runtime-attempt"),
  "reservation-released": emptyEventRule("runtime", "runtime-current"),
  "cancellation-requested": stateEventRule("runtime", "runtime-current", "cancelling"),
  "completion-confirmed": stateEventRule("runtime", "runtime-attempt", "succeeded"),
  "worker-ready": {
    origin: "worker",
    fence: "worker",
    payload: {
      exactVariants: [
        { exactFields: ["state"], fixed: { state: "running" } },
        { exactFields: ["state"], fixed: { state: "cancelling" } },
      ],
    },
  },
  "worker-heartbeat": {
    origin: "worker",
    fence: "worker",
    payload: {
      exactFields: ["stage"],
      enumValues: { stage: "jobStatus.publicStages" },
    },
  },
  "worker-progress": {
    origin: "worker",
    fence: "worker",
    payload: {
      exactFields: ["stage", "progressCurrent", "progressTotal"],
      enumValues: { stage: "jobStatus.publicStages" },
      integerValues: {
        progressCurrent: "nonnegative-json-safe-integer",
        progressTotal: "positive-json-safe-integer",
      },
      invariant: "progressCurrent-less-than-or-equal-to-progressTotal",
    },
  },
  "worker-checkpoint": {
    origin: "worker",
    fence: "worker",
    payload: {
      exactFields: ["artifactKind"],
      enumValues: { artifactKind: "jobEvents.publicArtifactKinds" },
    },
  },
  "worker-artifact": {
    origin: "worker",
    fence: "worker",
    payload: {
      exactFields: ["artifactKind"],
      enumValues: { artifactKind: "jobEvents.publicArtifactKinds" },
    },
  },
  "worker-complete": emptyEventRule("worker", "worker"),
  "worker-failed": {
    origin: "worker",
    fence: "worker",
    payload: {
      exactVariants: [
        {
          exactFields: ["state", "failureCode", "failureMessage"],
          fixed: {
            state: "failed",
            failureCode: "WORKER_FAILED",
            failureMessage: sanitizedRuntimeFailureMessage,
          },
        },
        { exactFields: ["state"], fixed: { state: "cancelling" } },
      ],
    },
  },
  "worker-cancellation-acknowledged": stateEventRule(
    "worker",
    "worker",
    "cancelling",
  ),
  "job-starting": stateEventRule("runtime", "runtime-attempt", "starting"),
  "job-running": stateEventRule("runtime", "runtime-attempt", "running"),
  "job-checkpointing": stateEventRule("runtime", "runtime-attempt", "checkpointing"),
  "job-cancelling": stateEventRule("runtime", "runtime-current", "cancelling"),
  "job-cancelled": stateEventRule("runtime", "runtime-current", "cancelled"),
  "job-succeeded": stateEventRule("runtime", "runtime-attempt", "succeeded"),
  "job-failed": stateEventRule("runtime", "runtime-attempt", "failed"),
  "job-resource-exhausted": {
    origin: "runtime",
    fence: "runtime-current",
    payload: {
      exactVariants: [
        { exactFields: ["state"], fixed: { state: "resource_exhausted" } },
        {
          exactFields: ["state", "resourceExhaustion"],
          fixed: { state: "resource_exhausted" },
          resourceExhaustion: "jobStatus.resourceExhaustion",
        },
      ],
    },
  },
  "job-interrupted": stateEventRule("runtime", "runtime-current", "interrupted"),
  "job-uncertain": stateEventRule("runtime", "runtime-attempt", "uncertain"),
};
const jobEventPayloadForbiddenFields = [
  "identity",
  "path",
  "resultPath",
  "checkpointPath",
  "artifactPath",
  "sha256",
  "owner",
  "requestPayload",
  "executable",
  "args",
  "cwd",
  "env",
  "token",
  "providerSecret",
];
const errorResponseFields = [
  "type",
  "protocolVersion",
  "code",
  "message",
  "retryable",
  "resource",
  "requiredHeadroomMb",
  "availableHeadroomMb",
];
const runtimeControlErrorCodes = [
  "INVALID_JOB_REQUEST",
  "JOB_SCOPE_FORBIDDEN",
  "JOB_NOT_FOUND",
  "JOB_CONFLICT",
  "JOB_OUTPUT_NOT_READY",
  "JOB_INPUT_TOO_LARGE",
  "JOB_INPUT_QUOTA_EXCEEDED",
  "JOB_CANCELLATION_QUOTA_EXCEEDED",
  "JOB_CANCELLED_BEFORE_SUBMISSION",
  "INVALID_SERVICE_REQUEST",
  "SERVICE_NOT_FOUND",
  "SERVICE_LEASE_CONFLICT",
  "BREADBOARD_RESOURCE_EXHAUSTED",
  "RUNTIME_UNAVAILABLE",
  "RUNTIME_INTERNAL_ERROR",
];
const serviceLeaseAcquireRequestFields = ["reason"];
const serviceLeaseAcquireForbiddenFields = [
  "serviceId",
  "maximumLeaseMs",
  "executable",
  "args",
  "cwd",
  "env",
];
const serviceLeaseAcquireResponseFields = ["ok", "leaseId", "serviceId"];
const serviceLeaseContractResponseFields = ["protocolVersion", "serviceId", "acquireTimeoutMs"];
const serviceLeaseReleaseResponseFields = ["ok", "released"];
const jobStates = [
  "queued",
  "admitted",
  "starting",
  "running",
  "checkpointing",
  "cancelling",
  "cancelled",
  "succeeded",
  "failed",
  "resource_exhausted",
  "interrupted",
  "uncertain",
];
const resourceClasses = [
  "core",
  "large-generation",
  "document-processing",
  "document-model",
  "media-processing",
  "browser-automation",
  "local-model",
  "docker-stack",
];
const modes = ["lean", "hot", "packaged"];
const serviceStates = [
  "available-but-stopped",
  "starting",
  "ready",
  "busy",
  "resource-blocked",
  "installation-unavailable",
  "failed",
  "stopping",
];
const forbiddenAuthorityFields = [
  "command",
  "executable",
  "args",
  "cwd",
  "env",
  "serviceDefinitions",
  "workerDefinitions",
];

requireEqual(contract.schemaVersion, 1, "schemaVersion");
requireEqual(contract.protocolVersion, 1, "protocolVersion");
requireEqual(contract.transport?.bootstrap, "private-stdin-ndjson", "transport.bootstrap");
requireEqual(contract.transport?.ready, "private-stdout-ndjson", "transport.ready");
requireEqual(contract.transport?.parentDisconnect, "bootstrap-stdin-eof", "transport.parentDisconnect");
requireEqual(contract.transport?.maximumLineBytes, 65_536, "transport.maximumLineBytes");
requireEqual(contract.bootstrap?.type, "runtime-bootstrap", "bootstrap.type");
requireStrings(contract.bootstrap?.requiredFields, bootstrapFields, "bootstrap.requiredFields");
requireStrings(contract.bootstrap?.modes, modes, "bootstrap.modes");
requireEqual(contract.bootstrap?.maximumRootBytes, 4_096, "bootstrap.maximumRootBytes");
requireEqual(
  contract.bootstrap?.rootAuthorities?.appRoot,
  "electron-main-derived-read-only-code-and-entrypoints",
  "bootstrap.rootAuthorities.appRoot",
);
requireEqual(
  contract.bootstrap?.rootAuthorities?.runtimeRoot?.lean,
  "desktop/build-resources",
  "bootstrap.rootAuthorities.runtimeRoot.lean",
);
requireEqual(
  contract.bootstrap?.rootAuthorities?.runtimeRoot?.hot,
  "desktop/build-resources",
  "bootstrap.rootAuthorities.runtimeRoot.hot",
);
requireEqual(
  contract.bootstrap?.rootAuthorities?.runtimeRoot?.packaged,
  "process.resourcesPath",
  "bootstrap.rootAuthorities.runtimeRoot.packaged",
);
requireStrings(
  contract.bootstrap?.forbiddenAuthorityFields,
  forbiddenAuthorityFields,
  "bootstrap.forbiddenAuthorityFields",
);
requireEqual(contract.launchManifests?.directory, "runtime-v2/manifests", "launchManifests.directory");
requireEqual(contract.launchManifests?.workerFile, "workers.json", "launchManifests.workerFile");
requireEqual(contract.launchManifests?.serviceFile, "services.json", "launchManifests.serviceFile");
requireEqual(contract.launchManifests?.workerManifestVersion, 2, "launchManifests.workerManifestVersion");
requireEqual(contract.launchManifests?.serviceManifestVersion, 4, "launchManifests.serviceManifestVersion");
requireEqual(contract.launchManifests?.maximumFileBytes, 262_144, "launchManifests.maximumFileBytes");
requireEqual(contract.launchManifests?.manifestAuthority, "runtimeRoot", "launchManifests.manifestAuthority");
requireEqual(
  contract.launchManifests?.allowedExecutableAuthority,
  "runtimeRoot",
  "launchManifests.allowedExecutableAuthority",
);
requireStrings(
  contract.launchManifests?.requiredServiceIds,
  ["chatmock", "dashboard", "hermes"],
  "launchManifests.requiredServiceIds",
);
requireStrings(
  contract.launchManifests?.requiredWorkerJobTypes,
  ["learn", "document-ingestion", "quartz-publish"],
  "launchManifests.requiredWorkerJobTypes",
);
for (const field of [
  "rejectMissingDefinitions",
  "rejectAbsoluteOrTraversingPaths",
  "ordinaryRequestsCannotSupplyDefinitions",
]) {
  requireEqual(contract.launchManifests?.[field], true, `launchManifests.${field}`);
}
requireEqual(contract.resourceAdmission?.signal, "windows-commit", "resourceAdmission.signal");
for (const field of [
  "sampledInsideSerializedDurableReservation",
  "pendingEstimatesAreAdditive",
  "reserveEqualityIsDenied",
  "oneHeavyweightClassAtATime",
]) {
  requireEqual(contract.resourceAdmission?.[field], true, `resourceAdmission.${field}`);
}
requireStrings(contract.resourceAdmission?.packaged?.modes, ["packaged"], "resourceAdmission.packaged.modes");
requireEqual(contract.resourceAdmission?.packaged?.strategy, "fixed", "resourceAdmission.packaged.strategy");
requireEqual(
  contract.resourceAdmission?.packaged?.reserveFloorMb,
  8_192,
  "resourceAdmission.packaged.reserveFloorMb",
);
requireEqual(
  contract.resourceAdmission?.packaged?.adaptiveProcessTreeGuard,
  false,
  "resourceAdmission.packaged.adaptiveProcessTreeGuard",
);
requireStrings(
  contract.resourceAdmission?.development?.modes,
  ["lean", "hot"],
  "resourceAdmission.development.modes",
);
for (const [field, expected] of [
  ["strategy", "max-floor-or-bounded-tenth-plus-guard"],
  ["reserveFloorMb", 4_096],
  ["commitLimitDivisor", 10],
  ["derivedReserveMinimumMb", 1_536],
  ["derivedReserveMaximumMb", 8_192],
  ["guardBandMb", 256],
  ["adaptiveProcessTreeGuard", true],
  ["guardPollIntervalMs", 25],
  ["manifestHardCeilingsRemain", true],
  ["onlyDashboardMayIncreaseLiveCeiling", true],
  ["onlyDashboardTerminatesAtGlobalReserve", true],
]) {
  requireEqual(
    contract.resourceAdmission?.development?.[field],
    expected,
    `resourceAdmission.development.${field}`,
  );
}
requireStrings(
  contract.jobSubmission?.requiredFields,
  jobSubmissionRequiredFields,
  "jobSubmission.requiredFields",
);
requireEqual(contract.jobSubmission?.method, "POST", "jobSubmission.method");
requireEqual(contract.jobSubmission?.path, "/v1/jobs", "jobSubmission.path");
requireStrings(
  contract.jobSubmission?.optionalFields,
  jobSubmissionOptionalFields,
  "jobSubmission.optionalFields",
);
requireStrings(
  contract.jobSubmission?.forbiddenAuthorityFields,
  jobSubmissionForbiddenAuthorityFields,
  "jobSubmission.forbiddenAuthorityFields",
);
requireEqual(contract.jobSubmission?.denyUnknownFields, true, "jobSubmission.denyUnknownFields");
requireEqual(contract.jobSubmission?.maximumBodyBytes, 262_144, "jobSubmission.maximumBodyBytes");
requireEqual(contract.jobSubmission?.maximumJobTypeBytes, 128, "jobSubmission.maximumJobTypeBytes");
requireEqual(
  contract.jobSubmission?.maximumIdempotencyKeyBytes,
  256,
  "jobSubmission.maximumIdempotencyKeyBytes",
);
requireEqual(
  contract.jobSubmission?.idempotencyKeyGrammar,
  "nonempty-unicode-without-control-characters",
  "jobSubmission.idempotencyKeyGrammar",
);
requireEqual(contract.jobSubmission?.maximumScopeIdBytes, 256, "jobSubmission.maximumScopeIdBytes");
requireEqual(
  contract.jobSubmission?.requestPayload,
  "plain-finite-json-value",
  "jobSubmission.requestPayload",
);
requireEqual(
  contract.jobSubmission?.maximumJsonNodesBeforeSerialization,
  100_000,
  "jobSubmission.maximumJsonNodesBeforeSerialization",
);
requireEqual(
  contract.jobSubmission?.inputUploads?.maximumCount,
  16,
  "jobSubmission.inputUploads.maximumCount",
);
requireStrings(
  contract.jobSubmission?.inputUploads?.itemFields,
  ["uploadId"],
  "jobSubmission.inputUploads.itemFields",
);
requireEqual(
  contract.jobSubmission?.inputUploads?.uniqueUploadIds,
  true,
  "jobSubmission.inputUploads.uniqueUploadIds",
);
requireEqual(
  contract.jobSubmission?.inputUploads?.callerPathsForbidden,
  true,
  "jobSubmission.inputUploads.callerPathsForbidden",
);
requireEqual(
  contract.jobInputUploads?.authority,
  "dashboard-server-bearer-and-job-authority-headers",
  "jobInputUploads.authority",
);
requireEqual(
  contract.jobInputUploads?.maximumUploadBytes,
  2_147_483_648,
  "jobInputUploads.maximumUploadBytes",
);
requireEqual(
  contract.jobInputUploads?.aggregateQuota?.accounting,
  "all-upload-ledger-rows-with-cleanedAt-null-including-adopted",
  "jobInputUploads.aggregateQuota.accounting",
);
requireEqual(
  contract.jobInputUploads?.aggregateQuota?.perOwnerMaximumCount,
  16,
  "jobInputUploads.aggregateQuota.perOwnerMaximumCount",
);
requireEqual(
  contract.jobInputUploads?.aggregateQuota?.perOwnerMaximumDeclaredBytes,
  4_294_967_296,
  "jobInputUploads.aggregateQuota.perOwnerMaximumDeclaredBytes",
);
requireEqual(
  contract.jobInputUploads?.aggregateQuota?.globalMaximumCount,
  256,
  "jobInputUploads.aggregateQuota.globalMaximumCount",
);
requireEqual(
  contract.jobInputUploads?.aggregateQuota?.globalMaximumDeclaredBytes,
  17_179_869_184,
  "jobInputUploads.aggregateQuota.globalMaximumDeclaredBytes",
);
requireEqual(
  contract.jobInputUploads?.aggregateQuota?.enforcement,
  "same-immediate-sqlite-transaction-as-reservation",
  "jobInputUploads.aggregateQuota.enforcement",
);
requireEqual(
  contract.jobInputUploads?.aggregateQuota?.errorCode,
  "JOB_INPUT_QUOTA_EXCEEDED",
  "jobInputUploads.aggregateQuota.errorCode",
);
requireEqual(contract.jobInputUploads?.reservation?.method, "POST", "jobInputUploads.reservation.method");
requireEqual(
  contract.jobInputUploads?.reservation?.path,
  "/v1/job-inputs",
  "jobInputUploads.reservation.path",
);
requireEqual(
  contract.jobInputUploads?.reservation?.maximumBodyBytes,
  16_384,
  "jobInputUploads.reservation.maximumBodyBytes",
);
requireStrings(
  contract.jobInputUploads?.reservation?.requestFields,
  ["gardenId", "conversationId", "displayName", "mediaType", "declaredSizeBytes"],
  "jobInputUploads.reservation.requestFields",
);
requireStrings(
  contract.jobInputUploads?.reservation?.responseFields,
  ["uploadId", "expiresAt", "maximumBytes"],
  "jobInputUploads.reservation.responseFields",
);
requireEqual(
  contract.jobInputUploads?.reservation?.expiresAt,
  "positive-future-json-safe-integer",
  "jobInputUploads.reservation.expiresAt",
);
requireEqual(contract.jobInputUploads?.stream?.method, "PUT", "jobInputUploads.stream.method");
requireEqual(
  contract.jobInputUploads?.stream?.pathTemplate,
  "/v1/job-inputs/{uploadId}",
  "jobInputUploads.stream.pathTemplate",
);
requireEqual(
  contract.jobInputUploads?.stream?.contentType,
  "application/octet-stream",
  "jobInputUploads.stream.contentType",
);
requireStrings(
  contract.jobInputUploads?.stream?.responseFields,
  ["type", "protocolVersion", "uploadId", "state", "sizeBytes", "sha256"],
  "jobInputUploads.stream.responseFields",
);
requireJson(
  contract.jobInputUploads?.stream?.responseFixed,
  { type: "runtime-job-input", protocolVersion: 1, state: "sealed" },
  "jobInputUploads.stream.responseFixed",
);
requireEqual(contract.jobInputUploads?.abandon?.method, "POST", "jobInputUploads.abandon.method");
requireEqual(
  contract.jobInputUploads?.abandon?.pathTemplate,
  "/v1/job-inputs/{uploadId}/abandon",
  "jobInputUploads.abandon.pathTemplate",
);
requireStrings(
  contract.jobInputUploads?.abandon?.responseFields,
  ["ok"],
  "jobInputUploads.abandon.responseFields",
);
requireEqual(contract.jobInputUploads?.abandon?.okMustBeTrue, true, "jobInputUploads.abandon.okMustBeTrue");
requireEqual(contract.jobInputUploads?.abandon?.idempotent, true, "jobInputUploads.abandon.idempotent");
requireEqual(
  contract.jobInputUploads?.adoptionPathTemplate,
  "runtime/jobs/{jobId}/inputs/{blobId}/payload",
  "jobInputUploads.adoptionPathTemplate",
);
requireEqual(contract.jobInputUploads?.uploadIsNeverAJob, true, "jobInputUploads.uploadIsNeverAJob");
requireEqual(contract.jobLookup?.method, "POST", "jobLookup.method");
requireEqual(contract.jobLookup?.path, "/v1/jobs/lookup", "jobLookup.path");
requireEqual(contract.jobLookup?.maximumBodyBytes, 1_024, "jobLookup.maximumBodyBytes");
requireStrings(
  contract.jobLookup?.requestFields,
  ["idempotencyKey"],
  "jobLookup.requestFields",
);
requireEqual(
  contract.jobLookup?.authority,
  "dashboard-server-bearer-and-job-authority-headers",
  "jobLookup.authority",
);
requireEqual(
  contract.jobLookup?.ownerAndScopesForbiddenInBody,
  true,
  "jobLookup.ownerAndScopesForbiddenInBody",
);
requireEqual(
  contract.jobLookup?.idempotencyKeyNeverReturned,
  true,
  "jobLookup.idempotencyKeyNeverReturned",
);
requireEqual(contract.jobLookup?.denyUnknownFields, true, "jobLookup.denyUnknownFields");
requireEqual(
  contract.jobIdempotencyCancellation?.method,
  "POST",
  "jobIdempotencyCancellation.method",
);
requireEqual(
  contract.jobIdempotencyCancellation?.path,
  "/v1/jobs/cancel-by-idempotency",
  "jobIdempotencyCancellation.path",
);
requireEqual(
  contract.jobIdempotencyCancellation?.maximumBodyBytes,
  1_024,
  "jobIdempotencyCancellation.maximumBodyBytes",
);
requireStrings(
  contract.jobIdempotencyCancellation?.requestFields,
  ["idempotencyKey"],
  "jobIdempotencyCancellation.requestFields",
);
requireEqual(
  contract.jobIdempotencyCancellation?.authority,
  "dashboard-server-bearer-and-exact-job-authority-headers",
  "jobIdempotencyCancellation.authority",
);
requireEqual(
  contract.jobIdempotencyCancellation?.ownerAndScopesForbiddenInBody,
  true,
  "jobIdempotencyCancellation.ownerAndScopesForbiddenInBody",
);
requireEqual(
  contract.jobIdempotencyCancellation?.idempotencyKeyNeverReturned,
  true,
  "jobIdempotencyCancellation.idempotencyKeyNeverReturned",
);
requireEqual(
  contract.jobIdempotencyCancellation?.tombstoneTtlMs,
  24 * 60 * 60 * 1_000,
  "jobIdempotencyCancellation.tombstoneTtlMs",
);
requireJson(
  contract.jobIdempotencyCancellation?.aggregateQuota,
  {
    perOwnerMaximumCount: 128,
    globalMaximumCount: 4_096,
    enforcement: "same-immediate-sqlite-transaction-as-cancellation",
    errorCode: "JOB_CANCELLATION_QUOTA_EXCEEDED",
  },
  "jobIdempotencyCancellation.aggregateQuota",
);
requireJson(
  contract.jobIdempotencyCancellation?.onlineCleanup,
  {
    maximumBatch: 64,
    periodicBatch: 8,
    touchesOnlyExpiredTombstones: true,
  },
  "jobIdempotencyCancellation.onlineCleanup",
);
requireEqual(
  contract.jobIdempotencyCancellation?.submissionRace,
  "active-tombstone-is-consumed-in-the-job-insert-transaction-and-job-is-never-admission-visible-before-terminal-cancelled",
  "jobIdempotencyCancellation.submissionRace",
);
requireJson(
  contract.jobIdempotencyCancellation?.response,
  {
    type: "runtime-job-idempotency-cancellation",
    protocolVersion: 1,
    exactFields: ["type", "protocolVersion", "jobId", "state", "accepted"],
    pendingDisposition: { jobId: null, state: "pending", accepted: true },
    acceptedJobStates: ["cancelling", "cancelled"],
    alreadyTerminalStates: ["succeeded", "failed", "resource_exhausted", "interrupted", "uncertain"],
    alreadyTerminalAccepted: false,
    denyUnknownFields: true,
  },
  "jobIdempotencyCancellation.response",
);
requireEqual(
  contract.jobIdempotencyCancellation?.denyUnknownFields,
  true,
  "jobIdempotencyCancellation.denyUnknownFields",
);
requireEqual(contract.learnRecoverySubmission?.method, "POST", "learnRecoverySubmission.method");
requireEqual(
  contract.learnRecoverySubmission?.path,
  "/v1/internal/jobs/learn-recovery",
  "learnRecoverySubmission.path",
);
requireEqual(
  contract.learnRecoverySubmission?.maximumBodyBytes,
  1_024,
  "learnRecoverySubmission.maximumBodyBytes",
);
requireStrings(
  contract.learnRecoverySubmission?.requestFields,
  ["idempotencyKey"],
  "learnRecoverySubmission.requestFields",
);
requireEqual(
  contract.learnRecoverySubmission?.idempotencyKeyGrammar,
  "learn-recovery-v2-colon-decimal-generation",
  "learnRecoverySubmission.idempotencyKeyGrammar",
);
requireEqual(
  contract.learnRecoverySubmission?.authority,
  "dashboard-server-bearer-only",
  "learnRecoverySubmission.authority",
);
requireStrings(
  contract.learnRecoverySubmission?.authorityHeadersForbidden,
  ["x-breadboard-user-id", "x-breadboard-garden-id", "x-breadboard-conversation-id"],
  "learnRecoverySubmission.authorityHeadersForbidden",
);
requireEqual(
  contract.learnRecoverySubmission?.fixedInternalPrincipal,
  "internal:learn-recovery",
  "learnRecoverySubmission.fixedInternalPrincipal",
);
requireEqual(contract.learnRecoverySubmission?.fixedJobType, "learn", "learnRecoverySubmission.fixedJobType");
requireJson(
  contract.learnRecoverySubmission?.fixedScopes,
  { gardenId: null, conversationId: null },
  "learnRecoverySubmission.fixedScopes",
);
requireJson(
  contract.learnRecoverySubmission?.fixedRequestPayload,
  { operation: "recovery" },
  "learnRecoverySubmission.fixedRequestPayload",
);
requireJson(contract.learnRecoverySubmission?.fixedInputUploads, [], "learnRecoverySubmission.fixedInputUploads");
requireStrings(
  contract.learnRecoverySubmission?.forbiddenBodyFields,
  [
    "jobType",
    "requestPayload",
    "inputUploads",
    "owner",
    "ownerPrincipal",
    "principal",
    "userId",
    "gardenId",
    "conversationId",
  ],
  "learnRecoverySubmission.forbiddenBodyFields",
);
requireEqual(
  contract.learnRecoverySubmission?.normalSubmissionAdmissionGateApplies,
  true,
  "learnRecoverySubmission.normalSubmissionAdmissionGateApplies",
);
requireEqual(contract.learnRecoverySubmission?.response, "runtime-job", "learnRecoverySubmission.response");
requireEqual(contract.learnRecoverySubmission?.denyUnknownFields, true, "learnRecoverySubmission.denyUnknownFields");
requireStrings(
  contract.jobAuthorityHeaders?.required,
  jobAuthorityRequiredHeaders,
  "jobAuthorityHeaders.required",
);
requireStrings(
  contract.jobAuthorityHeaders?.optional,
  jobAuthorityOptionalHeaders,
  "jobAuthorityHeaders.optional",
);
requireEqual(contract.jobAuthorityHeaders?.rejectDuplicates, true, "jobAuthorityHeaders.rejectDuplicates");
requireEqual(
  contract.jobAuthorityHeaders?.userId,
  "positive-json-safe-integer-decimal",
  "jobAuthorityHeaders.userId",
);
requireEqual(
  contract.jobAuthorityHeaders?.scopeGrammar,
  "visible-ascii-without-whitespace",
  "jobAuthorityHeaders.scopeGrammar",
);
requireEqual(
  contract.jobAuthorityHeaders?.scopeValuesMustMatchSubmission,
  true,
  "jobAuthorityHeaders.scopeValuesMustMatchSubmission",
);
requireEqual(
  contract.jobAuthorityHeaders?.neverRendererAccessible,
  true,
  "jobAuthorityHeaders.neverRendererAccessible",
);
requireEqual(
  contract.serviceLeaseControl?.authority,
  "dashboard-server-bearer-only",
  "serviceLeaseControl.authority",
);
requireEqual(
  contract.serviceLeaseControl?.maximumBodyBytes,
  8_192,
  "serviceLeaseControl.maximumBodyBytes",
);
requireEqual(
  contract.serviceLeaseControl?.maximumReasonBytes,
  256,
  "serviceLeaseControl.maximumReasonBytes",
);
requireEqual(
  contract.serviceLeaseControl?.reasonGrammar,
  "nonempty-unicode-without-control-characters",
  "serviceLeaseControl.reasonGrammar",
);
requireEqual(
  contract.serviceLeaseControl?.serviceIdentityAuthority,
  "authenticated-route-and-trusted-service-registry",
  "serviceLeaseControl.serviceIdentityAuthority",
);
requireEqual(
  contract.serviceLeaseControl?.leaseDurationAuthority,
  "trusted-service-registry",
  "serviceLeaseControl.leaseDurationAuthority",
);
requireEqual(
  contract.serviceLeaseControl?.acquireDeadline?.method,
  "GET",
  "serviceLeaseControl.acquireDeadline.method",
);
requireEqual(
  contract.serviceLeaseControl?.acquireDeadline?.pathTemplate,
  "/v1/services/{serviceId}/lease-contract",
  "serviceLeaseControl.acquireDeadline.pathTemplate",
);
requireEqual(
  contract.serviceLeaseControl?.acquireDeadline?.requestBody,
  "none",
  "serviceLeaseControl.acquireDeadline.requestBody",
);
requireStrings(
  contract.serviceLeaseControl?.acquireDeadline?.responseFields,
  serviceLeaseContractResponseFields,
  "serviceLeaseControl.acquireDeadline.responseFields",
);
requireEqual(
  contract.serviceLeaseControl?.acquireDeadline?.responseBinding,
  "requested-service-id",
  "serviceLeaseControl.acquireDeadline.responseBinding",
);
requireEqual(
  contract.serviceLeaseControl?.acquireDeadline?.startupTimeoutAuthority,
  "trusted-service-registry-readiness",
  "serviceLeaseControl.acquireDeadline.startupTimeoutAuthority",
);
requireEqual(
  contract.serviceLeaseControl?.acquireDeadline?.maximumManifestStartupMs,
  7 * 24 * 60 * 60_000,
  "serviceLeaseControl.acquireDeadline.maximumManifestStartupMs",
);
requireEqual(
  contract.serviceLeaseControl?.acquireDeadline?.settlementGraceMs,
  5_000,
  "serviceLeaseControl.acquireDeadline.settlementGraceMs",
);
requireEqual(
  contract.serviceLeaseControl?.acquireDeadline?.responseGraceMs,
  5_000,
  "serviceLeaseControl.acquireDeadline.responseGraceMs",
);
requireEqual(
  contract.serviceLeaseControl?.acquireDeadline?.dashboardTransportGraceMs,
  5_000,
  "serviceLeaseControl.acquireDeadline.dashboardTransportGraceMs",
);
requireEqual(
  contract.serviceLeaseControl?.acquireDeadline?.passive,
  true,
  "serviceLeaseControl.acquireDeadline.passive",
);
requireEqual(
  contract.serviceLeaseControl?.acquireDeadline?.denyUnknownFields,
  true,
  "serviceLeaseControl.acquireDeadline.denyUnknownFields",
);
requireEqual(contract.serviceLeaseControl?.acquire?.method, "POST", "serviceLeaseControl.acquire.method");
requireEqual(
  contract.serviceLeaseControl?.acquire?.pathTemplate,
  "/v1/services/{serviceId}/lease",
  "serviceLeaseControl.acquire.pathTemplate",
);
requireStrings(
  contract.serviceLeaseControl?.acquire?.requestFields,
  serviceLeaseAcquireRequestFields,
  "serviceLeaseControl.acquire.requestFields",
);
requireStrings(
  contract.serviceLeaseControl?.acquire?.forbiddenRequestFields,
  serviceLeaseAcquireForbiddenFields,
  "serviceLeaseControl.acquire.forbiddenRequestFields",
);
requireStrings(
  contract.serviceLeaseControl?.acquire?.responseFields,
  serviceLeaseAcquireResponseFields,
  "serviceLeaseControl.acquire.responseFields",
);
requireEqual(
  contract.serviceLeaseControl?.acquire?.okMustBeTrue,
  true,
  "serviceLeaseControl.acquire.okMustBeTrue",
);
requireEqual(
  contract.serviceLeaseControl?.acquire?.responseBinding,
  "requested-service-id",
  "serviceLeaseControl.acquire.responseBinding",
);
requireEqual(
  contract.serviceLeaseControl?.acquire?.responseDeliveryFailure,
  "release-returned-lease-immediately",
  "serviceLeaseControl.acquire.responseDeliveryFailure",
);
requireEqual(
  contract.serviceLeaseControl?.acquire?.denyUnknownFields,
  true,
  "serviceLeaseControl.acquire.denyUnknownFields",
);
requireEqual(contract.serviceLeaseControl?.release?.method, "POST", "serviceLeaseControl.release.method");
requireEqual(
  contract.serviceLeaseControl?.release?.pathTemplate,
  "/v1/leases/{leaseId}/release",
  "serviceLeaseControl.release.pathTemplate",
);
requireStrings(
  contract.serviceLeaseControl?.release?.requestFields,
  [],
  "serviceLeaseControl.release.requestFields",
);
requireEqual(
  contract.serviceLeaseControl?.release?.requestBody,
  "exact-empty-json-object",
  "serviceLeaseControl.release.requestBody",
);
requireStrings(
  contract.serviceLeaseControl?.release?.responseFields,
  serviceLeaseReleaseResponseFields,
  "serviceLeaseControl.release.responseFields",
);
requireEqual(
  contract.serviceLeaseControl?.release?.okMustBeTrue,
  true,
  "serviceLeaseControl.release.okMustBeTrue",
);
requireEqual(
  contract.serviceLeaseControl?.release?.denyUnknownFields,
  true,
  "serviceLeaseControl.release.denyUnknownFields",
);
requireEqual(contract.jobStatus?.type, "runtime-job", "jobStatus.type");
requireStrings(contract.jobStatus?.states, jobStates, "jobStatus.states");
requireStrings(contract.jobStatus?.publicStages, publicStages, "jobStatus.publicStages");
requireJson(
  contract.jobStatus?.stageProvenance,
  {
    authority: "runtime-owned-closed-enum",
    mapping: "exact-private-token-match",
    unknownFallback: "working",
    rawPrivateValuesNeverReturned: true,
  },
  "jobStatus.stageProvenance",
);
requireStrings(contract.jobStatus?.failureCodes, publicFailureCodes, "jobStatus.failureCodes");
requireJson(
  contract.jobStatus?.failureCodeProvenance,
  {
    authority: "runtime-owned-closed-enum",
    rawWorkerOrDurableValuesNeverReturned: true,
  },
  "jobStatus.failureCodeProvenance",
);
requireJson(
  contract.jobStatus?.failureMessagePolicy,
  {
    nonNullValue: sanitizedRuntimeFailureMessage,
    rawWorkerOrDurableValuesNeverReturned: true,
  },
  "jobStatus.failureMessagePolicy",
);
requireJson(
  contract.jobStatus?.resourceExhaustion,
  {
    nullable: true,
    allowedOnlyForState: "resource_exhausted",
    fields: ["resource", "requiredHeadroomMb", "availableHeadroomMb", "retryable"],
    resource: "windows_commit",
    retryable: false,
    privateReasonAndPolicyLabelsForbidden: true,
  },
  "jobStatus.resourceExhaustion",
);
requireStrings(
  contract.jobStatus?.resourceClasses,
  resourceClasses,
  "jobStatus.resourceClasses",
);
requireStrings(contract.jobStatus?.requiredFields, jobResponseFields, "jobStatus.requiredFields");
requireStrings(
  contract.jobStatus?.jobRequiredFields,
  jobStatusFields,
  "jobStatus.jobRequiredFields",
);
requireStrings(
  contract.jobStatus?.forbiddenFields,
  jobStatusForbiddenFields,
  "jobStatus.forbiddenFields",
);
requireStrings(
  contract.jobStatus?.responseBindings?.submission,
  ["authenticatedScopes", "submittedJobType"],
  "jobStatus.responseBindings.submission",
);
requireStrings(
  contract.jobStatus?.responseBindings?.inspection,
  ["authenticatedScopes", "requestedJobId"],
  "jobStatus.responseBindings.inspection",
);
requireStrings(
  contract.jobStatus?.responseBindings?.cancellation,
  ["authenticatedScopes", "requestedJobId"],
  "jobStatus.responseBindings.cancellation",
);
requireEqual(contract.jobStatus?.denyUnknownFields, true, "jobStatus.denyUnknownFields");
requireEqual(contract.jobEvents?.type, "runtime-job-events", "jobEvents.type");
requireEqual(contract.jobEvents?.method, "GET", "jobEvents.method");
requireEqual(
  contract.jobEvents?.pathTemplate,
  "/v1/jobs/{jobId}/events?after={sequence}&limit={limit}",
  "jobEvents.pathTemplate",
);
requireStrings(
  contract.jobEvents?.requiredFields,
  jobEventsResponseFields,
  "jobEvents.requiredFields",
);
requireStrings(
  contract.jobEvents?.eventRequiredFields,
  jobEventFields,
  "jobEvents.eventRequiredFields",
);
requireStrings(contract.jobEvents?.eventTypes, jobEventTypes, "jobEvents.eventTypes");
requireJson(
  contract.jobEvents?.eventOrigins,
  { runtime: runtimeJobEventTypes, worker: workerJobEventTypes },
  "jobEvents.eventOrigins",
);
requireJson(contract.jobEvents?.fenceRules, jobEventFenceRules, "jobEvents.fenceRules");
requireStrings(
  contract.jobEvents?.publicArtifactKinds,
  publicArtifactKinds,
  "jobEvents.publicArtifactKinds",
);
requireJson(
  contract.jobEvents?.artifactKindProvenance,
  {
    authority: "runtime-owned-closed-enum",
    unknownWorkerFallback: "artifact",
    rawWorkerValuesNeverReturned: true,
  },
  "jobEvents.artifactKindProvenance",
);
requireStrings(contract.jobEvents?.failureCodes, publicFailureCodes, "jobEvents.failureCodes");
requireJson(
  contract.jobEvents?.failureCodeProvenance,
  {
    authority: "runtime-owned-closed-enum",
    workerFailed: "WORKER_FAILED",
    rawWorkerOrDurableValuesNeverReturned: true,
  },
  "jobEvents.failureCodeProvenance",
);
requireEqual(
  contract.jobEvents?.sanitizedFailureMessage,
  sanitizedRuntimeFailureMessage,
  "jobEvents.sanitizedFailureMessage",
);
requireJson(contract.jobEvents?.eventRules, jobEventRules, "jobEvents.eventRules");
requireStrings(
  contract.jobEvents?.payloadAllowedFields,
  jobEventPayloadFields,
  "jobEvents.payloadAllowedFields",
);
requireStrings(
  contract.jobEvents?.payloadForbiddenFields,
  jobEventPayloadForbiddenFields,
  "jobEvents.payloadForbiddenFields",
);
requireEqual(contract.jobEvents?.maximumRecords, 256, "jobEvents.maximumRecords");
requireEqual(
  contract.jobEvents?.sourceQuery,
  "requested-limit-plus-one",
  "jobEvents.sourceQuery",
);
requireEqual(
  contract.jobEvents?.snapshotConsistency,
  "owned-job-events-and-active-reservation-in-one-sqlite-read-transaction",
  "jobEvents.snapshotConsistency",
);
requireStrings(
  contract.jobEvents?.responseBindings,
  ["requestedJobId", "requestedAfter", "requestedLimit"],
  "jobEvents.responseBindings",
);
requireEqual(
  contract.jobEvents?.maximumSerializedResponseBytes,
  contract.control?.maximumResponseBytes,
  "jobEvents.maximumSerializedResponseBytes",
);
requireEqual(contract.jobEvents?.strictlyIncreasingSequence, true, "jobEvents.strict ordering");
requireEqual(contract.jobEvents?.singleJobOnly, true, "jobEvents.singleJobOnly");
requireEqual(
  contract.jobEvents?.terminalMeaning,
  "durable-job-is-terminal-and-no-pending-or-resident-job-reservation",
  "jobEvents.terminalMeaning",
);
requireEqual(
  contract.jobEvents?.hasMoreMeaning,
  "another-byte-or-record-bounded-page-is-required",
  "jobEvents.hasMoreMeaning",
);
requireEqual(
  contract.jobEvents?.fullyDrainedWhen,
  "terminal-is-true-and-hasMore-is-false",
  "jobEvents.fullyDrainedWhen",
);
requireEqual(contract.jobEvents?.denyUnknownFields, true, "jobEvents.denyUnknownFields");
requireEqual(contract.jobInspection?.method, "GET", "jobInspection.method");
requireEqual(
  contract.jobInspection?.pathTemplate,
  "/v1/jobs/{jobId}",
  "jobInspection.pathTemplate",
);
requireEqual(contract.jobCancellation?.method, "POST", "jobCancellation.method");
requireEqual(
  contract.jobCancellation?.pathTemplate,
  "/v1/jobs/{jobId}/cancel",
  "jobCancellation.pathTemplate",
);
requireEqual(contract.jobOutputs?.maximumContentBytes, 1_048_576, "jobOutputs.maximumContentBytes");
requireEqual(
  contract.jobOutputs?.maximumSerializedResponseBytes,
  1_114_112,
  "jobOutputs.maximumSerializedResponseBytes",
);
requireEqual(contract.jobOutputs?.checkpoint?.method, "GET", "jobOutputs.checkpoint.method");
requireEqual(
  contract.jobOutputs?.checkpoint?.pathTemplate,
  "/v1/jobs/{jobId}/checkpoint",
  "jobOutputs.checkpoint.pathTemplate",
);
requireEqual(contract.jobOutputs?.result?.method, "GET", "jobOutputs.result.method");
requireEqual(
  contract.jobOutputs?.result?.pathTemplate,
  "/v1/jobs/{jobId}/result",
  "jobOutputs.result.pathTemplate",
);
requireEqual(contract.jobOutputs?.response?.type, "runtime-job-output", "jobOutputs.response.type");
requireEqual(contract.jobOutputs?.response?.protocolVersion, 1, "jobOutputs.response.protocolVersion");
requireStrings(
  contract.jobOutputs?.response?.exactFields,
  ["type", "protocolVersion", "jobId", "kind", "content"],
  "jobOutputs.response.exactFields",
);
requireStrings(
  contract.jobOutputs?.response?.kindValues,
  ["checkpoint", "result"],
  "jobOutputs.response.kindValues",
);
requireStrings(
  contract.jobOutputs?.response?.bindings,
  ["requestedJobId", "requestedKind"],
  "jobOutputs.response.bindings",
);
requireEqual(
  contract.jobOutputs?.response?.denyUnknownFields,
  true,
  "jobOutputs.response.denyUnknownFields",
);
requireStrings(
  contract.errorResponse?.requiredFields,
  errorResponseFields,
  "errorResponse.requiredFields",
);
requireEqual(contract.errorResponse?.type, "runtime-error", "errorResponse.type");
requireEqual(contract.errorResponse?.denyUnknownFields, true, "errorResponse.denyUnknownFields");
requireStrings(contract.errorResponse?.codes, runtimeControlErrorCodes, "errorResponse.codes");
requireEqual(
  contract.errorResponse?.retryableMustBeFalse,
  true,
  "errorResponse.retryableMustBeFalse",
);
requireEqual(
  contract.errorResponse?.resourceExhaustionEvidence?.code,
  "BREADBOARD_RESOURCE_EXHAUSTED",
  "errorResponse.resourceExhaustionEvidence.code",
);
requireEqual(
  contract.errorResponse?.resourceExhaustionEvidence?.resource,
  "windows_commit",
  "errorResponse.resourceExhaustionEvidence.resource",
);
requireEqual(
  contract.errorResponse?.resourceExhaustionEvidence?.requiredHeadroomMb,
  "positive-integer",
  "errorResponse.resourceExhaustionEvidence.requiredHeadroomMb",
);
requireEqual(
  contract.errorResponse?.resourceExhaustionEvidence?.availableHeadroomMb,
  "nonnegative-integer",
  "errorResponse.resourceExhaustionEvidence.availableHeadroomMb",
);
requireEqual(
  contract.errorResponse?.resourceExhaustionEvidence?.mustBeNullForOtherCodes,
  true,
  "errorResponse.resourceExhaustionEvidence.mustBeNullForOtherCodes",
);
requireEqual(contract.ready?.type, "runtime-ready", "ready.type");
requireStrings(contract.ready?.requiredFields, readyFields, "ready.requiredFields");
requireEqual(contract.status?.type, "runtime-status", "status.type");
requireStrings(contract.status?.requiredFields, statusFields, "status.requiredFields");
requireStrings(contract.serviceStatus?.requiredFields, serviceFields, "serviceStatus.requiredFields");
requireStrings(contract.serviceStatus?.states, serviceStates, "serviceStatus.states");
requireStrings(
  contract.serviceStatus?.startupPolicies,
  ["eager", "on-demand", "scheduled", "external"],
  "serviceStatus.startupPolicies",
);
requireEqual(contract.serviceStatus?.maximumRecords, 256, "serviceStatus.maximumRecords");
requireEqual(contract.serviceStatus?.maximumIdBytes, 128, "serviceStatus.maximumIdBytes");
requireEqual(contract.serviceStatus?.maximumDisplayNameBytes, 256, "serviceStatus.maximumDisplayNameBytes");
requireEqual(contract.serviceStatus?.maximumLastErrorBytes, 8_192, "serviceStatus.maximumLastErrorBytes");
requireEqual(contract.serviceStatus?.maximumRestarts, 64, "serviceStatus.maximumRestarts");
requireEqual(contract.serviceStatus?.adoptedMustBeFalse, true, "serviceStatus.adoptedMustBeFalse");
requireEqual(contract.control?.origin, "literal-loopback-http", "control.origin");
requireStrings(contract.control?.allowedHosts, ["127.0.0.1", "[::1]"], "control.allowedHosts");
requireEqual(contract.control?.authorizationScheme, "Bearer", "control.authorizationScheme");
requireEqual(contract.control?.minimumTokenBytes, 32, "control.minimumTokenBytes");
requireEqual(contract.control?.maximumTokenBytes, 1_024, "control.maximumTokenBytes");
requireEqual(contract.control?.maximumResponseBytes, 65_536, "control.maximumResponseBytes");
requireEqual(
  contract.control?.maximumJsonSafeInteger,
  Number.MAX_SAFE_INTEGER,
  "control.maximumJsonSafeInteger",
);
requireEqual(contract.control?.maximumActiveConnections, 40, "control.maximumActiveConnections");
requireEqual(
  contract.control?.maximumActiveDashboardConnections,
  32,
  "control.maximumActiveDashboardConnections",
);
requireEqual(
  contract.control?.maximumDashboardJobConnections,
  16,
  "control.maximumDashboardJobConnections",
);
requireEqual(
  contract.control?.maximumDashboardServiceConnections,
  8,
  "control.maximumDashboardServiceConnections",
);
requireEqual(
  contract.control?.minimumLifecycleConnectionReserve,
  8,
  "control.minimumLifecycleConnectionReserve",
);
requireEqual(
  contract.control?.minimumCrossRealmDashboardReserve,
  8,
  "control.minimumCrossRealmDashboardReserve",
);
requireEqual(
  contract.control?.maximumDashboardJobConnections +
    contract.control?.maximumDashboardServiceConnections,
  contract.control?.maximumActiveDashboardConnections -
    contract.control?.minimumCrossRealmDashboardReserve,
  "control dashboard client pools plus cross-realm reserve",
);
requireEqual(
  contract.control?.maximumActiveDashboardConnections +
    contract.control?.minimumLifecycleConnectionReserve,
  contract.control?.maximumActiveConnections,
  "control native dashboard ceiling plus lifecycle reserve",
);
requireEqual(
  contract.control?.requestPreludeDeadlineMs,
  2_000,
  "control.requestPreludeDeadlineMs",
);
requireEqual(
  contract.control?.developmentRequestPreludeDeadlineMs,
  60_000,
  "control.developmentRequestPreludeDeadlineMs",
);
requireEqual(contract.control?.requestReadDeadlineMs, 2_000, "control.requestReadDeadlineMs");
requireEqual(
  contract.control?.responseWriteDeadlineMs,
  2_000,
  "control.responseWriteDeadlineMs",
);
requireEqual(
  contract.control?.responseDeadlineStartsAfterHandler,
  true,
  "control.responseDeadlineStartsAfterHandler",
);
requireEqual(
  contract.control?.overloadBehavior,
  "authenticated-dashboard-503-with-lifecycle-handler-reserve",
  "control.overloadBehavior",
);
requireStrings(
  contract.control?.authorityRoles?.lifecycle,
  ["status", "shutdown"],
  "control.authorityRoles.lifecycle",
);
requireStrings(
  contract.control?.authorityRoles?.dashboard,
  [
    "status",
    "submitJob",
    "lookupJob",
    "cancelJobByIdempotencyKey",
    "submitLearnRecovery",
    "inspectJob",
    "replayJobEvents",
    "cancelJob",
    "reserveJobInput",
    "uploadJobInput",
    "abandonJobInput",
    "readJobCheckpoint",
    "readJobResult",
    "readServiceLeaseContract",
    "acquireServiceLease",
    "releaseLease",
  ],
  "control.authorityRoles.dashboard",
);
requireEqual(
  contract.control?.authorityRoles?.bearersMustBeDistinct,
  true,
  "control.authorityRoles.bearersMustBeDistinct",
);
requireEqual(
  contract.control?.authorityRoles?.unclassifiedRoutes,
  "deny",
  "control.authorityRoles.unclassifiedRoutes",
);
requireEqual(contract.control?.status?.method, "GET", "control.status.method");
requireEqual(contract.control?.status?.path, "/v1/status", "control.status.path");
requireEqual(contract.control?.submitJob?.method, "POST", "control.submitJob.method");
requireEqual(contract.control?.submitJob?.path, "/v1/jobs", "control.submitJob.path");
requireEqual(contract.control?.lookupJob?.method, "POST", "control.lookupJob.method");
requireEqual(contract.control?.lookupJob?.path, "/v1/jobs/lookup", "control.lookupJob.path");
requireEqual(
  contract.control?.cancelJobByIdempotencyKey?.method,
  "POST",
  "control.cancelJobByIdempotencyKey.method",
);
requireEqual(
  contract.control?.cancelJobByIdempotencyKey?.path,
  "/v1/jobs/cancel-by-idempotency",
  "control.cancelJobByIdempotencyKey.path",
);
requireEqual(
  contract.control?.submitLearnRecovery?.method,
  "POST",
  "control.submitLearnRecovery.method",
);
requireEqual(
  contract.control?.submitLearnRecovery?.path,
  "/v1/internal/jobs/learn-recovery",
  "control.submitLearnRecovery.path",
);
requireEqual(contract.control?.inspectJob?.method, "GET", "control.inspectJob.method");
requireEqual(
  contract.control?.inspectJob?.pathTemplate,
  "/v1/jobs/{jobId}",
  "control.inspectJob.pathTemplate",
);
requireEqual(contract.control?.replayJobEvents?.method, "GET", "control.replayJobEvents.method");
requireEqual(
  contract.control?.replayJobEvents?.pathTemplate,
  "/v1/jobs/{jobId}/events?after={sequence}&limit={limit}",
  "control.replayJobEvents.pathTemplate",
);
requireEqual(contract.control?.cancelJob?.method, "POST", "control.cancelJob.method");
requireEqual(
  contract.control?.cancelJob?.pathTemplate,
  "/v1/jobs/{jobId}/cancel",
  "control.cancelJob.pathTemplate",
);
requireEqual(contract.control?.reserveJobInput?.method, "POST", "control.reserveJobInput.method");
requireEqual(
  contract.control?.reserveJobInput?.path,
  "/v1/job-inputs",
  "control.reserveJobInput.path",
);
requireEqual(contract.control?.uploadJobInput?.method, "PUT", "control.uploadJobInput.method");
requireEqual(
  contract.control?.uploadJobInput?.pathTemplate,
  "/v1/job-inputs/{uploadId}",
  "control.uploadJobInput.pathTemplate",
);
requireEqual(contract.control?.abandonJobInput?.method, "POST", "control.abandonJobInput.method");
requireEqual(
  contract.control?.abandonJobInput?.pathTemplate,
  "/v1/job-inputs/{uploadId}/abandon",
  "control.abandonJobInput.pathTemplate",
);
requireEqual(contract.control?.readJobCheckpoint?.method, "GET", "control.readJobCheckpoint.method");
requireEqual(
  contract.control?.readJobCheckpoint?.pathTemplate,
  "/v1/jobs/{jobId}/checkpoint",
  "control.readJobCheckpoint.pathTemplate",
);
requireEqual(contract.control?.readJobResult?.method, "GET", "control.readJobResult.method");
requireEqual(
  contract.control?.readJobResult?.pathTemplate,
  "/v1/jobs/{jobId}/result",
  "control.readJobResult.pathTemplate",
);
requireEqual(
  contract.control?.readServiceLeaseContract?.method,
  "GET",
  "control.readServiceLeaseContract.method",
);
requireEqual(
  contract.control?.readServiceLeaseContract?.pathTemplate,
  "/v1/services/{serviceId}/lease-contract",
  "control.readServiceLeaseContract.pathTemplate",
);
requireEqual(
  contract.control?.acquireServiceLease?.method,
  "POST",
  "control.acquireServiceLease.method",
);
requireEqual(
  contract.control?.acquireServiceLease?.pathTemplate,
  "/v1/services/{serviceId}/lease",
  "control.acquireServiceLease.pathTemplate",
);
requireEqual(contract.control?.releaseLease?.method, "POST", "control.releaseLease.method");
requireEqual(
  contract.control?.releaseLease?.pathTemplate,
  "/v1/leases/{leaseId}/release",
  "control.releaseLease.pathTemplate",
);
requireEqual(contract.control?.shutdown?.method, "POST", "control.shutdown.method");
requireEqual(contract.control?.shutdown?.path, "/v1/shutdown", "control.shutdown.path");
requireEqual(contract.control?.shutdownResponse?.ok, true, "control.shutdownResponse.ok");

const rustValues = {
  protocolVersion: sourceInteger(
    rust,
    /pub const RUNTIME_CONTROL_PROTOCOL_VERSION:\s*u32\s*=\s*([^;]+);/,
    "Rust protocol version",
  ),
  maximumLineBytes: sourceInteger(
    rust,
    /pub const MAX_PROTOCOL_LINE_BYTES:\s*usize\s*=\s*([^;]+);/,
    "Rust maximum line bytes",
  ),
  maximumRootBytes: sourceInteger(
    rust,
    /pub const MAX_RUNTIME_ROOT_BYTES:\s*usize\s*=\s*([^;]+);/,
    "Rust maximum root bytes",
  ),
  maximumUrlBytes: sourceInteger(
    rust,
    /pub const MAX_LOOPBACK_URL_BYTES:\s*usize\s*=\s*([^;]+);/,
    "Rust maximum URL bytes",
  ),
  maximumServices: sourceInteger(
    rust,
    /pub const MAX_MANIFEST_ENTRIES:\s*usize\s*=\s*([^;]+);/,
    "Rust maximum services",
  ),
  maximumIdBytes: sourceInteger(
    rust,
    /pub const MAX_IDENTIFIER_BYTES:\s*usize\s*=\s*([^;]+);/,
    "Rust maximum identifier bytes",
  ),
  maximumDisplayNameBytes: sourceInteger(
    rust,
    /pub const MAX_STAGE_BYTES:\s*usize\s*=\s*([^;]+);/,
    "Rust maximum display-name bytes",
  ),
  maximumErrorBytes: sourceInteger(
    rust,
    /pub const MAX_FAILURE_MESSAGE_BYTES:\s*usize\s*=\s*([^;]+);/,
    "Rust maximum error bytes",
  ),
  maximumRestarts: sourceInteger(
    rust,
    /pub const MAX_SERVICE_RESTARTS:\s*u32\s*=\s*([^;]+);/,
    "Rust maximum restarts",
  ),
  maximumTokenBytes: sourceInteger(
    rust,
    /pub const MAX_CONTROL_TOKEN_BYTES:\s*usize\s*=\s*([^;]+);/,
    "Rust maximum token bytes",
  ),
  minimumTokenBytes: sourceInteger(
    rust,
    /pub const MIN_CONTROL_TOKEN_BYTES:\s*usize\s*=\s*([^;]+);/,
    "Rust minimum token bytes",
  ),
  maximumRequestBodyBytes: sourceInteger(
    rust,
    /pub const MAX_REQUEST_BODY_BYTES:\s*usize\s*=\s*([^;]+);/,
    "Rust maximum job-submission body bytes",
  ),
  maximumJobLookupBodyBytes: sourceInteger(
    rust,
    /pub const MAX_JOB_LOOKUP_BODY_BYTES:\s*usize\s*=\s*([^;]+);/,
    "Rust maximum job-lookup body bytes",
  ),
  maximumJobIdempotencyCancellationBodyBytes: sourceInteger(
    rust,
    /pub const MAX_JOB_IDEMPOTENCY_CANCELLATION_BODY_BYTES:\s*usize\s*=\s*([^;]+);/,
    "Rust maximum idempotency-cancellation body bytes",
  ),
  maximumLearnRecoveryRequestBodyBytes: sourceInteger(
    rust,
    /pub const MAX_LEARN_RECOVERY_REQUEST_BODY_BYTES:\s*usize\s*=\s*([^;]+);/,
    "Rust maximum Learn-recovery request body bytes",
  ),
  maximumServiceLeaseRequestBodyBytes: sourceInteger(
    rust,
    /pub const MAX_SERVICE_LEASE_REQUEST_BODY_BYTES:\s*usize\s*=\s*([^;]+);/,
    "Rust maximum service-lease body bytes",
  ),
  maximumServiceLeaseReasonBytes: sourceInteger(
    rust,
    /pub const MAX_SERVICE_LEASE_REASON_BYTES:\s*usize\s*=\s*([^;]+);/,
    "Rust maximum service-lease reason bytes",
  ),
  maximumManifestServiceStartupMs: sourceInteger(
    rust,
    /pub const MAX_TIMEOUT_MS:\s*u64\s*=\s*([^;]+);/,
    "Rust maximum manifest service startup timeout",
  ),
  serviceLeaseSettlementGraceMs: sourceInteger(
    rust,
    /pub const SERVICE_LEASE_SETTLEMENT_GRACE_MS:\s*u64\s*=\s*([^;]+);/,
    "Rust service-lease settlement grace",
  ),
  serviceLeaseResponseGraceMs: sourceInteger(
    rust,
    /pub const SERVICE_LEASE_RESPONSE_GRACE_MS:\s*u64\s*=\s*([^;]+);/,
    "Rust service-lease response grace",
  ),
  maximumIdempotencyKeyBytes: sourceInteger(
    rust,
    /pub const MAX_IDEMPOTENCY_KEY_BYTES:\s*usize\s*=\s*([^;]+);/,
    "Rust maximum idempotency-key bytes",
  ),
  maximumScopeIdBytes: sourceInteger(
    rust,
    /pub const MAX_SCOPE_ID_BYTES:\s*usize\s*=\s*([^;]+);/,
    "Rust maximum scope-ID bytes",
  ),
  maximumJobEventReplayRecords: sourceInteger(
    rust,
    /pub const MAX_JOB_EVENT_REPLAY_RECORDS:\s*usize\s*=\s*([^;]+);/,
    "Rust maximum job-event replay records",
  ),
  maximumJsonSafeInteger: sourceInteger(
    rust,
    /pub const MAX_JSON_SAFE_INTEGER:\s*u64\s*=\s*([^;]+);/,
    "Rust maximum JSON-safe integer",
  ),
};
const rustInputQuotaValues = {
  perOwnerMaximumCount: sourceInteger(
    rustInputUploads,
    /pub const MAX_UNCLEANED_JOB_INPUT_UPLOADS_PER_OWNER:\s*u64\s*=\s*([^;]+);/,
    "Rust per-owner uncleaned input count",
  ),
  perOwnerMaximumDeclaredBytes: sourceInteger(
    rustInputUploads,
    /pub const MAX_UNCLEANED_JOB_INPUT_BYTES_PER_OWNER:\s*u64\s*=\s*([^;]+);/,
    "Rust per-owner uncleaned input bytes",
  ),
  globalMaximumCount: sourceInteger(
    rustInputUploads,
    /pub const MAX_UNCLEANED_JOB_INPUT_UPLOADS_GLOBAL:\s*u64\s*=\s*([^;]+);/,
    "Rust global uncleaned input count",
  ),
  globalMaximumDeclaredBytes: sourceInteger(
    rustInputUploads,
    /pub const MAX_UNCLEANED_JOB_INPUT_BYTES_GLOBAL:\s*u64\s*=\s*([^;]+);/,
    "Rust global uncleaned input bytes",
  ),
};
const rustIdempotencyCancellationValues = {
  tombstoneTtlMs: sourceInteger(
    rustStore,
    /pub const JOB_IDEMPOTENCY_CANCELLATION_TTL_MS:\s*i64\s*=\s*([^;]+);/,
    "Rust idempotency-cancellation tombstone TTL",
  ),
  perOwnerMaximumCount: sourceInteger(
    rustStore,
    /pub const MAX_IDEMPOTENCY_CANCELLATIONS_PER_OWNER:\s*u64\s*=\s*([^;]+);/,
    "Rust per-owner idempotency-cancellation quota",
  ),
  globalMaximumCount: sourceInteger(
    rustStore,
    /pub const MAX_IDEMPOTENCY_CANCELLATIONS_GLOBAL:\s*u64\s*=\s*([^;]+);/,
    "Rust global idempotency-cancellation quota",
  ),
  maximumCleanupBatch: sourceInteger(
    rustStore,
    /pub const MAX_IDEMPOTENCY_CANCELLATION_CLEANUP_BATCH:\s*usize\s*=\s*([^;]+);/,
    "Rust idempotency-cancellation cleanup batch",
  ),
};
requireEqual(rustValues.protocolVersion, contract.protocolVersion, "Rust protocol version parity");
requireEqual(rustValues.maximumLineBytes, contract.transport?.maximumLineBytes, "Rust line limit parity");
requireEqual(rustValues.maximumRootBytes, contract.bootstrap?.maximumRootBytes, "Rust root limit parity");
requireEqual(rustValues.maximumUrlBytes, 2_048, "Rust URL limit parity");
requireEqual(rustValues.maximumServices, contract.serviceStatus?.maximumRecords, "Rust service limit parity");
requireEqual(rustValues.maximumIdBytes, contract.serviceStatus?.maximumIdBytes, "Rust ID limit parity");
requireEqual(
  rustValues.maximumDisplayNameBytes,
  contract.serviceStatus?.maximumDisplayNameBytes,
  "Rust display-name limit parity",
);
requireEqual(rustValues.maximumErrorBytes, contract.serviceStatus?.maximumLastErrorBytes, "Rust error limit parity");
requireEqual(rustValues.maximumRestarts, contract.serviceStatus?.maximumRestarts, "Rust restart limit parity");
requireEqual(rustValues.maximumTokenBytes, contract.control?.maximumTokenBytes, "Rust token limit parity");
requireEqual(rustValues.minimumTokenBytes, contract.control?.minimumTokenBytes, "Rust minimum-token parity");
requireEqual(
  rustValues.maximumRequestBodyBytes,
  contract.jobSubmission?.maximumBodyBytes,
  "Rust job-submission body limit parity",
);
requireEqual(
  rustValues.maximumJobLookupBodyBytes,
  contract.jobLookup?.maximumBodyBytes,
  "Rust job-lookup body limit parity",
);
requireEqual(
  rustValues.maximumJobIdempotencyCancellationBodyBytes,
  contract.jobIdempotencyCancellation?.maximumBodyBytes,
  "Rust idempotency-cancellation body limit parity",
);
requireEqual(
  rustValues.maximumLearnRecoveryRequestBodyBytes,
  contract.learnRecoverySubmission?.maximumBodyBytes,
  "Rust Learn-recovery body limit parity",
);
requireEqual(
  rustValues.maximumServiceLeaseRequestBodyBytes,
  contract.serviceLeaseControl?.maximumBodyBytes,
  "Rust service-lease body limit parity",
);
requireEqual(
  rustValues.maximumServiceLeaseReasonBytes,
  contract.serviceLeaseControl?.maximumReasonBytes,
  "Rust service-lease reason limit parity",
);
requireEqual(
  rustValues.maximumManifestServiceStartupMs,
  contract.serviceLeaseControl?.acquireDeadline?.maximumManifestStartupMs,
  "Rust service startup-timeout limit parity",
);
requireEqual(
  rustValues.serviceLeaseSettlementGraceMs,
  contract.serviceLeaseControl?.acquireDeadline?.settlementGraceMs,
  "Rust service-lease settlement-grace parity",
);
requireEqual(
  rustValues.serviceLeaseResponseGraceMs,
  contract.serviceLeaseControl?.acquireDeadline?.responseGraceMs,
  "Rust service-lease response-grace parity",
);
requireEqual(
  rustValues.maximumIdBytes,
  contract.jobSubmission?.maximumJobTypeBytes,
  "Rust job-type limit parity",
);
requireEqual(
  rustValues.maximumIdempotencyKeyBytes,
  contract.jobSubmission?.maximumIdempotencyKeyBytes,
  "Rust idempotency-key limit parity",
);
requireEqual(
  rustValues.maximumScopeIdBytes,
  contract.jobSubmission?.maximumScopeIdBytes,
  "Rust scope-ID limit parity",
);
requireEqual(
  rustValues.maximumJobEventReplayRecords,
  contract.jobEvents?.maximumRecords,
  "Rust job-event replay limit parity",
);
requireEqual(
  rustValues.maximumJsonSafeInteger,
  contract.control?.maximumJsonSafeInteger,
  "Rust JSON-safe integer parity",
);
for (const [field, value] of Object.entries(rustInputQuotaValues)) {
  requireEqual(
    value,
    contract.jobInputUploads?.aggregateQuota?.[field],
    `Rust input quota ${field} parity`,
  );
}
requireEqual(
  rustIdempotencyCancellationValues.tombstoneTtlMs,
  contract.jobIdempotencyCancellation?.tombstoneTtlMs,
  "Rust idempotency-cancellation TTL parity",
);
requireEqual(
  rustIdempotencyCancellationValues.perOwnerMaximumCount,
  contract.jobIdempotencyCancellation?.aggregateQuota?.perOwnerMaximumCount,
  "Rust per-owner idempotency-cancellation quota parity",
);
requireEqual(
  rustIdempotencyCancellationValues.globalMaximumCount,
  contract.jobIdempotencyCancellation?.aggregateQuota?.globalMaximumCount,
  "Rust global idempotency-cancellation quota parity",
);
requireEqual(
  rustIdempotencyCancellationValues.maximumCleanupBatch,
  contract.jobIdempotencyCancellation?.onlineCleanup?.maximumBatch,
  "Rust idempotency-cancellation cleanup batch parity",
);
requireStrings(rustEnumWireValues(rust, "RuntimeMode", "Rust runtime modes"), modes, "Rust runtime modes");
requireStrings(
  rustEnumWireValues(rust, "RuntimeServiceState", "Rust service states"),
  serviceStates,
  "Rust service states",
);
requireStrings(
  rustEnumSnakeWireValues(rust, "JobState", "Rust job states"),
  jobStates,
  "Rust job states",
);
requireStrings(
  rustEnumWireValues(rust, "ResourceClass", "Rust resource classes"),
  resourceClasses,
  "Rust resource classes",
);
requireStrings(
  rustEnumWireValues(rust, "RuntimePublicStage", "Rust public job stages"),
  publicStages,
  "Rust public job stages",
);
requireStrings(
  rustEnumWireValues(rust, "RuntimePublicArtifactKind", "Rust public artifact kinds"),
  publicArtifactKinds,
  "Rust public artifact kinds",
);
requireStrings(
  rustEnumExplicitRenameWireValues(
    rust,
    "RuntimePublicFailureCode",
    "Rust public failure codes",
  ),
  publicFailureCodes,
  "Rust public failure codes",
);
requireStrings(
  rustEnumWireValues(rust, "RuntimeJobEventType", "Rust runtime job event types"),
  jobEventTypes,
  "Rust runtime job event types",
);
requirePattern(rust, /tag\s*=\s*"type"[\s\S]*?rename_all_fields\s*=\s*"camelCase"[\s\S]*?pub enum RuntimeBootstrapMessage/, "Rust bootstrap must use a tagged camelCase wire shape");
requirePattern(rust, /pub enum RuntimeBootstrapMessage\s*\{\s*RuntimeBootstrap\s*\{[\s\S]*?protocol_version:[\s\S]*?mode:[\s\S]*?app_root:[\s\S]*?runtime_root:[\s\S]*?data_root:[\s\S]*?config_root:[\s\S]*?\}\s*,?\s*\}/, "Rust bootstrap fields do not match the contract");
requirePattern(
  rust,
  /validate_root_text\("appRoot",\s*app_root\)[\s\S]*?validate_root_text\("runtimeRoot",\s*runtime_root\)[\s\S]*?validate_root_text\("dataRoot",\s*data_root\)/,
  "Rust bootstrap does not validate runtimeRoot with the shared root grammar",
);
requirePattern(rust, /pub enum RuntimeReadyMessage\s*\{\s*RuntimeReady\s*\{[\s\S]*?protocol_version:[\s\S]*?runtime_pid:[\s\S]*?control_base_url:[\s\S]*?control_token:[\s\S]*?dashboard_url:[\s\S]*?services:[\s\S]*?\}\s*,?\s*\}/, "Rust ready fields do not match the contract");
requirePattern(rust, /pub enum RuntimeStatusMessage\s*\{\s*RuntimeStatus\s*\{[\s\S]*?protocol_version:[\s\S]*?runtime_pid:[\s\S]*?accepting_work:[\s\S]*?services:[\s\S]*?\}\s*,?\s*\}/, "Rust status fields do not match the contract");
requirePattern(rust, /pub struct RuntimeCommandAck\s*\{\s*pub ok:\s*bool,?\s*\}/, "Rust shutdown acknowledgement must contain only ok");
requirePattern(
  rust,
  /#\[serde\(rename_all\s*=\s*"camelCase",\s*deny_unknown_fields\)\]\s*pub struct JobSubmissionPayload/,
  "Rust job submission must reject unknown fields",
);
requireStrings(
  rustPublicStructWireFields(rust, "JobSubmissionPayload", "Rust job submission payload"),
  jobSubmissionFields,
  "Rust job-submission fields",
);
requirePattern(
  rust,
  /pub struct JobSubmissionPayload\s*\{[\s\S]*?pub garden_id:\s*Option<String>[\s\S]*?pub conversation_id:\s*Option<String>/,
  "Rust job-submission scope fields must remain optional",
);
requirePattern(
  rust,
  /impl JobSubmissionPayload\s*\{[\s\S]*?validate_identifier\("jobType",\s*&self\.job_type\)[\s\S]*?validate_scope_id\("gardenId",\s*garden_id\)[\s\S]*?validate_scope_id\("conversationId",\s*conversation_id\)[\s\S]*?MAX_IDEMPOTENCY_KEY_BYTES/,
  "Rust job-submission fields must use the bounded identifier, scope, and idempotency validators",
);
requirePattern(
  rust,
  /pub fn parse_job_submission_payload[\s\S]*?parse_bounded_json\(bytes,\s*JobSubmissionPayload::validate\)/,
  "Rust job submission must use the bounded validated body parser",
);
requirePattern(
  rust,
  /fn parse_bounded_json[\s\S]*?parse_bounded_json_with_limit\(bytes,\s*MAX_REQUEST_BODY_BYTES,\s*validate\)[\s\S]*?fn parse_bounded_json_with_limit[\s\S]*?if bytes\.len\(\) > maximum_body_bytes/,
  "Rust bounded body parser must enforce MAX_REQUEST_BODY_BYTES before deserialization",
);
requirePattern(
  rust,
  /pub fn validate_identifier[\s\S]*?value\.len\(\) > MAX_IDENTIFIER_BYTES/,
  "Rust job-type identifier validation must enforce MAX_IDENTIFIER_BYTES",
);
requirePattern(
  rust,
  /pub fn validate_scope_id[\s\S]*?value\.len\(\) > MAX_SCOPE_ID_BYTES[\s\S]*?\(b'!'\.\.=b'~'\)\.contains\(&byte\)/,
  "Rust scope validation must enforce the shared bounded visible-ASCII grammar",
);
const rustJobSubmissionBlock = sourceBlock(
  rust,
  /pub struct JobSubmissionPayload\s*\{/,
  "Rust job submission payload",
);
for (const field of jobSubmissionForbiddenAuthorityFields) {
  const rustField = field.replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`);
  requireAbsent(
    rustJobSubmissionBlock,
    new RegExp(`\\b${rustField}\\s*:`),
    `Rust job submission exposes forbidden authority field ${field}`,
  );
}
requireStrings(
  rustPublicStructWireFields(rust, "RuntimeJobLookupRequest", "Rust job lookup request"),
  ["idempotencyKey"],
  "Rust job-lookup fields",
);
requirePattern(
  rust,
  /#\[serde\(rename_all\s*=\s*"camelCase",\s*deny_unknown_fields\)\]\s*pub struct RuntimeJobLookupRequest/,
  "Rust job lookup must reject authority and unknown fields",
);
requirePattern(
  rust,
  /pub fn parse_runtime_job_lookup_request[\s\S]*?parse_bounded_json_with_limit\([\s\S]*?MAX_JOB_LOOKUP_BODY_BYTES[\s\S]*?RuntimeJobLookupRequest::validate/,
  "Rust job lookup does not use its narrow bounded parser",
);
requireStrings(
  rustPublicStructWireFields(
    rust,
    "RuntimeJobIdempotencyCancellationRequest",
    "Rust idempotency-cancellation request",
  ),
  ["idempotencyKey"],
  "Rust idempotency-cancellation request fields",
);
requireStrings(
  rustPublicStructWireFields(rust, "RuntimeLearnRecoveryRequest", "Rust Learn-recovery request"),
  ["idempotencyKey"],
  "Rust Learn-recovery request fields",
);
for (const structName of [
  "RuntimeJobIdempotencyCancellationRequest",
  "RuntimeLearnRecoveryRequest",
]) {
  requirePattern(
    rust,
    new RegExp(
      `#\\[serde\\(rename_all\\s*=\\s*"camelCase",\\s*deny_unknown_fields\\)\\]\\s*pub struct ${structName}`,
    ),
    `Rust ${structName} must reject unknown or caller-authority fields`,
  );
}
requirePattern(
  rust,
  /pub fn parse_runtime_job_idempotency_cancellation_request[\s\S]*?parse_bounded_json_with_limit\([\s\S]*?MAX_JOB_IDEMPOTENCY_CANCELLATION_BODY_BYTES[\s\S]*?RuntimeJobIdempotencyCancellationRequest::validate/,
  "Rust idempotency cancellation does not use its narrow bounded parser",
);
requirePattern(
  rust,
  /impl RuntimeJobIdempotencyCancellationRequest[\s\S]*?MAX_IDEMPOTENCY_KEY_BYTES[\s\S]*?char::is_control/,
  "Rust idempotency cancellation does not use the shared bounded key grammar",
);
requirePattern(
  rust,
  /pub fn parse_runtime_learn_recovery_request[\s\S]*?parse_bounded_json_with_limit\([\s\S]*?MAX_LEARN_RECOVERY_REQUEST_BODY_BYTES[\s\S]*?RuntimeLearnRecoveryRequest::validate/,
  "Rust Learn recovery does not use its narrow bounded parser",
);
requirePattern(
  rust,
  /impl RuntimeLearnRecoveryRequest[\s\S]*?"learn-recovery-v2:"[\s\S]*?generation\.is_empty\(\)[\s\S]*?is_ascii_digit\(\)[\s\S]*?generation\.len\(\) > 16[\s\S]*?MAX_JSON_SAFE_INTEGER/,
  "Rust Learn recovery key grammar is not fixed to a bounded decimal generation",
);
requireStrings(
  rustEnumSnakeWireValues(
    rust,
    "RuntimeJobIdempotencyCancellationState",
    "Rust idempotency-cancellation states",
  ),
  ["pending", ...jobStates],
  "Rust idempotency-cancellation state domain",
);
requirePattern(
  rust,
  /pub enum RuntimeJobIdempotencyCancellationResponse\s*\{\s*RuntimeJobIdempotencyCancellation\s*\{[\s\S]*?protocol_version:[\s\S]*?deserialize_required_nullable[\s\S]*?job_id:\s*Option<String>[\s\S]*?state:\s*RuntimeJobIdempotencyCancellationState[\s\S]*?accepted:\s*bool[\s\S]*?\}\s*,?\s*\}/,
  "Rust idempotency-cancellation response fields do not match the contract",
);
requirePattern(
  rust,
  /impl RuntimeJobIdempotencyCancellationResponse[\s\S]*?RuntimeJobIdempotencyCancellationState::Pending\s*=>\s*job_id\.is_none\(\)\s*&&\s*\*accepted[\s\S]*?Cancelling[\s\S]*?Cancelled\s*=>\s*job_id\.is_some\(\)\s*&&\s*\*accepted[\s\S]*?Succeeded[\s\S]*?Uncertain\s*=>\s*job_id\.is_some\(\)\s*&&\s*!\*accepted[\s\S]*?Queued[\s\S]*?Checkpointing\s*=>\s*false/,
  "Rust idempotency-cancellation response does not enforce the closed disposition matrix",
);
requirePattern(
  rust,
  /pub fn parse_runtime_job_idempotency_cancellation_response[\s\S]*?parse_bounded_control_json\(bytes,\s*RuntimeJobIdempotencyCancellationResponse::validate\)/,
  "Rust idempotency-cancellation response is not bounded and validated",
);
requireStrings(
  rustPublicStructWireFields(
    rust,
    "RuntimeServiceLeaseAcquireRequest",
    "Rust service-lease acquire request",
  ),
  serviceLeaseAcquireRequestFields,
  "Rust service-lease acquire request fields",
);
requireStrings(
  rustPublicStructWireFields(
    rust,
    "RuntimeServiceLeaseAcquireResponse",
    "Rust service-lease acquire response",
  ),
  serviceLeaseAcquireResponseFields,
  "Rust service-lease acquire response fields",
);
requireStrings(
  rustPublicStructWireFields(
    rust,
    "RuntimeServiceLeaseContractResponse",
    "Rust service-lease deadline contract response",
  ),
  serviceLeaseContractResponseFields,
  "Rust service-lease deadline contract response fields",
);
requireStrings(
  rustPublicStructWireFields(
    rust,
    "RuntimeServiceLeaseReleaseRequest",
    "Rust service-lease release request",
  ),
  [],
  "Rust service-lease release request fields",
);
requireStrings(
  rustPublicStructWireFields(
    rust,
    "RuntimeServiceLeaseReleaseResponse",
    "Rust service-lease release response",
  ),
  serviceLeaseReleaseResponseFields,
  "Rust service-lease release response fields",
);
for (const structName of [
  "RuntimeServiceLeaseAcquireRequest",
  "RuntimeServiceLeaseAcquireResponse",
  "RuntimeServiceLeaseContractResponse",
  "RuntimeServiceLeaseReleaseRequest",
  "RuntimeServiceLeaseReleaseResponse",
]) {
  requirePattern(
    rust,
    new RegExp(
      `#\\[serde\\((?:rename_all\\s*=\\s*"camelCase",\\s*)?deny_unknown_fields\\)\\]\\s*pub struct ${structName}`,
    ),
    `Rust ${structName} must reject unknown fields`,
  );
}
requirePattern(
  rust,
  /impl RuntimeServiceLeaseAcquireRequest[\s\S]*?MAX_SERVICE_LEASE_REASON_BYTES[\s\S]*?self\.reason\.trim\(\)\.is_empty\(\)[\s\S]*?self\.reason\.chars\(\)\.any\(char::is_control\)/,
  "Rust service-lease reasons do not enforce the closed bounded text grammar",
);
requirePattern(
  rust,
  /pub fn parse_runtime_service_lease_acquire_request[\s\S]*?parse_bounded_json_with_limit\([\s\S]*?MAX_SERVICE_LEASE_REQUEST_BODY_BYTES[\s\S]*?RuntimeServiceLeaseAcquireRequest::validate/,
  "Rust service-lease acquire requests do not use their narrow bounded parser",
);
requirePattern(
  rust,
  /pub fn parse_runtime_service_lease_release_request[\s\S]*?parse_bounded_json_with_limit\([\s\S]*?MAX_SERVICE_LEASE_REQUEST_BODY_BYTES[\s\S]*?RuntimeServiceLeaseReleaseRequest::validate/,
  "Rust service-lease release requests do not use their narrow bounded parser",
);
requirePattern(
  rust,
  /pub fn parse_runtime_service_lease_acquire_response[\s\S]*?parse_bounded_control_json\(bytes,\s*RuntimeServiceLeaseAcquireResponse::validate\)/,
  "Rust service-lease acquire responses do not use the bounded control parser",
);
requirePattern(
  rust,
  /pub fn parse_runtime_service_lease_contract_response[\s\S]*?parse_bounded_control_json\(bytes,\s*RuntimeServiceLeaseContractResponse::validate\)/,
  "Rust service-lease deadline contract responses do not use the bounded control parser",
);
requirePattern(
  rust,
  /pub fn parse_runtime_service_lease_release_response[\s\S]*?parse_bounded_control_json\(bytes,\s*RuntimeServiceLeaseReleaseResponse::validate\)/,
  "Rust service-lease release responses do not use the bounded control parser",
);
requirePattern(
  rust,
  /impl RuntimeServiceLeaseAcquireResponse[\s\S]*?if !self\.ok[\s\S]*?validate_identifier\("leaseId",\s*&self\.lease_id\)[\s\S]*?validate_identifier\("serviceId",\s*&self\.service_id\)/,
  "Rust service-lease acquire responses are not literal-true and identifier bounded",
);
requirePattern(
  rust,
  /impl RuntimeServiceLeaseContractResponse[\s\S]*?validate_runtime_control_version\(self\.protocol_version\)[\s\S]*?validate_identifier\("serviceId",\s*&self\.service_id\)[\s\S]*?self\.acquire_timeout_ms[\s\S]*?MAX_SERVICE_LEASE_ACQUIRE_TIMEOUT_MS/,
  "Rust service-lease deadline contracts are not versioned, service-bound, and bounded",
);
requirePattern(
  rust,
  /pub const MAX_SERVICE_LEASE_ACQUIRE_TIMEOUT_MS:\s*u64\s*=\s*MAX_TIMEOUT_MS\s*\+\s*SERVICE_LEASE_SETTLEMENT_GRACE_MS\s*\+\s*SERVICE_LEASE_RESPONSE_GRACE_MS\s*;/,
  "Rust maximum service-acquire timeout is not derived from manifest and runtime grace bounds",
);
requirePattern(
  rust,
  /impl RuntimeServiceLeaseReleaseResponse[\s\S]*?if self\.ok[\s\S]*?InvalidRange\s*\{\s*field:\s*"ok"\s*\}/,
  "Rust service-lease release responses must reject ok=false",
);
requireStrings(
  rustPublicStructWireFields(rust, "RuntimeJobStatus", "Rust runtime job status"),
  jobStatusFields,
  "Rust runtime-job status fields",
);
const rustJobStatusBlock = sourceBlock(
  rust,
  /pub struct RuntimeJobStatus\s*\{/,
  "Rust runtime job status",
);
requirePattern(
  rustJobStatusBlock,
  /pub stage:\s*Option<RuntimePublicStage>/,
  "Rust runtime job status stage is not the closed public-stage enum",
);
requirePattern(
  rustJobStatusBlock,
  /pub failure_code:\s*Option<RuntimePublicFailureCode>/,
  "Rust runtime job status failure code is not the closed runtime-owned enum",
);
requirePattern(
  rust,
  /impl RuntimeJobStatus\s*\{[\s\S]*?let failure_valid\s*=\s*match \(self\.failure_code,\s*self\.failure_message\.as_deref\(\)\)[\s\S]*?\(None,\s*None\)\s*=>\s*true[\s\S]*?Some\(SANITIZED_RUNTIME_FAILURE_MESSAGE\)[\s\S]*?JobState::Failed,\s*RuntimePublicFailureCode::RuntimeJobFailed[\s\S]*?JobState::Failed,\s*RuntimePublicFailureCode::WorkerFailed[\s\S]*?JobState::ResourceExhausted,[\s\S]*?RuntimePublicFailureCode::ResourceExhausted[\s\S]*?JobState::Interrupted,\s*RuntimePublicFailureCode::Interrupted[\s\S]*?JobState::Uncertain,\s*RuntimePublicFailureCode::Uncertain[\s\S]*?_\s*=>\s*false/,
  "Rust runtime-job status does not bind closed failure codes to state and the one sanitized message",
);
for (const field of jobStatusForbiddenFields) {
  const rustField = field.replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`);
  requireAbsent(
    rustJobStatusBlock,
    new RegExp(`\\b${rustField}\\s*:`),
    `Rust runtime job status exposes forbidden field ${field}`,
  );
}
requireStrings(
  rustPublicStructWireFields(rust, "RuntimeJobEventRecord", "Rust runtime job event"),
  jobEventFields,
  "Rust runtime-job event fields",
);
requireStrings(
  rustPublicStructWireFields(rust, "RuntimeJobEventPayload", "Rust runtime job event payload"),
  jobEventPayloadFields,
  "Rust runtime-job event payload fields",
);
const rustJobEventPayloadBlock = sourceBlock(
  rust,
  /pub struct RuntimeJobEventPayload\s*\{/,
  "Rust runtime job event payload",
);
requirePattern(
  rustJobEventPayloadBlock,
  /pub stage:\s*Option<RuntimePublicStage>/,
  "Rust event payload stage is not the closed public-stage enum",
);
requirePattern(
  rustJobEventPayloadBlock,
  /pub artifact_kind:\s*Option<RuntimePublicArtifactKind>/,
  "Rust event payload artifact kind is not the closed runtime-owned enum",
);
requirePattern(
  rustJobEventPayloadBlock,
  /pub failure_code:\s*Option<RuntimePublicFailureCode>/,
  "Rust event payload failure code is not the closed runtime-owned enum",
);
for (const field of jobEventPayloadForbiddenFields) {
  const rustField = field.replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`);
  requireAbsent(
    rustJobEventPayloadBlock,
    new RegExp(`\\b${rustField}\\s*:`),
    `Rust runtime job event payload exposes forbidden field ${field}`,
  );
}
const rustJobEventRecordBlock = sourceBlock(
  rust,
  /pub struct RuntimeJobEventRecord\s*\{/,
  "Rust runtime job event record",
);
requirePattern(
  rustJobEventRecordBlock,
  /pub event_type:\s*RuntimeJobEventType/,
  "Rust runtime job event record does not use the closed event-type enum",
);
requirePattern(
  rust,
  /impl RuntimeJobEventPayload\s*\{[\s\S]*?pub fn validate_for\(\s*&self,\s*event_type:\s*RuntimeJobEventType\s*\)/,
  "Rust event payload does not validate against its typed event discriminator",
);
requirePattern(
  rust,
  /impl RuntimeJobEventRecord\s*\{[\s\S]*?self\.payload\.validate_for\(self\.event_type\)\?/,
  "Rust event records do not apply exact payload validation for their typed discriminator",
);
const rustEventFenceBlock = sourceBlock(
  rust,
  /const fn fence_kind\(self\)\s*->\s*RuntimeJobEventFenceKind\s*\{/,
  "Rust typed runtime-job event fence matrix",
);
requireStrings(
  rustAliasedVariants(rustEventFenceBlock, "Self"),
  jobEventTypes,
  "Rust typed runtime-job event fence coverage",
  false,
);
const actualRustFenceGroups = {};
for (const match of rustEventFenceBlock.matchAll(
  /((?:Self::[A-Z][A-Za-z0-9]*\s*(?:\|\s*)?)+)\s*=>\s*RuntimeJobEventFenceKind::([A-Z][A-Za-z0-9]*)/g,
)) {
  actualRustFenceGroups[pascalToKebab(match[2])] = rustAliasedVariants(match[1], "Self");
}
for (const fence of Object.keys(jobEventFenceRules)) {
  const expectedEvents = jobEventTypes.filter((eventType) => jobEventRules[eventType].fence === fence);
  requireStrings(
    actualRustFenceGroups[fence],
    expectedEvents,
    `Rust ${fence} event-fence group`,
    false,
  );
}
requireAbsent(
  rustEventFenceBlock,
  /(?:^|[=>|,])\s*_\s*=>/,
  "Rust typed event-fence matrix contains a wildcard fallback",
);
const rustEventPayloadValidationBlock = sourceBlock(
  rust,
  /pub fn validate_for\(\s*&self,\s*event_type:\s*RuntimeJobEventType\s*\)/,
  "Rust exact runtime-job event payload matrix",
);
requireStrings(
  rustAliasedVariants(rustEventPayloadValidationBlock, "Event"),
  jobEventTypes,
  "Rust exact runtime-job event payload coverage",
  false,
);
const actualRustStateEvents = new Map();
for (const match of rustEventPayloadValidationBlock.matchAll(
  /((?:Event::[A-Z][A-Za-z0-9]*\s*(?:\|\s*)?)+)\s*=>\s*(?:\{\s*)?self\.is_exact_state\(JobState::([A-Z][A-Za-z0-9]*)\)/g,
)) {
  for (const eventType of rustAliasedVariants(match[1], "Event")) {
    actualRustStateEvents.set(eventType, pascalToSnake(match[2]));
  }
}
const rustEmptyPayloadMatch = rustEventPayloadValidationBlock.match(
  /((?:Event::[A-Z][A-Za-z0-9]*\s*(?:\|\s*)?)+)\s*=>\s*\{\s*self\s*==\s*&Self::default\(\)/,
);
const actualRustEmptyEvents = rustEmptyPayloadMatch
  ? rustAliasedVariants(rustEmptyPayloadMatch[1], "Event")
  : [];
if (!rustEmptyPayloadMatch) fail("Rust event payload matrix has no exact empty-payload group");
for (const eventType of jobEventTypes) {
  const payload = jobEventRules[eventType].payload;
  const variants = payload.exactVariants ?? [payload];
  if (
    variants.length === 1 &&
    variants[0].exactFields.length === 1 &&
    variants[0].exactFields[0] === "state"
  ) {
    requireEqual(
      actualRustStateEvents.get(eventType),
      variants[0].fixed.state,
      `Rust ${eventType} fixed-state payload`,
    );
  } else if (variants.length === 1 && variants[0].exactFields.length === 0) {
    if (!actualRustEmptyEvents.includes(eventType)) {
      fail(`Rust ${eventType} is missing from the exact empty-payload group`);
    }
  }
}
requirePattern(
  rustEventPayloadValidationBlock,
  /Event::WorkerReady\s*=>\s*\{[\s\S]*?self\.is_exact_state\(JobState::Running\)[\s\S]*?self\.is_exact_state\(JobState::Cancelling\)/,
  "Rust worker-ready payload does not preserve the exact cancelling alternative",
);
requirePattern(
  rustEventPayloadValidationBlock,
  /Event::WorkerHeartbeat\s*=>\s*\{[\s\S]*?self\.stage\.is_some\(\)[\s\S]*?self\.state\.is_none\(\)[\s\S]*?self\.progress_current\.is_none\(\)[\s\S]*?self\.progress_total\.is_none\(\)[\s\S]*?self\.artifact_kind\.is_none\(\)[\s\S]*?self\.failure_code\.is_none\(\)[\s\S]*?self\.failure_message\.is_none\(\)/,
  "Rust worker-heartbeat payload is not exactly one public stage",
);
requirePattern(
  rustEventPayloadValidationBlock,
  /Event::WorkerProgress\s*=>\s*\{[\s\S]*?self\.stage\.is_some\(\)[\s\S]*?\(self\.progress_current,\s*self\.progress_total\)[\s\S]*?Some\(current\),\s*Some\(total\)[\s\S]*?total > 0[\s\S]*?current <= total[\s\S]*?total <= MAX_JSON_SAFE_INTEGER[\s\S]*?self\.state\.is_none\(\)[\s\S]*?self\.artifact_kind\.is_none\(\)[\s\S]*?self\.failure_code\.is_none\(\)[\s\S]*?self\.failure_message\.is_none\(\)/,
  "Rust worker-progress payload is not exactly public stage plus bounded progress",
);
requirePattern(
  rustEventPayloadValidationBlock,
  /Event::WorkerCheckpoint\s*\|\s*Event::WorkerArtifact\s*=>\s*\{[\s\S]*?self\.artifact_kind\.is_some\(\)[\s\S]*?self\.state\.is_none\(\)[\s\S]*?self\.stage\.is_none\(\)[\s\S]*?self\.progress_current\.is_none\(\)[\s\S]*?self\.progress_total\.is_none\(\)[\s\S]*?self\.failure_code\.is_none\(\)[\s\S]*?self\.failure_message\.is_none\(\)/,
  "Rust worker artifact payloads are not exactly one closed runtime-owned artifact kind",
);
requirePattern(
  rustEventPayloadValidationBlock,
  /Event::WorkerFailed\s*=>\s*\{[\s\S]*?self\.state\s*==\s*Some\(JobState::Failed\)[\s\S]*?self\.failure_code\s*==\s*Some\(RuntimePublicFailureCode::WorkerFailed\)[\s\S]*?self\.failure_message\.as_deref\(\)\s*==\s*Some\(SANITIZED_RUNTIME_FAILURE_MESSAGE\)[\s\S]*?self\.stage\.is_none\(\)[\s\S]*?self\.progress_current\.is_none\(\)[\s\S]*?self\.progress_total\.is_none\(\)[\s\S]*?self\.artifact_kind\.is_none\(\)[\s\S]*?self\.is_exact_state\(JobState::Cancelling\)/,
  "Rust worker-failed payload is not fixed to its runtime-owned code and sanitized message",
);
requirePattern(
  rust,
  /fn is_exact_state\(&self,\s*state:\s*JobState\)\s*->\s*bool\s*\{[\s\S]*?self\.state\s*==\s*Some\(state\)[\s\S]*?self\.stage\.is_none\(\)[\s\S]*?self\.progress_current\.is_none\(\)[\s\S]*?self\.progress_total\.is_none\(\)[\s\S]*?self\.artifact_kind\.is_none\(\)[\s\S]*?self\.failure_code\.is_none\(\)[\s\S]*?self\.failure_message\.is_none\(\)/,
  "Rust fixed-state event payloads permit extra fields",
);
requireAbsent(
  rustEventPayloadValidationBlock,
  /(?:^|[=>|,])\s*_\s*=>/,
  "Rust typed event-payload matrix contains a wildcard fallback",
);
requirePattern(
  rust,
  /impl RuntimeJobEventRecord\s*\{[\s\S]*?let worker_sequence_valid\s*=\s*match self\.worker_sequence[\s\S]*?Some\(value\)\s*=>\s*value > 0 && value <= MAX_JSON_SAFE_INTEGER[\s\S]*?RuntimeJobEventFenceKind::RuntimeZero\s*=>\s*\{[\s\S]*?self\.attempt == 0[\s\S]*?self\.worker_instance_id\.is_none\(\)[\s\S]*?self\.worker_sequence\.is_none\(\)[\s\S]*?RuntimeJobEventFenceKind::RuntimeAttempt\s*=>\s*\{[\s\S]*?self\.attempt > 0[\s\S]*?self\.worker_instance_id\.is_some\(\)[\s\S]*?self\.worker_sequence\.is_none\(\)[\s\S]*?RuntimeJobEventFenceKind::RuntimeCurrent\s*=>\s*\{[\s\S]*?self\.worker_sequence\.is_none\(\)[\s\S]*?self\.attempt == 0 && self\.worker_instance_id\.is_none\(\)[\s\S]*?self\.attempt > 0 && self\.worker_instance_id\.is_some\(\)[\s\S]*?RuntimeJobEventFenceKind::Worker\s*=>\s*\{[\s\S]*?self\.attempt > 0[\s\S]*?self\.worker_instance_id\.is_some\(\)[\s\S]*?self\.worker_sequence\.is_some\(\)/,
  "Rust event records do not enforce the exact four fence shapes",
);
requirePattern(
  rust,
  /pub enum RuntimeJobResponse\s*\{\s*RuntimeJob\s*\{[\s\S]*?protocol_version:[\s\S]*?job:\s*RuntimeJobStatus[\s\S]*?\}\s*,?\s*\}/,
  "Rust runtime-job response fields do not match the contract",
);
requirePattern(
  rust,
  /pub enum RuntimeJobEventsResponse\s*\{\s*RuntimeJobEvents\s*\{[\s\S]*?protocol_version:[\s\S]*?job_id:[\s\S]*?after:[\s\S]*?next_after:[\s\S]*?terminal:[\s\S]*?has_more:[\s\S]*?events:\s*Vec<RuntimeJobEventRecord>[\s\S]*?\}\s*,?\s*\}/,
  "Rust runtime-job event response fields do not match the contract",
);
requirePattern(
  rust,
  /pub enum RuntimeControlErrorResponse\s*\{\s*RuntimeError\s*\{[\s\S]*?protocol_version:[\s\S]*?code:[\s\S]*?message:[\s\S]*?retryable:[\s\S]*?resource:[\s\S]*?required_headroom_mb:[\s\S]*?available_headroom_mb:[\s\S]*?\}\s*,?\s*\}/,
  "Rust runtime error response fields do not match the contract",
);
for (const code of runtimeControlErrorCodes) {
  requirePattern(
    rust,
    new RegExp(`"${code}"`),
    `Rust runtime error validator is missing ${code}`,
  );
}
requirePattern(
  rust,
  /if \*retryable[\s\S]*?code == "BREADBOARD_RESOURCE_EXHAUSTED"[\s\S]*?resource\.as_deref\(\) != Some\("windows_commit"\)[\s\S]*?else if resource\.is_some\(\)[\s\S]*?required_headroom_mb\.is_some\(\)[\s\S]*?available_headroom_mb\.is_some\(\)/,
  "Rust runtime errors must reject retryable responses and keep memory evidence atomic",
);
requirePattern(
  rust,
  /impl RuntimeJobEventsResponse[\s\S]*?events\.len\(\) > MAX_JOB_EVENT_REPLAY_RECORDS[\s\S]*?\*has_more && events\.is_empty\(\)[\s\S]*?event\.job_id[\s\S]*?event\.sequence <= previous[\s\S]*?previous != \*next_after/,
  "Rust event replay must enforce its page bound, continuation progress, one job, strict ordering, and exact next cursor",
);
requirePattern(
  rust,
  /pub fn parse_runtime_job_response[\s\S]*?parse_bounded_control_json\(bytes,\s*RuntimeJobResponse::validate\)/,
  "Rust runtime-job response must use the bounded control parser",
);
requirePattern(
  rust,
  /pub fn parse_runtime_job_events_response[\s\S]*?parse_bounded_control_json\(bytes,\s*RuntimeJobEventsResponse::validate\)/,
  "Rust event replay response must use the bounded control parser",
);
requirePattern(
  rust,
  /pub struct RuntimeServiceStatus\s*\{[\s\S]*?#\[serde\(deserialize_with\s*=\s*"deserialize_required_nullable"\)\]\s*pub last_error:\s*Option<String>/,
  "Rust service lastError must be required and nullable",
);
requireStrings(
  rustPublicStructWireFields(rust, "RuntimeServiceStatus", "Rust service status"),
  serviceFields,
  "Rust service status fields",
);
requirePattern(
  rust,
  /fn deserialize_required_nullable[\s\S]*?Option::<T>::deserialize\(deserializer\)/,
  "Rust required-nullable deserializer must accept explicit null",
);
requirePattern(
  rust,
  /pub fn parse_runtime_command_ack[\s\S]*?parse_bounded_control_json\(bytes,\s*RuntimeCommandAck::validate\)/,
  "Rust shutdown acknowledgement parser must enforce the literal-true validator",
);
requirePattern(
  rust,
  /impl RuntimeCommandAck\s*\{[\s\S]*?if !self\.ok[\s\S]*?InvalidRange\s*\{\s*field:\s*"ok"\s*\}/,
  "Rust shutdown acknowledgement validator must reject ok=false",
);
const rustBootstrapBlock = sourceBlock(rust, /pub enum RuntimeBootstrapMessage\s*\{/, "Rust bootstrap message");
for (const field of forbiddenAuthorityFields) {
  requireAbsent(rustBootstrapBlock, new RegExp(`\\b${field}\\b`, "i"), `Rust bootstrap exposes forbidden authority field ${field}`);
}
requirePattern(
  rustHost,
  /RuntimeBootstrapMessage::RuntimeBootstrap\s*\{[\s\S]*?app_root,[\s\S]*?runtime_root,[\s\S]*?data_root,[\s\S]*?RuntimePaths::new\([\s\S]*?PathBuf::from\(data_root\)[\s\S]*?PathBuf::from\(app_root\)[\s\S]*?PathBuf::from\(runtime_root\)/,
  "Rust host does not establish all three bootstrap path authorities",
);
requirePattern(
  rustHost,
  /resolve_runtime\(WORKER_MANIFEST_PATH\)[\s\S]*?resolve_runtime\(SERVICE_MANIFEST_PATH\)[\s\S]*?read_bounded_runtime_file\(&workers_path,[\s\S]*?read_bounded_runtime_file\(&services_path,/,
  "Rust host does not read both fixed manifests through runtimeRoot",
);
requirePattern(
  rustPaths,
  /pub struct RuntimePaths\s*\{[\s\S]*?data_root:\s*TrustedRoot,[\s\S]*?app_root:\s*TrustedRoot,[\s\S]*?runtime_root:\s*TrustedRoot,/,
  "RuntimePaths does not identity-pin dataRoot, appRoot, and runtimeRoot independently",
);
requirePattern(
  rustPaths,
  /pub fn resolve_runtime[\s\S]*?resolve_inside\(&self\.runtime_root,[\s\S]*?pub fn read_bounded_runtime_file[\s\S]*?read_bounded\(&self\.runtime_root,[\s\S]*?pub fn pin_runtime_file_for_launch[\s\S]*?validate_authority\(&self\.runtime_root,/,
  "RuntimePaths runtimeRoot authority lacks bounded resolution, read, or launch pinning",
);
requirePattern(
  rustRegistry,
  /pin_worker_executable_for_launch[\s\S]*?resolve_runtime[\s\S]*?pin_runtime_file_for_launch[\s\S]*?pin_worker_entrypoint_for_launch[\s\S]*?resolve_app[\s\S]*?pin_app_file_for_launch/,
  "Worker executable and entrypoint are not pinned by distinct runtime/app authorities",
);
requirePattern(
  rustRegistry,
  /prepare_service_launch[\s\S]*?pin_runtime_file_for_launch\([\s\S]*?resolve_runtime\(&profile\.allowed_executable\)/,
  "Typed service profile executable is not pinned by runtimeRoot authority",
);
requirePattern(
  rustRegistry,
  /ServiceInstallProbeAuthority::AppRoot[\s\S]*?pin_app_file_for_launch\(&paths\.resolve_app\(&probe\.path\)/,
  "Typed service app-root install probes are not retained as pinned launch files",
);
requirePattern(
  rustRegistry,
  /ServiceLaunchArgument::AppPath[\s\S]*?resolve_app\(path\)[\s\S]*?ServiceRuntimeValue::ServicePort/,
  "Typed service argv is not closed to appRoot paths and runtime-owned ports",
);
requirePattern(
  rustRegistry,
  /ServiceWorkingDirectoryPolicy::AppRoot[\s\S]*?pin_app_root_launch_directory[\s\S]*?ServiceWorkingDirectoryPolicy::AppSubdirectory[\s\S]*?pin_app_launch_directory/,
  "Typed service working directory is not pinned beneath appRoot",
);
requirePattern(
  rustRegistry,
  /ServiceWorkingDirectoryPolicy::DataSubdirectory[\s\S]*?pin_data_launch_directory/,
  "Typed mutable service working directory is not pinned beneath dataRoot",
);
requirePattern(
  rustRegistry,
  /ServiceWorkingDirectoryPolicy::HotDevelopmentWorkspace[\s\S]*?self\.mode != RuntimeMode::Hot[\s\S]*?has_distinct_data_root\(\)[\s\S]*?pin_data_launch_directory\(isolated_data_path\)[\s\S]*?pin_app_launch_directory\(app_path\)/,
  "Hot workspace selection is not mode-locked and rooted in pinned app/data identity",
);
requirePattern(
  rustPaths,
  /fn has_distinct_data_root[\s\S]*?data_root\.identity\.volume != self\.app_root\.identity\.volume[\s\S]*?data_root\.identity\.file != self\.app_root\.identity\.file/,
  "Hot workspace root selection does not compare pinned filesystem identities",
);

requirePattern(
  rustControl,
  /const USER_ID_HEADER:\s*&str\s*=\s*"x-breadboard-user-id";/,
  "Rust control server user authority header differs from the contract",
);
requirePattern(
  nextTransport,
  /export const RUNTIME_JOB_CONTROL_CONNECTIONS\s*=\s*16;[\s\S]*?export const RUNTIME_SERVICE_CONTROL_CONNECTIONS\s*=\s*8;[\s\S]*?connections:\s*RUNTIME_JOB_CONTROL_CONNECTIONS[\s\S]*?connections:\s*RUNTIME_SERVICE_CONTROL_CONNECTIONS/,
  "Next control transport does not preserve the bounded split job/service pools",
);
requirePattern(
  nextTransport,
  /__breadboardRuntimeControlTransportsV1[\s\S]*?\?\?=[\s\S]*?createRuntimeControlTransports\(\)/,
  "Next control transport is not retained across Hot module replacement",
);
requirePattern(
  next,
  /runtimeControlTransports\(\)\.job[\s\S]*?runtimeControlTransports\(\)\.service/,
  "Next runtime control calls do not use the bounded job and service transports",
);
requireAbsent(
  next,
  /\bfetch\s*\(/,
  "Next runtime control adapter bypasses its bounded transport",
);
requirePattern(
  rustControl,
  /const GARDEN_ID_HEADER:\s*&str\s*=\s*"x-breadboard-garden-id";/,
  "Rust control server garden authority header differs from the contract",
);
requirePattern(
  rustControl,
  /const CONVERSATION_ID_HEADER:\s*&str\s*=\s*"x-breadboard-conversation-id";/,
  "Rust control server conversation authority header differs from the contract",
);
requirePattern(
  rustControl,
  /fn request_body_limit\(method:\s*&str,\s*path:\s*&str\)\s*->\s*usize\s*\{\s*if method == "POST" && path == "\/v1\/jobs"\s*\{\s*MAX_REQUEST_BODY_BYTES\s*\}\s*else if method == "POST" && path == "\/v1\/internal\/jobs\/learn-recovery"\s*\{\s*MAX_LEARN_RECOVERY_REQUEST_BODY_BYTES\s*\}\s*else if method == "POST" && path == "\/v1\/jobs\/lookup"\s*\{\s*MAX_JOB_LOOKUP_BODY_BYTES\s*\}\s*else if method == "POST" && path == "\/v1\/jobs\/cancel-by-idempotency"\s*\{\s*MAX_JOB_IDEMPOTENCY_CANCELLATION_BODY_BYTES\s*\}\s*else if method == "POST" && path == "\/v1\/job-inputs"\s*\{\s*MAX_JOB_INPUT_RESERVATION_BODY_BYTES\s*\}\s*else if method == "POST" && path == "\/v1\/services\/recall\/reconcile"\s*\{\s*MAX_RECALL_RECONCILE_REQUEST_BODY_BYTES\s*\}\s*else if \(method == "POST" && path == "\/v1\/services\/recall\/status"\)\s*\|\| is_lease_mutation_route\(method, path\)\s*\|\| is_lifecycle_retry_route\(method, path\)\s*\|\| is_schedule_gateway_route\(method, path\)\s*\{\s*MAX_SERVICE_LEASE_REQUEST_BODY_BYTES\s*\}\s*else\s*\{\s*0\s*\}\s*\}/,
  "Rust control server must bound every typed JSON mutation and deny bodies on every other route",
);
requirePattern(
  rustControl,
  /const DASHBOARD_CLIENT_POOL_CEILING:\s*usize\s*=\s*24;[\s\S]*?const MIN_CROSS_REALM_DASHBOARD_RESERVE:\s*usize\s*=\s*8;[\s\S]*?const MAX_ACTIVE_DASHBOARD_CONNECTIONS:\s*usize\s*=\s*DASHBOARD_CLIENT_POOL_CEILING\s*\+\s*MIN_CROSS_REALM_DASHBOARD_RESERVE;[\s\S]*?const MIN_LIFECYCLE_CONNECTION_RESERVE:\s*usize\s*=\s*8;[\s\S]*?const MAX_ACTIVE_CONNECTIONS:\s*usize\s*=\s*MAX_ACTIVE_DASHBOARD_CONNECTIONS\s*\+\s*MIN_LIFECYCLE_CONNECTION_RESERVE;[\s\S]*?const REQUEST_PRELUDE_DEADLINE:\s*Duration\s*=\s*Duration::from_secs\(2\);[\s\S]*?const DEVELOPMENT_REQUEST_PRELUDE_DEADLINE:\s*Duration\s*=\s*Duration::from_secs\(60\);[\s\S]*?const REQUEST_DEADLINE:\s*Duration\s*=\s*Duration::from_secs\(2\);[\s\S]*?const RESPONSE_WRITE_DEADLINE:\s*Duration\s*=\s*Duration::from_secs\(2\);/,
  "Rust control server connection and deadline bounds differ from the contract",
);
requirePattern(
  rustControl,
  /if active\.load\(Ordering::Acquire\) >= MAX_ACTIVE_CONNECTIONS\s*\{[\s\S]*?thread::sleep\(ACCEPT_POLL_INTERVAL\);\s*continue;\s*\}[\s\S]*?match listener\.accept\(\)[\s\S]*?let previous = active\.fetch_add\(1,\s*Ordering::AcqRel\);[\s\S]*?debug_assert!\(previous < MAX_ACTIVE_CONNECTIONS\);[\s\S]*?scope\.spawn/,
  "Rust control server does not apply bounded listener-backlog pressure before allocating a scoped handler",
);
requirePattern(
  rustControl,
  /struct DashboardConnectionGuard\(Arc<AtomicUsize>\);[\s\S]*?fetch_update\(Ordering::AcqRel,\s*Ordering::Acquire,[\s\S]*?current < MAX_ACTIVE_DASHBOARD_CONNECTIONS[\s\S]*?authorities\.authenticate\(prelude\.head\.authorization\.as_deref\(\)\)[\s\S]*?ControlAuthorityRole::Dashboard[\s\S]*?DashboardConnectionGuard::try_acquire\(active_dashboard\)[\s\S]*?reject_saturated_dashboard_request\(stream,\s*prelude,\s*request_deadline\)[\s\S]*?ControlAuthorityRole::Lifecycle => None[\s\S]*?fn reject_saturated_dashboard_request[\s\S]*?bounded_json_body[\s\S]*?complete_buffered_request\(stream,\s*prelude,\s*request_deadline\)[\s\S]*?503,[\s\S]*?"Service Unavailable"[\s\S]*?dashboard-control-saturated/,
  "Rust control server does not enforce authenticated dashboard admission while preserving lifecycle capacity",
);
requirePattern(
  rustControl,
  /fn write_control_response\([\s\S]*?write_response\([\s\S]*?response_write_deadline\(\)[\s\S]*?fn write_response/,
  "Rust control responses do not receive a fresh write deadline after handler work",
);
requirePattern(
  rustControl,
  /pub\(crate\) struct ControlAuthorities[\s\S]*?lifecycle:\s*ControlPlaneAuthority[\s\S]*?dashboard:\s*ControlPlaneAuthority[\s\S]*?match \(lifecycle, dashboard\)[\s\S]*?\(true, false\)[\s\S]*?\(false, true\)[\s\S]*?_\s*=>\s*None/,
  "Rust control authority must retain distinct lifecycle/dashboard bearers and fail closed on overlap",
);
requirePattern(
  rustControl,
  /fn route_authority[\s\S]*?"\/v1\/status"[\s\S]*?ControlRouteAuthority::Either[\s\S]*?"\/v1\/shutdown"[\s\S]*?ControlRouteAuthority::Lifecycle[\s\S]*?"\/v1\/internal\/jobs\/learn-recovery"[\s\S]*?path\.starts_with\("\/v1\/jobs\/"\)[\s\S]*?path\.starts_with\("\/v1\/services\/"\)[\s\S]*?path\.starts_with\("\/v1\/leases\/"\)[\s\S]*?ControlRouteAuthority::Dashboard[\s\S]*?ControlRouteAuthority::Deny/,
  "Rust control routes are not explicitly assigned to closed bearer roles",
);
requirePattern(
  rustControl,
  /authorities\.authenticate\(prelude\.head\.authorization\.as_deref\(\)\)[\s\S]*?role_allows\(role, route_authority\(&prelude\.head\.path\)\)[\s\S]*?serve_service_request/,
  "Rust service control is reachable before transport authentication and route authorization",
);
requirePattern(
  rustControl,
  /fn parse_service_route[\s\S]*?path\.contains\('%'\)[\s\S]*?strip_prefix\("\/v1\/services\/"\)[\s\S]*?strip_suffix\("\/lease-contract"\)[\s\S]*?validate_identifier\("serviceId"[\s\S]*?method == "GET"[\s\S]*?strip_suffix\("\/lease"\)[\s\S]*?method == "POST"[\s\S]*?strip_prefix\("\/v1\/leases\/"\)[\s\S]*?strip_suffix\("\/release"\)[\s\S]*?validate_identifier\("leaseId"/,
  "Rust service control routes are not exact, unencoded, method-bound identifiers",
);
requirePattern(
  rustControl,
  /pub\(crate\) trait RuntimeServiceControl:[\s\S]*?fn service_lease_contract\([\s\S]*?service_id:\s*&str[\s\S]*?RuntimeServiceLeaseContractResponse[\s\S]*?fn acquire_service_lease\([\s\S]*?service_id:\s*&str[\s\S]*?reason:\s*&str[\s\S]*?RuntimeServiceLeaseAcquireResponse[\s\S]*?fn release_service_lease\([\s\S]*?lease_id:\s*&str[\s\S]*?RuntimeServiceLeaseReleaseResponse/,
  "Rust service controller does not expose only validated route-bound lease operations",
);
requireAbsent(
  sourceBlock(
    rustControl,
    /pub\(crate\) trait RuntimeServiceControl:[\s\S]*?\{/,
    "Rust service control trait",
  ),
  /\b(?:executable|command|args|cwd|environment|env|maximum_lease_ms)\s*:/,
  "Rust service controller exposes launch or lease-duration authority",
);
requirePattern(
  rustControl,
  /ServiceRoute::Contract\s*\{\s*service_id\s*\}[\s\S]*?service_control\.service_lease_contract\(&service_id\)[\s\S]*?response\s*\.validate\(\)[\s\S]*?response\.service_id != service_id[\s\S]*?write_bounded_protocol_response/,
  "Rust service deadline contract is not passive, validated, and route-bound",
);
requirePattern(
  rustControl,
  /parse_runtime_service_lease_acquire_request\(&request\.body\)[\s\S]*?service_control\.acquire_service_lease\(&service_id,\s*&payload\.reason\)[\s\S]*?deliver_service_lease/,
  "Rust service acquire does not validate its strict body before dispatch",
);
requirePattern(
  rustControl,
  /parse_runtime_service_lease_release_request\(&request\.body\)[\s\S]*?service_control\.release_service_lease\(&lease_id\)/,
  "Rust service release does not validate the exact empty body before dispatch",
);
requirePattern(
  rustControl,
  /fn deliver_service_lease[\s\S]*?response\.validate\(\)[\s\S]*?response\.service_id != expected_service_id[\s\S]*?release_service_lease\(&response\.lease_id\)[\s\S]*?let result = deliver\(&response\);[\s\S]*?if result\.is_err\(\)[\s\S]*?release_service_lease\(&response\.lease_id\)/,
  "Rust service acquire does not bind responses and reclaim an undeliverable opaque lease",
);
requirePattern(
  rustServiceEngine,
  /fn service_acquire_timeouts\(startup_ms:\s*u64\)[\s\S]*?pending:\s*Duration::from_millis\(startup_ms \+ SERVICE_LEASE_SETTLEMENT_GRACE_MS\)[\s\S]*?response:\s*Duration::from_millis\([\s\S]*?startup_ms \+ SERVICE_LEASE_SETTLEMENT_GRACE_MS \+ SERVICE_LEASE_RESPONSE_GRACE_MS/,
  "Rust service-acquire deadlines are not derived from manifest readiness plus the bounded grace terms",
);
requirePattern(
  rustServiceEngine,
  /fn service_acquire_timeout_map[\s\S]*?registry\.service_ids_in_dependency_order\(\)[\s\S]*?registry\.service\(service_id\)[\s\S]*?definition\.readiness\.startup_timeout_ms/,
  "Rust service-acquire deadlines are not closed over the trusted service registry",
);
const serviceLeaseContractBlock = sourceBlock(
  rustServiceEngine,
  /fn service_lease_contract\s*\(/,
  "Rust passive service-lease deadline contract",
);
requirePattern(
  serviceLeaseContractBlock,
  /self\s*\.service_acquire_timeouts[\s\S]*?\.get\(service_id\)[\s\S]*?RuntimeServiceLeaseContractResponse[\s\S]*?acquire_timeout_ms[\s\S]*?response\s*\.validate\(\)/,
  "Rust service-lease deadline contract does not read and validate its immutable registry-derived deadline",
);
requireAbsent(
  serviceLeaseContractBlock,
  /\b(?:submit_command|try_send|begin_owned_acquire|acquire_service_lease|start_service|poll)\b/,
  "Rust service-lease deadline contract performs an active lifecycle operation",
);
requirePattern(
  rustServiceEngine,
  /fn begin_owned_acquire[\s\S]*?self\.registry\.service\(&service_id\)[\s\S]*?service_acquire_timeouts\(definition\.readiness\.startup_timeout_ms\)\.pending/,
  "Rust controller does not independently enforce the trusted manifest readiness deadline",
);
requirePattern(
  rustHost,
  /trait PreparedRuntimeEngine:\s*Sync[\s\S]*?fn service_control\(&self\)\s*->\s*&dyn RuntimeServiceControl[\s\S]*?serve_with_jobs\([\s\S]*?prepared_ref\.service_control\(\)/,
  "Rust authoritative host does not route service control through the prepared engine",
);
requirePattern(
  rustControl,
  /name\.eq_ignore_ascii_case\(USER_ID_HEADER\)[\s\S]*?set_once\(&mut user_id[\s\S]*?name\.eq_ignore_ascii_case\(GARDEN_ID_HEADER\)[\s\S]*?set_once\(&mut garden_id[\s\S]*?name\.eq_ignore_ascii_case\(CONVERSATION_ID_HEADER\)[\s\S]*?set_once\(&mut conversation_id/,
  "Rust control server must reject duplicate job authority headers",
);
requirePattern(
  rustControl,
  /parsed <= 0 \|\| parsed as u64 > MAX_JSON_SAFE_INTEGER/,
  "Rust control server must keep user IDs inside the shared JSON-safe integer boundary",
);
requirePattern(
  rustControl,
  /fn authenticate_job_context\([\s\S]*?authority\s*\.authenticate_user\(authorization,\s*user_id,\s*garden_id,\s*conversation_id\)/,
  "Rust control server must mint job context only after bearer and scope authentication",
);
requirePattern(
  rustControl,
  /parse_job_submission_payload\(&request\.body\)[\s\S]*?job_control\.submit_job\(&context,\s*&payload\)/,
  "Rust control server must parse the bounded body before authorized submission",
);
requirePattern(
  rustControl,
  /path == "\/v1\/jobs"[\s\S]*?JobRoute::Submit[\s\S]*?"\/v1\/jobs\/lookup"[\s\S]*?JobRoute::Lookup[\s\S]*?"\/v1\/jobs\/cancel-by-idempotency"[\s\S]*?JobRoute::CancelByIdempotency[\s\S]*?"cancel"[\s\S]*?JobRoute::Cancel[\s\S]*?"events"[\s\S]*?parse_event_query/,
  "Rust control server job endpoints differ from the contract",
);
requirePattern(
  rustControl,
  /JobRoute::CancelByIdempotency\s*=>[\s\S]*?parse_runtime_job_idempotency_cancellation_request\(&request\.body\)[\s\S]*?cancel_job_by_idempotency_key\(&context,\s*&cancellation\.idempotency_key\)[\s\S]*?response\.validate\(\)[\s\S]*?write_bounded_job_success\(stream,\s*200,\s*"OK"/,
  "Rust control server does not authenticate, parse, dispatch, validate, and bound idempotency cancellation",
);
requirePattern(
  rustControl,
  /fn serve_learn_recovery_request[\s\S]*?request\.method != "POST"[\s\S]*?request\.user_id\.is_some\(\)[\s\S]*?request\.garden_id\.is_some\(\)[\s\S]*?request\.conversation_id\.is_some\(\)[\s\S]*?verify_bearer\(request\.authorization\.as_deref\(\)\)[\s\S]*?!shutdown\.is_accepting_work\(\)[\s\S]*?parse_runtime_learn_recovery_request\(&request\.body\)[\s\S]*?trusted_internal_context\("learn-recovery",\s*None,\s*None\)[\s\S]*?job_type:\s*"learn"\.into\(\)[\s\S]*?garden_id:\s*None[\s\S]*?conversation_id:\s*None[\s\S]*?input_uploads:\s*Vec::new\(\)[\s\S]*?"operation":\s*"recovery"[\s\S]*?submit_job\(&context,\s*&payload\)/,
  "Rust fixed Learn-recovery route exposes caller authority/job shape or bypasses shutdown admission",
);
requirePattern(
  rustControl,
  /query\.split\('&'\)[\s\S]*?"after"[\s\S]*?MAX_JSON_SAFE_INTEGER[\s\S]*?"limit"[\s\S]*?MAX_JOB_EVENT_REPLAY_RECORDS/,
  "Rust control server must strictly bound event replay cursors and pages",
);
requirePattern(
  rustControl,
  /payload\.garden_id\.as_deref\(\) != request\.garden_id\.as_deref\(\)[\s\S]*?payload\.conversation_id\.as_deref\(\) != request\.conversation_id\.as_deref\(\)[\s\S]*?RuntimeJobControlError::Forbidden/,
  "Rust control server must bind submission scopes to authenticated headers before dispatch",
);
requirePattern(
  rustControl,
  /fn validate_job_response_binding[\s\S]*?job\.job_id[\s\S]*?job\.job_type[\s\S]*?job\.garden_id[\s\S]*?request\.garden_id[\s\S]*?job\.conversation_id[\s\S]*?request\.conversation_id/,
  "Rust control server must bind job responses to the authenticated request",
);
requirePattern(
  rustControl,
  /fn validate_event_response_binding[\s\S]*?job_id != expected_job_id[\s\S]*?\*after != expected_after[\s\S]*?events\.len\(\) > requested_limit/,
  "Rust control server must bind event responses to the requested job, cursor, and page limit",
);
requirePattern(
  rustControl,
  /response\s*\.validate\(\)[\s\S]*?write_bounded_job_success/,
  "Rust control server must validate and bound job responses before writing",
);
requirePattern(
  rustControl,
  /fn write_bounded_job_success[\s\S]*?Err\(ControlError::OversizedResponse\)[\s\S]*?RuntimeJobControlError::Internal/,
  "Rust control server must contain an oversized engine response to one bounded request",
);
requirePattern(
  rustControl,
  /RuntimeControlErrorResponse::RuntimeError[\s\S]*?retryable:\s*false[\s\S]*?write_bounded_protocol_response/,
  "Rust control server must use the bounded non-retry error envelope",
);
requireAbsent(
  rustControl,
  /RuntimeJobControl[\s\S]*?(?:executable|command_line|working_directory|environment):/,
  "Rust job-control trait exposes process launch authority",
);
requirePattern(
  rustStore,
  /pub fn replay_job_events_snapshot[\s\S]*?requested_limit\s*\.checked_add\(1\)[\s\S]*?transaction_with_behavior\(TransactionBehavior::Deferred\)[\s\S]*?query_owned_job\([\s\S]*?job\.state\.is_terminal\(\)\s*&&\s*active_job_reservation_tx\(&transaction,\s*job_id\)\?\.is_none\(\)[\s\S]*?query_owned_events_after\([\s\S]*?transaction\.commit\(\)\?/,
  "Rust event replay must read the owned job, active reservation, and limit-plus-one events from one SQLite snapshot",
);
requirePattern(
  rustStore,
  /const SCHEMA_VERSION:\s*i64\s*=\s*13;[\s\S]*?const SCHEMA_V10:[\s\S]*?CREATE TABLE runtime_job_idempotency_cancellations[\s\S]*?owner_principal TEXT NOT NULL[\s\S]*?user_id INTEGER NOT NULL[\s\S]*?garden_id TEXT NOT NULL[\s\S]*?conversation_id TEXT NOT NULL[\s\S]*?idempotency_key TEXT NOT NULL[\s\S]*?expires_at INTEGER NOT NULL[\s\S]*?CREATE UNIQUE INDEX runtime_job_idempotency_cancellations_scope_idx[\s\S]*?owner_principal, user_id, garden_id, conversation_id, idempotency_key[\s\S]*?PRAGMA user_version = 10[\s\S]*?const SCHEMA_V13_REBUILD_SERVICE_AUTHORITY:[\s\S]*?PRAGMA user_version = 13/,
  "Rust durable cancellation tombstone schema is not exact-authority scoped and versioned",
);
requirePattern(
  rustStore,
  /pub fn cancel_job_by_idempotency_key[\s\S]*?transaction_with_behavior\(TransactionBehavior::Immediate\)[\s\S]*?delete_expired_idempotency_cancellations_tx[\s\S]*?query_job_by_idempotency_key[\s\S]*?current\.is_owned_by\(context\)[\s\S]*?request_job_cancellation_tx[\s\S]*?query_active_idempotency_cancellation_tx[\s\S]*?MAX_IDEMPOTENCY_CANCELLATIONS_PER_OWNER[\s\S]*?MAX_IDEMPOTENCY_CANCELLATIONS_GLOBAL[\s\S]*?INSERT INTO runtime_job_idempotency_cancellations[\s\S]*?transaction\.commit\(\)/,
  "Rust idempotency cancellation does not atomically cancel the exact owned job or enforce bounded tombstones",
);
requirePattern(
  rustStore,
  /pub\(crate\) fn submit_raw[\s\S]*?transaction_with_behavior\(TransactionBehavior::Immediate\)[\s\S]*?query_active_idempotency_cancellation_tx[\s\S]*?cancellation_pending[\s\S]*?adopt_job_input_uploads_tx[\s\S]*?append_event_tx[\s\S]*?consume_active_idempotency_cancellation_tx[\s\S]*?request_job_cancellation_tx[\s\S]*?transaction\.commit\(\)/,
  "Rust submission does not consume an active cancellation tombstone and materialize cancellation in one transaction",
);
requirePattern(
  rustStore,
  /fn query_active_idempotency_cancellation_tx[\s\S]*?owner_principal=\?1 AND user_id=\?2 AND garden_id=\?3[\s\S]*?conversation_id=\?4 AND idempotency_key=\?5 AND expires_at>\?6/,
  "Rust active tombstone lookup is not bound to the exact authenticated authority scope and TTL",
);
requirePattern(
  rustStore,
  /pub fn reconcile_expired_idempotency_cancellations_online[\s\S]*?1\.\.=MAX_IDEMPOTENCY_CANCELLATION_CLEANUP_BATCH[\s\S]*?delete_expired_idempotency_cancellations_tx[\s\S]*?fn delete_expired_idempotency_cancellations_tx[\s\S]*?WHERE expires_at<=\?1 ORDER BY expires_at, tombstone_id LIMIT \?2/,
  "Rust online cancellation-tombstone cleanup is not TTL-only and strictly bounded",
);
requirePattern(
  rustDurableJobControl,
  /replay_job_events_snapshot\(context,\s*job_id,\s*after_sequence,\s*limit\)[\s\S]*?runtime_job_events_response\([\s\S]*?&snapshot\.job,[\s\S]*?snapshot\.public_event_stream_sealed,[\s\S]*?&snapshot\.events/,
  "Rust durable job control must project the explicit event-stream seal from the atomic replay snapshot",
);
requirePattern(
  rustDurableJobControl,
  /fn cancel_job_by_idempotency_key[\s\S]*?store\s*\.cancel_job_by_idempotency_key\(context,\s*idempotency_key\)[\s\S]*?CancelJobByIdempotencyOutcome::Pending[\s\S]*?RuntimeJobIdempotencyCancellationState::Pending[\s\S]*?CancelJobByIdempotencyOutcome::Job[\s\S]*?should_cleanup_unstarted_terminal_inputs[\s\S]*?cleanup_unstarted_terminal_job_inputs[\s\S]*?RuntimeJobIdempotencyCancellationResponse::RuntimeJobIdempotencyCancellation/,
  "Rust durable job control does not project exact cancellation dispositions and clean unstarted cancellation inputs",
);
requirePattern(
  rustDurableJobControl,
  /StoreError::IdempotencyCancellationQuotaExceeded[\s\S]*?RuntimeJobControlError::CancellationQuotaExceeded[\s\S]*?StoreError::CancelledBeforeSubmission[\s\S]*?RuntimeJobControlError::CancelledBeforeSubmission/,
  "Rust durable job control does not close cancellation quota and pre-submission collision errors",
);
requirePattern(
  rustWorkerDispatcher,
  /const ONLINE_EXPIRED_IDEMPOTENCY_CANCELLATION_CLEANUP_BATCH:\s*usize\s*=\s*8;[\s\S]*?reconcile_expired_idempotency_cancellations_online\([\s\S]*?ONLINE_EXPIRED_IDEMPOTENCY_CANCELLATION_CLEANUP_BATCH/,
  "Rust worker dispatcher does not run the bounded online tombstone expiry sweep",
);
const rustPublicStageProjectionBlock = sourceBlock(
  rustControlViews,
  /fn public_stage\(internal_stage:\s*Option<&str>\)\s*->\s*Option<RuntimePublicStage>\s*\{/,
  "Rust public-stage projection",
);
for (const publicStage of publicStages) {
  requirePattern(
    rustPublicStageProjectionBlock,
    new RegExp(`RuntimePublicStage::${wireToPascal(publicStage)}`),
    `Rust public-stage projection cannot produce ${publicStage}`,
  );
}
requirePattern(
  rustPublicStageProjectionBlock,
  /_\s*=>\s*RuntimePublicStage::Working/,
  "Rust public-stage projection does not map unknown private values to working",
);
requireAbsent(
  rustPublicStageProjectionBlock,
  /(?:Some\()?\s*(?:stage|internal_stage)\.to_(?:string|owned)\(/,
  "Rust public-stage projection can echo a private stage string",
);
const rustPublicArtifactProjectionBlock = sourceBlock(
  rustControlViews,
  /fn public_artifact_kind\(internal_kind:\s*&str\)\s*->\s*RuntimePublicArtifactKind\s*\{/,
  "Rust public artifact-kind projection",
);
for (const artifactKind of publicArtifactKinds) {
  requirePattern(
    rustPublicArtifactProjectionBlock,
    new RegExp(`"${escapeRegex(artifactKind)}"\\s*=>\\s*RuntimePublicArtifactKind::${wireToPascal(artifactKind)}`),
    `Rust public artifact-kind projection is missing exact ${artifactKind} mapping`,
  );
}
requirePattern(
  rustPublicArtifactProjectionBlock,
  /_\s*=>\s*RuntimePublicArtifactKind::Artifact/,
  "Rust public artifact-kind projection does not map unknown worker values to artifact",
);
requirePattern(
  rustControlViews,
  /fn public_failure_code\(record:\s*&JobRecord\)\s*->\s*Option<RuntimePublicFailureCode>[\s\S]*?record\.failure_code\.as_ref\(\)\.map\(\|_\|\s*match record\.state[\s\S]*?JobState::ResourceExhausted\s*=>\s*RuntimePublicFailureCode::ResourceExhausted[\s\S]*?JobState::Interrupted\s*=>\s*RuntimePublicFailureCode::Interrupted[\s\S]*?JobState::Uncertain\s*=>\s*RuntimePublicFailureCode::Uncertain[\s\S]*?_\s*=>\s*RuntimePublicFailureCode::RuntimeJobFailed/,
  "Rust job status failure code is not derived from closed runtime-owned state categories",
);
requirePattern(
  rustControlViews,
  /fn project_worker_event[\s\S]*?serde_json::from_value\(record\.payload\.clone\(\)\)[\s\S]*?WorkerEvent::Checkpoint[\s\S]*?artifact_kind:\s*Some\(public_artifact_kind\(&kind\)\)[\s\S]*?WorkerEvent::Artifact[\s\S]*?artifact_kind:\s*Some\(public_artifact_kind\(&kind\)\)[\s\S]*?WorkerEvent::Complete[\s\S]*?RuntimeJobEventPayload::default\(\)[\s\S]*?WorkerEvent::Failed\s*\{\s*\.\.\s*\}[\s\S]*?failure_code:\s*Some\(RuntimePublicFailureCode::WorkerFailed\)[\s\S]*?failure_message:\s*Some\(SANITIZED_RUNTIME_FAILURE_MESSAGE\.to_string\(\)\)/,
  "Rust control projection must replace raw worker payloads with closed path-free runtime-owned values",
);
requireAbsent(
  rustControlViews,
  /payload:\s*(?:event|record)\.payload\.clone\(\)/,
  "Rust control projection republishes a raw durable event payload",
);
requirePattern(
  rustControlViews,
  /requested_limit\s*\.checked_add\(1\)[\s\S]*?EVENT_REPLAY_ENVELOPE_RESERVE_BYTES[\s\S]*?candidate_bytes > event_byte_budget[\s\S]*?has_more = projected\.len\(\) < events\.len\(\)[\s\S]*?encoded\.len\(\) > MAX_PROTOCOL_LINE_BYTES/,
  "Rust control projection must enforce a limit-plus-one source bound and byte-bound replay pages with explicit continuation",
);
requirePattern(
  rustControlViews,
  /pub fn runtime_job_events_response\([\s\S]*?public_event_stream_sealed:\s*bool[\s\S]*?terminal:\s*public_event_stream_sealed/,
  "Rust control projection must derive replay terminal from the explicit public-event-stream seal",
);
requirePattern(
  rustControlViews,
  /failure_message:\s*record[\s\S]*?SANITIZED_RUNTIME_FAILURE_MESSAGE/,
  "Rust job status projection must not republish raw durable failure messages",
);

const electronValues = {
  protocolVersion: sourceInteger(
    electron,
    /export const RUNTIME_PROTOCOL_VERSION\s*=\s*([^;]+?)\s+as const;/,
    "Electron protocol version",
  ),
  maximumLineBytes: sourceInteger(
    electron,
    /export const MAX_RUNTIME_PROTOCOL_LINE_BYTES\s*=\s*([^;]+);/,
    "Electron maximum line bytes",
  ),
  maximumRootBytes: sourceInteger(
    electron,
    /const MAX_RUNTIME_ROOT_BYTES\s*=\s*([^;]+);/,
    "Electron maximum root bytes",
  ),
  maximumUrlBytes: sourceInteger(
    electron,
    /const MAX_LOOPBACK_URL_BYTES\s*=\s*([^;]+);/,
    "Electron maximum URL bytes",
  ),
  maximumServices: sourceInteger(
    electron,
    /const MAX_RUNTIME_SERVICES\s*=\s*([^;]+);/,
    "Electron maximum services",
  ),
  maximumIdBytes: sourceInteger(
    electron,
    /const MAX_SERVICE_ID_BYTES\s*=\s*([^;]+);/,
    "Electron maximum identifier bytes",
  ),
  maximumDisplayNameBytes: sourceInteger(
    electron,
    /const MAX_SERVICE_DISPLAY_NAME_BYTES\s*=\s*([^;]+);/,
    "Electron maximum display-name bytes",
  ),
  maximumErrorBytes: sourceInteger(
    electron,
    /const MAX_SERVICE_ERROR_BYTES\s*=\s*([^;]+);/,
    "Electron maximum error bytes",
  ),
  minimumTokenBytes: sourceInteger(
    electron,
    /const MIN_CONTROL_TOKEN_BYTES\s*=\s*([^;]+);/,
    "Electron minimum token bytes",
  ),
  maximumTokenBytes: sourceInteger(
    electron,
    /const MAX_CONTROL_TOKEN_BYTES\s*=\s*([^;]+);/,
    "Electron maximum token bytes",
  ),
  maximumRestarts: sourceInteger(
    electron,
    /const MAX_SERVICE_RESTARTS\s*=\s*([^;]+);/,
    "Electron maximum restarts",
  ),
};
requireEqual(electronValues.protocolVersion, contract.protocolVersion, "Electron protocol version parity");
requireEqual(electronValues.maximumLineBytes, contract.transport?.maximumLineBytes, "Electron line limit parity");
requireEqual(electronValues.maximumRootBytes, contract.bootstrap?.maximumRootBytes, "Electron root limit parity");
requireEqual(electronValues.maximumUrlBytes, rustValues.maximumUrlBytes, "Electron URL limit parity");
requireEqual(electronValues.maximumServices, contract.serviceStatus?.maximumRecords, "Electron service limit parity");
requireEqual(electronValues.maximumIdBytes, contract.serviceStatus?.maximumIdBytes, "Electron ID limit parity");
requireEqual(electronValues.maximumDisplayNameBytes, contract.serviceStatus?.maximumDisplayNameBytes, "Electron display-name limit parity");
requireEqual(electronValues.maximumErrorBytes, contract.serviceStatus?.maximumLastErrorBytes, "Electron error limit parity");
requireEqual(electronValues.minimumTokenBytes, contract.control?.minimumTokenBytes, "Electron minimum-token parity");
requireEqual(electronValues.maximumTokenBytes, contract.control?.maximumTokenBytes, "Electron maximum-token parity");
requireEqual(electronValues.maximumRestarts, contract.serviceStatus?.maximumRestarts, "Electron restart limit parity");
requireStrings(
  sourceStringArray(
    electron,
    /const RUNTIME_SERVICE_STATES[^=]*=\s*new Set<[^>]+>\(\s*\[([\s\S]*?)\]\s*\);/,
    "Electron service states",
  ),
  serviceStates,
  "Electron service states",
);
requireStrings(
  sourceStringArray(
    electron,
    /const RUNTIME_SERVICE_STARTUP_POLICIES[^=]*=\s*new Set<[^>]+>\(\s*\[([\s\S]*?)\]\s*\);/,
    "Electron service startup policies",
  ),
  contract.serviceStatus?.startupPolicies,
  "Electron service startup policies",
);
requirePattern(electron, /export const RUNTIME_EXECUTABLE_NAME\s*=\s*"breadboard-runtime\.exe";/, "Electron executable name is not fixed");
requirePattern(electron, /spawnRuntime\(this\.#executable,\s*\[\],\s*\{[\s\S]*?shell:\s*false,[\s\S]*?detached:\s*false,/, "Electron runtime launch must use no args, no shell, and no detach");
requireAbsent(electron, /\b(?:taskkill|killProcessTree|execFile|execSync|spawnSync)\b/, "Electron runtime adapter contains an alternate process-tree authority");
requirePattern(electron, /#controlJson\("\/v1\/status",\s*"GET"\)/, "Electron status endpoint differs from the contract");
requirePattern(electron, /#controlJson\("\/v1\/shutdown",\s*"POST",\s*true\)/, "Electron shutdown endpoint differs from the contract");
requirePattern(electron, /Authorization:\s*`Bearer \$\{token\}`/, "Electron control authorization is not Bearer");
requirePattern(electron, /http:\/\/127\.0\.0\.1:/, "Electron does not accept the IPv4 loopback contract");
requirePattern(electron, /http:\/\/\[::1\]:/, "Electron does not accept the IPv6 loopback contract");
const electronBootstrapBlock = sourceBlock(electron, /export interface RuntimeBootstrapInput\s*\{/, "Electron bootstrap input");
for (const field of forbiddenAuthorityFields) {
  requireAbsent(
    electronBootstrapBlock,
    new RegExp(`\\breadonly\\s+${field}\\??\\s*:`, "i"),
    `Electron bootstrap exposes forbidden authority field ${field}`,
  );
}
requirePattern(
  electronBootstrapBlock,
  /mode:[\s\S]*?appRoot:[\s\S]*?runtimeRoot:[\s\S]*?dataRoot:[\s\S]*?configRoot:/,
  "Electron bootstrap input does not carry runtimeRoot as a private root",
);
requirePattern(
  electron,
  /#bootstrap\s*=\s*Object\.freeze\(\{[\s\S]*?runtimeRoot:\s*normalizeAbsolutePath\(options\.bootstrap\.runtimeRoot,\s*"runtimeRoot"\)[\s\S]*?function encodeBootstrap[\s\S]*?runtimeRoot:\s*input\.runtimeRoot/,
  "Electron does not normalize and encode runtimeRoot through its private bootstrap",
);
requirePattern(
  electronPathResolver,
  /const runtimeRoot\s*=\s*path\.join\(repoRoot,\s*"desktop",\s*"build-resources"\)[\s\S]*?appRoot:\s*repoRoot,[\s\S]*?runtimeRoot,[\s\S]*?const resources\s*=\s*input\.electronResourcesPath[\s\S]*?appRoot,[\s\S]*?runtimeRoot:\s*resources,/,
  "Electron main does not derive dev and packaged runtimeRoot from fixed trusted locations",
);
const bootstrapWriter = sourceBlock(electron, /function writePrivateBootstrap\s*\(/, "Electron private bootstrap writer");
requirePattern(bootstrapWriter, /stdin\.write\(/, "Electron bootstrap must write to the private stdin pipe");
requireAbsent(bootstrapWriter, /stdin\.(?:end|destroy)\(/, "Electron bootstrap writer closes the parent-liveness pipe after bootstrap");

const nextValues = {
  maximumManifestServiceStartupMs: sourceInteger(
    next,
    /const MAX_MANIFEST_SERVICE_STARTUP_TIMEOUT_MS\s*=\s*([^;]+);/,
    "Next maximum manifest service startup timeout",
  ),
  serviceLeaseSettlementGraceMs: sourceInteger(
    next,
    /const SERVICE_LEASE_SETTLEMENT_GRACE_MS\s*=\s*([^;]+);/,
    "Next service-lease settlement grace",
  ),
  serviceLeaseResponseGraceMs: sourceInteger(
    next,
    /const SERVICE_LEASE_RESPONSE_GRACE_MS\s*=\s*([^;]+);/,
    "Next service-lease response grace",
  ),
  serviceLeaseTransportGraceMs: sourceInteger(
    next,
    /const SERVICE_LEASE_TRANSPORT_GRACE_MS\s*=\s*([^;]+);/,
    "Next service-lease transport grace",
  ),
  minimumTokenBytes: sourceInteger(
    next,
    /const MIN_CONTROL_TOKEN_BYTES\s*=\s*([^;]+);/,
    "Next minimum token bytes",
  ),
  maximumTokenBytes: sourceInteger(
    next,
    /const MAX_CONTROL_TOKEN_BYTES\s*=\s*([^;]+);/,
    "Next maximum token bytes",
  ),
  maximumResponseBytes: sourceInteger(
    next,
    /const MAX_CONTROL_RESPONSE_BYTES\s*=\s*([^;]+);/,
    "Next maximum response bytes",
  ),
  maximumJobRequestBytes: sourceInteger(
    next,
    /const MAX_JOB_REQUEST_BYTES\s*=\s*([^;]+);/,
    "Next maximum job request bytes",
  ),
  maximumJobEventReplayRecords: sourceInteger(
    next,
    /const MAX_JOB_EVENT_REPLAY_RECORDS\s*=\s*([^;]+);/,
    "Next maximum job-event replay records",
  ),
  maximumRuntimeIdentifierBytes: sourceInteger(
    next,
    /const MAX_RUNTIME_IDENTIFIER_BYTES\s*=\s*([^;]+);/,
    "Next maximum runtime identifier bytes",
  ),
  maximumRuntimeScopeBytes: sourceInteger(
    next,
    /const MAX_RUNTIME_SCOPE_BYTES\s*=\s*([^;]+);/,
    "Next maximum runtime scope bytes",
  ),
  maximumRuntimeIdempotencyKeyBytes: sourceInteger(
    next,
    /const MAX_RUNTIME_IDEMPOTENCY_KEY_BYTES\s*=\s*([^;]+);/,
    "Next maximum runtime idempotency-key bytes",
  ),
  maximumRuntimeJsonNodes: sourceInteger(
    next,
    /const MAX_RUNTIME_JSON_NODES\s*=\s*([^;]+);/,
    "Next maximum runtime JSON nodes",
  ),
};
requireEqual(
  nextValues.maximumManifestServiceStartupMs,
  contract.serviceLeaseControl?.acquireDeadline?.maximumManifestStartupMs,
  "Next service startup-timeout limit parity",
);
requireEqual(
  nextValues.serviceLeaseSettlementGraceMs,
  contract.serviceLeaseControl?.acquireDeadline?.settlementGraceMs,
  "Next service-lease settlement-grace parity",
);
requireEqual(
  nextValues.serviceLeaseResponseGraceMs,
  contract.serviceLeaseControl?.acquireDeadline?.responseGraceMs,
  "Next service-lease response-grace parity",
);
requireEqual(
  nextValues.serviceLeaseTransportGraceMs,
  contract.serviceLeaseControl?.acquireDeadline?.dashboardTransportGraceMs,
  "Next service-lease transport-grace parity",
);
requireEqual(nextValues.minimumTokenBytes, contract.control?.minimumTokenBytes, "Next minimum-token parity");
requireEqual(nextValues.maximumTokenBytes, contract.control?.maximumTokenBytes, "Next maximum-token parity");
requireEqual(nextValues.maximumResponseBytes, contract.control?.maximumResponseBytes, "Next response-limit parity");
requireEqual(
  nextValues.maximumJobRequestBytes,
  contract.jobSubmission?.maximumBodyBytes,
  "Next job request limit parity",
);
requireEqual(
  nextValues.maximumJobEventReplayRecords,
  contract.jobEvents?.maximumRecords,
  "Next job-event replay limit parity",
);
requireEqual(
  nextValues.maximumRuntimeIdentifierBytes,
  contract.jobSubmission?.maximumJobTypeBytes,
  "Next runtime identifier limit parity",
);
requireEqual(
  nextValues.maximumRuntimeScopeBytes,
  contract.jobSubmission?.maximumScopeIdBytes,
  "Next runtime scope limit parity",
);
requireEqual(
  nextValues.maximumRuntimeIdempotencyKeyBytes,
  contract.jobSubmission?.maximumIdempotencyKeyBytes,
  "Next runtime idempotency-key limit parity",
);
requireEqual(
  nextValues.maximumRuntimeJsonNodes,
  contract.jobSubmission?.maximumJsonNodesBeforeSerialization,
  "Next runtime JSON-node limit parity",
);
requirePattern(next, /const LOOPBACK\s*=\s*new Set\(\["127\.0\.0\.1",\s*"\[::1\]"\]\)/, "Next control adapter must accept literal loopback hosts only");
requirePattern(next, /readBoundedControlJson\(response\)/, "Next control adapter must use its bounded response reader");
requirePattern(next, /authorization:\s*`Bearer \$\{target\.token\}`/, "Next control authorization is not Bearer");
requireStrings(
  sourceStringArray(
    next,
    /const RUNTIME_JOB_FIELDS\s*=\s*\[([\s\S]*?)\]\s*as const;/,
    "Next runtime-job fields",
  ),
  jobStatusFields,
  "Next runtime-job fields",
);
requireStrings(
  sourceStringArray(
    next,
    /const RUNTIME_JOB_EVENT_FIELDS\s*=\s*\[([\s\S]*?)\]\s*as const;/,
    "Next runtime-job event fields",
  ),
  jobEventFields,
  "Next runtime-job event fields",
);
requireStrings(
  sourceStringArray(
    next,
    /export type RuntimeJobEventType\s*=([\s\S]*?);/,
    "Next runtime-job event type union",
  ),
  jobEventTypes,
  "Next runtime-job event type union",
);
requireStrings(
  sourceStringArray(
    next,
    /const RUNTIME_PUBLIC_STAGES\s*=\s*new Set<[^>]+>\(\s*\[([\s\S]*?)\]\s*\);/,
    "Next public job stages",
  ),
  publicStages,
  "Next public job stages",
);
requireStrings(
  sourceStringArray(
    next,
    /export type RuntimePublicArtifactKind\s*=([\s\S]*?);/,
    "Next public artifact-kind type",
  ),
  publicArtifactKinds,
  "Next public artifact-kind type",
);
requireStrings(
  sourceStringArray(
    next,
    /const RUNTIME_PUBLIC_ARTIFACT_KINDS\s*=\s*new Set<[^>]+>\(\s*\[([\s\S]*?)\]\s*\);/,
    "Next public artifact kinds",
  ),
  publicArtifactKinds,
  "Next public artifact kinds",
);
requireStrings(
  sourceStringArray(
    next,
    /export type RuntimePublicFailureCode\s*=([\s\S]*?);/,
    "Next public failure-code type",
  ),
  publicFailureCodes,
  "Next public failure-code type",
);
requireStrings(
  sourceStringArray(
    next,
    /const RUNTIME_PUBLIC_FAILURE_CODES\s*=\s*new Set<[^>]+>\(\s*\[([\s\S]*?)\]\s*\);/,
    "Next public failure codes",
  ),
  publicFailureCodes,
  "Next public failure codes",
);
requirePattern(
  next,
  /interface RuntimeJobSnapshot\s*\{[\s\S]*?readonly stage:\s*RuntimePublicStage \| null;[\s\S]*?readonly failureCode:\s*RuntimePublicFailureCode \| null;/,
  "Next runtime-job snapshot does not use the closed public stage and failure-code types",
);
const nextJobEventPayloadMapBlock = sourceBlock(
  next,
  /interface RuntimeJobEventPayloadMap\s*\{/,
  "Next discriminated runtime-job event payload map",
);
requirePattern(
  nextJobEventPayloadMapBlock,
  /"worker-checkpoint":[\s\S]*?artifactKind:\s*RuntimePublicArtifactKind[\s\S]*?"worker-artifact":[\s\S]*?artifactKind:\s*RuntimePublicArtifactKind/,
  "Next worker artifact events do not use the closed runtime-owned artifact kind",
);
requirePattern(
  nextJobEventPayloadMapBlock,
  /"worker-failed":[\s\S]*?failureCode:\s*"WORKER_FAILED"[\s\S]*?failureMessage:\s*typeof SANITIZED_RUNTIME_FAILURE_MESSAGE/,
  "Next worker-failed payload is not fixed to its runtime-owned code and sanitized message",
);
const nextJobEventRulesBlock = sourceBlock(
  next,
  /const RUNTIME_JOB_EVENT_RULES\s*=\s*\{/,
  "Next exact runtime-job event rules",
);
requireStrings(
  sourceTopLevelObjectKeys(nextJobEventRulesBlock),
  jobEventTypes,
  "Next exact runtime-job event rule keys",
);
for (const eventType of jobEventTypes) {
  const expected = jobEventRules[eventType];
  const key = eventType.includes("-") ? `"${eventType}"` : eventType;
  const ruleBlock = sourceBlock(
    nextJobEventRulesBlock,
    new RegExp(`(?:^|\\n)\\s*${escapeRegex(key)}\\s*:\\s*\\{`),
    `Next ${eventType} event rule`,
  );
  requireEqual(
    sourceStringProperty(ruleBlock, "fence", `Next ${eventType} fence`),
    expected.fence,
    `Next ${eventType} fence`,
  );
  let payloadKind;
  const payloadVariants = expected.payload.exactVariants ?? [expected.payload];
  const primaryPayload = payloadVariants[0];
  if (eventType === "worker-ready") payloadKind = "worker-ready";
  else if (eventType === "worker-failed") payloadKind = "failure";
  else if (eventType === "job-resource-exhausted") payloadKind = "resource-exhaustion";
  else if (primaryPayload.exactFields.length === 0) payloadKind = "empty";
  else if (primaryPayload.exactFields.includes("failureCode")) payloadKind = "failure";
  else if (primaryPayload.exactFields[0] === "state") payloadKind = "state";
  else if (primaryPayload.exactFields[0] === "stage" && primaryPayload.exactFields.length === 1) {
    payloadKind = "stage";
  } else if (primaryPayload.exactFields.includes("progressCurrent")) payloadKind = "progress";
  else payloadKind = "artifact";
  requireEqual(
    sourceStringProperty(ruleBlock, "payload", `Next ${eventType} payload discriminator`),
    payloadKind,
    `Next ${eventType} payload discriminator`,
  );
  const expectedRuleFields = payloadKind === "state" ? ["fence", "payload", "state"] : ["fence", "payload"];
  requireStrings(
    [...ruleBlock.matchAll(/\b([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g)].map((match) => match[1]),
    expectedRuleFields,
    `Next ${eventType} exact rule fields`,
    false,
  );
  if (payloadKind === "state") {
    requireEqual(
      sourceStringProperty(ruleBlock, "state", `Next ${eventType} fixed state`),
      primaryPayload.fixed.state,
      `Next ${eventType} fixed state`,
    );
  }
}
requireStrings(
  sourceStringArray(
    next,
    /const RUNTIME_JOB_STATES\s*=\s*new Set<[^>]+>\(\s*\[([\s\S]*?)\]\s*\);/,
    "Next runtime-job states",
  ),
  jobStates,
  "Next runtime-job states",
);
requireStrings(
  sourceStringArray(
    next,
    /const RUNTIME_JOB_RESOURCE_CLASSES\s*=\s*new Set<[^>]+>\(\s*\[([\s\S]*?)\]\s*\);/,
    "Next runtime resource classes",
  ),
  resourceClasses,
  "Next runtime resource classes",
);
requirePattern(
  next,
  /"x-breadboard-user-id":\s*String\(authority\.userId\)[\s\S]*?"x-breadboard-garden-id"[\s\S]*?"x-breadboard-conversation-id"/,
  "Next runtime-job authority headers differ from the contract",
);
requirePattern(
  next,
  /function validateRuntimeJobAuthority[\s\S]*?!isSafePositiveInteger\(authority\.userId\)/,
  "Next runtime-job user authority must be a positive JSON-safe integer",
);
requirePattern(
  next,
  /function isRuntimeScope[\s\S]*?\^\[\\x21-\\x7e\]\+\$/,
  "Next runtime-job scopes must use the shared visible-ASCII header grammar",
);
requirePattern(
  next,
  /export async function submitRuntimeJob[\s\S]*?JSON\.stringify\(\{[\s\S]*?jobType:[\s\S]*?gardenId:[\s\S]*?conversationId:[\s\S]*?idempotencyKey:[\s\S]*?requestPayload:[\s\S]*?runtimeJobRequest\("\/v1\/jobs",\s*"POST"/,
  "Next Runtime V2 submission endpoint or bounded payload differs from the contract",
);
requirePattern(
  next,
  /export async function submitRuntimeJob[\s\S]*?parseRuntimeJobResponse\(value,\s*authority,\s*\{\s*jobType:\s*submission\.jobType\s*\}\)/,
  "Next Runtime V2 submission response is not bound to the submitted job type",
);
requirePattern(
  next,
  /async function runtimeLearnRecoveryRequest[\s\S]*?`\$\{target\.origin\}\/v1\/internal\/jobs\/learn-recovery`[\s\S]*?method:\s*"POST"[\s\S]*?authorization:\s*`Bearer \$\{target\.token\}`[\s\S]*?"content-type":\s*"application\/json"/,
  "Next fixed Learn-recovery request differs from the bearer-only internal route",
);
const nextLearnRecoveryRequestBlock = sourceBlock(
  next,
  /async function runtimeLearnRecoveryRequest\s*\(/,
  "Next fixed Learn-recovery request",
);
requireAbsent(
  nextLearnRecoveryRequestBlock,
  /x-breadboard-(?:user-id|garden-id|conversation-id)/,
  "Next fixed Learn-recovery request sends caller authority headers",
);
requirePattern(
  next,
  /export async function submitRuntimeLearnRecoveryJob[\s\S]*?\^learn-recovery-v2:\(\\d\{1,16\}\)\$[\s\S]*?Number\.isSafeInteger\(Number\(match\[1\]\)\)[\s\S]*?JSON\.stringify\(\{ idempotencyKey \}\)[\s\S]*?byteLength > 1024[\s\S]*?runtimeLearnRecoveryRequest\(body, env\)[\s\S]*?gardenId:\s*null,\s*conversationId:\s*null[\s\S]*?jobType:\s*"learn"/,
  "Next Learn-recovery helper does not enforce the fixed body, scope, job type, and key grammar",
);
requirePattern(
  next,
  /function assertRuntimeJsonValue[\s\S]*?MAX_RUNTIME_JSON_NODES[\s\S]*?Number\.isFinite\(candidate\)[\s\S]*?Object\.getPrototypeOf[\s\S]*?Object\.getOwnPropertyDescriptors[\s\S]*?assertRuntimeJsonValue\(submission\.requestPayload\)/,
  "Next Runtime V2 submission must reject lossy or unbounded pre-serialization payloads",
);
requirePattern(
  next,
  /submission\.idempotencyKey[\s\S]*?MAX_RUNTIME_IDEMPOTENCY_KEY_BYTES[\s\S]*?\\p\{Cc\}\/u/,
  "Next Runtime V2 idempotency keys must use the shared Unicode-control-free grammar",
);
requirePattern(
  next,
  /export async function inspectRuntimeJob[\s\S]*?runtimeJobRequest\(`\/v1\/jobs\/\$\{jobId\}`,\s*"GET"/,
  "Next Runtime V2 inspection endpoint differs from the contract",
);
requirePattern(
  next,
  /export async function inspectRuntimeJob[\s\S]*?parseRuntimeJobResponse\(value,\s*authority,\s*\{\s*jobId\s*\}\)/,
  "Next Runtime V2 inspection response is not bound to the requested job",
);
requirePattern(
  next,
  /export async function replayRuntimeJobEvents[\s\S]*?`\/v1\/jobs\/\$\{jobId\}\/events\?after=\$\{after\}&limit=\$\{limit\}`[\s\S]*?"GET"/,
  "Next Runtime V2 event endpoint differs from the contract",
);
requirePattern(
  next,
  /export async function replayRuntimeJobEvents[\s\S]*?parseRuntimeJobEventsResponse\(value,\s*authority,\s*jobId,\s*after,\s*limit\)/,
  "Next Runtime V2 event response is not bound to the requested page limit",
);
requirePattern(
  next,
  /export async function cancelRuntimeJob[\s\S]*?`\/v1\/jobs\/\$\{jobId\}\/cancel`[\s\S]*?"POST"/,
  "Next Runtime V2 cancellation endpoint differs from the contract",
);
requirePattern(
  next,
  /export async function cancelRuntimeJob[\s\S]*?parseRuntimeJobResponse\(value,\s*authority,\s*\{\s*jobId\s*\}\)/,
  "Next Runtime V2 cancellation response is not bound to the requested job",
);
requirePattern(
  next,
  /export async function cancelRuntimeJobByIdempotencyKey[\s\S]*?validateRuntimeJobAuthority\(authority\)[\s\S]*?MAX_RUNTIME_IDEMPOTENCY_KEY_BYTES[\s\S]*?\\p\{Cc\}\/u[\s\S]*?runtimeJobRequest\([\s\S]*?"\/v1\/jobs\/cancel-by-idempotency"[\s\S]*?"POST"[\s\S]*?JSON\.stringify\(\{ idempotencyKey \}\)[\s\S]*?parseRuntimeJobIdempotencyCancellationDisposition\(value\)/,
  "Next idempotency-cancellation helper does not bind authority, key, exact body, route, and response",
);
requirePattern(
  next,
  /function parseRuntimeJobIdempotencyCancellationDisposition[\s\S]*?hasExactKeys\(value,\s*\[[\s\S]*?"type"[\s\S]*?"protocolVersion"[\s\S]*?"jobId"[\s\S]*?"state"[\s\S]*?"accepted"[\s\S]*?value\.state === "pending"[\s\S]*?value\.jobId === null && value\.accepted === true[\s\S]*?value\.state === "cancelling" \|\| value\.state === "cancelled"[\s\S]*?value\.jobId !== null && value\.accepted === true[\s\S]*?"queued"[\s\S]*?"checkpointing"[\s\S]*?value\.jobId !== null[\s\S]*?value\.accepted === false[\s\S]*?return \{\s*jobId:[\s\S]*?state:[\s\S]*?accepted:[\s\S]*?\}/,
  "Next idempotency-cancellation response parser does not enforce the exact closed disposition matrix",
);
requirePattern(
  next,
  /function parseRuntimeJobSnapshot[\s\S]*?hasExactKeys\(value,\s*RUNTIME_JOB_FIELDS\)[\s\S]*?value\.gardenId !== authority\.gardenId[\s\S]*?value\.conversationId !== authority\.conversationId[\s\S]*?function parseRuntimeJobResponse[\s\S]*?expected\.jobId[\s\S]*?job\.jobId[\s\S]*?expected\.jobType[\s\S]*?job\.jobType/,
  "Next runtime-job response must be exact, scope-bound, and request-bound",
);
requirePattern(
  next,
  /function hasValidRuntimeJobFailure[\s\S]*?RUNTIME_PUBLIC_FAILURE_CODES\.has\(value\.failureCode[\s\S]*?value\.failureMessage !== SANITIZED_RUNTIME_FAILURE_MESSAGE[\s\S]*?case "RUNTIME_JOB_FAILED":[\s\S]*?case "WORKER_FAILED":[\s\S]*?value\.state === "failed"[\s\S]*?case "BREADBOARD_RESOURCE_EXHAUSTED":[\s\S]*?value\.state === "resource_exhausted"[\s\S]*?case "JOB_INTERRUPTED":[\s\S]*?value\.state === "interrupted"[\s\S]*?case "JOB_UNCERTAIN":[\s\S]*?value\.state === "uncertain"[\s\S]*?default:[\s\S]*?return false[\s\S]*?function parseRuntimeJobSnapshot[\s\S]*?RUNTIME_PUBLIC_STAGES\.has\(value\.stage[\s\S]*?hasValidRuntimeJobFailure\(value\)/,
  "Next runtime-job snapshot does not enforce closed runtime-owned stage/failure values",
);
requirePattern(
  next,
  /function parseRuntimeJobEventsResponse[\s\S]*?typeof value\.hasMore !== "boolean"[\s\S]*?value\.events\.length > requestedLimit[\s\S]*?value\.hasMore && value\.events\.length === 0[\s\S]*?parsed\.jobId !== expectedJobId[\s\S]*?parsed\.sequence <= previous[\s\S]*?previous !== value\.nextAfter/,
  "Next event replay must enforce continuation progress, its requested page bound, one job, strict ordering, and exact cursor",
);
requirePattern(
  next,
  /function parseRuntimeJobEventPayload[\s\S]*?case "empty":[\s\S]*?hasExactKeys\(value,\s*\[\]\)[\s\S]*?case "state":[\s\S]*?hasExactKeys\(value,\s*\["state"\]\)[\s\S]*?value\.state === rule\.state[\s\S]*?case "stage":[\s\S]*?hasExactKeys\(value,\s*\["stage"\]\)[\s\S]*?RUNTIME_PUBLIC_STAGES\.has\(value\.stage[\s\S]*?case "progress":[\s\S]*?hasExactKeys\(value,\s*\["stage",\s*"progressCurrent",\s*"progressTotal"\]\)[\s\S]*?value\.progressCurrent <= value\.progressTotal/,
  "Next event replay does not enforce the exact empty/state/stage/progress payload shapes",
);
requirePattern(
  next,
  /case "artifact":[\s\S]*?hasExactKeys\(value,\s*\["artifactKind"\]\)[\s\S]*?RUNTIME_PUBLIC_ARTIFACT_KINDS\.has\(\s*value\.artifactKind[\s\S]*?case "failure":[\s\S]*?hasExactKeys\(value,\s*\["state",\s*"failureCode",\s*"failureMessage"\]\)[\s\S]*?value\.state === "failed"[\s\S]*?value\.failureCode === "WORKER_FAILED"[\s\S]*?value\.failureMessage === SANITIZED_RUNTIME_FAILURE_MESSAGE/,
  "Next event replay does not enforce closed runtime-owned artifact and failure payloads",
);
requirePattern(
  next,
  /function hasValidRuntimeJobEventFence[\s\S]*?case "runtime-zero":[\s\S]*?value\.attempt === 0[\s\S]*?value\.workerInstanceId === null[\s\S]*?value\.workerSequence === null[\s\S]*?case "runtime-attempt":[\s\S]*?isSafePositiveInteger\(value\.attempt\)[\s\S]*?isRuntimeIdentifier\(value\.workerInstanceId\)[\s\S]*?value\.workerSequence === null[\s\S]*?case "runtime-current":[\s\S]*?value\.attempt === 0 && value\.workerInstanceId === null[\s\S]*?isSafePositiveInteger\(value\.attempt\)[\s\S]*?isRuntimeIdentifier\(value\.workerInstanceId\)[\s\S]*?case "worker":[\s\S]*?isSafePositiveInteger\(value\.workerSequence\)/,
  "Next event replay does not enforce the exact four event-fence classes",
);
requirePattern(
  next,
  /function parseRuntimeJobEvent\([\s\S]*?isRuntimeJobEventType\(value\.eventType\)[\s\S]*?RUNTIME_JOB_EVENT_RULES\[value\.eventType\][\s\S]*?hasValidRuntimeJobEventFence\(value,\s*rule\.fence\)[\s\S]*?parseRuntimeJobEventPayload\(value\.eventType,\s*value\.payload\)/,
  "Next event replay does not bind its exact payload and fence rules to the event discriminator",
);
requirePattern(
  next,
  /function parseRuntimeJobError[\s\S]*?value\.retryable !== false[\s\S]*?isResourceExhaustion[\s\S]*?!isSafePositiveInteger\(required\)[\s\S]*?!isResourceExhaustion[\s\S]*?resource !== null/,
  "Next runtime errors must preserve non-retryable, atomic resource exhaustion evidence",
);
requirePattern(
  next,
  /const MAX_SERVICE_LEASE_ACQUIRE_TIMEOUT_MS\s*=\s*MAX_MANIFEST_SERVICE_STARTUP_TIMEOUT_MS\s*\+\s*SERVICE_LEASE_SETTLEMENT_GRACE_MS\s*\+\s*SERVICE_LEASE_RESPONSE_GRACE_MS\s*;/,
  "Next maximum service-acquire timeout is not derived from the shared manifest and runtime grace bounds",
);
const nextServiceLeaseContractBlock = sourceBlock(
  next,
  /async function serviceLeaseControlTimeoutMs\s*\(/,
  "Next passive service-lease deadline preflight",
);
requirePattern(
  nextServiceLeaseContractBlock,
  /`\$\{target\.origin\}\/v1\/services\/\$\{serviceId\}\/lease-contract`[\s\S]*?method:\s*"GET"[\s\S]*?authorization:\s*`Bearer \$\{target\.token\}`[\s\S]*?readBoundedControlJson\(response\)[\s\S]*?hasExactKeys\(value,\s*\["protocolVersion",\s*"serviceId",\s*"acquireTimeoutMs"\]\)[\s\S]*?value\.protocolVersion !== 1[\s\S]*?value\.serviceId !== serviceId[\s\S]*?Number\.isSafeInteger\(value\.acquireTimeoutMs\)[\s\S]*?SERVICE_LEASE_SETTLEMENT_GRACE_MS \+ SERVICE_LEASE_RESPONSE_GRACE_MS[\s\S]*?MAX_SERVICE_LEASE_ACQUIRE_TIMEOUT_MS[\s\S]*?SERVICE_LEASE_TRANSPORT_GRACE_MS/,
  "Next service-lease deadline preflight is not authenticated, closed, service-bound, and bounded",
);
requireAbsent(
  nextServiceLeaseContractBlock,
  /method:\s*"POST"|\bcontrol\s*</,
  "Next service-lease deadline preflight performs an active control mutation",
);
requirePattern(
  next,
  /export async function acquireServiceLease\([\s\S]*?serviceLeaseControlTimeoutMs\(serviceId,\s*env\)[\s\S]*?`\/v1\/services\/\$\{serviceId\}\/lease`[\s\S]*?\{ reason \}[\s\S]*?timeoutMs \?\? CONTROL_TIMEOUT_MS[\s\S]*?typeof result\.leaseId !== "string"[\s\S]*?result\.serviceId !== serviceId[\s\S]*?targetId:\s*serviceId/,
  "Next service acquire is not bound to the requested service and opaque lease ID",
);
requirePattern(
  next,
  /export async function releaseSupervisorLease\([\s\S]*?`\/v1\/leases\/\$\{encodeURIComponent\(id\)\}\/release`[\s\S]*?ownerPid === undefined \? \{\} : \{ afterOwnerPidExit: ownerPid \}/,
  "Next default service release is not an exact empty JSON mutation on an encoded lease route",
);
requirePattern(
  next,
  /export async function withServiceLease[\s\S]*?acquireServiceLease\(serviceId,\s*reason,\s*env\)[\s\S]*?finally[\s\S]*?releaseSupervisorLease\(lease,\s*env\)/,
  "Next service lease scope does not release on success or failure through the exact default body",
);
requireAbsent(
  next,
  /export\s+(?:async\s+)?function\s+\w*Runtime\w*\([^)]*(?:executable|command|cwd)/i,
  "Next Runtime V2 adapter exposes process launch authority",
);

requireAbsent(
  electron,
  /export\s+(?:async\s+)?function\s+(?:submit|inspect|replay|cancel)RuntimeJob/,
  "Electron must not become a second Runtime V2 job compatibility layer",
);

if (failures.length > 0) {
  for (const failure of failures) {
    process.stderr.write(`[runtime-v2-control-contract] FAIL: ${failure}\n`);
  }
  process.stderr.write(`[runtime-v2-control-contract] FAILED: ${failures.length} issue(s).\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    "[runtime-v2-control-contract] PASS: JSON, Rust protocol/control, Electron, and Next source agree on bounded authenticated job and service-lease control, durable exact-scope pre-submission cancellation, fixed internal Learn recovery, exact route/response binding, the closed 25-event payload/fence matrix, runtime-owned public values, and bootstrap/ready/status/shutdown. Source-only validation started no build, compiler, app, service, worker, browser, model, or container.\n",
  );
}
