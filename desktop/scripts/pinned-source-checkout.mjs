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
 * no unreviewed inputs. Independent checkouts must be clean at the pinned
 * commit. Explicitly allowed vendored snapshots instead carry a tracked commit
 * receipt and must byte-match the outer checkout's index.
 */
export function assertPinnedCleanCheckout({
  label,
  sourceRoot,
  expectedCommit,
  allowVendoredSnapshot = false,
}) {
  if (!FULL_COMMIT_PATTERN.test(expectedCommit)) {
    throw new Error(`${label} source commit is not a full lowercase Git object ID.`);
  }
  if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
    throw new Error(`${label} source checkout is missing: ${sourceRoot}`);
  }

  const topLevel = runGit(sourceRoot, ["rev-parse", "--show-toplevel"]);
  const reportedRoot = topLevel.status === 0 ? topLevel.stdout.trim() : "";
  const independentCheckout =
    reportedRoot && canonicalPath(reportedRoot) === canonicalPath(sourceRoot);
  if (!independentCheckout && allowVendoredSnapshot && reportedRoot) {
    const relativeSource = path.relative(reportedRoot, sourceRoot);
    if (
      !relativeSource ||
      relativeSource.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeSource)
    ) {
      throw new Error(`${label} vendored source is outside its Git checkout.`);
    }

    const receiptPath = path.join(sourceRoot, SOURCE_COMMIT_RECEIPT_NAME);
    const receipt = fs.existsSync(receiptPath)
      ? fs.readFileSync(receiptPath, "utf8").trim()
      : "";
    if (receipt !== expectedCommit) {
      throw new Error(
        `${label} vendored source receipt must be ${expectedCommit}; ` +
          `found ${receipt || "missing"}.`,
      );
    }

    const trackedReceipt = runGit(sourceRoot, [
      "ls-files",
      "--error-unmatch",
      "--",
      SOURCE_COMMIT_RECEIPT_NAME,
    ]);
    const untracked = runGit(sourceRoot, [
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      ".",
    ]);
    const modified = runGit(sourceRoot, ["diff", "--quiet", "--", "."]);
    if (
      trackedReceipt.status !== 0 ||
      untracked.status !== 0 ||
      untracked.stdout.length > 0 ||
      modified.status !== 0
    ) {
      throw new Error(
        `${label} vendored source must be tracked and match the outer Git index.`,
      );
    }
    return expectedCommit;
  }
  if (!independentCheckout) {
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
