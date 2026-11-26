import type { BigIntStats } from "node:fs";
import type Database from "better-sqlite3";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { managedPath, fileIdentity } from "./filesystem.ts";
import { DAY_MS, STORAGE_POLICY } from "./policy.ts";
import { nativeWorkspaceFile } from "./workspace-native.ts";

/**
 * Warm tier for everything Breadboard keeps outside chat workspaces.
 *
 * Nothing here deletes, moves or renames a file. A file nobody has changed for
 * `warmDays` is compressed in place (Windows XPRESS8K through WOF, falling back
 * to NTFS compression), so every reader, including Explorer and other apps,
 * still opens the same path at ordinary speed. The first write restores a plain
 * file, and a changed file simply waits another `warmDays` before it is
 * considered again. Chat workspaces keep their own, stricter worker
 * (workspace-storage.ts); runtime- and browser-owned trees are never touched.
 */

// Owned roots, relative to the data folder. Anything else is left alone.
const ROOTS = /^(?:quartz|cad-projects|artifacts|chat-documents|recall|runtime\/scriberr|runtime\/hermes|openscience-state|exports|outputs)\//u;
// Trees with their own owner, live state, executable code or browser profiles.
const EXCLUDED = /^(?:runtime\/hermes-workspaces|runtime\/jobs|runtime-v2|database|config|Partitions|Local Storage|agent-runtime|code)\/|\/(?:node_modules|\.git|\.venv|venv|site-packages|__pycache__|models)\/|\/\.restore-|\/cache\//u;
// Text-like and CAD interchange formats that compress well. Media, archives,
// PDFs and office files are already compressed and are never worth the I/O.
const COMPRESSIBLE = /\.(?:html?|css|m?js|map|json|jsonl|ndjson|md|mdx|txt|csv|tsv|xml|svg|tex|bib|log|ya?ml|toml|srt|vtt|ipynb|step|stp|iges|igs|stl|obj|ply|gcode|dxf|scad|raw|vcd|s[12]p|cir|net|spice)$/iu;
const LIVE = /(?:\.(?:sqlite3?|db|ldb|lock|tmp|partial|part|crdownload)|-(?:wal|shm|journal))$/iu;

export const COLD_FILE_POLICY = Object.freeze({
  warmDays: 14,
  minimumBytes: 16 * 1024,
  // Below this ratio the file was not worth compressing; it is not retried
  // until its content changes.
  minimumSaving: STORAGE_POLICY.minimumSaving,
});

const installed = new WeakSet<Database.Database>();
export function ensureColdFileSchema(db: Database.Database): void {
  if (installed.has(db)) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS storage_cold_files(relative_path TEXT PRIMARY KEY,identity TEXT NOT NULL,modified_ms REAL NOT NULL,
      byte_length INTEGER NOT NULL,state TEXT NOT NULL DEFAULT 'pending',saved_bytes INTEGER NOT NULL DEFAULT 0,checked_at INTEGER NOT NULL DEFAULT 0,detail TEXT);
    CREATE INDEX IF NOT EXISTS storage_cold_file_queue ON storage_cold_files(state,modified_ms);`);
  installed.add(db);
}

/** Pure policy: may this data-folder path ever enter the warm tier? */
export function coldFileEligible(relative: string): boolean {
  const normalized = relative.replaceAll("\\", "/");
  return ROOTS.test(normalized) && !EXCLUDED.test(normalized) && COMPRESSIBLE.test(normalized) && !LIVE.test(normalized);
}

/** Scanner callback. Recording a candidate never touches the file. */
export function enqueueColdFile(db: Database.Database, relative: string, stat: BigIntStats): void {
  if (!stat.isFile() || stat.nlink !== BigInt(1) || stat.size < BigInt(COLD_FILE_POLICY.minimumBytes) || !coldFileEligible(relative)) return;
  ensureColdFileSchema(db);
  // A changed file returns to 'pending'; an unchanged one keeps its verdict.
  db.prepare(`INSERT INTO storage_cold_files(relative_path,identity,modified_ms,byte_length) VALUES(?,?,?,?)
    ON CONFLICT(relative_path) DO UPDATE SET identity=excluded.identity,modified_ms=excluded.modified_ms,byte_length=excluded.byte_length,
      state='pending',saved_bytes=0,checked_at=0,detail=NULL
    WHERE identity<>excluded.identity OR modified_ms<>excluded.modified_ms OR byte_length<>excluded.byte_length`)
    .run(relative.replaceAll("\\", "/"), fileIdentity(stat), Number(stat.mtimeMs), Number(stat.size));
}

export function coldFileStatus(db: Database.Database) {
  ensureColdFileSchema(db);
  return db.prepare(`SELECT COUNT(*) FILTER (WHERE state='compressed') files,COALESCE(SUM(saved_bytes),0) savedBytes,
    COUNT(*) FILTER (WHERE state='pending') pending FROM storage_cold_files`).get() as { files: number; savedBytes: number; pending: number };
}

type Row = { relative_path: string; identity: string; modified_ms: number; byte_length: number };

/** One bounded step. I/O is paced at the policy rate, so a backlog drains over
 * idle periods without ever being noticeable. */
export class ColdFileWorker {
  private nextOperation = 0;
  private readonly native: typeof nativeWorkspaceFile;
  private readonly platform: NodeJS.Platform;
  constructor(native: typeof nativeWorkspaceFile = nativeWorkspaceFile, platform: NodeJS.Platform = process.platform) {
    this.native = native;
    this.platform = platform;
  }
  async step(db: Database.Database, root: string, shouldYield: () => boolean, signal?: AbortSignal, now = Date.now()): Promise<number> {
    if (this.platform !== "win32" || now < this.nextOperation || shouldYield()) return 0;
    ensureColdFileSchema(db);
    const rows = db.prepare(`SELECT relative_path,identity,modified_ms,byte_length FROM storage_cold_files
      WHERE state='pending' AND modified_ms<? ORDER BY checked_at,modified_ms LIMIT 8`).all(now - COLD_FILE_POLICY.warmDays * DAY_MS) as Row[];
    let saved = 0;
    for (const row of rows) {
      if (shouldYield() || Date.now() < this.nextOperation) break;
      const settle = (state: string, bytes: number, detail: string | null) => db.prepare(
        "UPDATE storage_cold_files SET state=?,saved_bytes=?,checked_at=?,detail=? WHERE relative_path=? AND identity=? AND modified_ms=?")
        .run(state, bytes, Date.now(), detail, row.relative_path, row.identity, row.modified_ms);
      try {
        if (!coldFileEligible(row.relative_path)) { settle("skipped", 0, "Outside the warm tier"); continue; }
        const target = await managedPath(root, row.relative_path), stat = await fs.promises.lstat(target, { bigint: true });
        // Revalidate: the scanner's view may be a day old.
        if (!stat.isFile() || stat.nlink !== BigInt(1) || fileIdentity(stat) !== row.identity || Number(stat.mtimeMs) !== row.modified_ms
          || Number(stat.size) !== row.byte_length) {
          db.prepare("DELETE FROM storage_cold_files WHERE relative_path=? AND identity=? AND modified_ms=?").run(row.relative_path, row.identity, row.modified_ms);
          continue;
        }
        const allocated = await this.native({ root, path: target, identity: String(stat.ino), action: "inspect", signal });
        if (allocated < row.byte_length * (1 - COLD_FILE_POLICY.minimumSaving)) { settle("compressed", Math.max(0, row.byte_length - allocated), null); continue; }
        // The helper holds an exclusive handle: a file another process has open
        // for writing fails here and is retried on a later pass, untouched.
        const released = await this.native({ root, path: target, identity: String(stat.ino), action: "wof", signal });
        // Read once to hash, once to verify after compression, plus the write.
        this.nextOperation = Date.now() + 3 * row.byte_length / STORAGE_POLICY.ioBytesPerSecond * 1000;
        settle(released >= row.byte_length * COLD_FILE_POLICY.minimumSaving ? "compressed" : "skipped", released, null);
        saved += released;
      } catch (error) {
        const message = String(error instanceof Error ? error.message : error).slice(0, 300);
        // Leave it pending but behind the rest of the queue; a busy file is the
        // common case and must not hold up every other candidate.
        db.prepare("UPDATE storage_cold_files SET checked_at=?,detail=? WHERE relative_path=?").run(Date.now(), message, row.relative_path);
        this.nextOperation = Date.now() + 5_000;
        break;
      }
    }
    return saved;
  }
}
