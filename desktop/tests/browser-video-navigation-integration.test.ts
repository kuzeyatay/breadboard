import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

test("video navigation preserves user activation, playback position, tabs and history", () => {
  const desktop = path.resolve(__dirname, "../..");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-video-navigation-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    const video = spawnSync(require("ffmpeg-static") as string, [
      "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=64x36:r=5",
      "-t", "3", "-c:v", "libvpx", "-an", path.join(dir, "video.webm"),
    ], {encoding: "utf8", windowsHide: true, timeout: 15000});
    assert.equal(video.error, undefined, video.error?.message);
    assert.equal(video.status, 0, video.stderr);
    const result = spawnSync(require("electron") as string, [path.join(desktop, "tests/fixtures/browser-video-navigation.cjs"), dir], {
      cwd: desktop, env, encoding: "utf8", windowsHide: true, timeout: 60000,
    });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    fs.rmSync(dir, {recursive: true, force: true});
  }
});
