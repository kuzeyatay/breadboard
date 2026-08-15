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
