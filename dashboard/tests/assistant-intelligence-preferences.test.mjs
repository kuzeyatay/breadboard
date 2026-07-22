import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-intelligence-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;

const { default: db } = await import("../src/lib/db.ts");
const {
  getOpenHarnessUserSettings,
  setOpenHarnessUserSettings,
} = await import("../src/lib/openharness/runtime-store.ts");

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

after(() => {
  db.close();
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

test("a selected intelligence mode becomes the durable user default", () => {
  db.prepare(
    "INSERT INTO users(id, username, email, password_hash) VALUES (1, 'alice', 'alice@example.test', 'x')",
  ).run();

  assert.deepEqual(getOpenHarnessUserSettings(1), {
    filesystemMode: "restricted",
    lastActiveDirectory: null,
    defaultModel: "gpt-5.6-sol",
    reasoningEffort: "high",
    intelligencePreferenceSet: false,
  });

  setOpenHarnessUserSettings(1, {
    defaultModel: "gpt-5.6-terra",
    reasoningEffort: "xhigh",
  });
  assert.deepEqual(getOpenHarnessUserSettings(1), {
    filesystemMode: "restricted",
    lastActiveDirectory: null,
    defaultModel: "gpt-5.6-terra",
    reasoningEffort: "xhigh",
    intelligencePreferenceSet: true,
  });

  setOpenHarnessUserSettings(1, { filesystemMode: "full" });
  const restored = getOpenHarnessUserSettings(1);
  assert.equal(restored.defaultModel, "gpt-5.6-terra");
  assert.equal(restored.reasoningEffort, "xhigh");
  assert.equal(restored.intelligencePreferenceSet, true);
});

test("every dashboard chat surface consumes the shared intelligence preference", () => {
  for (const file of [
    "../src/app/components/openharness/dashboard-agent-terminal.tsx",
    "../src/app/components/openharness/garden-agent-chat.tsx",
    "../src/app/components/knowledge-terminal.tsx",
    "../src/app/garden/garden-assistant.tsx",
    "../src/app/gardens/[clusterSlug]/workspace-client.tsx",
  ]) {
    const contents = source(file);
    assert.match(contents, /useAssistantIntelligence\(\)/, file);
    assert.doesNotMatch(contents, /useState(?:<[^>]+>)?\(DEFAULT_MODEL\)/, file);
    assert.doesNotMatch(contents, /useState(?:<[^>]+>)?\(DEFAULT_ASSISTANT_REASONING_EFFORT\)/, file);
  }
});

test("preferences survive reloads locally, sync to the account, and reach Quartz", () => {
  const hook = source("../src/app/components/use-assistant-intelligence.ts");
  const route = source("../src/app/api/assistant-preferences/route.ts");
  const quartz = source("../../quartz/quartz/components/scripts/breadboardAI.inline.ts");

  assert.match(hook, /breadboard:assistant-model/);
  assert.match(hook, /breadboard:assistant-reasoning-effort/);
  assert.match(hook, /localStorage\.setItem/);
  assert.match(hook, /method: "PATCH"/);
  assert.match(route, /intelligencePreferenceSet/);
  assert.match(route, /setOpenHarnessUserSettings/);
  assert.match(quartz, /api\/assistant-preferences/);
  assert.match(quartz, /saveIntelligencePreference/);
  assert.match(quartz, /localStorage\.setItem\(ASSISTANT_EFFORT_STORAGE_KEY/);
});
