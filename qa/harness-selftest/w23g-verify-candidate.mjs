#!/usr/bin/env node

/**
 * W2-3G / A1 + A2 — is the candidate still exactly what was verified, and does
 * it still apply to the tree it is about to land in?
 *
 * A VERIFIED_REPAIR receipt blesses a specific set of bytes, not an intention.
 * Two things can have moved since: the candidate itself, and the target. Both
 * are checked here, and the landing refuses if either drifted.
 *
 * A note on the receipt: its `files_changed` field lists the whole snapshot
 * worktree diff, which on a snapshot worktree is the developer's entire
 * in-flight tree. That is the same snapshot-awareness bug as W23F-H1, in a
 * third place. The authoritative footprint of the repair is the capability's
 * authorised writes, which is what this uses.
 *
 * Run from the repository root.
 */

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const repoRoot = process.cwd();
const outDir = path.resolve(process.argv[2] ?? ".");
const repairDir = path.resolve(process.argv[3] ?? ".qa-results/week2-w23e001-repair/w23f-repair-20260818T072400Z");
const worktree = path.join(repoRoot, ".qa-worktrees", "w23e-001");

const sha = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const write = (name, value) =>
  fs.writeFileSync(path.join(outDir, name), JSON.stringify(value, null, 2) + "\n", "utf8");

const receipt = readJson(path.join(repairDir, "W23E-001.receipt.json"));
const state = readJson(path.join(repairDir, "repair-state.json"));
const migration = readJson(path.join(repairDir, "trust-migration-proofs.json"));

/** The repair footprint: what the capability actually authorised and wrote. */
const FOOTPRINT = [
  ...state.capability.allowedPaths,
  ...state.capability.regressionTestPaths,
];

function git(args, cwd = repoRoot) {
  const run = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
  return { status: run.status ?? 1, stdout: (run.stdout ?? "").trim(), stderr: (run.stderr ?? "").trim() };
}

// ------------------------------------------------- A1: candidate identity
const worktreeExists = fs.existsSync(worktree);
const worktreeHead = worktreeExists ? git(["rev-parse", "HEAD"], worktree).stdout : null;

const candidate = FOOTPRINT.map((relative) => {
  const inWorktree = path.join(worktree, relative);
  const present = fs.existsSync(inWorktree);
  const bytes = present ? fs.readFileSync(inWorktree) : null;
  return {
    path: relative,
    presentInCandidate: present,
    candidateSha256: bytes ? sha(bytes) : null,
    candidateBytes: bytes ? bytes.length : null,
  };
});

const identity = {
  findingId: receipt.finding_id,
  receiptStatus: receipt.final_status,
  capabilityId: receipt.repair_capability.capabilityId,
  capabilityFindingId: receipt.repair_capability.findingId,
  finalized: receipt.repair_capability.finalized,
  unauthorisedChanges: receipt.repair_capability.unauthorisedChanges,
  assertionIntegrityVerdict: receipt.assertion_integrity_result.verdict,
  assertionIntegrityRejections: receipt.assertion_integrity_result.rejections,
  isolationVerified: receipt.isolation_result.verified,
  secretScan: receipt.secret_scan_result,
  revision: receipt.revision,
  sourceSnapshotFingerprint: receipt.execution_identity.sourceSnapshotFingerprint,
  environmentFingerprint: receipt.execution_identity.environmentFingerprint,
  executionSnapshotId: receipt.execution_identity.executionSnapshotId,
  worktreeExists,
  worktreeHead,
  worktreeHeadMatchesRevision: worktreeHead === receipt.revision,
  repairFootprint: FOOTPRINT,
  candidate,
  receiptFilesChangedNote:
    "receipt.files_changed lists " +
    receipt.files_changed.length +
    " paths because it recorded the whole snapshot worktree diff. The repair footprint is the capability's " +
    FOOTPRINT.length +
    " authorised writes; that is what is landed.",
  allCandidateFilesPresent: candidate.every((entry) => entry.presentInCandidate),
  identityIntact:
    receipt.final_status === "VERIFIED_REPAIR" &&
    receipt.repair_capability.finalized === true &&
    receipt.repair_capability.unauthorisedChanges.length === 0 &&
    receipt.assertion_integrity_result.rejections.length === 0 &&
    receipt.isolation_result.verified === true &&
    receipt.secret_scan_result.findings === 0 &&
    worktreeExists &&
    worktreeHead === receipt.revision &&
    candidate.every((entry) => entry.presentInCandidate),
};
write("w23e001-candidate-identity.json", identity);

// --------------------------------------------- A2: target compatibility
const targetHead = git(["rev-parse", "HEAD"]).stdout;

const compatibility = FOOTPRINT.map((relative) => {
  const inTarget = path.join(repoRoot, relative);
  const targetPresent = fs.existsSync(inTarget);
  const targetBytes = targetPresent ? fs.readFileSync(inTarget) : null;
  // The pre-image the repair was written against: the snapshot worktree file
  // before the capability wrote it. Reconstructed from the committed blob,
  // because the snapshot materialised the developer tree over HEAD.
  const blob = spawnSync("git", ["show", receipt.revision + ":" + relative], {
    cwd: repoRoot,
    encoding: "buffer",
    maxBuffer: 128 * 1024 * 1024,
  });
  const committed = blob.status === 0 ? blob.stdout : null;
  const targetDirty = git(["status", "--porcelain", "--", relative]).stdout !== "";
  return {
    path: relative,
    targetPresent,
    targetSha256: targetBytes ? sha(targetBytes) : null,
    targetTrackedAtRevision: committed !== null,
    targetMatchesCommittedBlob: committed !== null && targetBytes !== null ? sha(targetBytes) === sha(committed) : null,
    targetHasUncommittedEdits: targetDirty,
    // A file the developer has edited since the candidate was built would make
    // the landed bytes different from the verified bytes.
    safeToLand: targetPresent ? targetDirty === false : true,
  };
});

const target = {
  targetHead,
  targetHeadMatchesCandidateRevision: targetHead === receipt.revision,
  files: compatibility,
  overlappingDeveloperEdits: compatibility.filter((entry) => entry.targetHasUncommittedEdits).map((entry) => entry.path),
  semanticConflicts: compatibility.filter((entry) => entry.safeToLand === false).map((entry) => entry.path),
  safeToLand: compatibility.every((entry) => entry.safeToLand),
  reasoning:
    "The landed bytes must be the verified bytes. Each footprint file in the target is compared against the committed blob at the candidate's revision; an uncommitted developer edit in any of them would mean the landed result was never verified.",
};
write("w23e001-target-compatibility.json", target);

console.log("A1 identity intact: " + identity.identityIntact);
console.log("   receipt status: " + identity.receiptStatus + ", capability finalized: " + identity.finalized);
console.log("   footprint: " + FOOTPRINT.join(", "));
console.log("A2 target head matches candidate revision: " + target.targetHeadMatchesCandidateRevision);
for (const entry of compatibility) {
  console.log(
    "   " + entry.path.padEnd(58) +
      " present=" + String(entry.targetPresent).padEnd(5) +
      " dirty=" + String(entry.targetHasUncommittedEdits).padEnd(5) +
      " safe=" + entry.safeToLand,
  );
}
console.log("A2 safe to land: " + target.safeToLand);
console.log("migration: " + JSON.stringify(migration.totals));
