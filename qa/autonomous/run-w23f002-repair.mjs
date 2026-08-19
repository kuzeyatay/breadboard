#!/usr/bin/env node

/**
 * W2-3H / Part B — the authorised SH1 repair for W23F-002.
 *
 * The defect: an entry in the REVIEWED install root, marked reviewState
 * approved, with no pinned hashes, is served healthy and dispatchable — and
 * stays healthy after its guidance is edited. `integrityVerified` starts life
 * as `pinnedHashes.length === 0`, so "nothing to check" became "nothing wrong".
 *
 * The fix is deliberately NOT a global fail-closed. W23F-002 established that a
 * pin is the trust mechanism for exactly one provenance class. First-party
 * prebuilt skills, user documents and approved MCP connections are trusted by
 * other means, and a global rule would mark every prebuilt skill unhealthy.
 *
 * So the policy is written as a policy: one exported predicate naming the
 * classes that are trusted by their pin, and one use of it.
 *
 * Run from the repository root:
 *   node qa/autonomous/run-w23f002-repair.mjs <evidence-dir>
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  applyGatedMutation,
  finalizeRepairCapability,
  issueRepairCapability,
  revokeRepairCapability,
} from "./lib/repair-capability.mjs";
import { evaluateRepairGate } from "./lib/repair-gate.mjs";
import {
  createSnapshotWorktree,
  captureDiff,
  diffStat,
  mainTreeFileFingerprint,
  removeRepairWorktree,
  rollbackInstructions,
} from "./lib/repair-worktree.mjs";
import { captureSourceSnapshot } from "./lib/source-snapshot.mjs";
import { reviewAssertionIntegrity } from "./lib/assertion-integrity.mjs";

const repoRoot = process.cwd();
const evidenceDir = path.resolve(process.argv[2] ?? ".qa-results/week2-w23f002-repair/adhoc");
fs.mkdirSync(evidenceDir, { recursive: true });

const log = [];
const note = (event, detail) => {
  log.push({ at: new Date().toISOString(), event, detail });
  console.log("[" + event + "] " + (typeof detail === "string" ? detail : JSON.stringify(detail)));
};

const snapshot = captureSourceSnapshot({ repoRoot, label: "w23f002-repair" });
note("snapshot-frozen", {
  baseCommit: snapshot.baseCommit,
  sourceFingerprint: snapshot.sourceFingerprint.slice(0, 16),
});

const finding = {
  id: "W23F-002",
  scenario: "week2-w23f002/reviewed-root-unpinned-entry",
  status: "failed",
  classification: "PRODUCT_BUG",
  severity: "P2",
  revision: snapshot.baseCommit,
  environment: { repositoryRevision: snapshot.baseCommit },
  sourceSnapshotFingerprint: snapshot.sourceFingerprint,
  reproduction: {
    reproduced: true,
    attempts: 2,
    method:
      "A reviewed-install-root entry with reviewState approved and no fileHashes lists as healthy and dispatchable, and remains healthy after its SKILL.md guidance is edited.",
  },
  diagnosis: {
    rootCause:
      "integrityVerified is initialised to pinnedHashes.length === 0, so an entry with nothing pinned is treated as verified. For the reviewed install root, whose entire trust story is the pin, that removes the control rather than deferring it.",
    responsibleCodePath: "dashboard/src/lib/hermes/skills.ts",
  },
  humanAuthorization: {
    granted: true,
    action: "implement the provenance-aware reviewed-root pin requirement",
    scope: "the established reviewed-root rule only",
    excludes: ["a global fail-closed default", "changes to first-party, document or MCP trust models"],
  },
};

const gate = evaluateRepairGate(finding);
note("repair-gate", {
  allowed: gate.productionSourceMutationAllowed,
  blockingReasons: gate.blockingReasons,
});
if (!gate.productionSourceMutationAllowed) throw new Error("repair gate denied the mutation");

const handle = createSnapshotWorktree({ repoRoot, findingId: "w23f-002", snapshot });
note("worktree", { path: handle.worktreePath, linkedRoots: handle.linkedRoots.length });

const PRODUCT_PATH = "dashboard/src/lib/hermes/skills.ts";
const REGRESSION_PATH = "dashboard/tests/reviewed-root-pin-required.test.mjs";

const mainTreeBefore = [PRODUCT_PATH].map((relative) => ({
  path: relative,
  fingerprint: mainTreeFileFingerprint(repoRoot, relative),
}));

let capability = null;
let verdict = null;

try {
  capability = issueRepairCapability({
    repoRoot,
    finding,
    worktree: handle,
    allowedPaths: [PRODUCT_PATH],
    regressionTestPaths: [REGRESSION_PATH],
  });
  note("capability-issued", { id: capability.id, allowedPaths: capability.allowedPaths });

  const before = fs.readFileSync(path.join(handle.worktreePath, PRODUCT_PATH), "utf8");

  const policyAnchor = "export function approvedRoot(): string {";
  if (!before.includes(policyAnchor)) throw new Error("approvedRoot anchor not found");

  const policyBlock = `/**
 * Which artifact classes are trusted BY their reviewed pin.
 *
 * A pin is not globally mandatory, and making it so would be a different bug:
 * first-party prebuilt skills carry no pin at all and are trusted by being
 * committed product code, user documents are trusted by ownership, and MCP
 * connections by explicit approval. A blanket rule would mark every one of
 * those unhealthy.
 *
 * The reviewed install root is the one class whose whole trust story IS the
 * pin: everything reaching it through the supported path is hashed at
 * promotion, and a record there asserts that a human approved exactly that
 * content. An entry with nothing pinned therefore has no evidence behind its
 * approval, and must not be served as though it did (W23F-002).
 */
export function requiresReviewedIntegrityPin(root: string): boolean {
  const resolved = path.resolve(root);
  return [approvedRoot(), conditionalRoot()].some(
    (reviewed) => path.resolve(reviewed) === resolved,
  );
}

`;
  const withPolicy = before.replace(policyAnchor, policyBlock + policyAnchor);

  const oldDefault = "      let integrityVerified = pinnedHashes.length === 0;";
  const newDefault = `      // "Nothing to check" is not "nothing wrong". Where the pin IS the trust
      // mechanism, an entry with no pins has no evidence behind its approval.
      let integrityVerified =
        pinnedHashes.length === 0 && !requiresReviewedIntegrityPin(root);`;
  if (!withPolicy.includes(oldDefault)) throw new Error("integrityVerified anchor not found");
  const after = withPolicy.replace(oldDefault, newDefault);

  applyGatedMutation({ capability, targetPath: PRODUCT_PATH, edit: () => after });
  note("product-patched", { path: PRODUCT_PATH, bytesDelta: after.length - before.length });

  const regression = fs.readFileSync(
    path.join(repoRoot, "qa/autonomous/fixtures/w23f002-regression.test.mjs"),
    "utf8",
  );
  applyGatedMutation({ capability, targetPath: REGRESSION_PATH, edit: () => regression });
  note("regression-added", { path: REGRESSION_PATH });

  const diff = captureDiff(handle, [PRODUCT_PATH, REGRESSION_PATH]);
  const integrity = reviewAssertionIntegrity(diff, { classification: finding.classification });
  note("assertion-integrity", {
    verdict: integrity.verdict,
    rejections: integrity.rejections.map((entry) => entry.rule),
  });
  if (integrity.rejections.length > 0) throw new Error("assertion integrity rejected the diff");

  verdict = finalizeRepairCapability({ capability, worktree: handle });
  note("capability-finalized", {
    finalized: verdict.finalized,
    authorisedWrites: verdict.authorisedWrites,
    unauthorisedChanges: verdict.unauthorisedChanges,
    repairFiles: verdict.repairFootprint.repairFiles,
    problems: verdict.problems,
  });

  fs.writeFileSync(path.join(evidenceDir, "repair-diff.patch"), diff, "utf8");
  fs.writeFileSync(
    path.join(evidenceDir, "repair-state.json"),
    JSON.stringify(
      {
        findingId: finding.id,
        worktreePath: handle.worktreePath,
        baseCommit: snapshot.baseCommit,
        sourceFingerprint: snapshot.sourceFingerprint,
        diffStat: diffStat(handle),
        assertionIntegrity: integrity,
        capability: {
          capabilityId: verdict.capabilityId,
          findingId: verdict.findingId,
          allowedPaths: capability.allowedPaths,
          regressionTestPaths: capability.regressionTestPaths,
          finalized: verdict.finalized,
          unauthorisedChanges: verdict.unauthorisedChanges,
          declaredButUnwritten: verdict.declaredButUnwritten,
        },
        repairFootprint: verdict.repairFootprint,
        mainTreeBefore,
        mainTreeAfter: [PRODUCT_PATH].map((relative) => ({
          path: relative,
          fingerprint: mainTreeFileFingerprint(repoRoot, relative),
        })),
        rollback: rollbackInstructions(handle),
        log,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  console.log("\nWORKTREE=" + handle.worktreePath);
} catch (error) {
  if (capability && !verdict) revokeRepairCapability(capability);
  removeRepairWorktree({ repoRoot, worktreePath: handle.worktreePath });
  fs.writeFileSync(
    path.join(evidenceDir, "repair-failure.json"),
    JSON.stringify({ error: error instanceof Error ? error.message : String(error), log }, null, 2) + "\n",
    "utf8",
  );
  throw error;
}
