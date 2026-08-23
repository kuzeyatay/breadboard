import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  auditGardenForFinalization,
  reviewedSourceFormulaPageBindingProblems,
  sourceFormulaReviewFinalizationContextFromGarden,
  verifyFinalArtifactNoMutation,
} from "../src/lib/garden-finalize.ts";
import {
  computeSourceFormulaReviewSetHash,
  sourceSetHashWithReviewedFormulas,
  sourceVisualSourceIdentityMapHash,
} from "../src/lib/source-visuals.ts";
import { selectedSourceArtifactInventorySnapshot } from "../src/lib/learn-source-artifact-inventory.ts";
import {
  runSyllabusCoverageEvidenceRecovery,
  syllabusCoverageRecoveryReceiptIntegrity,
} from "../src/lib/learn-syllabus-coverage-recovery.ts";
import { modelSourcePageAnchors } from "../src/lib/model-source-anchor-ledger.ts";

const FORMULA_ID = "S1.P1.E1";
const UNUSED_REVIEWED_FORMULA_ID = "S1.P2.E1";
const UNUSED_FORMULA_ID = "S2.P1.E1";
const FIGURE_ID = "S1.P3.F1";
const REVIEWED_TEXT = "E = mc^2 \\tag{1}";
const REVIEW_SET_HASH = "a".repeat(64);
const BASE_SOURCE_SET_HASH = "b".repeat(64);
const COMBINED_SOURCE_SET_HASH = sourceSetHashWithReviewedFormulas(
  BASE_SOURCE_SET_HASH,
  REVIEW_SET_HASH,
);
const SOURCE_IDENTITY_MAP = [
  { sourceId: "S1", sourceIndex: 1 },
  { sourceId: "S2", sourceIndex: 2 },
];

function fixtureLedger() {
  return [
    {
      sourceVisualId: FORMULA_ID,
      sourceId: "S1",
      pageNumber: 1,
      type: "equation",
      caption: "Mass-energy equivalence",
      exactText: REVIEWED_TEXT,
      bbox: { x: 0.1, y: 0.2, width: 0.5, height: 0.1 },
      usageStatus: "assigned",
    },
    {
      sourceVisualId: UNUSED_REVIEWED_FORMULA_ID,
      sourceId: "S1",
      pageNumber: 2,
      type: "equation",
      caption: "Reviewed but intentionally unused equation",
      exactText: "p = mv",
      bbox: { x: 0.2, y: 0.3, width: 0.4, height: 0.1 },
      usageStatus: "intentionally_skipped",
      skipReason: "Not needed for the chosen learning scope.",
    },
    {
      sourceVisualId: FIGURE_ID,
      sourceId: "S1",
      pageNumber: 3,
      type: "figure",
      caption: "Selected-source reference figure",
      bbox: { x: 0.1, y: 0.1, width: 0.6, height: 0.4 },
      usageStatus: "intentionally_skipped",
      skipReason: "Not needed for the chosen learning scope.",
    },
    {
      sourceVisualId: UNUSED_FORMULA_ID,
      sourceId: "S2",
      pageNumber: 1,
      type: "equation",
      caption: "Equation from an unselected source",
      exactText: "F = ma",
      bbox: { x: 0.2, y: 0.3, width: 0.4, height: 0.1 },
      usageStatus: "intentionally_skipped",
      skipReason: "Source S2 was not selected for this Learn run.",
    },
  ];
}

const SOURCE_ARTIFACT_INVENTORY_HASH = selectedSourceArtifactInventorySnapshot({
  selectedSourceIds: ["S1"],
  sourceIdentityMap: SOURCE_IDENTITY_MAP,
  visuals: fixtureLedger(),
}).sourceArtifactInventoryHash;
const EXPECTED_CONTEXT = {
  reviewSetHash: REVIEW_SET_HASH,
  combinedSourceSetHash: COMBINED_SOURCE_SET_HASH,
  sourceArtifactInventoryHash: SOURCE_ARTIFACT_INVENTORY_HASH,
  formulaIds: [FORMULA_ID, UNUSED_REVIEWED_FORMULA_ID],
  sourceIds: ["S1"],
  sourceIdentityMap: SOURCE_IDENTITY_MAP,
  topologyReviewPageReceipts: [],
  model: "gpt-test",
};

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function pageMarkdown({
  body = "$$\nE = mc^2 \\qquad \\text{(1)}\n$$",
  metadataText = REVIEWED_TEXT,
} = {}) {
  return `---
title: "Mass-energy equivalence"
knowledge_type: "learning-page"
breadboardType: "learning_page"
generatedBy: "learn_button"
learningUnitId: "U1"
sourceAnchors: ["${FORMULA_ID}"]
sourceFormulaAnchors: ["${FORMULA_ID}"]
sourceSetHash: "${COMBINED_SOURCE_SET_HASH}"
sourceFormulaReviewSetHash: "${REVIEW_SET_HASH}"
formulas:
  - kind: "source_definition"
    text: ${JSON.stringify(metadataText)}
    groundingStatus: "source-anchored"
    sourceAnchor: "${FORMULA_ID}"
---

# Mass-energy equivalence

${body}
`;
}

function buildFormulaGarden(root, { body, metadataText, duplicate = false } = {}) {
  const gardenDir = path.join(root, "reviewed-formulas");
  const breadboardDir = path.join(gardenDir, ".breadboard");
  const pagePath = path.join(gardenDir, "learning", "1. Foundations", "1.1 Mass Energy.md");
  fs.mkdirSync(path.dirname(pagePath), { recursive: true });
  fs.mkdirSync(path.join(gardenDir, "sources"), { recursive: true });
  fs.writeFileSync(path.join(gardenDir, "_index.md"), "---\ntitle: Reviewed formulas\n---\n");
  fs.writeFileSync(path.join(gardenDir, "sources", "_index.md"), "---\ntitle: Sources\n---\n");

  const baseLedger = fixtureLedger();
  const ledger = duplicate
    ? [baseLedger[0], { ...baseLedger[0] }, ...baseLedger.slice(1)]
    : baseLedger;
  writeJson(path.join(breadboardDir, "source-visuals.json"), ledger);
  writeJson(path.join(breadboardDir, "source-visual-source-index.json"), {
    schemaVersion: 1,
    sourceIdentityMap: SOURCE_IDENTITY_MAP,
  });
  writeJson(path.join(breadboardDir, "learning-unit-contract.json"), {
    sourceSetHash: COMBINED_SOURCE_SET_HASH,
    sourceFormulaReviewSetHash: REVIEW_SET_HASH,
    sourceArtifactInventoryHash: SOURCE_ARTIFACT_INVENTORY_HASH,
    learningUnits: [{
      id: "U1",
      title: "Mass-energy equivalence",
      role: "basic_def",
      learningQuestion: "How are mass and energy related?",
      prerequisiteConcepts: [],
      newConcepts: ["mass-energy equivalence"],
      sourceAnchors: [FORMULA_ID],
      sourceFigures: [],
      sourceFormulas: [{
        id: FORMULA_ID,
        teachingGoal: "State the reviewed relation.",
        termsToDefine: ["energy", "mass"],
        placement: "before_example",
      }],
      sourceTables: [],
      zettelNotes: [],
      mustNotRepeat: [],
      expectedWordRange: [50, 500],
    }],
    sourceArtifactAssignments: [{
      sourceArtifactId: FORMULA_ID,
      assignedLearningUnitId: "U1",
      placement: "before_example",
      reason: "Reviewed source definition",
      requiredInterpretation: "State the reviewed relation.",
    }],
  });
  writeJson(path.join(breadboardDir, "source-formula-review-set.json"), {
    schemaVersion: 1,
    promptVersion: 1,
    model: "gpt-test",
    sourceIds: ["S1"],
    sourceIdentityMap: SOURCE_IDENTITY_MAP,
    sourceIdentityMapHash: sourceVisualSourceIdentityMapHash(SOURCE_IDENTITY_MAP),
    formulaIds: [FORMULA_ID, UNUSED_REVIEWED_FORMULA_ID],
    topologyReviewPageReceipts: [],
    reviewSetHash: REVIEW_SET_HASH,
    baseSourceSetHash: BASE_SOURCE_SET_HASH,
    combinedSourceSetHash: COMBINED_SOURCE_SET_HASH,
    createdAt: "2026-08-15T00:00:00.000Z",
  });
  fs.writeFileSync(pagePath, pageMarkdown({ body, metadataText }));
  return gardenDir;
}

/** Install eleven required source definitions on one page. This deliberately
 * exceeds the ordinary metadata budget: every entry is a one-to-one exact
 * projection of a reviewed source equation, which is the only permitted
 * exemption from Formula Metadata Noise. */
function writeDenseReviewedFormulaPage(
  gardenDir,
  { duplicateLastAnchor = false, driftLastText = false } = {},
) {
  const formulas = [
    { id: FORMULA_ID, exactText: REVIEWED_TEXT, caption: "Mass-energy equivalence" },
    ...Array.from({ length: 10 }, (_, index) => ({
      id: `S1.P${index + 10}.E1`,
      exactText: `Q_{${index + 1}} = R_{${index + 1}} \\tag{${index + 2}}`,
      caption: `Reviewed symbolic identity ${index + 1}`,
    })),
  ];
  const breadboardDir = path.join(gardenDir, ".breadboard");
  const ledgerPath = path.join(breadboardDir, "source-visuals.json");
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
  const existingById = new Map(ledger.map((entry) => [entry.sourceVisualId, entry]));
  for (const [index, formula] of formulas.entries()) {
    existingById.set(formula.id, {
      sourceVisualId: formula.id,
      sourceId: "S1",
      pageNumber: index + 1,
      type: "equation",
      caption: formula.caption,
      exactText: formula.exactText,
      bbox: { x: 0.1, y: 0.2, width: 0.5, height: 0.1 },
      usageStatus: "assigned",
    });
  }
  writeJson(ledgerPath, [...existingById.values()]);

  const contractPath = path.join(breadboardDir, "learning-unit-contract.json");
  const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
  const unit = contract.learningUnits[0];
  unit.sourceAnchors = formulas.map((formula) => formula.id);
  unit.sourceFormulas = formulas.map((formula) => ({
    id: formula.id,
    teachingGoal: `State ${formula.caption}.`,
    termsToDefine: ["quantity"],
    placement: "before_example",
  }));
  contract.sourceArtifactAssignments = formulas.map((formula) => ({
    sourceArtifactId: formula.id,
    assignedLearningUnitId: "U1",
    placement: "before_example",
    reason: "Reviewed source definition",
    requiredInterpretation: `State ${formula.caption}.`,
  }));
  writeJson(contractPath, contract);

  const manifestPath = path.join(breadboardDir, "source-formula-review-set.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.formulaIds = formulas.map((formula) => formula.id);
  writeJson(manifestPath, manifest);

  const lastIndex = formulas.length - 1;
  const projections = formulas.map((formula, index) => {
    const expected = duplicateLastAnchor && index === lastIndex ? formulas[0] : formula;
    return {
      anchor: expected.id,
      text: driftLastText && index === lastIndex
        ? `${formula.exactText} + \\delta`
        : expected.exactText,
    };
  });
  const pagePath = path.join(gardenDir, "learning", "1. Foundations", "1.1 Mass Energy.md");
  const metadata = projections.map(({ anchor, text }) => [
    '  - kind: "source_definition"',
    `    text: ${JSON.stringify(text)}`,
    '    groundingStatus: "source-anchored"',
    `    sourceAnchor: "${anchor}"`,
  ].join("\n")).join("\n");
  fs.writeFileSync(pagePath, `---
title: "Mass-energy equivalence"
knowledge_type: "learning-page"
breadboardType: "learning_page"
generatedBy: "learn_button"
learningUnitId: "U1"
sourceAnchors: ${JSON.stringify(formulas.map((formula) => formula.id))}
sourceFormulaAnchors: ${JSON.stringify(formulas.map((formula) => formula.id))}
sourceSetHash: "${COMBINED_SOURCE_SET_HASH}"
sourceFormulaReviewSetHash: "${REVIEW_SET_HASH}"
formulas:
${metadata}
---

# Mass-energy equivalence

${projections.map(({ text }) => `$$\n${text}\n$$`).join("\n\n")}
`);
}

function formulaMetadataNoiseCheck(gardenDir) {
  const check = auditGardenForFinalization(gardenDir, "reviewed-formulas").checks.find(
    (candidate) => candidate.name === "Formula Metadata Noise",
  );
  assert.ok(check, "Formula Metadata Noise check must be present");
  return check;
}

async function syllabusRecoveryFixture(gardenDir, { recovered = true } = {}) {
  const syllabusPlan = {
    courseTitle: "Fields",
    units: [{
      id: "SU1",
      label: "Lecture 1",
      title: "Coulomb fields",
      objectives: ["Derive the field"],
      topics: ["Coulomb law"],
      materialIds: ["R1"],
    }],
    referencedMaterials: [{
      id: "R1",
      citation: "Hayt, Engineering Electromagnetics, section 2.1",
      title: "Engineering Electromagnetics",
      authors: ["Hayt"],
      kind: "textbook",
      locator: "section 2.1",
      required: true,
    }],
  };
  const initialDecision = {
    resolutions: [{
      materialId: "R1",
      citation: syllabusPlan.referencedMaterials[0].citation,
      status: "missing",
      sourceIds: [],
      matchReason: "The prefix is insufficient.",
    }],
    units: [{
      unitId: "SU1",
      availableSourceIds: [],
      missingCitations: [syllabusPlan.referencedMaterials[0].citation],
      teachable: false,
      coverageReason: "No substantive evidence was initially visible.",
    }],
  };
  const finalDecision = recovered ? {
    resolutions: [{
      materialId: "R1",
      citation: syllabusPlan.referencedMaterials[0].citation,
      status: "available",
      sourceIds: ["S1"],
      matchReason: "The recovered canonical page identifies and teaches the cited work.",
    }],
    units: [{
      unitId: "SU1",
      availableSourceIds: ["S1"],
      missingCitations: [],
      teachable: true,
      coverageReason: "The recovered page contains the derivation.",
    }],
  } : initialDecision;
  const sourceBody = [
    "## Internal planning",
    "Navigation only.",
    "## Source material",
    "## Page 1",
    "Title and contents",
    "## Page 19",
    "Coulomb law is derived from force and charge.",
  ].join("\n");
  fs.writeFileSync(
    path.join(gardenDir, "sources", "book.md"),
    `---\ntitle: Book\n---\n${sourceBody}\n`,
  );
  const sources = [{ sourceId: "S1", relPath: "sources/book.md", body: sourceBody }];
  const anchors = modelSourcePageAnchors([{
    id: "S1",
    slug: "S1",
    title: "Book",
    relPath: "sources/book.md",
    body: sourceBody,
  }]);
  return runSyllabusCoverageEvidenceRecovery({
    syllabusPlan,
    initialCoverageRaw: JSON.stringify(initialDecision),
    initialCoverageDecision: initialDecision,
    sources,
    anchors,
    sourceSetHash: COMBINED_SOURCE_SET_HASH,
    sourceArtifactInventoryHash: SOURCE_ARTIFACT_INVENTORY_HASH,
    model: "gpt-test",
    provider: async (request) => {
      if (request.phase === "page_selection") {
        const page = JSON.parse(request.user).pageCatalog.find(
          (entry) => entry.pageNumber === 19,
        );
        return { rawResponse: JSON.stringify({
          selectedPages: [{
            anchorId: page.anchorId,
            sourceId: page.sourceId,
            pageNumber: page.pageNumber,
            selectionReason: "This complete page tests the support gap.",
          }],
          selectionReason: "One exact page is sufficient.",
        }), model: "gpt-test" };
      }
      return { rawResponse: JSON.stringify(finalDecision), model: "gpt-test" };
    },
  });
}

test("reviewed page binding accepts Quartz tag lowering without projecting unused reviewed formulas", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-final-"));
  try {
    const gardenDir = buildFormulaGarden(root);
    assert.deepEqual(reviewedSourceFormulaPageBindingProblems({ gardenDir }), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("hidden reviewed math cannot satisfy the exact visible display projection", () => {
  for (const hidden of [
    `<!-- $$\n${REVIEWED_TEXT}\n$$ -->`,
    `~~~latex\n$$\n${REVIEWED_TEXT}\n$$\n~~~`,
  ]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-hidden-"));
    try {
      const gardenDir = buildFormulaGarden(root, {
        body: `$$\nE = -mc^2 \\qquad \\text{(1)}\n$$\n\n${hidden}`,
      });
      const problems = reviewedSourceFormulaPageBindingProblems({ gardenDir });
      assert.ok(
        problems.some((problem) => /not present as an exact visible Quartz display projection/.test(problem)),
        problems.join(" | "),
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test("reviewed metadata and visible formula reject exact sign drift", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-drift-"));
  try {
    const gardenDir = buildFormulaGarden(root, {
      body: "$$\nE = -mc^2 \\qquad \\text{(1)}\n$$",
      metadataText: "E = -mc^2 \\tag{1}",
    });
    const problems = reviewedSourceFormulaPageBindingProblems({ gardenDir });
    assert.ok(problems.some((problem) => /metadata entry 1 does not exactly match/.test(problem)));
    assert.ok(problems.some((problem) => /not present as an exact visible Quartz display projection/.test(problem)));
    const audit = auditGardenForFinalization(gardenDir, "reviewed-formulas", {
      expectedSourceFormulaReviewContext: EXPECTED_CONTEXT,
    });
    const projectionIssue = audit.repairableIssues.find((issue) =>
      issue.evidence.check === "Reviewed source-formula page projection");
    assert.ok(projectionIssue, JSON.stringify(audit.repairableIssues, null, 2));
    assert.equal(projectionIssue.repairMode, "chatmock");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("formula-bearing pages remain bound to the contract review hash", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-page-hash-"));
  try {
    const gardenDir = buildFormulaGarden(root);
    const pagePath = path.join(gardenDir, "learning", "1. Foundations", "1.1 Mass Energy.md");
    const page = fs.readFileSync(pagePath, "utf8").replace(
      `sourceFormulaReviewSetHash: "${REVIEW_SET_HASH}"`,
      `sourceFormulaReviewSetHash: "${"c".repeat(64)}"`,
    );
    fs.writeFileSync(pagePath, page);
    assert.ok(
      reviewedSourceFormulaPageBindingProblems({ gardenDir }).some((problem) =>
        /sourceFormulaReviewSetHash does not match/.test(problem)),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("central audit rejects a manifest whose combined source hash is not derived", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-manifest-hash-"));
  try {
    const gardenDir = buildFormulaGarden(root);
    const manifestPath = path.join(gardenDir, ".breadboard", "source-formula-review-set.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.combinedSourceSetHash = "c".repeat(64);
    writeJson(manifestPath, manifest);
    const audit = auditGardenForFinalization(gardenDir, "reviewed-formulas");
    assert.ok(
      audit.nonRepairableIssues.some((issue) =>
        issue.evidence.check === "AI-reviewed source-formula manifest binding" &&
        /combinedSourceSetHash is not derived/.test(issue.message)),
      JSON.stringify(audit.nonRepairableIssues, null, 2),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("formula-review manifest accepts prompt V2 and rejects unsupported prompt versions", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-manifest-prompt-version-"));
  try {
    const gardenDir = buildFormulaGarden(root);
    const manifestPath = path.join(gardenDir, ".breadboard", "source-formula-review-set.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

    manifest.promptVersion = 2;
    writeJson(manifestPath, manifest);
    const v2Audit = auditGardenForFinalization(gardenDir, "reviewed-formulas");
    assert.equal(
      v2Audit.nonRepairableIssues.some((issue) =>
        issue.evidence.check === "AI-reviewed source-formula manifest binding" &&
        /invalid promptVersion/.test(issue.message)),
      false,
      JSON.stringify(v2Audit.nonRepairableIssues, null, 2),
    );

    manifest.promptVersion = 3;
    writeJson(manifestPath, manifest);
    const v3Audit = auditGardenForFinalization(gardenDir, "reviewed-formulas");
    assert.ok(
      v3Audit.nonRepairableIssues.some((issue) =>
        issue.evidence.check === "AI-reviewed source-formula manifest binding" &&
        /invalid promptVersion/.test(issue.message)),
      JSON.stringify(v3Audit.nonRepairableIssues, null, 2),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Formula Metadata Noise exempts only one-to-one dense exact reviewed source projections", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-noise-reviewed-"));
  try {
    const gardenDir = buildFormulaGarden(root);

    writeDenseReviewedFormulaPage(gardenDir);
    const exactCheck = formulaMetadataNoiseCheck(gardenDir);
    assert.equal(exactCheck.status, "PASS", exactCheck.problems.join(" | "));

    writeDenseReviewedFormulaPage(gardenDir, { duplicateLastAnchor: true });
    const duplicateCheck = formulaMetadataNoiseCheck(gardenDir);
    assert.equal(duplicateCheck.status, "FAIL");
    assert.ok(
      duplicateCheck.problems.some((problem) => /contains 11 entries/.test(problem)),
      duplicateCheck.problems.join(" | "),
    );

    writeDenseReviewedFormulaPage(gardenDir, { driftLastText: true });
    const driftCheck = formulaMetadataNoiseCheck(gardenDir);
    assert.equal(driftCheck.status, "FAIL");
    assert.ok(
      driftCheck.problems.some((problem) => /contains 11 entries/.test(problem)),
      driftCheck.problems.join(" | "),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("verified formula identity text cannot drift from reviewed ledger text", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-identity-"));
  try {
    const gardenDir = buildFormulaGarden(root);
    writeJson(path.join(gardenDir, ".breadboard", "formula-identities.json"), {
      identities: [{
        anchorId: FORMULA_ID,
        verified: true,
        canonicalText: "E = -mc^2 \\tag{1}",
      }],
    });
    const audit = auditGardenForFinalization(gardenDir, "reviewed-formulas");
    assert.ok(
      audit.nonRepairableIssues.some((issue) =>
        issue.evidence.check === "Reviewed source-formula identity integrity" &&
        /canonicalText drifts/.test(issue.message)),
      JSON.stringify(audit.nonRepairableIssues, null, 2),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("central audit treats duplicate reviewed ledger IDs as non-repairable provenance failure", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-duplicate-"));
  try {
    const gardenDir = buildFormulaGarden(root, { duplicate: true });
    const audit = auditGardenForFinalization(gardenDir, "reviewed-formulas", {
      expectedSourceFormulaReviewContext: EXPECTED_CONTEXT,
    });
    const duplicateIssue = audit.nonRepairableIssues.find((issue) =>
      (issue.evidence.check === "AI-reviewed source-formula provenance" &&
        /Duplicate required source formula id/.test(issue.message)) ||
      (issue.evidence.check === "Selected source-artifact inventory binding" &&
        /duplicate\/conflicting id/.test(issue.message)));
    assert.ok(duplicateIssue, JSON.stringify(audit.nonRepairableIssues, null, 2));
    assert.equal(duplicateIssue.repairMode, "non_repairable");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("unselected-source equations do not widen the declared review set", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-source-isolation-"));
  try {
    const gardenDir = buildFormulaGarden(root);
    const audit = auditGardenForFinalization(gardenDir, "reviewed-formulas", {
      expectedSourceFormulaReviewContext: EXPECTED_CONTEXT,
    });
    assert.deepEqual(
      [...audit.repairableIssues, ...audit.nonRepairableIssues].filter((issue) =>
        issue.evidence.check === "AI-reviewed source-formula manifest binding"),
      [],
      "S2.P1.E1 belongs to unselected S2 and must not make the S1 manifest fail",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("central finalization binds selected non-formula artifacts but ignores unselected drift", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-artifact-inventory-final-"));
  try {
    const gardenDir = buildFormulaGarden(root);
    const ledgerPath = path.join(gardenDir, ".breadboard", "source-visuals.json");
    const baseline = auditGardenForFinalization(gardenDir, "reviewed-formulas", {
      expectedSourceFormulaReviewContext: EXPECTED_CONTEXT,
    });
    assert.deepEqual(
      [...baseline.repairableIssues, ...baseline.nonRepairableIssues].filter((issue) =>
        issue.evidence.check === "Selected source-artifact inventory binding"),
      [],
    );

    const unselectedTamper = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
    unselectedTamper.find((visual) => visual.sourceVisualId === UNUSED_FORMULA_ID).caption =
      "Changed unselected caption";
    writeJson(ledgerPath, unselectedTamper);
    const unselectedAudit = auditGardenForFinalization(gardenDir, "reviewed-formulas", {
      expectedSourceFormulaReviewContext: EXPECTED_CONTEXT,
    });
    assert.deepEqual(
      [...unselectedAudit.repairableIssues, ...unselectedAudit.nonRepairableIssues].filter(
        (issue) => issue.evidence.check === "Selected source-artifact inventory binding",
      ),
      [],
    );

    const selectedTamper = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
    selectedTamper.find((visual) => visual.sourceVisualId === FIGURE_ID).caption =
      "Changed selected caption";
    writeJson(ledgerPath, selectedTamper);
    const selectedAudit = auditGardenForFinalization(gardenDir, "reviewed-formulas", {
      expectedSourceFormulaReviewContext: EXPECTED_CONTEXT,
    });
    assert.ok(
      selectedAudit.nonRepairableIssues.some((issue) =>
        issue.evidence.check === "Selected source-artifact inventory binding" &&
        /does not match/.test(issue.message)),
      JSON.stringify(selectedAudit.nonRepairableIssues, null, 2),
    );

    const tamperedInventoryHash = selectedSourceArtifactInventorySnapshot({
      selectedSourceIds: ["S1"],
      sourceIdentityMap: SOURCE_IDENTITY_MAP,
      visuals: selectedTamper,
    }).sourceArtifactInventoryHash;
    const contractPath = path.join(gardenDir, ".breadboard", "learning-unit-contract.json");
    const tamperedContract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
    tamperedContract.sourceArtifactInventoryHash = tamperedInventoryHash;
    writeJson(contractPath, tamperedContract);
    const selfConsistentTamper = auditGardenForFinalization(gardenDir, "reviewed-formulas", {
      expectedSourceFormulaReviewContext: EXPECTED_CONTEXT,
    });
    assert.ok(
      selfConsistentTamper.nonRepairableIssues.some((issue) =>
        issue.evidence.check === "Selected source-artifact inventory binding" &&
        /active Learn expectation/.test(issue.message)),
      "re-hashing both the staged ledger and contract must not redefine the confirmed map",
    );

    tamperedContract.sourceArtifactInventoryHash = SOURCE_ARTIFACT_INVENTORY_HASH;
    writeJson(contractPath, tamperedContract);
    fs.unlinkSync(path.join(gardenDir, ".breadboard", "source-visual-source-index.json"));
    const missingRegistry = auditGardenForFinalization(gardenDir, "reviewed-formulas", {
      expectedSourceFormulaReviewContext: EXPECTED_CONTEXT,
    });
    assert.ok(
      missingRegistry.nonRepairableIssues.some((issue) =>
        issue.evidence.check === "Selected source-artifact inventory binding" &&
        /identity registry is missing or empty/.test(issue.message)),
      JSON.stringify(missingRegistry.nonRepairableIssues, null, 2),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("scoped-repair context retains artifact authority when the review manifest is deleted", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-artifact-context-"));
  try {
    const gardenDir = buildFormulaGarden(root);
    fs.unlinkSync(path.join(gardenDir, ".breadboard", "source-formula-review-set.json"));
    const context = sourceFormulaReviewFinalizationContextFromGarden(gardenDir);
    assert.ok(context, "the Learning Unit Contract inventory binding must keep the context active");
    assert.equal(context.sourceArtifactInventoryHash, SOURCE_ARTIFACT_INVENTORY_HASH);
    assert.deepEqual(context.sourceIdentityMap, SOURCE_IDENTITY_MAP);
    assert.equal(context.reviewSetHash, "");

    const contractPath = path.join(gardenDir, ".breadboard", "learning-unit-contract.json");
    const damagedContract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
    damagedContract.learningUnits = [];
    writeJson(contractPath, damagedContract);
    assert.equal(
      sourceFormulaReviewFinalizationContextFromGarden(gardenDir)
        ?.sourceArtifactInventoryHash,
      SOURCE_ARTIFACT_INVENTORY_HASH,
      "an empty/tampered unit payload must not fall through to stale planning authority",
    );
    fs.writeFileSync(contractPath, "{not-json");
    assert.equal(
      sourceFormulaReviewFinalizationContextFromGarden(gardenDir)
        ?.sourceArtifactInventoryHash,
      "",
      "an unreadable canonical contract must retain a fail-closed context instead of falling through",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("finalization binds recovered syllabus evidence to immutable raw source pages", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-syllabus-recovery-final-"));
  try {
    const gardenDir = buildFormulaGarden(root);
    const recovered = await syllabusRecoveryFixture(gardenDir);
    const contractPath = path.join(gardenDir, ".breadboard", "learning-unit-contract.json");
    const originalContract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
    const expectedContext = {
      ...EXPECTED_CONTEXT,
      syllabusCoverageEvidenceRecoveryHash: recovered.receipt.integritySha256,
      syllabusCoverageEvidenceRecovery: recovered.receipt,
    };
    const writeReceipt = (receipt, hash = receipt?.integritySha256 ?? "") => {
      writeJson(contractPath, {
        ...originalContract,
        syllabusCoverageEvidenceRecoveryHash: hash,
        ...(receipt !== undefined
          ? { syllabusCoverageEvidenceRecovery: receipt }
          : {}),
      });
    };

    writeReceipt(recovered.receipt);
    let audit = auditGardenForFinalization(gardenDir, "reviewed-formulas", {
      expectedSourceFormulaReviewContext: expectedContext,
    });
    const recoveryCheck = () => audit.checks.find((check) =>
      check.name === "Syllabus coverage evidence-recovery binding");
    assert.equal(
      recoveryCheck()?.status,
      "PASS",
      JSON.stringify(recoveryCheck(), null, 2),
    );

    writeReceipt(undefined, recovered.receipt.integritySha256);
    audit = auditGardenForFinalization(gardenDir, "reviewed-formulas", {
      expectedSourceFormulaReviewContext: expectedContext,
    });
    assert.ok(recoveryCheck()?.problems.some((problem) =>
      /without its receipt|missing/.test(problem)), JSON.stringify(recoveryCheck(), null, 2));

    const traversalReceipt = structuredClone(recovered.receipt);
    traversalReceipt.sourceBindings[0].relPath = "../outside.md";
    const { integritySha256: _oldIntegrity, ...traversalWithoutIntegrity } = traversalReceipt;
    traversalReceipt.integritySha256 = syllabusCoverageRecoveryReceiptIntegrity(
      traversalWithoutIntegrity,
    );
    writeReceipt(traversalReceipt);
    audit = auditGardenForFinalization(gardenDir, "reviewed-formulas", {
      expectedSourceFormulaReviewContext: {
        ...EXPECTED_CONTEXT,
        syllabusCoverageEvidenceRecoveryHash: traversalReceipt.integritySha256,
        syllabusCoverageEvidenceRecovery: traversalReceipt,
      },
    });
    assert.ok(recoveryCheck()?.problems.some((problem) =>
      /escapes the garden root/.test(problem)), JSON.stringify(recoveryCheck(), null, 2));

    const zero = await syllabusRecoveryFixture(gardenDir, { recovered: false });
    writeReceipt(zero.receipt);
    audit = auditGardenForFinalization(gardenDir, "reviewed-formulas", {
      expectedSourceFormulaReviewContext: {
        ...EXPECTED_CONTEXT,
        syllabusCoverageEvidenceRecoveryHash: zero.receipt.integritySha256,
        syllabusCoverageEvidenceRecovery: zero.receipt,
      },
    });
    assert.ok(recoveryCheck()?.problems.some((problem) =>
      /not a recovered teachable decision/.test(problem)), JSON.stringify(recoveryCheck(), null, 2));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a final-used formula outside the expected reviewed set fails closed", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-used-subset-"));
  try {
    const gardenDir = buildFormulaGarden(root);
    const audit = auditGardenForFinalization(gardenDir, "reviewed-formulas", {
      expectedSourceFormulaReviewContext: {
        ...EXPECTED_CONTEXT,
        formulaIds: [UNUSED_REVIEWED_FORMULA_ID],
      },
    });
    assert.ok(
      audit.nonRepairableIssues.some((issue) =>
        issue.evidence.check === "AI-reviewed source-formula manifest binding" &&
        issue.message === `${FORMULA_ID}: final-used source formula is absent from the AI-reviewed formula set`),
      JSON.stringify(audit.nonRepairableIssues, null, 2),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the no-mutation promotion verifier catches post-review formula tampering", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-promotion-tamper-"));
  try {
    const gardenDir = buildFormulaGarden(root, {
      body: "$$\nE = -mc^2 \\qquad \\text{(1)}\n$$",
    });
    const verification = verifyFinalArtifactNoMutation({
      gardenDir,
      gardenSlug: "reviewed-formulas",
      updateRepairReport: false,
      expectedSourceFormulaReviewContext: EXPECTED_CONTEXT,
    });
    assert.equal(verification.accepted, false);
    assert.ok(
      verification.validationFailures.some((failure) =>
        /not present as an exact visible Quartz display projection/.test(failure)),
      verification.validationFailures.join(" | "),
    );
    assert.deepEqual(verification.mutatedFiles, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an explicit empty review set is validated without coupling legacy visual strictness", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-empty-context-"));
  try {
    const gardenDir = path.join(root, "empty-reviewed-formulas");
    const breadboardDir = path.join(gardenDir, ".breadboard");
    fs.mkdirSync(path.join(gardenDir, "sources"), { recursive: true });
    fs.writeFileSync(path.join(gardenDir, "_index.md"), "---\ntitle: Empty review\n---\n");
    fs.writeFileSync(path.join(gardenDir, "sources", "_index.md"), "---\ntitle: Sources\n---\n");
    const emptyReviewHash = computeSourceFormulaReviewSetHash([], [], ["S1"]);
    const emptyCombinedHash = sourceSetHashWithReviewedFormulas(
      BASE_SOURCE_SET_HASH,
      emptyReviewHash,
    );
    const emptyIdentityMap = [{ sourceId: "S1", sourceIndex: 1 }];
    const emptyArtifactInventoryHash = selectedSourceArtifactInventorySnapshot({
      selectedSourceIds: ["S1"],
      sourceIdentityMap: emptyIdentityMap,
      visuals: [],
    }).sourceArtifactInventoryHash;
    writeJson(path.join(breadboardDir, "source-visuals.json"), []);
    writeJson(path.join(breadboardDir, "source-visual-source-index.json"), {
      schemaVersion: 1,
      sourceIdentityMap: emptyIdentityMap,
    });
    writeJson(path.join(breadboardDir, "learning-unit-contract.json"), {
      sourceSetHash: emptyCombinedHash,
      sourceFormulaReviewSetHash: emptyReviewHash,
      sourceArtifactInventoryHash: emptyArtifactInventoryHash,
      learningUnits: [{
        id: "U1",
        title: "No formulas",
        sourceAnchors: [],
        sourceFigures: [],
        sourceFormulas: [],
        sourceTables: [],
        zettelNotes: [],
      }],
      sourceArtifactAssignments: [],
    });
    writeJson(path.join(breadboardDir, "source-formula-review-set.json"), {
      schemaVersion: 1,
      promptVersion: 1,
      model: "gpt-test",
      sourceIds: ["S1"],
      sourceIdentityMap: emptyIdentityMap,
      sourceIdentityMapHash: sourceVisualSourceIdentityMapHash(emptyIdentityMap),
      formulaIds: [],
      topologyReviewPageReceipts: [],
      reviewSetHash: emptyReviewHash,
      baseSourceSetHash: BASE_SOURCE_SET_HASH,
      combinedSourceSetHash: emptyCombinedHash,
      createdAt: "2026-08-15T00:00:00.000Z",
    });
    const audit = auditGardenForFinalization(gardenDir, "empty-reviewed-formulas", {
      strictModelApprovedVisuals: true,
      expectedSourceFormulaReviewContext: {
        reviewSetHash: emptyReviewHash,
        combinedSourceSetHash: emptyCombinedHash,
        sourceArtifactInventoryHash: emptyArtifactInventoryHash,
        formulaIds: [],
        sourceIds: ["S1"],
        sourceIdentityMap: emptyIdentityMap,
        topologyReviewPageReceipts: [],
        model: "gpt-test",
      },
    });
    const formulaReviewChecks = new Set([
      "AI-reviewed source-formula manifest binding",
      "AI-reviewed source-formula provenance",
      "Reviewed source-formula identity integrity",
      "Reviewed source-formula page projection",
    ]);
    assert.deepEqual(
      [...audit.repairableIssues, ...audit.nonRepairableIssues]
        .filter((issue) => formulaReviewChecks.has(issue.evidence.check)),
      [],
    );

    const topologyReceipt = {
      recoveryProtocol: "v7",
      sourceId: "S1",
      pageNumber: 1,
      pageImagePath: "/empty-reviewed-formulas/assets/src-page-001.png",
      recoveryCacheKey: "c".repeat(64),
      recoveryCacheIntegritySha256: "d".repeat(64),
      topologyReviewCacheKey: "e".repeat(64),
      topologyReviewCacheIntegritySha256: "f".repeat(64),
      activeFormulaIds: [],
    };
    const tombstoneReviewHash = computeSourceFormulaReviewSetHash(
      [],
      [],
      ["S1"],
      [{ sourceId: "S1", sourceIndex: 1 }],
      [topologyReceipt],
    );
    assert.notEqual(
      tombstoneReviewHash,
      computeSourceFormulaReviewSetHash(
        [],
        [],
        ["S1"],
        [{ sourceId: "S1", sourceIndex: 1 }],
        [{ ...topologyReceipt, recoveryProtocol: "v6" }],
      ),
      "the review-set hash must bind the exact recovery protocol",
    );
    assert.throws(
      () => computeSourceFormulaReviewSetHash(
        [],
        [],
        ["S1"],
        [{ sourceId: "S1", sourceIndex: 1 }],
        [{
          sourceId: topologyReceipt.sourceId,
          pageNumber: topologyReceipt.pageNumber,
          pageImagePath: topologyReceipt.pageImagePath,
          recoveryCacheKey: topologyReceipt.recoveryCacheKey,
          recoveryCacheIntegritySha256: topologyReceipt.recoveryCacheIntegritySha256,
          topologyReviewCacheKey: topologyReceipt.topologyReviewCacheKey,
          topologyReviewCacheIntegritySha256: topologyReceipt.topologyReviewCacheIntegritySha256,
          activeFormulaIds: [],
        }],
      ),
      /unsupported or missing fields/,
    );
    const tombstoneCombinedHash = sourceSetHashWithReviewedFormulas(
      BASE_SOURCE_SET_HASH,
      tombstoneReviewHash,
    );
    const contractPath = path.join(breadboardDir, "learning-unit-contract.json");
    const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
    contract.sourceSetHash = tombstoneCombinedHash;
    contract.sourceFormulaReviewSetHash = tombstoneReviewHash;
    writeJson(contractPath, contract);
    const manifestPath = path.join(breadboardDir, "source-formula-review-set.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.topologyReviewPageReceipts = [topologyReceipt];
    manifest.reviewSetHash = tombstoneReviewHash;
    manifest.combinedSourceSetHash = tombstoneCombinedHash;
    writeJson(manifestPath, manifest);
    const tombstoneContext = {
      reviewSetHash: tombstoneReviewHash,
      combinedSourceSetHash: tombstoneCombinedHash,
      sourceArtifactInventoryHash: emptyArtifactInventoryHash,
      formulaIds: [],
      sourceIds: ["S1"],
      sourceIdentityMap: emptyIdentityMap,
      topologyReviewPageReceipts: [topologyReceipt],
      model: "gpt-test",
    };
    assert.deepEqual(
      sourceFormulaReviewFinalizationContextFromGarden(gardenDir)
        ?.topologyReviewPageReceipts,
      [topologyReceipt],
      "scoped repair must capture the canonical V7 tombstone before staging",
    );
    const missingDurableReceipt = auditGardenForFinalization(
      gardenDir,
      "empty-reviewed-formulas",
      { expectedSourceFormulaReviewContext: tombstoneContext },
    );
    assert.ok(
      missingDurableReceipt.nonRepairableIssues.some((issue) =>
        issue.evidence.check === "AI-reviewed source-formula provenance" &&
        /topology page receipts are missing, changed, or contain an unexpected page/.test(issue.message)),
      JSON.stringify(missingDurableReceipt.nonRepairableIssues, null, 2),
    );

    manifest.topologyReviewPageReceipts = [{
      ...topologyReceipt,
      recoveryProtocol: "v6",
    }];
    writeJson(manifestPath, manifest);
    const protocolTamper = auditGardenForFinalization(
      gardenDir,
      "empty-reviewed-formulas",
      { expectedSourceFormulaReviewContext: tombstoneContext },
    );
    assert.ok(
      protocolTamper.nonRepairableIssues.some((issue) =>
        issue.evidence.check === "AI-reviewed source-formula manifest binding" &&
        /topology page receipts do not match the active Learn expectation/.test(issue.message)),
      JSON.stringify(protocolTamper.nonRepairableIssues, null, 2),
    );

    delete manifest.topologyReviewPageReceipts;
    writeJson(manifestPath, manifest);
    const deletedManifestReceipt = auditGardenForFinalization(
      gardenDir,
      "empty-reviewed-formulas",
      { expectedSourceFormulaReviewContext: tombstoneContext },
    );
    assert.ok(
      deletedManifestReceipt.nonRepairableIssues.some((issue) =>
        issue.evidence.check === "AI-reviewed source-formula manifest binding" &&
        /topologyReviewPageReceipts are invalid/.test(issue.message)),
      JSON.stringify(deletedManifestReceipt.nonRepairableIssues, null, 2),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
