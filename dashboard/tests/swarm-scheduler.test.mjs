import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { SwarmStore } from "../src/lib/swarm/store.ts";
import { SwarmScheduler, SwarmStartRejected } from "../src/lib/swarm/scheduler.ts";
import { DEFAULT_SWARM_LIMITS } from "../src/lib/swarm/policy.ts";
import { runtimeSwarmObservation } from "../src/lib/swarm/runtime-observation.ts";
import { withSwarmInvocation, currentSwarmInvocation, swarmRuntimeIdentity } from "../src/lib/swarm/invocation.ts";
import { restrictSwarmWorkerDecision, workerToolAllowed } from "../src/lib/swarm/worker-policy.ts";

function setup(overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-scheduler-"));
  const database = new Database(path.join(directory, "state.db"));
  database.exec("CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES(1); CREATE TABLE conversations(id INTEGER PRIMARY KEY,user_id INTEGER); INSERT INTO conversations VALUES(1,1);");
  const store = new SwarmStore(database);
  const tasks = ["sources", "compare"].map(key => ({ key, title: key, brief: `Produce ${key}.`, executor: { kind: "runtime", id: "get-doc" },
    dependsOn: [], acceptance: ["The finding has evidence."], inputs: [], tokenBudget: 100 }));
  const run = store.create({ authority: { userId: 1, conversationId: 1, conversationPublicId: "conv_test", runtimeSessionId: 1,
    sourceRunId: "parent", originClientMessageId: "origin", surface: "dashboard_terminal", gardenId: null, gardenSlug: null,
    model: "test", reasoningEffort: "high", standingApproval: true, allowedTools: ["agent_launch"], allowedAgentIds: ["get-doc"], inputReferences: [] },
    requestId: "plan", limits: { ...DEFAULT_SWARM_LIMITS, maxTokens: 300 },
    plan: { objective: "A verified comparison", reason: "Independent sources", benefit: "coverage", mode: "durable", tasks },
    admission: () => ({ available: true, requiresApproval: false }), ...overrides });
  const jobs = new Map(); let starts = 0; let stops = 0;
  const adapter = { idempotentStart: true,
    async start(context) { starts++; const handle = { kind: "runtime", id: "get-doc", runId: context.attempt.requestId }; jobs.set(handle.runId, { status: "running" }); return handle; },
    async recover(context) { return jobs.has(context.attempt.requestId) ? { status: "found", handle: { kind: "runtime", id: "get-doc", runId: context.attempt.requestId } } : { status: "absent" }; },
    async observe(_context, handle) { return jobs.get(handle.runId); },
    async cancel(_context, handle) { stops++; jobs.set(handle.runId, { status: "cancelled", totalTokens: 12, usageComplete: true }); },
  };
  return { store, run, jobs, adapter, starts: () => starts, stops: () => stops,
    scheduler: () => new SwarmScheduler(store, () => adapter),
    close() { database.close(); fs.rmSync(directory, { recursive: true, force: true }); } };
}

test("parallel admission really starts independent jobs together", async () => {
  const f = setup();
  try {
    let release; const barrier = new Promise(resolve => { release = resolve; }); const start = f.adapter.start; let entered = 0;
    f.adapter.start = async context => { if (++entered === 2) release(); await barrier; return start(context); };
    const result = await f.scheduler().tick(1, f.run.id);
    assert.equal(result.started, 2); assert.equal(f.starts(), 2);
    assert.equal(f.store.snapshot(1, f.run.id).attempts.length, 2);
  } finally { f.close(); }
});

test("restart reconciles an accepted start whose response was lost without repeating it", async () => {
  const f = setup();
  try {
    const start = f.adapter.start;
    f.adapter.start = async context => { await start(context); throw new Error("lost response"); };
    await f.scheduler().tick(1, f.run.id);
    assert.equal(f.starts(), 2);
    assert.ok(f.store.snapshot(1, f.run.id).attempts.every(attempt => attempt.handle === null));
    await f.scheduler().tick(1, f.run.id);
    assert.equal(f.starts(), 2);
    assert.ok(f.store.snapshot(1, f.run.id).attempts.every(attempt => attempt.status === "running" && attempt.handle));
  } finally { f.close(); }
});

test("a competing coordinator cannot double-start a slow launch", async () => {
  const f = setup();
  try {
    let release; let entered; const ready = new Promise(resolve => { entered = resolve; });
    const barrier = new Promise(resolve => { release = resolve; }); const start = f.adapter.start;
    f.adapter.start = async context => { entered(); await barrier; return start(context); };
    const first = f.scheduler().tick(1, f.run.id); await ready;
    assert.equal((await f.scheduler().tick(1, f.run.id)).acquired, false);
    f.store.control(1, f.run.id, "cancel"); release(); await first;
    assert.ok(f.store.snapshot(1, f.run.id).attempts.every(attempt => attempt.status === "cancelling"));
    await f.scheduler().tick(1, f.run.id);
    assert.equal(f.stops(), 2); assert.equal(f.store.get(1, f.run.id).status, "cancelled");
  } finally { f.close(); }
});

test("transient observations keep workers live; successful work still needs evidence-backed verification", async () => {
  const f = setup();
  try {
    await f.scheduler().tick(1, f.run.id); const observe = f.adapter.observe;
    f.adapter.observe = async () => { throw new Error("network unavailable"); };
    await f.scheduler().tick(1, f.run.id);
    assert.ok(f.store.snapshot(1, f.run.id).tasks.every(task => task.status === "running"));
    f.adapter.observe = observe;
    for (const key of f.jobs.keys()) f.jobs.set(key, { status: "completed", totalTokens: 25, usageComplete: true,
      summary: "Observed result", evidence: [{ title: "Source", kind: "observation", summary: "Finding", reference: "https://example.test/source" }] });
    assert.equal((await f.scheduler().tick(1, f.run.id)).needsCoordinator, true);
    const snapshot = f.store.snapshot(1, f.run.id);
    assert.equal(snapshot.run.status, "verifying"); assert.equal(snapshot.run.chargedTokens, 50);
    for (const task of snapshot.tasks) f.store.verify(1, f.run.id, task.key, [{ criterion: task.acceptance[0], passed: true,
      evidenceIds: snapshot.evidence.filter(item => item.taskKey === task.key).map(item => item.id) }]);
    assert.equal(f.store.get(1, f.run.id).status, "completed");
  } finally { f.close(); }
});

test("a proven input rejection is retryable; an uncorrelated non-idempotent launch is not", async () => {
  const f = setup();
  try {
    f.adapter.start = async () => { throw new SwarmStartRejected("Missing document"); };
    await f.scheduler().tick(1, f.run.id);
    assert.equal(f.store.get(1, f.run.id).chargedTokens, 0);
    assert.ok(f.store.snapshot(1, f.run.id).tasks.every(task => task.status === "failed"));
    f.store.retry(1, f.run.id, "sources", "Use the available document instead.");
    f.adapter.start = async () => { throw new Error("unknown"); }; f.adapter.idempotentStart = false;
    await f.scheduler().tick(1, f.run.id); await f.scheduler().tick(1, f.run.id);
    assert.equal(f.store.snapshot(1, f.run.id).tasks[0].status, "uncertain");
    assert.throws(() => f.store.retry(1, f.run.id, "sources", "Try again"), { code: "swarm_retry_state" });
  } finally { f.close(); }
});

test("runtime evidence and usage preserve cumulative and partial semantics", () => {
  const events = [
    { sequenceNumber: 1, type: "run.usage", payload: { totalTokens: 10 } },
    { sequenceNumber: 2, type: "run.usage", payload: { totalTokens: 30, partial: true } },
    { sequenceNumber: 3, type: "artifact.ready", payload: { artifactId: "artifact_test", version: 2 } },
    { sequenceNumber: 4, type: "run.result", payload: { result: "Observed answer" } },
  ];
  const result = runtimeSwarmObservation({ terminal: true, status: "completed", events }, "job");
  assert.equal(result.totalTokens, 30); assert.equal(result.usageComplete, false);
  assert.equal(result.summary, "Observed answer"); assert.equal(result.evidence[1].kind, "artifact");
});

test("concurrent server principals do not bleed and runtime identity survives restart", async () => {
  const one = { userId: 1, agentId: "get-doc", requestId: "task:one:1", conversationPublicId: "conv_one" };
  const two = { ...one, userId: 2, requestId: "task:two:1" };
  const result = await Promise.all([one, two].map(value => withSwarmInvocation(value, async () => {
    await new Promise(resolve => setImmediate(resolve)); return currentSwarmInvocation();
  })));
  assert.deepEqual(result, [one, two]); assert.equal(currentSwarmInvocation(), undefined);
  assert.deepEqual(swarmRuntimeIdentity(one, "oa_doc", "get-doc-run"), swarmRuntimeIdentity({ ...one }, "oa_doc", "get-doc-run"));
  assert.notEqual(swarmRuntimeIdentity(one, "oa_doc", "get-doc-run").authority.conversationId, swarmRuntimeIdentity(two, "oa_doc", "get-doc-run").authority.conversationId);
});

test("persona and native workers cannot expand capabilities or recursively launch teams", () => {
  const parent = { allowedTools: ["read", "websearch", "agent_launch"], allowedOperations: ["source_read"],
    selectedConnections: ["docs"], selectedConditionalSkills: ["research"], authorizedRoots: ["safe"], authorizedPathPatterns: [], authorizedDeleteTargets: [], allowedCommandPatterns: [] };
  const scope = { executor: { kind: "persona", id: "researcher" }, authority: { allowedTools: parent.allowedTools, capability: parent } };
  const decision = { ...parent, allowedTools: ["read", "websearch", "terminal", "agent_launch", "delegate_task"], authorizedRoots: ["safe", "elsewhere"], allowedOperations: ["source_read", "code_write"], selectedConnections: ["docs", "mail"], authorizedDeleteTargets: ["file"] };
  restrictSwarmWorkerDecision(decision, scope);
  assert.deepEqual(decision.allowedTools, ["read", "websearch"]); assert.deepEqual(decision.authorizedRoots, ["safe"]);
  assert.deepEqual(decision.selectedConnections, ["docs"]); assert.deepEqual(decision.authorizedDeleteTargets, []);
  assert.equal(workerToolAllowed({ ...scope, executor: { kind: "native", id: "read" } }, "websearch"), false);
});
