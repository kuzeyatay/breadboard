// The Video Use agent: when it takes a turn on its own, what it refuses to run,
// and that a model's plan can never become an arbitrary ffmpeg command.
//
// Three boundaries carry almost all the risk here.
//
// The first is `videoEditIntent`, because this is the only agent that selects
// itself. A false positive replaces the answer someone wanted with a render
// they did not ask for, so the tests below are mostly about the *nos*.
//
// The second is the filter allowlist. The EDL's `grade` field is documented as
// "a preset name or a raw ffmpeg filter", the value comes from a model reading
// user text, and ffmpeg filters can read and write files. That is a file-write
// primitive unless something checks it.
//
// The third is plan validation, which is what stands between a plausible-looking
// JSON object and a render that would fail halfway through or produce nothing.

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";

const dashboardRoot = path.resolve(import.meta.dirname, "..");
const repositoryRoot = path.resolve(dashboardRoot, "..");
const read = (relative, root = dashboardRoot) =>
  fs.readFileSync(path.join(root, relative), "utf8");

const {
  VIDEO_USE_AGENT_ID,
  VIDEO_USE_AGENT_NAME,
  VIDEO_USE_COMMAND,
  parseVideoUseRequest,
  parseVideoUseRequestBody,
  taskFromVideoUseCommand,
  videoEditIntent,
  videoUseRunLabel,
  videoUseUserMessage,
} = await import("../src/lib/video-use/identity.ts");

const {
  GRADE_PRESETS,
  aspectFilterChain,
  composeGrade,
  validateFilterChain,
  validateGrade,
  VideoFilterError,
} = await import("../src/lib/video-use/filters.ts");

const {
  identityProgram,
  parseStoredProgram,
  programDurationSeconds,
  toCloneEdl,
  validatePlan,
  VideoProgramError,
} = await import("../src/lib/video-use/program.ts");

const { scribeTranscript } = await import("../src/lib/video-use/scribe-shape.ts");

const { planEdit, transportFailureMessage } = await import("../src/lib/video-use/plan.ts");

const probeFixture = {
  durationSeconds: 30,
  width: 1920,
  height: 1080,
  fps: 30,
  hasAudio: false,
  videoCodec: "h264",
  audioCodec: null,
  sizeBytes: 12_000_000,
  portrait: false,
};

/** A stand-in for ChatMock whose behaviour per request the test decides. */
async function withModelEndpoint(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function modelAnswer(program) {
  return JSON.stringify({
    choices: [{ message: { content: JSON.stringify(program) } }],
    usage: { prompt_tokens: 11, completion_tokens: 22 },
  });
}

const planFixture = {
  summary: "Reframed the clip to vertical.",
  ranges: [{ start: 0, end: 12, reason: "the whole beat" }],
  grade: null,
  aspect: "9:16",
  subtitles: "none",
  transform: {
    speed: 1,
    mute: false,
    volumeDb: 0,
    fadeInSeconds: 0,
    fadeOutSeconds: 0,
    reverse: false,
  },
};

const planInput = (baseUrl, extra = {}) => ({
  baseUrl,
  model: "test-model",
  // No clone checkout here: the instructions fall back rather than throw.
  root: path.join(dashboardRoot, "does-not-exist"),
  probe: probeFixture,
  program: identityProgram(30),
  packedTranscript: null,
  silenceMap: "This video has no audio track.",
  prompt: "make it a reel",
  ...extra,
});

const blobId = "vid_0123456789abcdef0123456789abcdef";

// --- identity ---------------------------------------------------------------

test("the command, id and name stay consistent with each other", () => {
  assert.equal(VIDEO_USE_COMMAND, `/agents:${VIDEO_USE_AGENT_ID}`);
  assert.equal(VIDEO_USE_AGENT_ID, "video-use");
  assert.equal(VIDEO_USE_AGENT_NAME, "Video Use");
});

test("the command parser strips its own token and keeps the rest", () => {
  assert.equal(taskFromVideoUseCommand("/agents:video-use cut the intro"), "cut the intro");
  assert.equal(taskFromVideoUseCommand("/agents:video-use"), "");
  assert.equal(taskFromVideoUseCommand("edit this video"), null);
  assert.equal(taskFromVideoUseCommand("/agents:shorts cut it"), null);
});

test("stacked slash tokens survive so the capability resolver still sees them", () => {
  assert.equal(
    taskFromVideoUseCommand("/yolo /agents:video-use trim the ending"),
    "/yolo trim the ending",
  );
});

test("the user half of the turn renders from the command", () => {
  assert.equal(videoUseUserMessage("make it vertical"), "/agents:video-use make it vertical");
  assert.equal(videoUseUserMessage("  "), "/agents:video-use");
});

test("the run label names the video and what was asked of it", () => {
  assert.equal(
    videoUseRunLabel({ prompt: "cut the dead air", sourceName: "talk.mp4" }),
    "talk.mp4 — cut the dead air",
  );
  assert.equal(videoUseRunLabel({ prompt: "", sourceName: "talk.mp4" }), "Edit talk.mp4");
});

// --- edit intent: the yeses -------------------------------------------------

test("plain editing instructions are recognised", () => {
  for (const message of [
    "cut the dead air at the start",
    "trim it to 60 seconds",
    "make it vertical for reels",
    "remove the ums and uhs",
    "add subtitles",
    "speed it up a bit",
    "colour grade this warmer",
    "can you clean up the audio and normalise the volume",
    "crop to 9:16",
    "reverse it",
  ]) {
    assert.equal(videoEditIntent(message).edit, true, message);
  }
});

test("naming a delivery format is an edit when a verb asks for one", () => {
  // The way people actually ask: they name the platform, not the operation.
  // The first build knew "for reels" but not "reel", so "please make this a
  // reel format" fell through to the ordinary chat agent, which did it by hand
  // with ffmpeg and left the file in the user's Downloads folder.
  for (const message of [
    "please make this a reel format",
    "make this a reel",
    "turn it into a tiktok",
    "convert to 9:16",
    "export as a vertical short",
    "i want this as an instagram story",
    "give me a square version",
    "repurpose this for shorts",
    "can you make it portrait",
  ]) {
    assert.equal(videoEditIntent(message).edit, true, message);
  }
});

test("a format word on its own is not an instruction", () => {
  // The other half of the pair rule: without a verb asking for one to be
  // produced, a format noun is as likely to be part of a question about the
  // video as a request to make one.
  for (const message of [
    "what happens in the reel?",
    "is this vertical?",
    "was this shot in portrait",
    "the square one looked better",
  ]) {
    assert.equal(videoEditIntent(message).edit, false, message);
  }
});

test("an edit word wins over a reading word when both are present", () => {
  // "transcribe this and cut the filler" is an edit: the transcript is a step,
  // the cut is the deliverable.
  assert.equal(videoEditIntent("transcribe this and then cut the filler").edit, true);
});

// --- edit intent: the nos, which matter more --------------------------------

test("questions about a video never become an edit", () => {
  for (const message of [
    "what is in this video?",
    "transcribe this",
    "summarise it for me",
    "what does he say at the end",
    "describe what happens here",
    "translate this to Dutch",
    "how long is this",
    "take notes from this talk",
  ]) {
    const intent = videoEditIntent(message);
    assert.equal(intent.edit, false, message);
    assert.equal(intent.reason, "reading_request", message);
  }
});

test("a message with no editing language is not an edit", () => {
  for (const message of ["", "here you go", "thanks!", "this is the recording from Tuesday"]) {
    const intent = videoEditIntent(message);
    assert.equal(intent.edit, false, message);
    assert.equal(intent.reason, "no_edit_language", message);
  }
});

test("editing words inside longer words do not trigger a render", () => {
  // The costly false positives: an editing verb that is only a substring.
  for (const message of [
    "this is cutting-edge research",
    "discolouration in the footage is interesting",
    "the uncut version is fine",
  ]) {
    assert.equal(videoEditIntent(message).edit, false, message);
  }
});

// --- the other gate on the same attachment ----------------------------------

test("editing a video and asking about one are complementary, never both", async () => {
  // Two things now select themselves off a video attachment: the Watch skill,
  // which reads a video and answers about it, and this agent, which changes it.
  // They share one input, so the pair has to partition it — an instruction that
  // reaches both would either render an answer or answer a render.
  const { watchCommandText } = await import("../src/lib/hermes/watch-intent.ts");
  const watches = (text) =>
    watchCommandText({
      text,
      surface: "dashboard_terminal",
      authenticated: true,
      hasVideoAttachment: true,
    }).automatic;

  for (const message of [
    "cut the dead air at the start",
    "trim it to 60 seconds",
    "crop to 9:16",
  ]) {
    assert.equal(videoEditIntent(message).edit, true, message);
    assert.equal(watches(message), false, `Watch should decline: ${message}`);
  }

  for (const message of ["what is in this video?", "summarise it for me", "describe what happens"]) {
    assert.equal(videoEditIntent(message).edit, false, message);
    assert.equal(watches(message), true, `Watch should take: ${message}`);
  }
});

// --- request validation -----------------------------------------------------

test("a request names either an artifact or an attached video, never neither", () => {
  assert.throws(() => parseVideoUseRequest({ prompt: "cut it" }), /Choose a video/);
  assert.throws(() => parseVideoUseRequest({ artifactId: "art_abcdef" }), /Describe the change/);
  assert.throws(
    () => parseVideoUseRequest({ prompt: "cut it", artifactId: "../etc/passwd" }),
    /not valid/,
  );
  assert.throws(
    () => parseVideoUseRequest({ prompt: "cut it", blobId: "vid_nope" }),
    /not valid/,
  );
});

test("a valid request keeps its source and defaults to a final render", () => {
  const fromArtifact = parseVideoUseRequest({
    prompt: "cut it",
    artifactId: "art_4f1c2b8e-1111-2222-3333-444455556666",
  });
  assert.equal(fromArtifact.source.kind, "artifact");
  assert.equal(fromArtifact.quality, "final");

  const fromAttachment = parseVideoUseRequest({
    prompt: "cut it",
    blobId,
    filename: "talk.mp4",
    quality: "preview",
  });
  assert.deepEqual(fromAttachment.source, { kind: "attachment", blobId, filename: "talk.mp4" });
  assert.equal(fromAttachment.quality, "preview");
});

// --- the filter allowlist ---------------------------------------------------

test("the grade presets the clone ships are accepted by name", () => {
  for (const preset of GRADE_PRESETS) assert.equal(validateGrade(preset), preset);
});

test("ordinary colour chains pass", () => {
  assert.equal(
    validateFilterChain("eq=contrast=1.08:saturation=1.1"),
    "eq=contrast=1.08:saturation=1.1",
  );
  // A quoted value containing commas must not be split into broken halves.
  assert.equal(
    validateFilterChain("curves=master='0/0 0.25/0.23 0.75/0.77 1/1'"),
    "curves=master='0/0 0.25/0.23 0.75/0.77 1/1'",
  );
});

test("a filter chain can never name a file", () => {
  // The one that matters: `metadata=print:file=…` writes wherever it is pointed.
  assert.throws(
    () => validateFilterChain("metadata=print:file=/tmp/owned.txt"),
    VideoFilterError,
  );
  assert.throws(() => validateFilterChain("movie=/etc/passwd"), VideoFilterError);
  assert.throws(
    () => validateFilterChain("eq=contrast=1.1,metadata=print:file=out.txt"),
    VideoFilterError,
  );
});

test("a filter chain can never rewire the graph or escape its argument", () => {
  assert.throws(() => validateFilterChain("[0:v]scale=100:100[out]"), VideoFilterError);
  assert.throws(() => validateFilterChain("eq=contrast=1.1;anullsrc"), VideoFilterError);
  assert.throws(() => validateFilterChain("eq=contrast=1.1\\,movie=x"), VideoFilterError);
  assert.throws(() => validateFilterChain("curves=master='0/0"), VideoFilterError);
});

test("an unknown filter is refused rather than passed through", () => {
  assert.throws(() => validateFilterChain("sendcmd=f=x"), VideoFilterError);
  assert.throws(() => validateFilterChain("concat=n=2"), VideoFilterError);
});

test("reframing composes in front of the look, and never after a crop-free scale", () => {
  const chain = aspectFilterChain("9:16");
  assert.match(chain, /scale=1080:1920:force_original_aspect_ratio=increase/);
  assert.match(chain, /crop=1080:1920/);
  assert.equal(aspectFilterChain("original"), null);

  // "auto" is a renderer sentinel, not a filter, so it cannot be concatenated
  // with one — a reframe replaces it with the clone's own safe floor.
  const composed = composeGrade("9:16", "auto");
  assert.ok(composed.startsWith("scale=1080:1920"));
  assert.ok(!composed.includes("auto"));
  assert.equal(composeGrade("original", "warm_cinematic"), "warm_cinematic");
});

// --- plan validation --------------------------------------------------------

const context = { durationSeconds: 60, hasTranscript: true };

test("a plan that keeps nothing is refused", () => {
  assert.throws(() => validatePlan({ ranges: [] }, context), VideoProgramError);
  assert.throws(() => validatePlan(null, context), VideoProgramError);
  // Every range outside the source is the same as no ranges at all.
  assert.throws(
    () => validatePlan({ ranges: [{ start: 90, end: 120 }] }, context),
    VideoProgramError,
  );
});

test("ranges past the end of the source are trimmed rather than rejected", () => {
  const plan = validatePlan({ ranges: [{ start: 10, end: 60.4 }] }, context);
  assert.deepEqual(plan.ranges[0], { start: 10, end: 60, reason: "" });
});

test("ranges shorter than a moment are dropped", () => {
  const plan = validatePlan(
    { ranges: [{ start: 0, end: 5 }, { start: 10, end: 10.05 }] },
    context,
  );
  assert.equal(plan.ranges.length, 1);
});

test("transform values are clamped, not trusted", () => {
  const plan = validatePlan(
    {
      ranges: [{ start: 0, end: 10 }],
      transform: { speed: 99, volumeDb: -400, fadeInSeconds: 500, reverse: "yes" },
    },
    context,
  );
  assert.equal(plan.transform.speed, 4);
  assert.equal(plan.transform.volumeDb, -30);
  assert.equal(plan.transform.fadeInSeconds, 10);
  // Only a real boolean turns a flag on; a truthy string does not.
  assert.equal(plan.transform.reverse, false);
});

test("burning captions requires a transcript", () => {
  const withText = validatePlan(
    { ranges: [{ start: 0, end: 10 }], subtitles: "burn" },
    { durationSeconds: 60, hasTranscript: true },
  );
  assert.equal(withText.subtitles, "burn");
  const without = validatePlan(
    { ranges: [{ start: 0, end: 10 }], subtitles: "burn" },
    { durationSeconds: 60, hasTranscript: false },
  );
  assert.equal(without.subtitles, "none");
});

test("a plan carrying a hostile grade fails the whole plan", () => {
  assert.throws(
    () =>
      validatePlan(
        { ranges: [{ start: 0, end: 10 }], grade: "metadata=print:file=/tmp/x" },
        context,
      ),
    VideoProgramError,
  );
});

test("runtime accounts for the speed change", () => {
  const program = {
    ranges: [{ start: 0, end: 30, reason: "" }],
    transform: { speed: 2, mute: false, volumeDb: 0, fadeInSeconds: 0, fadeOutSeconds: 0, reverse: false },
  };
  assert.equal(programDurationSeconds(program), 15);
});

// --- the EDL the clone actually reads ---------------------------------------

test("the EDL matches the schema SKILL.md documents", () => {
  const program = validatePlan(
    {
      ranges: [
        { start: 2.42, end: 6.85, reason: "cleanest delivery" },
        { start: 14.3, end: 28.9, reason: "only take without the false start" },
      ],
      grade: "warm_cinematic",
    },
    context,
  );
  const edl = toCloneEdl({
    program,
    sourceKey: "source",
    sourcePath: "C:\\videos\\source.mp4",
    subtitlesPath: null,
  });

  assert.equal(edl.version, 1);
  assert.deepEqual(Object.keys(edl.sources), ["source"]);
  assert.equal(edl.ranges.length, 2);
  assert.equal(edl.ranges[0].source, "source");
  assert.equal(edl.grade, "warm_cinematic");
  assert.equal(edl.subtitles, undefined);
  // total_duration_s is the cut length, which is what the renderer reports back.
  assert.equal(Math.round(edl.total_duration_s * 100) / 100, 19.03);

  // Every field the clone's render.py reads must be present on every range.
  for (const range of edl.ranges) {
    for (const key of ["source", "start", "end", "beat", "quote", "reason"]) {
      assert.ok(key in range, `range is missing ${key}`);
    }
  }
});

test("subtitles are referenced only when they were asked for", () => {
  const program = validatePlan(
    { ranges: [{ start: 0, end: 10 }], subtitles: "burn" },
    context,
  );
  const edl = toCloneEdl({
    program,
    sourceKey: "source",
    sourcePath: "/videos/source.mp4",
    subtitlesPath: "master.srt",
  });
  assert.equal(edl.subtitles, "master.srt");
});

// --- stored programs --------------------------------------------------------

test("the identity program is the whole source and nothing else", () => {
  const program = identityProgram(42);
  assert.deepEqual(program.ranges, [{ start: 0, end: 42, reason: "The whole source." }]);
  assert.equal(program.grade, null);
  assert.equal(program.aspect, "original");
  assert.equal(program.history.length, 0);
});

test("a stored program round-trips, and an unreadable one falls back instead of throwing", () => {
  const stored = {
    ranges: [{ start: 1, end: 5, reason: "kept" }],
    grade: "auto",
    aspect: "9:16",
    subtitles: "none",
    transform: { speed: 1, mute: false, volumeDb: 0, fadeInSeconds: 0, fadeOutSeconds: 0, reverse: false },
    history: [{ version: 2, prompt: "trim it", summary: "trimmed", at: "2026-08-09T00:00:00.000Z" }],
  };
  const parsed = parseStoredProgram(stored, 60);
  assert.equal(parsed.aspect, "9:16");
  assert.equal(parsed.history.length, 1);

  // A program that no longer validates against its source must not lock the
  // artifact out of the studio.
  assert.deepEqual(parseStoredProgram({ ranges: [] }, 30), identityProgram(30));
  assert.deepEqual(parseStoredProgram("nonsense", 30), identityProgram(30));
});

// --- wiring -----------------------------------------------------------------

test("the run kind is registered everywhere a card needs it", () => {
  const registry = read("src/lib/conversations/external-agent-runs.ts");
  assert.match(registry, /"video_use",/);
  assert.match(registry, /video_use: "Video Use",/);
  assert.match(registry, /video_use: "videoUseRun",/);
  assert.match(registry, /videoUseRun\?: \{ runId: string; task: string; quiet\?: boolean \}/);
  assert.match(registry, /candidate\.kind === "video_use"/);
  assert.match(registry, /videoUseRun: \{\s*runId: run\.runId,\s*task: run\.task,/);
});

test("both chat surfaces render the run card", () => {
  for (const file of [
    "src/app/components/hermes/agent-runtime-panel.tsx",
    "src/app/gardens/[clusterSlug]/workspace-client.tsx",
  ]) {
    const source = read(file);
    assert.match(source, /InlineVideoUseRun/, file);
    assert.match(source, /videoUseRun/, file);
  }
});

test("the run card guards its stream, recovers from a broken one, and reads its saved content", () => {
  const card = read("src/app/components/hermes/inline-video-use-run.tsx");
  assert.match(card, /if \(persistedOutcome && persistedOutcome !== "running"\) return;/);
  assert.match(card, /persistedContent/);
  assert.match(card, /notifyTaskCompleted/);

  // A single 500 from the events route used to end the subscription for good
  // — `onerror` just closed the stream — which left a live edit on "Thinking"
  // until the page was reloaded. The stream still closes, but the card then
  // catches up over plain JSON, reopens from where it left off, and falls back
  // to polling rather than going silent.
  assert.match(card, /stream\.onerror = \(\) => \{/);
  assert.doesNotMatch(card, /stream\.onerror = \(\) => stream\.close\(\);/);
  assert.match(card, /const cursorRef = useRef\(0\)/);
  assert.match(card, /\$\{base\}\/events\?since=\$\{cursorRef\.current\}/);
  assert.match(card, /headers: \{ accept: "application\/json" \}/);
  assert.match(card, /if \(response\.status === 404\) return "gone"/);
  assert.match(card, /attempt <= MAX_STREAM_ATTEMPTS/);
  assert.match(card, /window\.setTimeout\(\(\) => void recover\(\), POLL_INTERVAL_MS\)/);
  // The run's end is read off the events, not off state that lands a render later.
  assert.match(card, /if \(TERMINAL_EVENT_TYPES\.has\(event\.type\)\) finished = true/);
});

test("a quiet run leaves stopping to the shared composer", () => {
  const card = read("src/app/components/hermes/inline-video-use-run.tsx");
  assert.ok(card.indexOf("if (quiet) {") >= 0);
  const quiet = card.slice(
    card.indexOf("if (quiet) {"),
    card.indexOf("bb-agent-run-card"),
  );
  assert.doesNotMatch(quiet, />\s*Stop\s*</);
  assert.doesNotMatch(quiet, /onClick=\{stop\}/);
  const runtimePanel = read("src/app/components/hermes/agent-runtime-panel.tsx");
  assert.match(runtimePanel, /onStop=\{canStop \? stopEverything : undefined\}/);
  // The same abort call remains available on the named run card.
  assert.match(card, /const stop = useCallback\(\(\) => \{/);
  assert.match(card, /fetch\(`\$\{base\}\/abort`, \{ method: "POST" \}\)/);
});

test("the studio opens for every video artifact, from every surface that shows one", () => {
  const viewer = read("src/app/components/hermes/artifact-viewer.tsx");
  // The gate is the artifact's kind, not who produced it — that is what makes
  // the studio global rather than an editor for its own output.
  assert.match(viewer, /artifact\.kind === "video" && onEditVideo/);
  for (const file of [
    "src/app/components/hermes/artifact-panel.tsx",
    "src/app/components/hermes/inline-artifact-cards.tsx",
  ]) {
    const source = read(file);
    assert.match(source, /ArtifactVideoStudio/, file);
    assert.match(source, /onEditVideo/, file);
  }
});

test("the finished video artifact follows the assistant turn that requested the edit", () => {
  const artifact = read("src/lib/video-use/artifact.ts");
  const publish = artifact.slice(artifact.indexOf("export function publishEditedVideo"));

  // Linked and uploaded sources are adopted before the run descriptor has
  // necessarily been saved, so version one may have no originating message.
  // The completed publish must move the durable artifact onto the now-existing
  // assistant turn instead of leaving it in the unassigned pile.
  assert.match(artifact, /setArtifactOriginatingMessage,/);
  assert.match(publish, /const assistantMessageId = assistantMessageFor\(input\.context\)/);
  assert.match(
    publish,
    /setArtifactOriginatingMessage\(\{ artifactId: stored\.id, assistantMessageId \}\)/,
  );
  assert.match(publish, /presentArtifact\(getArtifactById\(stored\.id\) \?\? stored\)/);
});

// --- what a failed edit leaves behind ---------------------------------------
//
// The run adopts its source as an artifact before it plans anything, so until
// the render publishes version two that artifact holds a byte-copy of what the
// person just attached. A real failure — a 2m10s wait ending in an unreachable
// model — used to leave exactly that in the chat: a finished, downloadable
// video card, identical to the input, floating in the unassigned pile because
// only publishing ever assigns an owning turn. It reads as the answer, and it
// is not one.

test("the adopted source is a loading card, not a finished result", () => {
  const store = read("src/lib/hermes/artifact-store.ts");
  // The import store had one status and it was 'ready'.
  assert.match(store, /status\?: Extract<ArtifactStatus, "ready" \| "generating">/);
  assert.match(store, /const status = input\.status \?\? "ready"/);
  assert.doesNotMatch(
    store.slice(store.indexOf("export function createImportedArtifact")),
    /VALUES \(\?, \?, \?, \?, \?, \?, \?, \?, \?, \?, \?, \?, \?, \?, \?, 'ready', 1/,
  );

  const manager = read("src/lib/video-use/run-manager.ts");
  const adopt = manager.slice(
    manager.indexOf("async function adoptSource"),
    manager.indexOf("async function attachSourceToUserTurn"),
  );
  assert.match(adopt, /sourceHermesTool: "video_use_import",\s*\n\s*status: "generating",/);
  assert.match(adopt, /run\.adoptedArtifactId = created\.id/);
});

test("the adopted source is owned by the turn producing it, not by the pile", () => {
  const manager = read("src/lib/video-use/run-manager.ts");
  // Assigned after the wait for the user turn, which is the point at which the
  // assistant turn exists too.
  const drive = manager.slice(manager.indexOf("async function drive("));
  const attached = drive.indexOf("attachSourceToUserTurn(run, sourceAttachment)");
  const assigned = drive.indexOf("assignArtifactToAssistantTurn(run.context, run.adoptedArtifactId)");
  assert.ok(attached > 0 && assigned > attached);
  assert.match(
    read("src/lib/video-use/artifact.ts"),
    /export function assignArtifactToAssistantTurn\(/,
  );
});

test("a run that publishes nothing takes its adopted copy with it", () => {
  const manager = read("src/lib/video-use/run-manager.ts");
  assert.match(manager, /void discardAdoptedArtifact\(run\)/);

  const discard = manager.slice(manager.indexOf("async function discardAdoptedArtifact"));
  assert.match(discard, /await deleteArtifact\(\{/);
  assert.match(discard, /discardSession\(run\.userId, artifactId\)/);
  // A version past the first is somebody's edit; no failure may remove it.
  assert.match(discard, /if \(artifact && artifact\.current_version > 1\) return/);

  // Success is the only thing that stops the cleanup, and only once the
  // publish has actually returned.
  const drive = manager.slice(manager.indexOf("async function drive("));
  const publish = drive.indexOf("const stored = publishEditedVideo({");
  const cleared = drive.indexOf("run.adoptedArtifactId = null");
  assert.ok(publish > 0 && cleared > publish);

  // Stopping a first edit is the same situation: nothing was produced.
  const finish = manager.slice(
    manager.indexOf("function finish(run: RunState"),
    manager.indexOf("async function discardAdoptedArtifact"),
  );
  assert.match(finish, /discardAdoptedArtifact/);
});

test("an unreachable model is reported in words, not as \"fetch failed\"", () => {
  const refused = Object.assign(new TypeError("fetch failed"), {
    cause: { code: "ECONNREFUSED" },
  });
  const message = transportFailureMessage(refused, "http://127.0.0.1:8000");
  assert.doesNotMatch(message, /^fetch failed$/);
  assert.match(message, /nothing is listening there/);
  // The endpoint is named, because "which service" is the whole question.
  assert.match(message, /http:\/\/127\.0\.0\.1:8000\/v1\/chat\/completions/);
  assert.match(message, /ECONNREFUSED/);
  // A connection that dies mid-answer is a different thing from one refused.
  assert.match(
    transportFailureMessage(
      Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } }),
      "http://127.0.0.1:8000/v1",
    ),
    /dropped part-way through/,
  );
  // No cause at all still produces a sentence.
  assert.match(
    transportFailureMessage(new TypeError("fetch failed"), "http://127.0.0.1:8000"),
    /The edit could not be planned/,
  );

  const plan = read("src/lib/video-use/plan.ts");
  // The raw pass-through this replaces.
  assert.doesNotMatch(
    plan,
    /error instanceof Error \? error\.message : "The editor could not be reached\."/,
  );
  // The planner's own timeout is a slow model, not a broken connection.
  assert.match(plan, /took longer than \$\{Math\.round\(/);
});

test("a dropped connection is retried once rather than thrown away", async () => {
  // By the time the plan runs, the probe, the transcription and the silence map
  // have all been paid for — minutes of local work that a single lost socket
  // used to discard. The request never reached the model, so sending it again
  // is the whole fix.
  let requests = 0;
  const notices = [];
  const result = await withModelEndpoint(
    (request, response) => {
      requests += 1;
      if (requests === 1) {
        request.socket.destroy();
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(modelAnswer(planFixture));
    },
    (baseUrl) =>
      planEdit(planInput(baseUrl, { onTransportRetry: (detail) => notices.push(detail) })),
  );

  assert.equal(requests, 2);
  assert.equal(result.program.aspect, "9:16");
  assert.equal(result.usage.inputTokens, 11);
  // The wait is announced, so the stage does not just appear to hang twice.
  assert.equal(notices.length, 1);
  assert.match(notices[0], /Lost the connection/);
});

test("an answer the service gave is not retried, however unwelcome", async () => {
  // A 500 is the endpoint answering. Asking again gets the same answer, and the
  // person waits twice as long to read it.
  let requests = 0;
  await withModelEndpoint(
    (_request, response) => {
      requests += 1;
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "model is out of capacity" } }));
    },
    async (baseUrl) => {
      await assert.rejects(planEdit(planInput(baseUrl)), (error) => {
        assert.equal(error.name, "VideoPlanError");
        assert.equal(error.transport, false);
        assert.match(error.message, /HTTP 500/);
        return true;
      });
    },
  );
  assert.equal(requests, 1);
});

test("stopping the edit during the retry pause stops it", async () => {
  let requests = 0;
  const controller = new AbortController();
  await withModelEndpoint(
    (request) => {
      requests += 1;
      // Stop lands after the connection is lost but before the retry is sent:
      // the pause must be interruptible, or Stop takes a second and a half to
      // do anything and then sends the request anyway.
      const timer = setTimeout(() => controller.abort(), 300);
      timer.unref?.();
      request.socket.destroy();
    },
    async (baseUrl) => {
      await assert.rejects(
        planEdit(planInput(baseUrl, { signal: controller.signal })),
        /stopped/,
      );
    },
  );
  assert.equal(requests, 1);
});

test("a failed turn is set like a message, because it is the message", () => {
  const card = read("src/app/components/hermes/inline-video-use-run.tsx");
  const quiet = card.slice(card.indexOf("if (quiet) {"), card.indexOf("bb-agent-run-card"));
  // In Super Agent mode there is no card around the failure to explain it, so
  // it must read as the assistant's answer rather than as red diagnostics.
  assert.match(quiet, /<ChatMarkdown content=\{failure\} compact \/>/);
  assert.doesNotMatch(quiet, /text-\[var\(--danger\)\]/);
  assert.match(quiet, /role="alert"/);
});

test("the terminal reroutes an attached video only when the message asks for an edit", () => {
  const terminal = read("src/app/components/hermes/dashboard-agent-terminal.tsx");
  assert.match(terminal, /videoEditIntent\(text\)\.edit/);
  assert.match(terminal, /kind: "video_use"/);
});

test("every way in accepts a linked video, not just an attached one", () => {
  const terminal = read("src/app/components/hermes/dashboard-agent-terminal.tsx");
  // One resolver answers "which video", and all three entry points use it.
  // The typed command used to look only for an attachment, so pasting a link
  // with it read as "no video at all" and the run started with no source.
  assert.match(terminal, /const videoUseSource = useCallback/);
  assert.match(terminal, /const commandVideo = videoUseSource\(videoUseTask, chatAttachments\)/);
  assert.match(terminal, /const editableVideo = videoUseTarget\(text, chatAttachments\)/);
  assert.match(terminal, /videoUseTarget\(\s*previousUser\.content,/);
  // The command is the instruction, so it asks for the video and not for intent.
  const command = terminal.slice(
    terminal.indexOf("const videoUseTask = taskFromVideoUseCommand(text)"),
  );
  assert.doesNotMatch(
    command.slice(0, command.indexOf("const shorts")),
    /videoEditIntent/,
    "the typed command must not also have to pass the intent gate",
  );
  // Declared above every caller: a const used before its declaration throws
  // during render, which is a blank window rather than an error.
  const declared = terminal.indexOf("const videoUseSource = useCallback");
  assert.ok(declared > 0);
  assert.ok(declared < terminal.indexOf("const submit = useCallback"));
  assert.ok(declared < terminal.indexOf("const retryMessage = useCallback"));
});

test("a typed command with a link resolves to that video", async () => {
  // The exact message that failed with "Choose a video to edit".
  const { firstVideoSource } = await import("../src/lib/video-sources/identity.ts");
  const typed =
    "/agents:video-use https://www.youtube.com/watch?v=T-MUZP_rtzE can you turn this into an instagram reel and add captions";
  const task = taskFromVideoUseCommand(typed);
  assert.ok(task, "the command token was not recognised");
  // The link survives into the task, which is what the command branch reads.
  const source = firstVideoSource(task);
  assert.ok(source, "the linked video was lost with the command token");
  assert.equal(source.key, "youtube:T-MUZP_rtzE");
});

test("the transcript keeps what the person wrote", () => {
  const terminal = read("src/app/components/hermes/dashboard-agent-terminal.tsx");
  // This is the one agent that selects itself, so writing "/agents:video-use …"
  // into the user's message puts a command there that they never typed — and in
  // Super Agent mode, where no agent was chosen at all, misrepresents the turn.
  assert.match(terminal, /const userContent = options\.userContent \?\? videoUseUserMessage\(prompt\)/);
  // Every launch passes the text as the person left it.
  assert.match(terminal, /launchVideoUseRun\(videoUseTask, commandVideo, \{ userContent: text \}\)/);
  assert.match(terminal, /launchVideoUseRun\(text, editableVideo, \{ userContent: text \}\)/);
  assert.match(terminal, /userContent: previousUser\.content,/);
});

test("uploaded and linked edit sources remain normal playable message attachments", () => {
  const terminal = read("src/app/components/hermes/dashboard-agent-terminal.tsx");
  const launcher = terminal.slice(
    terminal.indexOf("const launchVideoUseRun = useCallback"),
    terminal.indexOf("const videoUseSource = useCallback"),
  );
  // Auto-routing used to clear the composer attachment and then persist no
  // attachment at all, making the playable card disappear from the user turn.
  assert.match(launcher, /const messageAttachments = "blobId" in video \? \[video\] : \[\]/);
  assert.match(launcher, /previewExternalAgentTurn\(\{[\s\S]*attachments: messageAttachments,/);
  assert.equal(
    launcher.match(/attachments: messageAttachments,/g)?.length,
    3,
    "the source stays attached in the preview, running turn, and start-failure turn",
  );

  // A URL has no blob id at launch. Adoption promotes the downloaded file onto
  // the same user turn, and the live transcript refresh exposes the shared
  // video player without waiting for a page reload.
  const manager = read("src/lib/video-use/run-manager.ts");
  assert.match(manager, /attachVideoToExternalAgentUserTurn\(/);
  assert.match(manager, /sourceAttachment, sourceAttached/);
  const card = read("src/app/components/hermes/inline-video-use-run.tsx");
  assert.match(card, /payload\.sourceAttached === true/);
  assert.match(card, /onSourceReadyRef\.current\?\.\(\)/);
  assert.match(terminal, /onExternalAgentSourceReady=\{\(\) => \{\s*void session\.refreshSession\(\)/);
});

test("starting a run never blocks the server or wedges the composer", () => {
  const runtime = read("src/lib/video-use/runtime.ts");
  // `spawnSync` does not merely make its caller wait — it stops the event loop,
  // so a 2.4s numpy probe on the path of every run froze the whole server,
  // including the endpoint that stops the run. Health is now file checks only.
  assert.doesNotMatch(
    runtime.slice(runtime.indexOf("export function videoUseHealth")),
    /spawnSync/,
    "health must not spawn a process",
  );
  assert.match(runtime, /export function probeVisualQc/);
  assert.match(runtime, /cachedWhich/, "`where python` is a spawn too; memoize it");

  // And the launch request is bounded, because the run card — the only place
  // with a Stop button — does not exist until it resolves.
  const terminal = read("src/app/components/hermes/dashboard-agent-terminal.tsx");
  const launcher = terminal.slice(
    terminal.indexOf("const launchVideoUseRun = useCallback"),
    terminal.indexOf("const videoUseSource = useCallback"),
  );
  assert.match(launcher, /signal: AbortSignal\.timeout\(/);
  assert.match(launcher, /setLaunchingVideoUseRun\(false\)/);
});

test("the route forwards every source the launchers actually send", () => {
  // The bug this pins: the route listed the request fields itself, and when the
  // `url` source was added it was not updated — so the browser sent a link, the
  // route silently dropped it, and every linked edit died on "Choose a video to
  // edit". These are the three payloads the three launch paths build, byte for
  // byte; they must survive the body parser with their source intact.
  const defaults = { quality: "final" };

  const linked = parseVideoUseRequestBody(
    {
      url: "https://www.youtube.com/watch?v=T-MUZP_rtzE",
      filename: "T-MUZP_rtzE",
      prompt: "can you turn this video into an instagram reel and add captions",
    },
    defaults,
  );
  assert.equal(linked.source.kind, "url");
  assert.equal(linked.source.url, "https://www.youtube.com/watch?v=T-MUZP_rtzE");

  const attached = parseVideoUseRequestBody(
    { blobId, filename: "talk.mp4", prompt: "cut the dead air" },
    defaults,
  );
  assert.equal(attached.source.kind, "attachment");
  assert.equal(attached.source.blobId, blobId);

  const stored = parseVideoUseRequestBody(
    {
      artifactId: "art_4f1c2b8e-1111-2222-3333-444455556666",
      prompt: "now make it vertical",
      quality: "preview",
    },
    defaults,
  );
  assert.equal(stored.source.kind, "artifact");
  assert.equal(stored.quality, "preview", "an explicit quality must beat the default");

  // And the stored default fills in only what the message left out.
  assert.equal(linked.quality, "final");
});

test("the route does not enumerate request fields itself", () => {
  // Enumerating them in two places is what let the route fall behind. One
  // function owns the list; the route hands it the body.
  const route = read("src/app/api/video-use/runs/route.ts");
  assert.match(route, /parseVideoUseRequestBody\(body\.request, defaults\)/);
  assert.doesNotMatch(route, /submitted\./);
});

test("Super Agent turns report without announcing an agent", () => {
  // The person chose no agent, so a card naming one announces a hand-off they
  // never made. The run still streams, still stores its artifact, still reports
  // — it just reads as an answer.
  const registry = read("src/lib/conversations/external-agent-runs.ts");
  assert.match(registry, /quiet\?: boolean/);
  assert.match(registry, /candidate\.quiet === true \? \{ quiet: true \} : \{\}/);

  const terminal = read("src/app/components/hermes/dashboard-agent-terminal.tsx");
  // Read at launch and stored, not read at render: a finished turn must not
  // change how it reads because the toggle moved afterwards.
  assert.match(terminal, /isSuperAgentEnabled\(\) \? \{ quiet: true \} : \{\}/);

  const card = read("src/app/components/hermes/inline-video-use-run.tsx");
  assert.match(card, /if \(quiet\) \{/);
  const quietStart = card.indexOf("if (quiet) {");
  const quietBranch = card.slice(quietStart, card.indexOf("\n  }\n\n  return (", quietStart));
  assert.doesNotMatch(quietBranch, /bb-agent-run-card/, "no card chrome when quiet");
  assert.doesNotMatch(quietBranch, /agentName/, "no agent name when quiet");
  assert.match(quietBranch, /<AssistantResponseMeta/,
    "quiet runs keep the ordinary assistant Thinking state");
  assert.doesNotMatch(quietBranch, /bb-agent-run-led/,
    "internal edit stages are not rendered as a detached progress row");
  assert.doesNotMatch(quietBranch, /\{renderLine \|\| runningStageLabel/,
    "internal edit stages stay inside the named Video Use card");
  assert.match(quietBranch, /ChatMarkdown/, "the result still renders");

  for (const surface of [
    "src/app/components/hermes/agent-runtime-panel.tsx",
    "src/app/gardens/[clusterSlug]/workspace-client.tsx",
  ]) {
    assert.match(read(surface), /quiet=\{(message|msg)\.videoUseRun\.quiet === true\}/, surface);
  }
});

test("a request with no video at all is refused before a run starts", () => {
  // The failure the user saw is the last line of defence; it should only ever
  // be reachable when there genuinely is no video.
  assert.throws(
    () => parseVideoUseRequest({ prompt: "turn this into a reel" }),
    /Choose a video to edit/,
  );
});

test("retrying an edit re-runs the edit, not the general agent", () => {
  const terminal = read("src/app/components/hermes/dashboard-agent-terminal.tsx");
  // Every other agent is re-routed on retry by parsing its slash token out of
  // the stored message. Video Use has no token — it selects itself from the
  // wording — so retry has to ask the same question the composer asked, or a
  // re-run silently becomes an ordinary turn and the answer comes back as a
  // loose file instead of an artifact.
  assert.match(terminal, /const retryVideo = videoUseTarget\(\s*previousUser\.content,/);
  assert.match(terminal, /launchVideoUseRun\(previousUser\.content, retryVideo, \{\s*branchGroupId,/);
  // One decision, used by both, so the two cannot drift apart.
  assert.match(terminal, /const editableVideo = videoUseTarget\(text, chatAttachments\)/);
  // Declared before both callers: a `const` referenced above its declaration
  // throws while the component renders, which is a blank screen, not an error.
  const declared = terminal.indexOf("const videoUseTarget = useCallback");
  assert.ok(declared > 0, "videoUseTarget is missing");
  assert.ok(declared < terminal.indexOf("const submit = useCallback"));
  assert.ok(declared < terminal.indexOf("const retryMessage = useCallback"));
  // A retried run belongs to the branch the retry created.
  assert.match(terminal, /branchGroupId: options\.branchGroupId,/);
});

test("a video the model changes itself still has to become an artifact", () => {
  // The gate is a phrase list, so it will always miss something. When a turn
  // reaches the ordinary agent anyway, the result must not end up as a loose
  // file in a user folder — which is exactly what happened before this existed.
  const context = read("src/lib/hermes/watch-turn.ts");
  assert.match(context, /Server-enforced output contract/);
  assert.match(context, /calling artifact_import yourself/);
  assert.match(context, /Never write a produced video to a user folder/);
  assert.match(context, /Downloads/);
  // The first version of this contract said only "attach it as an artifact",
  // and a model read that as a job for a video *agent* — it called OpenMontage,
  // which makes videos from a brief, cannot attach one you already have, and
  // failed for want of Codex after a seventeen-minute turn.
  assert.match(context, /Do not hand the finished file to another agent/);
  assert.match(context, /OpenMontage/);
  // And it says where the artifact goes, so the model can tell the person.
  assert.match(context, /video\s+studio/);
});

test("the clone is present and still exposes the helpers this drives", () => {
  for (const relative of ["SKILL.md", "helpers/render.py", "helpers/grade.py", "helpers/pack_transcripts.py"]) {
    assert.ok(
      fs.existsSync(path.join(repositoryRoot, "video-use", relative)),
      `video-use/${relative} is missing`,
    );
  }
});

// --- the transcript shape ---------------------------------------------------
//
// The clone's Python reads ElevenLabs Scribe's JSON, and both local engines have
// to produce it. What the packer actually depends on is narrow and easy to break
// by accident: `type`, `text`, `start`, `end`, `speaker_id` on every entry, and
// `spacing` entries carrying the gaps it breaks phrases on.

test("word timings become the Scribe shape the clone's helpers read", () => {
  // What Scriberr's WhisperX returns, after `word_segments` is normalized.
  const transcript = scribeTranscript([
    { start: 0.12, end: 0.5, text: "Ninety", speaker: "SPEAKER_00" },
    { start: 0.5, end: 0.9, text: "percent", speaker: "SPEAKER_00" },
    { start: 2.4, end: 3.1, text: "wasted.", speaker: "SPEAKER_00" },
  ]);

  const words = transcript.words.filter((word) => word.type === "word");
  assert.deepEqual(
    words.map((word) => word.text),
    ["Ninety", "percent", "wasted."],
  );
  assert.equal(transcript.text, "Ninety percent wasted.");

  // The 1.5s gap is the only place a cut could land, so it has to survive.
  const spacing = transcript.words.filter((word) => word.type === "spacing");
  assert.equal(spacing.length, 1);
  assert.equal(spacing[0].start, 0.9);
  assert.equal(spacing[0].end, 2.4);

  for (const word of transcript.words) {
    for (const field of ["type", "text", "start", "end", "speaker_id"]) {
      assert.ok(field in word, `a word is missing ${field}`);
    }
  }
});

test("speaker labels are normalized to what the packer prints", () => {
  // pack_transcripts.py strips a `speaker_` prefix; WhisperX's SPEAKER_01 and
  // Scribe's speaker_1 are the same voice and must not read as two.
  const transcript = scribeTranscript([
    { start: 0, end: 1, text: "one", speaker: "SPEAKER_01" },
    { start: 1, end: 2, text: "two", speaker: "speaker_1" },
    { start: 2, end: 3, text: "three", speaker: null },
  ]);
  assert.deepEqual(
    transcript.words.map((word) => word.speaker_id),
    ["S1", "S1", "S0"],
  );
});

test("a word with no usable timing is dropped rather than written", () => {
  const transcript = scribeTranscript([
    { start: 0, end: 1, text: "kept" },
    { start: Number.NaN, end: 2, text: "no start" },
    { start: 3, end: 2, text: "ends before it starts" },
    { start: 4, end: 5, text: "   " },
  ]);
  assert.equal(transcript.text, "kept");
});

test("speech is local: nothing in the editor calls a hosted transcriber", () => {
  for (const relative of [
    "src/lib/video-use/transcript.ts",
    "src/lib/video-use/speech.ts",
    "src/lib/video-use/runtime.ts",
    "src/lib/video-use/run-manager.ts",
  ]) {
    assert.doesNotMatch(read(relative), /elevenlabs\.io|xi-api-key/i, relative);
  }
});

test("the renderer is invoked the way its own documentation invokes it", () => {
  const render = read("src/lib/video-use/render.ts");
  assert.match(render, /"--build-subtitles"/);
  assert.match(render, /"--preview"/);
  // Windows consoles default to cp1252 and the helpers print "→", which raises
  // UnicodeEncodeError and kills the render before the first segment.
  const runtime = read("src/lib/video-use/runtime.ts");
  assert.match(runtime, /PYTHONUTF8: "1"/);
  assert.match(runtime, /PYTHONIOENCODING: "utf-8"/);
});
