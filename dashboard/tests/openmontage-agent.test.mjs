import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dashboardRoot = path.resolve(import.meta.dirname, "..");
const source = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");

const identity = await import("../src/lib/openmontage/identity.ts");
const runtime = await import("../src/lib/openmontage/runtime.ts");
const prompt = await import("../src/lib/openmontage/prompt.ts");
const workspace = await import("../src/lib/openmontage/workspace.ts");

// The workspace module resolves its root from the environment, so every test
// that touches disk gets its own directory and none of them can see a real run.
// Awaited rather than returned: a sync teardown would delete the directory out
// from under an async body still writing into it.
async function withWorkspaceRoot(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-openmontage-"));
  const previous = process.env.OPENMONTAGE_WORKSPACE_ROOT;
  process.env.OPENMONTAGE_WORKSPACE_ROOT = dir;
  try {
    return await run(dir);
  } finally {
    if (previous === undefined) delete process.env.OPENMONTAGE_WORKSPACE_ROOT;
    else process.env.OPENMONTAGE_WORKSPACE_ROOT = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** WorkspaceError carries its reason as `code`; the message is for a person. */
const hasCode = (code) => (error) => error?.code === code;

const RUN_ID = `omrun_${"a1b2c3d4".repeat(4)}`;

/** Write a production directory that looks like one OpenMontage would write. */
function seedProduction(runId, { pipelineType = "documentary-montage", stages = [], files = {} } = {}) {
  const projectDir = path.join(workspace.projectsDirectory(runId), "production-1");
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, "project.json"),
    JSON.stringify({
      version: "1.0",
      project_id: "production-1",
      title: "The Library at Alexandria",
      pipeline_type: pipelineType,
    }),
  );
  for (const stage of stages) {
    fs.writeFileSync(
      path.join(projectDir, `checkpoint_${stage}.json`),
      JSON.stringify({ stage, status: "complete" }),
    );
  }
  for (const [relative, contents] of Object.entries(files)) {
    const absolute = path.join(projectDir, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, contents);
  }
  return projectDir;
}

test("the command carries its brief, and a bare token starts nothing", () => {
  assert.equal(
    identity.briefFromOpenMontageCommand("/agents:openmontage a 60s history elegy"),
    "a 60s history elegy",
  );
  // A bare token is the palette inserting the command: the person is still
  // typing, so the caller must not launch an empty production.
  assert.equal(identity.briefFromOpenMontageCommand("/agents:openmontage"), "");
  assert.equal(identity.briefFromOpenMontageCommand("/agents:hyperframes a promo"), null);
  assert.equal(identity.briefFromOpenMontageCommand("make me a documentary"), null);
  assert.equal(
    identity.openMontageUserMessage("a trailer about deep time"),
    "/agents:openmontage a trailer about deep time",
  );
  // Prose that merely mentions the agent is not a command.
  assert.equal(identity.briefFromOpenMontageCommand("use /agents:openmontage for this"), null);
});

test("the three spellings of the agent's name agree", () => {
  assert.equal(identity.OPENMONTAGE_COMMAND, `/agents:${identity.OPENMONTAGE_AGENT_ID}`);
  assert.equal(identity.OPENMONTAGE_AGENT_NAME, "OpenMontage");
});

test("the prompt lifts the approval gates but keeps the decision record", () => {
  const rules = prompt.operatingRules({
    root: "/clone/OpenMontage",
    projectsDirectory: "/runs/omrun_x/projects",
    projectId: "production-1",
    env: {},
  });
  // The guide is written for a person at a terminal. The single thing this
  // prompt must override is the waiting, and the single thing it must NOT
  // override is the logging — that log is the card's only record of the run.
  assert.match(rules, /not interactive/i);
  assert.match(rules, /approval gates.*lifted/is);
  assert.match(rules, /decision_log\.json/);
  assert.match(rules, /options_considered/);
  assert.match(rules, /append/i);
  // The gate is not a policy the prompt can talk its way past: lib/checkpoint.py
  // REFUSES to write a gated stage as completed without human_approved=True, and
  // the error it raises tells the agent to end its turn. Found by running the
  // real thing. Without this instruction every production stalls at stage one.
  assert.match(rules, /human_approved=True/);
  assert.match(rules, /breadboard-autonomous-run/);
  // And the trail must not claim a person approved it, because none did.
  assert.match(rules, /Never record it as a person's approval/i);
  // Rule Zero must survive: an agent that skips the pipeline makes worse video.
  assert.match(rules, /pipeline_defs/);
  assert.match(rules, /director skill/i);
  // Nothing that fails to exit may be started inside a one-shot run.
  assert.match(rules, /backlot/i);
  assert.match(rules, /remotion studio/i);
  // The clone is shared: a production must not write into it.
  assert.match(rules, /do not edit it/i);
  assert.match(rules, /OPENMONTAGE_PROJECTS_DIR/);
  assert.match(rules, /production-1/);
});

test("the prompt tells the agent what it may actually spend", () => {
  const keyless = prompt.operatingRules({
    root: "/clone/OpenMontage",
    projectsDirectory: "/runs/p",
    projectId: "production-1",
    env: {},
  });
  // Without keys the generation tools report themselves unavailable. Saying so
  // up front stops the agent planning a shoot it cannot execute.
  assert.match(keyless, /No paid provider keys/i);
  assert.match(keyless, /expected, not a fault/i);

  const withKeys = prompt.operatingRules({
    root: "/clone/OpenMontage",
    projectsDirectory: "/runs/p",
    projectId: "production-1",
    env: { PEXELS_API_KEY: "x", ELEVENLABS_API_KEY: "y" },
  });
  assert.match(withKeys, /ELEVENLABS_API_KEY/);
  assert.match(withKeys, /PEXELS_API_KEY/);
  assert.match(withKeys, /unavailable no matter what a skill suggests/i);
});

test("only keys that are actually set are reported to the agent", () => {
  assert.deepEqual(prompt.configuredProviders({ FAL_KEY: "  " }), []);
  assert.deepEqual(prompt.configuredProviders({ SUNO_API_KEY: "abc" }), ["SUNO_API_KEY"]);
  // A variable that is not a provider key never becomes one.
  assert.deepEqual(prompt.configuredProviders({ PATH: "/usr/bin" }), []);
});

test("the run environment steers writes out of the clone and asks for UTF-8", () => {
  const toolchain = {
    python: { found: true, path: "/venv/bin/python", source: "venv", version: "3.10", dependencies: true },
    ffmpeg: { found: true, path: "/tools/bin/ffmpeg", source: "agent-reach" },
    ffprobe: { found: true, path: "/tools/bin/ffprobe", source: "agent-reach" },
    node: { found: true, path: "/usr/bin/node", source: "path", version: "v22" },
    remotion: { found: false, path: "", source: "" },
  };
  const env = runtime.openMontageEnv(
    toolchain,
    { projectsDirectory: "/runs/omrun_x/projects" },
    { PATH: "/usr/bin", OPENMONTAGE_ROOT: "/clone/OpenMontage" },
  );
  // The load-bearing variable: upstream's lib/paths.py reads it and every
  // checkpoint, artifact and project marker follows it.
  assert.equal(env.OPENMONTAGE_PROJECTS_DIR, "/runs/omrun_x/projects");
  // The tool registry scrubs unicode for cp1252 consoles; asking for UTF-8 is
  // the fix rather than the workaround.
  assert.equal(env.PYTHONIOENCODING, "utf-8");
  assert.equal(env.PYTHONUTF8, "1");
  // A bare `ffmpeg` must resolve to the copy we found, because that is what
  // every OpenMontage tool shells out to — so our directories have to come
  // before whatever the inherited PATH offers, and the inherited PATH has to
  // survive underneath them.
  const entries = env.PATH.split(path.delimiter);
  assert.ok(
    entries.indexOf("/tools/bin") >= 0 &&
      entries.indexOf("/tools/bin") < entries.indexOf("/usr/bin"),
    `PATH was ${env.PATH}`,
  );
  assert.ok(entries.includes("/usr/bin"));
});

test("the run environment writes PATH under the name the platform already uses", () => {
  const toolchain = {
    python: { found: false, path: "", source: "", version: "", dependencies: false },
    ffmpeg: { found: true, path: "/tools/bin/ffmpeg", source: "agent-reach" },
    ffprobe: { found: false, path: "", source: "" },
    node: { found: false, path: "", source: "", version: "" },
    remotion: { found: false, path: "", source: "" },
  };
  // Windows carries PATH as `Path`. Spreading env into a plain object drops the
  // case-insensitive lookup, so writing "PATH" beside an inherited "Path" would
  // leave the real one untouched and ffmpeg would stay unreachable.
  const env = runtime.openMontageEnv(toolchain, { projectsDirectory: "/p" }, { Path: "/usr/bin" });
  const entries = env.Path.split(path.delimiter);
  assert.ok(
    entries.indexOf("/tools/bin") >= 0 &&
      entries.indexOf("/tools/bin") < entries.indexOf("/usr/bin"),
    `Path was ${env.Path}`,
  );
  // The point of the test: no second, ignored copy under the other spelling.
  assert.equal(env.PATH, undefined);
});

test("a run id is validated before it becomes a path", async () => {
  await withWorkspaceRoot(() => {
    assert.ok(workspace.isRunId(RUN_ID));
    assert.ok(!workspace.isRunId("hfrun_" + "a".repeat(32)));
    assert.ok(!workspace.isRunId("omrun_../../etc"));
    assert.throws(() => workspace.runDirectory("../escape"), hasCode("invalid_run_id"));
  });
});

test("an artifact id cannot address a file outside the production", async () => {
  await withWorkspaceRoot(() => {
    seedProduction(RUN_ID, { files: { "renders/final.mp4": "video-bytes" } });
    const artifacts = workspace.scanArtifacts(RUN_ID);
    const video = artifacts.find((item) => item.name === "final.mp4");
    assert.ok(video, "the rendered file should be scanned");
    assert.equal(workspace.resolveArtifact(RUN_ID, video.id).record.name, "final.mp4");

    // The id encodes a relative path, so a crafted one must be re-checked.
    const escape = Buffer.from("../../../../etc/passwd", "utf8").toString("base64url");
    assert.throws(() => workspace.resolveArtifact(RUN_ID, escape), hasCode("artifact_not_found"));
    assert.throws(() => workspace.resolveArtifact(RUN_ID, "not base64!"), hasCode("artifact_not_found"));
  });
});

test("the deliverable is the rendered film, not the clips that went into it", async () => {
  await withWorkspaceRoot(() => {
    seedProduction(RUN_ID, {
      files: {
        "assets/video/b-roll-01.mp4": "x".repeat(9_000),
        "assets/video/b-roll-02.mp4": "x".repeat(9_000),
        "renders/final.mp4": "x".repeat(100),
      },
    });
    const video = workspace.primaryVideo(workspace.scanArtifacts(RUN_ID));
    // The sourced clips are larger and just as fresh; only the render counts.
    assert.equal(video.relativePath, "production-1/renders/final.mp4");
  });
});

test("progress is read from the production's own checkpoints", async () => {
  await withWorkspaceRoot(() => {
    seedProduction(RUN_ID, {
      pipelineType: "documentary-montage",
      stages: ["idea", "scene_plan"],
    });
    const state = workspace.readProductionState(RUN_ID);
    assert.equal(state.projectId, "production-1");
    assert.equal(state.title, "The Library at Alexandria");
    assert.equal(state.pipelineType, "documentary-montage");
    assert.deepEqual(state.completedStages, ["idea", "scene_plan"]);
    assert.equal(state.currentStage, "scene_plan");
  });
});

test("a run with no project yet reports nothing rather than guessing", async () => {
  await withWorkspaceRoot(() => {
    fs.mkdirSync(workspace.projectsDirectory(RUN_ID), { recursive: true });
    const state = workspace.readProductionState(RUN_ID);
    assert.equal(state.projectId, null);
    assert.deepEqual(state.completedStages, []);
    assert.equal(state.currentStage, null);
  });
});

test("the stage rail comes from the chosen pipeline, not the canonical list", () => {
  const stages = workspace.pipelineStages("documentary-montage");
  // Every pipeline uses a subset. This one has no `research` stage at all, and
  // showing one would promise the person a step their video never takes.
  assert.ok(stages.includes("idea"), `stages were ${stages.join(", ")}`);
  assert.ok(stages.includes("compose"));
  assert.ok(!stages.includes("research"));
  // A manifest that cannot be read falls back rather than rendering nothing.
  assert.deepEqual(
    workspace.pipelineStages("no-such-pipeline"),
    [...workspace.PRODUCTION_STAGES],
  );
  // A pipeline name is a filename; it must not be able to address one.
  assert.deepEqual(
    workspace.pipelineStages("../../../etc/passwd"),
    [...workspace.PRODUCTION_STAGES],
  );
});

test("the decision log is read with upstream's field names", async () => {
  await withWorkspaceRoot(() => {
    const projectDir = seedProduction(RUN_ID);
    fs.writeFileSync(
      path.join(projectDir, "decision_log.json"),
      JSON.stringify({
        version: "1.0",
        project_id: "production-1",
        decisions: [
          {
            decision_id: "d-001",
            stage: "idea",
            category: "voice_selection",
            subject: "Narration TTS provider",
            // The schema's names are `selected` and `reason`, and options are
            // objects with a `label` — not `chosen`/`rationale`/plain strings.
            selected: "openai_onyx",
            reason: "Only TTS provider with a key on this machine.",
            options_considered: [
              { option_id: "o1", label: "openai_onyx", score: 8, reason: "available" },
              { option_id: "o2", label: "elevenlabs", score: 9, reason: "no key" },
            ],
          },
          {
            decision_id: "d-002",
            stage: "assets",
            category: "voice_selection",
            subject: "Narration TTS provider",
            selected: "google_chirp3",
            reason: "The person swapped the voice mid-run.",
            options_considered: [{ option_id: "o1", label: "openai_onyx", score: 6, reason: "superseded" }],
          },
        ],
      }),
    );
    const { decisions } = workspace.readProductionState(RUN_ID);
    assert.equal(decisions.length, 2);
    assert.equal(decisions[0].chosen, "openai_onyx");
    assert.equal(decisions[0].rationale, "Only TTS provider with a key on this machine.");
    assert.deepEqual(decisions[0].optionsConsidered, ["openai_onyx", "elevenlabs"]);
    // Upstream's contract: the log is append-only and the latest entry for a
    // (category, subject) pair is the current one. A card that showed both as
    // current would tell the person the voice is still the one they replaced.
    assert.equal(decisions[0].superseded, true);
    assert.equal(decisions[1].superseded, false);
  });
});

test("a malformed decision log does not take the card down with it", async () => {
  await withWorkspaceRoot(() => {
    const projectDir = seedProduction(RUN_ID, { stages: ["idea"] });
    fs.writeFileSync(path.join(projectDir, "decision_log.json"), "{ not json");
    const state = workspace.readProductionState(RUN_ID);
    assert.deepEqual(state.decisions, []);
    // The rest of the production still reads.
    assert.deepEqual(state.completedStages, ["idea"]);
  });
});

test("ownership is recorded in the workspace so a finished film outlives the run", async () => {
  await withWorkspaceRoot(async () => {
    await workspace.createWorkspace({ runId: RUN_ID, userId: 7, brief: "a history elegy" });
    assert.equal(workspace.readOwner(RUN_ID).userId, 7);
    assert.equal(workspace.requireWorkspaceOwner(7, RUN_ID).brief, "a history elegy");
    // Another account must not reach it, even with the run id in hand.
    assert.throws(() => workspace.requireWorkspaceOwner(8, RUN_ID), hasCode("run_not_found"));
  });
});

test("the agent is wired into every surface that can run it", () => {
  const files = {
    "src/lib/hermes/capability-combinations.ts": [/profile\("openmontage"/],
    "src/lib/conversations/external-agent-runs.ts": [
      /"openmontage",/,
      /openmontage: "openMontageRun"/,
      /openMontageRun\?: \{ runId: string; brief: string \}/,
    ],
    "src/app/components/hermes/command-hub.tsx": [/OPENMONTAGE_COMMAND/, /openmontage-entry/],
    "src/app/components/assistant-composer.tsx": [/onSelectOpenMontage/],
    "src/app/components/hermes/agent-runtime-panel.tsx": [/message\.openMontageRun/],
    "src/app/components/hermes/dashboard-agent-terminal.tsx": [/routeOpenMontageCommand/],
    "src/app/gardens/[clusterSlug]/workspace-client.tsx": [/launchOpenMontage/, /msg\.openMontageRun/],
  };
  for (const [file, patterns] of Object.entries(files)) {
    const text = source(file);
    for (const pattern of patterns) {
      assert.match(text, pattern, `${file} is missing ${pattern}`);
    }
  }
});

test("every route the card calls exists", () => {
  for (const route of [
    "src/app/api/openmontage/runs/route.ts",
    "src/app/api/openmontage/runs/[runId]/events/route.ts",
    "src/app/api/openmontage/runs/[runId]/abort/route.ts",
    "src/app/api/openmontage/runs/[runId]/artifacts/route.ts",
    "src/app/api/openmontage/runs/[runId]/artifacts/[artifactId]/route.ts",
    "src/app/api/openmontage/health/route.ts",
    "src/app/api/openmontage/setup/route.ts",
  ]) {
    const text = source(route);
    assert.match(text, /requireUserId\(\)/, `${route} does not authenticate`);
  }
});

test("the card and the run manager agree on the event names", () => {
  const card = source("src/app/components/hermes/inline-openmontage-run.tsx");
  const manager = source("src/lib/openmontage/run-manager.ts");
  // A comment claiming these match is worth nothing; assert both sides.
  for (const event of [
    "run.started",
    "production.updated",
    "artifacts.updated",
    "agent.usage",
    "run.completed",
    "run.failed",
    "run.aborted",
  ]) {
    assert.ok(card.includes(`"${event}"`), `the card does not subscribe to ${event}`);
    assert.ok(manager.includes(`"${event}"`), `the run manager never emits ${event}`);
  }
});

test("a finished production replays instead of reconnecting to a dead stream", () => {
  const card = source("src/app/components/hermes/inline-openmontage-run.tsx");
  // EventSource retries forever by default; a restored turn must not stream.
  assert.match(card, /if \(replaying\) return;/);
  assert.match(card, /source\.close\(\)/);
  assert.match(card, /persistedContent/);
});

test("setup installs are the only writes, and they are user-triggered", () => {
  const route = source("src/app/api/openmontage/setup/route.ts");
  // The action is matched against a closed set, so nothing from the request
  // body ever reaches a command line.
  assert.match(route, /action !== "install-dependencies" && action !== "install-remotion"/);
  assert.match(route, /unknown_action/);
  // A run must never install anything: the run manager has no install path.
  const manager = source("src/lib/openmontage/run-manager.ts");
  assert.ok(!/npm install|pip install|uv venv/.test(manager), "a run must not install");
});
