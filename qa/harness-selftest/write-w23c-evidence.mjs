#!/usr/bin/env node

/** W2-3C: write the per-cluster adjudication evidence files. */

import * as fs from "node:fs";
import * as path from "node:path";
import { captureExecutionSnapshot, executionIdentity } from "../autonomous/lib/execution-snapshot.mjs";

const dir = path.resolve(process.argv[2] ?? "");
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const write = (name, value) =>
  fs.writeFileSync(path.join(dir, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");

const snapshot = captureExecutionSnapshot({ repoRoot: ".", label: "w2-3c-resolution" });
write("execution-snapshot.json", {
  ...executionIdentity(snapshot),
  frozenAt: snapshot.frozenAt,
  checkoutPolicy: snapshot.environment.checkoutPolicy,
  ignoredRootCount: snapshot.environment.ignoredRootCount,
});
console.log(
  `executionSnapshotId: ${snapshot.executionSnapshotId.slice(0, 16)} | checkout: ${snapshot.environment.checkoutPolicy.qaReconstructionPolicy}`,
);

write("root7-file-resolution.json", {
  generatedAt: new Date().toISOString(),
  finding:
    "ROOT-7 was not a product file-resolution defect. It was a residual bucket created by the review tooling failing to resolve which file each assertion targeted.",
  evidence: [
    "improving asserted-file resolution moved 33 rows out of the bucket during W2-3",
    "the live-versus-reconstruction partition then split the remainder: 12 reproduce in the developer's tree and are genuine contract questions, 5 do not",
  ],
  productPathResolutionDefects: 0,
  conclusion:
    "No product path-resolution defect was found. The 12 genuine failures were reassigned to contract families; the other 5 joined ROOT-8.",
  residualRisk:
    "Path-resolution semantics under junctions were not exercised at Electron runtime. That belongs to the lifecycle phase, not to a dashboard source-assertion review.",
});

write("root6-adjudication.json", {
  generatedAt: new Date().toISOString(),
  rootCauseId: "ROOT-6-WIRING-RELOCATED",
  tests: 3,
  allReproduceInLiveTree: true,
  finding:
    "All three reproduce in the developer's tree, so they are genuine contract questions rather than environment artefacts.",
  perTest: [
    {
      test: "assistant-message-ui :: completed response duration remains attached to restored messages",
      asserted: "presented.metadata.responseDurationMs",
      observation: "the identifier exists elsewhere in dashboard/src; the asserted module no longer contains it",
      contractA: "the duration must remain on the presented message metadata for restored transcripts",
      evidenceForA: "the test name states a user-visible property: a restored message still shows how long it took",
      contractB: "presentation moved and the metadata is carried elsewhere",
      evidenceForB: "the identifier resolves in another module",
      missingEvidence: "which module the renderer actually reads at runtime",
      classification: "UNRESOLVED_CONTRACT",
      confidence: "MEDIUM",
      humanDecisionNeeded: false,
    },
    {
      test: "learn-utils :: learn pipeline uses ChatMock Council task types",
      asserted: "debugFailedSubsectionDraft",
      observation: "present in exactly one file in the repository",
      contractA: "the Learn pipeline must register this Council task type",
      evidenceForA: "the assertion names a task type, which is a registry contract rather than a formatting detail",
      contractB: "the task type was renamed or moved deliberately",
      evidenceForB: "only a single occurrence remains",
      missingEvidence: "the Council task-type registry definition",
      classification: "UNRESOLVED_CONTRACT",
      confidence: "MEDIUM",
      humanDecisionNeeded: false,
    },
    {
      test: "openplanter-integration :: renders graph, trail, output and final-result widgets inline",
      asserted: "bb-agent-run-inset",
      observation: "the class exists in 18 files, so it is a shared visual utility this module stopped using",
      contractA: "OpenPlanter must use the shared inset material",
      evidenceForA: "a sibling assertion in the same suite requires the shared neumorphic run-card system",
      contractB: "the widget legitimately moved to a different shared class",
      evidenceForB: "the class is widely used elsewhere, so its absence here is local rather than a removal",
      missingEvidence: "whether the rendered result is visually equivalent",
      classification: "UNRESOLVED_CONTRACT",
      confidence: "MEDIUM",
      humanDecisionNeeded: false,
    },
  ],
  note: "Investigated rather than left LOW: each carries competing contracts, evidence for each, and the specific missing evidence.",
});

write("root5-adjudication.json", {
  generatedAt: new Date().toISOString(),
  rootCauseId: "ROOT-5-FIGURECOUNT-VARIABLE-RENAME",
  familyMembers: 1,
  familyCheck:
    "The vlm-ocr-figures test carries three assertions; the other two still pass, including the exact-occurrence count of saveFigure: vlmFigureSaver. The family is therefore this single assertion.",
  classification: "STALE_TEST",
  contractType: "IMPLEMENTATION_COUPLING",
  confidence: "HIGH",
  correctionApplied: false,
  whyNotApplied:
    "ROOT-4B-UI_SHAPE (18 tests) poses the same question of how to express a source-shape invariant behaviourally. Applying one replacement now would set the precedent before that family is adjudicated.",
  plannedReplacement:
    "Assert that figureCount is derived from vlm.figureCount and reaches the persisted payload, rather than pinning the identifier vlmFigureCount.",
  nonVacuityPlan: "Temporarily break the derivation so figureCount stays 0 and prove the replacement fails.",
});

write("learner-action-decision.json", {
  generatedAt: new Date().toISOString(),
  rootCauseId: "ROOT-2-VISUAL-CONTRACT-LEARNERACTION",
  tests: 2,
  currentBehavior:
    "buildVisualizationPlan throws: contract validation failed, U1 missing model-authored learnerAction; no validated model-authored learner control contract is present.",
  testExpectation: "A visualization plan builds for the fixture unit and reaches implementation dispatch.",
  callSiteSemantics: "The validator gates what reaches implementation dispatch, so it is a policy boundary.",
  userVisibleImpact:
    "If the validator is right, a generated visual without a model-authored learner control is refused. If the test is right, valid visuals are being refused.",
  historyEvidence: "None found establishing when learnerAction became mandatory.",
  contractA: "learnerAction became mandatory deliberately and the fixture is stale.",
  evidenceForA:
    "The validator names the missing field precisely and refuses rather than defaulting, which reads as a deliberate tightening.",
  contractB: "The validator over-rejects; a unit acquiring an interactive intent after routing should not need the action up front.",
  evidenceForB:
    "One of the two failing tests is specifically about acquiring intent *after* routing, which points at ordering rather than absence.",
  missingEvidence:
    "The change that introduced the requirement, and whether any currently passing fixture supplies learnerAction.",
  whyNotResolvableAutomatically:
    "Both readings are internally consistent. Choosing would require knowing intent, and guessing would either suppress a real gate or invalidate correct fixtures.",
  riskOfA: "If A is wrong, valid generated visuals are silently refused.",
  riskOfB: "If B is wrong, unvalidated model output reaches implementation dispatch.",
  week2Blocking: false,
  humanDecisionNeeded: true,
  confidence: "MEDIUM",
});

write("test-corrections.json", {
  generatedAt: new Date().toISOString(),
  harnessRepairs: [
    {
      file: "qa/autonomous/lib/repair-worktree.mjs",
      change: "checkout policy passed per command via -c core.autocrlf=false; an earlier git config write was removed",
      classification: "HARNESS_BUG",
      nonVacuityProof:
        "A sandbox test sets core.autocrlf=true, reconstructs, and asserts 0 CRLF plus a matching bare-newline pattern; a second test asserts the repository config is unchanged after create and remove.",
      assertionsWeakened: 0,
    },
    {
      file: "qa/autonomous/lib/source-snapshot.mjs",
      change: "git apply also runs with core.autocrlf=false so patching cannot reintroduce CRLF",
      classification: "HARNESS_BUG",
      nonVacuityProof: "covered by the same reconstruction byte assertion",
      assertionsWeakened: 0,
    },
    {
      file: "qa/autonomous/lib/execution-snapshot.mjs",
      change: "checkout policy recorded in environment identity and compared by compareEnvironments",
      classification: "HARNESS_BUG",
      nonVacuityProof: "a test mutates the policy and asserts compareEnvironments reports a checkout difference",
      assertionsWeakened: 0,
    },
  ],
  productRepairs: [],
  testCorrections: [],
  fixtureRepairs: [],
  incidentFoundAndFixed: {
    issue:
      "An earlier revision of the checkout fix wrote core.autocrlf=false with `git config` inside the worktree. A worktree shares the repository config file, so this changed the developer's own setting from true to false.",
    detectedBy: "captureCheckoutPolicy reporting repositoryAutocrlf=false when it had been true",
    remediation:
      "The setting was restored to true, the implementation now passes -c per command and never writes config, and a regression test asserts the repository config is untouched by create and remove.",
    userImpact: "None persisted; the setting was restored in the same pass that introduced it.",
  },
});

write("product-findings.json", {
  generatedAt: new Date().toISOString(),
  productBugs: [],
  note:
    "No eligible failure reached PRODUCT_BUG. Sixteen of the original sixty-two are resolved as harness, fixture or stale-test; the remainder are characterised contract questions or environment-unattributed.",
});

write("dashboard-final-results.json", {
  generatedAt: new Date().toISOString(),
  liveTreeRun: { tests: 5124, pass: 5048, fail: 55, skipped: 21 },
  reconstructionRun: { tests: 5089, failing: 60, eligible: 57, environmentBlocked: 3 },
  partition: { genuineContractFailures: 44, notReproducedInLiveTree: 13 },
  resolvedAcrossSequence: { harnessBug: 10, fixtureBug: 5, staleTest: 1 },
  remainingUnresolvedContract: 38,
  caveat:
    "The live and reconstruction runs used different source because the developer edits continuously. Counts are context; the per-identity partition is the evidence.",
});

console.log("evidence files written");
