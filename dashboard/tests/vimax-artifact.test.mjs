// The artifact boundary: what may be stored as a ViMax film, and what the
// viewer refuses to render.
//
// A production is the artifact's whole source, so a malformed one would play as
// an empty film that still looked authoritative. It is validated on the way in
// (the renderer) and on the way back out (the viewer).

import assert from "node:assert/strict";
import test from "node:test";

const { parseStoredProduction, vimaxProductionSchema } = await import(
  "../src/lib/vimax/schemas.ts"
);
const { VIMAX_PRODUCTION_SCHEMA_VERSION, productionDuration, shotsForScene, characterByIdx } =
  await import("../src/lib/vimax/types.ts");
const { artifactRenderer, availableArtifactRenderers } = await import(
  "../src/lib/hermes/artifact-renderers.ts"
);

const FRAME = {
  description: "Wide shot; a figure in a yellow oilskin stands left of frame.",
  visibleCharacterIdxs: [0],
  image: null,
};

const PRODUCTION = {
  schemaVersion: VIMAX_PRODUCTION_SCHEMA_VERSION,
  id: "vimax_test",
  title: "The Last Umbrella",
  logline: "Two rivals must share one umbrella.",
  brief: "Two rivals share the last umbrella",
  mode: "idea2video",
  style: "Cartoon",
  userRequirement: "",
  aspectRatio: "16:9",
  story: "Ada and Bo run the only two stalls on Quay Street...",
  characters: [
    {
      idx: 0,
      identifier: "Ada",
      isVisible: true,
      staticFeatures: "Short, cropped grey hair.",
      dynamicFeatures: "A patched yellow oilskin.",
      portrait: { artifactId: "art_1", prompt: "reference portrait", width: 1024, height: 1024 },
    },
  ],
  scenes: [
    {
      idx: 0,
      isLast: true,
      heading: "EXT. QUAY STREET - DAY",
      location: "Quay Street",
      timeOfDay: "DAY",
      atmosphere: "Grey light.",
      characterIdxs: [0],
      script: "<Ada> hauls a crate under the awning.",
    },
  ],
  shots: [
    {
      idx: 0,
      sceneIdx: 0,
      shotInScene: 0,
      camIdx: 0,
      isLast: false,
      visualDescription: "Wide shot of the market.",
      audioDescription: "[Sound Effect] Rain",
      firstFrame: { ...FRAME, image: { artifactId: "art_2", prompt: "frame", width: 1280, height: 720 } },
      lastFrame: FRAME,
      motion: "The camera pushes in.",
      variation: "small",
      variationReason: "Only the subject's position changes.",
      durationSeconds: 6,
      dialogue: [],
      narration: null,
      videoPrompt: "Cartoon style, 6 seconds.",
    },
    {
      idx: 1,
      sceneIdx: 0,
      shotInScene: 1,
      camIdx: 1,
      isLast: true,
      visualDescription: "Medium shot on the crate.",
      audioDescription: "",
      firstFrame: FRAME,
      lastFrame: FRAME,
      motion: "",
      variation: "medium",
      variationReason: "",
      durationSeconds: 4,
      dialogue: [{ speaker: "Ada", line: "Right, then.", emotion: "dry" }],
      narration: null,
      videoPrompt: "Cartoon style, 4 seconds.",
    },
  ],
  renderPlan: {
    imageBackend: "breadboard-provider",
    videoBackend: "none",
    videoBackendReason: "No video generation model is configured.",
    totalDurationSeconds: 10,
    shotCount: 2,
    drawnFrameCount: 1,
  },
  status: "storyboarded",
  createdAt: "2026-08-05T00:00:00.000Z",
  revisions: ["Two rivals share the last umbrella"],
};

test("a well-formed production is accepted and keeps its film verbatim", () => {
  const result = parseStoredProduction(PRODUCTION);
  assert.equal(result.ok, true, result.ok ? "" : result.error);
  assert.equal(result.value.title, "The Last Umbrella");
  assert.equal(result.value.shots[0].firstFrame.image.artifactId, "art_2");
  assert.equal(result.value.characters[0].portrait.artifactId, "art_1");
  assert.equal(productionDuration(result.value), 10);
  assert.equal(shotsForScene(result.value, 0).length, 2);
  assert.equal(characterByIdx(result.value, 0).identifier, "Ada");
  assert.equal(characterByIdx(result.value, 9), null);
});

test("a production from a future build is refused, not half-rendered", () => {
  const result = parseStoredProduction({ ...PRODUCTION, schemaVersion: 99 });
  assert.equal(result.ok, false);
  assert.match(result.error, /Unsupported production schema version 99/);
});

test("a production missing its shots is refused", () => {
  const { shots: _shots, ...withoutShots } = PRODUCTION;
  const result = parseStoredProduction(withoutShots);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.startsWith("shots")), result.issues.join("; "));
});

test("a shot with an unknown variation grade is refused", () => {
  const broken = structuredClone(PRODUCTION);
  broken.shots[0].variation = "enormous";
  const result = parseStoredProduction(broken);
  assert.equal(result.ok, false);
});

test("an absent portrait is null rather than missing", () => {
  const parsed = vimaxProductionSchema.safeParse({
    ...PRODUCTION,
    characters: [{ ...PRODUCTION.characters[0], portrait: undefined, dynamicFeatures: undefined }],
  });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.characters[0].portrait, null);
  assert.equal(parsed.data.characters[0].dynamicFeatures, null);
});

test("the renderer is registered and validates before it publishes", async () => {
  const renderer = artifactRenderer("vimax-production");
  assert.ok(renderer, "the vimax-production renderer must be registered");
  assert.equal(renderer.kind, "data");
  assert.equal(renderer.extension, ".json");

  assert.deepEqual(await renderer.validate(JSON.stringify(PRODUCTION)), { ok: true });

  const notJson = await renderer.validate("a film, honest");
  assert.equal(notJson.ok, false);
  assert.match(notJson.error, /valid JSON/);

  const wrongShape = await renderer.validate(JSON.stringify({ title: "nearly" }));
  assert.equal(wrongShape.ok, false);
  assert.match(wrongShape.error, /did not match its schema/);

  assert.ok(
    availableArtifactRenderers().some((entry) => entry.id === "vimax-production"),
    "the renderer must be listed as available",
  );
});

test("a film stored before video rendering existed still opens", () => {
  // The first films were written without imageBackendReason or video, and they
  // must keep opening rather than being refused for fields they could not have.
  const { imageBackendReason: _reason, video: _video, ...olderPlan } = {
    ...PRODUCTION.renderPlan,
    imageBackendReason: "",
    video: null,
  };
  const result = parseStoredProduction({ ...PRODUCTION, renderPlan: olderPlan });
  assert.equal(result.ok, true, result.ok ? "" : result.error);
  assert.equal(result.value.renderPlan.imageBackendReason, "");
  assert.equal(result.value.renderPlan.video, null);
  assert.equal(result.value.renderPlan.videoBackend, "none");
});

test("a stored film keeps the video it was encoded into", () => {
  const withVideo = {
    ...PRODUCTION,
    renderPlan: {
      ...PRODUCTION.renderPlan,
      videoBackend: "ffmpeg-animatic",
      videoBackendReason: "Encoded from the drawn frames.",
      video: {
        artifactId: "art_film",
        filename: "the-last-umbrella.mp4",
        durationSeconds: 10,
        width: 1280,
        height: 720,
        shotCount: 2,
      },
    },
  };
  const result = parseStoredProduction(withVideo);
  assert.equal(result.ok, true, result.ok ? "" : result.error);
  assert.equal(result.value.renderPlan.video.artifactId, "art_film");
  assert.equal(result.value.renderPlan.videoBackend, "ffmpeg-animatic");
});
