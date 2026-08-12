// End-to-end production run with the model call stubbed.
//
// Everything between the stub and the finished film is the real code path: the
// story is written, cut into scenes, cast, storyboarded scene by scene, every
// shot decomposed into first frame / motion / last frame, and the storyboard
// drawn. The stub answers by tool name rather than in sequence, because scenes
// and shots are processed concurrently and a positional queue would only pass
// by accident.

import assert from "node:assert/strict";
import test from "node:test";

const { produceFilm } = await import("../src/lib/vimax/pipeline.ts");
const { parseVimaxRequest } = await import("../src/lib/vimax/identity.ts");
const { parseStoredProduction } = await import("../src/lib/vimax/schemas.ts");

const STORY = {
  title: "The Last Umbrella",
  logline: "Two rivals must share one umbrella to cross a flooded city.",
  story: "Ada and Bo run the only two market stalls on Quay Street...",
  style: "Cartoon",
};

const SCRIPT_DESCRIPTION = {
  title: "Quay Street",
  logline: "Two stallholders, one umbrella.",
  style: "Cartoon",
};

const SCENES = {
  scenes: [
    {
      heading: "EXT. QUAY STREET - DAY",
      location: "Quay Street market",
      timeOfDay: "DAY",
      atmosphere: "Grey light, rain hammering the awnings.",
      script: "<Ada> hauls a crate under the awning. <Bo> watches from across the lane.",
    },
    {
      heading: "EXT. QUAY STREET - LATER",
      location: "Quay Street market",
      timeOfDay: "DUSK",
      atmosphere: "The rain thins; puddles hold the last of the light.",
      script: "<Bo> holds the umbrella over <Ada>'s crate.\n<Bo>: Move, then. Before it turns.",
    },
  ],
};

const CHARACTERS = {
  characters: [
    {
      identifier: "Ada",
      isVisible: true,
      staticFeatures: "Short, broad-shouldered, cropped grey hair, deep-set brown eyes.",
      dynamicFeatures: "A patched yellow oilskin and fingerless gloves.",
    },
    {
      identifier: "Bo",
      isVisible: true,
      staticFeatures: "Tall and narrow, long black plait, a scar through one eyebrow.",
      dynamicFeatures: "A green quilted coat, sleeves pushed up.",
    },
    {
      identifier: "The radio",
      isVisible: false,
      staticFeatures: "",
      dynamicFeatures: null,
    },
  ],
};

const STORYBOARD = {
  shots: [
    {
      camIdx: 0,
      visualDescription: "Wide shot of the market. <Ada> is on the left, facing right.",
      audioDescription: "[Sound Effect] Rain on canvas awnings",
      durationSeconds: 6,
      dialogue: [],
      narration: null,
    },
    {
      camIdx: 1,
      visualDescription: "Medium shot on <Bo>, facing left, watching across the lane.",
      audioDescription: "[Speaker] Bo (flat): Move, then.",
      durationSeconds: 4,
      dialogue: [{ speaker: "Bo", line: "Move, then.", emotion: "flat" }],
      narration: null,
    },
  ],
};

const DECOMPOSITION = {
  firstFrameDescription: "Wide shot at eye level; a figure in a yellow oilskin stands left of frame, facing right.",
  firstFrameCharacterIdxs: [0],
  lastFrameDescription: "The same wide shot; the figure has moved to centre frame, facing camera.",
  lastFrameCharacterIdxs: [0],
  motion: "The camera pushes in slowly as the figure in the yellow oilskin walks to centre frame.",
  variation: "medium",
  variationReason: "The subject crosses the frame and turns to face the camera.",
};

/** Answer whichever crew role the pipeline is asking for. */
function stubModel(overrides = {}) {
  const byTool = {
    submit_story: STORY,
    submit_script_description: SCRIPT_DESCRIPTION,
    submit_scenes: SCENES,
    submit_characters: CHARACTERS,
    submit_storyboard: STORYBOARD,
    submit_shot_decomposition: DECOMPOSITION,
    ...overrides,
  };
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    const name = body.tool_choice.function.name;
    calls.push({ name, body });
    return new Response(
      JSON.stringify({
        choices: [
          { message: { tool_calls: [{ function: { arguments: JSON.stringify(byTool[name]) } }] } },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

async function produce(brief, { drawImage, overrides, previousFilm } = {}) {
  const stub = stubModel(overrides);
  const events = [];
  const drawn = [];
  try {
    const production = await produceFilm({
      request: parseVimaxRequest(brief),
      ...(previousFilm ? { previousFilm } : {}),
      target: {
        baseUrl: "http://127.0.0.1:9/v1",
        model: "test-model",
        signal: new AbortController().signal,
      },
      hooks: {
        emit: (type, payload) => events.push({ type, payload }),
        signal: new AbortController().signal,
        ...(drawImage === null
          ? {}
          : {
              drawImage: async (input) => {
                drawn.push(input);
                if (drawImage) return drawImage(input);
                return {
                  ok: true,
                  image: { artifactId: `art_${drawn.length}`, width: 1280, height: 720 },
                };
              },
            }),
      },
    });
    return { production, events, drawn, calls: stub.calls };
  } finally {
    stub.restore();
  }
}

test("a run produces a complete, storable film", async () => {
  const { production, events } = await produce("Two rivals share the last umbrella");

  assert.equal(production.title, "The Last Umbrella");
  assert.equal(production.style, "Cartoon");
  assert.equal(production.mode, "idea2video");
  assert.equal(production.scenes.length, 2);
  assert.equal(production.characters.length, 3);

  // Two scenes storyboarded at two shots each, flattened into one film.
  assert.equal(production.shots.length, 4);
  assert.deepEqual(production.shots.map((shot) => shot.idx), [0, 1, 2, 3]);
  assert.deepEqual(production.shots.map((shot) => shot.sceneIdx), [0, 0, 1, 1]);
  assert.deepEqual(production.shots.map((shot) => shot.shotInScene), [0, 1, 0, 1]);
  // Exactly one shot ends the film.
  assert.deepEqual(production.shots.map((shot) => shot.isLast), [false, false, false, true]);
  assert.equal(production.scenes.at(-1).isLast, true);

  // The stage order the run card lamps up. Per-scene and per-image progress
  // events are dropped here; they are counters, not stages.
  const types = events.map((event) => event.type);
  assert.deepEqual(
    types.filter((type) => !type.endsWith(".drawn") && type !== "storyboard.scene"),
    [
      "story.started",
      "story.completed",
      "scenes.started",
      "scenes.completed",
      "characters.started",
      "characters.completed",
      "storyboard.started",
      "frames.started",
      "frames.completed",
      "portraits.started",
      "portraits.completed",
      "storyboardFrames.started",
      "storyboardFrames.completed",
    ],
    JSON.stringify(types),
  );

  // The film is only real if it survives the artifact boundary.
  const stored = parseStoredProduction(JSON.parse(JSON.stringify(production)));
  assert.equal(stored.ok, true, stored.ok ? "" : `${stored.error} ${stored.issues.join("; ")}`);
});

test("every shot carries the prompt a video model would render it from", async () => {
  const { production } = await produce("Two rivals share the last umbrella");
  for (const shot of production.shots) {
    assert.match(shot.videoPrompt, /Cartoon style/);
    assert.match(shot.videoPrompt, /Start frame:/);
    assert.match(shot.videoPrompt, /Motion:/);
    assert.match(shot.videoPrompt, /End frame:/);
    assert.equal(shot.firstFrame.description, DECOMPOSITION.firstFrameDescription);
    assert.equal(shot.variation, "medium");
  }
  // Runtime is the sum of the storyboard's own durations, not a guess.
  assert.equal(production.renderPlan.totalDurationSeconds, 6 + 4 + 6 + 4);
});

test("characters who are never seen are never drawn", async () => {
  const { production, drawn } = await produce("Two rivals share the last umbrella");
  const portraits = drawn.filter((entry) => entry.kind === "portrait");
  assert.deepEqual(
    portraits.map((entry) => entry.title),
    ["Ada — reference portrait", "Bo — reference portrait"],
  );
  const radio = production.characters.find((character) => character.identifier === "The radio");
  assert.equal(radio.portrait, null);
  assert.equal(radio.dynamicFeatures, null);
});

test("a frame with one subject is drawn from that character's portrait", async () => {
  const { drawn } = await produce("Two rivals share the last umbrella");
  const frames = drawn.filter((entry) => entry.kind === "frame");
  assert.equal(frames.length, 4);
  // The decomposition puts only character 0 (Ada) in frame, so her portrait —
  // the first image drawn — is the reference every frame is edited from.
  for (const frame of frames) {
    assert.equal(frame.referenceArtifactId, "art_1");
    assert.match(frame.prompt, /Cartoon style, 16:9 aspect ratio/);
    assert.match(frame.prompt, /Ada: Short, broad-shouldered/);
  }
});

test("a film whose frames cannot be drawn is still a film", async () => {
  const { production, events } = await produce("Two rivals share the last umbrella", {
    drawImage: async () => ({
      ok: false,
      reason: "The image provider's usage limit has been reached.",
      exhausted: false,
    }),
  });
  assert.equal(production.renderPlan.drawnFrameCount, 0);
  assert.equal(production.renderPlan.imageBackend, "none");
  assert.equal(production.status, "planned");
  assert.equal(production.shots.length, 4);
  assert.ok(production.shots.every((shot) => shot.firstFrame.image === null));
  assert.ok(events.some((event) => event.type === "storyboardFrames.completed"));
});

test("--no-images skips drawing entirely and says why", async () => {
  const { production, drawn } = await produce("A silent film about a clock --no-images");
  assert.equal(drawn.length, 0);
  assert.equal(production.renderPlan.drawnFrameCount, 0);
  assert.match(production.renderPlan.imageBackendReason, /--no-images/);
});

test("--script names the screenplay instead of writing a new story", async () => {
  const { production, calls } = await produce(
    "INT. KITCHEN - NIGHT\n\n<Ada> stares at the kettle. --script",
  );
  const names = calls.map((call) => call.name);
  assert.ok(names.includes("submit_script_description"));
  assert.ok(!names.includes("submit_story"), "the screenplay must not be rewritten as a story");
  assert.equal(production.mode, "script2video");
  assert.equal(production.title, "Quay Street");
  // In script mode the screenplay is the input, so no separate story is kept.
  assert.equal(production.story, "");
});

test("a stage that will not fit its schema is repaired once, then fails honestly", async () => {
  await assert.rejects(
    produce("Two rivals share the last umbrella", {
      overrides: { submit_scenes: { scenes: [] } },
    }),
    /screenplay did not match its schema|invalid_stage_output/i,
  );
});

test("the drawn film reports the backend that drew it", async () => {
  const { production } = await produce("Two rivals share the last umbrella");
  assert.equal(production.renderPlan.imageBackend, "breadboard-provider");
  assert.equal(production.renderPlan.drawnFrameCount, 4);
  assert.equal(production.status, "storyboarded");
  // Encoding happens after the pipeline, so a freshly produced film has no
  // video yet and says nothing about one it has not tried to make.
  assert.equal(production.renderPlan.videoBackend, "none");
  assert.equal(production.renderPlan.imageBackendReason, "");
});

test("a provider that has run out is asked once, not once per frame", async () => {
  let calls = 0;
  const { production, drawn, events } = await produce("Two rivals share the last umbrella", {
    drawImage: async () => {
      calls += 1;
      return {
        ok: false,
        reason: "The usage limit has been reached. It resets in about 3 days.",
        exhausted: true,
      };
    },
  });
  // One portrait attempt, then the run stops asking: 3 characters and 4 shots
  // would otherwise be 6 more calls that fail identically and slowly.
  assert.equal(calls, 1, `asked the exhausted provider ${calls} times`);
  assert.equal(drawn.length, 1);
  assert.equal(production.renderPlan.drawnFrameCount, 0);
  // And the film says why it has no pictures, rather than arriving bare.
  assert.match(production.renderPlan.imageBackendReason, /usage limit has been reached/);
  assert.match(production.renderPlan.imageBackendReason, /No frames could be drawn/);
  const unavailable = events.find((event) => event.type === "imagery.unavailable");
  assert.ok(unavailable, "the run must report that drawing became unavailable");
  assert.match(unavailable.payload.reason, /usage limit/);
});

test("a one-off refusal does not stop the rest of the storyboard", async () => {
  let calls = 0;
  const { production } = await produce("Two rivals share the last umbrella", {
    drawImage: async () => {
      calls += 1;
      return calls === 1
        ? { ok: false, reason: "That prompt was refused.", exhausted: false }
        : { ok: true, image: { artifactId: `art_${calls}`, width: 1280, height: 720 } };
    },
  });
  // The refused portrait costs one image, not the film.
  assert.equal(production.renderPlan.drawnFrameCount, 4);
  assert.match(production.renderPlan.imageBackendReason, /That prompt was refused/);
});

test("a follow-up revises the film it forks instead of writing an unrelated one", async () => {
  const previousFilm = [
    "Title: The Last Umbrella",
    "Style: Cartoon",
    "Characters:",
    "- Ada: short, grey hair",
  ].join("\n");
  const { calls, events } = await produce("make it kinder", { previousFilm });

  const story = calls.find((call) => call.name === "submit_story");
  const prompt = story.body.messages.at(-1).content;
  // The screenwriter is shown the existing film and told the new brief is a
  // change to it — otherwise the fork would store an unrelated story as the
  // next version of the old one.
  assert.match(prompt, /<EXISTING_FILM>/);
  assert.match(prompt, /The Last Umbrella/);
  assert.match(prompt, /a change to that existing film/);
  assert.match(prompt, /make it kinder/);
  assert.equal(events.find((event) => event.type === "story.started").payload.revising, true);
});

test("a first film is not told it is revising anything", async () => {
  const { calls, events } = await produce("Two rivals share the last umbrella");
  const story = calls.find((call) => call.name === "submit_story");
  assert.doesNotMatch(story.body.messages.at(-1).content, /EXISTING_FILM/);
  assert.equal(events.find((event) => event.type === "story.started").payload.revising, false);
});
