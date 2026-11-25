import { test } from "node:test";
import assert from "node:assert/strict";
import { interleaveProgressNotes } from "../src/lib/steered-response.ts";

const c = (id, offset, noteIndex) => ({ id, content: id, offset, ...(noteIndex === undefined ? {} : { noteIndex }) });
const shape = (timeline) => timeline.map((item) => item.kind === "note" ? item.text : `>${item.correction.id}`);

test("notes render in order with no steers", () => {
  const r = interleaveProgressNotes(["Plan.", "Found it."], [], "Answer.");
  assert.deepEqual(shape(r.timeline), ["Plan.", "Found it."]);
  assert.deepEqual(r.leading, []);
  assert.deepEqual(r.inline, []);
});

test("a steer sent during the second tool sits after the notes written before it", () => {
  const r = interleaveProgressNotes(["Plan.", "Checking logs.", "Only auth then."], [c("s1", 0, 2)], "Done.");
  assert.deepEqual(shape(r.timeline), ["Plan.", "Checking logs.", ">s1", "Only auth then."]);
});

test("a steer before any note, or from an older row, keeps its place above the response", () => {
  const r = interleaveProgressNotes(["Plan."], [c("early", 0, 0), c("legacy", 0)], "Done.");
  assert.deepEqual(r.leading.map((x) => x.id), ["early", "legacy"]);
  assert.deepEqual(shape(r.timeline), ["Plan."]);
});

test("a steer that split visible answer text stays in the answer", () => {
  const r = interleaveProgressNotes(["Plan."], [c("mid", 42, 1)], "Long answer");
  assert.deepEqual(r.inline.map((x) => x.id), ["mid"]);
  assert.deepEqual(shape(r.timeline), ["Plan."]);
});

test("a note index past the end clamps to after the last note", () => {
  const r = interleaveProgressNotes(["A.", "B."], [c("s", 0, 9)], "Final.");
  assert.deepEqual(shape(r.timeline), ["A.", "B.", ">s"]);
});

test("the final note is not shown twice when it became the answer", () => {
  const r = interleaveProgressNotes(["Plan.", "Stopped here."], [], "Stopped here.");
  assert.deepEqual(shape(r.timeline), ["Plan."]);
});

test("blank notes are ignored and nothing renders without notes", () => {
  const r = interleaveProgressNotes(["  ", ""], [c("s", 0, 1)], "Answer.");
  assert.deepEqual(r.timeline, []);
  assert.deepEqual(r.leading.map((x) => x.id), ["s"]);
});

test("every Hermes chat surface shows notes inline only while the turn runs", async () => {
  const fs = await import("node:fs");
  const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
  // Surfaces that render AgentRuntimePanel inherit it: terminal, side chat,
  // garden agent chat, PDF assistant.
  const panel = read("../src/app/components/hermes/agent-runtime-panel.tsx");
  assert.match(panel, /<InlineProgressNotes timeline=\{liveTimeline\} live waiting=\{awaitingSteerReply\} \/>/);
  // The streaming draft is held back until it is a note (sealed) or the answer
  // (turn over), so the answer is never shown as a dot first; it then types in.
  assert.match(panel, /const answerBody = liveDraft \? "" : responseContent;/);
  assert.match(panel, /if \(liveDraft\.trim\(\)\) holdAnswer\(heldAnswerKey\);/);
  assert.match(panel, /<TypeInAnswer id=\{heldAnswerKey\} content=\{answerBody\}>/);
  assert.doesNotMatch(panel, /text: liveDraft/);
  // The finished disclosure lists the notes, not reasoning summaries.
  assert.match(panel, /reasoning=\{intermediateResponses && thinkingUpdates\.length \? undefined : message\.reasoning\}/);
  assert.match(panel, /const progressLayout =\s*liveIntermediateTurn/);
  assert.match(panel, /progressNotes=\{liveIntermediateTurn \? \[\] : thinkingUpdates\}/);
  for (const surface of [
    "../src/app/gardens/[clusterSlug]/workspace-client.tsx",
    "../src/app/garden/garden-assistant.tsx",
    // Shared by the browser inline answer, Quartz popover and selection threads.
    "../src/app/components/chat-text-selection-ui.tsx",
  ]) {
    const source = read(surface);
    assert.match(source, /<IntermediateTurn\s+live=\{/, surface);
    // The Thinking disclosure holds the notes once the answer is in.
    assert.match(source, /progressNotes=\{hideNotes \? \[\] : /, surface);
  }
  const quartz = read("../../quartz/quartz/components/scripts/breadboardAI.inline.ts");
  assert.match(quartz, /insertProgressNote\(assistantEl, event\.payload\.text\)/);
  // Finished turns move their notes into the activity panel.
  assert.match(quartz, /status: "note"/);
  assert.doesNotMatch(quartz, /entry\.metadata\?\.progressNotes/);
});
