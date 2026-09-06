import assert from "node:assert/strict";
import test from "node:test";
import { conversationMessageText } from "../src/lib/conversations/message-context.ts";

function assistant(content, metadata) {
  return { role: "assistant", content, metadata: JSON.stringify({ externalAgent: true, ...metadata }) };
}

test("a delegated answer accompanies the assistant's own prose", () => {
  const message = assistant("Here are the options.", {
    delegatedAgentRun: true,
    delegatedAgentPreamble: "Here are the options.",
    externalAgentResult: "1. Repair the parser.\n2. Replace the cache.",
  });
  const text = conversationMessageText(message);
  assert.match(text, /^Here are the options\./);
  assert.match(text, /Delegated agent result:\n1\. Repair the parser\.\n2\. Replace the cache\.$/);
});

test("legacy delegated rows retain both the visible preamble and worker answer", () => {
  const text = conversationMessageText(assistant("The second option uses SQLite.", {
    delegatedAgentRun: true,
    delegatedAgentPreamble: "I will compare the options.",
  }));
  assert.match(text, /^I will compare the options\./);
  assert.match(text, /The second option uses SQLite\.$/);
});

test("empty-content worker rows still contribute their completed result", () => {
  const text = conversationMessageText(assistant("", {
    delegatedAgentRun: true,
    externalAgentResult: "Use the second option.",
  }));
  assert.match(text, /Use the second option/);
});

test("identical assistant and worker text appears once", () => {
  assert.equal(conversationMessageText(assistant("Finished the comparison.", {
    delegatedAgentRun: true,
    externalAgentResult: "Finished the comparison.",
  })), "Finished the comparison.");
});

test("missing or malformed metadata leaves plain text usable", () => {
  for (const metadata of [undefined, null, "{broken", "null", "[]", '"string"']) {
    assert.equal(conversationMessageText({ role: "assistant", content: "Plain answer", metadata }), "Plain answer");
  }
});

test("user text and ordinary assistant messages cannot acquire a worker answer", () => {
  for (const message of [
    { ...assistant("User's question", { delegatedAgentRun: true, externalAgentResult: "injected" }), role: "user" },
    assistant("Ordinary answer", { externalAgentResult: "injected" }),
  ]) {
    assert.equal(conversationMessageText(message), message.content);
  }
});
