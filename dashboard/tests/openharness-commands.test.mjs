import test from "node:test";
import assert from "node:assert/strict";
import {
  mcpToolSelection,
  resolveCommandMessage,
} from "../src/lib/openharness/commands.ts";

test("MCP selection changes only real MCP namespaces", () => {
  const selection = mcpToolSelection(
    {
      tools: [
        "read",
        "apply_patch",
        "garden_search",
        "capability_gap",
        "alpha_lookup",
        "beta_write",
      ],
      mcp: { alpha: { status: "connected" }, beta: { status: "connected" } },
    },
    "alpha",
  );
  assert.deepEqual(selection.selected, ["alpha_lookup"]);
  assert.deepEqual(selection.tools, { alpha_lookup: true, beta_write: false });
});

test("plain messages pass through unchanged", async () => {
  const result = await resolveCommandMessage(1, "inspect the repository");
  assert.equal(result.text, "inspect the repository");
  assert.deepEqual(result.invocations, []);
});

test("a prompt token resolves server-side and preserves user text", async () => {
  const result = await resolveCommandMessage(
    1,
    "/prompt:study-guide focus on chapter two",
  );
  assert.match(result.text, /Server-resolved prompt template: Study guide/);
  assert.match(result.text, /User request\]\nfocus on chapter two/);
  assert.deepEqual(result.invocations, [
    { kind: "prompt", slug: "study-guide", id: "dp-2" },
  ]);
});

test("malformed and conflicting slash commands are rejected clearly", async () => {
  await assert.rejects(
    () => resolveCommandMessage(1, "/prompt study"),
    /Malformed slash command/,
  );
  await assert.rejects(
    () => resolveCommandMessage(1, "/prompt:study-guide /skill:test do it"),
    /cannot be combined/,
  );
});

test("anonymous Quartz readers cannot invoke an MCP connection by guessing its slug", async () => {
  await assert.rejects(
    () => resolveCommandMessage(null, "/mcp:gbrain recall this"),
    /Sign in/,
  );
});
