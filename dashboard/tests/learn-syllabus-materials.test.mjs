import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildSyllabusCoverage,
  detectUnavailableCitations,
  matchSyllabusUnitForPage,
  normalizeSyllabusPlan,
  resolveSyllabusMaterials,
  summarizeSyllabusCoverage,
  unavailableCitationProbes,
} from "../src/lib/learn-syllabus.ts";
import { assessLessonQuality } from "../src/lib/learn-utils.ts";

const learnSource = fs.readFileSync(
  new URL("../src/lib/learn.ts", import.meta.url),
  "utf8",
);

/** Assert against learn.ts without dumping its 8k lines into the failure. */
function assertSource(pattern, description) {
  assert.ok(
    typeof pattern === "string"
      ? learnSource.includes(pattern)
      : pattern.test(learnSource),
    `learn.ts should ${description}`,
  );
}

function doc(slug, title, body = "", extra = {}) {
  return {
    id: slug,
    slug,
    title,
    relPath: `sources/${slug}.md`,
    body,
    ...extra,
  };
}

/** A syllabus that assigns three works: two uploaded, one not. */
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
      },
      {
        id: "R2",
        citation: "Gerstner, Neuronal Dynamics, ch. 4",
        title: "Neuronal Dynamics",
        authors: ["Gerstner"],
        kind: "chapter",
        locator: "ch. 4",
      },
      {
        id: "R3",
        citation: "Davies et al., Loihi Architecture Review (2021)",
        title: "Loihi Architecture Review",
        authors: ["Davies"],
        kind: "paper",
      },
    ],
  });

  const sources = [
    doc(
      "networks-of-spiking-neurons",
      "Networks of Spiking Neurons",
      "Spikes carry information in their timing.",
    ),
    doc(
      "neuronal-dynamics-ch4",
      "Neuronal Dynamics",
      "The membrane potential integrates input until it crosses threshold.",
      { sourceFile: "gerstner-neuronal-dynamics.pdf" },
    ),
  ];

  const resolutions = resolveSyllabusMaterials(plan, sources);
  return { plan, sources, coverage: buildSyllabusCoverage(plan, resolutions) };
}

describe("reading a syllabus", () => {
  test("extracts units and the materials they assign", () => {
    const { plan } = courseFixture();
    assert.equal(plan.courseTitle, "Spiking Neural Networks");
    assert.equal(plan.units.length, 3);
    assert.equal(plan.referencedMaterials.length, 3);
    assert.deepEqual(plan.units[0].materialIds, ["R1"]);
    assert.equal(plan.referencedMaterials[0].locator, "ch. 1");
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

describe("resolving assigned materials against the garden", () => {
  test("an uploaded work is found by title", () => {
    const { coverage } = courseFixture();
    const maass = coverage.resolutions.find((r) => r.materialId === "R1");
    assert.equal(maass.status, "available");
    assert.deepEqual(maass.sourceIds, ["networks-of-spiking-neurons"]);
  });

  test("an uploaded work is found through its filename", () => {
    const { coverage } = courseFixture();
    const gerstner = coverage.resolutions.find((r) => r.materialId === "R2");
    assert.equal(gerstner.status, "available");
    assert.deepEqual(gerstner.sourceIds, ["neuronal-dynamics-ch4"]);
  });

  test("a work nobody uploaded is reported missing, never guessed at", () => {
    const { coverage } = courseFixture();
    const loihi = coverage.resolutions.find((r) => r.materialId === "R3");
    assert.equal(loihi.status, "missing");
    assert.deepEqual(loihi.sourceIds, []);
    assert.deepEqual(coverage.missingCitations, [
      "Davies et al., Loihi Architecture Review (2021)",
    ]);
  });

  test("a citation naming no identifiable work is generic, not missing", () => {
    // "Lecture 4 slides" cannot be matched OR hallucinated about, so treating it
    // as missing would produce a warning the user can never resolve.
    const plan = normalizeSyllabusPlan({
      units: [],
      referencedMaterials: [
        { id: "R1", citation: "Lecture 4 slides" },
        { id: "R2", citation: "Readings TBD" },
        { id: "R3", citation: "Course notes, week 2" },
      ],
    });
    const resolutions = resolveSyllabusMaterials(plan, []);
    assert.deepEqual(
      resolutions.map((r) => r.status),
      ["generic", "generic", "generic"],
    );
    assert.deepEqual(buildSyllabusCoverage(plan, resolutions).missingCitations, []);
  });

  test("a unit whose every assigned work is absent is flagged untaught", () => {
    const { coverage } = courseFixture();
    assert.deepEqual(coverage.untaughtUnitTitles, [
      "Week 3: Neuromorphic hardware deployment",
    ]);
    const week3 = coverage.units.find((u) => u.unitId === "SU3");
    assert.equal(week3.teachable, false);
    assert.deepEqual(week3.availableSourceIds, []);
  });

  test("units carry the documents they should be taught from", () => {
    const { coverage } = courseFixture();
    assert.deepEqual(coverage.units[0].availableSourceIds, [
      "networks-of-spiking-neurons",
    ]);
    assert.deepEqual(coverage.availableSourceIds, [
      "networks-of-spiking-neurons",
      "neuronal-dynamics-ch4",
    ]);
  });

  test("a coincidental word overlap does not count as the assigned work", () => {
    const plan = normalizeSyllabusPlan({
      units: [],
      referencedMaterials: [
        {
          id: "R1",
          citation: "Hodgkin & Huxley, Quantitative Description of Membrane Current",
          title: "Quantitative Description of Membrane Current",
          authors: ["Hodgkin"],
        },
      ],
    });
    // Mentions "membrane" but is a different work by different authors.
    const sources = [doc("lecture-notes", "Course Overview", "membrane basics")];
    assert.equal(resolveSyllabusMaterials(plan, sources)[0].status, "missing");
  });

  test("the summary counts each status", () => {
    const { coverage } = courseFixture();
    assert.deepEqual(summarizeSyllabusCoverage(coverage), {
      unitCount: 3,
      materialCount: 3,
      availableCount: 2,
      missingCount: 1,
      genericCount: 0,
    });
  });
});

describe("the anti-hallucination gate", () => {
  test("a page teaching from a work nobody uploaded hard-fails", () => {
    const { coverage } = courseFixture();
    const probes = unavailableCitationProbes(coverage);
    assert.ok(probes.length > 0, "the missing work should produce a probe");

    const fabricated =
      "The Loihi Architecture Review shows that event-driven cores cut energy by an order of magnitude.";
    assert.deepEqual(detectUnavailableCitations(fabricated, probes), [
      "Davies et al., Loihi Architecture Review (2021)",
    ]);
  });

  test("author-and-year phrasing is caught too", () => {
    const { coverage } = courseFixture();
    const probes = unavailableCitationProbes(coverage);
    assert.deepEqual(
      detectUnavailableCitations("As Davies and colleagues reported in 2021, ...", probes),
      ["Davies et al., Loihi Architecture Review (2021)"],
    );
  });

  test("works that ARE uploaded never trip the gate", () => {
    const { coverage } = courseFixture();
    const probes = unavailableCitationProbes(coverage);
    const legitimate =
      "Neuronal Dynamics builds the membrane equation step by step, and Networks of Spiking Neurons motivates it.";
    assert.deepEqual(detectUnavailableCitations(legitimate, probes), []);
  });

  test("ordinary teaching prose never trips the gate", () => {
    const { coverage } = courseFixture();
    const probes = unavailableCitationProbes(coverage);
    const lesson =
      "A neuron accumulates charge until it crosses threshold, then emits a spike and resets. " +
      "Neuromorphic hardware exploits this: silence costs nothing, so a mostly still scene is nearly free to process.";
    assert.deepEqual(detectUnavailableCitations(lesson, probes), []);
  });

  test("generic citations produce no probes, so they can never false-positive", () => {
    const plan = normalizeSyllabusPlan({
      units: [],
      referencedMaterials: [{ id: "R1", citation: "Lecture 4 slides" }],
    });
    const coverage = buildSyllabusCoverage(plan, resolveSyllabusMaterials(plan, []));
    assert.deepEqual(unavailableCitationProbes(coverage), []);
  });

  test("no syllabus means no gate at all", () => {
    assert.deepEqual(unavailableCitationProbes(null), []);
    assert.deepEqual(detectUnavailableCitations("anything at all", []), []);
  });

  test("the lesson quality gate reports a fabricated citation as a hard failure", () => {
    const { coverage } = courseFixture();
    const probes = unavailableCitationProbes(coverage);
    const body = [
      "# Energy in spiking systems",
      "",
      "Imagine a sensor watching a still scene. A dense network keeps recomputing.",
      "The Loihi Architecture Review reports a tenfold energy reduction on this workload.",
      "For example, a spike costs a single synaptic operation.",
      "",
      "**Question.** Why does silence matter?",
      "**Answer.** Because no spike means no computation.",
    ].join("\n");

    const assessment = assessLessonQuality(body, {
      unavailableCitations: {
        detect: (prose) => detectUnavailableCitations(prose, probes),
      },
    });
    const problem = assessment.problems.find(
      (entry) => entry.code === "unavailable-citation",
    );
    assert.ok(problem, "the gate should raise an unavailable-citation problem");
    assert.equal(problem.hard, true);
    assert.equal(assessment.hardFail, true);
    assert.deepEqual(problem.evidence, [
      "Davies et al., Loihi Architecture Review (2021)",
    ]);
  });

  test("the gate is inert when no citation detector is supplied", () => {
    const body = "The Loihi Architecture Review reports a tenfold reduction.";
    const problems = assessLessonQuality(body).problems;
    assert.equal(
      problems.some((entry) => entry.code === "unavailable-citation"),
      false,
    );
  });
});

describe("pointing a page at its assigned reading", () => {
  test("a page matches the syllabus unit it teaches", () => {
    const { coverage } = courseFixture();
    const matched = matchSyllabusUnitForPage(
      coverage,
      "The Leaky Integrate-and-Fire Neuron — membrane potential accumulation and threshold firing",
    );
    assert.equal(matched?.unitId, "SU2");
    assert.deepEqual(matched?.availableSourceIds, ["neuronal-dynamics-ch4"]);
  });

  test("an unrelated page matches nothing rather than guessing", () => {
    const { coverage } = courseFixture();
    assert.equal(
      matchSyllabusUnitForPage(coverage, "Choosing a text editor for coursework"),
      null,
    );
  });

  test("no coverage means no match", () => {
    assert.equal(matchSyllabusUnitForPage(null, "anything"), null);
  });
});

describe("pipeline wiring for material availability", () => {
  test("the syllabus is read and its materials resolved before planning", () => {
    assertSource("SYLLABUS_READING_PROMPT", "have a syllabus-reading prompt");
    assertSource(
      "normalizeSyllabusPlan(syllabusCall.parsed)",
      "parse the syllabus reading",
    );
    assertSource(
      "resolveSyllabusMaterials(syllabusPlan, context.sources)",
      "resolve assigned materials against the garden's documents",
    );
  });

  test("a failed syllabus reading says so instead of pretending it checked", () => {
    assertSource(
      "Assigned readings were not checked against this garden's documents",
      "warn when the availability check could not run",
    );
  });

  test("missing works become planning warnings naming the citation", () => {
    assertSource(
      "work(s) that are not in this garden",
      "warn about assigned works that are not uploaded",
    );
    assertSource(
      "has no available material in this garden and was left uncovered",
      "warn about syllabus items it cannot cover",
    );
  });

  test("the availability verdict reaches every planning stage", () => {
    const hits = (learnSource.match(/syllabusCoverage: syllabusCoveragePayload/g) ?? []).length;
    assert.equal(hits, 3, `expected the coverage in all 3 planning payloads, found ${hits}`);
  });

  test("the planner is told to ground units in available material and never in missing work", () => {
    assertSource(
      "lists the documents that ARE present for that unit",
      "point the planner at the available documents",
    );
    assertSource("NOBODY UPLOADED", "mark missing works unmistakably");
    assertSource(
      "Never summarize, paraphrase, characterize, or state what such a work says",
      "forbid writing about a missing work",
    );
    assertSource(
      "Ground that unit heavily and specifically in those documents",
      "require heavy grounding in the assigned reading",
    );
  });

  test("page generation gates on the confirmed map's own availability check", () => {
    assertSource(
      "unavailableCitationProbes(",
      "build citation probes for the run",
    );
    assertSource("map.syllabusCoverage ?? null", "build them from the confirmed map");
    assertSource(
      "unavailableCitations: unavailableCitationGate",
      "pass the gate into the page quality check",
    );
  });

  test("the page prompt forbids naming an unavailable work", () => {
    assertSource(
      "dossier.unavailableCitations",
      "tell the page writer which works are unavailable",
    );
    assertSource(
      "You have never read them",
      "state plainly that the unavailable works were never read",
    );
  });

  test("assigned documents are prioritized in the page's source snippets", () => {
    assertSource(
      "preferredSourceIds: assignedSourceIds",
      "prefer the syllabus-assigned documents for the page",
    );
    assertSource(
      "if (preferredSourceIds?.has(source.slug)) score += 5;",
      "boost snippets from the assigned documents",
    );
  });

  test("the coverage is persisted so generation cannot resolve differently", () => {
    assertSource("syllabus_coverage_json", "persist the coverage on the map");
    assertSource(
      "ALTER TABLE learn_maps ADD COLUMN syllabus_coverage_json TEXT",
      "migrate existing databases",
    );
  });
});
