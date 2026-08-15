import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

import {
  finalizeGardenExport,
  repairLearningUnitsFromContract,
} from "../src/lib/garden-finalize.ts";

const finalizerPath = path.resolve(import.meta.dirname, "../src/lib/garden-finalize.ts");
const finalizerSource = fs.readFileSync(finalizerPath, "utf-8");
const finalizerAst = ts.createSourceFile(
  finalizerPath,
  finalizerSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);

function namedFunction(name) {
  let found;
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    if (!found) ts.forEachChild(node, visit);
  };
  visit(finalizerAst);
  assert.ok(found, `expected function ${name}`);
  return found;
}

function strictGuardedCalls(fn, callName) {
  const calls = [];
  const visit = (node, underStrictGuard = false) => {
    if (ts.isIfStatement(node)) {
      const guard = node.expression.getText(finalizerAst);
      const guarded = underStrictGuard || /!\s*preserveModelAuthoredContent\b/.test(guard);
      visit(node.expression, underStrictGuard);
      visit(node.thenStatement, guarded);
      if (node.elseStatement) visit(node.elseStatement, underStrictGuard);
      return;
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === callName) {
      calls.push({ node, underStrictGuard });
    }
    ts.forEachChild(node, (child) => visit(child, underStrictGuard));
  };
  visit(fn);
  return calls;
}

function frontmatter(values) {
  return `---\n${Object.entries(values)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join("\n")}\n---\n\n`;
}

function makeStrictBoundaryGarden() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-strict-finalize-"));
  const gardenDir = path.join(root, "strict-garden");
  const breadboardDir = path.join(gardenDir, ".breadboard");
  const sectionDir = path.join(gardenDir, "learning", "1. Foundations");
  const pageRel = "learning/1. Foundations/1.1 Accuracy.md";
  const pagePath = path.join(gardenDir, ...pageRel.split("/"));
  fs.mkdirSync(path.join(breadboardDir, "planning"), { recursive: true });
  fs.mkdirSync(sectionDir, { recursive: true });
  fs.mkdirSync(path.join(gardenDir, "sources"), { recursive: true });

  fs.writeFileSync(
    path.join(gardenDir, "_index.md"),
    frontmatter({ title: "Strict garden", knowledge_type: "cluster-index" }) + "# Strict garden\n",
  );
  fs.writeFileSync(
    path.join(gardenDir, "learning", "_index.md"),
    frontmatter({ title: "Learning", breadboardType: "learning_index" }) +
      "# Learning\n\n- [[learning/1. Foundations/_index|1. Foundations]]\n",
  );
  fs.writeFileSync(
    path.join(sectionDir, "_index.md"),
    frontmatter({ title: "1. Foundations", breadboardType: "textbook_section" }) +
      "# 1. Foundations\n\n- [[learning/1. Foundations/1.1 Accuracy|1.1 Accuracy]]\n",
  );
  fs.writeFileSync(
    path.join(gardenDir, "sources", "_index.md"),
    frontmatter({ title: "Sources", breadboardType: "source_index" }) + "# Sources\n",
  );
  fs.writeFileSync(
    path.join(gardenDir, "sources", "source.md"),
    frontmatter({ title: "Source", breadboardType: "source_document", sourceId: "source" }) +
      "# Page 1\n\nAccuracy is the number of correct predictions divided by the total number of predictions.\n",
  );

  const contract = {
    sourceSetHash: "strict-fixture",
    generatedAt: "2026-08-14T00:00:00.000Z",
    learningUnits: [{
      id: "U1",
      role: "metric",
      title: "Accuracy",
      learningQuestion: "How is accuracy calculated?",
      prerequisiteConcepts: [],
      newConcepts: ["classification-accuracy"],
      sourceAnchors: ["text-source-page-1", "S1.P1.E1"],
      sourceFigures: [],
      sourceFormulas: [{
        id: "S1.P1.E1",
        placement: "after_formula_introduction",
        reason: "The source defines classification accuracy.",
        requiredInterpretation: "Interpret correct predictions relative to all predictions.",
      }],
      sourceTables: [],
      zettelNotes: [{
        handle: "classification-accuracy",
        claim: "Classification accuracy compares correct predictions with all predictions.",
        connectedTo: [],
      }],
      semanticConcepts: [{
        slug: "classification-accuracy",
        preferredLabel: "Classification accuracy",
        role: "primary",
        aliases: [],
        evidenceAnchors: ["text-source-page-1", "S1.P1.E1"],
      }],
      // An explicit empty model-authored claim list is valid. The legacy
      // zettelNote above must never be promoted into a knowledge claim here.
      knowledgeClaims: [],
      mustNotRepeat: [],
      expectedWordRange: [120, 240],
    }],
    sourceArtifactAssignments: [{
      sourceArtifactId: "S1.P1.E1",
      assignedLearningUnitId: "U1",
      placement: "after_formula_introduction",
      reason: "The source defines classification accuracy.",
      requiredInterpretation: "Interpret correct predictions relative to all predictions.",
    }],
  };
  const contractPath = path.join(breadboardDir, "learning-unit-contract.json");
  fs.writeFileSync(contractPath, `${JSON.stringify(contract, null, 2)}\n`);

  const anchorLedgerPath = path.join(breadboardDir, "source-anchors.json");
  fs.writeFileSync(anchorLedgerPath, `${JSON.stringify({
    sourceTextConceptAnchors: [],
    sourceStructuralAnchors: [],
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(breadboardDir, "visual-index.json"), "{}\n");
  fs.writeFileSync(path.join(breadboardDir, "source-visuals.json"), `${JSON.stringify([{
    sourceVisualId: "S1.P1.E1",
    sourceId: "source",
    pageNumber: 1,
    type: "equation",
    caption: "Classification accuracy as correct predictions over total predictions",
    exactText: "A = N_{correct} / N_{total}",
    usageStatus: "assigned",
    assignedLearningUnitId: "U1",
    assignedPageId: pageRel,
  }], null, 2)}\n`);

  fs.writeFileSync(
    pagePath,
    frontmatter({
      title: "1.1 Accuracy",
      knowledge_type: "learning-page",
      breadboardType: "learning_page",
      generatedBy: "learn_button",
      generated_by: "learn_button",
      learningUnitId: "U1",
      learningUnitRole: "metric",
      sourceAnchors: ["text-source-page-1", "text-source-page-2", "S1.P1.E1"],
      sourceFormulaAnchors: [],
      primaryConcepts: ["classification-accuracy"],
      supportingConcepts: [],
      tags: ["classification-accuracy"],
      claimIds: [],
    }) +
      "# 1.1 Accuracy\n\nAccuracy measures the share of predictions that are correct.\n\n" +
      "$$A = N_{correct} / N_{total}$$\n",
  );

  return { root, gardenDir, contractPath, anchorLedgerPath, pagePath };
}

function semanticSnapshot(paths) {
  return {
    contract: fs.readFileSync(paths.contractPath, "utf-8"),
    anchors: fs.readFileSync(paths.anchorLedgerPath, "utf-8"),
    page: fs.readFileSync(paths.pagePath, "utf-8"),
  };
}

test("strict finalization statically guards every reachable semantic reconciler", () => {
  const cases = [
    ["finalizeGardenExport", [
      "regroundFormulas",
      "registerExistingTextAnchors",
      "synchronizeContractSourceAnchors",
      "reconcileFinalGardenSemantics",
      "reconcileFinalGardenState",
    ]],
    ["repairLearningUnitsFromContract", [
      "migrateGardenSemantics",
      "repairSourceTextConceptAnchors",
      "repairLearningUnitSourceTextAnchors",
      "regroundFormulas",
      "registerExistingTextAnchors",
      "synchronizeContractSourceAnchors",
      "reconcileFinalGardenState",
    ]],
  ];

  for (const [functionName, callNames] of cases) {
    const fn = namedFunction(functionName);
    for (const callName of callNames) {
      const calls = strictGuardedCalls(fn, callName);
      assert.ok(calls.length > 0, `expected ${functionName} to retain legacy ${callName}`);
      assert.equal(
        calls.some((call) => !call.underStrictGuard),
        false,
        `${functionName} must not call ${callName} outside !preserveModelAuthoredContent`,
      );
    }
  }
});

test("strict export leaves model formulas, source anchors, concepts, and empty claims byte-for-byte intact", (t) => {
  const fixture = makeStrictBoundaryGarden();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const before = semanticSnapshot(fixture);

  const report = finalizeGardenExport({
    gardenDir: fixture.gardenDir,
    gardenSlug: "strict-garden",
    preserveModelAuthoredContent: true,
  });

  assert.deepEqual(semanticSnapshot(fixture), before);
  const contract = JSON.parse(fs.readFileSync(fixture.contractPath, "utf-8"));
  assert.deepEqual(contract.learningUnits[0].knowledgeClaims, []);
  assert.equal(
    report.criticalProblems.some((problem) => /formula|anchor/i.test(problem)),
    true,
    "missing or mismatched model metadata must remain a validation blocker",
  );
});

test("strict contract repair ignores a requested deterministic executor and preserves semantic files", async (t) => {
  const fixture = makeStrictBoundaryGarden();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const before = semanticSnapshot(fixture);

  const report = await repairLearningUnitsFromContract({
    gardenDir: fixture.gardenDir,
    gardenSlug: "strict-garden",
    repairExecutor: "deterministic",
    preserveModelAuthoredContent: true,
    preserveModelAuthoredVisuals: true,
  });

  assert.deepEqual(semanticSnapshot(fixture), before);
  assert.ok(report.requests.length > 0, "fixture must exercise the repair path");
  assert.equal(
    report.repairs.some((repair) =>
      repair.executorAttempted.includes("deterministic") || repair.executorUsed === "deterministic"),
    false,
  );
  assert.equal(
    report.finalValidationFailures.some((problem) => /formula|anchor/i.test(problem)),
    true,
    "strict repair must leave invalid model metadata unresolved for a later model attempt",
  );
  const contract = JSON.parse(fs.readFileSync(fixture.contractPath, "utf-8"));
  assert.deepEqual(contract.learningUnits[0].knowledgeClaims, []);
});
