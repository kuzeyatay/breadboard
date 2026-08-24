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
