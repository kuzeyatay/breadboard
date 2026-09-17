import assert from "node:assert/strict";
import test from "node:test";
import { assistantVisibleContent } from "../src/lib/hermes/assistant-visible-content.ts";
import { delegatedThinkingUpdates } from "../src/lib/hermes/super-agent-activity.ts";

const content = "Max Research is reviewing the evidence, while Deep Research builds your beginner-safe training plan with exercise progressions. I’ll combine both results into one calorie target, diet, supplement guide, timeline, and gym program when they return.";
const earlier = "This needs two parallel tracks: evidence review and a beginner-safe program.";
const handoff = {
  role: "assistant", content: `\n\n${content}`, progressNotes: [earlier],
  verification: { externalAgents: [
    { agentName: "Max Research", carried: false },
    { agentName: "Deep Research" },
  ] },
};

test("saved and live launch updates appear only in Thinking without changing history", () => {
  for (const message of [handoff, JSON.parse(JSON.stringify(handoff))]) {
    const before = JSON.stringify(message);
    assert.equal(assistantVisibleContent(message.content, message), "");
    assert.deepEqual(delegatedThinkingUpdates(message), [earlier, content]);
    assert.equal(JSON.stringify(message), before);
  }
});

test("handoff updates are not duplicated by a stored preamble or progress note", () => {
  const message = { ...handoff, progressNotes: [earlier, content], delegatedAgentPreamble: content };
  assert.deepEqual(delegatedThinkingUpdates(message, content), [earlier, content]);
});

test("a worker result and a returned synthesis remain visible answers", () => {
  const answer = "The training program is ready. Here are the exercises and progressions.";
  for (const metadata of [
    { ...handoff, delegatedAgentRun: true },
    { ...handoff, verification: { externalAgents: handoff.verification.externalAgents.map((agent) => ({ ...agent, carried: true })) } },
    { ...handoff, verification: { externalAgents: [{ carried: true }, { carried: false }] } },
  ]) {
    const message = { ...metadata, content: answer };
    assert.equal(assistantVisibleContent(answer, message), answer);
    assert.deepEqual(delegatedThinkingUpdates(message), [earlier]);
  }
});

test("ordinary answers and failed or interrupted responses stay in the message", () => {
  for (const message of [
    { role: "assistant", content },
    { ...handoff, role: "user" },
    { ...handoff, failed: true, content: "Research failed. Please try again." },
    { ...handoff, interrupted: true, content: "Interrupted" },
  ]) {
    assert.equal(assistantVisibleContent(message.content, message), message.content);
  }
});
