import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-intelligence-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;

const { default: db } = await import("../src/lib/db.ts");
const {
  getHermesUserSettings,
  setHermesUserSettings,
} = await import("../src/lib/hermes/runtime-store.ts");

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

  assert.deepEqual(getHermesUserSettings(1), {
    filesystemMode: "restricted",
    lastActiveDirectory: null,
    defaultModel: "gpt-5.6-sol",
    reasoningEffort: "high",
    reasoningEffortByModel: {},
    intelligencePreferenceSet: false,
    autonomyTier: "autonomous",
    // "Rewrite naturally" as a standing preference. Off until asked for: it
    // rewrites what Breadboard says.
    humanizerAuto: false,
  });

  setHermesUserSettings(1, {
    defaultModel: "gpt-5.6-terra",
    reasoningEffort: "xhigh",
  });
  assert.deepEqual(getHermesUserSettings(1), {
    filesystemMode: "restricted",
    lastActiveDirectory: null,
    defaultModel: "gpt-5.6-terra",
    reasoningEffort: "xhigh",
    reasoningEffortByModel: { "gpt-5.6-terra": "xhigh" },
    intelligencePreferenceSet: true,
    autonomyTier: "autonomous",
    // Choosing a model or an effort must not disturb the rewriting preference.
    humanizerAuto: false,
  });

  setHermesUserSettings(1, { filesystemMode: "full" });
  const restored = getHermesUserSettings(1);
  assert.equal(restored.defaultModel, "gpt-5.6-terra");
  assert.equal(restored.reasoningEffort, "xhigh");
  assert.equal(restored.intelligencePreferenceSet, true);
});

test("the effort is remembered per model, so a shallower model cannot erase it", () => {
  // A model whose ladder stops lower clamps the selection down. Without a
  // per-model record that clamp would silently become the choice for the model
  // it was never made on.
  setHermesUserSettings(1, { defaultModel: "gpt-5.6-sol", reasoningEffort: "max" });
  setHermesUserSettings(1, { defaultModel: "cliproxy/claude-opus-5" });
  setHermesUserSettings(1, { reasoningEffort: "high" });

  const onClaude = getHermesUserSettings(1);
  assert.equal(onClaude.defaultModel, "cliproxy/claude-opus-5");
  assert.equal(onClaude.reasoningEffort, "high");
  assert.equal(onClaude.reasoningEffortByModel["gpt-5.6-sol"], "max");

  // Coming back restores the depth chosen there, not the clamped one.
  const back = setHermesUserSettings(1, { defaultModel: "gpt-5.6-sol" });
  assert.equal(back.reasoningEffort, "max");
  assert.equal(getHermesUserSettings(1).reasoningEffort, "max");

  // A model never chosen before keeps whatever is active rather than resetting.
  const fresh = setHermesUserSettings(1, { defaultModel: "gpt-5.6-luna" });
  assert.equal(fresh.reasoningEffort, "max");
});

test("the picker is handed the whole per-model record, not just the active pair", () => {
  const hook = source("../src/app/components/use-assistant-intelligence.ts");
  const route = source("../src/app/api/assistant-preferences/route.ts");
  assert.match(route, /reasoningEffortByModel: settings\.reasoningEffortByModel/);
  // Selecting a model applies its remembered depth in the same request, so the
  // model and the effort can never land out of order.
  assert.match(hook, /const restored = rememberedEfforts\.current\[normalized\]/);
  assert.match(
    hook,
    /persist\(restored \? \{ model: normalized, reasoningEffort: restored \} : \{ model: normalized \}\)/,
  );
  assert.match(hook, /remember\(model, value\)/);
});

test("every dashboard chat surface consumes the shared intelligence preference", () => {
  for (const file of [
    "../src/app/components/hermes/dashboard-agent-terminal.tsx",
    "../src/app/components/hermes/garden-agent-chat.tsx",
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
  assert.match(hook, /patchAssistantPreferences\(value\)/);
  assert.match(route, /intelligencePreferenceSet/);
  assert.match(route, /setHermesUserSettings/);
  assert.match(quartz, /api\/assistant-preferences/);
  assert.match(quartz, /saveIntelligencePreference/);
  assert.match(quartz, /localStorage\.setItem\(ASSISTANT_EFFORT_STORAGE_KEY/);
});
