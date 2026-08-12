import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dashboardRoot = path.resolve(import.meta.dirname, "..");
const source = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");

const identity = await import("../src/lib/hyperframes/identity.ts");
const runtime = await import("../src/lib/hyperframes/runtime.ts");
const prompt = await import("../src/lib/hyperframes/prompt.ts");

// The workspace module resolves its root from the environment, so every test
// that touches disk gets its own directory and none of them can see a real run.
function withWorkspaceRoot(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-hyperframes-"));
  const previous = process.env.HYPERFRAMES_WORKSPACE_ROOT;
  process.env.HYPERFRAMES_WORKSPACE_ROOT = dir;
  try {
    return run(dir);
  } finally {
    if (previous === undefined) delete process.env.HYPERFRAMES_WORKSPACE_ROOT;
    else process.env.HYPERFRAMES_WORKSPACE_ROOT = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const RUN_ID = `hfrun_${"a1b2c3d4".repeat(4)}`;

test("the command carries its brief, and a bare token starts nothing", () => {
  assert.equal(
    identity.briefFromHyperframesCommand("/agents:hyperframes a 10s launch video"),
    "a 10s launch video",
  );
  // A bare token is the palette inserting the command: the person is still
  // typing, so the caller must not launch an empty run.
  assert.equal(identity.briefFromHyperframesCommand("/agents:hyperframes"), "");
  assert.equal(identity.briefFromHyperframesCommand("/agents:codex fix the build"), null);
  assert.equal(identity.briefFromHyperframesCommand("make me a video"), null);
  assert.equal(
    identity.hyperframesUserMessage("promo clip"),
    "/agents:hyperframes promo clip",
  );
});

test("the agent's rules forbid the two things that would hang or fork the run", () => {
  const rules = prompt.operatingRules({
    projectDirectory: "/tmp/project",
    outputRelativePath: "out/video.mp4",
  });
  // `npx hyperframes@latest` is what both the model's training and the skills
  // suggest; it would fetch a second, unpinned CLI mid-run.
  assert.match(rules, /Never run `npx hyperframes`/);
  assert.match(rules, /hyperframes preview/);
  assert.match(rules, /out\/video\.mp4/);
  // Nobody is available to answer the skills' intent interview.
  assert.match(rules, /not interactive/i);
  assert.match(rules, /hyperframes lint/);
  assert.match(rules, /hyperframes check/);
});

test("the rules point at the clone's skills instead of restating them", () => {
  const root = runtime.skillsRoot();
  if (!root) {
    assert.match(
      prompt.operatingRules({ projectDirectory: "/tmp/p", outputRelativePath: "out/v.mp4" }),
      /skills are not on this machine/,
    );
    return;
  }
  const skills = prompt.installedSkills();
  assert.ok(skills.includes("hyperframes"), "the router skill must be discoverable");
  const rules = prompt.operatingRules({
    projectDirectory: "/tmp/p",
    outputRelativePath: "out/v.mp4",
  });
  assert.match(rules, /hyperframes\/SKILL\.md/);
  assert.match(rules, /router/);
});

test("the spawn environment pins the toolchain and disables the CLI's own fetching", () => {
  const toolchain = {
    cli: { found: false },
    ffmpeg: { found: true, path: path.join("/tools", "bin", "ffmpeg"), source: "test" },
    ffprobe: { found: true, path: path.join("/tools", "bin", "ffprobe"), source: "test" },
    browser: { found: true, path: path.join("/browser", "chrome"), source: "test" },
  };
  const env = runtime.hyperframesEnv(toolchain, { PATH: "/usr/bin" }, ["/shim"]);
  assert.equal(env.HYPERFRAMES_FFMPEG_PATH, toolchain.ffmpeg.path);
  assert.equal(env.HYPERFRAMES_BROWSER_PATH, toolchain.browser.path);
  // `init` would otherwise reach GitHub and write into the user's global agent
  // skill directories, and the person asked Breadboard for a video, not the
  // framework's vendor for telemetry.
  assert.equal(env.HYPERFRAMES_SKIP_SKILLS, "1");
  assert.equal(env.HYPERFRAMES_NO_UPDATE_CHECK, "1");
  assert.equal(env.HYPERFRAMES_NO_TELEMETRY, "1");
  assert.ok(env.PATH.startsWith(`/shim${path.delimiter}`));
  assert.ok(env.PATH.includes("/usr/bin"));
});

test("the CLI shim makes `hyperframes` a name the agent can actually type", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-hyperframes-shim-"));
  try {
    const written = runtime.writeCliShim(dir, {
      command: "/usr/bin/node",
      baseArgs: ["/cli/bin/hyperframes.mjs"],
      version: "0.0.0",
      source: "managed",
    });
    assert.equal(written, dir);
    const name = process.platform === "win32" ? "hyperframes.cmd" : "hyperframes";
    const script = fs.readFileSync(path.join(dir, name), "utf8");
    assert.match(script, /node/);
    assert.match(script, /hyperframes\.mjs/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("outputs are found by scanning the project, video first", async () => {
  const workspace = await import("../src/lib/hyperframes/workspace.ts");
  withWorkspaceRoot(() => {
    const project = workspace.projectDirectory(RUN_ID);
    fs.mkdirSync(path.join(project, "out"), { recursive: true });
    fs.writeFileSync(path.join(project, "index.html"), "<html></html>");
    fs.writeFileSync(path.join(project, "out", "video.mp4"), "0".repeat(64));
    fs.writeFileSync(path.join(project, "notes.txt"), "ignored");
    // Scaffold instructions are input to the run, not its output.
    fs.writeFileSync(path.join(project, "AGENTS.md"), "# instructions");
    fs.writeFileSync(path.join(project, "CLAUDE.md"), "# instructions");
    fs.mkdirSync(path.join(project, "node_modules", "pkg"), { recursive: true });
    fs.writeFileSync(path.join(project, "node_modules", "pkg", "bundled.mp4"), "0");

    const artifacts = workspace.scanArtifacts(RUN_ID);
    const paths = artifacts.map((artifact) => artifact.relativePath);
    assert.deepEqual(paths, ["out/video.mp4", "index.html"]);
    // A dependency's own media is not this run's output.
    assert.ok(!paths.some((value) => value.includes("node_modules")));
    assert.equal(workspace.primaryVideo(artifacts)?.relativePath, "out/video.mp4");
  });
});

test("an artifact id resolves only inside its own project", async () => {
  const workspace = await import("../src/lib/hyperframes/workspace.ts");
  withWorkspaceRoot((dir) => {
    const project = workspace.projectDirectory(RUN_ID);
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(path.join(project, "index.html"), "<html></html>");
    fs.writeFileSync(path.join(dir, "secret.md"), "not yours");

    const [artifact] = workspace.scanArtifacts(RUN_ID);
    assert.equal(workspace.resolveArtifact(RUN_ID, artifact.id).record.name, "index.html");

    const escaped = Buffer.from("../../secret.md", "utf8").toString("base64url");
    assert.throws(
      () => workspace.resolveArtifact(RUN_ID, escaped),
      (error) => error.code === "artifact_not_found",
    );
    assert.throws(
      () => workspace.resolveArtifact("hfrun_nope", artifact.id),
      (error) => error.code === "invalid_run_id",
    );
  });
});

test("the scaffold's own npm scripts run the pinned CLI, not a fresh npx download", async () => {
  const workspace = await import("../src/lib/hyperframes/workspace.ts");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-hyperframes-pin-"));
  try {
    // Exactly what `hyperframes init` writes. An agent reaches for `npm run
    // check` before a bare command — observed on the first real run — and that
    // would fetch a second copy of the CLI from npm.
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: "project",
        scripts: {
          dev: "npx --yes hyperframes@0.7.94 preview",
          check: "npx --yes hyperframes@0.7.94 check",
          render: "npx --yes hyperframes@0.7.94 render",
          publish: "npx --yes hyperframes@0.7.94 publish",
        },
      }),
    );
    workspace.pinProjectScripts(dir);
    const { scripts } = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    assert.equal(scripts.check, "hyperframes check");
    assert.equal(scripts.render, "hyperframes render");
    assert.equal(scripts.lint, "hyperframes lint");
    // `preview` never exits and `publish` uploads the video to a hosted
    // service; neither belongs on the easy path of a one-shot chat brief.
    assert.equal(scripts.dev, undefined);
    assert.equal(scripts.publish, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a finished run is still owned after the process that made it is gone", async () => {
  const workspace = await import("../src/lib/hyperframes/workspace.ts");
  withWorkspaceRoot(() => {
    fs.mkdirSync(workspace.runDirectory(RUN_ID), { recursive: true });
    fs.writeFileSync(
      path.join(workspace.runDirectory(RUN_ID), "owner.json"),
      JSON.stringify({ runId: RUN_ID, userId: 7, brief: "clip", createdAt: "" }),
    );
    assert.equal(workspace.requireWorkspaceOwner(7, RUN_ID).userId, 7);
    assert.throws(
      () => workspace.requireWorkspaceOwner(8, RUN_ID),
      (error) => error.code === "run_not_found",
    );
  });
});

test("the run is a Codex process pinned to ChatMock, outside a Git repository", () => {
  const manager = source("src/lib/hyperframes/run-manager.ts");
  assert.match(manager, /model_provider="chatmock"/);
  assert.match(manager, /wire_api="responses"/);
  assert.match(manager, /approval_policy="never"/);
  // A scaffolded video project is not a repository, and Codex refuses to run
  // outside one without this.
  assert.match(manager, /--skip-git-repo-check/);
  assert.match(manager, /resolveCodexLauncher/);
});

test("the composition source is never served as HTML on the dashboard's origin", () => {
  const route = source("src/app/api/hyperframes/runs/[runId]/artifacts/[artifactId]/route.ts");
  assert.match(route, /text\/plain; charset=utf-8/);
  assert.match(route, /x-content-type-options/);
  // Video review needs range requests, or the player cannot seek.
  assert.match(route, /content-range/);
  assert.match(route, /206/);
});

test("HyperFrames is a registered runtime agent with a plain-language palette entry", async () => {
  const { runtimeAgentByToken } = await import("../src/lib/hermes/capability-combinations.ts");
  const agent = runtimeAgentByToken("agents:hyperframes");
  assert.equal(agent?.name, "HyperFrames");
  // The brief is handed to the agent verbatim, so it cannot carry a skill.
  assert.equal(agent?.stacksCapabilities, false);
  assert.equal(agent?.acceptsAttachments, false);

  const hub = source("src/app/components/hermes/command-hub.tsx");
  assert.match(hub, /Makes a short video from a description/);
  assert.match(hub, /hyperframes-entry/);
});

test("the run kind survives a reload in both chat surfaces", async () => {
  const { parseExternalAgentRun, externalAgentMessageFields } = await import(
    "../src/lib/conversations/external-agent-runs.ts"
  );
  const run = parseExternalAgentRun({
    kind: "hyperframes",
    runId: RUN_ID,
    brief: "a 10s promo",
  });
  assert.deepEqual(run, { kind: "hyperframes", runId: RUN_ID, brief: "a 10s promo" });
  const fields = externalAgentMessageFields({
    externalAgent: true,
    externalAgentRun: run,
    externalAgentOutcome: "completed",
  });
  assert.deepEqual(fields.hyperframesRun, { runId: RUN_ID, brief: "a 10s promo" });

  const restore = source("src/app/api/chat-sessions/[sessionId]/route.ts");
  assert.match(restore, /EXTERNAL_AGENT_RUN_FIELD_BY_KIND\[kind\]/);
  const garden = source("src/app/gardens/[clusterSlug]/workspace-client.tsx");
  assert.match(garden, /InlineHyperframesRun/);
  const terminal = source("src/app/components/hermes/agent-runtime-panel.tsx");
  assert.match(terminal, /InlineHyperframesRun/);
});
