import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { TOPOLOGY_PROVENANCE_FILES } from "./provenance.ts";

const ignored = new Set([".breadboard", "assets", ".git", "node_modules"]);
const pending = new Map<string, Promise<string>>();

/** Same identity as the worker's synchronous fingerprint, without blocking
 * HTTP requests while mounted maps poll thousands of files. Concurrent tabs
 * share a walk; the next completed poll still reads the current filesystem. */
export function gardenContentFingerprintAsync(gardenDir: string): Promise<string> {
  const key = path.resolve(gardenDir);
  const existing = pending.get(key);
  if (existing) return existing;
  const work = readFingerprint(key).finally(() => {
    if (pending.get(key) === work) pending.delete(key);
  });
  pending.set(key, work);
  return work;
}

async function readFingerprint(gardenDir: string): Promise<string> {
  const entries: string[] = [];
  const statEntry = async (absolute: string, relative: string, optional = false) => {
    try {
      const stat = await fs.promises.stat(absolute);
      entries.push(`${relative}\u0000${stat.size}\u0000${Math.round(stat.mtimeMs)}`);
    } catch {
      if (!optional) entries.push(`${relative}\u0000unreadable`);
    }
  };
  const visit = async (absolute: string, relative: string): Promise<void> => {
    let children: Dirent[];
    try { children = await fs.promises.readdir(absolute, { withFileTypes: true }); }
    catch { return; }
    let stats: Promise<void>[] = [];
    for (const entry of children) {
      if (ignored.has(entry.name)) continue;
      const next = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await Promise.all(stats);
        stats = [];
        entries.push(`${next}/`);
        await visit(path.join(absolute, entry.name), next);
      } else if (entry.isFile() && /\.md$/i.test(entry.name)) {
        stats.push(statEntry(path.join(absolute, entry.name), next));
        if (stats.length === 32) { await Promise.all(stats); stats = []; }
      }
    }
    await Promise.all(stats);
  };
  await visit(gardenDir, "");
  await Promise.all(TOPOLOGY_PROVENANCE_FILES.map(relative => statEntry(path.join(gardenDir, relative), relative, true)));
  return createHash("sha256").update(entries.sort().join("\n")).digest("hex");
}
