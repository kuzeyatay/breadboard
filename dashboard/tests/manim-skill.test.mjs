import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { HermesRuntimeAdapter } from "../src/lib/agent-runtime/adapters/hermes.ts";
import { brokerCapabilities } from "../src/lib/hermes/capability-broker.ts";
import { resolveCommandMessage } from "../src/lib/hermes/commands.ts";
import { listFirstPartySkills } from "../src/lib/hermes/skills.ts";
import { planTask } from "../src/lib/hermes/task-plan.ts";
import { allowedToolsForSurface } from "../src/lib/hermes/tool-scopes.ts";
import { availableArtifactRenderers } from "../src/lib/hermes/artifact-renderers.ts";
import {
  ManimServiceError,
  manimDockerArgs,
  validateManimRequest,
} from "../src/lib/manim/service.ts";
import { DEFAULT_MANIM_IMAGE, readManimConfig } from "../src/lib/manim/config.ts";
import { MANIM_SKILL, MANIM_TOOL } from "../src/lib/manim/identity.ts";

const SAFE_SCENE = `from manim import *
import numpy as np

class BreadboardScene(Scene):
    def construct(self):
        circle = Circle(color=BLUE)
        label = Text("A circle")
        self.play(Create(circle), Write(label))
        self.wait(1)
`;

test("Manim is a ready prebuilt skill on both authenticated chat surfaces", () => {
  for (const surface of ["dashboard_terminal", "garden_chat"]) {
    const skill = listFirstPartySkills(surface).find((candidate) => candidate.slug === MANIM_SKILL);
    assert.ok(skill, `expected Manim on ${surface}`);
    assert.equal(skill.category, "Featured");
    assert.equal(skill.availability, "ready");
    assert.deepEqual(skill.capabilityContract?.requiredTools, [MANIM_TOOL]);
    assert.deepEqual(skill.capabilityContract?.requiredArtifactKinds, ["video"]);
    assert.deepEqual(skill.capabilityContract?.requiredRuntimes, ["manim-runtime"]);
    assert.deepEqual(skill.capabilityContract?.requiredBinaries, ["docker"]);
  }
  const quartz = listFirstPartySkills("quartz_ai").find(
    (candidate) => candidate.slug === MANIM_SKILL,
  );
  assert.ok(quartz);
  assert.notEqual(quartz.availability, "ready");
});

test("Manim has a guarded production path and a video renderer", () => {
  assert.ok(allowedToolsForSurface("dashboard_terminal").includes(MANIM_TOOL));
  assert.ok(allowedToolsForSurface("garden_chat").includes(MANIM_TOOL));
  assert.ok(!allowedToolsForSurface("quartz_ai").includes(MANIM_TOOL));
  assert.ok(availableArtifactRenderers().some((renderer) => renderer.kind === "video"));
});

test("the slash command resolves and loads the Manim skill", async () => {
  const resolved = await resolveCommandMessage(
    1,
    "/manim explain completing the square",
    process.cwd(),
    { mode: "knowledge", surface: "dashboard_terminal" },
  );
  assert.deepEqual(resolved.invocations.map((invocation) => invocation.slug), [MANIM_SKILL]);
  assert.match(resolved.text, /Reviewed skill guidance: manim/);
  assert.match(resolved.text, /"code"/);
  assert.match(resolved.text, /"sceneName"/);
});

test("the capability broker and Hermes adapter expose Manim only to private chat", async () => {
  const plan = planTask({
    request: "Explain completing the square with an animation",
    authenticated: true,
  });
  for (const surface of ["dashboard_terminal", "garden_chat"]) {
    const grant = brokerCapabilities({
      plan,
      surface,
      userId: 1,
      grants: [],
      workspaceRoot: "C:/runtime/session",
    });
    assert.equal(grant.allowedTools[MANIM_TOOL], true, surface);
  }
  const publicGrant = brokerCapabilities({
    plan,
    surface: "quartz_ai",
    userId: null,
    grants: [],
    workspaceRoot: "C:/runtime/public",
    isolated: true,
  });
  assert.equal(publicGrant.allowedTools[MANIM_TOOL], false);

  const adapter = new HermesRuntimeAdapter({
    baseUrl: "http://127.0.0.1:9119",
    chatmockBaseUrl: "http://127.0.0.1:8765/v1",
    sessionToken: "test",
    requestTimeoutMs: 5_000,
  });
  const capabilities = await adapter.listCapabilities();
  assert.ok(capabilities.tools.includes(MANIM_TOOL));
});

test("Manim source validation accepts a scene and rejects native escape hatches", () => {
  const parsed = validateManimRequest({
    title: "Circle construction",
    description: "A circle is drawn and labelled.",
    code: SAFE_SCENE,
  });
  assert.equal(parsed.sceneName, "BreadboardScene");
  assert.equal(parsed.quality, "standard");
  assert.match(parsed.code, /class BreadboardScene\(Scene\)/);

  for (const code of [
    `${SAFE_SCENE}\nimport os`,
    `${SAFE_SCENE}\nopen("secret.txt")`,
    `${SAFE_SCENE}\nthing.__class__`,
    `${SAFE_SCENE}\nimport requests`,
  ]) {
    assert.throws(
      () => validateManimRequest({ title: "Unsafe", description: "Unsafe scene.", code }),
      (error) => error instanceof ManimServiceError && error.code === "manim_invalid_source",
    );
  }
});

test("the Docker invocation is pinned, offline, read-only, and resource bounded", () => {
  const workDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-manim-test-"));
  try {
    const request = validateManimRequest({
      title: "Circle",
      description: "A circle appears.",
      code: SAFE_SCENE,
      quality: "draft",
    });
    const config = readManimConfig();
    const args = manimDockerArgs({
      config,
      workDirectory,
      containerName: "breadboard-manim-test",
      request,
    });
    assert.equal(config.image, process.env.MANIM_DOCKER_IMAGE?.trim() || DEFAULT_MANIM_IMAGE);
    assert.ok(args.includes("none"));
    assert.ok(args.includes("--read-only"));
    assert.ok(args.includes("ALL"));
    assert.ok(args.includes("no-new-privileges"));
    assert.ok(args.includes("--pids-limit"));
    assert.ok(args.includes("--memory"));
    assert.ok(args.includes("--cpus"));
    assert.ok(args.includes("cairo"));
    assert.deepEqual(args.slice(-5), ["l", "-o", "breadboard-manim", "scene.py", "BreadboardScene"]);
  } finally {
    fs.rmSync(workDirectory, { recursive: true, force: true });
  }
});
