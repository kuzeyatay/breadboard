import test from "node:test";
import assert from "node:assert/strict";
import { turnApprovalPolicy } from "../src/lib/hermes/turn-approval-policy.ts";
import { prepareTurn } from "../src/lib/hermes/dispatch-core.ts";

function prepare(channel, options = {}) {
  const surface = options.surface ?? "dashboard_terminal";
  const policy = turnApprovalPolicy({ surface, deliveryChannel: channel, ...options });
  const turn = prepareTurn({
    request: "okay, mute my pc",
    surface,
    userId: surface === "quartz_ai" ? null : 1,
    grants: [],
    workspaceRoot: "/runtime/hermes/test-pc-access",
    interactiveApprovals: policy.interactiveApprovals,
  });
  return { policy, tools: turn.grant.allowedTools };
}

for (const channel of ["telegram", "whatsapp"]) {
  test(`${channel} inherits the owner's standing approval and exposes real PC tools`, () => {
    const { policy, tools } = prepare(channel, { savedYoloMode: true });
    assert.equal(policy.interactive, false);
    assert.equal(policy.yoloMode, true);
    for (const name of ["terminal_execute_command", "computer_use", "breadboard_use"]) {
      assert.equal(tools[name], true, name);
    }
  });
  test(`${channel} cannot manufacture standing approval or override an explicit opt-out`, () => {
    for (const options of [{}, { savedYoloMode: false }, { savedYoloMode: true, yoloMode: false }]) {
      const { policy, tools } = prepare(channel, options);
      assert.equal(policy.yoloMode, false);
      assert.equal(tools.terminal_execute_command, false);
      assert.equal(tools.computer_use, false);
    }
  });
}

test("desktop PC tools remain discoverable without a computer-use keyword match", () => {
  const { policy, tools } = prepare(undefined);
  assert.equal(policy.yoloMode, false);
  assert.equal(policy.interactive, true);
  assert.equal(tools.terminal_execute_command, true);
  assert.equal(tools.computer_use, true);
});

test("public Quartz cannot acquire PC access through delivery or YOLO flags", () => {
  const { policy, tools } = prepare("telegram", { surface: "quartz_ai", savedYoloMode: true, yoloMode: true });
  assert.equal(policy.yoloMode, false);
  for (const name of ["terminal_execute_command", "computer_use", "breadboard_use"]) {
    assert.equal(tools[name], false, name);
  }
});
