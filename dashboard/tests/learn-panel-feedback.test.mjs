import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workspaceSource = fs.readFileSync(
  new URL(
    "../src/app/gardens/[clusterSlug]/workspace-client.tsx",
    import.meta.url,
  ),
  "utf8",
);
const learnSource = fs.readFileSync(
  new URL("../src/lib/learn.ts", import.meta.url),
  "utf8",
);
const confirmationDialogSource = fs.readFileSync(
  new URL(
    "../src/app/components/learn-confirmation-dialog.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("Learn panel omits Council activity and its polling", () => {
  assert.doesNotMatch(workspaceSource, /Council activity/);
  assert.doesNotMatch(workspaceSource, /\/learn\/events/);
  assert.doesNotMatch(workspaceSource, /learnEvents/);
});

test("Learn panel reports the active step without a redundant running subtitle", () => {
  assert.doesNotMatch(
    workspaceSource,
    /Learn is running\. \$\{Math\.round\(progress\)\}% complete\./,
  );
  assert.match(workspaceSource, /Learn failed before completion\./);
  assert.doesNotMatch(workspaceSource, /Internal stage:/);
  assert.match(workspaceSource, /const stageMessage =/);
  assert.match(workspaceSource, /stageMessage \|\| null/);
  assert.match(workspaceSource, /Section:/);
  assert.match(workspaceSource, /Page:/);
  assert.doesNotMatch(
    workspaceSource,
    /The error below explains what needs attention/,
  );
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

test("destructive Learn actions use the custom confirmation dialog", () => {
  assert.match(workspaceSource, /setLearnConfirmationAction\("full_rebuild"\)/);
  assert.match(workspaceSource, /setLearnConfirmationAction\("clear"\)/);
  assert.match(workspaceSource, /<LearnConfirmationDialog/);
  assert.doesNotMatch(
    workspaceSource,
    /window\.confirm\([\s\S]{0,300}regenerate the Learning Map/,
  );
  assert.match(confirmationDialogSource, /role="alertdialog"/);
  assert.match(confirmationDialogSource, /aria-modal="true"/);
  assert.match(confirmationDialogSource, /event\.key === "Escape"/);
  assert.match(confirmationDialogSource, /cancelRef\.current\?\.focus\(\)/);
});

test("rebuild and clear dialogs use the readable semantic light-theme palette", () => {
  assert.match(confirmationDialogSource, /Rebuild the entire garden\?/);
  assert.match(confirmationDialogSource, /Clear all Learn data\?/);
  assert.match(confirmationDialogSource, /Before you rebuild/);
  assert.match(confirmationDialogSource, /What stays/);
  assert.match(confirmationDialogSource, /bg-\[var\(--paper-raised\)\]/);
  assert.match(confirmationDialogSource, /text-\[var\(--ink-muted\)\]/);
  assert.match(confirmationDialogSource, /bg-\[var\(--danger\)\]/);
  assert.match(confirmationDialogSource, /text-\[#fffefb\]/);
  assert.doesNotMatch(confirmationDialogSource, /text-amber-200|bg-amber-950/);
});

test("destructive Learn dialog keeps keyboard focus inside the two actions", () => {
  assert.match(confirmationDialogSource, /event\.key !== "Tab"/);
  assert.match(confirmationDialogSource, /event\.shiftKey/);
  assert.match(confirmationDialogSource, /last\.focus\(\)/);
  assert.match(confirmationDialogSource, /first\.focus\(\)/);
});
