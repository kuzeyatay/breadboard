import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { build } from "esbuild";
import Database from "better-sqlite3";

const bundle=await build({entryPoints:[path.resolve(import.meta.dirname,"../src/lib/storage/workspace-storage.ts")],bundle:true,platform:"node",format:"cjs",packages:"external",write:false});
const module={exports:{}};new Function("require","module","exports",bundle.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
const storage=module.exports;
const nativeBundle=await build({entryPoints:[path.resolve(import.meta.dirname,"../src/lib/storage/workspace-native.ts")],bundle:true,platform:"node",format:"cjs",packages:"external",write:false});
const nativeModule={exports:{}};new Function("require","module","exports",nativeBundle.outputFiles[0].text)(createRequire(import.meta.url),nativeModule,nativeModule.exports);
const {nativeWorkspaceFile}=nativeModule.exports;
const old=Date.now()-14*86400000;
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
function fixture(t) {
  const base=path.resolve(os.tmpdir()),root=fs.mkdtempSync(path.join(base,"breadboard-workspace-test-")),db=new Database(":memory:");
  db.pragma("foreign_keys=ON");
  db.exec(`CREATE TABLE conversations(id INTEGER PRIMARY KEY,updated_at TEXT);
    CREATE TABLE conversation_messages(conversation_id INTEGER,updated_at TEXT,status TEXT,metadata TEXT);
    CREATE TABLE hermes_runtime_sessions(id INTEGER PRIMARY KEY,conversation_id INTEGER,workspace_key TEXT,updated_at TEXT);
    CREATE TABLE hermes_runs(runtime_session_id INTEGER,status TEXT,dispatch_json TEXT);
    CREATE TABLE storage_conversation_activity(conversation_id INTEGER PRIMARY KEY,last_read_at INTEGER);
    INSERT INTO conversations VALUES(1,'2020-01-01'),(2,'2020-01-01');
    INSERT INTO hermes_runtime_sessions VALUES(1,1,'conversations/conv_a/conv_a','2020-01-01'),(2,2,'conversations/conv_b/conv_b','2020-01-01');`);
  storage.ensureWorkspaceStorage(db);
  t.after(()=>{db.close();assert.equal(path.dirname(path.resolve(root)),base);assert.ok(path.basename(root).startsWith("breadboard-workspace-test-"));fs.rmSync(root,{recursive:true,force:true});});
  const file=(key,bytes,name="original.pdf")=>{
    const relative=`runtime/hermes-workspaces/conversations/conv_${key}/conv_${key}/.breadboard/attachments/${name}`,target=path.join(root,relative);
    fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);fs.utimesSync(target,new Date(old),new Date(old));
    return {relative,target,workspace:path.resolve(target,"../../..")};
  };
  const archived=(key,bytes)=>{
    const entry=file(key,bytes),hash=sha(bytes),relative=`storage/workspace-objects/${hash}.blob`,object=path.join(root,relative);
    fs.mkdirSync(path.dirname(object),{recursive:true});if(!fs.existsSync(object))fs.writeFileSync(object,bytes);
    db.prepare("INSERT OR IGNORE INTO storage_workspace_objects VALUES(?,?,?,?,?)").run(hash,relative,bytes.length,bytes.length,old);
    db.prepare("INSERT INTO storage_workspace_inputs VALUES(?,?,?,?,?,'archived',?)").run(entry.relative,`conversations/conv_${key}/conv_${key}`,hash,old,old,bytes.length);
    fs.unlinkSync(entry.target);return {...entry,object,hash};
  };
  return {root,db,file,archived};
}

test("archive restores exact bytes and filenames as independent editable files",t=>{
  const f=fixture(t),bytes=Buffer.from("exact binary\0 content".repeat(2000));
  const a=f.archived("a",bytes),b=f.archived("b",bytes);
  assert.equal(storage.restoreWorkspaceInputs(f.db,f.root,a.workspace),1);
  assert.deepEqual(fs.readFileSync(a.target),bytes);
  fs.writeFileSync(a.target,"edited independently");
  assert.equal(storage.restoreWorkspaceInputs(f.db,f.root,b.workspace),1);
  assert.deepEqual(fs.readFileSync(b.target),bytes);assert.deepEqual(fs.readFileSync(a.object),bytes);
  assert.notEqual(fs.statSync(a.target,{bigint:true}).ino,fs.statSync(b.target,{bigint:true}).ino);
  assert.equal(f.db.prepare("SELECT count(*) n FROM storage_workspace_inputs").get().n,0);
});

test("corrupt archive, disk-full, interrupted publish, and a changed destination keep the recovery reference",t=>{
  const f=fixture(t),bytes=Buffer.alloc(32000,65),a=f.archived("a",bytes);
  fs.writeFileSync(a.object,"corrupt");
  assert.throws(()=>storage.restoreWorkspaceInputs(f.db,f.root,a.workspace),/verification/);
  assert.equal(fs.existsSync(a.target),false);assert.equal(f.db.prepare("SELECT count(*) n FROM storage_workspace_inputs").get().n,1);
  fs.writeFileSync(a.object,bytes);
  const original=fs.writeSync;
  try {fs.writeSync=()=>{throw Object.assign(new Error("disk full"),{code:"ENOSPC"});};assert.throws(()=>storage.restoreWorkspaceInputs(f.db,f.root,a.workspace),/disk full/);}
  finally {fs.writeSync=original;}
  assert.equal(fs.existsSync(a.target),false);assert.equal(f.db.prepare("SELECT count(*) n FROM storage_workspace_inputs").get().n,1);
  fs.writeFileSync(a.target,"new user edit");
  storage.restoreWorkspaceInputs(f.db,f.root,a.workspace);
  assert.equal(fs.readFileSync(a.target,"utf8"),"new user edit");assert.deepEqual(fs.readFileSync(a.object),bytes);
  assert.equal(f.db.prepare("SELECT state FROM storage_workspace_inputs WHERE relative_path=?").get(a.relative).state,"conflict");
});

test("active work, recent reads, unknown owners and recovery operations cannot become cold",t=>{
  const {db}=fixture(t),key="conversations/conv_a/conv_a";
  assert.equal(storage.coldWorkspace(db,key),true);assert.equal(storage.coldWorkspace(db,"conversations/missing/missing"),false);
  db.exec("INSERT INTO hermes_runs VALUES(1,'active','{}')");assert.equal(storage.coldWorkspace(db,key),false);
  db.exec(`UPDATE hermes_runs SET status='completed',dispatch_json='{"taskRecovery":{"pending":true}}'`);assert.equal(storage.coldWorkspace(db,key),false);
  db.exec("DELETE FROM hermes_runs");db.prepare("INSERT INTO storage_conversation_activity VALUES(1,?)").run(Date.now());assert.equal(storage.coldWorkspace(db,key),false);
  db.exec("DELETE FROM storage_conversation_activity");storage.touchWorkspace(db,key);assert.equal(storage.coldWorkspace(db,key),false);
});

test("shared archives survive collection until every reference is restored, including recovery conflicts",async t=>{
  const f=fixture(t),bytes=Buffer.alloc(32000,70),a=f.archived("a",bytes),b=f.archived("b",bytes);
  // A pending journal is also a valid crash-recovery entry; reading status
  // neither inflates verified savings nor materializes files on chat startup.
  f.db.prepare("UPDATE storage_workspace_inputs SET state='pending' WHERE relative_path=?").run(a.relative);
  assert.equal(storage.workspaceStorageStatus(f.db).files,1);assert.equal(fs.existsSync(a.target),false);
  storage.restoreWorkspaceInputs(f.db,f.root,a.workspace);
  await storage.collectWorkspaceStorage(f.db,f.root,()=>false,Date.now()+8*86400000);assert.equal(fs.existsSync(a.object),true);
  fs.writeFileSync(b.target,"new unique work");storage.restoreWorkspaceInputs(f.db,f.root,b.workspace);
  await storage.collectWorkspaceStorage(f.db,f.root,()=>false,Date.now()+8*86400000);assert.equal(fs.existsSync(a.object),true);
  assert.equal(f.db.prepare("SELECT state FROM storage_workspace_inputs WHERE relative_path=?").get(b.relative).state,"conflict");
  assert.deepEqual(fs.readFileSync(a.target),bytes);assert.equal(fs.readFileSync(b.target,"utf8"),"new unique work");
});

test("an orphaned deletion after recovery cannot release the only archive reference",t=>{
  const f=fixture(t),bytes=Buffer.alloc(32000,74),a=f.archived("a",bytes);
  f.db.prepare("UPDATE storage_workspace_inputs SET state='pending' WHERE relative_path=?").run(a.relative);
  // The crashed producer committed its journal but has not yet removed the source.
  fs.writeFileSync(a.target,bytes);storage.restoreWorkspaceInputs(f.db,f.root,a.workspace);
  assert.equal(f.db.prepare("SELECT count(*) n FROM storage_workspace_inputs").get().n,1);
  // Its child finishes late, after the recovery lease expired. The archive
  // still owns the bytes and the next access can restore an independent file.
  fs.unlinkSync(a.target);assert.equal(storage.restoreWorkspaceInputs(f.db,f.root,a.workspace),1);
  assert.deepEqual(fs.readFileSync(a.target),bytes);assert.deepEqual(fs.readFileSync(a.object),bytes);
  assert.equal(f.db.prepare("SELECT count(*) n FROM storage_workspace_inputs").get().n,1);
});

test("restore rejects junction escapes and honors an outstanding crash-recovery lease",t=>{
  const f=fixture(t),a=f.archived("a",Buffer.alloc(32000,66));
  f.db.prepare("INSERT INTO storage_workspace_activity VALUES(?,?,?,?)").run("conversations/conv_a/conv_a",0,"old-process",Date.now()+10000);
  assert.throws(()=>storage.restoreWorkspaceInputs(f.db,f.root,a.workspace),/finishing/);
  f.db.exec("UPDATE storage_workspace_activity SET lease_until=0");
  const folder=path.dirname(a.target),moved=`${folder}-saved`;fs.renameSync(folder,moved);fs.symlinkSync(moved,folder,"junction");
  assert.throws(()=>storage.restoreWorkspaceInputs(f.db,f.root,a.workspace),/redirected/);
  fs.unlinkSync(folder);fs.renameSync(moved,folder);
  assert.equal(storage.restoreWorkspaceInputs(f.db,f.root,a.workspace),1);
});

test("canonical Runtime paths and ordinary workspace paths restore the same private file",{skip:process.platform!=="win32"},t=>{
  const f=fixture(t),bytes=Buffer.alloc(32000,73),a=f.archived("a",bytes),b=f.archived("b",bytes);
  assert.equal(storage.restoreWorkspaceInputs(f.db,path.toNamespacedPath(f.root),a.workspace),1);
  assert.equal(storage.restoreWorkspaceInputs(f.db,f.root,path.toNamespacedPath(b.workspace)),1);
  assert.deepEqual(fs.readFileSync(a.target),bytes);assert.deepEqual(fs.readFileSync(b.target),bytes);
});

test("native removal locks both copies, rejects changed data, shared files and alternate streams",{skip:process.platform!=="win32"},async t=>{
  const f=fixture(t),bytes=Buffer.alloc(64000,67),a=f.file("a",bytes),object=path.join(f.root,"saved.blob");fs.writeFileSync(object,bytes);
  const input={root:f.root,path:a.target,object,hash:sha(bytes),identity:String(fs.statSync(a.target,{bigint:true}).ino),action:"deduplicate"};
  fs.writeFileSync(object,"bad");await assert.rejects(nativeWorkspaceFile(input),/verification/);assert.equal(fs.existsSync(a.target),true);
  fs.writeFileSync(object,bytes);fs.writeFileSync(`${a.target}:important`,"metadata");await assert.rejects(nativeWorkspaceFile(input),/alternate/);assert.equal(fs.existsSync(a.target),true);fs.unlinkSync(`${a.target}:important`);
  const writer=fs.openSync(a.target,"r+");try{await assert.rejects(nativeWorkspaceFile(input),/being used|access|sharing/i);}finally{fs.closeSync(writer);}
  const link=path.join(f.root,"shared.pdf");fs.linkSync(a.target,link);await assert.rejects(nativeWorkspaceFile(input),/Shared/);fs.unlinkSync(link);
  const removed=await nativeWorkspaceFile(input);assert.ok(removed>0);assert.equal(fs.existsSync(a.target),false);assert.deepEqual(fs.readFileSync(object),bytes);
  assert.equal(storage.restoreWorkspaceInputs(f.db,f.root,f.root),0);
});

test("native compression preserves bytes and path and remains writable",{skip:process.platform!=="win32"},async t=>{
  const f=fixture(t),bytes=Buffer.from("compressible simulation output\n".repeat(100000)),a=f.file("a",bytes,"data.csv");
  const identity=String(fs.statSync(a.target,{bigint:true}).ino);
  const original={PATH:process.env.PATH,TEMP:process.env.TEMP,TMP:process.env.TMP,__NEXT_PRIVATE_STANDALONE_CONFIG:process.env.__NEXT_PRIVATE_STANDALONE_CONFIG};let saved;
  try {process.env.PATH="";process.env.TEMP=process.env.TMP=path.toNamespacedPath(f.root);process.env.__NEXT_PRIVATE_STANDALONE_CONFIG="x".repeat(100000);saved=await nativeWorkspaceFile({root:path.toNamespacedPath(f.root),path:a.target,identity,action:"compress"});}
  finally {for(const [key,value] of Object.entries(original))if(value===undefined)delete process.env[key];else process.env[key]=value;}
  assert.ok(saved>bytes.length/2);
  assert.deepEqual(fs.readFileSync(a.target),bytes);assert.equal(String(fs.statSync(a.target,{bigint:true}).ino),identity);
  fs.appendFileSync(a.target,"new output");assert.ok(fs.readFileSync(a.target,"utf8").endsWith("new output"));
});

test("worker deduplicates cold inputs and persists references before removal",{skip:process.platform!=="win32"},async t=>{
  const f=fixture(t),bytes=Buffer.alloc(65536,68),a=f.file("a",bytes),b=f.file("b",bytes);
  for(const entry of [a,b])storage.enqueueWorkspaceCandidate(f.db,entry.relative,fs.statSync(entry.target,{bigint:true}));
  const worker=new storage.WorkspaceStorageWorker();
  for(let i=0;i<70 && fs.existsSync(b.target);i++){await worker.step(f.db,path.toNamespacedPath(f.root),()=>false);await new Promise(resolve=>setTimeout(resolve,25));}
  assert.equal(fs.existsSync(a.target),false);assert.equal(fs.existsSync(b.target),false);
  assert.equal(f.db.prepare("SELECT count(*) n FROM storage_workspace_objects").get().n,1);
  assert.equal(f.db.prepare("SELECT count(*) n FROM storage_workspace_inputs").get().n,2);
  assert.ok(storage.workspaceStorageStatus(f.db).deduplicatedBytes>0);
  assert.equal(storage.restoreWorkspaceInputs(f.db,f.root,a.workspace),1);assert.deepEqual(fs.readFileSync(a.target),bytes);
});
