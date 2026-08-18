#!/usr/bin/env node

/** W2-3B Phase 5: one adjudication record per root-cause cluster. */

import * as fs from "node:fs";
import * as path from "node:path";

const dir = path.resolve(process.argv[2] ?? "");
const read = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));

const crlf = read("crlf-sensitivity.json");
const inventory = read("dashboard-failure-inventory.json");
const review = read("dashboard-contract-review.json");
const testsIn = (id) => review.rows.filter((row) => row.rootCauseId === id).map((row) => row.testId);

const NL = String.fromCharCode(92) + "n";

const clusters = [
  {
    rootCauseId: "ROOT-4A-CRLF-CHECKOUT-NORMALISATION",
    tests: crlf.sensitiveTests,
    sourceArea: ["qa/autonomous/lib/repair-worktree.mjs", "every source-contract assertion pinning a bare newline"],
    assertedContract: `A source-contract assertion pins text spanning a line break, for example /…just to hit${NL}a number/.`,
    actualImplementation:
      "The asserted text is present and unchanged in the developer tree. The repository sets core.autocrlf=true, so `git worktree add` rewrites text files to CRLF, and a bare newline escape cannot match a carriage-return pair.",
    externalBehavior: "Unchanged. No product behaviour is involved.",
    callSiteEvidence: [
      "hermes-skills/prebuilt/i-have-adhd/SKILL.md in the developer tree: 229 bare LF, 0 CRLF",
      "the same file in a default worktree checkout: 223 CRLF, 0 bare LF",
      "within one test, the newline-tolerant pattern passed while the bare-newline pattern failed on the same file",
      "no .gitattributes exists, so autocrlf governs every text file",
    ],
    runtimeEvidence: [
      "checking out with core.autocrlf=false yields 0 CRLF and the bare-newline assertion matches",
      "all 10 predicted tests flipped FAIL to PASS after the harness fix; the prediction came from static pattern analysis made before the change",
    ],
    historyEvidence: [],
    contractType: "IMPLEMENTATION_COUPLING",
    classification: "HARNESS_BUG",
    confidence: "HIGH",
    recommendedAction:
      "Fixed: reconstruction worktrees now check out with core.autocrlf=false so they carry committed bytes.",
    safeToCorrectNow: true,
    repairRequired: false,
    humanReviewRequired: false,
    notes:
      "These were never product bugs or stale tests. Adjudicated without this discovery, ten assertions would plausibly have been weakened or deleted to make a QA-environment artefact disappear.",
  },
  {
    rootCauseId: "ROOT-1-GENERATED-SKILL-ARTIFACT-MISSING",
    tests: testsIn("ROOT-1-GENERATED-SKILL-ARTIFACT-MISSING"),
    sourceArea: ["hermes-skills/prebuilt", "scripts/build-*-skill.mjs"],
    assertedContract:
      "A reviewed skill ships as a generated SKILL.md pinned by hash; an unbuilt or drifted artifact is disabled rather than shipped quietly.",
    actualImplementation:
      "The prebuilt artifacts for bullshit-detector, agent-loop-engineering and aris are absent, so the registry reports them not ready.",
    externalBehavior: "Correct: the integrity mechanism disables unreviewed guidance, which is the intended outcome.",
    callSiteEvidence: [
      "hermes-skills/prebuilt holds 21 skills, none of them the three under test",
      "the source clones are present but gitignored",
      "the test comment states the pin exists so that editing shipped guidance without re-review disables the skill",
    ],
    runtimeEvidence: ["listApprovedSkills reports enabled=false for the missing skills, which is the designed behaviour"],
    historyEvidence: [],
    contractType: "REAL_CONTRACT",
    classification: "FIXTURE_BUG",
    confidence: "HIGH",
    recommendedAction:
      "Developer decision: regenerate and re-review the artifacts. QA must not re-pin hashes to turn tests green.",
    safeToCorrectNow: false,
    repairRequired: false,
    humanReviewRequired: true,
    notes:
      "Phase 12 option D applies: the tests already assert that missing artifacts remain disabled, so no test change is warranted. The artifacts are simply absent.",
  },
  {
    rootCauseId: "ROOT-5-FIGURECOUNT-VARIABLE-RENAME",
    tests: testsIn("ROOT-5-FIGURECOUNT-VARIABLE-RENAME"),
    sourceArea: ["dashboard/src/app/api/ingest/route.ts"],
    assertedContract: "The ingest route persists figures as page assets and counts them.",
    actualImplementation:
      "figureCount is accumulated from vlm.figureCount and the anydoc path then persisted by shorthand; the pinned literal no longer exists.",
    externalBehavior: "Preserved, and broader than when the assertion was written.",
    callSiteEvidence: [
      "route.ts:783 defines vlmFigureSaver",
      "1467 and 1565 pass saveFigure on both paths; the same test's assertion of exactly two occurrences still passes",
      "1447/1475/1578 assign figureCount; 1959 persists it",
    ],
    runtimeEvidence: [],
    historyEvidence: [],
    contractType: "IMPLEMENTATION_COUPLING",
    classification: "STALE_TEST",
    confidence: "HIGH",
    recommendedAction:
      "Replace the literal assertion with one pinning the surviving invariant. NOT applied: its family (ROOT-4B) is unadjudicated and Phase 6 forbids partial easy wins.",
    safeToCorrectNow: false,
    repairRequired: false,
    humanReviewRequired: false,
    notes: "Held deliberately rather than taken as a red-count win.",
  },
  {
    rootCauseId: "ROOT-4B-SOURCE-SHAPE-DRIFT-REMAINDER",
    tests: testsIn("ROOT-4-SOURCE-SHAPE-DRIFT"),
    sourceArea: ["mixed: React component internals, route and query construction, data-projection pipelines"],
    assertedContract:
      "Mixed. Inspection found at least three distinct families rather than one shared contract.",
    actualImplementation: "Not established per test in this pass.",
    externalBehavior: "Not established per test.",
    callSiteEvidence: [
      "representative sampling found /api/hermes/sessions?surface=… (route construction, likely REAL_CONTRACT) alongside a pinned JSX className string (likely IMPLEMENTATION_COUPLING)",
    ],
    runtimeEvidence: [],
    historyEvidence: [],
    contractType: "MIXED",
    classification: "UNRESOLVED_CONTRACT",
    confidence: "LOW",
    recommendedAction:
      "Split by family and adjudicate route/query construction and data projection first, then JSX/CSS structure.",
    safeToCorrectNow: false,
    repairRequired: false,
    humanReviewRequired: false,
    notes: "ROOT-4 was confirmed MIXED; the CRLF family was extracted as ROOT-4A and resolved. This is the remainder.",
  },
  {
    rootCauseId: "ROOT-2-VISUAL-CONTRACT-LEARNERACTION",
    tests: testsIn("ROOT-2-VISUAL-CONTRACT-LEARNERACTION"),
    sourceArea: ["dashboard visual decision policy"],
    assertedContract: "A visualization plan can be built for the fixture unit.",
    actualImplementation: "buildVisualizationPlan rejects: U1 missing model-authored learnerAction.",
    externalBehavior: "Validation refuses a plan lacking a model-authored learner control.",
    callSiteEvidence: [],
    runtimeEvidence: [],
    historyEvidence: [],
    contractType: "REAL_CONTRACT",
    classification: "UNRESOLVED_CONTRACT",
    confidence: "MEDIUM",
    recommendedAction: "Establish when learnerAction became mandatory.",
    safeToCorrectNow: false,
    repairRequired: false,
    humanReviewRequired: true,
    notes: "Governs what reaches implementation dispatch; deliberately not guessed.",
  },
  {
    rootCauseId: "ROOT-6-WIRING-RELOCATED",
    tests: testsIn("ROOT-6-WIRING-RELOCATED"),
    sourceArea: ["mixed"],
    assertedContract: "A named helper is invoked inside a specific module.",
    actualImplementation: "The identifier exists elsewhere in dashboard/src; the asserted module no longer contains it.",
    externalBehavior: "Not established.",
    callSiteEvidence: ["identifiers such as withConversationContext resolve in 8 files, so this is relocation, not removal"],
    runtimeEvidence: [],
    historyEvidence: [],
    contractType: "UNCLEAR",
    classification: "UNRESOLVED_CONTRACT",
    confidence: "LOW",
    recommendedAction: "Trace each relocation and decide whether the test should follow it or an invariant broke.",
    safeToCorrectNow: false,
    repairRequired: false,
    humanReviewRequired: false,
    notes: "Shrank from 7 to 3 after the CRLF fix.",
  },
  {
    rootCauseId: "ROOT-7-UNREVIEWED",
    tests: testsIn("ROOT-7-UNREVIEWED"),
    sourceArea: ["mixed"],
    assertedContract: "Various; the asserted file is not resolvable automatically, or the failure is not a source assertion.",
    actualImplementation: "Not established.",
    externalBehavior: "Not established.",
    callSiteEvidence: [],
    runtimeEvidence: [],
    historyEvidence: [],
    contractType: "UNCLEAR",
    classification: "UNRESOLVED_CONTRACT",
    confidence: "LOW",
    recommendedAction: "Improve asserted-file resolution, then adjudicate.",
    safeToCorrectNow: false,
    repairRequired: false,
    humanReviewRequired: false,
    notes: "Residual bucket; the honest label for failures that have not been examined.",
  },
  {
    rootCauseId: "ROOT-3-CAD-CLONE-EXECUTION",
    tests: testsIn("ROOT-3-CAD-CLONE-EXECUTION"),
    sourceArea: ["dashboard/tests/parametric-cad-integration.test.mjs"],
    assertedContract: "A model exceeding the printer bed is reported as an error.",
    actualImplementation: "Not established; the test executes only once the CAD clone is linked.",
    externalBehavior: "Not established.",
    callSiteEvidence: ["listed as LINKING_DAMAGE in the W2-2B two-arm experiment"],
    runtimeEvidence: [],
    historyEvidence: [],
    contractType: "UNCLEAR",
    classification: "UNRESOLVED_CONTRACT",
    confidence: "LOW",
    recommendedAction: "Carry as W2-2B blocker E-2.",
    safeToCorrectNow: false,
    repairRequired: false,
    humanReviewRequired: false,
    notes: "Environment-sensitive rather than a clean eligible failure.",
  },
];

fs.writeFileSync(
  path.join(dir, "cluster-adjudications.json"),
  `${JSON.stringify(
    { generatedAt: new Date().toISOString(), executionSnapshotId: inventory.executionSnapshot.executionSnapshotId, clusters },
    null,
    2,
  )}\n`,
  "utf8",
);

console.log(`clusters adjudicated: ${clusters.length}`);
for (const cluster of clusters) {
  console.log(
    `  ${String(cluster.tests.length).padStart(3)}  ${cluster.rootCauseId}  [${cluster.confidence}] ${cluster.classification}`,
  );
}
