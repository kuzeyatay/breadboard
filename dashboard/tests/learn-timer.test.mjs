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

test("failed Learn jobs expose a regenerate action", () => {
  const workspaceSource = fs.readFileSync(
    new URL(
      "../src/app/gardens/[clusterSlug]/workspace-client.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(
    workspaceSource,
    /showPrimaryAction =[\s\S]*?status === "failed" \|\| status === "cancelled"/,
  );
  assert.match(
    workspaceSource,
    /async function handleRegenerateLessons\(\)[\s\S]*?postLearnAction\("regenerate"\)/,
  );
  assert.match(workspaceSource, /status === "failed"[\s\S]*?"Regenerate"/);
  assert.match(workspaceSource, /endpoint === "regenerate" && data\.planning/);
});

test("Learn failures stay in the panel without opening a dialog or toast", () => {
  const workspaceSource = fs.readFileSync(
    new URL(
      "../src/app/gardens/[clusterSlug]/workspace-client.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const catchStart = workspaceSource.indexOf("    } catch (error) {", workspaceSource.indexOf("const postLearnAction"));
  const catchEnd = workspaceSource.indexOf("    } finally {", catchStart);
  const learnActionCatch = workspaceSource.slice(catchStart, catchEnd);

  assert.ok(catchStart >= 0 && catchEnd > catchStart);
  assert.doesNotMatch(workspaceSource, /LearnErrorDialog/);
  assert.match(workspaceSource, /status === "failed" && job\?\.error[\s\S]*?\{job\.error\}/);
  assert.match(learnActionCatch, /if \(isCancel\) \{[\s\S]*?addToast\(message\)/);
  assert.doesNotMatch(learnActionCatch, /else[\s\S]*?addToast\(message\)/);
});

test("completed Learn panel exposes a black regenerate action beside Skip review", () => {
  const workspaceSource = fs.readFileSync(
    new URL(
      "../src/app/gardens/[clusterSlug]/workspace-client.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const skipReviewIndex = workspaceSource.indexOf("Skip review");
  const regenerateIndex = workspaceSource.indexOf(
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
  assert.ok(regenerateIndex > skipReviewIndex);
  assert.ok(primaryActionIndex > regenerateIndex);
  assert.match(
    workspaceSource.slice(regenerateIndex, primaryActionIndex),
    /onClick=\{handleRegenerateLessons\}[\s\S]*?bg-white[\s\S]*?text-gray-950[\s\S]*?M12 6\.75v10\.5[\s\S]*?"Regenerate"/,
  );
  assert.match(completedFooter, /Open lessons/);
  assert.doesNotMatch(completedFooter, /onClick=\{handleRegenerateLessons\}/);
});

test("cancelled Learn jobs expose a fresh generate action", () => {
  const workspaceSource = fs.readFileSync(
    new URL(
      "../src/app/gardens/[clusterSlug]/workspace-client.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(
    workspaceSource,
    /showPrimaryAction =[\s\S]*?status === "failed" \|\| status === "cancelled"/,
  );
  assert.match(
    workspaceSource,
    /async function handleGenerateAfterCancellation\(\)[\s\S]*?postLearnAction\("plan"\)/,
  );
  assert.match(workspaceSource, /status === "cancelled"[\s\S]*?"Generate"/);
});
