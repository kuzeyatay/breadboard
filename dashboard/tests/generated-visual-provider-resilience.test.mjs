import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  GENERATED_VISUAL_MAX_SOURCE_CHARS,
  GENERATED_VISUAL_PROVIDER_TRANSPORT_MAX_ATTEMPTS,
  createGeneratedVisualization,
  isGeneratedVisualProviderTransportError,
  loadGeneratedVisualManifest,
  normalizeDetailedGeneratedVisualCriticRecord,
  retryGeneratedVisualProviderRequest,
} from "../src/lib/generated-visuals.ts";
import { GENERATED_VISUAL_CAPABILITY_MANIFEST } from "../src/lib/generated-visual-capabilities.ts";
import { attachLearnTokenUsageTracking } from "../src/lib/learn-token-usage.ts";

const validSource = `import { defineVisualization } from "@breadboard/visual-sdk";
export default defineVisualization({
  schemaVersion: 1,
  sdkVersion: "1.0.0",
  title: "Provider resilience fixture",
  description: "Display one finite source-backed result.",
  accessibilityDescription: "A labelled value card displays the finite result.",
  controls: [],
  outputs: [{ id: "result", label: "Result", representation: "value", expression: { kind: "constant", value: 1 } }],
  scenes: [{ kind: "value", outputId: "result" }]
});`;

const opportunity = {
  id: "visual-provider-resilience",
  gardenId: "provider-resilience",
  learningUnitId: "U1",
  targetPage: "learning/provider-resilience.md",
  targetHeading: "Provider resilience",
  insertionAnchor: "learning-unit:U1:after-introduction",
  conceptIds: [],
  sourceAnchorIds: [],
  sourceVisualIds: [],
  sourceVisualRelationships: [],
  learningObjective: "Inspect the finite result.",
  learnerQuestion: "What result is displayed?",
  pedagogicalReason: "Exercise the generated-visual provider boundary.",
  interactionGoal: "inspect_relationship",
  learnerAction: "Inspect the displayed result and explain what it means.",
  requiredInputs: [],
  requiredOutputs: [{ id: "result", label: "Result", representation: "value" }],
  controlContractProblems: [],
  requiresGeneratedModule: true,
  priority: "high",
  confidence: 1,
  similarityFingerprint: "provider-resilience-fixture",
  requirement: "recommended",
};

const sourceContext = { source: "same source context" };
const sourceFigureSummaries = [{ id: "same-figure" }];
const formulaDefinitions = [{ id: "same-formula" }];

function candidate(tokenUsage) {
  return {
    title: "Provider resilience fixture",
    explanation: "A complete source-grounded fixture.",
    sourceCode: validSource,
    testCases: [],
    accessibilityDescription: "A labelled value card displays the finite result.",
    pedagogicalClaims: ["The displayed fixture result is finite."],
    ...(tokenUsage ? { tokenUsage } : {}),
  };
}

function approvedCritic(tokenUsage) {
  return {
    approved: true,
    checkedAt: new Date().toISOString(),
    reason: "The fixture passes the complete review.",
    requestedChanges: [],
    scores: { pedagogicalValue: 0.95, sourceFidelity: 0.95, usability: 0.95, accessibility: 0.95 },
    ...(tokenUsage ? { tokenUsage } : {}),
  };
}

function providerTimeout() {
  return Object.assign(new Error("Request timed out."), { name: "APIConnectionTimeoutError" });
}

function baseInput(gardenDir, events, overrides = {}) {
  return {
    client: {},
    model: "test-model",
    gardenDir,
    opportunity,
    pageMarkdown: "Source-grounded fixture text.",
    sourceContext,
    sourceFigureSummaries,
    formulaDefinitions,
    maxAttempts: 5,
    criticMaxAttempts: 3,
    runBrowserTests: false,
    onEvent: (event) => events.push(event),
    ...overrides,
  };
}

function assertSameCandidateRequest(left, right) {
  assert.equal(left.client, right.client);
  assert.equal(left.model, right.model);
  assert.equal(left.opportunity, right.opportunity);
  assert.equal(left.pageMarkdown, right.pageMarkdown);
  assert.equal(left.sourceContext, right.sourceContext);
  assert.equal(left.sourceFigureSummaries, right.sourceFigureSummaries);
  assert.equal(left.formulaDefinitions, right.formulaDefinitions);
  assert.equal(left.previousSourceCode, right.previousSourceCode);
  assert.equal(left.errors, right.errors);
  assert.equal(left.timeoutMs, right.timeoutMs);
  assert.ok(left.signal instanceof AbortSignal);
  assert.ok(right.signal instanceof AbortSignal);
}

function detailedApproval(overrides = {}) {
  return {
    approved: true,
    reason: "Every required dimension was reviewed.",
    requestedChanges: [],
    scores: {
      interactionImprovesUnderstanding: 0.95,
      subsectionFit: 0.95,
      controlMeaningfulness: 0.95,
      defaultStateUsefulness: 0.95,
      variableIntroduction: 0.95,
      sourceClaimsAndUnits: 0.95,
      primitiveTopologyAndDomain: 0.95,
      avoidsDuplication: 0.95,
      complexityDiscipline: 0.95,
      accessibility: 0.95,
      ...overrides,
    },
  };
}

test("the local request deadline is a transport retry and the next identical request can succeed", async () => {
  const transportAttempts = [];
  const retries = [];
  const result = await retryGeneratedVisualProviderRequest({
    timeoutMs: 5,
    work: async (_signal, transportAttempt) => {
      transportAttempts.push(transportAttempt);
      if (transportAttempt === 1) return new Promise(() => undefined);
      return "recovered";
    },
    onRetry: (event) => retries.push(event),
  });

  assert.equal(result, "recovered");
  assert.deepEqual(transportAttempts, [1, 2]);
  assert.equal(retries.length, 1);
  assert.match(retries[0].error.message, /provider request timed out after 5ms/i);
});

test("provider-owned completion timeout does not wrap an upstream retry delay", async () => {
  let calls = 0;
  const retries = [];
  const result = await retryGeneratedVisualProviderRequest({
    timeoutMs: 5,
    timeoutOwner: "provider",
    work: async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 15));
      return "upstream ladder completed";
    },
    onRetry: (event) => retries.push(event),
  });

  assert.equal(result, "upstream ladder completed");
  assert.equal(calls, 1);
  assert.deepEqual(retries, []);
});

test("built-in candidate transport retry reuses the exact model body and generic interaction contract", async () => {
  const gardenDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-visual-provider-body-"));
  const events = [];
  const bodies = [];
  const options = [];
  const client = {
    chat: {
      completions: {
        create: async (body, requestOptions) => {
          bodies.push(body);
          options.push(requestOptions);
          if (bodies.length === 1) throw providerTimeout();
          return {
            choices: [{ message: { content: JSON.stringify(candidate()) } }],
            usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
          };
        },
      },
    },
  };
  try {
    const result = await createGeneratedVisualization(baseInput(gardenDir, events, {
      client,
      criticProvider: async () => approvedCritic(),
    }));

    assert.equal(result.manifest?.generationAttempt, 1, result.errors.join("; "));
    assert.equal(bodies.length, 2);
    assert.deepEqual(bodies[1], bodies[0]);
    assert.notEqual(options[1].signal, options[0].signal);
    assert.equal(options[0].timeout, 90_000);
    assert.equal(options[1].timeout, 90_000);
    assert.equal(options[0].maxRetries, 0);
    assert.equal(options[1].maxRetries, 0);
    const system = bodies[0].messages.find(({ role }) => role === "system").content;
    assert.match(system, /implement opportunity\.interactionGoal and opportunity\.learnerAction as the artifact's actual interaction sequence/i);
    assert.match(system, /for test_prediction, require the learner to commit a prediction before the artifact reveals or evaluates the outcome/i);
    assert.match(system, /every decisive condition named by the reviewed interaction contract must be directly manipulable or evaluated/i);
    assert.match(system, new RegExp(GENERATED_VISUAL_CAPABILITY_MANIFEST.expressions.binaryOperators.join("/")));
    assert.match(system, new RegExp(GENERATED_VISUAL_CAPABILITY_MANIFEST.expressions.unaryOperators.join("/")));
    assert.match(system, new RegExp(GENERATED_VISUAL_CAPABILITY_MANIFEST.expressions.comparisons.join("/")));
    const userPacket = JSON.parse(bodies[0].messages.find(({ role }) => role === "user").content);
    assert.equal(userPacket.opportunity.learnerAction, opportunity.learnerAction);
    assert.equal(GENERATED_VISUAL_MAX_SOURCE_CHARS, GENERATED_VISUAL_CAPABILITY_MANIFEST.hardLimits.sourceCharacters);
    assert.deepEqual(userPacket.sdkDocumentation.controlTypes, [...GENERATED_VISUAL_CAPABILITY_MANIFEST.runtimeControls.types]);
    assert.deepEqual(userPacket.sdkDocumentation.outputTypes, [...GENERATED_VISUAL_CAPABILITY_MANIFEST.outputs.representations]);
    assert.deepEqual(userPacket.sdkDocumentation.sceneTypes, [...GENERATED_VISUAL_CAPABILITY_MANIFEST.scenes.kinds]);
    assert.deepEqual(userPacket.sdkDocumentation.spatialPrimitiveTypes, [...GENERATED_VISUAL_CAPABILITY_MANIFEST.scenes.spatial.primitiveKinds]);
    assert.equal(userPacket.sdkDocumentation.maxControls, GENERATED_VISUAL_CAPABILITY_MANIFEST.hardLimits.controls);
    assert.equal(userPacket.sdkDocumentation.maxScenes, GENERATED_VISUAL_CAPABILITY_MANIFEST.hardLimits.scenes);
    assert.equal(userPacket.sdkDocumentation.maxSpatialGroups, GENERATED_VISUAL_CAPABILITY_MANIFEST.hardLimits.spatialGroups);
    assert.equal(userPacket.sdkDocumentation.maxSpatialPrimitives, GENERATED_VISUAL_CAPABILITY_MANIFEST.hardLimits.spatialPrimitives);
    assert.equal(userPacket.sdkDocumentation.maxSpatialPolygonPoints, GENERATED_VISUAL_CAPABILITY_MANIFEST.hardLimits.spatialPolygonPoints);
    assert.equal(events.filter(({ type }) => type === "visual_model_generation_completed").length, 1);
    assert.equal(events.find(({ type }) => type === "visual_model_generation_completed").data.tokenUsage.totalTokens, 11);
  } finally {
    fs.rmSync(gardenDir, { recursive: true, force: true });
  }
});

test("provider timeout replays candidate generation without consuming a semantic attempt or usage event", async () => {
  const gardenDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-visual-provider-retry-"));
  const events = [];
  const requests = [];
  let criticCalls = 0;
  try {
    const result = await createGeneratedVisualization(baseInput(gardenDir, events, {
      candidateProvider: async (input) => {
        requests.push(input);
        if (requests.length === 1) throw providerTimeout();
        return candidate({ inputTokens: 7, outputTokens: 3, reasoningTokens: 1, totalTokens: 10 });
      },
      criticProvider: async () => {
        criticCalls += 1;
        return approvedCritic();
      },
    }));

    assert.equal(result.manifest?.generationAttempt, 1, result.errors.join("; "));
    assert.equal(requests.length, 2);
    assertSameCandidateRequest(requests[0], requests[1]);
    assert.equal(criticCalls, 1);
    assert.deepEqual(
      events.filter(({ type }) => type === "visual_generation_transport_retry").map(({ data }) => ({
        attempt: data.attempt,
        transportAttempt: data.transportAttempt,
      })),
      [{ attempt: 1, transportAttempt: 1 }],
    );
    assert.equal(events.filter(({ type }) => type === "visual_generation_started").length, 1);
    assert.equal(events.filter(({ type }) => type === "visual_repair_started").length, 0);
    assert.equal(events.filter(({ type }) => type === "visual_model_generation_completed").length, 1);
    assert.equal(
      events.find(({ type }) => type === "visual_model_generation_completed").data.tokenUsage.totalTokens,
      10,
    );
  } finally {
    fs.rmSync(gardenDir, { recursive: true, force: true });
  }
});

test("candidate transport exhaustion fails closed at semantic attempt one", async () => {
  const gardenDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-visual-provider-exhaust-"));
  const events = [];
  const attempts = [];
  let criticCalls = 0;
  try {
    const result = await createGeneratedVisualization(baseInput(gardenDir, events, {
      candidateProvider: async (input) => {
        attempts.push(input);
        throw providerTimeout();
      },
      criticProvider: async () => {
        criticCalls += 1;
        return approvedCritic();
      },
    }));

    assert.equal(result.manifest, null);
    assert.equal(result.failureCategory, "generation");
    assert.equal(attempts.length, GENERATED_VISUAL_PROVIDER_TRANSPORT_MAX_ATTEMPTS);
    attempts.slice(1).forEach((request) => assertSameCandidateRequest(attempts[0], request));
    assert.equal(criticCalls, 0);
    assert.match(result.errors.join("; "), /transport exhausted 3 identical-request attempts/i);
    assert.deepEqual(
      events.filter(({ type }) => type === "visual_generation_transport_retry").map(({ data }) => data.attempt),
      [1, 1],
    );
    assert.deepEqual(
      events.filter(({ type }) => type === "visual_generation_transport_exhausted").map(({ data }) => data.attempt),
      [1],
    );
    assert.equal(events.filter(({ type }) => type === "visual_generation_started").length, 1);
    assert.equal(events.some(({ type }) => type === "visual_repair_started"), false);
    assert.equal(events.some(({ type }) => type === "visual_generation_failed"), false);
    assert.equal(events.some(({ type }) => type === "visual_critic_completed"), false);
    assert.equal(events.some(({ type }) => type === "visual_published"), false);
    assert.equal(events.some(({ type }) => type === "visual_fallback_used"), false);
    assert.equal(loadGeneratedVisualManifest(gardenDir, opportunity.id), null);
  } finally {
    fs.rmSync(gardenDir, { recursive: true, force: true });
  }
});

test("non-transport candidate failure remains a model-authored semantic repair attempt", async () => {
  const gardenDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-visual-provider-semantic-"));
  const events = [];
  const requests = [];
  try {
    const result = await createGeneratedVisualization(baseInput(gardenDir, events, {
      maxAttempts: 2,
      candidateProvider: async (input) => {
        requests.push(input);
        if (requests.length === 1) throw new Error("candidate envelope is invalid");
        return candidate();
      },
      criticProvider: async () => approvedCritic(),
    }));

    assert.equal(result.manifest?.generationAttempt, 2, result.errors.join("; "));
    assert.equal(requests.length, 2);
    assert.equal(requests[0].errors, undefined);
    assert.deepEqual(requests[1].errors, ["candidate envelope is invalid"]);
    assert.equal(events.filter(({ type }) => type === "visual_generation_failed").length, 1);
    assert.equal(events.filter(({ type }) => type === "visual_repair_started").length, 1);
    assert.equal(events.some(({ type }) => type.includes("transport_retry")), false);
  } finally {
    fs.rmSync(gardenDir, { recursive: true, force: true });
  }
});

test("external cancellation interrupts candidate transport replay immediately", async () => {
  const gardenDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-visual-provider-cancel-"));
  const events = [];
  const controller = new AbortController();
  const cancellation = new Error("cancelled by resilience test");
  let calls = 0;
  try {
    await assert.rejects(
      createGeneratedVisualization(baseInput(gardenDir, events, {
        abortSignal: controller.signal,
        candidateProvider: async () => {
          calls += 1;
          controller.abort(cancellation);
          throw providerTimeout();
        },
        criticProvider: async () => approvedCritic(),
      })),
      cancellation,
    );
    assert.equal(calls, 1);
    assert.equal(events.some(({ type }) => type.includes("transport_retry")), false);
    assert.equal(events.some(({ type }) => type === "visual_generation_failed"), false);
    assert.equal(events.some(({ type }) => type === "visual_fallback_used"), false);
  } finally {
    fs.rmSync(gardenDir, { recursive: true, force: true });
  }
});

test("provider abort is never converted into a semantic generation retry", async () => {
  const gardenDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-visual-provider-abort-"));
  const events = [];
  const providerAbort = Object.assign(new Error("Request was aborted."), { name: "APIUserAbortError" });
  let calls = 0;
  try {
    await assert.rejects(
      createGeneratedVisualization(baseInput(gardenDir, events, {
        candidateProvider: async () => {
          calls += 1;
          throw providerAbort;
        },
        criticProvider: async () => approvedCritic(),
      })),
      providerAbort,
    );
    assert.equal(calls, 1);
    assert.equal(events.some(({ type }) => type.includes("transport_retry")), false);
    assert.equal(events.some(({ type }) => type === "visual_generation_failed"), false);
    assert.equal(events.some(({ type }) => type === "visual_repair_started"), false);
    assert.equal(events.some(({ type }) => type === "visual_fallback_used"), false);
  } finally {
    fs.rmSync(gardenDir, { recursive: true, force: true });
  }
});

test("critic transport retry preserves the validated artifact and critic protocol attempt", async () => {
  const gardenDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-visual-critic-provider-retry-"));
  const events = [];
  const criticRequests = [];
  let candidateCalls = 0;
  try {
    const result = await createGeneratedVisualization(baseInput(gardenDir, events, {
      candidateProvider: async () => {
        candidateCalls += 1;
        return candidate();
      },
      criticProvider: async (input) => {
        criticRequests.push(input);
        if (criticRequests.length === 1) throw providerTimeout();
        return approvedCritic({ inputTokens: 5, outputTokens: 2, reasoningTokens: 0, totalTokens: 7 });
      },
    }));

    assert.equal(result.manifest?.generationAttempt, 1, result.errors.join("; "));
    assert.equal(candidateCalls, 1);
    assert.equal(criticRequests.length, 2);
    for (const field of [
      "client",
      "model",
      "opportunity",
      "candidate",
      "definition",
      "sourceContext",
      "sourceFigureSummaries",
      "formulaDefinitions",
      "previewPath",
      "tests",
      "priorCriticFailure",
    ]) {
      assert.equal(criticRequests[0][field], criticRequests[1][field], field);
    }
    assert.deepEqual(
      events.filter(({ type }) => type === "visual_critic_transport_retry").map(({ data }) => ({
        attempt: data.attempt,
        criticAttempt: data.criticAttempt,
        transportAttempt: data.transportAttempt,
      })),
      [{ attempt: 1, criticAttempt: 1, transportAttempt: 1 }],
    );
    assert.equal(events.some(({ type }) => type === "visual_critic_retry"), false);
    assert.equal(events.some(({ type }) => type === "visual_repair_started"), false);
    assert.equal(events.filter(({ type }) => type === "visual_critic_completed").length, 1);
    assert.equal(events.find(({ type }) => type === "visual_critic_completed").data.tokenUsage.totalTokens, 7);
  } finally {
    fs.rmSync(gardenDir, { recursive: true, force: true });
  }
});

test("critic transport exhaustion is terminal without consuming critic protocol or generation repair attempts", async () => {
  const gardenDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-visual-critic-provider-exhaust-"));
  const events = [];
  let candidateCalls = 0;
  let criticCalls = 0;
  try {
    const result = await createGeneratedVisualization(baseInput(gardenDir, events, {
      candidateProvider: async () => {
        candidateCalls += 1;
        return candidate();
      },
      criticProvider: async () => {
        criticCalls += 1;
        throw providerTimeout();
      },
    }));

    assert.equal(result.manifest, null);
    assert.equal(result.failureCategory, "critic");
    assert.equal(candidateCalls, 1);
    assert.equal(criticCalls, GENERATED_VISUAL_PROVIDER_TRANSPORT_MAX_ATTEMPTS);
    assert.deepEqual(
      events.filter(({ type }) => type === "visual_critic_transport_retry").map(({ data }) => ({
        attempt: data.attempt,
        criticAttempt: data.criticAttempt,
      })),
      [{ attempt: 1, criticAttempt: 1 }, { attempt: 1, criticAttempt: 1 }],
    );
    assert.deepEqual(
      events.filter(({ type }) => type === "visual_critic_transport_exhausted").map(({ data }) => ({
        attempt: data.attempt,
        criticAttempt: data.criticAttempt,
      })),
      [{ attempt: 1, criticAttempt: 1 }],
    );
    assert.equal(events.some(({ type }) => type === "visual_critic_retry"), false);
    assert.equal(events.some(({ type }) => type === "visual_critic_failed"), false);
    assert.equal(events.some(({ type }) => type === "visual_repair_started"), false);
    assert.equal(events.some(({ type }) => type === "visual_published"), false);
    assert.equal(events.some(({ type }) => type === "visual_fallback_used"), false);
    assert.equal(loadGeneratedVisualManifest(gardenDir, opportunity.id), null);
  } finally {
    fs.rmSync(gardenDir, { recursive: true, force: true });
  }
});

test("critic prompt requires topology/domain comparison and legacy approval enters shape retry", async () => {
  const gardenDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-visual-topology-critic-"));
  const events = [];
  const requests = [];
  const replies = [
    {
      approved: true,
      reason: "Legacy approval must not publish.",
      requestedChanges: [],
      scores: { pedagogicalValue: 1, sourceFidelity: 1, usability: 1, accessibility: 1 },
    },
    detailedApproval(),
  ];
  const client = {
    chat: {
      completions: {
        create: async (request) => {
          requests.push(request);
          if (requests.length === 1) throw providerTimeout();
          return {
            choices: [{ message: { content: JSON.stringify(replies.shift()) } }],
            usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
          };
        },
      },
    },
  };
  try {
    const result = await createGeneratedVisualization(baseInput(gardenDir, events, {
      client,
      candidateProvider: async () => candidate(),
      criticMaxAttempts: 2,
    }));

    assert.equal(result.manifest?.generationAttempt, 1, result.errors.join("; "));
    assert.equal(requests.length, 3);
    assert.deepEqual(requests[1], requests[0]);
    const system = requests[0].messages.find(({ role }) => role === "system").content;
    assert.match(system, /actual topology and domain against its labels, explanation, interaction contract, and source evidence/i);
    assert.match(system, /centered\/full from bounded\/clipped\/one-sided\/sector geometry/i);
    assert.match(system, /open from closed geometry/i);
    assert.match(system, /relabeling does not change topology or domain/i);
    assert.ok(
      requests[0].response_format.json_schema.schema.properties.scores.required.includes(
        "primitiveTopologyAndDomain",
      ),
    );
    for (const scoreSchema of Object.values(
      requests[0].response_format.json_schema.schema.properties.scores.properties,
    )) {
      assert.equal(scoreSchema.minimum, 0);
      assert.equal(scoreSchema.maximum, 1);
    }
    assert.equal(events.filter(({ type }) => type === "visual_critic_transport_retry").length, 1);
    assert.equal(events.filter(({ type }) => type === "visual_critic_retry").length, 1);
    assert.match(requests[2].messages.at(-1).content, /previous review was discarded/i);
    assert.match(requests[2].messages.at(-1).content, /primitiveTopologyAndDomain/i);
  } finally {
    fs.rmSync(gardenDir, { recursive: true, force: true });
  }
});

test("topology/domain mismatch defeats approval even when prose relabels the primitive", () => {
  const critic = normalizeDetailedGeneratedVisualCriticRecord(detailedApproval({
    primitiveTopologyAndDomain: 0.2,
  }));

  assert.ok(critic);
  assert.equal(critic.approved, false);
  assert.equal(critic.scores.sourceFidelity, 0.2);
  assert.match(critic.requestedChanges.join("; "), /actual topology and domain match/i);
  assert.match(critic.requestedChanges.join("; "), /relabeling a mismatched shape is not a correction/i);
});

test("critic rejects out-of-range scores instead of clamping them into approval", () => {
  for (const primitiveTopologyAndDomain of [-0.01, 1.01, 2]) {
    const diagnostics = {};
    const critic = normalizeDetailedGeneratedVisualCriticRecord(
      detailedApproval({ primitiveTopologyAndDomain }),
      undefined,
      undefined,
      diagnostics,
    );

    assert.equal(critic, null);
    assert.match(
      diagnostics.reason,
      /score "primitiveTopologyAndDomain" must be between 0 and 1/i,
    );
  }
});

test("critic rejects an approval that also requests changes", () => {
  const verdict = detailedApproval();
  verdict.requestedChanges = ["Change the rendered topology before publication."];
  const diagnostics = {};
  const critic = normalizeDetailedGeneratedVisualCriticRecord(
    verdict,
    undefined,
    undefined,
    diagnostics,
  );

  assert.equal(critic, null);
  assert.match(diagnostics.reason, /approved the visual while requesting changes/i);
});

test("tracked Learn client owns restart retries without a generated-visual 6x3 expansion", async () => {
  const gardenDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-visual-tracked-transport-"));
  const events = [];
  const usageEvents = [];
  const rawBodies = [];
  const rawOptions = [];
  const connectionFailure = Object.assign(new Error("socket closed"), { code: "ECONNRESET" });
  const client = {
    chat: {
      completions: {
        create: async (body, options) => {
          rawBodies.push(body);
          rawOptions.push(options);
          throw connectionFailure;
        },
      },
    },
  };
  attachLearnTokenUsageTracking(
    client,
    (event) => usageEvents.push(event),
    { retry502: { sleep: async () => undefined } },
  );
  let criticCalls = 0;
  try {
    const result = await createGeneratedVisualization(baseInput(gardenDir, events, {
      client,
      timeoutMs: 5_000,
      criticProvider: async () => {
        criticCalls += 1;
        return approvedCritic();
      },
    }));

    assert.equal(result.manifest, null);
    assert.equal(result.failureCategory, "generation");
    assert.equal(rawBodies.length, 6, "the tracked client owns exactly its six raw transport attempts");
    rawBodies.slice(1).forEach((body) => assert.equal(body, rawBodies[0]));
    rawOptions.slice(1).forEach((options) => assert.equal(options, rawOptions[0]));
    assert.equal(rawOptions[0].timeout, 5_000);
    assert.equal(rawOptions[0].maxRetries, 0);
    assert.deepEqual(usageEvents.map(({ type }) => type), ["started", "completed"]);
    assert.equal(usageEvents[1].usage, null);
    assert.equal(criticCalls, 0);
    assert.equal(events.some(({ type }) => type === "visual_generation_transport_retry"), false);
    const exhaustion = events.filter(({ type }) => type === "visual_generation_transport_exhausted");
    assert.equal(exhaustion.length, 1);
    assert.equal(exhaustion[0].data.attempt, 1);
    assert.equal(exhaustion[0].data.transportRetryOwner, "upstream_client");
    assert.equal(events.filter(({ type }) => type === "visual_generation_started").length, 1);
    assert.equal(events.some(({ type }) => type === "visual_repair_started"), false);
    assert.equal(events.some(({ type }) => type === "visual_critic_completed"), false);
    assert.equal(events.some(({ type }) => type === "visual_published"), false);
    assert.equal(events.some(({ type }) => type === "visual_fallback_used"), false);
    assert.match(result.errors.join("; "), /upstream provider transport retries were exhausted/i);
  } finally {
    fs.rmSync(gardenDir, { recursive: true, force: true });
  }
});

test("transport classification remains narrow around timeouts, restarts, HTTP errors, and cancellation", () => {
  assert.equal(isGeneratedVisualProviderTransportError(providerTimeout()), true);
  assert.equal(
    isGeneratedVisualProviderTransportError(Object.assign(new Error("socket closed"), { code: "ECONNRESET" })),
    false,
  );
  assert.equal(isGeneratedVisualProviderTransportError(Object.assign(new Error("HTTP 502"), { status: 502 })), false);
  assert.equal(isGeneratedVisualProviderTransportError(Object.assign(new Error("HTTP 504 timeout"), { status: 504 })), false);
  assert.equal(isGeneratedVisualProviderTransportError(Object.assign(new Error("Request was aborted."), { name: "APIUserAbortError" })), false);
  assert.equal(isGeneratedVisualProviderTransportError(new Error("candidate envelope is invalid")), false);
});
