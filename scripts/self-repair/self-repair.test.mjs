import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  initializeSourceRepair, enqueueSourceRepair, readSourceRepair, updateSourceRepair,
  cancelSourceRepair, assertAutomaticRepairPatch, verifySourceRepairRelease,
  readRepairJournal, writeRepairJournal, recoverInterruptedRepairActivation,
} from "../../desktop/src/shared/source-repair.ts";
import { executeSourceRepair, copyRepairDashboardDependencies } from "./engine.mjs";

const fixtures = path.resolve(".tmp/source-repair-tests");
fs.mkdirSync(fixtures, { recursive: true });
function fixture() {
  const directory = fs.mkdtempSync(path.join(fixtures, "case-"));
  const root = path.join(directory, "repo"), data = path.join(directory, "data");
  fs.mkdirSync(path.join(root, "dashboard/src/lib"), { recursive: true });
  fs.mkdirSync(path.join(root, "dashboard/tests"), { recursive: true });
  fs.writeFileSync(path.join(root, ".gitignore"), ".qa-worktrees/\n.qa-results/\ndashboard/.next-desktop/\n");
  fs.writeFileSync(path.join(root, "dashboard/src/lib/value.ts"), "export function value(input: number) { return input || 10; }\n");
  fs.writeFileSync(path.join(root, "dashboard/tests/value.test.mjs"), "import test from 'node:test'; import assert from 'node:assert/strict'; import { value } from '../src/lib/value.ts'; test('positive value', () => assert.equal(value(4), 4));\n");
  const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "pipe", windowsHide: true });
  git("init", "-q"); git("add", "."); git("-c", "user.name=Fixture", "-c", "user.email=fixture@localhost", "commit", "-qm", "fixture");
  initializeSourceRepair(data, root, true);
  const request = enqueueSourceRepair(data, { userId: 1, conversationId: 1, sourceRunId: "run1", rootClientMessageId: "message1",
    request: "Keep zero in the output", failure: { code: "invalid_value", message: "zero became 10", fingerprint: "zero" }, model: "fixture" });
  const proposal = { classification: "PRODUCT_BUG", rootCause: "Logical OR treats valid zero as absent.",
    edits: [{ path: "dashboard/src/lib/value.ts", before: "return input || 10;", after: "return input ?? 10;" }],
    regression: "import test from 'node:test'; import assert from 'node:assert/strict'; import { value } from '@/lib/value.ts'; test('preserves zero', () => assert.equal(value(0), 0));\n" };
  return { directory, root, data, request, proposal };
}
async function execute(f, overrides = {}) {
  return executeSourceRepair({ dataRoot: f.data, repairId: f.request.id,
    dependencies: { baselineReady: () => ({ current: true }), propose: async () => f.proposal, review: async () => ({ approved: true, reason: "Preserves zero without changing positive inputs." }),
      build: async root => { const out = path.join(root, "dashboard/.next-desktop/standalone"); fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, "server.js"), "console.log('fixture server');\n"); }, ...overrides } });
}

test("reproduces, repairs an isolated copy, preserves oracle, seals build and leaves working source unchanged", async () => {
  const f = fixture();
  const result = await execute(f);
  const state = readSourceRepair(f.data, f.request.id);
  assert.equal(result.ready, true, state.reason);
  assert.equal(state.stage, "ready");
  assert.equal(state.checks.baselineReproductions, 2);
  assert.equal(state.checks.defectReintroductionFailed, true);
  assert.equal(fs.readFileSync(path.join(f.root, "dashboard/src/lib/value.ts"), "utf8").includes("input || 10"), true);
  verifySourceRepairRelease(f.data, f.root, state.release);
  fs.appendFileSync(path.join(state.release.root, "dashboard/src/lib/value.ts"), "\n// unexpected edit\n");
  assert.throws(() => verifySourceRepairRelease(f.data, f.root, state.release), /hash|changed|integrity/i);
});

test("rejects a false diagnosis whose regression already passes", async () => {
  const f = fixture(); f.proposal.regression = f.proposal.regression.replace("value(0), 0", "value(4), 4");
  await execute(f);
  assert.equal(readSourceRepair(f.data, f.request.id).stage, "blocked");
  assert.match(readSourceRepair(f.data, f.request.id).reason, /did not reproduce/);
});

test("unchanged repository suites can use native helpers while proposed regressions remain restricted", async () => {
  const f = fixture();
  fs.appendFileSync(path.join(f.root, "dashboard/tests/value.test.mjs"), `
import { execFileSync } from 'node:child_process';
test('trusted helper uses the disposable environment', () => assert.equal(execFileSync(process.execPath,
  ['-e', 'process.stdout.write(process.env.NODE_ENV)'], {encoding:'utf8', windowsHide:true}), 'test'));
`);
  await execute(f);
  assert.equal(readSourceRepair(f.data, f.request.id).stage, "ready");
  const rejected = fixture();
  rejected.proposal.regression += "\nimport { execFileSync } from 'node:child_process';\n";
  await execute(rejected);
  assert.equal(readSourceRepair(rejected.data, rejected.request.id).stage, "blocked");
  assert.match(readSourceRepair(rejected.data, rejected.request.id).reason, /outside application behavior|without process/);
});

test("independent review rejects a candidate before mutation", async () => {
  const f = fixture(); await execute(f, { review: async () => ({ approved: false, reason: "Wrong requirement" }) });
  assert.match(readSourceRepair(f.data, f.request.id).reason, /review rejected/);
});

test("source changes during verification prevent activation", async () => {
  const f = fixture(); await execute(f, { build: async () => fs.appendFileSync(path.join(f.root, "dashboard/src/lib/value.ts"), "\n// developer edit\n") });
  assert.match(readSourceRepair(f.data, f.request.id).reason, /source changed while/);
});

test("Stop is durable and a late worker cannot overwrite it", () => {
  const f = fixture(); cancelSourceRepair(f.data, f.request.id);
  updateSourceRepair(f.data, f.request.id, { stage: "ready" });
  assert.equal(readSourceRepair(f.data, f.request.id).stage, "cancelled");
});

test("automatic scope excludes controller, auth, validators, dependencies and traversal", () => {
  for (const file of ["desktop/src/main/app.ts", "dashboard/src/lib/auth.ts", "dashboard/src/lib/source-repair/service.ts", "dashboard/src/lib/artifact-validator.ts", "dashboard/src/lib/../db.ts", "package.json"]) {
    assert.throws(() => assertAutomaticRepairPatch([{ path: file, before: "old", after: "new" }]));
  }
});

test("startup rolls back an interrupted activation before selecting any candidate", () => {
  const f = fixture(); writeRepairJournal(f.data, { version: 1, phase: "activating", active: { id: "bad" }, previous: null, repairId: f.request.id, updatedAt: Date.now() });
  recoverInterruptedRepairActivation(f.data);
  assert.equal(readRepairJournal(f.data).active, null);
  assert.equal(readRepairJournal(f.data).phase, "stable");
  assert.equal(readSourceRepair(f.data, f.request.id).stage, "rolled_back");
});

test("isolated build dependencies are physical copies and preserve reviewed package links", async () => {
  const directory=fs.mkdtempSync(path.join(fixtures,"dependencies-"));
  const base=path.join(directory,"base"),candidate=path.join(directory,"candidate");
  const pkg=path.join(base,"dashboard/node_modules/fixture");
  const vendor=path.join(base,"vendor");
  fs.mkdirSync(pkg,{recursive:true});fs.mkdirSync(vendor);fs.mkdirSync(candidate);
  fs.writeFileSync(path.join(pkg,"index.js"),"export const value=1;\n");
  fs.writeFileSync(path.join(vendor,"package.json"),'{}');
  fs.symlinkSync(vendor,path.join(base,"dashboard/node_modules/vendor"),process.platform==='win32'?'junction':'dir');
  await copyRepairDashboardDependencies(base,candidate);
  const modules=path.join(candidate,"dashboard/node_modules");
  assert.equal(fs.lstatSync(modules).isSymbolicLink(),false);
  fs.writeFileSync(path.join(modules,"fixture/index.js"),"different candidate bytes");
  assert.equal(fs.readFileSync(path.join(pkg,"index.js"),'utf8'),"export const value=1;\n");
  assert.equal(fs.realpathSync(path.join(modules,"vendor")),fs.realpathSync(vendor));
  const cancelled=new AbortController();cancelled.abort();
  await assert.rejects(copyRepairDashboardDependencies(base,path.join(directory,"cancelled"),{signal:cancelled.signal}),/abort/i);
  assert.equal(fs.existsSync(path.join(directory,"cancelled/dashboard/node_modules")),false);
});

test('linked installed source dependencies survive candidate isolation', async () => {
  const f=fixture();
  const vendor=path.join(f.directory,'installed-vendor');fs.mkdirSync(vendor);
  fs.writeFileSync(path.join(vendor,'package.json'),'{}');
  fs.writeFileSync(path.join(vendor,'index.js'),'installed bytes');
  fs.symlinkSync(vendor,path.join(f.root,'external-library'),process.platform==='win32'?'junction':'dir');
  await execute(f,{build:async root=>{
    assert.equal(fs.readFileSync(path.join(root,'external-library/index.js'),'utf8'),'installed bytes');
    const out=path.join(root,'dashboard/.next-desktop/standalone');fs.mkdirSync(out,{recursive:true});
    fs.writeFileSync(path.join(out,'server.js'),'fixture server');
  }});
  assert.equal(readSourceRepair(f.data,f.request.id).stage,'ready',readSourceRepair(f.data,f.request.id).reason);
  assert.equal(fs.readFileSync(path.join(vendor,'index.js'),'utf8'),'installed bytes');
  verifySourceRepairRelease(f.data,f.root,readSourceRepair(f.data,f.request.id).release);
});


test('candidate preserves and seals current shared manifests and packaged skills', async () => {
  const f=fixture();
  const inputs={'shared/visualization-renderers.json':'{"fixture":true}','hermes-skills/prebuilt/fixture/SKILL.md':'Reviewed application instructions'};
  for(const [relative,contents]of Object.entries(inputs)){fs.mkdirSync(path.dirname(path.join(f.root,relative)),{recursive:true});fs.writeFileSync(path.join(f.root,relative),contents);}
  await execute(f,{build:async root=>{
    for(const [relative,contents]of Object.entries(inputs))assert.equal(fs.readFileSync(path.join(root,relative),'utf8'),contents);
    const out=path.join(root,'dashboard/.next-desktop/standalone');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'server.js'),'fixture server');
  }});
  const request=readSourceRepair(f.data,f.request.id);
  assert.equal(request.stage,'ready',request.reason);
  for(const relative of Object.keys(inputs))assert.ok(request.release.files.some(file=>file.path===relative));
  verifySourceRepairRelease(f.data,f.root,request.release);
});


test('tracked vendor sources retain their reviewed installed build inputs', async () => {
  const f=fixture(),vendor=path.join(f.root,'external-library');fs.mkdirSync(vendor);
  fs.writeFileSync(path.join(vendor,'package.json'),'{}');fs.writeFileSync(path.join(vendor,'index.js'),'reviewed source');
  fs.appendFileSync(path.join(f.root,'.gitignore'),'external-library/dist/\n');
  execFileSync('git',['add','external-library','.gitignore'],{cwd:f.root,windowsHide:true});
  execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@localhost','commit','-qm','tracked vendor source'],{cwd:f.root,windowsHide:true});
  fs.mkdirSync(path.join(vendor,'dist'));fs.writeFileSync(path.join(vendor,'dist/installed.js'),'reviewed installed bytes');
  await execute(f,{build:async root=>{
    assert.equal(fs.readFileSync(path.join(root,'external-library/dist/installed.js'),'utf8'),'reviewed installed bytes');
    const out=path.join(root,'dashboard/.next-desktop/standalone');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'server.js'),'fixture server');
  }});
  const request=readSourceRepair(f.data,f.request.id);assert.equal(request.stage,'ready',request.reason);
  verifySourceRepairRelease(f.data,f.root,request.release);
  assert.equal(fs.readFileSync(path.join(vendor,'index.js'),'utf8'),'reviewed source');
  assert.equal(fs.readFileSync(path.join(vendor,'dist/installed.js'),'utf8'),'reviewed installed bytes');
});

test('repair build waits for transient memory pressure without spending another candidate', async () => {
  const {runAdmittedRepairBuild}=await import('./engine.mjs');
  let clock=0,samples=0,builds=0;const waits=[],messages=[];
  await runAdmittedRepairBuild({root:process.cwd(),env:{},guard:()=>{},deadline:120000,now:()=>clock,
    sample:()=>{if(++samples<=2)throw Object.assign(new Error('temporary memory pressure'),{code:'BREADBOARD_RESOURCE_EXHAUSTED'});},
    sleep:async ms=>{waits.push(ms);clock+=ms;},onWaiting:message=>messages.push(message),
    runCommand:async(_command,_args,options)=>{builds++;assert.equal(options.timeoutMs,30000);assert.equal(options.env.BREADBOARD_SOURCE_REPAIR_BUILD,'1');return {code:0,output:''};}});
  assert.equal(builds,1);assert.equal(samples,3);assert.deepEqual(waits,[45000,45000]);assert.equal(messages.length,2);
});

test('repair build retries a typed child admission race but not a compiler failure', async () => {
  const {runAdmittedRepairBuild}=await import('./engine.mjs');
  let builds=0,waits=0;
  const options={root:process.cwd(),env:{},guard:()=>{},deadline:Date.now()+120000,sample:()=>{},sleep:async()=>{waits++;}};
  await runAdmittedRepairBuild({...options,runCommand:async()=>++builds===1?{code:1,output:"Error: insufficient commit\n code: 'BREADBOARD_RESOURCE_EXHAUSTED'"}:{code:0,output:''}});
  assert.equal(builds,2);assert.equal(waits,1);
  await assert.rejects(runAdmittedRepairBuild({...options,runCommand:async()=>{builds++;return {code:1,output:'TypeScript compilation failed'};}}),/TypeScript compilation failed/);
  assert.equal(builds,3);assert.equal(waits,1);
});

test('repair build cancellation interrupts the real pending timer', async () => {
  const {runAdmittedRepairBuild}=await import('./engine.mjs');
  const controller=new AbortController();let builds=0;
  const pending=runAdmittedRepairBuild({root:process.cwd(),env:{},signal:controller.signal,guard:()=>{},deadline:Date.now()+120000,
    sample:()=>{throw Object.assign(new Error('temporary pressure'),{code:'BREADBOARD_RESOURCE_EXHAUSTED'});},
    onWaiting:()=>setImmediate(()=>controller.abort()),runCommand:async()=>{builds++;return {code:0,output:''};}});
  await assert.rejects(pending,{name:'AbortError'});assert.equal(builds,0);
});

test('repair build keeps the original deadline while waiting for resources', async () => {
  const {runAdmittedRepairBuild}=await import('./engine.mjs');
  let clock=100,builds=0,samples=0;
  await assert.rejects(runAdmittedRepairBuild({root:process.cwd(),env:{},guard:()=>{},deadline:105,now:()=>clock,
    sample:()=>{samples++;throw Object.assign(new Error('pressure'),{code:'BREADBOARD_RESOURCE_EXHAUSTED'});},
    sleep:async ms=>{assert.equal(ms,5);clock+=ms;},runCommand:async()=>{builds++;return {code:0,output:''};}}),/deadline exhausted/);
  assert.equal(samples,1);assert.equal(builds,0);
});

test('repair build fails closed when resource measurement or durable cancellation fails', async () => {
  const {runAdmittedRepairBuild}=await import('./engine.mjs');
  let builds=0,samples=0;
  const options={root:process.cwd(),env:{},guard:()=>{},deadline:Date.now()+120000,
    sample:()=>{samples++;throw Error('resource measurement unavailable');},runCommand:async()=>{builds++;return {code:0,output:''};}};
  await assert.rejects(runAdmittedRepairBuild(options),/measurement unavailable/);
  await assert.rejects(runAdmittedRepairBuild({...options,guard:()=>{throw Error('Source repair cancelled');}}),/cancelled/);
  assert.equal(samples,1);assert.equal(builds,0);
});
