import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "../../desktop/node_modules/typescript/lib/typescript.js";
import { initializeSourceRepair, enqueueSourceRepair, updateSourceRepair, readSourceRepair,
  readRepairJournal, signSourceRepairRelease, repairFileHash, cancelSourceRepair } from "../../desktop/src/shared/source-repair.ts";

const modulePath = path.resolve(process.env.BREADBOARD_TEST_REPAIR_STAGE === "1" ? ".tmp/self-repair-staging/desktop/src/shared/source-repair-activation.ts" : "desktop/src/shared/source-repair-activation.ts");
const source = fs.readFileSync(modulePath, "utf8").replace('"./source-repair"', JSON.stringify(pathToFileURL(path.resolve("desktop/src/shared/source-repair.ts")).href));
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { SourceRepairActivator } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);

function setup(overrides = {}) {
  const directory = fs.mkdtempSync(path.resolve(".tmp/source-repair-tests/activation-"));
  const base = path.join(directory, "repo"), data = path.join(directory, "data");
  fs.mkdirSync(base);
  initializeSourceRepair(data, base, true);
  const request = enqueueSourceRepair(data, { userId: 1, conversationId: 1, sourceRunId: "r1", rootClientMessageId: "m1", request: "test task", model: "test",
    failure: { code: "test", message: "defect", fingerprint: "x" } });
  const root = path.join(base, ".qa-worktrees", request.id);
  fs.writeFileSync(path.join(base, "source.ts"), "export const baseline = 1;\n");
  const server = "dashboard/.next-desktop/standalone/server.js";
  fs.mkdirSync(path.dirname(path.join(root, server)), { recursive: true }); fs.writeFileSync(path.join(root, server), "// verified fixture\n");
  const release = signSourceRepairRelease(data, { id: request.id, root, baseRoot: base, sourceFingerprint: "fixture", changedSources: [],
    baseFiles: [{ path: "source.ts", sha256: repairFileHash(path.join(base, "source.ts")) }],
    createdAt: Date.now(), files: [{ path: server, sha256: repairFileHash(path.join(root, server)) }] });
  updateSourceRepair(data, request.id, { stage: "ready", parentReleaseId: null, release });
  const events = [];
  let clock = Date.now();
  const host = { quiesce: async () => ({ workers: 0, leases: 0 }), resumeAdmission: async () => { events.push("resume"); },
    restart: async () => { events.push(readRepairJournal(data).active?.id ?? "baseline"); return true; },
    healthy: async () => true, log: () => {}, ...overrides };
  return { base, data, request, release, host, events, activator: new SourceRepairActivator(data, base, host, { now: () => clock, sleep: async ms => { clock += ms; } }) };
}

test("activates only at quiet boundary and commits only after resumed task succeeds", async () => {
  const f = setup(); await f.activator.tick();
  assert.equal(readRepairJournal(f.data).phase, "probation");
  assert.equal(readSourceRepair(f.data, f.request.id).stage, "probation");
  await f.activator.tick(); assert.equal(readRepairJournal(f.data).phase, "probation");
  updateSourceRepair(f.data, f.request.id, { stage: "committed" }); await f.activator.tick();
  assert.equal(readRepairJournal(f.data).phase, "stable");
  assert.equal(readRepairJournal(f.data).active.id, f.request.id);
});

test("busy work defers activation without restart", async () => {
  const f = setup({ quiesce: async () => ({ workers: 1, leases: 0 }) }); await f.activator.tick();
  assert.deepEqual(f.events, ["resume"]); assert.equal(readRepairJournal(f.data).active, null);
});

test("failed candidate health rolls back to baseline", async () => {
  const f = setup({ healthy: async id => id === null }); await f.activator.tick();
  assert.deepEqual(f.events, [f.request.id, "baseline"]);
  assert.equal(readRepairJournal(f.data).active, null);
  assert.equal(readSourceRepair(f.data, f.request.id).stage, "rolled_back");
});

test("failed task replay rolls back a healthy candidate", async () => {
  const f = setup(); await f.activator.tick();
  updateSourceRepair(f.data, f.request.id, { stage: "rollback_requested" }); await f.activator.tick();
  assert.equal(readRepairJournal(f.data).active, null);
  assert.equal(readSourceRepair(f.data, f.request.id).stage, "rolled_back");
});

test("Stop during probation restores last verified release", async () => {
  const f = setup(); await f.activator.tick(); cancelSourceRepair(f.data, f.request.id); await f.activator.tick();
  assert.equal(readRepairJournal(f.data).active, null);
  assert.equal(readSourceRepair(f.data, f.request.id).stage, "cancelled");
});

test("failed quiesce never stops a running runtime", async () => {
  const f = setup({ quiesce: async () => { throw new Error("unavailable"); } }); await f.activator.tick();
  assert.deepEqual(f.events, ["resume"]); assert.equal(readSourceRepair(f.data, f.request.id).stage, "ready");
});

test("baseline source changes after verification prevent activation", async () => {
  const f = setup(); fs.appendFileSync(path.join(f.base, "source.ts"), "\n// newer developer change\n");
  await f.activator.tick(); assert.equal(readSourceRepair(f.data, f.request.id).stage, "blocked");
  assert.deepEqual(f.events, []);
});

test('a healthy candidate may still be warming after native restart', async () => {
  let samples=0;
  const f=setup({healthy:async id=>id===null||++samples>=3});
  await f.activator.tick();
  assert.equal(readRepairJournal(f.data).phase,'probation');
  assert.deepEqual(f.events,[f.request.id]);assert.equal(samples,5);
});

test('rollback waits for the previous dashboard instead of restarting it again', async () => {
  let baselineSamples=0;
  const f=setup({healthy:async id=>id!==null||++baselineSamples>=3});
  await f.activator.tick();updateSourceRepair(f.data,f.request.id,{stage:'rollback_requested'});
  await f.activator.tick();
  assert.equal(readSourceRepair(f.data,f.request.id).stage,'rolled_back');
  assert.deepEqual(f.events,[f.request.id,'baseline']);assert.equal(baselineSamples,5);
});

test('Stop during startup readiness rolls back without waiting out the startup deadline', async () => {
  let candidateSamples=0;
  const f=setup({healthy:async id=>{if(id===null)return true;candidateSamples++;cancelSourceRepair(f.data,f.request.id);return false;}});
  await f.activator.tick();
  assert.equal(candidateSamples,1);assert.equal(readSourceRepair(f.data,f.request.id).stage,'cancelled');
  assert.equal(readRepairJournal(f.data).active,null);assert.deepEqual(f.events,[f.request.id,'baseline']);
});

test('startup readiness remains bounded by the original repair deadline', async () => {
  let candidateSamples=0;
  const f=setup({healthy:async id=>{if(id===null)return true;candidateSamples++;return false;}});
  updateSourceRepair(f.data,f.request.id,{deadline:Date.now()+1500});
  await f.activator.tick();
  assert.equal(candidateSamples,2);assert.equal(readSourceRepair(f.data,f.request.id).stage,'rolled_back');
  assert.deepEqual(f.events,[f.request.id,'baseline']);
});
