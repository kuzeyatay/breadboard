import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = (relativePath) =>
  fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const modes = await import("../src/lib/intelligence-modes.ts");
const selection = await import("../src/lib/hermes/model-selection.ts");

test("modes come from what the model reports, in ladder order", () => {
  const claude = modes.toIntelligenceModes(["high", "low", "medium"]);
  assert.deepEqual(claude.map((mode) => mode.value), ["low", "medium", "high"]);
  assert.equal(claude[0].label, "Light");

  const gpt = modes.toIntelligenceModes(["low", "medium", "high", "xhigh", "max"]);
  assert.equal(gpt.at(-1).label, "Ultra");
});

test("a model with no reasoning notion offers no modes at all", () => {
  // Showing a ladder that the model ignores is a control that silently does
  // nothing — worse than showing none.
  assert.deepEqual(modes.toIntelligenceModes([]), []);
  assert.deepEqual(modes.toIntelligenceModes(undefined), []);
  assert.deepEqual(modes.toIntelligenceModes(null), []);
  assert.deepEqual(modes.toIntelligenceModes(["nonsense", 7]), []);
});

test("switching to a weaker model clamps down instead of keeping a lie", () => {
  const claude = modes.toIntelligenceModes(["low", "medium", "high"]);
  // GPT-5.6 Ultra -> Claude, which tops out at High.
  assert.equal(modes.clampIntelligenceMode("max", claude), "high");
  assert.equal(modes.clampIntelligenceMode("xhigh", claude), "high");
  // A level the model has is left alone.
  assert.equal(modes.clampIntelligenceMode("low", claude), "low");
});

test("clamping picks the nearest weaker level, not simply the strongest", () => {
  const sparse = modes.toIntelligenceModes(["low", "high"]);
  assert.equal(modes.clampIntelligenceMode("medium", sparse), "low");
});

test("clamping a model with no modes yields nothing to select", () => {
  assert.equal(modes.clampIntelligenceMode("high", []), null);
  assert.equal(modes.defaultIntelligenceMode([]), null);
});

test("a fresh model starts on the default level when it exists", () => {
  const full = modes.toIntelligenceModes(["low", "medium", "high", "xhigh", "max"]);
  assert.equal(modes.defaultIntelligenceMode(full), "high");
  // Otherwise it falls to the nearest weaker one.
  assert.equal(modes.defaultIntelligenceMode(modes.toIntelligenceModes(["low"])), "low");
});

test("provider models reach the runtime through the default sentinel", () => {
  // The runtime cannot register every provider model, so a provider-prefixed
  // choice is sent as `default` — which ChatMock expands to the background
  // model the Intelligence menu just set to that same model.
  const engine = selection.resolveHermesEngine("anthropic/claude-opus-4-5", "high");
  assert.equal(engine.model.modelID, "default");
  assert.equal(engine.model.providerID, "chatmock");
  assert.equal(engine.selectedModelID, "anthropic/claude-opus-4-5");
});

test("an unregistered bare model is still an error, not a silent substitution", () => {
  // `gpt-5` exists in ChatMock but is not registered with the runtime.
  // Substituting the sentinel would quietly answer with a different model.
  assert.throws(
    () => selection.resolveHermesEngine("gpt-5", "high"),
    (error) => error?.code === "unsupported_model",
  );
});

test("the sentinel keeps its max reasoning variant", () => {
  // It stands in for the background model, so downgrading here would cap a
  // GPT-5.6 background model that does support max.
  const engine = selection.resolveHermesEngine("default", "max");
  assert.equal(engine.variant, "max");
  assert.equal(engine.adjusted, false);
});

test("the Intelligence menu owns the background model", () => {
  const hook = source("src/app/components/use-assistant-intelligence.ts");
  // Selecting a model there sets the global default for Hermes/TARS/OpenCode.
  assert.match(hook, /\/api\/chatmock\/default-model/);
  assert.match(hook, /clampIntelligenceMode/);

  // Settings shows it but must not offer a second, rival control.
  const settings = source("src/app/components/settings-providers.tsx");
  assert.doesNotMatch(settings, /Use this model/);
  assert.match(settings, /Intelligence menu/);
});

test("the composer renders modes from the active model", () => {
  const composer = source("src/app/components/assistant-composer.tsx");
  assert.match(composer, /intelligenceModes\?: IntelligenceMode\[\]/);
  assert.match(composer, /effortOptions\.map/);
});

test("the models API reports each model's honoured efforts", () => {
  const route = source("src/app/api/models/route.ts");
  assert.match(route, /reasoning_efforts/);
  // Provider models must survive the runtime filter, which only governs which
  // ChatGPT ids the runtime can name directly.
  assert.match(route, /model\.owned_by !== 'chatgpt'/);
});

test("an unreachable agent runtime does not hide provider models", () => {
  // The runtime knows nothing about subscription models. Letting its failure
  // fall through to the outer catch replaced the whole list with the five
  // built-in ids — which is exactly "my Claude models disappeared".
  const route = source("src/app/api/models/route.ts");
  assert.match(route, /runtimeIds = null;/);
  assert.match(route, /runtimeIds === null/);
});

test("the settings tab no longer restates the background model", () => {
  const settings = source("src/app/components/settings-providers.tsx");
  assert.doesNotMatch(settings, /Background model/);
  // …and the code that only fed that panel is gone with it.
  assert.doesNotMatch(settings, /modelChoices/);
  assert.doesNotMatch(settings, /pendingModel/);
  assert.doesNotMatch(settings, /saveDefaultModel/);
});
