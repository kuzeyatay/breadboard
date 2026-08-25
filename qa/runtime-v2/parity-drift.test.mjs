import assert from "node:assert/strict";
import test from "node:test";
import {
  contractDigest,
  describeSourceCatalogDrift,
  FROZEN_CONTRACT_FIELDS,
  mockDeclarationSnapshotIsInternallyConsistent,
  sameMockOrFallbackDeclarations,
} from "./parity-drift.mjs";

test("mock declaration comparison ignores only source line movement", () => {
  const baseline = {
    count: 1,
    sha256: "188a000cbee83dfbce1610978261738274abda3e3a8182c53a8c4744e9004062",
    evidence: ["dashboard/source.ts:10:// fallback stays explicit"],
    truncated: false,
  };
  const moved = {
    count: 1,
    sha256: "7fb48ff01121e8cdcf24954eacc7d378b5699ad5fce3ffb9347efe49817ebb1c",
    evidence: ["dashboard/source.ts:99:// fallback stays explicit"],
    truncated: false,
  };
  assert.equal(sameMockOrFallbackDeclarations(baseline, moved), true);
  assert.equal(
    sameMockOrFallbackDeclarations(baseline, {
      ...moved,
      evidence: ["dashboard/source.ts:99:// fallback silently changed"],
    }),
    false,
  );
});

test("truncated mock declaration evidence remains hash-strict", () => {
  const baseline = {
    count: 30,
    sha256: "a".repeat(64),
    evidence: Array.from(
      { length: 24 },
      (_, index) => `dashboard/source.ts:${index + 1}:// fallback ${index}`,
    ),
    truncated: true,
  };
  assert.equal(
    sameMockOrFallbackDeclarations(baseline, {
      ...baseline,
      sha256: "b".repeat(64),
      evidence: baseline.evidence.map((value) => value.replace(":1:", ":2:")),
    }),
    false,
  );
});

test("complete mock evidence authenticates its count and line-sensitive hash", () => {
  const valid = {
    count: 1,
    sha256: "188a000cbee83dfbce1610978261738274abda3e3a8182c53a8c4744e9004062",
    evidence: ["dashboard/source.ts:10:// fallback stays explicit"],
    truncated: false,
  };
  assert.equal(mockDeclarationSnapshotIsInternallyConsistent(valid), true);
  assert.equal(
    mockDeclarationSnapshotIsInternallyConsistent({ ...valid, count: 2 }),
    false,
  );
  assert.equal(
    mockDeclarationSnapshotIsInternallyConsistent({ ...valid, sha256: "0".repeat(64) }),
    false,
  );
});

test("contract digest authenticates every independently frozen field", () => {
  const row = Object.fromEntries(FROZEN_CONTRACT_FIELDS.map((field) => [field, null]));
  const original = contractDigest(row);
  row.requiredServiceOrWorker = ["hermes"];
  assert.notEqual(contractDigest(row), original);
});

test("source catalog diagnostics identify the exact catalog and hash", () => {
  assert.equal(
    describeSourceCatalogDrift(
      "nextApiRoutes",
      { count: 518, sha256: "before" },
      { count: 518, sha256: "after" },
    ),
    "source catalog nextApiRoutes drifted (sha256 before -> after)",
  );
});
