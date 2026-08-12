// The ViMax run as the chat surfaces see it: the events a card streams, the
// reply the transcript keeps, and what happens when the film has nowhere to be
// stored.

import assert from "node:assert/strict";
import test from "node:test";

const { startRun, getEventsSince, isTerminal, abortRun } = await import(
  "../src/lib/vimax/run-manager.ts"
);
const { parseVimaxRequest } = await import("../src/lib/vimax/identity.ts");

const STORY = {
  title: "The Last Umbrella",
  logline: "Two rivals must share one umbrella to cross a flooded city.",
  story: "Ada and Bo run the only two stalls on Quay Street...",
  style: "Cartoon",
};

const SCENES = {
  scenes: [
    {
      heading: "EXT. QUAY STREET - DAY",
      location: "Quay Street",
      timeOfDay: "DAY",
      atmosphere: "Grey light, rain on the awnings.",
      script: "<Ada> hauls a crate under the awning.",
    },
  ],
};

const CHARACTERS = {
  characters: [
    {
      identifier: "Ada",
      isVisible: true,
      staticFeatures: "Short, cropped grey hair, deep-set brown eyes.",
      dynamicFeatures: "A patched yellow oilskin.",
    },
  ],
};

const STORYBOARD = {
  shots: [
    {
      camIdx: 0,
      visualDescription: "Wide shot of the market; <Ada> left of frame, facing right.",
      audioDescription: "[Sound Effect] Rain on canvas",
      durationSeconds: 6,
      dialogue: [],
      narration: null,
    },
  ],
};

const DECOMPOSITION = {
  firstFrameDescription: "Wide shot; a figure in a yellow oilskin stands left of frame.",
  firstFrameCharacterIdxs: [0],
  lastFrameDescription: "The same shot; the figure now stands centre frame.",
  lastFrameCharacterIdxs: [0],
  motion: "The camera pushes in as the figure in the yellow oilskin crosses to centre.",
  variation: "small",
  variationReason: "Only the subject's position changes.",
};

function stubModel() {
  const byTool = {
    submit_story: STORY,
    submit_scenes: SCENES,
    submit_characters: CHARACTERS,
    submit_storyboard: STORYBOARD,
    submit_shot_decomposition: DECOMPOSITION,
  };
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const name = JSON.parse(init.body).tool_choice.function.name;
    return new Response(
      JSON.stringify({
        choices: [
          { message: { tool_calls: [{ function: { arguments: JSON.stringify(byTool[name]) } }] } },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  return () => {
    globalThis.fetch = original;
  };
}

async function runToCompletion(brief) {
  const restore = stubModel();
  try {
    const { runId } = startRun({
      userId: 1,
      conversationPublicId: "conv_not_in_this_database",
      brief,
      parsed: parseVimaxRequest(brief),
      model: "test-model",
      reasoningEffort: "medium",
      baseUrl: "http://127.0.0.1:9/v1",
    });
    const deadline = Date.now() + 20_000;
    while (!isTerminal(1, runId) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return { runId, events: getEventsSince(1, runId, 0) };
  } finally {
    restore();
  }
}

const eventOf = (events, type) => events.find((event) => event.type === type);

test("a run streams its production and ends in a completed film", async () => {
  const { events } = await runToCompletion("Two rivals share the last umbrella --no-images");
  const types = events.map((event) => event.type);

  assert.equal(types[0], "run.started");
  assert.equal(types.at(-1), "run.completed");
  for (const stage of ["story.completed", "scenes.completed", "characters.completed", "frames.completed"]) {
    assert.ok(types.includes(stage), `missing ${stage} in ${JSON.stringify(types)}`);
  }

  const completed = eventOf(events, "run.completed");
  assert.equal(completed.payload.title, "The Last Umbrella");
  assert.equal(completed.payload.sceneCount, 1);
  assert.equal(completed.payload.shotCount, 1);
  assert.equal(completed.payload.durationSeconds, 6);
  assert.deepEqual(completed.payload.headings, ["EXT. QUAY STREET - DAY"]);

  // The chat reply stays short and points at the film rather than restating it.
  assert.match(completed.payload.summary, /The Last Umbrella/);
  assert.ok(completed.payload.summary.length < 500, completed.payload.summary);
  assert.doesNotMatch(completed.payload.summary, /Wide shot|yellow oilskin/);
});

test("token usage is reported as the run spends it", async () => {
  const { events } = await runToCompletion("Two rivals share the last umbrella --no-images");
  const usageEvents = events.filter((event) => event.type === "run.usage");
  assert.ok(usageEvents.length >= 4, `expected one per model call, got ${usageEvents.length}`);
  // The totals accumulate rather than reporting each call in isolation.
  const first = usageEvents[0].payload.totalTokens;
  const last = usageEvents.at(-1).payload.totalTokens;
  assert.ok(last > first, `${last} should exceed ${first}`);
  assert.equal(eventOf(events, "run.completed").payload.usage.totalTokens, last);
});

test("without a conversation the film says so instead of pretending", async () => {
  // Artifact storage needs a conversation with a runtime session. There is none
  // in this database, so the run completes and reports the artifact's absence
  // rather than failing or claiming a film that was never stored.
  const { events } = await runToCompletion("Two rivals share the last umbrella --no-images");
  const unavailable = eventOf(events, "artifact.unavailable");
  assert.ok(unavailable);
  assert.match(unavailable.payload.reason, /could not be stored as an artifact/);
  assert.match(
    eventOf(events, "run.completed").payload.summary,
    /could not be attached to this conversation/,
  );
});

test("a run that fails reports the stage that broke it", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("upstream is down", { status: 502 });
  try {
    const { runId } = startRun({
      userId: 1,
      conversationPublicId: "conv_not_in_this_database",
      brief: "A film that cannot be written",
      parsed: parseVimaxRequest("A film that cannot be written"),
      model: "test-model",
      reasoningEffort: "medium",
      baseUrl: "http://127.0.0.1:9/v1",
    });
    const deadline = Date.now() + 20_000;
    while (!isTerminal(1, runId) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const failed = eventOf(getEventsSince(1, runId, 0), "run.failed");
    assert.ok(failed);
    assert.match(failed.payload.error, /502/);
  } finally {
    globalThis.fetch = original;
  }
});

test("a run belongs to the person who started it", () => {
  const restore = stubModel();
  try {
    const { runId } = startRun({
      userId: 1,
      conversationPublicId: "conv_not_in_this_database",
      brief: "A film",
      parsed: parseVimaxRequest("A film"),
      model: "test-model",
      reasoningEffort: "medium",
      baseUrl: "http://127.0.0.1:9/v1",
    });
    assert.throws(() => getEventsSince(2, runId, 0), /run_not_found/);
    assert.throws(() => abortRun(2, runId), /run_not_found/);
    assert.equal(abortRun(1, runId), true);
    assert.equal(abortRun(1, runId), false, "an aborted run cannot be aborted twice");
  } finally {
    restore();
  }
});

test("an empty brief never starts a run", () => {
  assert.throws(
    () =>
      startRun({
        userId: 1,
        conversationPublicId: "conv_not_in_this_database",
        brief: "--no-images",
        parsed: parseVimaxRequest("--no-images"),
        model: "test-model",
        reasoningEffort: "medium",
        baseUrl: "http://127.0.0.1:9/v1",
      }),
    /empty_brief/,
  );
});
