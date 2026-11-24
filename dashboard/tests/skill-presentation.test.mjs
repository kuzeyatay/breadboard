import assert from "node:assert/strict";
import test from "node:test";
import { skillUseState, skillPermissionLabel } from "../src/lib/hermes/skill-presentation.ts";
import { summarizeCapabilityUse, turnCapabilitySelection } from "../src/lib/hermes/capability-usage.ts";

test("available inventory and ordinary tool calls never become used skills", () => {
  const summary = summarizeCapabilityUse({ selection: { inventory: { skills: 300, connections: 8, workflows: 2 } }, toolCalls: [{ toolName: "read", success: true }] });
  assert.deepEqual(summary.used, []);
});

test("loaded instructions remain distinct from selection and successful or failed use after persistence", () => {
  const selection = turnCapabilitySelection({ invocations: [{ kind: "skill", slug: "writing" }, { kind: "skill", slug: "watch" }], automaticSkills: [] });
  const summary = JSON.parse(JSON.stringify(summarizeCapabilityUse({ selection, toolCalls: [{ toolName: "watch_run", success: false }] })));
  assert.equal(skillUseState(summary.used.find(s => s.id === "writing")), "loaded");
  assert.equal(skillUseState(summary.used.find(s => s.id === "watch")), "failed");
  const legacy = summarizeCapabilityUse({ selection: { skills: [{ slug: "writing", selection: "requested" }] } });
  assert.equal(skillUseState(legacy.used[0]), "selected");
  const retried = summarizeCapabilityUse({ selection, toolCalls: [{ toolName: "watch_run", success: false }, { toolName: "watch_run", success: true }] });
  assert.equal(skillUseState(retried.used.find(s => s.id === "watch")), "used");
  const opened = summarizeCapabilityUse({ skillOpens: [{ slug: "writing" }] });
  assert.equal(skillUseState(opened.used[0]), "used");
  assert.equal(opened.used[0].selection, "agent");
  assert.deepEqual(opened.used[0].actions, ["opened"]);
});

test("access descriptions are readable and unknown permissions stay visible", () => {
  assert.equal(skillPermissionLabel("filesystem-read"), "Read files in the allowed workspace");
  assert.equal(skillPermissionLabel("shell"), "Run commands in the allowed workspace");
  assert.equal(skillPermissionLabel("future-access"), "future-access");
});
