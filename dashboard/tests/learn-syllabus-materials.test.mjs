import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  detectUnavailableCitations,
  modelAuthoredSyllabusPlanProblems,
  normalizeSyllabusPlan,
  projectModelAuthoredSyllabusPlan,
  projectModelAuthoredSyllabusCoverage,
  summarizeSyllabusCoverage,
  syllabusCoverageDecisionProblems,
  unavailableCitationProbes,
} from "../src/lib/learn-syllabus.ts";
import { assessLessonQuality } from "../src/lib/learn-utils.ts";

const learnSource = fs.readFileSync(new URL("../src/lib/learn.ts", import.meta.url), "utf8");
const syllabusSource = fs.readFileSync(
  new URL("../src/lib/learn-syllabus.ts", import.meta.url),
  "utf8",
);

function assertSource(pattern, description) {
  assert.ok(
    typeof pattern === "string" ? learnSource.includes(pattern) : pattern.test(learnSource),
    `learn.ts should ${description}`,
  );
}

function courseFixture() {
  const plan = normalizeSyllabusPlan({
    courseTitle: "Spiking Neural Networks",
    units: [
      {
        id: "SU1",
        label: "Week 1",
        title: "Why spiking networks exist",
        objectives: ["Explain why dense activations waste energy"],
        topics: ["event-driven computation", "sparsity"],
        materialIds: ["R1"],
      },
      {
        id: "SU2",
        label: "Week 2",
        title: "Membrane dynamics",
        objectives: ["Derive the leaky integrate-and-fire update"],
        topics: ["membrane potential", "threshold"],
        materialIds: ["R2"],
      },
      {
        id: "SU3",
        label: "Week 3",
        title: "Neuromorphic hardware deployment",
        objectives: ["Compare deployment targets"],
        topics: ["hardware"],
        materialIds: ["R3"],
      },
    ],
    referencedMaterials: [
      {
        id: "R1",
        citation: "Maass, Networks of Spiking Neurons, ch. 1",
        title: "Networks of Spiking Neurons",
        authors: ["Maass"],
        kind: "chapter",
        locator: "ch. 1",
        required: true,
      },
      {
        id: "R2",
        citation: "Gerstner, Neuronal Dynamics, ch. 4",
        title: "Neuronal Dynamics",
        authors: ["Gerstner"],
        kind: "chapter",
        locator: "ch. 4",
        required: true,
      },
      {
        id: "R3",
        citation: "Davies et al., Loihi Architecture Review (2021)",
        title: "Loihi Architecture Review",
        authors: ["Davies"],
        kind: "paper",
        required: true,
      },
    ],
  });
  const sourceIds = ["networks-of-spiking-neurons", "neuronal-dynamics-ch4"];
  const decision = {
    resolutions: [
      {
        materialId: "R1",
        citation: "Maass, Networks of Spiking Neurons, ch. 1",
        status: "available",
        sourceIds: ["networks-of-spiking-neurons"],
        matchReason: "The selected source contents explicitly list and contain chapter 1.",
      },
      {
        materialId: "R2",
        citation: "Gerstner, Neuronal Dynamics, ch. 4",
        status: "available",
        sourceIds: ["neuronal-dynamics-ch4"],
        matchReason: "The selected source excerpt is explicitly from chapter 4.",
      },
      {
        materialId: "R3",
        citation: "Davies et al., Loihi Architecture Review (2021)",
        status: "missing",
        sourceIds: [],
        matchReason: "No selected source is the cited paper.",
      },
    ],
    units: [
      {
        unitId: "SU1",
        availableSourceIds: ["networks-of-spiking-neurons"],
        missingCitations: [],
        teachable: true,
        coverageReason: "The uploaded chapter directly supports the objectives.",
      },
      {
        unitId: "SU2",
        availableSourceIds: ["neuronal-dynamics-ch4"],
        missingCitations: [],
        teachable: true,
        coverageReason: "The uploaded chapter directly supports the derivation.",
      },
      {
        unitId: "SU3",
        availableSourceIds: [],
        missingCitations: ["Davies et al., Loihi Architecture Review (2021)"],
        teachable: false,
        coverageReason: "The only assigned work is absent and no selected source supports deployment targets.",
      },
    ],
  };
  return {
    plan,
    sourceIds,
    decision,
    coverage: projectModelAuthoredSyllabusCoverage(plan, decision, sourceIds),
  };
}

describe("reading a syllabus", () => {
  test("active model-authored reading is projected exactly and malformed fields are repaired instead of normalized", () => {
    const exact = {
      courseTitle: "Electromagnetism",
      units: [{
        id: "SU1",
        label: "Week 1",
        title: "Electrostatic fields",
        objectives: ["Relate flux and charge"],
        topics: ["Gauss's law"],
        materialIds: ["R1"],
      }],
      referencedMaterials: [{
        id: "R1",
        citation: "Engineering Electromagnetics, chapter 3",
        title: "Engineering Electromagnetics",
        authors: ["William Hayt"],
        kind: "chapter",
        locator: "chapter 3",
        required: true,
      }],
    };
    assert.deepEqual(modelAuthoredSyllabusPlanProblems(exact), []);
    assert.deepEqual(projectModelAuthoredSyllabusPlan(exact), exact);

    const padded = structuredClone(exact);
    padded.referencedMaterials[0].locator = " chapter 3 ";
    assert.match(modelAuthoredSyllabusPlanProblems(padded).join("; "), /locator.*exact string/i);
    assert.throws(() => projectModelAuthoredSyllabusPlan(padded), /Invalid model-authored syllabus plan/);

    const unknown = structuredClone(exact);
    unknown.units[0].materialIds = ["R_UNKNOWN"];
    assert.match(modelAuthoredSyllabusPlanProblems(unknown).join("; "), /unknown R_UNKNOWN/);
  });

  test("extracts units and the materials they assign", () => {
    const { plan } = courseFixture();
    assert.equal(plan.courseTitle, "Spiking Neural Networks");
    assert.equal(plan.units.length, 3);
    assert.equal(plan.referencedMaterials.length, 3);
    assert.deepEqual(plan.units[0].materialIds, ["R1"]);
    assert.equal(plan.referencedMaterials[0].locator, "ch. 1");
    assert.equal(plan.referencedMaterials[0].required, true);
  });

  test("a malformed reading degrades to no structure instead of throwing", () => {
    for (const bad of [null, undefined, "not json", 42, [], {}]) {
      const plan = normalizeSyllabusPlan(bad);
      assert.deepEqual(plan.units, []);
      assert.deepEqual(plan.referencedMaterials, []);
    }
  });

  test("materials linked to unknown ids are dropped, not invented", () => {
    const plan = normalizeSyllabusPlan({
      units: [{ id: "SU1", title: "Week 1", materialIds: ["R9", "R1"] }],
      referencedMaterials: [{ id: "R1", citation: "Real Book" }],
    });
    assert.deepEqual(plan.units[0].materialIds, ["R1"]);
  });
});

describe("validating model-authored syllabus coverage", () => {
  test("projects every semantic verdict verbatim", () => {
    const { plan, sourceIds, decision, coverage } = courseFixture();
    assert.deepEqual(syllabusCoverageDecisionProblems(decision, plan, sourceIds), []);
    assert.equal(coverage.resolutions[2].status, "missing");
    assert.equal(coverage.units[2].teachable, false);
    assert.equal(coverage.units[2].coverageReason, decision.units[2].coverageReason);
    assert.deepEqual(coverage.availableSourceIds, [
      "networks-of-spiking-neurons",
      "neuronal-dynamics-ch4",
    ]);
    assert.deepEqual(coverage.untaughtUnitTitles, [
      "Week 3: Neuromorphic hardware deployment",
    ]);
  });

  test("requires a complete ordered decision", () => {
    const { plan, sourceIds, decision } = courseFixture();
    const incomplete = {
      resolutions: decision.resolutions.slice(1),
      units: decision.units.slice(0, 2),
    };
    const problems = syllabusCoverageDecisionProblems(incomplete, plan, sourceIds);
    assert.ok(problems.some((problem) => problem.includes("exactly 3 entries")));
    assert.ok(problems.some((problem) => problem.includes("must be exact plan id R1")));
  });

  test("rejects changed citations and unknown source ids", () => {
    const { plan, sourceIds, decision } = courseFixture();
    const invalid = structuredClone(decision);
    invalid.resolutions[0].citation = "similar but not exact";
    invalid.resolutions[0].sourceIds = ["made-up-source"];
    invalid.units[0].availableSourceIds = ["made-up-source"];
    const problems = syllabusCoverageDecisionProblems(invalid, plan, sourceIds);
    assert.ok(problems.some((problem) => problem.includes("exactly equal")));
    assert.ok(problems.some((problem) => problem.includes("unknown source id made-up-source")));
  });

  test("rejects contradictory status and source selections", () => {
    const { plan, sourceIds, decision } = courseFixture();
    const invalid = structuredClone(decision);
    invalid.resolutions[0].status = "missing";
    const problems = syllabusCoverageDecisionProblems(invalid, plan, sourceIds);
    assert.ok(problems.some((problem) => problem.includes("missing material R1 must not select source ids")));
    assert.ok(problems.some((problem) => problem.includes("missingCitations must exactly list")));
  });

  test("a matching book title cannot auto-promote an unverified chapter", () => {
    const plan = normalizeSyllabusPlan({
      units: [{ id: "SU1", title: "Boundary conditions", materialIds: ["R1"] }],
      referencedMaterials: [{
        id: "R1",
        citation: "Engineering Electromagnetics, chapter 9",
        title: "Engineering Electromagnetics",
        locator: "chapter 9",
        kind: "chapter",
        required: true,
      }],
    });
    const decision = {
      resolutions: [{
        materialId: "R1",
        citation: "Engineering Electromagnetics, chapter 9",
        status: "missing",
        sourceIds: [],
        matchReason: "The book title is present, but supplied evidence does not establish chapter 9 is present.",
      }],
      units: [{
        unitId: "SU1",
        availableSourceIds: [],
        missingCitations: ["Engineering Electromagnetics, chapter 9"],
        teachable: false,
        coverageReason: "The required chapter locator is not supported by the supplied evidence.",
      }],
    };
    assert.deepEqual(
      syllabusCoverageDecisionProblems(decision, plan, ["engineering-electromagnetics"]),
      [],
    );
    assert.equal(
      projectModelAuthoredSyllabusCoverage(plan, decision, ["engineering-electromagnetics"])
        .resolutions[0].status,
      "missing",
    );
  });

  test("required and optional materials inform, but do not compute, teachability", () => {
    const plan = normalizeSyllabusPlan({
      units: [
        { id: "SU1", title: "Required case", materialIds: ["R1"] },
        { id: "SU2", title: "Optional extension", materialIds: ["R2"] },
      ],
      referencedMaterials: [
        { id: "R1", citation: "Required Case Study", kind: "paper", required: true },
        { id: "R2", citation: "Optional Worked Examples", kind: "reading", required: false },
      ],
    });
    const decision = {
      resolutions: [
        { materialId: "R1", citation: "Required Case Study", status: "missing", sourceIds: [], matchReason: "Not present." },
        { materialId: "R2", citation: "Optional Worked Examples", status: "missing", sourceIds: [], matchReason: "Not present." },
      ],
      units: [
        {
          unitId: "SU1",
          availableSourceIds: [],
          missingCitations: ["Required Case Study"],
          teachable: false,
          coverageReason: "No source supports the required case.",
        },
        {
          unitId: "SU2",
          availableSourceIds: ["uploaded-notes"],
          missingCitations: ["Optional Worked Examples"],
          teachable: true,
          coverageReason: "The optional reading is absent, but uploaded notes directly support the unit topic.",
        },
      ],
    };
    assert.deepEqual(syllabusCoverageDecisionProblems(decision, plan, ["uploaded-notes"]), []);
    const coverage = projectModelAuthoredSyllabusCoverage(plan, decision, ["uploaded-notes"]);
    assert.equal(coverage.units[0].teachable, false);
    assert.equal(coverage.units[1].teachable, true);
  });

  test("summarizes authored material statuses", () => {
    assert.deepEqual(summarizeSyllabusCoverage(courseFixture().coverage), {
      unitCount: 3,
      materialCount: 3,
      availableCount: 2,
      missingCount: 1,
      genericCount: 0,
    });
  });
});

describe("the unavailable-citation safety gate", () => {
  test("a page teaching from a model-authored missing work hard-fails", () => {
    const { coverage } = courseFixture();
    const probes = unavailableCitationProbes(coverage);
    const fabricated =
      "The Loihi Architecture Review shows that event-driven cores cut energy by an order of magnitude.";
    assert.deepEqual(detectUnavailableCitations(fabricated, probes), [
      "Davies et al., Loihi Architecture Review (2021)",
    ]);
    const assessment = assessLessonQuality(fabricated, {
      unavailableCitations: { detect: (prose) => detectUnavailableCitations(prose, probes) },
    });
    assert.equal(
      assessment.problems.find((problem) => problem.code === "unavailable-citation")?.hard,
      true,
    );
  });

  test("available works and no-syllabus flows stay outside the gate", () => {
    const probes = unavailableCitationProbes(courseFixture().coverage);
    assert.deepEqual(
      detectUnavailableCitations("Neuronal Dynamics derives the membrane equation.", probes),
      [],
    );
    assert.deepEqual(unavailableCitationProbes(null), []);
    assert.deepEqual(detectUnavailableCitations("anything", []), []);
  });

  test("uses exact authored identifiers instead of fuzzy citation inference", () => {
    const probes = unavailableCitationProbes(courseFixture().coverage);
    assert.deepEqual(
      detectUnavailableCitations(
        "Davies et al.,   Loihi Architecture Review (2021) is assigned here.",
        probes,
      ),
      ["Davies et al., Loihi Architecture Review (2021)"],
    );
    assert.deepEqual(
      detectUnavailableCitations("Davies and colleagues reported this in 2021.", probes),
      [],
    );
    assert.deepEqual(
      detectUnavailableCitations("A Loihi review discusses architecture.", probes),
      [],
    );
  });
});

describe("pipeline wiring for model-authored syllabus coverage", () => {
  test("uses a second bounded validated model call before source planning", () => {
    assertSource("SYLLABUS_READING_PROMPT", "have a syllabus-reading prompt");
    assertSource("SYLLABUS_COVERAGE_PROMPT", "have a separate syllabus-coverage prompt");
    assertSource("stageLabel: \"Syllabus coverage review\"", "route coverage through bounded schema repair");
    assertSource("syllabusCoverageDecisionProblems(", "validate the complete model decision");
    assertSource("projectModelAuthoredSyllabusCoverage(", "project the validated decision");
  });

  test("supplies exact material semantics and selected source evidence", () => {
    assertSource("selectedSourceCatalog: promptSyllabusCoverageSourceCatalog(context)", "send selected sources");
    assertSource("sourceFile: source.sourceFile", "send exact source filenames");
    assertSource("content: sourcePlanningIndex(source.body", "send exact bounded source content");
    assertSource("Match title/authors AND any locator", "require locator-level evidence");
    assertSource("A missing REQUIRED material", "tell the model how required status matters");
    assertSource("A missing OPTIONAL material", "tell the model how optional status matters");
  });

  test("contains no active deterministic material matcher or teachability fallback", () => {
    assert.equal(learnSource.includes("resolveSyllabusMaterials("), false);
    assert.equal(learnSource.includes("buildSyllabusCoverage("), false);
    assert.equal(syllabusSource.includes("scoreMaterialAgainstSource"), false);
    assert.equal(syllabusSource.includes("AVAILABILITY_THRESHOLD"), false);
    assert.equal(syllabusSource.includes("referencedAnything || missingCitations.length"), false);
  });

  test("preserves the none/no-syllabus flow and carries coverage to planning", () => {
    assertSource("if (context.syllabus) {", "only invoke syllabus models when selected");
    const hits = (learnSource.match(/syllabusCoverage: syllabusCoveragePayload/g) ?? []).length;
    assert.equal(hits, 3, `expected coverage in all 3 planning payloads, found ${hits}`);
  });

  test("missing works become explicit warnings", () => {
    assertSource("work(s) that are not in this garden", "warn about missing-material verdicts");
    assertSource(
      "has no available material in this garden and was left uncovered",
      "warn about model-authored unteachable units",
    );
  });
});
