#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  contractDigest,
  describeSourceCatalogDrift,
  FROZEN_CONTRACT_FIELDS,
  mockDeclarationSnapshotIsInternallyConsistent,
  same,
  sameMockOrFallbackDeclarations,
} from "./parity-drift.mjs";

const qaDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(qaDir, "..", "..");
const inventoryPath = path.join(qaDir, "feature-parity.json");
const snapshotPath = path.join(qaDir, "registry-snapshot.mjs");
const args = new Set(process.argv.slice(2));
const inventoryOnly = args.delete("--inventory-only");
if (args.size > 0) {
  throw new Error(`Unknown Runtime V2 parity option(s): ${[...args].join(", ")}`);
}

function fail(message, failures) {
  failures.push(message);
}

function nonEmpty(value) {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return value !== null && typeof value === "object";
}

function evidenceHasPre(value) {
  return value && Array.isArray(value.preMigration) && value.preMigration.length > 0;
}

function evidenceHasPost(value) {
  return value && Array.isArray(value.postMigration) && value.postMigration.length > 0;
}

if (!fs.existsSync(inventoryPath)) {
  throw new Error(`Runtime V2 feature inventory is missing: ${inventoryPath}`);
}

const baseline = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));
const snapshotRun = spawnSync(process.execPath, [snapshotPath], {
  cwd: repoRoot,
  encoding: "utf8",
  env: { ...process.env, NODE_NO_WARNINGS: "1" },
  maxBuffer: 128 * 1024 * 1024,
  windowsHide: true,
});
if (snapshotRun.status !== 0) {
  process.stderr.write(snapshotRun.stderr || snapshotRun.stdout);
  throw new Error(`Runtime V2 source snapshot failed with exit ${snapshotRun.status}`);
}
const currentSnapshot = JSON.parse(snapshotRun.stdout);
const current = currentSnapshot.featureParity;
const structuralFailures = [];
const structuralNotes = [];

if (baseline.schemaVersion !== 2) fail(`unsupported feature-parity schema ${baseline.schemaVersion}`, structuralFailures);
if (!Array.isArray(baseline.capabilities)) fail("feature-parity capabilities must be an array", structuralFailures);
if (!Array.isArray(baseline.requiredCapabilityFields)) fail("requiredCapabilityFields must be an array", structuralFailures);
if (!same(baseline.contractFieldsComparedToSource, FROZEN_CONTRACT_FIELDS)) {
  fail("frozen contractFieldsComparedToSource does not match the validator's complete field set", structuralFailures);
}
if (!same(current.contractFieldsComparedToSource, FROZEN_CONTRACT_FIELDS)) {
  fail("current contractFieldsComparedToSource does not match the validator's complete field set", structuralFailures);
}

const baselineRows = new Map();
for (const row of baseline.capabilities ?? []) {
  if (!row || typeof row !== "object") {
    fail("capability row is not an object", structuralFailures);
    continue;
  }
  if (baselineRows.has(row.capabilityId)) fail(`duplicate baseline capability ${row.capabilityId}`, structuralFailures);
  baselineRows.set(row.capabilityId, row);
  for (const field of baseline.requiredCapabilityFields ?? []) {
    if (!(field in row)) fail(`${row.capabilityId} is missing required field ${field}`, structuralFailures);
  }
  for (const field of [
    "capabilityId",
    "displayName",
    "category",
    "visibleEntryPoint",
    "selectionSemantics",
    "routeOrIpcContract",
    "progressEventContract",
    "streamingContract",
    "cancellationBehavior",
    "approvalBehavior",
    "followUpContextBehavior",
    "restartBehavior",
    "recoveryBehavior",
    "preMigrationStatus",
    "runtimePath",
    "stoppedServiceBehavior",
  ]) {
    if (!nonEmpty(row[field])) fail(`${row.capabilityId} has empty ${field}`, structuralFailures);
  }
  if (!Array.isArray(row.preMigrationEvidence) || row.preMigrationEvidence.length === 0) {
    fail(`${row.capabilityId} has no pre-migration evidence`, structuralFailures);
  }
  for (const field of [
    "selectionEvidence",
    "serviceWorkerEvidence",
    "outputArtifactEvidence",
    "cancellationEvidence",
    "recoveryEvidence",
  ]) {
    if (!evidenceHasPre(row[field])) fail(`${row.capabilityId} has no pre-migration ${field}`, structuralFailures);
  }
  if (!Array.isArray(row.sourceRefs) || row.sourceRefs.length === 0) {
    fail(`${row.capabilityId} has no sourceRefs`, structuralFailures);
  } else {
    for (const reference of row.sourceRefs) {
      const relativePath = reference.replace(/:\d+$/, "");
      if (!fs.existsSync(path.join(repoRoot, relativePath))) {
        fail(`${row.capabilityId} references missing source ${relativePath}`, structuralFailures);
      }
    }
  }
  if (
    Array.isArray(row.requiredServiceOrWorker) &&
    row.requiredServiceOrWorker.length > 0 &&
    !/remain visible while stopped/i.test(row.stoppedServiceBehavior)
  ) {
    fail(`${row.capabilityId} does not preserve stopped-service visibility`, structuralFailures);
  }
  if (
    !row.mockOrFallbackDeclarations ||
    !Number.isInteger(row.mockOrFallbackDeclarations.count) ||
    typeof row.mockOrFallbackDeclarations.sha256 !== "string"
  ) {
    fail(`${row.capabilityId} has no auditable mock/fallback declaration snapshot`, structuralFailures);
  } else if (!mockDeclarationSnapshotIsInternallyConsistent(row.mockOrFallbackDeclarations)) {
    fail(`${row.capabilityId} has an internally inconsistent mock/fallback declaration snapshot`, structuralFailures);
  }
  if (row.baselineContractSha256 !== contractDigest(row)) {
    fail(`${row.capabilityId} baselineContractSha256 does not authenticate its frozen fields`, structuralFailures);
  }
}

const currentRows = new Map(current.capabilities.map((row) => [row.capabilityId, row]));
for (const row of current.capabilities) {
  if (!mockDeclarationSnapshotIsInternallyConsistent(row.mockOrFallbackDeclarations)) {
    fail(`${row.capabilityId} current mock/fallback declaration snapshot is internally inconsistent`, structuralFailures);
  }
  if (row.baselineContractSha256 !== contractDigest(row)) {
    fail(`${row.capabilityId} current baselineContractSha256 is internally inconsistent`, structuralFailures);
  }
}
for (const capabilityId of baselineRows.keys()) {
  if (!currentRows.has(capabilityId)) fail(`capability disappeared from source: ${capabilityId}`, structuralFailures);
}
for (const capabilityId of currentRows.keys()) {
  if (!baselineRows.has(capabilityId)) fail(`source capability is absent from feature-parity.json: ${capabilityId}`, structuralFailures);
}

for (const [capabilityId, baselineRow] of baselineRows) {
  const currentRow = currentRows.get(capabilityId);
  if (!currentRow) continue;
  for (const field of FROZEN_CONTRACT_FIELDS) {
    const exactMatch = same(baselineRow[field], currentRow[field]);
    const semanticMatch =
      field === "mockOrFallbackDeclarations"
        ? sameMockOrFallbackDeclarations(baselineRow[field], currentRow[field])
        : exactMatch;
    if (!semanticMatch) {
      fail(`${capabilityId} ${field} drifted from the frozen source contract`, structuralFailures);
    } else if (!exactMatch && field === "mockOrFallbackDeclarations") {
      structuralNotes.push(
        `${capabilityId} mock/fallback declarations are unchanged; only recorded source line pointers moved`,
      );
    }
  }
}

for (const name of new Set([
  ...Object.keys(baseline.sourceCatalogs ?? {}),
  ...Object.keys(current.sourceCatalogs ?? {}),
])) {
  if (!same(baseline.sourceCatalogs?.[name], current.sourceCatalogs?.[name])) {
    fail(
      describeSourceCatalogDrift(name, baseline.sourceCatalogs?.[name], current.sourceCatalogs?.[name]),
      structuralFailures,
    );
  }
}
if (baseline.capabilityCount !== baselineRows.size) {
  fail(`capabilityCount=${baseline.capabilityCount} but matrix contains ${baselineRows.size}`, structuralFailures);
}
if (!same(baseline.countsByCategory, current.countsByCategory)) {
  fail("category counts drifted from current source", structuralFailures);
}

const exactMinimums = {
  "runtime-agent": 37,
  "first-party-skill": 26,
  "installed-reviewed-skill": 3,
  "default-prompt": 10,
  provider: 12,
  attachment: 6,
  "artifact-type": 16,
};
for (const [category, expected] of Object.entries(exactMinimums)) {
  const actual = baseline.capabilities.filter((row) => row.category === category).length;
  if (actual !== expected) fail(`${category} count ${actual}; expected ${expected}`, structuralFailures);
}
for (const requiredCategory of [
  "agency-persona",
  "approval",
  "chat-surface",
  "connection",
  "connection-catalog",
  "recovery",
  "registry",
  "tool-family",
  "workflow",
]) {
  if (!baseline.capabilities.some((row) => row.category === requiredCategory)) {
    fail(`matrix has no ${requiredCategory} row`, structuralFailures);
  }
}

for (const row of baseline.capabilities.filter((candidate) =>
  ["runtime-agent", "agency-persona", "first-party-persona", "first-party-skill", "installed-reviewed-skill", "default-prompt"].includes(candidate.category),
)) {
  if (!row.slashCommand) fail(`${row.capabilityId} is missing its command entry point`, structuralFailures);
}
for (const row of baseline.capabilities.filter((candidate) => candidate.category === "runtime-agent")) {
  if (!/\/events/.test(row.routeOrIpcContract) || !/\/abort/.test(row.routeOrIpcContract)) {
    fail(`${row.capabilityId} lost progress or cancellation route`, structuralFailures);
  }
}

for (const note of structuralNotes) process.stderr.write(`[runtime-v2-parity] NOTE structural: ${note}\n`);
for (const failure of structuralFailures) process.stderr.write(`[runtime-v2-parity] FAIL structural: ${failure}\n`);

const resultCounts = {};
for (const row of baseline.capabilities ?? []) {
  resultCounts[row.result] = (resultCounts[row.result] ?? 0) + 1;
  process.stdout.write(
    `[runtime-v2-parity] ROW ${row.result.padEnd(7)} ${row.capabilityId} | pre=${row.preMigrationStatus} | post=${row.postMigrationStatus} | ${row.displayName}\n`,
  );
}

if (structuralFailures.length > 0) {
  process.stderr.write(
    `[runtime-v2-parity] structural/source inventory FAILED: ${structuralFailures.length} issue(s), ${baselineRows.size} row(s)\n`,
  );
  process.exitCode = 1;
} else if (inventoryOnly) {
  process.stdout.write(
    `[runtime-v2-parity] inventory-only PASS: ${baselineRows.size} capability row(s); source catalogs and drift contracts match. No app, service, worker, build, compiler, or post-migration workflow was run.\n`,
  );
} else {
  const postFailures = [];
  for (const row of baseline.capabilities) {
    if (row.postMigrationStatus === "NOT RUN" || row.result === "NOT RUN") {
      postFailures.push(`${row.capabilityId}: post-migration Electron evidence NOT RUN`);
      continue;
    }
    if (row.result === "FAIL") {
      postFailures.push(`${row.capabilityId}: recorded FAIL`);
      continue;
    }
    if (!new Set(["PASS", "BLOCKED"]).has(row.result)) {
      postFailures.push(`${row.capabilityId}: invalid result ${row.result}`);
      continue;
    }
    if (!Array.isArray(row.postMigrationEvidence) || row.postMigrationEvidence.length === 0) {
      postFailures.push(`${row.capabilityId}: no post-migration evidence`);
    }
    for (const field of [
      "selectionEvidence",
      "serviceWorkerEvidence",
      "outputArtifactEvidence",
      "cancellationEvidence",
      "recoveryEvidence",
    ]) {
      if (!evidenceHasPost(row[field])) postFailures.push(`${row.capabilityId}: no post ${field}`);
    }
    if (row.result === "PASS" && /mock|canned|lower-capability/i.test(row.postMigrationEvidence.join(" "))) {
      postFailures.push(`${row.capabilityId}: PASS evidence declares a prohibited mock/canned/lower-capability path`);
    }
    if (row.result === "BLOCKED" && row.preMigrationStatus !== "BLOCKED") {
      postFailures.push(`${row.capabilityId}: newly BLOCKED without a matching pre-migration blocker`);
    }
  }
  for (const failure of postFailures.slice(0, 40)) {
    process.stderr.write(`[runtime-v2-parity] FAIL evidence: ${failure}\n`);
  }
  if (postFailures.length > 40) {
    process.stderr.write(`[runtime-v2-parity] ... ${postFailures.length - 40} additional evidence failure(s)\n`);
  }
  if (postFailures.length > 0) {
    process.stderr.write(
      `[runtime-v2-parity] expected fail-closed result: ${postFailures.length} post-migration evidence gate(s) unresolved; results=${JSON.stringify(resultCounts)}\n`,
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `[runtime-v2-parity] PASS: ${baselineRows.size} capability row(s) have inspected post-migration evidence.\n`,
    );
  }
}
