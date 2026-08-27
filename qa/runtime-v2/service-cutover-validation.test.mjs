import assert from "node:assert/strict";
import test from "node:test";

import { validateServiceCutover } from "./service-cutover-validation.mjs";

const evidence = {
  sources: ["src/runtime-owner.rs:1"],
  evidence: ["focused cutover test passed"],
};

test("accepts a leased service, a native schedule, and a retired coordinator split", () => {
  const result = validateServiceCutover({
    inventory: {
      entries: [
        {
          runtime_id: "service:gbrain",
          classification: "on-demand-service",
          current_owner: "breadboard-runtime",
          current_state: "runtime-v2_on-demand_cutover",
          ...evidence,
        },
        {
          runtime_id: "schedule:review",
          classification: "scheduled-service",
          current_owner: "Runtime V2 native scheduler",
          current_state: "runtime-v2_scheduled_cutover",
          ...evidence,
        },
        {
          runtime_id: "service:background-coordinator",
          classification: "scheduled-service",
          current_owner: "Rust runtime",
          current_state: "retired_after_split_into_native_schedules",
          ...evidence,
        },
      ],
    },
    serviceManifest: {
      services: [
        {
          id: "gbrain",
          startupPolicy: "on-demand",
          idleTtlMs: 600_000,
          launchProfiles: [{}],
        },
      ],
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.counts, {
    inventoryServices: 3,
    manifestServices: 1,
    completed: 3,
  });
});

test("rejects every escape hatch for an app-launched service", () => {
  const result = validateServiceCutover({
    inventory: {
      entries: [
        {
          runtime_id: "service:comfyui",
          classification: "on-demand-service",
          current_owner: "dashboard Next process",
          current_state: "not_cut_over",
          sources: [],
          evidence: [],
        },
      ],
    },
    serviceManifest: { services: [] },
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /no trusted Runtime V2 service manifest/);
  assert.match(result.errors.join("\n"), /current owner is not Runtime V2/);
  assert.match(result.errors.join("\n"), /still marked not cut over/);
  assert.match(result.errors.join("\n"), /no authoritative source evidence/);
  assert.match(result.errors.join("\n"), /no verification evidence/);
});

test("rejects eager and immortal service registrations", () => {
  const result = validateServiceCutover({
    inventory: {
      entries: [
        {
          runtime_id: "service:chatmock",
          classification: "on-demand-service",
          current_owner: "breadboard-runtime",
          current_state: "runtime-v2_cutover",
          ...evidence,
        },
      ],
    },
    serviceManifest: {
      services: [
        {
          id: "chatmock",
          startupPolicy: "eager",
          idleTtlMs: null,
          launchProfiles: [{}],
        },
      ],
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /not genuinely on-demand/);
  assert.match(result.errors.join("\n"), /no positive idle TTL/);
});

test("includes core services and requires their eager non-expiring policy", () => {
  const result = validateServiceCutover({
    inventory: {
      entries: [
        {
          runtime_id: "service:dashboard",
          classification: "core",
          current_owner: "breadboard-runtime",
          current_state: "runtime-v2_core_cutover",
          current_memory_baseline_mb: 128,
          measured_peak_mb: 192,
          memory_metric: "Windows process private bytes",
          ...evidence,
        },
      ],
    },
    serviceManifest: {
      services: [
        {
          id: "dashboard",
          startupPolicy: "eager",
          idleTtlMs: null,
          launchProfiles: [{}],
        },
      ],
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.counts.inventoryServices, 1);
  assert.equal(result.counts.completed, 1);
});

test("rejects an unmeasured permanent core service", () => {
  const result = validateServiceCutover({
    inventory: {
      entries: [
        {
          runtime_id: "service:dashboard",
          classification: "core",
          current_owner: "breadboard-runtime",
          current_state: "runtime-v2_core_cutover",
          current_memory_baseline_mb: null,
          measured_peak_mb: null,
          memory_metric: null,
          ...evidence,
        },
      ],
    },
    serviceManifest: {
      services: [
        {
          id: "dashboard",
          startupPolicy: "eager",
          idleTtlMs: null,
          launchProfiles: [{}],
        },
      ],
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /no valid measured baseline\/peak memory evidence/);
  assert.equal(result.counts.completed, 0);
});

test("rejects a trusted service omitted from the execution inventory", () => {
  const result = validateServiceCutover({
    inventory: { entries: [] },
    serviceManifest: {
      services: [
        {
          id: "orphan",
          startupPolicy: "on-demand",
          idleTtlMs: 60_000,
          launchProfiles: [{}],
        },
      ],
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /manifest entry has no execution-inventory service row/);
});

test("failure-isolated manifest services remain mandatory cutover rows", () => {
  const result = validateServiceCutover({
    inventory: {
      entries: [
        {
          runtime_id: "service:gbrain",
          classification: "on-demand-service",
          current_owner: "Electron service manager",
          current_state: "legacy_electron_owned",
          ...evidence,
        },
      ],
    },
    serviceManifest: {
      services: [
        {
          id: "gbrain",
          requirement: "optional",
          startupPolicy: "on-demand",
          idleTtlMs: 600_000,
          launchProfiles: [{}],
        },
      ],
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /current owner is not Runtime V2/);
  assert.match(result.errors.join("\n"), /still marked not cut over/);
  assert.equal(result.counts.completed, 0);
});

test("accepts a scheduled service with a positive idle TTL", () => {
  const result = validateServiceCutover({
    inventory: {
      entries: [
        {
          runtime_id: "service:postiz-coordinator",
          classification: "scheduled-service",
          current_owner: "Runtime V2",
          current_state: "runtime-v2_scheduled_cutover",
          ...evidence,
        },
      ],
    },
    serviceManifest: {
      services: [
        {
          id: "postiz-coordinator",
          startupPolicy: "scheduled",
          idleTtlMs: 60_000,
          launchProfiles: [{}],
        },
      ],
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.counts.completed, 1);
});
