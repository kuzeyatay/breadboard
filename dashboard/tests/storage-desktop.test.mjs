import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";

async function load(relative, overrides={}) {
  const result=await build({entryPoints:[path.resolve(import.meta.dirname,"../../desktop/src",relative)],bundle:true,platform:"node",format:"cjs",packages:"external",write:false});
  const module={exports:{}},base=createRequire(import.meta.url);
  new Function("require","module","exports",result.outputFiles[0].text)(name=>name in overrides?overrides[name]:base(name),module,module.exports);
  return module.exports;
}
const {LogManager}=await load("main/log-manager.ts");
const queue=await load("shared/storage-compaction.ts");
const compaction=await load("main/storage-compaction.ts");
const coordinator=await load("main/storage-maintenance.ts",{electron:{powerMonitor:{getSystemIdleTime:()=>0}}});
const downloads=await load("shared/released-downloads.ts");

test("only explicitly completed installation downloads expire",()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"bb-storage-downloads-"));
  try {
    const complete=path.join(root,".download-11111111-1111-1111-1111-111111111111"),unproven=path.join(root,".download-22222222-2222-2222-2222-222222222222");
    for(const dir of [complete,unproven]){fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,"vscode.zip"),Buffer.alloc(8192,1));}
    downloads.releaseInstallationDownload(complete,"vscode.zip");
    assert.equal(downloads.cleanReleasedInstallationDownloads(root,()=>false),0);
    assert.ok(downloads.cleanReleasedInstallationDownloads(root,()=>false,Date.now()+8*86400000)>0);
    assert.ok(fs.existsSync(path.join(unproven,"vscode.zip")));
  } finally {assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});}
});

test("installation log cap retains a usable active writer and skips shared files",()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"bb-storage-logs-"));
  const logs=new LogManager({logsDir:root});
  try {
    const writer=logs.forService("dashboard");writer.write("a".repeat(4096));
    fs.writeFileSync(path.join(root,"old.log"),"expired diagnostic");fs.utimesSync(path.join(root,"old.log"),new Date(0),new Date(0));
    fs.writeFileSync(path.join(root,"shared.log"),"retained shared bytes");fs.linkSync(path.join(root,"shared.log"),path.join(root,"work.txt"));
    assert.ok(logs.prune(Date.now(),1024)>0);
    assert.equal(fs.existsSync(path.join(root,"old.log")),false);
    writer.write("still writable");assert.match(fs.readFileSync(writer.filePath,"utf8"),/still writable/u);
    assert.equal(fs.readFileSync(path.join(root,"work.txt"),"utf8"),"retained shared bytes");
  } finally {logs.closeAll();assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});}
});

test("compaction requests are durable and low space or live leases never stop services",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"bb-storage-compact-"));
  try {
    const request=queue.requestStorageCompaction(root);assert.deepEqual(queue.requestStorageCompaction(root),request);
    let stopped=0,resumed=0;
    await compaction.runRequestedStorageCompaction({dataRoot:root,appRoot:root,runtimeRoot:root,binDir:root,
      idle:()=>true,quiesce:async()=>({workers:1,leases:1}),resume:async()=>{resumed++;},stop:async()=>{stopped++;return true;},restart:async()=>{throw new Error("must not restart");}});
    assert.equal(stopped,0);assert.ok(resumed<=1);assert.equal(queue.readStorageCompaction(root).phase,"deferred");
    assert.ok(queue.readStorageCompaction(root).retryAfter>Date.now());
  } finally {assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});}
});

test("one idle coordinator neither starts on launch nor overlaps requests, and aborts on input",async(t)=>{
  t.mock.timers.enable({apis:["setInterval","Date"]});
  let idle=119,calls=0,signal,finish;
  const stop=coordinator.startStorageMaintenance({dashboardUrl:()=>"http://127.0.0.1:4444",idleSeconds:()=>idle,
    session:{cookies:{get:async()=>[]}},fetch:async(_url,init)=>{calls++;signal=init.signal;return new Promise(resolve=>{finish=()=>resolve(new Response('{"housekeepingAllowed":false}',{headers:{"content-type":"application/json"}}));});}});
  try {
    assert.equal(calls,0);t.mock.timers.tick(15000);await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,0);
    idle=120;t.mock.timers.tick(15000);await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);
    t.mock.timers.tick(15000);await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);
    idle=0;t.mock.timers.tick(250);assert.equal(signal.aborted,true);
    finish();await new Promise(resolve=>setImmediate(resolve));
  } finally {stop();t.mock.timers.reset();}
});

test("a locked app's idle tick carries the per-launch key, which the dashboard accepts only while it is current",async(t)=>{
  const dataRoot=fs.mkdtempSync(path.join(os.tmpdir(),"bb-maintenance-key-")),configDir=path.join(dataRoot,"config");
  const keys=await (async()=>{
    const result=await build({entryPoints:[path.resolve(import.meta.dirname,"../src/lib/storage/maintenance-key.ts")],bundle:true,platform:"node",format:"cjs",packages:"external",write:false});
    const module={exports:{}};new Function("require","module","exports",result.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);return module.exports;
  })();
  t.mock.timers.enable({apis:["setInterval","Date"]});
  try {
    const key=coordinator.issueMaintenanceKey(configDir);
    assert.match(key,/^[a-f0-9]{64}$/u);
    assert.equal(coordinator.MAINTENANCE_KEY_HEADER,keys.MAINTENANCE_KEY_HEADER);
    assert.equal(path.join(configDir,coordinator.MAINTENANCE_KEY_FILE),keys.maintenanceKeyPath(dataRoot));
    let presented;
    const stop=coordinator.startStorageMaintenance({dashboardUrl:()=>"http://127.0.0.1:4444",idleSeconds:()=>600,maintenanceKey:()=>key,
      session:{cookies:{get:async()=>[]}},fetch:async(_url,init)=>{presented=new Request("http://127.0.0.1:4444/api/storage/maintenance",{method:"POST",headers:init.headers});return new Response('{"housekeepingAllowed":true}',{headers:{"content-type":"application/json"}});}});
    try {t.mock.timers.tick(15000);await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));} finally {stop();}
    assert.ok(presented,"the idle tick was sent");
    assert.equal(keys.desktopMaintenanceAuthorized(presented,dataRoot),true);
    const asking=value=>new Request("http://127.0.0.1:4444/",{headers:value===undefined?{}:{[keys.MAINTENANCE_KEY_HEADER]:value}});
    assert.equal(keys.desktopMaintenanceAuthorized(asking(undefined),dataRoot),false);
    assert.equal(keys.desktopMaintenanceAuthorized(asking("f".repeat(64)),dataRoot),false);
    assert.equal(keys.desktopMaintenanceAuthorized(asking(key.toUpperCase()),dataRoot),false);
    assert.equal(keys.desktopMaintenanceAuthorized(asking(key+"0"),dataRoot),false);
    // The next launch's key replaces it; the old one stops working at once.
    const next=coordinator.issueMaintenanceKey(configDir);
    assert.notEqual(next,key);
    assert.equal(keys.desktopMaintenanceAuthorized(asking(key),dataRoot),false);
    assert.equal(keys.desktopMaintenanceAuthorized(asking(next),dataRoot),true);
    assert.deepEqual(fs.readdirSync(configDir),[coordinator.MAINTENANCE_KEY_FILE],"no partial key file is left behind");
    // No key file, no access.
    fs.rmSync(path.join(configDir,coordinator.MAINTENANCE_KEY_FILE));
    assert.equal(keys.desktopMaintenanceAuthorized(asking(next),dataRoot),false);
  } finally {t.mock.timers.reset();assert.ok(path.resolve(dataRoot).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(dataRoot,{recursive:true,force:true});}
});

test("the desktop maintenance key unlocks only the idle tick of the storage route",()=>{
  const source=fs.readFileSync(path.resolve(import.meta.dirname,"../src/app/api/storage/maintenance/route.ts"),"utf8");
  assert.match(source,/const desktop = desktopMaintenanceAuthorized\(request\);\s*if \(!desktop\) assertStorageOwner\(db, await requireUserId\(\)\);/u);
  assert.match(source,/if \(desktop && body\.action !== "tick"\)[\s\S]*?status: 403/u);
});
