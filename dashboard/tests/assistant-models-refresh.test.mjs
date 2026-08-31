import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

/**
 * Connecting a provider must change the model menu without an app restart.
 *
 * ChatMock re-reads `providers.json` on every request, so it serves a new
 * provider's models immediately. The pickers were the stale layer: each surface
 * fetched `/api/models` once and kept the result for the life of the page, and
 * three of them latched on a `modelsLoaded` flag so the catalog froze the first
 * time the menu was opened. Nothing invalidated any of it.
 */

const read = (relativePath) =>
  fs.readFileSync(new URL(`../src/${relativePath}`, import.meta.url), "utf8");

const hook = read("app/components/use-assistant-models.ts");

/** Every surface that renders a model picker. */
const SURFACES = [
  "app/components/knowledge-terminal.tsx",
  "app/garden/garden-assistant.tsx",
  "app/gardens/[clusterSlug]/workspace-client.tsx",
  "app/components/hermes/garden-agent-chat.tsx",
  "app/components/hermes/dashboard-agent-terminal.tsx",
];

test("the shared hook re-reads the catalog when providers change", () => {
  assert.match(hook, /ASSISTANT_MODELS_CHANGED_EVENT = "breadboard:assistant-models-changed"/);
  assert.match(hook, /export function notifyAssistantModelsChanged/);
  // A listener, not just an initial load: this is the part that removes the
  // restart.
  assert.match(hook, /addEventListener\(ASSISTANT_MODELS_CHANGED_EVENT/);
  assert.match(hook, /removeEventListener\(ASSISTANT_MODELS_CHANGED_EVENT/);
  // The refetch must not be suppressed by the first-load guard, or a menu that
  // has already been opened would keep showing the old list.
  const handler = /const handler = \(\) => void fetchModels\(true\);/;
  assert.match(hook, handler);
});

test("a failed catalog read leaves the built-in models rather than an empty menu", () => {
  assert.match(hook, /DEFAULT_ASSISTANT_MODELS/);
  assert.match(hook, /if \(ids\.length > 0\) setModels\(mergeAssistantModels\(ids\)\)/);
});

test("a one-model Google subscription catalog repairs itself after reconnect", () => {
  assert.match(hook, /googleSubscriptionCatalogLooksTruncated\(ids\)/);
  assert.match(hook, /fetch\("\/api\/cliproxy\/sync", \{ method: "POST" \}\)/);
  assert.match(hook, /invalidateAssistantModelCatalog\(\)/);
  assert.match(hook, /loadAssistantModelCatalog\(\{ force: true \}\)/);
  assert.match(hook, /\^cliproxy\\\/gemini-/);
  assert.match(hook, /\^openrouter\\\/google\\\/gemini-/);
});

test("every model picker reads the catalog from the shared hook", () => {
  for (const surface of SURFACES) {
    const source = read(surface);
    assert.match(
      source,
      /useAssistantModels\(/,
      `${surface} must source its models from useAssistantModels`,
    );
    // A private copy of the fetch would silently reintroduce the stale menu.
    assert.doesNotMatch(
      source,
      /fetch\(["']\/api\/models["']\)/,
      `${surface} must not fetch the model catalog on its own`,
    );
    assert.doesNotMatch(
      source,
      /setModelsLoaded/,
      `${surface} must not keep its own load-once latch`,
    );
  }
});

test("provider changes in settings announce the new catalog", () => {
  const settings = read("app/components/settings-providers.tsx");
  assert.match(settings, /notifyAssistantModelsChanged/);
  // Every provider mutation is funneled through the same state-application path.
  const announcements = settings.match(/notifyAssistantModelsChanged\(\)/g) ?? [];
  assert.equal(announcements.length, 1);
  assert.match(settings, /applyState\(payload as ChatmockProviderState\)[\s\S]*?notifyAssistantModelsChanged\(\)/);
});
