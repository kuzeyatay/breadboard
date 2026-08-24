import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const assistantSource = fs.readFileSync(
  new URL("../src/app/garden/garden-assistant.tsx", import.meta.url),
  "utf8",
);

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `expected ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `expected ${endMarker} after ${startMarker}`);
  return source.slice(start, end);
}

test("assistant planning always sends an explicit teaching-source and syllabus selection", () => {
  const learnState = sourceBetween(
    assistantSource,
    "interface AssistantLearnState",
    "interface SavedPrompt",
  );
  assert.match(learnState, /selectedSourceIds\?: string\[\]/);
  assert.match(learnState, /syllabusSourceId\?: string \| null/);

  const handler = sourceBetween(
    assistantSource,
    "async function handleAssistantLearn()",
    "const chatPanelStyle",
  );
  assert.match(
    handler,
    /const syllabusSourceId =[\s\S]*?learnState\.syllabusSourceId\.trim\(\)[\s\S]*?: null/,
  );
  assert.match(
    handler,
    /const selectedTeachingSourceIds = selectedSourceIds\.filter\([\s\S]*?sourceId !== syllabusSourceId/,
  );
  assert.match(
    handler,
    /endpoint === 'plan'[\s\S]*?includedSourceIds: selectedTeachingSourceIds,[\s\S]*?syllabusSourceId,/,
  );
});
