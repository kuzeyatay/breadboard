import fs from "node:fs";
import path from "node:path";

function assertDirectPathSegments(candidate, label) {
  const resolved = path.resolve(candidate);
  if (!path.isAbsolute(candidate)) throw new Error(`${label} must be an absolute path.`);
  const parsed = path.parse(resolved);
  let current = parsed.root;
  for (const segment of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const metadata = fs.lstatSync(current, { throwIfNoEntry: false });
    if (!metadata) break;
    if (metadata.isSymbolicLink()) {
      throw new Error(`${label} traverses a symlink or junction: ${current}`);
    }
  }
  return resolved;
}

function assertDirectDirectory(candidate, label, { allowMissing = false } = {}) {
  const resolved = assertDirectPathSegments(candidate, label);
  const metadata = fs.lstatSync(resolved, { throwIfNoEntry: false });
  if (!metadata && allowMissing) return resolved;
  if (!metadata?.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a direct directory.`);
  }
  return resolved;
}

// Windows briefly refuses to rename a directory whose fresh files an indexer or virus scan still holds open.
function renameWithRetry(operations, from, to) {
  for (let attempt = 1; ; attempt++) {
    try { return operations.renameSync(from, to); }
    catch (error) {
      if (attempt >= 10 || !["EPERM", "EACCES", "EBUSY"].includes(error?.code)) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200 * attempt);
    }
  }
}

export function commitAtomicDirectorySwap({
  stagedTarget,
  target,
  label = "artifact directory",
  operations = fs,
}) {
  stagedTarget = assertDirectDirectory(stagedTarget, `staged ${label}`);
  target = assertDirectDirectory(target, label, { allowMissing: true });
  const parent = assertDirectDirectory(path.dirname(target), `${label} parent`);
  if (path.dirname(stagedTarget) !== parent) {
    throw new Error(`staged ${label} must be a same-parent sibling of its target.`);
  }
  const targetMetadata = fs.lstatSync(target, { throwIfNoEntry: false });
  if (targetMetadata && (!targetMetadata.isDirectory() || targetMetadata.isSymbolicLink())) {
    throw new Error(`${label} target must be absent or a direct directory.`);
  }

  const backupRoot = operations.mkdtempSync(path.join(parent, ".artifact-backup-"));
  const backup = path.join(backupRoot, path.basename(target));
  let backedUp = false;
  let installed = false;
  let preserveBackup = false;
  let failure = null;
  try {
    if (targetMetadata) {
      renameWithRetry(operations, target, backup);
      backedUp = true;
    }
    renameWithRetry(operations, stagedTarget, target);
    installed = true;
  } catch (error) {
    failure = error;
    const rollbackErrors = [];
    if (installed && fs.existsSync(target)) {
      try {
        operations.rmSync(target, { recursive: true, force: true });
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (backedUp && fs.existsSync(backup)) {
      try {
        operations.renameSync(backup, target);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      preserveBackup = true;
      failure = new AggregateError(
        [error, ...rollbackErrors],
        `${label} swap failed and rollback was incomplete.`,
      );
    }
  } finally {
    if (!preserveBackup) {
      operations.rmSync(backupRoot, { recursive: true, force: true });
    }
  }
  if (!installed) throw failure;
}
