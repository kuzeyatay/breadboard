import test from "node:test";
import assert from "node:assert/strict";
import { issueCapabilityToken } from "../src/lib/openharness/capability-token.ts";
import { executeGardenTool } from "../src/lib/openharness/garden-tools.ts";
import { GARDEN_TOOLS } from "../src/lib/openharness/tool-scopes.ts";

function gardenToken(gardenId, tools = GARDEN_TOOLS) {
  return issueCapabilityToken({
    userId: 1,
    surface: "garden_chat",
    openHarnessSessionId: "oh1",
    gardenId,
    allowedTools: [...tools],
  });
}

test("rejects an invalid capability token", async () => {
  const result = await executeGardenTool({ rawToken: "garbage", tool: "garden_search", args: {} });
  assert.equal(result.ok, false);
  assert.match(result.error, /token/i);
});

test("rejects a tool not in the token's allowlist", async () => {
  // Token only allows garden_get_page; ask for garden_search.
  const token = gardenToken("physics", ["garden_get_page"]);
  const result = await executeGardenTool({ rawToken: token, tool: "garden_search", args: { gardenId: "physics" } });
  assert.equal(result.ok, false);
  assert.match(result.error, /not permitted/i);
});

test("rejects a garden id that differs from the token scope", async () => {
  const token = gardenToken("physics");
  // Model attempts to read a different garden by passing gardenId in args.
  const result = await executeGardenTool({
    rawToken: token,
    tool: "garden_search",
    args: { gardenId: "chemistry", query: "x" },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /not permitted/i);
});

test("a scoped token for a non-existent garden reports garden not found (not a scope escape)", async () => {
  const token = gardenToken("does-not-exist-xyz");
  const result = await executeGardenTool({
    rawToken: token,
    tool: "garden_search",
    args: { gardenId: "does-not-exist-xyz", query: "x" },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /not found/i);
});

test("shell/file/git/skill tool names are never in the garden allowlist", () => {
  for (const forbidden of ["bash", "edit", "write", "read", "webfetch", "task", "find-skills", "skill"]) {
    assert.ok(!GARDEN_TOOLS.includes(forbidden), `${forbidden} must not be a garden tool`);
  }
});
