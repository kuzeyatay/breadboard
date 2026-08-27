import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { validateParityEvidenceObservation } from "./parity-evidence-observation.mjs";
import {
  packageVerificationBinding,
  validatePackageVerifierReceipt,
} from "./package-verifier-receipt.mjs";

export const PARITY_EVIDENCE_SCHEMA_VERSION = 1;
export const PARITY_EVIDENCE_KIND = "breadboard-runtime-v2-parity-evidence";
export const PARITY_EVIDENCE_MAX_AGE_MS = 24 * 60 * 60_000;
export const PARITY_EVIDENCE_FUTURE_TOLERANCE_MS = 5 * 60_000;
export const PARITY_EVIDENCE_MAX_RUN_DURATION_MS = 12 * 60 * 60_000;

const SHA256_PATTERN = /^[0-9A-F]{64}$/u;
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const BOUNDED_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const BLOCKER_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,127}$/u;
const PROHIBITED_PASS_EVIDENCE_PATTERN = /\b(?:mock|canned|lower-capability)\b/iu;
const EVIDENCE_TYPES = Object.freeze([
  "electron",
  "service",
  "worker",
  "output",
  "cancellation",
  "recovery",
]);
const ALL_REFERENCE_TYPES = Object.freeze(["receipt", ...EVIDENCE_TYPES]);
const EVIDENCE_MTIME_TOLERANCE_MS = 5 * 60_000;
const MAX_EVIDENCE_FILE_BYTES = 1024 * 1024 * 1024;
const POST_EVIDENCE_FIELDS = Object.freeze([
  "selectionEvidence",
  "serviceWorkerEvidence",
  "outputArtifactEvidence",
  "cancellationEvidence",
  "recoveryEvidence",
]);
const BLOCKER_REQUIREMENT_FIELDS = Object.freeze({
  CREDENTIAL: "credentialRequirements",
  MODEL_FILE: "externalSoftwareRequirements",
  EXTERNAL_SERVICE: "providerRequirements",
  EXTERNAL_SOFTWARE: "externalSoftwareRequirements",
});

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fail(message) {
  throw new Error(`Runtime V2 parity evidence rejected: ${message}`);
}

function exactKeys(value, expected, label) {
  if (!record(value)) fail(`${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail(`${label} fields must be exactly ${wanted.join(", ")}.`);
  }
}

function canonicalIso(value, label) {
  if (typeof value !== "string") fail(`${label} must be an ISO timestamp.`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    fail(`${label} must be a canonical ISO timestamp.`);
  }
  return parsed;
}

function validateExecutableIdentity(value) {
  exactKeys(value, ["fileName", "pathSha256", "bytes", "sha256"], "receipt executable");
  if (
    value.fileName !== "Breadboard.exe" ||
    typeof value.pathSha256 !== "string" ||
    !SHA256_PATTERN.test(value.pathSha256) ||
    !Number.isSafeInteger(value.bytes) ||
    value.bytes <= 0 ||
    typeof value.sha256 !== "string" ||
    !SHA256_PATTERN.test(value.sha256)
  ) {
    fail("receipt executable identity is invalid.");
  }
  return Object.freeze({ ...value });
}

function validateWorkflowIdentity(value, electronRunId) {
  exactKeys(value, ["electronRunId", "workflowId", "conversationIdSha256"], "workflow identity");
  if (
    value.electronRunId !== electronRunId ||
    typeof value.workflowId !== "string" ||
    !BOUNDED_ID_PATTERN.test(value.workflowId) ||
    typeof value.conversationIdSha256 !== "string" ||
    !SHA256_PATTERN.test(value.conversationIdSha256)
  ) {
    fail("workflow identity is invalid or is not bound to the receipt Electron run.");
  }
  return Object.freeze({ ...value });
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

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex").toUpperCase();
}

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

function postMigrationProjection(inventory) {
  const clone = structuredClone(inventory);
  for (const row of clone.capabilities ?? []) {
    delete row.postMigrationStatus;
    delete row.postMigrationEvidence;
    delete row.result;
    for (const field of POST_EVIDENCE_FIELDS) {
      if (record(row[field])) delete row[field].postMigration;
    }
  }
  return clone;
}

export function computeInventoryContractSha256(inventory) {
  if (!record(inventory) || inventory.schemaVersion !== 2 || !Array.isArray(inventory.capabilities)) {
    fail("feature-parity.json is not schema version 2.");
  }
  return sha256Text(JSON.stringify(stableValue(postMigrationProjection(inventory))));
}

export function computeParityEvidenceReceiptContentSha256(receipt) {
  if (!record(receipt)) fail("receipt must be an object.");
  const unsigned = { ...receipt };
  delete unsigned.contentSha256;
  return sha256Text(JSON.stringify(stableValue(unsigned)));
}

export function sealParityEvidenceReceipt(receipt) {
  const sealed = structuredClone(receipt);
  sealed.contentSha256 = computeParityEvidenceReceiptContentSha256(sealed);
  return sealed;
}

function safeRelativePath(relativePath, label) {
  if (
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    relativePath.length > 1024 ||
    relativePath.includes("\\") ||
    relativePath.includes("#") ||
    relativePath.includes("\0") ||
    path.posix.isAbsolute(relativePath)
  ) {
    fail(`${label} has an invalid repository-relative path.`);
  }
  const segments = relativePath.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    fail(`${label} has a non-canonical repository-relative path.`);
  }
  return relativePath;
}

function withinRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function evidencePathAllowed(relativePath) {
  return (
    relativePath.startsWith(".qa-results/") ||
    relativePath.startsWith("qa/runtime-v2/evidence/")
  );
}

function resolveRepositoryFile(repoRoot, relativePath, label, { evidence = false } = {}) {
  const safePath = safeRelativePath(relativePath, label);
  if (evidence && !evidencePathAllowed(safePath)) {
    fail(`${label} must live under .qa-results/ or qa/runtime-v2/evidence/.`);
  }
  const root = fs.realpathSync(path.resolve(repoRoot));
  const candidate = path.resolve(root, ...safePath.split("/"));
  if (!withinRoot(root, candidate)) fail(`${label} escaped the repository root.`);
  const stat = fs.statSync(candidate, { throwIfNoEntry: false });
  if (!stat?.isFile()) fail(`${label} does not identify an existing regular file: ${safePath}`);
  const realCandidate = fs.realpathSync(candidate);
  if (!withinRoot(root, realCandidate)) fail(`${label} resolves outside the repository root.`);
  return { absolutePath: realCandidate, relativePath: safePath, stat };
}

function relativeToRepo(repoRoot, absolutePath) {
  return path.relative(path.resolve(repoRoot), absolutePath).split(path.sep).join("/");
}

export function computeSourceSha256(repoRoot, sourceRefs) {
  if (!Array.isArray(sourceRefs) || sourceRefs.length === 0) {
    fail("sourceRefs must be a non-empty array.");
  }
  const files = new Map();
  for (const reference of sourceRefs) {
    if (typeof reference !== "string") fail("sourceRefs entries must be strings.");
    const relativePath = reference.replace(/:\d+$/u, "");
    const resolved = resolveRepositoryFile(repoRoot, relativePath, "source reference");
    files.set(resolved.relativePath, resolved.absolutePath);
  }
  const hash = createHash("sha256");
  const sortedFiles = [...files].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  for (const [relativePath, absolutePath] of sortedFiles) {
    hash.update(relativePath);
    hash.update("\0");
    hash.update(fs.readFileSync(absolutePath));
    hash.update("\0");
  }
  return hash.digest("hex").toUpperCase();
}

function validateSourceIdentity(repoRoot, row) {
  if (!Array.isArray(row.sourceRefs) || row.sourceRefs.length === 0) {
    fail(`${row.capabilityId} has no source references.`);
  }
  if (typeof row.sourceSha256 !== "string" || !SHA256_PATTERN.test(row.sourceSha256.toUpperCase())) {
    fail(`${row.capabilityId} has no valid source SHA-256.`);
  }
  const actual = computeSourceSha256(repoRoot, row.sourceRefs);
  if (actual !== row.sourceSha256.toUpperCase()) {
    fail(`${row.capabilityId} source files no longer match sourceSha256.`);
  }
}

function validateEvidenceReference({ repoRoot, reference, label, startedAtMs, finishedAtMs, receiptPath }) {
  exactKeys(reference, ["path", "bytes", "sha256", "capturedAt"], label);
  if (!Number.isSafeInteger(reference.bytes) || reference.bytes <= 0 || reference.bytes > MAX_EVIDENCE_FILE_BYTES) {
    fail(`${label} has invalid bytes.`);
  }
  if (typeof reference.sha256 !== "string" || !SHA256_PATTERN.test(reference.sha256)) {
    fail(`${label} has an invalid uppercase SHA-256.`);
  }
  const capturedAtMs = canonicalIso(reference.capturedAt, `${label}.capturedAt`);
  if (
    capturedAtMs < startedAtMs - PARITY_EVIDENCE_FUTURE_TOLERANCE_MS ||
    capturedAtMs > finishedAtMs + PARITY_EVIDENCE_FUTURE_TOLERANCE_MS
  ) {
    fail(`${label} was not captured within the receipt run bounds.`);
  }
  const resolved = resolveRepositoryFile(repoRoot, reference.path, label, { evidence: true });
  if (receiptPath && path.resolve(resolved.absolutePath) === path.resolve(receiptPath)) {
    fail(`${label} cannot circularly reference the parity receipt itself.`);
  }
  if (resolved.stat.size !== reference.bytes) fail(`${label} byte size no longer matches.`);
  if (Math.abs(resolved.stat.mtimeMs - capturedAtMs) > EVIDENCE_MTIME_TOLERANCE_MS) {
    fail(`${label} file time does not match its capturedAt value.`);
  }
  if (sha256File(resolved.absolutePath) !== reference.sha256) {
    fail(`${label} SHA-256 no longer matches.`);
  }
  return Object.freeze({ ...reference, path: resolved.relativePath });
}

function receiptReferenceFromSnapshot(repoRoot, receiptPath, snapshot) {
  const root = path.resolve(repoRoot);
  const absolute = path.resolve(receiptPath);
  if (!withinRoot(root, absolute)) fail("receipt path escaped the repository root.");
  const relative = relativeToRepo(root, absolute);
  const resolved = resolveRepositoryFile(root, relative, "parity receipt", { evidence: true });
  if (snapshot.bytes <= 0 || snapshot.bytes > 16 * 1024 * 1024) {
    fail("parity receipt has an invalid size.");
  }
  return Object.freeze({
    path: resolved.relativePath,
    bytes: snapshot.bytes,
    sha256: snapshot.sha256,
    capturedAt: snapshot.capturedAt,
  });
}

function validateReceiptIdentity(repoRoot, receiptPath) {
  const snapshot = readBoundedJsonSnapshot(receiptPath, "parity receipt", 16 * 1024 * 1024);
  return receiptReferenceFromSnapshot(repoRoot, receiptPath, snapshot);
}

function validateInventoryBinding(receipt, inventory) {
  exactKeys(receipt.inventory, ["path", "schemaVersion", "capabilityCount", "contractSha256"], "inventory binding");
  if (receipt.inventory.path !== "qa/runtime-v2/feature-parity.json") {
    fail("inventory binding path is not qa/runtime-v2/feature-parity.json.");
  }
  if (receipt.inventory.schemaVersion !== inventory.schemaVersion || receipt.inventory.schemaVersion !== 2) {
    fail("inventory binding schema version does not match feature-parity.json.");
  }
  if (
    receipt.inventory.capabilityCount !== inventory.capabilities.length ||
    receipt.inventory.capabilityCount !== inventory.capabilityCount
  ) {
    fail("inventory binding capability count does not match feature-parity.json.");
  }
  const current = computeInventoryContractSha256(inventory);
  if (receipt.inventory.contractSha256 !== current) {
    fail("inventory binding does not match the current frozen capability contracts.");
  }
  return current;
}

function validateReceiptRow({
  row,
  baselineRow,
  repoRoot,
  receiptRunId,
  receiptElectronRunId,
  receiptExecutable,
  startedAtMs,
  finishedAtMs,
  receiptPath,
  nowMs,
  enforceFreshness,
  observationPathsSeen,
  validatedPackageVerification,
}) {
  if (!record(row) || typeof row.result !== "string") fail("receipt contains an invalid row.");
  const expectedKeys = row.result === "BLOCKED"
    ? ["capabilityId", "result", "executionDisposition", "fallbackUsed", "workflowIdentity", "blocker", "evidence"]
    : row.result === "FAIL"
      ? ["capabilityId", "result", "executionDisposition", "fallbackUsed", "workflowIdentity", "failure", "evidence"]
      : ["capabilityId", "result", "executionDisposition", "fallbackUsed", "workflowIdentity", "evidence"];
  exactKeys(row, expectedKeys, `${row.capabilityId ?? "unknown"} receipt row`);
  if (typeof row.capabilityId !== "string" || row.capabilityId.length === 0) {
    fail("receipt row has no explicit capabilityId.");
  }
  if (!baselineRow) fail(`receipt references unknown capability ${row.capabilityId}.`);
  if (row.fallbackUsed !== false) fail(`${row.capabilityId} used or ambiguously declared a fallback.`);
  const validatedWorkflowIdentity = validateWorkflowIdentity(row.workflowIdentity, receiptElectronRunId);
  if (row.result === "PASS") {
    if (row.executionDisposition !== "REAL_WORKFLOW_COMPLETED") {
      fail(`${row.capabilityId} PASS requires REAL_WORKFLOW_COMPLETED.`);
    }
  } else if (row.result === "BLOCKED") {
    if (baselineRow.preMigrationStatus !== "BLOCKED") {
      fail(`${row.capabilityId} is newly BLOCKED without a matching pre-migration blocker.`);
    }
    if (row.executionDisposition !== "MATCHING_BASELINE_PREREQUISITE_BLOCKED") {
      fail(`${row.capabilityId} BLOCKED disposition does not match the baseline-prerequisite rule.`);
    }
    exactKeys(
      row.blocker,
      ["code", "summary", "prerequisiteType", "prerequisiteId"],
      `${row.capabilityId} blocker`,
    );
    if (typeof row.blocker.code !== "string" || !BLOCKER_CODE_PATTERN.test(row.blocker.code)) {
      fail(`${row.capabilityId} blocker has an invalid code.`);
    }
    if (
      typeof row.blocker.summary !== "string" ||
      row.blocker.summary.trim().length === 0 ||
      row.blocker.summary.length > 500
    ) {
      fail(`${row.capabilityId} blocker has an invalid summary.`);
    }
    const requirementField = BLOCKER_REQUIREMENT_FIELDS[row.blocker.prerequisiteType];
    if (!requirementField || typeof row.blocker.prerequisiteId !== "string") {
      fail(`${row.capabilityId} blocker has an invalid prerequisite identity.`);
    }
    const baselineRequirements = baselineRow[requirementField];
    if (!Array.isArray(baselineRequirements) || !baselineRequirements.includes(row.blocker.prerequisiteId)) {
      fail(`${row.capabilityId} blocker does not match a frozen pre-migration prerequisite.`);
    }
  } else if (row.result === "FAIL") {
    if (row.executionDisposition !== "REAL_WORKFLOW_FAILED") {
      fail(`${row.capabilityId} FAIL requires REAL_WORKFLOW_FAILED.`);
    }
    exactKeys(row.failure, ["code", "summary"], `${row.capabilityId} failure`);
    if (typeof row.failure.code !== "string" || !BLOCKER_CODE_PATTERN.test(row.failure.code)) {
      fail(`${row.capabilityId} failure has an invalid code.`);
    }
    if (
      typeof row.failure.summary !== "string" ||
      row.failure.summary.trim().length === 0 ||
      row.failure.summary.length > 500
    ) {
      fail(`${row.capabilityId} failure has an invalid summary.`);
    }
  } else {
    fail(`${row.capabilityId} result must be PASS, BLOCKED, or FAIL.`);
  }

  exactKeys(row.evidence, EVIDENCE_TYPES, `${row.capabilityId} evidence`);
  const evidence = {};
  const observations = {};
  const operationIds = new Set();
  for (const type of EVIDENCE_TYPES) {
    const references = row.evidence[type];
    const failureTypeRequired = row.result === "FAIL" && type === "electron";
    if (!Array.isArray(references) || (row.result !== "FAIL" && references.length === 0) || (failureTypeRequired && references.length === 0)) {
      fail(`${row.capabilityId} requires actual ${type} evidence.`);
    }
    if (row.result === "FAIL" && type !== "electron" && references.length !== 0) {
      fail(`${row.capabilityId} FAIL may contain only the runner-emitted electron failure observation.`);
    }
    const seen = new Set();
    observations[type] = [];
    evidence[type] = references.map((reference, index) => {
      const validated = validateEvidenceReference({
        repoRoot,
        reference,
        label: `${row.capabilityId}.${type}[${index}]`,
        startedAtMs,
        finishedAtMs,
        receiptPath,
      });
      if (seen.has(validated.path)) fail(`${row.capabilityId} has duplicate ${type} evidence ${validated.path}.`);
      if (observationPathsSeen.has(validated.path)) {
        fail(`observation ${validated.path} is reused across evidence types or capability rows.`);
      }
      seen.add(validated.path);
      observationPathsSeen.add(validated.path);
      const observationPath = path.join(path.resolve(repoRoot), ...validated.path.split("/"));
      const observation = readBoundedJson(observationPath, `${row.capabilityId}.${type} observation`);
      const expected = {
        runId: receiptRunId,
        capabilityId: row.capabilityId,
        evidenceType: type,
        result: row.result,
        executionDisposition: row.executionDisposition,
        runtimeMode: "packaged-electron",
        workflowIdentity: validatedWorkflowIdentity,
        operationId: observation?.operationId,
        packageVerification: packageVerificationBinding(validatedPackageVerification),
      };
      if (row.result === "BLOCKED") expected.blocker = row.blocker;
      if (row.result === "FAIL") {
        expected.failureCode = row.failure.code;
        expected.failureSummary = row.failure.summary;
      }
      const checked = validateParityEvidenceObservation({
        repoRoot,
        observationPath: validated.path,
        expectedFileIdentity: validated,
        expected,
        expectedExecutableIdentity: receiptExecutable,
        validatedPackageVerification,
        nowMs,
        enforceFreshness,
      });
      if (operationIds.has(checked.observation.operationId)) {
        fail(`${row.capabilityId} duplicates observation operationId ${checked.observation.operationId}.`);
      }
      operationIds.add(checked.observation.operationId);
      observations[type].push(checked.observation);
      return validated;
    });
    const paths = evidence[type].map((reference) => reference.path);
    const sorted = [...paths].sort((left, right) => left.localeCompare(right));
    if (JSON.stringify(paths) !== JSON.stringify(sorted)) {
      fail(`${row.capabilityId} ${type} evidence must be sorted by path.`);
    }
  }
  validateSourceIdentity(repoRoot, baselineRow);
  return Object.freeze({
    row: Object.freeze({ ...row, evidence: Object.freeze(evidence) }),
    observations: Object.freeze(observations),
    baselineRow,
  });
}

export function validateParityEvidenceReceipt({
  receipt,
  receiptPath,
  receiptReference = null,
  repoRoot,
  inventory,
  nowMs = Date.now(),
  enforceFreshness = true,
  validatedPackageVerification = null,
}) {
  exactKeys(
    receipt,
    ["schemaVersion", "kind", "runId", "electronRunId", "startedAt", "finishedAt", "inventory", "executable", "packageVerification", "rows", "contentSha256"],
    "receipt",
  );
  if (receipt.schemaVersion !== PARITY_EVIDENCE_SCHEMA_VERSION || receipt.kind !== PARITY_EVIDENCE_KIND) {
    fail("receipt kind or schema version is unsupported.");
  }
  if (typeof receipt.runId !== "string" || !RUN_ID_PATTERN.test(receipt.runId)) {
    fail("receipt has an invalid runId.");
  }
  if (typeof receipt.electronRunId !== "string" || !RUN_ID_PATTERN.test(receipt.electronRunId)) {
    fail("receipt has an invalid electronRunId.");
  }
  const startedAtMs = canonicalIso(receipt.startedAt, "receipt.startedAt");
  const finishedAtMs = canonicalIso(receipt.finishedAt, "receipt.finishedAt");
  if (finishedAtMs < startedAtMs) fail("receipt time bounds are reversed.");
  if (finishedAtMs - startedAtMs > PARITY_EVIDENCE_MAX_RUN_DURATION_MS) {
    fail(`receipt duration exceeds ${PARITY_EVIDENCE_MAX_RUN_DURATION_MS} ms.`);
  }
  if (finishedAtMs > nowMs + PARITY_EVIDENCE_FUTURE_TOLERANCE_MS) {
    fail("receipt is dated in the future.");
  }
  if (enforceFreshness && nowMs - finishedAtMs > PARITY_EVIDENCE_MAX_AGE_MS) {
    fail(`receipt is stale; maximum import age is ${PARITY_EVIDENCE_MAX_AGE_MS} ms.`);
  }
  if (typeof receipt.contentSha256 !== "string" || !SHA256_PATTERN.test(receipt.contentSha256)) {
    fail("receipt has no valid uppercase contentSha256.");
  }
  if (computeParityEvidenceReceiptContentSha256(receipt) !== receipt.contentSha256) {
    fail("receipt contentSha256 does not match; the receipt was altered or incompletely sealed.");
  }
  const receiptExecutable = validateExecutableIdentity(receipt.executable);
  if (!record(receipt.packageVerification) || !record(receipt.packageVerification.receipt)) {
    fail("receipt has no verified package-closure binding.");
  }
  let validatedPackage = validatedPackageVerification;
  if (validatedPackage === null) {
    const packageReceiptPath = path.join(
      path.resolve(repoRoot),
      ...safeRelativePath(receipt.packageVerification.receipt.path, "package verification receipt").split("/"),
    );
    validatedPackage = validatePackageVerifierReceipt({
      repoRoot,
      receiptPath: packageReceiptPath,
      expectedFileIdentity: receipt.packageVerification.receipt,
      nowMs,
      enforceFreshness,
      verifyClosure: true,
    });
  }
  if (!same(receipt.packageVerification, packageVerificationBinding(validatedPackage))) {
    fail("receipt packageVerification does not match the sealed verified package closure.");
  }
  if (!same(receiptExecutable, validatedPackage.executableIdentity)) {
    fail("receipt executable does not match the verified package closure.");
  }
  if (!record(inventory) || !Array.isArray(inventory.capabilities)) {
    fail("feature-parity inventory is malformed.");
  }
  const inventoryContractSha256 = validateInventoryBinding(receipt, inventory);
  if (!Array.isArray(receipt.rows) || receipt.rows.length === 0) fail("receipt has no capability rows.");
  const baselineRows = new Map();
  for (const row of inventory.capabilities) {
    if (!record(row) || typeof row.capabilityId !== "string") fail("feature-parity inventory has an invalid row.");
    if (baselineRows.has(row.capabilityId)) fail(`feature-parity inventory duplicates ${row.capabilityId}.`);
    baselineRows.set(row.capabilityId, row);
  }
  const validatedRows = new Map();
  const observationPathsSeen = new Set();
  let previousCapabilityId = null;
  for (const row of receipt.rows) {
    if (typeof row?.capabilityId === "string" && previousCapabilityId !== null && row.capabilityId.localeCompare(previousCapabilityId) <= 0) {
      fail("receipt capability rows must be unique and sorted by capabilityId.");
    }
    const validated = validateReceiptRow({
      row,
      baselineRow: baselineRows.get(row?.capabilityId),
      repoRoot,
      receiptRunId: receipt.runId,
      receiptElectronRunId: receipt.electronRunId,
      receiptExecutable,
      startedAtMs,
      finishedAtMs,
      receiptPath,
      nowMs,
      enforceFreshness,
      observationPathsSeen,
      validatedPackageVerification: validatedPackage,
    });
    if (validatedRows.has(row.capabilityId)) fail(`receipt duplicates capability ${row.capabilityId}.`);
    validatedRows.set(row.capabilityId, validated);
    previousCapabilityId = row.capabilityId;
  }
  const validatedReceiptReference = receiptReference ?? validateReceiptIdentity(repoRoot, receiptPath);
  for (const validatedRow of validatedRows.values()) {
    if (
      validatedRow.row.result === "PASS" &&
      PROHIBITED_PASS_EVIDENCE_PATTERN.test(
        buildPostMigrationPatch(validatedRow, validatedReceiptReference).postMigrationEvidence.join(" "),
      )
    ) {
      fail(`${validatedRow.row.capabilityId} PASS evidence declares a prohibited mock/canned/lower-capability path.`);
    }
  }
  return Object.freeze({
    inventoryContractSha256,
    receiptReference: validatedReceiptReference,
    rows: validatedRows,
    packageVerification: validatedPackage,
  });
}

export function formatEvidenceReference(type, reference) {
  if (!ALL_REFERENCE_TYPES.includes(type)) fail(`unknown recorded evidence type ${type}.`);
  return `${type}:${reference.path}#sha256=${reference.sha256}#bytes=${reference.bytes}#capturedAt=${reference.capturedAt}`;
}

export function parseEvidenceReference(value) {
  if (typeof value !== "string") fail("recorded evidence reference must be a string.");
  const match = value.match(
    /^(receipt|electron|service|worker|output|cancellation|recovery):([^#]+)#sha256=([0-9A-F]{64})#bytes=([1-9][0-9]*)#capturedAt=(.+)$/u,
  );
  if (!match) fail("recorded evidence reference is not canonical Runtime V2 evidence v1.");
  const bytes = Number(match[4]);
  if (!Number.isSafeInteger(bytes) || bytes > MAX_EVIDENCE_FILE_BYTES) {
    fail("recorded evidence reference has invalid bytes.");
  }
  canonicalIso(match[5], "recorded evidence capturedAt");
  return Object.freeze({
    type: match[1],
    path: safeRelativePath(match[2], "recorded evidence reference"),
    sha256: match[3],
    bytes,
    capturedAt: match[5],
  });
}

function buildPostMigrationPatch(validatedRow, receiptReference) {
  const evidence = validatedRow.row.evidence;
  const refs = Object.fromEntries(
    EVIDENCE_TYPES.map((type) => [
      type,
      evidence[type].map((reference) => formatEvidenceReference(type, reference)),
    ]),
  );
  const receipt = formatEvidenceReference("receipt", receiptReference);
  return Object.freeze({
    postMigrationStatus: validatedRow.row.result,
    postMigrationEvidence: [receipt, ...EVIDENCE_TYPES.flatMap((type) => refs[type])],
    selectionEvidence: refs.electron,
    serviceWorkerEvidence: [...refs.service, ...refs.worker],
    outputArtifactEvidence: refs.output,
    cancellationEvidence: refs.cancellation,
    recoveryEvidence: refs.recovery,
    result: validatedRow.row.result,
  });
}

function rowIsUnrecorded(row) {
  return (
    row.postMigrationStatus === "NOT RUN" &&
    row.result === "NOT RUN" &&
    Array.isArray(row.postMigrationEvidence) &&
    row.postMigrationEvidence.length === 0 &&
    POST_EVIDENCE_FIELDS.every(
      (field) => record(row[field]) && Array.isArray(row[field].postMigration) && row[field].postMigration.length === 0,
    )
  );
}

function applyPatch(row, patch) {
  row.postMigrationStatus = patch.postMigrationStatus;
  row.postMigrationEvidence = [...patch.postMigrationEvidence];
  row.selectionEvidence.postMigration = [...patch.selectionEvidence];
  row.serviceWorkerEvidence.postMigration = [...patch.serviceWorkerEvidence];
  row.outputArtifactEvidence.postMigration = [...patch.outputArtifactEvidence];
  row.cancellationEvidence.postMigration = [...patch.cancellationEvidence];
  row.recoveryEvidence.postMigration = [...patch.recoveryEvidence];
  row.result = patch.result;
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function readBoundedJson(file, label) {
  const stat = fs.statSync(file, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.size < 2 || stat.size > 64 * 1024 * 1024) {
    fail(`${label} does not exist or has an invalid size.`);
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail(`${label} is malformed JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readBoundedJsonSnapshot(file, label, maximumBytes = 64 * 1024 * 1024) {
  const descriptor = fs.openSync(file, "r");
  try {
    const before = fs.fstatSync(descriptor);
    if (!before.isFile() || before.size < 2 || before.size > maximumBytes) {
      fail(`${label} does not exist or has an invalid size.`);
    }
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || bytes.length !== after.size) {
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
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex").toUpperCase(),
      capturedAt: after.mtime.toISOString(),
    });
  } finally {
    fs.closeSync(descriptor);
  }
}

function atomicReplaceJson(file, value, expectedOriginalSha256) {
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  const mode = fs.statSync(file).mode;
  try {
    if (sha256File(file) !== expectedOriginalSha256) {
      fail("feature-parity.json changed while evidence was being validated.");
    }
    const descriptor = fs.openSync(temporary, "wx", mode);
    try {
      fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    if (sha256File(file) !== expectedOriginalSha256) {
      fail("feature-parity.json changed before the atomic evidence commit.");
    }
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function resolveNewEvidenceFile(repoRoot, relativePath, label) {
  const safePath = safeRelativePath(relativePath, label);
  if (!evidencePathAllowed(safePath)) fail(`${label} must live under an immutable QA evidence root.`);
  const root = fs.realpathSync(path.resolve(repoRoot));
  const candidate = path.resolve(root, ...safePath.split("/"));
  if (!withinRoot(root, candidate)) fail(`${label} escaped the repository root.`);
  if (fs.existsSync(candidate)) fail(`${label} already exists; evidence receipts are immutable.`);
  return Object.freeze({ relativePath: safePath, absolutePath: candidate });
}

function publishImmutableJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    const descriptor = fs.openSync(temporary, "wx", 0o600);
    try {
      fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    try {
      fs.linkSync(temporary, file);
    } catch (error) {
      if (error?.code === "EEXIST") fail("parity receipt target already exists; immutable receipts cannot be replaced.");
      throw error;
    }
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function expectedObservationBinding(observation) {
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
  if (observation.result === "BLOCKED") expected.blocker = observation.blocker;
  if (observation.result === "FAIL") {
    expected.failureCode = observation.failureCode;
    expected.failureSummary = observation.failureSummary;
  }
  return expected;
}

function sameObservationGroup(left, observation) {
  return (
    left.result === observation.result &&
    left.executionDisposition === observation.executionDisposition &&
    same(left.workflowIdentity, observation.workflowIdentity) &&
    same(left.packageVerification, observation.packageVerification) &&
    same(left.blocker ?? null, observation.blocker ?? null) &&
    same(left.failure ?? null, observation.result === "FAIL"
      ? { code: observation.failureCode, summary: observation.failureSummary }
      : null)
  );
}

export function recordParityEvidenceReceipt({
  repoRoot,
  receiptPath,
  observationPaths,
  executablePath,
  packageVerifierReceiptPath,
  inventoryPath = path.join(repoRoot, "qa", "runtime-v2", "feature-parity.json"),
  nowMs = Date.now(),
}) {
  if (!Array.isArray(observationPaths) || observationPaths.length === 0 || observationPaths.length > 10_000) {
    fail("observationPaths must contain 1-10000 runner-emitted observation paths.");
  }
  const target = resolveNewEvidenceFile(repoRoot, receiptPath, "parity receipt path");
  const inventory = readBoundedJson(path.resolve(inventoryPath), "feature-parity.json");
  const packageReceiptRelativePath = safeRelativePath(
    packageVerifierReceiptPath,
    "packageVerifierReceiptPath",
  );
  const validatedPackage = validatePackageVerifierReceipt({
    repoRoot,
    receiptPath: path.join(path.resolve(repoRoot), ...packageReceiptRelativePath.split("/")),
    executablePath,
    nowMs,
    enforceFreshness: true,
    verifyClosure: true,
  });
  const verifiedPackageBinding = packageVerificationBinding(validatedPackage);
  const groups = new Map();
  const seenPaths = new Set();
  let receiptRunId = null;
  let electronRunId = null;
  let executable = null;
  let startedAtMs = Number.POSITIVE_INFINITY;
  let finishedAtMs = Number.NEGATIVE_INFINITY;

  for (const candidate of observationPaths) {
    const relativePath = safeRelativePath(candidate, "observation path");
    if (seenPaths.has(relativePath)) fail(`observationPaths duplicates ${relativePath}.`);
    seenPaths.add(relativePath);
    const observation = readBoundedJson(
      path.join(path.resolve(repoRoot), ...relativePath.split("/")),
      "runner-emitted parity observation",
    );
    const validated = validateParityEvidenceObservation({
      repoRoot,
      observationPath: relativePath,
      expected: expectedObservationBinding(observation),
      executablePath,
      validatedPackageVerification: validatedPackage,
      nowMs,
      enforceFreshness: true,
    });
    const current = validated.observation;
    if (receiptRunId === null) receiptRunId = current.runId;
    if (electronRunId === null) electronRunId = current.workflowIdentity.electronRunId;
    if (executable === null) executable = current.executable;
    if (current.runId !== receiptRunId) fail("observations do not share one parity runId.");
    if (current.workflowIdentity.electronRunId !== electronRunId) {
      fail("observations do not share one packaged Electron run identity.");
    }
    if (!same(current.executable, executable)) fail("observations do not share one packaged executable identity.");
    if (!same(current.packageVerification, verifiedPackageBinding)) {
      fail("observations do not share the supplied verified package closure.");
    }
    startedAtMs = Math.min(startedAtMs, Date.parse(current.timestamps.startedAt));
    finishedAtMs = Math.max(finishedAtMs, Date.parse(current.timestamps.recordedAt));

    let group = groups.get(current.capabilityId);
    if (!group) {
      group = {
        capabilityId: current.capabilityId,
        result: current.result,
        executionDisposition: current.executionDisposition,
        fallbackUsed: false,
        workflowIdentity: current.workflowIdentity,
        packageVerification: current.packageVerification,
        blocker: current.blocker ?? null,
        failure: current.result === "FAIL"
          ? { code: current.failureCode, summary: current.failureSummary }
          : null,
        evidence: Object.fromEntries(EVIDENCE_TYPES.map((type) => [type, []])),
        operationIds: new Set(),
      };
      groups.set(current.capabilityId, group);
    } else if (!sameObservationGroup(group, current)) {
      fail(`${current.capabilityId} observations disagree on result, workflow, blocker, or failure identity.`);
    }
    if (group.operationIds.has(current.operationId)) {
      fail(`${current.capabilityId} duplicates operationId ${current.operationId}.`);
    }
    group.operationIds.add(current.operationId);
    group.evidence[current.evidenceType].push(validated.reference);
  }

  if (finishedAtMs - startedAtMs > PARITY_EVIDENCE_MAX_RUN_DURATION_MS) {
    fail(`observation batch duration exceeds ${PARITY_EVIDENCE_MAX_RUN_DURATION_MS} ms.`);
  }
  const rows = [...groups.values()]
    .sort((left, right) => left.capabilityId.localeCompare(right.capabilityId))
    .map((group) => {
      for (const type of EVIDENCE_TYPES) {
        group.evidence[type].sort((left, right) => left.path.localeCompare(right.path));
      }
      if (group.result === "FAIL") {
        if (group.evidence.electron.length !== 1 || EVIDENCE_TYPES.slice(1).some((type) => group.evidence[type].length !== 0)) {
          fail(`${group.capabilityId} FAIL requires exactly one electron failure observation.`);
        }
      } else {
        for (const type of EVIDENCE_TYPES) {
          if (group.evidence[type].length === 0) fail(`${group.capabilityId} lacks ${type} observation coverage.`);
        }
      }
      const row = {
        capabilityId: group.capabilityId,
        result: group.result,
        executionDisposition: group.executionDisposition,
        fallbackUsed: false,
        workflowIdentity: group.workflowIdentity,
        evidence: group.evidence,
      };
      if (group.blocker) row.blocker = group.blocker;
      if (group.failure) row.failure = group.failure;
      return row;
    });
  const receipt = sealParityEvidenceReceipt({
    schemaVersion: PARITY_EVIDENCE_SCHEMA_VERSION,
    kind: PARITY_EVIDENCE_KIND,
    runId: receiptRunId,
    electronRunId,
    startedAt: new Date(startedAtMs).toISOString(),
    finishedAt: new Date(finishedAtMs).toISOString(),
    inventory: {
      path: "qa/runtime-v2/feature-parity.json",
      schemaVersion: 2,
      capabilityCount: inventory.capabilityCount,
      contractSha256: computeInventoryContractSha256(inventory),
    },
    executable,
    packageVerification: verifiedPackageBinding,
    rows,
  });
  const provisionalReference = {
    path: target.relativePath,
    bytes: 1,
    sha256: "A".repeat(64),
    capturedAt: new Date(nowMs).toISOString(),
  };
  validateParityEvidenceReceipt({
    receipt,
    receiptPath: target.absolutePath,
    receiptReference: provisionalReference,
    repoRoot,
    inventory,
    nowMs,
    enforceFreshness: true,
    validatedPackageVerification: validatedPackage,
  });
  const finalPackageVerification = validatePackageVerifierReceipt({
    repoRoot,
    receiptPath: path.join(path.resolve(repoRoot), ...packageReceiptRelativePath.split("/")),
    expectedFileIdentity: verifiedPackageBinding.receipt,
    executablePath,
    nowMs,
    enforceFreshness: true,
    verifyClosure: true,
  });
  if (!same(packageVerificationBinding(finalPackageVerification), verifiedPackageBinding)) {
    fail("verified package closure changed before parity receipt publication.");
  }
  publishImmutableJson(target.absolutePath, receipt);
  const snapshot = readBoundedJsonSnapshot(target.absolutePath, "published parity receipt", 16 * 1024 * 1024);
  const reference = receiptReferenceFromSnapshot(repoRoot, target.absolutePath, snapshot);
  validateParityEvidenceReceipt({
    receipt: snapshot.value,
    receiptPath: target.absolutePath,
    receiptReference: reference,
    repoRoot,
    inventory,
    nowMs,
    enforceFreshness: true,
    validatedPackageVerification: finalPackageVerification,
  });
  return Object.freeze({ receipt: Object.freeze(receipt), reference });
}

export function importParityEvidence({
  repoRoot,
  inventoryPath = path.join(repoRoot, "qa", "runtime-v2", "feature-parity.json"),
  receiptPath,
  nowMs = Date.now(),
  checkOnly = false,
}) {
  const resolvedInventoryPath = path.resolve(inventoryPath);
  const resolvedReceiptPath = path.resolve(receiptPath);
  const lockPath = `${resolvedInventoryPath}.parity-evidence.lock`;
  let lockDescriptor;
  try {
    lockDescriptor = fs.openSync(lockPath, "wx", 0o600);
  } catch (error) {
    fail(`could not acquire the feature-parity evidence lock: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    const originalSha256 = sha256File(resolvedInventoryPath);
    const inventory = readBoundedJson(resolvedInventoryPath, "feature-parity.json");
    const beforeProjection = postMigrationProjection(inventory);
    const receiptSnapshot = readBoundedJsonSnapshot(
      resolvedReceiptPath,
      "parity evidence receipt",
      16 * 1024 * 1024,
    );
    const receiptReference = receiptReferenceFromSnapshot(repoRoot, resolvedReceiptPath, receiptSnapshot);
    const receipt = receiptSnapshot.value;
    const validated = validateParityEvidenceReceipt({
      receipt,
      receiptPath: resolvedReceiptPath,
      receiptReference,
      repoRoot,
      inventory,
      nowMs,
      enforceFreshness: true,
    });
    const inventoryRows = new Map(inventory.capabilities.map((row) => [row.capabilityId, row]));
    for (const [capabilityId, validatedRow] of validated.rows) {
      const target = inventoryRows.get(capabilityId);
      if (!target) fail(`receipt references unknown capability ${capabilityId}.`);
      if (validatedRow.row.result === "BLOCKED") {
        fail(
          `${capabilityId} BLOCKED import is unsupported until a sealed pre-migration installed-Electron ` +
          "package-closure receipt authenticates the exact historical blocker; preMigrationStatus alone is not evidence.",
        );
      }
      if (!rowIsUnrecorded(target)) {
        fail(`${capabilityId} already has post-migration evidence; duplicate/overwrite imports are forbidden.`);
      }
      applyPatch(target, buildPostMigrationPatch(validatedRow, validated.receiptReference));
    }
    if (!same(beforeProjection, postMigrationProjection(inventory))) {
      fail("import attempted to modify a frozen source-inventory field.");
    }
    if (!checkOnly) {
      const finalSnapshot = readBoundedJsonSnapshot(
        resolvedReceiptPath,
        "parity evidence receipt",
        16 * 1024 * 1024,
      );
      const finalReference = receiptReferenceFromSnapshot(repoRoot, resolvedReceiptPath, finalSnapshot);
      if (!same(finalReference, receiptReference)) {
        fail("parity evidence receipt changed before the atomic inventory commit.");
      }
      validateParityEvidenceReceipt({
        receipt: finalSnapshot.value,
        receiptPath: resolvedReceiptPath,
        receiptReference: finalReference,
        repoRoot,
        inventory,
        nowMs,
        enforceFreshness: true,
      });
      atomicReplaceJson(resolvedInventoryPath, inventory, originalSha256);
    }
    return Object.freeze({
      checkOnly,
      importedCapabilityIds: Object.freeze([...validated.rows.keys()]),
      inventoryContractSha256: validated.inventoryContractSha256,
      receiptSha256: validated.receiptReference.sha256,
    });
  } finally {
    if (lockDescriptor !== undefined) fs.closeSync(lockDescriptor);
    fs.rmSync(lockPath, { force: true });
  }
}

export function validateRecordedParityEvidence({ inventory, repoRoot }) {
  const errors = [];
  const receiptCache = new Map();
  const completedRows = new Map();
  for (const row of inventory.capabilities ?? []) {
    if (rowIsUnrecorded(row)) continue;
    if (!new Set(["PASS", "BLOCKED", "FAIL"]).has(row.result) || row.postMigrationStatus !== row.result) {
      errors.push(`${row.capabilityId}: partially populated or invalid post-migration disposition`);
      continue;
    }
    if (row.result === "BLOCKED") {
      errors.push(
        `${row.capabilityId}: BLOCKED lacks an authenticated pre-migration installed-Electron package-closure receipt`,
      );
      continue;
    }
    let receiptReference;
    try {
      const parsed = (row.postMigrationEvidence ?? []).map(parseEvidenceReference);
      const receipts = parsed.filter(({ type }) => type === "receipt");
      if (receipts.length !== 1) fail(`${row.capabilityId} must reference exactly one parity receipt.`);
      receiptReference = receipts[0];
    } catch (error) {
      errors.push(`${row.capabilityId}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    let validated = receiptCache.get(receiptReference.path);
    if (!validated) {
      try {
        const receiptPath = path.join(path.resolve(repoRoot), ...receiptReference.path.split("/"));
        const receiptSnapshot = readBoundedJsonSnapshot(
          receiptPath,
          "recorded parity evidence receipt",
          16 * 1024 * 1024,
        );
        const identity = receiptReferenceFromSnapshot(repoRoot, receiptPath, receiptSnapshot);
        if (
          identity.bytes !== receiptReference.bytes ||
          identity.sha256 !== receiptReference.sha256 ||
          identity.capturedAt !== receiptReference.capturedAt
        ) {
          fail("recorded parity receipt identity no longer matches its file.");
        }
        validated = validateParityEvidenceReceipt({
          receipt: receiptSnapshot.value,
          receiptPath,
          receiptReference: identity,
          repoRoot,
          inventory,
          enforceFreshness: false,
        });
        receiptCache.set(receiptReference.path, validated);
      } catch (error) {
        errors.push(`${row.capabilityId}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
    }
    const validatedRow = validated.rows.get(row.capabilityId);
    if (!validatedRow) {
      errors.push(`${row.capabilityId}: linked receipt does not contain this capability`);
      continue;
    }
    const expected = buildPostMigrationPatch(validatedRow, validated.receiptReference);
    const actual = {
      postMigrationStatus: row.postMigrationStatus,
      postMigrationEvidence: row.postMigrationEvidence,
      selectionEvidence: row.selectionEvidence?.postMigration,
      serviceWorkerEvidence: row.serviceWorkerEvidence?.postMigration,
      outputArtifactEvidence: row.outputArtifactEvidence?.postMigration,
      cancellationEvidence: row.cancellationEvidence?.postMigration,
      recoveryEvidence: row.recoveryEvidence?.postMigration,
      result: row.result,
    };
    if (!same(actual, expected)) errors.push(`${row.capabilityId}: recorded post-migration fields do not match the sealed receipt`);
    completedRows.set(row.capabilityId, receiptReference.path);
  }
  for (const [receiptPath, validated] of receiptCache) {
    for (const capabilityId of validated.rows.keys()) {
      if (completedRows.get(capabilityId) !== receiptPath) {
        errors.push(`${capabilityId}: sealed receipt was not imported as one atomic batch`);
      }
    }
  }
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}
