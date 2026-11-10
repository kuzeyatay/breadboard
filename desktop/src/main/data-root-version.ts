/**
 * Data-root version guard. Every start records the Breadboard version that
 * opened the data root. A data root last opened by a newer Breadboard is
 * refused: an older app running over databases a newer one migrated is how
 * workspaces get corrupted, and the person can simply install the newer app.
 */
import * as fs from "node:fs";
import * as path from "node:path";

export const DATA_ROOT_VERSION_FILE = "breadboard-version.json";

export interface DataRootVersionRecord {
  version: string;
  writtenAt: string;
}

/** Numeric dotted comparison; a pre-release suffix is ignored. */
export function compareVersions(a: string, b: string): number {
  const parse = (value: string) =>
    value
      .trim()
      .replace(/^v/u, "")
      .split("-")[0]!
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0);
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const delta = (left[i] ?? 0) - (right[i] ?? 0);
    if (delta !== 0) return delta < 0 ? -1 : 1;
  }
  return 0;
}

export function readDataRootVersion(dataRoot: string): DataRootVersionRecord | null {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(dataRoot, DATA_ROOT_VERSION_FILE), "utf8"),
    ) as Partial<DataRootVersionRecord>;
    if (typeof parsed.version !== "string" || !/^\d+\.\d+/u.test(parsed.version)) return null;
    return { version: parsed.version, writtenAt: String(parsed.writtenAt ?? "") };
  } catch {
    return null;
  }
}

/** The newer version that last opened the data root, or null when this app may. */
export function newerDataRootVersion(dataRoot: string, appVersion: string): string | null {
  const record = readDataRootVersion(dataRoot);
  if (!record) return null;
  return compareVersions(record.version, appVersion) > 0 ? record.version : null;
}

/** Records this version unless a newer one already owns the data root. */
export function recordDataRootVersion(dataRoot: string, appVersion: string): void {
  if (newerDataRootVersion(dataRoot, appVersion)) return;
  const record: DataRootVersionRecord = {
    version: appVersion,
    writtenAt: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(dataRoot, DATA_ROOT_VERSION_FILE),
    `${JSON.stringify(record, null, 2)}\n`,
  );
}
