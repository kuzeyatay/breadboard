import test from "node:test";
import assert from "node:assert/strict";
import {
  GBRAIN_TOOLS,
  allowedToolsForSurface,
} from "../src/lib/openharness/tool-scopes.ts";

test("GBrain tools expose no write, admin, capture, delete, cron, or shell operation", () => {
  const forbidden = [
    "capture",
    "import",
    "delete",
    "edit",
    "write",
    "schema",
    "admin",
    "cron",
    "shell",
    "enrich",
    "publish",
    "mutate",
  ];
  for (const tool of GBRAIN_TOOLS) {
    for (const bad of forbidden) {
      assert.ok(!tool.includes(bad), `${tool} must not include a ${bad} operation`);
    }
  }
});

test("GBrain tools are exactly the five read-only knowledge operations", () => {
  assert.deepEqual([...GBRAIN_TOOLS].sort(), [
    "gbrain_graph_neighbors",
    "gbrain_retrieve",
    "gbrain_search",
    "gbrain_status",
    "gbrain_synthesize",
  ]);
});

test("Quartz AI never receives GBrain tools", () => {
  const tools = allowedToolsForSurface("quartz_ai");
  for (const g of GBRAIN_TOOLS) {
    assert.ok(!tools.includes(g), `quartz_ai must not expose ${g}`);
  }
});

test("GBrain tools are absent when GBrain is disabled (default)", () => {
  const prev = process.env.GBRAIN_MODE;
  delete process.env.GBRAIN_MODE;
  try {
    const garden = allowedToolsForSurface("garden_chat");
    for (const g of GBRAIN_TOOLS) assert.ok(!garden.includes(g), `${g} must be absent when disabled`);
  } finally {
    if (prev !== undefined) process.env.GBRAIN_MODE = prev;
  }
});

test("Garden Chat and Terminal receive GBrain tools only when enabled", () => {
  const prev = process.env.GBRAIN_MODE;
  process.env.GBRAIN_MODE = "preferred";
  try {
    const garden = allowedToolsForSurface("garden_chat");
    const terminal = allowedToolsForSurface("dashboard_terminal");
    for (const g of GBRAIN_TOOLS) {
      assert.ok(garden.includes(g), `garden_chat should expose ${g}`);
      assert.ok(terminal.includes(g), `terminal should expose ${g}`);
    }
    // Quartz still excluded even when enabled.
    const quartz = allowedToolsForSurface("quartz_ai");
    for (const g of GBRAIN_TOOLS) assert.ok(!quartz.includes(g));
  } finally {
    if (prev !== undefined) process.env.GBRAIN_MODE = prev;
    else delete process.env.GBRAIN_MODE;
  }
});
