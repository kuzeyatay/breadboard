import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface StorageCompactionState {
  version: 1; requestedAt: number;
  phase: "pending" | "running" | "complete" | "deferred";
  retryAfter?: number; finishedAt?: number; bytesReleased?: number; detail?: string;
}

function directory(dataRoot: string): string {
  const root = path.resolve(dataRoot), dir = path.join(root, "storage");
  const normalized = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
  if (fs.lstatSync(root).isSymbolicLink() || normalized(fs.realpathSync(root)) !== normalized(root))
    throw new Error("Redirected storage root");
  fs.mkdirSync(dir, { recursive: true });
  if (fs.lstatSync(dir).isSymbolicLink() || normalized(fs.realpathSync(dir)) !== normalized(dir))
    throw new Error("Redirected storage directory");
  return dir;
}

export function readStorageCompaction(dataRoot: string): StorageCompactionState | null {
  const file = path.join(directory(dataRoot), "compaction.json");
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 4096) throw new Error("Invalid storage maintenance state");
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (value.version !== 1 || !Number.isSafeInteger(value.requestedAt)
      || !["pending", "running", "complete", "deferred"].includes(value.phase)) throw new Error("Invalid storage maintenance state");
    return value;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

export function writeStorageCompaction(dataRoot: string, state: StorageCompactionState): void {
  const dir = directory(dataRoot), file = path.join(dir, "compaction.json"), temporary = path.join(dir, `${randomUUID()}.compaction-tmp`);
  const handle = fs.openSync(temporary, "wx", 0o600);
  try { fs.writeFileSync(handle, JSON.stringify(state)); fs.fsyncSync(handle); }
  finally { fs.closeSync(handle); }
  fs.renameSync(temporary, file);
}

export function requestStorageCompaction(dataRoot: string): StorageCompactionState {
  const current = readStorageCompaction(dataRoot);
  if (current?.phase === "pending" || current?.phase === "running") return current;
  const state: StorageCompactionState = { version: 1, requestedAt: Date.now(), phase: "pending" };
  writeStorageCompaction(dataRoot, state); return state;
}
