import test from "node:test";
import assert from "node:assert/strict";
import {
  mcpToolSelection,
  assignCommandTokens,
  resolveCommandMessage,
} from "../src/lib/hermes/commands.ts";

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
  assert.equal(result.userText, "inspect the repository");
  assert.deepEqual(result.invocations, []);
});

test("agent commands are namespaced, keep only the last selection, and preserve the user request", async () => {
  const selected = await resolveCommandMessage(
    1,
    "/agent:ux-researcher /agents:agency-agents:frontend-developer review this interface",
  );
  assert.equal(selected.text, "review this interface");
  assert.equal(selected.userText, "review this interface");
  assert.deepEqual(selected.agencyAgentSelection, {
    action: "set",
    slug: "frontend-developer",
    id: selected.invocations[0].id,
  });
  assert.deepEqual(selected.invocations.map((item) => [item.kind, item.slug]), [
    ["agent", "frontend-developer"],
  ]);

  const cleared = await resolveCommandMessage(1, "/agent:none continue normally");
  assert.deepEqual(cleared.agencyAgentSelection, { action: "clear" });
  assert.equal(cleared.userText, "continue normally");
});

test("agent-like text in prose or code is not interpreted and unknown agents are useful errors", async () => {
  const prose = "Please document `/agent:frontend-developer` without selecting it.";
  assert.equal((await resolveCommandMessage(1, prose)).text, prose);
  const code = "```\n/agent:frontend-developer\n```";
  assert.equal((await resolveCommandMessage(1, code)).text, code);
  await assert.rejects(
    () => resolveCommandMessage(1, "/agent:not-a-real-agent help"),
    /Choose one from the Agents tab or use \/agent:none/,
  );
});

test("a prompt token resolves server-side and preserves user text", async () => {
  const result = await resolveCommandMessage(
    1,
    "/prompt:study-guide focus on chapter two",
  );
  assert.match(result.text, /Server-resolved prompt: Study guide/);
  assert.match(result.text, /User request\]\nfocus on chapter two/);
  assert.deepEqual(result.invocations, [
    { kind: "prompt", slug: "study-guide", id: "dp-2" },
  ]);
});

test("malformed and conflicting slash commands are rejected clearly", async () => {
  await assert.rejects(
    () => resolveCommandMessage(1, "/prompt study"),
    /unavailable in the current surface or task mode/,
  );
  await assert.rejects(
    () => resolveCommandMessage(1, "/prompt:study-guide /skill:test do it"),
    /cannot be combined/,
  );
});

test("runtime-agent commands never degrade into a generic capability error", async () => {
  await assert.rejects(
    () => resolveCommandMessage(1, "/agents:deep-research compare batteries"),
    (error) =>
      error?.code === "external_agent_dispatch_required" &&
      /chat runner/.test(error.message),
  );
});

test("clean tokens resolve and collisions receive deterministic visible namespaces", async () => {
  const result = await resolveCommandMessage(1, "/study-guide focus on chapter two");
  assert.match(result.text, /Server-resolved prompt: Study guide/);
  assert.deepEqual(
    assignCommandTokens([
      { kind: "skill", slug: "shared" },
      { kind: "prompt", slug: "shared" },
      { kind: "mcp", slug: "drive" },
      { kind: "agent", slug: "shared" },
      { kind: "agent", slug: "geographer", source: "Agency Agents" },
    ]),
    [
      { kind: "skill", slug: "shared", token: "skill-shared" },
      { kind: "prompt", slug: "shared", token: "prompt-shared" },
      { kind: "mcp", slug: "drive", token: "drive" },
      { kind: "agent", slug: "shared", token: "agent:shared" },
      {
        kind: "agent",
        slug: "geographer",
        source: "Agency Agents",
        token: "agents:agency-agents:geographer",
      },
    ],
  );
});

test("anonymous Quartz readers cannot invoke an MCP connection by guessing its slug", async () => {
  await assert.rejects(
    () => resolveCommandMessage(null, "/mcp:gbrain recall this"),
    /Sign in/,
  );
});
