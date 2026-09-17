import test from "node:test";
import assert from "node:assert/strict";
import {
  HERMES_CHATMOCK_PROVIDER_ID,
  resolveHermesEngine,
} from "../src/lib/hermes/model-selection.ts";

test("uses the UI-selected model and reasoning effort", () => {
  for (const modelID of ["gpt-6-astra", "gpt-5.6-terra"]) {
    const engine = resolveHermesEngine(modelID, "max");
    assert.deepEqual(engine.model, {
      providerID: HERMES_CHATMOCK_PROVIDER_ID,
      modelID,
    });
    assert.equal(engine.selectedModelID, modelID);
    assert.equal(engine.variant, "max");
    assert.equal(engine.adjusted, false);
  }
});

test("maps max to xhigh when the selected model does not support max", () => {
  const engine = resolveHermesEngine("gpt-5.5", "max");
  assert.equal(engine.requestedReasoningEffort, "max");
  assert.equal(engine.variant, "xhigh");
  assert.equal(engine.adjusted, true);
});

test("uses the Hermes defaults when a legacy client omits both selections", () => {
  const engine = resolveHermesEngine(undefined, undefined);
  assert.equal(engine.model.modelID, "gpt-5.6-sol");
  assert.equal(engine.variant, "high");
});

test("a cleared profile default fails inherited turns but permits explicit models", () => {
  for (const model of [undefined, null, "", "none"]) {
    assert.throws(() => resolveHermesEngine(model, "high", "none"),
      error => error?.code === "default_model_required" && error?.status === 400);
  }
  assert.equal(resolveHermesEngine("gpt-6-astra", "high", "none").selectedModelID, "gpt-6-astra");
  assert.equal(resolveHermesEngine(undefined, "high", "gpt-5.5").selectedModelID, "gpt-5.5");
  const inheritedProvider = resolveHermesEngine(undefined, "high", "cliproxy/claude-opus-5");
  assert.equal(inheritedProvider.model.modelID, "chat");
  assert.equal(inheritedProvider.selectedModelID, "cliproxy/claude-opus-5");
});

test("a provider-prefixed pick travels as the chat sentinel, never as default", () => {
  // Hermes cannot name `cliproxy/...`, so the pick rides a sentinel. It must
  // be `chat`: `default` is the background model the profile page owns, and
  // routing a conversation through it used to drag Learn and every council
  // onto whatever model was picked for that one chat.
  const engine = resolveHermesEngine("cliproxy/gemini-3.6-flash-high", "max");
  assert.equal(engine.model.modelID, "chat");
  assert.equal(engine.selectedModelID, "cliproxy/gemini-3.6-flash-high");
  // The sentinel stands for a model whose depth ChatMock clamps itself.
  assert.equal(engine.variant, "max");
  assert.equal(engine.adjusted, false);

  const background = resolveHermesEngine("default", "high");
  assert.equal(background.model.modelID, "default");
});

test("rejects models that are not registered with Hermes", () => {
  assert.throws(
    () => resolveHermesEngine("gpt-5", "high"),
    (error) => error?.code === "unsupported_model" && error?.status === 400,
  );
});
