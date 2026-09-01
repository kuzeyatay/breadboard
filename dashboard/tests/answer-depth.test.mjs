import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  answerDepthDiagnostics,
  answerDepthSection,
  classifyQuestionScope,
} from "../src/lib/hermes/answer-depth.ts";
import { composeHermesSystemPrompt } from "../src/lib/hermes/system-prompts.ts";

// Bread answered scoped questions well and general ones thinly: "how does X
// work" produced a survey at uniform low altitude while any of its headings,
// asked directly, produced the details that mattered. These tests hold the
// classifier to the distinction the fix depends on: a general question is an
// ask that names its subject without scoping it, and everything else pays
// nothing.
//
// The cases are deliberately spread across technology, finance, engineering
// and everyday subjects, because the classifier's promise is that it reads the
// shape of the ask and never the topic.

delete process.env.ENABLE_ANSWER_DEPTH;

const source = (relativePath) =>
  fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const decision = (overrides = {}) => ({
  mode: "knowledge",
  requestedOutcome: "answer the question",
  implementationRequired: false,
  decisionReason: "test",
  decisionSource: "breadboard_server_policy_v1",
  authorizedRoots: [],
  authorizedPathPatterns: [],
  allowedTools: [],
  allowedOperations: ["knowledge_work"],
  allowedCommandPatterns: [],
  selectedConditionalSkills: [],
  selectedConnections: [],
  createdAt: "2026-09-01T00:00:00.000Z",
  expiresAt: null,
  revokedAt: null,
  ...overrides,
});

// --- classification ---------------------------------------------------------

test("a general question engages, whatever it is about", () => {
  const general = [
    "how does garbage collection work?",
    "tell me about mortgages",
    "explain quantum entanglement",
    "what should I know about hiring a contractor?",
    "why do bridges have expansion joints?",
    "what is a load balancer?",
    "walk me through how vaccines get approved",
    "could you explain inflation?",
  ];
  for (const question of general) {
    const result = classifyQuestionScope(question);
    assert.equal(result.scope, "general", question);
  }
});

test("an unscoped sentence ending in a question mark is a question too", () => {
  const result = classifyQuestionScope("so containers are just processes?");
  assert.equal(result.scope, "general");
  assert.ok(result.signals.includes("bare_question"));
});

test("a question that carries its own scope composes without the section", () => {
  const scoped = [
    ["how do I lower a 7.2% APR?", "number"],
    ["how does useEffect work?", "code_identifier"],
    ["postgres versus mysql for analytics?", "comparison"],
    ["what happens if the primary node fails?", "condition"],
    ["what should I know about my lease?", "personal_scope"],
    ['what does "idempotent" mean in that sentence?', "quoted_span"],
    ["what specifically changed in the pricing model?", "narrowing_adverb"],
  ];
  for (const [question, signal] of scoped) {
    const result = classifyQuestionScope(question);
    assert.equal(result.scope, "scoped", question);
    assert.ok(result.signals.includes(signal), `${question} -> ${signal}`);
  }
});

test("a long message is treated as carrying its own scope", () => {
  const long = `how does caching work? ${"We run a read-heavy service and I keep seeing stale pages after publishing, so the team is debating whether the problem sits in the CDN, the application layer, or the browser, and everyone has a different theory about it. ".repeat(2)}`;
  const result = classifyQuestionScope(long);
  assert.equal(result.scope, "scoped");
  assert.ok(result.signals.includes("self_scoped_length"));
});

test("tasks, small talk and statements pay nothing", () => {
  assert.equal(classifyQuestionScope("").scope, "none");
  assert.equal(classifyQuestionScope("thanks!").scope, "none");
  assert.equal(classifyQuestionScope("fix the login redirect loop").scope, "none");
  assert.equal(
    classifyQuestionScope("can you write a cover letter for this posting").scope,
    "none",
  );
  assert.equal(
    classifyQuestionScope("summarize the attached report").scope,
    "none",
  );
  assert.equal(
    classifyQuestionScope("I finished the report yesterday.").scope,
    "none",
  );
});

// --- the section ------------------------------------------------------------

test("the section carries the contract and the per-turn frame", () => {
  const section = answerDepthSection({ userText: "tell me about mortgages" });
  assert.ok(section);
  assert.match(section, /# answer_depth/);
  assert.match(section, /# depth_turn/);
  // The two halves the contract must keep: resolution, and proportion.
  assert.match(section, /same resolution as a scoped one/);
  assert.match(section, /Proportion still wins/);
  assert.doesNotMatch(section, /—/);
});

test("a scoped question and a task get no section", () => {
  assert.equal(answerDepthSection({ userText: "how does useEffect work?" }), null);
  assert.equal(answerDepthSection({ userText: "deploy the staging build" }), null);
  assert.equal(answerDepthSection({ userText: undefined }), null);
});

test("the kill switch composes the section away", () => {
  process.env.ENABLE_ANSWER_DEPTH = "0";
  try {
    assert.equal(
      answerDepthSection({ userText: "tell me about mortgages" }),
      null,
    );
  } finally {
    delete process.env.ENABLE_ANSWER_DEPTH;
  }
});

test("diagnostics point at a contract file that exists", () => {
  const diagnostics = answerDepthDiagnostics();
  assert.equal(diagnostics.live, true);
  assert.equal(diagnostics.enabled, true);
});

// --- wiring -----------------------------------------------------------------

test("a general question ships the contract from the composed prompt", () => {
  const prompt = composeHermesSystemPrompt({
    surface: "dashboard_terminal",
    decision: decision(),
    userText: "how does garbage collection work?",
  });
  assert.match(prompt, /# answer_depth/);
});

test("a scoped question composes the same prompt without it", () => {
  const prompt = composeHermesSystemPrompt({
    surface: "dashboard_terminal",
    decision: decision(),
    userText: "How does useEffect decide when to re-run?",
  });
  assert.doesNotMatch(prompt, /# answer_depth/);
});

test("agent mode off owes the same standard", () => {
  const direct = source("src/lib/conversations/direct-turn-service.ts");
  assert.match(direct, /answerDepthSection\(\{ userText \}\)/);
});
