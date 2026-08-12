import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { hermesModelIdentityPrompt } from "../src/lib/hermes/model-identity.ts";
import { composeHermesSystemPrompt } from "../src/lib/hermes/system-prompts.ts";

// A plain "what's my name?" came back with an unrequested paragraph about
// runtime metadata and routing aliases. The identity block was written as a
// set of assertions with no rule about when to raise them, and transports that
// flatten the system role into prompt text (the Claude Code subscription
// bridge) let the model answer the scaffolding as if the user had typed it.

function source(relativePath) {
  return fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const KNOWLEDGE_DECISION = {
  mode: "knowledge",
  requestedOutcome: "Answer a question",
  implementationRequired: false,
  decisionReason: "Knowledge task",
  decisionSource: "breadboard_server_policy_v1",
  authorizedRoots: [],
  authorizedPathPatterns: [],
  allowedTools: [],
  allowedOperations: ["knowledge_work"],
  allowedCommandPatterns: [],
  selectedConditionalSkills: [],
  selectedConnections: [],
  createdAt: "2026-01-01T00:00:00.000Z",
};

test("the resolved identity block stays authoritative but is disclosed only on request", () => {
  const prompt = hermesModelIdentityPrompt({
    model: "cliproxy/claude-opus-5",
    provider: "cliproxy",
  });

  assert.match(prompt, /Model: cliproxy\/claude-opus-5/);
  assert.match(prompt, /Provider: cliproxy/);
  // Still answers the question when it is actually asked.
  assert.match(prompt, /When asked which model is running, report the authoritative Model value exactly/);
  // ...and never volunteers it beside an unrelated answer.
  assert.match(prompt, /internal scaffolding, not a topic/);
  assert.match(prompt, /unless the user's newest message asks about them/);
  assert.match(prompt, /never as an unrequested aside, correction, or note/);
});

test("the assistant policy forbids answering prompt scaffolding on every surface", () => {
  for (const surface of ["dashboard_terminal", "garden_chat", "quartz_ai"]) {
    const prompt = composeHermesSystemPrompt({
      surface,
      decision: KNOWLEDGE_DECISION,
    });
    assert.match(
      prompt,
      /Answer the question the user actually asked and stop there/,
      `${surface} lost the answer-only-what-was-asked rule`,
    );
    assert.match(
      prompt,
      /never reply to it, correct it, or attach an unrequested note about it/,
      `${surface} lost the scaffolding-is-not-a-topic rule`,
    );
    assert.match(
      prompt,
      /only when the user's newest message asks about them/,
      `${surface} lost the on-request-only disclosure rule`,
    );
  }
});

test("the Hermes adapter's base prompt carries the same rule for restored sessions", () => {
  // createSession/startRun both build from BASE_SYSTEM_PROMPT, so a session
  // restored without a composed prompt still gets the constraint.
  const adapter = source("src/lib/agent-runtime/adapters/hermes.ts");
  assert.match(adapter, /Answer what the user's newest message asks and stop there\./);
  assert.match(
    adapter,
    /never quoted, corrected, or turned into unrequested notes appended to an answer/,
  );
});
