import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  applyVisualizationRoutesToLearningUnits,
  buildVisualizationCoverageReport,
  buildVisualizationPlan,
} from "../src/lib/visualization-opportunities.ts";
import {
  buildGeneratedVisualBlock,
  compileGeneratedVisualization,
  createGeneratedVisualization,
  loadGeneratedVisualDefinition,
  loadGeneratedVisualManifest,
  normalizeDetailedGeneratedVisualCriticRecord,
  parseGeneratedVisualBlock,
  rollbackGeneratedVisualization,
  runGeneratedVisualBrowserTests,
  runGeneratedVisualDeterministicTests,
  validateGeneratedVisualizationManifest,
} from "../src/lib/generated-visuals.ts";

function unit(overrides = {}) {
  return {
    id: "U1",
    title: "Explore an unusual state machine",
    role: "application",
    learningQuestion: "How does changing gain alter coupled-state propagation under intervention?",
    prerequisiteConcepts: [],
    newConcepts: ["coupled state propagation"],
    sourceAnchors: ["S1.P2.F1"],
    sourceFigures: [],
    sourceFormulas: [],
    sourceTables: [],
    interactiveVisual: {
      id: "state-propagation",
      uniqueConcept: "intervening on coupled state propagation",
      visualType: "coupled_state_intervention",
      whyStaticSourceFigureIsNotEnough: "The learner must change one state and inspect propagation.",
      learnerManipulates: ["gain"],
      expectedInsight: "local interventions can amplify or damp downstream states",
      sourceAnchors: ["S1.P2.F1"],
      duplicateSignature: "coupled-state-intervention",
    },
    zettelNotes: [],
    semanticConcepts: [{ slug: "coupled-state-propagation", preferredLabel: "Coupled state propagation", role: "primary", aliases: [], evidenceAnchors: ["S1.P2.F1"] }],
    knowledgeClaims: [],
    mustNotRepeat: [],
    expectedWordRange: [700, 1100],
    ...overrides,
  };
}

function learningMap(units) {
  return {
    gardenId: "demo",
    title: "State propagation",
    summary: "Learn through intervention.",
    sourceOnly: true,
    createdAt: "2026-07-16T00:00:00.000Z",
    warnings: [],
    sections: [{
      id: "section-1",
      title: "Coupled states",
      purpose: "Understand propagation.",
      sourceAnchors: ["S1.P2.F1"],
      subsections: units.map((candidate, index) => ({
        id: `subsection-${index + 1}`,
        title: candidate.title,
        purpose: candidate.learningQuestion,
        sourceAnchors: candidate.sourceAnchors,
        conceptTags: candidate.newConcepts,
        learningUnitId: candidate.id,
      })),
    }],
  };
}

test("opportunity analysis covers every unit and routes a non-catalog interaction to generation", () => {
  const units = [unit()];
  const plan = buildVisualizationPlan({ gardenId: "demo", learningMap: learningMap(units), learningUnits: units });
  assert.equal(plan.opportunities.length, 1);
  assert.equal(plan.opportunities[0].learningUnitId, "U1");
  assert.equal(plan.decisions[0].route, "generated_module");
  assert.equal(plan.opportunities[0].requiresGeneratedModule, true);
});

test("representative fixtures route only the units that pass visual necessity", () => {
  const customVisual = (id, concept) => ({
    id,
    uniqueConcept: concept,
    visualType: `${id}_custom`,
    whyStaticSourceFigureIsNotEnough: "The learner must manipulate or step through the relationship.",
    learnerManipulates: ["parameter"],
    expectedInsight: `Understand ${concept} by experimentation`,
    sourceAnchors: [`S1.${id}.E1`],
    duplicateSignature: id,
  });
  const fixture = (id, title, role, extra = {}) => unit({
    id,
    title,
    role,
    learningQuestion: `How does ${title.toLowerCase()} work?`,
    newConcepts: [title],
    semanticConcepts: [{ slug: id.toLowerCase(), preferredLabel: title, role: "primary", aliases: [], evidenceAnchors: [`S1.${id}.E1`] }],
    sourceAnchors: [`S1.${id}.E1`],
    interactiveVisual: undefined,
    ...extra,
  });
  const fixtures = [
    fixture("MATH", "Nonlinear parameter equation", "formula", {
      sourceFormulas: [{ id: "S1.MATH.E1", teachingGoal: "inspect the curve", termsToDefine: ["parameter"], placement: "before_example" }],
    }),
    fixture("TIME", "Time-dependent signal trajectory", "mechanism", {
      learningQuestion: "How does changing signal rate alter the trajectory over time?",
      interactiveVisual: customVisual("time", "signal evolution"),
    }),
    fixture("BIO", "Biological membrane mechanism", "mechanism", {
      learningQuestion: "How does changing membrane current alter voltage feedback?",
      interactiveVisual: customVisual("bio", "membrane feedback"),
    }),
    fixture("ALGO", "Algorithm execution step by step", "application", { interactiveVisual: customVisual("algo", "algorithm state") }),
    fixture("COMPARE", "Architecture comparison trade-off", "comparison", { interactiveVisual: customVisual("compare", "architecture trade-off") }),
    fixture("FIGURE", "Reconstructing a source figure", "core_concept", {
      sourceFigures: [{ id: "S1.FIGURE.F1", placement: "inside_concept_explanation", mustBeDiscussedWith: "the source trend", interpretationGoal: "inspect the source relationship" }],
      interactiveVisual: customVisual("figure", "source-figure reconstruction"),
    }),
    fixture("NOVIS", "Historical terminology", "motivation", {
      learningQuestion: "What terminology is used in the chapter?",
      newConcepts: ["terminology"],
      semanticConcepts: [{ slug: "terminology", preferredLabel: "Terminology", role: "primary", aliases: [], evidenceAnchors: ["S1.NOVIS.T1"] }],
    }),
  ];
  const plan = buildVisualizationPlan({ gardenId: "fixtures", learningMap: learningMap(fixtures), learningUnits: fixtures });
  assert.equal(plan.opportunities.length, 4);
  assert.deepEqual(
    plan.opportunities.map((opportunity) => opportunity.learningUnitId),
    ["MATH", "TIME", "BIO", "COMPARE"],
  );
  assert.ok(plan.decisions.every((decision) => decision.route !== "intentional_omission"), JSON.stringify(plan.decisions));
  const nonInteractive = new Map(plan.teachingMedia.map((medium) => [medium.unitId, medium.preferredMedium]));
  assert.equal(nonInteractive.get("FIGURE"), "source_figure");
  assert.ok(["prose", "timeline"].includes(nonInteractive.get("NOVIS")));
});

test("semantic duplicate opportunities are removed by garden coordination before routing", () => {
  const first = unit();
  const second = unit({ id: "U2" });
  const units = [first, second];
  const plan = buildVisualizationPlan({ gardenId: "demo", learningMap: learningMap(units), learningUnits: units });
  assert.equal(plan.opportunities.length, 1);
  const duplicateDecision = plan.visualNecessityDecisions.find((decision) => decision.unitId === "U2");
  assert.ok(["not_needed", "harmful_or_distracting"].includes(duplicateDecision.necessity));
  assert.ok(duplicateDecision.duplicationRisk >= 0.85);
});

test("coverage gate fails uncovered critical opportunities and reports zero published visuals", () => {
  const critical = unit();
  const plan = buildVisualizationPlan({ gardenId: "demo", learningMap: learningMap([critical]), learningUnits: [critical] });
  const report = buildVisualizationCoverageReport({ plan, outcomes: [], gate: "fail" });
  assert.equal(report.status, "fail");
  assert.equal(report.generatedVisualsPublished + report.trustedVisualsPublished, 0);
  assert.ok(report.uncoveredCriticalOpportunityIds.length > 0);
});

test("route selection never chooses a trusted renderer rejected by contract compatibility", () => {
  const sparse = unit({
    id: "SPARSE",
    title: "How Sparse Events Can Reduce Computation",
    role: "mechanism",
    learningQuestion: "How does changing event sparsity alter computation over time?",
    newConcepts: ["event sparsity", "computational activity"],
    interactiveVisual: undefined,
  });
  const plan = buildVisualizationPlan({ gardenId: "demo", learningMap: learningMap([sparse]), learningUnits: [sparse] });
  const route = plan.decisions[0];
  assert.notEqual(route?.selectedRenderer, "lif_neuron");
});

test("generated routes clear stale incompatible contract types", () => {
  const comparison = unit({
    id: "DATA",
    title: "Datasets for Static and Event-Based Tasks",
    role: "comparison",
    learningQuestion: "How do static and event-based datasets compare over time?",
    newConcepts: ["event-based datasets"],
    interactiveVisual: { ...unit().interactiveVisual, visualType: "neural_coding" },
  });
  const plan = buildVisualizationPlan({ gardenId: "demo", learningMap: learningMap([comparison]), learningUnits: [comparison] });
  const routed = applyVisualizationRoutesToLearningUnits([comparison], plan);
  assert.notEqual(routed[0].interactiveVisual?.visualType, "neural_coding");
});

test("detailed council critic rejection is normalized with actionable feedback", () => {
  const rationale = "The path comparison fits the subsection, but its controls and variable grounding need revision.";
  const critic = normalizeDetailedGeneratedVisualCriticRecord({
    opportunityId: "visual-u7-18fcd14e",
    decision: "reject",
    overallScore: 0.62,
    scores: {
      interactionImprovesUnderstanding: 0.76,
      subsectionFit: 0.96,
      meaningfulControls: 0.32,
      usefulDefaultState: 0.84,
      variableIntroduction: 0.55,
      sourceClaimsAndUnitsPreserved: 0.68,
      avoidsDuplication: 0.98,
      avoidsUnnecessaryComplexity: 0.9,
      accessibility: 0.94,
    },
    rationale,
  }, undefined, "visual-u7-18fcd14e");

  assert.ok(critic);
  assert.equal(critic.approved, false);
  assert.equal(critic.providerApproved, false);
  assert.equal(critic.reason, rationale);
  assert.equal(critic.scores.pedagogicalValue, 0.32);
  assert.equal(critic.scores.sourceFidelity, 0.68);
  assert.equal(critic.scores.usability, 0.32);
  assert.equal(critic.scores.accessibility, 0.94);
  assert.equal(critic.providerScores.overallScore, 0.62);
  assert.ok(critic.requestedChanges.some((change) => /variables that directly change/i.test(change)));
  assert.ok(critic.requestedChanges.some((change) => /every variable and unit/i.test(change)));
  assert.ok(critic.requestedChanges.some((change) => /source evidence/i.test(change)));
});

test("detailed council critic approval still enforces normalized score thresholds", () => {
  const critic = normalizeDetailedGeneratedVisualCriticRecord({
    opportunityId: "visual-approved",
    decision: "approve",
    overallScore: 0.91,
    scores: {
      interactionImprovesUnderstanding: 0.92,
      subsectionFit: 0.95,
      meaningfulControls: 0.88,
      usefulDefaultState: 0.9,
      variableIntroduction: 0.86,
      sourceClaimsAndUnitsPreserved: 0.93,
      avoidsDuplication: 0.94,
      avoidsUnnecessaryComplexity: 0.89,
      accessibility: 0.91,
    },
    rationale: "Approved with strong evidence.",
  }, undefined, "visual-approved");

  assert.equal(critic?.approved, true);
  assert.deepEqual(critic?.requestedChanges, []);
});

test("detailed critic normalization rejects mismatched opportunities and non-numeric scores", () => {
  const mismatched = normalizeDetailedGeneratedVisualCriticRecord({
    opportunityId: "visual-from-another-unit",
    decision: "approve",
    overallScore: 0.95,
    scores: { interactionImprovesUnderstanding: 0.95 },
  }, undefined, "visual-for-this-unit");
  const invalidScores = normalizeDetailedGeneratedVisualCriticRecord({
    opportunityId: "visual-for-this-unit",
    decision: "reject",
    overallScore: null,
    scores: {
      interactionImprovesUnderstanding: null,
      meaningfulControls: "",
    },
  }, undefined, "visual-for-this-unit");
  const incompleteApproval = normalizeDetailedGeneratedVisualCriticRecord({
    opportunityId: "visual-for-this-unit",
    decision: "approve",
    overallScore: 0.99,
    scores: { interactionImprovesUnderstanding: 0.99 },
  }, undefined, "visual-for-this-unit");
  const contradictoryDecision = normalizeDetailedGeneratedVisualCriticRecord({
    opportunityId: "visual-for-this-unit",
    approved: true,
    decision: "reject",
    overallScore: 0.99,
    scores: { interactionImprovesUnderstanding: 0.99 },
  }, undefined, "visual-for-this-unit");

  assert.equal(mismatched, null);
  assert.equal(invalidScores, null);
  assert.equal(incompleteApproval, null);
  assert.equal(contradictoryDecision, null);
});

test("an under-scored rubric approval names the dimensions the critic skipped", () => {
  const diagnostics = {};
  const critic = normalizeDetailedGeneratedVisualCriticRecord({
    approved: true,
    reason: "The visualization connects potential difference, gradient, and field direction.",
    scores: {
      interactionImprovesUnderstanding: 0.9,
      subsectionFit: 0.98,
      controlMeaningfulness: 0.92,
      defaultStateUsefulness: 0.94,
      variableIntroduction: 0.91,
    },
  }, undefined, undefined, diagnostics);

  assert.equal(critic, null);
  assert.equal(diagnostics.detailed, true);
  assert.match(diagnostics.reason, /without scoring/i);
  for (const dimension of ["sourceClaimsAndUnits", "avoidsDuplication", "complexityDiscipline", "accessibility"]) {
    assert.match(diagnostics.reason, new RegExp(dimension));
  }
});

test("a legacy critic record is not claimed by the rubric path", () => {
  const diagnostics = {};
  const legacy = normalizeDetailedGeneratedVisualCriticRecord({
    approved: true,
    scores: { pedagogy: 0.9, source_coverage: 0.9, correctness: 0.9, interaction_quality: 0.9, accessibility: 0.9 },
  }, undefined, undefined, diagnostics);

  assert.equal(legacy, null);
  assert.notEqual(diagnostics.detailed, true);
});

const validSource = `import { defineVisualization } from "@breadboard/visual-sdk";
export default defineVisualization({
  schemaVersion: 1,
  sdkVersion: "1.0.0",
  title: "Coupled state intervention",
  description: "Change the gain and inspect how the propagated state changes.",
  accessibilityDescription: "A gain slider updates a numeric propagated-state result and a plotted response curve.",
  controls: [{ id: "gain", label: "Gain", type: "slider", min: 0, max: 3, step: 0.1, defaultValue: 1 }],
  outputs: [{
    id: "main_output",
    label: "Propagated state",
    representation: "chart",
    expression: { kind: "binary", op: "add", left: { kind: "input", id: "gain" }, right: { kind: "input", id: "x" } }
  }],
  scenes: [{
    kind: "plot",
    title: "Propagation response",
    xLabel: "Input state",
    yLabel: "Output state",
    xMin: 0,
    xMax: 4,
    samples: 48,
    series: [{ id: "response", label: "output", expression: { kind: "binary", op: "multiply", left: { kind: "input", id: "gain" }, right: { kind: "input", id: "x" } } }]
  }],
  animation: { durationMs: 3000, loop: true, autoplay: false },
  theme: { accent: "green" }
});`;

test("strict AST compiler emits only the fixed JSON envelope and deterministic tests pass", () => {
  const plan = buildVisualizationPlan({ gardenId: "demo", learningMap: learningMap([unit()]), learningUnits: [unit()] });
  const opportunity = plan.opportunities[0];
  const compiled = compileGeneratedVisualization(validSource, opportunity);
  assert.equal(compiled.validation.valid, true, compiled.validation.errors.join("; "));
  assert.ok(compiled.compiledJavaScript.startsWith("globalThis.__BREADBOARD_GENERATED_VISUAL__ = Object.freeze("));
  assert.equal(compiled.compiledJavaScript.includes("fetch("), false);
  const tests = runGeneratedVisualDeterministicTests({
    definition: compiled.definition,
    opportunity,
    availableSourceAnchorIds: new Set(["S1.P2.F1"]),
    testCases: [{ name: "gain doubles state", inputs: { gain: 2, x: 2 }, expected: { main_output: 4 } }],
  });
  assert.equal(tests.passed, true, JSON.stringify(tests));
});

test("AST validator rejects network calls, callbacks, and extra executable statements", () => {
  const malicious = `import { defineVisualization } from "@breadboard/visual-sdk";
fetch("https://example.com");
export default defineVisualization({ schemaVersion: 1, sdkVersion: "1.0.0", title: "Bad", description: "Bad", accessibilityDescription: "A deliberately invalid networked visual.", controls: [], outputs: [], scenes: [] });`;
  const compiled = compileGeneratedVisualization(malicious);
  assert.equal(compiled.validation.valid, false);
  assert.ok(compiled.validation.errors.some((error) => /forbidden|executable|URL/i.test(error)), compiled.validation.errors.join("; "));
});

test("AST validator rejects arbitrary imports and privileged application or browser access", () => {
  const cases = [
    `import { defineVisualization } from "d3"; export default defineVisualization({});`,
    `import { defineVisualization } from "@breadboard/visual-sdk"; process.env.SECRET; export default defineVisualization({});`,
    `import { defineVisualization } from "@breadboard/visual-sdk"; window.localStorage.clear(); export default defineVisualization({});`,
    `import { defineVisualization } from "@breadboard/visual-sdk"; import("https://example.com/x.js"); export default defineVisualization({});`,
    `import { defineVisualization } from "@breadboard/visual-sdk"; while (true) {} export default defineVisualization({});`,
  ];
  for (const source of cases) {
    const compiled = compileGeneratedVisualization(source);
    assert.equal(compiled.validation.valid, false, source);
    assert.ok(compiled.validation.errors.length > 0, source);
  }
});

test("compilation cache is source-, opportunity-, and SDK-version aware", () => {
  const uniqueSource = validSource.replace("Coupled state intervention", "Cached coupled state intervention");
  const first = compileGeneratedVisualization(uniqueSource);
  const second = compileGeneratedVisualization(uniqueSource);
  assert.equal(first.cacheHit, false);
  assert.equal(second.cacheHit, true);
  assert.equal(first.compiledHash, second.compiledHash);
});

test("generated Markdown block identity round-trips", () => {
  const block = buildGeneratedVisualBlock("visual-u1-deadbeef", 3);
  const value = block.replace(/^```[^\n]+\n/, "").replace(/\n```$/, "");
  assert.deepEqual(parseGeneratedVisualBlock(value), { id: "visual-u1-deadbeef", version: 3 });
});

test("manifest validation rejects path, hash, status, and identity mismatches", () => {
  const checked = validateGeneratedVisualizationManifest({
    schemaVersion: 1,
    sdkVersion: "1.0.0",
    id: "visual-valid-id",
    gardenId: "demo",
    learningUnitId: "U1",
    title: "Visual",
    description: "Description",
    learningObjective: "Learn",
    sourceAnchorIds: [],
    sourceVisualIds: [],
    conceptIds: [],
    insertionAnchor: "learning-unit:U1:after-introduction",
    targetPage: "sources/not-allowed.md",
    targetHeading: "Visual",
    sourceHash: "bad",
    compiledHash: "bad",
    status: "published",
    generatedAt: "not-a-date",
    generatorModel: "test",
    generationAttempt: 1,
    version: 1,
    artifactPath: ".breadboard/visuals/wrong",
    similarityFingerprint: "fingerprint",
  }, "visual-different-id");
  assert.equal(checked.manifest, null);
  assert.match(checked.errors.join("; "), /does not match|targetPage|sourceHash|compiledHash|artifactPath|generatedAt/);
});

const browserAvailable = [
  process.env.BREADBOARD_VISUAL_BROWSER_PATH,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].some((candidate) => candidate && fs.existsSync(candidate));

test("isolated browser runtime mounts at mobile and desktop sizes without overflow", { skip: !browserAvailable }, () => {
  const compiled = compileGeneratedVisualization(validSource);
  assert.ok(compiled.definition);
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-visual-browser-"));
  try {
    const result = runGeneratedVisualBrowserTests({ definition: compiled.definition, outputDir });
    assert.ok(result.tests.every((candidate) => candidate.passed), JSON.stringify(result.tests));
    assert.equal(fs.existsSync(path.join(outputDir, "preview.png")), true);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("versioned generated artifacts preserve evidence and support validated rollback", async () => {
  const plan = buildVisualizationPlan({ gardenId: "demo", learningMap: learningMap([unit()]), learningUnits: [unit()] });
  const opportunity = {
    ...plan.opportunities[0],
    targetPage: "learning/1. Coupled states/1.1 Explore an unusual state machine.md",
    targetHeading: "Explore an unusual state machine",
    insertionAnchor: "learning-unit:U1:after-introduction",
  };
  const gardenDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-visual-artifact-"));
  const candidateProvider = async () => ({
    title: "Coupled state intervention",
    explanation: "A source-grounded intervention explorer.",
    sourceCode: validSource,
    testCases: [{ name: "gain doubles state", inputs: { gain: 2, x: 2 }, expected: { main_output: 4 } }],
    accessibilityDescription: "A gain slider changes both a numeric output and the plotted propagation response.",
    pedagogicalClaims: ["The propagated state changes with gain."],
  });
  const criticProvider = async () => ({
    approved: true,
    checkedAt: new Date().toISOString(),
    reason: "The control changes the intended relationship.",
    requestedChanges: [],
    scores: { pedagogicalValue: 0.9, sourceFidelity: 0.9, usability: 0.9, accessibility: 0.9 },
  });
  try {
    const common = {
      client: {},
      model: "test-model",
      gardenDir,
      opportunity,
      pageMarkdown: `Introduction.\n\n<!-- ${opportunity.insertionAnchor} -->`,
      availableSourceAnchorIds: new Set(["S1.P2.F1"]),
      candidateProvider,
      criticProvider,
      runBrowserTests: false,
    };
    const first = await createGeneratedVisualization(common);
    assert.equal(first.manifest?.version, 1, first.errors.join("; "));
    const second = await createGeneratedVisualization(common);
    assert.equal(second.manifest?.version, 2, second.errors.join("; "));
    assert.equal(second.manifest?.previousVersion, 1);
    const publishedDir = path.join(gardenDir, ".breadboard", "visuals", opportunity.id);
    const publishedSource = fs.readFileSync(path.join(publishedDir, "source.tsx"));
    const publishedCompiled = fs.readFileSync(path.join(publishedDir, "compiled.js"));
    assert.equal(second.manifest?.sourceHash, crypto.createHash("sha256").update(publishedSource).digest("hex"));
    assert.equal(second.manifest?.compiledHash, crypto.createHash("sha256").update(publishedCompiled).digest("hex"));
    assert.ok(loadGeneratedVisualDefinition(gardenDir, opportunity.id, 1));
    assert.ok(loadGeneratedVisualDefinition(gardenDir, opportunity.id, 2));
    const lifecycle = JSON.parse(fs.readFileSync(path.join(
      gardenDir, ".breadboard", "visuals", opportunity.id, "versions", "2", "lifecycle.json",
    ), "utf8"));
    assert.deepEqual(lifecycle.map((entry) => entry.status), ["draft", "validated", "compiled", "tested", "critic_approved", "published"]);
    const restored = rollbackGeneratedVisualization({ gardenDir, id: opportunity.id, version: 1 });
    assert.equal(restored.version, 1);
    assert.equal(loadGeneratedVisualManifest(gardenDir, opportunity.id)?.version, 1);
  } finally {
    fs.rmSync(gardenDir, { recursive: true, force: true });
  }
});

test("a detailed council rejection repairs with its real feedback before approval", async () => {
  const plan = buildVisualizationPlan({ gardenId: "critic-repair", learningMap: learningMap([unit()]), learningUnits: [unit()] });
  const opportunity = {
    ...plan.opportunities[0],
    gardenId: "critic-repair",
    targetPage: "learning/1/critic-repair.md",
    targetHeading: "Critic repair",
  };
  const gardenDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-visual-critic-repair-"));
  const events = [];
  const candidateInputs = [];
  const criticRecords = [
    {
      opportunityId: opportunity.id,
      decision: "reject",
      overallScore: 0.62,
      scores: {
        interactionImprovesUnderstanding: 0.76,
        subsectionFit: 0.96,
        meaningfulControls: 0.32,
        usefulDefaultState: 0.84,
        variableIntroduction: 0.55,
        sourceClaimsAndUnitsPreserved: 0.68,
        avoidsDuplication: 0.98,
        avoidsUnnecessaryComplexity: 0.9,
        accessibility: 0.94,
      },
      rationale: "Use meaningful, introduced, source-grounded variables.",
    },
    {
      opportunityId: opportunity.id,
      decision: "approve",
      overallScore: 0.92,
      scores: {
        interactionImprovesUnderstanding: 0.92,
        subsectionFit: 0.95,
        meaningfulControls: 0.88,
        usefulDefaultState: 0.9,
        variableIntroduction: 0.86,
        sourceClaimsAndUnitsPreserved: 0.93,
        avoidsDuplication: 0.94,
        avoidsUnnecessaryComplexity: 0.89,
        accessibility: 0.91,
      },
      rationale: "Approved after the grounded repair.",
    },
  ];
  const client = {
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content: JSON.stringify(criticRecords.shift()) } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      },
    },
  };
  try {
    const result = await createGeneratedVisualization({
      client,
      model: "test-model",
      gardenDir,
      opportunity,
      pageMarkdown: "A source-grounded explanation.",
      availableSourceAnchorIds: new Set(["S1.P2.F1"]),
      maxAttempts: 2,
      criticMaxAttempts: 1,
      runBrowserTests: false,
      onEvent: (event) => events.push(event),
      candidateProvider: async (input) => {
        candidateInputs.push(input);
        return {
          title: "Coupled state intervention",
          explanation: "A source-grounded intervention explorer.",
          sourceCode: validSource,
          testCases: [{ name: "gain doubles state", inputs: { gain: 2, x: 2 }, expected: { main_output: 4 } }],
          accessibilityDescription: "A gain slider changes both a numeric output and the plotted response.",
          pedagogicalClaims: ["The propagated state changes with gain."],
        };
      },
    });

    assert.equal(result.manifest?.generationAttempt, 2, result.errors.join("; "));
    assert.equal(candidateInputs.length, 2);
    assert.match(candidateInputs[1].errors.join("; "), /meaningful, introduced, source-grounded variables/i);
    assert.match(candidateInputs[1].errors.join("; "), /variables that directly change/i);
    assert.match(candidateInputs[1].errors.join("; "), /every variable and unit/i);
    assert.ok(events.some((event) => event.type === "visual_critic_rejected"));
    assert.ok(events.some((event) => event.type === "visual_repair_started"));
  } finally {
    fs.rmSync(gardenDir, { recursive: true, force: true });
  }
});

test("critic protocol exhaustion retries the same validated artifact without regenerating it", async () => {
  const plan = buildVisualizationPlan({ gardenId: "critic-failure", learningMap: learningMap([unit()]), learningUnits: [unit()] });
  const opportunity = {
    ...plan.opportunities[0],
    gardenId: "critic-failure",
    targetPage: "learning/1/critic-failure.md",
    targetHeading: "Critic failure",
  };
  const gardenDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-visual-critic-failure-"));
  const events = [];
  let candidateCalls = 0;
  let criticCalls = 0;
  try {
    const result = await createGeneratedVisualization({
      client: {},
      model: "test-model",
      gardenDir,
      opportunity,
      pageMarkdown: "A validated visual waiting for review.",
      availableSourceAnchorIds: new Set(["S1.P2.F1"]),
      maxAttempts: 5,
      criticMaxAttempts: 2,
      runBrowserTests: false,
      onEvent: (event) => events.push(event),
      candidateProvider: async () => {
        candidateCalls += 1;
        return {
          title: "Coupled state intervention",
          explanation: "A source-grounded intervention explorer.",
          sourceCode: validSource,
          testCases: [{ name: "gain doubles state", inputs: { gain: 2, x: 2 }, expected: { main_output: 4 } }],
          accessibilityDescription: "A gain slider changes both a numeric output and the plotted response.",
          pedagogicalClaims: ["The propagated state changes with gain."],
        };
      },
      criticProvider: async () => {
        criticCalls += 1;
        throw new Error("critic returned an invalid record");
      },
    });

    assert.equal(result.manifest, null);
    assert.equal(result.failureCategory, "critic");
    assert.equal(candidateCalls, 1);
    assert.equal(criticCalls, 2);
    assert.match(result.errors.join("; "), /could not complete after 2 attempts/i);
    assert.doesNotMatch(result.errors.join("; "), /Retry critic review with the validated artifact/i);
    assert.ok(events.some((event) => event.type === "visual_critic_retry"));
    assert.ok(events.some((event) => event.type === "visual_critic_failed"));
    assert.equal(events.some((event) => event.type === "visual_repair_started"), false);
  } finally {
    fs.rmSync(gardenDir, { recursive: true, force: true });
  }
});

test("cancellation during critic review escapes the retry loop immediately", async () => {
  const plan = buildVisualizationPlan({ gardenId: "critic-cancel", learningMap: learningMap([unit()]), learningUnits: [unit()] });
  const opportunity = {
    ...plan.opportunities[0],
    gardenId: "critic-cancel",
    targetPage: "learning/1/critic-cancel.md",
    targetHeading: "Critic cancel",
  };
  const gardenDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-visual-critic-cancel-"));
  const events = [];
  const abortController = new AbortController();
  let criticCalls = 0;
  try {
    await assert.rejects(createGeneratedVisualization({
      client: {},
      model: "test-model",
      gardenDir,
      opportunity,
      pageMarkdown: "A validated visual waiting for review.",
      availableSourceAnchorIds: new Set(["S1.P2.F1"]),
      maxAttempts: 5,
      criticMaxAttempts: 3,
      runBrowserTests: false,
      abortSignal: abortController.signal,
      onEvent: (event) => events.push(event),
      candidateProvider: async () => ({
        title: "Coupled state intervention",
        explanation: "A source-grounded intervention explorer.",
        sourceCode: validSource,
        testCases: [{ name: "gain doubles state", inputs: { gain: 2, x: 2 }, expected: { main_output: 4 } }],
        accessibilityDescription: "A gain slider changes both a numeric output and the plotted response.",
        pedagogicalClaims: ["The propagated state changes with gain."],
      }),
      criticProvider: async () => {
        criticCalls += 1;
        abortController.abort(new Error("cancelled by test"));
        throw new Error("cancelled by test");
      },
    }), /cancelled by test/i);

    assert.equal(criticCalls, 1);
    assert.equal(events.some((event) => event.type === "visual_critic_retry"), false);
    assert.equal(events.some((event) => event.type === "visual_critic_failed"), false);
    assert.equal(events.some((event) => event.type === "visual_fallback_used"), false);
  } finally {
    fs.rmSync(gardenDir, { recursive: true, force: true });
  }
});

test("a deterministic runtime-test failure is recorded and repaired on the next bounded attempt", async () => {
  const plan = buildVisualizationPlan({ gardenId: "repair", learningMap: learningMap([unit()]), learningUnits: [unit()] });
  const opportunity = {
    ...plan.opportunities[0],
    gardenId: "repair",
    targetPage: "learning/1/repair.md",
    targetHeading: "Repair",
  };
  const gardenDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-visual-repair-"));
  let calls = 0;
  const events = [];
  try {
    const result = await createGeneratedVisualization({
      client: {},
      model: "test-model",
      gardenDir,
      opportunity,
      pageMarkdown: "An anchored explanation.",
      availableSourceAnchorIds: new Set(["S1.P2.F1"]),
      maxAttempts: 2,
      runBrowserTests: false,
      onEvent: (event) => events.push(event),
      candidateProvider: async () => {
        calls += 1;
        return {
          title: "Coupled state intervention",
          explanation: "A repaired intervention explorer.",
          sourceCode: validSource,
          testCases: [{
            name: "gain doubles state",
            inputs: { gain: 2, x: 2 },
            expected: { main_output: calls === 1 ? 999 : 4 },
          }],
          accessibilityDescription: "A labeled gain control changes the response.",
          pedagogicalClaims: ["Gain changes the propagated state."],
        };
      },
      criticProvider: async () => ({
        approved: true,
        checkedAt: new Date().toISOString(),
        reason: "Approved after deterministic repair.",
        requestedChanges: [],
        scores: { pedagogicalValue: 0.9, sourceFidelity: 0.9, usability: 0.9, accessibility: 0.9 },
      }),
    });
    assert.equal(result.manifest?.generationAttempt, 2, result.errors.join("; "));
    assert.equal(calls, 2);
    assert.ok(events.some((event) => event.type === "visual_runtime_test_failed"));
    assert.ok(events.some((event) => event.type === "visual_repair_started"));
    const attemptsRoot = path.join(gardenDir, ".breadboard", "visuals", opportunity.id, "attempts");
    const rejectionFiles = fs.readdirSync(attemptsRoot, { recursive: true }).filter((entry) => String(entry).endsWith("rejection.json"));
    assert.equal(rejectionFiles.length, 1);
  } finally {
    fs.rmSync(gardenDir, { recursive: true, force: true });
  }
});

test("exhausted repairs reject safely without publishing a broken artifact", async () => {
  const plan = buildVisualizationPlan({ gardenId: "reject", learningMap: learningMap([unit()]), learningUnits: [unit()] });
  const opportunity = { ...plan.opportunities[0], gardenId: "reject", targetPage: "learning/reject.md" };
  const gardenDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-visual-reject-"));
  const events = [];
  try {
    const result = await createGeneratedVisualization({
      client: {},
      model: "test-model",
      gardenDir,
      opportunity,
      pageMarkdown: "An explanation remains available without the visual.",
      maxAttempts: 2,
      runBrowserTests: false,
      onEvent: (event) => events.push(event),
      candidateProvider: async () => ({
        title: "Unsafe visual",
        explanation: "This candidate must never publish.",
        sourceCode: `import { defineVisualization } from "unsafe-package"; export default defineVisualization({});`,
        testCases: [],
        accessibilityDescription: "Rejected visual.",
        pedagogicalClaims: [],
      }),
      criticProvider: async () => { throw new Error("critic must not run"); },
    });
    assert.equal(result.manifest, null);
    assert.equal(result.failureCategory, "validation");
    assert.ok(events.some((event) => event.type === "visual_fallback_used"));
    assert.equal(loadGeneratedVisualManifest(gardenDir, opportunity.id), null);
  } finally {
    fs.rmSync(gardenDir, { recursive: true, force: true });
  }
});

test("generated visualization work obeys the configured concurrency limit", async () => {
  const previousLimit = process.env.LEARN_GENERATED_VISUAL_CONCURRENCY;
  process.env.LEARN_GENERATED_VISUAL_CONCURRENCY = "1";
  const roots = [];
  let active = 0;
  let peak = 0;
  try {
    const basePlan = buildVisualizationPlan({ gardenId: "queue", learningMap: learningMap([unit()]), learningUnits: [unit()] });
    const work = [1, 2, 3].map(async (number) => {
      const gardenDir = fs.mkdtempSync(path.join(os.tmpdir(), `breadboard-visual-queue-${number}-`));
      roots.push(gardenDir);
      const opportunity = {
        ...basePlan.opportunities[0],
        id: `visual-queued-${number}`,
        gardenId: `queue-${number}`,
        targetPage: `learning/${number}.md`,
      };
      return createGeneratedVisualization({
        client: {},
        model: "test-model",
        gardenDir,
        opportunity,
        pageMarkdown: "Queued visualization.",
        availableSourceAnchorIds: new Set(["S1.P2.F1"]),
        maxAttempts: 1,
        runBrowserTests: false,
        candidateProvider: async () => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 30));
          active -= 1;
          return {
            title: "Queued visual",
            explanation: "A queued visual.",
            sourceCode: validSource,
            testCases: [{ name: "finite", inputs: { gain: 1, x: 1 }, expected: { main_output: 2 } }],
            accessibilityDescription: "A queued visual with labeled controls.",
            pedagogicalClaims: ["The output is finite."],
          };
        },
        criticProvider: async () => ({
          approved: true,
          checkedAt: new Date().toISOString(),
          reason: "Approved.",
          requestedChanges: [],
          scores: { pedagogicalValue: 0.9, sourceFidelity: 0.9, usability: 0.9, accessibility: 0.9 },
        }),
      });
    });
    const results = await Promise.all(work);
    assert.ok(results.every((result) => result.manifest));
    assert.equal(peak, 1);
  } finally {
    if (previousLimit === undefined) delete process.env.LEARN_GENERATED_VISUAL_CONCURRENCY;
    else process.env.LEARN_GENERATED_VISUAL_CONCURRENCY = previousLimit;
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
  }
});
