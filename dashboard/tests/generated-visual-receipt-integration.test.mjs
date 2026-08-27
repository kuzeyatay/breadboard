import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createGeneratedVisualization as createGeneratedVisualizationWithCompiler,
} from "../src/lib/generated-visuals.ts";
import { compileGeneratedVisualization } from "../src/lib/generated-visual-compiler.ts";
import { runGeneratedVisualBrowserTestsLocally } from "../src/lib/generated-visual-browser-tests.ts";
import {
  generatedVisualCouncilReceiptDirectory,
  stableGeneratedVisualCouncilRecoveryRoot,
} from "../src/lib/generated-visual-council-receipts.ts";

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

const MODEL = "gpt-5.6-sol";
const CRITIC_MODEL = "gpt-5.5";
const NOW = "2031-08-24T12:00:00.000Z";
const PREVIEW_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const sourceCode = `import { defineVisualization } from "@breadboard/visual-sdk";
export default defineVisualization({
  schemaVersion: 1,
  sdkVersion: "1.0.0",
  title: "Finite result",
  description: "Display one finite source-backed result.",
  accessibilityDescription: "A labelled value card displays the finite default result. Reset restores that default result.",
  controls: [],
  outputs: [{ id: "result", label: "Result", representation: "value", expression: { kind: "constant", value: 1 } }],
  scenes: [{ kind: "value", outputId: "result" }]
});`;

const candidate = {
  title: "Finite result",
  explanation: "The value card makes the source-backed finite result explicit.",
  sourceCode,
  testCases: [],
  accessibilityDescription:
    "A labelled value card displays the finite default result. Reset restores that default result.",
  pedagogicalClaims: ["The displayed result is finite."],
};

const critic = {
  approved: true,
  reason: "The source-backed visual is focused, legible, and accessible.",
  requestedChanges: [],
  scores: {
    interactionImprovesUnderstanding: 0.94,
    subsectionFit: 0.96,
    controlMeaningfulness: 0.93,
    defaultStateUsefulness: 0.95,
    variableIntroduction: 0.94,
    sourceClaimsAndUnits: 0.97,
    primitiveTopologyAndDomain: 0.96,
    avoidsDuplication: 0.95,
    complexityDiscipline: 0.97,
    accessibility: 0.95,
  },
};

const opportunity = {
  id: "visual-receipt-integration",
  gardenId: "receipt-integration",
  learningUnitId: "U1",
  targetPage: "learning/finite-result.md",
  targetHeading: "Finite result",
  insertionAnchor: "learning-unit:U1:after-introduction",
  conceptIds: [],
  sourceAnchorIds: [],
  sourceVisualIds: [],
  sourceVisualRelationships: [],
  learningObjective: "Inspect the finite result.",
  learnerQuestion: "What result is displayed?",
  pedagogicalReason: "Make the result directly inspectable.",
  interactionGoal: "inspect_relationship",
  learnerAction: "Inspect the displayed result and explain it.",
  requiredInputs: [],
  requiredOutputs: [
    { id: "result", label: "Result", representation: "value" },
  ],
  controlContractProblems: [],
  requiresGeneratedModule: true,
  priority: "high",
  confidence: 1,
  similarityFingerprint: "receipt-integration-generic",
  requirement: "recommended",
};

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function receiptResult(body, content, index) {
  const councilRunId = `crun_generated_visual_integration_${index}`;
  const requestedModel = body.model;
  return {
    councilRunId,
    councilMode: "direct_council",
    requestedModel,
    resolvedModel: requestedModel,
    finalAnswer: content,
    reasoningSummary: "Detailed integration reasoning.",
    usageEstimated: false,
    usage: {
      inputTokens: 40 + index,
      outputTokens: 20 + index,
      totalTokens: 60 + index * 2,
      cachedInputTokens: 2,
      reasoningTokens: 8,
      callCount: 1,
      reportedCallCount: 1,
    },
    modelRouting: [
      {
        schemaVersion: 1,
        at: NOW,
        requestId: councilRunId,
        endpoint: "council",
        requestedModel,
        resolvedModel: requestedModel,
        upstreamModel: requestedModel,
        provider: "chatgpt",
        outcome: "succeeded",
        fallback: false,
      },
    ],
    responseHash: sha256(content),
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function httpCompletion(result) {
  return {
    id: result.councilRunId,
    choices: [
      { message: { role: "assistant", content: result.finalAnswer } },
    ],
    usage: {
      prompt_tokens: result.usage.inputTokens,
      completion_tokens: result.usage.outputTokens,
      total_tokens: result.usage.totalTokens,
      prompt_tokens_details: { cached_tokens: result.usage.cachedInputTokens },
      completion_tokens_details: {
        reasoning_tokens: result.usage.reasoningTokens,
      },
    },
    usageEstimated: false,
    councilRunId: result.councilRunId,
    councilMode: "direct_council",
    chatmockModelRouting: {
      requestedModel: result.requestedModel,
      resolvedModel: result.resolvedModel,
      servedModels: [result.resolvedModel],
      usedFallback: false,
    },
  };
}

function jsonResponse(status, value) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => structuredClone(value),
  };
}

function passingBrowserPreview({ outputDir }) {
  fs.mkdirSync(outputDir, { recursive: true });
  const previewPath = path.join(outputDir, "preview.png");
  fs.writeFileSync(previewPath, Buffer.from(PREVIEW_BASE64, "base64"));
  const identity = {
    id: "mobile-375x667-light--default",
    viewport: { width: 375, height: 667 },
    theme: "light",
    selectState: [],
    defaultState: true,
    selectStateCoverageTruncated: false,
  };
  return {
    tests: [{ name: "browser preview fixture", passed: true }],
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
        cells: [
          {
            ...identity,
            captured: true,
            attempts: [
              {
                attempt: 1,
                status: 0,
                signal: null,
                screenshotCreated: true,
                screenshotBytes: fs.statSync(previewPath).size,
              },
            ],
          },
        ],
      },
    },
    previews: [{ ...identity, path: previewPath }],
  };
}

test("built-in author and image critic use durable exact Council receipts", async () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "generated-visual-receipt-integration-"),
  );
  const stagingGarden = path.join(root, "staging-garden");
  const liveGarden = path.join(root, "live-garden");
  fs.mkdirSync(stagingGarden, { recursive: true });
  fs.mkdirSync(liveGarden, { recursive: true });
  const recoveryRoot = stableGeneratedVisualCouncilRecoveryRoot(
    liveGarden,
    path.join(root, "runtime"),
  );
  const receipts = new Map();
  const posts = [];
  const observations = [];
  const originalFetch = globalThis.fetch;
  const originalCriticModel = process.env.LEARN_GENERATED_VISUAL_CRITIC_MODEL;

  const client = {
    baseURL: "http://127.0.0.1:8765/v1",
    chat: {
      completions: {
        create: async (body, options) => {
          posts.push(structuredClone(body));
          assert.equal(options.maxRetries, 0);
          const content = JSON.stringify(
            body.taskType === "critique" ? critic : candidate,
          );
          const result = receiptResult(body, content, posts.length);
          receipts.set(body.clientRequestId, {
            requestHash: body.clientRequestHash,
            result,
          });
          return httpCompletion(result);
        },
      },
    },
  };

  globalThis.fetch = async (input) => {
    const url = new URL(input);
    assert.equal(url.pathname, "/v1/internal/council-results/resolve");
    const requestId = url.searchParams.get("requestId");
    const requestHash = url.searchParams.get("requestHash");
    const receipt = receipts.get(requestId);
    if (!receipt) {
      return jsonResponse(404, {
        error: { code: "receipt_not_found", message: "missing" },
      });
    }
    assert.equal(requestHash, receipt.requestHash);
    return jsonResponse(200, { state: "completed", result: receipt.result });
  };
  process.env.LEARN_GENERATED_VISUAL_CRITIC_MODEL = CRITIC_MODEL;

  try {
    const result = await createGeneratedVisualization({
      client,
      model: MODEL,
      gardenDir: stagingGarden,
      durableRecoveryDir: recoveryRoot,
      recoveryOwnerId: "job-generic-receipt-integration",
      opportunity,
      pageMarkdown: "The source establishes one finite result.",
      sourceContext: { source: "generic finite-result source" },
      availableSourceAnchorIds: new Set(),
      maxAttempts: 1,
      criticMaxAttempts: 1,
      browserTestRunner: passingBrowserPreview,
      onCouncilReceipt: (receipt) => observations.push(receipt),
    });

    assert.ok(result.manifest);
    assert.equal(posts.length, 2);
    assert.deepEqual(
      posts.map((body) => body.taskType),
      ["visualization_generation", "critique"],
    );
    assert.deepEqual(
      posts.map((body) => body.model),
      [MODEL, MODEL],
    );
    for (const body of posts) {
      assert.equal(body.councilModeOverride, "direct_council");
      assert.deepEqual(body.reasoning, { effort: "max", summary: "detailed" });
      assert.match(body.clientRequestId, /^lrq_[A-Za-z0-9_-]{8,120}$/);
      assert.match(body.clientRequestHash, /^[0-9a-f]{64}$/);
    }
    const criticUser = posts[1].messages.find(
      (message) => message.role === "user",
    );
    assert.ok(Array.isArray(criticUser.content));
    assert.equal(
      criticUser.content.filter((part) => part.type === "image_url").length,
      1,
    );

    assert.deepEqual(
      observations.map((receipt) => ({
        phase: receipt.phase,
        requestedModel: receipt.requestedModel,
        resolvedModel: receipt.resolvedModel,
        recovered: receipt.recovered,
        dispatchCount: receipt.dispatchCount,
        httpCompletionObserved: receipt.httpCompletionObserved,
      })),
      [
        {
          phase: "author",
          requestedModel: MODEL,
          resolvedModel: MODEL,
          recovered: false,
          dispatchCount: 1,
          httpCompletionObserved: true,
        },
        {
          phase: "critic",
          requestedModel: MODEL,
          resolvedModel: MODEL,
          recovered: false,
          dispatchCount: 1,
          httpCompletionObserved: true,
        },
      ],
    );

    const receiptDir = generatedVisualCouncilReceiptDirectory(recoveryRoot);
    const receiptFiles = fs.readdirSync(receiptDir);
    assert.equal(
      receiptFiles.filter((name) => name.endsWith(".binding.json")).length,
      2,
    );
    assert.equal(
      receiptFiles.filter((name) => name.endsWith(".completed.json")).length,
      2,
    );
    assert.equal(
      fs.existsSync(generatedVisualCouncilReceiptDirectory(stagingGarden)),
      false,
    );
    assert.equal(
      receiptDir.startsWith(`${path.resolve(liveGarden)}${path.sep}`),
      false,
    );
    const localEvidence = receiptFiles
      .map((name) => fs.readFileSync(path.join(receiptDir, name), "utf8"))
      .join("\n");
    assert.doesNotMatch(localEvidence, /generic finite-result source/);
    assert.doesNotMatch(localEvidence, new RegExp(PREVIEW_BASE64));
    assert.doesNotMatch(localEvidence, /The source establishes one finite result/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCriticModel === undefined) {
      delete process.env.LEARN_GENERATED_VISUAL_CRITIC_MODEL;
    } else {
      process.env.LEARN_GENERATED_VISUAL_CRITIC_MODEL = originalCriticModel;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an externally aborted late author cannot emit receipt accounting and the fresh run recovers it", async () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "generated-visual-receipt-abort-integration-"),
  );
  const stagingGarden = path.join(root, "staging-garden");
  const liveGarden = path.join(root, "live-garden");
  fs.mkdirSync(stagingGarden, { recursive: true });
  fs.mkdirSync(liveGarden, { recursive: true });
  const recoveryRoot = stableGeneratedVisualCouncilRecoveryRoot(
    liveGarden,
    path.join(root, "runtime"),
  );
  const receiptDir = generatedVisualCouncilReceiptDirectory(recoveryRoot);
  const receipts = new Map();
  const posts = [];
  const observations = [];
  const controller = new AbortController();
  const abortReason = new Error("fixture Learn generation was externally aborted");
  const originalFetch = globalThis.fetch;
  let releaseProvider;
  let announceProviderStarted;
  let announceProviderReturned;
  const providerGate = new Promise((resolve) => {
    releaseProvider = resolve;
  });
  const providerStarted = new Promise((resolve) => {
    announceProviderStarted = resolve;
  });
  const providerReturned = new Promise((resolve) => {
    announceProviderReturned = resolve;
  });

  const client = {
    baseURL: "http://127.0.0.1:8765/v1",
    chat: {
      completions: {
        create: async (body, options) => {
          posts.push(structuredClone(body));
          assert.equal(options.maxRetries, 0);
          const content = JSON.stringify(
            body.taskType === "critique" ? critic : candidate,
          );
          const result = receiptResult(body, content, posts.length);
          if (body.taskType === "visualization_generation") {
            announceProviderStarted();
            await providerGate;
          }
          receipts.set(body.clientRequestId, {
            requestHash: body.clientRequestHash,
            result,
          });
          if (body.taskType === "visualization_generation") {
            announceProviderReturned();
          }
          return httpCompletion(result);
        },
      },
    },
  };

  globalThis.fetch = async (input) => {
    const url = new URL(input);
    const requestId = url.searchParams.get("requestId");
    const requestHash = url.searchParams.get("requestHash");
    const receipt = receipts.get(requestId);
    if (!receipt) {
      return jsonResponse(404, {
        error: { code: "receipt_not_found", message: "missing" },
      });
    }
    assert.equal(requestHash, receipt.requestHash);
    return jsonResponse(200, { state: "completed", result: receipt.result });
  };

  const createInput = {
    client,
    model: MODEL,
    gardenDir: stagingGarden,
    durableRecoveryDir: recoveryRoot,
    recoveryOwnerId: "job-receipt-abort-integration",
    opportunity,
    pageMarkdown: "The source establishes one finite result.",
    sourceContext: { source: "generic finite-result source" },
    availableSourceAnchorIds: new Set(),
    maxAttempts: 1,
    criticMaxAttempts: 1,
    browserTestRunner: passingBrowserPreview,
    onCouncilReceipt: (receipt) => observations.push(receipt),
  };

  try {
    const abortedRun = createGeneratedVisualization({
      ...createInput,
      abortSignal: controller.signal,
    });
    await providerStarted;
    controller.abort(abortReason);
    await assert.rejects(abortedRun, (error) => error === abortReason);
    assert.deepEqual(observations, []);

    releaseProvider();
    await providerReturned;
    await new Promise((resolve) => setImmediate(resolve));
    const filesAfterLateSettlement = fs.readdirSync(receiptDir);
    for (const suffix of ["response", "completed", "failed", "redispatch"]) {
      assert.equal(
        filesAfterLateSettlement.some((name) => name.endsWith(`.${suffix}.json`)),
        false,
        `${suffix} evidence must not escape an aborted continuation`,
      );
    }
    assert.deepEqual(observations, []);

    const recoveredRun = await createGeneratedVisualization(createInput);
    assert.ok(recoveredRun.manifest);
    assert.deepEqual(
      posts.map((body) => body.taskType),
      ["visualization_generation", "critique"],
      "the fresh run must recover the author receipt instead of posting it again",
    );
    assert.deepEqual(
      observations.map((receipt) => ({
        phase: receipt.phase,
        recovered: receipt.recovered,
        dispatchCount: receipt.dispatchCount,
        httpCompletionObserved: receipt.httpCompletionObserved,
      })),
      [
        {
          phase: "author",
          recovered: true,
          dispatchCount: 0,
          httpCompletionObserved: false,
        },
        {
          phase: "critic",
          recovered: false,
          dispatchCount: 1,
          httpCompletionObserved: true,
        },
      ],
    );
  } finally {
    releaseProvider();
    globalThis.fetch = originalFetch;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
