import {test} from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {resolveBulkRoot, writeBulkLocation, BULK_LOCATION_FILE, validateBulkRoot} from "../src/main/bulk-location";
import {resolvePaths} from "../src/main/path-resolver";

test("bulk preference leaves active data C and is ignored by QA", t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "bb-bulk-"));
  t.after(() => fs.rmSync(base, {recursive:true, force:true}));
  const profile = path.join(base,"profile"), bulk = path.join(base,"bulk"), repo = path.join(base,"repo");
  for (const p of [profile,bulk,path.join(repo,"desktop","dist","main")]) fs.mkdirSync(p,{recursive:true});
  writeBulkLocation(profile,{version:1,bulkRoot:bulk,verifiedAt:new Date().toISOString()},[repo]);
  const input = {isPackaged:false,forceDev:true,userDataDir:profile,electronResourcesPath:undefined,moduleDir:path.join(repo,"desktop","dist","main")};
  const actual = resolvePaths(input);
  assert.equal(actual.bulkRoot,bulk);
  assert.equal(actual.databaseDir,path.join(profile,"Data","database"));
  assert.equal(actual.runtimeDir,path.join(profile,"Data","runtime"));
  assert.equal(resolvePaths({...input,qaMode:true}).bulkRoot,undefined);
  fs.writeFileSync(path.join(profile,BULK_LOCATION_FILE),"invalid");
  assert.equal(resolveBulkRoot(profile,true,[repo]),undefined);
  assert.throws(()=>resolveBulkRoot(profile,false,[repo]));
});

test("bulk preference rejects missing, overlapping and redirected roots", t => {
  const base=fs.mkdtempSync(path.join(os.tmpdir(),"bb-bulk-validation-"));
  t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  const profile=path.join(base,"profile"),bulk=path.join(base,"bulk"),linked=path.join(base,"linked");
  fs.mkdirSync(profile);fs.mkdirSync(bulk);
  assert.throws(()=>validateBulkRoot(profile,[profile]),/separate/u);
  assert.throws(()=>validateBulkRoot(base,[profile]),/separate/u);
  assert.equal(validateBulkRoot(path.join(base,"missing"),[profile]),path.join(base,"missing"),"a disconnected bulk drive must not block C databases");
  assert.throws(()=>validateBulkRoot("relative",[profile]),/absolute/u);
  fs.symlinkSync(bulk,linked,process.platform==="win32"?"junction":"dir");
  assert.throws(()=>validateBulkRoot(linked,[profile]),/junction|direct/u);
  fs.unlinkSync(linked);
});
