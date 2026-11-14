import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import type { BigIntStats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { managedPath, ensureManagedDirectory, fileIdentity, allocatedBytes } from "./filesystem.ts";
import { DAY_MS, STORAGE_POLICY } from "./policy.ts";
import { attachmentIndexComplete, attachmentReferenced } from "./attachment-references.ts";

const initialized = new WeakSet<Database.Database>();
const collectionCursors = new WeakMap<Database.Database, string>();
export function ensureImmutableFileSchema(db: Database.Database): void {
  if (initialized.has(db)) return;
  db.exec(`CREATE TABLE IF NOT EXISTS storage_file_objects (
    sha256 TEXT PRIMARY KEY, relative_path TEXT NOT NULL UNIQUE, identity TEXT NOT NULL,
    byte_length INTEGER NOT NULL, modified_ms REAL NOT NULL, orphan_since INTEGER,
    reference_cursor TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS storage_file_candidates (
    relative_path TEXT PRIMARY KEY, identity TEXT NOT NULL, modified_ms REAL NOT NULL,
    byte_length INTEGER NOT NULL, artifact_version INTEGER NOT NULL DEFAULT 0, inspected INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS storage_file_references(
    relative_path TEXT PRIMARY KEY,sha256 TEXT NOT NULL REFERENCES storage_file_objects(sha256),
    blob_id TEXT,artifact_id TEXT,artifact_version INTEGER,was_owned INTEGER NOT NULL DEFAULT 0,released_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS storage_file_reference_objects ON storage_file_references(sha256,relative_path)`);
  const columns = db.pragma("table_info(storage_file_objects)") as Array<{ name: string }>;
  if (!columns.some(column => column.name === "reference_cursor"))
    db.exec("ALTER TABLE storage_file_objects ADD COLUMN reference_cursor TEXT NOT NULL DEFAULT ''");
  initialized.add(db);
}

export function isImmutableUpload(relative: string): boolean {
  return /^(?:(?:chat-documents|chat-audio|chat-videos|chat-files)[/\\]u\d+[/\\](?:doc|aud|vid|fil)_[a-f0-9]{32}|chat-models[/\\][a-f0-9]{2}[/\\]mdl_[a-f0-9]{32})\.[a-z0-9]+$/iu.test(relative);
}

async function digestFile(file: string, signal?: AbortSignal): Promise<string> {
  const digest = createHash("sha256");
  const stream = fs.createReadStream(file, { highWaterMark: 256 * 1024, signal });
  for await (const chunk of stream) digest.update(chunk);
  return digest.digest("hex");
}

/** Only immutable originals and closed artifact versions enter this store.
 * Logical paths remain intact, so readers do no extra lookup or decompression.
 * All application writes to delivered artifacts already replace via rename;
 * mutable workspaces and editable sources must never be passed here. */
export async function deduplicateImmutableFile(db: Database.Database, root: string, relative: string,
  options: { artifactVersion?: boolean; signal?: AbortSignal; stillEligible?: () => boolean; verified?: { hash: string; identity: string; modifiedMs: number; bytes: number } } = {}): Promise<number> {
  if (!isImmutableUpload(relative) && !options.artifactVersion) throw new Error("Not an immutable storage object");
  ensureImmutableFileSchema(db);
  const source = await managedPath(root, relative), before = await fs.promises.stat(source, { bigint: true });
  if (!before.isFile() || before.size < BigInt(16_384)) return 0;
  if (options.verified && (options.verified.identity !== fileIdentity(before) || options.verified.modifiedMs !== Number(before.mtimeMs)
    || options.verified.bytes !== Number(before.size))) throw new Error("Immutable source changed during hashing");
  const hash = options.verified?.hash ?? await digestFile(source, options.signal);
  const after = await fs.promises.stat(source, { bigint: true });
  if (fileIdentity(before) !== fileIdentity(after) || before.size !== after.size || before.mtimeNs !== after.mtimeNs)
    throw new Error("Immutable source changed during verification");
  const relativeObject = path.join("storage", "objects", hash.slice(0, 2), hash);
  const object = path.join(root, relativeObject);
  // A pre-existing hardlink may be a writable workspace reference. Never make
  // that file the canonical object for unrelated uploads.
  if (before.nlink > BigInt(1)) {
    const known = db.prepare("SELECT 1 FROM storage_file_objects WHERE sha256=? AND identity=?").get(hash, fileIdentity(before));
    if (!known) return 0;
  }
  await ensureManagedDirectory(root, path.dirname(relativeObject));
  if (options.signal?.aborted || options.stillEligible?.() === false) return 0;
  let created = false;
  try { await fs.promises.link(source, object); created = true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  await managedPath(root, relativeObject);
  const objectStat = await fs.promises.stat(object, { bigint: true });
  const prior = db.prepare("SELECT identity,modified_ms FROM storage_file_objects WHERE sha256=?").get(hash) as { identity: string; modified_ms: number } | undefined;
  // A process may have exited after publishing the link, before recording it.
  // Rehash an unregistered object rather than trusting its filename.
  const recovered = !created && !prior && await digestFile(object, options.signal) === hash;
  if (objectStat.size !== before.size || (!created && !recovered && (!prior || prior.identity !== fileIdentity(objectStat) || prior.modified_ms !== Number(objectStat.mtimeMs))))
    throw new Error("Immutable object checksum mismatch");
  let saved = 0;
  if (fileIdentity(before) !== fileIdentity(objectStat)) {
    const temporary = `${source}.${randomUUID()}.storage-link`;
    try {
      await fs.promises.link(object, temporary);
      const current = await fs.promises.stat(await managedPath(root, relative), { bigint: true });
      if (fileIdentity(current) !== fileIdentity(before) || current.mtimeNs !== before.mtimeNs || options.signal?.aborted || options.stillEligible?.() === false)
        throw new Error("Immutable source changed before replacement");
      await fs.promises.rename(temporary, source);
      if (before.nlink === BigInt(1)) saved = allocatedBytes(before);
    } finally { await fs.promises.unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
  }
  db.prepare(`INSERT INTO storage_file_objects(sha256,relative_path,identity,byte_length,modified_ms) VALUES(?,?,?,?,?)
    ON CONFLICT(sha256) DO UPDATE SET orphan_since=NULL`).run(hash, relativeObject, fileIdentity(objectStat), Number(objectStat.size), Number(objectStat.mtimeMs));
  const blobId=isImmutableUpload(relative)?path.parse(relative).name:null;
  const parts=relative.split(path.sep),artifactId=options.artifactVersion?parts[2]:null,version=artifactId?Number(parts[3]?.slice(1)):null;
  const owned=blobId ? attachmentIndexComplete(db) && attachmentReferenced(db,blobId) : true;
  db.prepare(`INSERT INTO storage_file_references(relative_path,sha256,blob_id,artifact_id,artifact_version,was_owned) VALUES(?,?,?,?,?,?)
    ON CONFLICT(relative_path) DO UPDATE SET sha256=excluded.sha256,was_owned=MAX(was_owned,excluded.was_owned)`)
    .run(relative,hash,blobId,artifactId,version,owned?1:0);
  return saved;
}

export function enqueueImmutableCandidate(db: Database.Database, relative: string, stat: BigIntStats, artifactVersion = false): void {
  ensureImmutableFileSchema(db);
  if ((!isImmutableUpload(relative) && !artifactVersion) || Number(stat.mtimeMs) > Date.now()-7*DAY_MS || stat.size<BigInt(16_384)) return;
  db.prepare(`INSERT INTO storage_file_candidates(relative_path,identity,modified_ms,byte_length,artifact_version) VALUES(?,?,?,?,?)
    ON CONFLICT(relative_path) DO UPDATE SET identity=excluded.identity,modified_ms=excluded.modified_ms,byte_length=excluded.byte_length,inspected=0
    WHERE identity<>excluded.identity OR modified_ms<>excluded.modified_ms OR byte_length<>excluded.byte_length`)
    .run(relative,fileIdentity(stat),Number(stat.mtimeMs),Number(stat.size),artifactVersion?1:0);
}

/** Hash at most 2 MiB per idle slice. Hash state is disposable; a restart simply
 * rechecks the candidate. No extra full-sized staging copy is allocated. */
export class ImmutableFileWorker {
  private current: { row: { relative_path: string; identity: string; modified_ms: number; byte_length: number; artifact_version: number };
    file: FileHandle; digest: ReturnType<typeof createHash>; offset: number } | null = null;
  async step(db: Database.Database, root: string, shouldYield: () => boolean, eligible?: (relative: string) => boolean): Promise<number> {
    ensureImmutableFileSchema(db);
    if (!this.current) {
      const row=db.prepare("SELECT * FROM storage_file_candidates WHERE inspected=0 ORDER BY relative_path LIMIT 1").get() as NonNullable<ImmutableFileWorker["current"]>["row"]|undefined;
      if (!row) return 0;
      try { this.current={row,file:await fs.promises.open(await managedPath(root,row.relative_path),"r"),digest:createHash("sha256"),offset:0}; }
      catch { db.prepare("UPDATE storage_file_candidates SET inspected=1 WHERE relative_path=?").run(row.relative_path); return 0; }
    }
    const current=this.current, buffer=Buffer.alloc(64*1024);
    const start=Date.now(); let read=0;
    try {
      while(read<2*1024*1024 && !shouldYield()) {
        const {bytesRead}=await current.file.read(buffer,0,buffer.length,current.offset);
        if (!bytesRead) {
          await current.file.close(); this.current=null;
          const saved=await deduplicateImmutableFile(db,root,current.row.relative_path,{artifactVersion:!!current.row.artifact_version,
            stillEligible: () => !shouldYield() && (!current.row.artifact_version || eligible?.(current.row.relative_path) === true),
            verified:{hash:current.digest.digest("hex"),identity:current.row.identity,modifiedMs:current.row.modified_ms,bytes:current.row.byte_length}});
          db.prepare("UPDATE storage_file_candidates SET inspected=1 WHERE relative_path=?").run(current.row.relative_path);
          return saved;
        }
        current.digest.update(buffer.subarray(0,bytesRead)); current.offset+=bytesRead; read+=bytesRead;
        const wait=read/STORAGE_POLICY.ioBytesPerSecond*1000-(Date.now()-start);
        if(wait>0) await new Promise(resolve=>setTimeout(resolve,Math.min(10,wait)));
      }
    } catch (error) {
      await current.file.close().catch(()=>{}); this.current=null;
      db.prepare("UPDATE storage_file_candidates SET inspected=1 WHERE relative_path=?").run(current.row.relative_path);
      throw error;
    }
    return 0;
  }
}

/** Link counts include references outside Breadboard's inventory. The private
 * canonical link is released only after a complete seven-day orphan grace. */
export async function collectImmutableFiles(db: Database.Database, root: string, now = Date.now(), shouldYield = () => false): Promise<number> {
  ensureImmutableFileSchema(db);
  const select = db.prepare("SELECT * FROM storage_file_objects WHERE sha256>? ORDER BY sha256 LIMIT 16");
  let objects = select.all(collectionCursors.get(db) ?? "") as Array<{
    sha256: string; relative_path: string; identity: string; modified_ms: number; orphan_since: number | null; reference_cursor: string;
  }>;
  let released = 0;
  if (!objects.length) { collectionCursors.delete(db); objects = select.all("") as typeof objects; }
  for (const object of objects) {
    if(shouldYield())break;
    collectionCursors.set(db, object.sha256);
    const target = await managedPath(root, object.relative_path);
    let stat = await fs.promises.stat(target, { bigint: true });
    if (fileIdentity(stat) !== object.identity || Number(stat.mtimeMs)!==object.modified_ms) continue;
    const selectReferences=db.prepare("SELECT * FROM storage_file_references WHERE sha256=? AND relative_path>? ORDER BY relative_path LIMIT 128");
    let references=selectReferences.all(object.sha256,object.reference_cursor) as Array<{
      relative_path:string;blob_id:string|null;artifact_id:string|null;artifact_version:number|null;was_owned:number;released_at:number|null;
    }>;
    if(!references.length) {
      db.prepare("UPDATE storage_file_objects SET reference_cursor='' WHERE sha256=?").run(object.sha256);
      references=selectReferences.all(object.sha256,"") as typeof references;
    }
    for(const reference of references) {
      if(shouldYield())break;
      // Keep progress on heavily shared objects. Retained references at the
      // start of a page must not hide released references on later pages.
      db.prepare("UPDATE storage_file_objects SET reference_cursor=? WHERE sha256=?").run(reference.relative_path,object.sha256);
      const retained=()=>reference.blob_id ? attachmentReferenced(db,reference.blob_id)
        : !!db.prepare("SELECT 1 FROM hermes_artifact_versions WHERE artifact_id=? AND version=?").get(reference.artifact_id,reference.artifact_version);
      const owns=retained();
      let logical: string | undefined;
      try {logical=await managedPath(root,reference.relative_path);} catch(error) {if((error as NodeJS.ErrnoException).code!=="ENOENT")continue;}
      if(owns) {
        if(!reference.blob_id || attachmentIndexComplete(db)) db.prepare("UPDATE storage_file_references SET was_owned=1,released_at=NULL WHERE relative_path=?").run(reference.relative_path);
        db.prepare("UPDATE storage_file_objects SET orphan_since=NULL WHERE sha256=?").run(object.sha256);
        if(!logical && (!reference.blob_id || attachmentIndexComplete(db))) {
          await ensureManagedDirectory(root,path.dirname(reference.relative_path));
          // Recovery after an interrupted owner deletion: the DB reference is
          // authoritative and the canonical object still holds the exact bytes.
          await fs.promises.link(target,path.join(root,reference.relative_path)).catch(error=>{if(error.code!=="EEXIST")throw error;});
        }
        continue;
      }
      const current=logical ? await fs.promises.stat(logical,{bigint:true}):null;
      if(current && fileIdentity(current)!==object.identity)logical=undefined; // Preserve the independent replacement.
      if(logical && !reference.was_owned)continue; // Unsent originals stay protected.
      db.transaction(()=>{
        if(retained())return;
        if(logical)fs.unlinkSync(logical);
        if(reference.released_at!==null && reference.released_at<now-7*DAY_MS)
          db.prepare("DELETE FROM storage_file_references WHERE relative_path=? AND sha256=?").run(reference.relative_path,object.sha256);
        else {
          db.prepare("UPDATE storage_file_references SET released_at=COALESCE(released_at,?) WHERE relative_path=?").run(now,reference.relative_path);
          db.prepare("UPDATE storage_file_objects SET orphan_since=COALESCE(orphan_since,?) WHERE sha256=?").run(now,object.sha256);
        }
      })();
    }
    if(db.prepare("SELECT 1 FROM storage_file_references WHERE sha256=? LIMIT 1").get(object.sha256))continue;
    stat=await fs.promises.stat(target,{bigint:true});
    if (stat.nlink > BigInt(1)) { db.prepare("UPDATE storage_file_objects SET orphan_since=NULL WHERE sha256=?").run(object.sha256); continue; }
    if (object.orphan_since === null) db.prepare("UPDATE storage_file_objects SET orphan_since=? WHERE sha256=?").run(now, object.sha256);
    else if (object.orphan_since < now - 7 * DAY_MS) {
      await fs.promises.unlink(target); released += allocatedBytes(stat);
      db.prepare("DELETE FROM storage_file_objects WHERE sha256=?").run(object.sha256);
    }
  }
  return released;
}
