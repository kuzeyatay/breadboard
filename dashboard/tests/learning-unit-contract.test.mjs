import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeLearningUnits,
  sectionSemanticProfile,
  sectionTitleGrammarProblems,
  clusterUnitsIntoSections,
  learningMapFromUnits,
  assignSourceArtifacts,
  atomicZettelHandle,
  isAtomicZettelHandle,
  zettelHandlesForUnit,
  interactiveVisualSignature,
  signatureKey,
  duplicateInteractiveVisuals,
  visualTypeCompatibleWithUnit,
  figurePlacementProblems,
  validateLearningUnitContracts,
  clusterDepthProblems,
  dropIncompatibleInteractiveVisuals,
  interactiveVisualGroundingProblems,
} from "../src/lib/learning-unit-contract.ts";
import { sanitizeLearnerTitle } from "../src/lib/learn-utils.ts";

// A realistic set of learning units for an SNN source (used generically — the
// clustering/validation logic is domain-agnostic).
function snnUnits() {
  return normalizeLearningUnits([
    { id: "U1", role: "motivation", title: "Why dense networks waste work", learningQuestion: "Why do we need event-driven computation?", zettelNotes: [{ handle: "event-driven-computation-saves-work-by-staying-silent", claim: "Event-driven systems only compute when something changes." }] },
    { id: "U2", role: "core_concept", title: "What a spike is", learningQuestion: "What does a spike represent?", newConcepts: ["spike"], zettelNotes: [{ handle: "spike-timing-carries-information", claim: "The timing of a spike is part of the message." }] },
    { id: "U3", role: "mechanism", title: "The LIF neuron", learningQuestion: "How does a leaky integrate-and-fire neuron work?", newConcepts: ["membrane potential", "threshold", "reset", "leak"],
      interactiveVisual: { id: "v_lif", visualType: "lif_neuron", uniqueConcept: "membrane potential accumulation and reset", whyStaticSourceFigureIsNotEnough: "The learner must watch the potential climb, cross threshold, spike and reset over time.", learnerManipulates: ["input current", "threshold"], expectedInsight: "how threshold and leak change firing", sourceAnchors: ["S1.P4.F1"] },
      zettelNotes: [{ handle: "lif-threshold-turns-accumulated-input-into-an-event", claim: "The threshold converts accumulated input into a discrete spike." }] },
    { id: "U4", role: "mechanism", title: "Leak and reset", learningQuestion: "Why does the membrane potential leak?", newConcepts: ["leak"], zettelNotes: [{ handle: "leak-prevents-input-from-accumulating-forever", claim: "Leak keeps old input from accumulating forever." }] },
    { id: "U5", role: "formula", title: "The membrane update rule", learningQuestion: "What equation governs the membrane potential?", sourceFormulas: [{ id: "S1.P6.E1", teachingGoal: "Define the update rule", termsToDefine: ["V", "tau"], placement: "before_example" }], zettelNotes: [{ handle: "membrane-update-integrates-current-with-decay", claim: "The update integrates current with exponential decay." }] },
    { id: "U6", role: "training_method", title: "Surrogate gradients", learningQuestion: "How do we train through non-differentiable spikes?", newConcepts: ["surrogate gradient"], zettelNotes: [{ handle: "surrogate-gradients-smooth-over-non-differentiable-spikes", claim: "Surrogate gradients approximate the derivative of the spike." }] },
    { id: "U7", role: "training_method", title: "STDP", learningQuestion: "How does spike-timing-dependent plasticity update weights?", newConcepts: ["stdp", "plasticity"],
      interactiveVisual: { id: "v_stdp", visualType: "stdp_window", uniqueConcept: "pre/post timing window", whyStaticSourceFigureIsNotEnough: "The learner drags the timing difference and sees the weight change sign.", learnerManipulates: ["pre/post delay"], expectedInsight: "sign of weight change from timing", sourceAnchors: ["S1.P7.G1"] },
      zettelNotes: [{ handle: "stdp-updates-weights-from-local-timing", claim: "STDP updates weights from local spike timing." }] },
    { id: "U8", role: "metric", title: "Energy efficiency", learningQuestion: "How do we measure energy per inference?", sourceFormulas: [{ id: "S1.P6.E2", teachingGoal: "Define energy efficiency", termsToDefine: ["E"], placement: "inside_metric_definition" }],
      interactiveVisual: { id: "v_metric", visualType: "metric_calculator", uniqueConcept: "energy-per-inference computation", whyStaticSourceFigureIsNotEnough: "The learner changes spike count and sees the energy change.", learnerManipulates: ["spike count"], expectedInsight: "how spike count drives energy", sourceAnchors: ["S1.P6.E2"] },
      zettelNotes: [{ handle: "spike-count-approximates-neuromorphic-work", claim: "Total spike count approximates the work done on neuromorphic hardware." }] },
    { id: "U9", role: "metric", title: "Accuracy is not enough", learningQuestion: "Why is accuracy alone misleading?", zettelNotes: [{ handle: "accuracy-alone-hides-energy-and-latency-cost", claim: "A model can be accurate while too slow or energy-hungry." }] },
    { id: "U10", role: "result_interpretation", title: "Reading the training curves", learningQuestion: "What do the training curves tell us?", sourceTables: [{ id: "S1.P8.G1", teachingGoal: "Interpret convergence", rowsOrColumnsToExplain: ["epoch", "accuracy"], placement: "inside_result_interpretation" }], zettelNotes: [{ handle: "training-curves-reveal-convergence-speed", claim: "Training curves reveal how quickly a model converges." }] },
    { id: "U11", role: "comparison", title: "ANN vs SNN", learningQuestion: "How do ANN-to-SNN conversions compare?", sourceTables: [{ id: "S1.P9.T1", teachingGoal: "Compare accuracy and spike count", rowsOrColumnsToExplain: ["model", "accuracy", "spikes"], placement: "inside_comparison" }],
      interactiveVisual: { id: "v_tradeoff", visualType: "tradeoff_explorer", uniqueConcept: "accuracy/energy tradeoff across model families", whyStaticSourceFigureIsNotEnough: "The learner changes the deployment priority and sees which family wins.", learnerManipulates: ["priority"], expectedInsight: "best model depends on priority", sourceAnchors: ["S1.P9.T1"] },
      zettelNotes: [{ handle: "ann-to-snn-conversion-preserves-accuracy-but-can-increase-spike-count", claim: "Conversion preserves accuracy but can raise spike count." }] },
    { id: "U12", role: "application", title: "Neuromorphic hardware", learningQuestion: "Where do SNNs run best?", zettelNotes: [{ handle: "hardware-access-shapes-snn-reproducibility", claim: "Access to neuromorphic hardware shapes reproducibility." }] },
    { id: "U13", role: "limitation", title: "Open problems", learningQuestion: "What is still unsolved?", zettelNotes: [{ handle: "snn-training-at-scale-remains-an-open-problem", claim: "Training SNNs at scale is still an open problem." }] },
    { id: "U14", role: "synthesis", title: "Putting it together", learningQuestion: "How does the whole picture fit?", zettelNotes: [{ handle: "event-driven-design-connects-timing-energy-and-accuracy", claim: "Event-driven design ties timing, energy, and accuracy together." }] },
  ]);
}

describe("Learning Unit Contract — clustering (Fix 1)", () => {
  test("clusters 14 units into 4-7 real multi-subsection sections", () => {
    const clusters = clusterUnitsIntoSections(snnUnits());
    assert.ok(clusters.length >= 4 && clusters.length <= 7, `got ${clusters.length} sections`);
    const single = clusters.filter((c) => c.unitIds.length <= 1);
    assert.ok(single.length * 4 <= clusters.length, `too many single-subsection sections: ${single.length}/${clusters.length}`);
    // No section exceeds the cap.
    assert.ok(clusters.every((c) => c.unitIds.length <= 5));
    assert.equal(clusterDepthProblems(clusters).length, 0, JSON.stringify(clusterDepthProblems(clusters)));
  });

  test("rejects a shallow map where every section has one subsection", () => {
    // 8 units, each in its own theme is impossible (only 7 themes); instead
    // simulate the bad shape directly via clusterDepthProblems.
    const bad = [
      { title: "A", themeKey: "a", unitIds: ["1"] },
      { title: "B", themeKey: "b", unitIds: ["2"] },
      { title: "C", themeKey: "c", unitIds: ["3"] },
      { title: "D", themeKey: "d", unitIds: ["4"] },
      { title: "E", themeKey: "e", unitIds: ["5"] },
      { title: "F", themeKey: "f", unitIds: ["6"] },
      { title: "G", themeKey: "g", unitIds: ["7"] },
      { title: "H", themeKey: "h", unitIds: ["8"] },
    ];
    const problems = clusterDepthProblems(bad);
    assert.ok(problems.some((p) => /every section has a single subsection/.test(p)));
  });

  test("learningMapFromUnits produces a spine with multi-subsection sections", () => {
    const map = learningMapFromUnits(snnUnits(), {
      gardenId: "g", title: "Spiking Neural Networks", summary: "s", sourceOnly: true, createdAt: "2026-07-04T00:00:00Z",
    });
    assert.ok(map.sections.length >= 4 && map.sections.length <= 7);
    const totalSubs = map.sections.reduce((n, s) => n + s.subsections.length, 0);
    assert.equal(totalSubs, 14);
    // Subsections carry the unit's source visuals + atomic tags.
    const lif = map.sections.flatMap((s) => s.subsections).find((s) => s.title === "The LIF neuron");
    assert.ok(lif.sourceVisualIds.length === 0 || lif.conceptTags.every(isAtomicZettelHandle));
    assert.ok(map.sections.flatMap((s) => s.subsections).every((s) => s.conceptTags.every(isAtomicZettelHandle)));
  });
});

describe("Learning Unit Contract — atomic Zettelkasten handles (Fix 6/7)", () => {
  test("atomicZettelHandle turns a claim into a slash-free kebab handle", () => {
    assert.equal(
      atomicZettelHandle("Event-driven computation saves work by staying silent"),
      "event-driven-computation-saves-work-by-staying-silent",
    );
    assert.equal(atomicZettelHandle("metric/accuracy-per-energy"), "metric-accuracy-per-energy");
    assert.ok(!atomicZettelHandle("spike/rate coding").includes("/"));
  });

  test("isAtomicZettelHandle rejects slashes and broad single words", () => {
    assert.ok(isAtomicZettelHandle("spike-timing-carries-information"));
    assert.ok(!isAtomicZettelHandle("metric/accuracy-per-energy"), "slash namespaces are banned");
    assert.ok(!isAtomicZettelHandle("latency"), "broad single words are banned");
    assert.ok(!isAtomicZettelHandle("snn"), "broad single words are banned");
  });

  test("unit handles are atomic and slash-free", () => {
    for (const unit of snnUnits()) {
      for (const handle of zettelHandlesForUnit(unit)) {
        assert.ok(isAtomicZettelHandle(handle), `bad handle: ${handle}`);
        assert.ok(!handle.includes("/"));
      }
    }
  });

  test("normalization tops up thin zettel plans to at least three atomic handles", () => {
    const [unit] = normalizeLearningUnits([
      {
        id: "U-thin",
        role: "metric",
        title: "Spike Count as Computational Activity",
        learningQuestion: "How does spike count measure activity cost?",
        newConcepts: ["spike count"],
        sourceAnchors: ["S1.P6.E3"],
        zettelNotes: [
          { handle: "spike-count-connects-activity-to-cost", claim: "Spike count connects activity to cost." },
        ],
      },
    ]);
    const handles = zettelHandlesForUnit(unit);
    assert.ok(handles.length >= 3, `expected at least three handles, got ${handles.join(", ")}`);
    assert.ok(handles.every(isAtomicZettelHandle));
  });
});

describe("Learning Unit Contract — interactive visual uniqueness (Fix 4)", () => {
  test("detects duplicate interactive visual signatures", () => {
    const units = normalizeLearningUnits([
      { id: "A", role: "mechanism", title: "LIF one", interactiveVisual: { visualType: "lif_neuron", uniqueConcept: "membrane dynamics", whyStaticSourceFigureIsNotEnough: "watch it evolve", learnerManipulates: ["current"], expectedInsight: "firing", sourceAnchors: ["S1.P4.F1"] } },
      { id: "B", role: "mechanism", title: "LIF two", interactiveVisual: { visualType: "lif_neuron", uniqueConcept: "membrane dynamics", whyStaticSourceFigureIsNotEnough: "watch it evolve", learnerManipulates: ["current"], expectedInsight: "firing", sourceAnchors: ["S1.P4.F1"] } },
    ]);
    const dups = duplicateInteractiveVisuals(units);
    assert.equal(dups.length, 1);
    assert.deepEqual(dups[0].unitIds.sort(), ["A", "B"]);
  });

  test("a visual that explicitly reuses an earlier one is not a duplicate", () => {
    const units = normalizeLearningUnits([
      { id: "A", role: "mechanism", title: "LIF one", interactiveVisual: { id: "v1", visualType: "lif_neuron", uniqueConcept: "membrane dynamics", whyStaticSourceFigureIsNotEnough: "watch", learnerManipulates: ["current"], expectedInsight: "firing", sourceAnchors: ["S1.P4.F1"] } },
      { id: "B", role: "mechanism", title: "LIF revisit", interactiveVisual: { visualType: "lif_neuron", uniqueConcept: "membrane dynamics", whyStaticSourceFigureIsNotEnough: "watch", learnerManipulates: ["current"], expectedInsight: "firing", sourceAnchors: ["S1.P4.F1"], reuseOf: "v1" } },
    ]);
    assert.equal(duplicateInteractiveVisuals(units).length, 0);
  });

  test("the whole SNN garden has no duplicate visuals", () => {
    assert.equal(duplicateInteractiveVisuals(snnUnits()).length, 0);
  });
});

describe("Learning Unit Contract — visual/unit compatibility (Fix 5)", () => {
  test("a LIF visual on an intro/motivation unit is rejected", () => {
    const [unit] = normalizeLearningUnits([
      { id: "X", role: "motivation", title: "Why SNNs matter", learningQuestion: "why does this topic exist?",
        interactiveVisual: { visualType: "lif_neuron", uniqueConcept: "why it matters", whyStaticSourceFigureIsNotEnough: "n/a", learnerManipulates: ["x"], expectedInsight: "y", sourceAnchors: ["S1.P8.G1"] } },
    ]);
    const compat = visualTypeCompatibleWithUnit("lif_neuron", unit);
    assert.equal(compat.ok, false);
  });

  test("a LIF visual on a real LIF mechanism unit is accepted", () => {
    const lif = snnUnits().find((u) => u.id === "U3");
    assert.equal(visualTypeCompatibleWithUnit("lif_neuron", lif).ok, true);
  });

  test("a tradeoff explorer on a comparison unit is accepted; on a plain concept unit is rejected", () => {
    const comparison = snnUnits().find((u) => u.id === "U11");
    assert.equal(visualTypeCompatibleWithUnit("tradeoff_explorer", comparison).ok, true);
    const concept = snnUnits().find((u) => u.id === "U2");
    assert.equal(visualTypeCompatibleWithUnit("tradeoff_explorer", concept).ok, false);
  });

  test("metric and training aliases keep their concrete renderer types", () => {
    const [metric, training] = normalizeLearningUnits([
      {
        id: "M",
        role: "metric",
        title: "Metric formula calculator",
        learningQuestion: "How do accuracy, latency, spike count, and energy become measurable metrics?",
        interactiveVisual: {
          visualType: "metric_tradeoff_calculator",
          uniqueConcept: "direct metric calculator",
          whyStaticSourceFigureIsNotEnough: "the learner changes metric inputs and watches outputs update",
          learnerManipulates: ["correct", "spike count"],
          expectedInsight: "accuracy and energy respond to different inputs",
          sourceAnchors: ["S1.P6.E1"],
        },
      },
      {
        id: "T",
        role: "result_interpretation",
        title: "Training convergence curve",
        learningQuestion: "How does convergence over epochs show learning speed?",
        interactiveVisual: {
          visualType: "training_curves",
          uniqueConcept: "training loss and accuracy curves",
          whyStaticSourceFigureIsNotEnough: "the learner changes target accuracy and watches convergence time move",
          learnerManipulates: ["learning rate", "target accuracy"],
          expectedInsight: "higher targets can delay convergence",
          sourceAnchors: ["S1.P11.G1"],
        },
      },
    ]);
    assert.equal(metric.interactiveVisual.visualType, "metric_calculator");
    assert.equal(training.interactiveVisual.visualType, "training_curve");
    assert.equal(visualTypeCompatibleWithUnit("metric_calculator", metric).ok, true);
    assert.equal(visualTypeCompatibleWithUnit("training_curve", training).ok, true);
    assert.notEqual(metric.interactiveVisual.visualType, "tradeoff_explorer");
    assert.notEqual(training.interactiveVisual.visualType, "tradeoff_explorer");
  });

  test("an unknown visual type is rejected instead of becoming a mandatory contract", () => {
    const [withJustification] = normalizeLearningUnits([
      { id: "A", role: "mechanism", title: "Custom", interactiveVisual: { visualType: "custom_widget", uniqueConcept: "a real thing", whyStaticSourceFigureIsNotEnough: "because interaction is required", learnerManipulates: ["k"], expectedInsight: "z", sourceAnchors: [] } },
    ]);
    assert.equal(withJustification.interactiveVisual, undefined);
    assert.equal(visualTypeCompatibleWithUnit("custom_widget", withJustification).ok, false);
    const [withoutJustification] = normalizeLearningUnits([
      { id: "B", role: "mechanism", title: "Custom", interactiveVisual: { visualType: "custom_widget", uniqueConcept: "", whyStaticSourceFigureIsNotEnough: "", learnerManipulates: [], expectedInsight: "", sourceAnchors: [] } },
    ]);
    assert.equal(visualTypeCompatibleWithUnit("custom_widget", withoutJustification).ok, false);
  });

  test("dropIncompatibleInteractiveVisuals removes unsupported visual contracts", () => {
    const [unit] = normalizeLearningUnits([
      { id: "A", role: "mechanism", title: "Custom", interactiveVisual: { visualType: "custom_type", uniqueConcept: "custom", whyStaticSourceFigureIsNotEnough: "needs an unsupported widget", learnerManipulates: ["x"], expectedInsight: "y", sourceAnchors: [] } },
    ]);
    const { units, dropped } = dropIncompatibleInteractiveVisuals([
      {
        ...unit,
        interactiveVisual: {
          id: "custom",
          uniqueConcept: "custom",
          visualType: "custom_type",
          whyStaticSourceFigureIsNotEnough: "needs an unsupported widget",
          learnerManipulates: ["x"],
          expectedInsight: "y",
          sourceAnchors: [],
          duplicateSignature: "custom",
        },
      },
    ]);
    assert.equal(units[0].interactiveVisual, undefined);
    assert.equal(dropped.length, 1);
    assert.match(dropped[0], /custom_type/);
  });
});

describe("Learning Unit Contract — source artifact assignment (Fix 3/8)", () => {
  test("assigns artifacts to their exact units with placement + interpretation", () => {
    const assignments = assignSourceArtifacts(snnUnits());
    const byId = new Map(assignments.map((a) => [a.sourceArtifactId, a]));
    assert.equal(byId.get("S1.P4.F1"), undefined); // figure only referenced by an interactive visual anchor, not a sourceFigure
    assert.equal(byId.get("S1.P6.E1").assignedLearningUnitId, "U5");
    assert.equal(byId.get("S1.P9.T1").assignedLearningUnitId, "U11");
    assert.equal(byId.get("S1.P9.T1").placement, "inside_comparison");
    assert.ok(byId.get("S1.P6.E1").requiredInterpretation.length > 0);
  });

  test("dedupes duplicate source artifacts to one primary teaching unit", () => {
    const units = normalizeLearningUnits([
      {
        id: "A",
        role: "core_concept",
        title: "What the table measures",
        sourceTables: [{ id: "S1.P7.T1", teachingGoal: "Define table columns", rowsOrColumnsToExplain: ["accuracy"], placement: "inside_comparison" }],
      },
      {
        id: "B",
        role: "result_interpretation",
        title: "Reading the result table",
        sourceTables: [{ id: "S1.P7.T1", teachingGoal: "Interpret result patterns", rowsOrColumnsToExplain: ["accuracy"], placement: "inside_result_interpretation" }],
      },
      {
        id: "C",
        role: "limitation",
        title: "Where the result does not generalize",
        sourceTables: [{ id: "S1.P7.T1", teachingGoal: "Mention limitations", rowsOrColumnsToExplain: ["accuracy"], placement: "inside_comparison" }],
      },
    ]);
    const assignments = assignSourceArtifacts(units);
    assert.equal(assignments.filter((assignment) => assignment.sourceArtifactId === "S1.P7.T1").length, 1);
    assert.equal(assignments[0].assignedLearningUnitId, "B");
    assert.equal(assignments[0].placement, "inside_result_interpretation");
  });

  test("flags a result figure assigned to a definition unit", () => {
    const units = normalizeLearningUnits([
      { id: "D", role: "core_concept", title: "What SNNs are", sourceFigures: [{ id: "S1.P8.G1", placement: "inside_result_interpretation", mustBeDiscussedWith: "results", interpretationGoal: "read the curve" }] },
    ]);
    const problems = validateLearningUnitContracts(units);
    assert.ok(problems.some((p) => /result figure .* assigned to a definition/.test(p)));
  });
});

describe("Learning Unit Contract — inline figure placement (Fix 2)", () => {
  const prose = "The membrane potential rises as input current arrives, and each arriving spike nudges it upward until it reaches the firing threshold. ".repeat(2);

  test("flags a page that dumps figures under ## Source Figures", () => {
    const md = `${prose}\n\n## Source Figures\n\n![A source figure](assets/source-visuals/fig1.png)\n`;
    const problems = figurePlacementProblems(md);
    assert.ok(problems.some((p) => /Source Figures/.test(p)));
  });

  test("flags a figure with no nearby interpretive prose", () => {
    const md = `# Lesson\n\n![Orphan figure](assets/source-visuals/fig1.png)\n`;
    const problems = figurePlacementProblems(md);
    assert.ok(problems.some((p) => /no interpretive prose/.test(p)));
  });

  test("passes when a figure sits next to interpretive prose", () => {
    const md = `${prose}\n\n![Membrane potential trace](assets/source-visuals/fig1.png)\n\n${prose}`;
    assert.deepEqual(figurePlacementProblems(md), []);
  });

  test("flags more than 3 figures on one page", () => {
    const md = [prose, "![a](x/source-visuals/a.png)", prose, "![b](x/source-visuals/b.png)", prose, "![c](x/source-visuals/c.png)", prose, "![d](x/source-visuals/d.png)", prose].join("\n\n");
    const problems = figurePlacementProblems(md);
    assert.ok(problems.some((p) => /embeds 4 source figures/.test(p)));
  });
});

describe("Learning Unit Contract — full-set validation (Fix 11)", () => {
  test("a well-formed 14-unit contract set passes", () => {
    const problems = validateLearningUnitContracts(snnUnits(), { artifactCount: 6 });
    assert.deepEqual(problems, [], JSON.stringify(problems, null, 2));
  });

  test("too few units for an artifact-rich source fails", () => {
    const few = snnUnits().slice(0, 6);
    const problems = validateLearningUnitContracts(few, { artifactCount: 20 });
    assert.ok(problems.some((p) => /only 6 learning units/.test(p)));
  });

  test("a slash-namespaced handle is rejected", () => {
    const units = snnUnits();
    units[0].zettelNotes[0].handle = "metric/accuracy-per-energy";
    const problems = validateLearningUnitContracts(units);
    assert.ok(problems.some((p) => /slash namespace/.test(p) || /not an atomic concept handle/.test(p)));
  });
});

describe("Learning Unit Contract - section semantics and grounding", () => {
  test("flags training units grouped under a metrics-only section title", () => {
    const units = normalizeLearningUnits([
      { id: "T1", role: "training_method", title: "Surrogate-gradient training", learningQuestion: "How are spikes trained?" },
      { id: "T2", role: "training_method", title: "ANN-to-SNN conversion", learningQuestion: "How is conversion trained?" },
      { id: "M1", role: "metric", title: "Accuracy as a metric", learningQuestion: "How is accuracy measured?" },
    ]);
    const profile = sectionSemanticProfile({
      sectionTitle: "The Metrics That Make SNNs Measurable",
      units,
    });
    assert.equal(profile.titleMatchesUnits, false);
    assert.match(profile.problems.join("\n"), /SECTION_SEMANTIC_MISMATCH/);
    assert.match(profile.problems.join("\n"), /training units are grouped under a metrics-only title/);
  });

  test("accepts a mixed title that names learning and evaluation", () => {
    const units = normalizeLearningUnits([
      { id: "T1", role: "training_method", title: "Surrogate-gradient training", learningQuestion: "How are spikes trained?" },
      { id: "M1", role: "metric", title: "Accuracy as a metric", learningQuestion: "How is accuracy measured?" },
    ]);
    const profile = sectionSemanticProfile({
      sectionTitle: "How SNNs Learn and Are Evaluated",
      units,
    });
    assert.equal(profile.problems.length, 0, profile.problems.join("\n"));
  });

  test("generated mixed training/metric and comparison/metric section titles name both roles", () => {
    const trainingMetricUnits = normalizeLearningUnits([
      { id: "T1", role: "training_method", title: "Surrogate-gradient training", learningQuestion: "How are spikes trained?" },
      { id: "M1", role: "metric", title: "Accuracy and latency", learningQuestion: "How are SNNs evaluated?" },
    ]);
    const trainingMetricMap = learningMapFromUnits(trainingMetricUnits, {
      gardenId: "g",
      title: "Spiking Neural Networks",
      summary: "s",
      sourceOnly: true,
      createdAt: "2026-07-04T00:00:00Z",
    });
    assert.match(trainingMetricMap.sections[0].title, /learn.*evaluat/i);
    assert.equal(
      sectionSemanticProfile({ sectionTitle: trainingMetricMap.sections[0].title, units: trainingMetricUnits }).problems.length,
      0,
    );

    const comparisonMetricUnits = normalizeLearningUnits([
      { id: "M1", role: "metric", title: "Accuracy and latency", learningQuestion: "How are SNNs evaluated?" },
      { id: "C1", role: "comparison", title: "ANN versus SNN results", learningQuestion: "How do the model families compare?" },
    ]);
    const comparisonMetricMap = learningMapFromUnits(comparisonMetricUnits, {
      gardenId: "g",
      title: "Spiking Neural Networks",
      summary: "s",
      sourceOnly: true,
      createdAt: "2026-07-04T00:00:00Z",
    });
    assert.match(comparisonMetricMap.sections[0].title, /metrics?.*results?.*compar/i);
    assert.equal(
      sectionSemanticProfile({ sectionTitle: comparisonMetricMap.sections[0].title, units: comparisonMetricUnits }).problems.length,
      0,
    );
  });

  test("generated result-interpretation-only sections use results vocabulary", () => {
    const units = normalizeLearningUnits([
      { id: "R1", role: "result_interpretation", title: "Latency comparisons across models", learningQuestion: "What does the latency result mean?" },
      { id: "R2", role: "result_interpretation", title: "Energy and spike count comparisons", learningQuestion: "What does the energy result mean?" },
    ]);
    const map = learningMapFromUnits(units, {
      gardenId: "g",
      title: "Spiking Neural Networks",
      summary: "s",
      sourceOnly: true,
      createdAt: "2026-07-04T00:00:00Z",
    });
    assert.match(map.sections[0].title, /results?/i);
    assert.equal(
      sectionSemanticProfile({ sectionTitle: map.sections[0].title, units }).problems.length,
      0,
    );
  });

  test("allows an introductory why-title to introduce core SNN mechanisms", () => {
    const units = normalizeLearningUnits([
      { id: "M1", role: "mechanism", title: "Spikes, Timing, and Event-Driven Computation", learningQuestion: "How do spike events carry information?", newConcepts: ["spike events"] },
      { id: "M2", role: "mechanism", title: "The Leaky Integrate-and-Fire Neuron", learningQuestion: "How does the membrane potential produce spikes?", newConcepts: ["LIF neuron"] },
    ]);
    const profile = sectionSemanticProfile({
      sectionTitle: "1. Why SNNs Need Events",
      units,
    });
    assert.equal(profile.problems.length, 0, profile.problems.join("\n"));
  });

  test("title sanitizer fixes plural subject verb agreement before rendering", () => {
    assert.equal(sanitizeLearnerTitle("How SNNs Learns"), "How SNNs Learn");
    assert.equal(
      sanitizeLearnerTitle("Where SNNs Fits and What Still Blocks It"),
      "Where SNNs Fit and What Still Blocks Adoption",
    );
  });

  test("flags generic plural-subject singular-verb title grammar", () => {
    assert.match(sectionTitleGrammarProblems("How SNNs Learns").join("\n"), /SNNs.*Learn/);
    assert.match(sectionTitleGrammarProblems("Where LLMs Uses Tools").join("\n"), /LLMs.*Use/);
    assert.match(sectionTitleGrammarProblems("Why CNNs Fits Edge Devices").join("\n"), /CNNs.*Fit/);
    assert.match(sectionTitleGrammarProblems("How Agents Uses Memory").join("\n"), /Agents.*Use/);
  });

  test("rejects mechanism visuals grounded only in result-table text", () => {
    const problems = interactiveVisualGroundingProblems({
      visualType: "stdp_window",
      sourceAnchors: ["S1.P9.T1"],
      sourceAnchorText: "Latency and energy result table for model performance",
      status: "source-grounded",
      justification: "uses table",
    });
    assert.match(problems.join("\n"), /semantically incompatible|mechanism visual/);
  });

  test("accepts honest conceptual visuals with explicit justification", () => {
    const problems = interactiveVisualGroundingProblems({
      visualType: "stdp_window",
      sourceAnchors: [],
      sourceAnchorText: "",
      status: "conceptual-no-direct-source-figure",
      justification: "The source discusses STDP timing in prose but provides no timing-window figure, so the visual teaches the timing relationship conceptually.",
    });
    assert.deepEqual(problems, []);
  });
});
