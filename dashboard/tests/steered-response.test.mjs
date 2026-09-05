import assert from "node:assert/strict";
import test from "node:test";

import {
  isClarificationAnswerMessage,
  splitSteeredResponse,
} from "../src/lib/steered-response.ts";

test("answers to assistant clarification questions are not new chat turns", () => {
  assert.equal(
    isClarificationAnswerMessage({
      clientMessageId: "clarify:request-1",
    }),
    true,
  );
  assert.equal(
    isClarificationAnswerMessage({
      clientMessageId: "legacy-message-id",
      clarificationAnswer: true,
    }),
    true,
  );
  assert.equal(
    isClarificationAnswerMessage({ clientMessageId: "steer:request-1" }),
    false,
  );
});

test("steered response continuations render below their correction bubbles", () => {
  assert.deepEqual(
    splitSteeredResponse("first part and the continued answer", [
      { id: "steer-1", content: "focus on the details", offset: 10 },
    ]),
    [
      { kind: "assistant", content: "first part", key: "assistant-0-10" },
      {
        kind: "correction",
        content: "focus on the details",
        key: "correction-steer-1",
      },
      {
        kind: "assistant",
        content: " and the continued answer",
        key: "assistant-10-35",
      },
    ],
  );
});

test("multiple steering boundaries retain their submission order", () => {
  assert.deepEqual(
    splitSteeredResponse("abcdefghij", [
      { id: "second", content: "second steer", offset: 7 },
      { id: "first", content: "first steer", offset: 3 },
    ]).map((segment) => [segment.kind, segment.content]),
    [
      ["assistant", "abc"],
      ["correction", "first steer"],
      ["assistant", "defg"],
      ["correction", "second steer"],
      ["assistant", "hij"],
    ],
  );
});

test("a boundary beyond an interrupted response is clamped safely", () => {
  assert.deepEqual(
    splitSteeredResponse("short", [
      { id: "late", content: "continue differently", offset: 200 },
    ]).map((segment) => [segment.kind, segment.content]),
    [
      ["assistant", "short"],
      ["correction", "continue differently"],
    ],
  );
});
