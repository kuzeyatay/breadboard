import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const assistant = read("src/app/garden/garden-assistant.tsx");
const assistantSwitch = read("src/app/components/hermes/garden-assistant-switch.tsx");

test("garden routes always render one stable Quartz AI assistant", () => {
  assert.match(assistantSwitch, /return <GardenAssistant \{\.\.\.props\} \/>/);
  assert.doesNotMatch(assistantSwitch, /GardenAgentChat|hermes\/health|useState|useEffect/);
});

test("the sole garden launcher and panel use the Quartz AI identity", () => {
  assert.match(assistant, />Quartz AI<\/p>/);
  assert.match(assistant, />\s*Quartz AI\s*<\/button>/);
  assert.doesNotMatch(assistant, /Ask map|Ask this garden/);
});
