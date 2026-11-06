import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {activateGoalMode, accountGoalModeTurn, goalCanContinue, setGoalModeStatus, callGoalModeTool} from "../src/lib/goal-mode.ts";

function fixture(t, options = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "goal-runtime-recovery-"));
  t.after(() => fs.rmSync(home, {recursive: true, force: true}));
  const env = {...process.env, BREADBOARD_GOAL_HOME: home};
  const conversationPublicId = "recovery-test";
  const goal = activateGoalMode({conversationPublicId, objective: "Finish and verify the report", env, ...options});
  return {env, conversationPublicId, goalId: goal.goal_id, startedAt: new Date().toISOString()};
}

test("two transport failures automatically resume; a third stops the loop", t => {
  const input = fixture(t);
  for (let n = 1; n <= 3; n++) {
    const state = accountGoalModeTurn({...input, runId: `run-${n}`, automatic: true, toolCalls: 0, outcome: "error", failureCode: "runtime_stream_silent"});
    assert.equal(state.status, n < 3 ? "active" : "blocked");
    assert.equal(goalCanContinue(state), n < 3);
    const duplicate = accountGoalModeTurn({...input, runId: `run-${n}`, outcome: "error", failureCode: "runtime_stream_silent"});
    assert.equal(duplicate.runtime_failures, n, "duplicate accounting cannot consume another retry");
  }
  setGoalModeStatus({...input, status: "active"});
  assert.equal(accountGoalModeTurn({...input, runId: "resumed", outcome: "error", failureCode: "stream_error"}).status, "active");
});

test("a successful turn resets transport retries and completion stays complete", t => {
  const input = fixture(t);
  accountGoalModeTurn({...input, runId: "failure", outcome: "error", failureCode: "stream_error"});
  assert.equal(accountGoalModeTurn({...input, runId: "success", outcome: "completed", toolCalls: 1}).runtime_failures, 0);
  callGoalModeTool({...input, tool: "update_goal", args: {status: "complete"}});
  assert.equal(accountGoalModeTurn({...input, runId: "late-failure", outcome: "error", failureCode: "runtime_stream_silent"}).status, "complete");
});

test("user stop, permission denial, resource and usage limits never auto-resume", t => {
  for (const [outcome, failureCode, expected] of [["cancelled", "runtime_stream_silent", "paused"], ["error", "permission_denied", "blocked"], ["error", "BREADBOARD_RESOURCE_EXHAUSTED", "blocked"], ["usage_limited", "rate_limit", "usage_limited"]]) {
    const input = fixture(t);
    const state = accountGoalModeTurn({...input, runId: outcome + failureCode, outcome, failureCode});
    assert.equal(state.status, expected);
    assert.equal(goalCanContinue(state), false);
  }
});

test("the token budget takes priority over transport recovery", t => {
  const input = fixture(t, {tokenBudget: 100});
  const state = accountGoalModeTurn({...input, runId: "limited", tokensUsed: 100, outcome: "error", failureCode: "stream_error"});
  assert.equal(state.status, "budget_limited");
  assert.equal(goalCanContinue(state), false);
});

test("missing artifacts and runtime failures continue; a different cause starts a fresh blocker audit", t => {
  const input=fixture(t);
  for(const [runId,failureCode,failureMessage] of [
    ['missing','required_artifact_missing','The requested PDF is missing'],
    ['runtime','hermes_turn_failed','Provider connection reset'],
    ['layout','required_artifact_missing','The PDF layout needs repair'],
  ]) {
    const state=accountGoalModeTurn({...input,runId,automatic:true,toolCalls:0,outcome:'error',failureCode,failureMessage});
    assert.equal(state.status,'active');
    assert.equal(goalCanContinue(state),true);
    assert.equal(state.runtime_failures,1);
  }
  assert.equal(accountGoalModeTurn({...input,runId:'auth',outcome:'error',failureCode:'hermes_turn_failed',failureMessage:'HTTP 401 Unauthorized'}).status,'blocked');
});
