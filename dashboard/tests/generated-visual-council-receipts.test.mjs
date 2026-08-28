import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  GeneratedVisualCouncilReceiptError,
  generatedVisualCouncilReceiptDirectory,
  mergeGeneratedVisualCouncilReceiptDirectory,
  prepareGeneratedVisualCouncilRequest,
  runGeneratedVisualCouncilRequestWithReceipt,
  stableGeneratedVisualCouncilRecoveryRoot,
} from "../src/lib/generated-visual-council-receipts.ts";
import { canonicalCouncilJsonV1 } from "../src/lib/council-request-hash.ts";

const NOW = "2031-04-05T06:07:08.000Z";

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function requestFixture(overrides = {}) {
  return {
    model: "gpt-5.6-sol",
    messages: [
      {
        role: "system",
        content:
          "Author exactly one visual with {{BREADBOARD_CHATMOCK_RESOLVED_MODEL}} via {{BREADBOARD_CHATMOCK_RESOLVED_PROVIDER}}.",
      },
      { role: "user", content: JSON.stringify({ concept: "flux", attempt: 2 }) },
    ],
    max_completion_tokens: 1537,
    response_format: { type: "json_object" },
    taskType: "visualization_generation",
    gardenId: "garden-fixture",
    pageId: "learning/flux",
    sourceContext: { sourceIds: ["source-a"], page: 17 },
    councilModeOverride: "direct_council",
    ...overrides,
  };
}

function receiptResult(body, content = '{"title":"Recovered visual"}') {
  const councilRunId = "crun_generated_visual_fixture_0001";
  return {
    councilRunId,
    councilMode: "direct_council",
    requestedModel: body.model,
    resolvedModel: body.model,
    finalAnswer: content,
    reasoningSummary: "Detailed fixture reasoning.",
    usageEstimated: false,
    usage: {
      inputTokens: 11,
      outputTokens: 7,
      totalTokens: 18,
      cachedInputTokens: 2,
      reasoningTokens: 3,
      callCount: 1,
      reportedCallCount: 1,
    },
    modelRouting: [
      {
        schemaVersion: 1,
        at: NOW,
        requestId: councilRunId,
        endpoint: "council",
        requestedModel: body.model,
        resolvedModel: body.model,
        upstreamModel: body.model,
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
    object: "chat.completion",
    model: result.requestedModel,
    choices: [
      { index: 0, message: { role: "assistant", content: result.finalAnswer } },
    ],
    usage: {
      prompt_tokens: result.usage.inputTokens,
      completion_tokens: result.usage.outputTokens,
      total_tokens: result.usage.totalTokens,
      prompt_tokens_details: { cached_tokens: result.usage.cachedInputTokens },
      completion_tokens_details: { reasoning_tokens: result.usage.reasoningTokens },
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

function failedAttempt(body, generation) {
  return {
    dispatchGeneration: generation,
    outcome: "failed_no_final_answer",
    councilRunId: `crun_generated_visual_failed_${generation}`,
    finalAnswerPresent: false,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      callCount: 1,
      reportedCallCount: 0,
    },
    // A websocket-close/no-final run can have zero reported usage while the
    // runtime truthfully labels that failed-attempt projection as estimated.
    usageEstimated: true,
    modelRouting: [
      {
        schemaVersion: 1,
        at: NOW,
        requestId: `crun_generated_visual_failed_${generation}`,
        endpoint: "council",
        requestedModel: body.model,
        resolvedModel: body.model,
        upstreamModel: body.model,
        provider: "chatgpt",
        outcome: "failed",
        fallback: false,
        statusCode: 502,
        errorCode: "connection_closed",
        failurePhase: "receive",
        partialOutput: true,
        replaySafe: false,
      },
    ],
    requestedModel: body.model,
    resolvedModel: body.model,
    createdAt: NOW,
    updatedAt: NOW,
    failureCode: "council_no_final_answer",
  };
}

function jsonResponse(status, value) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => structuredClone(value),
  };
}

class FakeCouncilBoundary {
  receipts = new Map();
  posts = [];
  requestOptions = [];
  resolves = [];
  resolveOverride = null;
  createOverride = null;

  constructor() {
    this.client = {
      baseURL: "http://127.0.0.1:8765/v1",
      chat: {
        completions: {
          create: async (body, options) => {
            this.posts.push(structuredClone(body));
            this.requestOptions.push(options);
            assert.equal(options.maxRetries, 0);
            if (this.createOverride) return this.createOverride(body, options);
            const result = this.complete(body);
            return httpCompletion(result);
          },
        },
      },
    };
    this.fetch = async (input, init) => {
      const url = new URL(input);
      assert.equal(url.pathname, "/v1/internal/council-results/resolve");
      assert.equal(init.method, "GET");
      assert.equal(init.redirect, "error");
      const requestId = url.searchParams.get("requestId");
      const requestHash = url.searchParams.get("requestHash");
      this.resolves.push({ requestId, requestHash });
      if (this.resolveOverride) {
        return this.resolveOverride({ requestId, requestHash, url, init });
      }
      const receipt = this.receipts.get(requestId);
      if (!receipt) {
        return jsonResponse(404, {
          error: { code: "receipt_not_found", message: "missing" },
        });
      }
      if (receipt.requestHash !== requestHash) {
        return jsonResponse(409, {
          error: { code: "binding_conflict", message: "conflict" },
        });
      }
      if (receipt.state === "started") {
        return jsonResponse(409, {
          error: { code: "request_started", message: "started" },
        });
      }
      if (receipt.state === "failed") {
        return jsonResponse(409, {
          state: "failed",
          error: { code: "request_failed", message: "failed" },
          ...(receipt.proof ? { receipt: receipt.proof } : {}),
        });
      }
      return jsonResponse(200, { state: "completed", result: receipt.result });
    };
  }

  complete(body, mutate = (value) => value) {
    const result = mutate(receiptResult(body));
    this.receipts.set(body.clientRequestId, {
      state: "completed",
      requestHash: body.clientRequestHash,
      result,
    });
    return result;
  }

  fail(body, generation = 1) {
    const current = this.receipts.get(body.clientRequestId);
    const priorAttempts = generation === 2 && current?.proof?.attempts
      ? current.proof.attempts
      : generation === 2
        ? [failedAttempt(body, 1)]
        : [];
    const proof = {
      dispatchGeneration: generation,
      dispatchCount: generation,
      redispatchCount: generation - 1,
      redispatchAllowed: generation === 1,
      failureCode: "council_no_final_answer",
      attempts: [...priorAttempts, failedAttempt(body, generation)],
    };
    this.receipts.set(body.clientRequestId, {
      state: "failed",
      requestHash: body.clientRequestHash,
      proof,
    });
    return proof;
  }
}

function fixtureRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gv-council-receipts-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function runInput(root, fake, overrides = {}) {
  return {
    client: fake.client,
    durableRecoveryDir: root,
    invocationKey: "job-a/visual-flux/author/attempt-1",
    recoveryMetadata: {
      jobId: "job-a",
      opportunityId: "visual-flux",
      phase: "author",
      semanticAttempt: 1,
    },
    request: requestFixture(),
    fetchImpl: fake.fetch,
    requestIdFactory: () => "lrq_fixture_author_0001",
    now: () => NOW,
    ...overrides,
  };
}

async function rejectsState(promise, state) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof GeneratedVisualCouncilReceiptError);
    assert.equal(error.state, state);
    return true;
  });
}

test("stable recovery roots are outside gardens, deterministic, and garden-specific", (t) => {
  const root = fixtureRoot(t);
  const runtimeRoot = path.join(root, "runtime");
  const firstGarden = path.join(root, "gardens", "electromagnetics-1");
  const secondGarden = path.join(root, "gardens", "electromagnetics-2");
  const first = stableGeneratedVisualCouncilRecoveryRoot(
    firstGarden,
    runtimeRoot,
  );
  const repeated = stableGeneratedVisualCouncilRecoveryRoot(
    path.join(firstGarden, "."),
    runtimeRoot,
  );
  const second = stableGeneratedVisualCouncilRecoveryRoot(
    secondGarden,
    runtimeRoot,
  );

  assert.equal(first, repeated);
  assert.notEqual(first, second);
  assert.equal(path.dirname(path.dirname(first)), path.resolve(runtimeRoot));
  assert.ok(
    path.relative(firstGarden, first).startsWith(`..${path.sep}`),
    "the operational receipt root must not be replaced with the garden",
  );
  assert.throws(
    () => stableGeneratedVisualCouncilRecoveryRoot(
      firstGarden,
      path.join(firstGarden, "runtime"),
    ),
    (error) => {
      assert.ok(error instanceof GeneratedVisualCouncilReceiptError);
      assert.equal(error.state, "conflict");
      return true;
    },
  );
});

test("canonical generated-visual request binds actual max tokens, exact model, and max/detailed reasoning", () => {
  const request = requestFixture();
  const prepared = prepareGeneratedVisualCouncilRequest(request);
  assert.equal(request.reasoning, undefined, "preparation must not mutate its caller");
  assert.deepEqual(prepared.request.reasoning, { effort: "max", summary: "detailed" });
  assert.equal(prepared.envelope.maxTokens, 1537);
  assert.equal(prepared.envelope.requestedModel, "gpt-5.6-sol");
  assert.equal(prepared.envelope.resolvedModel, "gpt-5.6-sol");
  assert.equal(prepared.envelope.reasoning.effort, "max");
  assert.equal(prepared.envelope.reasoning.summary, "detailed");
  assert.equal(
    prepared.envelope.messages[0].content,
    "Author exactly one visual with gpt-5.6-sol via chatgpt.",
  );
  assert.equal(
    prepared.requestHash,
    "6468931cf71e6f3a6a15175c61b5f88674735b0ac5cfe1e8ada726268e473fa6",
  );
  assert.notEqual(
    prepareGeneratedVisualCouncilRequest(
      requestFixture({ max_completion_tokens: 1538 }),
    ).requestHash,
    prepared.requestHash,
  );
  for (const forbidden of [
    { clientRequestRedispatch: true },
    { client_request_redispatch: true },
  ]) {
    assert.throws(
      () => prepareGeneratedVisualCouncilRequest(requestFixture(forbidden)),
      /unsupported or conflicting fields/,
    );
  }
});

test("preview image parts are opt-in, preserved exactly, and unknown parts fail closed", () => {
  const imagePart = {
    type: "image_url",
    image_url: { url: "data:image/png;base64,aGVsbG8=", detail: "low" },
  };
  const multimodal = requestFixture({
    taskType: "critique",
    messages: [
      { role: "system", content: "Review the visual." },
      { role: "user", content: [{ type: "text", text: "Evidence" }, imagePart] },
    ],
  });
  assert.throws(
    () => prepareGeneratedVisualCouncilRequest(multimodal),
    /does not permit one or more message parts/,
  );
  const prepared = prepareGeneratedVisualCouncilRequest(multimodal, {
    allowImageUrlParts: true,
  });
  assert.deepEqual(prepared.request.messages[1].content[1], imagePart);
  assert.throws(
    () => prepareGeneratedVisualCouncilRequest(
      requestFixture({
        messages: [{ role: "user", content: [{ type: "input_audio", data: "x" }] }],
      }),
      { allowImageUrlParts: true },
    ),
    /does not permit one or more message parts/,
  );
});

test("an opted-in multimodal critic dispatch preserves its exact preview part", async (t) => {
  const root = fixtureRoot(t);
  const fake = new FakeCouncilBoundary();
  const imagePart = {
    type: "image_url",
    image_url: { url: "data:image/png;base64,aGVsbG8=", detail: "low" },
  };
  await runGeneratedVisualCouncilRequestWithReceipt(
    runInput(root, fake, {
      invocationKey: "job-a/visual-flux/critic/attempt-1",
      recoveryMetadata: { jobId: "job-a", phase: "critic" },
      requestIdFactory: () => "lrq_fixture_critic_0001",
      allowImageUrlParts: true,
      request: requestFixture({
        taskType: "critique",
        messages: [
          { role: "system", content: "Review this exact preview." },
          {
            role: "user",
            content: [{ type: "text", text: "Critic evidence" }, imagePart],
          },
        ],
      }),
    }),
  );
  assert.deepEqual(fake.posts[0].messages[1].content[1], imagePart);
});

test("fresh dispatch is durably bound, receipt-validated, and same invocation recovers without another POST", async (t) => {
  const root = fixtureRoot(t);
  const fake = new FakeCouncilBoundary();
  const input = runInput(root, fake);
  const first = await runGeneratedVisualCouncilRequestWithReceipt(input);
  assert.equal(first.recovered, false);
  assert.equal(first.dispatched, true);
  assert.equal(fake.requestOptions[0].timeout, undefined);
  assert.equal(first.dispatchCount, 1);
  assert.equal(first.httpCompletionObserved, true);
  assert.equal(first.requestId, "lrq_fixture_author_0001");
  assert.equal(first.content, '{"title":"Recovered visual"}');
  assert.deepEqual(first.tokenUsage, {
    inputTokens: 11,
    outputTokens: 7,
    reasoningTokens: 3,
    totalTokens: 18,
  });
  assert.equal(fake.posts.length, 1);
  assert.equal(fake.posts[0].clientRequestId, first.requestId);
  assert.equal(fake.posts[0].clientRequestHash, first.requestHash);
  assert.deepEqual(fake.posts[0].reasoning, { effort: "max", summary: "detailed" });
  assert.equal(fake.posts[0].max_completion_tokens, 1537);

  const directory = generatedVisualCouncilReceiptDirectory(root);
  const names = fs.readdirSync(directory).sort();
  assert.equal(names.filter((name) => name.endsWith(".binding.json")).length, 1);
  assert.equal(names.filter((name) => name.endsWith(".dispatch.json")).length, 1);
  assert.equal(names.filter((name) => name.endsWith(".completed.json")).length, 1);
  assert.equal(names.some((name) => name.endsWith(".tmp")), false);
  const localLedger = names
    .map((name) => fs.readFileSync(path.join(directory, name), "utf8"))
    .join("\n");
  assert.doesNotMatch(localLedger, /Author exactly one visual|Recovered visual/);

  const second = await runGeneratedVisualCouncilRequestWithReceipt(input);
  assert.equal(second.recovered, true);
  assert.equal(second.dispatched, false);
  assert.equal(second.dispatchCount, 0);
  assert.equal(second.httpCompletionObserved, false);
  assert.equal(second.requestId, first.requestId);
  assert.equal(fake.posts.length, 1);
});

test("receipt-aware dispatch binds the SDK timeout to the configured observation budget", async (t) => {
  const root = fixtureRoot(t);
  const fake = new FakeCouncilBoundary();
  const result = await runGeneratedVisualCouncilRequestWithReceipt(
    runInput(root, fake, { startedReceiptObservationTimeoutMs: 1_234 }),
  );

  assert.equal(result.dispatched, true);
  assert.equal(fake.requestOptions.length, 1);
  assert.equal(fake.requestOptions[0].timeout, 1_234);
});

test("a server-completed receipt is recovered during preflight before any local dispatch", async (t) => {
  const root = fixtureRoot(t);
  const fake = new FakeCouncilBoundary();
  const request = requestFixture();
  const prepared = prepareGeneratedVisualCouncilRequest(request);
  const requestId = "lrq_fixture_preflight_0001";
  const body = {
    ...prepared.request,
    clientRequestId: requestId,
    clientRequestHash: prepared.requestHash,
  };
  fake.receipts.set(requestId, {
    state: "completed",
    requestHash: prepared.requestHash,
    result: receiptResult(body),
  });

  const result = await runGeneratedVisualCouncilRequestWithReceipt(
    runInput(root, fake, {
      request,
      requestIdFactory: () => requestId,
    }),
  );

  assert.equal(result.requestId, requestId);
  assert.equal(result.requestHash, prepared.requestHash);
  assert.equal(result.recovered, true);
  assert.equal(result.dispatched, false);
  assert.equal(result.dispatchCount, 0);
  assert.equal(result.httpCompletionObserved, false);
  assert.equal(fake.posts.length, 0);
  assert.equal(fake.resolves.length, 1);
});

test("a later deliberate invocation does not replay a normally completed result", async (t) => {
  const root = fixtureRoot(t);
  const fake = new FakeCouncilBoundary();
  await runGeneratedVisualCouncilRequestWithReceipt(runInput(root, fake));
  const regenerated = await runGeneratedVisualCouncilRequestWithReceipt(
    runInput(root, fake, {
      invocationKey: "job-b/visual-flux/author/attempt-1",
      recoveryMetadata: { jobId: "job-b", phase: "author" },
      requestIdFactory: () => "lrq_fixture_author_0002",
    }),
  );
  assert.equal(regenerated.requestId, "lrq_fixture_author_0002");
  assert.equal(regenerated.recovered, false);
  assert.equal(regenerated.dispatched, true);
  assert.equal(regenerated.dispatchCount, 1);
  assert.equal(regenerated.httpCompletionObserved, true);
  assert.equal(fake.posts.length, 2);
});

test("a completed receipt is recovered when the transport fails after provider completion", async (t) => {
  const root = fixtureRoot(t);
  const fake = new FakeCouncilBoundary();
  fake.createOverride = async (body) => {
    fake.complete(body);
    throw new Error("socket closed after durable completion");
  };
  const result = await runGeneratedVisualCouncilRequestWithReceipt(runInput(root, fake));
  assert.equal(result.recovered, true);
  assert.equal(result.dispatched, true);
  assert.equal(result.dispatchCount, 1);
  assert.equal(result.httpCompletionObserved, false);
  assert.equal(fake.posts.length, 1);
  await runGeneratedVisualCouncilRequestWithReceipt(runInput(root, fake));
  assert.equal(fake.posts.length, 1);
});

test("a started receipt is observed to durable completion after a transport timeout without another POST", async (t) => {
  const root = fixtureRoot(t);
  const fake = new FakeCouncilBoundary();
  fake.createOverride = async (body) => {
    fake.receipts.set(body.clientRequestId, {
      state: "started",
      requestHash: body.clientRequestHash,
    });
    setTimeout(() => fake.complete(body), 10);
    throw new Error("SDK transport timed out while the provider kept running");
  };

  const result = await runGeneratedVisualCouncilRequestWithReceipt(
    runInput(root, fake, { startedReceiptObservationTimeoutMs: 100 }),
  );

  assert.equal(result.recovered, true);
  assert.equal(result.dispatched, true);
  assert.equal(result.dispatchCount, 1);
  assert.equal(result.httpCompletionObserved, false);
  assert.equal(fake.posts.length, 1);
  assert.ok(fake.resolves.length >= 3);

  await runGeneratedVisualCouncilRequestWithReceipt(
    runInput(root, fake, { startedReceiptObservationTimeoutMs: 100 }),
  );
  assert.equal(fake.posts.length, 1);
});

test("started-receipt observation is abort-aware and never duplicates the request", async (t) => {
  const root = fixtureRoot(t);
  const fake = new FakeCouncilBoundary();
  const controller = new AbortController();
  const abortReason = new Error("outer generated-visual deadline reached");
  fake.createOverride = async (body) => {
    fake.receipts.set(body.clientRequestId, {
      state: "started",
      requestHash: body.clientRequestHash,
    });
    setTimeout(() => controller.abort(abortReason), 10);
    throw new Error("SDK transport timed out while the provider kept running");
  };

  await assert.rejects(
    runGeneratedVisualCouncilRequestWithReceipt(
      runInput(root, fake, {
        signal: controller.signal,
        startedReceiptObservationTimeoutMs: 1_000,
      }),
    ),
    (error) => error === abortReason,
  );
  assert.equal(fake.posts.length, 1);
});

test("an abort fences a provider that settles late and a fresh invocation recovers without a duplicate", async (t) => {
  const root = fixtureRoot(t);
  const fake = new FakeCouncilBoundary();
  const controller = new AbortController();
  const abortReason = new Error("generated-visual fixture externally aborted");
  const accounting = [];
  let releaseProvider;
  let announceProviderStarted;
  const providerGate = new Promise((resolve) => {
    releaseProvider = resolve;
  });
  const providerStarted = new Promise((resolve) => {
    announceProviderStarted = resolve;
  });
  fake.createOverride = async (body) => {
    announceProviderStarted();
    await providerGate;
    const result = fake.complete(body);
    return httpCompletion(result);
  };

  const lateContinuation = runGeneratedVisualCouncilRequestWithReceipt(
    runInput(root, fake, { signal: controller.signal }),
  ).then((receipt) => {
    accounting.push(receipt);
    return receipt;
  });
  await providerStarted;
  controller.abort(abortReason);
  releaseProvider();
  await assert.rejects(lateContinuation, (error) => error === abortReason);

  const receiptDirectory = generatedVisualCouncilReceiptDirectory(root);
  const namesAfterLateSettlement = fs.readdirSync(receiptDirectory).sort();
  assert.equal(
    namesAfterLateSettlement.filter((name) => name.endsWith(".binding.json")).length,
    1,
  );
  assert.equal(
    namesAfterLateSettlement.filter((name) => name.endsWith(".dispatch.json")).length,
    1,
  );
  for (const suffix of ["response", "completed", "failed", "redispatch"]) {
    assert.equal(
      namesAfterLateSettlement.some((name) => name.endsWith(`.${suffix}.json`)),
      false,
      `${suffix} evidence must not be written by an aborted continuation`,
    );
  }
  assert.deepEqual(accounting, []);
  assert.equal(fake.posts.length, 1);

  fake.createOverride = null;
  const recovered = await runGeneratedVisualCouncilRequestWithReceipt(
    runInput(root, fake),
  );
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.dispatched, false);
  assert.equal(recovered.dispatchCount, 0);
  assert.equal(recovered.httpCompletionObserved, false);
  assert.equal(fake.posts.length, 1, "recovery must not duplicate the provider call");
  assert.equal(
    fs.readdirSync(receiptDirectory).filter((name) =>
      name.endsWith(".completed.json")).length,
    1,
  );
});

test("an observed HTTP completion consumes redispatch authority even when resolve reports not_found", async (t) => {
  const root = fixtureRoot(t);
  const fake = new FakeCouncilBoundary();
  fake.createOverride = async (body) => httpCompletion(receiptResult(body));
  const input = runInput(root, fake);
  await rejectsState(runGeneratedVisualCouncilRequestWithReceipt(input), "conflict");
  assert.equal(fake.posts.length, 1);
  await rejectsState(runGeneratedVisualCouncilRequestWithReceipt(input), "conflict");
  assert.equal(fake.posts.length, 1);
  const names = fs.readdirSync(generatedVisualCouncilReceiptDirectory(root));
  assert.equal(names.filter((name) => name.endsWith(".response.json")).length, 1);
  assert.equal(names.filter((name) => name.endsWith(".redispatch.json")).length, 0);
});

test("a malformed resolved HTTP completion is sticky corrupt and never redispatched", async (t) => {
  const root = fixtureRoot(t);
  const fake = new FakeCouncilBoundary();
  fake.createOverride = async () => ({});
  const input = runInput(root, fake);
  await rejectsState(runGeneratedVisualCouncilRequestWithReceipt(input), "corrupt");
  assert.equal(fake.posts.length, 1);
  fake.resolveOverride = async () => jsonResponse(409, {
    error: { code: "request_failed", message: "contradictory failure" },
  });
  await rejectsState(runGeneratedVisualCouncilRequestWithReceipt(input), "corrupt");
  assert.equal(fake.posts.length, 1);
  const names = fs.readdirSync(generatedVisualCouncilReceiptDirectory(root));
  assert.equal(names.filter((name) => name.endsWith(".failed.json")).length, 0);
});

test("a malformed HTTP body can self-heal from its exact independently validated receipt", async (t) => {
  const root = fixtureRoot(t);
  const fake = new FakeCouncilBoundary();
  fake.createOverride = async (body) => {
    fake.complete(body);
    return {};
  };
  const result = await runGeneratedVisualCouncilRequestWithReceipt(runInput(root, fake));
  assert.equal(result.recovered, true);
  assert.equal(result.dispatched, true);
  assert.equal(result.dispatchCount, 1);
  assert.equal(result.httpCompletionObserved, false);
  assert.equal(fake.posts.length, 1);
});

test("receipt_not_found authorizes exactly one same-id redispatch and then recovers", async (t) => {
  const root = fixtureRoot(t);
  const fake = new FakeCouncilBoundary();
  fake.createOverride = async (body) => {
    if (fake.posts.length === 1) throw new Error("request stopped in checkpoint gap");
    const result = fake.complete(body);
    return httpCompletion(result);
  };
  const result = await runGeneratedVisualCouncilRequestWithReceipt(runInput(root, fake));
  assert.equal(result.recovered, true);
  assert.equal(result.dispatched, true);
  assert.equal(result.dispatchCount, 2);
  assert.equal(result.httpCompletionObserved, true);
  assert.equal(fake.posts.length, 2);
  assert.equal(fake.posts[0].clientRequestId, fake.posts[1].clientRequestId);
  assert.equal(fake.posts[0].clientRequestHash, fake.posts[1].clientRequestHash);
  const names = fs.readdirSync(generatedVisualCouncilReceiptDirectory(root));
  assert.equal(names.filter((name) => name.endsWith(".redispatch.json")).length, 1);
});

test("an exact generation-one failed receipt authorizes one explicit same-id redispatch", async (t) => {
  const root = fixtureRoot(t);
  const fake = new FakeCouncilBoundary();
  let failedProof;
  fake.createOverride = async (body) => {
    if (fake.posts.length === 1) {
      failedProof = fake.fail(body, 1);
      throw new Error("HTTP 502 from the first exact provider dispatch");
    }
    assert.equal(body.clientRequestRedispatch, true);
    const result = fake.complete(body);
    return httpCompletion(result);
  };

  const result = await runGeneratedVisualCouncilRequestWithReceipt(
    runInput(root, fake),
  );

  assert.equal(result.recovered, true);
  assert.equal(result.dispatched, true);
  assert.equal(result.dispatchCount, 2);
  assert.equal(result.httpCompletionObserved, true);
  assert.equal(fake.posts.length, 2);
  assert.equal(failedProof.attempts[0].usageEstimated, true);
  assert.equal(failedProof.attempts[0].usage.reportedCallCount, 0);
  assert.equal(Object.hasOwn(fake.posts[0], "clientRequestRedispatch"), false);
  assert.equal(fake.posts[1].clientRequestRedispatch, true);
  assert.equal(fake.posts[0].clientRequestId, fake.posts[1].clientRequestId);
  assert.equal(fake.posts[0].clientRequestHash, fake.posts[1].clientRequestHash);

  const directory = generatedVisualCouncilReceiptDirectory(root);
  const redispatchName = fs.readdirSync(directory).find((name) =>
    name.endsWith(".redispatch.json"));
  assert.ok(redispatchName);
  const marker = JSON.parse(
    fs.readFileSync(path.join(directory, redispatchName), "utf8"),
  );
  assert.equal(marker.redispatchReason, "request_failed");
  assert.equal(marker.failureCode, "council_no_final_answer");
  assert.equal(marker.receiptDispatchGeneration, 1);
  assert.equal(marker.receiptDispatchCount, 1);
  assert.equal(marker.receiptRedispatchCount, 0);
  assert.equal(marker.receiptRedispatchAllowed, true);
  assert.match(marker.receiptProofHash, /^[0-9a-f]{64}$/);
  assert.equal(
    fs.readdirSync(directory).filter((name) => name.endsWith(".failed.json")).length,
    0,
  );
});

test("abort after failed-receipt resolution fences the recovery claim and provider redispatch", async (t) => {
  const root = fixtureRoot(t);
  const fake = new FakeCouncilBoundary();
  const controller = new AbortController();
  const abortReason = new Error("abort before exact failed-receipt recovery");
  fake.createOverride = async (body) => {
    if (fake.posts.length === 1) {
      fake.fail(body, 1);
      throw new Error("HTTP 502 before failed-receipt resolution");
    }
    const result = fake.complete(body);
    return httpCompletion(result);
  };
  fake.resolveOverride = async ({ requestId, requestHash }) => {
    if (fake.resolves.length === 1) {
      return jsonResponse(404, {
        error: { code: "receipt_not_found", message: "missing" },
      });
    }
    const receipt = fake.receipts.get(requestId);
    assert.equal(receipt.requestHash, requestHash);
    controller.abort(abortReason);
    return jsonResponse(409, {
      state: "failed",
      error: { code: "request_failed", message: "failed" },
      receipt: receipt.proof,
    });
  };

  await assert.rejects(
    runGeneratedVisualCouncilRequestWithReceipt(
      runInput(root, fake, { signal: controller.signal }),
    ),
    (error) => error === abortReason,
  );
  assert.equal(fake.posts.length, 1);
  let names = fs.readdirSync(generatedVisualCouncilReceiptDirectory(root));
  assert.equal(names.filter((name) => name.endsWith(".redispatch.json")).length, 0);

  fake.resolveOverride = null;
  const recovered = await runGeneratedVisualCouncilRequestWithReceipt(
    runInput(root, fake),
  );
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.dispatchCount, 1);
  assert.equal(fake.posts.length, 2);
  assert.equal(fake.posts[1].clientRequestRedispatch, true);
  names = fs.readdirSync(generatedVisualCouncilReceiptDirectory(root));
  assert.equal(names.filter((name) => name.endsWith(".redispatch.json")).length, 1);
});

test("re-entry resumes a failed-receipt claim when crash happened before ChatMock observed its POST", async (t) => {
  const root = fixtureRoot(t);
  const fake = new FakeCouncilBoundary();
  const controller = new AbortController();
  const crashReason = new Error("lease died after failed-receipt claim");
  let clockReads = 0;
  const crashAfterRedispatchClaim = () => {
    clockReads += 1;
    if (clockReads === 3) controller.abort(crashReason);
    return NOW;
  };
  fake.createOverride = async (body) => {
    if (fake.posts.length === 1) {
      fake.fail(body, 1);
      throw new Error("HTTP 502 before local failed-receipt claim");
    }
    assert.equal(body.clientRequestRedispatch, true);
    const result = fake.complete(body);
    return httpCompletion(result);
  };

  await assert.rejects(
    runGeneratedVisualCouncilRequestWithReceipt(
      runInput(root, fake, {
        signal: controller.signal,
        now: crashAfterRedispatchClaim,
      }),
    ),
    (error) => error === crashReason,
  );
  assert.equal(fake.posts.length, 1);
  let names = fs.readdirSync(generatedVisualCouncilReceiptDirectory(root));
  assert.equal(names.filter((name) => name.endsWith(".redispatch.json")).length, 1);
  assert.equal(names.filter((name) => name.endsWith(".completed.json")).length, 0);

  const recovered = await runGeneratedVisualCouncilRequestWithReceipt(
    runInput(root, fake),
  );
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.dispatchCount, 1);
  assert.equal(recovered.httpCompletionObserved, true);
  assert.equal(fake.posts.length, 2);
  assert.equal(fake.posts[1].clientRequestRedispatch, true);
  names = fs.readdirSync(generatedVisualCouncilReceiptDirectory(root));
  assert.equal(names.filter((name) => name.endsWith(".redispatch.json")).length, 1);
  assert.equal(names.filter((name) => name.endsWith(".completed.json")).length, 1);
});

test("re-entry resumes a receipt-not-found claim when crash happened before ChatMock observed its POST", async (t) => {
  const root = fixtureRoot(t);
  const fake = new FakeCouncilBoundary();
  const controller = new AbortController();
  const crashReason = new Error("lease died after receipt-not-found claim");
  let clockReads = 0;
  const crashAfterRedispatchClaim = () => {
    clockReads += 1;
    if (clockReads === 3) controller.abort(crashReason);
    return NOW;
  };
  fake.createOverride = async (body) => {
    if (fake.posts.length === 1) {
      throw new Error("transport stopped before ChatMock receipt reservation");
    }
    assert.equal(Object.hasOwn(body, "clientRequestRedispatch"), false);
    const result = fake.complete(body);
    return httpCompletion(result);
  };

  await assert.rejects(
    runGeneratedVisualCouncilRequestWithReceipt(
      runInput(root, fake, {
        signal: controller.signal,
        now: crashAfterRedispatchClaim,
      }),
    ),
    (error) => error === crashReason,
  );
  assert.equal(fake.posts.length, 1);
  let names = fs.readdirSync(generatedVisualCouncilReceiptDirectory(root));
  assert.equal(names.filter((name) => name.endsWith(".redispatch.json")).length, 1);

  const recovered = await runGeneratedVisualCouncilRequestWithReceipt(
    runInput(root, fake),
  );
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.dispatchCount, 1);
  assert.equal(recovered.httpCompletionObserved, true);
  assert.equal(fake.posts.length, 2);
  assert.equal(Object.hasOwn(fake.posts[1], "clientRequestRedispatch"), false);
  names = fs.readdirSync(generatedVisualCouncilReceiptDirectory(root));
  assert.equal(names.filter((name) => name.endsWith(".redispatch.json")).length, 1);
  assert.equal(names.filter((name) => name.endsWith(".completed.json")).length, 1);
});

test("a claimed failed-receipt recovery never resumes from a mismatched server proof", async (t) => {
  const root = fixtureRoot(t);
  const fake = new FakeCouncilBoundary();
  const controller = new AbortController();
  const crashReason = new Error("crash after local failed-receipt claim");
  let clockReads = 0;
  fake.createOverride = async (body) => {
    fake.fail(body, 1);
    throw new Error("first provider dispatch failed");
  };

  await assert.rejects(
    runGeneratedVisualCouncilRequestWithReceipt(
      runInput(root, fake, {
        signal: controller.signal,
        now: () => {
          clockReads += 1;
          if (clockReads === 3) controller.abort(crashReason);
          return NOW;
        },
      }),
    ),
    (error) => error === crashReason,
  );
  assert.equal(fake.posts.length, 1);
  const requestId = fake.posts[0].clientRequestId;
  fake.receipts.get(requestId).proof.attempts[0].councilRunId =
    "crun_generated_visual_failed_conflicting";

  await rejectsState(
    runGeneratedVisualCouncilRequestWithReceipt(runInput(root, fake)),
    "conflict",
  );
  assert.equal(fake.posts.length, 1);
});

test("a claimed failed-receipt recovery never resumes after server generation two started", async (t) => {
  const root = fixtureRoot(t);
  const fake = new FakeCouncilBoundary();
  const controller = new AbortController();
  const crashReason = new Error("crash after local failed-receipt claim");
  let clockReads = 0;
  fake.createOverride = async (body) => {
    fake.fail(body, 1);
    throw new Error("first provider dispatch failed");
  };

  await assert.rejects(
    runGeneratedVisualCouncilRequestWithReceipt(
      runInput(root, fake, {
        signal: controller.signal,
        now: () => {
          clockReads += 1;
          if (clockReads === 3) controller.abort(crashReason);
          return NOW;
        },
      }),
    ),
    (error) => error === crashReason,
  );
  assert.equal(fake.posts.length, 1);
  const requestId = fake.posts[0].clientRequestId;
  fake.receipts.get(requestId).state = "started";

  await rejectsState(
    runGeneratedVisualCouncilRequestWithReceipt(runInput(root, fake)),
    "started",
  );
  assert.equal(fake.posts.length, 1);
});

test("a second exact failed receipt is terminal and can never cause a third dispatch", async (t) => {
  const root = fixtureRoot(t);
  const fake = new FakeCouncilBoundary();
  fake.createOverride = async (body) => {
    fake.fail(body, fake.posts.length === 1 ? 1 : 2);
    throw new Error(`HTTP 502 from provider dispatch ${fake.posts.length}`);
  };
  const input = runInput(root, fake);

  await rejectsState(runGeneratedVisualCouncilRequestWithReceipt(input), "failed");
  assert.equal(fake.posts.length, 2);
  assert.equal(fake.posts[1].clientRequestRedispatch, true);
  await rejectsState(runGeneratedVisualCouncilRequestWithReceipt(input), "failed");
  assert.equal(fake.posts.length, 2);

  const directory = generatedVisualCouncilReceiptDirectory(root);
  const names = fs.readdirSync(directory);
  assert.equal(names.filter((name) => name.endsWith(".redispatch.json")).length, 1);
  assert.equal(names.filter((name) => name.endsWith(".failed.json")).length, 1);
  const failureName = names.find((name) => name.endsWith(".failed.json"));
  const failure = JSON.parse(
    fs.readFileSync(path.join(directory, failureName), "utf8"),
  );
  assert.equal(failure.failureCode, "council_no_final_answer");
});

test("a generation-one failure with server authority already consumed is terminal", async (t) => {
  const root = fixtureRoot(t);
  const fake = new FakeCouncilBoundary();
  fake.createOverride = async (body) => {
    const proof = fake.fail(body, 1);
    proof.redispatchAllowed = false;
    throw new Error("server claim exists but generation advance was interrupted");
  };
  const input = runInput(root, fake);

  await rejectsState(runGeneratedVisualCouncilRequestWithReceipt(input), "failed");
  assert.equal(fake.posts.length, 1);
  await rejectsState(runGeneratedVisualCouncilRequestWithReceipt(input), "failed");
  assert.equal(fake.posts.length, 1);
  const names = fs.readdirSync(generatedVisualCouncilReceiptDirectory(root));
  assert.equal(names.filter((name) => name.endsWith(".redispatch.json")).length, 0);
  assert.equal(names.filter((name) => name.endsWith(".failed.json")).length, 1);
});

test("failed-receipt metadata must be exact before a 502 can authorize redispatch", async (t) => {
  const root = fixtureRoot(t);
  const fake = new FakeCouncilBoundary();
  fake.createOverride = async () => {
    throw new Error("generic HTTP 502");
  };
  fake.resolveOverride = async () => fake.resolves.length === 1
    ? jsonResponse(404, {
        error: { code: "receipt_not_found", message: "missing" },
      })
    : jsonResponse(409, {
        state: "failed",
        error: { code: "request_failed", message: "failed" },
        receipt: {
          dispatchGeneration: 2,
          dispatchCount: 2,
          redispatchCount: 0,
          redispatchAllowed: true,
          failureCode: "council_no_final_answer",
          attempts: [],
        },
      });

  await rejectsState(
    runGeneratedVisualCouncilRequestWithReceipt(runInput(root, fake)),
    "corrupt",
  );
  assert.equal(fake.posts.length, 1);
  const names = fs.readdirSync(generatedVisualCouncilReceiptDirectory(root));
  assert.equal(names.filter((name) => name.endsWith(".redispatch.json")).length, 0);
});

test("an unobservable resolver after a 502 is terminal and never guessed into a redispatch", async (t) => {
  const root = fixtureRoot(t);
  const fake = new FakeCouncilBoundary();
  fake.createOverride = async () => {
    throw new Error("generic HTTP 502");
  };
  fake.resolveOverride = async () => {
    if (fake.resolves.length === 1) {
      return jsonResponse(404, {
        error: { code: "receipt_not_found", message: "missing" },
      });
    }
    throw new Error("resolver unavailable");
  };

  await rejectsState(
    runGeneratedVisualCouncilRequestWithReceipt(runInput(root, fake)),
    "started",
  );
  assert.equal(fake.posts.length, 1);
  const names = fs.readdirSync(generatedVisualCouncilReceiptDirectory(root));
  assert.equal(names.filter((name) => name.endsWith(".redispatch.json")).length, 0);
});

test("same-id redispatch recovered only from its receipt reports two calls and no HTTP completion", async (t) => {
  const root = fixtureRoot(t);
  const fake = new FakeCouncilBoundary();
  fake.createOverride = async (body) => {
    if (fake.posts.length === 1) throw new Error("first checkpoint gap");
    fake.complete(body);
    throw new Error("redispatch response transport closed");
  };
  const result = await runGeneratedVisualCouncilRequestWithReceipt(runInput(root, fake));
  assert.equal(result.recovered, true);
  assert.equal(result.dispatched, true);
  assert.equal(result.dispatchCount, 2);
  assert.equal(result.httpCompletionObserved, false);
  assert.equal(fake.posts.length, 2);
});

test("an absent receipt after a claimed redispatch resumes at most once per helper entry", async (t) => {
  const root = fixtureRoot(t);
  const fake = new FakeCouncilBoundary();
  fake.createOverride = async () => {
    throw new Error("transport stopped before ChatMock receipt");
  };
  const input = runInput(root, fake);
  await rejectsState(runGeneratedVisualCouncilRequestWithReceipt(input), "not_found");
  assert.equal(fake.posts.length, 2);
  await rejectsState(runGeneratedVisualCouncilRequestWithReceipt(input), "not_found");
  assert.equal(fake.posts.length, 3);
  await rejectsState(
    runGeneratedVisualCouncilRequestWithReceipt(
      runInput(root, fake, {
        invocationKey: "job-b/visual-flux/author/attempt-1",
        requestIdFactory: () => "lrq_fixture_author_0002",
      }),
    ),
    "not_found",
  );
  assert.equal(fake.posts.length, 4);
});

test("started, failed, conflict, and corrupt resolver states never dispatch", async (t) => {
  const cases = [
    [409, "request_started", "started"],
    [409, "request_failed", "failed"],
    [409, "binding_conflict", "conflict"],
    [409, "receipt_corrupt", "corrupt"],
    [500, "receipt_read_failed", "corrupt"],
  ];
  for (const [status, code, state] of cases) {
    const root = fixtureRoot(t);
    const fake = new FakeCouncilBoundary();
    fake.resolveOverride = async () => jsonResponse(status, {
      error: { code, message: code },
    });
    await rejectsState(
      runGeneratedVisualCouncilRequestWithReceipt(
        runInput(root, fake, {
          invocationKey: `job-${code}/visual/author/attempt-1`,
          requestIdFactory: () => `lrq_fixture_${code}_0001`,
        }),
      ),
      state,
    );
    assert.equal(fake.posts.length, 0, code);
  }
});

test("completed receipts with invalid model, routing, response hash, or usage fail corrupt before dispatch", async (t) => {
  const mutations = [
    (result) => ({ ...result, requestedModel: "gpt-wrong" }),
    (result) => ({
      ...result,
      modelRouting: [{ ...result.modelRouting[0], fallback: true }],
    }),
    (result) => ({ ...result, responseHash: "f".repeat(64) }),
    (result) => ({
      ...result,
      usage: { ...result.usage, reportedCallCount: 0 },
    }),
    (result) => ({ ...result, usageEstimated: true }),
  ];
  for (const [index, mutate] of mutations.entries()) {
    const root = fixtureRoot(t);
    const fake = new FakeCouncilBoundary();
    fake.resolveOverride = async ({ requestId, requestHash }) => {
      const body = {
        ...requestFixture(),
        clientRequestId: requestId,
        clientRequestHash: requestHash,
      };
      return jsonResponse(200, {
        state: "completed",
        result: mutate(receiptResult(body)),
      });
    };
    await rejectsState(
      runGeneratedVisualCouncilRequestWithReceipt(
        runInput(root, fake, {
          invocationKey: `job-invalid-${index}/visual/author/attempt-1`,
          requestIdFactory: () => `lrq_fixture_invalid_${index}_0001`,
        }),
      ),
      "corrupt",
    );
    assert.equal(fake.posts.length, 0);
  }
});

test("one invocation key cannot drift to a different canonical request", async (t) => {
  const root = fixtureRoot(t);
  const fake = new FakeCouncilBoundary();
  fake.createOverride = async () => {
    throw new Error("no receipt");
  };
  const input = runInput(root, fake);
  await rejectsState(runGeneratedVisualCouncilRequestWithReceipt(input), "not_found");
  assert.equal(fake.posts.length, 2);
  await rejectsState(
    runGeneratedVisualCouncilRequestWithReceipt({
      ...input,
      request: requestFixture({ max_completion_tokens: 1538 }),
    }),
    "conflict",
  );
  assert.equal(fake.posts.length, 2);
});

test("an exact ambiguous prior invocation is adopted, while unrelated completed calls are ignored", async (t) => {
  const root = fixtureRoot(t);
  const fake = new FakeCouncilBoundary();
  fake.createOverride = async () => {
    throw new Error("no observable receipt yet");
  };
  await rejectsState(
    runGeneratedVisualCouncilRequestWithReceipt(runInput(root, fake)),
    "not_found",
  );
  assert.equal(fake.posts.length, 2);
  const originalBody = fake.posts[0];
  fake.complete(originalBody);
  fake.createOverride = null;

  const adopted = await runGeneratedVisualCouncilRequestWithReceipt(
    runInput(root, fake, {
      invocationKey: "job-recovery/visual-flux/author/attempt-1",
      recoveryMetadata: { jobId: "job-recovery", phase: "author" },
      requestIdFactory: () => "lrq_fixture_author_adopted",
    }),
  );
  assert.equal(adopted.recovered, true);
  assert.equal(adopted.dispatched, false);
  assert.equal(adopted.dispatchCount, 0);
  assert.equal(adopted.httpCompletionObserved, false);
  assert.equal(adopted.requestId, originalBody.clientRequestId);
  assert.equal(fake.posts.length, 2);

  const deliberate = await runGeneratedVisualCouncilRequestWithReceipt(
    runInput(root, fake, {
      invocationKey: "job-deliberate/visual-flux/author/attempt-1",
      recoveryMetadata: { jobId: "job-deliberate", phase: "author" },
      requestIdFactory: () => "lrq_fixture_author_0003",
    }),
  );
  assert.equal(deliberate.requestId, "lrq_fixture_author_0003");
  assert.equal(deliberate.recovered, false);
  assert.equal(deliberate.dispatched, true);
  assert.equal(deliberate.dispatchCount, 1);
  assert.equal(deliberate.httpCompletionObserved, true);
  assert.equal(fake.posts.length, 3);
});

test("live immutable receipts union into incoming staging without copying prompt-like files", async (t) => {
  const liveRoot = fixtureRoot(t);
  const incomingRoot = fixtureRoot(t);
  const fake = new FakeCouncilBoundary();
  const original = await runGeneratedVisualCouncilRequestWithReceipt(
    runInput(liveRoot, fake),
  );
  const liveDirectory = generatedVisualCouncilReceiptDirectory(liveRoot);
  fs.writeFileSync(
    path.join(liveDirectory, "prompt-and-image.json"),
    JSON.stringify({ prompt: "must not copy", image_url: "data:image/png;base64,eA==" }),
  );

  await rejectsState(
    Promise.resolve().then(() => mergeGeneratedVisualCouncilReceiptDirectory({
      liveGardenDir: liveRoot,
      incomingGardenDir: incomingRoot,
      sourceQuiescenceHeld: () => false,
    })),
    "started",
  );

  const first = mergeGeneratedVisualCouncilReceiptDirectory({
    liveGardenDir: liveRoot,
    incomingGardenDir: incomingRoot,
    sourceQuiescenceHeld: () => true,
  });
  assert.deepEqual(first, { copiedFiles: 4, identicalFiles: 0 });
  const incomingDirectory = generatedVisualCouncilReceiptDirectory(incomingRoot);
  const sourceNames = fs.readdirSync(liveDirectory).filter((name) =>
    /\.(?:binding|dispatch|redispatch|response|completed|failed)\.json$/.test(name));
  const incomingNames = fs.readdirSync(incomingDirectory).sort();
  assert.equal(incomingNames.includes("prompt-and-image.json"), false);
  assert.deepEqual(incomingNames, sourceNames.sort());
  for (const name of incomingNames) {
    assert.deepEqual(
      fs.readFileSync(path.join(incomingDirectory, name)),
      fs.readFileSync(path.join(liveDirectory, name)),
    );
  }
  const second = mergeGeneratedVisualCouncilReceiptDirectory({
    liveGardenDir: liveRoot,
    incomingGardenDir: incomingRoot,
    sourceQuiescenceHeld: () => true,
  });
  assert.deepEqual(second, { copiedFiles: 0, identicalFiles: 4 });

  const recovered = await runGeneratedVisualCouncilRequestWithReceipt(
    runInput(incomingRoot, fake),
  );
  assert.equal(recovered.requestId, original.requestId);
  assert.equal(recovered.dispatchCount, 0);
  assert.equal(recovered.httpCompletionObserved, false);
  assert.equal(fake.posts.length, 1);
});

test("receipt union fails closed on a valid byte conflict or orphaned marker", async (t) => {
  const liveRoot = fixtureRoot(t);
  const incomingRoot = fixtureRoot(t);
  const fake = new FakeCouncilBoundary();
  await runGeneratedVisualCouncilRequestWithReceipt(runInput(liveRoot, fake));
  mergeGeneratedVisualCouncilReceiptDirectory({
    liveGardenDir: liveRoot,
    incomingGardenDir: incomingRoot,
    sourceQuiescenceHeld: () => true,
  });
  const incomingDirectory = generatedVisualCouncilReceiptDirectory(incomingRoot);
  const bindingName = fs.readdirSync(incomingDirectory).find((name) =>
    name.endsWith(".binding.json"));
  const bindingPath = path.join(incomingDirectory, bindingName);
  const changed = JSON.parse(fs.readFileSync(bindingPath, "utf8"));
  changed.createdAt = "2031-04-05T06:07:09.000Z";
  delete changed.integrityHash;
  changed.integrityHash = sha256(canonicalCouncilJsonV1(changed));
  fs.writeFileSync(bindingPath, `${JSON.stringify(changed)}\n`, "utf8");
  await rejectsState(
    Promise.resolve().then(() => mergeGeneratedVisualCouncilReceiptDirectory({
      liveGardenDir: liveRoot,
      incomingGardenDir: incomingRoot,
      sourceQuiescenceHeld: () => true,
    })),
    "conflict",
  );

  const orphanLive = fixtureRoot(t);
  const orphanIncoming = fixtureRoot(t);
  const orphanDirectory = generatedVisualCouncilReceiptDirectory(orphanLive);
  fs.mkdirSync(orphanDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(orphanDirectory, `${"a".repeat(64)}.${"b".repeat(64)}.dispatch.json`),
    "{}\n",
    "utf8",
  );
  await rejectsState(
    Promise.resolve().then(() => mergeGeneratedVisualCouncilReceiptDirectory({
      liveGardenDir: orphanLive,
      incomingGardenDir: orphanIncoming,
      sourceQuiescenceHeld: () => true,
    })),
    "corrupt",
  );
});
