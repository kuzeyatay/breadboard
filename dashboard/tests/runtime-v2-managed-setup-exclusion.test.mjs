import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {executeManagedSetup, MANAGED_SETUP_EXCLUSIVE_OPERATIONS, MANAGED_SETUP_OPERATIONS} from "../scripts/runtime-v2-managed-setup-executor.mjs";

const targets = ["deep-tutor", "deer-flow", "legal", "money-printer", "openexecutive", "shorts", "stock-analyst", "tradingagents", "vibe-trading"];
const expanded = {
  "bolt-slides": ["runtime-v2/toolchains/bolt-slides/node_modules"],
  "career-ops": ["runtime-v2/toolchains/career-ops/node_modules", "runtime-v2/toolchains/career-ops-browsers"],
  hyperframes: ["hyperframes-cli/node_modules"],
  openscience: ["openscience-cli/node_modules"],
  openwork: ["openwork-runtime/apps/server/node_modules", "openwork-runtime/node_modules", "openwork-runtime/packages/paths/node_modules"],
  openmontage: ["runtime-v2/services/openmontage/.venv", "runtime-v2/toolchains/openmontage/remotion-composer/node_modules"],
  resource2skill: ["runtime-v2/services/resource2skill/.venv", "runtime-v2/services/resource2skill/browsers"],
  wardrobe: ["runtime-v2/toolchains/wardrobe/node_modules"],
  acestep: ["runtime-v2/services/acestep/.venv", "runtime-v2/services/acestep/source/checkpoints"],
  matraix: ["runtime-v2/services/matraix/.venv"],
};

test("native admission and the setup executor protect the same actions", () => {
  const native = fs.readFileSync(new URL("../../native/runtime-core/src/managed_setup_guard.rs", import.meta.url), "utf8");
  const contracts = new Map([...native.matchAll(/\("([a-z0-9-]+)", &\[([^\]]+)\]\)/gu)].map(match => [
    match[1], [...match[2].matchAll(/"([a-z0-9-]+)"/gu)].map(action => action[1]),
  ]));
  assert.deepEqual([...contracts.keys()].sort(), [...MANAGED_SETUP_EXCLUSIVE_OPERATIONS].sort());
  for (const operation of MANAGED_SETUP_EXCLUSIVE_OPERATIONS) assert.deepEqual(contracts.get(operation), MANAGED_SETUP_OPERATIONS[operation]);
});

test("an older Runtime cannot mutate any protected environment", async t => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-setup-exclusion-"));
  t.after(() => fs.rmSync(dataRoot, {recursive: true, force: true}));
  assert.equal(MANAGED_SETUP_EXCLUSIVE_OPERATIONS.length, 19);
  for (const operation of MANAGED_SETUP_EXCLUSIVE_OPERATIONS) {
    for (const action of MANAGED_SETUP_OPERATIONS[operation]) {
      for (const capability of [undefined, "1"]) {
      await assert.rejects(executeManagedSetup({protocolVersion: 1, operation, action}, {
        dataRoot, appRoot: dataRoot, env: {BREADBOARD_MANAGED_SETUP_EXCLUSION: capability}, signal: new AbortController().signal,
        spawnImpl: () => assert.fail("unprotected setup must not spawn"),
      }), error => error.code === "setup_runtime_update_required" && /Restart Breadboard/u.test(error.message));
      }
    }
  }
});

test("all nine removal recipes preserve config, models and artifacts even without a clone", async t => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-setup-removal-"));
  t.after(() => fs.rmSync(dataRoot, {recursive: true, force: true}));
  for (const operation of targets) {
    const service = path.join(dataRoot, "runtime-v2", "services", operation);
    const venv = path.join(service, ".venv");
    fs.mkdirSync(venv, {recursive: true});
    fs.writeFileSync(path.join(venv, "dependency.txt"), "disposable");
    for (const name of ["config.json", "model.bin", "artifact.mp4"]) fs.writeFileSync(path.join(service, name), "preserve");
    const result = await executeManagedSetup({protocolVersion: 1, operation, action: "remove"}, {
      dataRoot, appRoot: dataRoot, env: {BREADBOARD_MANAGED_SETUP_EXCLUSION: "2"},
      signal: new AbortController().signal,
      spawnImpl: () => assert.fail("removal must not spawn"),
    });
    assert.equal(result.ok, true);
    assert.equal(fs.existsSync(venv), false);
    for (const name of ["config.json", "model.bin", "artifact.mp4"]) assert.equal(fs.readFileSync(path.join(service, name), "utf8"), "preserve");
  }
});

test("expanded removals require the newer native exclusion contract before touching files", async t => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-removal-version-"));
  t.after(() => fs.rmSync(dataRoot, {recursive:true,force:true}));
  for (const operation of Object.keys(expanded)) {
    await assert.rejects(executeManagedSetup({protocolVersion:1,operation,action:"remove"}, {
      dataRoot,appRoot:dataRoot,env:{BREADBOARD_MANAGED_SETUP_EXCLUSION:"2"},
      signal:new AbortController().signal,spawnImpl:()=>assert.fail("must not spawn"),
    }), error=>error.code==="setup_runtime_update_required");
  }
  assert.deepEqual(fs.readdirSync(dataRoot),[]);
});

test("all managed removals delete only dependency leaves on both drives and keep user work", async t => {
  const base=fs.mkdtempSync(path.join(os.tmpdir(),"breadboard-all-removals-"));
  t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  for(const [operation,leaves] of Object.entries({...Object.fromEntries(targets.map(id=>[id,[`runtime-v2/services/${id}/.venv`]])),...expanded})) {
    const dataRoot=path.join(base,operation,"data"),bulkRoot=path.join(base,operation,"bulk");
    const expected=[],preserved=[];
    for(const root of [dataRoot,bulkRoot]) {
      fs.mkdirSync(root,{recursive:true});
      for(const relative of leaves) {
        const target=path.join(root,...relative.split("/"));
        fs.mkdirSync(target,{recursive:true});fs.writeFileSync(path.join(target,"package.bin"),"dependency");
        const keep=path.join(path.dirname(target),"saved-user-work.txt");fs.writeFileSync(keep,"preserve");preserved.push(keep);
        // Career Ops intentionally keeps its state-bearing runtime on C.
        if(root===bulkRoot&&relative==="runtime-v2/toolchains/career-ops/node_modules") preserved.push(path.join(target,"package.bin"));
        else expected.push(target);
      }
      const history=path.join(root,"history.sqlite3");fs.writeFileSync(history,"preserve");preserved.push(history);
    }
    const result=await executeManagedSetup({protocolVersion:1,operation,action:"remove"},{
      dataRoot,appRoot:dataRoot,env:{BREADBOARD_MANAGED_SETUP_EXCLUSION:"3",BREADBOARD_BULK_DATA_DIR:bulkRoot},
      signal:new AbortController().signal,spawnImpl:()=>assert.fail("removal must not spawn"),
    });
    assert.equal(result.ok,true,operation);
    for(const target of expected)assert.equal(fs.existsSync(target),false,`${operation}: ${target}`);
    for(const keep of preserved)assert.equal(fs.existsSync(keep),true,`${operation} must preserve ${keep}`);
  }
});

test("a redirected new removal target prevents deletion of either drive", async t => {
  const base=fs.mkdtempSync(path.join(os.tmpdir(),"breadboard-removal-preflight-"));
  t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  for(const [operation,leaves] of Object.entries(expanded)) {
    if(operation==="career-ops")continue; // Its state-bearing root is always C; covered above.
    const dataRoot=path.join(base,operation,"data"),bulkRoot=path.join(base,operation,"bulk"),outside=path.join(base,operation,"outside");
    const oldTarget=path.join(dataRoot,...leaves[0].split("/")),newTarget=path.join(bulkRoot,...leaves[0].split("/"));
    fs.mkdirSync(oldTarget,{recursive:true});fs.writeFileSync(path.join(oldTarget,"keep"),"old");
    fs.mkdirSync(path.dirname(newTarget),{recursive:true});fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,"keep"),"outside");
    fs.symlinkSync(outside,newTarget,process.platform==="win32"?"junction":"dir");
    await assert.rejects(executeManagedSetup({protocolVersion:1,operation,action:"remove"},{
      dataRoot,appRoot:dataRoot,env:{BREADBOARD_MANAGED_SETUP_EXCLUSION:"3",BREADBOARD_BULK_DATA_DIR:bulkRoot},
      signal:new AbortController().signal,spawnImpl:()=>assert.fail("must not spawn"),
    }),error=>error.code==="setup_path_indirect");
    assert.equal(fs.readFileSync(path.join(oldTarget,"keep"),"utf8"),"old");
    assert.equal(fs.readFileSync(path.join(outside,"keep"),"utf8"),"outside");
  }
});

test("removal refuses a redirected environment and preserves its target", async t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-setup-removal-link-"));
  t.after(() => fs.rmSync(base, {recursive: true, force: true}));
  const dataRoot = path.join(base, "data"), outside = path.join(base, "unrelated");
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "keep.txt"), "preserved");
  for (const operation of targets) {
    const service = path.join(dataRoot, "runtime-v2", "services", operation);
    fs.mkdirSync(service, {recursive: true});
    fs.symlinkSync(outside, path.join(service, ".venv"), process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(executeManagedSetup({protocolVersion: 1, operation, action: "remove"}, {
      dataRoot, appRoot: dataRoot, env: {BREADBOARD_MANAGED_SETUP_EXCLUSION: "2"}, signal: new AbortController().signal,
      spawnImpl: () => assert.fail("removal must not spawn"),
    }), error => error.code === "setup_path_indirect");
    assert.equal(fs.readFileSync(path.join(outside, "keep.txt"), "utf8"), "preserved");
  }
});
