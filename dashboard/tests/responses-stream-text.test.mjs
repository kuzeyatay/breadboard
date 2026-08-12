import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  assistantTextFromOutputItem,
  createResponseTextRecovery,
  reasoningTextFromOutputItem,
} from "../src/lib/responses-stream-text.ts";

// A Responses provider may stream the answer as `output_text.delta` events, or
// hand it over once on `output_item.done`, or both. Reading only the deltas
// stored an empty answer for every `cliproxy/*` model; reading only the finished
// item would print the answer twice for ChatGPT's. These pin the reconciliation
// and the three readers that depend on it.

function source(relativePath) {
  return fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const messageItem = (text) => ({
  id: "msg_1",
  type: "message",
  role: "assistant",
  status: "completed",
  content: [{ type: "output_text", text, annotations: [] }],
});

test("a finished message item yields its concatenated output_text", () => {
  assert.equal(assistantTextFromOutputItem(messageItem("Hello.")), "Hello.");
  assert.equal(
    assistantTextFromOutputItem({
      type: "message",
      content: [
        { type: "output_text", text: "one " },
        { type: "output_text", text: "two" },
      ],
    }),
    "one two",
  );
});

test("items that carry no answer text yield nothing", () => {
  // Reasoning, tool and image items all ride the same event. Treating any of
  // them as answer text would splice machinery into the user's message.
  assert.equal(assistantTextFromOutputItem({ type: "reasoning", summary: [] }), "");
  assert.equal(
    assistantTextFromOutputItem({ type: "image_generation_call", result: "AAAA" }),
    "",
  );
  assert.equal(assistantTextFromOutputItem(null), "");
  assert.equal(assistantTextFromOutputItem("message"), "");
  assert.equal(assistantTextFromOutputItem({ type: "message" }), "");
});

test("a finished reasoning item yields its summary text", () => {
  assert.equal(
    reasoningTextFromOutputItem({
      type: "reasoning",
      summary: [
        { type: "summary_text", text: "First. " },
        { type: "summary_text", text: "Second." },
      ],
    }),
    "First. Second.",
  );
  assert.equal(reasoningTextFromOutputItem(messageItem("Hello.")), "");
});

test("a provider that only sends the finished item delivers the whole answer", () => {
  // The cliproxy shape: no deltas at all, so every character is missing and the
  // turn would otherwise be stored empty.
  const recovery = createResponseTextRecovery();
  assert.equal(
    recovery.missingFrom(0, assistantTextFromOutputItem(messageItem("Full answer."))),
    "Full answer.",
  );
});

test("a provider that streams is not made to repeat itself", () => {
  // The ChatGPT shape: the finished item restates exactly what the deltas
  // already delivered, so nothing is left over.
  const recovery = createResponseTextRecovery();
  recovery.recordStreamed(0, "Full ");
  recovery.recordStreamed(0, "answer.");
  assert.equal(recovery.missingFrom(0, "Full answer."), "");
});

test("a stream cut short is completed, not restarted", () => {
  const recovery = createResponseTextRecovery();
  recovery.recordStreamed(0, "Full ");
  assert.equal(recovery.missingFrom(0, "Full answer."), "answer.");
});

test("output items are reconciled independently", () => {
  // Reasoning is output 0 and the message is output 1 in the same response, so
  // one index's deltas must never mask another index's missing text.
  const recovery = createResponseTextRecovery();
  recovery.recordStreamed(0, "thought");
  assert.equal(recovery.missingFrom(1, "answer"), "answer");
  assert.equal(recovery.missingFrom(0, "thought"), "");
});

test("an item that contradicts what was streamed is discarded", () => {
  // The user has already read the streamed text. Appending a conflicting copy
  // would leave two different answers in one message; the screen wins.
  const recovery = createResponseTextRecovery();
  recovery.recordStreamed(0, "Streamed answer.");
  assert.equal(recovery.missingFrom(0, "A different answer."), "");
});

test("empty text is never emitted", () => {
  const recovery = createResponseTextRecovery();
  assert.equal(recovery.missingFrom(0, ""), "");
  recovery.recordStreamed(0, "");
  assert.equal(recovery.missingFrom(0, "answer"), "answer");
});

test("every Responses reader recovers text from the finished item", () => {
  // One bug in three places: the direct pipeline stored an empty message, and
  // both legacy chat routes streamed an empty answer. A new reader that skips
  // this is the same outage again.
  for (const file of [
    "src/lib/conversations/direct-turn-service.ts",
    "src/app/api/chat/route.ts",
    "src/app/api/knowledge-chat/route.ts",
  ]) {
    const text = source(file);
    assert.match(text, /createResponseTextRecovery\(\)/, `${file} has no recovery`);
    assert.match(
      text,
      /response\.output_item\.done/,
      `${file} ignores the finished item`,
    );
    assert.match(
      text,
      /assistantTextFromOutputItem\(event\.item\)/,
      `${file} does not read answer text from the finished item`,
    );
    assert.match(
      text,
      /recordStreamed\(event\.output_index, event\.delta\)/,
      `${file} does not record streamed text, so it would emit the answer twice`,
    );
  }
});
