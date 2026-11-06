import assert from "node:assert/strict";
import test from "node:test";
import { planTask } from "../src/lib/hermes/task-plan.ts";
import { turnApprovalPolicy } from "../src/lib/hermes/turn-approval-policy.ts";
import { prepareTurn } from "../src/lib/hermes/dispatch-core.ts";

const lab = String.raw`C:\Users\Student\Downloads\5GLab assignment\5GLab assignment`;
function paths(request) {
  return planTask({ request, authenticated: true }).requiredResources
    .filter(resource => resource.kind === "path").map(resource => resource.value);
}

for (const wrap of [value => value, value => `"${value}"`, value => `\`${value}\``]) {
  test(`a ${wrap("path")} with spaces preserves its scope`, () => {
    assert.deepEqual(paths(`Read ${wrap(lab)} and summarize the assignment.`), [lab]);
  });
}

test("multiple explicit Windows paths stay separate without adding parent aliases", () => {
  const target = String.raw`D:\5XTA0-lab\ubuntu-wsl`;
  assert.deepEqual(paths(`Read ${lab}; then inspect ${target}.`), [lab, target]);
});

test("an independently requested Downloads folder remains a resource", () => {
  assert.deepEqual(paths(`Read "${lab}" and inspect my Downloads folder.`), [lab, "downloads"]);
});

for (const surface of ["garden_chat", "dashboard_terminal"]) {
  test(`Super Agent standing approval survives API omission on ${surface}`, () => {
    assert.equal(turnApprovalPolicy({ surface, superAgent: true }).yoloMode, true);
    assert.equal(turnApprovalPolicy({ surface, superAgent: false }).yoloMode, false);
  });
}

test("Super Agent does not grant a public surface standing approval", () => {
  assert.equal(turnApprovalPolicy({
    surface: "quartz_ai", superAgent: true, yoloMode: true, savedYoloMode: true,
  }).yoloMode, false);
});

test("a document folder permission accurately describes its requested read", () => {
  const turn = prepareTurn({
    request: `Read "${lab}" and summarize the assignment.`, surface: "garden_chat",
    userId: 1, grants: [], workspaceRoot: "C:/runtime/test-workspace",
    interactiveApprovals: true,
  });
  assert.ok(turn.pendingPermissions.length > 0);
  for (const request of turn.pendingPermissions) {
    assert.equal(request.path, lab);
    assert.deepEqual(request.operations, ["read"]);
    assert.match(request.message, /read/i);
    assert.doesNotMatch(request.message, /not read/i);
  }
});

test("approving the exact lab folder clears preflight without approving Downloads", () => {
  const input = {
    request: `Read ${lab} and summarize the assignment.`, surface: "garden_chat",
    userId: 1, workspaceRoot: "C:/runtime/test-workspace", interactiveApprovals: true,
  };
  const pending = prepareTurn({ ...input, grants: [] });
  assert.equal(pending.blocked, true);
  const grant = {
    id: "lab-once", userId: 1, canonicalPath: lab, displayName: "5GLab assignment",
    scope: "one_time", createdAt: "now", revokedAt: null,
    permissions: { read: true, create: false, modify: false, move: false, delete: false, execute: false },
  };
  const approved = prepareTurn({ ...input, grants: [grant] });
  assert.equal(approved.blocked, false);
  assert.deepEqual(approved.pendingPermissions, []);
  assert.equal(prepareTurn({ ...input, request: "Read my Downloads folder.", grants: [grant] }).blocked, true);
});
