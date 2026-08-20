// Vox Director: the command grammar, the settings precedence, the containment
// rules, the fallback chains, and the promise the whole integration rests on —
// that nothing in it reaches Atlas Cloud or wants an API key.
//
// The shared suites (`external-agent-persistence`, `capability-combinations`,
// `runtime-agent-briefs`, `agent-conversation-context-coverage`) already walk
// this agent along with every other one. What is here is what only this agent
// can get wrong.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dashboardRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(dashboardRoot, "..");
const source = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");

const {
  VOX_DIRECTOR_AGENT_ID,
  VOX_DIRECTOR_AGENT_NAME,
  VOX_DIRECTOR_COMMAND,
  VOX_MAX_DURATION_SECONDS,
  VOX_MIN_DURATION_SECONDS,
  beatCountForDuration,
  clampVoxDuration,
  parseVoxDirectorRequest,
  taskFromVoxDirectorCommand,
  voxDirectorUserMessage,
} = await import("../src/lib/vox-director/identity.ts");

// ---------------------------------------------------------------------------
// Identity and the command grammar
// ---------------------------------------------------------------------------

test("the three spellings of the agent's name stay consistent", () => {
  assert.equal(VOX_DIRECTOR_COMMAND, "/agents:vox-director");
  assert.equal(VOX_DIRECTOR_AGENT_ID, "vox-director");
  assert.equal(VOX_DIRECTOR_AGENT_NAME, "Vox Director");
  assert.equal(VOX_DIRECTOR_COMMAND, `/agents:${VOX_DIRECTOR_AGENT_ID}`);
});

test("the command token is recognised, and nothing else is", () => {
  assert.equal(
    taskFromVoxDirectorCommand("/agents:vox-director why the sky is blue"),
    "why the sky is blue",
  );
  // A bare token selects the agent: the palette inserts it before the person
  // has typed anything, so this is "wait", not "launch nothing".
  assert.equal(taskFromVoxDirectorCommand("/agents:vox-director"), "");
  assert.equal(taskFromVoxDirectorCommand("/agents:vox-director   "), "");
  // Case is not a way to miss the agent.
  assert.equal(taskFromVoxDirectorCommand("/AGENTS:VOX-DIRECTOR hello"), "hello");

  // Another agent's command is not this one.
  assert.equal(taskFromVoxDirectorCommand("/agents:vimax a film"), null);
  assert.equal(taskFromVoxDirectorCommand("/agents:vox a film"), null);
  assert.equal(taskFromVoxDirectorCommand("/agents:vox-director-2 a film"), null);
  // Prose that merely mentions the agent is prose.
  assert.equal(taskFromVoxDirectorCommand("make a vox-director video please"), null);
});

test("stacked capability tokens survive the parse", () => {
  // The resolver still has to see them, so they are preserved in front of the
  // brief rather than eaten.
  assert.equal(
    taskFromVoxDirectorCommand("/skills:diagram-design /agents:vox-director explain photosynthesis"),
    "/skills:diagram-design explain photosynthesis",
  );
  assert.equal(
    taskFromVoxDirectorCommand("/agents:vox-director /web explain photosynthesis"),
    "/web explain photosynthesis",
  );
});

test("the user half of the turn renders the command back", () => {
  assert.equal(
    voxDirectorUserMessage("why the sky is blue"),
    "/agents:vox-director why the sky is blue",
  );
  assert.equal(voxDirectorUserMessage("   "), "/agents:vox-director");
});

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

test("flags are read out of the brief and leave the topic behind", () => {
  const parsed = parseVoxDirectorRequest(
    'explain why the Concorde disappeared --duration 20 --vertical --style "punk-zine" --no-music --seed 1234 --motion kenburns',
  );
  assert.equal(parsed.brief, "explain why the Concorde disappeared");
  assert.equal(parsed.duration, 20);
  assert.equal(parsed.aspectRatio, "9:16");
  assert.equal(parsed.style, "punk-zine");
  assert.equal(parsed.music, false);
  assert.equal(parsed.seed, 1234);
  assert.equal(parsed.motion, "kenburns");
  // Untouched by any of that.
  assert.equal(parsed.images, true);
});

test("the defaults are the ones the brief promises", () => {
  const parsed = parseVoxDirectorRequest("how a heat pump works");
  assert.equal(parsed.duration, 30);
  assert.equal(parsed.aspectRatio, "16:9");
  assert.equal(parsed.motion, "local");
  assert.equal(parsed.images, true);
  assert.equal(parsed.music, true);
  assert.equal(parsed.seed, null);
  assert.equal(parsed.style, null);
});

test("an unreasonable duration is clamped, not refused", () => {
  // A person who typed 3600 made a mistake worth correcting; a run that took it
  // literally would spend an hour rendering frames before anyone found out.
  assert.equal(parseVoxDirectorRequest("a topic --duration 3600").duration, VOX_MAX_DURATION_SECONDS);
  assert.equal(parseVoxDirectorRequest("a topic --duration 1").duration, VOX_MIN_DURATION_SECONDS);
  assert.equal(parseVoxDirectorRequest("a topic --duration 0").duration, VOX_MIN_DURATION_SECONDS);
  assert.equal(clampVoxDuration(Number.NaN), 30);
  assert.equal(clampVoxDuration(45.4), 45);

  // A duration that is not a number is not a flag; it stays in the topic.
  const words = parseVoxDirectorRequest("a topic --duration soon");
  assert.equal(words.duration, 30);
  assert.match(words.brief, /--duration soon/);
});

test("every aspect flag maps to a frame, and the last one wins", () => {
  assert.equal(parseVoxDirectorRequest("t --vertical").aspectRatio, "9:16");
  assert.equal(parseVoxDirectorRequest("t --portrait").aspectRatio, "9:16");
  assert.equal(parseVoxDirectorRequest("t --square").aspectRatio, "1:1");
  assert.equal(parseVoxDirectorRequest("t --landscape").aspectRatio, "16:9");
  assert.equal(parseVoxDirectorRequest("t --wide").aspectRatio, "16:9");
  assert.equal(parseVoxDirectorRequest("t --vertical --square").aspectRatio, "1:1");
});

test("an unknown motion backend stays part of the topic", () => {
  // Silently downgrading to a renderer nobody asked for is worse than reading
  // the word as prose.
  const parsed = parseVoxDirectorRequest("a topic --motion interpretive");
  assert.equal(parsed.motion, "local");
  assert.match(parsed.brief, /--motion interpretive/);

  for (const backend of ["auto", "local", "kenburns", "scrapbook"]) {
    assert.equal(parseVoxDirectorRequest(`t --motion ${backend}`).motion, backend);
  }
});

test("a flag in the message always beats a stored default", async () => {
  const { voxDirectorDefaults, voxDirectorCheckpoint } = await import(
    "../src/lib/agent-settings/defaults.ts"
  );
  const stored = voxDirectorDefaults({
    duration: 60,
    aspectRatio: "9:16",
    motion: "kenburns",
    style: "chinese-ink",
    images: false,
    music: false,
    seed: 99,
    checkpoint: "sd_xl_base_1.0.safetensors",
  });
  assert.deepEqual(stored, {
    duration: 60,
    aspectRatio: "9:16",
    style: "chinese-ink",
    motion: "kenburns",
    images: false,
    music: false,
    seed: 99,
  });
  assert.equal(voxDirectorCheckpoint({ checkpoint: "sd_xl_base_1.0.safetensors" }), "sd_xl_base_1.0.safetensors");
  assert.equal(voxDirectorCheckpoint({}), null);

  // Every stored value has a flag that undoes it for one message.
  const overridden = parseVoxDirectorRequest(
    'a topic --duration 15 --landscape --motion local --style "swiss-modern" --images --music --seed 7',
    stored,
  );
  assert.equal(overridden.duration, 15);
  assert.equal(overridden.aspectRatio, "16:9");
  assert.equal(overridden.motion, "local");
  assert.equal(overridden.style, "swiss-modern");
  assert.equal(overridden.images, true);
  assert.equal(overridden.music, true);
  assert.equal(overridden.seed, 7);

  // And a message that says nothing keeps them.
  const untouched = parseVoxDirectorRequest("a topic", stored);
  assert.deepEqual({ ...untouched, brief: undefined }, { ...stored, brief: undefined });
});

test("unknown stored values fall back to the defaults", async () => {
  const { voxDirectorDefaults } = await import("../src/lib/agent-settings/defaults.ts");
  const fallback = voxDirectorDefaults({
    aspectRatio: "21:9",
    motion: "interpretive",
    duration: "long",
    seed: 0,
  });
  assert.equal(fallback.aspectRatio, "16:9");
  assert.equal(fallback.motion, "local");
  assert.equal(fallback.duration, 30);
  // 0 is the form's way of saying "a fresh seed each run".
  assert.equal(fallback.seed, null);
});

test("beat counts follow the skill's own pacing table", () => {
  const thirty = beatCountForDuration(30);
  const sixty = beatCountForDuration(60);
  // 30s -> 6-8 beats, 60s -> 10-12, from references/beat-layer.md §2.
  assert.ok(thirty.min >= 5 && thirty.min <= 7, `30s min was ${thirty.min}`);
  assert.ok(thirty.max >= 7 && thirty.max <= 9, `30s max was ${thirty.max}`);
  assert.ok(sixty.min >= 10 && sixty.min <= 12, `60s min was ${sixty.min}`);
  assert.ok(sixty.max <= 14, `60s max was ${sixty.max}`);
  // A very short film still has more than one beat to cut between.
  assert.ok(beatCountForDuration(5).min >= 2);
});

// ---------------------------------------------------------------------------
// Schemas: what a model is allowed to return
// ---------------------------------------------------------------------------

test("the element schema refuses a box that would animate nothing", async () => {
  const { motionPlanSchema } = await import("../src/lib/vox-director/schemas.ts");
  const plan = (bbox) => ({
    elements: [
      { name: "headline", bbox, mode: "crop", entrance: "slap", from: "T", start: 0.2, spin: 0 },
    ],
    cameraZoom: 1.06,
    cameraShake: true,
    confetti: false,
    starburst: false,
  });
  assert.equal(motionPlanSchema.safeParse(plan([60, 40, 940, 400])).success, true);
  // Inverted corners are a plan the model did not mean.
  assert.equal(motionPlanSchema.safeParse(plan([940, 400, 60, 40])).success, false);
  // A sliver is not an element.
  assert.equal(motionPlanSchema.safeParse(plan([100, 100, 120, 400])).success, false);
  // Off the grid entirely.
  assert.equal(motionPlanSchema.safeParse(plan([0, 0, 2000, 500])).success, false);
});

test("an element name can never become a path", async () => {
  const { motionPlanSchema } = await import("../src/lib/vox-director/schemas.ts");
  const { safeName } = await import("../src/lib/vox-director/motion-backend.ts");
  const named = (name) =>
    motionPlanSchema.safeParse({
      elements: [
        { name, bbox: [60, 40, 940, 400], mode: "crop", entrance: "slap", from: "T", start: 0, spin: 0 },
      ],
      cameraZoom: 1,
      cameraShake: false,
      confetti: false,
      starburst: false,
    }).success;
  assert.equal(named("headline"), true);
  assert.equal(named("hero_2"), true);
  assert.equal(named("../../brain"), false);
  assert.equal(named("a/b"), false);
  assert.equal(named("a b"), false);

  // And even if one got through, it is scrubbed before it reaches a file name.
  assert.equal(safeName("../../brain.db"), "braindb");
  assert.equal(safeName("C:\\windows"), "cwindows");
  assert.equal(safeName(""), "piece");
});

test("a stored production is verified rather than trusted", async () => {
  const { parseStoredProduction, VOX_PRODUCTION_SCHEMA_VERSION } = await import(
    "../src/lib/vox-director/schemas.ts"
  );
  assert.equal(parseStoredProduction({}).ok, false);
  assert.equal(parseStoredProduction(null).ok, false);
  assert.equal(parseStoredProduction([]).ok, false);
  // A version this build does not understand is refused, not half-rendered.
  const wrongVersion = parseStoredProduction({
    ...minimalProduction(),
    schemaVersion: VOX_PRODUCTION_SCHEMA_VERSION + 1,
  });
  assert.equal(wrongVersion.ok, false);
  assert.match(wrongVersion.error, /schema version/i);

  const good = parseStoredProduction(minimalProduction());
  assert.equal(good.ok, true, good.ok ? "" : `${good.error} ${good.issues.join("; ")}`);
});

function minimalProduction() {
  return {
    schemaVersion: 1,
    id: "voxrun_" + "a".repeat(32),
    title: "Why the sky is blue",
    brief: "why the sky is blue",
    logline: "Light scatters.",
    arc: "hook_payoff",
    ending: "hard_cut",
    language: "en",
    duration: 10,
    aspectRatio: "16:9",
    style: {
      theme: "american-retro",
      idiom: "american-retro",
      palette: "red, mustard, teal",
      typeStyle: "wood type",
      finish: "halftone",
      mood: "punchy",
      motionStyle: "punchy",
      rationale: "It suits a mid-century science explainer.",
      captionStyle: "white",
    },
    seed: null,
    beats: [
      {
        id: 1,
        title: "WHY BLUE",
        narration: "The sky is not painted.",
        background: "deep blue",
        feel: "curious",
        hook: "direct_question",
        narrationSeconds: 3.2,
        narrationRelativePath: "audio/beat_1.wav",
        shots: [
          {
            id: "a",
            key: "1a",
            duration: 4,
            shotSize: "WIDE",
            cameraMove: "push_in",
            scene: "a paper sun over torn blue sky",
            elementMotion: "the sun bobs, scraps drift",
            title: true,
            imagePrompt: "…",
            negativePrompt: "",
            poster: null,
            motionPlan: null,
            clipBackend: "local",
            clipRelativePath: "motion/clip_1a.mp4",
            clipNote: "",
          },
        ],
      },
    ],
    renderPlan: {
      imageBackend: "title-card",
      imageBackendReason: "",
      posterCount: 1,
      motionBackend: "local",
      motionBackendReason: "",
      narrationBackend: "voicebox:kokoro",
      narrationVoice: "Echo",
      narrationBackendReason: "",
      musicSource: "silence",
      musicReason: "",
      video: null,
      videoReason: "",
    },
    runId: "voxrun_" + "a".repeat(32),
    revisions: [],
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Workspace containment
// ---------------------------------------------------------------------------

test("nothing resolves outside the run's own workspace", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vox-workspace-"));
  process.env.VOX_DIRECTOR_WORKSPACE_ROOT = root;
  try {
    const workspace = await import(
      `../src/lib/vox-director/workspace.ts?containment=${Date.now()}`
    );
    const runId = `voxrun_${"b".repeat(32)}`;

    assert.equal(workspace.isRunId(runId), true);
    assert.equal(workspace.isRunId("voxrun_short"), false);
    assert.equal(workspace.isRunId("../../etc"), false);
    assert.throws(() => workspace.runDirectory("../../etc"), /not valid/);

    workspace.createWorkspace({ runId, userId: 7, brief: "a topic" });
    const owner = workspace.readOwner(runId);
    assert.equal(owner.userId, 7);
    // A run id must never be readable by another account.
    assert.throws(() => workspace.requireWorkspaceOwner(8, runId), /not found/);
    assert.equal(workspace.requireWorkspaceOwner(7, runId).runId, runId);

    // Inside is fine.
    assert.ok(workspace.resolveInWorkspace(runId, "keyframes/poster_1a.png"));
    // Out is not — in every spelling.
    for (const escape of [
      "../other-run/final.mp4",
      "../../../db/brain.db",
      "keyframes/../../../secrets",
      path.resolve(root, "elsewhere.txt"),
    ]) {
      assert.throws(
        () => workspace.resolveInWorkspace(runId, escape),
        /outside the run/,
        `${escape} was allowed`,
      );
    }

    // A spec's name cannot become a path either.
    const spec = workspace.writeSpec(runId, "../../evil", { ok: true });
    assert.ok(spec.startsWith(path.resolve(root, runId)));
  } finally {
    delete process.env.VOX_DIRECTOR_WORKSPACE_ROOT;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the Python driver checks containment again on its own side", () => {
  // The spec file crosses a process boundary, so the second check is what makes
  // tampering with one between the two useless.
  const driver = fs.readFileSync(path.join(dashboardRoot, "scripts", "vox_local.py"), "utf8");
  assert.match(driver, /def inside\(root, candidate\)/);
  assert.match(driver, /path escapes the run workspace/);
  // Every operation that opens or writes a file goes through it.
  for (const op of ["op_posters", "op_elements", "op_motion", "op_kenburns", "op_scrapbook", "op_still", "op_silence", "op_assemble", "op_probe"]) {
    const body = driver.slice(driver.indexOf(`def ${op}(`), driver.indexOf("\ndef ", driver.indexOf(`def ${op}(`) + 10));
    assert.match(body, /inside\(root,/, `${op} opens a path without a containment check`);
  }
});

// ---------------------------------------------------------------------------
// The fallback chains
// ---------------------------------------------------------------------------

test("motion degrades downward and never upward", async () => {
  const { motionChain } = await import("../src/lib/vox-director/motion-backend.ts");
  assert.deepEqual(motionChain("auto"), ["local", "scrapbook", "kenburns", "still"]);
  assert.deepEqual(motionChain("local"), ["local", "scrapbook", "kenburns", "still"]);
  assert.deepEqual(motionChain("scrapbook"), ["scrapbook", "kenburns", "still"]);
  // Someone who asked for the fast renderer did not ask to wait for a frame loop.
  assert.deepEqual(motionChain("kenburns"), ["kenburns", "still"]);
});

test("a model-planned box is held to the grid before it is cut", async () => {
  const { normaliseBox } = await import("../src/lib/vox-director/motion-backend.ts");
  assert.deepEqual(normaliseBox([940, 400, 60, 40]), [60, 40, 940, 400]);
  assert.deepEqual(normaliseBox([-50, -10, 1500, 2000]), [0, 0, 1000, 1000]);
  assert.deepEqual(normaliseBox([10.4, 20.6, 30.5, 40.2]), [10, 21, 31, 40]);
});

test("images fall back to title cards, and --no-images asks for them", async () => {
  const { planImageBackend } = await import("../src/lib/vox-director/image-backend.ts");
  const off = await planImageBackend({ images: false, configuredCheckpoint: null });
  assert.equal(off.backend, "title-card");
  assert.match(off.reason, /--no-images/);
  // A run that could not draw says so; it never reports posters it did not make.
  assert.notEqual(off.reason, "");
});

test("a poster seed is derived from the film's, so one flag fixes them all", async () => {
  const { shotSeed } = await import("../src/lib/vox-director/image-backend.ts");
  assert.equal(shotSeed(1234, "1a"), shotSeed(1234, "1a"));
  assert.notEqual(shotSeed(1234, "1a"), shotSeed(1234, "1b"));
  assert.notEqual(shotSeed(1234, "1a"), shotSeed(1235, "1a"));
  assert.ok(Number.isInteger(shotSeed(1234, "1a")) && shotSeed(1234, "1a") >= 0);
});

test("narration is the one stage that does not degrade", () => {
  const pipeline = source("src/lib/vox-director/pipeline.ts");
  // A narrated explainer with no narration is not a lesser film, it is the
  // wrong one — so this throws rather than assembling silence.
  assert.match(pipeline, /throw new VoxPipelineError\("no_narration"/);
  assert.match(pipeline, /does not degrade/);
  // Music, by contrast, is allowed to be nothing at all.
  assert.match(source("src/lib/vox-director/audio-backend.ts"), /source: "silence"/);
});

test("a render is only reported when ffprobe can read it back", () => {
  const pipeline = source("src/lib/vox-director/pipeline.ts");
  assert.match(pipeline, /parsed\.codec !== "h264"/);
  assert.match(pipeline, /duration <= 0\.5/);
  assert.match(pipeline, /fs\.existsSync\(final\)/);
});

// ---------------------------------------------------------------------------
// The event protocol — both sides have to agree on the names
// ---------------------------------------------------------------------------

test("the card listens for exactly the events the run emits", () => {
  const card = source("src/app/components/hermes/inline-vox-director-run.tsx");
  const emitted = new Set();
  for (const file of ["src/lib/vox-director/run-manager.ts", "src/lib/vox-director/pipeline.ts"]) {
    for (const match of source(file).matchAll(/emit\(\s*(?:run,\s*)?"([a-z_]+\.[A-Za-z_]+)"/g)) {
      emitted.add(match[1]);
    }
  }
  // Every stage the brief asks a run to report.
  for (const required of [
    "run.started",
    "plan.started",
    "plan.completed",
    "style.started",
    "style.completed",
    "keyframes.started",
    "keyframe.started",
    "keyframe.completed",
    "keyframes.completed",
    "motion.started",
    "beat_motion.started",
    "beat_motion.completed",
    "motion.completed",
    "audio.started",
    "narration.completed",
    "audio.completed",
    "assembly.started",
    "assembly.completed",
    "artifact.created",
    "run.completed",
    "run.failed",
    "run.aborted",
  ]) {
    assert.ok(emitted.has(required), `the run never emits ${required}`);
  }

  // The card subscribes by name, so a rename on one side is a silent card.
  const subscribed = new Set(
    [...card.matchAll(/^\s+"([a-z_]+\.[A-Za-z_]+)",$/gm)].map((match) => match[1]),
  );
  for (const type of subscribed) {
    assert.ok(emitted.has(type), `the card listens for ${type}, which nothing emits`);
  }
  for (const type of emitted) {
    // Progress chatter is deliberately not rendered; everything else is.
    if (type === "assembly.progress" || type === "run.usage") continue;
    assert.ok(subscribed.has(type), `${type} is emitted but the card ignores it`);
  }
});

test("the run manager keeps the contract every agent keeps", () => {
  // Asserted from source, the way every other agent's manager is: importing one
  // pulls in `server-only`, the database and a Voicebox client, none of which
  // belong in a unit test process.
  const src = source("src/lib/vox-director/run-manager.ts");
  for (const name of ["startRun", "getEventsSince", "isTerminal", "abortRun"]) {
    assert.ok(
      src.includes(`export function ${name}(`),
      `run-manager has no exported ${name}`,
    );
  }
  // An unknown or someone else's run is an error, not a silent empty list.
  assert.match(src, /if \(!run \|\| run\.userId !== userId\) throw new Error\("run_not_found"\)/);
  // Events are append-only and sequenced, so the SSE route can replay.
  assert.match(src, /sequenceNumber: run\.sequence/);
  assert.match(src, /event\.sequenceNumber > since/);
  // Ownership is checked on the way in, not assumed.
  assert.match(src, /run\.userId !== userId/);
  // Terminal events carry the summary that becomes the saved message.
  assert.match(src, /emit\(run, "run\.completed", \{\s*\n\s*summary:/);
  assert.match(src, /emit\(run, "run\.aborted", \{ summary:/);
  // Cleanup is scheduled and unreferenced.
  assert.match(src, /setTimeout\(\(\) => runs\.delete\(run\.runId\), RETENTION_MS\)\.unref\?\.\(\)/);
});

test("an abort stops the render, not just the promise", () => {
  const manager = source("src/lib/vox-director/run-manager.ts");
  // The signal takes the driver Python; the tree kill takes the ffmpeg it was
  // piping frames into.
  assert.match(manager, /run\.controller\.abort\(\)/);
  assert.match(manager, /for \(const pid of run\.children\) killTree\(pid\)/);
  const runtime = source("src/lib/vox-director/runtime.ts");
  assert.match(runtime, /taskkill", \["\/pid", String\(pid\), "\/T", "\/F"\]/);
  // And an abort route exists that reaches it.
  assert.match(
    source("src/app/api/vox-director/runs/[runId]/abort/route.ts"),
    /abortRun\(userId, runId\)/,
  );
});

// ---------------------------------------------------------------------------
// The routes
// ---------------------------------------------------------------------------

test("every route authenticates, and the run route resolves ChatMock properly", () => {
  const routes = [
    "src/app/api/vox-director/runs/route.ts",
    "src/app/api/vox-director/runs/[runId]/events/route.ts",
    "src/app/api/vox-director/runs/[runId]/abort/route.ts",
    "src/app/api/vox-director/health/route.ts",
  ];
  for (const route of routes) {
    assert.match(source(route), /requireUserId\(\)/, `${route} does not authenticate`);
  }
  const runs = source("src/app/api/vox-director/runs/route.ts");
  // Never a hard-coded ChatMock URL: the desktop/host split depends on this.
  assert.match(runs, /resolveChatmockBaseUrl\(request\)/);
  assert.doesNotMatch(runs, /127\.0\.0\.1:8765/);
  // Stored defaults, then the message on top of them.
  assert.match(runs, /agentSettingsFor\(userId, VOX_DIRECTOR_AGENT_ID\)/);
  assert.match(runs, /parseVoxDirectorRequest\(brief, voxDirectorDefaults\(settings\)\)/);
  // The chat is carried in its own field, never folded into the brief.
  assert.match(runs, /conversationContext: conversationContextFromBody\(userId, body/);
  assert.doesNotMatch(runs, /brief:\s*`\$\{/);
  // A stacked capability token is refused rather than read as topic material.
  assert.match(runs, /findCapabilityConflict\(/);
  // Nothing is installed on the path of a run.
  assert.doesNotMatch(runs, /setup|install/i);
});

test("health distinguishes ready, degraded and unavailable", async () => {
  const { voxHealthLevel } = await import("../src/lib/vox-director/runtime.ts");
  assert.equal(voxHealthLevel({ blocking: [], degraded: [] }), "ready");
  // ComfyUI missing but the title cards available.
  assert.equal(voxHealthLevel({ blocking: [], degraded: ["no ComfyUI"] }), "degraded");
  // ffmpeg missing.
  assert.equal(voxHealthLevel({ blocking: ["no ffmpeg"], degraded: [] }), "unavailable");
  assert.equal(voxHealthLevel({ blocking: ["no ffmpeg"], degraded: ["no ComfyUI"] }), "unavailable");

  const route = source("src/app/api/vox-director/health/route.ts");
  // The things that stop a film entirely.
  for (const blocker of ["ffmpeg", "ffprobe", "Pillow", "ChatMock", "Python"]) {
    assert.match(route, new RegExp(`blocking\\.push\\([^)]*${blocker}`, "i"), `${blocker} is not blocking`);
  }
  // And the one that only costs the look.
  assert.match(route, /degraded\.push\([\s\S]{0,200}title cards/);
  // A cloned directory existing is never on its own a reason to report healthy.
  const runtime = source("src/lib/vox-director/runtime.ts");
  assert.match(runtime, /scripts", "motion\.py"/);
  assert.match(runtime, /scripts", "assemble\.py"/);
  assert.match(runtime, /references", "prompt-guide\.md"/);
});

// ---------------------------------------------------------------------------
// The persisted descriptor and the artifacts
// ---------------------------------------------------------------------------

test("the run descriptor is persisted at launch, on both chat surfaces", async () => {
  const { parseExternalAgentRun, EXTERNAL_AGENT_RUN_FIELD_BY_KIND, externalAgentDisplayName } =
    await import("../src/lib/conversations/external-agent-runs.ts");

  const parsed = parseExternalAgentRun({
    kind: "vox_director",
    runId: "voxrun_1",
    brief: "why the sky is blue",
  });
  assert.deepEqual(parsed, {
    kind: "vox_director",
    runId: "voxrun_1",
    brief: "why the sky is blue",
  });
  // A malformed descriptor must not break an otherwise healthy transcript.
  assert.equal(parseExternalAgentRun({ kind: "vox_director", runId: "voxrun_1" }), null);
  assert.equal(parseExternalAgentRun({ kind: "vox_director", brief: "x" }), null);
  assert.equal(EXTERNAL_AGENT_RUN_FIELD_BY_KIND.vox_director, "voxDirectorRun");
  assert.equal(externalAgentDisplayName("vox_director"), "Vox Director");

  const terminal = source("src/app/components/hermes/dashboard-agent-terminal.tsx");
  const garden = source("src/app/gardens/[clusterSlug]/workspace-client.tsx");
  // Persisted when the run launches, not when it completes: a run that finishes
  // while the tab is closed still has to come back.
  assert.match(terminal, /run: \{ kind: "vox_director", runId: String\(data\.run\.runId\), brief \}/);
  assert.match(garden, /voxDirectorRun: \{ runId: String\(data\.run\.runId\), brief \},/);
  assert.match(garden, /externalAgentOutcome: "running",/);
  // Both surfaces route the command.
  assert.match(terminal, /routeVoxDirectorCommand\(/);
  assert.match(garden, /briefFromVoxDirectorCommand\(text\)/);
  // And a model may delegate to it.
  assert.match(terminal, /case "vox-director":\s*\n\s*await launchVoxDirectorRun\(request\.brief\);/);
  assert.match(garden, /case "vox-director":\s*\n\s*await launchVoxDirector\(request\.brief\);/);
});

test("the film and the production belong to the chat that made them", () => {
  const artifact = source("src/lib/vox-director/artifact.ts");
  // The conversation is captured at launch and resolved from its public id.
  assert.match(artifact, /getConversationForUser\(input\.conversationPublicId, input\.userId\)/);
  assert.match(artifact, /findExternalAgentAssistantMessage\(/);
  // The MP4 goes through the same door as every other video in Breadboard, so
  // it plays in the transcript and opens in the existing studio.
  assert.match(artifact, /kind: "video"/);
  assert.match(artifact, /createImportedArtifact\(/);
  // The importer is only allowed inside the run that produced the file.
  assert.match(artifact, /authorizedRoot: input\.workspaceRoot/);
  // clusterId is the garden only on a garden chat.
  assert.match(artifact, /conversation\.surface === "garden_chat" \? conversation\.default_garden_id : null/);
  // Artifacts are never listed unscoped.
  assert.match(artifact, /listArtifactsForUser\(\{\s*\n\s*userId: input\.userId,\s*\n\s*conversationPublicId/);

  // A storage failure is reported, never a claim that the film was published.
  const manager = source("src/lib/vox-director/run-manager.ts");
  assert.match(manager, /emit\(run, "artifact\.failed"/);
  assert.match(manager, /could not be attached to this conversation/);
  assert.match(manager, /still on disk in the run's workspace/);
});

test("reopening a finished production never calls a model", () => {
  const viewer = source("src/app/components/vox-director/vox-production-artifact.tsx");
  // Everything renders from the stored document; the only requests are for the
  // artifact bytes the browser plays or shows.
  assert.doesNotMatch(viewer, /chat\/completions|\/api\/vox-director\/runs/);
  assert.match(viewer, /production\.beats\.map|production\.beats\.flatMap/);
  const renderers = source("src/lib/hermes/artifact-renderers.ts");
  assert.match(renderers, /id: "vox-director-production"/);
  assert.match(renderers, /parseStoredProduction/);
});

// ---------------------------------------------------------------------------
// The promise the whole integration rests on
// ---------------------------------------------------------------------------

test("nothing in the integration reaches Atlas Cloud or wants an API key", () => {
  const files = [
    ...fs
      .readdirSync(path.join(dashboardRoot, "src/lib/vox-director"))
      .map((name) => `src/lib/vox-director/${name}`),
    "src/app/api/vox-director/runs/route.ts",
    "src/app/api/vox-director/runs/[runId]/events/route.ts",
    "src/app/api/vox-director/runs/[runId]/abort/route.ts",
    "src/app/api/vox-director/health/route.ts",
    "src/app/components/hermes/inline-vox-director-run.tsx",
    "src/app/components/vox-director/vox-production-artifact.tsx",
    "scripts/vox_local.py",
  ];
  // A comment naming the thing that is deliberately *not* used is the point of
  // the integration; a line of code that could reach it is the failure. So the
  // scan is of code, with the comments stripped out first.
  const codeOnly = (body) =>
    body
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .split(/\r?\n/)
      .map((line) => line.replace(/(^|\s)(\/\/|#).*$/, ""))
      .join("\n");
  for (const file of files) {
    const body = codeOnly(source(file));
    assert.doesNotMatch(body, /atlascloud/i, `${file} names Atlas Cloud in code`);
    assert.doesNotMatch(body, /ATLASCLOUD_API_KEY/, `${file} reads an Atlas Cloud key`);
  }

  // The clone's hosted path lives behind provider.py; the driver never imports it.
  const driver = fs.readFileSync(path.join(dashboardRoot, "scripts", "vox_local.py"), "utf8");
  assert.doesNotMatch(driver, /^import provider|^from provider|^import atlas_cloud/m);
  assert.doesNotMatch(driver, /import (?:requests|urllib\.request|httpx)/);
  // What it does import is the clone's craft.
  assert.match(driver, /^import styles\b/m);
  assert.match(driver, /^import text_overlay\b/m);
  assert.match(driver, /import motion\b/);
  assert.match(driver, /import assemble\b/);

  // And the only model layer is ChatMock.
  const client = source("src/lib/vox-director/model-client.ts");
  assert.match(client, /chatmockApiKeyValue\(\)/);
  assert.doesNotMatch(client, /openai\.com|anthropic\.com|generativelanguage|openrouter|ollama|llama\.cpp/i);
});

test("the creative knowledge is read from the clone, not restated here", () => {
  const prompts = source("src/lib/vox-director/prompts.ts");
  // The prompts point at upstream's reference files at run time.
  assert.match(prompts, /referenceSection\(input\.cloneRoot, "beat-layer\.md"/);
  assert.match(prompts, /referenceSection\(input\.cloneRoot, "prompt-guide\.md"/);
  assert.match(prompts, /referenceSection\(input\.cloneRoot, "local-engine\.md"/);

  // And the collage prompt itself is composed by the clone's own composer,
  // so pulling the clone updates the look.
  const driver = fs.readFileSync(path.join(dashboardRoot, "scripts", "vox_local.py"), "utf8");
  assert.match(driver, /styles\.compose_collage_prompt\(/);
  assert.match(driver, /styles\.THEME_PRESETS/);
  const pipeline = source("src/lib/vox-director/pipeline.ts");
  assert.match(pipeline, /operation: "prompts"/);
  assert.match(pipeline, /operation: "themes"/);
  // The final render is upstream's assembly stage, not a second one.
  assert.match(driver, /assemble\.run\(project\)/);
});

test("the clone is present and still has the pieces the run executes", () => {
  // Not a health assertion — a structural one. If upstream renames these, the
  // integration is broken and this is where that is noticed.
  const clone = path.join(repoRoot, "vox-director");
  if (!fs.existsSync(clone)) {
    // A checkout without the clone is legitimate; the run reports it as
    // unavailable rather than failing halfway through.
    return;
  }
  for (const relative of [
    "SKILL.md",
    "scripts/styles.py",
    "scripts/motion.py",
    "scripts/text_overlay.py",
    "scripts/assemble.py",
    "scripts/kenburns.py",
    "scripts/mg_scrapbook.py",
    "scripts/extract_elements.py",
    "references/beat-layer.md",
    "references/prompt-guide.md",
    "references/local-engine.md",
  ]) {
    assert.ok(fs.existsSync(path.join(clone, relative)), `the clone is missing ${relative}`);
  }
  // The functions the driver calls by name.
  const styles = fs.readFileSync(path.join(clone, "scripts", "styles.py"), "utf8");
  assert.match(styles, /def compose_collage_prompt\(/);
  assert.match(styles, /^THEME_PRESETS = \{/m);
  const motion = fs.readFileSync(path.join(clone, "scripts", "motion.py"), "utf8");
  for (const symbol of ["class Layer", "def fly_in", "def slap", "def drop", "def pop_settle", "class Confetti", "def starburst"]) {
    assert.ok(motion.includes(symbol), `motion.py no longer has ${symbol}`);
  }
  const assembleSource = fs.readFileSync(path.join(clone, "scripts", "assemble.py"), "utf8");
  assert.match(assembleSource, /def run\(project_dir\)/);
  // The keys Breadboard writes into beats.json for it.
  for (const key of ["clip_path", "narration_audio", "narration_dur", "bgm_path", "caption_style"]) {
    assert.ok(assembleSource.includes(key), `assemble.py no longer reads ${key}`);
  }
});

test("the upstream beats.json Breadboard writes is upstream's own shape", async () => {
  const { writeUpstreamBeatsDocument } = await import(
    "../src/lib/vox-director/beats-document.ts"
  );
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vox-beats-"));
  process.env.VOX_DIRECTOR_WORKSPACE_ROOT = root;
  try {
    const workspace = await import(`../src/lib/vox-director/workspace.ts?beats=${Date.now()}`);
    const runId = `voxrun_${"c".repeat(32)}`;
    workspace.createWorkspace({ runId, userId: 1, brief: "t" });

    const production = minimalProduction();
    production.runId = runId;
    production.id = runId;
    const written = writeUpstreamBeatsDocument(runId, production, "audio/silence.wav");
    const document = JSON.parse(fs.readFileSync(written, "utf8"));

    // Upstream's schema, so a production made here can be driven by hand from
    // vox-director/out/<project>/ exactly as SKILL.md documents.
    assert.equal(document.aspect, "16:9");
    assert.equal(document.language, "en");
    assert.equal(document.theme, "american-retro");
    assert.equal(document.arc, "hook_payoff");
    assert.equal(document.captions, true);
    assert.equal(document.caption_style, "white");
    assert.deepEqual(document.mix, { music: 0.6, voice: 1.25 });
    assert.equal(document.beats[0].title_en, "WHY BLUE");
    assert.equal(document.beats[0].narration_dur, 3.2);
    assert.ok(document.beats[0].shots[0].clip_path.endsWith("clip_1a.mp4"));
    assert.ok(path.isAbsolute(document.beats[0].shots[0].clip_path));
    assert.ok(document.bgm_path.endsWith("silence.wav"));

    // Two claims this document must never make.
    assert.equal(document.provider, "none");
    assert.equal(document.watermark, "");
  } finally {
    delete process.env.VOX_DIRECTOR_WORKSPACE_ROOT;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Vox Director is offered as itself, next to the agents it is confused with", async () => {
  const { runtimeAgentBrief } = await import("../src/lib/hermes/runtime-agent-briefs.ts");
  const brief = runtimeAgentBrief("vox-director");
  assert.ok(brief, "Vox Director has no selection brief");
  // The two neighbours a chooser cannot tell it from by topic alone.
  assert.match(`${brief.does} ${brief.choose}`, /ViMax/);
  assert.match(`${brief.does} ${brief.choose}`, /HyperFrames/);
  // And both of them point back.
  assert.match(
    `${runtimeAgentBrief("vimax").does} ${runtimeAgentBrief("vimax").choose}`,
    /Vox Director/,
  );
  assert.match(
    `${runtimeAgentBrief("hyperframes").does} ${runtimeAgentBrief("hyperframes").choose}`,
    /Vox Director/,
  );
});

test("a shot key is matched however the model writes it back", async () => {
  const { planKey } = await import("../src/lib/vox-director/motion-backend.ts");
  // Every spelling a live run has actually produced for the same poster.
  for (const spelling of ["1a", " 1A ", "shot 1a", "Shot 1A", "beat 1 shot a", "1-a"]) {
    assert.equal(planKey(spelling), "1a", spelling);
  }
  assert.equal(planKey("10b"), "10b");
  assert.equal(planKey("beat 1 shot b"), "1b");
  // A bare beat number means its first shot, which is what a one-shot beat is.
  assert.equal(planKey("3"), "3a");
  // And something with no shot in it at all matches nothing.
  assert.equal(planKey("headline"), "");
  assert.notEqual(planKey("2a"), planKey("1a"));
});
