import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createGeneratedVisualization,
  generateVisualizationCandidate,
  validateGeneratedVisualizationCandidateEnvelope,
} from "../src/lib/generated-visuals.ts";

const validSource = `import { defineVisualization } from "@breadboard/visual-sdk";
export default defineVisualization({
  schemaVersion: 1,
  sdkVersion: "1.0.0",
  title: "Envelope fixture",
  description: "A bounded candidate-envelope fixture.",
  accessibilityDescription: "A labelled value card displays the finite source-grounded fixture result.",
  controls: [],
  outputs: [{ id: "result", label: "Result", representation: "value", expression: { kind: "constant", value: 1 } }],
  scenes: [{ kind: "value", outputId: "result" }]
});`;

const opportunity = {
  id: "visual-envelope-fixture",
  gardenId: "candidate-envelope",
  learningUnitId: "U1",
  targetPage: "learning/envelope.md",
  targetHeading: "Envelope",
  insertionAnchor: "learning-unit:U1:after-introduction",
  conceptIds: [],
  sourceAnchorIds: [],
  sourceVisualIds: [],
  sourceVisualRelationships: [],
  learningObjective: "Inspect the finite result.",
  learnerQuestion: "What result is displayed?",
  pedagogicalReason: "Exercise the candidate protocol.",
  interactionGoal: "inspect_relationship",
  requiredInputs: [],
  requiredOutputs: [{ id: "result", label: "Result", representation: "value" }],
  controlContractProblems: [],
  requiresGeneratedModule: true,
  priority: "high",
  confidence: 1,
  similarityFingerprint: "candidate-envelope-fixture",
  requirement: "recommended",
};

function validEnvelope() {
  return {
    title: "Envelope fixture",
    explanation: "A complete candidate envelope.",
    sourceCode: validSource,
    testCases: [],
    accessibilityDescription: "A labelled value card displays the finite source-grounded fixture result.",
    pedagogicalClaims: ["The displayed fixture result is finite."],
  };
}

function candidateClient(contents, requests = []) {
  const queue = [...contents];
  return {
    chat: {
      completions: {
        create: async (request) => {
          requests.push(request);
          return {
            choices: [{ message: { content: queue.shift() ?? "" } }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          };
        },
      },
    },
  };
}

test("generated candidate prompt and schema explicitly require the six-field envelope", async () => {
  const requests = [];
  const candidate = await generateVisualizationCandidate({
    client: candidateClient([JSON.stringify(validEnvelope())], requests),
    model: "test-model",
    opportunity,
    pageMarkdown: "Source-grounded fixture text.",
  });

  assert.equal(candidate.title, "Envelope fixture");
  assert.equal(requests.length, 1);
  const system = requests[0].messages[0].content;
  for (const field of [
    "title",
    "explanation",
    "sourceCode",
    "testCases",
    "accessibilityDescription",
    "pedagogicalClaims",
  ]) {
    assert.match(system, new RegExp(`\\b${field}\\b`));
    assert.ok(requests[0].response_format.json_schema.schema.required.includes(field));
  }
  assert.equal(requests[0].response_format.json_schema.strict, true);
  assert.match(
    system,
    /status scene.*threshold is required and must be a literal finite number.*never an expression, string, null, NaN, or Infinity/i,
  );
  assert.match(
    system,
    /vector primitive is a finite directed segment.*must not call it an unbounded line, ray, or axis/i,
  );
  assert.match(
    system,
    /timeline scene is exactly.*progressInput must exactly equal one of the declared reviewed control ids.*There is no implicit progress, time, step, or output input/i,
  );
  assert.match(
    system,
    /spatial primitive label must name that rendered primitive itself.*narrow mobile previews/i,
  );
  assert.match(
    system,
    /Screen-left\/right\/top\/bottom are presentation-dependent, not world geometry.*do not make a screen-relative placement claim.*every relevant labelled preview/i,
  );
  assert.match(
    system,
    /For every screen-relative left\/right\/top\/bottom claim, perform a projection audit.*world-coordinate relationship instead/i,
  );
  assert.match(
    system,
    /authored view values must be literal finite numbers within azimuthDegrees -180\.\.180, elevationDegrees -85\.\.85, and scale 0\.25\.\.2/i,
  );
  assert.match(
    system,
    /every spatial group and primitive label must be a concise nonempty 1-72-character string/i,
  );
  assert.match(
    system,
    /authored opacity, when present, must be a literal finite number between 0\.1 and 1/i,
  );
  assert.match(
    system,
    /at least one allowed alternate control state must change by more than 1e-9 the evaluated value of an output\.expression or numeric scene expression/i,
  );
  assert.match(
    system,
    /whenever a label, explanation, or accessibility text calls a vector unit or normalized, its evaluated to-from Euclidean norm must be exactly 1 in every rendered state/i,
  );
  assert.match(
    system,
    /Do not call a direction vector unit or normalized by implication: from:\[0,0,0\] to:\[1,0,0\] has magnitude 1, while to:\[1,1,1\] has magnitude sqrt\(3\)/i,
  );
  assert.match(
    system,
    /Cylinder and cone primitives are bounded capped closed solids; never use either when the claim requires an open, uncapped, clipped, one-sided, or sector surface/i,
  );
  assert.match(
    system,
    /named-point normal, tangent, or basis-direction claim.*relative interior.*not an edge, vertex, seam, or cap.*face normal must be parallel or antiparallel/i,
  );
  assert.match(
    system,
    /make an internal checklist from every exactErrors and exactHistory entry.*not merely their labels, explanation, or the newest entry/i,
  );
  assert.match(
    system,
    /FINAL NON-NEGOTIABLE SELF-CHECK BEFORE THE JSON RESPONSE: verify the literal sourceCode, not just its prose/i,
  );
});

test("candidate envelope rejects missing, extra, and malformed fields without defaulting", () => {
  const missing = validateGeneratedVisualizationCandidateEnvelope({
    sourceCode: validSource,
    testCases: [],
  });
  assert.equal(missing.candidate, null);
  assert.match(missing.errors.join("; "), /candidate\.title is required/);
  assert.match(missing.errors.join("; "), /candidate\.explanation is required/);
  assert.match(missing.errors.join("; "), /candidate\.accessibilityDescription is required/);
  assert.match(missing.errors.join("; "), /candidate\.pedagogicalClaims must be an array/);

  const malformed = validateGeneratedVisualizationCandidateEnvelope({
    ...validEnvelope(),
    unsupported: true,
    pedagogicalClaims: [""],
    testCases: [{
      name: "fixture",
      inputs: [{ id: "gain", value: 1 }, { id: "gain", value: 2 }],
      expected: [],
    }],
  });
  assert.equal(malformed.candidate, null);
  assert.match(malformed.errors.join("; "), /candidate\.unsupported is not supported/);
  assert.match(malformed.errors.join("; "), /pedagogicalClaims\[0\].*non-empty string/);
  assert.match(malformed.errors.join("; "), /inputs\[1\]\.id is missing or duplicate/);
  assert.match(malformed.errors.join("; "), /tolerance must be a finite number or null/);
});

test("candidate envelope failure consumes one bounded generation attempt and reaches repair", async () => {
  const malformed = JSON.stringify({ sourceCode: validSource, testCases: [] });
  const modelClient = candidateClient([malformed, JSON.stringify(validEnvelope())]);
  const gardenDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-candidate-envelope-"));
  const candidateInputs = [];
  const events = [];
  try {
    const result = await createGeneratedVisualization({
      client: {},
      model: "test-model",
      gardenDir,
      opportunity,
      pageMarkdown: "Source-grounded fixture text.",
      maxAttempts: 2,
      runBrowserTests: false,
      onEvent: (event) => events.push(event),
      candidateProvider: async (input) => {
        candidateInputs.push(input);
        return generateVisualizationCandidate({ ...input, client: modelClient });
      },
      criticProvider: async () => ({
        approved: true,
        checkedAt: new Date().toISOString(),
        reason: "The repaired candidate is complete.",
        requestedChanges: [],
        scores: { pedagogicalValue: 0.9, sourceFidelity: 0.9, usability: 0.9, accessibility: 0.9 },
      }),
    });

    assert.equal(result.manifest?.generationAttempt, 2, result.errors.join("; "));
    assert.equal(candidateInputs.length, 2);
    assert.match(candidateInputs[1].errors.join("; "), /candidate\.title is required/);
    assert.match(candidateInputs[1].errors.join("; "), /candidate\.pedagogicalClaims must be an array/);
    assert.equal(events.filter((event) => event.type === "visual_generation_failed").length, 1);
    assert.equal(events.filter((event) => event.type === "visual_repair_started").length, 1);
  } finally {
    fs.rmSync(gardenDir, { recursive: true, force: true });
  }
});

test("persistent candidate envelope failure exhausts the bounded budget without publishing", async () => {
  const malformed = JSON.stringify({ sourceCode: validSource, testCases: [] });
  const modelClient = candidateClient([malformed, malformed]);
  const gardenDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-candidate-envelope-exhaust-"));
  let candidateCalls = 0;
  let criticCalls = 0;
  try {
    const result = await createGeneratedVisualization({
      client: {},
      model: "test-model",
      gardenDir,
      opportunity: { ...opportunity, id: "visual-envelope-exhaust" },
      pageMarkdown: "Source-grounded fixture text.",
      maxAttempts: 2,
      runBrowserTests: false,
      candidateProvider: async (input) => {
        candidateCalls += 1;
        return generateVisualizationCandidate({ ...input, client: modelClient });
      },
      criticProvider: async () => {
        criticCalls += 1;
        throw new Error("critic must not receive an invalid candidate envelope");
      },
    });

    assert.equal(candidateCalls, 2);
    assert.equal(criticCalls, 0);
    assert.equal(result.manifest, null);
    assert.equal(result.failureCategory, "generation");
    assert.match(result.errors.join("; "), /candidate\.title is required/);
  } finally {
    fs.rmSync(gardenDir, { recursive: true, force: true });
  }
});
