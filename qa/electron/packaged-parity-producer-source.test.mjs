import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const electronDir = path.dirname(fileURLToPath(import.meta.url));
const producerPath = path.join(
  electronDir,
  "specs",
  "packaged-parity",
  "runtime-v2-feature-parity.spec.ts",
);
const workflowPath = path.join(electronDir, "packaged-parity-workflows.ts");

function indexOfRequired(source, pattern, label) {
  const match = pattern.exec(source);
  assert.ok(match, `packaged parity producer must contain ${label}`);
  return match.index;
}

test("packaged parity producer is a direct fail-closed observation and receipt authority", () => {
  assert.equal(
    fs.statSync(producerPath, { throwIfNoEntry: false })?.isFile(),
    true,
    "the packaged Runtime V2 parity producer spec must exist",
  );
  const source = fs.readFileSync(producerPath, "utf8");

  const packageContext = indexOfRequired(
    source,
    /\bopenParityEvidencePackageRun\s*\(/u,
    "a literal openParityEvidencePackageRun call",
  );
  const harnessConstruction = indexOfRequired(
    source,
    /\bnew\s+ElectronQaHarness\s*\(/u,
    "an explicit packaged ElectronQaHarness construction",
  );
  const harnessStart = indexOfRequired(
    source,
    /\b(?:qa|harness)\.start\s*\(/u,
    "an explicit harness start",
  );
  const acceptanceGapGate = indexOfRequired(
    source,
    /\bassertNoPackagedParityAcceptanceGaps\s*\(/u,
    "an explicit pre-launch acceptance-gap gate",
  );
  const observation = indexOfRequired(
    source,
    /\brecordParityEvidenceObservation\s*\(/u,
    "a literal recordParityEvidenceObservation call",
  );
  indexOfRequired(
    source,
    /\brecordParityEvidenceFailure\s*\(/u,
    "a literal recordParityEvidenceFailure call",
  );
  const completeCoverage = indexOfRequired(
    source,
    /\bassertCompletePackagedParityOutcomes\s*\(/u,
    "a literal complete-coverage assertion",
  );
  const blockerAuthority = indexOfRequired(
    source,
    /\bassertPublishableBlockedOutcome\s*\(/u,
    "a literal frozen blocker-authority assertion",
  );
  const shutdown = indexOfRequired(
    source,
    /\b(?:qa|harness)\.shutdown\s*\(\s*\{[^}]*\bassertPortsReleased\s*:\s*true/u,
    "an explicit packaged shutdown with port-release enforcement",
  );
  const processCleanup = indexOfRequired(
    source,
    /\bassertPackagedProcessCleanup\s*\(/u,
    "a literal packaged process-tree cleanup assertion",
  );
  const publication = indexOfRequired(
    source,
    /\bpublishOutcomes\s*\(\s*\{/u,
    "observation publication after cleanup",
  );
  const receipt = indexOfRequired(
    source,
    /\brecordParityEvidenceReceipt\s*\(/u,
    "a literal recordParityEvidenceReceipt call",
  );

  assert.ok(packageContext < harnessConstruction, "package observation context must open before harness construction");
  assert.ok(packageContext < harnessStart, "package observation context must open before Electron starts");
  assert.ok(packageContext < acceptanceGapGate, "acceptance gaps must be evaluated under sealed package authority");
  assert.ok(acceptanceGapGate < harnessStart, "known coverage gaps must stop the run before Electron starts");
  assert.ok(harnessStart < observation, "observations must come from a running packaged Electron session");
  assert.ok(completeCoverage < blockerAuthority, "complete workflow coverage must precede blocker publication authority");
  assert.ok(blockerAuthority < shutdown, "all blocker authority must be resolved before packaged shutdown");
  assert.ok(shutdown < processCleanup, "process cleanup must be checked only after explicit shutdown");
  assert.ok(processCleanup < publication, "no observation may publish before process-tree cleanup passes");
  assert.ok(publication < receipt, "observations must publish before their receipt is sealed");
  assert.ok(completeCoverage < receipt, "all 496 workflow outcomes must be accounted for before receipt publication");

  assert.match(source, /mode\s*:\s*["']packaged["']/u);
  assert.match(source, /desktopConfigProfile\s*:\s*["']production-required["']/u);
  assert.doesNotMatch(source, /\b(?:page|context|browserContext)\.route\s*\(/u, "network interception is not observation");
  assert.doesNotMatch(source, /\brouteFromHAR\s*\(/u, "HAR replay is not packaged runtime evidence");
  assert.doesNotMatch(source, /\b(?:route\.)?(?:fulfill|abort|continue)\s*\(/u, "synthetic routed responses are forbidden");
  assert.doesNotMatch(source, /\bsetContent\s*\(/u, "injected HTML is not normal UI evidence");
  assert.doesNotMatch(source, /\b(?:mock|stub|fake)(?:Response|Result|Output)\b/iu, "mocked outcomes are forbidden");
  assert.doesNotMatch(source, /\bresult\s*:\s*["']PASS["']/u, "a literal canned PASS result is forbidden");
  assert.doesNotMatch(source, /(?:\?\?|\|\|)\s*["']PASS["']/u, "a PASS fallback is forbidden");
});

test("chat-surface rows use exact packaged UI entry points and transport identities", () => {
  const producer = fs.readFileSync(producerPath, "utf8");
  const workflows = fs.readFileSync(workflowPath, "utf8");

  assert.match(producer, /\bcreateGarden\s*\(/u);
  assert.match(producer, /\buploadDocuments\s*\(/u);
  assert.match(producer, /ORCHARD-VIOLET-12/u, "Garden authority must include visible Quartz publication proof");
  assert.match(producer, /\buiAuthority\b/u);

  for (const capabilityId of [
    "surface:dashboard-terminal",
    "surface:garden-chat",
    "surface:legacy-garden-chat",
    "surface:quartz-ai",
    "surface:temporary-chat",
  ]) {
    assert.match(workflows, new RegExp(capabilityId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  }
  assert.match(workflows, /Ask anything across your gardens/u);
  assert.match(workflows, /Ask about your documents/u);
  assert.match(workflows, /Ask about a topic, page, source, or link/u);
  assert.match(workflows, /Open Assistant for this page/u);
  assert.match(workflows, /Turn on temporary chat/u);
  assert.match(workflows, /temporary:true/u);
  assert.match(workflows, /selectedDocumentSlugs:present/u);
  assert.match(workflows, /activeMarkdown:present/u);
  assert.match(workflows, /context\.pageSlug:present/u);
  assert.match(workflows, /\bexerciseFollowUp\s*\(/u);
  assert.match(workflows, /sameConversationObserved/u);
  assert.match(workflows, /priorContextObserved/u);
  assert.match(workflows, /followUpConversationIds\.some\(\(conversationId\) => conversationId !== primaryConversationId\)/u);
  assert.match(workflows, /!followUp\.outputText\.includes\(primaryMarker\)/u);
  assert.match(workflows, /sourceProvenPreMigrationSemantics/u);
  assert.match(workflows, /reasonCode:\s*plan\.recovery\.notApplicable\.reasonCode/u);
  assert.match(workflows, /recoveryAuthority/u);
  assert.match(workflows, /scenarioKind:\s*plan\.recovery\.scenarioKind/u);
  assert.match(workflows, /plan\.output\.driverKind === null/u);
  assert.match(workflows, /generic chat workflow is forbidden/u);
  assert.match(workflows, /plan\.recovery\.supported && plan\.recovery\.driverKind === null/u);
  assert.match(workflows, /recovery driver; the workflow cannot start/u);

  assert.doesNotMatch(workflows, /\b(?:page|context|browserContext)\.route\s*\(/u);
  assert.doesNotMatch(workflows, /\bsetContent\s*\(/u);
});

test("persona and model recovery drivers cross real UI boundaries and retain exact context", () => {
  const producer = fs.readFileSync(producerPath, "utf8");
  const workflows = fs.readFileSync(workflowPath, "utf8");
  const recoveryState = fs.readFileSync(
    path.join(electronDir, "packaged-parity-recovery-state.mjs"),
    "utf8",
  );

  assert.match(workflows, /plan\.recovery\.driverKind === "SOURCE_SELECTION_FAIL_CLOSED"/u);
  assert.match(workflows, /\binjectUnresolvablePersonaSelection\s*\(/u);
  assert.match(workflows, /The selected Agency Agent is no longer available and was cleared\./u);
  assert.match(workflows, /messageDispatchCountSince\(cursor\) !== 0/u);
  assert.match(workflows, /\breadInjectedPersonaSelection\s*\(/u);
  assert.match(workflows, /\bsubmitDashboardRecoveryTurn\s*\([\s\S]*?plan,/u);
  assert.match(workflows, /sourceContextRestored:\s*true/u);
  assert.match(workflows, /unresolvableSelectionInjected:\s*true/u);
  assert.match(workflows, /truthfulFailurePresentationObserved:\s*true/u);

  assert.match(workflows, /plan\.recovery\.driverKind === "STORED_SELECTION_APP_RESTART"/u);
  assert.match(workflows, /\bqa\.restart\s*\(\s*\{\s*assertPortsReleased:\s*true/u);
  assert.match(workflows, /\bensureAuthenticatedDashboard\s*\(/u);
  assert.match(workflows, /toHaveClass\(\/\\bneu-selected\\b\/u/u);
  assert.match(workflows, /requestUsedModelSince\(cursor, selectedIdentity\)/u);
  assert.match(workflows, /postRestartRequestUsedSelection:\s*true/u);
  assert.match(workflows, /appRestartObserved:\s*true/u);
  assert.match(workflows, /\bassertSameConversationAfterBoundary\s*\(/u);
  assert.match(workflows, /!turn\.outputText\.includes\(primaryMarker\)/u);
  assert.match(workflows, /\bassertNoUnexpectedRuntimeJobs\s*\(/u);
  assert.match(workflows, /recoveryBefore\.runtimeOwnedProcessIds/u);
  assert.match(producer, /const shutdownRoots = \[await qa\.mainProcessPid\(\), qa\.readEndpoints\(\)\.pid\]/u);

  assert.match(recoveryState, /\.breadboard-qa-run\.json/u);
  assert.match(recoveryState, /dataDir is not the isolated QA run's exact user-data\/Data directory/u);
  assert.match(recoveryState, /WHERE id = \? AND public_id = \? AND active_agency_agent_slug = \?/u);
  assert.doesNotMatch(workflows, /fetch\([^\n]*\/api\/hermes\/sessions\/[^\n]*agency-agent/u);
  assert.doesNotMatch(workflows, /(?:page|context|browserContext)\.route\s*\(/u);
});
