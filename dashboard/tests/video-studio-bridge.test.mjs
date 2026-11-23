import test from "node:test";
import assert from "node:assert/strict";
import { callStudio, completeCall, takeCalls, withoutMediaBytes } from "../src/lib/timeline-studio/bridge.ts";
import { markStudioSeen, studioClosed, videoStudioContext } from "../src/lib/timeline-studio/context.ts";

test("a call waits for the open page, which runs it and answers", async () => {
  const user = 9001;
  studioClosed(user);
  await assert.rejects(callStudio(user, "timeline_project_inspect", {}), /not open/);

  const polled = takeCalls(user, 2_000); // the page's long poll also marks it open
  const answer = callStudio(user, "timeline_project_inspect", { a: 1 });
  const calls = await polled;
  assert.deepEqual(calls.map(({ name, args }) => [name, args]), [["timeline_project_inspect", { a: 1 }]]);
  assert.equal(completeCall(user, calls[0].id, { result: { ok: true, stateToken: "s1" } }), true);
  assert.deepEqual(await answer, { ok: true, stateToken: "s1" });
  assert.equal(completeCall(user, calls[0].id, { result: {} }), false, "an answer counts once");

  const failing = callStudio(user, "timeline_edit_apply", {});
  const [call] = await takeCalls(user, 2_000);
  completeCall(user, call.id, { error: "Stale previewId" });
  await assert.rejects(failing, /Stale previewId/);
  studioClosed(user);
});

test("review media stays out of the model's context, and Bread is told where the studio is", () => {
  const cleaned = withoutMediaBytes({ frames: [{ time: 1, image: `data:image/jpeg;base64,${"A".repeat(4096)}` }], ok: true });
  assert.match(cleaned.frames[0].image, /^\[image\/jpeg, 3 KiB, shown in Video Studio\]$/);
  assert.equal(cleaned.ok, true);

  studioClosed(7);
  assert.match(videoStudioContext(7), /not open right now/);
  markStudioSeen(7, { artifactId: "art-1", conversationId: "c", title: "Trip" });
  assert.match(videoStudioContext(7), /open right now, opened on the video artifact "Trip" \(art-1\)/);
  assert.match(videoStudioContext(7), /mcp_call connection="video-studio"/);
  studioClosed(7);
});
