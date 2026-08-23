import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  openGymUserMessage,
  taskFromOpenGymCommand,
} from "../src/lib/open-gym/identity.ts";
import {
  loadOpenGymCatalog,
  searchOpenGymCatalog,
} from "../src/lib/open-gym/catalog.ts";
import {
  attachOpenGymAnimations,
  parseOpenGymResult,
} from "../src/lib/open-gym/result.ts";
import {
  mergeOpenGymProfile,
  readOpenGymState,
  saveOpenGymProgram,
} from "../src/lib/open-gym/state.ts";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");

test("openGym has the same command grammar as other runtime agents", () => {
  assert.equal(taskFromOpenGymCommand("/agents:open-gym build a three-day program"), "build a three-day program");
  assert.equal(taskFromOpenGymCommand("/study-guide /agents:open-gym show squat form"), "/study-guide show squat form");
  assert.equal(taskFromOpenGymCommand("please use openGym"), null);
  assert.equal(openGymUserMessage("show squat form"), "/agents:open-gym show squat form");
});

test("the integration reads and searches the cloned openGym catalogue", async () => {
  const catalog = await loadOpenGymCatalog();
  assert.equal(catalog.length, 1324);
  const matches = await searchOpenGymCatalog("how do I perform a barbell bench press", { limit: 5 });
  assert.ok(matches.length > 0);
  assert.match(matches[0].n, /bench press/i);
  assert.ok(matches[0].st.length > 0);
  assert.match(matches[0].gif, /\.gif$/i);
});

test("animation references survive transcript persistence", () => {
  const stored = attachOpenGymAnimations("## Bench press\n\nDo it with control.", [{
    id: "0025",
    n: "Barbell Bench Press",
    bp: "chest",
    eq: "barbell",
  }]);
  assert.match(stored, /OPEN_GYM_ANIMATIONS/);
  const restored = parseOpenGymResult(stored);
  assert.equal(restored.content, "## Bench press\n\nDo it with control.");
  assert.deepEqual(restored.animations, [{
    id: "0025",
    name: "Barbell Bench Press",
    bodyPart: "chest",
    equipment: "barbell",
  }]);
});

test("a registered exercise how-to completes without a model and carries its animation", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-open-gym-run-"));
  const previous = process.env.OPEN_GYM_AGENT_DATA_DIR;
  process.env.OPEN_GYM_AGENT_DATA_DIR = root;
  try {
    const manager = await import("../src/lib/open-gym/run-manager.ts");
    const run = manager.startRun({
      userId: 77,
      task: "show me how to do a barbell bench press",
      model: "not-needed-for-catalogue-technique",
      reasoningEffort: "medium",
      baseUrl: "http://127.0.0.1:1/v1",
    });
    let completed;
    for (let attempt = 0; attempt < 100 && !completed; attempt += 1) {
      completed = manager.getEventsSince(77, run.runId, 0)
        .find((event) => event.type === "run.completed");
      if (!completed) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(completed, "the deterministic technique run did not finish");
    const result = parseOpenGymResult(String(completed.payload.summary));
    assert.equal(result.animations[0].id, "0025");
    assert.match(result.content, /barbell bench press/i);
    assert.match(result.content, /How to do it/);
  } finally {
    if (previous === undefined) delete process.env.OPEN_GYM_AGENT_DATA_DIR;
    else process.env.OPEN_GYM_AGENT_DATA_DIR = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("profile and programs persist per user across reads", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-open-gym-"));
  const previous = process.env.OPEN_GYM_AGENT_DATA_DIR;
  process.env.OPEN_GYM_AGENT_DATA_DIR = root;
  try {
    await Promise.all([
      mergeOpenGymProfile(41, { goals: ["strength"], daysPerWeek: 3 }),
      mergeOpenGymProfile(42, { goals: ["mobility"], daysPerWeek: 5 }),
    ]);
    const program = await saveOpenGymProgram({
      userId: 41,
      title: "Three-day strength",
      markdown: "# Three-day strength\n",
      exerciseIds: ["0025"],
    });
    const user = await readOpenGymState(41);
    const other = await readOpenGymState(42);
    assert.deepEqual(user.profile.goals, ["strength"]);
    assert.equal(user.profile.daysPerWeek, 3);
    assert.equal(user.programs[0].id, program.id);
    assert.deepEqual(other.profile.goals, ["mobility"]);
    assert.equal(other.programs.length, 0);
  } finally {
    if (previous === undefined) delete process.env.OPEN_GYM_AGENT_DATA_DIR;
    else process.env.OPEN_GYM_AGENT_DATA_DIR = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("both chat surfaces launch openGym and render its persistent animation card", () => {
  const terminal = source("src/app/components/hermes/dashboard-agent-terminal.tsx");
  const garden = source("src/app/gardens/[clusterSlug]/workspace-client.tsx");
  const card = source("src/app/components/hermes/inline-open-gym-run.tsx");
  for (const body of [terminal, garden]) {
    assert.match(body, /\/api\/open-gym\/runs/);
    assert.match(body, /kind: "open_gym"|openGymRun:/);
    assert.match(body, /taskFromOpenGymCommand/);
  }
  assert.match(card, /parseOpenGymResult\(persistedContent\)/);
  assert.match(card, /exercises\/\$\{encodeURIComponent\(exercise\.id\)\}\/animation/);
  assert.match(card, /new EventSource\(/);
  assert.match(card, /onerror/);
});

test("program artifacts are conversation-scoped and rendered", () => {
  const artifact = source("src/lib/open-gym/artifact.ts");
  assert.match(artifact, /getConversationForUser\(input\.conversationPublicId, input\.userId\)/);
  assert.match(artifact, /conversationId: context\.conversationId/);
  assert.match(artifact, /rendererId: "markdown"/);
  assert.match(artifact, /await renderArtifact\(/);
});
