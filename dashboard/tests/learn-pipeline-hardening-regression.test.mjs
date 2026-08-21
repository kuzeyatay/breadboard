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
const gardenFinalizePath = path.join(dashboardRoot, "src", "lib", "garden-finalize.ts");
const instrumentationPath = path.join(dashboardRoot, "src", "instrumentation-node.ts");
const learnSource = fs.readFileSync(learnPath, "utf8");
const gardenFinalizeSource = fs.readFileSync(gardenFinalizePath, "utf8");
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

function declarationsNamed(root, name) {
  const declarations = [];
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      declarations.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return declarations;
}

function objectPropertyInitializer(object, name) {
  assert.ok(ts.isObjectLiteralExpression(object), `expected an object literal for ${name}`);
  const property = object.properties.find((candidate) => {
    if (!ts.isPropertyAssignment(candidate)) return false;
    if (ts.isIdentifier(candidate.name) || ts.isStringLiteralLike(candidate.name)) {
      return candidate.name.text === name;
    }
    return false;
  });
  assert.ok(property && ts.isPropertyAssignment(property), `expected property ${name}`);
  return unwrapExpression(property.initializer);
}

function assertBooleanCallOption(call, name, expected) {
  const options = unwrapExpression(call.arguments[0]);
  const initializer = objectPropertyInitializer(options, name);
  assert.equal(
    initializer.kind,
    expected ? ts.SyntaxKind.TrueKeyword : ts.SyntaxKind.FalseKeyword,
    `${name} must be ${expected}`,
  );
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
    assert.ok(rollbackPaths.includes(".breadboard/source-formula-reviews"));
    assert.ok(rollbackPaths.includes(".breadboard/source-formula-review-set.json"));
    assert.ok(rollbackPaths.includes(".breadboard/source-visual-source-index.json"));
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

  test("planning releases its fenced lease when strict source context collection fails", () => {
    const planningSource = sourceOf(namedFunction("runLearnPlanning"));
    assert.match(
      planningSource,
      /try \{[\s\S]*?context = collectLearnSourceContext\([\s\S]*?\} catch \(error\) \{\s*lease\.release\(\);\s*throw error;/,
    );
  });

  test("generation requires and re-verifies the exact authoritative source-anchor ledger before route-bundle rehydration", () => {
    const generationSource = sourceOf(namedFunction("runTextbookGeneration"));
    const workspaceIndex = generationSource.indexOf("createLearnBuildWorkspace");
    const firstLedgerVerificationIndex = generationSource.indexOf(
      "verifyAuthoritativeSourceAnchorLedger(workspace)",
    );
    const canonicalAnchorValidationIndex = generationSource.indexOf(
      "const selectedCanonicalSourceAnchors",
    );
    const visualReviewIndex = generationSource.indexOf(
      "const generationVisualNecessityReview",
    );
    const secondLedgerVerificationIndex = generationSource.indexOf(
      "verifyAuthoritativeSourceAnchorLedger(workspace)",
      firstLedgerVerificationIndex + 1,
    );
    const contractWriteIndex = generationSource.indexOf(
      "const contractWrite = writeLearningUnitContractArtifacts",
    );

    assert.ok(workspaceIndex >= 0);
    assert.match(
      generationSource.slice(workspaceIndex, workspaceIndex + 1_000),
      /requireAuthoritativeSourceAnchorLedger:\s*true/,
    );
    assert.ok(
      firstLedgerVerificationIndex > workspaceIndex &&
        firstLedgerVerificationIndex < canonicalAnchorValidationIndex,
      "the exact ledger must be verified before canonical-anchor validation",
    );
    assert.ok(
      secondLedgerVerificationIndex > visualReviewIndex &&
        secondLedgerVerificationIndex < contractWriteIndex,
        "the exact ledger must be re-verified after route-bundle rehydration and before contract persistence",
    );
  });

  test("visual routing is persisted with the confirmed map and generation rehydrates it without a second model allocation", () => {
    const tables = sourceOf(namedFunction("ensureLearnTables"));
    for (const column of [
      "visual_necessity_review_json",
      "visualization_plan_json",
      "visual_contract_executability_ledger_json",
      "visual_route_binding_json",
    ]) {
      assert.match(tables, new RegExp(`${column}\\s+TEXT`));
      assert.match(tables, new RegExp(`ADD COLUMN ${column} TEXT`));
    }

    const planning = sourceOf(namedFunction("runLearnPlanning"));
    assert.match(planning, /const confirmedVisualRouteBundle = createConfirmedVisualRouteBundle\(/);
    assert.match(
      planning,
      /visual_necessity_review_json = \?, visualization_plan_json = \?,[\s\S]*?visual_contract_executability_ledger_json = \?, visual_route_binding_json = \?/,
    );
    assert.match(planning, /visualRouteBindingHash:/);

    const confirmation = sourceOf(namedFunction("confirmLearningMap"));
    const bundleGate = confirmation.indexOf("const confirmedVisualRouteProblems = confirmedVisualRouteBundleProblems");
    const confirmationReturn = confirmation.indexOf("if (alreadyConfirmed) return");
    assert.ok(bundleGate >= 0 && confirmationReturn > bundleGate);

    const generation = namedFunction("runTextbookGeneration");
    const generationSource = sourceOf(generation);
    const rehydrate = generationSource.indexOf("confirmedVisualRouteBundleForGeneration");
    const contractWrite = generationSource.indexOf("const contractWrite = writeLearningUnitContractArtifacts");
    assert.ok(rehydrate >= 0 && contractWrite > rehydrate);
    assert.match(generationSource, /visual_route_plan_rehydrated/);
    assert.match(
      generationSource,
      /generationExecutabilityContext:[\s\S]*?generationExecutabilityLedger\.context/,
    );
    for (const forbiddenSecondAllocation of [
      "planAndReviewVisualNecessity",
      "buildVisualizationPlanWithContractRepair",
      "reviewVisualizationPlanExecutability",
      "buildFinalVisualizationPlanFromRoutedContracts",
      "buildVisualContractExecutabilityLedger",
    ]) {
      assert.equal(
        callsNamed(generation, forbiddenSecondAllocation).length,
        0,
        `${forbiddenSecondAllocation} must not silently replace a confirmed visual allocation`,
      );
    }

    const binding = sourceOf(namedFunction("confirmedVisualRouteBundleProblems"));
    assert.match(binding, /sourceFormulaReviewSetHash/);
    assert.match(binding, /learningUnitContractSha256/);
    assert.match(binding, /visualContractExecutabilityLinkageProblems/);
    assert.match(binding, /context\.phase !== "planning"/);

    const snapshotRestore = sourceOf(namedFunction("restoreLearnDatabaseSnapshot"));
    assert.match(snapshotRestore, /visual_necessity_review_json/);
    assert.match(snapshotRestore, /visual_contract_executability_ledger_json/);
    assert.match(snapshotRestore, /row\.visual_route_binding_json \?\? null/);

    assert.match(
      gardenFinalizeSource,
      /requireGenerationPhase:\s*expectedVisualContractExecutabilityContext\?\.phase !== "planning"/,
      "a verified map-bound planning ledger must retain its truthful review context through finalization",
    );
  });

  test("failed staged visual preview matrices retain bounded root-ledger evidence without publishing the candidate", () => {
    const reconciliation = sourceOf(namedFunction("reconcileInteractiveVisuals"));
    assert.match(reconciliation, /durableEventContentPath\?: string/);
    assert.match(reconciliation, /event\.type === "visual_browser_tests_completed"/);
    assert.match(reconciliation, /event\.data\.previewMatrixReceipt/);
    assert.match(reconciliation, /"learn_visual_preview_matrix_observed"/);
    assert.match(reconciliation, /stage: "staging_unpublished"/);
    assert.match(
      reconciliation,
      /appendLearnEvent\(contentPath, gardenId, event\.type, eventData\)[\s\S]*?appendLearnEvent\([\s\S]*?durableEventContentPath/,
      "the normal staging ledger must remain separate from the diagnostic-only durable event mirror",
    );

    const generation = sourceOf(namedFunction("runTextbookGeneration"));
    assert.match(
      generation,
      /contentPath: artifactContentPath,\s*durableEventContentPath: contentPath,/,
      "normal generation must send visual artifacts to staging but preview receipts to the root ledger",
    );
    assert.doesNotMatch(
      reconciliation,
      /gardenDir: path\.join\(durableEventContentPath, gardenId\)/,
      "durable preview diagnostics must never redirect generated artifacts out of staging",
    );
  });
});

describe("Learn validation, reads, and publication contracts", () => {
  test("active Learn keeps semantic repair model-only and disables semantic fallbacks", () => {
    const generation = namedFunction("runTextbookGeneration");

    for (const forbiddenCall of [
      "reconcileFinalGardenState",
      "reconcileFinalFormulaProjections",
      "runWeakAnchorSelfHealingLoop",
      "migrateLegacyTextConceptAnchors",
      "healDanglingReplacementReferences",
      "ensureQuestionBlock",
      "embedAssignedSourceVisuals",
      "scrubAiisms",
      "scrubLearnerProse",
      "scrubSourceCommentaryProse",
    ]) {
      assert.equal(
        callsNamed(generation, forbiddenCall).length,
        0,
        `${forbiddenCall} must not author or rewrite semantics during active Learn`,
      );
    }

    const executorDeclarations = declarationsNamed(generation, "repairExecutorMode");
    assert.equal(executorDeclarations.length, 1);
    const executor = unwrapExpression(executorDeclarations[0].initializer);
    assert.ok(ts.isStringLiteralLike(executor));
    assert.equal(executor.text, "model");

    const contractRepairs = callsNamed(generation, "repairLearningUnitsFromContract");
    assert.equal(contractRepairs.length, 1);
    assertBooleanCallOption(contractRepairs[0], "preserveModelAuthoredVisuals", true);
    assertBooleanCallOption(contractRepairs[0], "preserveModelAuthoredContent", true);
    const repairExecutor = objectPropertyInitializer(
      unwrapExpression(contractRepairs[0].arguments[0]),
      "repairExecutor",
    );
    assert.ok(ts.isIdentifier(repairExecutor));
    assert.equal(repairExecutor.text, "repairExecutorMode");

    const finalizers = callsNamed(generation, "finalizeGardenExport");
    assert.equal(finalizers.length, 1);
    assertBooleanCallOption(finalizers[0], "preserveModelAuthoredContent", true);

    const criticRepairs = callsNamed(generation, "makeCriticArtifactRepair");
    assert.equal(criticRepairs.length, 1);
    assertBooleanCallOption(criticRepairs[0], "allowDeterministicRepairs", false);
  });

  test("source evidence is selected by the model and projected by exact canonical anchors", () => {
    const planningSource = sourceOf(namedFunction("runLearnPlanning"));
    assert.match(planningSource, /structuralSourceTextAnchorCatalog\(context\)/);
    assert.match(planningSource, /canonicalSourceAnchors:\s*canonicalSourceAnchorCatalog/);
    assert.match(planningSource, /persistSelectedStructuralSourceAnchors/);

    const dossierSource = sourceOf(namedFunction("buildPageDossier"));
    assert.match(dossierSource, /exactSourceSnippetsForAnchors/);
    assert.doesNotMatch(dossierSource, /selectRelevantSourceSnippets|fallbackKeywords/);

    const exactProjection = sourceOf(namedFunction("exactSourceSnippetsForAnchors"));
    assert.match(exactProjection, /input\.anchors/);
    assert.doesNotMatch(exactProjection, /score|sort\(|keyword|similar/i);
  });

  test("routed visual persistence requires exact learning-unit identity", () => {
    const persistence = sourceOf(namedFunction("persistRoutedVisualPlans"));
    assert.match(persistence, /Learning Unit Contract is missing/);
    assert.match(persistence, /new Set\(persistedIds\)\.size/);
    assert.match(persistence, /JSON\.stringify\(persistedIds\) !== JSON\.stringify\(routedIds\)/);
    assert.doesNotMatch(persistence, /if \(!fs\.existsSync\(filePath\)\) return/);
  });

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
    assert.match(resolverSource, /explicitPageHints/);
    assert.match(resolverSource, /unresolvedIds/);
    assert.match(markdownDiscoverySource, /source\.body/);
    assert.match(markdownDiscoverySource, /P\(\\d\+\).*\[FGTE\]/);
    assert.match(planningSource, /reconcilePlannedSourceArtifacts/);
    assert.match(
      planningSource,
      /const selectedSourcePageHints = selectedStructuralSourcePageHints\([\s\S]*?explicitPageHints:\s*selectedSourcePageHints[\s\S]*?const scopeCall/,
      "exact pages selected by the Source Map must be scanned before scope and spine planning",
    );
    assert.match(
      planningSource,
      /structuredArtifactIdsMentionedBySources\(context\)[\s\S]*?candidateArtifactIds:\s*mentionedArtifactIds[\s\S]*?let promptSourceContext/,
      "source-markdown page hints must be proven before the planner sees extractedSourceArtifacts",
    );
    assert.match(generationSource, /ensureReferencedSourceArtifactsExtracted\(/);
    assert.match(
      sourceOf(namedFunction("ensureSourceVisualsExtracted")),
      /sourceVisualCachedPageImageUrls\(contentPath, gardenId, source\.slug\)/,
      "rollback-surviving AI page scans must hydrate before the next Source Map",
    );
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

  test("late source-set or inventory drift rebinds coverage before each bounded Source Map reauthor and fails closed at its cap", () => {
    const planningSource = sourceOf(namedFunction("runLearnPlanning"));

    assert.match(
      planningSource,
      /const requestSourceMap = async \(\) => \{[\s\S]*?const artifactInventory = refreshSelectedSourceArtifactInventory\([\s\S]*?const sourceSetHash = context\.sourceSetHash[\s\S]*?const call = await callValidatedPlanningJson\([\s\S]*?return \{ call, artifactInventory, sourceSetHash \}/,
      "the full selected planning evidence must be captured immediately before every Source Map call",
    );
    assert.match(
      planningSource,
      /for \(;;\) \{[\s\S]*?ensureReferencedSourceArtifactsExtracted\([\s\S]*?const refreshedPlanningContext = collectLearnSourceContext\([\s\S]*?syllabusCoverageRebindSourceBindingProblems\([\s\S]*?context = refreshedPlanningContext[\s\S]*?const postSelectedPageArtifactInventory = refreshSelectedSourceArtifactInventory\([\s\S]*?const evidenceTransition = sourceMapPlanningEvidenceTransition\([\s\S]*?await rebindSyllabusCoverage\(\);[\s\S]*?sourceMapRequest = await requestSourceMap\(\)/,
      "every allowed formula-review or registry drift must refresh source context, rebind coverage, and re-author the complete Source Map",
    );
    assert.match(
      planningSource,
      /let sourceMapReauthorAttempts = 0;[\s\S]*?reauthorAttempts: sourceMapReauthorAttempts[\s\S]*?if \(evidenceTransition === "fail"\) \{[\s\S]*?MAX_SOURCE_MAP_EVIDENCE_REAUTHORS/,
      "the numeric Source Map reauthor counter must fail closed at its fixed cap",
    );
    assert.match(
      planningSource,
      /sourceMapAttempt: sourceMapReauthorAttempts \+ 1[\s\S]*?sourceMapReauthorAttempts \+= 1/,
      "each complete model reauthor must have a truthful 1-based attempt receipt",
    );
    assert.match(
      planningSource,
      /const rebindSyllabusCoverage = async \(\): Promise<void> => \{[\s\S]*?callValidatedPlanningJson\([\s\S]*?taskType:\s*"source_map"[\s\S]*?runSyllabusCoverageEvidenceRecovery\([\s\S]*?syllabusCoverageRecoveryReceiptProblems\([\s\S]*?syllabusCoverage = reboundCoverage/,
      "the rebind must obtain a new model-authored coverage decision and strictly validate any new recovery receipt before replacing state",
    );
    const rebindStart = planningSource.indexOf("const rebindSyllabusCoverage = async");
    const rebindEnd = planningSource.indexOf("const requestSourceMap = async", rebindStart);
    assert.ok(rebindStart >= 0 && rebindEnd > rebindStart);
    const rebindSource = planningSource.slice(rebindStart, rebindEnd);
    assert.match(planningSource, /const syllabusCoveragePayload = \(\) =>/);
    assert.match(planningSource, /syllabusCoverage:\s*syllabusCoveragePayload\(\)/);
    assert.doesNotMatch(
      rebindSource,
      /evidenceRecovery\s*=/,
      "a rebind must never mechanically rewrite a prior recovery receipt",
    );
    const mapCommit = planningSource.indexOf("const storedMap = db.transaction");
    const recoveryCommitGate = planningSource.lastIndexOf(
      "assertSyllabusCoverageRecoveryBinding",
      mapCommit,
    );
    assert.ok(
      recoveryCommitGate > rebindStart && mapCommit > recoveryCommitGate,
      "a stale recovery receipt must be rejected before a proposed map can commit",
    );
    assert.match(
      planningSource,
      /const currentSourceMapArtifactProblems = sourceMapPlanProblems\([\s\S]*?registeredArtifacts:\s*context\.sourceFigures[\s\S]*?The accepted Source Map is not valid against the current selected source-artifact inventory/,
      "scope planning must revalidate the accepted map against the current complete registry",
    );
    const sourceMapValidation = sourceOf(namedFunction("sourceMapPlanProblems"));
    assert.match(sourceMapValidation, /registered\.sourceId !== sourceId/);
    assert.match(sourceMapValidation, /rawKind !== registered\.kind/);
  });

  test("selected artifact inventory survives map/version persistence and rollback restoration", () => {
    const tables = sourceOf(namedFunction("ensureLearnTables"));
    assert.match(
      tables,
      /CREATE TABLE IF NOT EXISTS learn_maps[\s\S]*?source_artifact_inventory_hash TEXT NOT NULL/,
    );
    assert.match(
      tables,
      /CREATE TABLE IF NOT EXISTS learn_versions[\s\S]*?source_artifact_inventory_hash TEXT NOT NULL/,
    );
    assert.ok(
      (tables.match(/ADD COLUMN source_artifact_inventory_hash TEXT NOT NULL DEFAULT ''/g) ?? [])
        .length >= 2,
      "legacy maps and versions must migrate to an invalid empty binding",
    );

    const insertMap = sourceOf(namedFunction("insertLearnMap"));
    assert.match(insertMap, /sourceArtifactInventoryHash:\s*string/);
    assert.match(insertMap, /source_artifact_inventory_hash/);
    assert.match(insertMap, /stored\.sourceArtifactInventoryHash/);
    const insertVersion = sourceOf(namedFunction("insertLearnVersion"));
    assert.match(insertVersion, /sourceArtifactInventoryHash:\s*string/);
    assert.match(insertVersion, /source_artifact_inventory_hash/);
    assert.match(insertVersion, /sourceArtifactInventoryHash,/);

    const rollback = sourceOf(namedFunction("restoreLearnDatabaseSnapshot"));
    assert.match(
      rollback,
      /INSERT INTO learn_maps[\s\S]*?source_artifact_inventory_hash[\s\S]*?row\.source_artifact_inventory_hash \?\? ""/,
    );
    assert.match(
      rollback,
      /INSERT INTO learn_versions[\s\S]*?source_artifact_inventory_hash[\s\S]*?row\.source_artifact_inventory_hash \?\? ""/,
    );

    const contractBacked = sourceOf(namedFunction("isContractBackedLearningMap"));
    assert.match(contractBacked, /\^\[0-9a-f\]\{64\}\$/);
    assert.match(
      contractBacked,
      /coverageInventoryHash === map\.sourceArtifactInventoryHash\.toLowerCase\(\)/,
    );
    const coverage = sourceOf(namedFunction("sourceCoveragePlan"));
    assert.match(coverage, /sourceArtifactInventoryHash:\s*context\.sourceArtifactInventoryHash/);
    const contractWrite = sourceOf(namedFunction("writeLearningUnitContractArtifacts"));
    assert.match(contractWrite, /sourceArtifactInventoryHash:\s*string/);
    assert.match(contractWrite, /sourceArtifactInventoryHash,/);
  });

  test("inventory authority is recollected and CAS-bound at planning, confirmation, and generation boundaries", () => {
    const planning = sourceOf(namedFunction("runLearnPlanning"));
    const commitRecollect = planning.indexOf("const commitContext = collectLearnSourceContext");
    const insert = planning.indexOf("const stored = insertLearnMap", commitRecollect);
    const finalRecollect = planning.indexOf("const finalPlanningContext = collectLearnSourceContext", insert);
    const awaiting = planning.indexOf('status: retainLeaseOnSuccess ? "building_navigation" : "awaiting_confirmation"', finalRecollect);
    assert.ok(commitRecollect >= 0 && insert > commitRecollect);
    assert.match(
      planning.slice(commitRecollect, insert),
      /commitContext\.sourceArtifactInventoryHash !== context\.sourceArtifactInventoryHash/,
    );
    assert.ok(finalRecollect > insert && awaiting > finalRecollect);
    assert.match(
      planning.slice(finalRecollect, awaiting),
      /finalPlanningContext\.sourceArtifactInventoryHash !==[\s\S]*?storedMap\.sourceArtifactInventoryHash/,
    );
    assert.ok(
      (planning.match(/WHERE id = \? AND source_artifact_inventory_hash = \?/g) ?? []).length >= 2,
      "contract and routed-map writes must retain the inventory CAS",
    );

    const confirmation = sourceOf(namedFunction("confirmLearningMap"));
    const confirmationRecollect = confirmation.indexOf("const confirmationContext = collectLearnSourceContext");
    const confirmationUpdate = confirmation.indexOf("UPDATE learn_maps", confirmationRecollect);
    assert.ok(confirmationRecollect >= 0 && confirmationUpdate > confirmationRecollect);
    assert.match(
      confirmation.slice(confirmationRecollect, confirmationUpdate),
      /confirmationContext\.sourceArtifactInventoryHash !==[\s\S]*?map\.sourceArtifactInventoryHash/,
    );
    assert.match(
      confirmation.slice(confirmationUpdate),
      /status = 'proposed'[\s\S]*?source_set_hash = \?[\s\S]*?source_artifact_inventory_hash = \?/,
    );

    const generation = sourceOf(namedFunction("runTextbookGeneration"));
    const liveGate = generation.indexOf("confirmedArtifactInventoryHash !== map.sourceArtifactInventoryHash");
    const stagedGate = generation.indexOf("stagedContext.sourceArtifactInventoryHash !==");
    const extraction = generation.indexOf("const generationFormulaReview = await reviewAndBindSourceFormulas");
    const postExtractionGate = generation.indexOf("context.sourceArtifactInventoryHash !== map.sourceArtifactInventoryHash", extraction);
    const contractWrite = generation.indexOf("const contractWrite = writeLearningUnitContractArtifacts", postExtractionGate);
    const finalMapCas = generation.lastIndexOf("UPDATE learn_maps");
    const versionInsert = generation.indexOf("insertLearnVersion", finalMapCas);
    assert.ok(liveGate >= 0 && stagedGate > liveGate && extraction > stagedGate);
    assert.ok(postExtractionGate > extraction && contractWrite > postExtractionGate);
    assert.ok(finalMapCas > contractWrite && versionInsert > finalMapCas);
    assert.match(
      generation.slice(finalMapCas, versionInsert + 500),
      /status = 'confirmed'[\s\S]*?source_set_hash = \?[\s\S]*?source_artifact_inventory_hash = \?[\s\S]*?sourceArtifactInventoryHash:\s*context\.sourceArtifactInventoryHash/,
    );
  });

  test("status requires a version's exact map and aggregates current artifact drift", () => {
    const status = sourceOf(namedFunction("getLearnStatusSnapshot"));
    assert.match(
      status,
      /const versionMap = isContractBackedLearningMap\(versionMapCandidate\)/,
    );
    assert.match(status, /let sourceSetChanged = Boolean\(latestVersion && !versionMap\)/);
    assert.match(
      status,
      /const sourceBindingMap = latestVersion\s*\? versionMap\s*:\s*contractProposed \?\? confirmedMap/,
    );
    assert.match(status, /selectedSourceArtifactInventorySnapshot\(/);
    assert.match(
      status,
      /latestVersion\.source_artifact_inventory_hash !==[\s\S]*?sourceBindingMap\.sourceArtifactInventoryHash/,
    );
    assert.match(
      status,
      /expectedArtifactInventoryHash !== currentArtifactInventoryHash/,
    );
  });

  test("learning-spine repair carries the strongest rejected candidate with its exact problem history", () => {
    const planningSource = sourceOf(namedFunction("runLearnPlanning"));
    const repairStart = planningSource.indexOf("let topicMapCall = await callPlanningJsonWithRetry");
    const repairEnd = planningSource.indexOf("const visualNecessityReview", repairStart);
    assert.ok(repairStart >= 0 && repairEnd > repairStart);
    const repairSource = planningSource.slice(repairStart, repairEnd);

    assert.match(
      repairSource,
      /startLearningSpineFullRepairLineage\(\{[\s\S]*?invalidResponse:\s*topicMapCall\.content[\s\S]*?unitCount:\s*learningUnits\.length[\s\S]*?validationProblems:\s*contractProblems/,
      "the initial response, units, and exact hard failures must start one lineage",
    );
    assert.match(
      repairSource,
      /let topicMapCall = await callPlanningJsonWithRetry\(\{[\s\S]*?taskType:\s*"learning_spine"[\s\S]*?preserveExactContent:\s*true[\s\S]*?\}\);/,
      "the initial candidate must retain exact provider text before entering the lineage",
    );
    assert.match(
      repairSource,
      /const retryCall = await callPlanningJsonWithRetry\(\{[\s\S]*?taskType:\s*"learning_spine"[\s\S]*?preserveExactContent:\s*true[\s\S]*?\}\);/,
      "every full-contract repair candidate must retain exact provider text",
    );
    assert.match(
      repairSource,
      /const repairFeedback = learningSpineFullRepairFeedback\(fullRepairLineage, repairAttempt\)[\s\S]*?user: topicMapUser\(repairFeedback\)/,
      "the next repair must receive the incumbent response and its exact hard-check history",
    );
    assert.match(
      repairSource,
      /recordLearningSpineFullRepairCandidate\(\{[\s\S]*?invalidResponse:\s*retryCall\.content[\s\S]*?unitCount:\s*retryUnits\.length[\s\S]*?validationProblems:\s*retryProblems/,
      "every rejected retry must be reviewed with its exact raw candidate and failures",
    );
    assert.match(
      repairSource,
      /candidateUnitCount:\s*retryUnits\.length[\s\S]*?promotedToIncumbent:\s*lineageReview\?\.promotedToIncumbent \?\? false[\s\S]*?incumbentUnitCount:\s*fullRepairLineage\.incumbent\.unitCount/,
      "durable review events must expose the candidate-lineage decision",
    );
    assert.match(
      repairSource,
      /topicMapCall = fullRepairLineage\.incumbent\.payload\.call;[\s\S]*?learningUnits = fullRepairLineage\.incumbent\.payload\.units;[\s\S]*?sourceArtifactOmissions = fullRepairLineage\.incumbent\.payload\.sourceArtifactOmissions;[\s\S]*?contractProblems = fullRepairLineage\.incumbent\.validationProblems/,
      "candidate state and validation state must advance atomically from the lineage incumbent",
    );
    assert.doesNotMatch(
      repairSource,
      /retryProblems\.length < contractProblems\.length/,
      "raw problem count alone must not decide whether a nonempty candidate replaces an empty one",
    );
    assert.match(repairSource, /for \(let repairAttempt = 1; repairAttempt <= 2/);
    assert.equal(
      (repairSource.match(/callPlanningJsonWithRetry\(/g) ?? []).length,
      3,
      "the initial/full-replacement call sites stay intact and targeted model repair has its own provider call",
    );
    assert.match(repairSource, /runLearningSpineTargetedRepair\([\s\S]*?maxAttempts:\s*2/);
    assert.match(repairSource, /describeLearningSpineRepairAttempts\(\{[\s\S]*?fullContractAttempts:\s*3/);
    assert.match(repairSource, /targetedCalls:\s*targetedRepairOutcome\?\.calls \?\? 0/);
    assert.match(repairSource, /targetedStatus:\s*targetedRepairOutcome\?\.status \?\? "not_run"/);
    assert.match(repairSource, /No fallback curriculum was written/);
  });

  test("residual unit/concept failures use complete AI-authored targeted records and full revalidation", () => {
    const planningSource = sourceOf(namedFunction("runLearnPlanning"));
    const fullRepair = planningSource.indexOf("for (let repairAttempt = 1; repairAttempt <= 2");
    const targetedRepair = planningSource.indexOf("runLearningSpineTargetedRepair(");
    const finalFailure = planningSource.indexOf("if (contractProblems.length > 0)", targetedRepair);
    assert.ok(fullRepair >= 0 && targetedRepair > fullRepair && finalFailure > targetedRepair);
    const targetedSource = planningSource.slice(targetedRepair, finalFailure);

    assert.match(targetedSource, /canonicalPlanningPacket:\s*topicMapPlanningPacket\(\)/);
    assert.match(targetedSource, /canonicalEvidenceByUnit:\s*canonicalLearningSpineEvidenceByUnit\(/);
    assert.match(targetedSource, /maxAttempts:\s*2/);
    assert.match(targetedSource, /taskType:\s*"learning_spine_targeted_repair"/);
    assert.match(targetedSource, /system:\s*withSyllabusRules\(request\.system/);
    assert.doesNotMatch(targetedSource, /system:[^\n]*TOPIC_MAP_PROMPT/);
    assert.match(targetedSource, /return result\.parsed/);
    assert.match(targetedSource, /modelAuthoredLearningUnitParseProblems\(candidate\)/);
    assert.match(targetedSource, /sourceArtifactOwnershipProblems\(candidateUnits\)/);
    assert.match(targetedSource, /sourceArtifactCoverageProblems\(/);
    assert.match(targetedSource, /canonicalSourceAnchorProblems\(/);
    assert.match(targetedSource, /syllabusUnitAssignmentProblems\(/);
    assert.match(targetedSource, /conceptRegistryAlignmentProblems\(/);
    assert.match(targetedSource, /validateLearningUnitContracts\(/);
    assert.match(targetedSource, /modelAuthoredLearningMapDepthProblems\(/);
    assert.match(targetedSource, /repairExecutorMode:\s*"model"/);
    assert.doesNotMatch(targetedSource, /reconcileLearningUnitConceptAliases|alignLearningUnitConceptAliasesWithRegistry/);
    assert.match(learnSource, /semanticConcept slug appears in multiple units[\s\S]*?same preferredLabel[\s\S]*?same aliases array/);
  });

  test("shallow or source-shaped learning spines are repaired as hard failures", () => {
    const depthValidation = sourceOf(namedFunction("modelAuthoredLearningMapDepthProblems"));
    const candidateProjection = sourceOf(namedFunction("learningMapFromPlanningCandidate"));
    const planningSource = sourceOf(namedFunction("runLearnPlanning"));
    const validationStart = planningSource.indexOf("let contractProblems = [");
    const validationEnd = planningSource.indexOf("const visualNecessityReview", validationStart);
    assert.ok(validationStart >= 0 && validationEnd > validationStart);
    const boundedValidation = planningSource.slice(validationStart, validationEnd);

    assert.match(depthValidation, /validateLearningMapDepth\(/);
    assert.match(depthValidation, /learningMapFromPlanningCandidate\(/);
    assert.match(candidateProjection, /learningMapFromModelAuthoredUnits\(/);
    assert.match(candidateProjection, /title: record\.title/);
    assert.match(candidateProjection, /summary: record\.summary/);
    assert.doesNotMatch(candidateProjection, /title:[^\n]*\.trim\(|summary:[^\n]*\.trim\(/);

    assert.equal(
      (boundedValidation.match(/modelAuthoredLearningMapDepthProblems\(/g) ?? []).length,
      3,
      "the initial spine, every full replacement, and every targeted merged candidate must receive the depth gate",
    );
    assert.match(
      boundedValidation,
      /candidate: topicMapCall\.parsed,[\s\S]*?units: learningUnits/,
    );
    assert.match(
      boundedValidation,
      /candidate: retryCall\.parsed,[\s\S]*?units: retryUnits/,
    );
    assert.match(
      boundedValidation,
      /validationProblems: contractProblems/,
      "depth failures must ride the existing bounded model-repair prompt",
    );

    assert.match(
      planningSource,
      /const depthProblems = validateLearningMapDepth\(learningMap, context\);\s*if \(depthProblems\.length > 0\) \{\s*throw new Error\([\s\S]*?Learning spine depth invariant failed after bounded model repair/,
      "a post-loop depth failure is an invariant violation, never publishable state",
    );
    assert.doesNotMatch(planningSource, /Learning spine depth warning/);
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
      /auditGardenForFinalization\(clusterDir, gardenId,\s*\{[\s\S]*?expectedSourceFormulaReviewContext:\s*sourceFormulaReviewFinalizationContext[\s\S]*?audit\.stateFingerprint/,
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
    const supersededEventIndex = recoverySource.indexOf("learn_abandoned_job_superseded");
    const supersededCleanupIndex = recoverySource.indexOf(
      "disposeAbandonedLearnWorkspaces(current.garden_id, current.id)",
      supersededEventIndex,
    );
    const supersededContinueIndex = recoverySource.indexOf("continue;", supersededEventIndex);
    assert.ok(
      supersededCleanupIndex > supersededEventIndex &&
        supersededContinueIndex > supersededCleanupIndex,
      "a superseded abandoned job must clean both possible staging roots before continuing",
    );
    assert.match(
      learnSource,
      /function disposeAbandonedLearnWorkspaces\(gardenId: string, jobId: string\)[\s\S]*?learnWorkspaceRootCandidates\(gardenId, jobId\)/,
    );
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

describe("model-approved generated visual failures", () => {
  test("use the full bounded repair budget and stop before finalization if any approved visual remains missing", () => {
    const reconcileSource = sourceOf(namedFunction("reconcileInteractiveVisuals"));
    assert.match(reconcileSource, /maxAttempts:\s*GENERATED_VISUAL_SEMANTIC_MAX_ATTEMPTS/);
    assert.match(learnSource, /GENERATED_VISUAL_SEMANTIC_MAX_ATTEMPTS/);
    assert.match(
      reconcileSource,
      /throw new Error\([\s\S]*?Model-approved \$\{opportunity\.requirement\} interactive visual/,
    );
    assert.doesNotMatch(reconcileSource, /Generated visualization (?:garden|page) limit/);
    assert.doesNotMatch(reconcileSource, /generatedVisualBudget/);
    assert.match(
      reconcileSource,
      /availableSourceAnchorIds:\s*new Set\([\s\S]*?Object\.keys\(buildCanonicalSourceAnchors/,
    );
  });
});

describe("model-authored visual-necessity recovery", () => {
  test("wires compact targeted decision replacement and lets malformed model output reach semantic validation", () => {
    const planningSource = sourceOf(namedFunction("planAndReviewVisualNecessity"));
    assert.match(planningSource, /targetedRepairProvider:\s*async/);
    assert.match(planningSource, /taskType:\s*"visual_necessity_targeted_repair"/);
    assert.match(planningSource, /unitIds:\s*request\.unitIds/);
    assert.match(planningSource, /targetedRepairCalls:\s*run\.targetedRepairCalls/);
    assert.doesNotMatch(
      planningSource,
      /Visual-necessity planner returned no JSON object|Targeted visual-necessity repair returned no JSON object/,
      "malformed model JSON must consume semantic repair, while transport exceptions propagate",
    );
  });
});

describe("model-authored source artifact coverage", () => {
  test("generation accepts registry enumeration order without replacing the authored projection", () => {
    const generation = sourceOf(namedFunction("runTextbookGeneration"));

    assert.match(
      generation,
      /sameSourceArtifactAssignmentRecords\(\s*sourceArtifactReconciliation\.assignments,\s*confirmedSourceArtifactAssignments,?\s*\)/,
    );
    assert.doesNotMatch(
      generation,
      /JSON\.stringify\(sourceArtifactReconciliation\.assignments\)/,
      "registry order must not masquerade as a semantic assignment rewrite",
    );
    assert.match(
      generation,
      /assignments:\s*confirmedSourceArtifactAssignments/,
      "the untouched model-authored assignment order must continue into the contract writer",
    );
  });

  test("forgotten artifacts enter the bounded full-contract repair loop and omissions persist", () => {
    const planningStart = learnSource.indexOf("let contractProblems = [");
    const planningEnd = learnSource.indexOf("const visualNecessityReview", planningStart);
    assert.ok(planningStart >= 0 && planningEnd > planningStart);
    const planning = learnSource.slice(planningStart, planningEnd);

    assert.match(planning, /sourceArtifactCoverageProblems\(\s*learningUnits,\s*sourceArtifactOmissions/);
    assert.match(planning, /for \(let repairAttempt = 1; repairAttempt <= 2/);
    assert.match(planning, /sourceArtifactCoverageProblems\(\s*retryUnits,\s*retrySourceArtifactOmissions/);
    assert.match(
      planning,
      /sourceArtifactOmissions:\s*retrySourceArtifactOmissions[\s\S]*?sourceArtifactOmissions = fullRepairLineage\.incumbent\.payload\.sourceArtifactOmissions/,
      "omissions must advance atomically with the selected full-repair candidate",
    );
    assert.match(learnSource, /sourceArtifactOmissions:\s*omissions/);
    assert.match(learnSource, /sourceArtifactOmissions,\s*buildCanonicalSourceAnchors/);
    assert.doesNotMatch(
      learnSource,
      /Not central to any confirmed subsection of this learning map\./,
      "closeout must not manufacture a generic omission reason",
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

test("zero-teachable syllabus recovery is bounded, durable, and precedes every map or LUC call", () => {
  const recoveryGate = learnSource.indexOf(
    "if (!syllabusCoverageHasTeachableUnits(syllabusCoverage))",
  );
  const sourceMapRequest = learnSource.indexOf("const requestSourceMap = async", recoveryGate);
  const firstLearningSpineRequest = learnSource.indexOf(
    'taskType: "learning_spine"',
    recoveryGate,
  );
  assert.ok(recoveryGate > 0, "zero-teachable recovery gate must exist");
  assert.ok(sourceMapRequest > recoveryGate, "Source Map must follow recovery");
  assert.ok(firstLearningSpineRequest > sourceMapRequest, "LUC authoring must follow Source Map");
  const recoveryBlock = learnSource.slice(recoveryGate, sourceMapRequest);
  assert.match(recoveryBlock, /runSyllabusCoverageEvidenceRecovery/);
  assert.match(recoveryBlock, /preserveExactContent: true/);
  assert.match(recoveryBlock, /const recoveryLiveContext = collectLearnSourceContext/);
  assert.match(recoveryBlock, /syllabusCoverageRecoveryReceiptProblems/);
  assert.match(recoveryBlock, /No Source Map or Learning Unit Contract was requested/);

  const coveragePlan = sourceOf(namedFunction("sourceCoveragePlan"));
  assert.match(coveragePlan, /syllabusCoverageEvidenceRecoveryHash/);
  assert.match(coveragePlan, /syllabusCoverageEvidenceRecovery/);
  const writer = sourceOf(namedFunction("writeLearningUnitContractArtifacts"));
  assert.match(writer, /syllabusCoverageEvidenceRecoveryHash/);
  assert.match(writer, /syllabusCoverageEvidenceRecovery/);

  const confirmation = sourceOf(namedFunction("confirmLearningMap"));
  assert.ok(
    confirmation.indexOf('const alreadyConfirmed = map.status === "confirmed"') <
      confirmation.indexOf("assertSyllabusCoverageRecoveryBinding"),
  );
  assert.ok(
    confirmation.indexOf("assertSyllabusCoverageRecoveryBinding") <
      confirmation.indexOf("if (alreadyConfirmed) return"),
    "idempotent confirmation must not bypass live receipt validation",
  );

  const generation = sourceOf(namedFunction("runTextbookGeneration"));
  assert.match(
    generation,
    /sourceFormulaReviewFinalizationContextFromGarden\(workspace\.stagingGardenDir\)/,
  );
  assert.ok(
    generation.indexOf("stagedPersistedSourceContext") <
      generation.lastIndexOf("writeLearningUnitContractArtifacts"),
    "seeded LUC receipt must be checked before the generation writer can replace it",
  );
});
