import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  cumulativeLearnWorkflowElapsedMs,
  currentLearnElapsedMs,
  currentLearnWorkflowAttempts,
  formatLearnElapsedTime,
  transitionLearnTimer,
} from "../src/lib/learn-timer.ts";

test("Learn timer accumulates retries on one confirmed map until publication", () => {
  const attempts = [
    { id: "first", status: "failed", elapsedMs: 9 * 60 * 60 * 1000, createdAt: "2026-07-14T00:00:00.000Z" },
    { id: "second", status: "failed", elapsedMs: 3 * 60 * 60 * 1000, createdAt: "2026-07-14T09:10:00.000Z" },
    { id: "current", status: "generating_textbook", elapsedMs: 15 * 60 * 1000, createdAt: "2026-07-14T12:20:00.000Z" },
  ];

  assert.equal(
    cumulativeLearnWorkflowElapsedMs(attempts, "current"),
    12 * 60 * 60 * 1000 + 15 * 60 * 1000,
  );
});

test("a completed publication closes the cumulative Learn timer chain", () => {
  const attempts = [
    { id: "failed", status: "failed", elapsedMs: 60_000, createdAt: "2026-07-14T00:00:00.000Z" },
    { id: "published", status: "complete", elapsedMs: 120_000, createdAt: "2026-07-14T00:02:00.000Z" },
    { id: "new-run", status: "generating_textbook", elapsedMs: 30_000, createdAt: "2026-07-14T00:05:00.000Z" },
  ];

  assert.equal(cumulativeLearnWorkflowElapsedMs(attempts, "published"), 180_000);
  assert.equal(cumulativeLearnWorkflowElapsedMs(attempts, "new-run"), 30_000);
  assert.deepEqual(
    currentLearnWorkflowAttempts(attempts, "new-run").map((attempt) => attempt.id),
    ["new-run"],
  );
});

test("time and token projections select the same complete retry chain", () => {
  const attempts = [
    { id: "map-owner", status: "failed", elapsedMs: 10, createdAt: "2026-07-14T00:00:00.000Z" },
    { id: "retry-one", status: "failed", elapsedMs: 20, createdAt: "2026-07-14T00:01:00.000Z" },
    { id: "retry-two", status: "generating_textbook", elapsedMs: 30, createdAt: "2026-07-14T00:02:00.000Z" },
  ];

  assert.deepEqual(
    currentLearnWorkflowAttempts(attempts, "retry-two").map((attempt) => attempt.id),
    ["map-owner", "retry-one", "retry-two"],
  );
  assert.equal(cumulativeLearnWorkflowElapsedMs(attempts, "retry-two"), 60);
});

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
  const projectionSource = fs.readFileSync(
    new URL("../src/lib/learn-status-projection.ts", import.meta.url),
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
  assert.match(projectionSource, /function learnTimerForWorkflow/);
  assert.match(projectionSource, /cumulativeLearnWorkflowElapsedMs/);
  assert.match(
    projectionSource,
    /function learnTokenUsageForWorkflow[\s\S]*?learnWorkflowAttempts\(job\)[\s\S]*?attempts\.map\(\(attempt\) => attempt\.id\)/,
  );
  assert.match(
    projectionSource,
    /confirmed_learning_map_id\s*=\s*\?\s+OR\s+proposed_learning_map_id\s*=\s*\?/,
  );
  assert.match(
    projectionSource,
    /const workflowTimer = visibleJob \? learnTimerForWorkflow\(visibleJob\) : null/,
  );
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
    /autoConfirmLearnJobStatus !== "awaiting_confirmation"[\s\S]*?!autoConfirmLearningMapId[\s\S]*?!autoConfirmLearnModel[\s\S]*?postLearnAction\("confirm",\s*\{\s*learningMapId: autoConfirmLearningMapId,\s*expectedModel: autoConfirmLearnModel,\s*generate: true,/,
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
  const chatScrollerIndex = workspaceSource.search(
    /<main\s+ref=\{transcriptScrollRef\}\s+className="[^"]*\boverflow-y-auto\b[^"]*"\s*>/,
  );
  const transcriptIndex = workspaceSource.indexOf("<ChatTranscript", chatScrollerIndex);

  assert.ok(panelIndex >= 0, "Learn panel should be rendered");
  assert.ok(chatScrollerIndex > panelIndex, "Learn panel should precede the chat scroller");
  assert.ok(transcriptIndex > chatScrollerIndex, "chat transcript should remain inside its scroller");
  assert.match(workspaceSource, /max-h-\[55vh\][\s\S]*?shrink-0 overflow-y-auto/);
});

test("navbar Learn button owns the collapsed loading indicator", () => {
  const workspaceSource = fs.readFileSync(
    new URL(
      "../src/app/gardens/[clusterSlug]/workspace-client.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(workspaceSource, /learnPanelOpen \? "Close Learn panel" : "Open Learn panel"/);
  assert.match(
    workspaceSource,
    /learnBusy \|\|[\s\S]*?learnCancelBusy \|\|[\s\S]*?isLearnActive\(learnState\?\.job\?\.status\)[\s\S]*?<Spinner className="h-3\.5 w-3\.5"/,
  );
  assert.match(workspaceSource, /Learn is running\. Open Learn panel/);
  assert.doesNotMatch(workspaceSource, /function renderCollapsedLearnIndicator/);
  assert.doesNotMatch(workspaceSource, /renderCollapsedLearnIndicator\(\)/);
});

test("Learn has no detached or post-completion loading circle", () => {
  const workspaceSource = fs.readFileSync(
    new URL(
      "../src/app/gardens/[clusterSlug]/workspace-client.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.doesNotMatch(workspaceSource, /LEARN_SETTLED_INDICATOR_VISIBLE_MS/);
  assert.doesNotMatch(workspaceSource, /showSettledLearnIndicator/);
  assert.doesNotMatch(workspaceSource, /setShowSettledLearnIndicator/);
});

test("failed Learn jobs restart rolled-back planning but preserve generation retry", () => {
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
    /shouldRepairFailedJob =\s*status === "failed" &&\s*hasExistingLearnContent &&\s*job\?\.mode !== "update_sources"/,
  );
  assert.match(
    workspaceSource,
    /async function handleRepairIssues\(\)[\s\S]*?postLearnAction\("regenerate", \{ mode: "repair" \}\)/,
  );
  assert.match(workspaceSource, /status === "failed"[\s\S]*?"Retry Learn"/);
  assert.match(
    workspaceSource,
    /const shouldRestartFailedPlanning =[\s\S]*?status === "failed"[\s\S]*?!hasExistingLearnContent[\s\S]*?job\.mode === "plan"[\s\S]*?!learnState\.job\.proposedLearningMapId\?\.trim\(\)[\s\S]*?\|\|[\s\S]*?learnState\.job\.requiresReplan === true/,
  );
  const primaryStart = workspaceSource.indexOf("async function handleLearnPrimary()");
  const primaryEnd = workspaceSource.indexOf(
    "async function handleConfirmAndGenerate()",
    primaryStart,
  );
  const primaryHandler = workspaceSource.slice(primaryStart, primaryEnd);
  const failedPlanningBranchIndex = primaryHandler.indexOf(
    "if (shouldRestartFailedPlanning)",
  );
  const failedPlanningPlanIndex = primaryHandler.indexOf(
    'postLearnAction("plan")',
    failedPlanningBranchIndex,
  );
  const generationRetryIndex = primaryHandler.indexOf(
    'postLearnAction("generate"',
    failedPlanningBranchIndex,
  );

  assert.ok(primaryStart >= 0 && primaryEnd > primaryStart);
  assert.ok(failedPlanningBranchIndex >= 0, "failed planning needs an explicit recovery branch");
  assert.ok(
    failedPlanningPlanIndex > failedPlanningBranchIndex,
    "a rolled-back failed plan must restart planning",
  );
  assert.ok(
    generationRetryIndex > failedPlanningPlanIndex,
    "historical confirmed maps must be considered only after failed-planning recovery",
  );
  assert.match(
    primaryHandler,
    /if \(shouldRestartFailedPlanning\)[\s\S]*?postLearnAction\("plan"\)[\s\S]*?return;[\s\S]*?if \(learnState\?\.confirmedLearningMapId\)[\s\S]*?postLearnAction\("generate"/,
  );
  assert.match(
    workspaceSource,
    /status === "failed"[\s\S]*?shouldRestartFailedPlanning[\s\S]*?"Planning\.\.\."[\s\S]*?"Retrying\.\.\."[\s\S]*?shouldRestartFailedPlanning[\s\S]*?"Restart planning"[\s\S]*?"Retry Learn"/,
  );
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
    /showFailedState && job\?\.error[\s\S]*?displayLearnError\(job\.error\)/,
  );
  assert.match(
    learnActionCatch,
    // Cancel, Pause/Resume, and Clear are direct user commands whose refusals
    // must be spoken. A start the server refuses outright creates no job, so
    // the panel has nothing to show and it must be spoken too — that silence is
    // what made a rejected Learn run look like a dead button. A generation that
    // ran and failed does leave a failed job, and stays in the panel instead.
    /if \([\s\S]*?isCancel \|\|[\s\S]*?isPauseAction \|\|[\s\S]*?endpoint === "clear" \|\|[\s\S]*?refreshed\?\.job\?\.status !== "failed"[\s\S]*?\) \{[\s\S]*?addToast\(message\)/,
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
    "{showPrimaryAction && !active && (",
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
    /shouldAddNewLearnMaterial \|\| hasLearnUserInstruction[\s\S]*?handleLearnPrimary[\s\S]*?handleRepairIssues[\s\S]*?bg-white[\s\S]*?text-gray-950[\s\S]*?"Add new material"[\s\S]*?"Repair issues"/,
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
  const cancelledPlanningIndex = primaryHandler.indexOf("if (shouldRestartCancelledPlanning)");
  const failedPlanningIndex = primaryHandler.indexOf("if (shouldRestartFailedPlanning)");
  const staleBindingIndex = primaryHandler.lastIndexOf("if (shouldReplanStaleMapBinding)");
  const replanIndex = primaryHandler.indexOf('postLearnAction("plan")', cancelledPlanningIndex);
  const generateIndex = primaryHandler.indexOf(
    'postLearnAction("generate"',
    staleBindingIndex,
  );
  const initialPlanIndex = primaryHandler.lastIndexOf('postLearnAction("plan")');

  assert.ok(primaryStart >= 0 && primaryEnd > primaryStart);
  assert.ok(repairIndex >= 0, "existing learner content must recover through repair");
  assert.ok(cancelledPlanningIndex > repairIndex, "cancelled planning follows existing-content repair");
  assert.ok(failedPlanningIndex > cancelledPlanningIndex, "failed planning keeps its explicit recovery");
  assert.ok(staleBindingIndex > failedPlanningIndex, "stale bindings replan after specific recovery branches");
  assert.ok(replanIndex > cancelledPlanningIndex, "a cancelled plan must start fresh planning");
  assert.ok(generateIndex > staleBindingIndex, "a usable map-only garden may generate its first pages");
  assert.ok(initialPlanIndex > generateIndex, "an empty garden may start initial planning");
  assert.match(
    primaryHandler,
    /if \(shouldRestartCancelledPlanning\)[\s\S]*?postLearnAction\("plan"\)[\s\S]*?if \(shouldRestartFailedPlanning\)[\s\S]*?postLearnAction\("plan"\)/,
  );
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
    /const hasExistingLearnContent = Boolean\([\s\S]*?latestTextbookVersionId[\s\S]*?hasTextbook[\s\S]*?const endpoint = hasExistingLearnContent[\s\S]*?'regenerate'[\s\S]*?requiresReplan[\s\S]*?'plan'[\s\S]*?confirmedLearningMapId[\s\S]*?'generate'[\s\S]*?'plan'/,
  );
});
