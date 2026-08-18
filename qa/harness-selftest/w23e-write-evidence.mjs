#!/usr/bin/env node

/**
 * W2-3E Phases 12–18 and 21: classifications, the product finding, the flip
 * prediction, and the updated contract map.
 *
 * Run from the repository root with the run directory as the first argument.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const runDir = process.argv[2];
if (!runDir) throw new Error("usage: w23e-write-evidence.mjs <run-dir>");
const at = (name) => path.join(runDir, name);
const readJson = (name) => JSON.parse(fs.readFileSync(at(name), "utf8"));
const write = (name, value) => fs.writeFileSync(at(name), `${JSON.stringify(value, null, 2)}\n`, "utf8");

const snapshot = readJson("execution-snapshot.json");
const targets = readJson("behavioural-contract-targets.json");
const skill = readJson("skill-integrity-arbitration.json");
const checkoutArms = readJson("checkout-arm-experiment.json");
const binding = readJson("turn-binding-arbitration.json");
const material = readJson("shared-material-arbitration.json");
const catalog = readJson("catalog-announcement-arbitration.json");
const visual = readJson("visual-contract-arbitration.json");
const counterexamples = readJson("behaviour-counterexamples.json");
const stability = readJson("targeted-stability.json");

const EXECUTION = snapshot.executionSnapshotId;

// ---------------------------------------------------------------- runtime
const runtimeBySubRoot = {
  SKILL_INTEGRITY_PIN: skill,
  ARTIFACT_TURN_BINDING: binding,
  CATALOG_CHANGE_ANNOUNCEMENT: catalog,
  WORKSPACE_MATERIAL_ISOLATION: material,
  AGENT_RUN_CARD_MATERIAL: material,
  VISUAL_CONTRACT_VALIDATION: visual,
};

write("behaviour-runtime-results.json", {
  generatedAt: new Date().toISOString(),
  executionSnapshotId: EXECUTION,
  method:
    "Every sub-root was settled by executing the production path it protects. Only external edges were stubbed: the browser (an EventTarget), the network (a counter), and the filesystem location of a throwaway database.",
  subRoots: Object.entries(runtimeBySubRoot).map(([subRoot, evidence]) => ({
    subRoot,
    productionEntryPoint: evidence.boundary ?? evidence.method ?? null,
    invariants: (evidence.invariants ?? []).map((entry) => ({
      name: entry.name,
      holds: entry.holds,
      detail: entry.detail,
    })),
    allInvariantsHold: evidence.allInvariantsHold,
    brokenInvariants: evidence.brokenInvariants ?? [],
  })),
  supplementaryExperiments: {
    freshCheckoutArms: {
      question: checkoutArms.question,
      conclusion: checkoutArms.conclusion,
      perSkill: checkoutArms.perSkill.map((entry) => ({
        slug: entry.slug,
        checkoutPoliciesThatVerify: entry.checkoutPoliciesThatVerify,
        verifiesUnderAnyCheckout: entry.verifiesUnderAnyCheckout,
      })),
      repositoryConfigUnchanged: checkoutArms.repositoryConfigUnchanged,
      globalConfigUnchanged: checkoutArms.globalConfigUnchanged,
    },
  },
});

// -------------------------------------------------------- negative cases
write("behaviour-negative-cases.json", {
  generatedAt: new Date().toISOString(),
  executionSnapshotId: EXECUTION,
  principle:
    "A positive control alone proves only that the happy path works. Each sub-root was additionally attacked with the input that would make its invariant wrong.",
  cases: [
    {
      subRoot: "SKILL_INTEGRITY_PIN",
      adversarial: [
        { case: "a skill whose integrity failed", expected: "refused at every dispatch boundary", observed: skill.gateDirections.find((e) => e.case === "integrity failed")?.dispatchAllowed === false ? "refused" : "ALLOWED" },
        { case: "enabled but unhealthy", expected: "refused", observed: skill.gateDirections.find((e) => e.case === "enabled but unhealthy")?.dispatchAllowed === false ? "refused" : "ALLOWED" },
        { case: "healthy but disabled", expected: "refused", observed: skill.gateDirections.find((e) => e.case === "healthy but disabled")?.dispatchAllowed === false ? "refused" : "ALLOWED" },
        { case: "the anonymous public surface", expected: "never offered a tool that fetches arbitrary URLs", observed: skill.runtime.filter((e) => e.surface === "quartz_ai").every((e) => e.listed === false) ? "not offered" : "OFFERED" },
        { case: "a fresh checkout under the other line-ending policy", expected: "the reviewed skill still verifies", observed: checkoutArms.conclusion },
      ],
    },
    {
      subRoot: "ARTIFACT_TURN_BINDING",
      adversarial: binding.cases
        .filter((entry) => entry.kind === "NEGATIVE")
        .map((entry) => ({ case: entry.name, detail: entry.detail ?? null, ...entry })),
    },
    {
      subRoot: "CATALOG_CHANGE_ANNOUNCEMENT",
      adversarial: [
        { case: "a repeat load with no announcement", expected: "served from cache", observed: `${catalog.cacheBehaviour.fetchesAfterFirstLoad} -> ${catalog.cacheBehaviour.fetchesAfterSecondLoad} fetches` },
        { case: "a load after an announcement", expected: "goes to the network and returns the new catalog", observed: `${catalog.cacheBehaviour.fetchesAfterSecondLoad} -> ${catalog.cacheBehaviour.fetchesAfterAnnouncement} fetches` },
        { case: "a forced load", expected: "never served from cache", observed: catalog.cacheBehaviour.forcedLoadCausedNetwork },
      ],
    },
    {
      subRoot: "WORKSPACE_MATERIAL_ISOLATION",
      adversarial: [
        { case: "every bb-neu-* rule in the shipped stylesheet", expected: "no motion or layout declaration", observed: `${material.workspaceMaterial.materialRuleCount} rules parsed, ${material.workspaceMaterial.violations.length} violations` },
        { case: "the failing assertion's own text window", expected: "n/a — measured to show what the window sweeps in", observed: material.workspaceMaterial.textWindow.nonMaterialSelectorsSweptIn },
      ],
    },
    {
      subRoot: "AGENT_RUN_CARD_MATERIAL",
      adversarial: [
        { case: "every class the card uses", expected: "defined in the stylesheet", observed: material.agentRunCards.socialsUnknownClasses.length === 0 ? "all defined" : material.agentRunCards.socialsUnknownClasses },
        { case: "the asserted classes the card lacks", expected: "not family invariants", observed: material.agentRunCards.assertedClassStatus.filter((e) => !e.usedBySocialsCard).map((e) => `${e.className}: ${e.cardsUsingIt}/${material.agentRunCards.family.length} cards`) },
        { case: "brand hex colours", expected: "none", observed: material.agentRunCards.brandHexColours },
      ],
    },
    {
      subRoot: "VISUAL_CONTRACT_VALIDATION",
      adversarial: [
        ...visual.fieldNaming.map((entry) => ({ case: `omit ${entry.omitted}`, expected: "refused, naming that field", observed: entry.refused && entry.namesTheOmittedField ? "refused and named" : "NOT NAMED" })),
        { case: "no model-authored contract at all", expected: "refused", observed: visual.experiments.find((e) => e.arm.includes("no model-authored contract"))?.accepted === false ? "refused" : "ACCEPTED" },
        { case: "learnerAction present but blank", expected: "refused", observed: visual.experiments.find((e) => e.arm.includes("blank"))?.refused ? "refused" : "ACCEPTED" },
        { case: "decision.interaction diverges by one field", expected: "refused", observed: visual.experiments.find((e) => e.arm.includes("diverges"))?.refused ? "refused" : "ACCEPTED" },
      ],
    },
  ],
});

// ------------------------------------------------------- classifications
const CLASSIFY = {
  SKILL_INTEGRITY_PIN: {
    classification: "PRODUCT_BUG",
    confidence: "HIGH",
    severity: "P1",
    findingId: "W23E-001",
    rationale:
      "Both reviewed skills fail their integrity pin without any content change. A fresh checkout of the reviewed commit was materialised under each of the repository's two possible line-ending policies: bullshit-detector verifies under neither, premortem only under core.autocrlf=true. The runtime consequence was executed, not inferred — enabled=false, healthy=false, and an explicit /premortem ask is refused with 'That capability is unavailable in the current surface or task mode.' The gate itself is correct and keeps its teeth in every partial-failure combination; the defect is that the pin is computed over bytes git does not preserve.",
    testIsCorrect: true,
    correctionNeeded: "none — these tests should stay red until the product is repaired",
  },
  CATALOG_CHANGE_ANNOUNCEMENT: {
    classification: "STALE_TEST",
    confidence: "HIGH",
    severity: null,
    rationale:
      "Both funnels announce. The second one moved: the subscription catalog sync now lives in settings-accounts.tsx :: syncSubscriptionModels, because the account list became the only place a sign-in starts. The announcement was executed against a real listener, and the cache was proven to invalidate and refetch the new catalog. The assertion counts call sites in one file, which no consumer can observe.",
    testIsCorrect: false,
    correctionCategory: "B",
  },
  WORKSPACE_MATERIAL_ISOLATION: {
    classification: "TEST_EXPECTATION_BUG",
    confidence: "HIGH",
    severity: null,
    rationale:
      "All 21 bb-neu-* rules in the shipped stylesheet were parsed and none declares a motion or layout property, so the invariant holds. The assertion does not measure those rules: it takes a text slice from a comment to a distant marker, which now also contains .bb-chat-marquee and .bb-garden-card-action:active. A marquee must set transform and overflow, so the assertion as written expects something that was never intended to be true.",
    testIsCorrect: false,
    correctionCategory: "B",
  },
  AGENT_RUN_CARD_MATERIAL: {
    classification: "STALE_TEST",
    confidence: "HIGH",
    severity: null,
    rationale:
      "The card uses 12 shared agent-run classes, every one defined in the stylesheet, and carries no brand hex colour. Of the four asserted classes it lacks, bb-agent-run-icon is used by 0 of 32 inline agent-run cards and is not defined in the stylesheet at all; neu-button and neu-inset are used by 0 of 32; bb-agent-run-pill by 2 of 32. Satisfying the assertion would mean adding markup for a class that does not exist.",
    testIsCorrect: false,
    correctionCategory: "B",
  },
  ARTIFACT_TURN_BINDING: {
    classification: "FIXTURE_BUG",
    confidence: "HIGH",
    severity: null,
    rationale:
      "Executed against a real database, a film launched on garden_chat binds to its asking turn and the legacy transcript carries the same canonical id. The fixture writes the Garden's turn with a raw INSERT and canonical_message_id NULL, on the belief that the Garden does not use the canonical turn store. It does: garden-agent-chat.tsx uses useAgentSession('garden_chat'), which POSTs to the external-turns route, which calls recordExternalAgentTurn — the same function the passing Terminal case calls. The fixture asserts against a write path the Garden surface never takes.",
    testIsCorrect: false,
    correctionCategory: "A",
  },
  VISUAL_CONTRACT_VALIDATION: {
    classification: "FIXTURE_BUG",
    confidence: "HIGH",
    severity: null,
    rationale:
      "Contract A confirmed, Contract B refuted. The model is asked to author learnerAction in the repair prompt, the necessity batch carries it, and implementation consumes it. The validator names each missing field individually rather than refusing broadly, refuses a blank value, and still refuses a plan with no model-authored contract. Supplying learnerAction is necessary but not sufficient: the plan's contract must also equal the decision's interaction contract exactly. A contract assembled the way the pipeline assembles one routes to generated_module and yields a concrete interactive intent, which is precisely what both failing tests assert. The suite's local withModelAuthoredPlan helper predates the tightened contract.",
    testIsCorrect: false,
    correctionCategory: "A",
    resolvesHeldItem: "the learnerAction human-decision item from W2-3C is settled by experiment; humanDecisionNeeded is now false",
  },
};

const rows = targets.targets.map((target) => {
  const verdict = CLASSIFY[target.subRoot];
  return {
    testId: target.testId,
    testFile: target.testFile,
    subRoot: target.subRoot,
    previousClassification: target.currentClassification,
    previousConfidence: target.currentConfidence,
    classification: verdict.classification,
    confidence: verdict.confidence,
    severity: verdict.severity,
    findingId: verdict.findingId ?? null,
    correctionCategory: verdict.correctionCategory ?? null,
    correctionApplied: false,
    rationale: verdict.rationale,
    executionSnapshotId: EXECUTION,
  };
});

write("behaviour-classifications.json", {
  generatedAt: new Date().toISOString(),
  executionSnapshotId: EXECUTION,
  total: rows.length,
  byClassification: rows.reduce((accumulator, row) => {
    accumulator[row.classification] = (accumulator[row.classification] ?? 0) + 1;
    return accumulator;
  }, {}),
  byConfidence: rows.reduce((accumulator, row) => {
    accumulator[row.confidence] = (accumulator[row.confidence] ?? 0) + 1;
    return accumulator;
  }, {}),
  rows,
});

// -------------------------------------------------------- product finding
const bullshit = checkoutArms.perSkill.find((entry) => entry.slug === "bullshit-detector");
const premortem = checkoutArms.perSkill.find((entry) => entry.slug === "premortem");

write("product-findings.json", {
  generatedAt: new Date().toISOString(),
  executionSnapshotId: EXECUTION,
  baseCommit: snapshot.baseCommit,
  sourceSnapshotFingerprint: snapshot.sourceFingerprint,
  environmentFingerprint: snapshot.environmentFingerprint,
  findings: [
    {
      id: "W23E-001",
      title: "Reviewed skill integrity pins are computed over bytes git does not preserve, so two shipped skills are disabled for every user",
      classification: "PRODUCT_BUG",
      severity: "P1",
      severityDefinition: "A core user journey is completely broken.",
      confidence: "HIGH",
      affectedTests: rows.filter((row) => row.findingId === "W23E-001").map((row) => row.testId),
      userVisibleImpact:
        "Bullshit Detector and Premortem appear in the installed-skills catalog but never work. The super agent is never told they exist, /bullshit-detector and /premortem are refused with 'That capability is unavailable in the current surface or task mode', and the skill_open tool will not serve their guidance. There is no user-side workaround: the user has not edited anything.",
      causalChain: [
        "A skill's integrity is verified by hashing the shipped file's bytes and comparing against the hash pinned in .agents/skills/registry.json.",
        "The pin for bullshit-detector equals the sha256 of the build script's raw in-memory output, which mixes line endings: the generated preamble uses LF and the vendored clone's body uses CRLF.",
        "git normalises the committed blob to LF and, with core.autocrlf=true, writes CRLF back out at checkout. Neither rendering can reproduce a mixed-line-ending hash.",
        "The pin for premortem equals the CRLF rendering, so it verifies only on a checkout that writes CRLF.",
        "integrityVerified is therefore false, which sets enabled=false and healthy=false on the skill summary.",
        "Every boundary that would ship guidance — super-agent skillEntries, skillAvailableForContext, the skill_open route — correctly refuses a skill in that state, so the feature is completely unavailable.",
      ],
      evidence: {
        freshCheckoutArms: {
          "bullshit-detector": {
            verifiesUnder: bullshit.checkoutPoliciesThatVerify,
            note: "no checkout of the reviewed commit reproduces the pinned hash",
          },
          premortem: {
            verifiesUnder: premortem.checkoutPoliciesThatVerify,
            note: "CRLF only; the developer's own working copy is LF and therefore fails",
          },
        },
        generator: skill.generatorEvidence,
        runtimeConsequence: skill.runtime,
        commandResolution: skill.commandResolution,
        gateIsCorrect: skill.gateDirections,
        everyGuidanceBoundaryApplies: skill.consumerGates,
      },
      whatIsNotWrong: [
        "The integrity gate itself. It refuses a failed-integrity skill in every partial-failure combination, and every consumer that would ship guidance applies it.",
        "The failure direction. The control fails closed, so this is an availability defect and not a security bypass.",
        "The anonymous public surface, which is never offered either skill.",
        "The tests. All five assert the intended behaviour correctly and should stay red until the product is repaired.",
      ],
      independentReproduction: {
        method:
          "Two throwaway worktrees were materialised from HEAD, one per line-ending policy, with the policy passed per command. The shipped SKILL.md was hashed in each and compared against the registry pin.",
        independentOfFirstEvidence:
          "yes — the first evidence came from the runtime skill list in the developer's working tree; this reproduction uses fresh checkouts and never reads the working copy",
        repositoryConfigUnchanged: checkoutArms.repositoryConfigUnchanged,
        globalConfigUnchanged: checkoutArms.globalConfigUnchanged,
      },
      repairStatus: "DESIGNED_NOT_APPLIED_AWAITING_AUTHORISATION",
      repairHeldBecause:
        "Every viable repair crosses a fence set for this work. Normalising line endings before hashing changes how an integrity control reaches its verdict, and 'do not change security boundaries' is a standing Week-1 constraint. Adding .gitattributes to stop git rewriting these files is a repository-wide checkout-policy change the W2-3C instructions explicitly discouraged. Regenerating the pins is forbidden by the W2-3B instruction that the pin exists to stop unreviewed generated guidance shipping — and it would not hold, because the next checkout on a different policy breaks it again. Applying any of these autonomously would be a QA pass quietly rewriting a trust control.",
      candidateRepairs: [
        {
          option: "A",
          change:
            "Normalise line endings before hashing, in both the pin generator and skills.ts's verifier. Content changes are still detected byte-for-byte; only CR/LF differences stop mattering.",
          smallest: true,
          risk:
            "It relaxes an integrity control. For markdown guidance the model reads, line endings carry no meaning, and the counterexample proof shows a line-ending-tolerant verifier still rejects changed words. Even so, relaxing a trust control is a human decision.",
          regressionTest:
            "Pin a skill from LF bytes, verify it from CRLF bytes and from LF bytes: both must verify. Change one word: both must fail.",
        },
        {
          option: "B",
          change:
            "Mark .agents/skills/** as not-text in .gitattributes so git never rewrites these files, leaving the verifier byte-exact.",
          smallest: false,
          risk:
            "No weakening of the control at all, but it changes repository checkout policy, and W2-3C's instructions discouraged adding .gitattributes.",
          regressionTest:
            "Materialise the two checkout arms again; both must now produce identical bytes and both must verify.",
        },
        {
          option: "C",
          change: "Regenerate and re-review the pins.",
          smallest: false,
          risk:
            "Forbidden by the standing W2-3B instruction, and it does not fix the defect: a machine with the other policy breaks again on the next clone.",
          regressionTest: "n/a — rejected",
        },
      ],
      recommendation:
        "Option A, paired with a generator that writes LF, is the smallest change that makes the pin mean 'this content was reviewed' rather than 'these bytes were written on that machine'. It needs an explicit human decision because it is a trust control.",
    },
  ],
});

// ------------------------------------------------------------- flips
write("expected-test-flips.json", {
  generatedAt: new Date().toISOString(),
  executionSnapshotId: EXECUTION,
  predictionMadeBefore: "any correction or repair",
  changesApplied: {
    productFiles: 0,
    testFiles: 0,
    repositoryArtefacts: 0,
    note: "No SH1 repair was applied and no test correction was applied, both for stated reasons. A no-flip prediction is still a prediction: any target changing state would signal an unintended side effect of the arbitration itself.",
  },
  predictions: rows.map((row) => ({
    testId: row.testId,
    before: "FAIL",
    expectedAfter: "FAIL",
    causalReason:
      row.classification === "PRODUCT_BUG"
        ? "The product defect is unrepaired by deliberate choice, so the test must still fail."
        : "The correction is designed but held, so the test must still fail.",
  })),
  expectedUnrelatedFlips: [
    {
      scope: "the seven target test files",
      expectation: "no other test in these files changes state",
      why: "the arbitration ran in separate processes against throwaway databases and local stand-ins; nothing was written to product source, test source or repository artefacts",
    },
  ],
});

// -------------------------------------------------------- contract map
const previousMap = JSON.parse(
  fs.readFileSync(
    ".qa-results/week2-executable-contract-arbitration/w23d-20260817T200225Z/updated-contract-map.json",
    "utf8",
  ),
);
const before = previousMap.after ?? previousMap.byState ?? previousMap;

const movement = {
  UNRESOLVED_CONTRACT: -11,
  RESOLVED_PRODUCT_BUG: +5,
  RESOLVED_FIXTURE_BUG: +3,
  RESOLVED_STALE_TEST: +2,
  RESOLVED_TEST_BUG: +1,
};

const after = { ...before };
for (const [state, delta] of Object.entries(movement)) {
  after[state] = (after[state] ?? 0) + delta;
}

write("updated-contract-map.json", {
  generatedAt: new Date().toISOString(),
  executionSnapshotId: EXECUTION,
  note:
    "Eleven ROOT-4B-BEHAVIOURAL rows moved out of UNRESOLVED_CONTRACT. RESOLVED_PRODUCT_BUG means the contract is settled and the defect is recorded with a designed repair, not that the defect is fixed — those five tests are still failing and should be.",
  before,
  movement,
  after,
  rows: rows.map((row) => ({
    testId: row.testId,
    from: "UNRESOLVED_CONTRACT",
    to: `RESOLVED_${row.classification === "PRODUCT_BUG" ? "PRODUCT_BUG" : row.classification === "TEST_EXPECTATION_BUG" ? "TEST_BUG" : row.classification}`,
    confidence: row.confidence,
  })),
  heldForPolicy: {
    executableContractReplacements: 8,
    root5Case: 1,
    uiShapeRows: 18,
    behaviouralCategoryBCorrections: rows.filter((row) => row.correctionCategory === "B").length,
    behaviouralCategoryACorrections: rows.filter((row) => row.correctionCategory === "A").length,
    note:
      "The three category-B behavioural corrections join the held source-shape policy set, because each would replace a source-shape assertion with an executable one and that is the policy question this pass must not settle by accident. The two category-A corrections are eligible to apply and are held only because the user's own ordering schedules corrections after the policy pass.",
  },
  counterexampleProof: {
    total: counterexamples.total,
    detected: counterexamples.detected,
    nonVacuous: counterexamples.nonVacuous,
  },
  stability: {
    attemptsPerFamily: stability.attemptsPerFamily,
    allStable: stability.allStable,
    flaky: stability.flaky,
  },
});

console.log(`[w23e] classifications: ${JSON.stringify(rows.reduce((a, r) => ({ ...a, [r.classification]: (a[r.classification] ?? 0) + 1 }), {}))}`);
console.log(`[w23e] contract map after: ${JSON.stringify(after)}`);
