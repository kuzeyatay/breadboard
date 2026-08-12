import test from "node:test";
import assert from "node:assert/strict";
import { issueCapabilityToken } from "../src/lib/hermes/capability-token.ts";
import { executeGardenTool } from "../src/lib/hermes/garden-tools.ts";
import { GARDEN_TOOLS, allowedToolsForSurface } from "../src/lib/hermes/tool-scopes.ts";

function gardenToken(gardenId, tools = GARDEN_TOOLS) {
  return issueCapabilityToken({
    userId: 1,
    surface: "garden_chat",
    hermesSessionId: "oh1",
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

test("the direct note writer is unreachable from public Quartz AI", async () => {
  // garden_save_note skips proposal review, so the surface that serves
  // anonymous readers must not carry it at all.
  assert.equal(allowedToolsForSurface("quartz_ai").includes("garden_save_note"), false);
  for (const surface of ["dashboard_terminal", "garden_chat"]) {
    assert.ok(allowedToolsForSurface(surface).includes("garden_save_note"), surface);
  }

  const token = issueCapabilityToken({
    userId: 1,
    surface: "quartz_ai",
    hermesSessionId: "oh-quartz",
    gardenId: "physics",
    allowedTools: allowedToolsForSurface("quartz_ai"),
  });
  const result = await executeGardenTool({
    rawToken: token,
    tool: "garden_save_note",
    args: { gardenId: "physics", title: "t", content: "c" },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /not permitted/i);
});

test("shell/file/git/skill tool names are never in the garden allowlist", () => {
  for (const forbidden of ["bash", "edit", "write", "read", "webfetch", "task", "find-skills", "skill"]) {
    assert.ok(!GARDEN_TOOLS.includes(forbidden), `${forbidden} must not be a garden tool`);
  }
});
