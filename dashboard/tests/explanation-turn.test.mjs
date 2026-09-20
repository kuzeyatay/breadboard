import test from "node:test";
import assert from "node:assert/strict";
import { explanationIntent, buildExplanationTurn, explanationTurnPrompt } from "../src/lib/hermes/explanation-turn.ts";
import { reviewExplanation } from "../src/lib/hermes/explanation-review.ts";

const message = (role, content) => ({ role, content, surface: "garden_chat", status: "complete" });
const objections = [
  "what adjustment bro you cant just say the adjustment before like telling what happens",
  "what do you mean if? you dont fucking know what happens>",
  "explain this better", "I still don't understand", "how?", "why", "you skipped the step that causes this", "that still makes no sense", "I am confused",
];

test("natural objections keep the explanation open without requiring a question mark", () => {
  for (const request of objections) assert.deepEqual(explanationIntent(request), { candidate: true, repair: true }, request);
  assert.deepEqual(explanationIntent("what adjustment", true), { candidate: true, repair: true });
  assert.deepEqual(explanationIntent("Explain how DNS works"), { candidate: true, repair: false });
});

test("document instructions and action requests do not activate explanation repair", () => {
  for (const request of [
    'Translate "what adjustment bro you cant just say that" into Turkish',
    '> I still do not understand\n\nSummarize this quote.',
    '<document>why does this happen? explain this better</document>\nSave the file.',
    'Create a visualization of how this works', 'Do not explain; return JSON only.', 'thanks',
  ]) assert.equal(buildExplanationTurn({ request, messages: [], selectionContext: "Selected text" }), undefined, request);
});

test("the disputed older answer survives large recent context with sources kept separate", () => {
  const messages = Array.from({ length: 40 }, (_, i) => message("assistant", `Unrelated ${i}. ` + "x".repeat(2_000)));
  messages.push(message("assistant", "The adjustment may overshoot."), message("user", objections[0]));
  const original = JSON.stringify(messages);
  const turn = buildExplanationTurn({ request: objections[0], messages,
    selectionContext: "The selected parent: If the initial field were equal, then a current mismatch would follow.",
    constraints: "Explain the causal sequence. Do not assume equal initial fields.",
    sourcePassages: "A source passage with its own provenance.",
  });
  assert.equal(turn.repair, true);
  assert.match(turn.context, /The selected parent: If the initial field were equal/);
  assert.match(turn.context, /Do not assume equal initial fields/);
  assert.match(turn.context, /what adjustment bro/);
  assert.doesNotMatch(turn.context, /Unrelated 0\./);
  assert.doesNotMatch(turn.context, /A source passage/);
  assert.equal(turn.sourcePassages, "A source passage with its own provenance.");
  assert.ok(turn.context.length < 16_000);
  assert.equal(JSON.stringify(messages), original);
});

test("one missing causal link can be checked without inventing a second requirement", async () => {
  const calls = [];
  const result = await reviewExplanation({ userRequest: objections[0], context: "The current mismatch was never established.",
    answer: "The initial condition was an assumption, so that sequence was only illustrative.", model: "fixture",
    complete: async request => {
      calls.push(request.stage);
      return { content: JSON.stringify(request.stage === "plan"
        ? { applicable: true, reason: "An unsupported antecedent", mechanisms: [{ mechanism: "State whether the initial condition was assumed or established.", sourceQuotes: [] }] }
        : { concerns: [], coverage: [{ id: "m1", status: "covered", quotes: ["The initial condition was an assumption"], reason: "", consequence: "" }] }) };
    },
  });
  assert.equal(result.report.status, "reviewed");
  assert.deepEqual(calls, ["plan", "review"]);
});

test("failure receipts distinguish malformed JSON from valid but incomplete coverage", async () => {
  for (const [content, expected] of [["{", "invalid_json"], [JSON.stringify({ applicable: true, reason: "Missing mechanisms", mechanisms: [] }), "invalid mechanism contract"]]) {
    const result = await reviewExplanation({ userRequest: "Explain this better", context: "", answer: "The adjustment happens.", model: "fixture", complete: async () => ({ content }) });
    assert.equal(result.report.status, "unavailable");
    assert.equal(result.report.failureStage, "plan");
    assert.equal(result.report.failureReason, expected);
    assert.equal(result.answer, "The adjustment happens.");
  }
});

test("rendered quotations survive bold and line wrapping but cannot change facts", async () => {
  const answer = "**The local field pushes electrons.**\nThey move in response. Charge is -2 units. Power x**2 + y**2.";
  for (const [quote, accepted] of [
    ["The local field pushes electrons. They move in response.", true],
    ["The local field pushes electrons. Charge is -2 units.", false],
    ["Charge is 2 units.", false],
    ["Charge is -3 units.", false],
    ["Power x2 + y2.", false],
  ]) {
    const result = await reviewExplanation({ userRequest: "what do you mean", answer, context: "", model: "fixture",
      complete: async request => ({ content: JSON.stringify(request.stage === "plan"
        ? { applicable: true, reason: "Test actual quote coverage", mechanisms: [{ mechanism: "The field causes local motion", sourceQuotes: [] }] }
        : { concerns: [], coverage: [{ id: "m1", status: "covered", quotes: [quote], reason: "", consequence: "" }] }) }),
    });
    assert.equal(result.report.status, accepted ? "reviewed" : "unavailable", quote);
    if (accepted) assert.ok(answer.includes(result.report.coverage[0].quotes[0]), "receipt stores the exact original span");
  }
});

test("selected follow-ups and proposed summaries reach generation and review without magic wording", async () => {
  for (const request of [
    "so basically in a giberrish paragraph you say that its fifty fifty",
    "does that mean two electrons physically sitting next to each other?",
    "this whole paragraph doesnt make sense to someone that doesnt know what an electron shell is",
    "Two real little balls next to each other?",
  ]) {
    const turn = buildExplanationTurn({ request, messages: [], selectionContext: "Electrons pair up in slots." });
    assert.equal(turn?.repair, true, request);
    assert.equal(turn?.hasSelection, true);
    let called = false;
    await reviewExplanation({ userRequest: request, hasSelection: turn.hasSelection, context: turn.context,
      answer: "A reply to check.", model: "fixture", complete: async () => {
        called = true;
        return { content: JSON.stringify({ applicable: false, reason: "Admission check only", mechanisms: [] }) };
      } });
    assert.equal(called, true, request);
  }
  assert.deepEqual(explanationIntent("so basically it is fifty fifty"), { candidate: true, repair: true });
  for (const request of ["thanks", "got it", "yes", "Translate this into Dutch", "Create an image of this"])
    assert.equal(explanationIntent(request, true).candidate, false, request);
});
