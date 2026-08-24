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
const assistantSource = fs.readFileSync(
  new URL("../src/app/garden/garden-assistant.tsx", import.meta.url),
  "utf8",
);
const runnerSource = fs.readFileSync(
  new URL("../../tmp-learn-ui-inspect.mjs", import.meta.url),
  "utf8",
);

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `expected ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `expected ${endMarker} after ${startMarker}`);
  return source.slice(start, end);
}

test("workspace replans an authoritative stale map binding before review, confirmation, or generation", () => {
  const recoveryState = sourceBetween(
    workspaceSource,
    "const hasExistingLearnContent",
    "async function handleCancelLearn()",
  );
  assert.match(
    recoveryState,
    /const shouldReplanStaleMapBinding =\s*!hasExistingLearnContent &&\s*learnState\?\.sourceSetChanged === true/,
  );

  const primary = sourceBetween(
    workspaceSource,
    "async function handleLearnPrimary()",
    "async function handleConfirmAndGenerate()",
  );
  const awaitingReview = sourceBetween(
    primary,
    'if (learnState?.job?.status === "awaiting_confirmation")',
    "// Existing learner content always recovers",
  );
  const awaitingRepair = awaitingReview.indexOf("handleRepairIssues()");
  const awaitingReplan = awaitingReview.indexOf(
    "if (shouldReplanStaleMapBinding)",
  );
  const openReview = awaitingReview.indexOf("setLearnPanelOpen(true)");
  assert.ok(awaitingRepair >= 0, "existing content keeps repair precedence");
  assert.ok(awaitingReplan > awaitingRepair);
  assert.ok(
    openReview > awaitingReplan,
    "only a clean awaiting-confirmation proposal may open for review",
  );
  assert.match(
    awaitingReview.slice(awaitingReplan, openReview),
    /postLearnAction\("plan"\)[\s\S]*?return;/,
  );

  const cancelledPlanning = primary.indexOf(
    "if (shouldRestartCancelledPlanning)",
  );
  const failedPlanning = primary.indexOf("if (shouldRestartFailedPlanning)");
  const staleBinding = primary.lastIndexOf(
    "if (shouldReplanStaleMapBinding)",
  );
  const confirmedMap = primary.indexOf(
    "if (learnState?.confirmedLearningMapId)",
  );
  assert.ok(cancelledPlanning >= 0);
  assert.ok(failedPlanning > cancelledPlanning);
  assert.ok(
    staleBinding > failedPlanning,
    "failed and cancelled planning keep their specific recovery branches",
  );
  assert.ok(
    confirmedMap > staleBinding,
    "authoritative stale state must be handled before generation is considered",
  );
  const staleBranch = primary.slice(staleBinding, confirmedMap);
  assert.match(staleBranch, /postLearnAction\("plan"\)[\s\S]*?return;/);
  assert.doesNotMatch(staleBranch, /postLearnAction\("generate"/);

  assert.match(
    workspaceSource,
    /status === "failed"[\s\S]*?shouldRestartFailedPlanning \|\|\s*shouldReplanStaleMapBinding[\s\S]*?"Restart planning"/,
  );
  assert.match(
    workspaceSource,
    /status === "cancelled"[\s\S]*?shouldRestartCancelledPlanning \|\|\s*shouldReplanStaleMapBinding[\s\S]*?"Restart planning"/,
  );
  assert.match(
    workspaceSource,
    /status === "awaiting_confirmation" &&\s*shouldReplanStaleMapBinding[\s\S]*?"Restart planning"/,
  );

  const confirmation = sourceBetween(
    workspaceSource,
    "async function handleConfirmAndGenerate()",
    "async function handleRegenerateLearningMap()",
  );
  const confirmRepair = confirmation.indexOf("handleRepairIssues()");
  const confirmReplan = confirmation.indexOf(
    "if (shouldReplanStaleMapBinding)",
  );
  const proposalIdentity = confirmation.indexOf(
    "const proposedLearningMapId",
  );
  const confirmPost = confirmation.indexOf('postLearnAction("confirm"');
  assert.ok(confirmRepair >= 0);
  assert.ok(confirmReplan > confirmRepair);
  assert.ok(proposalIdentity > confirmReplan);
  assert.ok(confirmPost > proposalIdentity);
  assert.match(
    confirmation.slice(confirmReplan, proposalIdentity),
    /postLearnAction\("plan"\)[\s\S]*?return;/,
  );
  assert.match(
    workspaceSource,
    /proposedMap &&\s*status === "awaiting_confirmation" &&\s*!staleReviewForExistingGarden &&\s*!shouldReplanStaleMapBinding/,
  );
  const autoConfirmation = sourceBetween(
    workspaceSource,
    "const autoConfirmLearnJobId",
    "function handleRetryAssistant",
  );
  assert.match(
    autoConfirmation,
    /hasExistingLearnContent \|\|\s*shouldReplanStaleMapBinding \|\|\s*autoConfirmLearnJobStatus !== "awaiting_confirmation"/,
  );
  assert.match(
    autoConfirmation,
    /postLearnAction\("confirm"[\s\S]*?shouldReplanStaleMapBinding,[\s\S]*?\]\);/,
  );
});

test("assistant preserves repair precedence and replans stale map-only gardens", () => {
  const learnState = sourceBetween(
    assistantSource,
    "interface AssistantLearnState",
    "interface SavedPrompt",
  );
  assert.match(learnState, /sourceSetChanged\?: boolean/);

  const handler = sourceBetween(
    assistantSource,
    "async function handleAssistantLearn()",
    "const chatPanelStyle",
  );
  assert.match(
    handler,
    /const awaitingCleanLearningMapReview =\s*learnState\.job\?\.status === 'awaiting_confirmation' &&\s*!hasExistingLearnContent &&\s*learnState\.sourceSetChanged !== true/,
  );
  assert.match(
    handler,
    /if \(awaitingCleanLearningMapReview\)[\s\S]*?ready for confirmation[\s\S]*?return;/,
  );
  const repair = handler.indexOf("? 'regenerate'");
  const stale = handler.indexOf(
    ": learnState.sourceSetChanged === true",
  );
  const generate = handler.indexOf("? 'generate'");
  assert.ok(repair >= 0, "existing generated content must still use repair");
  assert.ok(stale > repair, "stale map-only recovery follows repair precedence");
  assert.ok(generate > stale, "stale binding must be checked before generation");
  assert.match(
    handler.slice(stale, generate),
    /sourceSetChanged === true[\s\S]*?\? 'plan'/,
  );
});

test("guarded stale-checkpoint runner permits one direct plan and no generation probe", () => {
  const replan = sourceBetween(
    runnerSource,
    "if (shouldReplanStaleCancelledGeneration)",
    "if (shouldRetryGenerationOnce)",
  );
  assert.match(
    replan,
    /getByRole\("button", \{\s*name: "Restart planning",\s*exact: true/,
  );
  assert.match(replan, /guardedPostCount === 1 && pathname\.endsWith\("\/learn\/plan"\)/);
  assert.match(replan, /guardedPostCount !== 1 \|\|\s*learnPosts\.length !== 1/);
  assert.match(replan, /staleGenerationSkipped: true/);
  assert.doesNotMatch(replan, /generateResponsePromise|name: "Generate"/);
});
