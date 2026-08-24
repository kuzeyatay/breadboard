import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  LEARNING_SPINE_ARTIFACT_CATALOG_REF,
  projectCanonicalLearningSpinePacket,
} from "../src/lib/learning-spine-prompt-projection.ts";

function artifact(index, overrides = {}) {
  return {
    id: `S1.P${index + 1}.F1`,
    sourceId: "source-a",
    kind: "figure",
    page: index + 1,
    caption: `Canonical artifact caption ${index}`,
    suggestedVisualUse: `Canonical use ${index}`,
    ...overrides,
  };
}

function sourceMapFigure(item, overrides = {}) {
  return {
    id: item.id,
    sourceId: item.sourceId,
    kind: item.kind,
    caption: item.caption,
    teachingValue: `Teaching value for ${item.id}`,
    ...overrides,
  };
}

function packetInput(count = 3) {
  const artifacts = Array.from({ length: count }, (_, index) => artifact(index));
  const conceptNodes = [{
    title: "Boundary conditions",
    excerpt: "Distinct semantic evidence retained for the spine.",
    sourceDocument: "source-a",
    locations: ["Page 12"],
  }];
  const sourceAnchors = [{
    id: "text-source-a-page-12",
    sourceId: "source-a",
    summary: "Boundary evidence",
  }];
  return {
    sourceOnly: true,
    syllabus: { courseTitle: "Electromagnetics" },
    syllabusCoverage: { units: [{ unitId: "SU1" }] },
    sourceMap: {
      sources: [{
        id: "source-a",
        title: "Source A",
        role: "Primary evidence",
        centralConcepts: ["fields"],
      }],
      figures: artifacts.map((item) => sourceMapFigure(item)),
      sourceAnchors,
      missingOrUnclear: [],
    },
    scopeContract: { included: ["fields"], excluded: [] },
    sources: {
      gardenId: "garden-a",
      gardenTitle: "Garden A",
      sourceSetHash: "source-hash",
      sourceArtifactInventoryHash: "artifact-hash",
      sources: [{ id: "source-a", title: "Source A", excerpt: "Source excerpt" }],
      conceptNodes,
      sourceVisuals: artifacts.map((item) => ({
        sourceVisualId: item.id,
        sourceId: item.sourceId,
        page: item.page,
        kind: item.kind,
        caption: item.caption,
      })),
      sourceFigures: artifacts.map((item) => ({ ...item })),
    },
    extractedSourceArtifacts: artifacts,
    responseShape: "LearningUnitContract JSON",
  };
}

test("serializes a large artifact payload exactly once and keeps semantic evidence", () => {
  const input = packetInput(260);
  input.sourceMap.figures[1] = sourceMapFigure(input.extractedSourceArtifacts[1], {
    caption: "Distinct model-authored Source Map caption",
    selectionRationale: "This diagram connects two prerequisite ideas.",
  });
  const before = structuredClone(input);

  const projected = projectCanonicalLearningSpinePacket(input);
  const serialized = JSON.stringify(projected);

  assert.equal(projected.extractedSourceArtifacts.length, 260);
  assert.equal(projected.sources.sourceVisuals, undefined);
  assert.equal(projected.sources.sourceFigures, undefined);
  assert.equal(projected.sourceMap.figures, undefined);
  assert.equal(
    projected.sources.sourceArtifactCatalogRef,
    LEARNING_SPINE_ARTIFACT_CATALOG_REF,
  );
  assert.equal(
    projected.sourceMap.sourceArtifactCatalogRef,
    LEARNING_SPINE_ARTIFACT_CATALOG_REF,
  );

  for (const item of input.extractedSourceArtifacts) {
    assert.equal(serialized.split(`\"${item.id}\"`).length - 1, 1, `${item.id} must have one payload`);
    assert.equal(serialized.split(`\"${item.caption}\"`).length - 1, 1, `${item.id} caption must not repeat`);
  }
  assert.deepEqual(projected.extractedSourceArtifacts[0].sourceMapAnnotation, {
    teachingValue: `Teaching value for ${input.extractedSourceArtifacts[0].id}`,
  });
  assert.deepEqual(projected.extractedSourceArtifacts[1].sourceMapAnnotation, {
    caption: "Distinct model-authored Source Map caption",
    teachingValue: `Teaching value for ${input.extractedSourceArtifacts[1].id}`,
    selectionRationale: "This diagram connects two prerequisite ideas.",
  });

  assert.equal(projected.sources.conceptNodes, input.sources.conceptNodes);
  assert.equal(projected.sourceMap.sources, input.sourceMap.sources);
  assert.equal(projected.sourceMap.sourceAnchors, input.sourceMap.sourceAnchors);
  assert.equal(projected.syllabus, input.syllabus);
  assert.equal(projected.syllabusCoverage, input.syllabusCoverage);
  assert.equal(projected.scopeContract, input.scopeContract);
  assert.deepEqual(input, before, "projection must not mutate validated planner inputs");
});

test("fails closed when canonical artifacts and validated Source Map references drift", () => {
  const missing = packetInput(2);
  missing.sourceMap.figures.pop();
  assert.throws(
    () => projectCanonicalLearningSpinePacket(missing),
    /is missing from the validated Source Map/,
  );

  const unknown = packetInput(1);
  unknown.sourceMap.figures.push(sourceMapFigure(artifact(9)));
  assert.throws(
    () => projectCanonicalLearningSpinePacket(unknown),
    /is absent from the canonical Learning Spine catalog/,
  );

  const duplicate = packetInput(1);
  duplicate.extractedSourceArtifacts.push({ ...duplicate.extractedSourceArtifacts[0] });
  assert.throws(
    () => projectCanonicalLearningSpinePacket(duplicate),
    /appears more than once/,
  );

  const mismatched = packetInput(1);
  mismatched.sourceMap.figures[0].sourceId = "source-b";
  assert.throws(
    () => projectCanonicalLearningSpinePacket(mismatched),
    /does not match its canonical sourceId and kind/,
  );
});

test("Learn keeps strict contract validators on the unprojected canonical registry", () => {
  const learnSource = fs.readFileSync(new URL("../src/lib/learn.ts", import.meta.url), "utf8");
  const packetStart = learnSource.indexOf("const topicMapPlanningPacket = () =>");
  const targetedRepairStart = learnSource.indexOf("runLearningSpineTargetedRepair({", packetStart);
  const contractBlock = learnSource.slice(packetStart, targetedRepairStart);

  assert.match(contractBlock, /projectCanonicalLearningSpinePacket\(\{/);
  assert.match(contractBlock, /kind:\s*sourceMapArtifactKind\(figure\.kind\)/);
  assert.match(
    contractBlock,
    /sourceArtifactCoverageProblems\([\s\S]*?registeredArtifactsFromFigures\(context\.sourceFigures\)/,
  );
  assert.match(
    contractBlock,
    /validateLearningUnitContracts\(learningUnits,[\s\S]*?requireModelAuthoredSemantics:\s*true[\s\S]*?requireModelAuthoredSections:\s*true/,
  );
  assert.match(
    learnSource,
    /extractedSourceArtifacts is the request's single canonical source-artifact catalog/,
  );
});
