import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {DatabaseSync} from "node:sqlite";
import {configureBulkLocation} from "./configure-bulk-location.mjs";

function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "bb-hybrid-activation-"));
  t.after(() => fs.rmSync(base,{recursive:true,force:true}));
  const userDataDir=path.join(base,"profile"), bulkRoot=path.join(base,"bulk"), appRoot=path.join(base,"app"), data=path.join(userDataDir,"Data");
  for(const root of [path.join(data,"runtime-v2"),bulkRoot,appRoot]) fs.mkdirSync(root,{recursive:true});
  const database = new DatabaseSync(path.join(data,"runtime-v2/runtime-v2.sqlite3"));
  database.exec("CREATE TABLE runtime_jobs (job_id TEXT, state TEXT, user_id INTEGER, owner_principal TEXT)");database.close();
  return {userDataDir,bulkRoot,appRoot,data};
}

test("offline hybrid activation writes only the separate preference and releases its lock", t => {
  const f=fixture(t), result=configureBulkLocation(f);
  assert.equal(result.dataRoot,f.data);assert.equal(result.bulkRoot,f.bulkRoot);
  const saved=JSON.parse(fs.readFileSync(path.join(f.userDataDir,"breadboard-bulk-storage.json"),"utf8"));
  assert.equal(saved.bulkRoot,f.bulkRoot);
  assert.equal(fs.existsSync(path.join(f.userDataDir,"breadboard-storage.json")),false);
  assert.equal(fs.existsSync(path.join(f.userDataDir,"breadboard-data-migration.lock")),false);
  assert.ok(fs.existsSync(path.join(f.data,"runtime-v2/runtime-v2.sqlite3")));
});

test("active user work and a live Runtime owner refuse preference activation", t => {
  const f=fixture(t), filename=path.join(f.data,"runtime-v2/runtime-v2.sqlite3");
  const database=new DatabaseSync(filename);database.exec("INSERT INTO runtime_jobs VALUES ('active','running',1,'user:1')");database.close();
  assert.throws(()=>configureBulkLocation(f),/unfinished/u);
  const next=new DatabaseSync(filename);next.exec("DELETE FROM runtime_jobs");next.close();
  fs.mkdirSync(path.join(f.data,"runtime"));fs.writeFileSync(path.join(f.data,"runtime/endpoints.json"),JSON.stringify({pid:process.pid}));
  assert.throws(()=>configureBulkLocation(f),/still running/u);
  assert.equal(fs.existsSync(path.join(f.userDataDir,"breadboard-bulk-storage.json")),false);
});

test("activation refuses an existing different bulk root and preserves the preference", t => {
  const f=fixture(t);configureBulkLocation(f);
  const before=fs.readFileSync(path.join(f.userDataDir,"breadboard-bulk-storage.json"),"utf8");
  const alternate=path.join(path.dirname(f.bulkRoot),"alternate");fs.mkdirSync(alternate);
  assert.throws(()=>configureBulkLocation({...f,bulkRoot:alternate}),/different bulk root/u);
  assert.equal(fs.readFileSync(path.join(f.userDataDir,"breadboard-bulk-storage.json"),"utf8"),before);
  assert.equal(fs.existsSync(path.join(f.userDataDir,"breadboard-data-migration.lock")),false);
});
