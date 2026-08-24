import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

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

function extractedCanonicalizer() {
  const functionSource = sourceBetween(
    runnerSource,
    "function quartzCanonicalSlugFromRelPath",
    "function publicLearningVersionId",
  ).trim();
  const expression = functionSource.replace(/}\s*$/, "}");
  return Function(`"use strict"; return (${expression});`)();
}

test("Learn UI verification mirrors Quartz canonical file-path slugs", () => {
  const canonicalize = extractedCanonicalizer();
  assert.equal(
    canonicalize(
      "learning/1. Epidemic Feedback/1.1 Contact Reduction and Feedback Threshold.md",
    ),
    "learning/1.-Epidemic-Feedback/1.1-Contact-Reduction-and-Feedback-Threshold",
  );
  assert.equal(
    canonicalize("cool/what about r&d?.md"),
    "cool/what-about-r-and-d",
  );
  assert.equal(
    canonicalize("100% Results/_index.md"),
    "100-percent-Results/index",
  );
});

test("completion navigation is bound to exact canonical inventory paths", () => {
  const inventoryContract = sourceBetween(
    runnerSource,
    "function assertExactLessonInventory",
    "function quartzArtifactUrl",
  );
  assert.match(
    inventoryContract,
    /expectedApiSlug = path\.posix\.basename\(actual\.relPath\)\.replace\(\/\\\.md\$\/i, ""\)/,
  );
  assert.match(
    inventoryContract,
    /canonicalSlug = quartzCanonicalSlugFromRelPath\(actual\.relPath\)/,
  );
  assert.match(
    inventoryContract,
    /fullCanonicalSlug = quartzCanonicalSlugFromRelPath\(\s*`\$\{gardenId\}\/\$\{actual\.relPath\}`/,
  );
  assert.match(inventoryContract, /inventoryByRelPath\.has\(actual\.relPath\)/);
  assert.match(inventoryContract, /relativeCanonicalSlugs\.has\(canonicalSlug\)/);

  const completion = sourceBetween(
    runnerSource,
    "if (shouldVerifyComplete)",
    "if (shouldDiagnoseSelection)",
  );
  assert.match(
    completion,
    /quartzArtifactUrl\(\s*quartzRootSource,\s*lesson\.fullCanonicalSlug/,
  );
  assert.match(
    completion,
    /\?note=\$\{encodeURIComponent\(lesson\.canonicalSlug\)\}/,
  );
  assert.match(completion, /finalHttpPath !== lesson\.fullCanonicalSlug/);
  assert.match(completion, /finalPath !== lesson\.fullCanonicalSlug/);
  assert.match(completion, /dataSlug !== lesson\.fullCanonicalSlug/);
  assert.doesNotMatch(completion, /noteSlug = lesson\.relPath/);
  assert.doesNotMatch(
    completion,
    /quartzArtifactUrl\(quartzRootSource, lesson\.relPath\)/,
  );
});

test("completion renders every exact lesson through the dashboard Quartz route", () => {
  const completion = sourceBetween(
    runnerSource,
    "if (shouldVerifyComplete)",
    "if (shouldDiagnoseSelection)",
  );
  assert.match(
    completion,
    /for \(const \[artifactIndex, lesson\] of lessonArtifacts\.entries\(\)\)/,
  );
  assert.match(
    completion,
    /renderedArtifacts\.length !== lessonArtifacts\.length/,
  );
  assert.match(completion, /everyLessonRendered: true/);
  assert.doesNotMatch(completion, /sampleIndexes|sampleIndex|Math\.floor/);
  assert.match(completion, /page\.goto\(artifactUiUrl, \{ waitUntil: "domcontentloaded" \}\)/);
  assert.match(completion, /finalPath !== lesson\.fullCanonicalSlug/);
  assert.match(completion, /dataSlug !== lesson\.fullCanonicalSlug/);
  assert.match(completion, /renderedTitle !== lesson\.title/);
  assert.match(completion, /articleText\.length < 200/);
});

test("proposal subsections validate their direct number, title, and badge separately", () => {
  const proposalAudit = sourceBetween(
    runnerSource,
    "async function auditConfirmationUi",
    "await page.goto(gardenWorkspaceUrl",
  );
  assert.match(proposalAudit, /renderedSubsection\.locator\(":scope > span"\)/);
  assert.match(
    proposalAudit,
    /directSpans\.first\(\)\.innerText\(\)/,
  );
  assert.match(
    proposalAudit,
    /Array\.from\(element\.childNodes\)[\s\S]*?node\.nodeType === Node\.TEXT_NODE/,
  );
  assert.match(
    proposalAudit,
    /renderedSubsection\.locator\(":scope > span\.text-cyan-500"\)/,
  );
  assert.match(
    proposalAudit,
    /expectedBadge = `\$\{visualCount\} visual\$\{visualCount === 1 \? "" : "s"\}`/,
  );
  assert.doesNotMatch(
    proposalAudit,
    /renderedSubsections\.nth\(subsectionIndex\)\.innerText\(\)/,
  );
});

test("generation retry requires an explicit failed job, map, and model contract", () => {
  const modeSetup = sourceBetween(
    runnerSource,
    "const shouldStatusOnly",
    "if (shouldStatusOnly)",
  );
  assert.match(
    modeSetup,
    /shouldRetryGenerationOnce = process\.argv\.includes\("--retry-generation-once"\)/,
  );
  assert.match(modeSetup, /!expectedJobId \|\| !expectedMapId \|\| !expectedModelArgument/);
  assert.match(
    modeSetup,
    /--retry-generation-once requires --expected-job-id, --expected-map-id, and --expected-model/,
  );

  const failedAudit = sourceBetween(
    runnerSource,
    "function assertExpectedFailedGeneration",
    "function assertExpectedRetriedGeneration",
  );
  assert.match(failedAudit, /status\?\.job\?\.status !== "failed"/);
  assert.match(failedAudit, /status\?\.job\?\.mode !== "generate"/);
  assert.match(failedAudit, /status\?\.job\?\.model !== expectedModelValue/);
  assert.match(failedAudit, /status\?\.job\?\.requiresReplan !== false/);
  assert.match(failedAudit, /status\?\.job\?\.confirmedLearningMapId !== expectedMapId/);
  assert.match(failedAudit, /status\?\.confirmedLearningMapId !== expectedMapId/);
  assert.match(
    failedAudit,
    /sameOrderedStrings\(status\?\.job\?\.sourceIds, expectedTeachingSourceIds\)/,
  );
  assert.match(
    failedAudit,
    /sameOrderedStrings\(status\?\.selectedSourceIds, expectedTeachingSourceIds\)/,
  );
  assert.match(failedAudit, /status\?\.job\?\.syllabusSourceId !== expectedSyllabusSourceId/);
  assert.match(failedAudit, /status\?\.job\?\.sourceOnly !== true/);
  assert.match(failedAudit, /status\?\.job\?\.includeSourceSnapshots !== false/);
  assert.match(failedAudit, /status\?\.latestTextbookVersionId !== undefined/);
  assert.doesNotMatch(
    failedAudit,
    /status\?\.job\?\.latestTextbookVersionId !== undefined/,
  );
  assert.match(failedAudit, /job-local field is provisional/);
  assert.match(failedAudit, /status\?\.hasTextbook !== false/);
});

test("generation retry permits one exact UI generate request and no fallback action", () => {
  const retry = sourceBetween(
    runnerSource,
    "if (shouldRetryGenerationOnce)",
    "if (shouldAuditConfirmation)",
  );
  assert.match(
    retry,
    /getByRole\("button", \{\s*name: "Retry Learn",\s*exact: true/,
  );
  assert.match(retry, /retryButtonCount !== 1/);
  assert.match(retry, /retryButton\.isEnabled\(\)/);
  assert.match(retry, /if \(!\(await learnPanel\.isVisible\(\)\)\)/);
  assert.match(retry, /await openLearnPanel\(\)/);
  assert.match(retry, /the job changed during UI reload/);
  assert.match(retry, /the UI reload issued Learn action POSTs/);
  assert.equal(
    [...retry.matchAll(/retryButton\.click\(\{ clickCount: 1 \}\)/g)].length,
    1,
  );
  assert.ok(
    retry.includes('`/api/gardens/${gardenId}/learn/[^/?]+(?:\\\\?.*)?$`'),
  );
  assert.match(retry, /requestPath !== generatePath/);
  assert.match(retry, /Blocked unexpected Learn action POST during retry/);
  assert.match(retry, /retryGeneratePostCount > 1/);
  assert.match(retry, /route\.abort\("blockedbyclient"\)/);
  assert.match(retry, /Object\.keys\(body\)\.sort\(\)/);
  for (const key of [
    "confirmedLearningMapId",
    "expectedModel",
    "includeSourceSnapshots",
    "includedSourceIds",
    "skipManualReview",
    "sourceOnly",
    "syllabusSourceId",
  ]) {
    assert.match(retry, new RegExp(`"${key}"`));
  }
  assert.match(retry, /body\.expectedModel !== expectedModelArgument/);
  assert.match(retry, /body\.confirmedLearningMapId !== expectedMapId/);
  assert.match(
    retry,
    /sameOrderedStrings\(body\.includedSourceIds, expectedTeachingSourceIds\)/,
  );
  assert.match(retry, /body\.syllabusSourceId !== expectedSyllabusSourceId/);
  assert.match(retry, /body\.sourceOnly !== true/);
  assert.match(retry, /body\.includeSourceSnapshots !== false/);
  assert.match(retry, /body\.skipManualReview !== false/);
  assert.doesNotMatch(retry, /postLearnAction\("plan"/);
});

test("generation retry accepts only a distinct durable 202 job with exact provenance", () => {
  const retry = sourceBetween(
    runnerSource,
    "if (shouldRetryGenerationOnce)",
    "if (shouldAuditConfirmation)",
  );
  assert.match(retry, /retryResponse\.status\(\) !== 202/);
  assert.match(retry, /retryData\?\.success !== true/);
  assert.match(retry, /retryData\?\.accepted !== true/);
  assert.match(retry, /generationJobId === expectedJobId/);
  assert.match(retry, /data\?\.job\?\.id === generationJobId/);
  assert.match(retry, /data\.job\.id !== expectedJobId/);
  assert.match(retry, /\["failed", "cancelled"\]\.includes\(generationStatus\.job\.status\)/);
  assert.match(
    retry,
    /assertExpectedRetriedGeneration\(\s*generationStatus,\s*generationJobId,\s*expectedMapId,\s*expectedModelArgument/,
  );
  assert.match(retry, /retryGeneratePostCount !== 1 \|\| !capturedRetryBody/);
  assert.match(retry, /await browser\.close\(\)\.catch\(\(\) => \{\}\)/);
  assert.match(retry, /finally \{\s*if \(browser\.isConnected\(\)\)/);

  const durableAudit = sourceBetween(
    runnerSource,
    "function assertExpectedRetriedGeneration",
    "function normalizedLessonInventory",
  );
  assert.match(durableAudit, /status\?\.job\?\.model !== expectedModelValue/);
  assert.match(durableAudit, /status\?\.job\?\.confirmedLearningMapId !== expectedMapId/);
  assert.match(durableAudit, /status\?\.confirmedLearningMapId !== expectedMapId/);
  assert.match(durableAudit, /status\?\.job\?\.sourceOnly !== true/);
  assert.match(durableAudit, /status\?\.job\?\.includeSourceSnapshots !== false/);
  assert.match(durableAudit, /status\?\.syllabusCoverage/);
});
