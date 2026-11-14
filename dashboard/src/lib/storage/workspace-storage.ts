import { createHash, randomUUID, type Hash } from "node:crypto";
import type { BigIntStats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import type Database from "better-sqlite3";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { managedPath, ensureManagedDirectory, fileIdentity, allocatedBytes, releaseDisposableFile } from "./filesystem.ts";
import { DAY_MS, STORAGE_POLICY } from "./policy.ts";
import { nativeWorkspaceFile } from "./workspace-native.ts";
import { runtimeProcessPath, sameRuntimePath } from "../../../scripts/runtime-v2-paths.mjs";

const prefix = "runtime/hermes-workspaces/";
const installed = new WeakSet<Database.Database>();
type Candidate = { relative_path: string; workspace_key: string; identity: string; modified_ms: number; byte_length: number; kind: "input" | "file" };

export function ensureWorkspaceStorage(db: Database.Database): void {
  if (installed.has(db)) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS storage_workspace_activity(workspace_key TEXT PRIMARY KEY,accessed_at INTEGER NOT NULL,holder TEXT,lease_until INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS storage_workspace_candidates(relative_path TEXT PRIMARY KEY,workspace_key TEXT NOT NULL,identity TEXT NOT NULL,modified_ms REAL NOT NULL,byte_length INTEGER NOT NULL,kind TEXT NOT NULL,checked_at INTEGER NOT NULL DEFAULT 0,detail TEXT);
    CREATE INDEX IF NOT EXISTS storage_workspace_candidate_scan ON storage_workspace_candidates(checked_at,relative_path);
    CREATE TABLE IF NOT EXISTS storage_workspace_objects(sha256 TEXT PRIMARY KEY,relative_path TEXT NOT NULL UNIQUE,byte_length INTEGER NOT NULL,allocated_bytes INTEGER NOT NULL,created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS storage_workspace_inputs(relative_path TEXT PRIMARY KEY,workspace_key TEXT NOT NULL,sha256 TEXT NOT NULL REFERENCES storage_workspace_objects(sha256),modified_ms REAL NOT NULL,created_at INTEGER NOT NULL,state TEXT NOT NULL DEFAULT 'pending',source_bytes INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS storage_workspace_input_key ON storage_workspace_inputs(workspace_key);
    CREATE INDEX IF NOT EXISTS storage_workspace_input_object ON storage_workspace_inputs(sha256);
    CREATE TRIGGER IF NOT EXISTS storage_workspace_unsettled_reference BEFORE DELETE ON storage_workspace_inputs
      WHEN OLD.state<>'archived' BEGIN SELECT RAISE(IGNORE); END;
    CREATE TABLE IF NOT EXISTS storage_workspace_totals(id INTEGER PRIMARY KEY CHECK(id=1),compressed_bytes INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS storage_workspace_scratch(relative_path TEXT PRIMARY KEY,created_at INTEGER NOT NULL);
    INSERT OR IGNORE INTO storage_workspace_totals(id) VALUES(1);
    UPDATE storage_workspace_candidates SET checked_at=0,detail=NULL WHERE detail='spawn powershell.exe ENOENT' OR detail LIKE '#< CLIXML%' OR detail LIKE 'The environment block used to start a process cannot be longer than%';
  `);
  installed.add(db);
}

/** Only the isolated, server-generated conversation roots are owned here. */
export function workspaceLocation(relative: string): { key: string; local: string } | null {
  const normalized = relative.replaceAll("\\", "/");
  if (!normalized.startsWith(prefix)) return null;
  const pieces = normalized.slice(prefix.length).split("/");
  if (pieces.length < 3 || pieces[0] !== "conversations" || !pieces.slice(1,3).every(v => /^[a-z0-9_-]{1,80}$/u.test(v))) return null;
  if (pieces.some(v => !v || v === "." || v === ".." || v.includes(":"))) return null;
  return { key: pieces.slice(0,3).join("/"), local: pieces.slice(3).join("/") };
}

export function enqueueWorkspaceCandidate(db: Database.Database, relative: string, stat: BigIntStats): void {
  const location = workspaceLocation(relative);
  if (!location?.local || !stat.isFile() || stat.nlink !== BigInt(1) || stat.size < BigInt(STORAGE_POLICY.minimumPayloadBytes)) return;
  // Never compress active databases, executables, recovery journals or caches.
  // Ordinary outputs keep their paths; NTFS provides transparent random reads.
  const input = /^\.breadboard\/attachments\/[^/]+$/u.test(location.local) && !/\/\.restore-/u.test(location.local);
  if (location.local.includes("/.restore-")) return;
  if (!input && !/\.(?:txt|md|csv|json|jsonl|xml|svg|html|tex|log|raw|vcd|s[12]p)$/iu.test(location.local)) return;
  ensureWorkspaceStorage(db);
  db.prepare(`INSERT INTO storage_workspace_candidates(relative_path,workspace_key,identity,modified_ms,byte_length,kind) VALUES(?,?,?,?,?,?)
    ON CONFLICT(relative_path) DO UPDATE SET identity=excluded.identity,modified_ms=excluded.modified_ms,byte_length=excluded.byte_length,checked_at=0,detail=NULL
    WHERE identity<>excluded.identity OR modified_ms<>excluded.modified_ms OR byte_length<>excluded.byte_length`)
    .run(relative.replaceAll("\\", "/"),location.key,fileIdentity(stat),Number(stat.mtimeMs),Number(stat.size),input?"input":"file");
}

export function touchWorkspace(db: Database.Database, key: string, now = Date.now()): void {
  ensureWorkspaceStorage(db);
  db.prepare(`INSERT INTO storage_workspace_activity(workspace_key,accessed_at) VALUES(?,?)
    ON CONFLICT(workspace_key) DO UPDATE SET accessed_at=MAX(accessed_at,excluded.accessed_at)
    WHERE accessed_at<excluded.accessed_at-1000`).run(key,now);
}

export function coldWorkspace(db: Database.Database, key: string, now = Date.now()): boolean {
  ensureWorkspaceStorage(db);
  const cutoff = now - STORAGE_POLICY.coldDays * DAY_MS;
  const activity = db.prepare("SELECT accessed_at,lease_until FROM storage_workspace_activity WHERE workspace_key=?").get(key) as {accessed_at:number;lease_until:number}|undefined;
  if (activity && (activity.accessed_at >= cutoff || activity.lease_until > now)) return false;
  // Unknown owners, unrecognized states, pending messages and any unfinished
  // recovery operation are protected. A success status alone is not authority.
  return !!db.prepare(`SELECT 1 FROM hermes_runtime_sessions s JOIN conversations c ON c.id=s.conversation_id
    LEFT JOIN storage_conversation_activity a ON a.conversation_id=c.id
    WHERE s.workspace_key=? AND c.updated_at<datetime(?/1000,'unixepoch')
      AND s.updated_at<datetime(?/1000,'unixepoch') AND COALESCE(a.last_read_at,0)<?
      AND NOT EXISTS(SELECT 1 FROM conversation_messages m WHERE m.conversation_id=c.id AND
        (m.updated_at>=datetime(?/1000,'unixepoch') OR m.status='pending' OR json_extract(CASE WHEN json_valid(m.metadata) THEN m.metadata END,'$.externalAgentOutcome')='running'))
      AND NOT EXISTS(SELECT 1 FROM hermes_runs r JOIN hermes_runtime_sessions rs ON rs.id=r.runtime_session_id
        WHERE rs.conversation_id=c.id AND (r.status NOT IN ('completed','failed','cancelled','stopped')
          OR json_extract(CASE WHEN json_valid(r.dispatch_json) THEN r.dispatch_json END,'$.taskRecovery.pending')=1)) LIMIT 1`)
    .get(key,cutoff,cutoff,cutoff,cutoff);
}

function claim(db: Database.Database, key: string, holder: string, now = Date.now()): boolean {
  db.prepare("INSERT OR IGNORE INTO storage_workspace_activity(workspace_key,accessed_at) VALUES(?,0)").run(key);
  return db.prepare("UPDATE storage_workspace_activity SET holder=?,lease_until=? WHERE workspace_key=? AND lease_until<=?").run(holder,now+60_000,key,now).changes===1;
}
function release(db: Database.Database, key: string, holder: string): void {
  db.prepare("UPDATE storage_workspace_activity SET holder=NULL,lease_until=0 WHERE workspace_key=? AND holder=?").run(key,holder);
}

function durable(db:Database.Database,write:()=>void):void {
  // A successful WAL commit must survive a power failure before deleting any
  // file. Restore the owning connection's normal performance policy afterward.
  const previous=db.pragma("synchronous",{simple:true}) as number;
  try {db.pragma("synchronous=FULL");db.transaction(write).immediate();}
  finally {db.pragma(`synchronous=${previous}`);}
}

function hashFile(filename:string):string {
  const fd=fs.openSync(filename,"r"), hash=createHash("sha256"),buffer=Buffer.allocUnsafe(256*1024);
  try {for (;;) {const n=fs.readSync(fd,buffer,0,buffer.length,null);if(!n)break;hash.update(buffer.subarray(0,n));}return hash.digest("hex");}
  finally {fs.closeSync(fd);}
}

function safeSync(root: string, relative: string, missingLeaf = false): string {
  const base = path.resolve(root), target = path.resolve(base,relative), rel = path.relative(base,target);
  if (!rel || path.isAbsolute(relative) || rel.startsWith(`..${path.sep}`) || rel === ".." || path.isAbsolute(rel)) throw new Error("Workspace storage path escapes its root");
  let current=base;
  for (const part of ["",...rel.split(path.sep)]) {
    if (part) current=path.join(current,part);
    const stat=fs.lstatSync(current,{throwIfNoEntry:false});
    if (!stat && missingLeaf && current===target) break;
    if (!stat || stat.isSymbolicLink()) throw new Error("Missing or redirected workspace path");
    if (!sameRuntimePath(fs.realpathSync.native(current),current)) throw new Error("Redirected workspace authority");
  }
  return target;
}

/** Materialize private, writable copies. No link ever joins an editable file to
 * the object store. The reference is removed only after a verified atomic
 * publication; disk-full/crashes leave the object and manifest recoverable.
 * Unsettled references also have a database guard: after a process crash an
 * orphaned native helper might finish deleting its original after the lease
 * expires. An existing path alone cannot prove that operation has settled. */
export function restoreWorkspaceInputs(db: Database.Database, root: string, workspace: string): number {
  const location=workspaceLocation(path.relative(runtimeProcessPath(root),runtimeProcessPath(path.resolve(workspace))));
  if (!location || location.local) return 0;
  ensureWorkspaceStorage(db); touchWorkspace(db,location.key);
  const rows=db.prepare(`SELECT i.*,o.relative_path object_path,o.byte_length FROM storage_workspace_inputs i
    JOIN storage_workspace_objects o ON o.sha256=i.sha256 WHERE i.workspace_key=? ORDER BY i.relative_path`).all(location.key) as Array<{
      relative_path:string;object_path:string;sha256:string;modified_ms:number;byte_length:number;
    }>;
  if (!rows.length) return 0;
  const holder=randomUUID();
  if (!claim(db,location.key,holder)) throw new Error("Workspace storage is finishing a verified operation. Retry in a moment.");
  let restored=0;
  try {
    for (const row of rows) {
      if (workspaceLocation(row.relative_path)?.key!==location.key || !row.relative_path.includes("/.breadboard/attachments/")) throw new Error("Invalid archived workspace input");
      const target=safeSync(root,row.relative_path,true);
      if (!fs.existsSync(target)) {
        const volume=fs.statfsSync(root);
        if (volume.bavail*volume.bsize<row.byte_length+64*1024**2) throw new Error("More free space is needed to restore this workspace. Its archived files are intact.");
        if (!/^storage\/workspace-objects\/[a-f0-9]{64}\.blob$/u.test(row.object_path)) throw new Error("Invalid workspace object");
        const object=safeSync(root,row.object_path), temporary=path.join(path.dirname(target),`.restore-${randomUUID()}.tmp`);
        const scratch=path.relative(root,temporary).replaceAll("\\","/");
        durable(db,()=>{db.prepare("INSERT INTO storage_workspace_scratch VALUES(?,?)").run(scratch,Date.now());});
        let input=-1,output=-1;
        try {
          input=fs.openSync(object,"r"); output=fs.openSync(temporary,"wx",0o600);
          const buffer=Buffer.allocUnsafe(256*1024), hash=createHash("sha256"); let bytes=0;
          for (;;) {
            const count=fs.readSync(input,buffer,0,buffer.length,null); if (!count) break;
            hash.update(buffer.subarray(0,count)); bytes+=count;
            let offset=0; while(offset<count) offset+=fs.writeSync(output,buffer,offset,count-offset);
          }
          fs.fsyncSync(output);
          if (bytes!==row.byte_length || hash.digest("hex")!==row.sha256) throw new Error("Workspace archive failed verification; its original reference was retained.");
          fs.closeSync(output); fs.closeSync(input);
          safeSync(root,row.relative_path,true);
          // link(EXCL) publishes the new private inode without overwriting a
          // concurrently created edit. It never links to the shared object.
          fs.linkSync(temporary,target); fs.unlinkSync(temporary);
          db.prepare("DELETE FROM storage_workspace_scratch WHERE relative_path=?").run(scratch);
          fs.utimesSync(target,new Date(),new Date(row.modified_ms)); restored++;
        } catch(error) {
          try { fs.closeSync(output); } catch {} try { fs.closeSync(input); } catch {}
          try { fs.unlinkSync(temporary); } catch {}
          if (!fs.existsSync(temporary)) db.prepare("DELETE FROM storage_workspace_scratch WHERE relative_path=?").run(scratch);
          throw error;
        }
      } else {
        // An edit or a completed restore already owns this name. Never replace it.
        const current=fs.lstatSync(target,{bigint:true});
        if (!current.isFile() || current.isSymbolicLink() || current.nlink!==BigInt(1)) throw new Error("Unsafe workspace restore destination");
        if (Number(current.size)!==row.byte_length || hashFile(target)!==row.sha256) {
          // A crash can leave an independently edited destination beside an
          // older archive. Both are unique work until explicitly reconciled.
          db.prepare("UPDATE storage_workspace_inputs SET state='conflict' WHERE relative_path=?").run(row.relative_path);
          continue;
        }
      }
      db.prepare("DELETE FROM storage_workspace_inputs WHERE relative_path=? AND sha256=?").run(row.relative_path,row.sha256);
    }
    return restored;
  } finally { release(db,location.key,holder); }
}

export async function prepareWorkspaceInputs(db: Database.Database, root: string, workspace: string): Promise<number> {
  const location=workspaceLocation(path.relative(runtimeProcessPath(root),runtimeProcessPath(path.resolve(workspace))));
  if (!location || location.local) return 0;
  touchWorkspace(db,location.key);
  const deadline=Date.now()+65_000;
  for (;;) {
    const lock=db.prepare("SELECT lease_until FROM storage_workspace_activity WHERE workspace_key=?").get(location.key) as {lease_until:number};
    if (lock.lease_until<=Date.now()) return restoreWorkspaceInputs(db,root,workspace);
    if (Date.now()>=deadline) throw new Error("Workspace maintenance has not released its recovery lease.");
    await new Promise(resolve=>setTimeout(resolve,50));
  }
}

export function workspaceStorageStatus(db: Database.Database) {
  ensureWorkspaceStorage(db);
  const references=db.prepare(`SELECT COUNT(*) files,COUNT(DISTINCT workspace_key) workspaces,COALESCE(SUM(o.byte_length),0) logicalBytes,COALESCE(SUM(i.source_bytes),0) sourceBytes
    FROM storage_workspace_inputs i JOIN storage_workspace_objects o ON o.sha256=i.sha256 WHERE i.state='archived'`).get() as {files:number;workspaces:number;logicalBytes:number;sourceBytes:number};
  const objects=db.prepare("SELECT COALESCE(SUM(allocated_bytes),0) bytes FROM storage_workspace_objects").get() as {bytes:number};
  const compression=db.prepare("SELECT compressed_bytes bytes FROM storage_workspace_totals WHERE id=1").get() as {bytes:number};
  const skipped=db.prepare("SELECT relative_path path,detail reason FROM storage_workspace_candidates WHERE detail IS NOT NULL ORDER BY checked_at DESC LIMIT 5").all();
  const recoveries=db.prepare("SELECT count(*) count FROM storage_workspace_inputs WHERE state<>'archived'").get() as {count:number};
  const archivedWorkspaces=db.prepare(`SELECT workspace_key key,count(*) files FROM storage_workspace_inputs GROUP BY workspace_key ORDER BY workspace_key LIMIT 20`).all();
  return {...references,objectBytes:objects.bytes,deduplicatedBytes:Math.max(0,references.sourceBytes-objects.bytes),compressedBytes:compression.bytes,recoveryCopies:recoveries.count,archivedWorkspaces,skipped};
}

/** Only producer-journalled scratch and unreferenced immutable objects expire.
 * Retained archive/recovery references have no expiry. There is no tree delete. */
export async function collectWorkspaceStorage(db:Database.Database,root:string,shouldYield:()=>boolean,now=Date.now()):Promise<number> {
  ensureWorkspaceStorage(db);let released=0;
  const scratch=db.prepare("SELECT relative_path FROM storage_workspace_scratch WHERE created_at<? LIMIT 16").all(now-7*DAY_MS) as Array<{relative_path:string}>;
  for(const row of scratch) {
    if(shouldYield())return released;
    if(!/^storage\/workspace-objects\/[a-f0-9-]{36}\.partial$/u.test(row.relative_path)
      && !(workspaceLocation(row.relative_path) && /\/\.restore-[a-f0-9-]{36}\.tmp$/u.test(row.relative_path)))continue;
    try {await releaseDisposableFile(db,root,row.relative_path,"workspace-storage","temporary",now-7*DAY_MS-1);}
    catch(error) {if((error as NodeJS.ErrnoException).code!=="ENOENT")continue;}
    db.prepare("DELETE FROM storage_workspace_scratch WHERE relative_path=?").run(row.relative_path);
  }
  const objects=db.prepare(`SELECT * FROM storage_workspace_objects o WHERE created_at<?
    AND NOT EXISTS(SELECT 1 FROM storage_workspace_inputs i WHERE i.sha256=o.sha256) LIMIT 8`).all(now-7*DAY_MS) as Array<{sha256:string;relative_path:string}>;
  for(const row of objects) {
    if(shouldYield())break;
    if(row.relative_path!==`storage/workspace-objects/${row.sha256}.blob` || !/^[a-f0-9]{64}$/u.test(row.sha256))continue;
    try {
      const target=await managedPath(root,row.relative_path),stat=await fs.promises.lstat(target,{bigint:true});
      if(!stat.isFile() || stat.nlink!==BigInt(1))continue;
      // No await between the reference check and unlink. Producers/restore
      // commit references in this same SQLite database before releasing leases.
      db.transaction(()=>{
        if(db.prepare("SELECT 1 FROM storage_workspace_inputs WHERE sha256=?").get(row.sha256))return;
        fs.unlinkSync(target);db.prepare("DELETE FROM storage_workspace_objects WHERE sha256=?").run(row.sha256);released+=allocatedBytes(stat);
      }).immediate();
    } catch(error) {
      if((error as NodeJS.ErrnoException).code==="ENOENT")db.prepare("DELETE FROM storage_workspace_objects WHERE sha256=? AND NOT EXISTS(SELECT 1 FROM storage_workspace_inputs WHERE sha256=?)").run(row.sha256,row.sha256);
    }
  }
  return released;
}

/** A bounded producer: copying/hashing yields every 256 KiB, at 10 MiB/s.
 * Only the final native compare-and-delete holds a workspace lease. */
export class WorkspaceStorageWorker {
  private current: { row:Candidate; input:FileHandle; output:FileHandle; temporary:string; hash:Hash; bytes:number; nextRead:number } | null=null;
  private nextOperation=0;
  get pending():boolean {return this.current!==null;}
  async step(db: Database.Database,root: string,shouldYield:()=>boolean,signal?:AbortSignal): Promise<number> {
    ensureWorkspaceStorage(db);
    if (process.platform!=="win32" || Date.now()<this.nextOperation) return 0;
    if (!this.current) {
      const rows=db.prepare(`SELECT * FROM storage_workspace_candidates c WHERE checked_at<?
        AND NOT EXISTS(SELECT 1 FROM storage_workspace_inputs i WHERE i.relative_path=c.relative_path)
        ORDER BY checked_at,relative_path LIMIT 16`).all(Date.now()-7*DAY_MS) as Candidate[];
      let row:Candidate|undefined;
      for (const candidate of rows) {
        if(shouldYield())return 0;
        db.prepare("UPDATE storage_workspace_candidates SET checked_at=?,detail=NULL WHERE relative_path=?").run(Date.now(),candidate.relative_path);
        if (candidate.modified_ms<Date.now()-7*DAY_MS && coldWorkspace(db,candidate.workspace_key)) {row=candidate;break;}
      }
      if (!row || shouldYield()) return 0;
      try {
        const target=await managedPath(root,row.relative_path), stat=await fs.promises.lstat(target,{bigint:true});
        if (!stat.isFile() || stat.nlink!==BigInt(1) || fileIdentity(stat)!==row.identity || Number(stat.mtimeMs)!==row.modified_ms) return 0;
        if (row.kind==="file") {
          const holder=randomUUID(); if (!coldWorkspace(db,row.workspace_key) || !claim(db,row.workspace_key,holder)) return 0;
          try {
            const saved=await nativeWorkspaceFile({root,path:target,identity:String(stat.ino),action:"compress",signal});
            db.prepare("UPDATE storage_workspace_totals SET compressed_bytes=compressed_bytes+? WHERE id=1").run(saved);
            // Charge verification reads and writes as well as the source read.
            this.nextOperation=Date.now()+4*row.byte_length/STORAGE_POLICY.ioBytesPerSecond*1000;
            return saved;
          } finally { release(db,row.workspace_key,holder); }
        }
        const volume=await fs.promises.statfs(root);
        if (volume.bavail*volume.bsize<STORAGE_POLICY.reserveBytes+row.byte_length) throw new Error("Waiting for archive scratch space plus the 2 GiB reserve.");
        // Detect open writers/alternate streams before allocating a second copy.
        await nativeWorkspaceFile({root,path:target,identity:String(stat.ino),action:"inspect",signal});
        await ensureManagedDirectory(root,"storage/workspace-objects");
        const temporary=`storage/workspace-objects/${randomUUID()}.partial`;
        durable(db,()=>{db.prepare("INSERT INTO storage_workspace_scratch VALUES(?,?)").run(temporary,Date.now());});
        const input=await fs.promises.open(target,"r");
        try {
          const output=await fs.promises.open(path.join(root,temporary),"wx",0o600);
          this.current={row,input,output,temporary,hash:createHash("sha256"),bytes:0,nextRead:Date.now()};
        } catch(error) { await input.close(); throw error; }
      } catch(error) {
        db.prepare("UPDATE storage_workspace_candidates SET detail=? WHERE relative_path=?").run(String(error instanceof Error?error.message:error).slice(0,300),row.relative_path); return 0;
      }
    }
    const current=this.current!;
    try {
      db.prepare("UPDATE storage_workspace_scratch SET created_at=? WHERE relative_path=?").run(Date.now(),current.temporary);
      if (!coldWorkspace(db,current.row.workspace_key)) {await this.cancel(db,root); return 0;}
      const buffer=Buffer.allocUnsafe(256*1024); let readThisSlice=0;
      while(!shouldYield() && readThisSlice<2*1024**2) {
        if(Date.now()<current.nextRead) {
          await new Promise(resolve=>setTimeout(resolve,Math.min(25,current.nextRead-Date.now())));
          continue;
        }
        const {bytesRead}=await current.input.read(buffer,0,buffer.length,null);
        if (!bytesRead) return await this.commit(db,root,signal);
        current.hash.update(buffer.subarray(0,bytesRead));
        let offset=0; while(offset<bytesRead) offset+=(await current.output.write(buffer,offset,bytesRead-offset)).bytesWritten;
        current.bytes+=bytesRead; readThisSlice+=bytesRead;
        current.nextRead=Date.now()+2*bytesRead/STORAGE_POLICY.ioBytesPerSecond*1000;
      }
      return 0;
    } catch(error) {
      db.prepare("UPDATE storage_workspace_candidates SET detail=? WHERE relative_path=?").run(String(error instanceof Error?error.message:error).slice(0,300),current.row.relative_path);
      await this.cancel(db,root); return 0;
    }
  }
  private async cancel(db:Database.Database,root:string):Promise<void> {
    const current=this.current;this.current=null;if(!current)return;
    await current.input.close().catch(()=>{});await current.output.close().catch(()=>{});
    // The producer issues cleanup authority only after releasing its handles.
    await releaseDisposableFile(db,root,current.temporary,"workspace-storage","temporary").catch(()=>{});
  }
  private async commit(db:Database.Database,root:string,signal?:AbortSignal):Promise<number> {
    const current=this.current!,row=current.row;
    await current.output.sync(); await current.output.close(); await current.input.close();
    const hash=current.hash.digest("hex"), object=`storage/workspace-objects/${hash}.blob`;
    const target=await managedPath(root,row.relative_path), stat=await fs.promises.lstat(target,{bigint:true});
    if (current.bytes!==row.byte_length || fileIdentity(stat)!==row.identity || Number(stat.mtimeMs)!==row.modified_ms || !coldWorkspace(db,row.workspace_key)) {
      await this.cancel(db,root);return 0;
    }
    const temporaryStat=await fs.promises.lstat(await managedPath(root,current.temporary),{bigint:true});
    // Register the canonical name before publication; a crash can leave either
    // the object or its scratch file, both discoverable without a startup scan.
    db.prepare("INSERT OR IGNORE INTO storage_workspace_objects VALUES(?,?,?,?,?)").run(hash,object,row.byte_length,allocatedBytes(temporaryStat),Date.now());
    let created=false;
    try { await fs.promises.link(path.join(root,current.temporary),path.join(root,object));created=true; }
    catch(error) { if((error as NodeJS.ErrnoException).code!=="EEXIST") throw error; }
    await fs.promises.unlink(path.join(root,current.temporary));this.current=null;
    db.prepare("DELETE FROM storage_workspace_scratch WHERE relative_path=?").run(current.temporary);
    let stored=await fs.promises.lstat(await managedPath(root,object),{bigint:true});
    if (!stored.isFile() || stored.nlink!==BigInt(1) || Number(stored.size)!==row.byte_length) throw new Error("Invalid workspace archive object");
    if(created)await nativeWorkspaceFile({root,path:path.join(root,object),identity:String(stored.ino),hash,action:"compress",signal}).catch(()=>0);
    stored=await fs.promises.lstat(await managedPath(root,object),{bigint:true});
    const objectBytes=await nativeWorkspaceFile({root,path:path.join(root,object),identity:String(stored.ino),action:"inspect",signal});
    db.prepare("UPDATE storage_workspace_objects SET allocated_bytes=? WHERE sha256=?").run(objectBytes,hash);
    const holder=randomUUID();if(!coldWorkspace(db,row.workspace_key) || !claim(db,row.workspace_key,holder)) return 0;
    try {
      // SQLite commits the recovery reference BEFORE the only filesystem removal.
      durable(db,()=>{
        db.prepare("INSERT INTO storage_workspace_inputs(relative_path,workspace_key,sha256,modified_ms,created_at) VALUES(?,?,?,?,?)").run(row.relative_path,row.workspace_key,hash,row.modified_ms,Date.now());
      });
      const released=await nativeWorkspaceFile({root,path:target,object:path.join(root,object),hash,identity:String(stat.ino),action:"deduplicate",newObject:created,signal});
      db.prepare("UPDATE storage_workspace_inputs SET state='archived',source_bytes=? WHERE relative_path=? AND sha256=?").run(released,row.relative_path,hash);
      this.nextOperation=Date.now()+(created?8:2)*row.byte_length/STORAGE_POLICY.ioBytesPerSecond*1000;
      return Math.max(0,released-(created?objectBytes:0));
    } finally { release(db,row.workspace_key,holder); }
  }
}
