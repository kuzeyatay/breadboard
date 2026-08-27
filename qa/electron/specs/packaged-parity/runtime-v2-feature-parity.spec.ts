import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { expect, test as playwrightTest } from "@playwright/test";

import { createQaEnvironment } from "../../environment";
import { ElectronQaHarness } from "../../fixtures";
import {
  assertCompletePackagedParityOutcomes,
  assertNoPackagedParityAcceptanceGaps,
  assertPublishableBlockedOutcome,
  buildPackagedParityPlan,
  type PackagedParityPlan,
} from "../../packaged-parity-plan.mjs";
import {
  assertMandatoryServiceRegistration,
} from "../../packaged-parity-runtime-evidence.mjs";
import {
  assertPackagedProcessCleanup,
  capturePackagedRuntimeSnapshot,
} from "../../packaged-parity-runtime";
import {
  runPackagedCapabilityWorkflow,
  type PackagedParityWorkflowOutcome,
} from "../../packaged-parity-workflows";
import { readPackagedParityHandoff } from "../../run-qa-options.mjs";
import {
  createGarden,
  openGardenWorkspace,
  registerAndSignIn,
  uploadDocuments,
} from "../../user-journeys";
// These JavaScript contracts deliberately retain their runtime validation as
// the authority. The calls remain in this allowlisted spec because the
// observation module verifies the actual caller stack and producer source.
import {
  closeParityEvidencePackageRun,
  openParityEvidencePackageRun,
  recordParityEvidenceFailure,
  recordParityEvidenceObservation,
} from "../../../runtime-v2/parity-evidence-observation.mjs";
import { recordParityEvidenceReceipt } from "../../../runtime-v2/parity-evidence-contract.mjs";

const PRODUCER_PATH = "qa/electron/specs/packaged-parity/runtime-v2-feature-parity.spec.ts";
const EVIDENCE_TYPES = ["electron", "service", "worker", "output", "cancellation", "recovery"] as const;

playwrightTest("all frozen Runtime V2 capabilities in one sealed packaged Electron run", async () => {
  // Observation/receipt freshness is capped at twelve hours by the evidence
  // contract. Stop with no receipt before crossing that authority boundary.
  playwrightTest.setTimeout(11 * 60 * 60_000);
  const repoRoot = path.resolve(__dirname, "..", "..", "..", "..");
  const handoff = readPackagedParityHandoff({ repoRoot });
  const packageRunContext = openParityEvidencePackageRun({
    repoRoot,
    packageVerifierReceiptPath: handoff.packageReceiptPath,
    executablePath: handoff.executablePath,
    runId: handoff.runId,
  });
  const packageOpenedAtMs = Date.now();
  const inventory = readJson(path.join(repoRoot, "qa", "runtime-v2", "feature-parity.json"));
  const serviceManifest = readJson(path.join(repoRoot, "desktop", "runtime-v2", "manifests", "services.json"));
  const workerManifest = readJson(path.join(repoRoot, "desktop", "runtime-v2", "manifests", "workers.json"));
  const plans = buildPackagedParityPlan({ inventory, serviceManifest, workerManifest });
  const run = createQaEnvironment({
    repoRoot,
    runId: handoff.runId,
    preserve: "on-failure",
    providerAuthFile: process.env["BREADBOARD_QA_PROVIDER_AUTH_FILE"],
    desktopConfigProfile: "production-required",
    gbrainMode: "required",
    env: { BREADBOARD_DESKTOP_DASHBOARD_MODE: "standalone" },
  });
  const qa = new ElectronQaHarness(run, {
    mode: "packaged",
    executablePath: handoff.executablePath,
  });

  let completed = false;
  try {
    // Known missing UI or exhaustive drivers are acceptance failures, not a
    // reason to launch Electron and later mislabel a representative turn as
    // full parity. This gate runs after sealed package authority opens and
    // before the packaged executable starts.
    assertNoPackagedParityAcceptanceGaps(plans);
    await qa.start();
    const page = await qa.dismissWelcome();
    await registerAndSignIn(page, qa.run.bootstrap.auth, 3 * 60_000);
    const startupRoots = [await qa.mainProcessPid(), qa.readEndpoints().pid];
    const startup = capturePackagedRuntimeSnapshot({
      repoRoot,
      dataDir: qa.run.paths.dataDir,
      endpoints: qa.readEndpoints().urls,
      runtimeRootPids: startupRoots,
    });
    assertMandatoryServiceRegistration(serviceManifest, startup);

    // All Garden-bound rows share one real, isolated UI authority. A visible
    // document inside the Quartz iframe proves that upload and static
    // publication completed; garden creation alone is not publication proof.
    const garden = await createGarden(page, {
      name: `Packaged parity ${handoff.runId.slice(-12)}`,
      description: "Isolated packaged Runtime V2 parity authority",
    }, 3 * 60_000);
    await openGardenWorkspace(page, garden, 3 * 60_000);
    const uploaded = await uploadDocuments(page, [
      path.join(repoRoot, "qa", "fixtures", "orchard-notes.txt"),
    ], 15 * 60_000);
    const quartzDocumentTitle = uploaded[0]?.displayedTitle;
    if (!quartzDocumentTitle) throw new Error("The packaged parity Garden produced no published document identity.");
    await Promise.all([
      page.waitForURL((url) => url.pathname === `/garden/${garden.slug}`, { timeout: 5 * 60_000 }),
      page.getByRole("link", { name: quartzDocumentTitle, exact: true }).first().click(),
    ]);
    await expect(
      page.frameLocator(`iframe[title="${escapeCssString(`${garden.name} garden`)}"]`)
        .getByText("ORCHARD-VIOLET-12", { exact: false }).first(),
    ).toBeVisible({ timeout: 5 * 60_000 });
    await openGardenWorkspace(page, garden, 3 * 60_000);
    await Promise.all([
      page.waitForURL((url) => url.pathname === "/dashboard", { timeout: 3 * 60_000 }),
      page.getByRole("link", { name: "Back to dashboard", exact: true }).click(),
    ]);
    await assertAuthenticatedDashboardReady(page);
    const uiAuthority = { garden, quartzDocumentTitle } as const;

    const outcomes: PackagedParityWorkflowOutcome[] = [];
    for (const plan of plans) {
      outcomes.push(await runPackagedCapabilityWorkflow({
        qa,
        plan,
        parityRunId: handoff.runId,
        packageOpenedAtMs,
        uiAuthority,
      }));
    }
    assertCompletePackagedParityOutcomes(plans, outcomes);

    // A newly unavailable provider/credential/software dependency is not a
    // baseline blocker. Validate every blocked outcome before publishing even
    // one observation, so a failed authority check leaves diagnostics but no
    // partial evidence set that could be mistaken for acceptance.
    const plansById = new Map(plans.map((plan) => [plan.capabilityId, plan]));
    for (const outcome of outcomes) {
      if (outcome.result === "BLOCKED") {
        assertPublishableBlockedOutcome(requiredPlan(plansById, outcome.capabilityId), outcome);
      }
    }

    // Stored-model recovery performs genuine same-profile Electron restarts.
    // Rebind final cleanup authority to the currently running packaged tree,
    // never the PIDs captured before those restart scenarios.
    const shutdownRoots = [await qa.mainProcessPid(), qa.readEndpoints().pid];
    const beforeShutdown = capturePackagedRuntimeSnapshot({
      repoRoot,
      dataDir: qa.run.paths.dataDir,
      endpoints: qa.readEndpoints().urls,
      runtimeRootPids: shutdownRoots,
    });
    const shutdown = await qa.shutdown({ assertPortsReleased: true, timeoutMs: 180_000 });
    const afterShutdown = capturePackagedRuntimeSnapshot({
      repoRoot,
      dataDir: qa.run.paths.dataDir,
      endpoints: shutdown.endpoints.urls,
      runtimeRootPids: shutdownRoots,
    });
    const cleanup = assertPackagedProcessCleanup(beforeShutdown, afterShutdown);
    const cleanupPath = writeCleanupArtifact(repoRoot, handoff.runId, {
      schemaVersion: 1,
      kind: "breadboard-packaged-parity-cleanup",
      runId: handoff.runId,
      mainPid: shutdown.mainPid,
      exitCode: shutdown.exitCode,
      signalCode: shutdown.signalCode,
      releasedPorts: shutdown.releasedPorts,
      trackedProcessIdsSha256: hash(cleanup.trackedProcessIds.join(",")),
      trackedProcessCount: cleanup.trackedProcessIds.length,
      releasedServiceIds: cleanup.releasedServiceIds,
      recordedAt: new Date().toISOString(),
    });

    const observationPaths = publishOutcomes({
      repoRoot,
      runId: handoff.runId,
      packageRunContext,
      outcomes,
      cleanupPath,
    });
    // Recheck the exact frozen set immediately before the only receipt seal.
    // A subset of valid observations is diagnostics, never parity completion.
    assertCompletePackagedParityOutcomes(plans, outcomes);
    if (observationPaths.length < outcomes.length) {
      throw new Error("Every packaged workflow must publish at least one immutable observation.");
    }
    recordParityEvidenceReceipt({
      repoRoot,
      receiptPath: `.qa-results/parity/${handoff.runId}/receipt.json`,
      observationPaths,
      executablePath: handoff.executablePath,
      packageVerifierReceiptPath: handoff.packageReceiptPath,
    });
    completed = true;
  } catch (error) {
    qa.markFailed();
    throw error;
  } finally {
    try {
      closeParityEvidencePackageRun(packageRunContext);
    } finally {
      if (!completed) qa.markFailed();
      await qa.teardown();
    }
  }
});

function publishOutcomes(options: {
  readonly repoRoot: string;
  readonly runId: string;
  readonly packageRunContext: unknown;
  readonly outcomes: readonly PackagedParityWorkflowOutcome[];
  readonly cleanupPath: string;
}): string[] {
  const paths: string[] = [];
  for (const outcome of options.outcomes) {
    if (outcome.result === "BLOCKED") {
      // assertPublishableBlockedOutcome deliberately runs before this helper.
      // No current workflow can reach here without authenticated old-package
      // blocker authority and six actual blocked claim sets.
      throw new Error(`${outcome.capabilityId} has no publishable six-part BLOCKED observation set.`);
    }
    if (outcome.result === "FAIL") {
      if (!outcome.failure) throw new Error(`${outcome.capabilityId} FAIL has no visible failure identity.`);
      const observationPath = observationPathFor(options.runId, outcome.capabilityId, "electron", 0);
      recordParityEvidenceFailure({
        repoRoot: options.repoRoot,
        observationPath,
        producerPath: PRODUCER_PATH,
        packageRunContext: options.packageRunContext,
        runId: options.runId,
        capabilityId: outcome.capabilityId,
        workflowIdentity: outcome.workflowIdentity,
        operationId: operationId(outcome.capabilityId, "electron", 0),
        startedAt: outcome.startedAt,
        finishedAt: new Date().toISOString(),
        failureCode: outcome.failure.code,
        failureSummary: outcome.failure.summary,
        claims: {
          uiEntryPoint: outcome.uiEntryPoint,
          selectedCapabilityId: outcome.capabilityId,
          normalEntryPointUsed: true,
          realRequestSubmitted: true,
          selectionObserved: true,
          failureObserved: true,
          truthfulFailurePresentationObserved: true,
        },
        supportingArtifactPaths: [outcome.artifactPath, options.cleanupPath],
      });
      paths.push(observationPath);
      continue;
    }
    if (!outcome.claims) throw new Error(`${outcome.capabilityId} PASS has no claim set.`);
    for (const evidenceType of EVIDENCE_TYPES) {
      const values = evidenceType === "service" || evidenceType === "worker"
        ? outcome.claims[evidenceType]
        : [outcome.claims[evidenceType]];
      for (const [index, claims] of values.entries()) {
        const observationPath = observationPathFor(options.runId, outcome.capabilityId, evidenceType, index);
        recordParityEvidenceObservation({
          repoRoot: options.repoRoot,
          observationPath,
          producerPath: PRODUCER_PATH,
          packageRunContext: options.packageRunContext,
          runId: options.runId,
          capabilityId: outcome.capabilityId,
          evidenceType,
          workflowIdentity: outcome.workflowIdentity,
          operationId: operationId(outcome.capabilityId, evidenceType, index),
          startedAt: outcome.startedAt,
          finishedAt: new Date().toISOString(),
          claims,
          supportingArtifactPaths: [outcome.artifactPath, options.cleanupPath],
        });
        paths.push(observationPath);
      }
    }
  }
  return paths;
}

function requiredPlan(plans: ReadonlyMap<string, PackagedParityPlan>, capabilityId: string): PackagedParityPlan {
  const plan = plans.get(capabilityId);
  if (!plan) throw new Error(`No frozen plan exists for ${capabilityId}.`);
  return plan;
}

function observationPathFor(runId: string, capabilityId: string, type: string, index: number): string {
  const slug = `${capabilityId.replace(/[^A-Za-z0-9._-]+/gu, "-").slice(0, 80)}-${hash(capabilityId).slice(0, 16)}`;
  return `.qa-results/parity/${runId}/observations/${slug}-${type}-${index}.json`;
}

function operationId(capabilityId: string, type: string, index: number): string {
  return `parity:${hash(`${capabilityId}:${type}:${index}`).slice(0, 32)}:${type}:${index}`;
}

function writeCleanupArtifact(repoRoot: string, runId: string, value: unknown): string {
  const relative = `.qa-results/parity/${runId}/cleanup.json`;
  const file = path.join(repoRoot, ...relative.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return relative;
}

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").toUpperCase();
}

async function assertAuthenticatedDashboardReady(page: import("@playwright/test").Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "Gardens", exact: true })).toBeVisible({ timeout: 3 * 60_000 });
  await expect(page.getByRole("button", { name: "New garden", exact: true })).toBeVisible({ timeout: 3 * 60_000 });
}

function escapeCssString(value: string): string {
  return value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"');
}
