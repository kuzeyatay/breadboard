import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  GBRAIN_NODE_EXECUTABLE_RUNTIME,
  GBRAIN_NODE_ROOT_COMMAND,
  isRuntimeV2MigratedInventoryEntry,
  unreconciledMigratedCapabilityIds,
} from "./execution-inventory-validation.mjs";

test("Runtime V2 current ownership counts as migrated while targets and incompatibilities do not", () => {
  assert.equal(
    isRuntimeV2MigratedInventoryEntry({
      current_state: "runtime-v2_disposable_job",
    }),
    true,
  );
  assert.equal(
    isRuntimeV2MigratedInventoryEntry({
      current_state: "legacy_spawn;runtime-v2_incompatible_escape_risk",
    }),
    false,
  );
  assert.equal(
    isRuntimeV2MigratedInventoryEntry({
      current_state: "runtime-v2_job_not_cut_over",
    }),
    false,
  );
});

test("a migrated entry cannot retain an inventory-only capability ID", () => {
  const entry = {
    current_state: "runtime-v2_service_migrated",
    capability_ids: ["surface:garden-chat", "tool-family:unreconciled"],
  };
  assert.deepEqual(
    unreconciledMigratedCapabilityIds(entry, new Set(["surface:garden-chat"])),
    ["tool-family:unreconciled"],
  );
});

test("GBrain execution inventory names the exact bundled-Node launch boundary", () => {
  const inventory = JSON.parse(
    fs.readFileSync(path.join(import.meta.dirname, "execution-inventory.json"), "utf8"),
  );
  const gbrain = inventory.entries.find(({ runtime_id }) => runtime_id === "service:gbrain");
  assert.ok(gbrain);
  assert.equal(gbrain.executable_runtime, GBRAIN_NODE_EXECUTABLE_RUNTIME);
  assert.equal(gbrain.root_command, GBRAIN_NODE_ROOT_COMMAND);
  assert.doesNotMatch(`${gbrain.executable_runtime}\n${gbrain.root_command}`, /\bbun\b|server\.ts/iu);
});
