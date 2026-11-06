import assert from "node:assert/strict";
import test, { describe } from "node:test";

import {
  buildLearningSpineTargetedRepairRequest,
  mergeLearningSpineTargetedResponse,
  runLearningSpineTargetedRepair,
  scopeLearningSpineProblems,
} from "../src/lib/model-learning-spine-repair.ts";

function unit(id, semanticConcepts) {
  return {
    id,
    title: `Unit ${id}`,
    role: "core_concept",
    learningQuestion: `What does ${id} teach?`,
    prerequisiteConcepts: [],
    newConcepts: semanticConcepts.map((concept) => concept.preferredLabel),
    syllabusUnitIds: ["SU1"],
    sourceAnchors: [`anchor-${id}`],
    sourceFigures: [],
    sourceFormulas: [],
    sourceTables: [],
    sourceQuestions: [],
    semanticConcepts,
    knowledgeClaims: [],
    zettelNotes: [],
    mustNotRepeat: [],
    expectedWordRange: [700, 900],
    sectionPlan: {
      id: "S1",
      title: "Fields and coordinates",
      purpose: "Teach the shared mathematical foundation.",
    },
  };
}

function concept(slug, preferredLabel, aliases = []) {
  return {
    slug,
    preferredLabel,
    role: "primary",
    aliases,
    evidenceAnchors: ["anchor-U1"],
  };
}

const conflict = 'Concept "differential-gauss-law" has inconsistent model-authored label or aliases across units';

describe("learning-spine targeted model repair", () => {
  test("concept conflicts target every unit that authored the conflicting slug", () => {
    const units = [
      unit("U1", [concept("differential-gauss-law", "Differential Gauss law")]),
      unit("U2", [concept("differential-gauss-law", "Gauss law in differential form")]),
      unit("U3", [concept("electric-potential", "Electric potential")]),
    ];
    assert.deepEqual(scopeLearningSpineProblems([conflict], units), {
      unitIds: ["U1", "U2"],
      scopedProblems: [conflict],
      unscopedProblems: [],
    });
  });

  test("parse-index and exact unit failures are scoped, while global failures fail closed", () => {
    const units = [
      unit("U1", [concept("electric-field", "Electric field")]),
      unit("U10", [concept("electric-potential", "Electric potential")]),
    ];
    const scope = scopeLearningSpineProblems([
      "learningUnits[1].title must be a non-empty string",
      'unit "U1": source anchor is missing',
      "registered source artifacts are not partitioned exactly once",
    ], units);
    assert.deepEqual(scope.unitIds, ["U1", "U10"]);
    assert.deepEqual(scope.unscopedProblems, [
      "registered source artifacts are not partitioned exactly once",
    ]);

    const duplicateIds = [
      unit("U1", [concept("electric-field", "Electric field")]),
      unit("U1", [concept("electric-potential", "Electric potential")]),
    ];
    const duplicateScope = scopeLearningSpineProblems([
      'learningUnits[1].id duplicates model-authored unit id "U1"',
    ], duplicateIds);
    assert.deepEqual(duplicateScope.unitIds, []);
    assert.equal(duplicateScope.unscopedProblems.length, 1);

    for (const malformedId of ["", "not canonical"]) {
      const malformedScope = scopeLearningSpineProblems([
        "learningUnits[0].id must already be a canonical identifier",
      ], [unit(malformedId, [concept("electric-field", "Electric field")])]);
      assert.deepEqual(malformedScope.unitIds, []);
      assert.equal(malformedScope.unscopedProblems.length, 1);
    }
  });

  test("atomically replaces complete target records and preserves every untouched record by identity", () => {
    const first = unit("U1", [concept("differential-gauss-law", "Differential Gauss law")]);
    const second = unit("U2", [concept("differential-gauss-law", "Gauss law in differential form")]);
    const untouched = unit("U3", [concept("electric-potential", "Electric potential")]);
    const candidate = {
      title: "Electromagnetism",
      summary: "Learn fields.",
      learningUnits: [first, second, untouched],
      sourceArtifactOmissions: [],
      warnings: [],
    };
    const replacement1 = unit("U1", [concept("differential-gauss-law", "Differential Gauss law", ["point-form Gauss law"])]);
    const replacement2 = unit("U2", [concept("differential-gauss-law", "Differential Gauss law", ["point-form Gauss law"])]);
    const merged = mergeLearningSpineTargetedResponse({
      candidate,
      targetUnitIds: ["U1", "U2"],
      response: { learningUnits: [replacement1, replacement2] },
    });
    assert.equal(merged.ok, true);
    assert.equal(merged.candidate.learningUnits[0], replacement1);
    assert.equal(merged.candidate.learningUnits[1], replacement2);
    assert.equal(merged.candidate.learningUnits[2], untouched);
    assert.equal(merged.candidate.sourceArtifactOmissions, candidate.sourceArtifactOmissions);
  });

  test("rejects partial, extra, or patch-like responses without changing the candidate", () => {
    const first = unit("U1", [concept("differential-gauss-law", "Differential Gauss law")]);
    const second = unit("U2", [concept("differential-gauss-law", "Gauss law in differential form")]);
    const candidate = { learningUnits: [first, second] };
    const partial = mergeLearningSpineTargetedResponse({
      candidate,
      targetUnitIds: ["U1", "U2"],
      response: { learningUnits: [{ id: "U1", semanticConcepts: [] }] },
    });
    assert.equal(partial.ok, false);
    assert.match(partial.problems.join("; "), /complete|must be/i);
    assert.equal(candidate.learningUnits[0], first);
    assert.equal(candidate.learningUnits[1], second);

    const extra = mergeLearningSpineTargetedResponse({
      candidate,
      targetUnitIds: ["U1"],
      response: { learningUnits: [first], explanation: "done" },
    });
    assert.equal(extra.ok, false);
    assert.match(extra.problems.join("; "), /unsupported top-level fields/);
  });

  test("prompt discloses the exact repeated-concept gate and requests complete records", () => {
    const u1 = unit("U1", [concept("differential-gauss-law", "Differential Gauss law")]);
    const request = buildLearningSpineTargetedRepairRequest({
      attempt: 1,
      candidate: { learningUnits: [u1] },
      units: [u1],
      unitIds: ["U1"],
      validationProblems: [conflict],
      canonicalPlanningPacket: { sourceMap: { sourceAnchors: [] } },
      canonicalEvidenceByUnit: { U1: [{ id: "anchor-U1", exactText: "Gauss law" }] },
    });
    assert.match(request.system, /COMPLETE learning-unit record/);
    assert.match(request.system, /Estimate each unit independently/);
    assert.match(request.system, /advisory planning estimates, not minimums or caps/);
    assert.doesNotMatch(request.system, /"expectedWordRange":\s*\[700,\s*1100\]/);
    assert.match(request.system, /inside_concept_explanation/);
    assert.match(request.system, /semanticConcepts/);
    assert.match(request.system, /knowledgeClaims/);
    assert.match(request.system, /sectionPlan/);
    assert.match(request.system, /same preferredLabel/);
    assert.match(request.system, /same aliases array \(same values in the same order\)/);
    assert.match(request.system, /atomically replace/);
    assert.deepEqual(JSON.parse(request.user).requestedUnitIds, ["U1"]);
    assert.deepEqual(JSON.parse(request.user).canonicalEvidenceByUnit.U1, [
      { id: "anchor-U1", exactText: "Gauss law" },
    ]);
  });

  test("repairs with complete AI records, revalidates the full candidate, and keeps unaffected units untouched", async () => {
    const u1 = unit("U1", [concept("differential-gauss-law", "Differential Gauss law")]);
    const u2 = unit("U2", [concept("differential-gauss-law", "Gauss law in differential form")]);
    const untouched = unit("U3", [concept("electric-potential", "Electric potential")]);
    const candidate = {
      title: "Electromagnetism",
      summary: "Learn fields.",
      learningUnits: [u1, u2, untouched],
      sourceArtifactOmissions: [],
    };
    let validatedCandidate;
    const result = await runLearningSpineTargetedRepair({
      candidate,
      units: [u1, u2, untouched],
      validationProblems: [conflict],
      canonicalPlanningPacket: { sourceMap: {}, scopeContract: {} },
      canonicalEvidenceByUnit: {},
      provider: async (request) => {
        assert.deepEqual(request.unitIds, ["U1", "U2"]);
        return {
          learningUnits: [
            unit("U1", [concept("differential-gauss-law", "Differential Gauss law", ["point-form Gauss law"])]),
            unit("U2", [concept("differential-gauss-law", "Differential Gauss law", ["point-form Gauss law"])]),
          ],
        };
      },
      validateCandidate: (merged) => {
        validatedCandidate = merged;
        return { units: merged.learningUnits.map((record) => structuredClone(record)), problems: [] };
      },
    });
    assert.equal(result.status, "repaired");
    assert.equal(result.calls, 1);
    assert.equal(result.candidate.learningUnits[2], untouched);
    assert.equal(validatedCandidate.learningUnits[2], untouched);
    assert.equal(result.units[2], untouched);
    assert.equal(result.reviews[0].accepted, true);
  });

  test("malformed model output consumes the bounded semantic attempts", async () => {
    const u1 = unit("U1", [concept("differential-gauss-law", "Differential Gauss law")]);
    const u2 = unit("U2", [concept("differential-gauss-law", "Gauss law in differential form")]);
    let calls = 0;
    const result = await runLearningSpineTargetedRepair({
      candidate: { learningUnits: [u1, u2] },
      units: [u1, u2],
      validationProblems: [conflict],
      canonicalPlanningPacket: {},
      canonicalEvidenceByUnit: {},
      provider: async () => {
        calls += 1;
        return { learningUnits: [{ id: "U1" }] };
      },
      validateCandidate: () => {
        throw new Error("malformed output must not reach whole-candidate validation");
      },
    });
    assert.equal(result.status, "exhausted");
    assert.equal(result.calls, 2);
    assert.equal(calls, 2);
    assert.equal(result.candidate.learningUnits[0], u1);
  });

  test("missing or empty fulfilled output is terminal after one provider call", async () => {
    const u1 = unit("U1", [concept("differential-gauss-law", "Differential Gauss law")]);
    const u2 = unit("U2", [concept("differential-gauss-law", "Gauss law in differential form")]);
    for (const output of [undefined, null, "", "  \n"]) {
      let calls = 0;
      let validations = 0;
      await assert.rejects(
        runLearningSpineTargetedRepair({
          candidate: { learningUnits: [u1, u2] },
          units: [u1, u2],
          validationProblems: [conflict],
          canonicalPlanningPacket: {},
          canonicalEvidenceByUnit: {},
          provider: async () => {
            calls += 1;
            return output;
          },
          validateCandidate: () => {
            validations += 1;
            return { units: [u1, u2], problems: [] };
          },
        }),
        /returned no nonempty candidate; no semantic repair request was issued/i,
      );
      assert.equal(calls, 1);
      assert.equal(validations, 0);
    }
  });

  test("nonempty malformed output remains bounded semantic repair evidence", async () => {
    const u1 = unit("U1", [concept("differential-gauss-law", "Differential Gauss law")]);
    const u2 = unit("U2", [concept("differential-gauss-law", "Gauss law in differential form")]);
    let calls = 0;
    const result = await runLearningSpineTargetedRepair({
      candidate: { learningUnits: [u1, u2] },
      units: [u1, u2],
      validationProblems: [conflict],
      canonicalPlanningPacket: {},
      canonicalEvidenceByUnit: {},
      provider: async () => {
        calls += 1;
        return "{nonempty malformed targeted candidate";
      },
      validateCandidate: () => {
        throw new Error("malformed output must not reach whole-candidate validation");
      },
    });
    assert.equal(result.status, "exhausted");
    assert.equal(calls, 2);
  });

  test("provider transport failures escape and do not consume a semantic retry", async () => {
    const u1 = unit("U1", [concept("differential-gauss-law", "Differential Gauss law")]);
    const u2 = unit("U2", [concept("differential-gauss-law", "Gauss law in differential form")]);
    let calls = 0;
    await assert.rejects(
      runLearningSpineTargetedRepair({
        candidate: { learningUnits: [u1, u2] },
        units: [u1, u2],
        validationProblems: [conflict],
        canonicalPlanningPacket: {},
        canonicalEvidenceByUnit: {},
        provider: async () => {
          calls += 1;
          throw new Error("transport ended prematurely");
        },
        validateCandidate: () => ({ units: [u1, u2], problems: [] }),
      }),
      /transport ended prematurely/,
    );
    assert.equal(calls, 1);
  });

  test("never targets an accepted global failure and rejects proposed global regressions before retrying", async () => {
    const u1 = unit("U1", [concept("differential-gauss-law", "Differential Gauss law")]);
    const u2 = unit("U2", [concept("differential-gauss-law", "Gauss law in differential form")]);
    let calls = 0;
    const global = await runLearningSpineTargetedRepair({
      candidate: { learningUnits: [u1, u2] },
      units: [u1, u2],
      validationProblems: ["garden has only three sections"],
      canonicalPlanningPacket: {},
      canonicalEvidenceByUnit: {},
      provider: async () => {
        calls += 1;
        return {};
      },
      validateCandidate: () => ({ units: [u1, u2], problems: [] }),
    });
    assert.equal(global.status, "unscoped");
    assert.equal(calls, 0);

    let validations = 0;
    const recovered = await runLearningSpineTargetedRepair({
      candidate: { learningUnits: [u1, u2] },
      units: [u1, u2],
      validationProblems: [conflict],
      canonicalPlanningPacket: {},
      canonicalEvidenceByUnit: {},
      provider: async () => {
        calls += 1;
        return {
          learningUnits: [
            unit("U1", [concept("differential-gauss-law", "Differential Gauss law")]),
            unit("U2", [concept("differential-gauss-law", "Differential Gauss law")]),
          ],
        };
      },
      validateCandidate: (candidate) => {
        validations += 1;
        return {
          units: candidate.learningUnits,
          problems: validations === 1
            ? ["registered source artifacts are not partitioned exactly once"]
            : [],
        };
      },
    });
    assert.equal(recovered.status, "repaired");
    assert.equal(recovered.calls, 2);
    assert.equal(recovered.reviews[0].introducedUnscopedProblems, true);
    assert.equal(recovered.reviews[0].accepted, false);

    const exhausted = await runLearningSpineTargetedRepair({
      candidate: { learningUnits: [u1, u2] },
      units: [u1, u2],
      validationProblems: [conflict],
      canonicalPlanningPacket: {},
      canonicalEvidenceByUnit: {},
      provider: async () => ({
        learningUnits: [
          unit("U1", [concept("differential-gauss-law", "Differential Gauss law")]),
          unit("U2", [concept("differential-gauss-law", "Differential Gauss law")]),
        ],
      }),
      validateCandidate: (candidate) => ({
        units: candidate.learningUnits,
        problems: ["registered source artifacts are not partitioned exactly once"],
      }),
    });
    assert.equal(exhausted.status, "exhausted");
    assert.equal(exhausted.calls, 2);
    assert.equal(exhausted.candidate.learningUnits[0], u1);
  });
});

test("forgotten artifacts are placed by the model, then owned through the unit repair", async () => {
  // Live 2026-09-23 (gpt-6-luna): forgotten-artifact failures name no unit, so
  // the whole targeted repair was "unscoped" and planning failed.
  const forgotten = (id) =>
    `registered source artifact "${id}" is forgotten; assign it to exactly one learning unit or explicitly omit it with a model-authored reason`;
  const u1 = unit("U1", []);
  const u2 = unit("U2", []);
  const requests = [];
  const result = await runLearningSpineTargetedRepair({
    candidate: { learningUnits: [u1, u2], sourceArtifactOmissions: [] },
    units: [u1, u2],
    validationProblems: [forgotten("S1.P2.G1"), forgotten("S1.P3.F1")],
    canonicalPlanningPacket: {
      extractedSourceArtifacts: [
        { id: "S1.P2.G1", kind: "graph", caption: "BER curve for QPSK" },
        { id: "S1.P3.F1", kind: "figure", caption: "Course logo on the title slide" },
      ],
    },
    canonicalEvidenceByUnit: {},
    provider: async (request) => {
      requests.push(request);
      if (request.unitIds.length === 0) {
        assert.match(request.user, /BER curve for QPSK/);
        return {
          placements: [
            { sourceArtifactId: "S1.P2.G1", ownerUnitId: "U2" },
            {
              sourceArtifactId: "S1.P3.F1",
              omission: {
                disposition: "non_instructional",
                artifactSummary: "Course logo shown on the title slide",
                reason: "The course logo on the title slide carries no telecommunications content to teach.",
                alternativeArtifactId: null,
              },
            },
          ],
        };
      }
      assert.deepEqual(request.unitIds, ["U2"]);
      assert.match(request.user, /must own registered source artifact \\"S1\.P2\.G1\\"/);
      return {
        learningUnits: [{
          ...u2,
          sourceFigures: [{ id: "S1.P2.G1", placement: "inside_result_interpretation", mustBeDiscussedWith: "BER", interpretationGoal: "read the curve" }],
        }],
      };
    },
    validateCandidate: (candidate) => {
      const owned = candidate.learningUnits.some((record) => record.sourceFigures.some((figure) => figure.id === "S1.P2.G1"));
      const omitted = candidate.sourceArtifactOmissions.some((omission) => omission.sourceArtifactId === "S1.P3.F1");
      return {
        units: candidate.learningUnits.map((record) => structuredClone(record)),
        problems: [
          ...(owned ? [] : [forgotten("S1.P2.G1")]),
          ...(omitted ? [] : [forgotten("S1.P3.F1")]),
        ],
      };
    },
  });
  assert.equal(result.status, "repaired");
  assert.equal(requests.length, 2);
  assert.equal(result.candidate.sourceArtifactOmissions[0].sourceArtifactId, "S1.P3.F1");
  assert.equal(result.candidate.learningUnits[1].sourceFigures[0].id, "S1.P2.G1");
});

test("an invalid placement is retried once, then the repair fails closed", async () => {
  const forgotten = 'registered source artifact "S1.P2.G1" is forgotten; assign it to exactly one learning unit or explicitly omit it with a model-authored reason';
  const u1 = unit("U1", []);
  let calls = 0;
  const result = await runLearningSpineTargetedRepair({
    candidate: { learningUnits: [u1], sourceArtifactOmissions: [] },
    units: [u1],
    validationProblems: [forgotten],
    canonicalPlanningPacket: {},
    canonicalEvidenceByUnit: {},
    provider: async (request) => {
      calls += 1;
      assert.equal(request.unitIds.length, 0);
      return { placements: [{ sourceArtifactId: "S1.P2.G1", ownerUnitId: "U9" }] };
    },
    validateCandidate: () => { throw new Error("an invalid placement must not be applied"); },
  });
  assert.equal(calls, 2);
  assert.equal(result.status, "unscoped");
});

test("forgotten artifacts beside a vague omission are re-placed in batches", async () => {
  // Live 2026-09-30 (gpt-6-sol, telecom-1 M1): 617 forgotten artifacts plus
  // vague omission reasons made the repair "unscoped" and planning failed.
  const forgotten = (id) =>
    `registered source artifact "${id}" is forgotten; assign it to exactly one learning unit or explicitly omit it with a model-authored reason`;
  const ids = Array.from({ length: 70 }, (_, index) => `S1.P${index + 10}.F1`);
  const omit = (id) => ({
    sourceArtifactId: id,
    disposition: "outside_learning_scope",
    artifactSummary: `Figure ${id} shows a fiber splice diagram`,
    reason: `The fiber splice diagram ${id} belongs to a later module outside this syllabus scope.`,
    alternativeArtifactId: null,
  });
  const u1 = unit("U1", []);
  const batches = [];
  const result = await runLearningSpineTargetedRepair({
    candidate: {
      learningUnits: [u1],
      sourceArtifactOmissions: [{ ...omit("S1.P1.F1"), reason: "Not needed." }],
    },
    units: [u1],
    validationProblems: [
      "sourceArtifactOmissions[0].reason must provide a specific pedagogical justification of at least eight words",
      ...ids.map(forgotten),
    ],
    canonicalPlanningPacket: {},
    canonicalEvidenceByUnit: {},
    provider: async (request) => {
      assert.equal(request.unitIds.length, 0);
      batches.push(request.placementBatch);
      const wanted = JSON.parse(request.user).forgottenArtifacts.map((entry) => entry.id);
      return { placements: wanted.map((id) => ({ sourceArtifactId: id, omission: (({ sourceArtifactId: _id, ...rest }) => rest)(omit(id)) })) };
    },
    validateCandidate: (candidate) => {
      const omitted = new Set(candidate.sourceArtifactOmissions.map((omission) => omission.sourceArtifactId));
      return {
        units: candidate.learningUnits,
        problems: [...ids, "S1.P1.F1"].filter((id) => !omitted.has(id)).map(forgotten),
      };
    },
  });
  assert.equal(result.status, "repaired");
  assert.deepEqual(batches.sort(), [1, 2, 3]);
  assert.equal(result.candidate.sourceArtifactOmissions.length, 71);
  assert.ok(result.candidate.sourceArtifactOmissions.every((omission) => omission.reason !== "Not needed."));
});

test("an owner placement carries its own lesson entry and respects the lesson's room", async () => {
  // Live 2026-09-30 (gpt-6-sol, telecom-1 M1): ~480 owner choices each needed a
  // whole-unit rewrite, and 11 targeted repairs could not absorb them.
  const forgotten = (id) =>
    `registered source artifact "${id}" is forgotten; assign it to exactly one learning unit or explicitly omit it with a model-authored reason`;
  const existing = Array.from({ length: 11 }, (_, index) => ({
    id: `S1.P1.E${index + 1}`, teachingGoal: "use it", termsToDefine: [], placement: "before_example", grounding: "asserted_in_source", derivableFrom: [],
  }));
  const u1 = { ...unit("U1", []), sourceFormulas: existing };
  const entry = { teachingGoal: "compute the bit error rate", termsToDefine: ["Q"], placement: "inside_metric_definition", grounding: "asserted_in_source", derivableFrom: [] };
  const omission = {
    disposition: "redundant_with_assigned_artifact",
    artifactSummary: "Alternate bit error rate expression",
    reason: "This alternate bit error rate expression repeats what S1.P9.E1 already teaches.",
    alternativeArtifactId: "S1.P1.E1",
  };
  const responses = [
    { placements: [
      { sourceArtifactId: "S1.P9.E1", ownerUnitId: "U1", entry },
      { sourceArtifactId: "S1.P9.E2", ownerUnitId: "U1", entry },
    ] },
    { placements: [
      { sourceArtifactId: "S1.P9.E1", ownerUnitId: "U1", entry },
      { sourceArtifactId: "S1.P9.E2", omission },
    ] },
  ];
  const seen = [];
  const result = await runLearningSpineTargetedRepair({
    candidate: { learningUnits: [u1], sourceArtifactOmissions: [] },
    units: [u1],
    validationProblems: [forgotten("S1.P9.E1"), forgotten("S1.P9.E2")],
    canonicalPlanningPacket: {},
    canonicalEvidenceByUnit: {},
    provider: async (request) => {
      assert.equal(request.unitIds.length, 0, "no whole-unit rewrite is needed");
      seen.push(JSON.parse(request.user));
      return responses[seen.length - 1];
    },
    validateCandidate: (candidate) => {
      const ids = new Set([
        ...candidate.learningUnits.flatMap((record) => record.sourceFormulas.map((formula) => formula.id)),
        ...candidate.sourceArtifactOmissions.map((record) => record.sourceArtifactId),
      ]);
      return { units: candidate.learningUnits, problems: ["S1.P9.E1", "S1.P9.E2"].filter((id) => !ids.has(id)).map(forgotten) };
    },
  });
  assert.equal(result.status, "repaired");
  assert.equal(seen[0].learningUnits[0].remainingArtifactCapacity, 1);
  assert.match(JSON.stringify(seen[1].previousResponseProblems), /remainingArtifactCapacity is 1/);
  const formulas = result.candidate.learningUnits[0].sourceFormulas;
  assert.equal(formulas.length, 12);
  assert.deepEqual(formulas.at(-1), { ...entry, id: "S1.P9.E1" });
});

test("a section metadata failure is scoped to every unit carrying that section", () => {
  // Live 2026-09-30 (gpt-6-sol): a missing singleSubsectionReason named only
  // the section, left the repair "unscoped", and failed planning.
  const u1 = { ...unit("U1", []), sectionPlan: { id: "S2", title: "Bandpass", purpose: "p" } };
  const u2 = { ...unit("U2", []), sectionPlan: { id: "S3", title: "OFDM", purpose: "p" } };
  const scope = scopeLearningSpineProblems(
    ['section "S2" has one unit without a model-authored singleSubsectionReason'],
    [u1, u2],
  );
  assert.deepEqual(scope.unitIds, ["U1"]);
  assert.deepEqual(scope.unscopedProblems, []);
});
