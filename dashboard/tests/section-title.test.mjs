// Cross-domain regression + source-leakage tests for the topic-agnostic
// section-title system. Verifies that titles are generated from garden-derived
// vocabulary + universal purposes for ANY subject, with no domain leakage.

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  universalPurposeForRole,
  buildGardenTopicProfile,
  deriveSectionTitleIntent,
  generateSectionTitle,
  validateSectionTitleVocabulary,
  foreignTitleContentWords,
} from "../src/lib/section-title.ts";
import {
  learningMapFromUnits,
  normalizeLearningUnits,
  sectionSemanticProfile,
  sectionTitleNaturalnessProblems,
  sectionTitleGrammarProblems,
} from "../src/lib/learning-unit-contract.ts";

// SNN / neuroscience proper nouns that must never appear in a non-SNN garden.
const SNN_WORDS = /\b(snn|snns|spiking|neuromorphic|stdp|surrogate|ann[- ]to[- ]snn|neuron|neurons|membrane|synaptic|axon|dendrite)\b/i;

const META = { gardenId: "g", summary: "s", sourceOnly: true, createdAt: "2026-07-04T00:00:00Z" };
const u = (role, title, concepts = []) => ({ role, title, learningQuestion: `What should a learner understand about ${title}?`, newConcepts: concepts });

/** Generate a bare title for one section's unit group + assert the universal
 * invariants: learner-facing (naturalness+grammar), self-coherent (semantic
 * profile clean), and vocabulary-supported by the garden. */
function titleFor(gardenTitle, rawUnits, otherTitles = []) {
  const units = normalizeLearningUnits(rawUnits);
  const profile = buildGardenTopicProfile({ gardenTitle, units });
  const candidate = generateSectionTitle({ units, profile, otherSectionTitles: otherTitles });
  const title = candidate.title;
  assert.deepEqual(sectionTitleNaturalnessProblems(title), [], `naturalness of "${title}"`);
  assert.deepEqual(sectionTitleGrammarProblems(title), [], `grammar of "${title}"`);
  assert.equal(sectionSemanticProfile({ sectionTitle: title, units }).problems.length, 0, `semantic coherence of "${title}"`);
  assert.equal(validateSectionTitleVocabulary(title, profile).valid, true, `vocabulary provenance of "${title}"`);
  return { title, profile, candidate };
}

// ---------------------------------------------------------------------------
// Fix 1: universal purpose mapping
// ---------------------------------------------------------------------------

describe("universal section purposes", () => {
  test("every LearningUnitRole maps to a universal purpose", () => {
    assert.equal(universalPurposeForRole("motivation"), "orientation");
    assert.equal(universalPurposeForRole("core_concept"), "concept");
    assert.equal(universalPurposeForRole("mechanism"), "process");
    assert.equal(universalPurposeForRole("formula"), "formalism");
    assert.equal(universalPurposeForRole("worked_example"), "example");
    assert.equal(universalPurposeForRole("training_method"), "method");
    assert.equal(universalPurposeForRole("metric"), "evaluation");
    assert.equal(universalPurposeForRole("result_interpretation"), "evidence");
    assert.equal(universalPurposeForRole("comparison"), "comparison");
    assert.equal(universalPurposeForRole("application"), "application");
    assert.equal(universalPurposeForRole("limitation"), "limitation");
    assert.equal(universalPurposeForRole("synthesis"), "synthesis");
  });

  test("SectionTitleIntent derives primary purpose + focus from unit roles", () => {
    const units = normalizeLearningUnits([u("application", "Deployment"), u("application", "Field use"), u("limitation", "Open problems")]);
    const intent = deriveSectionTitleIntent(units, 6);
    assert.equal(intent.primaryPurpose, "application");
    assert.ok(intent.secondaryPurposes.includes("limitation"));
    assert.equal(intent.learnerMove, "apply_method");
  });
});

// ---------------------------------------------------------------------------
// Fix 6: vocabulary provenance
// ---------------------------------------------------------------------------

describe("vocabulary provenance", () => {
  test("rejects foreign-domain vocabulary (the Photosynthesis / SNN example)", () => {
    const units = normalizeLearningUnits([
      u("concept", "Chlorophyll and light absorption", ["chlorophyll"]),
      u("process", "The Calvin cycle", ["calvin cycle"]),
    ]);
    const profile = buildGardenTopicProfile({ gardenTitle: "Photosynthesis", units });
    const result = validateSectionTitleVocabulary("Where SNNs Fit and What Still Blocks Adoption", profile);
    assert.equal(result.valid, false);
    const unsupportedLower = result.unsupportedTerms.map((t) => t.toLowerCase());
    assert.ok(unsupportedLower.includes("snns"), `expected SNNs unsupported, got ${JSON.stringify(result.unsupportedTerms)}`);
    assert.ok(unsupportedLower.includes("adoption"), `expected adoption unsupported, got ${JSON.stringify(result.unsupportedTerms)}`);
  });

  test("accepts garden-derived + universal vocabulary", () => {
    const units = normalizeLearningUnits([u("concept", "Chlorophyll and light absorption", ["chlorophyll"])]);
    const profile = buildGardenTopicProfile({ gardenTitle: "Photosynthesis", units });
    assert.equal(validateSectionTitleVocabulary("Understanding Chlorophyll", profile).valid, true);
    assert.equal(validateSectionTitleVocabulary("The Core Ideas", profile).valid, true);
    assert.equal(validateSectionTitleVocabulary("Applications and Practical Use", profile).valid, true);
  });

  test("foreignTitleContentWords flags only unsourced, non-universal words", () => {
    assert.deepEqual(foreignTitleContentWords("The Core Ideas", ["chlorophyll", "light"]), []);
    assert.deepEqual(foreignTitleContentWords("Understanding Chlorophyll", ["chlorophyll and light"]), []);
    assert.ok(foreignTitleContentWords("Neuron Membrane Dynamics", ["accuracy", "latency"]).length > 0);
  });
});

// ---------------------------------------------------------------------------
// Fix 10: cross-domain fixtures
// ---------------------------------------------------------------------------

describe("cross-domain section titles", () => {
  // 1. Spiking neural networks (the reference STEM garden).
  test("1. spiking neural networks — application/limitation section is topic-neutral", () => {
    const { title } = titleFor("Spiking Neural Networks", [
      u("limitation", "Limits of conventional architectures", ["dense network limits"]),
      u("application", "Neuromorphic hardware and deployment", ["hardware deployment"]),
      u("synthesis", "Choosing a strategy", ["strategy choice"]),
    ]);
    // The title itself is universal (the OLD hardcoded "Where SNNs Fit..." is gone).
    assert.match(title, /application|limits?|open questions|practical/i);
    assert.doesNotMatch(title, /\bSNN\b|spiking|neuromorphic|surrogate|stdp/i);
  });

  // 2. Photosynthesis (biology).
  test("2. photosynthesis — no SNN vocabulary leaks; concepts are garden-derived", () => {
    const sections = [
      [u("motivation", "Why plants capture light", ["light energy"]), u("core_concept", "Chlorophyll and pigments", ["chlorophyll"])],
      [u("mechanism", "The light-dependent reactions", ["electron transport"]), u("mechanism", "The Calvin cycle", ["carbon fixation"])],
      [u("application", "Photosynthesis in agriculture", ["crop yield"]), u("limitation", "Limits under drought stress", ["water stress"])],
    ];
    const used = [];
    for (const s of sections) {
      const { title } = titleFor("Photosynthesis", s, used);
      used.push(title);
      assert.doesNotMatch(title, SNN_WORDS, `SNN leakage in "${title}"`);
    }
  });

  // 3. The French Revolution (history) — must not be forced into metric/formula wording.
  test("3. french revolution — history sections are not forced into metric/formula wording", () => {
    const sections = [
      [u("motivation", "Why the old regime collapsed", ["ancien regime"]), u("core_concept", "The estates and their grievances", ["estates system"])],
      [u("result_interpretation", "Reading the revolutionary timeline", ["timeline of events"]), u("comparison", "Comparing revolutionary factions", ["jacobins girondins"])],
      [u("application", "The revolution's lasting legacy", ["modern influence"]), u("limitation", "Contested historical interpretations", ["historiography debate"])],
    ];
    const used = [];
    for (const s of sections) {
      const { title } = titleFor("The French Revolution", s, used);
      used.push(title);
      assert.doesNotMatch(title, /\bformula\b|\bequation\b|\bmetric\b|\bmeasuring\b|\btraining\b/i, `math/metric wording in "${title}"`);
      assert.doesNotMatch(title, SNN_WORDS);
    }
  });

  // 4. Contract law — must not be forced into training terminology.
  test("4. contract law — law sections are not forced into training terminology", () => {
    const sections = [
      [u("core_concept", "What makes an agreement enforceable", ["offer acceptance"]), u("core_concept", "Consideration and intent", ["consideration"])],
      [u("training_method", "How to form a valid contract", ["contract formation"]), u("training_method", "Drafting enforceable terms", ["drafting clauses"])],
      [u("application", "Applying contract rules to disputes", ["breach remedies"]), u("limitation", "Where doctrine is unsettled", ["unsettled doctrine"])],
    ];
    const used = [];
    for (const s of sections) {
      const { title } = titleFor("Contract Law", s, used);
      used.push(title);
      assert.doesNotMatch(title, /\btraining\b|\bgradient\b|\bsurrogate\b/i, `training terminology in "${title}"`);
      assert.doesNotMatch(title, SNN_WORDS);
    }
  });

  // 5. Fourier analysis (STEM) — can use mathematical/measurement titles when supported.
  test("5. fourier analysis — formalism/evaluation sections can use math/measurement titles", () => {
    const formal = titleFor("Fourier Analysis", [
      u("formula", "The Fourier transform definition", ["fourier transform"]),
      u("worked_example", "Transforming a square wave", ["square wave"]),
    ]);
    assert.match(formal.title, /formal|mathematical|describing|worked|transform/i);

    const evalSection = titleFor("Fourier Analysis", [
      u("metric", "Measuring spectral energy", ["spectral energy"]),
      u("metric", "Frequency resolution", ["frequency resolution"]),
    ]);
    assert.match(evalSection.title, /measur|evaluat|spectral|frequency/i);
    assert.doesNotMatch(evalSection.title, SNN_WORDS);
  });

  // 6. Supply-chain management — application/limitation works.
  test("6. supply-chain management — application/limitation section is coherent", () => {
    const { title } = titleFor("Supply-Chain Management", [
      u("application", "Applying inventory strategies", ["inventory optimization"]),
      u("limitation", "Limits under disruption", ["disruption risk"]),
    ]);
    assert.match(title, /application|limits?|open questions|practical|inventory/i);
    assert.doesNotMatch(title, SNN_WORDS);
  });

  // 7. Quantum mechanics (STEM) — formalism supported, no cross-domain leakage.
  test("7. quantum mechanics — formalism section stays math-flavored and clean", () => {
    const { title } = titleFor("Quantum Mechanics", [
      u("formula", "The Schrodinger equation", ["schrodinger equation"]),
      u("core_concept", "Superposition and states", ["superposition"]),
    ]);
    assert.doesNotMatch(title, SNN_WORDS);
    assert.doesNotMatch(title, /\btraining\b|\bsurrogate\b/i);
  });

  // 8. Unknown topic with no recognizable domain — receives valid universal titles.
  test("8. unknown topic — every purpose still gets a valid, universal title", () => {
    const roleSets = [
      ["motivation"], ["core_concept"], ["mechanism"], ["formula"], ["worked_example"],
      ["training_method"], ["metric"], ["result_interpretation"], ["comparison"],
      ["application"], ["limitation"], ["synthesis"],
    ];
    const used = [];
    for (const roles of roleSets) {
      const rawUnits = roles.flatMap((role, i) => [
        u(role, `Widget calibration facet ${i}A`, ["calibration facet"]),
        u(role, `Widget calibration facet ${i}B`, ["tolerance band"]),
      ]);
      const { title } = titleFor("Widget Calibration", rawUnits, used);
      used.push(title);
      assert.doesNotMatch(title, SNN_WORDS);
    }
  });
});

// ---------------------------------------------------------------------------
// Cross-garden isolation + uniqueness
// ---------------------------------------------------------------------------

describe("cross-garden isolation and uniqueness", () => {
  test("no SNN vocabulary leaks into a non-SNN garden's full map", () => {
    const historyUnits = normalizeLearningUnits([
      u("motivation", "Why the revolution began", ["ancien regime"]),
      u("core_concept", "The three estates", ["estates system"]),
      u("mechanism", "How events unfolded", ["storming bastille"]),
      u("result_interpretation", "Reading the timeline", ["timeline"]),
      u("comparison", "Comparing the factions", ["jacobins"]),
      u("application", "The lasting legacy", ["modern influence"]),
      u("limitation", "Contested interpretations", ["historiography"]),
      u("synthesis", "Putting it together", ["synthesis"]),
    ]);
    const map = learningMapFromUnits(historyUnits, { ...META, title: "The French Revolution" });
    for (const section of map.sections) {
      assert.doesNotMatch(section.title, SNN_WORDS, `SNN leakage: "${section.title}"`);
      assert.deepEqual(sectionTitleNaturalnessProblems(section.title), [], section.title);
    }
    // Titles are unique across the garden.
    const keys = map.sections.map((s) => s.title.toLowerCase());
    assert.equal(new Set(keys).size, keys.length, `duplicate section titles: ${JSON.stringify(map.sections.map((s) => s.title))}`);
  });

  test("the SNN garden may legitimately use SNN concepts (they come from its own units)", () => {
    const snnUnits = normalizeLearningUnits([
      u("motivation", "Why spiking networks exist", ["event-driven computation"]),
      u("mechanism", "The leaky integrate-and-fire neuron", ["LIF neuron"]),
      u("training_method", "Surrogate-gradient training", ["surrogate gradient"]),
      u("metric", "Accuracy and latency", ["accuracy"]),
      u("application", "Neuromorphic deployment", ["neuromorphic hardware"]),
      u("limitation", "Adoption barriers", ["hardware barriers"]),
    ]);
    const map = learningMapFromUnits(snnUnits, { ...META, title: "Spiking Neural Networks" });
    // Every title is still learner-facing and coherent, regardless of vocabulary.
    for (const section of map.sections) {
      assert.deepEqual(sectionTitleNaturalnessProblems(section.title), [], section.title);
      assert.deepEqual(sectionTitleGrammarProblems(section.title), [], section.title);
    }
  });
});

// ---------------------------------------------------------------------------
// Fix 11: source-code leakage scan
// ---------------------------------------------------------------------------

describe("source-code leakage", () => {
  test("the topic-general title module contains no hardcoded domain proper nouns", () => {
    const modulePath = fileURLToPath(new URL("../src/lib/section-title.ts", import.meta.url));
    const source = fs.readFileSync(modulePath, "utf-8");
    // Strip comments so the leakage RULE description doesn't trip the scan.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .split(/\r?\n/)
      .map((line) => line.replace(/\/\/.*$/, ""))
      .join("\n");
    const prohibited = [/\bSNN\b/i, /spiking neural/i, /neuromorphic/i, /\bSTDP\b/i, /surrogate gradient/i, /ann[- ]to[- ]snn/i];
    for (const pattern of prohibited) {
      assert.doesNotMatch(code, pattern, `prohibited domain literal ${pattern} found in section-title.ts code`);
    }
  });

  test("the de-SNN'd title role hints in learning-unit-contract carry no domain proper nouns", () => {
    const modulePath = fileURLToPath(new URL("../src/lib/learning-unit-contract.ts", import.meta.url));
    const source = fs.readFileSync(modulePath, "utf-8");
    // Scope to the TITLE_ROLE_HINTS block (the title-vocabulary consistency check).
    const block = source.match(/const TITLE_ROLE_HINTS[\s\S]*?\n\];/)?.[0] ?? "";
    assert.ok(block.length > 0, "TITLE_ROLE_HINTS block not found");
    for (const pattern of [/\bSNN\b/i, /spiking/i, /neuromorphic/i, /\bstdp\b/i, /surrogate/i, /\bneuron\b/i, /membrane/i, /ann-to-snn/i]) {
      assert.doesNotMatch(block, pattern, `domain literal ${pattern} in TITLE_ROLE_HINTS`);
    }
  });
});
