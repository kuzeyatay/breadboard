// Bread's page tools reach the AFFiNE editor open in the browser through a queue its long poll drains.
import assert from "node:assert/strict";
import test from "node:test";
import { callSpacesPageTool, completePageCall, takePageCalls } from "../src/lib/spaces/page-bridge.ts";
import { spacesPageContext } from "../src/lib/spaces/page-context.ts";

const page = { gardenId: "notes", fileId: "gf_1", title: "Plan", mode: "page" };

test("with no page open, a call fails at once with a reason Bread can act on", async () => {
  const result = await callSpacesPageTool({ userId: 41, tool: "page_read", args: {} });
  assert.equal(result.error, "spaces_page_closed");
  assert.match(spacesPageContext(41), /No Spaces page is open/);
});

test("a call is taken by the editor's poll and its answer returned to Bread", async () => {
  await takePageCalls(42, page, 1);
  assert.match(spacesPageContext(42), /"Plan" open right now/);
  const pending = callSpacesPageTool({ userId: 42, tool: "page_append", args: { markdown: "## Next" } });
  const [call] = await takePageCalls(42, page, 1000);
  assert.deepEqual([call.name, call.args], ["page_append", { markdown: "## Next" }]);
  assert.equal(completePageCall(42, call.id, { result: { version: 3 } }), true);
  assert.deepEqual(await pending, { version: 3 });
});

test("bad arguments and unknown tools never reach the page", async () => {
  await takePageCalls(43, page, 1);
  assert.equal((await callSpacesPageTool({ userId: 43, tool: "page_append", args: {} })).error, "spaces_page_argument");
  assert.equal((await callSpacesPageTool({ userId: 43, tool: "page_set_mode", args: { mode: "slides" } })).error, "spaces_page_argument");
  assert.equal((await callSpacesPageTool({ userId: 43, tool: "page_delete", args: {} })).error, "spaces_page_tool_unknown");
  assert.deepEqual(await takePageCalls(43, page, 1), []);
});

test("an editor error comes back as a tool error", async () => {
  await takePageCalls(44, page, 1);
  const pending = callSpacesPageTool({ userId: 44, tool: "page_read", args: {} });
  const [call] = await takePageCalls(44, page, 1000);
  completePageCall(44, call.id, { error: "boom" });
  assert.equal((await pending).error, "spaces_page_tool_failed");
});
