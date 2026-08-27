import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  packageVerificationBinding,
  validatePackageVerifierReceipt,
} from "./package-verifier-receipt.mjs";

export const PARITY_EVIDENCE_OBSERVATION_SCHEMA_VERSION = 1;
export const PARITY_EVIDENCE_OBSERVATION_KIND = "breadboard-runtime-v2-parity-observation";
export const PARITY_EVIDENCE_OBSERVATION_MAX_DURATION_MS = 12 * 60 * 60_000;
export const PARITY_EVIDENCE_OBSERVATION_MAX_AGE_MS = 12 * 60 * 60_000;
export const PARITY_EVIDENCE_OBSERVATION_FUTURE_TOLERANCE_MS = 5 * 60_000;

const SHA256_PATTERN = /^[0-9A-F]{64}$/u;
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const BOUNDED_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const BLOCKER_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,127}$/u;
const PRODUCER_PATTERN = /^qa\/electron\/specs\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.spec\.ts$/u;
const EVIDENCE_TYPES = Object.freeze([
  "electron",
  "service",
  "worker",
  "output",
  "cancellation",
  "recovery",
]);
const PREREQUISITE_TYPES = Object.freeze([
  "CREDENTIAL",
  "MODEL_FILE",
  "EXTERNAL_SERVICE",
  "EXTERNAL_SOFTWARE",
]);
const EVIDENCE_ROOTS = Object.freeze([".qa-results/", "qa/runtime-v2/evidence/"]);
const MAX_OBSERVATION_BYTES = 16 * 1024 * 1024;
const MAX_PACKAGE_RECEIPT_BYTES = 32 * 1024 * 1024;
const MAX_PRODUCER_BYTES = 2 * 1024 * 1024;
const MAX_SUPPORTING_ARTIFACT_BYTES = 1024 * 1024 * 1024;
const MAX_SUPPORTING_ARTIFACTS = 128;
const FILE_TIME_TOLERANCE_MS = 5 * 60_000;
const PACKAGE_RUN_CONTEXT_KIND = "breadboard-runtime-v2-parity-package-run-context";
// The private WeakMap membership is the authority. The frozen public value is
// deliberately insufficient: clones, IPC values, and hand-built lookalikes fail.
const packageRunContexts = new WeakMap();

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fail(message) {
  throw new Error(`Runtime V2 parity observation rejected: ${message}`);
}

function exactKeys(value, expected, label) {
  if (!record(value)) fail(`${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail(`${label} fields must be exactly ${wanted.join(", ")}.`);
  }
}

function exactKeysWithOptional(value, required, optional, label) {
  if (!record(value)) fail(`${label} must be an object.`);
  for (const key of required) {
    if (!Object.hasOwn(value, key)) fail(`${label} is missing ${key}.`);
  }
  const allowed = new Set([...required, ...optional]);
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) fail(`${label} has unexpected field(s): ${unexpected.sort().join(", ")}.`);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!record(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

function same(left, right) {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex").toUpperCase();
}

function sha256Text(value) {
  return sha256Bytes(Buffer.from(value, "utf8"));
}

function canonicalIso(value, label) {
  if (typeof value !== "string") fail(`${label} must be a canonical ISO timestamp.`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    fail(`${label} must be a canonical ISO timestamp.`);
  }
  return parsed;
}

function boundedString(value, label, maxLength = 500) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength ||
    value.trim() !== value ||
    /[\0\r\n]/u.test(value)
  ) {
    fail(`${label} must be a non-empty trimmed single-line string of at most ${maxLength} characters.`);
  }
  return value;
}

function boundedId(value, label) {
  if (typeof value !== "string" || !BOUNDED_ID_PATTERN.test(value)) {
    fail(`${label} is not a canonical bounded identifier.`);
  }
  return value;
}

function runId(value, label) {
  if (typeof value !== "string" || !RUN_ID_PATTERN.test(value)) {
    fail(`${label} is not a canonical run identifier.`);
  }
  return value;
}

function uppercaseSha256(value, label) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    fail(`${label} must be an uppercase SHA-256.`);
  }
  return value;
}

function trueClaim(value, label) {
  if (value !== true) fail(`${label} must be true.`);
}

function zeroClaim(value, label) {
  if (value !== 0) fail(`${label} must be zero.`);
}

function canonicalRelativePath(relativePath, label) {
  if (
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    relativePath.length > 1024 ||
    relativePath.includes("\\") ||
    relativePath.includes("#") ||
    relativePath.includes("\0") ||
    path.posix.isAbsolute(relativePath)
  ) {
    fail(`${label} is not a canonical repository-relative path.`);
  }
  const segments = relativePath.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    fail(`${label} is not a canonical repository-relative path.`);
  }
  return relativePath;
}

function evidencePath(relativePath, label) {
  const canonical = canonicalRelativePath(relativePath, label);
  if (!EVIDENCE_ROOTS.some((root) => canonical.startsWith(root))) {
    fail(`${label} must live under .qa-results/ or qa/runtime-v2/evidence/.`);
  }
  return canonical;
}

function withinRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function canonicalRepoRoot(repoRoot) {
  if (typeof repoRoot !== "string" || !path.isAbsolute(repoRoot)) {
    fail("repoRoot must be an existing absolute directory.");
  }
  const resolved = fs.realpathSync(path.resolve(repoRoot));
  if (!fs.statSync(resolved).isDirectory()) fail("repoRoot must be an existing absolute directory.");
  return resolved;
}

function resolveExistingRepoFile(root, relativePath, label, { evidence = false } = {}) {
  const canonical = evidence
    ? evidencePath(relativePath, label)
    : canonicalRelativePath(relativePath, label);
  const candidate = path.resolve(root, ...canonical.split("/"));
  if (!withinRoot(root, candidate)) fail(`${label} escaped the repository root.`);
  const stat = fs.statSync(candidate, { throwIfNoEntry: false });
  if (!stat?.isFile()) fail(`${label} does not identify an existing regular file: ${canonical}`);
  const realCandidate = fs.realpathSync(candidate);
  if (!withinRoot(root, realCandidate)) fail(`${label} resolves outside the repository root.`);
  return Object.freeze({ absolutePath: realCandidate, relativePath: canonical });
}

function resolveObservationTarget(root, relativePath) {
  const canonical = evidencePath(relativePath, "observationPath");
  const candidate = path.resolve(root, ...canonical.split("/"));
  if (!withinRoot(root, candidate)) fail("observationPath escaped the repository root.");
  const directorySegments = canonical.split("/").slice(0, -1);
  let checkedDirectory = root;
  for (const segment of directorySegments) {
    const next = path.join(checkedDirectory, segment);
    const existing = fs.lstatSync(next, { throwIfNoEntry: false });
    if (!existing) fs.mkdirSync(next);
    const realNext = fs.realpathSync(next);
    if (!withinRoot(root, realNext) || !fs.statSync(realNext).isDirectory()) {
      fail("observationPath parent resolves outside the repository root or is not a directory.");
    }
    checkedDirectory = realNext;
  }
  const realParent = checkedDirectory;
  if (!withinRoot(root, realParent)) fail("observationPath parent resolves outside the repository root.");
  const target = path.join(realParent, path.basename(candidate));
  if (fs.lstatSync(target, { throwIfNoEntry: false })) {
    fail(`observationPath already exists; observations are immutable: ${canonical}`);
  }
  return Object.freeze({ absolutePath: target, relativePath: canonical });
}

function sameFileState(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs
  );
}

function snapshotFileIdentity(file, label, { maxBytes, expectedName = null, pathSha256 = false } = {}) {
  const before = fs.statSync(file, { throwIfNoEntry: false });
  if (!before?.isFile() || before.size <= 0 || before.size > maxBytes) {
    fail(`${label} must be a non-empty regular file no larger than ${maxBytes} bytes.`);
  }
  if (expectedName && path.basename(file).toLowerCase() !== expectedName.toLowerCase()) {
    fail(`${label} must be ${expectedName}.`);
  }
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
  const after = fs.statSync(file, { throwIfNoEntry: false });
  if (!after?.isFile() || !sameFileState(before, after)) fail(`${label} changed while it was being hashed.`);
  const identity = {
    bytes: after.size,
    sha256: hash.digest("hex").toUpperCase(),
    capturedAt: after.mtime.toISOString(),
  };
  if (expectedName) identity.fileName = path.basename(file);
  if (pathSha256) {
    const normalizedPath = path.normalize(fs.realpathSync(file));
    identity.pathSha256 = sha256Text(process.platform === "win32" ? normalizedPath.toLowerCase() : normalizedPath);
  }
  return Object.freeze(identity);
}

function readBoundedJsonSnapshot(file, label) {
  const before = fs.statSync(file, { throwIfNoEntry: false });
  if (!before?.isFile() || before.size < 2 || before.size > MAX_OBSERVATION_BYTES) {
    fail(`${label} does not exist or has an invalid size.`);
  }
  const bytes = fs.readFileSync(file);
  const after = fs.statSync(file, { throwIfNoEntry: false });
  if (!after?.isFile() || !sameFileState(before, after) || bytes.length !== after.size) {
    fail(`${label} changed while it was being read.`);
  }
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    fail(`${label} is malformed JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return Object.freeze({
    value,
    identity: Object.freeze({
      bytes: bytes.length,
      sha256: sha256Bytes(bytes),
      capturedAt: after.mtime.toISOString(),
    }),
  });
}

function validateFileReference(reference, label) {
  exactKeys(reference, ["path", "bytes", "sha256", "capturedAt"], label);
  const validatedPath = evidencePath(reference.path, `${label}.path`);
  if (!Number.isSafeInteger(reference.bytes) || reference.bytes <= 0 || reference.bytes > MAX_SUPPORTING_ARTIFACT_BYTES) {
    fail(`${label}.bytes is invalid.`);
  }
  uppercaseSha256(reference.sha256, `${label}.sha256`);
  canonicalIso(reference.capturedAt, `${label}.capturedAt`);
  return Object.freeze({ ...reference, path: validatedPath });
}

function producerIdentity(root, producerPath, recorderName = "recordParityEvidenceObservation") {
  if (typeof producerPath !== "string" || !PRODUCER_PATTERN.test(producerPath)) {
    fail("producerPath is not allowlisted under qa/electron/specs/**/*.spec.ts.");
  }
  const resolved = resolveExistingRepoFile(root, producerPath, "producerPath");
  const identity = snapshotFileIdentity(resolved.absolutePath, "producer", { maxBytes: MAX_PRODUCER_BYTES });
  const source = fs.readFileSync(resolved.absolutePath, "utf8");
  const recorderPattern = recorderName === "recordParityEvidenceFailure"
    ? /\brecordParityEvidenceFailure\s*\(/u
    : /\brecordParityEvidenceObservation\s*\(/u;
  if (!recorderPattern.test(source)) {
    fail(`allowlisted producer source does not contain a ${recorderName} call.`);
  }
  return Object.freeze({
    absolutePath: resolved.absolutePath,
    recorded: Object.freeze({
      path: resolved.relativePath,
      bytes: identity.bytes,
      sha256: identity.sha256,
    }),
  });
}

function assertProducerIsCaller(absoluteProducerPath) {
  const stack = new Error("parity-observation-producer-check").stack ?? "";
  const normalizedPath = path.normalize(absoluteProducerPath).replaceAll("\\", "/").toLowerCase();
  const encodedPath = encodeURI(normalizedPath);
  const found = stack.split(/\r?\n/u).some((line) => {
    const normalizedLine = line.replaceAll("\\", "/").toLowerCase();
    return normalizedLine.includes(normalizedPath) || normalizedLine.includes(encodedPath);
  });
  if (!found) {
    fail("recordParityEvidenceObservation was not called from the declared allowlisted producer.");
  }
}

function executableIdentity(executablePath) {
  if (typeof executablePath !== "string" || !path.isAbsolute(executablePath)) {
    fail("executablePath must be the absolute path of an existing packaged Breadboard.exe.");
  }
  const resolved = fs.realpathSync(path.resolve(executablePath));
  return snapshotFileIdentity(resolved, "packaged executable", {
    maxBytes: Number.MAX_SAFE_INTEGER,
    expectedName: "Breadboard.exe",
    pathSha256: true,
  });
}

function workflowIdentity(value, label = "workflowIdentity") {
  exactKeys(value, ["electronRunId", "workflowId", "conversationIdSha256"], label);
  runId(value.electronRunId, `${label}.electronRunId`);
  boundedId(value.workflowId, `${label}.workflowId`);
  uppercaseSha256(value.conversationIdSha256, `${label}.conversationIdSha256`);
  return Object.freeze({ ...value });
}

function blocker(value, label = "blocker") {
  exactKeys(value, ["prerequisiteType", "prerequisiteId", "code", "summary"], label);
  if (!PREREQUISITE_TYPES.includes(value.prerequisiteType)) {
    fail(`${label}.prerequisiteType is unsupported.`);
  }
  boundedId(value.prerequisiteId, `${label}.prerequisiteId`);
  if (typeof value.code !== "string" || !BLOCKER_CODE_PATTERN.test(value.code)) {
    fail(`${label}.code is not canonical.`);
  }
  boundedString(value.summary, `${label}.summary`, 500);
  return Object.freeze({ ...value });
}

function validateApplicabilityClaim(value, label, applicableFields, notApplicableField) {
  if (!record(value)) fail(`${label} must be an object.`);
  if (value.applicability === "APPLICABLE") {
    exactKeys(value, ["applicability", ...applicableFields], label);
    return "APPLICABLE";
  }
  if (value.applicability === "NOT_APPLICABLE") {
    exactKeys(value, ["applicability", "inventoryContractObserved", notApplicableField], label);
    trueClaim(value.inventoryContractObserved, `${label}.inventoryContractObserved`);
    trueClaim(value[notApplicableField], `${label}.${notApplicableField}`);
    return "NOT_APPLICABLE";
  }
  fail(`${label}.applicability must be APPLICABLE or NOT_APPLICABLE.`);
}

function validatePassClaims(evidenceType, claims, capabilityId) {
  const label = `${evidenceType} PASS claims`;
  switch (evidenceType) {
    case "electron":
      exactKeys(claims, [
        "uiEntryPoint",
        "selectedCapabilityId",
        "normalEntryPointUsed",
        "realRequestSubmitted",
        "selectionObserved",
        "semanticAssertionsPassed",
        ...(Object.hasOwn(claims, "followUp") ? ["followUp"] : []),
      ], label);
      boundedString(claims.uiEntryPoint, `${label}.uiEntryPoint`);
      if (claims.selectedCapabilityId !== capabilityId) fail(`${label}.selectedCapabilityId does not match capabilityId.`);
      trueClaim(claims.normalEntryPointUsed, `${label}.normalEntryPointUsed`);
      trueClaim(claims.realRequestSubmitted, `${label}.realRequestSubmitted`);
      trueClaim(claims.selectionObserved, `${label}.selectionObserved`);
      trueClaim(claims.semanticAssertionsPassed, `${label}.semanticAssertionsPassed`);
      if (Object.hasOwn(claims, "followUp")) {
        const applicability = validateApplicabilityClaim(
          claims.followUp,
          `${label}.followUp`,
          ["sameConversationObserved", "priorContextObserved"],
          "followUpNotSupported",
        );
        if (applicability === "APPLICABLE") {
          trueClaim(claims.followUp.sameConversationObserved, `${label}.followUp.sameConversationObserved`);
          trueClaim(claims.followUp.priorContextObserved, `${label}.followUp.priorContextObserved`);
        }
      }
      break;
    case "service": {
      const applicability = validateApplicabilityClaim(
        claims,
        label,
        ["serviceId", "runtimeOwned", "startOrLeaseObserved", "singleInstanceObserved", "readyObserved"],
        "noServiceExpected",
      );
      if (applicability === "APPLICABLE") {
        boundedId(claims.serviceId, `${label}.serviceId`);
        trueClaim(claims.runtimeOwned, `${label}.runtimeOwned`);
        trueClaim(claims.startOrLeaseObserved, `${label}.startOrLeaseObserved`);
        trueClaim(claims.singleInstanceObserved, `${label}.singleInstanceObserved`);
        trueClaim(claims.readyObserved, `${label}.readyObserved`);
      }
      break;
    }
    case "worker": {
      const applicability = validateApplicabilityClaim(
        claims,
        label,
        [
          "workerKind",
          "jobIdSha256",
          "workerInstanceIdSha256",
          "freshProcessObserved",
          "terminalExitObserved",
          "descendantsCleaned",
        ],
        "noWorkerExpected",
      );
      if (applicability === "APPLICABLE") {
        boundedId(claims.workerKind, `${label}.workerKind`);
        uppercaseSha256(claims.jobIdSha256, `${label}.jobIdSha256`);
        uppercaseSha256(claims.workerInstanceIdSha256, `${label}.workerInstanceIdSha256`);
        trueClaim(claims.freshProcessObserved, `${label}.freshProcessObserved`);
        trueClaim(claims.terminalExitObserved, `${label}.terminalExitObserved`);
        trueClaim(claims.descendantsCleaned, `${label}.descendantsCleaned`);
      }
      break;
    }
    case "output": {
      const applicability = validateApplicabilityClaim(
        claims,
        label,
        [
          "outputKind",
          "outputIdSha256",
          "expectedOutputObserved",
          "nonPlaceholderObserved",
          "openBehaviorObserved",
        ],
        "noOutputExpected",
      );
      if (applicability === "APPLICABLE") {
        boundedId(claims.outputKind, `${label}.outputKind`);
        uppercaseSha256(claims.outputIdSha256, `${label}.outputIdSha256`);
        trueClaim(claims.expectedOutputObserved, `${label}.expectedOutputObserved`);
        trueClaim(claims.nonPlaceholderObserved, `${label}.nonPlaceholderObserved`);
        trueClaim(claims.openBehaviorObserved, `${label}.openBehaviorObserved`);
      }
      break;
    }
    case "cancellation": {
      const applicability = validateApplicabilityClaim(
        claims,
        label,
        ["cancellationRequested", "terminalCancellationObserved", "visibleResultObserved", "descendantsCleaned"],
        "cancellationNotSupported",
      );
      if (applicability === "APPLICABLE") {
        trueClaim(claims.cancellationRequested, `${label}.cancellationRequested`);
        trueClaim(claims.terminalCancellationObserved, `${label}.terminalCancellationObserved`);
        trueClaim(claims.visibleResultObserved, `${label}.visibleResultObserved`);
        trueClaim(claims.descendantsCleaned, `${label}.descendantsCleaned`);
      }
      break;
    }
    case "recovery": {
      if (claims?.applicability === "NOT_APPLICABLE") {
        exactKeys(claims, [
          "applicability",
          "inventoryContractObserved",
          "recoveryNotSupported",
          "reasonCode",
          "sourceProvenPreMigrationSemantics",
        ], label);
        trueClaim(claims.inventoryContractObserved, `${label}.inventoryContractObserved`);
        trueClaim(claims.recoveryNotSupported, `${label}.recoveryNotSupported`);
        boundedId(claims.reasonCode, `${label}.reasonCode`);
        trueClaim(
          claims.sourceProvenPreMigrationSemantics,
          `${label}.sourceProvenPreMigrationSemantics`,
        );
        break;
      }
      if (!record(claims) || claims.applicability !== "APPLICABLE") {
        fail(`${label}.applicability must be APPLICABLE or NOT_APPLICABLE.`);
      }
      if (["REFRESH", "DASHBOARD_RESTART", "APP_RESTART"].includes(claims.recoveryKind)) {
        exactKeys(claims, [
          "applicability",
          "recoveryKind",
          "reconnected",
          "noDuplicationObserved",
          "contextPreserved",
        ], label);
        trueClaim(claims.reconnected, `${label}.reconnected`);
        trueClaim(claims.noDuplicationObserved, `${label}.noDuplicationObserved`);
        trueClaim(claims.contextPreserved, `${label}.contextPreserved`);
        break;
      }
      if (claims.recoveryKind === "SOURCE_SELECTION_FAIL_CLOSED") {
        exactKeys(claims, [
          "applicability",
          "recoveryKind",
          "selectedIdentitySha256",
          "unresolvableSelectionInjected",
          "truthfulFailurePresentationObserved",
          "selectionCleared",
          "noFallbackObserved",
          "sourceContextRestored",
          "sameConversationObserved",
          "priorContextObserved",
          "noDuplicationObserved",
        ], label);
        uppercaseSha256(claims.selectedIdentitySha256, `${label}.selectedIdentitySha256`);
        for (const field of [
          "unresolvableSelectionInjected",
          "truthfulFailurePresentationObserved",
          "selectionCleared",
          "noFallbackObserved",
          "sourceContextRestored",
          "sameConversationObserved",
          "priorContextObserved",
          "noDuplicationObserved",
        ]) {
          trueClaim(claims[field], `${label}.${field}`);
        }
        break;
      }
      if (claims.recoveryKind === "STORED_SELECTION_APP_RESTART") {
        exactKeys(claims, [
          "applicability",
          "recoveryKind",
          "selectedIdentitySha256",
          "appRestartObserved",
          "storedSelectionRestored",
          "postRestartRequestUsedSelection",
          "sameConversationObserved",
          "priorContextObserved",
          "noDuplicationObserved",
          "contextPreserved",
        ], label);
        uppercaseSha256(claims.selectedIdentitySha256, `${label}.selectedIdentitySha256`);
        for (const field of [
          "appRestartObserved",
          "storedSelectionRestored",
          "postRestartRequestUsedSelection",
          "sameConversationObserved",
          "priorContextObserved",
          "noDuplicationObserved",
          "contextPreserved",
        ]) {
          trueClaim(claims[field], `${label}.${field}`);
        }
        break;
      }
      fail(`${label}.recoveryKind is unsupported.`);
      break;
    }
    default:
      fail(`unsupported evidenceType ${evidenceType}.`);
  }
}

function validateBlockedClaims(evidenceType, claims, capabilityId) {
  const label = `${evidenceType} BLOCKED claims`;
  switch (evidenceType) {
    case "electron":
      exactKeys(claims, [
        "uiEntryPoint",
        "selectedCapabilityId",
        "normalEntryPointUsed",
        "realRequestSubmitted",
        "selectionObserved",
        "truthfulBlockedPresentationObserved",
      ], label);
      boundedString(claims.uiEntryPoint, `${label}.uiEntryPoint`);
      if (claims.selectedCapabilityId !== capabilityId) fail(`${label}.selectedCapabilityId does not match capabilityId.`);
      trueClaim(claims.normalEntryPointUsed, `${label}.normalEntryPointUsed`);
      trueClaim(claims.realRequestSubmitted, `${label}.realRequestSubmitted`);
      trueClaim(claims.selectionObserved, `${label}.selectionObserved`);
      trueClaim(claims.truthfulBlockedPresentationObserved, `${label}.truthfulBlockedPresentationObserved`);
      break;
    case "service":
      exactKeys(claims, ["requiredRuntimeId", "runtimeBoundaryObserved", "unrelatedServicesUnaffected", "noFallbackObserved"], label);
      boundedId(claims.requiredRuntimeId, `${label}.requiredRuntimeId`);
      trueClaim(claims.runtimeBoundaryObserved, `${label}.runtimeBoundaryObserved`);
      trueClaim(claims.unrelatedServicesUnaffected, `${label}.unrelatedServicesUnaffected`);
      trueClaim(claims.noFallbackObserved, `${label}.noFallbackObserved`);
      break;
    case "worker":
      exactKeys(claims, ["expectedWorkerKind", "dispatchBoundaryObserved", "orphanCount", "noFallbackObserved"], label);
      boundedId(claims.expectedWorkerKind, `${label}.expectedWorkerKind`);
      trueClaim(claims.dispatchBoundaryObserved, `${label}.dispatchBoundaryObserved`);
      zeroClaim(claims.orphanCount, `${label}.orphanCount`);
      trueClaim(claims.noFallbackObserved, `${label}.noFallbackObserved`);
      break;
    case "output":
      exactKeys(claims, ["expectedOutputKind", "placeholderAbsent", "truthfulBlockedResultObserved"], label);
      boundedId(claims.expectedOutputKind, `${label}.expectedOutputKind`);
      trueClaim(claims.placeholderAbsent, `${label}.placeholderAbsent`);
      trueClaim(claims.truthfulBlockedResultObserved, `${label}.truthfulBlockedResultObserved`);
      break;
    case "cancellation":
      exactKeys(claims, ["cancellationContractObserved", "orphanCount", "noFallbackObserved"], label);
      trueClaim(claims.cancellationContractObserved, `${label}.cancellationContractObserved`);
      zeroClaim(claims.orphanCount, `${label}.orphanCount`);
      trueClaim(claims.noFallbackObserved, `${label}.noFallbackObserved`);
      break;
    case "recovery":
      exactKeys(claims, ["recoveryContractObserved", "noDuplicationObserved", "truthfulBlockedStateRetained"], label);
      trueClaim(claims.recoveryContractObserved, `${label}.recoveryContractObserved`);
      trueClaim(claims.noDuplicationObserved, `${label}.noDuplicationObserved`);
      trueClaim(claims.truthfulBlockedStateRetained, `${label}.truthfulBlockedStateRetained`);
      break;
    default:
      fail(`unsupported evidenceType ${evidenceType}.`);
  }
}

function validateFailureClaims(evidenceType, claims, capabilityId) {
  if (evidenceType !== "electron") fail("FAIL observations must use electron evidenceType.");
  const label = "electron FAIL claims";
  exactKeys(claims, [
    "uiEntryPoint",
    "selectedCapabilityId",
    "normalEntryPointUsed",
    "realRequestSubmitted",
    "selectionObserved",
    "failureObserved",
    "truthfulFailurePresentationObserved",
  ], label);
  boundedString(claims.uiEntryPoint, `${label}.uiEntryPoint`);
  if (claims.selectedCapabilityId !== capabilityId) fail(`${label}.selectedCapabilityId does not match capabilityId.`);
  trueClaim(claims.normalEntryPointUsed, `${label}.normalEntryPointUsed`);
  trueClaim(claims.realRequestSubmitted, `${label}.realRequestSubmitted`);
  trueClaim(claims.selectionObserved, `${label}.selectionObserved`);
  trueClaim(claims.failureObserved, `${label}.failureObserved`);
  trueClaim(claims.truthfulFailurePresentationObserved, `${label}.truthfulFailurePresentationObserved`);
}

function validateClaims(evidenceType, result, claims, capabilityId) {
  if (!EVIDENCE_TYPES.includes(evidenceType)) fail(`unsupported evidenceType ${evidenceType}.`);
  if (result === "PASS") validatePassClaims(evidenceType, claims, capabilityId);
  else if (result === "BLOCKED") validateBlockedClaims(evidenceType, claims, capabilityId);
  else validateFailureClaims(evidenceType, claims, capabilityId);
}

function validateTimestamps(value, nowMs, enforceFreshness = true) {
  exactKeys(value, ["startedAt", "finishedAt", "recordedAt"], "timestamps");
  const startedAtMs = canonicalIso(value.startedAt, "timestamps.startedAt");
  const finishedAtMs = canonicalIso(value.finishedAt, "timestamps.finishedAt");
  const recordedAtMs = canonicalIso(value.recordedAt, "timestamps.recordedAt");
  if (finishedAtMs < startedAtMs) fail("workflow timestamps are reversed.");
  if (finishedAtMs - startedAtMs > PARITY_EVIDENCE_OBSERVATION_MAX_DURATION_MS) {
    fail(`workflow duration exceeds ${PARITY_EVIDENCE_OBSERVATION_MAX_DURATION_MS} ms.`);
  }
  if (recordedAtMs < finishedAtMs - PARITY_EVIDENCE_OBSERVATION_FUTURE_TOLERANCE_MS) {
    fail("observation was recorded before the workflow finished.");
  }
  if (recordedAtMs > finishedAtMs + PARITY_EVIDENCE_OBSERVATION_FUTURE_TOLERANCE_MS) {
    fail("observation was not recorded promptly after the workflow finished.");
  }
  if (enforceFreshness) {
    if (
      finishedAtMs > nowMs + PARITY_EVIDENCE_OBSERVATION_FUTURE_TOLERANCE_MS ||
      recordedAtMs > nowMs + PARITY_EVIDENCE_OBSERVATION_FUTURE_TOLERANCE_MS
    ) {
      fail("observation timestamps are in the future.");
    }
    if (
      nowMs - finishedAtMs > PARITY_EVIDENCE_OBSERVATION_MAX_AGE_MS ||
      nowMs - recordedAtMs > PARITY_EVIDENCE_OBSERVATION_MAX_AGE_MS
    ) {
      fail(`observation is stale; maximum age is ${PARITY_EVIDENCE_OBSERVATION_MAX_AGE_MS} ms.`);
    }
  }
  return Object.freeze({ startedAtMs, finishedAtMs, recordedAtMs });
}

function validateProducer(root, value, result) {
  exactKeys(value, ["path", "bytes", "sha256"], "producer");
  const current = producerIdentity(
    root,
    value.path,
    result === "FAIL" ? "recordParityEvidenceFailure" : "recordParityEvidenceObservation",
  );
  if (
    current.recorded.bytes !== value.bytes ||
    current.recorded.sha256 !== uppercaseSha256(value.sha256, "producer.sha256")
  ) {
    fail("producer source identity no longer matches the recorded allowlisted producer.");
  }
  return current;
}

function validateExecutableIdentityShape(value, label = "executable") {
  exactKeys(value, ["fileName", "pathSha256", "bytes", "sha256"], label);
  if (value.fileName !== "Breadboard.exe") fail(`${label}.fileName must be Breadboard.exe.`);
  uppercaseSha256(value.pathSha256, `${label}.pathSha256`);
  uppercaseSha256(value.sha256, `${label}.sha256`);
  if (!Number.isSafeInteger(value.bytes) || value.bytes <= 0) fail(`${label}.bytes is invalid.`);
  return Object.freeze({ ...value });
}

function validateExecutable(value, { executablePath = null, expectedExecutableIdentity = null }) {
  const recorded = validateExecutableIdentityShape(value);
  if ((executablePath === null) === (expectedExecutableIdentity === null)) {
    fail("provide exactly one executablePath or expectedExecutableIdentity.");
  }
  if (expectedExecutableIdentity !== null) {
    const expected = validateExecutableIdentityShape(expectedExecutableIdentity, "expectedExecutableIdentity");
    if (!same(recorded, expected)) fail("packaged executable identity does not match expectedExecutableIdentity.");
    return expected;
  }
  const current = executableIdentity(executablePath);
  const expected = {
    fileName: current.fileName,
    pathSha256: current.pathSha256,
    bytes: current.bytes,
    sha256: current.sha256,
  };
  if (!same(recorded, expected)) fail("packaged executable identity no longer matches the observation.");
  return current;
}

function validatePackageVerification(
  root,
  value,
  {
    executablePath = null,
    expectedExecutableIdentity = null,
    validatedPackageVerification = null,
    nowMs,
    enforceFreshness,
  },
) {
  exactKeys(
    value,
    [
      "receipt",
      "packageRootPathSha256",
      "closureSha256",
      "closureFileCount",
      "closureBytes",
      "verifierSourceClosureSha256",
    ],
    "packageVerification",
  );
  const receipt = validateFileReference(value.receipt, "packageVerification.receipt");
  uppercaseSha256(value.packageRootPathSha256, "packageVerification.packageRootPathSha256");
  uppercaseSha256(value.closureSha256, "packageVerification.closureSha256");
  uppercaseSha256(value.verifierSourceClosureSha256, "packageVerification.verifierSourceClosureSha256");
  if (!Number.isSafeInteger(value.closureFileCount) || value.closureFileCount <= 0) {
    fail("packageVerification.closureFileCount is invalid.");
  }
  if (!Number.isSafeInteger(value.closureBytes) || value.closureBytes <= 0) {
    fail("packageVerification.closureBytes is invalid.");
  }
  let validated = validatedPackageVerification;
  if (validated === null) {
    const receiptPath = path.join(root, ...receipt.path.split("/"));
    validated = validatePackageVerifierReceipt({
      repoRoot: root,
      receiptPath,
      expectedFileIdentity: receipt,
      ...(executablePath === null ? {} : { executablePath }),
      nowMs,
      enforceFreshness,
      verifyClosure: true,
    });
  }
  const expectedBinding = packageVerificationBinding(validated);
  if (!same(value, expectedBinding)) {
    fail("packageVerification does not match the sealed verified package closure.");
  }
  if (
    expectedExecutableIdentity !== null &&
    !same(validateExecutableIdentityShape(expectedExecutableIdentity, "expectedExecutableIdentity"), validated.executableIdentity)
  ) {
    fail("expectedExecutableIdentity does not match the verified package closure.");
  }
  return validated;
}

function validateSupportingArtifacts(root, references, timestamps, observationRelativePath = null) {
  if (!Array.isArray(references) || references.length === 0 || references.length > MAX_SUPPORTING_ARTIFACTS) {
    fail(`supportingArtifacts must contain 1-${MAX_SUPPORTING_ARTIFACTS} references.`);
  }
  const seen = new Set();
  let previousPath = null;
  const validated = [];
  for (let index = 0; index < references.length; index += 1) {
    const reference = validateFileReference(references[index], `supportingArtifacts[${index}]`);
    if (seen.has(reference.path)) fail(`supportingArtifacts duplicates ${reference.path}.`);
    if (previousPath !== null && reference.path.localeCompare(previousPath) <= 0) {
      fail("supportingArtifacts must be uniquely sorted by path.");
    }
    if (observationRelativePath && reference.path === observationRelativePath) {
      fail("an observation cannot reference itself as a supporting artifact.");
    }
    seen.add(reference.path);
    previousPath = reference.path;
    const resolved = resolveExistingRepoFile(root, reference.path, `supportingArtifacts[${index}]`, { evidence: true });
    const current = snapshotFileIdentity(resolved.absolutePath, `supportingArtifacts[${index}]`, {
      maxBytes: MAX_SUPPORTING_ARTIFACT_BYTES,
    });
    if (
      current.bytes !== reference.bytes ||
      current.sha256 !== reference.sha256 ||
      current.capturedAt !== reference.capturedAt
    ) {
      fail(`supportingArtifacts[${index}] identity no longer matches its file.`);
    }
    const capturedAtMs = canonicalIso(reference.capturedAt, `supportingArtifacts[${index}].capturedAt`);
    if (
      capturedAtMs < timestamps.startedAtMs - FILE_TIME_TOLERANCE_MS ||
      capturedAtMs > timestamps.finishedAtMs + FILE_TIME_TOLERANCE_MS
    ) {
      fail(`supportingArtifacts[${index}] was not captured within the workflow bounds.`);
    }
    validated.push(reference);
  }
  return Object.freeze(validated);
}

function contentSha256(value) {
  const unsigned = { ...value };
  delete unsigned.contentSha256;
  return sha256Text(JSON.stringify(stableValue(unsigned)));
}

function validateBinding(expected, observation) {
  const expectedKeys = [
    "runId",
    "capabilityId",
    "evidenceType",
    "result",
    "executionDisposition",
    "runtimeMode",
    "workflowIdentity",
    "operationId",
    "packageVerification",
  ];
  if (expected.result === "BLOCKED") expectedKeys.push("blocker");
  if (expected.result === "FAIL") expectedKeys.push("failureCode", "failureSummary");
  exactKeys(expected, expectedKeys, "expected binding");
  const actual = Object.fromEntries(expectedKeys.map((key) => [key, observation[key]]));
  if (!same(actual, expected)) fail("observation does not match the caller's expected binding.");
}

function validateObservationObject({
  root,
  observation,
  expected,
  executablePath,
  expectedExecutableIdentity,
  validatedPackageVerification,
  nowMs,
  enforceFreshness,
  observationRelativePath,
}) {
  const commonKeys = [
    "schemaVersion",
    "kind",
    "runId",
    "capabilityId",
    "evidenceType",
    "result",
    "executionDisposition",
    "fallbackUsed",
    "runtimeMode",
    "workflowIdentity",
    "operationId",
    "producer",
    "executable",
    "packageVerification",
    "timestamps",
    "claims",
    "supportingArtifacts",
    "contentSha256",
  ];
  const expectedKeys = observation?.result === "BLOCKED"
    ? [...commonKeys, "blocker"]
    : observation?.result === "FAIL"
      ? [...commonKeys, "failureCode", "failureSummary"]
      : commonKeys;
  exactKeys(observation, expectedKeys, "observation");
  if (
    observation.schemaVersion !== PARITY_EVIDENCE_OBSERVATION_SCHEMA_VERSION ||
    observation.kind !== PARITY_EVIDENCE_OBSERVATION_KIND
  ) {
    fail("observation kind or schema version is unsupported.");
  }
  runId(observation.runId, "runId");
  boundedId(observation.capabilityId, "capabilityId");
  if (!EVIDENCE_TYPES.includes(observation.evidenceType)) fail("evidenceType is unsupported.");
  const isBlocked = observation.result === "BLOCKED";
  const isFailure = observation.result === "FAIL";
  if (!isBlocked && !isFailure && observation.result !== "PASS") fail("result must be PASS, BLOCKED, or FAIL.");
  const disposition = isBlocked
    ? "MATCHING_BASELINE_PREREQUISITE_BLOCKED"
    : isFailure
      ? "REAL_WORKFLOW_FAILED"
      : "REAL_WORKFLOW_COMPLETED";
  if (observation.executionDisposition !== disposition) fail("executionDisposition does not match result.");
  if (observation.fallbackUsed !== false) fail("fallbackUsed must be false.");
  if (observation.runtimeMode !== "packaged-electron") fail("runtimeMode must be packaged-electron.");
  const validatedWorkflow = workflowIdentity(observation.workflowIdentity);
  boundedId(observation.operationId, "operationId");
  const validatedBlocker = isBlocked ? blocker(observation.blocker) : null;
  if (isFailure) {
    if (typeof observation.failureCode !== "string" || !BLOCKER_CODE_PATTERN.test(observation.failureCode)) {
      fail("failureCode is not canonical.");
    }
    boundedString(observation.failureSummary, "failureSummary", 500);
  }
  const timestamps = validateTimestamps(observation.timestamps, nowMs, enforceFreshness);
  validateClaims(observation.evidenceType, observation.result, observation.claims, observation.capabilityId);
  validateProducer(root, observation.producer, observation.result);
  validateExecutable(observation.executable, { executablePath, expectedExecutableIdentity });
  const validatedPackage = validatePackageVerification(root, observation.packageVerification, {
    executablePath,
    expectedExecutableIdentity,
    validatedPackageVerification,
    nowMs,
    enforceFreshness,
  });
  if (!same(observation.executable, validatedPackage.executableIdentity)) {
    fail("observation executable does not match the verified package closure.");
  }
  validateSupportingArtifacts(root, observation.supportingArtifacts, timestamps, observationRelativePath);
  uppercaseSha256(observation.contentSha256, "contentSha256");
  if (contentSha256(observation) !== observation.contentSha256) {
    fail("contentSha256 does not match; the observation was altered or incompletely sealed.");
  }
  validateBinding(expected, observation);
  return Object.freeze({
    observation: Object.freeze(structuredClone(observation)),
    workflowIdentity: validatedWorkflow,
    blocker: validatedBlocker,
    packageVerification: validatedPackage,
  });
}

function publishImmutableJson(target, value) {
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.chmodSync(temporary, 0o444);
    fs.linkSync(temporary, target);
  } catch (error) {
    if (error?.code === "EEXIST") fail("observation target already exists; immutable observations cannot be replaced.");
    throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temporary, { force: true });
  }
}

function buildSupportingArtifactReferences(root, paths, startedAtMs, finishedAtMs, observationRelativePath) {
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > MAX_SUPPORTING_ARTIFACTS) {
    fail(`supportingArtifactPaths must contain 1-${MAX_SUPPORTING_ARTIFACTS} paths.`);
  }
  const unique = new Map();
  for (const candidate of paths) {
    const canonical = evidencePath(candidate, "supporting artifact path");
    if (canonical === observationRelativePath) fail("an observation cannot reference itself as a supporting artifact.");
    if (unique.has(canonical)) fail(`supportingArtifactPaths duplicates ${canonical}.`);
    const resolved = resolveExistingRepoFile(root, canonical, "supporting artifact", { evidence: true });
    const identity = snapshotFileIdentity(resolved.absolutePath, "supporting artifact", {
      maxBytes: MAX_SUPPORTING_ARTIFACT_BYTES,
    });
    const capturedAtMs = canonicalIso(identity.capturedAt, "supporting artifact capturedAt");
    if (
      capturedAtMs < startedAtMs - FILE_TIME_TOLERANCE_MS ||
      capturedAtMs > finishedAtMs + FILE_TIME_TOLERANCE_MS
    ) {
      fail(`${canonical} was not captured within the workflow bounds.`);
    }
    unique.set(canonical, Object.freeze({ path: canonical, ...identity }));
  }
  return Object.freeze(
    [...unique.values()].sort((left, right) => left.path.localeCompare(right.path)),
  );
}

function observationReference(relativePath, absolutePath) {
  const identity = snapshotFileIdentity(absolutePath, "published observation", { maxBytes: MAX_OBSERVATION_BYTES });
  return Object.freeze({ path: relativePath, ...identity });
}

function packageRunContextState(context, { root, runId: expectedRunId, nowMs, timestamps = null }) {
  if (!record(context)) fail("packageRunContext is not an open Runtime V2 package-run guard.");
  const state = packageRunContexts.get(context);
  if (!state || state.closed) fail("packageRunContext is forged, closed, or belongs to another process.");
  if (state.root !== root || state.runId !== expectedRunId) {
    fail("packageRunContext does not match repoRoot and runId.");
  }
  if (nowMs - state.openedAtMs > PARITY_EVIDENCE_OBSERVATION_MAX_DURATION_MS) {
    fail("packageRunContext exceeded the maximum parity workflow duration.");
  }
  if (
    timestamps !== null &&
    timestamps.startedAtMs < state.openedAtMs
  ) {
    fail("workflow started before the packageRunContext established the verified package authority.");
  }
  // This is deliberately a bounded receipt-file check, not a recursive package
  // walk. Batch publication/import perform fresh full-closure validation.
  const receipt = state.binding.receipt;
  const resolved = resolveExistingRepoFile(root, receipt.path, "packageRunContext receipt", { evidence: true });
  const current = snapshotFileIdentity(resolved.absolutePath, "packageRunContext receipt", {
    maxBytes: MAX_PACKAGE_RECEIPT_BYTES,
  });
  if (
    current.bytes !== receipt.bytes ||
    current.sha256 !== receipt.sha256 ||
    current.capturedAt !== receipt.capturedAt
  ) {
    fail("packageRunContext receipt identity no longer matches its sealed file.");
  }
  return state;
}

export function openParityEvidencePackageRun(options) {
  exactKeys(
    options,
    ["repoRoot", "packageVerifierReceiptPath", "executablePath", "runId"],
    "package run options",
  );
  const root = canonicalRepoRoot(options.repoRoot);
  const validatedRunId = runId(options.runId, "runId");
  const receiptRelativePath = evidencePath(
    options.packageVerifierReceiptPath,
    "packageVerifierReceiptPath",
  );
  const validationNowMs = Date.now();
  const validatedPackage = validatePackageVerifierReceipt({
    repoRoot: root,
    receiptPath: path.join(root, ...receiptRelativePath.split("/")),
    executablePath: options.executablePath,
    nowMs: validationNowMs,
    enforceFreshness: true,
    verifyClosure: true,
  });
  const binding = packageVerificationBinding(validatedPackage);
  const context = Object.freeze({
    kind: PACKAGE_RUN_CONTEXT_KIND,
    runId: validatedRunId,
    packageVerification: binding,
  });
  packageRunContexts.set(context, {
    root,
    runId: validatedRunId,
    openedAtMs: Date.now(),
    binding,
    validatedPackage,
    closed: false,
  });
  return context;
}

export function closeParityEvidencePackageRun(context) {
  if (!record(context)) fail("packageRunContext is not an open Runtime V2 package-run guard.");
  const state = packageRunContexts.get(context);
  if (!state || state.closed) fail("packageRunContext is forged, closed, or belongs to another process.");
  state.closed = true;
  packageRunContexts.delete(context);
}

export function recordParityEvidenceObservation(options) {
  const required = [
    "repoRoot",
    "observationPath",
    "producerPath",
    "packageRunContext",
    "runId",
    "capabilityId",
    "evidenceType",
    "workflowIdentity",
    "operationId",
    "startedAt",
    "finishedAt",
    "claims",
    "supportingArtifactPaths",
  ];
  exactKeysWithOptional(options, required, ["blocker"], "record options");
  const root = canonicalRepoRoot(options.repoRoot);
  const producer = producerIdentity(root, options.producerPath);
  assertProducerIsCaller(producer.absolutePath);
  const target = resolveObservationTarget(root, options.observationPath);
  const nowMs = Date.now();
  const timestampValue = Object.freeze({
    startedAt: options.startedAt,
    finishedAt: options.finishedAt,
    recordedAt: new Date(nowMs).toISOString(),
  });
  const timestamps = validateTimestamps(timestampValue, nowMs);
  const validatedRunId = runId(options.runId, "runId");
  const packageState = packageRunContextState(options.packageRunContext, {
    root,
    runId: validatedRunId,
    nowMs,
    timestamps,
  });
  const executable = packageState.validatedPackage.executableIdentity;
  const validatedPackage = packageState.validatedPackage;
  const validatedCapabilityId = boundedId(options.capabilityId, "capabilityId");
  if (!EVIDENCE_TYPES.includes(options.evidenceType)) fail("evidenceType is unsupported.");
  const validatedWorkflow = workflowIdentity(options.workflowIdentity);
  const validatedOperationId = boundedId(options.operationId, "operationId");
  const validatedBlocker = Object.hasOwn(options, "blocker") ? blocker(options.blocker) : null;
  const result = validatedBlocker ? "BLOCKED" : "PASS";
  const executionDisposition = validatedBlocker
    ? "MATCHING_BASELINE_PREREQUISITE_BLOCKED"
    : "REAL_WORKFLOW_COMPLETED";
  validateClaims(options.evidenceType, result, options.claims, validatedCapabilityId);
  const supportingArtifacts = buildSupportingArtifactReferences(
    root,
    options.supportingArtifactPaths,
    timestamps.startedAtMs,
    timestamps.finishedAtMs,
    target.relativePath,
  );
  const observation = {
    schemaVersion: PARITY_EVIDENCE_OBSERVATION_SCHEMA_VERSION,
    kind: PARITY_EVIDENCE_OBSERVATION_KIND,
    runId: validatedRunId,
    capabilityId: validatedCapabilityId,
    evidenceType: options.evidenceType,
    result,
    executionDisposition,
    fallbackUsed: false,
    runtimeMode: "packaged-electron",
    workflowIdentity: validatedWorkflow,
    operationId: validatedOperationId,
    producer: producer.recorded,
    executable: Object.freeze({
      fileName: executable.fileName,
      pathSha256: executable.pathSha256,
      bytes: executable.bytes,
      sha256: executable.sha256,
    }),
    packageVerification: packageVerificationBinding(validatedPackage),
    timestamps: timestampValue,
    claims: structuredClone(options.claims),
    supportingArtifacts,
  };
  if (validatedBlocker) observation.blocker = validatedBlocker;
  observation.contentSha256 = contentSha256(observation);

  // Recheck every mutable input immediately before the exclusive publication.
  validateProducer(root, observation.producer, observation.result);
  validateExecutable(observation.executable, {
    expectedExecutableIdentity: packageState.validatedPackage.executableIdentity,
  });
  const finalPackageState = packageRunContextState(options.packageRunContext, {
    root,
    runId: validatedRunId,
    nowMs: Date.now(),
    timestamps,
  });
  validatePackageVerification(root, observation.packageVerification, {
    expectedExecutableIdentity: observation.executable,
    validatedPackageVerification: finalPackageState.validatedPackage,
    nowMs,
    enforceFreshness: true,
  });
  validateSupportingArtifacts(root, observation.supportingArtifacts, timestamps, target.relativePath);
  publishImmutableJson(target.absolutePath, observation);
  const reference = observationReference(target.relativePath, target.absolutePath);
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
  if (validatedBlocker) expected.blocker = validatedBlocker;
  validateParityEvidenceObservation({
    repoRoot: root,
    observationPath: target.relativePath,
    expectedFileIdentity: reference,
    expected,
    expectedExecutableIdentity: observation.executable,
    validatedPackageVerification: finalPackageState.validatedPackage,
    nowMs,
  });
  return Object.freeze({
    observation: Object.freeze(structuredClone(observation)),
    reference,
  });
}

export function recordParityEvidenceFailure(options) {
  const required = [
    "repoRoot",
    "observationPath",
    "producerPath",
    "packageRunContext",
    "runId",
    "capabilityId",
    "workflowIdentity",
    "operationId",
    "startedAt",
    "finishedAt",
    "failureCode",
    "failureSummary",
    "claims",
    "supportingArtifactPaths",
  ];
  exactKeys(options, required, "failure record options");
  const root = canonicalRepoRoot(options.repoRoot);
  const producer = producerIdentity(root, options.producerPath, "recordParityEvidenceFailure");
  assertProducerIsCaller(producer.absolutePath);
  const target = resolveObservationTarget(root, options.observationPath);
  const nowMs = Date.now();
  const timestampValue = Object.freeze({
    startedAt: options.startedAt,
    finishedAt: options.finishedAt,
    recordedAt: new Date(nowMs).toISOString(),
  });
  const timestamps = validateTimestamps(timestampValue, nowMs);
  const validatedRunId = runId(options.runId, "runId");
  const packageState = packageRunContextState(options.packageRunContext, {
    root,
    runId: validatedRunId,
    nowMs,
    timestamps,
  });
  const executable = packageState.validatedPackage.executableIdentity;
  const validatedPackage = packageState.validatedPackage;
  const validatedCapabilityId = boundedId(options.capabilityId, "capabilityId");
  const validatedWorkflow = workflowIdentity(options.workflowIdentity);
  const validatedOperationId = boundedId(options.operationId, "operationId");
  if (typeof options.failureCode !== "string" || !BLOCKER_CODE_PATTERN.test(options.failureCode)) {
    fail("failureCode is not canonical.");
  }
  const validatedFailureSummary = boundedString(options.failureSummary, "failureSummary", 500);
  validateFailureClaims("electron", options.claims, validatedCapabilityId);
  const supportingArtifacts = buildSupportingArtifactReferences(
    root,
    options.supportingArtifactPaths,
    timestamps.startedAtMs,
    timestamps.finishedAtMs,
    target.relativePath,
  );
  const observation = {
    schemaVersion: PARITY_EVIDENCE_OBSERVATION_SCHEMA_VERSION,
    kind: PARITY_EVIDENCE_OBSERVATION_KIND,
    runId: validatedRunId,
    capabilityId: validatedCapabilityId,
    evidenceType: "electron",
    result: "FAIL",
    executionDisposition: "REAL_WORKFLOW_FAILED",
    fallbackUsed: false,
    runtimeMode: "packaged-electron",
    workflowIdentity: validatedWorkflow,
    operationId: validatedOperationId,
    producer: producer.recorded,
    executable: Object.freeze({
      fileName: executable.fileName,
      pathSha256: executable.pathSha256,
      bytes: executable.bytes,
      sha256: executable.sha256,
    }),
    packageVerification: packageVerificationBinding(validatedPackage),
    timestamps: timestampValue,
    failureCode: options.failureCode,
    failureSummary: validatedFailureSummary,
    claims: structuredClone(options.claims),
    supportingArtifacts,
  };
  observation.contentSha256 = contentSha256(observation);

  validateProducer(root, observation.producer, observation.result);
  validateExecutable(observation.executable, {
    expectedExecutableIdentity: packageState.validatedPackage.executableIdentity,
  });
  const finalPackageState = packageRunContextState(options.packageRunContext, {
    root,
    runId: validatedRunId,
    nowMs: Date.now(),
    timestamps,
  });
  validatePackageVerification(root, observation.packageVerification, {
    expectedExecutableIdentity: observation.executable,
    validatedPackageVerification: finalPackageState.validatedPackage,
    nowMs,
    enforceFreshness: true,
  });
  validateSupportingArtifacts(root, observation.supportingArtifacts, timestamps, target.relativePath);
  publishImmutableJson(target.absolutePath, observation);
  const reference = observationReference(target.relativePath, target.absolutePath);
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
    failureCode: observation.failureCode,
    failureSummary: observation.failureSummary,
  };
  validateParityEvidenceObservation({
    repoRoot: root,
    observationPath: target.relativePath,
    expectedFileIdentity: reference,
    expected,
    expectedExecutableIdentity: observation.executable,
    validatedPackageVerification: finalPackageState.validatedPackage,
    nowMs,
  });
  return Object.freeze({
    observation: Object.freeze(structuredClone(observation)),
    reference,
  });
}

export function validateParityEvidenceObservation(options) {
  const required = ["repoRoot", "expected"];
  exactKeysWithOptional(
    options,
    required,
    [
      "observation",
      "observationPath",
      "expectedFileIdentity",
      "executablePath",
      "expectedExecutableIdentity",
      "validatedPackageVerification",
      "enforceFreshness",
      "nowMs",
    ],
    "validation options",
  );
  const hasObject = Object.hasOwn(options, "observation");
  const hasPath = Object.hasOwn(options, "observationPath");
  if (hasObject === hasPath) fail("provide exactly one of observation or observationPath.");
  if (Object.hasOwn(options, "expectedFileIdentity") && !hasPath) {
    fail("expectedFileIdentity requires observationPath.");
  }
  const hasExecutablePath = Object.hasOwn(options, "executablePath");
  const hasExecutableIdentity = Object.hasOwn(options, "expectedExecutableIdentity");
  if (hasExecutablePath === hasExecutableIdentity) {
    fail("provide exactly one executablePath or expectedExecutableIdentity.");
  }
  const nowMs = Object.hasOwn(options, "nowMs") ? options.nowMs : Date.now();
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) fail("nowMs is invalid.");
  const enforceFreshness = Object.hasOwn(options, "enforceFreshness") ? options.enforceFreshness : true;
  if (typeof enforceFreshness !== "boolean") fail("enforceFreshness must be a boolean.");
  const root = canonicalRepoRoot(options.repoRoot);
  let observation = options.observation;
  let reference = null;
  let relativePath = null;
  if (hasPath) {
    relativePath = evidencePath(options.observationPath, "observationPath");
    const resolved = resolveExistingRepoFile(root, relativePath, "observationPath", { evidence: true });
    const snapshot = readBoundedJsonSnapshot(resolved.absolutePath, "parity observation");
    observation = snapshot.value;
    reference = Object.freeze({ path: relativePath, ...snapshot.identity });
    if (Object.hasOwn(options, "expectedFileIdentity")) {
      const expectedIdentity = validateFileReference(options.expectedFileIdentity, "expectedFileIdentity");
      if (!same(reference, expectedIdentity)) fail("observation file identity does not match expectedFileIdentity.");
    }
  }
  if (!record(observation)) fail("observation must be an object.");
  const validated = validateObservationObject({
    root,
    observation,
    expected: options.expected,
    executablePath: hasExecutablePath ? options.executablePath : null,
    expectedExecutableIdentity: hasExecutableIdentity ? options.expectedExecutableIdentity : null,
    validatedPackageVerification: Object.hasOwn(options, "validatedPackageVerification")
      ? options.validatedPackageVerification
      : null,
    nowMs,
    enforceFreshness,
    observationRelativePath: relativePath,
  });
  return Object.freeze({ ...validated, reference });
}
