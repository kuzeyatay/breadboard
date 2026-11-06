import assert from "node:assert/strict";
import test from "node:test";

import { touchRecent, transcriptsToRelease } from "../src/lib/conversations/transcript-cache.ts";

test("keeps the most recent transcripts and releases the rest", () => {
  assert.deepEqual(transcriptsToRelease([5, 4, 3, 2, 1], new Set(), 3), [2, 1]);
  assert.deepEqual(transcriptsToRelease([1, 2], new Set(), 3), []);
});

test("never releases a pinned transcript, and pinned ones do not use up the warm slots", () => {
  // 5 is on screen and 1 is streaming: both stay, and 4, 3 still get the two warm slots.
  assert.deepEqual(transcriptsToRelease([5, 4, 3, 2, 1], new Set([5, 1]), 2), [2]);
  assert.deepEqual(transcriptsToRelease([5, 4], new Set([5, 4]), 0), []);
});

test("touching a chat moves it to the front without duplicating it", () => {
  assert.deepEqual(touchRecent([3, 2, 1], 1), [1, 3, 2]);
  assert.deepEqual(touchRecent([], 7), [7]);
});

test("Garden Chat never writes a transcript it has not loaded", async () => {
  const fs = await import("node:fs");
  const workspace = fs.readFileSync(new URL("../src/app/gardens/[clusterSlug]/workspace-client.tsx", import.meta.url), "utf8");
  const persist = workspace.slice(workspace.indexOf("async function persistChatSession("), workspace.indexOf("const saveFailureLabel"));
  // The PATCH replaces every saved message, so a save from an unloaded
  // (empty) local copy would erase the chat on the server.
  assert.match(persist, /if \(!loadedTranscriptsRef\.current\.has\(sessionId\)\)/);
  assert.match(workspace, /const fetchChatSessions = useCallback[\s\S]{0,400}summary: "1"/, "opening a Garden reads chat rows, not every transcript");
});
