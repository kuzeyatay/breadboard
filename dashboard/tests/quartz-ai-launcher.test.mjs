import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");
const assistant = read("src/app/garden/garden-assistant.tsx");
const assistantSwitch = read(
  "src/app/components/hermes/garden-assistant-switch.tsx",
);
const sessionsRoute = read("src/app/api/chat-sessions/route.ts");
const database = read("src/lib/db.ts");
const gardenClient = read("src/app/garden/[clusterSlug]/garden-client.tsx");
const libraryClient = read("src/app/garden/library-garden-client.tsx");
const gardenAdapter = read("src/lib/hermes/garden-chat-adapter.ts");
const quartzHighlighter = read(
  "../quartz/quartz/components/scripts/highlighter.inline.ts",
);

test("garden routes always render one stable Assistant", () => {
  assert.match(assistantSwitch, /return <GardenAssistant \{\.\.\.props\} \/>/);
  assert.doesNotMatch(
    assistantSwitch,
    /GardenAgentChat|hermes\/health|useState|useEffect/,
  );
});

test("the sole garden launcher and panel use the Assistant identity", () => {
  assert.match(assistant, />Assistant<\/p>/);
  assert.match(assistant, />\s*Assistant\s*<\/button>/);
  assert.doesNotMatch(assistant, />Quartz AI<\/p>/);
  assert.doesNotMatch(assistant, /Ask map|Ask this garden/);
});

test("Assistant history is separate from Garden Chat history", () => {
  assert.match(assistant, /historySurface=assistant/);
  assert.match(assistant, /historySurface:\s*'assistant'/);
  assert.match(sessionsRoute, /cs\.history_surface = \?/);
  assert.match(sessionsRoute, /history_surface\) VALUES \(\?, \?, \?, \?\)/);
  assert.match(database, /"chat_sessions",\s*\n\s*"history_surface"/);
});

test("chat bubbles do not repeat You and Assistant speaker labels", () => {
  assert.doesNotMatch(
    assistant,
    /message\.role === 'user' \? 'You' : 'Assistant'/,
  );
});

test("Quartz Ask here bridges the highlighted excerpt into the sole Assistant", () => {
  assert.match(quartzHighlighter, /second-brain:assistant-ask-here/);
  assert.match(quartzHighlighter, /window\.parent\.postMessage/);
  assert.match(quartzHighlighter, /DEFAULT_HIGHLIGHT_COLOR/);
  assert.match(gardenClient, /quartzAssistantSelectionRequest\(data\)/);
  assert.match(libraryClient, /quartzAssistantSelectionRequest\(data\)/);
  assert.match(assistant, /selectedTextRequest/);
  assert.match(assistant, />Ask here<\/p>/);
  assert.match(assistant, /selectedText,/);
  assert.match(gardenAdapter, /selectedTextContext\(payload\.selectedText\)/);
  assert.match(
    gardenAdapter,
    /JSON\.stringify\(\{ highlightedText: selectedText \}\)/,
  );
});
