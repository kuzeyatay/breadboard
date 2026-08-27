import crypto from "node:crypto";

// Keep this independent from the generated snapshot. A frozen baseline cannot
// redefine which source-backed fields the validator is supposed to protect.
export const FROZEN_CONTRACT_FIELDS = Object.freeze([
  "sourceIdentity",
  "displayName",
  "category",
  "visibleEntryPoint",
  "slashCommand",
  "implicitTrigger",
  "selectionSemantics",
  "routeOrIpcContract",
  "requiredServiceOrWorker",
  "providerRequirements",
  "credentialRequirements",
  "externalSoftwareRequirements",
  "inputTypes",
  "outputTypes",
  "artifactTypes",
  "progressEventContract",
  "streamingContract",
  "cancellationBehavior",
  "approvalBehavior",
  "followUpContextBehavior",
  "restartBehavior",
  "recoveryBehavior",
  "uiEntryPoint",
  "runtimePath",
  "stoppedServiceBehavior",
  "mockOrFallbackDeclarations",
  "sourceRefs",
  "sourceSha256",
]);

export function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  }
  return value;
}

export function same(left, right) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

export function contractDigest(row, fields = FROZEN_CONTRACT_FIELDS) {
  const contract = Object.fromEntries(fields.map((field) => [field, row[field]]));
  return crypto.createHash("sha256").update(JSON.stringify(contract)).digest("hex");
}

const HISTORICAL_STATUS_FIELDS = Object.freeze([
  "preMigrationStatus",
  "preMigrationEvidence",
  "postMigrationStatus",
  "postMigrationEvidence",
  "result",
]);

const HISTORICAL_EVIDENCE_FIELDS = Object.freeze([
  "selectionEvidence",
  "serviceWorkerEvidence",
  "outputArtifactEvidence",
  "cancellationEvidence",
  "recoveryEvidence",
]);

/**
 * Refresh source-backed contracts without erasing the evidence ledger.
 *
 * Registry generation intentionally follows the current source so reviewed
 * Runtime V2 cutovers can update their route, worker and source-digest fields.
 * Pre/post execution evidence is a different authority: it records what was
 * actually observed before and after migration and must survive regeneration.
 */
export function preserveHistoricalParityEvidence(current, previous) {
  if (!current || !Array.isArray(current.capabilities)) return current;
  if (!previous || !Array.isArray(previous.capabilities)) return current;

  const previousRows = new Map(
    previous.capabilities
      .filter((row) => row && typeof row.capabilityId === "string")
      .map((row) => [row.capabilityId, row]),
  );

  return {
    ...current,
    capabilities: current.capabilities.map((currentRow) => {
      const previousRow = previousRows.get(currentRow?.capabilityId);
      if (!previousRow) return currentRow;

      const reconciled = { ...currentRow };
      for (const field of HISTORICAL_STATUS_FIELDS) {
        if (Object.hasOwn(previousRow, field)) reconciled[field] = previousRow[field];
      }
      for (const field of HISTORICAL_EVIDENCE_FIELDS) {
        const prior = previousRow[field];
        const next = currentRow[field];
        reconciled[field] = {
          preMigration: Array.isArray(prior?.preMigration)
            ? prior.preMigration
            : (next?.preMigration ?? []),
          postMigration: Array.isArray(prior?.postMigration)
            ? prior.postMigration
            : (next?.postMigration ?? []),
        };
      }
      return reconciled;
    }),
  };
}

function sha256Text(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function mockDeclarationSnapshotIsInternallyConsistent(snapshot) {
  if (
    !snapshot ||
    !Number.isInteger(snapshot.count) ||
    snapshot.count < 0 ||
    typeof snapshot.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(snapshot.sha256) ||
    !Array.isArray(snapshot.evidence) ||
    typeof snapshot.truncated !== "boolean"
  ) {
    return false;
  }
  if (snapshot.truncated) {
    return snapshot.count > snapshot.evidence.length && snapshot.evidence.length === 24;
  }
  return (
    snapshot.count === snapshot.evidence.length &&
    snapshot.sha256 === sha256Text(snapshot.evidence.join("\n"))
  );
}

function declarationWithoutLineNumber(value) {
  if (typeof value !== "string") return value;
  return value.replace(/^(.+?):\d+:/, "$1:");
}

/// The snapshot's original declaration hash includes source line numbers.
/// For a non-truncated declaration set, compare every path and declaration
/// after removing only that unstable line number. Text/path/count changes still
/// fail. A truncated set remains hash-strict because its unseen tail cannot be
/// audited from the recorded evidence.
export function sameMockOrFallbackDeclarations(baseline, current) {
  if (
    !mockDeclarationSnapshotIsInternallyConsistent(baseline) ||
    !mockDeclarationSnapshotIsInternallyConsistent(current)
  ) {
    return false;
  }
  if (
    baseline.count !== current.count ||
    baseline.truncated !== current.truncated ||
    !Array.isArray(baseline.evidence) ||
    !Array.isArray(current.evidence)
  ) {
    return false;
  }
  if (baseline.truncated || current.truncated) {
    return baseline.sha256 === current.sha256 && same(baseline.evidence, current.evidence);
  }
  return same(
    baseline.evidence.map(declarationWithoutLineNumber),
    current.evidence.map(declarationWithoutLineNumber),
  );
}

export function describeSourceCatalogDrift(name, baseline, current) {
  if (!baseline || !current || typeof baseline !== "object" || typeof current !== "object") {
    return `source catalog ${name} was added or removed`;
  }
  const changes = [];
  for (const field of new Set([...Object.keys(baseline), ...Object.keys(current)])) {
    if (same(baseline[field], current[field])) continue;
    if (field === "sha256" || field.endsWith("Sha256")) {
      changes.push(`${field} ${baseline[field] ?? "missing"} -> ${current[field] ?? "missing"}`);
    } else if (/count/i.test(field) && [baseline[field], current[field]].every(Number.isInteger)) {
      changes.push(`${field} ${baseline[field]} -> ${current[field]}`);
    } else {
      changes.push(field);
    }
  }
  return `source catalog ${name} drifted (${changes.join("; ") || "unknown fields"})`;
}
