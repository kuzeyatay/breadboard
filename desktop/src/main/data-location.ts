import * as fs from "node:fs";
import * as path from "node:path";

export const DATA_LOCATION_FILE = "breadboard-storage.json";
export const DATA_MIGRATION_LOCK = "breadboard-data-migration.lock";

export interface DataLocation {
  version: 1;
  dataRoot: string;
  previousDataRoot: string;
  verifiedAt: string;
}

/** Accept only direct local paths; Runtime's data authority cannot be a junction. */
export function validateDataRoot(candidate: string, mustExist = true): string {
  if (!candidate || candidate.includes("\0") || !path.isAbsolute(candidate)
    || (process.platform === "win32" && !/^[a-z]:[\\/]/iu.test(candidate))) {
    throw new Error("Breadboard's data location must be an absolute local directory.");
  }
  const resolved = path.resolve(candidate);
  if (resolved === path.parse(resolved).root) throw new Error("A drive root cannot be Breadboard's data directory.");
  if (mustExist && !fs.existsSync(resolved)) throw new Error(`Breadboard's configured data directory is missing: ${resolved}`);
  let current = resolved;
  for (;;) {
    const metadata = fs.lstatSync(current, {throwIfNoEntry: false});
    if (metadata && (!metadata.isDirectory() || metadata.isSymbolicLink())) {
      throw new Error("Breadboard's data directory must not traverse a file, symlink, or junction.");
    }
    if (metadata) {
      const real = fs.realpathSync.native(current);
      const canonical = process.platform === "win32" ? path.toNamespacedPath(real).toLowerCase() : real;
      const expected = process.platform === "win32" ? path.toNamespacedPath(current).toLowerCase() : current;
      if (canonical !== expected) throw new Error("Breadboard's data directory must be a direct path.");
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return resolved;
}

/** This preference lives beside Data, so relocating Data cannot hide it. */
export function readDataLocation(userDataDir: string): DataLocation | null {
  const file = path.join(userDataDir, DATA_LOCATION_FILE);
  const metadata = fs.lstatSync(file, {throwIfNoEntry: false});
  if (!metadata) return null;
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 16_384) {
    throw new Error("Breadboard's storage preference is invalid.");
  }
  const value = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<DataLocation>;
  if (value.version !== 1 || typeof value.dataRoot !== "string"
    || typeof value.previousDataRoot !== "string" || typeof value.verifiedAt !== "string"
    || !Number.isFinite(Date.parse(value.verifiedAt))) {
    throw new Error("Breadboard's storage preference is invalid.");
  }
  return {...value, dataRoot: validateDataRoot(value.dataRoot)} as DataLocation;
}

export function resolveDataRoot(userDataDir: string, qaMode = false): string {
  // QA must never inherit a person's production storage choice, even when a
  // test profile accidentally contains a copied preference.
  if (qaMode) return path.join(userDataDir, "Data");
  if (fs.existsSync(path.join(userDataDir, DATA_MIGRATION_LOCK))) {
    throw new Error("Breadboard is finishing its data migration. Wait for verification before reopening it.");
  }
  const location = readDataLocation(userDataDir);
  return location?.dataRoot ?? path.join(userDataDir, "Data");
}

export function writeDataLocation(userDataDir: string, location: DataLocation): void {
  const dataRoot = validateDataRoot(location.dataRoot);
  const previousDataRoot = validateDataRoot(location.previousDataRoot);
  const profile = validateDataRoot(userDataDir);
  const relativeProfile = path.relative(dataRoot, profile);
  if (!relativeProfile || (!relativeProfile.startsWith("..") && !path.isAbsolute(relativeProfile))) {
    throw new Error("The data location cannot contain its Electron profile.");
  }
  const file = path.join(profile, DATA_LOCATION_FILE);
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({...location, dataRoot, previousDataRoot}, null, 2) + "\n", {flag: "wx", mode: 0o600});
  fs.renameSync(temporary, file);
}
