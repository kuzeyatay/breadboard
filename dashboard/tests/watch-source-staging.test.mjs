import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { stageWatchSource } from "../src/lib/hermes/watch-source-staging.ts";
import { resolveWatchSource } from "../src/lib/hermes/watch-service.ts";

function setup(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "watch-staging-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const workspace = path.join(base, "workspace");
  const downloads = path.join(base, "Downloads");
  const store = path.join(base, "chat-videos");
  for (const dir of [workspace, downloads, store]) fs.mkdirSync(dir, { recursive: true });
  const granted = path.join(downloads, "GGzE Demo.mp4");
  const upload = path.join(store, "vid_abc.mp4");
  const secret = path.join(base, "elsewhere.mp4");
  for (const file of [granted, upload, secret]) fs.writeFileSync(file, "video bytes");
  const deps = {
    canRead: (_userId, target) => target.startsWith(downloads),
    isOwnStoredVideo: (_userId, real) => real === fs.realpathSync.native(upload),
  };
  return { workspace, downloads, granted, upload, secret, deps };
}

test("a video in a folder the user approved is copied into the workspace for Watch", async (t) => {
  const { workspace, granted, deps } = setup(t);
  const staged = await stageWatchSource({ userId: 1, source: granted, workspaceRoot: workspace, deps });
  assert.notEqual(staged, granted);
  assert.equal(path.dirname(staged), path.join(fs.realpathSync.native(workspace), ".breadboard", "uploads"));
  assert.match(path.basename(staged), /^[0-9a-f]{12}-GGzE_Demo\.mp4$/);
  // A copy, never a link: writing in the workspace must not reach the original.
  assert.equal(fs.statSync(staged).nlink, 1);
  assert.equal(resolveWatchSource(staged, workspace), staged);
  // Staging the same file again reuses the copy.
  assert.equal(await stageWatchSource({ userId: 1, source: granted, workspaceRoot: workspace, deps }), staged);
});

test("the stored copy of the user's own upload is linked in", async (t) => {
  const { workspace, upload, deps } = setup(t);
  const staged = await stageWatchSource({ userId: 1, source: upload, workspaceRoot: workspace, deps });
  assert.notEqual(staged, upload);
  assert.equal(resolveWatchSource(staged, workspace), staged);
});

test("anything the user has not shared is left for Watch to refuse", async (t) => {
  const { workspace, secret, deps } = setup(t);
  assert.equal(await stageWatchSource({ userId: 1, source: secret, workspaceRoot: workspace, deps }), secret);
  assert.throws(() => resolveWatchSource(secret, workspace), /inside the authorized workspace/);
  assert.equal(fs.existsSync(path.join(workspace, ".breadboard")), false);
});

test("URLs, missing files, non-videos and files already inside pass through untouched", async (t) => {
  const { workspace, downloads, deps } = setup(t);
  const inside = path.join(workspace, "clip.mp4");
  fs.writeFileSync(inside, "x");
  const notes = path.join(downloads, "notes.txt");
  fs.writeFileSync(notes, "x");
  for (const source of ["https://example.com/v.mp4", path.join(downloads, "missing.mp4"), notes, inside, "clip.mp4"]) {
    assert.equal(await stageWatchSource({ userId: 1, source, workspaceRoot: workspace, deps }), source);
  }
});
