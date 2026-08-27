import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  assertCompletePackagedParityOutcomes,
  assertNoPackagedParityAcceptanceGaps,
  assertPublishableBlockedOutcome,
  buildPackagedParityPlan,
  packagedParityAcceptanceGaps,
  PACKAGED_PARITY_RUNTIME_ALIASES,
} from "./packaged-parity-plan.mjs";

const electronDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(electronDir, "..", "..");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), "utf8"));
}

const inventory = readJson("qa/runtime-v2/feature-parity.json");
const serviceManifest = readJson("desktop/runtime-v2/manifests/services.json");
const workerManifest = readJson("desktop/runtime-v2/manifests/workers.json");

const EXPECTED_CATEGORY_COUNTS = Object.freeze({
  "agency-persona": 264,
  approval: 8,
  "artifact-type": 16,
  attachment: 6,
  "chat-surface": 5,
  connection: 11,
  "connection-catalog": 3,
  "default-prompt": 10,
  "first-party-persona": 2,
  "first-party-skill": 26,
  "installed-reviewed-skill": 3,
  "model-selection": 6,
  profile: 1,
  provider: 13,
  recovery: 10,
  registry: 9,
  repository: 2,
  "runtime-agent": 37,
  "tool-family": 40,
  workflow: 24,
});

const EXPECTED_DRIVER_BY_CATEGORY = Object.freeze({
  "agency-persona": "slash",
  approval: "approval",
  "artifact-type": "artifact",
  attachment: "attachment",
  "chat-surface": "surface",
  connection: "connection",
  "connection-catalog": "connection-catalog",
  "default-prompt": "slash",
  "first-party-persona": "slash",
  "first-party-skill": "slash",
  "installed-reviewed-skill": "slash",
  "model-selection": "model",
  profile: "profile",
  provider: "provider",
  recovery: "recovery",
  registry: "registry",
  repository: "repository",
  "runtime-agent": "slash",
  "tool-family": "tool",
  workflow: "workflow",
});

function build(overrides = {}) {
  return buildPackagedParityPlan({ inventory, serviceManifest, workerManifest, ...overrides });
}

test("packaged parity plan covers the exact frozen 496-capability inventory once", () => {
  const plans = build();
  const expectedIds = inventory.capabilities.map(({ capabilityId }) => capabilityId).sort();
  const actualIds = plans.map(({ capabilityId }) => capabilityId);

  assert.equal(inventory.capabilityCount, 496);
  assert.equal(plans.length, 496);
  assert.equal(new Set(actualIds).size, 496);
  assert.deepEqual(actualIds, expectedIds);
  assert.equal(Object.isFrozen(plans), true);
  assert.equal(plans.every(Object.isFrozen), true);
});

test("every frozen category has one explicit driver partition", () => {
  const plans = build();
  const counts = Object.fromEntries(Object.keys(EXPECTED_CATEGORY_COUNTS).map((category) => [category, 0]));

  for (const plan of plans) {
    assert.equal(
      plan.driver.kind,
      EXPECTED_DRIVER_BY_CATEGORY[plan.category],
      `${plan.capabilityId} has the wrong UI driver`,
    );
    counts[plan.category] += 1;
    if (plan.driver.kind === "slash") {
      const row = inventory.capabilities.find(({ capabilityId }) => capabilityId === plan.capabilityId);
      assert.equal(plan.driver.slashCommand, row.slashCommand);
      assert.match(plan.driver.slashCommand, /^\//u);
    } else {
      assert.equal(Object.hasOwn(plan.driver, "slashCommand"), false);
    }
  }

  assert.deepEqual(counts, EXPECTED_CATEGORY_COUNTS);
  assert.deepEqual(inventory.countsByCategory, EXPECTED_CATEGORY_COUNTS);
  assert.equal(
    plans.filter(({ driver }) => driver.kind === "slash").length,
    342,
    "slash selection coverage drifted",
  );
});

test("surface and attachment smoke outputs are not invented artifact renderer requirements", () => {
  const plans = build();
  for (const plan of plans.filter(({ category }) => category === "chat-surface")) {
    assert.equal(plan.output.expectedType, "streamed-chat-message", plan.capabilityId);
    assert.equal(plan.output.requiresOpenArtifact, false, plan.capabilityId);
  }
  for (const plan of plans.filter(({ category }) => category === "attachment")) {
    assert.equal(plan.output.expectedType, "durable-message-attachment", plan.capabilityId);
    assert.equal(plan.output.requiresOpenArtifact, false, plan.capabilityId);
  }
  for (const plan of plans.filter(({ category }) => category === "artifact-type")) {
    assert.equal(plan.output.requiresOpenArtifact, true, plan.capabilityId);
  }
  const diagramDesign = plans.find(({ capabilityId }) =>
    capabilityId === "skill:first-party:diagram-design");
  assert.deepEqual(diagramDesign.output.requiredArtifactTypes, ["html"]);
  assert.equal(diagramDesign.output.expectedType, "html");
  assert.equal(
    diagramDesign.contractCorrection.reasonCode,
    "FROZEN_BASELINE_MISTOOK_INLINE_SVG_FOR_A_SECOND_ARTIFACT",
  );
  const outputFamilyCounts = Object.fromEntries(
    [...new Set(plans.map(({ output }) => output.contractKind))]
      .sort()
      .map((kind) => [kind, plans.filter(({ output }) => output.contractKind === kind).length]),
  );
  assert.deepEqual(outputFamilyCounts, {
    ARTIFACT_KIND_MATRIX: 2,
    LIFECYCLE_SEQUENCE: 4,
    RENDERER_MATRIX: 3,
    ROUTE_RESULT_FIELDS: 5,
    RUNTIME_EVENT_FACETS: 22,
    SINGLE_OUTPUT: 460,
  });
  assert.equal(
    plans.filter(({ output }) => output.driverKind === null).length,
    36,
    "every non-literal output family must remain fail-closed until its dedicated driver exists",
  );
  const resource2skill = plans.find(({ capabilityId }) =>
    capabilityId === "skill:first-party:resource2skill");
  assert.deepEqual(resource2skill.output.requiredArtifactTypes, []);
  assert.deepEqual(resource2skill.output.requiredOutputIdentities, [
    "web domain outputs",
    "presentation domain outputs",
    "spreadsheet domain outputs",
    "scene domain outputs",
    "audio domain outputs",
  ]);
  const research = plans.find(({ capabilityId }) => capabilityId === "workflow:research");
  assert.deepEqual(research.output.requiredArtifactTypes, []);
  assert.deepEqual(research.output.requiredOutputIdentities, [
    "research_begin state",
    "research_record evidence conflicts and gaps",
    "research_status coverage and stop reason",
    "final cited chat synthesis",
  ]);
  const watch = plans.find(({ capabilityId }) => capabilityId === "workflow:watch-video");
  assert.deepEqual(watch.output.requiredArtifactTypes, []);
  assert.deepEqual(watch.output.requiredOutputIdentities.slice(0, 3), [
    "report",
    "framePaths",
    "analyzedFrameCount",
  ]);
});

test("planner requires real follow-up turns and honors temporary chat's intentional non-durable contract", () => {
  const plans = build();
  const temporary = plans.find(({ capabilityId }) => capabilityId === "surface:temporary-chat");
  assert.ok(temporary);
  assert.equal(temporary.followUp.supported, true);
  assert.match(temporary.followUp.contract, /real second turn/iu);
  assert.equal(temporary.recovery.supported, false);
  assert.equal(temporary.recovery.scenarioKind, "NOT_APPLICABLE");
  assert.equal(temporary.recovery.driverKind, null);
  assert.equal(temporary.recovery.selectionIdentity, null);
  assert.equal(temporary.recovery.contract, "Not applicable.");
  assert.deepEqual(temporary.contractCorrection, {
    reasonCode: "FROZEN_BASELINE_OVERGENERALIZED_TEMPORARY_CHAT_DURABILITY",
    correctionSha256: "302d69cfa4676cc215b90dc23e0d919887d79b9723ed0f4987660c6418c114dc",
    frozenBaselineContractSha256: "4b5775ca9655015f4465084d27c7ea1d5ba6e769fa4052dccc44047666d1a3a4",
    authoritativeSourceRefs: [
      "dashboard/src/app/api/hermes/sessions/route.ts:138",
      "dashboard/src/app/components/hermes/dashboard-agent-terminal.tsx:1029",
      "dashboard/src/app/components/hermes/use-agent-session.ts:1262",
      "dashboard/src/lib/conversations/memory.ts:187",
      "dashboard/src/lib/conversations/store.ts:272",
      "dashboard/tests/temporary-chat.test.mjs:122",
    ],
  });
  assert.deepEqual(temporary.recovery.notApplicable, {
    reasonCode: "INTENTIONAL_NON_DURABLE_TEMPORARY_CHAT",
    sourceProvenPreMigrationSemantics: true,
    evidence: [
      "dashboard/src/app/components/hermes/use-agent-session.ts:1262",
      "dashboard/src/lib/conversations/store.ts:272",
      "dashboard/tests/temporary-chat.test.mjs:122",
    ],
  });

  const inventoryWithoutFollowUp = structuredClone(inventory);
  const profile = inventoryWithoutFollowUp.capabilities.find(({ category }) => category === "profile");
  profile.followUpContextBehavior = "Not applicable.";
  const plannedProfile = build({ inventory: inventoryWithoutFollowUp })
    .find(({ capabilityId }) => capabilityId === profile.capabilityId);
  assert.equal(plannedProfile.followUp.supported, false);

  const inventedRecoveryNarrowing = structuredClone(inventory);
  inventedRecoveryNarrowing.capabilities.find(({ category }) => category === "profile").recoveryBehavior = "Not applicable.";
  assert.throws(
    () => build({ inventory: inventedRecoveryNarrowing }),
    /declares recovery Not applicable without a reviewed source-backed authority/u,
  );
});

test("persona, model, and conversation-run recovery rows have exact real-workflow driver identities", () => {
  const plans = build();
  const sourceSelections = plans.filter(({ recovery }) =>
    recovery.scenarioKind === "SOURCE_SELECTION_FAIL_CLOSED");
  assert.equal(sourceSelections.length, 266);
  assert.equal(sourceSelections.filter(({ category }) => category === "agency-persona").length, 264);
  assert.equal(sourceSelections.filter(({ category }) => category === "first-party-persona").length, 2);
  for (const plan of sourceSelections) {
    assert.equal(plan.recovery.driverKind, "SOURCE_SELECTION_FAIL_CLOSED");
    const prefix = plan.category === "agency-persona" ? "/agents:agency-agents:" : "/agent:";
    assert.equal(plan.recovery.selectionIdentity, plan.driver.slashCommand.slice(prefix.length));
  }

  const storedSelections = plans.filter(({ recovery }) =>
    recovery.scenarioKind === "STORED_SELECTION_RESTART");
  assert.equal(storedSelections.length, 6);
  for (const plan of storedSelections) {
    assert.equal(plan.recovery.driverKind, "STORED_SELECTION_APP_RESTART");
    assert.equal(plan.recovery.selectionIdentity, plan.capabilityId.slice("model:".length));
  }

  const conversationRuns = plans.filter(({ recovery }) =>
    recovery.scenarioKind === "CONVERSATION_RUN_RECONCILIATION");
  assert.equal(conversationRuns.length, 39);
  assert.deepEqual(
    Object.fromEntries([...new Set(conversationRuns.map(({ category }) => category))]
      .sort()
      .map((category) => [category, conversationRuns.filter((plan) => plan.category === category).length])),
    { "default-prompt": 10, "first-party-skill": 26, "installed-reviewed-skill": 3 },
  );
  for (const plan of conversationRuns) {
    assert.equal(plan.recovery.driverKind, null, `${plan.capabilityId} must remain closed until its executor is complete`);
    assert.equal(plan.recovery.selectionIdentity, plan.driver.slashCommand.slice(1));
    assert.equal(plan.capabilityId.endsWith(`:${plan.recovery.selectionIdentity}`), true);
  }

  const malformedPersona = structuredClone(inventory);
  malformedPersona.capabilities.find(({ category }) => category === "agency-persona").slashCommand =
    "/agents:agency-agents:UPPERCASE-NOT-A-SLUG";
  assert.throws(
    () => build({ inventory: malformedPersona }),
    /source-selection recovery has an invalid persona identity/u,
  );

  const malformedModel = structuredClone(inventory);
  const malformedModelRow = malformedModel.capabilities.find(({ category }) => category === "model-selection");
  malformedModelRow.capabilityId = "selection:not-a-model";
  malformedModelRow.requiredServiceOrWorker = [];
  assert.throws(
    () => build({ inventory: malformedModel }),
    /stored-selection recovery lacks a canonical model capability ID/u,
  );

  const mismatchedConversationRun = structuredClone(inventory);
  mismatchedConversationRun.capabilities.find(({ category }) => category === "default-prompt").slashCommand =
    "/another-frozen-prompt";
  assert.throws(
    () => build({ inventory: mismatchedConversationRun }),
    /conversation-run recovery slash selection does not match its frozen capability identity/u,
  );
});

test("known missing UI and broad registry or multi-artifact drivers fail before Electron can mint PASS", () => {
  const plans = build();
  const gaps = packagedParityAcceptanceGaps(plans);
  const counts = Object.fromEntries(
    [...new Set(gaps.map(({ code }) => code))]
      .sort()
      .map((code) => [code, gaps.filter((gap) => gap.code === code).length]),
  );
  assert.deepEqual(counts, {
    OUTPUT_ARTIFACT_KIND_MATRIX_DRIVER_INCOMPLETE: 2,
    OUTPUT_LIFECYCLE_SEQUENCE_DRIVER_INCOMPLETE: 4,
    OUTPUT_RENDERER_MATRIX_DRIVER_INCOMPLETE: 3,
    OUTPUT_ROUTE_RESULT_FIELDS_DRIVER_INCOMPLETE: 5,
    OUTPUT_RUNTIME_EVENT_FACETS_DRIVER_INCOMPLETE: 22,
    RECOVERY_ATOMIC_ARTIFACT_ROLLBACK_DRIVER_INCOMPLETE: 16,
    RECOVERY_ATOMIC_STATE_ROLLBACK_DRIVER_INCOMPLETE: 5,
    RECOVERY_BLOB_INTEGRITY_DRIVER_INCOMPLETE: 6,
    RECOVERY_CAPABILITY_SPECIFIC_STATE_DRIVER_INCOMPLETE: 7,
    RECOVERY_CONVERSATION_RUN_RECONCILIATION_DRIVER_INCOMPLETE: 39,
    RECOVERY_DEPENDENCY_FAILURE_NO_FALLBACK_DRIVER_INCOMPLETE: 46,
    RECOVERY_DURABLE_APPROVAL_STATE_DRIVER_INCOMPLETE: 8,
    RECOVERY_DURABLE_JOB_RECONCILIATION_DRIVER_INCOMPLETE: 17,
    RECOVERY_DURABLE_RUN_IDENTITY_DRIVER_INCOMPLETE: 37,
    RECOVERY_EXTERNAL_DEPENDENCY_NO_FALLBACK_DRIVER_INCOMPLETE: 27,
    RECOVERY_INTENTIONAL_EPHEMERAL_LOSS_DRIVER_INCOMPLETE: 2,
    RECOVERY_REGISTRY_INTEGRITY_DRIVER_INCOMPLETE: 9,
    REGISTRY_BEHAVIOR_DRIVER_INCOMPLETE: 9,
    VISIBLE_UI_ENTRY_POINT_MISSING: 1,
  });
  assert.ok(gaps.some(({ capabilityId, code }) =>
    capabilityId === "surface:quartz-ai" && code === "VISIBLE_UI_ENTRY_POINT_MISSING"));
  assert.ok(gaps.some(({ capabilityId, code }) =>
    capabilityId === "registry:artifact-renderers" && code === "REGISTRY_BEHAVIOR_DRIVER_INCOMPLETE"));
  assert.ok(gaps.some(({ capabilityId, code }) =>
    capabilityId === "workflow:document-editing" && code === "OUTPUT_ARTIFACT_KIND_MATRIX_DRIVER_INCOMPLETE"));
  assert.throws(
    () => assertNoPackagedParityAcceptanceGaps(plans),
    /265 explicit acceptance gap\(s\); no Electron run or PASS receipt is authorized/u,
  );
});

test("service and worker expectations come only from manifest IDs or finite frozen aliases", () => {
  for (const plan of build()) {
    const expectedServices = serviceManifest.services
      .filter(({ capabilityIds }) => capabilityIds.includes(plan.capabilityId))
      .map(({ id, requirement, startupPolicy }) => ({
        serviceId: id,
        requirement,
        startupPolicy,
        associationAuthority: "manifest-capability-id",
      }));
    for (const serviceId of PACKAGED_PARITY_RUNTIME_ALIASES.services[plan.capabilityId] ?? []) {
      if (expectedServices.some((service) => service.serviceId === serviceId)) continue;
      const { requirement, startupPolicy } = serviceManifest.services.find(({ id }) => id === serviceId);
      expectedServices.push({ serviceId, requirement, startupPolicy, associationAuthority: "explicit-frozen-alias" });
    }
    const expectedWorkers = workerManifest.workers
      .filter(({ capabilityIds }) => capabilityIds.includes(plan.capabilityId))
      .map(({ kind, jobTypes, gracefulCancellationMs }) => ({
        workerKind: kind,
        jobTypes,
        gracefulCancellationMs,
        associationAuthority: "manifest-capability-id",
      }));
    for (const workerKind of PACKAGED_PARITY_RUNTIME_ALIASES.workers[plan.capabilityId] ?? []) {
      if (expectedWorkers.some((worker) => worker.workerKind === workerKind)) continue;
      const { jobTypes, gracefulCancellationMs } = workerManifest.workers.find(({ kind }) => kind === workerKind);
      expectedWorkers.push({ workerKind, jobTypes, gracefulCancellationMs, associationAuthority: "explicit-frozen-alias" });
    }

    assert.deepEqual(plan.services, expectedServices, `${plan.capabilityId} has an unauthorised service association`);
    assert.deepEqual(plan.workers, expectedWorkers, `${plan.capabilityId} has an unauthorised worker association`);
  }
});

test("the complete plan anchors every mandatory service and every row-mapped worker without fuzzy matching", () => {
  const plans = build();
  assert.deepEqual(
    [...new Set(plans.flatMap(({ services }) => services.map(({ serviceId }) => serviceId)))].sort(),
    serviceManifest.services.map(({ id }) => id).sort(),
  );
  const inventoryIds = new Set(inventory.capabilities.map(({ capabilityId }) => capabilityId));
  const requiredWorkerKinds = workerManifest.workers
    .filter(({ capabilityIds }) => capabilityIds.some((capabilityId) => inventoryIds.has(capabilityId)))
    .map(({ kind }) => kind);
  requiredWorkerKinds.push(...Object.values(PACKAGED_PARITY_RUNTIME_ALIASES.workers).flat());
  assert.deepEqual(
    [...new Set(plans.flatMap(({ workers }) => workers.map(({ workerKind }) => workerKind)))].sort(),
    [...new Set(requiredWorkerKinds)].sort(),
  );
  for (const plan of plans) {
    const row = inventory.capabilities.find(({ capabilityId }) => capabilityId === plan.capabilityId);
    assert.deepEqual(plan.declaredRuntimeRequirements, row.requiredServiceOrWorker);
  }
});

test("planner rejects malformed inventories, duplicate IDs, unknown categories, and undeclared slash drivers", () => {
  assert.throws(
    () => build({ inventory: { ...inventory, schemaVersion: 1 } }),
    /must be schema version 2/u,
  );
  assert.throws(
    () => build({ inventory: { ...inventory, capabilityCount: 495 } }),
    /capabilityCount does not match/u,
  );

  const duplicate = structuredClone(inventory);
  duplicate.capabilities[1].capabilityId = duplicate.capabilities[0].capabilityId;
  assert.throws(() => build({ inventory: duplicate }), /duplicates/u);

  const unknownCategory = structuredClone(inventory);
  const profile = unknownCategory.capabilities.find(({ category }) => category === "profile");
  profile.category = "new-unreviewed-category";
  assert.throws(() => build({ inventory: unknownCategory }), /unsupported category new-unreviewed-category/u);

  const undeclaredSlash = structuredClone(inventory);
  const nonSlash = undeclaredSlash.capabilities.find(({ category }) => category === "profile");
  nonSlash.slashCommand = "/silently-promoted";
  assert.throws(() => build({ inventory: undeclaredSlash }), /unexpected slashCommand/u);

  assert.throws(
    () => build({ serviceManifest: { version: 4, services: [{ ...serviceManifest.services[0], capabilityIds: [""] }] } }),
    /capabilityIds must be an array of non-empty strings/u,
  );
  assert.throws(
    () => build({ workerManifest: { version: 2, workers: [{ ...workerManifest.workers[0], jobTypes: "learn" }] } }),
    /jobTypes must be an array/u,
  );
});

test("outcome coverage rejects missing, duplicate, unexpected, and unlabelled rows", () => {
  const plans = build().slice(0, 3);
  const complete = plans.map(({ capabilityId }) => ({ capabilityId }));
  assert.equal(assertCompletePackagedParityOutcomes(plans, complete), true);

  assert.throws(
    () => assertCompletePackagedParityOutcomes(plans, complete.slice(1)),
    /coverage differs \(missing=/u,
  );
  assert.throws(
    () => assertCompletePackagedParityOutcomes(plans, [complete[0], complete[0], complete[2]]),
    /missing or duplicate capabilityId/u,
  );
  assert.throws(
    () => assertCompletePackagedParityOutcomes(plans, [complete[0], complete[1], { capabilityId: "unexpected:row" }]),
    /coverage differs .*unexpected=unexpected:row/u,
  );
  assert.throws(
    () => assertCompletePackagedParityOutcomes(plans, [complete[0], complete[1], {}]),
    /missing or duplicate capabilityId/u,
  );
});

test("BLOCKED publication requires an exact frozen blocker and authenticated installed-Electron baseline", () => {
  const operationalPlan = build().find(({ prerequisites }) => prerequisites.length > 0);
  assert.ok(operationalPlan, "the frozen inventory must retain prerequisite-bearing coverage");
  const exact = operationalPlan.prerequisites[0];
  const baseOutcome = {
    capabilityId: operationalPlan.capabilityId,
    result: "BLOCKED",
    blocker: {
      prerequisiteType: exact.prerequisiteType,
      prerequisiteId: exact.prerequisiteId,
    },
    baselineBlockerAuthority: "authenticated-installed-electron",
  };

  assert.throws(
    () => assertPublishableBlockedOutcome(operationalPlan, baseOutcome),
    /missing baseline evidence, not a publishable BLOCKED result/u,
  );

  const historicallyBlockedPlan = {
    ...operationalPlan,
    baseline: { status: "BLOCKED", evidence: ["authenticated historical receipt"] },
  };
  assert.throws(
    () => assertPublishableBlockedOutcome(historicallyBlockedPlan, {
      ...baseOutcome,
      blocker: { ...baseOutcome.blocker, prerequisiteId: `${exact.prerequisiteId}-different` },
    }),
    /not an exact frozen prerequisite/u,
  );
  assert.throws(
    () => assertPublishableBlockedOutcome(historicallyBlockedPlan, {
      ...baseOutcome,
      baselineBlockerAuthority: "source-inventory-only",
    }),
    /lacks authenticated pre-migration installed-Electron blocker authority/u,
  );
  assert.throws(
    () => assertPublishableBlockedOutcome(historicallyBlockedPlan, { ...baseOutcome, result: "PASS" }),
    /non-BLOCKED result/u,
  );
  assert.deepEqual(assertPublishableBlockedOutcome(historicallyBlockedPlan, baseOutcome), exact);
});
