#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const qaDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(qaDir, "..", "..");
const contractPath = path.join(repoRoot, "native", "runtime-protocol", "runtime-control-contract.json");
const rustPath = path.join(repoRoot, "native", "runtime-protocol", "src", "lib.rs");
const rustControlPath = path.join(repoRoot, "native", "runtime-cli", "src", "control.rs");
const rustDurableJobControlPath = path.join(repoRoot, "native", "runtime-cli", "src", "durable_job_control.rs");
const rustHostPath = path.join(repoRoot, "native", "runtime-cli", "src", "host.rs");
const rustControlViewsPath = path.join(repoRoot, "native", "runtime-core", "src", "control_views.rs");
const rustPathsPath = path.join(repoRoot, "native", "runtime-core", "src", "paths.rs");
const rustRegistryPath = path.join(repoRoot, "native", "runtime-core", "src", "registry.rs");
const rustStorePath = path.join(repoRoot, "native", "runtime-core", "src", "store.rs");
const electronPath = path.join(repoRoot, "desktop", "src", "main", "runtime-process.ts");
const electronPathResolverPath = path.join(repoRoot, "desktop", "src", "main", "path-resolver.ts");
const nextPath = path.join(repoRoot, "dashboard", "src", "lib", "supervisor-control.ts");

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
const rustDurableJobControl = readText(rustDurableJobControlPath, "Rust durable job control source");
const rustHost = readText(rustHostPath, "Rust authoritative host source");
const rustControlViews = readText(rustControlViewsPath, "Rust runtime control projection source");
const rustPaths = readText(rustPathsPath, "Rust trusted path source");
const rustRegistry = readText(rustRegistryPath, "Rust launch registry source");
const rustStore = readText(rustStorePath, "Rust runtime durable store source");
const electron = readText(electronPath, "Electron runtime adapter source");
const electronPathResolver = readText(
  electronPathResolverPath,
  "Electron authoritative path resolver source",
);
const next = readText(nextPath, "Next runtime control adapter source");

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
  "state",
  "lastError",
  "restarts",
  "adopted",
];
const jobSubmissionRequiredFields = ["jobType", "idempotencyKey", "requestPayload"];
const jobSubmissionOptionalFields = ["gardenId", "conversationId"];
const jobSubmissionFields = [
  "jobType",
  "gardenId",
  "conversationId",
  "idempotencyKey",
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
  "worker-ready": stateEventRule("worker", "worker", "running"),
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
      exactFields: ["state", "failureCode", "failureMessage"],
      fixed: {
        state: "failed",
        failureCode: "WORKER_FAILED",
        failureMessage: sanitizedRuntimeFailureMessage,
      },
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
  "job-resource-exhausted": stateEventRule(
    "runtime",
    "runtime-current",
    "resource_exhausted",
  ),
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
const runtimeJobErrorCodes = [
  "INVALID_JOB_REQUEST",
  "JOB_SCOPE_FORBIDDEN",
  "JOB_NOT_FOUND",
  "JOB_CONFLICT",
  "BREADBOARD_RESOURCE_EXHAUSTED",
  "RUNTIME_UNAVAILABLE",
  "RUNTIME_INTERNAL_ERROR",
];
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
requireEqual(contract.launchManifests?.workerManifestVersion, 1, "launchManifests.workerManifestVersion");
requireEqual(contract.launchManifests?.serviceManifestVersion, 1, "launchManifests.serviceManifestVersion");
requireEqual(contract.launchManifests?.maximumFileBytes, 262_144, "launchManifests.maximumFileBytes");
requireEqual(contract.launchManifests?.manifestAuthority, "runtimeRoot", "launchManifests.manifestAuthority");
requireEqual(
  contract.launchManifests?.allowedExecutableAuthority,
  "runtimeRoot",
  "launchManifests.allowedExecutableAuthority",
);
requireEqual(
  contract.launchManifests?.allowedEntrypointAuthority,
  "appRoot",
  "launchManifests.allowedEntrypointAuthority",
);
requireStrings(
  contract.launchManifests?.requiredServiceIds,
  ["chatmock", "dashboard", "hermes"],
  "launchManifests.requiredServiceIds",
);
requireStrings(
  contract.launchManifests?.requiredWorkerJobTypes,
  ["learn", "document-ingestion"],
  "launchManifests.requiredWorkerJobTypes",
);
for (const field of [
  "rejectMissingDefinitions",
  "rejectAbsoluteOrTraversingPaths",
  "ordinaryRequestsCannotSupplyDefinitions",
]) {
  requireEqual(contract.launchManifests?.[field], true, `launchManifests.${field}`);
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
requireStrings(
  contract.errorResponse?.requiredFields,
  errorResponseFields,
  "errorResponse.requiredFields",
);
requireEqual(contract.errorResponse?.type, "runtime-error", "errorResponse.type");
requireEqual(contract.errorResponse?.denyUnknownFields, true, "errorResponse.denyUnknownFields");
requireStrings(contract.errorResponse?.codes, runtimeJobErrorCodes, "errorResponse.codes");
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
requireEqual(contract.control?.status?.method, "GET", "control.status.method");
requireEqual(contract.control?.status?.path, "/v1/status", "control.status.path");
requireEqual(contract.control?.submitJob?.method, "POST", "control.submitJob.method");
requireEqual(contract.control?.submitJob?.path, "/v1/jobs", "control.submitJob.path");
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
    /pub const MAX_CONCURRENCY:\s*u32\s*=\s*([^;]+);/,
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
  /fn parse_bounded_json[\s\S]*?if bytes\.len\(\) > MAX_REQUEST_BODY_BYTES/,
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
  if (payload.exactFields.length === 1 && payload.exactFields[0] === "state") {
    requireEqual(
      actualRustStateEvents.get(eventType),
      payload.fixed.state,
      `Rust ${eventType} fixed-state payload`,
    );
  } else if (payload.exactFields.length === 0) {
    if (!actualRustEmptyEvents.includes(eventType)) {
      fail(`Rust ${eventType} is missing from the exact empty-payload group`);
    }
  }
}
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
  /Event::WorkerFailed\s*=>\s*\{[\s\S]*?self\.state\s*==\s*Some\(JobState::Failed\)[\s\S]*?self\.failure_code\s*==\s*Some\(RuntimePublicFailureCode::WorkerFailed\)[\s\S]*?self\.failure_message\.as_deref\(\)\s*==\s*Some\(SANITIZED_RUNTIME_FAILURE_MESSAGE\)[\s\S]*?self\.stage\.is_none\(\)[\s\S]*?self\.progress_current\.is_none\(\)[\s\S]*?self\.progress_total\.is_none\(\)[\s\S]*?self\.artifact_kind\.is_none\(\)/,
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
for (const code of runtimeJobErrorCodes) {
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
  /pin_service_executable_for_launch[\s\S]*?resolve_runtime[\s\S]*?pin_runtime_file_for_launch[\s\S]*?pin_service_entrypoint_for_launch[\s\S]*?resolve_app[\s\S]*?pin_app_file_for_launch/,
  "Service executable and entrypoint are not pinned by distinct runtime/app authorities",
);

requirePattern(
  rustControl,
  /const USER_ID_HEADER:\s*&str\s*=\s*"x-breadboard-user-id";/,
  "Rust control server user authority header differs from the contract",
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
  /fn request_body_limit[\s\S]*?method == "POST" && path == "\/v1\/jobs"[\s\S]*?MAX_REQUEST_BODY_BYTES[\s\S]*?else\s*\{\s*0\s*\}/,
  "Rust control server must accept a body only for bounded job submission",
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
  /authority\.authenticate_user\([\s\S]*?request\.authorization[\s\S]*?user_id[\s\S]*?request\.garden_id[\s\S]*?request\.conversation_id/,
  "Rust control server must mint job context only after bearer and scope authentication",
);
requirePattern(
  rustControl,
  /parse_job_submission_payload\(&request\.body\)[\s\S]*?job_control\.submit_job\(&context,\s*&payload\)/,
  "Rust control server must parse the bounded body before authorized submission",
);
requirePattern(
  rustControl,
  /path == "\/v1\/jobs"[\s\S]*?JobRoute::Submit[\s\S]*?"cancel"[\s\S]*?JobRoute::Cancel[\s\S]*?"events"[\s\S]*?parse_event_query/,
  "Rust control server job endpoints differ from the contract",
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
  rustDurableJobControl,
  /replay_job_events_snapshot\(context,\s*job_id,\s*after_sequence,\s*limit\)[\s\S]*?runtime_job_events_response\([\s\S]*?&snapshot\.job,[\s\S]*?snapshot\.public_event_stream_sealed,[\s\S]*?&snapshot\.events/,
  "Rust durable job control must project the explicit event-stream seal from the atomic replay snapshot",
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
  if (expected.payload.exactFields.length === 0) payloadKind = "empty";
  else if (expected.payload.exactFields.includes("failureCode")) payloadKind = "failure";
  else if (expected.payload.exactFields[0] === "state") payloadKind = "state";
  else if (expected.payload.exactFields[0] === "stage" && expected.payload.exactFields.length === 1) {
    payloadKind = "stage";
  } else if (expected.payload.exactFields.includes("progressCurrent")) payloadKind = "progress";
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
      expected.payload.fixed.state,
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
    "[runtime-v2-control-contract] PASS: JSON, Rust protocol/control, Electron, and Next source agree on bounded authenticated job submission/inspection/cancellation, the exact closed 25-event payload/fence matrix, runtime-owned public stage/artifact/failure values, and bootstrap/ready/status/shutdown. Source-only validation started no build, compiler, app, service, worker, browser, model, or container.\n",
  );
}
