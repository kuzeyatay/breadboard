import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { describe } from "node:test";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

import {
  acquireGardenLearnLease,
  acquireGardenLearnLock,
  LOCK_STALE_MS,
  promoteStagingGarden,
  readGardenLearnLock,
  releaseGardenLearnLock,
} from "../src/lib/learn-atomic-promotion.ts";
import {
  learnTimerRunsForStatus,
  transitionLearnTimer,
} from "../src/lib/learn-timer.ts";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const learnPath = path.join(dashboardRoot, "src", "lib", "learn.ts");
const instrumentationPath = path.join(dashboardRoot, "src", "instrumentation-node.ts");
const learnSource = fs.readFileSync(learnPath, "utf8");
const instrumentationSource = fs.readFileSync(instrumentationPath, "utf8");
const learnAst = ts.createSourceFile(
  learnPath,
  learnSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);

function namedFunction(name) {
  const declaration = learnAst.statements.find(
    (statement) =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === name,
  );
  assert.ok(declaration, `expected function ${name} to exist`);
  return declaration;
}

function sourceOf(node) {
  return node.getText(learnAst);
}

function callsNamed(root, name) {
  const calls = [];
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === name
    ) {
      calls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return calls;
}

function variableDeclaration(name) {
  for (const statement of learnAst.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const declaration = statement.declarationList.declarations.find(
      (candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === name,
    );
    if (declaration) return declaration;
  }
  assert.fail(`expected variable ${name} to exist`);
}

function unwrapExpression(expression) {
  let current = expression;
  while (
    current &&
    (ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isParenthesizedExpression(current))
  ) {
    current = current.expression;
  }
  return current;
}

function stringArrayVariable(name) {
  const declaration = variableDeclaration(name);
  const initializer = unwrapExpression(declaration.initializer);
  assert.ok(ts.isArrayLiteralExpression(initializer), `${name} must be an array`);
  return initializer.elements
    .filter((element) => ts.isStringLiteralLike(element))
    .map((element) => element.text);
}

function propertyCallCount(root, receiver, property) {
  let count = 0;
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === receiver &&
      node.expression.name.text === property
    ) {
      count += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return count;
}

describe("Learn rollback and garden isolation contracts", () => {
  test("rollback snapshots only Learn-owned projections and preserves ordinary Markdown", () => {
    const rollbackPaths = stringArrayVariable("LEARN_RUN_ROLLBACK_PATHS");

    assert.ok(rollbackPaths.includes("Learning"));
    assert.ok(rollbackPaths.includes("assets/source-visuals"));
    assert.ok(rollbackPaths.includes(".breadboard/planning"));
    for (const protectedPath of [
      "_index.md",
      "sources",
      "sources/_index.md",
      "notes",
      "README.md",
    ]) {
      assert.equal(
        rollbackPaths.includes(protectedPath),
        false,
        `${protectedPath} must never be rollback-owned`,
      );
    }

    const snapshotSource = sourceOf(namedFunction("createLearnRunSnapshot"));
    assert.match(
      snapshotSource,
      /const snapshotCandidates = \[\.\.\.LEARN_RUN_ROLLBACK_PATHS\]/,
    );
    assert.doesNotMatch(snapshotSource, /readdirSync\(clusterDir|walkMarkdown|\.endsWith\(["']\.md/);

    const rollbackSource = sourceOf(namedFunction("rollbackLearnRun"));
    assert.match(
      rollbackSource,
      /for \(const relPath of LEARN_RUN_ROLLBACK_PATHS\)/,
    );
    assert.doesNotMatch(rollbackSource, /readdirSync\(clusterDir|walkMarkdown/);
  });

  test("every learning-map ID lookup is scoped by garden_id", () => {
    const lookupSource = sourceOf(namedFunction("getLearnMapById"));
    assert.match(
      lookupSource,
      /WHERE id = \? AND garden_id = \?/,
    );

    const calls = callsNamed(learnAst, "getLearnMapById");
    assert.ok(calls.length >= 6, "expected all confirmation, generation, and status lookups");
    for (const call of calls) {
      assert.equal(call.arguments.length, 2, sourceOf(call));
      assert.equal(call.arguments[1].getText(learnAst), "gardenId", sourceOf(call));
    }
  });

  test("generation reloads and validates source state only after fenced lease acquisition", () => {
    const generationSource = sourceOf(namedFunction("runTextbookGeneration"));
    const retainedLeaseCheckIndex = generationSource.indexOf("if (gardenLease)");
    const leaseIndex = generationSource.indexOf("acquireGardenLearnLease");
    const mapReloadIndex = generationSource.indexOf("let selectedMap");
    const contextIndex = generationSource.indexOf("context = collectLearnSourceContext");
    const driftIndex = generationSource.indexOf(
      "if (context.sourceSetHash !== map.sourceSetHash)",
    );
    const jobIndex = generationSource.indexOf("let job:", driftIndex);
    const workspaceIndex = generationSource.indexOf("createLearnBuildWorkspace");
    const stagedContextIndex = generationSource.indexOf("const stagedContext");
    const stagedDriftIndex = generationSource.indexOf(
      "if (stagedContext.sourceSetHash !== map.sourceSetHash)",
    );

    assert.ok(retainedLeaseCheckIndex >= 0 && retainedLeaseCheckIndex < mapReloadIndex);
    assert.ok(leaseIndex > retainedLeaseCheckIndex && leaseIndex < mapReloadIndex);
    assert.ok(mapReloadIndex < contextIndex && contextIndex < driftIndex);
    assert.ok(jobIndex > driftIndex, "drift must fail before a durable job starts");
    assert.ok(workspaceIndex > driftIndex, "drift must fail before staging is created");
    assert.match(
      generationSource.slice(driftIndex, jobIndex),
      /throw new LearnPipelineConflictError[\s\S]*?Run Learn planning again/,
    );
    assert.ok(workspaceIndex < stagedContextIndex && stagedContextIndex < stagedDriftIndex);
    assert.match(
      generationSource.slice(stagedDriftIndex, stagedDriftIndex + 350),
      /throw new LearnPipelineConflictError[\s\S]*?isolated workspace/,
    );
  });
});

describe("Learn validation, reads, and publication contracts", () => {
  test("a non-publish-ready critic result blocks atomic promotion", () => {
    const generationSource = sourceOf(namedFunction("runTextbookGeneration"));
    const criticIndex = generationSource.indexOf("const criticLoop = await runCriticLoop");
    const gateIndex = generationSource.indexOf(
      "if (!criticLoop.status.publishReady || criticLoop.finalBlockingIssues.length > 0)",
      criticIndex,
    );
    const promotionIndex = generationSource.indexOf("await promoteStagingGarden", criticIndex);

    assert.ok(criticIndex >= 0 && gateIndex > criticIndex);
    assert.ok(promotionIndex > gateIndex, "promotion must remain behind the critic gate");
    assert.match(
      generationSource.slice(gateIndex, promotionIndex),
      /throw new Error\([\s\S]*?did not approve publication/,
    );
    assert.match(
      generationSource.slice(criticIndex, promotionIndex),
      /learn_critic_loop_failed[\s\S]*?throw criticError;/,
      "critic failures must propagate instead of shipping a draft",
    );
  });

  test("status performs one non-migrating knowledge scan and no recovery writes", () => {
    const contextFunction = namedFunction("collectLearnSourceContext");
    const contextSource = sourceOf(contextFunction);
    assert.equal(callsNamed(contextFunction, "scanClusterKnowledge").length, 1);
    assert.match(
      contextSource,
      /scanClusterKnowledge\(contentPath, gardenId, \{\s*migrateSources: false,?\s*\}\)/,
    );
    assert.match(
      contextSource,
      /const existingTextbookPages[\s\S]*?\.filter\(isLearnAuthoredLesson\)/,
      "document-ingestion learning pages must not make a never-run garden repair-only",
    );

    const cachedContextFunction = namedFunction("collectLearnStatusContext");
    const cachedContextSource = sourceOf(cachedContextFunction);
    assert.equal(
      callsNamed(cachedContextFunction, "collectLearnSourceContext").length,
      1,
    );
    assert.equal(callsNamed(cachedContextFunction, "scanClusterKnowledge").length, 0);
    assert.match(learnSource, /LEARN_STATUS_CONTEXT_CACHE_TTL_MS = 5_000/);
    assert.match(
      cachedContextSource,
      /cached && cached\.expiresAt > now[\s\S]*?return cached\.context/,
    );

    const statusFunction = namedFunction("getLearnStatusSnapshot");
    const statusSource = sourceOf(statusFunction);
    assert.equal(callsNamed(statusFunction, "collectLearnStatusContext").length, 1);
    assert.equal(callsNamed(statusFunction, "collectLearnSourceContext").length, 0);
    assert.equal(callsNamed(statusFunction, "scanClusterKnowledge").length, 0);
    assert.doesNotMatch(
      statusSource,
      /recoverAbandonedLearnJobs|refreshClusterIndex|rollbackLearnRun|migrateSources/,
    );
    assert.match(statusSource, /context\.existingTextbookPages\.length > 0/);
  });

  test("rollback re-fences its final destination check with a live heartbeat", () => {
    const rollbackSource = sourceOf(namedFunction("rollbackLearnRun"));
    assert.match(
      rollbackSource,
      /verifyCurrentDestination:\s*\(destinationDir\)\s*=>\s*lease\.heartbeat\(\)\s*&&/,
    );
  });

  test("all mutating entry points hold fenced leases through their finalizers", () => {
    for (const functionName of [
      "runLearnPlanning",
      "runTextbookGeneration",
      "runLearnRepairOperation",
      "clearAllLearnData",
    ]) {
      const declaration = namedFunction(functionName);
      const functionSource = sourceOf(declaration);
      assert.equal(
        callsNamed(declaration, "acquireGardenLearnLease").length,
        1,
        `${functionName} must acquire exactly one long-lived fenced lease`,
      );
      assert.match(
        functionSource,
        /finally[\s\S]*?lease\.release\(\)/,
        `${functionName} must release its lease in finally`,
      );
    }
  });

  test("generation, repair, and Clear heartbeat immediately before publication", () => {
    const generation = namedFunction("runTextbookGeneration");
    const generationSource = sourceOf(generation);
    assert.match(
      generationSource,
      /verifyCurrentDestination:[\s\S]{0,160}?lease\.heartbeat\(\)\s*&&/,
    );
    assert.ok(propertyCallCount(generation, "lease", "heartbeat") >= 1);

    const repair = namedFunction("runLearnRepairOperation");
    const repairSource = sourceOf(repair);
    assert.match(
      repairSource,
      /status === "publishing_repair"[\s\S]*?!lease\.heartbeat\(\)[\s\S]*?committingLearnJobs\.add/,
    );

    const clear = namedFunction("clearAllLearnData");
    const clearSource = sourceOf(clear);
    assert.match(
      clearSource,
      /verifyCurrentDestination:[\s\S]{0,220}?if \(!lease\.heartbeat\(\)\) return false;/,
    );
  });

  test("late source artifacts are materialized from the preserved PDF before contract acceptance", () => {
    const contextSource = sourceOf(namedFunction("collectLearnSourceContext"));
    const resolverSource = sourceOf(namedFunction("ensureReferencedSourceArtifactsExtracted"));
    const markdownDiscoverySource = sourceOf(namedFunction("structuredArtifactIdsMentionedBySources"));
    const planningSource = sourceOf(namedFunction("runLearnPlanning"));
    const generationSource = sourceOf(namedFunction("runTextbookGeneration"));

    assert.match(contextSource, /sourcePdf:\s*node\.sourcePdf/);
    assert.match(resolverSource, /ensureSourcePdfPageSnapshots\(/);
    assert.match(resolverSource, /extractSourceVisuals\(/);
    assert.match(resolverSource, /unresolvedIds/);
    assert.match(markdownDiscoverySource, /source\.body/);
    assert.match(markdownDiscoverySource, /P\(\\d\+\).*\[FGTE\]/);
    assert.match(planningSource, /reconcilePlannedSourceArtifacts/);
    assert.match(
      planningSource,
      /structuredArtifactIdsMentionedBySources\(context\)[\s\S]*?candidateArtifactIds:\s*mentionedArtifactIds[\s\S]*?const promptSourceContext/,
      "source-markdown page hints must be proven before the planner sees extractedSourceArtifacts",
    );
    assert.match(generationSource, /ensureReferencedSourceArtifactsExtracted\(/);
    assert.match(
      learnSource,
      /may ONLY be copied verbatim from extractedSourceArtifacts/,
      "the planner must not promote figure-like prose references into artifact ids",
    );
    assert.doesNotMatch(
      learnSource,
      /sourceFigures\.slice\(0,\s*40\)/,
      "planning must not discard registered visuals after the first forty",
    );
  });

  test("final repair retries are bounded by progress, rounds, and runtime", () => {
    const generationSource = sourceOf(namedFunction("runTextbookGeneration"));

    assert.doesNotMatch(generationSource, /MAX_FINALIZE_PASSES\s*=\s*3/);
    assert.match(
      learnSource,
      /LEARN_FINALIZE_MAX_ROUNDS\s*=\s*envClampedPositiveInt\([\s\S]*?"LEARN_FINALIZE_MAX_ROUNDS"[\s\S]*?8[\s\S]*?1[\s\S]*?12/,
    );
    assert.match(
      learnSource,
      /LEARN_FINALIZE_MAX_RUNTIME_MS\s*=\s*envClampedPositiveInt\([\s\S]*?"LEARN_FINALIZE_MAX_RUNTIME_MS"/,
    );
    assert.match(generationSource, /new Set<string>\(\)/);
    assert.match(
      generationSource,
      /auditGardenForFinalization\(clusterDir, gardenId\)[\s\S]*?audit\.stateFingerprint/,
    );
    assert.match(
      generationSource,
      /failedStateKey[\s\S]*?seenFailedStates\.has\(failedStateKey\)[\s\S]*?"no_progress"/,
    );
    assert.match(
      generationSource,
      /Date\.now\(\) - finalizeLoopStartedAt >= LEARN_FINALIZE_MAX_RUNTIME_MS/,
    );
    assert.match(generationSource, /learn_finalization_retry_scheduled/);
    assert.match(generationSource, /learn_finalization_loop_(?:completed|stopped)/);
    assert.ok(
      callsNamed(namedFunction("runTextbookGeneration"), "throwIfLearnCancelled").length >= 2,
      "the bounded loop must retain cancellation checks",
    );
  });

  test("a lost fenced lease aborts promotion without touching the published garden", async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-learn-lost-lease-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const destination = path.join(root, "garden");
    const staging = path.join(root, "staging");
    fs.mkdirSync(destination, { recursive: true });
    fs.mkdirSync(staging, { recursive: true });
    fs.writeFileSync(path.join(destination, "old.md"), "published-before-crash");
    fs.writeFileSync(path.join(staging, "new.md"), "uncommitted-build");

    const started = Date.now();
    let clock = started;
    const original = acquireGardenLearnLease(
      destination,
      { gardenSlug: "g", jobId: "job", buildId: "old-build" },
      { heartbeatIntervalMs: 60_000, now: () => clock },
    );
    assert.equal(original.acquired, true);
    if (!original.acquired) return;

    clock = started + LOCK_STALE_MS + 1;
    const takeover = acquireGardenLearnLock(
      destination,
      { gardenSlug: "g", jobId: "new-job", buildId: "new-build" },
      clock,
    );
    assert.equal(takeover.acquired, true);

    const promotion = await promoteStagingGarden({
      stagingGardenDir: staging,
      destinationGardenDir: destination,
      verifyCurrentDestination: () => original.lease.heartbeat(),
    });

    assert.equal(promotion.promoted, false);
    assert.equal(original.lease.lost, true);
    assert.equal(fs.readFileSync(path.join(destination, "old.md"), "utf8"), "published-before-crash");
    assert.equal(fs.existsSync(path.join(destination, "new.md")), false);
    assert.equal(readGardenLearnLock(destination)?.jobId, "new-job");
    releaseGardenLearnLock(destination, "new-job");
  });
});

describe("Learn repair timing and abandoned-job recovery", () => {
  test("every repair phase keeps the Learn stopwatch running", () => {
    const repairStatuses = [
      "analyzing_issues",
      "repairing",
      "revalidating",
      "publishing_repair",
    ];
    for (const status of repairStatuses) {
      assert.equal(learnTimerRunsForStatus(status), true, status);
      assert.deepEqual(
        transitionLearnTimer(
          { elapsedMs: 250, startedAt: "2026-08-10T10:00:00.000Z" },
          status,
          "2026-08-10T10:01:00.000Z",
        ),
        { elapsedMs: 250, startedAt: "2026-08-10T10:00:00.000Z" },
      );
    }
    assert.deepEqual(
      transitionLearnTimer(
        { elapsedMs: 250, startedAt: "2026-08-10T10:00:00.000Z" },
        "complete",
        "2026-08-10T10:01:00.000Z",
      ),
      { elapsedMs: 60_250 },
    );
  });

  test("Node startup wires a guarded immediate and recurring Learn recovery sweep", () => {
    assert.match(
      instrumentationSource,
      /__breadboardAbandonedLearnSweeper\?: ReturnType<typeof setInterval>/,
    );
    assert.match(
      instrumentationSource,
      /if \(!globalState\.__breadboardAbandonedLearnSweeper\)/,
    );
    assert.match(instrumentationSource, /process\.env\.QUARTZ_CONTENT_PATH/);
    assert.match(
      instrumentationSource,
      /await import\("\.\/lib\/learn\.ts"\)[\s\S]*?await recoverAbandonedLearnJobs\(\{ contentPath \}\)/,
    );
    assert.match(instrumentationSource, /setTimeout\(\(\) => void sweep\(\), 0\)/);
    assert.match(instrumentationSource, /setInterval\(\(\) => void sweep\(\), 60 \* 1000\)/);
    assert.match(
      instrumentationSource,
      /globalState\.__breadboardAbandonedLearnSweeper = timer/,
    );
  });

  test("recovery requires a stale job plus lease ownership before rollback", () => {
    const recovery = namedFunction("recoverAbandonedLearnJobs");
    const recoverySource = sourceOf(recovery);
    const cutoffIndex = recoverySource.indexOf("LEARN_JOB_ABANDONED_AFTER_MS");
    const leaseIndex = recoverySource.indexOf("acquireGardenLearnLease");
    const restoreIndex = recoverySource.indexOf("restorePreviousPromotedGarden");
    const rollbackIndex = recoverySource.indexOf("rollbackLearnRun");
    const failedIndex = recoverySource.indexOf('status: "failed"', rollbackIndex);

    assert.ok(cutoffIndex >= 0 && leaseIndex > cutoffIndex);
    assert.ok(restoreIndex > leaseIndex);
    assert.ok(rollbackIndex > leaseIndex);
    assert.ok(failedIndex > rollbackIndex);
    assert.match(recoverySource, /if \(!leaseResult\.acquired\)[\s\S]*?continue;/);
    assert.match(recoverySource, /finally \{\s*lease\.release\(\);\s*\}/);
    assert.match(recoverySource, /learn_abandoned_job_recovered/);
  });

  test("generation restores the retained previous tree if its second-resource commit fails", () => {
    const generationSource = sourceOf(namedFunction("runTextbookGeneration"));
    const promotionIndex = generationSource.indexOf("await promoteStagingGarden");
    const retainedIndex = generationSource.indexOf(
      "retainPreviousUntilCallerCommit: true",
      promotionIndex,
    );
    const restoreIndex = generationSource.indexOf(
      "restorePreviousPromotedGarden",
      promotionIndex,
    );
    const failureUpdateIndex = generationSource.indexOf(
      'status: "failed"',
      restoreIndex,
    );

    assert.ok(promotionIndex >= 0 && retainedIndex > promotionIndex);
    assert.ok(restoreIndex > retainedIndex, "the previous tree must remain recoverable after swap");
    assert.ok(failureUpdateIndex > restoreIndex, "filesystem recovery precedes terminal failure state");
    assert.match(
      generationSource.slice(promotionIndex, failureUpdateIndex),
      /previousPromotedGardenDir && !promotionCommitted/,
    );
  });
});

describe("Learn cancellation and terminal-transition races", () => {
  test("cancel rejects terminal jobs and fences cleanup against another process", () => {
    const cancelSource = sourceOf(namedFunction("cancelLatestLearnJob"));
    const terminalGuard = cancelSource.search(
      /if \([\s\S]{0,80}!(?:activeStatus|recoverableLearnStatus|cancellableLearnStatus)\(latest\.status\)[\s\S]{0,120}?\) \{/,
    );
    const controllerIndex = cancelSource.indexOf(
      "activeLearnAbortControllers.get(latest.id)",
    );
    const cleanupIndex = cancelSource.indexOf("cleanupLearnArtifactsAfterCancel");
    const leaseFenceIndex = [
      cancelSource.indexOf("acquireGardenLearnLease", controllerIndex),
      cancelSource.indexOf("readGardenLearnLock", controllerIndex),
    ].find((index) => index >= 0) ?? -1;

    assert.ok(terminalGuard >= 0, "complete and failed jobs must not be cancellable");
    assert.ok(terminalGuard < controllerIndex);
    assert.match(
      cancelSource.slice(terminalGuard, controllerIndex),
      /throw new LearnCancelConflictError/,
    );
    assert.ok(
      leaseFenceIndex > controllerIndex && leaseFenceIndex < cleanupIndex,
      "a no-local-controller cancel must inspect/claim the cross-process garden lease before rollback",
    );
    assert.match(
      cancelSource.slice(leaseFenceIndex, cleanupIndex),
      /return next|throw new LearnCancelConflictError/,
      "fresh foreign ownership must exit before cleanup",
    );
  });

  test("planning, generation, and repair verify their intended terminal transition", () => {
    const planningSource = sourceOf(namedFunction("runLearnPlanning"));
    const planningUpdateIndex = planningSource.indexOf("const nextJob = updateLearnJobExpectStatus");
    const planningHandoffIndex = planningSource.indexOf(
      "leaseTransferred = retainLeaseOnSuccess",
      planningUpdateIndex,
    );
    assert.ok(planningUpdateIndex >= 0 && planningHandoffIndex > planningUpdateIndex);
    const planningTransition = planningSource.slice(planningUpdateIndex, planningHandoffIndex);
    assert.match(
      planningTransition,
      /status:\s*retainLeaseOnSuccess\s*\?\s*"building_navigation"\s*:\s*"awaiting_confirmation"/,
    );
    assert.match(planningTransition, /progressPercent:\s*retainLeaseOnSuccess\s*\?\s*55\s*:\s*100/);

    const cases = [
      {
        functionName: "runTextbookGeneration",
        variable: "finalJob",
        status: "complete",
        end: "promotionCommitted = true",
      },
      {
        functionName: "runLearnRepairOperation",
        variable: "finalJob",
        status: "complete",
        end: "repairCommitRecorded = true",
      },
    ];

    for (const entry of cases) {
      const operationSource = sourceOf(namedFunction(entry.functionName));
      const updateIndex = operationSource.indexOf(`const ${entry.variable} =`);
      const endIndex = operationSource.indexOf(entry.end, updateIndex);
      assert.ok(updateIndex >= 0 && endIndex > updateIndex, entry.functionName);
      const transition = operationSource.slice(updateIndex, endIndex);
      const explicitGuard = new RegExp(
        `${entry.variable}\\.status\\s*!==?\\s*["']${entry.status}["']`,
      );
      const assertionHelper = new RegExp(
        `assert\\w*Learn\\w*\\(\\s*${entry.variable}\\s*,\\s*["']${entry.status}["']`,
        "i",
      );
      const guardedUpdateHelper = new RegExp(
        `updateLearnJobExpectStatus\\([\\s\\S]*?status:\\s*["']${entry.status}["']`,
      );
      assert.ok(
        explicitGuard.test(transition) ||
          assertionHelper.test(transition) ||
          guardedUpdateHelper.test(transition),
        `${entry.functionName} must reject a CAS result that did not reach ${entry.status}`,
      );
      assert.match(
        transition,
        /throw|assert\w*Learn|updateLearnJobExpectStatus/i,
        `${entry.functionName} must unwind so its cancellation/restore catch runs`,
      );
    }
  });
});

describe("Learn recovery and Clear transaction boundaries", () => {
  test("abandoned-job recovery isolates failures to one candidate", () => {
    const recoverySource = sourceOf(namedFunction("recoverAbandonedLearnJobs"));
    const loopIndex = recoverySource.indexOf("for (const candidate of candidates)");
    const loopEnd = recoverySource.indexOf(
      "return { recoveredJobIds, skippedJobIds }",
      loopIndex,
    );
    assert.ok(loopIndex >= 0 && loopEnd > loopIndex);
    const loopSource = recoverySource.slice(loopIndex, loopEnd);
    assert.match(loopSource, /finally \{\s*lease\.release\(\);\s*\}/);
    assert.match(
      loopSource,
      /catch \(error\) \{[\s\S]*?skippedJobIds[\s\S]*?learn_abandoned_job_recovery_failed/,
    );
    assert.match(loopSource, /continuing sweep/);
  });

  test("abandoned recovery selects only a backup carrying exact job ownership", () => {
    const ownerLookup = sourceOf(namedFunction("previousGardenForAbandonedJob"));
    assert.match(ownerLookup, /exactOwnerSuffix/);
    assert.match(ownerLookup, /candidate\.name\.endsWith\(exactOwnerSuffix\)/);
    assert.doesNotMatch(ownerLookup, /return candidates\[0\]/);
    // Pre-owner-suffix backups are accepted only with that exact job's snapshot,
    // never because they happen to be newest.
    assert.match(ownerLookup, /learnRunSnapshotDir\(candidate\.path, job\.id\)/);
  });

  test("Clear publishes before committing SQLite or deleting the previous tree", () => {
    const clearSource = sourceOf(namedFunction("clearAllLearnData"));
    const promotionIndex = clearSource.indexOf("const publication = await promoteStagingGarden");
    const publishIndex = clearSource.indexOf(
      "await publishQuartzAfterMutation(`cleared Learn data in ${gardenId}`",
      promotionIndex,
    );
    const databaseIndex = clearSource.indexOf("databaseResult = db.transaction", promotionIndex);
    const cleanupIndex = clearSource.indexOf(
      "const previousGardenDir = path.resolve(publication.previousPreservedAt)",
      databaseIndex,
    );

    assert.ok(promotionIndex >= 0);
    assert.ok(publishIndex > promotionIndex, "Quartz publish follows filesystem promotion");
    assert.ok(databaseIndex > publishIndex, "SQLite deletion waits for successful Quartz publish");
    assert.ok(cleanupIndex > databaseIndex, "the rollback tree survives until SQLite commits");
    assert.match(
      clearSource.slice(publishIndex, databaseIndex),
      /restorePreviousPromotedGarden|restoreGardenAfterClearDatabaseFailure/,
      "publication failure must restore the retained previous tree",
    );
    assert.match(
      clearSource.slice(publishIndex, databaseIndex),
      /requireSuccess:\s*true/,
    );
  });
});

describe("retained-lease workflow handoff", () => {
  test("automatic planning and generation share one durable job and one lease", () => {
    const pipelineSource = sourceOf(namedFunction("runLearnPipeline"));
    const planningIndex = pipelineSource.indexOf("const planning = await runLearnPlanning");
    const retainedIndex = pipelineSource.indexOf("const retainedLease = planning.retainedLease");
    const confirmIndex = pipelineSource.indexOf("confirmLearningMap", retainedIndex);
    const generationIndex = pipelineSource.indexOf("await runTextbookGeneration", confirmIndex);
    const releaseIndex = pipelineSource.indexOf("retainedLease.release()", generationIndex);

    assert.ok(planningIndex >= 0 && retainedIndex > planningIndex);
    assert.match(
      pipelineSource.slice(planningIndex, retainedIndex),
      /retainLeaseOnSuccess:\s*autoConfirmTopicMap/,
    );
    assert.ok(confirmIndex > retainedIndex && generationIndex > confirmIndex);
    assert.match(
      pipelineSource.slice(generationIndex, releaseIndex),
      /gardenLease:\s*retainedLease/,
    );
    assert.ok(releaseIndex > generationIndex);

    const generationSource = sourceOf(namedFunction("runTextbookGeneration"));
    assert.match(generationSource, /const jobId = gardenLease\?\.lock\.jobId \?\? makeId\("learn_job"\)/);
    assert.match(generationSource, /gardenLease && selectedMap\.jobId !== jobId/);
    const retainedJobBranch = generationSource.indexOf("if (gardenLease) {", generationSource.indexOf("let job:"));
    const createJobBranch = generationSource.indexOf("return createLearnJob", retainedJobBranch);
    assert.ok(retainedJobBranch >= 0 && createJobBranch > retainedJobBranch);
    assert.match(
      generationSource.slice(retainedJobBranch, createJobBranch),
      /getLearnJobById\(jobId\)[\s\S]*?updateLearnJob\(jobId/,
    );
  });

  test("manual confirmation terminalizes its planning job when generation takes over", () => {
    const generationSource = sourceOf(namedFunction("runTextbookGeneration"));
    const transactionIndex = generationSource.indexOf("job = db.transaction");
    const planningLookupIndex = generationSource.indexOf(
      "getLearnJobById(map.jobId)",
      transactionIndex,
    );
    const terminalIndex = generationSource.indexOf(
      'status: "complete"',
      planningLookupIndex,
    );
    const createIndex = generationSource.indexOf(
      "return createLearnJob",
      terminalIndex,
    );

    assert.ok(transactionIndex >= 0);
    assert.ok(planningLookupIndex > transactionIndex);
    assert.ok(terminalIndex > planningLookupIndex);
    assert.ok(createIndex > terminalIndex);
    assert.match(
      generationSource.slice(planningLookupIndex, createIndex),
      /awaiting_confirmation[\s\S]*?updateLearnJobExpectStatus/,
    );
  });
});

describe("cross-process mutation fences", () => {
  test("new planning, repair, and Clear work rejects every unresolved older job", () => {
    for (const functionName of [
      "runLearnPlanning",
      "runLearnRepairOperation",
      "clearAllLearnData",
    ]) {
      const functionSource = sourceOf(namedFunction(functionName));
      const leaseIndex = functionSource.indexOf("acquireGardenLearnLease");
      const reconcileIndex = functionSource.indexOf(
        "reconcileSupersededAwaitingLearnJobs(gardenId)",
        leaseIndex,
      );
      const conflictIndex = functionSource.indexOf(
        "assertNoUnresolvedLearnJob(gardenId)",
        leaseIndex,
      );
      assert.ok(
        leaseIndex >= 0 &&
          reconcileIndex > leaseIndex &&
          conflictIndex > reconcileIndex,
        `${functionName} must recheck unresolved jobs after acquiring its lease`,
      );
    }

    const conflictHelper = sourceOf(namedFunction("learnJobNeedsExclusiveResolution"));
    assert.match(conflictHelper, /recoverableLearnStatus\(job\.status\)/);
    assert.match(conflictHelper, /job\.status === "awaiting_confirmation"/);
    assert.match(conflictHelper, /LEARN_CANCELLATION_REQUESTED_STEP/);

    const legacyReconciliation = sourceOf(
      namedFunction("reconcileSupersededAwaitingLearnJobs"),
    );
    assert.match(legacyReconciliation, /status = 'awaiting_confirmation'/);
    assert.match(legacyReconciliation, /newer\.status = 'complete'/);
    assert.match(legacyReconciliation, /newer\.mode = 'repair'/);
    assert.match(legacyReconciliation, /FROM learn_versions AS version/);
    assert.match(legacyReconciliation, /updateLearnJobExpectStatus/);
  });

  test("generation allows only its map's planning job and refuses every other workflow", () => {
    const generationSource = sourceOf(namedFunction("runTextbookGeneration"));
    assert.match(
      generationSource,
      /handoffJobId[\s\S]*?awaiting_confirmation[\s\S]*?building_navigation[\s\S]*?assertNoUnresolvedLearnJob\(gardenId, handoffJobId\)/,
    );
    const confirmationSource = sourceOf(namedFunction("confirmLearningMap"));
    assert.match(
      confirmationSource,
      /assertNoUnresolvedLearnJob\(gardenId, map\.jobId\)/,
    );
  });

  test("large synchronous preflight work is re-fenced immediately before job or journal creation", () => {
    for (const [functionName, creationMarker] of [
      ["runLearnPlanning", "job = createLearnJob"],
      ["runLearnRepairOperation", "job = createLearnJob"],
      ["clearAllLearnData", "createLearnClearOperation"],
    ]) {
      const functionSource = sourceOf(namedFunction(functionName));
      const creationIndex = functionSource.indexOf(creationMarker);
      const heartbeatIndex = functionSource.lastIndexOf(
        "lease.heartbeat()",
        creationIndex,
      );
      const conflictIndex = functionSource.lastIndexOf(
        "assertNoUnresolvedLearnJob(gardenId)",
        creationIndex,
      );
      assert.ok(
        creationIndex >= 0 &&
          heartbeatIndex >= 0 &&
          conflictIndex > heartbeatIndex &&
          conflictIndex < creationIndex,
        `${functionName} must heartbeat and recheck DB ownership immediately before ${creationMarker}`,
      );
    }

    const generationSource = sourceOf(namedFunction("runTextbookGeneration"));
    const generationCreateIndex = generationSource.indexOf("return createLearnJob");
    const generationHeartbeatIndex = generationSource.lastIndexOf(
      "lease.heartbeat()",
      generationCreateIndex,
    );
    const generationConflictIndex = generationSource.lastIndexOf(
      "assertNoUnresolvedLearnJob(gardenId, handoffJobId)",
      generationCreateIndex,
    );
    assert.ok(
      generationHeartbeatIndex >= 0 &&
        generationConflictIndex > generationHeartbeatIndex &&
        generationConflictIndex < generationCreateIndex,
    );
  });

  test("recovery protects newer committed jobs and publishes retries only afterward", () => {
    const recoverySource = sourceOf(namedFunction("recoverAbandonedLearnJobs"));
    assert.match(recoverySource, /rowid AS job_rowid/);
    assert.match(recoverySource, /learn_abandoned_job_superseded/);
    const rollbackIndex = recoverySource.indexOf("await rollbackLearnRun");
    const retryIndex = recoverySource.lastIndexOf(
      "await recoverPendingLearnPublications(contentPath)",
    );
    assert.ok(retryIndex > rollbackIndex);

    const retrySource = sourceOf(namedFunction("recoverPendingLearnPublications"));
    assert.match(retrySource, /unresolvedLearnJob\(publication\.garden_id\)/);
  });

  test("repair promotion and Clear restore both recheck fenced ownership", () => {
    const scopedRepairSource = fs.readFileSync(
      path.join(dashboardRoot, "src", "lib", "learn-scoped-repair.ts"),
      "utf8",
    );
    assert.match(
      scopedRepairSource,
      /verifyCurrentDestination:[\s\S]*?input\.verifyLease\?\.\(\)/,
    );
    const repairSource = sourceOf(namedFunction("runLearnRepairOperation"));
    assert.match(repairSource, /verifyLease:\s*\(\) => lease\.heartbeat\(\)/);

    const restoreSource = sourceOf(
      namedFunction("restoreGardenAfterClearDatabaseFailure"),
    );
    assert.match(restoreSource, /if \(ownsLease && !ownsLease\(\)\)/);
    const clearSource = sourceOf(namedFunction("clearAllLearnData"));
    assert.match(clearSource, /ownsLease:\s*\(\) => lease\.heartbeat\(\)/);
  });
});

describe("required generated visual failures", () => {
  test("use the full bounded repair budget and stop before finalization if a required visual remains missing", () => {
    const reconcileSource = sourceOf(namedFunction("reconcileInteractiveVisuals"));
    assert.match(
      reconcileSource,
      /maxAttempts:\s*opportunity\.requirement === "required" \? 5 : undefined/,
    );
    assert.match(
      reconcileSource,
      /opportunity\.requirement === "required"[\s\S]*?throw new Error\([\s\S]*?Required interactive visual/,
    );
    assert.match(
      reconcileSource,
      /Generated visualization garden limit[\s\S]*?opportunity\.requirement === "required"[\s\S]*?throw new Error/,
    );
    assert.match(
      reconcileSource,
      /Generated visualization page limit[\s\S]*?opportunity\.requirement === "required"[\s\S]*?throw new Error/,
    );
  });
});

describe("startup cleanup journals", () => {
  test("a cancelled job with pending cleanup is adopted by startup recovery", () => {
    const recoverableSource = sourceOf(namedFunction("recoverableAbandonedJob"));
    assert.match(
      recoverableSource,
      /job\.status === "cancelled"[\s\S]*?job\.current_step === LEARN_CANCELLATION_REQUESTED_STEP/,
    );

    const cancelSource = sourceOf(namedFunction("cancelLatestLearnJob"));
    assert.match(
      cancelSource,
      /cancellationCleanupPending[\s\S]*?latest\.currentStep === LEARN_CANCELLATION_REQUESTED_STEP/,
    );
    assert.match(cancelSource, /cancellationCleanupPending\s*\?\s*latest\s*:/);

    const recoverySource = sourceOf(namedFunction("recoverAbandonedLearnJobs"));
    assert.match(
      recoverySource,
      /OR \(status = 'cancelled' AND current_step = \?\)/,
    );
    assert.match(
      recoverySource,
      /\.all\(cutoff, LEARN_CANCELLATION_REQUESTED_STEP\)/,
    );
    const cancellationIndex = recoverySource.indexOf(
      'const cancellationRecovery = current.status === "cancelled"',
    );
    const rollbackIndex = recoverySource.lastIndexOf("await rollbackLearnRun", cancellationIndex);
    const terminalIndex = recoverySource.indexOf("updateLearnJobExpectStatus", cancellationIndex);
    const discardIndex = recoverySource.indexOf("discardLearnRunSnapshot", terminalIndex);
    assert.ok(rollbackIndex >= 0 && rollbackIndex < cancellationIndex);
    assert.ok(terminalIndex > cancellationIndex && discardIndex > terminalIndex);
    assert.match(
      recoverySource.slice(terminalIndex, discardIndex),
      /status:\s*"cancelled"[\s\S]*?latest Learn changes rolled back/,
    );
  });

  test("Clear writes a phase journal and startup resolves every interrupted phase", () => {
    assert.match(
      learnSource,
      /CREATE TABLE IF NOT EXISTS learn_clear_operations[\s\S]*?phase\s+TEXT/,
    );
    const clearSource = sourceOf(namedFunction("clearAllLearnData"));
    const journalIndex = clearSource.indexOf("createLearnClearOperation(");
    const promotionIndex = clearSource.indexOf("await promoteStagingGarden", journalIndex);
    const promotedPhaseIndex = clearSource.indexOf('"filesystem_promoted"', promotionIndex);
    const databaseIndex = clearSource.indexOf("databaseResult = db.transaction", promotedPhaseIndex);
    const committedPhaseIndex = clearSource.indexOf('"database_committed"', databaseIndex);
    const cleanupIndex = clearSource.indexOf(
      "const previousGardenDir = path.resolve(publication.previousPreservedAt)",
      committedPhaseIndex,
    );
    const journalDeleteIndex = clearSource.indexOf("deleteLearnClearOperation(clearId)", cleanupIndex);
    assert.ok(journalIndex >= 0 && journalIndex < promotionIndex);
    assert.ok(promotionIndex < promotedPhaseIndex && promotedPhaseIndex < databaseIndex);
    assert.ok(databaseIndex < committedPhaseIndex && committedPhaseIndex < cleanupIndex);
    assert.ok(cleanupIndex < journalDeleteIndex);

    const startupRecovery = sourceOf(namedFunction("recoverInterruptedLearnClears"));
    assert.match(startupRecovery, /acquireGardenLearnLease/);
    assert.match(startupRecovery, /current\.phase === "database_committed"/);
    assert.match(startupRecovery, /current\.phase === "restored_pending_publication"/);
    assert.match(startupRecovery, /current\.phase === "filesystem_promoted"/);
    assert.match(startupRecovery, /previousGardenForClearOperation/);
    assert.match(startupRecovery, /restoreGardenAfterClearDatabaseFailure/);
    assert.match(startupRecovery, /finally \{\s*leaseResult\.lease\.release\(\);\s*\}/);

    const abandonedRecovery = sourceOf(namedFunction("recoverAbandonedLearnJobs"));
    const clearRecoveryIndex = abandonedRecovery.indexOf("await recoverInterruptedLearnClears(contentPath)");
    const abandonedQueryIndex = abandonedRecovery.indexOf("const cutoff", clearRecoveryIndex);
    assert.ok(clearRecoveryIndex >= 0 && clearRecoveryIndex < abandonedQueryIndex);
  });
});

describe("rollback snapshot lifetime and lease-loss ownership", () => {
  test("rollback snapshots survive until the corresponding terminal update", () => {
    const planningSource = sourceOf(namedFunction("runLearnPlanning"));
    const planningFailureIndex = planningSource.indexOf(
      'const message = errorMessage(error, "Learn planning failed")',
    );
    const planningRollbackIndex = planningSource.indexOf("await rollbackLearnRun", planningFailureIndex);
    const planningTerminalIndex = planningSource.indexOf('status: "failed"', planningRollbackIndex);
    const planningDiscardIndex = planningSource.indexOf("discardLearnRunSnapshot", planningTerminalIndex);
    assert.ok(
      planningFailureIndex >= 0 &&
        planningRollbackIndex > planningFailureIndex &&
        planningTerminalIndex > planningRollbackIndex &&
        planningDiscardIndex > planningTerminalIndex,
    );

    const generationSource = sourceOf(namedFunction("runTextbookGeneration"));
    const generationCancelIndex = generationSource.indexOf("if (isLearnCancellation(job.id, error))");
    const generationRollbackIndex = generationSource.indexOf("cleanupLearnArtifactsAfterCancel", generationCancelIndex);
    const generationTerminalIndex = generationSource.indexOf('status: "cancelled"', generationRollbackIndex);
    const generationDiscardIndex = generationSource.indexOf("discardLearnRunSnapshot", generationTerminalIndex);
    assert.ok(
      generationCancelIndex >= 0 &&
        generationRollbackIndex > generationCancelIndex &&
        generationTerminalIndex > generationRollbackIndex &&
        generationDiscardIndex > generationTerminalIndex,
    );
    assert.doesNotMatch(
      generationSource,
      /planningRolledBack/,
      "generation setup cannot discard a planning snapshot through an out-of-scope flag",
    );

    const repairSource = sourceOf(namedFunction("runLearnRepairOperation"));
    const repairTerminalIndex = repairSource.indexOf("const finalJob = updateLearnJobExpectStatus");
    const repairDiscardIndex = repairSource.indexOf("learnRunSnapshotDir", repairTerminalIndex);
    assert.ok(repairTerminalIndex >= 0 && repairDiscardIndex > repairTerminalIndex);
  });

  test("lease loss leaves snapshots for the new owner and skips outer rebuild rollback", () => {
    for (const functionName of [
      "runLearnPlanning",
      "runTextbookGeneration",
      "runLearnRepairOperation",
    ]) {
      const declaration = namedFunction(functionName);
      const guardedCatches = [];
      const visit = (node) => {
        if (ts.isCatchClause(node)) {
          const firstStatement = node.block.statements[0];
          if (
            firstStatement &&
            ts.isIfStatement(firstStatement) &&
            sourceOf(firstStatement.expression).includes("lease.lost") &&
            sourceOf(firstStatement.expression).includes(
              "leaseLostLearnJobs.has(job.id)",
            )
          ) {
            guardedCatches.push(firstStatement);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(declaration);
      assert.equal(
        guardedCatches.length,
        1,
        `${functionName} must have one authoritative outer lease-loss guard`,
      );
      const leaseGuard = guardedCatches[0];
      const guardCondition = sourceOf(leaseGuard.expression);
      const guardBody = sourceOf(leaseGuard.thenStatement);
      assert.match(
        guardCondition,
        /!lease\.heartbeat\(\)/,
        `${functionName} must freshly verify lease ownership before rollback`,
      );
      assert.match(guardBody, /throw error/);
      assert.doesNotMatch(
        guardBody,
        /rollbackLearnRun|discardLearnRunSnapshot|restorePreviousPromotedGarden|updateLearnJob/,
      );
    }

    const repairSource = sourceOf(namedFunction("runLearnRepairOperation"));
    assert.match(
      repairSource,
      /finally \{[\s\S]*?!lease\.lost[\s\S]*?!leaseLostLearnJobs\.has\(job\.id\)[\s\S]*?learnRunSnapshotDir/,
    );

    const rebuildSource = sourceOf(namedFunction("rebuildEntireGarden"));
    const leaseLossIndex = rebuildSource.indexOf("rebuildLease.lost");
    const heartbeatIndex = rebuildSource.indexOf(
      "!rebuildLease.heartbeat()",
      leaseLossIndex,
    );
    const throwIndex = rebuildSource.indexOf("throw error", heartbeatIndex);
    const rollbackIndex = rebuildSource.indexOf("await rollbackLearnRun", throwIndex);
    assert.ok(
      leaseLossIndex >= 0 &&
        heartbeatIndex > leaseLossIndex &&
        throwIndex > heartbeatIndex &&
        rollbackIndex > throwIndex,
    );
  });
});

test("generation and repair use a status CAS at commit entry", () => {
  const generationSource = sourceOf(namedFunction("runTextbookGeneration"));
  const generationPromotionIndex = generationSource.indexOf("const promotion = await promoteStagingGarden");
  const generationCasIndex = generationSource.lastIndexOf(
    "updateLearnJobExpectStatus(job.id",
    generationPromotionIndex,
  );
  const generationCommitSetIndex = generationSource.indexOf(
    "committingLearnJobs.add(job.id)",
    generationCasIndex,
  );
  assert.ok(generationCasIndex >= 0 && generationCasIndex < generationCommitSetIndex);
  assert.match(
    generationSource.slice(generationCasIndex, generationCommitSetIndex),
    /status:\s*"writing_quartz"/,
  );

  const repairSource = sourceOf(namedFunction("runLearnRepairOperation"));
  const repairPublishingIndex = repairSource.indexOf(
    'if (status === "publishing_repair") {',
  );
  const repairHeartbeatIndex = repairSource.indexOf(
    "lease.heartbeat()",
    repairPublishingIndex,
  );
  const repairCommitSetIndex = repairSource.indexOf(
    "committingLearnJobs.add(job.id)",
    repairHeartbeatIndex,
  );
  const repairProgressCasIndex = repairSource.indexOf(
    "updateLearnJobExpectStatus(job.id, progressUpdate)",
    repairCommitSetIndex,
  );
  const repairPromotionResultIndex = repairSource.indexOf(
    "previousRepairGardenDir = repair.promotion.previousPreservedAt",
  );
  assert.ok(
    repairPublishingIndex >= 0 &&
      repairHeartbeatIndex > repairPublishingIndex &&
      repairCommitSetIndex > repairHeartbeatIndex &&
      repairProgressCasIndex > repairCommitSetIndex &&
      repairPromotionResultIndex > repairProgressCasIndex,
  );
  assert.match(
    repairSource.slice(repairPublishingIndex, repairPromotionResultIndex),
    /status === "publishing_repair"[\s\S]*?lease\.heartbeat\(\)[\s\S]*?updateLearnJobExpectStatus\(job\.id, progressUpdate\)/,
  );
});

test("half-swap plus restore failure exposes the retained previous tree honestly", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-half-swap-failure-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const destination = path.join(root, "garden");
  const staging = path.join(root, "staging");
  fs.mkdirSync(destination, { recursive: true });
  fs.mkdirSync(staging, { recursive: true });
  fs.writeFileSync(path.join(destination, "old.md"), "last-known-good");
  fs.writeFileSync(path.join(staging, "new.md"), "candidate");

  const originalRenameSync = fs.renameSync;
  fs.renameSync = (source, target) => {
    const sourceName = path.basename(String(source));
    if (
      path.resolve(String(target)) === path.resolve(destination) &&
      (sourceName.startsWith(".garden.incoming-") ||
        sourceName.startsWith(".garden.previous-"))
    ) {
      throw Object.assign(new Error(`injected rename failure for ${sourceName}`), {
        code: "EPERM",
      });
    }
    return originalRenameSync(source, target);
  };

  let result;
  try {
    result = await promoteStagingGarden({
      stagingGardenDir: staging,
      destinationGardenDir: destination,
      retainPreviousUntilCallerCommit: true,
      recoveryOwnerId: "job-half-swap",
      options: { maxAttempts: 1, initialDelayMs: 1, maxDelayMs: 1 },
    });
  } finally {
    fs.renameSync = originalRenameSync;
  }

  assert.equal(result.promoted, false);
  assert.ok(result.previousPreservedAt, "the caller needs an exact recovery pointer");
  assert.equal(fs.existsSync(destination), false);
  assert.equal(
    fs.readFileSync(path.join(result.previousPreservedAt, "old.md"), "utf8"),
    "last-known-good",
  );
  assert.doesNotMatch(
    result.reason,
    /destination untouched|destination intact|previous published garden (?:preserved|restored)/i,
  );
  assert.match(result.reason, /could not be restored|recovery is required/i);
});
