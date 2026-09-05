import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  incrementalLearningUnitPreservationProblems,
  incrementalSourceMapPreservationProblems,
  incrementalSourceQuestionPreservationProblems,
  publishedLearningPagesByUnitId,
  readIncrementalLearnBaseline,
  semanticLearningUnitForIncrementalUpdate,
} from "../src/lib/learn-incremental.ts";
import { createLearnBuildWorkspace } from "../src/lib/learn-build-workspace.ts";

function unit(id, title = id) {
  return {
    id,
    title,
    role: "core_concept",
    learningQuestion: `What is ${title}?`,
    prerequisiteConcepts: [],
    newConcepts: [title],
    syllabusUnitIds: [],
    sourceAnchors: [`anchor-${id}`],
    sourceFigures: [],
    sourceFormulas: [],
    sourceTables: [],
    sourceQuestions: [],
    zettelNotes: [],
    semanticConcepts: [{
      slug: title.toLowerCase(),
      preferredLabel: title,
      role: "primary",
      aliases: [],
      evidenceAnchors: [`anchor-${id}`],
    }],
    knowledgeClaims: [],
    mustNotRepeat: [],
    expectedWordRange: [700, 900],
    sectionPlan: {
      id: "S1",
      title: "Foundations",
      purpose: "Build the foundations.",
    },
  };
}

test("additive contract validation allows insertion but rejects edits, deletion, and reordering", () => {
  const first = unit("U1", "Alpha");
  const second = unit("U2", "Beta");
  const inserted = unit("U3", "Bridge");
  assert.deepEqual(
    incrementalLearningUnitPreservationProblems(
      [first, inserted, second],
      [first, second],
    ),
    [],
  );
  assert.match(
    incrementalLearningUnitPreservationProblems(
      [{ ...first, title: "Changed" }, second],
      [first, second],
    ).join(" "),
    /existing unit "U1" changed/,
  );
  assert.match(
    incrementalLearningUnitPreservationProblems([second], [first, second]).join(" "),
    /existing unit "U1" was removed/,
  );
  assert.match(
    incrementalLearningUnitPreservationProblems([second, first], [first, second]).join(" "),
    /changed relative order/,
  );
});

test("visual presentation fields do not make a preserved semantic unit look changed", () => {
  const baseline = unit("U1", "Alpha");
  const routed = {
    ...baseline,
    interactiveVisual: { id: "visual-u1" },
    interactiveVisualPlan: { requirement: "not_needed" },
    teachingMediumPlan: { preferredMedium: "prose" },
  };
  assert.deepEqual(semanticLearningUnitForIncrementalUpdate(routed), baseline);
  assert.deepEqual(
    incrementalLearningUnitPreservationProblems([routed], [baseline]),
    [],
  );
});

test("existing source-question identities survive an additive source-map update", () => {
  const oldQuestion = {
    id: "Q1",
    sourceId: "old-source",
    label: "Problem 1",
    prompt: "Explain alpha.",
    sourceAnchorIds: ["anchor-U1"],
    relatedFigureIds: [],
    syllabusAssignments: [],
    teachingValue: "Practice alpha.",
  };
  assert.deepEqual(
    incrementalSourceQuestionPreservationProblems(
      {
        sourceQuestions: [
          {
            teachingValue: oldQuestion.teachingValue,
            syllabusAssignments: oldQuestion.syllabusAssignments,
            relatedFigureIds: oldQuestion.relatedFigureIds,
            sourceAnchorIds: oldQuestion.sourceAnchorIds,
            prompt: oldQuestion.prompt,
            label: oldQuestion.label,
            sourceId: oldQuestion.sourceId,
            id: oldQuestion.id,
          },
          { ...oldQuestion, id: "Q2" },
        ],
      },
      { sourceQuestions: [oldQuestion] },
    ),
    [],
  );
  assert.match(
    incrementalSourceQuestionPreservationProblems(
      { sourceQuestions: [{ ...oldQuestion, prompt: "Changed" }] },
      { sourceQuestions: [oldQuestion] },
    ).join(" "),
    /existing source question "Q1" changed/,
  );
});

test("existing source-anchor identities survive an additive source-map update", () => {
  const oldAnchor = {
    id: "source-a:p1",
    sourceId: "source-a",
    title: "Alpha",
    summary: "The original grounding record.",
  };
  assert.deepEqual(
    incrementalSourceMapPreservationProblems(
      {
        sourceAnchors: [oldAnchor, { ...oldAnchor, id: "source-b:p2" }],
        sourceQuestions: [],
      },
      { sourceAnchors: [oldAnchor], sourceQuestions: [] },
    ),
    [],
  );
  assert.match(
    incrementalSourceMapPreservationProblems(
      {
        sourceAnchors: [{ ...oldAnchor, summary: "Changed" }],
        sourceQuestions: [],
      },
      { sourceAnchors: [oldAnchor], sourceQuestions: [] },
    ).join(" "),
    /existing source anchor "source-a:p1" changed/,
  );
});

test("published lesson bodies and the semantic baseline are recovered by stable unit id", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-learn-update-baseline-"));
  try {
    fs.mkdirSync(path.join(root, ".breadboard"), { recursive: true });
    fs.mkdirSync(path.join(root, "learning", "1. Foundations"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".breadboard", "learning-unit-contract.json"),
      `${JSON.stringify({ learningUnits: [unit("U1", "Alpha")], sourceArtifactOmissions: [] }, null, 2)}\n`,
    );
    fs.writeFileSync(
      path.join(root, "learning", "1. Foundations", "1.1 Alpha.md"),
      `---\ntitle: "1.1 Alpha"\nlearningUnitId: "U1"\n---\n\nAlpha body stays exactly here.\n`,
    );
    const baseline = readIncrementalLearnBaseline(root);
    assert.equal(baseline?.learningUnits[0]?.id, "U1");
    const pages = publishedLearningPagesByUnitId(root);
    assert.equal(pages.get("U1")?.body, "Alpha body stays exactly here.");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("update workspaces seed reusable visual implementations but never stale learning paths", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-learn-update-workspace-"));
  const repository = path.join(root, "garden");
  const workspaceRoot = path.join(root, "workspace");
  try {
    fs.mkdirSync(path.join(repository, "learning", "1. Old"), { recursive: true });
    fs.mkdirSync(path.join(repository, ".breadboard", "visuals"), { recursive: true });
    fs.writeFileSync(path.join(repository, "learning", "1. Old", "1.1 Old.md"), "old");
    fs.writeFileSync(path.join(repository, ".breadboard", "visuals", "v1.json"), "{}\n");
    fs.writeFileSync(path.join(repository, ".breadboard", "visual-index.json"), "{}\n");
    const workspace = createLearnBuildWorkspace({
      gardenSlug: "garden",
      jobId: "job-update",
      mode: "update",
      repositoryGardenDir: repository,
      contractFingerprint: "contract",
      sourceSetFingerprint: "sources",
      workspaceRoot,
    });
    assert.equal(fs.existsSync(workspace.stagingLearningDir), false);
    assert.equal(
      fs.existsSync(path.join(workspace.stagingGardenDir, ".breadboard", "visuals", "v1.json")),
      true,
    );
    assert.equal(
      fs.existsSync(path.join(workspace.stagingGardenDir, ".breadboard", "visual-index.json")),
      true,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the Learn route and workspace choose additive planning for new material", () => {
  const executorSource = fs.readFileSync(
    new URL("../src/lib/learn-operation-executor.ts", import.meta.url),
    "utf8",
  );
  const learnSource = fs.readFileSync(
    new URL("../src/lib/learn.ts", import.meta.url),
    "utf8",
  );
  const workspaceSource = fs.readFileSync(
    new URL(
      "../src/app/gardens/[clusterSlug]/workspace-client.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(
    executorSource,
    /mode: additiveUpdate \? "update_sources" : "plan"/,
  );
  assert.match(
    executorSource,
    /status\.job\.confirmedLearningMapId === status\.confirmedLearningMapId/,
  );
  assert.match(
    learnSource,
    /Insert each new unit at the pedagogically best position among the existing units; do not merely append/,
  );
  assert.match(
    workspaceSource,
    /hasLocallyAddedLearnMaterial =[\s\S]*?effectiveLearnIncludedSourceSlugs\.some/,
  );
  assert.match(
    workspaceSource,
    /shouldAddNewLearnMaterial =[\s\S]*?sourceSetChanged[\s\S]*?hasLocallyAddedLearnMaterial/,
  );
  assert.match(
    workspaceSource,
    /learnState\.job\.confirmedLearningMapId ===[\s\S]*?learnState\.confirmedLearningMapId/,
  );
});
