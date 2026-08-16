import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  authoredSyllabusLocatorCatalog,
  boundedCanonicalSourcePageEvidence,
  buildSyllabusCoverageSourceCatalog,
  canonicalSourceRawPageBlocks,
  detectUnavailableCitations,
  hydrateSelectedCanonicalSourceRawPages,
  modelAuthoredSyllabusPlanProblems,
  parseCanonicalSourceRawPages,
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

function partialSupportFixture() {
  const plan = normalizeSyllabusPlan({
    courseTitle: "Signals and systems",
    units: [{
      id: "SU_PARTIAL",
      label: "Module 4",
      title: "Numerical boundary-value methods",
      objectives: ["Apply a finite-difference method and interpret its result"],
      topics: ["boundary-value equations", "finite differences"],
      materialIds: ["R_TEXT", "R_WORKBOOK"],
    }],
    referencedMaterials: [
      {
        id: "R_TEXT",
        citation: "Boundary-Value Theory, ch. 6",
        title: "Boundary-Value Theory",
        kind: "chapter",
        locator: "ch. 6",
        required: true,
      },
      {
        id: "R_WORKBOOK",
        citation: "Numerical Methods Workbook, exercise set 4",
        title: "Numerical Methods Workbook",
        kind: "reading",
        locator: "exercise set 4",
        required: true,
      },
    ],
  });
  const sourceIds = ["boundary-value-theory-ch6"];
  const decision = {
    resolutions: [
      {
        materialId: "R_TEXT",
        citation: "Boundary-Value Theory, ch. 6",
        status: "available",
        sourceIds: ["boundary-value-theory-ch6"],
        matchReason: "The selected chapter directly derives the boundary-value equations.",
      },
      {
        materialId: "R_WORKBOOK",
        citation: "Numerical Methods Workbook, exercise set 4",
        status: "missing",
        sourceIds: [],
        matchReason: "No selected source is the assigned exercise workbook.",
      },
    ],
    units: [{
      unitId: "SU_PARTIAL",
      availableSourceIds: ["boundary-value-theory-ch6"],
      missingCitations: ["Numerical Methods Workbook, exercise set 4"],
      teachable: false,
      coverageReason: "The selected chapter directly supports the equations, but the required numerical-method exercises are absent, so the full objective cannot be taught.",
    }],
  };
  return { plan, sourceIds, decision };
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

  test("preserves repeated missing citations for distinct assigned material ids", () => {
    const citation = "Shared course resource on Canvas";
    const authoredPlan = {
      courseTitle: "Repeated-resource course",
      referencedMaterials: [
        {
          id: "R1",
          citation,
          title: "Shared course resource",
          authors: [],
          kind: "reading",
          required: true,
        },
        {
          id: "R2",
          citation,
          title: "Shared course resource",
          authors: [],
          kind: "reading",
          required: true,
        },
      ],
      units: [{
        id: "SU1",
        title: "Repeated-resource unit",
        objectives: ["Use the assigned resource"],
        topics: ["resource"],
        materialIds: ["R1", "R2"],
      }],
    };
    assert.deepEqual(modelAuthoredSyllabusPlanProblems(authoredPlan), []);
    const plan = projectModelAuthoredSyllabusPlan(authoredPlan);
    const decision = {
      resolutions: [
        {
          materialId: "R1",
          citation,
          status: "missing",
          sourceIds: [],
          matchReason: "The selected sources do not contain this assigned resource.",
        },
        {
          materialId: "R2",
          citation,
          status: "missing",
          sourceIds: [],
          matchReason: "The selected sources do not contain this assigned resource.",
        },
      ],
      units: [{
        unitId: "SU1",
        availableSourceIds: [],
        missingCitations: [citation, citation],
        teachable: false,
        coverageReason: "Both separately assigned resource records are absent.",
      }],
    };

    assert.deepEqual(syllabusCoverageDecisionProblems(decision, plan, ["uploaded-notes"]), []);
    assert.deepEqual(
      projectModelAuthoredSyllabusCoverage(plan, decision, ["uploaded-notes"])
        .units[0].missingCitations,
      [citation, citation],
    );

    const deduplicated = structuredClone(decision);
    deduplicated.units[0].missingCitations = [citation];
    assert.ok(
      syllabusCoverageDecisionProblems(deduplicated, plan, ["uploaded-notes"])
        .some((problem) => problem.includes("missingCitations must exactly list")),
    );

    const extraDuplicate = structuredClone(decision);
    extraDuplicate.units[0].missingCitations = [citation, citation, citation];
    assert.ok(
      syllabusCoverageDecisionProblems(extraDuplicate, plan, ["uploaded-notes"])
        .some((problem) => problem.includes("missingCitations must exactly list")),
    );
  });

  test("continues to reject duplicate source identifiers while repeated citations are allowed", () => {
    const { plan, sourceIds, decision } = courseFixture();
    const invalid = structuredClone(decision);
    invalid.resolutions[0].sourceIds = [
      "networks-of-spiking-neurons",
      "networks-of-spiking-neurons",
    ];
    invalid.units[0].availableSourceIds = [
      "networks-of-spiking-neurons",
      "networks-of-spiking-neurons",
    ];

    const problems = syllabusCoverageDecisionProblems(invalid, plan, sourceIds);
    assert.ok(problems.includes("resolution R1.sourceIds duplicates networks-of-spiking-neurons"));
    assert.ok(problems.includes("unit SU1.availableSourceIds duplicates networks-of-spiking-neurons"));
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

  test("accepts partial model-authored support for an unteachable unit without rewriting provenance", () => {
    const { plan, sourceIds, decision } = partialSupportFixture();
    const originalDecision = structuredClone(decision);

    assert.deepEqual(syllabusCoverageDecisionProblems(decision, plan, sourceIds), []);
    const coverage = projectModelAuthoredSyllabusCoverage(plan, decision, sourceIds);

    assert.deepEqual(decision, originalDecision, "projection must not rewrite the model decision");
    assert.equal(coverage.units[0].teachable, false);
    assert.deepEqual(coverage.units[0].availableSourceIds, ["boundary-value-theory-ch6"]);
    assert.equal(coverage.units[0].coverageReason, originalDecision.units[0].coverageReason);
    assert.deepEqual(coverage.resolutions[0].sourceIds, ["boundary-value-theory-ch6"]);
    assert.deepEqual(coverage.availableSourceIds, ["boundary-value-theory-ch6"]);
    assert.deepEqual(coverage.untaughtUnitTitles, [
      "Module 4: Numerical boundary-value methods",
    ]);
  });

  test("rejects an unteachable unit that omits an available assigned source", () => {
    const { plan, sourceIds, decision } = partialSupportFixture();
    decision.units[0].availableSourceIds = [];

    const problems = syllabusCoverageDecisionProblems(decision, plan, sourceIds);
    assert.deepEqual(problems, [
      "unit SU_PARTIAL.availableSourceIds must include at least one source selected for its available assigned material",
    ]);
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
    assertSource("selectedSourceCatalog: promptSyllabusCoverageSourceCatalog(context, syllabusPlan)", "send selected sources");
    assertSource("authoredLocators: authoredSyllabusLocatorCatalog(syllabusPlan.referencedMaterials)", "send exact authored locators without matching them");
    assertSource("buildSyllabusCoverageSourceCatalog(context.sources)", "send a bounded coverage source catalog");
    assertSource("canonicalRawPageEvidence.pages", "distinguish raw canonical page evidence from planning context");
    assertSource("Match title/authors AND any locator", "require locator-level evidence");
    assertSource(
      "Distinct assigned material IDs can copy the same exact citation",
      "preserve repeated citations for distinct assigned material records",
    );
    assertSource("generated navigation context and can never prove", "keep generated source metadata out of coverage proof");
    assertSource("A missing REQUIRED material", "tell the model how required status matters");
    assertSource("A missing OPTIONAL material", "tell the model how optional status matters");
    assertSource(
      "An unteachable unit may still have partial or direct source support.",
      "allow model-authored partial support without changing teachability",
    );
    assertSource(
      "teachable is the sole authorization for the planner to generate lessons.",
      "make the model's teachability verdict the generation gate",
    );
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
      "could not be fully supported by the available source material and was left uncovered",
      "warn about model-authored unteachable units",
    );
  });
});

describe("bounded canonical source evidence for syllabus coverage", () => {
  test("hydrates only model-selected canonical identities with original CRLF bytes", () => {
    const first = "## Page 1\r\nIdentity page\r\n";
    const late = "## Page 19\r\nCoulomb derivation\r\n\r\n";
    const last = "## Page 403\r\nSkin-depth worked example\r\n";
    const body = `## Internal planning\r\nnonproof\r\n## Source material\r\n${first}${late}${last}`;

    assert.deepEqual(canonicalSourceRawPageBlocks("book", body), [
      { sourceId: "book", pageNumber: 1, exactText: first, complete: true },
      { sourceId: "book", pageNumber: 19, exactText: late, complete: true },
      { sourceId: "book", pageNumber: 403, exactText: last, complete: true },
    ]);
    assert.deepEqual(hydrateSelectedCanonicalSourceRawPages({
      sources: [{ sourceId: "book", body }],
      selections: [
        { sourceId: "book", pageNumber: 403 },
        { sourceId: "book", pageNumber: 19 },
      ],
      maxPages: 2,
      maxChars: late.length + last.length,
    }), [
      { sourceId: "book", pageNumber: 403, exactText: last, complete: true },
      { sourceId: "book", pageNumber: 19, exactText: late, complete: true },
    ]);
  });

  test("fails closed on raw-page identity collisions, swaps, and partial-page budgets", () => {
    const book = "## Source material\n## Page 1\nOne\n## Page 9\nNine complete bytes\n";
    const notes = "## Source material\n## Page 9\nDifferent source bytes\n";
    const common = {
      sources: [
        { sourceId: "book", body: book },
        { sourceId: "notes", body: notes },
      ],
      maxPages: 2,
      maxChars: 10_000,
    };
    assert.throws(
      () => hydrateSelectedCanonicalSourceRawPages({
        ...common,
        selections: [
          { sourceId: "book", pageNumber: 9 },
          { sourceId: "book", pageNumber: 9 },
        ],
      }),
      /repeats book Page 9/,
    );
    assert.throws(
      () => hydrateSelectedCanonicalSourceRawPages({
        ...common,
        selections: [{ sourceId: "missing", pageNumber: 9 }],
      }),
      /unknown missing Page 9/,
    );
    assert.throws(
      () => hydrateSelectedCanonicalSourceRawPages({
        ...common,
        selections: [{ sourceId: "book", pageNumber: 9 }],
        maxChars: 8,
      }),
      /complete pages cannot be truncated/,
    );
    assert.throws(
      () => canonicalSourceRawPageBlocks(
        "book",
        "## Source material\n## Page 9\nFirst\n## Page 9\nSecond\n",
      ),
      /duplicate Page 9/,
    );
  });

  test("rejects unsafe and near-miss page identities while ignoring fenced examples", () => {
    for (const heading of [
      "## Page1",
      "## Page0",
      "### Page 1",
      "## Page 9007199254740993",
    ]) {
      assert.throws(
        () => canonicalSourceRawPageBlocks(
          "book",
          `## Source material\n${heading}\nNot authoritative\n`,
        ),
        /unknown page identity|safe integer range/,
      );
    }

    const realPage = "## Page 1\r\nAuthoritative bytes\r\n";
    const body = [
      "## Source material\r\n",
      "```markdown\r\n",
      "## Page 999\r\n",
      "Example only\r\n",
      "```\r\n",
      realPage,
    ].join("");
    assert.deepEqual(canonicalSourceRawPageBlocks("book", body), [{
      sourceId: "book",
      pageNumber: 1,
      exactText: realPage,
      complete: true,
    }]);
    const malformedLatexFence = [
      "## Source material\n",
      "## Page 552\nClean preceding page\n",
      "## Page 553\nPrior page\n",
      "```latex\n\\alpha + \\beta\n",
      "## Page 554\nRecovered page boundary\n",
      "```\n",
      "## Page 555\nFollowing page\n",
    ].join("");
    const ambiguousParse = parseCanonicalSourceRawPages("book", malformedLatexFence);
    assert.deepEqual(ambiguousParse.pages.map((page) => page.pageNumber), [552, 555]);
    assert.deepEqual(ambiguousParse.ambiguousPageNumbers, [553, 554]);
    assert.equal(ambiguousParse.pages[0].exactText, "## Page 552\nClean preceding page\n");
    assert.equal(ambiguousParse.pages[1].exactText, "## Page 555\nFollowing page\n");
    assert.throws(
      () => canonicalSourceRawPageBlocks(
        "book",
        "## Source material\n## Page 1\nReal\n```markdown\n## Page 1\nFake duplicate\n```\n",
      ),
      /duplicate Page 1/,
    );
    assert.throws(
      () => canonicalSourceRawPageBlocks(
        "book",
        "## Source material\n## Page 1\nOne\n## Source material\n## Page 2\nTwo\n",
      ),
      /duplicate Source material sections/,
    );
    assert.throws(
      () => canonicalSourceRawPageBlocks(
        "book",
        "```markdown\n## Source material\n## Page 1\nFake authority\n```\n",
      ),
      /Source material marker occurs inside an ambiguous fenced region/,
    );
  });

  test("reserves verbatim canonical title and author pages after internal planning", () => {
    const generatedPreamble = "Generated planning context that must not crowd raw pages.\n".repeat(3_000);
    const pageOne = [
      "## Page 1",
      "ENGINEERING ELECTROMAGNETICS",
      "Ninth Edition",
      "WILLIAM H. HAYT, JR.",
      "JOHN A. BUCK",
      "",
    ].join("\n");
    const pageTwo = [
      "## Page 2",
      "CONTENTS",
      "Chapter 1 Vector Analysis 1",
      "",
    ].join("\n");
    const pageSeven = [
      "## Page 7",
      "Chapter 7 Magnetic Fields",
      "",
    ].join("\n");
    const body = [
      "## Summary",
      generatedPreamble,
      "## Internal planning",
      "This generated planning delimiter is not canonical source evidence.",
      "## Source material",
      pageOne,
      pageTwo,
      pageSeven,
    ].join("\n");

    const [catalog] = buildSyllabusCoverageSourceCatalog([{
      slug: "hayt-buck",
      title: "uploaded filename",
      relPath: "sources/hayt-buck.md",
      sourceFile: "engineering-electromagnetics.pdf",
      body,
    }]);
    const rawPageOne = body.slice(body.indexOf("## Page 1"), body.indexOf("## Page 2"));
    const rawPageTwo = body.slice(body.indexOf("## Page 2"), body.indexOf("## Page 7"));
    const rawPageSeven = body.slice(body.indexOf("## Page 7"));

    assert.ok(catalog.navigationMetadata.planningIndex.includes("Generated planning context"));
    assert.equal(catalog.navigationMetadata.planningIndex.includes("ENGINEERING ELECTROMAGNETICS"), false);
    assert.deepEqual(
      catalog.canonicalRawPageEvidence.pages.map((page) => ({
        sourceId: page.sourceId,
        pageNumber: page.pageNumber,
        exactText: page.exactText,
        complete: page.complete,
      })),
      [
        {
          sourceId: "hayt-buck",
          pageNumber: 1,
          exactText: rawPageOne,
          complete: true,
        },
        {
          sourceId: "hayt-buck",
          pageNumber: 2,
          exactText: rawPageTwo,
          complete: true,
        },
        {
          sourceId: "hayt-buck",
          pageNumber: 7,
          exactText: rawPageSeven,
          complete: true,
        },
      ],
    );
    assert.ok(catalog.canonicalRawPageEvidence.pages[0].exactText.includes("WILLIAM H. HAYT, JR."));
    assert.ok(catalog.canonicalRawPageEvidence.pages[1].exactText.includes("Chapter 1 Vector Analysis 1"));
    assert.ok(catalog.canonicalRawPageEvidence.pages[2].exactText.includes("Chapter 7 Magnetic Fields"));
    assert.equal(catalog.canonicalRawPageEvidence.pages[0].exactText.includes("fabricated title"), false);
    assert.equal(catalog.canonicalRawPageEvidence.pages[0].exactText.includes("[truncated]"), false);
  });

  test("isolates duplicate metadata titles and binds canonical raw bytes into the packet hash", () => {
    const sourceA = {
      slug: "first",
      title: "Same upload title",
      relPath: "sources/first.md",
      body: "## Internal planning\nignored\n## Source material\n## Page 1\nFirst unique author\n",
    };
    const sourceB = {
      slug: "second",
      title: "Same upload title",
      relPath: "sources/second.md",
      body: "## Internal planning\nignored\n## Source material\n## Page 1\nSecond unique author\n",
    };
    const catalog = buildSyllabusCoverageSourceCatalog([sourceA, sourceB]);

    assert.equal(catalog[0].canonicalRawPageEvidence.pages[0].sourceId, "first");
    assert.equal(catalog[1].canonicalRawPageEvidence.pages[0].sourceId, "second");
    assert.ok(catalog[0].canonicalRawPageEvidence.pages[0].exactText.includes("First unique author"));
    assert.equal(catalog[0].canonicalRawPageEvidence.pages[0].exactText.includes("Second unique author"), false);

    const changed = buildSyllabusCoverageSourceCatalog([{
      ...sourceA,
      body: sourceA.body.replace("First unique author", "Changed canonical author bytes"),
    }, sourceB]);
    assert.notEqual(catalog[0].canonicalRawSourceSha256, changed[0].canonicalRawSourceSha256);
    assert.notEqual(JSON.stringify(catalog[0]), JSON.stringify(changed[0]));
  });

  test("uses fixed complete page slices and fails closed on ambiguous page identity", () => {
    const pageOne = "## Page 1\nOne.\n";
    const pageTwo = "## Page 2\nTwo.\n";
    const pageThree = "## Page 3\nThree.\n";
    const evidence = boundedCanonicalSourcePageEvidence(
      "bounded-source",
      `## Source material\n${pageOne}${pageTwo}${pageThree}`,
      pageOne.length + pageTwo.length + pageThree.length,
    );
    assert.deepEqual(evidence.pages, [
      { sourceId: "bounded-source", pageNumber: 1, exactText: pageOne, complete: true },
      { sourceId: "bounded-source", pageNumber: 2, exactText: pageTwo, complete: true },
      { sourceId: "bounded-source", pageNumber: 3, exactText: pageThree, complete: true },
    ]);
    assert.equal(evidence.omittedPageCount, 0);
    assert.equal(evidence.truncated, false);
    assert.throws(
      () => boundedCanonicalSourcePageEvidence(
        "duplicate-pages",
        "## Source material\n## Page 1\nFirst\n## Page 1\nSecond\n",
        1_000,
      ),
      /duplicate Page 1/,
    );
    assert.throws(
      () => boundedCanonicalSourcePageEvidence(
        "unknown-page",
        "## Source material\n## Page one\nUntrusted identity\n",
        1_000,
      ),
      /unknown page identity/,
    );
    assert.throws(
      () => boundedCanonicalSourcePageEvidence(
        "noncanonical-page",
        "## Source material\n## PAGE 1\nWrong heading case\n",
        1_000,
      ),
      /unknown page identity/,
    );
    const crlfEvidence = boundedCanonicalSourcePageEvidence(
      "crlf-page",
      "## Source material\r\n## Page 1\r\nCRLF canonical bytes\r\n",
      1_000,
    );
    assert.deepEqual(crlfEvidence.pages, [{
      sourceId: "crlf-page",
      pageNumber: 1,
      exactText: "## Page 1\r\nCRLF canonical bytes\r\n",
      complete: true,
    }]);
  });

  test("keeps the aggregate source-text budget fixed and fails before a partial identity page", () => {
    const sources = Array.from({ length: 10 }, (_, index) => ({
      slug: `source-${index + 1}`,
      title: `Source ${index + 1}`,
      relPath: `sources/${index + 1}.md`,
      body: [
        "## Summary",
        "Generated preamble.\n".repeat(10_000),
        "## Internal planning",
        "ignored",
        "## Source material",
        "## Page 1",
        `Exact identity ${index + 1}`,
      ].join("\n"),
    }));
    const catalog = buildSyllabusCoverageSourceCatalog(sources);
    const transportedSourceChars = catalog.reduce((total, source) => total
      + source.navigationMetadata.planningIndex.length
      + source.canonicalRawPageEvidence.pages.reduce((pageTotal, page) => pageTotal + page.exactText.length, 0)
      + (source.canonicalRawPageEvidence.unpagedEvidence?.exactText.length ?? 0), 0);
    assert.ok(transportedSourceChars <= 120_000, `transported ${transportedSourceChars} source chars`);
    for (const source of catalog) {
      assert.ok(source.canonicalRawPageEvidence.pages[0].exactText.includes(`Exact identity ${source.id.split("-")[1]}`));
    }

    assert.throws(
      () => buildSyllabusCoverageSourceCatalog([{
        slug: "oversized-page",
        title: "Oversized page",
        relPath: "sources/oversized.md",
        body: `## Source material\n## Page 1\n${"x".repeat(24_001)}`,
      }]),
      /cannot carry its complete fixed identity prefix/,
    );
    assert.throws(
      () => buildSyllabusCoverageSourceCatalog([{
        slug: "oversized-second-page",
        title: "Oversized second page",
        relPath: "sources/oversized-second.md",
        body: `## Source material\n## Page 1\nSmall identity\n## Page 2\n${"y".repeat(24_001)}\n## Page 3\nWould otherwise fit\n`,
      }]),
      /cannot carry its complete fixed identity prefix/,
    );
  });

  test("carries authored locators verbatim without selecting source pages from their text", () => {
    assert.equal(buildSyllabusCoverageSourceCatalog.length, 1);
    const locators = authoredSyllabusLocatorCatalog([
      { id: "R1", locator: "pp. 40-58" },
      { id: "R2", locator: "chapter 20" },
    ]);
    assert.deepEqual(locators, [
      { materialId: "R1", locator: "pp. 40-58" },
      { materialId: "R2", locator: "chapter 20" },
    ]);
    const source = {
      slug: "fixed-prefix",
      title: "Fixed prefix source",
      relPath: "sources/fixed-prefix.md",
      body: [
        "## Source material",
        ...Array.from({ length: 8 }, (_, index) => `## Page ${index + 1}\nPrefix page ${index + 1}\n`),
        "## Page 40\nLate raw page named by the syllabus locator\n",
      ].join("\n"),
    };
    const beforeLocators = buildSyllabusCoverageSourceCatalog([source]);
    const afterLocators = buildSyllabusCoverageSourceCatalog([source]);
    assert.deepEqual(beforeLocators, afterLocators);
    assert.deepEqual(
      afterLocators[0].canonicalRawPageEvidence.pages.map((page) => page.pageNumber),
      [1, 2, 3, 4, 5, 6, 7, 8],
    );
    assert.equal(afterLocators[0].canonicalRawPageEvidence.omittedPageCount, 1);
    assert.equal(
      afterLocators[0].canonicalRawPageEvidence.pages.some((page) => page.pageNumber === 40),
      false,
    );
  });

  test("rejects duplicate source identities before building a coverage catalog", () => {
    assert.throws(
      () => buildSyllabusCoverageSourceCatalog([
        { slug: "book", title: "Book A", relPath: "sources/a.md", body: "## Page 1\nA\n" },
        { slug: "book", title: "Book B", relPath: "sources/b.md", body: "## Page 1\nB\n" },
      ]),
      /duplicate source "book"/,
    );
  });

  test("keeps unpaged source material verbatim without fabricating a page marker", () => {
    const evidence = boundedCanonicalSourcePageEvidence("plain-note", "Raw note text only.", 1_000);
    assert.deepEqual(evidence.pages, []);
    assert.deepEqual(evidence.unpagedEvidence, {
      sourceId: "plain-note",
      exactText: "Raw note text only.",
      complete: true,
    });
    assert.equal(evidence.truncated, false);
  });
});
