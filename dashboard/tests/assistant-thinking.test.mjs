import assert from "node:assert/strict";
import test from "node:test";
import { assistantThinkingText, isAssistantTextPreview } from "../src/lib/assistant-thinking.ts";

test("saved answer previews match the answer's normalized prose", () => {
  const preview = "The forecast is ready—check the hourly detail.\n\nThere may be showers later today.";
  const answer = "The forecast is ready, check the hourly detail.\nThere may be showers later today.";
  assert.equal(assistantThinkingText(preview, answer, []), "");
});

test("short shared openings do not hide distinct thinking", () => {
  assert.equal(isAssistantTextPreview("The forecast", "The forecast is ready."), false);
  assert.equal(assistantThinkingText("Compare the two sources.", "The forecast is ready.", []), "Compare the two sources.");
});

test("thinking is retained when no answer or progress was recorded", () => {
  assert.equal(assistantThinkingText("  Saved reasoning.  ", "", []), "Saved reasoning.");
  assert.equal(assistantThinkingText(undefined, "Answer", []), "");
});

test("pre-tool narration previews are removed without mutating their source", () => {
  const note = "I will check the forecast for each requested location and compare the expected conditions tomorrow.";
  const progress = [note];
  assert.equal(assistantThinkingText(note.slice(0, 85), "Another answer", progress), "");
  assert.deepEqual(progress, [note]);
});
