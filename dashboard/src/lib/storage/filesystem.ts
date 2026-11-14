import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import type { BigIntStats, Dir } from "node:fs";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { ensureStorageSchema } from "./store.ts";
import { DAY_MS, STORAGE_POLICY } from "./policy.ts";

export const fileIdentity = (stat: BigIntStats) => `${stat.dev}:${stat.ino}`;
export const allocatedBytes = (stat: BigIntStats) => Number(stat.blocks * BigInt(512));

export async function ensureManagedDirectory(root: string, relative: string): Promise<string> {
  const normalized = path.relative(path.resolve(root), path.resolve(root, relative));
  if (!normalized || path.isAbsolute(relative) || normalized === ".." || normalized.startsWith(`..${path.sep}`)) throw new Error("Invalid managed directory");
  let current = "";
  for (const component of normalized.split(path.sep)) {
    current = path.join(current, component);
    if (path.dirname(current) !== ".") await managedPath(root, path.dirname(current));
    else if ((await fs.promises.lstat(root)).isSymbolicLink()) throw new Error("Redirected storage root");
    try { await fs.promises.mkdir(path.join(root, current)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    await managedPath(root, current);
  }
  return path.join(root, normalized);
}

/** Reject every redirected component, including the authority root itself. */
export async function managedPath(root: string, relative: string): Promise<string> {
  const base = path.resolve(root), target = path.resolve(base, relative);
  const rel = path.relative(base, target);
  if (!relative || path.isAbsolute(relative) || rel === "" || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel))
    throw new Error("Storage path escapes its managed root");
  let current = base;
  const rootStat = await fs.promises.lstat(current);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("Redirected storage root");
  for (const part of rel.split(path.sep)) {
    current = path.join(current, part);
    if ((await fs.promises.lstat(current)).isSymbolicLink()) throw new Error("Redirected storage path");
  }
  const actual = await fs.promises.realpath(target);
  const comparable = (value: string) => process.platform === "win32" ? value.replace(/^\\\\\?\\/u, "").toLowerCase() : value;
  if (comparable(actual) !== comparable(target)) throw new Error("Redirected storage path");
  return target;
}

/** Producers call this only after releasing the file and its recovery references.
 * Scanning a temp directory never turns its contents into deletion authority. */
export async function releaseDisposableFile(db: Database.Database, root: string, relative: string,
  owner: string, kind: "temporary" | "download" | "diagnostic", now = Date.now()): Promise<void> {
  ensureStorageSchema(db);
  const target = await managedPath(root, relative), stat = await fs.promises.lstat(target, { bigint: true });
  if (!stat.isFile() || !owner) throw new Error("Invalid disposable file");
  const released = db.prepare(`INSERT INTO storage_disposable_files(relative_path,owner,kind,identity,modified_ms,byte_length,released_at)
    VALUES(?,?,?,?,?,?,?) ON CONFLICT(relative_path) DO UPDATE SET owner=excluded.owner,kind=excluded.kind,
    identity=excluded.identity,modified_ms=excluded.modified_ms,byte_length=excluded.byte_length,released_at=excluded.released_at,lease_until=0
    WHERE storage_disposable_files.lease_until<? AND storage_disposable_files.cleanup_path IS NULL`)
    .run(relative, owner, kind, fileIdentity(stat), Number(stat.mtimeMs), Number(stat.size), now, Date.now());
  if (!released.changes) throw new Error("The disposable file is leased by another operation");
}

/** A producer must acquire its lease before reusing a released path. Failure
 * means it must wait or allocate a new path; cleanup may already own this one. */
export function leaseDisposableFile(db: Database.Database, relative: string, until: number, now = Date.now()): boolean {
  ensureStorageSchema(db);
  if (!Number.isSafeInteger(until) || until <= now) throw new Error("Invalid storage lease");
  return db.prepare(`UPDATE storage_disposable_files SET lease_until=? WHERE relative_path=?
    AND lease_until<? AND cleanup_path IS NULL`).run(until,relative,now).changes === 1;
}

/** A conservative, bounded preview. Uninspected entries never inflate the
 * "verified reclaimable" number, and shared allocations cannot be reclaimed. */
export async function disposablePreview(db: Database.Database, root: string, now=Date.now()) {
  ensureStorageSchema(db);
  const rows=db.prepare(`SELECT relative_path,cleanup_path,identity,modified_ms,byte_length FROM storage_disposable_files
    WHERE released_at<? AND lease_until<? ORDER BY released_at LIMIT 33`).all(now-7*DAY_MS,now) as Array<{
      relative_path:string;cleanup_path:string|null;identity:string;modified_ms:number;byte_length:number;
    }>;
  let verifiedBytes=0,verifiedFiles=0;
  for (const row of rows.slice(0,32)) {
    try {
      const stat=await fs.promises.lstat(await managedPath(root,row.cleanup_path??row.relative_path),{bigint:true});
      if (stat.isFile() && fileIdentity(stat)===row.identity && Number(stat.mtimeMs)===row.modified_ms && Number(stat.size)===row.byte_length) {
        verifiedFiles++; if(stat.nlink===BigInt(1)) verifiedBytes+=allocatedBytes(stat);
      }
    } catch { /* Unverified candidates remain protected. */ }
  }
  return {verifiedBytes,verifiedFiles,complete:rows.length<=32};
}

export async function cleanDisposableFiles(db: Database.Database, root: string, now = Date.now(), shouldYield = () => false) {
  ensureStorageSchema(db);
  const rows = db.prepare(`SELECT * FROM storage_disposable_files WHERE lease_until<? AND released_at<? ORDER BY released_at LIMIT 32`)
    .all(now, now - STORAGE_POLICY.temporaryDays * DAY_MS) as Array<{
      relative_path: string; identity: string; modified_ms: number; byte_length: number; cleanup_path: string | null;
    }>;
  let filesRemoved = 0, bytesReleased = 0; const skipped: string[] = [];
  for (const row of rows) {
    if (shouldYield()) break;
    const quarantine = row.cleanup_path ?? path.join("storage", "quarantine", randomUUID());
    const expires = now + 60_000;
    if (!db.prepare(`UPDATE storage_disposable_files SET lease_until=?,cleanup_path=? WHERE relative_path=?
      AND identity=? AND modified_ms=? AND byte_length=? AND lease_until<?`).run(expires,quarantine,row.relative_path,row.identity,row.modified_ms,row.byte_length,now).changes) continue;
    try {
      await ensureManagedDirectory(root, path.dirname(quarantine));
      let target: string;
      try { target = await managedPath(root, quarantine); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        const original = await managedPath(root, row.relative_path);
        target = path.join(root, quarantine);
        await fs.promises.rename(original, target);
      }
      // Verify the object *after* an atomic rename. A replacement between the
      // initial scan and rename can never be unlinked as the old disposable.
      const stat = await fs.promises.lstat(await managedPath(root, quarantine), { bigint: true });
      if (!stat.isFile() || fileIdentity(stat) !== row.identity || Number(stat.mtimeMs) !== row.modified_ms || Number(stat.size) !== row.byte_length) {
        try {
          await managedPath(root, path.dirname(row.relative_path) === "." ? path.dirname(quarantine) : path.dirname(row.relative_path));
          await fs.promises.link(target, path.join(root, row.relative_path));
          await fs.promises.unlink(target);
          db.prepare("UPDATE storage_disposable_files SET cleanup_path=NULL WHERE relative_path=? AND cleanup_path=?").run(row.relative_path,quarantine);
        } catch { /* Keep the unexpected file in the journalled quarantine if its original path is occupied. */ }
        skipped.push("A temporary file changed after it was released."); continue;
      }
      // No recursive deletion: each file has separate producer-issued authority.
      await fs.promises.unlink(target);
      db.prepare("DELETE FROM storage_disposable_files WHERE relative_path=? AND cleanup_path=?").run(row.relative_path, quarantine);
      filesRemoved++; if (stat.nlink === BigInt(1)) bytesReleased += allocatedBytes(stat);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        db.prepare("DELETE FROM storage_disposable_files WHERE relative_path=? AND identity=?").run(row.relative_path, row.identity);
      else skipped.push("A temporary file is busy, redirected, or inaccessible.");
    } finally {
      db.prepare("UPDATE storage_disposable_files SET lease_until=0 WHERE relative_path=? AND cleanup_path=?").run(row.relative_path,quarantine);
    }
  }
  return { filesRemoved, bytesReleased, skipped: [...new Set(skipped)] };
}

export interface StorageInventory {
  startedAt: number; updatedAt: number; complete: boolean; files: number;
  allocatedBytes: number; logicalBytes: number; hardlinkBytesAvoided: number;
  skippedEntries: number; categories: Record<string, number>;
  largest: Array<{ path: string; bytes: number }>;
}

/** A bounded DFS retains directory handles rather than materializing a million
 * job names. Only multiply-linked files need an identity map. */
export class StorageScanner {
  readonly result: StorageInventory;
  private stack: Array<{ relative: string; dir: Dir }> = [];
  private readonly linked = new Map<string, { category: string; bytes: number }>();
  private started = false;
  private readonly root: string;
  constructor(root: string, now = Date.now()) {
    this.root = path.resolve(root);
    this.result = { startedAt: now, updatedAt: now, complete: false, files: 0, allocatedBytes: 0,
      logicalBytes: 0, hardlinkBytesAvoided: 0, skippedEntries: 0, categories: {}, largest: [] };
  }
  async step(shouldYield = () => false, maximumEntries = 128, onFile?: (relative: string, stat: BigIntStats) => void): Promise<StorageInventory> {
    if (!this.started) {
      const stat = await fs.promises.lstat(this.root);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Invalid storage root");
      this.stack.push({ relative: "", dir: await fs.promises.opendir(this.root) }); this.started = true;
    }
    for (let count = 0; this.stack.length && count < maximumEntries && !shouldYield(); count++) {
      const current = this.stack[this.stack.length - 1];
      const entry = await current.dir.read();
      if (!entry) { await current.dir.close(); this.stack.pop(); continue; }
      const relative = path.join(current.relative, entry.name);
      try {
        const candidate = await managedPath(this.root, relative);
        const stat = await fs.promises.lstat(candidate, { bigint: true });
        if (stat.isDirectory()) { this.stack.push({ relative, dir: await fs.promises.opendir(candidate) }); continue; }
        if (!stat.isFile()) continue;
        try { onFile?.(relative, stat); } catch { this.result.skippedEntries++; }
        this.result.files++; this.result.logicalBytes += Number(stat.size);
        const bytes = allocatedBytes(stat), identity = fileIdentity(stat);
        const category = relative.split(path.sep)[0];
        const prior = stat.nlink > BigInt(1) ? this.linked.get(identity) : undefined;
        if (prior) {
          this.result.hardlinkBytesAvoided += bytes;
          if (prior.category !== category && prior.category !== "Shared files") {
            this.result.categories[prior.category] -= prior.bytes;
            this.result.categories["Shared files"] = (this.result.categories["Shared files"] ?? 0) + prior.bytes;
            prior.category = "Shared files";
          }
          continue;
        }
        if (stat.nlink > BigInt(1)) this.linked.set(identity, { category, bytes });
        this.result.allocatedBytes += bytes;
        this.result.categories[category] = (this.result.categories[category] ?? 0) + bytes;
        this.result.largest.push({ path: relative, bytes });
        this.result.largest.sort((a, b) => b.bytes - a.bytes); this.result.largest.length = Math.min(20, this.result.largest.length);
      } catch { this.result.skippedEntries++; }
    }
    this.result.updatedAt = Date.now(); this.result.complete = this.stack.length === 0;
    return this.result;
  }
  async close(): Promise<void> { for (const frame of this.stack.splice(0)) await frame.dir.close().catch(() => {}); }
}
