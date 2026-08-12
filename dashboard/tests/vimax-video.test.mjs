// Encoding a production into a real video file.
//
// The encoder itself is exercised against the ffmpeg this repository already
// ships; when there is none the tests say so rather than failing, because a
// machine without ffmpeg is a supported state (the film is still produced, it
// just has no MP4).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const { renderProductionVideo, resolveFfmpeg } = await import("../src/lib/vimax/video.ts");

const ffmpeg = resolveFfmpeg();

function shot(overrides = {}) {
  return {
    idx: 0,
    sceneIdx: 0,
    shotInScene: 0,
    camIdx: 0,
    isLast: false,
    visualDescription: "",
    audioDescription: "",
    firstFrame: { description: "", visibleCharacterIdxs: [], image: null },
    lastFrame: { description: "", visibleCharacterIdxs: [], image: null },
    motion: "",
    variation: "small",
    variationReason: "",
    durationSeconds: 2,
    dialogue: [],
    narration: null,
    videoPrompt: "",
    ...overrides,
  };
}

const production = {
  schemaVersion: 1,
  id: "vimax_test",
  title: "Test Film",
  logline: "",
  brief: "",
  mode: "idea2video",
  style: "watercolour",
  userRequirement: "",
  aspectRatio: "16:9",
  story: "",
  characters: [],
  scenes: [],
  shots: [],
  renderPlan: {
    imageBackend: "breadboard-provider",
    videoBackend: "none",
    videoBackendReason: "",
    totalDurationSeconds: 4,
    shotCount: 2,
    drawnFrameCount: 2,
  },
  status: "storyboarded",
  createdAt: "2026-08-05T00:00:00.000Z",
  revisions: [],
};

/** A solid-colour PNG, written by ffmpeg so the test needs no image fixture. */
async function makeFrame(directory, name, colour) {
  const { spawnSync } = await import("node:child_process");
  const file = path.join(directory, name);
  spawnSync(
    ffmpeg,
    ["-nostdin", "-y", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=${colour}:s=1280x720`, "-frames:v", "1", file],
    { windowsHide: true },
  );
  return file;
}

test("a production with no drawn frames is not filmed, and says so", async () => {
  const result = await renderProductionVideo({ production, frames: [] });
  assert.equal(result.ok, false);
  assert.match(result.reason, /nothing to encode/i);
});

test("ffmpeg is resolved from the tools this repository already ships", () => {
  // Not a hard requirement — a machine without ffmpeg still produces films —
  // but on a checkout that has the desktop shell installed it must be found,
  // because "no ffmpeg" was the wrong answer while one sat in node_modules.
  if (!ffmpeg) {
    console.log("no ffmpeg on this machine; encoder tests skipped");
    return;
  }
  assert.ok(fs.existsSync(ffmpeg), ffmpeg);
});

test("the encoded film runs for exactly as long as its storyboard says", async (t) => {
  if (!ffmpeg) return t.skip("no ffmpeg available");
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "vimax-video-test-"));
  try {
    const frames = [
      { shot: shot({ idx: 0, durationSeconds: 2, motion: "The camera pushes in." }), imagePath: await makeFrame(workspace, "a.png", "navy") },
      {
        shot: shot({
          idx: 1,
          durationSeconds: 3,
          isLast: true,
          motion: "The camera pulls out.",
          variation: "large",
          dialogue: [{ speaker: "Ada", line: "Right, then.", emotion: "dry" }],
        }),
        imagePath: await makeFrame(workspace, "b.png", "maroon"),
      },
    ];

    const result = await renderProductionVideo({ production, frames });
    assert.equal(result.ok, true, result.ok ? "" : result.reason);
    assert.equal(result.shotCount, 2);
    assert.equal(result.width, 1280);
    assert.equal(result.height, 720);
    assert.equal(result.durationSeconds, 5);

    const { spawnSync } = await import("node:child_process");
    const probe = spawnSync(ffmpeg, ["-i", result.filePath], { encoding: "utf8", windowsHide: true });
    const output = `${probe.stdout ?? ""}${probe.stderr ?? ""}`;

    // The real defect this guards: a looped still decodes at 25fps unless the
    // input rate is set, which silently made every shot 17% short and walked
    // the subtitles out of sync with the picture.
    assert.match(output, /Duration: 00:00:05\.0/, output.slice(0, 600));
    assert.match(output, /Video: h264/);
    assert.match(output, /1280x720/);
    // Dialogue travels as a subtitle track, so the words are in the file.
    assert.match(output, /Subtitle: mov_text/);

    fs.rmSync(result.workspace, { recursive: true, force: true });
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("a vertical production is encoded in its own aspect ratio", async (t) => {
  if (!ffmpeg) return t.skip("no ffmpeg available");
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "vimax-video-test-"));
  try {
    const result = await renderProductionVideo({
      production: { ...production, aspectRatio: "9:16" },
      frames: [{ shot: shot({ durationSeconds: 1 }), imagePath: await makeFrame(workspace, "a.png", "teal") }],
    });
    assert.equal(result.ok, true, result.ok ? "" : result.reason);
    assert.equal(result.width, 720);
    assert.equal(result.height, 1280);
    fs.rmSync(result.workspace, { recursive: true, force: true });
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
