// Opt-in live checks against the real cloned LoopX CLI.
//
// These spawn Python and take tens of seconds per tick (a LoopX command is
// roughly 2.5 seconds off OneDrive and closer to ten on it), so they stay out of
// the default suite. Run them after touching the bridge, the tick, or the
// projection:
//
//   BREADBOARD_TEST_LIVE_LOOPX=1 node --test --experimental-strip-types tests/loopx-live.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runLoopxTick } from "../src/lib/loopx/tick.ts";
import { loopStateSection } from "../src/lib/loopx/governance.ts";
import { loopxPaths, resolveLoopxRuntime, runLoopx } from "../src/lib/loopx/runtime.ts";
import {
  buildSnapshot,
  readObjective,
  readSnapshot,
  writeSnapshot,
} from "../src/lib/loopx/snapshot.ts";

const live = Boolean(process.env.BREADBOARD_TEST_LIVE_LOOPX?.trim());
const home = fs.mkdtempSync(path.join(os.tmpdir(), "loopx-live-"));
process.env.BREADBOARD_LOOPX_HOME = home;
process.on("exit", () => {
  fs.rmSync(home, { recursive: true, force: true });
});

const conversation = "conv-live-0001";
const objective = "Migrate every legacy anchor to the two-phase planner";
const turn = {
  conversationPublicId: conversation,
  surface: "dashboard_terminal",
  mode: "knowledge",
  userText: "keep working on the anchor migration until it is done",
  userTurnCount: 1,
  objective,
  outcome: "completed",
  toolCalls: 2,
  producedArtifact: false,
};

test(
  "a first tick creates the goal, records the turn, and leaves a readable snapshot",
  { skip: live ? false : "set BREADBOARD_TEST_LIVE_LOOPX=1" },
  async () => {
    assert.ok(resolveLoopxRuntime(), "the LoopX runtime must resolve");
    const result = await runLoopxTick(turn);
    assert.equal(result.ran, true, `tick did not run: ${result.reason}`);
    assert.equal(result.created, true);

    const paths = loopxPaths(conversation);
    assert.ok(fs.existsSync(paths.registry), "LoopX wrote no registry");
    assert.ok(fs.existsSync(paths.stateFile), "LoopX wrote no goal state");
    assert.equal(readObjective(paths.stateFile), objective);

    const snapshot = readSnapshot(conversation);
    assert.ok(snapshot, "the tick left no snapshot");
    assert.equal(snapshot.objective, objective);
    assert.ok(snapshot.obligation, "the loop stated no obligation for the turn");
    assert.deepEqual(snapshot.mustInclude, [
      "coherent_artifact",
      "targeted_validation",
      "state_writeback",
    ]);

    const rendered = loopStateSection(conversation, "dashboard_terminal");
    assert.match(rendered, /# loop_state/);
    assert.match(rendered, /No owner gate is open/);
    // LoopX's own onboarding todo asks the agent to run `loopx check`; the
    // projection must never hand that to an assistant forbidden from doing it.
    // The intro and the closing rules both name LoopX on purpose, so only the
    // work lines are checked.
    const workLines = rendered
      .split("\n")
      .filter((line) => /^(- |Next action on record:)/.test(line));
    for (const line of workLines) {
      assert.doesNotMatch(line, /loopx/i, `LoopX housekeeping leaked: ${line}`);
    }
  },
);

test(
  "nothing LoopX writes escapes the Breadboard-owned root",
  { skip: live ? false : "set BREADBOARD_TEST_LIVE_LOOPX=1" },
  () => {
    const root = path.resolve(home);
    const written = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else written.push(full);
      }
    };
    walk(root);
    assert.ok(written.length > 0, "the live tick wrote nothing at all");
    for (const file of written) {
      assert.ok(path.resolve(file).startsWith(root), `${file} escaped the root`);
    }
    // Upstream's shared registry location must stay untouched.
    assert.ok(
      written.every((file) => !file.includes(path.join(".codex", "loopx"))),
      "a file landed in the shared ~/.codex/loopx layout",
    );
  },
);

test(
  "an open owner gate flips the turn from delivery to waiting",
  { skip: live ? false : "set BREADBOARD_TEST_LIVE_LOOPX=1" },
  async () => {
    const paths = loopxPaths(conversation);
    await runLoopx({
      conversationPublicId: conversation,
      command: [
        "todo",
        "add",
        "--goal-id",
        paths.goalId,
        "--project",
        paths.project,
        "--role",
        "user",
        "--task-class",
        "user_gate",
        "--text",
        "Approve deleting the legacy anchor table before the migration continues",
      ],
    });
    const quota = await runLoopx({
      conversationPublicId: conversation,
      command: ["quota", "should-run", "--goal-id", paths.goalId],
    });
    writeSnapshot(
      conversation,
      buildSnapshot({
        goalId: paths.goalId,
        objective: readObjective(paths.stateFile),
        quota: quota.payload,
        capturedAt: new Date().toISOString(),
      }),
    );

    const snapshot = readSnapshot(conversation);
    assert.equal(snapshot.requiresUserAction, true);
    assert.deepEqual(snapshot.userGates, [
      "Approve deleting the legacy anchor table before the migration continues",
    ]);
    const rendered = loopStateSection(conversation, "dashboard_terminal");
    assert.match(rendered, /waiting on a person, not on you/);
    assert.match(rendered, /Approve deleting the legacy anchor table/);

    // A tick while gated must not clear the gate.
    const ticked = await runLoopxTick({
      ...turn,
      userTurnCount: 3,
      toolCalls: 0,
    });
    assert.equal(ticked.ran, true);
    assert.equal(readSnapshot(conversation).userGates.length, 1);
  },
);
