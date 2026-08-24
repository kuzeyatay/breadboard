// Goal as a skill rather than a mode.
//
// Goal used to be a switch in the composer's mode menu that created the
// objective server-side from whatever the person happened to type. It is now a
// first-party skill: the wording selects it, the model writes the objective
// with create_goal, and the goal card above the composer owns the lifecycle
// afterwards.
//
// Four things are locked here — the skill ships and is usable on both chat
// surfaces, the intent module fires on commitments without stealing ordinary
// turns, the switch and its browser preference are really gone, and the turn
// service gates the goal tools on the skill or an existing goal rather than on
// a request field.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { listApprovedSkills, listFirstPartySkills } from "../src/lib/hermes/skills.ts";
import {
  goalCommandText,
  shouldAutoSelectGoal,
  GOAL_MODE_SKILL,
} from "../src/lib/hermes/goal-intent.ts";
import {
  callGoalModeTool,
  clearGoalModeState,
  extendGoalModeBudget,
  goalModeSection,
  presentGoalModeState,
  readGoalModeState,
  setGoalModeStatus,
} from "../src/lib/goal-mode.ts";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "goal-skill-test-"));
const env = { ...process.env, BREADBOARD_GOAL_HOME: home };
process.on("exit", () => fs.rmSync(home, { recursive: true, force: true }));

function selects(text, hasActiveGoal = false) {
  return shouldAutoSelectGoal({
    text,
    surface: "dashboard_terminal",
    authenticated: true,
    hasActiveGoal,
  });
}

function seed(conversationPublicId, args) {
  callGoalModeTool({
    conversationPublicId,
    tool: "create_goal",
    args,
    env,
    now: new Date("2026-08-15T12:00:00.000Z"),
  });
  return readGoalModeState(conversationPublicId, env);
}

test("Goal ships as a first-party skill usable on both chat surfaces", () => {
  const shipped = listFirstPartySkills("dashboard_terminal", []).find(
    (skill) => skill.slug === GOAL_MODE_SKILL,
  );
  assert.ok(shipped, "the goal skill is not in the first-party store");
  // Its guidance is full of tool-call syntax; a classification of
  // implementation work would confine "keep going until the tests pass" to
  // scoped implementation mode, which is the one turn it exists for.
  assert.equal(shipped.classification, "eligible_general");
  assert.equal(shipped.availability, "ready", shipped.unavailableReasons.join("; "));
  for (const surface of ["dashboard_terminal", "garden_chat"]) {
    assert.ok(
      listApprovedSkills(surface, []).some((skill) => skill.slug === GOAL_MODE_SKILL),
      `the goal skill is unavailable on ${surface}`,
    );
  }
  const markdown = shipped.instructions;
  // The three halves of the contract the model has to hold: create it first,
  // read it later, and never claim completion without evidence.
  for (const marker of ["create_goal", "get_goal", "update_goal", "Completion audit"]) {
    assert.ok(
      markdown.includes(marker) || markdown.includes(marker.toLowerCase()),
      `the shipped guidance lost ${marker}`,
    );
  }
});

test("a commitment to keep working selects the skill; ordinary turns do not", () => {
  for (const text of [
    "keep going until the dashboard tests pass",
    "don't stop until the deploy is green",
    "iterate until the build is clean",
    "your goal is to migrate every route off the old client",
    "Goal: get the importer under two minutes",
    "fix this, however long it takes",
  ]) {
    assert.ok(selects(text), `missed: ${text}`);
  }
  for (const text of [
    "what is goal mode?",
    "how do goals work here?",
    "summarize the team's goals for Q3",
    "rewrite the objectives section of this doc",
    "run the tests",
    "how do i do biceps curls",
    "keep the second paragraph and drop the rest",
  ]) {
    assert.equal(selects(text), false, `stolen: ${text}`);
  }
  // A conversation already under a goal has nothing for the skill to do — the
  // objective is carried by its own system section, and selecting again would
  // only earn a create_goal refusal.
  assert.equal(selects("keep going until it passes", true), false);
  // An explicit command already says what the turn is.
  assert.equal(selects("/watch keep going until you have the whole clip"), false);
  assert.equal(
    shouldAutoSelectGoal({
      text: "The user's goal is to learn biceps curls",
      surface: "dashboard_terminal",
      authenticated: true,
      internalContinuation: true,
    }),
    false,
  );
  assert.equal(
    goalCommandText({
      text: "keep going until the tests pass",
      surface: "dashboard_terminal",
      authenticated: true,
    }).text,
    `/${GOAL_MODE_SKILL} keep going until the tests pass`,
  );
  // Quartz has no conversation to hold a goal against.
  assert.equal(
    shouldAutoSelectGoal({
      text: "keep going until it passes",
      surface: "quartz_ai",
      authenticated: true,
    }),
    false,
  );
});

test("the turn the skill is selected for is told to create the goal itself", () => {
  const opening = goalModeSection(null, env, { skillSelected: true });
  assert.match(opening, /^# goal_mode/m);
  assert.match(opening, /create_goal/);
  // No skill, no goal, no section: an ordinary turn must not carry one.
  assert.equal(goalModeSection(null, env, {}), "");
  // Once the goal exists the model is told to stop reaching for create_goal,
  // and told that the lifecycle is not its to drive.
  const state = seed("skill-created", { objective: "Get every route migrated" });
  const running = goalModeSection(state, env, { skillSelected: true });
  assert.match(running, /do not call create_goal/i);
  assert.match(running, /pause, resume or abandon it from the goal card/i);
});

test("pause, resume, budget and abandon belong to the person", () => {
  const conversationPublicId = "lifecycle";
  const state = seed(conversationPublicId, {
    objective: "Hold this objective",
    turn_budget: 2,
  });
  assert.equal(state.status, "active");

  const paused = setGoalModeStatus({ conversationPublicId, status: "paused", env });
  assert.equal(paused?.status, "paused");
  assert.match(
    goalModeSection(paused, env),
    /Do not continue goal work until the user explicitly resumes it/,
  );

  const resumed = setGoalModeStatus({ conversationPublicId, status: "active", env });
  assert.equal(resumed?.status, "active");
  assert.equal(resumed?.objective, state.objective, "resuming must not rewrite the objective");

  // Raising the ceiling on a goal that ran into it is what puts it back in
  // motion; leaving the status alone would park it in budget_limited forever.
  const limited = setGoalModeStatus({ conversationPublicId, status: "active", env });
  assert.ok(limited);
  const extended = extendGoalModeBudget({ conversationPublicId, turnBudget: 20, env });
  assert.equal(extended?.turn_budget, 20);
  assert.equal(extended?.status, "active");
  assert.equal(presentGoalModeState(extended).remainingTurns, 20 - extended.turns_used);

  clearGoalModeState(conversationPublicId, env);
  assert.equal(readGoalModeState(conversationPublicId, env), null);
});

test("a completed goal is history: it cannot be resumed or re-budgeted", () => {
  const conversationPublicId = "finished";
  seed(conversationPublicId, { objective: "Finish and stay finished" });
  callGoalModeTool({
    conversationPublicId,
    tool: "update_goal",
    args: { status: "complete" },
    env,
  });
  assert.equal(
    setGoalModeStatus({ conversationPublicId, status: "active", env })?.status,
    "complete",
  );
  assert.equal(
    extendGoalModeBudget({ conversationPublicId, turnBudget: 50, env })?.turn_budget,
    null,
  );
});

test("the Goal switch and its browser preference are gone", () => {
  assert.equal(
    fs.existsSync(new URL("../src/app/components/use-goal-mode.ts", import.meta.url)),
    false,
    "the Goal mode browser preference still exists",
  );
  const composer = fs.readFileSync(
    new URL("../src/app/components/assistant-composer.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(composer, /Goal mode/);
  assert.doesNotMatch(composer, /useGoalMode/);
  // The card replaces it, and it is the composer that renders it, so all four
  // chat surfaces get it from one place.
  assert.match(composer, /<GoalCard/);
  const dispatch = fs.readFileSync(
    new URL("../src/app/components/hermes/use-agent-session.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(dispatch, /isGoalModeEnabled/);
});

test("the goal tools are gated on the skill or an existing goal, not on a request field", () => {
  const service = fs.readFileSync(
    new URL("../src/lib/conversations/turn-service.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(service, /input\.goalMode/);
  assert.match(service, /const goalMode = goalModeState !== null \|\| goalSkillSelected;/);
  assert.match(service, /invocation\.slug === GOAL_MODE_SKILL/);
  // The dispatched run carries a null id on the creating turn, and the stream's
  // finalize resolves it — otherwise the first turn of every goal goes
  // unaccounted.
  assert.match(service, /goalId: goalModeState\?\.goal_id \?\? null/);
  const stream = fs.readFileSync(
    new URL("../src/lib/hermes/event-stream.ts", import.meta.url),
    "utf8",
  );
  assert.match(stream, /goalMode\.goalId \?\?/);
  const messages = fs.readFileSync(
    new URL("../src/app/api/hermes/sessions/[sessionId]/messages/route.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(messages, /goalMode/);
});

test("Super Agent cannot start Goal Mode from its ambient inventory", () => {
  const superAgent = fs.readFileSync(
    new URL("../src/lib/hermes/super-agent.ts", import.meta.url),
    "utf8",
  );
  assert.match(superAgent, /skill\.slug !== GOAL_MODE_SKILL/);
  assert.match(superAgent, /slug !== GOAL_MODE_CONNECTION/);
});
