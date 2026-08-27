import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { contractDigest, same, stable } from "./parity-drift.mjs";

const correctionsPath = path.resolve(
  process.cwd(),
  "qa",
  "runtime-v2",
  "parity-contract-corrections.json",
);

const REVIEWED_CORRECTIONS = Object.freeze({
  "surface:temporary-chat": Object.freeze({
    reasonCode: "FROZEN_BASELINE_OVERGENERALIZED_TEMPORARY_CHAT_DURABILITY",
    correctedFields: Object.freeze([
      "followUpContextBehavior",
      "recoveryBehavior",
      "restartBehavior",
    ]),
    oldFields: Object.freeze([
      "baselineContractSha256",
      "followUpContextBehavior",
      "recoveryBehavior",
      "restartBehavior",
      "sourceRefs",
      "sourceSha256",
    ]),
  }),
  "skill:first-party:diagram-design": Object.freeze({
    reasonCode: "FROZEN_BASELINE_MISTOOK_INLINE_SVG_FOR_A_SECOND_ARTIFACT",
    correctedFields: Object.freeze(["artifactTypes"]),
    oldFields: Object.freeze([
      "artifactTypes",
      "baselineContractSha256",
      "sourceRefs",
      "sourceSha256",
    ]),
  }),
  "skill:first-party:resource2skill": Object.freeze({
    reasonCode: "FROZEN_BASELINE_MISTOOK_RUNTIME_DOMAIN_OUTPUTS_FOR_HERMES_ARTIFACTS",
    correctedFields: Object.freeze(["artifactTypes"]),
    oldFields: Object.freeze([
      "artifactTypes",
      "baselineContractSha256",
      "sourceRefs",
      "sourceSha256",
    ]),
  }),
  "workflow:research": Object.freeze({
    reasonCode: "FROZEN_BASELINE_MISTOOK_TYPED_RESEARCH_STATE_FOR_HERMES_ARTIFACTS",
    correctedFields: Object.freeze(["artifactTypes"]),
    oldFields: Object.freeze([
      "artifactTypes",
      "baselineContractSha256",
      "sourceRefs",
      "sourceSha256",
    ]),
  }),
  "workflow:watch-video": Object.freeze({
    reasonCode: "FROZEN_BASELINE_MISTOOK_WATCH_INPUT_AND_RESULT_FIELDS_FOR_HERMES_ARTIFACTS",
    correctedFields: Object.freeze(["artifactTypes"]),
    oldFields: Object.freeze([
      "artifactTypes",
      "baselineContractSha256",
      "sourceRefs",
      "sourceSha256",
    ]),
  }),
});

function fail(message) {
  throw new Error(`[runtime-v2-contract-correction] ${message}`);
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function keys(value) {
  return Object.keys(value).sort();
}

function withoutOwnHash(correction) {
  const { correctionSha256: _ignored, ...authenticated } = correction;
  return authenticated;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function correctionDigest(correction) {
  if (!record(correction)) fail("correction must be an object.");
  return sha256(withoutOwnHash(correction));
}

export function validateParityContractCorrections(catalog) {
  if (!record(catalog) || catalog.schemaVersion !== 1 || !Array.isArray(catalog.corrections)) {
    fail("catalog must be schema version 1 with a corrections array.");
  }
  if (catalog.correctionCount !== catalog.corrections.length) {
    fail("correctionCount does not match corrections.length.");
  }
  const expectedIds = Object.keys(REVIEWED_CORRECTIONS).sort();
  const actualIds = catalog.corrections.map(({ capabilityId }) => capabilityId).sort();
  if (!same(actualIds, expectedIds)) {
    fail(`reviewed correction set differs (expected=${expectedIds.join(",")}; actual=${actualIds.join(",")}).`);
  }

  for (const correction of catalog.corrections) {
    if (!record(correction)) fail("correction entry must be an object.");
    const reviewed = REVIEWED_CORRECTIONS[correction.capabilityId];
    if (!reviewed || correction.reasonCode !== reviewed.reasonCode) {
      fail(`${String(correction.capabilityId)} is not a reviewed correction/reason pair.`);
    }
    if (!record(correction.oldContract) || !same(keys(correction.oldContract), reviewed.oldFields)) {
      fail(`${correction.capabilityId} oldContract must contain the exact reviewed frozen fields.`);
    }
    if (!record(correction.correctedSemantics) || !same(keys(correction.correctedSemantics), reviewed.correctedFields)) {
      fail(`${correction.capabilityId} correctedSemantics may change only the reviewed semantic fields.`);
    }
    if (
      !Array.isArray(correction.authoritativeSourceRefs) ||
      correction.authoritativeSourceRefs.length === 0 ||
      new Set(correction.authoritativeSourceRefs).size !== correction.authoritativeSourceRefs.length ||
      correction.authoritativeSourceRefs.some((reference) =>
        typeof reference !== "string" || !/^[^:\r\n]+(?:\/[^:\r\n]+)*:\d+$/u.test(reference))
    ) {
      fail(`${correction.capabilityId} authoritativeSourceRefs must be unique repository line references.`);
    }
    if (!/^[a-f0-9]{64}$/u.test(correction.correctionSha256 ?? "")) {
      fail(`${correction.capabilityId} correctionSha256 is malformed.`);
    }
    const actualDigest = correctionDigest(correction);
    if (actualDigest !== correction.correctionSha256) {
      fail(`${correction.capabilityId} correctionSha256 does not authenticate the overlay.`);
    }
  }
  return true;
}

const parsedCatalog = JSON.parse(fs.readFileSync(correctionsPath, "utf8"));
validateParityContractCorrections(parsedCatalog);
export const PARITY_CONTRACT_CORRECTIONS = deepFreeze(parsedCatalog);

/**
 * Produce an in-memory effective contract for execution planning. The checked
 * frozen row is never rewritten: each override first authenticates the exact
 * old row/hash and remains separately identified by the overlay hash.
 */
export function applyParityContractCorrections(inventory) {
  if (!record(inventory) || !Array.isArray(inventory.capabilities)) {
    fail("inventory must contain a capabilities array.");
  }
  const corrections = new Map(
    PARITY_CONTRACT_CORRECTIONS.corrections.map((correction) => [correction.capabilityId, correction]),
  );
  const applied = new Set();
  const capabilities = inventory.capabilities.map((row) => {
    const correction = corrections.get(row?.capabilityId);
    if (!correction) return row;
    if (applied.has(correction.capabilityId)) {
      fail(`${correction.capabilityId} appears more than once in the inventory.`);
    }
    applied.add(correction.capabilityId);

    if (
      row.baselineContractSha256 !== correction.oldContract.baselineContractSha256 ||
      contractDigest(row) !== correction.oldContract.baselineContractSha256
    ) {
      fail(`${correction.capabilityId} no longer matches the authenticated frozen baseline hash.`);
    }
    const reviewed = REVIEWED_CORRECTIONS[correction.capabilityId];
    for (const field of reviewed.oldFields) {
      if (field === "baselineContractSha256") continue;
      if (!same(row[field], correction.oldContract[field])) {
        fail(`${correction.capabilityId} oldContract.${field} no longer matches the frozen row.`);
      }
    }

    return Object.freeze({
      ...row,
      ...correction.correctedSemantics,
      contractCorrection: Object.freeze({
        reasonCode: correction.reasonCode,
        correctionSha256: correction.correctionSha256,
        frozenBaselineContractSha256: correction.oldContract.baselineContractSha256,
        authoritativeSourceRefs: Object.freeze([...correction.authoritativeSourceRefs]),
      }),
    });
  });

  // The checked full inventory must never silently omit a reviewed correction.
  // Small synthetic unit-test inventories may omit the target by construction.
  if (inventory.contractVersion === "runtime-v2-feature-parity-v1") {
    for (const capabilityId of corrections.keys()) {
      if (!applied.has(capabilityId)) fail(`full inventory is missing reviewed correction target ${capabilityId}.`);
    }
  }
  return Object.freeze({ ...inventory, capabilities: Object.freeze(capabilities) });
}
