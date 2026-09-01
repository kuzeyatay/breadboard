import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const dashboardRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const source = (relative) =>
  fs.readFileSync(path.join(dashboardRoot, relative), "utf8");

const workspace = source("src/app/gardens/[clusterSlug]/workspace-client.tsx");
const learn = source("src/lib/learn.ts");
const postBuild = source("src/lib/learn-humanizer.ts");
const switchRoute = source(
  "src/app/api/gardens/[gardenId]/learn/humanizer/route.ts",
);
const tokenRowStart = workspace.indexOf('aria-label="Learn token usage"');
const tokenRow = workspace.slice(
  tokenRowStart,
  workspace.indexOf("{panelExpanded &&", tokenRowStart),
);
const statusBarStart = workspace.indexOf('aria-label="Learn status"');
const statusBar = workspace.slice(statusBarStart, tokenRowStart);

test("the Learn panel puts Rewrite naturally at the far right of the token row", () => {
  assert.doesNotMatch(workspace, /aria-label="Close Learn panel"/);
  assert.match(workspace, /useHumanizerMode\(\)/);
  assert.match(
    workspace,
    /const learnPanelAvailable = Boolean\([\s\S]{0,120}hasExistingLearnContent/,
  );
  assert.match(workspace, /disabled={!learnPanelAvailable}/);
  assert.match(tokenRow, /role="switch"[\s\S]*Rewrite naturally/);
  assert.match(tokenRow, /className="ml-auto flex shrink-0/);
  assert.ok(tokenRow.indexOf("Rewrite naturally") > tokenRow.indexOf("formatAssistantModelName"));
});

test("a completed Learn shows Humanize work in its status bar", () => {
  assert.ok(statusBarStart >= 0, "Learn status bar should be rendered");
  assert.match(statusBar, /learnStatusBarActive/);
  assert.match(statusBar, /learnStatusBarActive \? "learn-progress-pulse"/);
  assert.match(workspace, /Humanizing completed lessons/);
  assert.match(workspace, /Restoring the original AI lesson copy/);
  assert.match(statusBar, /learnHumanizerStatusMessage/);
  assert.match(statusBar, /aria-live="polite"/);
});

test("Learn humanization is a validated post-build pass, never a page-generation step", () => {
  const criticFinished = learn.indexOf("const humanizerRun = await humanizeFinishedLearnBuild");
  const publishStarts = learn.indexOf("mergeLearnEventLedgers(repositoryGardenDir, clusterDir)");
  assert.ok(criticFinished > learn.indexOf("learn_critic_loop_completed"));
  assert.ok(criticFinished < publishStarts);
  assert.match(learn, /validate: \(\) => \{[\s\S]{0,500}verifyFinalArtifactNoMutation/);
  assert.match(postBuild, /path\.join\(gardenDir, "learning"\)/);
  assert.match(postBuild, /restoreOriginals\(originals\)/);
  assert.match(postBuild, /storedTextHumanizerForUser/);
  assert.doesNotMatch(postBuild, /\.breadboard[\\/]planning|sources[\\/]/);
});

test("publication refreshes final validation after critic and humanizer work", () => {
  const humanizerFinished = learn.indexOf("const humanizerRun = await humanizeFinishedLearnBuild");
  const publishStarts = learn.indexOf("mergeLearnEventLedgers(repositoryGardenDir, clusterDir)");
  const prePublication = learn.slice(humanizerFinished, publishStarts);

  assert.match(
    prePublication,
    /const prePublicationFinalizeReport = finalizeGardenExport\([\s\S]*?preserveModelAuthoredContent: true/,
  );
  assert.match(
    prePublication,
    /const prePublicationVerification = verifyFinalArtifactNoMutation\([\s\S]*?updateRepairReport: false/,
  );
  assert.match(
    learn.slice(publishStarts),
    /verifyManifest:[\s\S]*?updateRepairReport: false/,
  );
});

test("a finished Learn version follows later Rewrite naturally changes", () => {
  assert.match(
    workspace,
    /\/learn\/humanizer[\s\S]{0,500}expectedVersionId: versionId/,
  );
  assert.match(workspace, /Switched lessons back to the AI copy/);
  assert.match(workspace, /learnState\?\.humanizer\?\.status === "running"/);
  assert.match(switchRoute, /executeLearnOperationForRoute/);
  assert.match(
    switchRoute,
    /operation: "humanizer"[\s\S]*?enabled,[\s\S]*?expectedVersionId,/,
  );
  assert.match(
    switchRoute,
    /if \(execution\.accepted\) \{[\s\S]*?accepted: true,[\s\S]*?\{ status: 202 \}/,
  );
  assert.doesNotMatch(switchRoute, /switchFinishedLearnHumanizer|handOffLearnTask/);
  assert.match(postBuild, /\.breadboard\/humanizer/);
  assert.match(postBuild, /restoreLearnAiCopy/);
  assert.match(postBuild, /activeCopy: "ai"/);
});
