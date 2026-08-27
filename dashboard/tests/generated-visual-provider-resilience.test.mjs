import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  GENERATED_VISUAL_MAX_SOURCE_CHARS,
  GENERATED_VISUAL_PREVIEW_MAX_SELECT_STATES,
  GENERATED_VISUAL_REPAIR_HISTORY_MAX_ENTRIES,
  GENERATED_VISUAL_PROVIDER_LATE_RESULT_GRACE_MS,
  GENERATED_VISUAL_PROVIDER_MAX_TOTAL_WAIT_MS,
  GENERATED_VISUAL_PROVIDER_REQUEST_TIMEOUT_MS,
  GENERATED_VISUAL_PROVIDER_TRANSPORT_MAX_ATTEMPTS,
  GENERATED_VISUAL_SEMANTIC_MAX_ATTEMPTS,
  createGeneratedVisualization as createGeneratedVisualizationWithCompiler,
  generateVisualizationCandidate,
  isGeneratedVisualProviderTransportError,
  loadGeneratedVisualManifest,
  normalizeDetailedGeneratedVisualCriticRecord,
  retryGeneratedVisualProviderRequest,
} from "../src/lib/generated-visuals.ts";
import { compileGeneratedVisualization } from "../src/lib/generated-visual-compiler.ts";
import { runGeneratedVisualBrowserTestsLocally } from "../src/lib/generated-visual-browser-tests.ts";
import {
  GENERATED_VISUAL_CAPABILITY_MANIFEST,
  GENERATED_VISUAL_CAPABILITY_MANIFEST_HASH,
} from "../src/lib/generated-visual-capabilities.ts";
import { attachLearnTokenUsageTracking } from "../src/lib/learn-token-usage.ts";

const localCompilerRunner = async (sourceCode, opportunity) =>
  compileGeneratedVisualization(sourceCode, opportunity);

function createGeneratedVisualization(input) {
  return createGeneratedVisualizationWithCompiler({
    ...input,
    compilerRunner: input.compilerRunner ?? localCompilerRunner,
    browserTestRunner:
      input.browserTestRunner ?? runGeneratedVisualBrowserTestsLocally,
  });
}

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

function rejectedCritic(reason, requestedChanges) {
  return {
    ...approvedCritic(),
    approved: false,
    reason,
    requestedChanges,
  };
}

function providerTimeout() {
  return Object.assign(new Error("Request timed out."), { name: "APIConnectionTimeoutError" });
}

function providerConnectionFailure() {
  return Object.assign(new Error("socket closed"), { code: "ECONNRESET" });
}

function providerConnectionRefusal() {
  return Object.assign(new Error("listener refused request"), {
    code: "ECONNREFUSED",
  });
}

function providerAbortError() {
  return Object.assign(new Error("Provider stopped after its request signal aborted."), {
    name: "AbortError",
    code: "ABORT_ERR",
  });
}

function createDeferred() {
  let resolve;
  const promise = new Promise((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
}

function rejectWithAbortWhenSignalled(signal) {
  return new Promise((_resolve, reject) => {
    const rejectAbort = () => reject(providerAbortError());
    if (signal.aborted) rejectAbort();
    else signal.addEventListener("abort", rejectAbort, { once: true });
  });
}

async function exhaustOwnedDeadlineWithNestedProviderAbort(externalSignal) {
  return retryGeneratedVisualProviderRequest({
    timeoutMs: 5,
    externalSignal,
    work: (signal) => rejectWithAbortWhenSignalled(signal),
  });
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

function passingBrowserPreview(outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  const previewPath = path.join(outputDir, "preview.png");
  fs.writeFileSync(
    previewPath,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  const identity = {
    id: "mobile-375x667-light--default",
    viewport: { width: 375, height: 667 },
    theme: "light",
    selectState: [],
    defaultState: true,
    selectStateCoverageTruncated: false,
  };
  return {
    tests: [{ name: "browser preview fixture", passed: true, detail: "captured" }],
    browser: {
      executable: "fixture-browser",
      viewports: ["375x667 light"],
      screenshotCreated: true,
      previewCount: 1,
      selectStateCount: 1,
      selectStateCoverageTruncated: false,
      previewMatrixComplete: true,
      previewMatrixReceipt: {
        expectedCount: 1,
        capturedCount: 1,
        cells: [{
          ...identity,
          captured: true,
          attempts: [{
            attempt: 1,
            status: 0,
            signal: null,
            screenshotCreated: true,
            screenshotBytes: fs.statSync(previewPath).size,
          }],
        }],
      },
    },
    previews: [{ ...identity, path: previewPath }],
  };
}

test("Learn gives model-authored visual repair the bounded semantic ceiling", () => {
  assert.equal(GENERATED_VISUAL_PROVIDER_TRANSPORT_MAX_ATTEMPTS, 1);
  assert.equal(GENERATED_VISUAL_SEMANTIC_MAX_ATTEMPTS, 8);
  assert.equal(
    GENERATED_VISUAL_REPAIR_HISTORY_MAX_ENTRIES,
    GENERATED_VISUAL_SEMANTIC_MAX_ATTEMPTS,
  );
  const learnSource = fs.readFileSync(
    new URL("../src/lib/learn.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    learnSource,
    /maxAttempts:\s*GENERATED_VISUAL_SEMANTIC_MAX_ATTEMPTS/,
  );
});

test("semantic repair reaches attempt eight with exact AI critic feedback and then fails closed", async () => {
  const gardenDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "breadboard-visual-semantic-budget-"),
  );
  const events = [];
  const candidateRequests = [];
  const criticReasons = Array.from(
    { length: GENERATED_VISUAL_SEMANTIC_MAX_ATTEMPTS },
    (_, index) => `critic reason ${index + 1}: repair the authored geometry`,
  );
  const requestedChanges = Array.from(
    { length: GENERATED_VISUAL_SEMANTIC_MAX_ATTEMPTS },
    (_, index) => [`requested change ${index + 1}: move the rendered primitive`],
  );
  try {
    const result = await createGeneratedVisualization(
      baseInput(gardenDir, events, {
        maxAttempts: 99,
        candidateProvider: async (input) => {
          candidateRequests.push(input);
          return candidate();
        },
        criticProvider: async () => {
          const index = candidateRequests.length - 1;
          return rejectedCritic(criticReasons[index], requestedChanges[index]);
        },
      }),
    );

    assert.equal(result.manifest, null);
    assert.equal(result.failureCategory, "critic");
    assert.equal(candidateRequests.length, GENERATED_VISUAL_SEMANTIC_MAX_ATTEMPTS);
    assert.equal(
      events.filter(({ type }) => type === "visual_repair_started").length,
      GENERATED_VISUAL_SEMANTIC_MAX_ATTEMPTS - 1,
    );
    for (
      let attempt = 2;
      attempt <= GENERATED_VISUAL_SEMANTIC_MAX_ATTEMPTS;
      attempt += 1
    ) {
      const request = candidateRequests[attempt - 1];
      assert.deepEqual(request.errors, [
        criticReasons[attempt - 2],
        ...requestedChanges[attempt - 2],
      ]);
      assert.deepEqual(request.previousCandidate, candidate());
      assert.equal(request.repairHistory.length, attempt - 1);
      assert.deepEqual(
        request.repairHistory.map((entry) => ({
          attempt: entry.attempt,
          failureCategory: entry.failureCategory,
          errors: entry.errors,
          critic: entry.critic,
        })),
        Array.from({ length: attempt - 1 }, (_, index) => ({
          attempt: index + 1,
          failureCategory: "critic",
          errors: [
            criticReasons[index],
            ...requestedChanges[index],
          ],
          critic: {
            reason: criticReasons[index],
            requestedChanges: requestedChanges[index],
          },
        })),
      );
      for (const entry of request.repairHistory) {
        assert.match(entry.candidateSnapshotHash, /^[a-f0-9]{64}$/);
      }
    }
    assert.deepEqual(result.errors, [
      criticReasons.at(-1),
      ...requestedChanges.at(-1),
    ]);
    assert.equal(events.filter(({ type }) => type === "visual_fallback_used").length, 1);
    assert.equal(events.some(({ type }) => type === "visual_published"), false);
    assert.equal(loadGeneratedVisualManifest(gardenDir, opportunity.id), null);
  } finally {
    fs.rmSync(gardenDir, { recursive: true, force: true });
  }
});

test("rejected-attempt sink receives candidate and preview evidence at the rejection boundary", async () => {
  const gardenDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "breadboard-visual-rejected-sink-"),
  );
  const events = [];
  const rejected = [];
  try {
    const result = await createGeneratedVisualization(baseInput(gardenDir, events, {
      maxAttempts: 1,
      runBrowserTests: true,
      candidateProvider: async () => candidate(),
      browserTestRunner: ({ outputDir }) => {
        const preview = passingBrowserPreview(outputDir);
        preview.tests = [{ name: "runtime rejection fixture", passed: false, detail: "failed" }];
        return preview;
      },
      criticProvider: async () => {
        throw new Error("critic must not run after a failed runtime gate");
      },
      onRejectedAttempt: (receipt) => rejected.push(receipt),
    }));

    assert.equal(result.manifest, null);
    assert.equal(result.failureCategory, "runtime");
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].category, "runtime");
    assert.equal(rejected[0].candidate.sourceCode, validSource);
    assert.equal(
      rejected[0].evidence.tests.browser.previewMatrixReceipt.capturedCount,
      1,
    );
    assert.match(rejected[0].runId, /^[0-9]+-[0-9]+$/);
  } finally {
    fs.rmSync(gardenDir, { recursive: true, force: true });
  }
});

test("null-candidate rejections reach the sink and sink failure preserves the original result", async () => {
  const gardenDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "breadboard-visual-rejected-null-sink-"),
  );
  const events = [];
  const rejected = [];
  const providerFailure = new Error("candidate provider fixture failed");
  try {
    await assert.rejects(
      createGeneratedVisualization(baseInput(gardenDir, events, {
        maxAttempts: 1,
        candidateProvider: async () => {
          throw providerFailure;
        },
        onRejectedAttempt: (receipt) => {
          rejected.push(receipt);
          throw new Error("audit destination fixture failed at C:\\private\\profile");
        },
      })),
      (error) => error === providerFailure,
    );
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].candidate, null);
    assert.equal(rejected[0].category, "generation");
    const failureEvent = events.find(
      ({ type }) => type === "learn_visual_rejected_attempt_audit_failed",
    );
    assert.ok(failureEvent);
    assert.equal(failureEvent.data.reason, "rejected attempt audit could not be persisted");
    assert.doesNotMatch(JSON.stringify(failureEvent), /private|profile/i);
  } finally {
    fs.rmSync(gardenDir, { recursive: true, force: true });
  }
});

test("repair history fingerprints all six candidate fields instead of sourceCode alone", async () => {
  const gardenDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "breadboard-visual-snapshot-lineage-"),
  );
  const events = [];
  const requests = [];
  const candidates = [
    { ...candidate(), explanation: "First explanation with the shared source." },
    { ...candidate(), explanation: "Second explanation with the shared source." },
    { ...candidate(), explanation: "Third explanation with the shared source." },
  ];
  try {
    const result = await createGeneratedVisualization(
      baseInput(gardenDir, events, {
        maxAttempts: 3,
        candidateProvider: async (input) => {
          requests.push(input);
          return candidates[requests.length - 1];
        },
        criticProvider: async () =>
          rejectedCritic("The complete candidate needs another model revision.", [
            "Change an authored field without changing the shared source.",
          ]),
      }),
    );

    assert.equal(result.manifest, null);
    assert.equal(requests.length, 3);
    assert.equal(candidates[0].sourceCode, candidates[1].sourceCode);
    assert.equal(requests[2].previousCandidate.explanation, candidates[1].explanation);
    assert.equal(requests[2].repairHistory.length, 2);
    assert.notEqual(
      requests[2].repairHistory[0].candidateSnapshotHash,
      requests[2].repairHistory[1].candidateSnapshotHash,
      "metadata-only candidate changes must have distinct repair lineage",
    );
  } finally {
    fs.rmSync(gardenDir, { recursive: true, force: true });
  }
});

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

test("the soft deadline adopts the original late result without starting an identical request", async () => {
  const transportAttempts = [];
  const waits = [];
  const recoveries = [];
  const result = await retryGeneratedVisualProviderRequest({
    timeoutMs: 5,
    lateResultGraceMs: 50,
    work: async (_signal, transportAttempt) => {
      transportAttempts.push(transportAttempt);
      await new Promise((resolve) => setTimeout(resolve, 15));
      return "late original result";
    },
    onLateResultWait: (event) => waits.push(event),
    onLateResultRecovered: (event) => recoveries.push(event),
  });

  assert.equal(result, "late original result");
  assert.deepEqual(transportAttempts, [1]);
  assert.deepEqual(waits, [{ timeoutMs: 5, lateResultGraceMs: 50, hardTimeoutMs: 55 }]);
  assert.equal(recoveries.length, 1);
  assert.equal(recoveries[0].timeoutMs, 5);
  assert.equal(recoveries[0].lateResultGraceMs, 50);
  assert.ok(recoveries[0].waitedMs >= 0);
});

test("provider deadline defaults cover ChatMock's full 30-minute window with one finite hard bound", () => {
  assert.equal(GENERATED_VISUAL_PROVIDER_REQUEST_TIMEOUT_MS, 20 * 60_000);
  assert.equal(GENERATED_VISUAL_PROVIDER_LATE_RESULT_GRACE_MS, 11 * 60_000);
  assert.equal(GENERATED_VISUAL_PROVIDER_MAX_TOTAL_WAIT_MS, 31 * 60_000);
  assert.equal(
    GENERATED_VISUAL_PROVIDER_REQUEST_TIMEOUT_MS +
      GENERATED_VISUAL_PROVIDER_LATE_RESULT_GRACE_MS,
    GENERATED_VISUAL_PROVIDER_MAX_TOTAL_WAIT_MS,
  );
  assert.ok(GENERATED_VISUAL_PROVIDER_MAX_TOTAL_WAIT_MS > 5 * 60_000);
  assert.ok(GENERATED_VISUAL_PROVIDER_MAX_TOTAL_WAIT_MS > 30 * 60_000);
});

test("the provider deadline clamps the combined wait while preserving tiny deterministic overrides", async () => {
  const waits = [];
  const result = await retryGeneratedVisualProviderRequest({
    timeoutMs: 5,
    lateResultGraceMs: GENERATED_VISUAL_PROVIDER_MAX_TOTAL_WAIT_MS,
    work: async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      return "bounded late result";
    },
    onLateResultWait: (event) => waits.push(event),
  });

  assert.equal(result, "bounded late result");
  assert.deepEqual(waits, [
    {
      timeoutMs: 5,
      lateResultGraceMs: GENERATED_VISUAL_PROVIDER_MAX_TOTAL_WAIT_MS - 5,
      hardTimeoutMs: GENERATED_VISUAL_PROVIDER_MAX_TOTAL_WAIT_MS,
    },
  ]);
});

test("an exhausted ambiguous deadline fails closed after one call", async () => {
  let calls = 0;
  await assert.rejects(
    retryGeneratedVisualProviderRequest({
      timeoutMs: 5,
      lateResultGraceMs: 5,
      work: async () => {
        calls += 1;
        return new Promise(() => undefined);
      },
    }),
    (error) => {
      assert.equal(error.code, "BREADBOARD_GENERATED_VISUAL_REQUEST_TIMEOUT");
      assert.match(error.message, /ambiguous duplicate request was suppressed/i);
      return true;
    },
  );
  assert.equal(calls, 1);
});

test("the visual boundary never delegates replay eligibility to an outer session", async () => {
  const receiptFailure = Object.assign(new Error("ChatMock verified pre-output failure"), {
    status: 502,
    body: {
      chatmockTransportRecovery: {
        retryable: true,
        recovered: true,
        phase: "pre_output",
        recoveryId: "visual-request-receipt-generic",
        evidence: "request_scoped_pre_output_receipt",
      },
    },
  });
  for (const failure of [
    providerConnectionFailure(),
    providerConnectionRefusal(),
    receiptFailure,
  ]) {
    let calls = 0;
    await assert.rejects(
      retryGeneratedVisualProviderRequest({
        timeoutMs: 50,
        work: async () => {
          calls += 1;
          throw failure;
        },
      }),
      (error) => error === failure,
    );
    assert.equal(calls, 1, "the boundary reports eligibility but never replays itself");
  }
});

test("a throwing late-result wait observer cannot abandon the original result", async (context) => {
  let clockMs = 0;
  context.mock.method(performance, "now", () => clockMs);
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const providerStarted = createDeferred();
  const providerResult = createDeferred();
  const waitObserved = createDeferred();
  let calls = 0;
  const operation = retryGeneratedVisualProviderRequest({
    timeoutMs: 5,
    lateResultGraceMs: 50,
    work: async () => {
      calls += 1;
      providerStarted.resolve();
      return providerResult.promise;
    },
    onLateResultWait: () => {
      waitObserved.resolve();
      throw new Error("wait event ledger fixture failed");
    },
  });
  await providerStarted.promise;
  clockMs = 5;
  context.mock.timers.tick(5);
  await waitObserved.promise;
  providerResult.resolve("original result after broken wait telemetry");
  const result = await operation;

  assert.equal(result, "original result after broken wait telemetry");
  assert.equal(calls, 1);
});

test("a throwing late-result recovered observer cannot replace the adopted result", async (context) => {
  let clockMs = 0;
  context.mock.method(performance, "now", () => clockMs);
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const providerStarted = createDeferred();
  const providerResult = createDeferred();
  const waitObserved = createDeferred();
  let calls = 0;
  const operation = retryGeneratedVisualProviderRequest({
    timeoutMs: 5,
    lateResultGraceMs: 50,
    work: async () => {
      calls += 1;
      providerStarted.resolve();
      return providerResult.promise;
    },
    onLateResultWait: () => {
      waitObserved.resolve();
    },
    onLateResultRecovered: () => {
      throw new Error("recovered event ledger fixture failed");
    },
  });
  await providerStarted.promise;
  clockMs = 5;
  context.mock.timers.tick(5);
  await waitObserved.promise;
  providerResult.resolve("adopted result before broken recovered telemetry");
  const result = await operation;

  assert.equal(result, "adopted result before broken recovered telemetry");
  assert.equal(calls, 1);
});

test("hard ambiguity preserves its timeout when the wait observer also throws", async () => {
  let calls = 0;
  const observerFailure = new Error("wait event ledger fixture failed at hard timeout");
  await assert.rejects(
    retryGeneratedVisualProviderRequest({
      timeoutMs: 5,
      lateResultGraceMs: 5,
      work: async () => {
        calls += 1;
        return new Promise(() => undefined);
      },
      onLateResultWait: () => {
        throw observerFailure;
      },
    }),
    (error) => {
      assert.notEqual(error, observerFailure);
      assert.match(error.message, /ambiguous duplicate request was suppressed/i);
      return true;
    },
  );
  assert.equal(calls, 1);
});

test("the hard-timeout race winner remains authoritative over later provider rejection and cancellation", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const controller = new AbortController();
  const lateProviderFailure = new Error("provider rejected after hard timeout");
  const lateCancellation = new Error("external cancellation arrived after hard timeout");
  let rejectProvider;
  let calls = 0;
  const operation = retryGeneratedVisualProviderRequest({
    timeoutMs: 5,
    lateResultGraceMs: 5,
    externalSignal: controller.signal,
    work: async () => {
      calls += 1;
      return new Promise((_resolve, reject) => {
        rejectProvider = reject;
      });
    },
  });
  setTimeout(() => rejectProvider?.(lateProviderFailure), 25);
  setTimeout(() => controller.abort(lateCancellation), 30);
  await Promise.resolve();
  assert.equal(typeof rejectProvider, "function");
  // Resolve the soft timer, then starve its async continuation while advancing
  // beyond every logical deadline. The absolute 10ms hard timeout must retain
  // authority even though the provider and cancellation callbacks are due too.
  context.mock.timers.tick(5);
  context.mock.timers.tick(25);
  await assert.rejects(
    operation,
    (error) =>
      error !== lateProviderFailure &&
      error !== lateCancellation &&
      error.code === "BREADBOARD_GENERATED_VISUAL_REQUEST_TIMEOUT" &&
      /ambiguous duplicate request was suppressed/i.test(error.message),
  );
  assert.equal(calls, 1);
});

test("a provider rejection that wins the timeout race keeps exact identity despite a later external abort", async () => {
  const controller = new AbortController();
  const providerFailure = Object.assign(new Error("provider won first"), {
    code: "ECONNRESET",
  });
  const laterCancellation = new Error("later cancellation must not replace provider result");
  let calls = 0;
  await assert.rejects(
    retryGeneratedVisualProviderRequest({
      timeoutMs: 50,
      externalSignal: controller.signal,
      work: async () => {
        calls += 1;
        setTimeout(() => controller.abort(laterCancellation), 5);
        throw providerFailure;
      },
    }),
    (error) => error === providerFailure,
  );
  assert.equal(calls, 1);
});

test("built-in candidate keeps its SDK request recoverable and sends the exact model body once", async () => {
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
    assert.equal(bodies.length, 1);
    assert.equal(GENERATED_VISUAL_PROVIDER_REQUEST_TIMEOUT_MS, 20 * 60_000);
    assert.equal(GENERATED_VISUAL_PROVIDER_LATE_RESULT_GRACE_MS, 11 * 60_000);
    assert.equal(options[0].timeout, undefined);
    assert.ok(options[0].signal instanceof AbortSignal);
    assert.equal(options[0].maxRetries, 0);
    const system = bodies[0].messages.find(({ role }) => role === "system").content;
    assert.match(system, /implement opportunity\.interactionGoal and opportunity\.learnerAction as the artifact's actual interaction sequence/i);
    assert.match(system, /for test_prediction, require the learner to commit a prediction before the artifact reveals or evaluates the outcome/i);
    assert.match(system, /every decisive condition named by the reviewed interaction contract must be directly manipulable or evaluated/i);
    assert.match(system, /same control count, id, kind, label, type, protocolRole, unit, min, max, step, options, and defaultValue/i);
    assert.match(system, /same output count, id, label, and representation/i);
    assert.match(system, /complete model-authored consistency check/i);
    assert.match(system, /vector endpoint deltas and magnitudes/i);
    assert.match(system, /component-wise sums, resultants, and other aggregates/i);
    assert.match(system, /representative samples of a larger or continuous domain/i);
    assert.match(system, /whole-domain aggregate as their exact finite subtotal/i);
    assert.match(system, /does not supply enough information to evaluate a sign, magnitude, scale, or aggregate/i);
    assert.match(system, new RegExp(GENERATED_VISUAL_CAPABILITY_MANIFEST.expressions.binaryOperators.join("/")));
    assert.match(system, new RegExp(GENERATED_VISUAL_CAPABILITY_MANIFEST.expressions.unaryOperators.join("/")));
    assert.match(system, new RegExp(GENERATED_VISUAL_CAPABILITY_MANIFEST.expressions.comparisons.join("/")));
    const userPacket = JSON.parse(bodies[0].messages.find(({ role }) => role === "user").content);
    assert.equal(userPacket.opportunity.learnerAction, opportunity.learnerAction);
    assert.equal(GENERATED_VISUAL_MAX_SOURCE_CHARS, GENERATED_VISUAL_CAPABILITY_MANIFEST.hardLimits.sourceCharacters);
    assert.deepEqual(userPacket.sdkDocumentation.controlTypes, [...GENERATED_VISUAL_CAPABILITY_MANIFEST.runtimeControls.types]);
    assert.deepEqual(
      userPacket.sdkDocumentation.controlKinds,
      [...GENERATED_VISUAL_CAPABILITY_MANIFEST.requiredContractControls.kinds],
    );
    assert.deepEqual(
      userPacket.sdkDocumentation.controlProtocolRoles,
      [...GENERATED_VISUAL_CAPABILITY_MANIFEST.requiredContractControls.protocolRoles],
    );
    assert.deepEqual(userPacket.sdkDocumentation.outputTypes, [...GENERATED_VISUAL_CAPABILITY_MANIFEST.outputs.representations]);
    assert.deepEqual(userPacket.sdkDocumentation.sceneTypes, [...GENERATED_VISUAL_CAPABILITY_MANIFEST.scenes.kinds]);
    assert.deepEqual(userPacket.sdkDocumentation.spatialPrimitiveTypes, [...GENERATED_VISUAL_CAPABILITY_MANIFEST.scenes.spatial.primitiveKinds]);
    assert.deepEqual(userPacket.sdkDocumentation.spatialLabelModes, [...GENERATED_VISUAL_CAPABILITY_MANIFEST.scenes.spatial.labelModes]);
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

test("built-in author treats empty, missing, or literal-null fulfilled output as terminal after one raw call", async () => {
  for (const [label, content] of [
    ["missing", undefined],
    ["null", null],
    ["empty", ""],
    ["whitespace", "  \n"],
    ["literal-null", "null"],
    ["fenced-null", "```json\nnull\n```"],
  ]) {
    const gardenDir = fs.mkdtempSync(
      path.join(os.tmpdir(), `breadboard-visual-empty-author-${label}-`),
    );
    const events = [];
    let rawCalls = 0;
    let criticCalls = 0;
    const client = {
      chat: {
        completions: {
          create: async () => {
            rawCalls += 1;
            return {
              choices: [{
                message: content === undefined ? {} : { content },
              }],
            };
          },
        },
      },
    };
    try {
      await assert.rejects(
        createGeneratedVisualization(baseInput(gardenDir, events, {
          client,
          maxAttempts: 5,
          criticProvider: async () => {
            criticCalls += 1;
            return approvedCritic();
          },
        })),
        /generated visualization candidate returned (?:no nonempty content|literal JSON null)/,
      );
      assert.equal(rawCalls, 1, `${label} author output must not authorize another POST`);
      assert.equal(criticCalls, 0);
      assert.equal(events.some(({ type }) => type === "visual_repair_started"), false);
    } finally {
      fs.rmSync(gardenDir, { recursive: true, force: true });
    }
  }
});

test("built-in critic treats empty, missing, or literal-null fulfilled output as terminal after one raw call", async () => {
  for (const [label, content] of [
    ["missing", undefined],
    ["null", null],
    ["empty", ""],
    ["whitespace", "  \n"],
    ["literal-null", "null"],
    ["fenced-null", "```json\nnull\n```"],
  ]) {
    const gardenDir = fs.mkdtempSync(
      path.join(os.tmpdir(), `breadboard-visual-empty-critic-${label}-`),
    );
    const events = [];
    let candidateCalls = 0;
    let rawCalls = 0;
    const client = {
      chat: {
        completions: {
          create: async () => {
            rawCalls += 1;
            return {
              choices: [{
                message: content === undefined ? {} : { content },
              }],
            };
          },
        },
      },
    };
    try {
      await assert.rejects(
        createGeneratedVisualization(baseInput(gardenDir, events, {
          client,
          criticMaxAttempts: 3,
          candidateProvider: async () => {
            candidateCalls += 1;
            return candidate();
          },
        })),
        /critic returned (?:no nonempty content|literal JSON null)/,
      );
      assert.equal(candidateCalls, 1);
      assert.equal(rawCalls, 1, `${label} critic output must not authorize another POST`);
      assert.equal(events.some(({ type }) => type === "visual_critic_retry"), false);
      assert.equal(events.some(({ type }) => type === "visual_repair_started"), false);
    } finally {
      fs.rmSync(gardenDir, { recursive: true, force: true });
    }
  }
});

test("nonempty malformed built-in author output permits one validation-targeted repair", async () => {
  const gardenDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "breadboard-visual-author-semantic-repair-"),
  );
  const events = [];
  const requests = [];
  const client = {
    chat: {
      completions: {
        create: async (request) => {
          requests.push(request);
          return {
            choices: [{
              message: {
                content: requests.length === 1
                  ? "{nonempty malformed candidate"
                  : JSON.stringify(candidate()),
              },
            }],
          };
        },
      },
    },
  };
  try {
    const result = await createGeneratedVisualization(baseInput(gardenDir, events, {
      client,
      maxAttempts: 2,
      criticProvider: async () => approvedCritic(),
    }));

    assert.equal(result.manifest?.generationAttempt, 2, result.errors.join("; "));
    assert.equal(requests.length, 2);
    const repairPacket = JSON.parse(
      requests[1].messages.find(({ role }) => role === "user").content,
    );
    assert.match(
      repairPacket.repairContext.exactErrors.join("; "),
      /candidate is not valid JSON/i,
    );
    assert.equal(events.filter(({ type }) => type === "visual_repair_started").length, 1);
  } finally {
    fs.rmSync(gardenDir, { recursive: true, force: true });
  }
});

test("default author and critic adopt their original late council results and emit recovery evidence", async () => {
  const gardenDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-visual-late-adoption-"));
  const events = [];
  const bodies = [];
  const options = [];
  const client = {
    chat: {
      completions: {
        create: async (body, requestOptions) => {
          bodies.push(body);
          options.push(requestOptions);
          await new Promise((resolve) => setTimeout(resolve, 15));
          return {
            choices: [{
              message: {
                content: JSON.stringify(
                  body.taskType === "visualization_generation"
                    ? candidate()
                    : detailedApproval(),
                ),
              },
            }],
            usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
          };
        },
      },
    },
  };
  try {
    const result = await createGeneratedVisualization(baseInput(gardenDir, events, {
      client,
      timeoutMs: 5,
      lateResultGraceMs: 50,
    }));

    assert.equal(result.manifest?.generationAttempt, 1, result.errors.join("; "));
    assert.equal(bodies.length, 2, "one author and one critic call must be sufficient");
    assert.deepEqual(bodies.map(({ taskType }) => taskType), [
      "visualization_generation",
      "critique",
    ]);
    assert.ok(options.every(({ timeout }) => timeout === undefined));
    assert.ok(options.every(({ signal }) => signal instanceof AbortSignal));
    for (const eventType of [
      "visual_generation_late_result_wait_started",
      "visual_generation_late_result_adopted",
      "visual_critic_late_result_wait_started",
      "visual_critic_late_result_adopted",
    ]) {
      const matching = events.filter(({ type }) => type === eventType);
      assert.equal(matching.length, 1, eventType);
      assert.equal(matching[0].data.attempt, 1);
      assert.equal(matching[0].data.duplicateRequestSuppressed, true);
    }
    assert.equal(events.some(({ type }) => type.includes("transport_retry")), false);
    assert.equal(events.some(({ type }) => type === "visual_repair_started"), false);
  } finally {
    fs.rmSync(gardenDir, { recursive: true, force: true });
  }
});

test("default author hard ambiguity cannot consume a semantic attempt", async () => {
  const gardenDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-visual-author-hard-timeout-"));
  const events = [];
  const bodies = [];
  const client = {
    chat: {
      completions: {
        create: async (body, { signal }) => {
          bodies.push(body);
          return rejectWithAbortWhenSignalled(signal);
        },
      },
    },
  };
  try {
    await assert.rejects(
      createGeneratedVisualization(baseInput(gardenDir, events, {
        client,
        timeoutMs: 5,
        lateResultGraceMs: 5,
        maxAttempts: 5,
      })),
      (error) => error.code === "BREADBOARD_GENERATED_VISUAL_REQUEST_TIMEOUT",
    );
    assert.equal(bodies.length, 1);
    assert.equal(events.filter(({ type }) => type === "visual_generation_started").length, 1);
    assert.equal(events.filter(({ type }) => type === "visual_repair_started").length, 0);
    assert.equal(events.filter(({ type }) => type === "visual_generation_late_result_wait_started").length, 1);
    assert.equal(events.filter(({ type }) => type === "visual_generation_provider_failed").length, 1);
  } finally {
    fs.rmSync(gardenDir, { recursive: true, force: true });
  }
});

test("default critic hard ambiguity cannot consume a semantic critic attempt", async () => {
  const gardenDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-visual-critic-hard-timeout-"));
  const events = [];
  const bodies = [];
  let candidateCalls = 0;
  const client = {
    chat: {
      completions: {
        create: async (body, { signal }) => {
          bodies.push(body);
          return rejectWithAbortWhenSignalled(signal);
        },
      },
    },
  };
  try {
    await assert.rejects(
      createGeneratedVisualization(baseInput(gardenDir, events, {
        client,
        timeoutMs: 5,
        lateResultGraceMs: 5,
        candidateProvider: async () => {
          candidateCalls += 1;
          return candidate();
        },
        criticMaxAttempts: 3,
      })),
      (error) => error.code === "BREADBOARD_GENERATED_VISUAL_REQUEST_TIMEOUT",
    );
    assert.equal(candidateCalls, 1);
    assert.equal(bodies.length, 1);
    assert.equal(events.filter(({ type }) => type === "visual_critic_late_result_wait_started").length, 1);
    assert.equal(events.filter(({ type }) => type === "visual_critic_provider_failed").length, 1);
    assert.equal(events.filter(({ type }) => type === "visual_critic_retry").length, 0);
    assert.equal(events.filter(({ type }) => type === "visual_repair_started").length, 0);
  } finally {
    fs.rmSync(gardenDir, { recursive: true, force: true });
  }
});

test("built-in model repair receives the complete prior source and every exact feedback entry", async () => {
  const bodies = [];
  const previousSourceCode = "model-authored prior source\n".repeat(
    Math.ceil((GENERATED_VISUAL_MAX_SOURCE_CHARS + 97) / 28),
  );
  const exactErrors = [
    `long model-authored critic rationale: ${"q".repeat(1_250)}`,
    ...Array.from(
      { length: 22 },
      (_, index) => `model-authored requested change ${index + 1}`,
    ),
  ];
  assert.ok(previousSourceCode.length > GENERATED_VISUAL_MAX_SOURCE_CHARS);
  assert.ok(exactErrors[0].length > 1_000);
  assert.ok(exactErrors.length > 20);
  const client = {
    chat: {
      completions: {
        create: async (body) => {
          bodies.push(body);
          return {
            choices: [{ message: { content: JSON.stringify(candidate()) } }],
            usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
          };
        },
      },
    },
  };

  await generateVisualizationCandidate({
    client,
    model: "test-model",
    opportunity,
    pageMarkdown: "Source-grounded fixture text.",
    sourceContext,
    sourceFigureSummaries,
    formulaDefinitions,
    previousSourceCode,
    errors: exactErrors,
  });

  assert.equal(bodies.length, 1);
  const userPacket = JSON.parse(
    bodies[0].messages.find(({ role }) => role === "user").content,
  );
  assert.equal(
    userPacket.repairContext.previousSourceCode,
    previousSourceCode,
    "the prior model-authored module must not be clipped before repair",
  );
  assert.deepEqual(
    userPacket.repairContext.exactErrors,
    exactErrors,
    "critic and gate feedback must not be clipped or dropped before repair",
  );
});

test("built-in model repair carries the complete prior candidate, cumulative exact history, immutable contract, and labelled preview evidence", async () => {
  const previewDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "breadboard-visual-repair-packet-"),
  );
  const previewPath = path.join(previewDir, "mobile-case-b.png");
  fs.writeFileSync(
    previewPath,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+3MxGAAAAAElFTkSuQmCC",
      "base64",
    ),
  );
  const bodies = [];
  const previousCandidate = {
    ...candidate(),
    title: "Prior authored title",
    explanation: "Prior authored explanation.",
    testCases: [{
      name: "prior check",
      inputs: { input: 2 },
      expected: { result: 4 },
      tolerance: 0,
    }],
    accessibilityDescription: "Prior authored non-visual description.",
    pedagogicalClaims: ["Prior authored pedagogical claim."],
  };
  const repairHistory = [
    {
      attempt: 1,
      failureCategory: "validation",
      errors: ["exact validation gate reason"],
      candidateSnapshotHash: "a".repeat(64),
    },
    {
      attempt: 2,
      failureCategory: "critic",
      errors: ["exact critic reason", "exact requested change"],
      critic: {
        reason: "exact critic reason",
        requestedChanges: ["exact requested change"],
      },
      candidateSnapshotHash: "b".repeat(64),
    },
  ];
  const previews = [{
    id: "mobile-375x667-light--case_mode-1",
    viewport: { width: 375, height: 667 },
    theme: "light",
    selectState: [{ controlId: "case_mode", optionIndex: 1, optionLabel: "Case B" }],
    defaultState: false,
    selectStateCoverageTruncated: false,
    path: previewPath,
  }];
  const client = {
    chat: {
      completions: {
        create: async (body) => {
          bodies.push(body);
          return {
            choices: [{ message: { content: JSON.stringify(candidate()) } }],
            usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
          };
        },
      },
    },
  };

  try {
    await generateVisualizationCandidate({
      client,
      model: "test-model",
      opportunity,
      pageMarkdown: "Source-grounded fixture text.",
      sourceContext,
      sourceFigureSummaries,
      formulaDefinitions,
      previousCandidate,
      repairHistory,
      errors: repairHistory.at(-1).errors,
      previews,
    });

    const system = bodies[0].messages.find(({ role }) => role === "system").content;
    assert.match(system, /immutableContract controls and outputs are fixed/i);
    assert.match(system, /previewCoverage\.selectStateCoverageTruncated/i);
    const content = bodies[0].messages.find(({ role }) => role === "user").content;
    assert.ok(Array.isArray(content));
    assert.equal(content.filter((part) => part.type === "image_url").length, 1);
    const userPacket = JSON.parse(content.find((part) => part.type === "text").text);
    assert.deepEqual(userPacket.immutableContract, {
      requiredInputs: opportunity.requiredInputs,
      requiredOutputs: opportunity.requiredOutputs,
    });
    const { sourceHash, ...previousCandidateMetadata } =
      userPacket.repairContext.previousCandidate;
    assert.deepEqual(previousCandidateMetadata, previousCandidate);
    assert.match(sourceHash, /^[a-f0-9]{64}$/);
    assert.deepEqual(userPacket.repairContext.exactHistory, repairHistory);
    assert.deepEqual(userPacket.repairContext.renderedPreviews, [{
      id: previews[0].id,
      viewport: previews[0].viewport,
      theme: previews[0].theme,
      selectState: previews[0].selectState,
      defaultState: false,
      selectStateCoverageTruncated: false,
    }]);
    assert.deepEqual(userPacket.repairContext.previewCoverage, {
      renderedPreviewCount: 1,
      selectStateCap: 4,
      selectStateCoverageTruncated: false,
      policy:
        "Labelled previews are evidence only for their stated viewport and select state. A truncated select-state matrix is a deliberate bounded subset, never proof of an unrendered state or full state coverage.",
    });
  } finally {
    fs.rmSync(previewDir, { recursive: true, force: true });
  }
});

test("provider timeout suppresses a duplicate candidate call and semantic attempt", async () => {
  const gardenDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-visual-provider-retry-"));
  const events = [];
  const requests = [];
  const failure = providerTimeout();
  let criticCalls = 0;
  try {
    await assert.rejects(
      createGeneratedVisualization(baseInput(gardenDir, events, {
        candidateProvider: async (input) => {
          requests.push(input);
          throw failure;
        },
        criticProvider: async () => {
          criticCalls += 1;
          return approvedCritic();
        },
      })),
      (error) => error === failure,
    );
    assert.equal(requests.length, 1);
    assert.equal(criticCalls, 0);
    const failureEvent = events.find(({ type }) => type === "visual_generation_provider_failed");
    assert.equal(failureEvent.data.providerInvocations, 1);
    assert.equal(events.filter(({ type }) => type === "visual_generation_started").length, 1);
    assert.equal(events.filter(({ type }) => type === "visual_repair_started").length, 0);
    assert.equal(events.filter(({ type }) => type === "visual_model_generation_completed").length, 0);
  } finally {
    fs.rmSync(gardenDir, { recursive: true, force: true });
  }
});

test("candidate transport exhaustion fails closed at semantic attempt one", async () => {
  const gardenDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-visual-provider-exhaust-"));
  const events = [];
  const attempts = [];
  const failure = providerTimeout();
  let criticCalls = 0;
  try {
    await assert.rejects(
      createGeneratedVisualization(baseInput(gardenDir, events, {
        candidateProvider: async (input) => {
          attempts.push(input);
          throw failure;
        },
        criticProvider: async () => {
          criticCalls += 1;
          return approvedCritic();
        },
      })),
      (error) => error === failure,
    );
    assert.equal(attempts.length, 1);
    assert.equal(criticCalls, 0);
    assert.deepEqual(
      events.filter(({ type }) => type === "visual_generation_provider_failed").map(({ data }) => data.attempt),
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

test("custom candidate AbortError caused by the owned deadline returns a truthful transport rejection", async () => {
  const gardenDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-visual-candidate-deadline-abort-"));
  const events = [];
  let candidateCalls = 0;
  let criticCalls = 0;
  try {
    await assert.rejects(
      createGeneratedVisualization(baseInput(gardenDir, events, {
        candidateProvider: async ({ signal }) => {
          candidateCalls += 1;
          return exhaustOwnedDeadlineWithNestedProviderAbort(signal);
        },
        criticProvider: async () => {
          criticCalls += 1;
          return approvedCritic();
        },
      })),
      (error) => error.code === "BREADBOARD_GENERATED_VISUAL_REQUEST_TIMEOUT",
    );
    assert.equal(candidateCalls, 1, "the exhausted logical request must not become a semantic retry");
    assert.equal(criticCalls, 0);
    assert.equal(events.filter(({ type }) => type === "visual_generation_provider_failed").length, 1);
    assert.equal(events.some(({ type }) => type === "visual_generation_failed"), false);
    assert.equal(events.some(({ type }) => type === "visual_repair_started"), false);
    assert.equal(events.some(({ type }) => type === "visual_fallback_used"), false);
    assert.equal(loadGeneratedVisualManifest(gardenDir, opportunity.id), null);
  } finally {
    fs.rmSync(gardenDir, { recursive: true, force: true });
  }
});

test("a custom candidate callback failure remains exact and cannot become semantic repair", async () => {
  const gardenDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-visual-provider-semantic-"));
  const events = [];
  const requests = [];
  const failure = new Error("candidate envelope is invalid");
  try {
    await assert.rejects(
      createGeneratedVisualization(baseInput(gardenDir, events, {
        maxAttempts: 2,
        candidateProvider: async (input) => {
          requests.push(input);
          throw failure;
        },
        criticProvider: async () => approvedCritic(),
      })),
      (error) => error === failure,
    );

    assert.equal(requests.length, 1);
    assert.equal(requests[0].errors, undefined);
    assert.equal(events.filter(({ type }) => type === "visual_generation_provider_failed").length, 1);
    assert.equal(events.filter(({ type }) => type === "visual_repair_started").length, 0);
  } finally {
    fs.rmSync(gardenDir, { recursive: true, force: true });
  }
});

test("external cancellation that settles first interrupts the candidate transport boundary immediately", async () => {
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

test("external cancellation wins over a custom candidate provider's signal AbortError", async () => {
  const gardenDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-visual-provider-signal-cancel-"));
  const events = [];
  const controller = new AbortController();
  const cancellation = new Error("external cancellation owns the abort");
  let calls = 0;
  try {
    await assert.rejects(
      createGeneratedVisualization(baseInput(gardenDir, events, {
        abortSignal: controller.signal,
        candidateProvider: async ({ signal }) => {
          calls += 1;
          queueMicrotask(() => controller.abort(cancellation));
          return rejectWithAbortWhenSignalled(signal);
        },
        criticProvider: async () => approvedCritic(),
      })),
      cancellation,
    );
    assert.equal(calls, 1);
    assert.equal(events.some(({ type }) => type.includes("transport_retry")), false);
    assert.equal(events.some(({ type }) => type.includes("transport_exhausted")), false);
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

test("critic timeout preserves the validated artifact but suppresses a duplicate review", async () => {
  const gardenDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-visual-critic-provider-retry-"));
  const events = [];
  const criticRequests = [];
  const failure = providerTimeout();
  let candidateCalls = 0;
  try {
    await assert.rejects(
      createGeneratedVisualization(baseInput(gardenDir, events, {
        candidateProvider: async () => {
          candidateCalls += 1;
          return candidate();
        },
        criticProvider: async (input) => {
          criticRequests.push(input);
          throw failure;
        },
      })),
      (error) => error === failure,
    );
    assert.equal(candidateCalls, 1);
    assert.equal(criticRequests.length, 1);
    assert.equal(events.some(({ type }) => type === "visual_critic_retry"), false);
    assert.equal(events.some(({ type }) => type === "visual_repair_started"), false);
    assert.equal(events.filter(({ type }) => type === "visual_critic_completed").length, 0);
    const failureEvent = events.find(({ type }) => type === "visual_critic_provider_failed");
    assert.equal(failureEvent.data.providerInvocations, 1);
  } finally {
    fs.rmSync(gardenDir, { recursive: true, force: true });
  }
});

test("an ambiguous critic reset is terminal without a duplicate", async () => {
  const gardenDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-visual-critic-session-retry-"));
  const events = [];
  const criticRequests = [];
  const failure = providerConnectionFailure();
  let candidateCalls = 0;
  try {
    await assert.rejects(
      createGeneratedVisualization(baseInput(gardenDir, events, {
        candidateProvider: async () => {
          candidateCalls += 1;
          return candidate();
        },
        criticProvider: async (input) => {
          criticRequests.push(input);
          throw failure;
        },
      })),
      (error) => error === failure,
    );
    assert.equal(candidateCalls, 1);
    assert.equal(criticRequests.length, 1);
    assert.equal(events.some(({ type }) => type === "visual_critic_retry"), false);
    assert.equal(events.some(({ type }) => type === "visual_repair_started"), false);
    assert.equal(events.some(({ type }) => type === "visual_critic_completed"), false);
    const failed = events.find(({ type }) => type === "visual_critic_provider_failed");
    assert.equal(failed.data.providerInvocations, 1);
    assert.equal(failed.data.duplicateRequestSuppressed, true);
    assert.equal(failed.data.reason, failure.message);
  } finally {
    fs.rmSync(gardenDir, { recursive: true, force: true });
  }
});

test("unqualified HTTP and partial critic failures cannot become semantic retries", async () => {
  for (const { label, failure } of [
    {
      label: "unqualified-502",
      failure: Object.assign(new Error("HTTP 502 without a request receipt"), {
        status: 502,
      }),
    },
    {
      label: "partial-response",
      failure: new Error("Response ended prematurely after partial output"),
    },
  ]) {
    const gardenDir = fs.mkdtempSync(
      path.join(os.tmpdir(), `breadboard-visual-critic-${label}-`),
    );
    const events = [];
    let criticCalls = 0;
    try {
      await assert.rejects(
        createGeneratedVisualization(baseInput(gardenDir, events, {
          candidateProvider: async () => candidate(),
          criticProvider: async () => {
            criticCalls += 1;
            throw failure;
          },
        })),
        (error) => error === failure,
      );
      assert.equal(criticCalls, 1);
      assert.equal(events.some(({ type }) => type === "visual_critic_retry"), false);
      assert.equal(events.some(({ type }) => type === "visual_repair_started"), false);
      const exhausted = events.find(
        ({ type }) => type === "visual_critic_provider_failed",
      );
      assert.ok(exhausted);
      assert.equal(exhausted.data.duplicateRequestSuppressed, true);
    } finally {
      fs.rmSync(gardenDir, { recursive: true, force: true });
    }
  }
});

test("an unverified pre-accept critic refusal is terminal at the visual boundary", async () => {
  const gardenDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-visual-critic-safe-session-"));
  const events = [];
  const criticRequests = [];
  const failure = providerConnectionRefusal();
  try {
    await assert.rejects(
      createGeneratedVisualization(baseInput(gardenDir, events, {
        candidateProvider: async () => candidate(),
        criticProvider: async (input) => {
          criticRequests.push(input);
          throw failure;
        },
      })),
      (error) => error === failure,
    );
    assert.equal(criticRequests.length, 1);
    const exhausted = events.find(({ type }) => type === "visual_critic_provider_failed");
    assert.equal(exhausted.data.duplicateRequestSuppressed, true);
    assert.equal(events.some(({ type }) => type === "visual_critic_retry"), false);
    assert.equal(events.some(({ type }) => type === "visual_repair_started"), false);
  } finally {
    fs.rmSync(gardenDir, { recursive: true, force: true });
  }
});

test("tracked Learn critic never replays exact refusal even when recovery would verify", async () => {
  const gardenDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-visual-critic-tracked-session-"));
  const events = [];
  const rawBodies = [];
  const rawOptions = [];
  const usageEvents = [];
  const transportAttempts = [];
  const rejectedTransports = [];
  const recoveryVerifications = [];
  const connectionFailure = Object.assign(new Error("listener refused request"), {
    code: "ECONNREFUSED",
  });
  const client = {
    baseURL: "http://provider.invalid/v1",
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
    {
      retryTransport: {
        verifyConnectionRecovery: async (input) => {
          recoveryVerifications.push(input);
          return {
            id: "critic-health-receipt",
            evidence: "model_health_200_with_available_account",
          };
        },
        onAttempt: (attempt) => transportAttempts.push(attempt),
        onRejected: (rejection) => rejectedTransports.push(rejection),
      },
    },
  );
  try {
    await assert.rejects(
      createGeneratedVisualization(baseInput(gardenDir, events, {
        client,
        candidateProvider: async () => candidate(),
        runBrowserTests: true,
        browserTestRunner: ({ outputDir }) => passingBrowserPreview(outputDir),
      })),
      (error) => error === connectionFailure,
    );
    assert.equal(rawBodies.length, 1);
    const criticUserContent = rawBodies[0].messages.find(({ role }) => role === "user").content;
    assert.ok(Array.isArray(criticUserContent), "the exercised critic request must be multimodal");
    assert.equal(criticUserContent.filter(({ type }) => type === "image_url").length, 1);
    assert.equal(rawOptions[0].timeout, undefined);
    assert.ok(rawOptions[0].signal instanceof AbortSignal);
    assert.equal(rawOptions[0].maxRetries, 0);
    assert.equal(recoveryVerifications.length, 0);
    assert.deepEqual(
      transportAttempts.map(({ attempt, maxAttempts, retryCause }) => ({
        attempt,
        maxAttempts,
        retryCause,
      })),
      [
        {
          attempt: 1,
          maxAttempts: 1,
          retryCause: undefined,
        },
      ],
    );
    assert.deepEqual(rejectedTransports, [{
      attempt: 1,
      maxAttempts: 1,
      rejectionCause: "replay_disabled",
      retryCause: "connection_failure",
    }]);
    assert.deepEqual(
      usageEvents.map(({ type }) => type),
      ["started", "completed"],
    );
    assert.equal(usageEvents[1].usage, null);
    assert.equal(events.some(({ type }) => type === "visual_critic_provider_failed"), true);
    assert.equal(events.some(({ type }) => type === "visual_repair_started"), false);
    assert.equal(events.filter(({ type }) => type === "visual_published").length, 0);
  } finally {
    fs.rmSync(gardenDir, { recursive: true, force: true });
  }
});

test("configured recovery diagnostics cannot reopen an exact critic refusal", async () => {
  const gardenDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-visual-critic-provider-exhaust-"));
  const events = [];
  const recoveryVerifications = [];
  const rejectedTransports = [];
  const connectionRefusal = providerConnectionRefusal();
  let candidateCalls = 0;
  let rawCalls = 0;
  const client = {
    chat: {
      completions: {
        create: async () => {
          rawCalls += 1;
          throw connectionRefusal;
        },
      },
    },
  };
  attachLearnTokenUsageTracking(client, () => undefined, {
    retryTransport: {
      verifyConnectionRecovery: async (input) => {
        recoveryVerifications.push(input);
        return {
          recovered: false,
          probeCount: 2,
          outcome: "service_still_unavailable",
        };
      },
      onRejected: (rejection) => rejectedTransports.push(rejection),
    },
  });
  try {
    await assert.rejects(
      createGeneratedVisualization(baseInput(gardenDir, events, {
        client,
        candidateProvider: async () => {
          candidateCalls += 1;
          return candidate();
        },
      })),
      (error) => error === connectionRefusal,
    );
    assert.equal(candidateCalls, 1);
    assert.equal(rawCalls, 1);
    assert.equal(recoveryVerifications.length, 0);
    assert.deepEqual(rejectedTransports, [{
      attempt: 1,
      maxAttempts: 1,
      rejectionCause: "replay_disabled",
      retryCause: "connection_failure",
    }]);
    assert.deepEqual(
      events.filter(({ type }) => type === "visual_critic_provider_failed").map(({ data }) => ({
        attempt: data.attempt,
        criticAttempt: data.criticAttempt,
        duplicateRequestSuppressed: data.duplicateRequestSuppressed,
      })),
      [{
        attempt: 1,
        criticAttempt: 1,
        duplicateRequestSuppressed: true,
      }],
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

test("custom critic AbortError caused by the owned deadline returns a truthful critic transport rejection", async () => {
  const gardenDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-visual-critic-deadline-abort-"));
  const events = [];
  let candidateCalls = 0;
  let criticCalls = 0;
  try {
    await assert.rejects(
      createGeneratedVisualization(baseInput(gardenDir, events, {
        candidateProvider: async () => {
          candidateCalls += 1;
          return candidate();
        },
        criticProvider: async ({ signal }) => {
          criticCalls += 1;
          return exhaustOwnedDeadlineWithNestedProviderAbort(signal);
        },
      })),
      (error) => error.code === "BREADBOARD_GENERATED_VISUAL_REQUEST_TIMEOUT",
    );
    assert.equal(candidateCalls, 1);
    assert.equal(criticCalls, 1, "the exhausted logical request must not become a critic-protocol retry");
    assert.equal(events.filter(({ type }) => type === "visual_critic_provider_failed").length, 1);
    assert.equal(events.some(({ type }) => type === "visual_critic_failed"), false);
    assert.equal(events.some(({ type }) => type === "visual_critic_retry"), false);
    assert.equal(events.some(({ type }) => type === "visual_repair_started"), false);
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
    assert.equal(requests.length, 2);
    const system = requests[0].messages.find(({ role }) => role === "system").content;
    assert.match(system, /actual topology and domain against its labels, explanation, interaction contract, and source evidence/i);
    assert.match(system, /centered\/full from bounded\/clipped\/one-sided\/sector geometry/i);
    assert.match(system, /open from closed geometry/i);
    assert.match(system, /plane\(center,normal,size\) is a finite centered full rectangular patch and is valid for a full rectangular box face/i);
    assert.match(system, /do not require a polygon merely because that face is finite/i);
    assert.match(system, /Diagram node\.value is optional and must remain an expression object.*never a bare numeric value/i);
    assert.match(system, /do not request a derived formula or deep expression tree inside a diagram node value/i);
    assert.match(system, /final learnerAction promises a selected, highlighted, emphasized, or distinguished branch.*diagram edge\.strength expressions for every exact select option.*single option.*exclusive emphasized branch.*combined\/both\/all\/sum\/total\/\+ option.*union.*pairwise-distinct rendered signatures/i);
    assert.match(system, /edge\.strength is the supported authored mechanism.*rather than CSS, runtime, or control-contract changes/i);
    assert.match(system, /Do not request a long derived formula inside any spatial coordinate either.*simple literal\/input\/one-operation geometry/i);
    assert.match(system, /Never request min or max as a binary expression operator/i);
    assert.match(system, /Cylinder and cone primitives are bounded capped closed solids.*ordered polygon facets.*open, uncapped, clipped, one-sided, or sector surface/i);
    assert.match(system, /named-point normal, tangent, or basis-direction claim.*edge, vertex, seam, or cap.*face normal.*parallel or antiparallel/i);
    assert.match(system, /screen-relative left\/right\/top\/bottom statement as a literal rendered claim.*exact supplied preview.*world-coordinate relationship rather than a camera assumption/i);
    assert.match(system, /relabeling does not change topology or domain/i);
    assert.match(system, /independently recompute every evaluable relationship from the literal definition/i);
    assert.match(system, /vector's endpoint delta and magnitude/i);
    assert.match(system, /claimed sum must equal the displayed contributions at the authored precision/i);
    assert.match(system, /representative samples of a larger or continuous domain/i);
    assert.match(system, /whole-domain aggregate that is constructed or implied as their exact finite subtotal/i);
    assert.match(system, /part of both sourceClaimsAndUnits and primitiveTopologyAndDomain/i);
    assert.match(system, /displayed direction is multiplied by an uncontrolled signed scalar.*underlying term direction.*fixed-sign assumption.*opposite-sign reversal.*neutral labels.*sign-dependent reversal/i);
    assert.match(system, /input, then commit, then reveal\/evaluate order/i);
    assert.match(system, /reveals or evaluates the outcome before commitment/i);
    assert.match(system, /no retained hidden-state snapshot/i);
    assert.match(system, /complete bounded inventory of every blocking revision/i);
    assert.match(system, /immutableContract controls and outputs are planner-owned/i);
    assert.match(system, /trusted runtime renders every exact immutable control before numeric outputs and observable scenes.*runtimeEvidence verifies DOM order and rendered mobile visibility.*candidate cannot author control placement/i);
    assert.match(system, /Do not request a duplicate selector, scene-embedded control, CSS, or runtime ordering change/i);
    assert.match(system, /sourceCode\/SDK-feasible/i);
    assert.match(system, /never request a contract, planner, lesson, route, renderer, runtime, CSS, or unavailable SDK mutation/i);
    assert.match(system, /bounded representative evidence rather than proof of complete or unshown select-state coverage/i);
    const criticPacket = JSON.parse(
      requests[0].messages.find(({ role }) => role === "user").content,
    );
    assert.deepEqual(criticPacket.immutableContract, {
      requiredInputs: opportunity.requiredInputs,
      requiredOutputs: opportunity.requiredOutputs,
    });
    assert.deepEqual(
      criticPacket.capabilityManifest,
      GENERATED_VISUAL_CAPABILITY_MANIFEST,
    );
    assert.equal(
      criticPacket.capabilityManifestHash,
      GENERATED_VISUAL_CAPABILITY_MANIFEST_HASH,
    );
    assert.deepEqual(criticPacket.renderedPreviews, []);
    assert.deepEqual(criticPacket.previewCoverage, {
      renderedPreviewCount: 0,
      selectStateCap: GENERATED_VISUAL_PREVIEW_MAX_SELECT_STATES,
      selectStateCoverageTruncated: false,
      policy:
        "Labelled previews are evidence only for their stated viewport and select state. A truncated select-state matrix is a deliberate bounded subset, never proof of an unrendered state or full state coverage.",
    });
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
    assert.equal(events.filter(({ type }) => type === "visual_critic_retry").length, 1);
    assert.match(requests[1].messages.at(-1).content, /previous review was discarded/i);
    assert.match(requests[1].messages.at(-1).content, /primitiveTopologyAndDomain/i);
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

test("tracked Learn critic makes one raw call after an ambiguous reset", async () => {
  const gardenDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-visual-tracked-transport-"));
  const events = [];
  const usageEvents = [];
  const rawBodies = [];
  const rawOptions = [];
  const transportAttempts = [];
  const rejectedTransports = [];
  const recoveryVerifications = [];
  const connectionFailure = Object.assign(new Error("socket closed"), { code: "ECONNRESET" });
  const client = {
    baseURL: "http://provider.invalid/v1",
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
    {
      retryTransport: {
        verifyConnectionRecovery: async (input) => {
          recoveryVerifications.push(input);
          return {
            recovered: false,
            probeCount: 3,
            outcome: "no_available_account",
            httpStatus: 200,
          };
        },
        onAttempt: (attempt) => transportAttempts.push(attempt),
        onRejected: (rejection) => rejectedTransports.push(rejection),
      },
    },
  );
  try {
    await assert.rejects(
      createGeneratedVisualization(baseInput(gardenDir, events, {
        client,
        candidateProvider: async () => candidate(),
      })),
      (error) => error === connectionFailure,
    );
    assert.equal(rawBodies.length, 1, "unverified recovery cannot authorize a replay");
    assert.equal(rawOptions.length, 1);
    assert.equal(rawOptions[0].timeout, undefined);
    assert.ok(rawOptions[0].signal instanceof AbortSignal);
    assert.equal(rawOptions[0].maxRetries, 0);
    assert.deepEqual(usageEvents.map(({ type }) => type), ["started", "completed"]);
    assert.equal(usageEvents[1].usage, null);
    assert.equal(recoveryVerifications.length, 0);
    assert.deepEqual(transportAttempts.map(({ attempt }) => attempt), [1]);
    assert.deepEqual(rejectedTransports, [{
      attempt: 1,
      maxAttempts: 1,
      rejectionCause: "replay_disabled",
      retryCause: "connection_failure",
    }]);
    const exhaustion = events.filter(({ type }) => type === "visual_critic_provider_failed");
    assert.equal(exhaustion.length, 1);
    assert.equal(exhaustion[0].data.attempt, 1);
    assert.equal(exhaustion[0].data.duplicateRequestSuppressed, true);
    assert.equal(events.filter(({ type }) => type === "visual_generation_started").length, 1);
    assert.equal(events.some(({ type }) => type === "visual_repair_started"), false);
    assert.equal(events.some(({ type }) => type === "visual_critic_completed"), false);
    assert.equal(events.some(({ type }) => type === "visual_published"), false);
    assert.equal(events.some(({ type }) => type === "visual_fallback_used"), false);
  } finally {
    fs.rmSync(gardenDir, { recursive: true, force: true });
  }
});

test("tracked Learn author never replays exact refusal even when recovery would verify", async () => {
  const gardenDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-visual-tracked-replay-exhaustion-"));
  const events = [];
  const usageEvents = [];
  const rawBodies = [];
  const rawOptions = [];
  const transportAttempts = [];
  const rejectedTransports = [];
  const recoveryVerifications = [];
  const connectionRefusal = Object.assign(new Error("listener refused request"), {
    code: "ECONNREFUSED",
  });
  const client = {
    baseURL: "http://provider.invalid/v1",
    chat: {
      completions: {
        create: async (body, options) => {
          rawBodies.push(body);
          rawOptions.push(options);
          throw connectionRefusal;
        },
      },
    },
  };
  attachLearnTokenUsageTracking(
    client,
    (event) => usageEvents.push(event),
    {
      retryTransport: {
        verifyConnectionRecovery: async (input) => {
          recoveryVerifications.push(input);
          return {
            id: "generation-health-receipt",
            evidence: "model_health_200_with_available_account",
          };
        },
        onAttempt: (attempt) => transportAttempts.push(attempt),
        onRejected: (rejection) => rejectedTransports.push(rejection),
      },
    },
  );
  let criticCalls = 0;
  try {
    await assert.rejects(
      createGeneratedVisualization(baseInput(gardenDir, events, {
        client,
        criticProvider: async () => {
          criticCalls += 1;
          return approvedCritic();
        },
      })),
      (error) => error === connectionRefusal,
    );
    assert.equal(rawBodies.length, 1);
    assert.ok(rawOptions.every(({ timeout }) => timeout === undefined));
    assert.ok(rawOptions.every(({ signal }) => signal instanceof AbortSignal));
    assert.ok(rawOptions.every(({ maxRetries }) => maxRetries === 0));
    assert.equal(recoveryVerifications.length, 0);
    assert.deepEqual(
      transportAttempts.map(({ attempt, maxAttempts, retryCause }) => ({
        attempt,
        maxAttempts,
        retryCause,
      })),
      [
        { attempt: 1, maxAttempts: 1, retryCause: undefined },
      ],
    );
    assert.deepEqual(rejectedTransports, [{
      attempt: 1,
      maxAttempts: 1,
      rejectionCause: "replay_disabled",
      retryCause: "connection_failure",
    }]);
    assert.deepEqual(usageEvents.map(({ type }) => type), ["started", "completed"]);
    assert.equal(usageEvents[1].usage, null);
    assert.equal(criticCalls, 0);
    const exhaustion = events.filter(({ type }) => type === "visual_generation_provider_failed");
    assert.equal(exhaustion.length, 1);
    assert.equal(exhaustion[0].data.attempt, 1);
    assert.equal(exhaustion[0].data.providerInvocations, 1);
    assert.equal(exhaustion[0].data.duplicateRequestSuppressed, true);
    assert.equal(events.filter(({ type }) => type === "visual_generation_started").length, 1);
    assert.equal(events.some(({ type }) => type === "visual_repair_started"), false);
    assert.equal(events.some(({ type }) => type === "visual_critic_completed"), false);
    assert.equal(events.some(({ type }) => type === "visual_published"), false);
    assert.equal(events.some(({ type }) => type === "visual_fallback_used"), false);
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
  assert.equal(
    isGeneratedVisualProviderTransportError(Object.assign(new Error("Provider request timed out."), {
      name: "APIConnectionTimeoutError",
      cause: providerAbortError(),
    })),
    true,
    "an explicit provider timeout remains a timeout when its own deadline caused a nested AbortError",
  );
  assert.equal(isGeneratedVisualProviderTransportError(new Error("candidate envelope is invalid")), false);
});
