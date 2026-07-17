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

test("Learn keeps controls up and current-step copy below the progress bar", () => {
  assert.match(
    workspaceSource,
    /<div className="flex flex-col gap-2">[\s\S]*?<div className="flex min-h-8 items-center justify-between gap-3">[\s\S]*?<div className="flex shrink-0 items-center gap-2">[\s\S]*?<p className="text-sm font-medium text-white">Learn<\/p>[\s\S]*?<div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">/,
  );
  assert.match(
    workspaceSource,
    /learn-progress-pulse[\s\S]*?<div className="mt-2 min-w-0" aria-live="polite" aria-atomic="true">[\s\S]*?statusDetails\.join\(" "\)/,
  );
  assert.match(
    workspaceSource,
    /status === "cancelled" \|\| staleReviewForExistingGarden[\s\S]*?\? ""/,
  );
});

test("Learn panel omits the old colored repair summary", () => {
  assert.doesNotMatch(workspaceSource, /Last repair:/);
  assert.doesNotMatch(workspaceSource, /Existing learner pages are protected/);
  assert.doesNotMatch(workspaceSource, /proposedMap\.warnings\.map/);
});
