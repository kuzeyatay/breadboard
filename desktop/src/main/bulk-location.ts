import * as fs from "node:fs";
import * as path from "node:path";
import {validateDataRoot} from "./data-location";

export const BULK_LOCATION_FILE = "breadboard-bulk-storage.json";
export interface BulkLocation { version: 1; bulkRoot: string; verifiedAt: string }

function overlaps(left: string, right: string): boolean {
  const relative = path.relative(left, right);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function validateBulkRoot(candidate: string, protectedRoots: readonly string[]): string {
  const root = validateDataRoot(candidate, false);
  for (const protectedRoot of protectedRoots) {
    const protectedPath = path.resolve(protectedRoot);
    if (overlaps(root, protectedPath) || overlaps(protectedPath, root)) {
      throw new Error("Breadboard's large-file directory must be separate from active data, its profile, and program files.");
    }
  }
  return root;
}

/** This preference is Electron-owned; ambient environment and QA never select it. */
export function resolveBulkRoot(userDataDir: string, qaMode: boolean, protectedRoots: readonly string[]): string | undefined {
  if (qaMode) return undefined;
  const file = path.join(userDataDir, BULK_LOCATION_FILE);
  const metadata = fs.lstatSync(file, {throwIfNoEntry: false});
  if (!metadata) return undefined;
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 4096) throw new Error("Breadboard's large-file storage preference is invalid.");
  const value = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<BulkLocation>;
  if (value.version !== 1 || typeof value.bulkRoot !== "string" || typeof value.verifiedAt !== "string" || !Number.isFinite(Date.parse(value.verifiedAt))) {
    throw new Error("Breadboard's large-file storage preference is invalid.");
  }
  return validateBulkRoot(value.bulkRoot, [userDataDir, ...protectedRoots]);
}

/** Caller must hold the normal offline migration lock before activating this. */
export function writeBulkLocation(userDataDir: string, location: BulkLocation, protectedRoots: readonly string[]): void {
  const profile = validateDataRoot(userDataDir);
  const bulkRoot = validateBulkRoot(location.bulkRoot, [profile, ...protectedRoots]);
  if (location.version !== 1 || !Number.isFinite(Date.parse(location.verifiedAt))) throw new Error("Invalid bulk storage activation.");
  const file = path.join(profile, BULK_LOCATION_FILE);
  const existing = fs.lstatSync(file, {throwIfNoEntry: false});
  if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new Error("The bulk storage preference is redirected.");
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({...location, bulkRoot}, null, 2) + "\n", {flag: "wx", mode: 0o600});
  fs.renameSync(temporary, file);
}
