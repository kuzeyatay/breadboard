import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  accountGoalModeTurn,
  activateGoalMode,
  callGoalModeTool,
  GOAL_MODE_CONNECTION,
  goalModePaths,
  goalModeSection,
  readGoalModeState,
} from "../src/lib/goal-mode.ts";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "goal-mode-test-"));
const env = { ...process.env, BREADBOARD_GOAL_HOME: home };
process.on("exit", () => fs.rmSync(home, { recursive: true, force: true }));

test("Goal Mode state is contained and keeps the upstream goal_state schema", () => {
  const paths = goalModePaths("conversation/with a name", env);
  assert.ok(path.resolve(paths.stateFile).startsWith(path.resolve(home)));
  assert.doesNotMatch(path.basename(path.dirname(paths.stateFile)), /conversation/);

  const state = activateGoalMode({
    conversationPublicId: "conversation/with a name",
    objective: "Ship a conversation-scoped Goal Mode",
    env,
    now: new Date("2026-08-15T12:00:00.000Z"),
  });
  assert.deepEqual(Object.keys(state).sort(), [
    "accounting",
    "continuation_deferred",
    "created_at",
    "goal_id",
    "objective",
    "status",
    "time_used_seconds",
    "token_budget",
    "tokens_used",
    "turn_budget",
    "turns_used",
    "updated_at",
  ]);
  assert.equal(state.status, "active");
  assert.equal(readGoalModeState("conversation/with a name", env)?.objective, state.objective);
});

test("Goal Mode preserves a goal, accounts a completed turn, and honours its budget", () => {
  const conversationPublicId = "budgeted-conversation";
  const state = activateGoalMode({
    conversationPublicId,
    objective: "Verify the budget contract",
    turnBudget: 1,
    env,
    now: new Date("2026-08-15T12:00:00.000Z"),
  });
  const same = activateGoalMode({
    conversationPublicId,
    objective: "This must not replace the first objective",
    env,
  });
  assert.equal(same.goal_id, state.goal_id);
  assert.equal(same.objective, state.objective);

  const accounted = accountGoalModeTurn({
    conversationPublicId,
    goalId: state.goal_id,
    startedAt: "2026-08-15T12:00:00.000Z",
    env,
    now: new Date("2026-08-15T12:00:07.000Z"),
  });
  assert.equal(accounted?.turns_used, 1);
  assert.equal(accounted?.time_used_seconds, 7);
  assert.equal(accounted?.status, "budget_limited");
  assert.match(goalModeSection(accounted), /has reached its turn budget/);
  assert.match(goalModeSection(accounted), /do not start new substantive work/i);
});

test("the native Goal bridge matches upstream MCP lifecycle responses", () => {
  const conversationPublicId = "goal-mcp-lifecycle";
  const created = callGoalModeTool({
    conversationPublicId,
    tool: "create_goal",
    args: { objective: "Complete the Goal Mode integration", turn_budget: 3 },
    env,
    now: new Date("2026-08-15T12:00:00.000Z"),
  });
  assert.equal(created.isError, undefined);
  assert.match(created.text, /"turnBudget": 3/);

  const duplicate = callGoalModeTool({
    conversationPublicId,
    tool: "create_goal",
    args: { objective: "replace it" },
    env,
  });
  assert.equal(duplicate.isError, true);
  assert.match(duplicate.text, /cannot create a new goal/);

  const complete = callGoalModeTool({
    conversationPublicId,
    tool: "update_goal",
    args: { status: "complete" },
    env,
    now: new Date("2026-08-15T12:01:00.000Z"),
  });
  assert.equal(complete.isError, undefined);
  assert.match(complete.text, /"status": "complete"/);
  assert.match(complete.text, /Goal achieved\. Report final budget usage/);
});

test("Goal Mode renders Goal's continuation and completion-audit contract", () => {
  const state = activateGoalMode({
    conversationPublicId: "prompt-contract",
    objective: "Keep the full objective intact",
    env,
  });
  const section = goalModeSection(state);
  assert.match(section, /^# goal_mode/m);
  assert.match(section, /Keep the full objective intact/);
  assert.match(section, /Completion audit:/);
  assert.match(section, new RegExp(`connection="${GOAL_MODE_CONNECTION}"`));
  assert.match(section, /update_goal/);
});

test("editing a goal objective keeps its id and usage, as Codex's goal editor does", async () => {
  const { editGoalModeObjective, goalObjectiveUpdatedPrompt, setGoalModeStatus, extendGoalModeBudget } =
    await import("../src/lib/goal-mode.ts");
  const id = "edit-objective-conversation";
  const original = activateGoalMode({ conversationPublicId: id, objective: "keep polishing", tokenBudget: 40, env,
    now: new Date("2026-11-01T00:00:00.000Z") });
  const accounted = accountGoalModeTurn({ conversationPublicId: id, goalId: original.goal_id, runId: "r1",
    startedAt: "2026-11-01T00:00:00Z", tokensUsed: 50, env, now: new Date("2026-11-01T00:00:12Z") });
  assert.equal(accounted.status, "budget_limited");

  // Over budget: the edit asks for active, the budget keeps it limited.
  const edited = editGoalModeObjective({ conversationPublicId: id, objective: "  keep polishing with clearer wording ", env });
  assert.equal(edited.objectiveChanged, true);
  assert.equal(edited.state.objective, "keep polishing with clearer wording");
  assert.equal(edited.state.status, "budget_limited");
  assert.equal(edited.state.goal_id, original.goal_id);
  assert.equal(edited.state.tokens_used, 50);
  assert.equal(edited.state.time_used_seconds, 12);
  assert.equal(edited.state.created_at, original.created_at);

  // A paused goal stays paused through an edit.
  extendGoalModeBudget({ conversationPublicId: id, tokenBudget: null, env });
  setGoalModeStatus({ conversationPublicId: id, status: "paused", env });
  const paused = editGoalModeObjective({ conversationPublicId: id, objective: "a paused rewording", env });
  assert.equal(paused.state.status, "paused");

  // Same text is not a change, and an empty objective is refused.
  assert.equal(editGoalModeObjective({ conversationPublicId: id, objective: "a paused rewording", env }).objectiveChanged, false);
  assert.throws(() => editGoalModeObjective({ conversationPublicId: id, objective: "   ", env }));

  const prompt = goalObjectiveUpdatedPrompt({ ...paused.state, objective: "use <b> & co" });
  assert.match(prompt, /supersedes any previous thread goal objective/);
  assert.match(prompt, /use &lt;b&gt; &amp; co/);
  assert.equal(editGoalModeObjective({ conversationPublicId: "no-goal-here", objective: "x", env }), null);
});
