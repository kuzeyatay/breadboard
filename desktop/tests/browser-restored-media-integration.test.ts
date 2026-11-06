import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

test("restarting restores loaded video tabs without autoplay and still allows manual playback", () => {
  const desktop = path.resolve(__dirname, "../..");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-restored-media-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    // A silent audio track exercises audible-media policy without making noise.
    const video = spawnSync(require("ffmpeg-static") as string, [
      "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=64x36:r=5",
      "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", "2",
      "-c:v", "libvpx", "-c:a", "libopus", path.join(dir, "video.webm"),
    ], { encoding: "utf8", windowsHide: true, timeout: 15_000 });
    assert.equal(video.error, undefined, video.error?.message);
    assert.equal(video.status, 0, video.stderr);
    for (const phase of ["save", "restore"]) {
      const result = spawnSync(require("electron") as string, [
        path.join(desktop, "tests/fixtures/browser-restored-media.cjs"), dir, phase,
      ], { cwd: desktop, env, encoding: "utf8", windowsHide: true, timeout: 45_000 });
      assert.equal(result.error, undefined, `${phase}: ${result.error?.message}`);
      assert.equal(result.status, 0, `${phase}: ${result.stdout}\n${result.stderr}`);
    }
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
