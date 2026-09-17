import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { learnOperationActivity } from "../src/lib/learn-operation-activity.ts";

const completed = { id: "learn_finished", status: "complete" };
const runtimeJob = { jobId: "job_rewrite", jobType: "learn", state: "running" };
const workspace = fs.readFileSync(
  new URL("../src/app/gardens/[clusterSlug]/workspace-client.tsx", import.meta.url), "utf8",
);
const parsed = ts.createSourceFile("workspace.tsx", workspace, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function handler(name, bindings) {
  let found;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.ok(found, name);
  const js = ts.transpileModule(found.getText(parsed), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return Function(...Object.keys(bindings), `${js}; return ${name};`)(...Object.values(bindings));
}

test("finished lessons remain busy throughout the separate rewrite lifecycle", () => {
  for (const state of ["queued", "admitted", "starting", "running", "checkpointing", "cancelling"]) {
    for (const status of ["running", "restoring_ai"]) {
      assert.deepEqual(learnOperationActivity({
        job: completed, humanizer: { status }, runtimeJob: { ...runtimeJob, state },
      }), { active: true, humanizerActive: true, cancelJobId: "job_rewrite" });
    }
  }
});

test("pending rewrite admission blocks new work without cancelling old generation", () => {
  assert.deepEqual(learnOperationActivity({ job: completed }, true), {
    active: true, humanizerActive: true, cancelJobId: null,
  });
  assert.equal(learnOperationActivity({ job: completed, humanizer: { status: "running" } }).cancelJobId, null);
});

test("settled rewrites release controls and normal Learn cancellation still works", () => {
  for (const state of ["succeeded", "cancelled", "failed", "interrupted", "uncertain", "resource_exhausted"]) {
    assert.equal(learnOperationActivity({
      job: completed, humanizer: { status: "ai" }, runtimeJob: { ...runtimeJob, state },
    }).active, false);
  }
  for (const status of ["planning", "paused", "awaiting_confirmation"]) {
    assert.equal(learnOperationActivity({ job: { ...completed, status } }).cancelJobId, completed.id);
  }
  assert.equal(learnOperationActivity({ publicationRecovery: { active: true } }).active, true);
  assert.equal(learnOperationActivity({ runtimeJob: { ...runtimeJob, jobType: "document-ingestion" } }).cancelJobId, null);
});

test("workspace Cancel targets the rewrite and start/repair handlers reject overlapping work", async () => {
  const calls = [];
  const activity = learnOperationActivity({ job: completed, humanizer: { status: "running" }, runtimeJob });
  const bindings = {
    learnBusy: false, learnCancelBusy: false,
    learnOperationActive: activity.active, learnCancelJobId: activity.cancelJobId,
    postLearnAction: async (...args) => calls.push(args),
  };
  await handler("handleLearnPrimary", bindings)();
  await handler("handleRepairIssues", bindings)();
  assert.equal(calls.length, 0);
  await handler("handleCancelLearn", bindings)();
  assert.deepEqual(calls, [["cancel", { expectedJobId: "job_rewrite" }]]);
  await handler("handleCancelLearn", { ...bindings, learnCancelJobId: null })();
  assert.equal(calls.length, 1);
});
