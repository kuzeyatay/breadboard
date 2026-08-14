import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dashboardRoot = path.resolve(import.meta.dirname, "..");
const source = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");
const identity = await import("../src/lib/resource2skill/identity.ts");

test("the command parser preserves the brief and accepts an explicit domain", () => {
  assert.equal(
    identity.briefFromResource2SkillCommand("/agents:resource2skill --domain excel Build a budget"),
    "--domain excel Build a budget",
  );
  assert.deepEqual(identity.parseResource2SkillBrief("--domain excel Build a budget"), {
    domain: "excel",
    task: "Build a budget",
  });
  assert.equal(identity.briefFromResource2SkillCommand("/agents:resource2skill"), "");
  assert.equal(identity.briefFromResource2SkillCommand("make a workbook"), null);
});

test("domain inference is deterministic and defaults to web", () => {
  assert.equal(identity.parseResource2SkillBrief("Build an 8-slide launch deck").domain, "ppt");
  assert.equal(identity.parseResource2SkillBrief("Create an xlsx financial model").domain, "excel");
  assert.equal(identity.parseResource2SkillBrief("Render a Blender product scene").domain, "blender");
  assert.equal(identity.parseResource2SkillBrief("Compose a 24 bar track at 90 BPM").domain, "reaper");
  assert.equal(identity.parseResource2SkillBrief("Make a nonprofit landing page").domain, "web");
});

test("artifacts cannot escape the run output directory", async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-r2s-"));
  const previous = process.env.RESOURCE2SKILL_WORKSPACE_ROOT;
  process.env.RESOURCE2SKILL_WORKSPACE_ROOT = temporary;
  try {
    const workspace = await import(`../src/lib/resource2skill/workspace.ts?test=${Date.now()}`);
    const runId = `r2srun_${"a1b2c3d4".repeat(4)}`;
    const output = workspace.createWorkspace({
      runId,
      userId: 7,
      brief: "deck",
      domain: "ppt",
      createdAt: new Date(0).toISOString(),
    });
    fs.writeFileSync(path.join(output, "deck.pptx"), "pptx");
    fs.writeFileSync(path.join(workspace.runDirectory(runId), "secret.txt"), "secret");
    const [artifact] = workspace.scanArtifacts(runId);
    assert.equal(artifact.relativePath, "deck.pptx");
    assert.equal(workspace.resolveArtifact(runId, artifact.id).record.kind, "presentation");
    const escaped = Buffer.from("../secret.txt", "utf8").toString("base64url");
    assert.throws(() => workspace.resolveArtifact(runId, escaped), (error) => error.code === "artifact_not_found");
    assert.equal(workspace.requireWorkspaceOwner(7, runId).domain, "ppt");
    assert.throws(() => workspace.requireWorkspaceOwner(8, runId), (error) => error.code === "run_not_found");
  } finally {
    if (previous === undefined) delete process.env.RESOURCE2SKILL_WORKSPACE_ROOT;
    else process.env.RESOURCE2SKILL_WORKSPACE_ROOT = previous;
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("the bridge keeps secrets in the environment and isolates domain outputs", () => {
  const bridge = source("../scripts/resource2skill-bridge.py");
  const manager = source("src/lib/resource2skill/run-manager.ts");
  assert.match(bridge, /CHATMOCK_BASE_URL/);
  assert.match(bridge, /--demo-dir/);
  assert.match(bridge, /save_presentation to this exact path/);
  assert.doesNotMatch(manager, /--api-key/);
  assert.match(manager, /CHATMOCK_API_KEY: input\.apiKey/);
});

test("Resource2Skill is registered and rendered on both chat surfaces", async () => {
  const { runtimeAgentByToken } = await import("../src/lib/hermes/capability-combinations.ts");
  assert.equal(runtimeAgentByToken("agents:resource2skill")?.name, "Resource2Skill");
  assert.match(source("src/app/components/hermes/command-hub.tsx"), /resource2skill-entry/);
  assert.match(source("src/app/components/hermes/agent-runtime-panel.tsx"), /InlineResource2SkillRun/);
  assert.match(source("src/app/gardens/[clusterSlug]/workspace-client.tsx"), /InlineResource2SkillRun/);
});

test("generated HTML is downloaded rather than executed on the dashboard origin", () => {
  const route = source("src/app/api/resource2skill/runs/[runId]/artifacts/[artifactId]/route.ts");
  assert.match(route, /application\/octet-stream/);
  assert.match(route, /x-content-type-options/);
  assert.match(route, /content-disposition/);
});
