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

test("rejects models that are not registered with Hermes", () => {
  assert.throws(
    () => resolveHermesEngine("gpt-5", "high"),
    (error) => error?.code === "unsupported_model" && error?.status === 400,
  );
});
