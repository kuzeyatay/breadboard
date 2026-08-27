import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const SOURCE_COMMIT_RECEIPT_NAME = "BREADBOARD_SOURCE_COMMIT";

const FULL_COMMIT_PATTERN = /^[0-9a-f]{40}$/u;

function canonicalPath(candidate) {
  const resolved = fs.realpathSync.native(candidate);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function runGit(sourceRoot, args) {
  return spawnSync("git", ["-C", sourceRoot, ...args], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
}

/**
 * Prove that a local source closure is the exact reviewed Git commit and has
 * no staged, modified, deleted, or untracked inputs. The top-level check is
 * deliberate: without it, `git -C` can silently walk into Breadboard's parent
 * checkout when a nested repository is missing.
 */
export function assertPinnedCleanCheckout({ label, sourceRoot, expectedCommit }) {
  if (!FULL_COMMIT_PATTERN.test(expectedCommit)) {
    throw new Error(`${label} source commit is not a full lowercase Git object ID.`);
  }
  if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
    throw new Error(`${label} source checkout is missing: ${sourceRoot}`);
  }

  const topLevel = runGit(sourceRoot, ["rev-parse", "--show-toplevel"]);
  const reportedRoot = topLevel.status === 0 ? topLevel.stdout.trim() : "";
  if (!reportedRoot || canonicalPath(reportedRoot) !== canonicalPath(sourceRoot)) {
    throw new Error(`${label} source must be an independent Git checkout: ${sourceRoot}`);
  }

  const revision = runGit(sourceRoot, ["rev-parse", "--verify", "HEAD^{commit}"]);
  const actualCommit = revision.status === 0 ? revision.stdout.trim() : "";
  if (actualCommit !== expectedCommit) {
    throw new Error(
      `${label} checkout must be pinned to ${expectedCommit}; ` +
        `found ${actualCommit || "unknown"}.`,
    );
  }

  const status = runGit(sourceRoot, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--ignore-submodules=none",
  ]);
  if (status.status !== 0) {
    throw new Error(`${label} source cleanliness could not be verified.`);
  }
  if (status.stdout.length > 0) {
    throw new Error(
      `${label} source checkout must contain no staged, modified, deleted, or untracked files.`,
    );
  }

  return actualCommit;
}

export function writeSourceCommitReceipt(targetRoot, commit) {
  if (!FULL_COMMIT_PATTERN.test(commit)) {
    throw new Error("Cannot write a source receipt for an invalid Git object ID.");
  }
  fs.writeFileSync(path.join(targetRoot, SOURCE_COMMIT_RECEIPT_NAME), `${commit}\n`, {
    encoding: "utf8",
    mode: 0o644,
  });
}
