import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  contractDigest,
  describeSourceCatalogDrift,
  FROZEN_CONTRACT_FIELDS,
  mockDeclarationSnapshotIsInternallyConsistent,
  preserveHistoricalParityEvidence,
  sameMockOrFallbackDeclarations,
} from "./parity-drift.mjs";
import {
  applyParityContractCorrections,
  correctionDigest,
  PARITY_CONTRACT_CORRECTIONS,
  validateParityContractCorrections,
} from "./parity-contract-corrections.mjs";

const runtimeV2Dir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(runtimeV2Dir, "..", "..");

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

test("temporary-chat correction overlays, but never rewrites, the authenticated frozen row", () => {
  const inventory = JSON.parse(
    fs.readFileSync(path.join(runtimeV2Dir, "feature-parity.json"), "utf8"),
  );
  const frozenRow = inventory.capabilities.find(({ capabilityId }) =>
    capabilityId === "surface:temporary-chat");
  assert.ok(frozenRow, "the frozen inventory must include temporary chat");
  assert.equal(
    frozenRow.followUpContextBehavior,
    "Same conversation preserves exact transcript, selected branch, source and artifact context.",
  );
  assert.equal(
    frozenRow.restartBehavior,
    "Durable conversation/run rows are resumed or terminally reconciled on restart.",
  );
  assert.equal(
    frozenRow.recoveryBehavior,
    "Refresh reconnects by session/run id and bounded event cursor.",
  );
  assert.equal(frozenRow.sourceSha256, "7537c5f028c5c50169b71235c311af389de342138ffd67b6748f17b1ad112d3d");
  assert.equal(frozenRow.baselineContractSha256, "4b5775ca9655015f4465084d27c7ea1d5ba6e769fa4052dccc44047666d1a3a4");
  assert.equal(frozenRow.baselineContractSha256, contractDigest(frozenRow));

  const frozenBefore = JSON.stringify(frozenRow);
  const correction = PARITY_CONTRACT_CORRECTIONS.corrections[0];
  assert.equal(correction.capabilityId, frozenRow.capabilityId);
  assert.equal(correction.oldContract.baselineContractSha256, frozenRow.baselineContractSha256);
  assert.equal(correction.oldContract.sourceSha256, frozenRow.sourceSha256);
  assert.deepEqual(correction.oldContract.sourceRefs, frozenRow.sourceRefs);
  assert.equal(correction.correctionSha256, correctionDigest(correction));

  const effectiveInventory = applyParityContractCorrections(inventory);
  const row = effectiveInventory.capabilities.find(({ capabilityId }) =>
    capabilityId === "surface:temporary-chat");
  assert.match(row.followUpContextBehavior, /live temporary conversation.+real second turn/iu);
  assert.match(row.restartBehavior, /intentionally excluded from history.+restart recovery/iu);
  assert.equal(row.recoveryBehavior, "Not applicable.");
  assert.equal(row.contractCorrection.correctionSha256, correction.correctionSha256);
  assert.equal(row.contractCorrection.frozenBaselineContractSha256, frozenRow.baselineContractSha256);
  assert.equal(JSON.stringify(frozenRow), frozenBefore, "overlay mutated the checked frozen row");

  const authoritativeRefs = [
    "dashboard/src/app/api/hermes/sessions/route.ts:",
    "dashboard/src/app/components/hermes/dashboard-agent-terminal.tsx:",
    "dashboard/src/app/components/hermes/use-agent-session.ts:",
    "dashboard/src/lib/conversations/memory.ts:",
    "dashboard/src/lib/conversations/store.ts:",
    "dashboard/tests/temporary-chat.test.mjs:",
  ];
  for (const prefix of authoritativeRefs) {
    assert.ok(
      row.contractCorrection.authoritativeSourceRefs.some((reference) => reference.startsWith(prefix)),
      `temporary chat correction lacks authoritative source evidence from ${prefix}`,
    );
  }

  const authorityLinePatterns = new Map([
    ["dashboard/src/app/api/hermes/sessions/route.ts:138", /temporary:\s*body\.temporary === true/u],
    ["dashboard/src/app/components/hermes/dashboard-agent-terminal.tsx:1029", /const \[temporaryChat, setTemporaryChat\]/u],
    ["dashboard/src/app/components/hermes/use-agent-session.ts:1262", /temporary chat, which is deliberately not somewhere you can come back/iu],
    ["dashboard/src/lib/conversations/memory.ts:187", /temporary chat keeps its own thread of context/iu],
    ["dashboard/src/lib/conversations/store.ts:272", /temporary = 0/u],
    ["dashboard/tests/temporary-chat.test.mjs:122", /temporary chat keeps its own thread of context/iu],
  ]);
  assert.deepEqual(
    [...row.contractCorrection.authoritativeSourceRefs].sort(),
    [...authorityLinePatterns.keys()].sort(),
  );
  for (const [reference, pattern] of authorityLinePatterns) {
    const match = /^(.*):(\d+)$/u.exec(reference);
    assert.ok(match, `invalid source reference ${reference}`);
    const line = fs.readFileSync(path.join(repoRoot, match[1]), "utf8").split(/\r?\n/u)[Number(match[2]) - 1];
    assert.match(line ?? "", pattern, `${reference} no longer proves the correction`);
  }

  assert.match(
    fs.readFileSync(
      path.join(repoRoot, "dashboard/src/app/components/hermes/use-agent-session.ts"),
      "utf8",
    ),
    /temporary chat, which is deliberately not somewhere you can come back/iu,
  );
  assert.match(
    fs.readFileSync(path.join(repoRoot, "dashboard/src/lib/conversations/store.ts"), "utf8"),
    /WHERE user_id = \? AND temporary = 0/iu,
  );
  assert.match(
    fs.readFileSync(path.join(repoRoot, "dashboard/tests/temporary-chat.test.mjs"), "utf8"),
    /a temporary chat keeps its own thread of context/iu,
  );
});

test("temporary-chat correction fails closed on overlay or frozen-row tampering", () => {
  const catalog = structuredClone(PARITY_CONTRACT_CORRECTIONS);
  catalog.corrections[0].correctedSemantics.recoveryBehavior = "Refresh works after all.";
  assert.throws(
    () => validateParityContractCorrections(catalog),
    /correctionSha256 does not authenticate the overlay/u,
  );

  const inventory = JSON.parse(
    fs.readFileSync(path.join(runtimeV2Dir, "feature-parity.json"), "utf8"),
  );
  inventory.capabilities.find(({ capabilityId }) =>
    capabilityId === "surface:temporary-chat").restartBehavior = "Silently changed frozen promise.";
  assert.throws(
    () => applyParityContractCorrections(inventory),
    /no longer matches the authenticated frozen baseline hash/u,
  );
});

test("diagram-design correction preserves the frozen row and requires its one real HTML artifact", () => {
  const inventory = JSON.parse(
    fs.readFileSync(path.join(runtimeV2Dir, "feature-parity.json"), "utf8"),
  );
  const frozenRow = inventory.capabilities.find(({ capabilityId }) =>
    capabilityId === "skill:first-party:diagram-design");
  assert.deepEqual(frozenRow.artifactTypes, ["diagram", "svg"]);
  assert.equal(frozenRow.sourceSha256, "bc9a812d11734b2a37904bf533fd43ebef8c46b9548f758c4ec8cd53a9c17844");
  assert.equal(frozenRow.baselineContractSha256, "5b3c65da97600a9e5b6490638c6bff2e29667cded6b21ca6d3fe8b0d30949fb0");
  assert.equal(contractDigest(frozenRow), frozenRow.baselineContractSha256);

  const effective = applyParityContractCorrections(inventory).capabilities.find(({ capabilityId }) =>
    capabilityId === frozenRow.capabilityId);
  assert.deepEqual(effective.artifactTypes, ["html"]);
  assert.equal(
    effective.contractCorrection.reasonCode,
    "FROZEN_BASELINE_MISTOOK_INLINE_SVG_FOR_A_SECOND_ARTIFACT",
  );
  assert.equal(
    effective.contractCorrection.correctionSha256,
    "118497a5612862ac136b198449243d139dd2806769b743ec7d9fb811c8dc99cb",
  );
  assert.deepEqual(frozenRow.artifactTypes, ["diagram", "svg"], "overlay rewrote frozen artifact types");

  const skill = fs.readFileSync(
    path.join(repoRoot, "hermes-skills/prebuilt/diagram-design/SKILL.md"),
    "utf8",
  ).split(/\r?\n/u);
  assert.match(skill[19] ?? "", /requiredArtifactKinds:\s*\[html\]/u);
  assert.match(skill[26] ?? "", /single self-contained \.html file/iu);
});

test("typed runtime outputs are corrected separately without erasing frozen artifact claims", () => {
  const inventory = JSON.parse(
    fs.readFileSync(path.join(runtimeV2Dir, "feature-parity.json"), "utf8"),
  );
  const effective = applyParityContractCorrections(inventory);
  const cases = [
    {
      capabilityId: "skill:first-party:resource2skill",
      frozenArtifactTypes: ["markdown", "skill-package"],
      frozenHash: "674bfa7579e3240d523196b233fa1ab5b109e60f08a14f6679c03a6bda43ad49",
      correctionHash: "cd16f3ec98f0419a90b95b1553f0a45afe595397d8574d834372d8504a0943b2",
      authority: [
        ["hermes-skills/prebuilt/resource2skill/SKILL.md:15", /requiredArtifactKinds:\s*\[\]/u],
        ["hermes-skills/prebuilt/resource2skill/SKILL.md:24", /Choose the domain/iu],
        ["hermes-skills/prebuilt/resource2skill/SKILL.md:28", /\/agents:resource2skill/u],
        ["hermes-skills/prebuilt/resource2skill/SKILL.md:30", /run card stream/iu],
        ["hermes-skills/prebuilt/resource2skill/SKILL.md:37", /web.*landing pages/iu],
      ],
    },
    {
      capabilityId: "workflow:research",
      frozenArtifactTypes: ["markdown", "data"],
      frozenHash: "57c5b70e1b8d308ba04c2c6f23d7f044362183fdf58e3276e7c87ee7f7b16570",
      correctionHash: "00bcdd006e3eefd8a9d88d3f7ecbe8ad152f54b97e1cc6f45c59bada7c33aaf3",
      authority: [
        ["dashboard/src/app/api/hermes/tools/research/route.ts:115", /tool === "research_begin"/u],
        ["dashboard/src/app/api/hermes/tools/research/route.ts:144", /tool === "research_record"/u],
        ["dashboard/src/lib/research/types.ts:406", /interface ResearchState/u],
      ],
    },
    {
      capabilityId: "workflow:watch-video",
      frozenArtifactTypes: ["image", "video", "markdown"],
      frozenHash: "485e7793a7589fa5f350c8ba38f9b1662bf610345a4ad06d823313ee9c0d1051",
      correctionHash: "7f7cd2e42eb07035ff40c3da5c988a6882167bf26238e4d65346cd8aad86a3f5",
      authority: [
        ["dashboard/src/lib/hermes/watch-service.ts:61", /interface WatchRunResult/u],
        ["dashboard/src/app/api/hermes/tools/watch/route.ts:105", /ok: true, data: result/u],
      ],
    },
  ];

  for (const audit of cases) {
    const frozenRow = inventory.capabilities.find(({ capabilityId }) => capabilityId === audit.capabilityId);
    const effectiveRow = effective.capabilities.find(({ capabilityId }) => capabilityId === audit.capabilityId);
    assert.deepEqual(frozenRow.artifactTypes, audit.frozenArtifactTypes, `${audit.capabilityId} frozen row changed`);
    assert.equal(frozenRow.baselineContractSha256, audit.frozenHash);
    assert.equal(contractDigest(frozenRow), audit.frozenHash);
    assert.deepEqual(effectiveRow.artifactTypes, []);
    assert.equal(effectiveRow.contractCorrection.correctionSha256, audit.correctionHash);
    assert.deepEqual(
      effectiveRow.contractCorrection.authoritativeSourceRefs,
      audit.authority.map(([reference]) => reference),
    );
    for (const [reference, pattern] of audit.authority) {
      const match = /^(.*):(\d+)$/u.exec(reference);
      assert.ok(match);
      const line = fs.readFileSync(path.join(repoRoot, match[1]), "utf8").split(/\r?\n/u)[Number(match[2]) - 1];
      assert.match(line ?? "", pattern, `${reference} no longer proves ${audit.capabilityId}`);
    }
  }
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

test("source-contract reconciliation preserves the independent pre/post evidence ledger", () => {
  const previous = {
    capabilities: [
      {
        capabilityId: "runtime-agent:example",
        runtimePath: "legacy path",
        preMigrationStatus: "SOURCE_PRESENT",
        preMigrationEvidence: ["legacy.ts:10"],
        postMigrationStatus: "PASS",
        postMigrationEvidence: ["receipt.json"],
        selectionEvidence: {
          preMigration: ["legacy.ts:10"],
          postMigration: ["electron.json"],
        },
        serviceWorkerEvidence: { preMigration: ["legacy.ts:20"], postMigration: ["worker.json"] },
        outputArtifactEvidence: { preMigration: ["legacy.ts:30"], postMigration: ["artifact.json"] },
        cancellationEvidence: { preMigration: ["legacy.ts:40"], postMigration: ["cancel.json"] },
        recoveryEvidence: { preMigration: ["legacy.ts:50"], postMigration: ["restart.json"] },
        result: "PASS",
      },
    ],
  };
  const current = {
    capabilities: [
      {
        capabilityId: "runtime-agent:example",
        runtimePath: "Runtime V2 path",
        preMigrationStatus: "SOURCE_PRESENT",
        preMigrationEvidence: ["runtime.ts:100"],
        postMigrationStatus: "NOT RUN",
        postMigrationEvidence: [],
        selectionEvidence: { preMigration: ["runtime.ts:100"], postMigration: [] },
        serviceWorkerEvidence: { preMigration: ["runtime.ts:100"], postMigration: [] },
        outputArtifactEvidence: { preMigration: ["runtime.ts:100"], postMigration: [] },
        cancellationEvidence: { preMigration: ["runtime.ts:100"], postMigration: [] },
        recoveryEvidence: { preMigration: ["runtime.ts:100"], postMigration: [] },
        result: "NOT RUN",
      },
      {
        capabilityId: "runtime-agent:new",
        runtimePath: "new path",
        preMigrationEvidence: ["new.ts:1"],
      },
    ],
  };

  const reconciled = preserveHistoricalParityEvidence(current, previous);
  const existing = reconciled.capabilities[0];
  assert.equal(existing.runtimePath, "Runtime V2 path");
  assert.deepEqual(existing.preMigrationEvidence, ["legacy.ts:10"]);
  assert.deepEqual(existing.postMigrationEvidence, ["receipt.json"]);
  assert.equal(existing.postMigrationStatus, "PASS");
  assert.equal(existing.result, "PASS");
  assert.deepEqual(existing.selectionEvidence.postMigration, ["electron.json"]);
  assert.deepEqual(reconciled.capabilities[1], current.capabilities[1]);
});
