import test from "node:test";
import assert from "node:assert/strict";
import {
  OPENHARNESS_CHATMOCK_PROVIDER_ID,
  resolveOpenHarnessEngine,
} from "../src/lib/openharness/model-selection.ts";

test("uses the UI-selected model and reasoning effort", () => {
  const engine = resolveOpenHarnessEngine("gpt-5.6-terra", "max");
  assert.deepEqual(engine.model, {
    providerID: OPENHARNESS_CHATMOCK_PROVIDER_ID,
    modelID: "gpt-5.6-terra",
  });
  assert.equal(engine.variant, "max");
  assert.equal(engine.adjusted, false);
});

test("maps max to xhigh when the selected model does not support max", () => {
  const engine = resolveOpenHarnessEngine("gpt-5.5", "max");
  assert.equal(engine.requestedReasoningEffort, "max");
  assert.equal(engine.variant, "xhigh");
  assert.equal(engine.adjusted, true);
});

test("uses the OpenHarness defaults when a legacy client omits both selections", () => {
  const engine = resolveOpenHarnessEngine(undefined, undefined);
  assert.equal(engine.model.modelID, "gpt-5.6-sol");
  assert.equal(engine.variant, "high");
});

test("rejects models that are not registered with OpenHarness", () => {
  assert.throws(
    () => resolveOpenHarnessEngine("gpt-5", "high"),
    (error) => error?.code === "unsupported_model" && error?.status === 400,
  );
});
