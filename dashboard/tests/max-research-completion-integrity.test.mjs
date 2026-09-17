import assert from "node:assert/strict";
import test from "node:test";
import { completeText } from "../src/lib/max-research/completion.ts";

test("a length-truncated answer cannot pass as a completed research report", async () => {
  let calls = 0;
  await assert.rejects(completeText({
    baseUrl:"http://test.invalid",model:"test",reasoningEffort:"medium",prompt:"Test",
    fetchImpl:async () => { calls++; return Response.json({choices:[{finish_reason:"length",message:{content:"A report that stops halfway"}}]}); },
  }), /truncated/);
  assert.equal(calls, 1, "Do not repeat a generation that hit its output limit unchanged");
});
