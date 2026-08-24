import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const dashboardRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const workspaceSource = fs.readFileSync(
  path.join(
    dashboardRoot,
    "src",
    "app",
    "gardens",
    "[clusterSlug]",
    "workspace-client.tsx",
  ),
  "utf8",
);

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `expected ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `expected ${endMarker} after ${startMarker}`);
  return source.slice(start, end);
}

test("cancelled planning without a proposal restarts planning before any historical map", () => {
  const jobInfo = sourceBetween(
    workspaceSource,
    "interface LearnJobInfo",
    "interface LearnValidationReportInfo",
  );
  assert.match(jobInfo, /mode: [^;]*"plan"[^;]*;/);

  const recoveryState = sourceBetween(
    workspaceSource,
    "const hasExistingLearnContent",
    "async function handleCancelLearn()",
  );
  assert.match(
    recoveryState,
    /learnState\?\.job\?\.status === "cancelled"[\s\S]*?learnState\.job\.mode === "plan"[\s\S]*?!learnState\.job\.proposedLearningMapId\?\.trim\(\)[\s\S]*?!hasExistingLearnContent/,
  );

  const primaryHandler = sourceBetween(
    workspaceSource,
    "async function handleLearnPrimary()",
    "async function handleConfirmAndGenerate()",
  );
  const restartBranch = primaryHandler.indexOf(
    "if (shouldRestartCancelledPlanning)",
  );
  const historicalMapBranch = primaryHandler.indexOf(
    "if (learnState?.confirmedLearningMapId)",
  );
  assert.ok(restartBranch >= 0, "expected cancelled-planning recovery branch");
  assert.ok(
    historicalMapBranch > restartBranch,
    "planning recovery must run before an older confirmed map is considered",
  );
  assert.match(
    primaryHandler.slice(restartBranch, historicalMapBranch),
    /postLearnAction\("plan"\)[\s\S]*?return;/,
  );

  const cancelledClickHandler = sourceBetween(
    workspaceSource,
    "async function handleGenerateAfterCancellation()",
    "const autoConfirmLearnJobId",
  );
  assert.match(cancelledClickHandler, /await handleLearnPrimary\(\)/);

  assert.match(workspaceSource, /\? "Planning\.\.\."/);
  assert.match(workspaceSource, /\? "Restart planning"/);
});
