import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeWebTextHighlight, parseWebSelectionAction, webHighlightUrl } from "../src/shared/web-text-selection";
import { isTabsCommand } from "../src/shared/ipc-contract";

const entry = { id: "mark", start: 4, end: 18, quote: "selected words", prefix: "The ", suffix: " follow." };

test("web annotation transport accepts bounded anchors and viewport points only", () => {
  const url = (value: unknown) => "breadboard-selection://annotation?data=" + encodeURIComponent(JSON.stringify(value));
  const valid = { action: "select", entry, anchor: { x: 30, y: 80 } };
  assert.deepEqual(parseWebSelectionAction(url(valid)), valid);
  assert.deepEqual(parseWebSelectionAction(url({ ...valid, action: "position", visible: false })), { ...valid, action: "position", visible: false });
  for (const value of [null, {}, { ...valid, action: "save" }, { ...valid, anchor: { x: -1, y: 30 } },
    { ...valid, entry: { ...entry, end: 19 } }, { ...valid, entry: { ...entry, quote: "x".repeat(4001) } }]) {
    assert.equal(parseWebSelectionAction(url(value)), null);
  }
  assert.equal(parseWebSelectionAction("https://example.com/"), null);
  assert.equal(normalizeWebTextHighlight({ ...entry, conversationId: "foreign" })?.conversationId, undefined);
});

test("web highlight identity preserves query and SPA routes across launches", () => {
  assert.equal(webHighlightUrl("https://example.com/lesson?q=1#chapter:~:text=selected%20words"), "https://example.com/lesson?q=1#chapter");
  assert.equal(webHighlightUrl("https://example.com/#/lesson-two"), "https://example.com/#/lesson-two");
  for (const value of ["file:///secret", "javascript:alert(1)", "https://user:pass@example.com/", "bad"]) assert.equal(webHighlightUrl(value), null);
});

test("trusted popup commands validate colors, notes, sizes and conversation bindings", () => {
  assert.ok(isTabsCommand({ type: "browser-selection-action", action: "highlight", value: "blue" }));
  assert.ok(isTabsCommand({ type: "browser-selection-action", action: "note", value: null }));
  assert.ok(isTabsCommand({ type: "browser-selection-resize", height: 160 }));
  assert.ok(isTabsCommand({ type: "browser-selection-delete", id: "mark", url: "https://example.com/" }));
  assert.ok(isTabsCommand({ type: "browser-answer-state", state: { requestId: "request", selectionId: "mark", content: { pending: true } } }));
  assert.ok(isTabsCommand({ type: "browser-answer-action", action: { requestId: "request", selectionId: "mark", action: "ask", question: "Explain this" } }));
  assert.ok(isTabsCommand({ type: "browser-selection-conversation", id: "mark", url: "https://example.com/", conversationId: "conv_saved" }));
  for (const value of [{ type: "browser-selection-action", action: "highlight", value: "orange" },
    { type: "browser-selection-action", action: "note", value: "x".repeat(4001) },
    { type: "browser-selection-resize", height: Infinity },
    { type: "browser-selection-delete", id: "../invalid", url: "https://example.com/" },
    { type: "browser-answer-resize", width: 400, height: NaN },
    { type: "browser-answer-state", state: { requestId: "request", selectionId: "mark", content: { pending: "yes" } } },
    { type: "browser-answer-action", action: { requestId: "request", selectionId: "mark", action: "ask", question: "" } },
    { type: "browser-selection-conversation", id: "mark", url: "https://example.com/", conversationId: "other" }]) assert.equal(isTabsCommand(value), false);
});
