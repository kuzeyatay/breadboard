import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { describe } from "node:test";
import { fileURLToPath } from "node:url";
import { StringDecoder } from "node:string_decoder";
import vm from "node:vm";
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
import { modelAuthoredLearningUnitParseProblems } from "../src/lib/learning-unit-contract.ts";
import {
  isAmbiguousModelTransportFailure,
  modelTransportFailureEvidence,
} from "../src/lib/http-502-retry.ts";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const learnPath = path.join(dashboardRoot, "src", "lib", "learn.ts");
const learnStatusPath = path.join(
  dashboardRoot,
  "src",
  "lib",
  "learn-status-projection.ts",
);
const sourceVisualsPath = path.join(
  dashboardRoot,
  "src",
  "lib",
  "source-visuals.ts",
);
const gardenFinalizePath = path.join(dashboardRoot, "src", "lib", "garden-finalize.ts");
const nativeServiceEnginePath = path.join(
  path.dirname(dashboardRoot),
  "native",
  "runtime-cli",
  "src",
  "service_engine.rs",
);
const learnSource = fs.readFileSync(learnPath, "utf8");
const learnStatusSource = fs.readFileSync(learnStatusPath, "utf8");
const sourceVisualsSource = fs.readFileSync(sourceVisualsPath, "utf8");
const gardenFinalizeSource = fs.readFileSync(gardenFinalizePath, "utf8");
const nativeServiceEngineSource = fs.readFileSync(nativeServiceEnginePath, "utf8");
const learnAst = ts.createSourceFile(
  learnPath,
  learnSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);
const learnStatusAst = ts.createSourceFile(
  learnStatusPath,
  learnStatusSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);
const sourceVisualsAst = ts.createSourceFile(
  sourceVisualsPath,
  sourceVisualsSource,
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

function namedStatusFunction(name) {
  const declaration = learnStatusAst.statements.find(
    (statement) =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === name,
  );
  assert.ok(declaration, `expected status projection function ${name} to exist`);
  return declaration;
}

function statusSourceOf(node) {
  return node.getText(learnStatusAst);
}

function namedSourceVisualsFunction(name) {
  const declaration = sourceVisualsAst.statements.find(
    (statement) =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === name,
  );
  assert.ok(declaration, `expected source-visual function ${name} to exist`);
  return declaration;
}

function executableSourceVisualsFunction(name, globals = {}) {
  const declaration = namedSourceVisualsFunction(name).getText(sourceVisualsAst);
  const executableSource = ts.transpileModule(
    `${declaration}\nglobalThis.testFunction = ${name};`,
    {
      compilerOptions: {
        module: ts.ModuleKind.None,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const sandbox = { ...globals };
  vm.runInNewContext(executableSource, sandbox);
  assert.equal(typeof sandbox.testFunction, "function");
  return sandbox.testFunction;
}

function executableNamedFunction(name, globals = {}) {
  const executableSource = ts.transpileModule(
    `${sourceOf(namedFunction(name))}\nglobalThis.testFunction = ${name};`,
    {
      compilerOptions: {
        module: ts.ModuleKind.None,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const sandbox = { ...globals };
  vm.runInNewContext(executableSource, sandbox);
  assert.equal(typeof sandbox.testFunction, "function");
  return sandbox.testFunction;
}

function executableStatusNamedFunction(name, globals = {}) {
  const executableSource = ts.transpileModule(
    `${statusSourceOf(namedStatusFunction(name))}\nglobalThis.testFunction = ${name};`,
    {
      compilerOptions: {
        module: ts.ModuleKind.None,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const sandbox = { ...globals };
  vm.runInNewContext(executableSource, sandbox);
  assert.equal(typeof sandbox.testFunction, "function");
  return sandbox.testFunction;
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

  test("generation persists the correct rollback owner before proposal promotion or handoff", () => {
    const rollbackPolicy = executableNamedFunction("generationRollbackInheritanceJobId");
    const planningJobId = "job-planning-generic";

    assert.equal(
      rollbackPolicy({
        mapAtEntry: { jobId: planningJobId, status: "confirmed" },
        confirmsProposedMap: true,
      }),
      undefined,
      "an already-confirmed map is a generation input even when auto-confirm is enabled",
    );
    assert.equal(
      rollbackPolicy({
        mapAtEntry: { jobId: planningJobId, status: "proposed" },
        confirmsProposedMap: true,
      }),
      planningJobId,
      "a proposal promoted by this generation retains its planning rollback owner",
    );
    assert.equal(
      rollbackPolicy({
        mapAtEntry: { jobId: planningJobId, status: "proposed" },
        confirmsProposedMap: false,
      }),
      undefined,
      "a generation that does not promote the proposal cannot claim its planning snapshot",
    );
    assert.equal(
      rollbackPolicy({ mapAtEntry: null, confirmsProposedMap: true }),
      undefined,
    );

    const generation = sourceOf(namedFunction("runTextbookGeneration"));
    const ownershipDecision = generation.indexOf(
      "inheritedPlanningSnapshotJobId = generationRollbackInheritanceJobId",
    );
    const inheritedGuard = generation.indexOf(
      "if (!gardenLease && inheritedPlanningSnapshotJobId)",
      ownershipDecision,
    );
    const inheritedSnapshot = generation.indexOf("createLearnRunSnapshot", inheritedGuard);
    const automaticConfirmation = generation.indexOf("confirmLearningMap", inheritedSnapshot);
    const interactiveGuard = generation.indexOf(
      "if (confirmProposedLearningMap)",
      automaticConfirmation,
    );
    const interactiveConfirmation = generation.indexOf("confirmLearningMap", interactiveGuard);
    const freshGuard = generation.indexOf(
      "if (!gardenLease && !inheritedPlanningSnapshotJobId)",
      interactiveConfirmation,
    );
    const freshSnapshot = generation.indexOf("createLearnRunSnapshot", freshGuard);
    const handoffCommit = generation.indexOf("job = db.transaction", freshSnapshot);
    const responseYield = generation.indexOf("await yieldToResponse", handoffCommit);
    assert.ok(
      ownershipDecision >= 0 &&
        inheritedGuard > ownershipDecision &&
        inheritedSnapshot > inheritedGuard &&
        automaticConfirmation > inheritedSnapshot &&
        interactiveConfirmation > inheritedSnapshot,
      "a transient proposal must inherit its planning rollback anchor before either confirmation path can mutate it",
    );
    assert.ok(
      freshGuard > interactiveConfirmation &&
        freshSnapshot > freshGuard &&
        handoffCommit > freshSnapshot &&
        responseYield > handoffCommit,
      "an already-confirmed input must receive a fresh rollback baseline before its generation job is handed off or exposed",
    );
    assert.match(
      generation.slice(inheritedSnapshot, automaticConfirmation),
      /inheritFromJobId: inheritedPlanningSnapshotJobId/,
    );
    assert.doesNotMatch(
      generation.slice(freshSnapshot, handoffCommit),
      /inheritFromJobId:/,
      "a pre-existing confirmed map's fresh baseline must not point behind that map",
    );
    assert.doesNotMatch(
      generation.slice(ownershipDecision),
      /inheritFromJobId: map\.jobId/,
      "a pre-existing confirmed map must never inherit its pre-planning snapshot",
    );
    assert.doesNotMatch(
      generation.slice(responseYield),
      /createLearnRunSnapshot/,
      "no accepted generation may expose a job before its rollback checkpoint exists",
    );
  });

  test("cancellation during generation response handoff rolls back before lease release", () => {
    const generation = sourceOf(namedFunction("runTextbookGeneration"));
    const setupStart = generation.indexOf("let workspace: LearnBuildWorkspace | null = null");
    const setupEnd = generation.indexOf("const artifactContentPath", setupStart);
    const setup = generation.slice(setupStart, setupEnd);
    const generatingStatus = setup.indexOf('status: "generating_learning_pages"');
    const firstCancellationCheck = setup.indexOf("throwIfLearnCancelled(job.id)", generatingStatus);
    const responseYield = setup.indexOf("await yieldToResponse", firstCancellationCheck);
    const secondCancellationCheck = setup.indexOf("throwIfLearnCancelled(job.id)", responseYield);
    const workspaceSeed = setup.indexOf("createLearnBuildWorkspace", secondCancellationCheck);
    const cancellationBranch = setup.indexOf("if (isLearnCancellationWithoutMaskingFailure(job.id, error))", workspaceSeed);
    const rollback = setup.indexOf("cleanupLearnArtifactsAfterCancel", cancellationBranch);
    const cancelledTerminal = setup.indexOf('status: "cancelled"', rollback);
    const snapshotDiscard = setup.indexOf("discardLearnRunSnapshot", cancelledTerminal);
    const failedTerminal = setup.indexOf('status: "failed"', snapshotDiscard);
    const finalLeaseRelease = setup.indexOf("lease.release()", failedTerminal);

    assert.ok(
      generatingStatus >= 0 &&
        firstCancellationCheck > generatingStatus &&
        responseYield > firstCancellationCheck &&
        secondCancellationCheck > responseYield &&
        workspaceSeed > secondCancellationCheck,
      "the durable job must check Stop on both sides of the response handoff",
    );
    assert.ok(
      cancellationBranch > workspaceSeed &&
        rollback > cancellationBranch &&
        cancelledTerminal > rollback &&
        snapshotDiscard > cancelledTerminal &&
        failedTerminal > snapshotDiscard &&
        finalLeaseRelease > failedTerminal,
      "setup cancellation must rollback and terminalize as cancelled while the fenced lease is still owned",
    );
    assert.match(setup.slice(cancellationBranch, failedTerminal), /throw error/);
    assert.doesNotMatch(
      setup.slice(cancellationBranch, failedTerminal),
      /throw new LearnCancelledError\(\)/,
      "a concurrent provider/SDK failure classified as cancellation retains exact identity",
    );
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

  test("failed staged visuals retain bounded root-ledger evidence without publishing the candidate", () => {
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
    assert.match(
      reconciliation,
      /createGeneratedVisualization\(\{[\s\S]*?gardenDir: path\.join\(contentPath, gardenId\)/,
      "generated artifacts must remain in staging",
    );
    assert.match(
      reconciliation,
      /onRejectedAttempt:[\s\S]*?persistLearnVisualRejectedAttemptAudit\([\s\S]*?gardenDir: path\.join\(durableEventContentPath, gardenId\)/,
      "only the bounded rejected-attempt receipt may target the durable snapshot",
    );
  });

  test("rejected visual audits survive ordinary failure and clear only at success or cancellation boundaries", () => {
    const discard = sourceOf(namedFunction("discardLearnRunSnapshot"));
    assert.doesNotMatch(
      discard,
      /removeAllLearnVisualRejectedAttemptAudits/,
      "ordinary planning/setup snapshot disposal must not sweep sibling failed-generation evidence",
    );

    const reconciliation = sourceOf(namedFunction("reconcileInteractiveVisuals"));
    assert.match(
      reconciliation,
      /if \(result\.manifest\)[\s\S]*?removeLearnVisualRejectedAttemptAudit/,
      "a visual that eventually succeeds must discard its own failed attempts",
    );

    const generation = sourceOf(namedFunction("runTextbookGeneration"));
    assert.match(
      generation,
      /promotionCommitted = true;[\s\S]*?removeAllLearnVisualRejectedAttemptAudits\(repositoryGardenDir\)/,
      "a committed generation must sweep obsolete sibling-job audit trees",
    );
    assert.match(
      generation,
      /status: "cancelled"[\s\S]*?discardLearnRunSnapshot[\s\S]*?removeRejectedAttemptAuditsAfterTerminalLifecycle/,
    );

    const cancel = sourceOf(namedFunction("cancelLatestLearnJob"));
    assert.match(
      cancel,
      /status: "cancelled"[\s\S]*?discardLearnRunSnapshot[\s\S]*?removeRejectedAttemptAuditsAfterTerminalLifecycle/,
    );
    assert.match(
      learnSource,
      /STATIC_LEARN_CLEAR_REMOVAL_ROOTS[\s\S]*?"\.breadboard\/learn-run-snapshots"/,
      "Learn Clear must remove the complete rejected-attempt snapshot namespace",
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
    assert.ok(finalizers.length >= 1);
    for (const finalizer of finalizers) {
      assertBooleanCallOption(finalizer, "preserveModelAuthoredContent", true);
    }

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
    assert.match(dossierSource, /requiredSourceFormulaDossierEntries/);
    assert.doesNotMatch(dossierSource, /selectRelevantSourceSnippets|fallbackKeywords/);

    const formulaDossierSource = sourceOf(namedFunction("requiredSourceFormulaDossierEntries"));
    assert.match(formulaDossierSource, /anchor\.exactText\?\.trim\(\)/);
    assert.match(formulaDossierSource, /verbatim canonical equation transcription/);
    assert.match(learnSource, /dossier\.requiredSourceFormulas is an exact-copy checklist/);
    assert.match(learnSource, /If failedProblems includes missing-source-formula/);

    const literalFormulaSheet = sourceOf(namedFunction("withVerbatimSourceFormulaCopySheet"));
    assert.match(literalFormulaSheet, /"\$\$",\s*exactText,\s*"\$\$"/);
    assert.match(literalFormulaSheet, /literal Markdown display blocks, not JSON strings/);
    assert.match(literalFormulaSheet, /two ASCII backslashes before &/);
    assert.match(literalFormulaSheet, /blocks,\s*payload/);
    const formulaRepairSelection = sourceOf(namedFunction("sourceFormulasNeedingVerbatimRepair"));
    assert.match(formulaRepairSelection, /problem\.code === "missing-source-formula"/);
    const formulaRepairFormatting = sourceOf(namedFunction("formatModelAuthoredLessonQualityProblemForRepair"));
    assert.match(formulaRepairFormatting, /VERBATIM SOURCE FORMULA COPY SHEET/);
    const generationSource = sourceOf(namedFunction("runTextbookGeneration"));
    assert.equal(
      (generationSource.match(/user:\s*withVerbatimSourceFormulaCopySheet\(/g) ?? []).length,
      2,
      "both initial generation and focused repair must receive the literal formula copy sheet",
    );
    assert.match(generationSource, /const formulasNeedingRepair = sourceFormulasNeedingVerbatimRepair/);

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

  test("status performs one lightweight read-only scan and no recovery writes", () => {
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

    const statusFunction = namedStatusFunction("getLearnStatusSnapshot");
    const statusSource = statusSourceOf(statusFunction);
    assert.equal(callsNamed(statusFunction, "scanStatusKnowledge").length, 1);
    assert.equal(callsNamed(statusFunction, "collectLearnSourceContext").length, 0);
    assert.equal(callsNamed(statusFunction, "scanClusterKnowledge").length, 0);
    assert.doesNotMatch(
      statusSource,
      /recoverAbandonedLearnJobs|refreshClusterIndex|rollbackLearnRun|migrateSources/,
    );
    assert.match(statusSource, /const hasTextbook = context\.hasTextbook/);
    assert.match(statusSource, /context\.incomplete \|\|/);
    assert.doesNotMatch(
      learnStatusSource,
      /writeFileSync|appendFileSync|mkdirSync|renameSync|setInterval|globalThis/,
    );
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
      /const requestSourceMap = async \(reauthorCycle: number\) => \{[\s\S]*?const artifactInventory = refreshSelectedSourceArtifactInventory\([\s\S]*?const sourceSetHash = context\.sourceSetHash[\s\S]*?const call = await callValidatedPlanningJson\([\s\S]*?return \{ call, artifactInventory, sourceSetHash \}/,
      "the full selected planning evidence must be captured immediately before every Source Map call",
    );
    assert.match(
      planningSource,
      /for \(;;\) \{[\s\S]*?ensureReferencedSourceArtifactsExtracted\([\s\S]*?const refreshedPlanningContext = collectLearnSourceContext\([\s\S]*?syllabusCoverageRebindSourceBindingProblems\([\s\S]*?context = refreshedPlanningContext[\s\S]*?const postSelectedPageArtifactInventory = refreshSelectedSourceArtifactInventory\([\s\S]*?const evidenceTransition = sourceMapPlanningEvidenceTransition\([\s\S]*?const reauthorCycle = sourceMapReauthorAttempts \+ 1;[\s\S]*?await rebindSyllabusCoverage\(reauthorCycle\);[\s\S]*?sourceMapRequest = await requestSourceMap\(reauthorCycle\)/,
      "every allowed formula-review or registry drift must refresh source context, rebind coverage, and re-author the complete Source Map",
    );
    assert.match(
      planningSource,
      /let sourceMapReauthorAttempts = 0;[\s\S]*?reauthorAttempts: sourceMapReauthorAttempts[\s\S]*?if \(evidenceTransition === "fail"\) \{[\s\S]*?MAX_SOURCE_MAP_EVIDENCE_REAUTHORS/,
      "the numeric Source Map reauthor counter must fail closed at its fixed cap",
    );
    assert.match(
      planningSource,
      /sourceMapAttempt: sourceMapReauthorAttempts \+ 1[\s\S]*?const reauthorCycle = sourceMapReauthorAttempts \+ 1;[\s\S]*?sourceMapReauthorAttempts = reauthorCycle/,
      "each complete model reauthor must have a truthful 1-based attempt receipt",
    );
    assert.match(
      planningSource,
      /const rebindSyllabusCoverage = async \(reauthorCycle: number\): Promise<void> => \{[\s\S]*?callValidatedPlanningJson\([\s\S]*?taskType:\s*"source_map"[\s\S]*?runSyllabusCoverageEvidenceRecovery\([\s\S]*?syllabusCoverageRecoveryReceiptProblems\([\s\S]*?syllabusCoverage = reboundCoverage/,
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
    assert.match(sourceMapValidation, /sourceMapArtifactKind\(artifact\.kind\)/);
    assert.match(sourceOf(namedFunction("promptSources")), /sourceMapPromptFigures\(context\.sourceFigures\)/);
    assert.match(planningSource, /sourceMapFigureAnchorPromptCatalog\(context\.sourceFigures\)/);
    assert.match(learnSource, /authoritative normalized Source Map artifact catalog/);
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
    const invalidReviewGate = generation.indexOf(
      "generationFormulaReview.newlyReplacedFormulaIds.length > 0",
      extraction,
    );
    const invalidReviewThrow = generation.indexOf(
      "throw new LearnPipelineConflictError(",
      invalidReviewGate,
    );
    const finalMapCas = generation.lastIndexOf("UPDATE learn_maps");
    const versionInsert = generation.indexOf("insertLearnVersion", finalMapCas);
    assert.ok(liveGate >= 0 && stagedGate > liveGate && extraction > stagedGate);
    assert.ok(postExtractionGate > extraction && contractWrite > postExtractionGate);
    assert.ok(
      invalidReviewGate > extraction &&
        postExtractionGate > invalidReviewGate &&
        invalidReviewThrow > invalidReviewGate &&
        invalidReviewThrow > postExtractionGate &&
        invalidReviewThrow < contractWrite,
      "a changed formula-review receipt must fail before contract or learner writes",
    );
    assert.match(
      generation.slice(invalidReviewThrow, contractWrite),
      /requiresReplan:\s*true/,
      "the failed background job must preserve the only valid recovery action",
    );
    assert.ok(finalMapCas > contractWrite && versionInsert > finalMapCas);
    assert.match(
      generation.slice(finalMapCas, versionInsert + 500),
      /status = 'confirmed'[\s\S]*?source_set_hash = \?[\s\S]*?source_artifact_inventory_hash = \?[\s\S]*?sourceArtifactInventoryHash:\s*context\.sourceArtifactInventoryHash/,
    );
    assert.match(
      generation.slice(contractWrite),
      /requiresReplan = learnFailureRequiresReplan\(error\)[\s\S]*?learn_failed[\s\S]*?requiresReplan[\s\S]*?updateLearnJob\(job\.id,[\s\S]*?requiresReplan/,
      "background generation failures must persist structured recovery state",
    );
  });

  test("status streams the exact canonical trimmed source body digest", () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "learn-status-digest-"));
    const sourcePath = path.join(temporaryRoot, "source.md");
    const body = " \r\n\tα one\n\n二 two\u00a0three 😀\r\n  ";
    fs.writeFileSync(sourcePath, body, "utf8");
    const streamBody = executableStatusNamedFunction("streamTrimmedStatusBody", {
      Buffer,
      StringDecoder,
      createHash,
      fs,
      STATUS_STREAM_CHUNK_BYTES: 5,
      STATUS_PENDING_WHITESPACE_LIMIT: 1024 * 1024,
    });
    const chunks = [];
    const descriptor = fs.openSync(sourcePath, "r");
    try {
      const projection = streamBody(
        descriptor,
        0,
        fs.fstatSync(descriptor).size,
        (value) => chunks.push(value),
      );
      const canonical = body.trim();
      assert.equal(chunks.join(""), canonical);
      assert.equal(
        projection.bodyHash,
        createHash("sha256").update(canonical).digest("hex"),
      );
      assert.equal(
        projection.wordCount,
        canonical.split(/\s+/).filter(Boolean).length,
      );
    } finally {
      fs.closeSync(descriptor);
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  test("status rejects non-canonical formula topology receipts", () => {
    const pageNumberFromAssetUrl = (assetUrl) => {
      const match = assetUrl.match(
        /-page-(\d{1,5})(?:-\d+)?\.(?:png|jpe?g|webp)$/i,
      );
      return match ? Number.parseInt(match[1], 10) : undefined;
    };
    const normalize = executableStatusNamedFunction("normalizeTopologyReceipts", {
      SHA256: /^[0-9a-f]{64}$/i,
      STATUS_SOURCE_VISUAL_LIMIT: 16_384,
      pageNumberFromAssetUrl,
    });
    const canonicalNormalize = executableSourceVisualsFunction(
      "normalizedSourceFormulaTopologyReviewPageReceipts",
      {
        isFullPageSnapshotUrl: (assetUrl) =>
          pageNumberFromAssetUrl(assetUrl) !== undefined,
        pageNumberFromAssetUrl,
      },
    );
    const project = (fn, value) => {
      try {
        return { ok: true, value: JSON.parse(JSON.stringify(fn(value))) };
      } catch {
        return { ok: false };
      }
    };
    const clone = (value) => JSON.parse(JSON.stringify(value));
    const assertParity = (value) => {
      assert.deepEqual(
        project(normalize, clone(value)),
        project(canonicalNormalize, clone(value)),
      );
    };
    const hash = "a".repeat(64);
    const receipt = {
      activeFormulaIds: ["S1.P2.E1"],
      pageImagePath: "/garden/assets/source-page-002.png",
      pageNumber: 2,
      recoveryCacheIntegritySha256: hash,
      recoveryCacheKey: hash,
      recoveryProtocol: "v7",
      sourceId: "source",
      topologyReviewCacheIntegritySha256: hash,
      topologyReviewCacheKey: hash,
    };
    assert.equal(normalize([receipt]).length, 1);
    for (const candidate of [
      [receipt],
      [{ ...receipt, unsupported: true }],
      [{ ...receipt, pageNumber: "2" }],
      [{ ...receipt, activeFormulaIds: ["S1.P3.E1"] }],
      [{ ...receipt, activeFormulaIds: ["S1.P2.E2", "S1.P2.E1"] }],
      [receipt, receipt],
      [{ ...receipt, recoveryCacheKey: "A".repeat(64) }],
      [{ ...receipt, pageImagePath: "/garden/assets/source-page-000.png" }],
    ]) {
      assertParity(candidate);
    }
  });

  test("status refuses an oversized formula manifest before reading it", () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "learn-status-formula-"));
    const manifestPath = path.join(temporaryRoot, "source-formula-review-set.json");
    const descriptor = fs.openSync(manifestPath, "w");
    try {
      fs.writeFileSync(descriptor, "{}\n", "utf8");
      fs.ftruncateSync(descriptor, 9 * 1024 * 1024);
    } finally {
      fs.closeSync(descriptor);
    }
    const readBounded = executableStatusNamedFunction("readBoundedStatusFile", {
      fs,
    });
    try {
      assert.throws(() => readBounded(manifestPath, 8 * 1024 * 1024));
      assert.match(
        statusSourceOf(namedStatusFunction("loadFormulaManifest")),
        /readBoundedStatusJson[\s\S]*?STATUS_FORMULA_MANIFEST_BYTE_LIMIT/,
      );
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  test("status does not expose a structurally invalid Learning Unit Contract", () => {
    const statusContractShapeIsBounded = executableStatusNamedFunction(
      "statusContractShapeIsBounded",
      {
        Buffer,
        STATUS_CONTRACT_NODE_LIMIT: 16_384,
        STATUS_CONTRACT_CONTAINER_LIMIT: 4_096,
        STATUS_CONTRACT_DEPTH_LIMIT: 64,
        STATUS_CONTRACT_STRING_BYTE_LIMIT: 64 * 1024,
        STATUS_CONTRACT_STRING_TOTAL_BYTE_LIMIT: 8 * 1024 * 1024,
      },
    );
    const isContractBacked = executableStatusNamedFunction(
      "isContractBackedLearningMap",
      {
        SHA256: /^[0-9a-f]{64}$/i,
        modelAuthoredLearningUnitParseProblems,
        statusContractShapeIsBounded,
        planningRecord: (value) =>
          value && typeof value === "object" && !Array.isArray(value) ? value : {},
      },
    );
    const hash = "a".repeat(64);
    assert.equal(
      isContractBacked({
        sourceArtifactInventoryHash: hash,
        coveragePlan: {
          sourceArtifactInventoryHash: hash,
          learningUnitContracts: [{}],
        },
      }),
      false,
    );
    assert.equal(statusContractShapeIsBounded(new Array(4_097).fill({})), false);
  });

  test("status requires a version's exact map and aggregates current artifact drift", () => {
    const status = statusSourceOf(namedStatusFunction("getLearnStatusSnapshot"));
    assert.match(
      status,
      /const versionMap = isContractBackedLearningMap\(versionMapCandidate\)/,
    );
    assert.match(
      status,
      /let sourceSetChanged =\s*context\.incomplete \|\|\s*Boolean\(latestVersion && !versionMap\) \|\|\s*learnLifecycleMapBindingMismatch[\s\S]*?learnSelectionDiffersFromMapBinding/,
    );
    assert.match(
      status,
      /sourceSetChanged =\s*sourceSetChanged \|\|\s*expectedSourceSetHash !== currentHash/,
      "artifact/hash refresh must not erase an earlier job-to-map binding mismatch",
    );
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

  test("status flags a newest-job selection paired with an unrelated fallback map", () => {
    const selectionDiffers = executableStatusNamedFunction("learnSelectionDiffersFromMapBinding");
    const currentSelection = {
      sourceIds: ["source-current-generic", "guide-current-generic"],
      syllabusSourceId: "guide-current-generic",
    };
    const exactMap = {
      sourceIds: [...currentSelection.sourceIds],
      syllabusSourceId: currentSelection.syllabusSourceId,
      sourceSetHash: "hash-current-generic",
    };
    const fallbackMap = {
      sourceIds: ["source-older-generic"],
      syllabusSourceId: undefined,
      sourceSetHash: "hash-older-generic",
    };

    assert.equal(
      selectionDiffers({
        selection: currentSelection,
        map: exactMap,
        jobSourceSetHash: "hash-current-generic",
      }),
      false,
      "the preserved confirmed input must remain a valid status binding after cancellation",
    );
    assert.equal(
      selectionDiffers({
        selection: currentSelection,
        map: fallbackMap,
        jobSourceSetHash: "hash-current-generic",
      }),
      true,
      "status must expose a stale fallback map instead of reporting an unchanged source set",
    );
  });

  test("status treats map identity as part of the published lifecycle binding", () => {
    const lifecycleMismatch = executableStatusNamedFunction("learnLifecycleMapBindingMismatch");
    const publishedMapId = "map-published-generic";
    const newerMapId = "map-newer-generic";

    assert.equal(
      lifecycleMismatch({
        versionMapId: publishedMapId,
        confirmedMapId: publishedMapId,
        jobMapId: publishedMapId,
      }),
      false,
      "normal generation stays current when version, confirmed map, and job share one map ID",
    );
    assert.equal(
      lifecycleMismatch({
        versionMapId: publishedMapId,
        confirmedMapId: newerMapId,
        jobMapId: newerMapId,
      }),
      true,
      "a same-source newer map cannot masquerade as the map that owns the published version",
    );
    assert.equal(
      lifecycleMismatch({
        versionMapId: publishedMapId,
        confirmedMapId: publishedMapId,
        jobMapId: newerMapId,
      }),
      true,
      "a newest job bound to a distinct map makes the published lifecycle stale",
    );
    assert.equal(
      lifecycleMismatch({
        confirmedMapId: newerMapId,
        jobMapId: newerMapId,
      }),
      false,
      "without a published version there is no version-to-map lifecycle mismatch",
    );
  });

  test("an ambiguous nested planning transport failure never repeats the authoritative request", async () => {
    const authoritativeCall = namedFunction("callPlanningJsonOnce");
    const authoritativeSource = sourceOf(authoritativeCall);
    assert.equal(
      callsNamed(authoritativeCall, "callCouncilJson").length,
      1,
      "one planning invocation must issue exactly one Council request",
    );
    assert.match(
      authoritativeSource,
      /catch \(error\)[\s\S]*?isLearnCancellationWithoutMaskingFailure\(jobId, error\)[\s\S]*?!isAmbiguousModelTransportFailure\(error\)[\s\S]*?learn_planning_transport_ambiguous[\s\S]*?modelTransportFailureEvidence\(error\)[\s\S]*?retryIssued:\s*false[\s\S]*?throw error/,
      "an ambiguous failure must leave deep durable evidence and rethrow the original error",
    );
    const timeoutCatch = authoritativeSource.slice(authoritativeSource.indexOf("catch (error)"));
    assert.doesNotMatch(
      timeoutCatch,
      /callCouncilJson|retryCouncilMode|LEARN_PLANNING_RETRY_COUNCIL_MODE/,
      "the timeout catch must not contain a hidden second provider call",
    );

    const providerCalls = [];
    const events = [];
    const resetCause = Object.assign(new Error("socket reset after request write"), {
      code: "ECONNRESET",
    });
    const originalFailure = new Error("Connection error.", { cause: resetCause });
    const executableSource = ts.transpileModule(
      `${authoritativeSource}\nglobalThis.testFunction = callPlanningJsonOnce;`,
      {
        compilerOptions: {
          module: ts.ModuleKind.None,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText;
    const sandbox = {
      LEARN_PLANNING_COUNCIL_MODE: "direct_council",
      LEARN_PLANNING_TIMEOUT_MS: 1234,
      callCouncilJson: async (request) => {
        providerCalls.push(request);
        throw originalFailure;
      },
      isLearnCancellationWithoutMaskingFailure: () => false,
      isAmbiguousModelTransportFailure,
      modelTransportFailureEvidence,
      appendLearnEvent: (...args) => events.push(args),
      errorMessage: (error) => error.message,
    };
    vm.runInNewContext(executableSource, sandbox);
    await assert.rejects(
      sandbox.testFunction({
        client: {},
        model: "model-generic",
        taskType: "source_map",
        gardenId: "garden-generic",
        system: "system-generic",
        user: "user-generic",
        sourceContext: { stage: "generic" },
        contentPath: "content-generic",
        jobId: "job-generic",
      }),
      (error) => error === originalFailure,
      "the exact ambiguous wrapper object must escape unchanged",
    );
    assert.equal(providerCalls.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(events)), [
      [
        "content-generic",
        "garden-generic",
        "learn_planning_transport_ambiguous",
        {
          jobId: "job-generic",
          taskType: "source_map",
          error: "Connection error.",
          transportFailure: {
            causes: [
              {
                name: "Error",
                message: "Connection error.",
                leaf: false,
              },
              {
                code: "ECONNRESET",
                name: "Error",
                message: "socket reset after request write",
                leaf: true,
              },
            ],
          },
          councilMode: "direct_council",
          retryIssued: false,
        },
      ],
    ]);

    const cancellation = new Error("Learn job cancelled");
    sandbox.callCouncilJson = async (request) => {
      providerCalls.push(request);
      throw cancellation;
    };
    sandbox.isLearnCancellationWithoutMaskingFailure = (_jobId, error) => error === cancellation;
    await assert.rejects(
      sandbox.testFunction({
        client: {},
        model: "model-generic",
        taskType: "scope_contract",
        gardenId: "garden-generic",
        system: "system-generic",
        user: "user-generic",
        sourceContext: { stage: "cancelled-generic" },
        contentPath: "content-generic",
        jobId: "job-cancelled-generic",
      }),
      (error) => error === cancellation,
      "the exact cancellation object must escape unchanged",
    );
    assert.equal(providerCalls.length, 2);
    assert.equal(
      events.length,
      1,
      "intentional job cancellation must not be mislabeled as transport ambiguity",
    );

    assert.doesNotMatch(
      learnSource,
      /LEARN_PLANNING_RETRY_COUNCIL_MODE|learn_planning_timeout_retry/,
      "obsolete retry configuration and events must stay removed",
    );

    const validatedPlanning = sourceOf(namedFunction("callValidatedPlanningJson"));
    assert.match(
      validatedPlanning,
      /let result = await callPlanningJsonOnce\([\s\S]*?\);\s*assertNonemptyPlanningCandidate\(result, stageLabel\);\s*let problems = validate\(result\.parsed\);\s*for \(let repairAttempt = 1; repairAttempt <= 2 && problems\.length > 0;[\s\S]*?result = await dispatchAfterDurablePlanningIssuance\([\s\S]*?dispatch: \(\) => callPlanningJsonOnce\([\s\S]*?\),\s*\}\);\s*assertNonemptyPlanningCandidate\(result, stageLabel\);/,
      "bounded semantic repair requires a nonempty returned candidate and concrete validation failure",
    );
    assert.equal(
      callsNamed(namedFunction("callValidatedPlanningJson"), "callPlanningJsonOnce").length,
      2,
      "validated planning has one initial call site and one validation-gated repair call site",
    );

    const assertPlanningCandidate = executableNamedFunction(
      "assertNonemptyPlanningCandidate",
      { stripMarkdownFence: (value) => value.trim() },
    );
    for (const missing of [
      { content: "", parsed: null },
      { content: "  \n", parsed: null },
      { content: "null", parsed: null },
      { content: "anything", parsed: undefined },
    ]) {
      assert.throws(
        () => assertPlanningCandidate(missing, "Generic planning stage"),
        /no usable nonempty candidate; no semantic repair request was issued/i,
      );
    }
    assert.doesNotThrow(
      () => assertPlanningCandidate(
        { content: "{nonempty malformed returned candidate", parsed: null },
        "Generic planning stage",
      ),
      "nonempty malformed provider text remains concrete validation evidence",
    );

    const planningSource = sourceOf(namedFunction("runLearnPlanning"));
    assert.match(
      planningSource,
      /let topicMapCall = await callPlanningJsonOnce\([\s\S]*?assertNonemptyPlanningCandidate\(topicMapCall, "Learning spine"\)/,
    );
    assert.match(
      planningSource,
      /const retryCall = await callPlanningJsonOnce\([\s\S]*?assertNonemptyPlanningCandidate\(retryCall, "Learning spine repair"\)/,
    );
    assert.match(
      planningSource,
      /const result = await callPlanningJsonOnce\([\s\S]*?assertNonemptyPlanningCandidate\(result, "Learning spine targeted repair"\)/,
      "specialized learning-spine loops must not turn an empty result into repair permission",
    );
  });

  test("planning cleanup and observers cannot replace the authoritative provider error", async () => {
    const rethrowAfterCleanup = executableNamedFunction(
      "rethrowAfterBestEffortLearnFailureCleanup",
    );
    const providerFailure = new Error("exact planning provider failure");
    const cleanupFailures = [
      () => {
        throw new Error("rollback fixture failed");
      },
      async () => {
        throw new Error("failure observer fixture failed");
      },
    ];
    for (const cleanup of cleanupFailures) {
      await assert.rejects(
        rethrowAfterCleanup(providerFailure, cleanup),
        (error) => error === providerFailure,
      );
    }

    const planningSource = sourceOf(namedFunction("runLearnPlanning"));
    assert.match(
      planningSource,
      /return rethrowAfterBestEffortLearnFailureCleanup\(error, async \(\) => \{/,
      "the complete planning rollback/diagnostic path must be subordinate to the original error",
    );
    assert.doesNotMatch(
      planningSource,
      /throw rollbackError/,
      "lease loss during rollback must stop stale cleanup without replacing the original provider error",
    );
    assert.match(
      planningSource,
      /finally \{[\s\S]*?try \{\s*disposeModelTracking\(\);[\s\S]*?try \{\s*lease\.release\(\);/,
      "planning finalizers must also remain subordinate to the authoritative outcome",
    );
  });

  test("text repair requests propagate provider failures and require returned validation evidence", async () => {
    const modelTextCandidateOrThrow = executableNamedFunction(
      "modelTextCandidateOrThrow",
      {
        cleanCouncilMarkdown: (content, fallback) =>
          typeof content === "string" ? content : fallback,
      },
    );
    const runRepair = executableNamedFunction("runValidatedTextRepairLoop", {
      cleanCouncilMarkdown: (content, fallback) =>
        typeof content === "string" ? content : fallback,
      modelTextCandidateOrThrow,
    });
    const failures = [
      new Error("Connection error.", {
        cause: Object.assign(new Error("socket reset after request write"), {
          code: "ECONNRESET",
        }),
      }),
      Object.assign(new Error("Request timed out."), {
        name: "APIConnectionTimeoutError",
      }),
      Object.assign(new Error("Request was aborted."), {
        name: "AbortError",
        code: "ABORT_ERR",
      }),
      Object.assign(new Error("HTTP 502 without request-bound authorization"), {
        status: 502,
      }),
      new Error("Response ended prematurely after partial output"),
    ];

    for (const failure of failures) {
      let requests = 0;
      let validations = 0;
      let reviews = 0;
      await assert.rejects(
        runRepair({
          maxAttempts: 3,
          request: async () => {
            requests += 1;
            throw failure;
          },
          validate: (markdown) => {
            validations += 1;
            return { markdown, problems: [] };
          },
          emptyResponseMessage: "empty response",
          onReviewed: () => {
            reviews += 1;
          },
        }),
        (error) => error === failure,
      );
      assert.equal(requests, 1);
      assert.equal(validations, 0);
      assert.equal(reviews, 0);
    }

    let emptyRequests = 0;
    await assert.rejects(
      runRepair({
        maxAttempts: 3,
        request: async () => {
          emptyRequests += 1;
          return "  ";
        },
        validate: () => {
          assert.fail("an empty response is not a semantic candidate");
        },
        emptyResponseMessage: "exact empty response failure",
      }),
      /exact empty response failure/,
    );
    assert.equal(emptyRequests, 1);

    for (const missingCandidate of ["null", "```json\nnull\n```"]) {
      let requests = 0;
      await assert.rejects(
        runRepair({
          maxAttempts: 3,
          request: async () => {
            requests += 1;
            return missingCandidate;
          },
          validate: () => {
            assert.fail("literal JSON null is not semantic validation evidence");
          },
          emptyResponseMessage: "exact missing text candidate",
        }),
        /literal JSON null/i,
      );
      assert.equal(requests, 1);
    }

    const requestEvidence = [];
    const reviewEvidence = [];
    const repaired = await runRepair({
      maxAttempts: 3,
      request: async (input) => {
        requestEvidence.push(JSON.parse(JSON.stringify(input)));
        return input.attempt === 1 ? "returned invalid draft" : "returned valid draft";
      },
      validate: (markdown) => ({
        markdown,
        problems: markdown.includes("invalid") ? ["missing-concrete-example"] : [],
      }),
      emptyResponseMessage: "empty response",
      onReviewed: (input) => reviewEvidence.push(JSON.parse(JSON.stringify(input))),
    });
    assert.deepEqual(JSON.parse(JSON.stringify(repaired)), {
      markdown: "returned valid draft",
      lastMarkdown: "returned valid draft",
      problems: [],
    });
    assert.deepEqual(requestEvidence, [
      { attempt: 1, previousMarkdown: "", failedProblems: [] },
      {
        attempt: 2,
        previousMarkdown: "returned invalid draft",
        failedProblems: ["missing-concrete-example"],
      },
    ]);

    const acceptedDespiteObserver = await runRepair({
      maxAttempts: 2,
      request: async () => "accepted draft",
      validate: (markdown) => ({ markdown, problems: [] }),
      emptyResponseMessage: "empty response",
      onReviewed: () => {
        throw new Error("review observer failed");
      },
    });
    assert.equal(acceptedDespiteObserver.markdown, "accepted draft");

    const generationSource = sourceOf(namedFunction("runTextbookGeneration"));
    assert.match(
      generationSource,
      /attemptBody = modelTextCandidateOrThrow\([\s\S]*?generated\.content/,
    );
    assert.match(
      generationSource,
      /const repairedBody = modelTextCandidateOrThrow\([\s\S]*?repaired\.content/,
    );
    assert.deepEqual(reviewEvidence.map(({ attempt, problems }) => ({ attempt, problems })), [
      { attempt: 1, problems: ["missing-concrete-example"] },
      { attempt: 2, problems: [] },
    ]);
  });

  test("source scans and lesson generation have no throw-to-repair escape hatch", () => {
    const referencedScan = namedFunction("ensureReferencedSourceArtifactsExtracted");
    const eagerScan = namedFunction("ensureSourceVisualsExtracted");
    assert.equal(callsNamed(referencedScan, "extractSourceVisuals").length, 1);
    assert.equal(callsNamed(eagerScan, "extractSourceVisuals").length, 1);
    assert.doesNotMatch(sourceOf(referencedScan), /\bcatch\s*\(/);
    assert.doesNotMatch(sourceOf(eagerScan), /\bcatch\s*\(/);

    const planningSource = sourceOf(namedFunction("runLearnPlanning"));
    const reconcileStart = planningSource.indexOf(
      "const reconcilePlannedSourceArtifacts = async",
    );
    const reconcileEnd = planningSource.indexOf(
      'learningUnits = await reconcilePlannedSourceArtifacts(learningUnits, "initial")',
      reconcileStart,
    );
    assert.ok(reconcileStart >= 0 && reconcileEnd > reconcileStart);
    const reconcileSource = planningSource.slice(reconcileStart, reconcileEnd);
    assert.match(
      reconcileSource,
      /const resolution = await ensureReferencedSourceArtifactsExtracted\(/,
    );
    assert.doesNotMatch(
      reconcileSource,
      /Referenced source-page scan could not finish|learn_referenced_source_scan_failed|catch\s*\(/,
      "a late referenced-page provider failure must escape before any later model work",
    );
    assert.doesNotMatch(
      learnSource,
      /learn_referenced_source_scan_failed/,
      "planning and generation must not downgrade an exact scan failure to a warning",
    );

    const generationSource = sourceOf(namedFunction("runTextbookGeneration"));
    assert.match(
      generationSource,
      /const referencedArtifactResolution = await ensureReferencedSourceArtifactsExtracted\([\s\S]*?ledgerVisuals = loadSourceVisuals/,
    );
    const lessonStart = generationSource.indexOf("// Stage 4: bounded model generation and repair");
    const lessonEnd = generationSource.indexOf(
      "throwIfLearnCancelled(job.id);",
      lessonStart,
    );
    assert.ok(lessonStart >= 0 && lessonEnd > lessonStart);
    const lessonSource = generationSource.slice(lessonStart, lessonEnd);
    assert.doesNotMatch(lessonSource, /\bcatch\s*\(/);
    assert.match(
      lessonSource,
      /attempt > 0[\s\S]*?!lastAttemptBody\.trim\(\)[\s\S]*?failedProblemCodes\.length === 0/,
    );
    assert.match(
      lessonSource,
      /if \(quality\.hardFail\)[\s\S]*?const hardQualityProblems = quality\.problems\.filter\(\(problem\) => problem\.hard\)[\s\S]*?taskType: "subsection_repair"/,
    );
    assert.doesNotMatch(
      learnSource,
      /LEARN_ENABLE_UNCONDITIONAL_REVISION|taskType: "full_page_revision"/,
    );

    assert.match(
      generationSource,
      /catch \(criticError\) \{\s*try \{[\s\S]*?learn_critic_loop_failed[\s\S]*?\} catch \{[\s\S]*?throw criticError;/,
      "critic diagnostics must not replace the exact provider failure",
    );
    const terminalFailureStart = generationSource.lastIndexOf(
      "if (isLearnCancellationWithoutMaskingFailure(job.id, error))",
    );
    assert.ok(terminalFailureStart >= 0);
    const terminalFailureSource = generationSource.slice(terminalFailureStart);
    assert.match(
      terminalFailureSource,
      /return rethrowAfterBestEffortLearnFailureCleanup\(error, async \(\) => \{[\s\S]*?try \{[\s\S]*?appendLearnEvent\([\s\S]*?"learn_failed"[\s\S]*?\} catch \{[\s\S]*?try \{[\s\S]*?updateLearnJob\([\s\S]*?\} catch \{/,
      "terminal event/status diagnostics must remain best-effort before exact rethrow",
    );
  });

  test("learning-spine repair carries the strongest rejected candidate with its exact problem history", () => {
    const planningSource = sourceOf(namedFunction("runLearnPlanning"));
    const repairStart = planningSource.indexOf("let topicMapCall = await callPlanningJsonOnce");
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
      /let topicMapCall = await callPlanningJsonOnce\(\{[\s\S]*?taskType:\s*"learning_spine"[\s\S]*?preserveExactContent:\s*true[\s\S]*?\}\);/,
      "the initial candidate must retain exact provider text before entering the lineage",
    );
    assert.match(
      repairSource,
      /const retryCall = await callPlanningJsonOnce\(\{[\s\S]*?taskType:\s*"learning_spine"[\s\S]*?preserveExactContent:\s*true[\s\S]*?\}\);/,
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
      (repairSource.match(/callPlanningJsonOnce\(/g) ?? []).length,
      3,
      "the initial/full-replacement call sites stay intact and targeted model repair has its own provider call",
    );
    assert.match(repairSource, /runLearningSpineTargetedRepair\([\s\S]*?maxAttempts:\s*2/);
    assert.match(repairSource, /describeLearningSpineRepairAttempts\(\{[\s\S]*?fullContractAttempts:\s*3/);
    assert.match(repairSource, /targetedCalls:\s*targetedRepairOutcome\?\.calls \?\? 0/);
    assert.match(repairSource, /targetedStatus:\s*targetedRepairOutcome\?\.status \?\? "not_run"/);
    assert.match(repairSource, /No fallback curriculum was written/);
    assert.match(
      learnSource,
      /role names the unit's teaching move, never the type of source artifact it owns[\s\S]*?verified formula may support any semantically appropriate role[\s\S]*?at least three appropriate roles[\s\S]*?conceptual\/mechanism[\s\S]*?application\/interpretation\/synthesis\/practice/,
    );
    assert.match(
      learnSource,
      /Treat role as the teaching move rather than the owned artifact type:[\s\S]*?never turn concept\/mechanism\/application\/interpretation\/synthesis\/practice units into formula units merely because they own equations/,
    );
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

  test("native Runtime startup owns the single-flight Learn recovery schedule", () => {
    assert.match(
      nativeServiceEngineSource,
      /RuntimeScheduleRegistration::fixed\("learn-recovery", 0, 60_000\)/,
    );
    assert.match(
      nativeServiceEngineSource,
      /claim_due_runtime_schedule\(now_ms\)/,
    );
    assert.match(
      nativeServiceEngineSource,
      /occurrence\.schedule_id == "learn-recovery"[\s\S]*?registry\.submit_job/,
    );
    assert.match(
      nativeServiceEngineSource,
      /bind_runtime_schedule_occurrence_job\([\s\S]*?&occurrence,[\s\S]*?&job\.job_id/,
    );
    assert.equal(
      fs.existsSync(path.join(dashboardRoot, "src", "instrumentation-node.ts")),
      false,
      "the dashboard must not revive a second recovery timer",
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
      'status: restorePending ? "writing_quartz" : "failed"',
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
  test("abandoned-job recovery terminalizes token lifecycles atomically", () => {
    const terminalCommit = sourceOf(
      namedFunction("commitRecoveredLearnJobTerminalState"),
    );
    const statusIndex = terminalCommit.indexOf("updateLearnJobExpectStatus");
    const usageIndex = terminalCommit.indexOf(
      "reconcilePersistedLearnTokenUsageForTerminalJob",
    );
    assert.ok(statusIndex >= 0 && usageIndex > statusIndex);
    assert.match(terminalCommit, /return db\.transaction\(\(\) => \{/);
    assert.match(terminalCommit, /\}\)\.immediate\(\);/);
    assert.doesNotMatch(terminalCommit, /catch\s*\(/);

    const recoverySource = sourceOf(namedFunction("recoverAbandonedLearnJobs"));
    const cutoffIndex = recoverySource.indexOf(
      "LEARN_JOB_ABANDONED_AFTER_MS",
    );
    const staleTerminalIndex = recoverySource.indexOf(
      "reconcilePersistedLearnTokenUsageForStaleTerminalJobs",
    );
    const candidateQueryIndex = recoverySource.indexOf("const candidates = db");
    assert.ok(
      cutoffIndex >= 0 &&
        staleTerminalIndex > cutoffIndex &&
        candidateQueryIndex > staleTerminalIndex,
      "startup must age-fence and reconcile older terminal rows before its active-job sweep",
    );
    assert.equal(
      recoverySource.match(/commitRecoveredLearnJobTerminalState\(/g)?.length,
      2,
      "both superseded and rolled-back abandoned jobs must reconcile usage",
    );
  });

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
    const terminalIndex = recoverySource.indexOf(
      "commitRecoveredLearnJobTerminalState",
      cancellationIndex,
    );
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
    const generationCancelIndex = generationSource.indexOf("if (isLearnCancellationWithoutMaskingFailure(job.id, error))");
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
    const confirmationSource = sourceOf(
      namedFunction("confirmLearnLeaseForFailureCleanup"),
    );
    assert.match(confirmationSource, /lease\.lost/);
    assert.match(confirmationSource, /leaseLostLearnJobs\.has\(jobId\)/);
    assert.match(confirmationSource, /lease\.confirmOwnership\(\)/);
    assert.match(confirmationSource, /ownership === "owned"/);
    assert.match(confirmationSource, /ownership === "lost"/);
    assert.match(confirmationSource, /Atomics\.wait/);

    for (const [functionName, ownershipHelper] of [
      ["runLearnPlanning", "stillOwnPlanningLease"],
      ["runTextbookGeneration", "stillOwnGenerationLease"],
      ["runLearnRepairOperation", "stillOwnRepairLease"],
    ]) {
      const functionSource = sourceOf(namedFunction(functionName));
      assert.match(
        functionSource,
        new RegExp(`const ${ownershipHelper} = \\(\\): boolean => \\{[\\s\\S]*?confirmLearnLeaseForFailureCleanup\\(lease, job\\.id\\)`),
        `${functionName} must freshly and safely verify lease ownership before rollback`,
      );
      assert.match(
        functionSource,
        new RegExp(`if \\(!${ownershipHelper}\\(\\)\\) \\{[\\s\\S]{0,300}?throw error;`),
        `${functionName} must leave cleanup to the new fenced owner after lease loss`,
      );
    }

    const repairSource = sourceOf(namedFunction("runLearnRepairOperation"));
    assert.match(
      repairSource,
      /finally \{[\s\S]*?!lease\.lost[\s\S]*?!leaseLostLearnJobs\.has\(job\.id\)[\s\S]*?learnRunSnapshotDir/,
    );

    const rebuildSource = sourceOf(namedFunction("rebuildEntireGarden"));
    const ownershipIndex = rebuildSource.indexOf("const stillOwnRebuildLease");
    const confirmationIndex = rebuildSource.indexOf(
      "confirmLearnLeaseForFailureCleanup(rebuildLease, planningJobId)",
      ownershipIndex,
    );
    const ownershipGuardIndex = rebuildSource.indexOf(
      "!stillOwnRebuildLease()",
      confirmationIndex,
    );
    const throwIndex = rebuildSource.indexOf("throw error", ownershipGuardIndex);
    const rollbackIndex = rebuildSource.indexOf("await rollbackLearnRun", throwIndex);
    assert.ok(
      ownershipIndex >= 0 &&
        confirmationIndex > ownershipIndex &&
        ownershipGuardIndex > confirmationIndex &&
        throwIndex > ownershipGuardIndex &&
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
    const sourceParentName = path.basename(path.dirname(String(source)));
    if (
      path.resolve(String(target)) === path.resolve(destination) &&
      (sourceParentName.startsWith(".garden.incoming-") ||
        sourceName.startsWith(".garden.incoming-") ||
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
