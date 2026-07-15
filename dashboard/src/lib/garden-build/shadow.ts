import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderAcceptedGardenSnapshot } from "../garden-renderer/render-garden.ts";
import type { RenderedGardenManifest } from "../garden-renderer/manifest.ts";
import { validateRenderedGardenProjection, type ProjectionValidationResult } from "../garden-renderer/projection-validation.ts";
import { fingerprintGardenBuildState } from "./fingerprint.ts";
import { gardenIssueMigrationMetrics, type GardenIssue } from "./issues.ts";
import { validateGardenBuildInvariants } from "./invariants.ts";
import { mergeGardenIssues } from "./issue-identity.ts";
import { importLegacyGardenBuildState, type LegacyImportMetrics } from "./legacy-import.ts";
import { compareCanonicalParity, renderCanonicalParityMarkdown, type CanonicalParityReport } from "./parity.ts";
import { proposeCanonicalRepairs } from "./repair-dispatcher.ts";
import { planFormulaReconciliationFromLegacy, planSemanticReconciliationFromLegacy, planWeakAnchorRepairFromLegacy } from "./repair-adapters.ts";
import { createAcceptedGardenSnapshot, type AcceptedGardenSnapshot } from "./snapshot.ts";
import { applyGardenBuildTransaction, type GardenBuildTransaction } from "./transactions.ts";
import type { CanonicalAcceptanceDecision, GardenBuildState } from "./types.ts";

export interface CanonicalShadowOptions {
  maxDeterministicRounds?: number;
  enableModelRepairs?: boolean;
  legacyAccepted?: boolean;
  criticAvailable?: boolean;
  criticPass?: boolean;
  writeDiagnostics?: boolean;
}

export interface CanonicalShadowBuildResult {
  importedState: GardenBuildState;
  repairedState: GardenBuildState;
  importIssues: GardenIssue[];
  finalIssues: GardenIssue[];
  importMetrics: LegacyImportMetrics;
  issueMetrics: ReturnType<typeof gardenIssueMigrationMetrics>;
  transactions: GardenBuildTransaction[];
  deterministicRepairCount: number;
  verifiedModelRepairCount: number;
  modelPacketCount: number;
  snapshot?: AcceptedGardenSnapshot;
  manifest?: RenderedGardenManifest;
  projection?: ProjectionValidationResult;
  parity: CanonicalParityReport;
  acceptance: CanonicalAcceptanceDecision;
  accepted: boolean;
  publishReady: boolean;
  stoppedReason: "accepted" | "canonical_issues_remain" | "no_progress" | "model_unavailable" | "projection_failure";
}

function fileSnapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(root, abs).replace(/\\/g, "/");
      if (rel === ".breadboard/canonical-shadow" || rel.startsWith(".breadboard/canonical-shadow/")) continue;
      if (entry.isDirectory()) walk(abs);
      else out[rel] = crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
    }
  };
  walk(root);
  return out;
}

function writeDiagnostics(gardenDir: string, result: Omit<CanonicalShadowBuildResult, "parity"> & { parity: CanonicalParityReport }): void {
  const breadboard = path.join(gardenDir, ".breadboard");
  fs.mkdirSync(breadboard, { recursive: true });
  const staging = fs.mkdtempSync(path.join(breadboard, ".canonical-shadow-stage-"));
  const write = (name: string, value: unknown) => fs.writeFileSync(path.join(staging, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
  write("build-state.json", result.repairedState);
  if (result.snapshot) write("accepted-snapshot.json", result.snapshot);
  if (result.manifest) write("render-manifest.json", result.manifest);
  write("parity.json", result.parity);
  fs.writeFileSync(path.join(staging, "parity.md"), renderCanonicalParityMarkdown(result.parity), "utf8");
  const target = path.join(breadboard, "canonical-shadow");
  fs.rmSync(target, { recursive: true, force: true });
  fs.renameSync(staging, target);
}

export async function runCanonicalGardenShadowBuild(gardenDir: string, gardenSlug: string, options: CanonicalShadowOptions = {}): Promise<CanonicalShadowBuildResult> {
  const beforeFiles = fileSnapshot(gardenDir);
  const imported = importLegacyGardenBuildState(gardenDir, gardenSlug);
  let state = structuredClone(imported.state);
  const transactions: GardenBuildTransaction[] = [];
  let deterministicRepairCount = 0;
  let modelPacketCount = 0;
  let noProgress = false;
  for (let round = 0; round < (options.maxDeterministicRounds ?? 3); round += 1) {
    const blockers = mergeGardenIssues([state.issueState.active, validateGardenBuildInvariants(state)]).filter((issue) => issue.severity === "blocking");
    if (!blockers.length) break;
    const proposed = proposeCanonicalRepairs(blockers, state);
    const formulaPlan = round === 0 ? planFormulaReconciliationFromLegacy(gardenDir, state) : { operations: [], modelPackets: [] };
    const semanticPlan = round === 0 ? planSemanticReconciliationFromLegacy(gardenDir, state) : { operations: [] };
    const weakPlan = round === 0 ? planWeakAnchorRepairFromLegacy(gardenDir, state) : { deterministicOperations: [], modelPackets: [] };
    modelPacketCount += proposed.modelPackets.length + formulaPlan.modelPackets.length + weakPlan.modelPackets.length;
    const operations = [...proposed.operations, ...formulaPlan.operations, ...semanticPlan.operations, ...weakPlan.deterministicOperations]
      .filter((operation, index, all) => all.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(operation)) === index);
    if (!operations.length) { noProgress = true; break; }
    const applied = applyGardenBuildTransaction(state, operations, { expectedStage: "repair", validateAfter: true });
    transactions.push(applied.transaction);
    if (!applied.transaction.committed || applied.transaction.fingerprintAfter === applied.transaction.fingerprintBefore) { noProgress = true; break; }
    deterministicRepairCount += operations.length;
    state = applied.state;
  }
  state.fingerprint = fingerprintGardenBuildState(state);
  const finalIssues = mergeGardenIssues([state.issueState.active, state.issueState.warnings, validateGardenBuildInvariants(state)]);
  const canonicalBlockers = finalIssues.filter((issue) => issue.severity === "blocking");
  let snapshot = canonicalBlockers.length ? undefined : createAcceptedGardenSnapshot(state);
  let manifest: RenderedGardenManifest | undefined;
  let projection: ProjectionValidationResult | undefined;
  let renderRoot: string | undefined;
  if (snapshot) {
    renderRoot = fs.mkdtempSync(path.join(os.tmpdir(), `breadboard-${gardenSlug}-canonical-`));
    try {
      manifest = await renderAcceptedGardenSnapshot(snapshot, renderRoot);
      projection = validateRenderedGardenProjection(snapshot, renderRoot, manifest);
    } finally {
      fs.rmSync(renderRoot, { recursive: true, force: true });
    }
  }
  const afterFilesBeforeDiagnostics = fileSnapshot(gardenDir);
  const liveGardenMutated = JSON.stringify(beforeFiles) !== JSON.stringify(afterFilesBeforeDiagnostics);
  const parity = compareCanonicalParity({ importedState: imported.state, repairedState: state, importIssues: imported.issues, snapshot, projection, legacyAccepted: options.legacyAccepted, liveGardenMutated });
  const criticPass = options.criticPass ?? true;
  const projectionPass = projection?.passed ?? false;
  const canonicalStatePass = canonicalBlockers.length === 0;
  const accepted = Boolean(snapshot && canonicalStatePass);
  const publishReady = accepted && projectionPass && criticPass && parity.unexpectedRegressionCount === 0;
  const acceptance: CanonicalAcceptanceDecision = {
    buildId: state.buildId, stateFingerprint: state.fingerprint, canonicalStatePass, snapshotCreated: Boolean(snapshot), projectionPass,
    criticAvailable: options.criticAvailable ?? false, criticPass, blockers: [...canonicalBlockers, ...(projection?.issues ?? [])],
    warnings: finalIssues.filter((issue) => issue.severity !== "blocking"), accepted, publishReady,
    primaryReason: !canonicalStatePass ? (modelPacketCount > 0 && !options.enableModelRepairs ? "model_unavailable_with_semantic_blockers" : "canonical_state_invalid")
      : !projectionPass ? "projection_integrity_failed" : !criticPass ? "verified_critic_blockers" : "accepted",
  };
  state.acceptance = acceptance;
  const stoppedReason: CanonicalShadowBuildResult["stoppedReason"] = !canonicalStatePass
    ? (modelPacketCount > 0 && !options.enableModelRepairs ? "model_unavailable" : noProgress ? "no_progress" : "canonical_issues_remain")
    : !projectionPass || liveGardenMutated ? "projection_failure" : "accepted";
  const result: CanonicalShadowBuildResult = {
    importedState: imported.state, repairedState: state, importIssues: imported.issues, finalIssues,
    importMetrics: imported.metrics, issueMetrics: gardenIssueMigrationMetrics(imported.issues), transactions,
    deterministicRepairCount, verifiedModelRepairCount: 0, modelPacketCount, snapshot, manifest, projection, parity,
    acceptance, accepted, publishReady, stoppedReason,
  };
  if (options.writeDiagnostics !== false) writeDiagnostics(gardenDir, result);
  return result;
}
