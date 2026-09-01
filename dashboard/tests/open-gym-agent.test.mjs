import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  isOpenGymSuperAgentRoutingCandidate,
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
import { resolveOpenGymSuperAgentRoute } from "../src/lib/open-gym/routing.ts";

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

  const curls = await searchOpenGymCatalog("how do i do biceps curls", { limit: 5 });
  assert.equal(curls[0].id, "0294");
  assert.equal(curls[0].n, "dumbbell biceps curl");
});

test("Super Agent routing is deterministic across exercise phrasing", async () => {
  const exerciseRequests = [
    "how do I do biceps curls?",
    "show me proper form for a barbell bench press",
    "can you demonstrate a dumbbell lateral raise",
    "teach me the correct way to squat",
    "what is the right way to do a Romanian deadlift?",
    "walk me through a cable row",
    "give me setup cues for a goblet squat",
  ];
  for (const request of exerciseRequests) {
    assert.equal(isOpenGymSuperAgentRoutingCandidate(request), true);
    const decision = await resolveOpenGymSuperAgentRoute(request);
    assert.equal(decision.route, true, request);
    assert.equal(decision.reason, "registered_exercise", request);
    assert.ok(decision.exercise?.id, request);
  }

  const program = await resolveOpenGymSuperAgentRoute(
    "build a three-day strength workout plan",
  );
  assert.deepEqual(program, { route: true, reason: "fitness_program" });

  for (const request of [
    "show me how to bake sourdough bread",
    "how do I execute this SQL query?",
    "make me a Python program",
    "what muscles do biceps curls work?",
  ]) {
    assert.equal((await resolveOpenGymSuperAgentRoute(request)).route, false, request);
  }
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

  // Markdown and model handoffs are allowed to normalize comments. The
  // metadata stays private and parseable even when whitespace is inserted.
  const normalized = stored.replace("<!--OPEN_GYM", "<!--\n  OPEN_GYM");
  const normalizedResult = parseOpenGymResult(normalized);
  assert.equal(normalizedResult.content, "## Bench press\n\nDo it with control.");
  assert.equal(normalizedResult.animations[0].id, "0025");
  assert.doesNotMatch(normalizedResult.content, /OPEN_GYM_ANIMATIONS/);

  const bareResult = parseOpenGymResult(
    stored.replace("<!--", "").replace("-->", ""),
  );
  assert.equal(bareResult.content, "## Bench press\n\nDo it with control.");
  assert.equal(bareResult.animations[0].id, "0025");

  const leaked = parseOpenGymResult(
    "OPEN_GYM_ANIMATIONS:%5Bbroken%5D\n\nThe answer remains visible.",
  );
  assert.equal(leaked.content, "The answer remains visible.");
});

test("a registered exercise how-to completes without a model and carries its animation", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-open-gym-run-"));
  const previous = process.env.OPEN_GYM_AGENT_DATA_DIR;
  process.env.OPEN_GYM_AGENT_DATA_DIR = root;
  try {
    const manager = await import("../src/lib/open-gym/run-manager.ts");
    const run = manager.startRuntimeWorkerRun({
      userId: 77,
      runtimeJobId: "job_open_gym_catalogue_test",
      task: "how do i do biceps curls",
      model: "not-needed-for-catalogue-technique",
      reasoningEffort: "medium",
      baseUrl: "http://127.0.0.1:1/v1",
      apiKey: "local",
    });
    let completed;
    for (let attempt = 0; attempt < 100 && !completed; attempt += 1) {
      completed = manager.getRuntimeWorkerEventsSince(77, run.runId, 0)
        .find((event) => event.type === "run.completed");
      if (!completed) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(completed, "the deterministic technique run did not finish");
    const result = parseOpenGymResult(String(completed.payload.summary));
    assert.equal(result.animations[0].id, "0294");
    assert.match(result.content, /dumbbell biceps curl/i);
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

test("both chat surfaces persist the quiet Super Agent openGym presentation", () => {
  const terminal = source("src/app/components/hermes/dashboard-agent-terminal.tsx");
  const terminalPanel = source("src/app/components/hermes/agent-runtime-panel.tsx");
  const garden = source("src/app/gardens/[clusterSlug]/workspace-client.tsx");
  const card = source("src/app/components/hermes/inline-open-gym-run.tsx");
  for (const body of [terminal, garden]) {
    assert.match(body, /\/api\/open-gym\/runs/);
    assert.match(body, /kind: "open_gym"|openGymRun:/);
    assert.match(body, /taskFromOpenGymCommand/);
    assert.match(body, /shouldRouteOpenGymFromSuperAgent/);
    assert.match(body, /isSuperAgentEnabled\(\)/);
    assert.match(body, /userContent: text/);
    assert.match(body, /userContent: text, quiet: true/);
  }
  const routingClient = source("src/lib/open-gym/routing-client.ts");
  const routingRoute = source("src/app/api/open-gym/route/route.ts");
  assert.match(routingClient, /\/api\/open-gym\/route/);
  assert.match(routingClient, /return true;[\s\S]{0,80}finally/);
  assert.match(routingRoute, /resolveOpenGymSuperAgentRoute/);
  assert.match(card, /parseOpenGymResult\(persistedContent\)/);
  assert.match(card, /exercises\/\$\{encodeURIComponent\(exercise\.id\)\}\/animation/);
  assert.match(card, /new EventSource\(/);
  assert.match(card, /onerror/);
  assert.match(card, /if \(quiet\)/);
  assert.match(card, /hasExerciseDemonstration/);
  assert.match(card, /rounded-\[12px\] border border-\[var\(--line\)\]/);
  assert.match(card, /<ChatMarkdown content=\{result\} compact \/>/);
  assert.ok(
    card.indexOf("if (quiet)") < card.indexOf('className="bb-agent-run-card'),
    "Super Agent's direct answer must render before the explicit-agent run card",
  );
  assert.match(
    terminalPanel,
    /message\.delegatedAgentRun === true &&[\s\S]{0,80}!message\.openGymRun/,
  );
  assert.match(
    garden,
    /msg\.delegatedAgentRun &&[\s\S]{0,80}!msg\.openGymRun/,
  );
  assert.match(
    terminalPanel,
    /message\.openGymRun[\s\S]{0,300}persistedContent=\{externalAgentCardContent\(message\)\}/,
  );
  assert.match(
    garden,
    /msg\.openGymRun[\s\S]{0,300}persistedContent=\{externalAgentCardContent\(msg\)\}/,
  );
});

test("Super Agent must delegate exercise demonstrations instead of substituting prose", () => {
  const superAgent = source("src/lib/hermes/super-agent.ts");
  const briefs = source("src/lib/hermes/runtime-agent-briefs.ts");
  assert.match(superAgent, /Exercise demonstrations and workout programs go to openGym/);
  assert.match(superAgent, /form guidance and framed animation are the requested result/);
  assert.match(superAgent, /without an openGym run card/);
  assert.match(briefs, /framed animation render directly without exposing the agent's run card/);
});

test("the direct openGym answer does not spawn a second Super Agent thinking turn", () => {
  const terminal = source("src/app/components/hermes/dashboard-agent-terminal.tsx");
  const terminalPanel = source("src/app/components/hermes/agent-runtime-panel.tsx");
  const garden = source("src/app/gardens/[clusterSlug]/workspace-client.tsx");
  for (const body of [terminal, garden]) {
    assert.match(
      body,
      /request\.agentId === OPEN_GYM_AGENT_ID[\s\S]{0,260}awaitedLaunchesRef\.current\.delete/,
    );
    assert.match(
      body,
      /if \(message\.openGymRun\)[\s\S]{0,180}awaitedLaunchesRef\.current\.delete/,
    );
    assert.match(
      body,
      /openGymRun[\s\S]{0,260}(?:continue|return);/,
    );
  }
  assert.match(
    terminalPanel,
    /message\.delegatedAgentPreamble &&[\s\S]{0,80}!message\.openGymRun/,
  );
  assert.match(
    garden,
    /msg\.delegatedAgentPreamble &&[\s\S]{0,80}!msg\.openGymRun/,
  );
});

test("program artifacts are conversation-scoped and rendered", () => {
  const artifact = source("src/lib/open-gym/artifact.ts");
  assert.match(artifact, /getConversationForUser\(input\.conversationPublicId, input\.userId\)/);
  assert.match(artifact, /conversationId: context\.conversationId/);
  assert.match(artifact, /rendererId: "markdown"/);
  assert.match(artifact, /await renderArtifact\(/);
});
