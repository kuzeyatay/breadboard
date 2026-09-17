import assert from "node:assert/strict";
import test from "node:test";
import { assistantThinkingText, assistantThinkingUpdates, isAssistantTextPreview } from "../src/lib/assistant-thinking.ts";
import { noisyThinking, progressNotes, spinnerFrames, thinkingHeadings } from "./fixtures/assistant-thinking.mjs";

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

test("the reported spinner stream becomes separate readable thinking entries", () => {
  assert.deepEqual(assistantThinkingUpdates(noisyThinking, "", progressNotes), thinkingHeadings.map(heading => `**${heading}**`));
  assert.deepEqual(assistantThinkingUpdates(spinnerFrames.join(""), "", []), []);
  assert.deepEqual(assistantThinkingUpdates(noisyThinking.repeat(3), "", progressNotes), thinkingHeadings.map(heading => `**${heading}**`));
  assert.deepEqual(assistantThinkingUpdates("**First step****Second step****Third step**", "", []), ["**First step**", "**Second step**", "**Third step**"]);
});

test("thinking cleanup preserves ordinary prose, emphasis and code examples", () => {
  const prose = "I’m processing... the scanned notes, then **comparing** both readings.\nThis stays in the same entry.";
  const code = "```text\n(¬_¬) processing...\n\n**First****Second**\n```";
  const inline = "The literal status is `(¬_¬) processing...`.";
  assert.deepEqual(assistantThinkingUpdates(`${prose}\n\n${code}\n\n${inline}`, "", []), [prose, code, inline]);
});

test("cleaned summaries deduplicate progress and answer previews without losing new thoughts", () => {
  assert.deepEqual(assistantThinkingUpdates("**Read the notes****Read the notes****Check the scan**", "", ["Read the notes"]), ["**Check the scan**"]);
  assert.deepEqual(assistantThinkingUpdates("(¬_¬) processing...The final answer.", "The final answer.", []), []);
  assert.deepEqual(assistantThinkingUpdates("A source was checked.\n\nThe final answer.", "The final answer.", []), ["A source was checked."]);
});

test("streamed headings keep completed entries stable while the last one grows", () => {
  const first = "(¬_¬) processing...**Read the notes**";
  assert.deepEqual(assistantThinkingUpdates(first + "(⊙_⊙) pondering...", "", []), ["**Read the notes**"]);
  assert.deepEqual(assistantThinkingUpdates(first + "**Check the", "", []), ["**Read the notes**", "**Check the"]);
  assert.deepEqual(assistantThinkingUpdates(first + "**Check the scan**", "", []), ["**Read the notes**", "**Check the scan**"]);
});
