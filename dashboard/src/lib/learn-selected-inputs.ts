import { createHash } from "node:crypto";
import { externalRuntimeFilesystem as fs } from "./external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "./external-runtime-path.ts";
import { isGardenUserPath } from "./garden-user-content.ts";

export type SelectedLearnInputSnapshot = ReadonlyMap<string, string>;

function inputPath(gardenDir: string, relPath: string): string {
  const parts = relPath.replace(/\\/g, "/").split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part.includes(":"))) {
    throw new Error(`Invalid selected Learn input: ${relPath}`);
  }
  let resolved = path.resolve(gardenDir);
  for (const part of parts) {
    resolved = path.join(resolved, part);
    if (fs.lstatSync(resolved, { throwIfNoEntry: false })?.isSymbolicLink()) {
      throw new Error(`Selected Learn input contains a symbolic link: ${relPath}`);
    }
  }
  return resolved;
}

function inputFingerprint(file: string): string {
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new Error("Selected Learn input must be a file.");
  // A note without an authored date uses mtime in its source identity.
  return createHash("sha256").update(fs.readFileSync(file)).update(String(stat.mtimeMs)).digest("hex");
}

/** Call under the content hold. User folders are otherwise omitted from builds. */
export function stageSelectedLearnInputs(input: {
  repositoryGardenDir: string;
  stagingGardenDir: string;
  sourcePaths: readonly string[];
}): SelectedLearnInputSnapshot {
  const snapshot = new Map<string, string>();
  for (const relPath of new Set(input.sourcePaths)) {
    const source = inputPath(input.repositoryGardenDir, relPath);
    const fingerprint = inputFingerprint(source);
    const destination = inputPath(input.stagingGardenDir, relPath);
    const stat = fs.statSync(source);
    if (isGardenUserPath(relPath)) {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(source, destination);
    }
    fs.utimesSync(destination, stat.atime, stat.mtime);
    snapshot.set(relPath, fingerprint);
  }
  return snapshot;
}

/** Publication holds the content lease while checking these exact inputs. */
export function selectedLearnInputsUnchanged(gardenDir: string, snapshot: SelectedLearnInputSnapshot): boolean {
  try {
    for (const [relPath, fingerprint] of snapshot) {
      if (inputFingerprint(inputPath(gardenDir, relPath)) !== fingerprint) return false;
    }
    return true;
  } catch {
    return false;
  }
}
