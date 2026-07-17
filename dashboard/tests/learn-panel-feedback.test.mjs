import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workspaceSource = fs.readFileSync(
  new URL("../src/app/gardens/[clusterSlug]/workspace-client.tsx", import.meta.url),
  "utf8",
);
const learnSource = fs.readFileSync(
  new URL("../src/lib/learn.ts", import.meta.url),
  "utf8",
);

test("Learn panel omits Council activity and its polling", () => {
  assert.doesNotMatch(workspaceSource, /Council activity/);
  assert.doesNotMatch(workspaceSource, /\/learn\/events/);
  assert.doesNotMatch(workspaceSource, /learnEvents/);
});

test("Learn panel reports the active step without a redundant running subtitle", () => {
  assert.doesNotMatch(workspaceSource, /Learn is running\. \$\{Math\.round\(progress\)\}% complete\./);
  assert.match(workspaceSource, /Learn failed before completion\./);
  assert.doesNotMatch(workspaceSource, /Internal stage:/);
  assert.match(workspaceSource, /const stageMessage =/);
  assert.match(workspaceSource, /stageMessage \|\| null/);
  assert.match(workspaceSource, /Section:/);
  assert.match(workspaceSource, /Page:/);
  assert.doesNotMatch(workspaceSource, /The error below explains what needs attention/);
  assert.doesNotMatch(workspaceSource, /selectedDocumentNames/);
  assert.match(workspaceSource, /aria-live="polite"/);
  assert.match(learnSource, /Planning failed; last internal step:/);
  assert.match(learnSource, /Lesson generation failed; last internal step:/);
});
