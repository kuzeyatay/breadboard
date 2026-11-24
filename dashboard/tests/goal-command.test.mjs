import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  applyGoalCommand,
  parseGoalCommand,
  readGoalModeState,
} from "../src/lib/goal-mode.ts";

function sandbox() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "goal-command-"));
  return { env: { ...process.env, BREADBOARD_GOAL_HOME: home }, home };
}

test("an explicit /goal <objective> parses as a set command", () => {
  assert.deepEqual(
    parseGoalCommand("/goal read the briefing in C:\\Users\\me\\Downloads\\Pkg and using mendix acomplish the given task"),
    { kind: "set", objective: "read the briefing in C:\\Users\\me\\Downloads\\Pkg and using mendix acomplish the given task" },
  );
  assert.deepEqual(parseGoalCommand("/goal pause"), { kind: "pause" });
  assert.deepEqual(parseGoalCommand("/GOAL resume"), { kind: "resume" });
  assert.deepEqual(parseGoalCommand("/goal clear"), { kind: "clear" });
  assert.equal(parseGoalCommand("/goal"), null);
  assert.equal(parseGoalCommand("set a goal for me"), null);
  assert.equal(parseGoalCommand("/goals list"), null);
});

test("/goal creates the goal on the server, without relying on the model", () => {
  const { env, home } = sandbox();
  try {
    const state = applyGoalCommand("conv_a", parseGoalCommand("/goal ship the retake"), env);
    assert.equal(state.status, "active");
    assert.equal(readGoalModeState("conv_a", env).objective, "ship the retake");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("a new /goal replaces an unfinished (even paused) goal", () => {
  const { env, home } = sandbox();
  try {
    const first = applyGoalCommand("conv_b", { kind: "set", objective: "old" }, env);
    applyGoalCommand("conv_b", { kind: "pause" }, env);
    assert.equal(readGoalModeState("conv_b", env).status, "paused");
    const second = applyGoalCommand("conv_b", { kind: "set", objective: "new" }, env);
    assert.notEqual(second.goal_id, first.goal_id);
    assert.equal(second.status, "active");
    assert.equal(second.objective, "new");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("/goal pause, resume and clear are the person's controls", () => {
  const { env, home } = sandbox();
  try {
    applyGoalCommand("conv_c", { kind: "set", objective: "x" }, env);
    assert.equal(applyGoalCommand("conv_c", { kind: "pause" }, env).status, "paused");
    assert.equal(applyGoalCommand("conv_c", { kind: "resume" }, env).status, "active");
    assert.equal(applyGoalCommand("conv_c", { kind: "clear" }, env), null);
    assert.equal(readGoalModeState("conv_c", env), null);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
