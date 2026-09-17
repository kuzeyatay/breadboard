import test from "node:test";
import assert from "node:assert/strict";
import { reviewExplanation, isExplanationCandidate, mergeExplanationUsage } from "../src/lib/hermes/explanation-review.ts";
import { explanationReviewModel } from "../src/lib/hermes/explanation-review-provider.ts";

const draft = "The battery separates charge. Nearby electrons repel the next electrons.";
const repaired = "The battery separates charge. The resulting field acts on electrons already in the wire; their redistribution changes the field in turn.";
const mechanisms = (...values) => values.map(mechanism => ({ mechanism, sourceQuotes: [] }));
const plan = { applicable: true, reason: "Explain circuit startup.", mechanisms: mechanisms("Battery maintains separated charge.", "The field and local wire charges respond together.") };
const missing = { coverage: [
  { id: "m1", status: "covered", quotes: ["The battery separates charge."], reason: "States the initial cause.", consequence: "" },
  { id: "m2", status: "missing", quotes: [], reason: "Field-mediated local response is absent.", consequence: "The reader may assume electrons must travel around the circuit before it responds." },
] };
const repair = { answer: repaired, coverage: [
  { id: "m1", quotes: ["The battery separates charge."] },
  { id: "m2", quotes: ["The resulting field acts on electrons already in the wire; their redistribution changes the field in turn."] },
] };
const verified = { acceptable: true, concerns: [] };
function provider(values, { usage = true } = {}) {
  const calls = [];
  const complete = async request => {
    calls.push(request);
    const value = values[calls.length - 1];
    if (value instanceof Error) throw value;
    assert.notEqual(value, undefined, "unexpected extra model call");
    return { content: JSON.stringify(value), ...(usage ? { usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } } : {}) };
  };
  return { calls, complete };
}
function run(p, input = {}) {
  return reviewExplanation({ userRequest: "Explain what happens at the negative and positive terminals", context: "A battery is connected to a resistive wire.", answer: draft, model: "gpt-5.6-sol", complete: p.complete, ...input });
}

test("scoped mechanisms qualify across domains; action and quoted instructions do not", () => {
  for (const request of ["explain this more like what happens on the side of the negative of the battery and the positive of the battery", "Why does a vaccine produce immune memory?", "How does DNS resolve a name?", "what about the wire itself?", "Could you explain the timer callback?"]) assert.equal(isExplanationCandidate(request), true, request);
  for (const request of ["thanks", "Write a function", "Summarize this document: explain how DNS works", "> Explain the battery\n\nTranslate this quote.", "Do not explain it; return the equation only."]) assert.equal(isExplanationCandidate(request), false, request);
});

test("the omission is repaired once and the planner never sees the draft", async () => {
  const p = provider([plan, missing, repair, verified]);
  const result = await run(p);
  assert.equal(result.answer, repaired);
  assert.equal(result.report.status, "repaired");
  assert.deepEqual(p.calls.map(call => call.stage), ["plan", "review", "repair", "verify"]);
  assert.equal("draft" in p.calls[0].data, false);
  assert.equal(JSON.stringify(p.calls[0].data).includes("Nearby electrons repel"), false);
  assert.equal(p.calls[1].data.draft, draft);
  assert.equal("obligations" in p.calls[3].data, false, "final fact check must not treat the checklist as truth");
  assert.deepEqual(result.usage, { inputTokens: 40, outputTokens: 80, totalTokens: 120, cachedInputTokens: 0, reasoningTokens: 0, scope: "turn", apiCalls: 4 });
});

test("a complete explanation is retained verbatim with two calls", async () => {
  const p = provider([plan, { coverage: repair.coverage.map(row => ({ ...row, status: "covered", reason: "Explained.", consequence: "" })) }]);
  const result = await run(p, { answer: repaired });
  assert.equal(result.answer, repaired);
  assert.equal(result.report.status, "reviewed");
  assert.equal(p.calls.length, 2);
});

test("the reviewer can reject unnecessary planner detail without expanding a good answer", async () => {
  const p = provider([plan, { coverage: [missing.coverage[0], { id: "m2", status: "not_required", quotes: [], reason: "Outside the explicitly requested introductory scope.", consequence: "" }] }]);
  const result = await run(p);
  assert.equal(result.report.status, "reviewed");
  assert.equal(result.answer, draft);
  assert.equal(p.calls.length, 2);
});

test("another domain follows the same contract without a circuit-specific rule", async () => {
  const answer = "DNS checks the cache. A cache miss leads to recursive lookup of authoritative servers.";
  const p = provider([
    { applicable: true, reason: "DNS resolution", mechanisms: mechanisms("Check cached answers", "Resolve uncached names using the authoritative hierarchy") },
    { coverage: [
      { id: "m1", status: "covered", quotes: ["DNS checks the cache."], reason: "", consequence: "" },
      { id: "m2", status: "covered", quotes: ["A cache miss leads to recursive lookup of authoritative servers."], reason: "", consequence: "" },
    ] },
  ]);
  assert.equal((await run(p, { userRequest: "How does DNS resolve a name?", answer })).report.status, "reviewed");
});

test("greetings are free and a factual one-liner can be declined by the planner", async () => {
  const p = provider([{ applicable: false, reason: "A factual one-liner", mechanisms: [] }]);
  assert.equal((await run(p, { userRequest: "thanks" })).report.calls, 0);
  assert.equal((await run(p, { userRequest: "What is the capital of France?", answer: "Paris." })).report.status, "not_applicable");
  assert.equal(p.calls.length, 1);
});

test("a model cannot pass incomplete coverage or a made-up answer quote", async () => {
  for (const coverage of [missing.coverage.slice(0, 1), [missing.coverage[0], missing.coverage[0]], [missing.coverage[0], { ...missing.coverage[1], status: "covered", quotes: ["The field propagates."] }]]) {
    const result = await run(provider([plan, { coverage }]));
    assert.equal(result.report.status, "unavailable");
    assert.equal(result.answer, draft);
    assert.equal(result.report.calls, 2);
  }
});

test("source uncertainty is recorded without guessing a repair", async () => {
  const p = provider([plan, { coverage: [missing.coverage[0], { ...missing.coverage[1], status: "uncertain" }] }]);
  const result = await run(p);
  assert.equal(result.report.status, "needs_evidence");
  assert.equal(result.answer, draft);
  assert.equal(p.calls.length, 2);
});

test("source quotes must be exact; irrelevant retrieval does not prohibit general knowledge", async () => {
  const sourcePassages = "The field acts on electrons already in the wire.";
  for (const [sourceQuotes, expected] of [[[sourcePassages], "repaired"], [[], "repaired"], [["A fabricated source quotation."], "unavailable"], [[draft], "unavailable"]]) {
    const grounded = { ...plan, mechanisms: [plan.mechanisms[0], { ...plan.mechanisms[1], sourceQuotes }] };
    const p = provider([grounded, missing, repair, verified]);
    const result = await run(p, { context: draft, sourcePassages });
    assert.equal(result.report.status, expected);
    assert.equal(p.calls[0].data.sourcePassages, sourcePassages);
  }
});

test("separate exact passages can support coverage but spliced or empty quotes cannot", async () => {
  const answer = "The battery separates charge. The field acts locally. Some other detail. The charges respond.";
  const spans = ["The field acts locally.", "The charges respond."];
  for (const [quotes, expected] of [[spans, "reviewed"], [[spans.join(" ")], "unavailable"], [["The battery separates charge. The field acts locally."], "reviewed"], [[], "unavailable"], [[""], "unavailable"], [[...spans, "Invented evidence."], "unavailable"]]) {
    const p = provider([plan, { coverage: [missing.coverage[0], { id: "m2", status: "covered", quotes, reason: "Explained.", consequence: "" }] }]);
    assert.equal((await run(p, { answer })).report.status, expected);
  }
  const p = provider([plan, missing, { ...repair, coverage: [repair.coverage[0], { id: "m2", quotes: ["The resulting field acts on electrons already in the wire;", "their redistribution changes the field in turn."] }] }, verified]);
  assert.equal((await run(p)).report.status, "repaired");
});

test("a repair cannot drop a source or claim coverage without revised-answer evidence", async () => {
  for (const bad of [repair, { ...repair, answer: repaired + " [Source](https://example.org/source)", coverage: [repair.coverage[0], { id: "m2", quotes: ["Invented supporting sentence"] }] }]) {
    const result = await run(provider([plan, missing, bad]), { answer: draft + " [Source](https://example.org/source)" });
    assert.equal(result.report.status, "unavailable");
    assert.equal(result.answer, draft + " [Source](https://example.org/source)");
    assert.equal(result.report.calls, 3);
  }
});

test("a repair that introduces a wrong direction is rejected, without another rewrite", async () => {
  const wrong = "The battery separates charge. The electric field points in the same direction as electron drift.";
  const p = provider([plan, missing, { answer: wrong, coverage: [{ id: "m1", quotes: ["The battery separates charge."] }, { id: "m2", quotes: ["The electric field points in the same direction as electron drift."] }] },
    { acceptable: false, concerns: [{ quotes: ["The electric field points in the same direction as electron drift."], reason: "Electron drift is opposite the electric field in a resistive wire." }] }]);
  const result = await run(p);
  assert.equal(result.answer, draft);
  assert.equal(result.report.status, "unavailable");
  assert.equal(result.report.repairConcerns.length, 1);
  assert.match(result.report.reason, /factual consistency/);
  assert.equal(p.calls.length, 4);
});

test("final verification cannot approve with unresolved concerns or fabricated evidence", async () => {
  for (const verdict of [{ acceptable: false, concerns: [] }, { acceptable: true, concerns: [{ quotes: ["The battery separates charge."], reason: "Unresolved concern." }] }, { acceptable: false, concerns: [{ quotes: ["Fabricated passage."], reason: "Unsupported." }] }]) {
    const result = await run(provider([plan, missing, repair, verdict]));
    assert.equal(result.answer, draft);
    assert.equal(result.report.status, "unavailable");
  }
});

test("the full draft is never silently truncated; context excerpts are disclosed", async () => {
  const p = provider([plan, missing, repair, verified]);
  assert.equal((await run(p, { answer: "a".repeat(32_001) })).report.status, "unavailable");
  assert.equal(p.calls.length, 0);
  await run(p, { context: "front" + "a".repeat(60_000) + "tail" });
  assert.equal(p.calls[0].data.contextTruncated, true);
  assert.match(p.calls[0].data.context, /^front/);
  assert.match(p.calls[0].data.context, /tail$/);
});

test("one deadline bounds an unresponsive provider and retains the answer", async () => {
  // Keep the test process alive while AbortSignal.timeout's unref'ed timer runs.
  const keepAlive = setInterval(() => {}, 100);
  try {
    const result = await run({ complete: async () => new Promise(() => {}) }, { timeoutMs: 15 });
    assert.equal(result.report.status, "unavailable");
    assert.match(result.report.reason, /time limit/);
    assert.equal(result.answer, draft);
    assert.equal(result.usage.partial, true);
  } finally { clearInterval(keepAlive); }
});

test("user cancellation propagates rather than finalizing the draft", async () => {
  const controller = new AbortController();
  await assert.rejects(run({ complete: async () => {
    controller.abort(new DOMException("Stopped", "AbortError"));
    return new Promise(() => {});
  } }, { signal: controller.signal }), { name: "AbortError" });
});

test("failed or unreported phases remain visible in token accounting", async () => {
  const result = await run(provider([plan, new Error("provider down")]));
  const total = mergeExplanationUsage({ inputTokens: 100, outputTokens: 50, totalTokens: 150, apiCalls: 1 }, result.usage);
  assert.equal(total.totalTokens, 180);
  assert.equal(total.apiCalls, 3);
  assert.equal(total.partial, true);
  assert.equal(mergeExplanationUsage({ total: 999, model: "legacy", calls: 7 }, result.usage).totalTokens, 30);
});

test("provider uses the selected model, no tools or nested council, and strict output", async () => {
  const requests = [];
  const complete = explanationReviewModel("gpt-5.6-sol", async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body), signal: init.signal });
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(plan) } }] });
  });
  const result = await run({ complete });
  // Returning a plan to the review call is intentionally invalid.
  assert.equal(result.report.status, "unavailable");
  assert.equal(requests[0].body.model, "gpt-5.6-sol");
  assert.equal(requests[0].body.council, false);
  assert.equal(requests[0].body.tools, undefined);
  assert.equal(requests[0].body.response_format.json_schema.strict, true);
  assert.match(requests[0].body.messages[0].content, /Required JSON schema:/);
  assert.match(requests[0].body.messages[0].content, /"mechanisms"/);
  assert.ok(requests[0].signal instanceof AbortSignal);
});

test("provider length stops cannot be mistaken for a complete review", async () => {
  const complete = explanationReviewModel("gpt-5.6-sol", async () => Response.json({ choices: [{ finish_reason: "length", message: { content: JSON.stringify(plan) } }] }));
  assert.equal((await run({ complete })).report.status, "unavailable");
});
