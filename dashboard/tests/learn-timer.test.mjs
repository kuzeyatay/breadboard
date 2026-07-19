import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  currentLearnElapsedMs,
  formatLearnElapsedTime,
  transitionLearnTimer,
} from "../src/lib/learn-timer.ts";

test("Learn timer pauses for map confirmation and resumes for generation", () => {
  const planning = {
    elapsedMs: 0,
    startedAt: "2026-07-14T10:00:00.000Z",
  };
  const awaitingConfirmation = transitionLearnTimer(
    planning,
    "awaiting_confirmation",
    "2026-07-14T10:02:00.000Z",
  );

  assert.deepEqual(awaitingConfirmation, { elapsedMs: 120_000 });
  assert.equal(
    currentLearnElapsedMs(
      awaitingConfirmation,
      Date.parse("2026-07-14T10:05:00.000Z"),
    ),
    120_000,
  );

  const generating = transitionLearnTimer(
    awaitingConfirmation,
    "generating_textbook",
    "2026-07-14T10:05:00.000Z",
  );
  assert.deepEqual(generating, {
    elapsedMs: 120_000,
    startedAt: "2026-07-14T10:05:00.000Z",
  });
  assert.equal(
    currentLearnElapsedMs(generating, Date.parse("2026-07-14T10:06:00.000Z")),
    180_000,
  );

  const complete = transitionLearnTimer(
    generating,
    "complete",
    "2026-07-14T10:07:00.000Z",
  );
  assert.deepEqual(complete, { elapsedMs: 240_000 });
});

test("Learn timer formats accumulated time as a stable stopwatch", () => {
  assert.equal(formatLearnElapsedTime(0), "00:00:00");
  assert.equal(formatLearnElapsedTime(3_723_999), "01:02:03");
  assert.equal(formatLearnElapsedTime(100 * 60 * 60 * 1000), "100:00:00");
});

test("Learn timer and skip-review state are persisted and exposed by the panel", () => {
  const learnSource = fs.readFileSync(
    new URL("../src/lib/learn.ts", import.meta.url),
    "utf8",
  );
  const workspaceSource = fs.readFileSync(
    new URL(
      "../src/app/gardens/[clusterSlug]/workspace-client.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const planRouteSource = fs.readFileSync(
    new URL(
      "../src/app/api/gardens/[gardenId]/learn/plan/route.ts",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(learnSource, /active_elapsed_ms\s+INTEGER NOT NULL DEFAULT 0/);
  assert.match(learnSource, /timer_started_at\s+TEXT/);
  assert.match(learnSource, /transitionLearnTimer/);
  assert.match(learnSource, /function learnTimerForWorkflow/);
  assert.match(workspaceSource, /Skip review/);
  assert.match(workspaceSource, /skipManualReview:[\s\S]*?endpoint === "plan" \? false/);
  assert.match(workspaceSource, /formatLearnElapsedTime\(learnElapsedMs\)/);
  assert.doesNotMatch(workspaceSource, />paused<\/span>/);
  assert.match(workspaceSource, /Paused while the learning map waits for confirmation/);
  assert.match(planRouteSource, /autoConfirmTopicMap: body\.skipManualReview === true/);
  assert.match(
    learnSource,
    /if \(!autoConfirmTopicMap\) return planning;[\s\S]*?confirmLearningMap[\s\S]*?runTextbookGeneration/,
  );
});

test("Skip review remains changeable while the source map is being planned", () => {
  const workspaceSource = fs.readFileSync(
    new URL(
      "../src/app/gardens/[clusterSlug]/workspace-client.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(
    workspaceSource,
    /skipManualReview:[\s\S]*?endpoint === "plan" \? false : learnSkipManualReviewRef\.current/,
  );
  assert.match(workspaceSource, /autoConfirmingLearnJobRef/);
  assert.match(
    workspaceSource,
    /autoConfirmLearnJobStatus !== "awaiting_confirmation"[\s\S]*?postLearnAction\("confirm", \{ generate: true \}\)/,
  );
  assert.match(workspaceSource, /active && status !== "planning"/);
});

test("Learn panel stays outside the independently scrolling chat transcript", () => {
  const workspaceSource = fs.readFileSync(
    new URL(
      "../src/app/gardens/[clusterSlug]/workspace-client.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const panelIndex = workspaceSource.indexOf("{renderLearnPanel()}");
  const chatScrollerIndex = workspaceSource.indexOf(
    '<main className="flex-1 overflow-y-auto px-4 py-6">',
  );
  const transcriptIndex = workspaceSource.indexOf("<ChatTranscript", chatScrollerIndex);

  assert.ok(panelIndex >= 0, "Learn panel should be rendered");
  assert.ok(chatScrollerIndex > panelIndex, "Learn panel should precede the chat scroller");
  assert.ok(transcriptIndex > chatScrollerIndex, "chat transcript should remain inside its scroller");
  assert.match(workspaceSource, /max-h-\[55vh\][\s\S]*?shrink-0 overflow-y-auto/);
});

test("navbar toggles Learn while a collapsed status indicator remains outside chat scrolling", () => {
  const workspaceSource = fs.readFileSync(
    new URL(
      "../src/app/gardens/[clusterSlug]/workspace-client.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const indicatorIndex = workspaceSource.indexOf("{renderCollapsedLearnIndicator()}");
  const chatScrollerIndex = workspaceSource.indexOf(
    '<main className="flex-1 overflow-y-auto px-4 py-6">',
  );

  assert.match(workspaceSource, /learnPanelOpen \? "Close Learn panel" : "Open Learn panel"/);
  assert.match(workspaceSource, /function renderCollapsedLearnIndicator/);
  assert.ok(indicatorIndex >= 0, "collapsed Learn status should render");
  assert.ok(indicatorIndex < chatScrollerIndex, "collapsed status must sit outside chat scrolling");
  assert.match(workspaceSource, /status === "complete"[\s\S]*?text-\[#4f8a62\]/);
  assert.match(workspaceSource, /status === "failed"[\s\S]*?text-\[#b85c5c\]/);
  assert.match(workspaceSource, /status === "complete" \|\| status === "failed"/);
  assert.match(workspaceSource, /h-5 w-5 rounded-full border-\[3px\] border-current/);
  assert.doesNotMatch(workspaceSource, /d="m5 12\.5 4\.2 4\.2L19 7"/);
  assert.match(workspaceSource, /onClick=\{\(\) => setLearnPanelOpen\(true\)\}/);
});

test("collapsed Learn indicator expires two minutes after a non-loading state", () => {
  const workspaceSource = fs.readFileSync(
    new URL(
      "../src/app/gardens/[clusterSlug]/workspace-client.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(
    workspaceSource,
    /LEARN_SETTLED_INDICATOR_VISIBLE_MS = 2 \* 60 \* 1000/,
  );
  assert.match(workspaceSource, /Date\.parse\(job\.updatedAt \?\? ""\)/);
  assert.match(
    workspaceSource,
    /window\.setTimeout\([\s\S]*?setShowSettledLearnIndicator\(false\)[\s\S]*?remainingMs/,
  );
  assert.match(
    workspaceSource,
    /if \(!active && !showSettledLearnIndicator\) return null/,
  );
  assert.match(
    workspaceSource,
    /if \(active\) \{[\s\S]*?setShowSettledLearnIndicator\(true\)/,
  );
});

test("failed Learn jobs choose retry or scoped repair from the current garden state", () => {
  const workspaceSource = fs.readFileSync(
    new URL(
      "../src/app/gardens/[clusterSlug]/workspace-client.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(
    workspaceSource,
    /showPrimaryAction =[\s\S]*?status === "failed"[\s\S]*?status === "cancelled"/,
  );
  assert.match(
    workspaceSource,
    /shouldRepairFailedJob =\s*status === "failed" && hasExistingLearnContent/,
  );
  assert.match(
    workspaceSource,
    /async function handleRepairIssues\(\)[\s\S]*?postLearnAction\("regenerate", \{ mode: "repair" \}\)/,
  );
  assert.match(workspaceSource, /status === "failed"[\s\S]*?"Retry Learn"/);
  assert.match(workspaceSource, /endpoint === "regenerate"[\s\S]*?unaffected pages were preserved/);
  assert.match(workspaceSource, /handleFullRebuild[\s\S]*?forceFullRebuild: true/);
});

test("Learn failures stay in the panel without opening a dialog or toast", () => {
  const workspaceSource = fs.readFileSync(
    new URL(
      "../src/app/gardens/[clusterSlug]/workspace-client.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const quartzAssistantSource = fs.readFileSync(
    new URL("../src/app/garden/garden-assistant.tsx", import.meta.url),
    "utf8",
  );
  const catchStart = workspaceSource.indexOf("    } catch (error) {", workspaceSource.indexOf("const postLearnAction"));
  const catchEnd = workspaceSource.indexOf("    } finally {", catchStart);
  const learnActionCatch = workspaceSource.slice(catchStart, catchEnd);

  assert.ok(catchStart >= 0 && catchEnd > catchStart);
  assert.doesNotMatch(workspaceSource, /LearnErrorDialog/);
  assert.doesNotMatch(quartzAssistantSource, /LearnErrorDialog|learn-error-dismissal/);
  assert.match(
    workspaceSource,
    /status === "failed" && job\?\.error[\s\S]*?displayLearnError\(job\.error\)/,
  );
  assert.match(
    learnActionCatch,
    /if \(isCancel \|\| endpoint === "clear"\) \{[\s\S]*?addToast\(message\)/,
  );
  assert.doesNotMatch(learnActionCatch, /else[\s\S]*?addToast\(message\)/);
});

test("completed Learn panel exposes scoped repair beside Skip review", () => {
  const workspaceSource = fs.readFileSync(
    new URL(
      "../src/app/gardens/[clusterSlug]/workspace-client.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const skipReviewIndex = workspaceSource.indexOf("Skip review");
  const repairIndex = workspaceSource.indexOf(
    '{status === "complete" && (',
    skipReviewIndex,
  );
  const primaryActionIndex = workspaceSource.indexOf(
    "{showPrimaryAction && (",
    skipReviewIndex,
  );
  const completedFooterIndex = workspaceSource.indexOf(
    '{panelExpanded && status === "complete" && (',
  );
  const completedFooter = workspaceSource.slice(completedFooterIndex);

  assert.ok(skipReviewIndex >= 0);
  assert.ok(repairIndex > skipReviewIndex);
  assert.ok(primaryActionIndex > repairIndex);
  assert.match(
    workspaceSource.slice(repairIndex, primaryActionIndex),
    /onClick=\{handleRepairIssues\}[\s\S]*?bg-white[\s\S]*?text-gray-950[\s\S]*?M12 6\.75v10\.5[\s\S]*?"Repair issues"/,
  );
  assert.match(workspaceSource.slice(repairIndex, primaryActionIndex), /Rebuild entire garden/);
  assert.match(completedFooter, /Open lessons/);
  assert.doesNotMatch(completedFooter, /onClick=\{handleRepairIssues\}/);
});

test("cancelled Learn jobs recover according to the current garden state", () => {
  const workspaceSource = fs.readFileSync(
    new URL(
      "../src/app/gardens/[clusterSlug]/workspace-client.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(
    workspaceSource,
    /showPrimaryAction =[\s\S]*?status === "failed"[\s\S]*?status === "cancelled"/,
  );
  const primaryStart = workspaceSource.indexOf("async function handleLearnPrimary()");
  const primaryEnd = workspaceSource.indexOf("async function handleConfirmAndGenerate()", primaryStart);
  const primaryHandler = workspaceSource.slice(primaryStart, primaryEnd);
  const repairIndex = primaryHandler.indexOf('postLearnAction("regenerate", { mode: "repair" })');
  const generateIndex = primaryHandler.indexOf('postLearnAction("generate"');
  const planIndex = primaryHandler.indexOf('postLearnAction("plan")');

  assert.ok(primaryStart >= 0 && primaryEnd > primaryStart);
  assert.ok(repairIndex >= 0, "existing learner content must recover through repair");
  assert.ok(generateIndex > repairIndex, "a map-only garden may generate its first pages");
  assert.ok(planIndex > generateIndex, "only an empty garden may start planning");
  assert.match(
    workspaceSource,
    /async function handleGenerateAfterCancellation\(\)[\s\S]*?await handleLearnPrimary\(\)/,
  );
  assert.match(workspaceSource, /status === "cancelled"[\s\S]*?"Repair issues"[\s\S]*?"Generate"/);
  assert.match(
    workspaceSource,
    /hasExistingLearnContent &&[\s\S]*?status === "complete"[\s\S]*?status === "failed"[\s\S]*?status === "cancelled"[\s\S]*?Rebuild entire garden/,
  );

  const assistantSource = fs.readFileSync(
    new URL("../src/app/garden/garden-assistant.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    assistantSource,
    /const hasExistingLearnContent = Boolean\([\s\S]*?latestTextbookVersionId[\s\S]*?hasTextbook[\s\S]*?const endpoint = hasExistingLearnContent[\s\S]*?'regenerate'[\s\S]*?confirmedLearningMapId[\s\S]*?'generate'[\s\S]*?'plan'/,
  );
});
