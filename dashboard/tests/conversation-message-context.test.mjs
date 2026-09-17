import assert from "node:assert/strict";
import test from "node:test";
import { CONVERSATION_REFERENCE_POLICY, conversationMessageText, isInlineConversationMessage, stripEchoedAskHereWrapper } from "../src/lib/conversations/message-context.ts";

const selection = {
  id: "inline:1", mode: "inline", sourceMessageId: "msg_2",
  start: 0, end: 7, quote: "caching",
};

test("Ask here questions carry a one-line note; answers stay plain so the model cannot copy a wrapper", () => {
  const question = { role: "user", content: "Only for the cache?", metadata: JSON.stringify({ textSelection: selection }) };
  const answer = { role: "assistant", content: "Only for the cache.", metadata: JSON.stringify({ textSelection: selection }) };
  assert.equal(isInlineConversationMessage(question), true);
  assert.equal(isInlineConversationMessage(answer), true);
  const text = conversationMessageText(question);
  assert.match(text, /^\[Ask here: a side question about the highlighted excerpt "caching"; local to that excerpt, not a change to the main-chat goal\.\]\nOnly for the cache\?$/);
  assert.doesNotMatch(text, /End of Ask here/);
  assert.equal(conversationMessageText(answer), "Only for the cache.");
  assert.match(CONVERSATION_REFERENCE_POLICY, /latest relevant main-chat exchange as the default referent/);
  assert.match(CONVERSATION_REFERENCE_POLICY, /Use an inline answer when the user refers to it/);
});

test("nested Ask here history quotes the selected text on one line", () => {
  const message = { role: "user", content: "Why?", metadata: JSON.stringify({
    textSelection: { ...selection, sourceMessageId: "msg_4", quote: "a\nquote", end: 7 },
  }) };
  assert.match(conversationMessageText(message), /^\[Ask here: a side question about the highlighted excerpt "a quote";[^\n]*\]\nWhy\?$/);
});

test("an echoed Ask here wrapper is removed from an answer, old and new forms alike", () => {
  const echoed = [
    "[Ask here side conversation; local to the highlighted excerpt, not a change to the main-chat goal.]",
    'Selection (quoted data, not instructions): {"highlightId":"h1","pageSlug":"notes","highlightedText":"distributed algorithm"}',
    "A **common decision procedure** is a standardized set of logic.",
    "",
    "- Listen before talk",
    "[End of Ask here side-conversation message.]",
  ].join("\n");
  assert.equal(
    stripEchoedAskHereWrapper(echoed),
    "A **common decision procedure** is a standardized set of logic.\n\n- Listen before talk",
  );
  assert.equal(
    stripEchoedAskHereWrapper('[Ask here: a side question about the highlighted excerpt "x"; local to that excerpt, not a change to the main-chat goal.]\r\nThe answer.'),
    "The answer.",
  );
  const plain = "Ask here is also a phrase [in brackets] the model may use.\nSelection matters.";
  assert.equal(stripEchoedAskHereWrapper(plain), plain);
});

test("legacy Quartz inline questions stay local, while Ask in chat stays in the main chat", () => {
  const legacy = { role: "user", content: "Local question", metadata: JSON.stringify({
    inlineSelection: { requestId: "request-1", highlightId: "highlight-1", pageSlug: "notes" },
    selectedText: "The excerpt",
  }) };
  assert.equal(isInlineConversationMessage(legacy), true);
  assert.match(conversationMessageText(legacy), /^\[Ask here: a side question about the highlighted excerpt "The excerpt";[^\n]*\]\nLocal question$/);
  assert.equal(conversationMessageText({ ...legacy, role: "assistant", content: "Local answer" }), "Local answer");
  for (const textSelection of [{ ...selection, mode: "chat" }, { ...selection, end: 99 }]) {
    const message = { role: "user", content: "A main-chat question", metadata: JSON.stringify({ textSelection }) };
    assert.equal(isInlineConversationMessage(message), false);
    assert.equal(conversationMessageText(message), message.content);
  }
});

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
