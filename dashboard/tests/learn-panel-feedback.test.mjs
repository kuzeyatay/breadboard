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
const modelCallIndicatorSource = fs.readFileSync(
  new URL("../src/app/components/model-call-indicator.tsx", import.meta.url),
  "utf8",
);

test("Learn panel omits Council activity and its polling", () => {
  assert.doesNotMatch(workspaceSource, /Council activity/);
  assert.doesNotMatch(workspaceSource, /\/learn\/events/);
  assert.doesNotMatch(workspaceSource, /learnEvents/);
});

test("Learn panel reports one failure message without redundant status or stage copy", () => {
  assert.doesNotMatch(
    workspaceSource,
    /Learn is running\. \$\{Math\.round\(progress\)\}% complete\./,
  );
  assert.doesNotMatch(workspaceSource, /Learn failed before completion\./);
  assert.match(workspaceSource, /const showFailedState = status === "failed" && !startingLearnAction/);
  assert.match(workspaceSource, /showFailedState && job\?\.error/);
  assert.match(
    workspaceSource,
    /status === "failed"\s*\|\|\s*status === "cancelled"\s*\|\|\s*staleReviewForExistingGarden/,
  );
  assert.match(workspaceSource, /Starting Learn retry\.\.\./);
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

test("abandoned Learn recovery states the observed failure without claiming an app restart", () => {
  assert.match(
    learnSource,
    /Learn stopped responding before completion\. Your garden was restored and is safe to retry\./,
  );
  assert.doesNotMatch(learnSource, /Interrupted by an app restart/);
  assert.match(
    workspaceSource,
    /the learn worker stopped without completing[\s\S]*?Learn stopped responding before completion/,
  );
});

test("Learn keeps controls up and current-step copy below the progress bar", () => {
  assert.match(
    workspaceSource,
    /<div className="flex flex-col gap-2">[\s\S]*?<div className="flex min-h-8 items-start justify-between gap-3">[\s\S]*?<div className="flex h-8 shrink-0 items-center gap-2">[\s\S]*?<p className="text-sm font-medium text-white">Learn<\/p>[\s\S]*?<div className="flex min-w-0 flex-1 items-start gap-2">[\s\S]*?<div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-x-2 gap-y-1\.5 md:flex-nowrap">/,
  );
  assert.match(
    workspaceSource,
    /learn-progress-pulse[\s\S]*?<div className="mt-2 min-w-0" aria-live="polite" aria-atomic="true">[\s\S]*?statusDetails\.join\(" "\)/,
  );
  assert.match(
    workspaceSource,
    /status === "cancelled"\s*\|\|\s*staleReviewForExistingGarden[\s\S]*?\?\s*""/,
  );
});

test("completed Learn panel omits redundant status copy and internal identifiers", () => {
  assert.doesNotMatch(workspaceSource, /Lessons complete\./);
  assert.match(
    workspaceSource,
    /const statusDetails = status === "complete"\s*\? \[\]/,
  );

  const completedFooterIndex = workspaceSource.indexOf(
    '{panelExpanded && status === "complete" && (',
  );
  const completedFooterEnd = workspaceSource.indexOf(
    "</section>",
    completedFooterIndex,
  );
  assert.ok(
    completedFooterIndex >= 0 && completedFooterEnd > completedFooterIndex,
    "completed Learn footer is missing",
  );
  const completedFooter = workspaceSource.slice(
    completedFooterIndex,
    completedFooterEnd,
  );
  assert.match(completedFooter, /Open lessons/);
  assert.doesNotMatch(completedFooter, /latestTextbookVersionId|job\?\.id/);
});

test("an active Learn run shows one action instead of wrapping disabled actions", () => {
  assert.match(workspaceSource, /\{hasLearnData && !active && \(/);
  assert.match(workspaceSource, /\{showPrimaryAction && !active && \(/);
  assert.match(workspaceSource, /\{active && \([\s\S]*?Cancelling\.\.\./);
});

test("model call labels are plain text without a badge or status dot", () => {
  assert.match(
    modelCallIndicatorSource,
    /className="inline-flex items-center whitespace-nowrap text-gray-500"/,
  );
  assert.match(
    workspaceSource,
    /\{learnPanelModel \? \([\s\S]*?<span className="text-gray-600">Model:<\/span>[\s\S]*?<span[\s\S]*?className="font-mono tabular-nums text-gray-200"/,
  );
  // In flight, the chip names the model actually placing the calls. Idle, it
  // names the model the next run will use, so changing the Intelligence picker
  // in the chat bar is reflected without waiting for another run.
  assert.match(
    workspaceSource,
    /const learnPanelModel = active \? \(job\?\.model \?\? model\) : model;/,
  );
  assert.doesNotMatch(
    modelCallIndicatorSource,
    /text-\[10px\]|rounded-full|border-gray|bg-gray|bg-emerald/,
  );
});

test("a long syllabus name stays bounded while the panel closes from the toolbar", () => {
  assert.match(
    workspaceSource,
    /ref=\{learnSyllabusMenuButtonRef\}[\s\S]*?className="neu-button flex h-\[30px\] w-full min-w-0 items-center/,
  );
  assert.match(
    workspaceSource,
    /className="min-w-0 flex-1 max-w-28 truncate sm:max-w-32"/,
  );
  assert.doesNotMatch(workspaceSource, /aria-label="Close Learn panel"/);
  assert.match(
    workspaceSource,
    /onClick=\{\(\) => setLearnPanelOpen\(\(open\) => !open\)\}[\s\S]*?learnPanelOpen \? "Close Learn panel" : "Open Learn panel"/,
  );
});

test("Learn controls stay on one row and the syllabus name absorbs the pressure", () => {
  assert.match(workspaceSource, /justify-end gap-x-2 gap-y-1\.5 md:flex-nowrap/);
  assert.match(
    workspaceSource,
    /ref=\{learnSyllabusMenuButtonRef\}[\s\S]*?className="neu-button flex h-\[30px\] w-full min-w-0 items-center/,
  );
  assert.match(workspaceSource, /className="min-w-0 flex-1 max-w-28 truncate sm:max-w-32"/);
  for (const label of ["Clear data", "Generate", "Source-only", "Skip review"]) {
    assert.ok(workspaceSource.includes(label), `${label} control is missing`);
  }
  const rowStart = workspaceSource.indexOf(
    'justify-end gap-x-2 gap-y-1.5 md:flex-nowrap',
  );
  const rowEnd = workspaceSource.indexOf(
    '{(active || status === "complete" || status === "failed") && (',
    rowStart,
  );
  assert.ok(rowStart >= 0 && rowEnd > rowStart, "Learn control row is missing");
  const row = workspaceSource.slice(rowStart, rowEnd);
  const controlHeights = row.match(/h-\[30px\]/g) ?? [];
  assert.ok(
    controlHeights.length >= 6,
    "every Learn control should share the 30px row height",
  );
});

test("Learn exposes a natural-language request layer from a question control", () => {
  assert.match(workspaceSource, /aria-label=\{[\s\S]*?Guide Learn with a request/);
  assert.match(workspaceSource, /ariaLabel="Guide Learn"/);
  assert.match(workspaceSource, /role="dialog"/);
  assert.match(workspaceSource, /LEARN_USER_INSTRUCTION_EXAMPLES\.map/);
  assert.match(workspaceSource, /id="learn-user-instruction"/);
  assert.match(workspaceSource, /Redo only the topics after Maxwell's equations/);
  assert.match(workspaceSource, /userInstruction: learnUserInstruction\.trim\(\) \|\| undefined/);
  assert.match(workspaceSource, /handleGuidedLearnRun/);
  assert.match(workspaceSource, /hasExistingLearnContent[\s\S]*?setLearnConfirmationAction\("full_rebuild"\)/);
});

test("Learn panel uses the wider workspace without a blurred edge", () => {
  const css = fs.readFileSync(
    new URL("../src/app/globals.css", import.meta.url),
    "utf8",
  );
  assert.match(workspaceSource, /bb-neu-learn-tray[^"]*max-w-7xl/);
  assert.doesNotMatch(workspaceSource, /bb-neu-learn-tray[^"]*max-w-5xl/);
  assert.match(
    css,
    /\.bb-neu-learn-tray\s*\{[\s\S]*?box-shadow:\s*none;/,
  );
  assert.doesNotMatch(
    css,
    /html\[data-theme="dark"\] \.bb-neu-learn-tray\s*\{/,
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

test("rebuild and clear dialogs use concise copy and the readable semantic light-theme palette", () => {
  assert.match(confirmationDialogSource, /Rebuild the entire garden\?/);
  assert.match(confirmationDialogSource, /Clear Learn data\?/);
  assert.match(
    confirmationDialogSource,
    /This permanently deletes all generated Learn content and history\. This cannot be undone\./,
  );
  assert.match(confirmationDialogSource, /Before you rebuild/);
  assert.doesNotMatch(confirmationDialogSource, /What stays/);
  assert.match(confirmationDialogSource, /\{content\.guidance && \(/);
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
