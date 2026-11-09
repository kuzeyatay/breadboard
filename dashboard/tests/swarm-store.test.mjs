import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { SwarmStore } from "../src/lib/swarm/store.ts";
import { DEFAULT_SWARM_LIMITS } from "../src/lib/swarm/policy.ts";

const authority = (conversationId = 1) => ({ userId: 1, conversationId, conversationPublicId: `conv_${conversationId}`, runtimeSessionId: conversationId,
  sourceRunId: "source-one", originClientMessageId: "message-one", surface: "dashboard_terminal", gardenId: null,
  gardenSlug: null, model: "test-model", reasoningEffort: "high", standingApproval: false,
  allowedTools: ["agent_launch"], allowedAgentIds: ["get-doc", "deep-research", "codex", "agent-browser"], inputReferences: [] });
const task = (key, overrides = {}) => ({ key, title: key, brief: `Investigate ${key}.`, executor: { kind: "runtime", id: "get-doc" },
  dependsOn: [], acceptance: ["Findings are supported by the saved evidence."], inputs: [], tokenBudget: 100, ...overrides });
const plan = (tasks = [task("one"), task("two")]) => ({ objective: "A complete comparison.", reason: "Separate sources improve coverage.", benefit: "coverage", mode: "durable", tasks });
function fixture(options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-swarm-"));
  const file = path.join(directory, "state.db");
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES (1),(2); CREATE TABLE conversations(id INTEGER PRIMARY KEY,user_id INTEGER); INSERT INTO conversations VALUES (1,1),(2,1),(3,2);");
  let now = 1_000;
  const store = new SwarmStore(db, () => now);
  const create = (extra = {}) => store.create({ authority: authority(), requestId: "request-one", plan: plan(),
    limits: { ...DEFAULT_SWARM_LIMITS, maxTokens: 400 }, admission: () => ({ available: true, requiresApproval: false }), ...options, ...extra });
  return { db, file, store, create, advance: ms => { now += ms; }, clock: () => now,
    close() { db.close(); fs.rmSync(directory, { recursive: true, force: true }); } };
}
const attach = (store, lease, claimed) => store.attach(lease, claimed.attempt.id, { ...claimed.task.executor, runId: `job-${claimed.task.key}` });
const evidence = (store, lease, claimed, kind = "observation") => store.evidence(lease, claimed.attempt.id,
  [{ title: "Source inspected", summary: "The source contains the requested finding.", kind, reference: `https://example.test/${claimed.task.key}` }]);
function complete(store, lease, claimed, tokens = 50) {
  attach(store, lease, claimed);
  store.reportUsage(lease, claimed.attempt.id, tokens, true);
  const ids = evidence(store, lease, claimed);
  store.settle(lease, claimed.attempt.id, "completed", "The findings and their sources.");
  store.verify(1, lease.runId, claimed.task.key, claimed.task.acceptance.map(criterion => ({ criterion, passed: true, evidenceIds: ids })));
  return ids;
}

test("creation is owned and idempotent, and one conversation has one coordinator", () => {
  const f = fixture();
  try {
    const run = f.create();
    assert.equal(f.create().id, run.id);
    assert.throws(() => f.create({ plan: { ...plan(), objective: "Different work" } }), { code: "swarm_request_conflict" });
    assert.throws(() => f.create({ requestId: "another" }), { code: "swarm_already_active" });
    assert.throws(() => f.store.snapshot(2, run.id), { code: "swarm_not_found" });
    assert.throws(() => f.create({ authority: authority(3) }), { code: "swarm_conversation_scope" });
    f.db.prepare("UPDATE conversations SET user_id=2 WHERE id=1").run();
    assert.throws(() => f.store.get(1, run.id), { code: "swarm_not_found" });
  } finally { f.close(); }
});

test("two real connections cannot admit twice and a restarted coordinator fences old callbacks", () => {
  const f = fixture(); const otherDb = new Database(f.file); const other = new SwarmStore(otherDb, f.clock);
  try {
    const run = f.create();
    const lease = f.store.acquireLease(1, run.id, "first", 1000);
    assert.equal(other.acquireLease(1, run.id, "second", 1000), null);
    const claimed = f.store.claimNext(lease);
    f.advance(1001);
    const replacement = other.acquireLease(1, run.id, "second", 1000);
    assert.equal(replacement.fence, lease.fence + 1);
    assert.throws(() => attach(f.store, lease, claimed), { code: "swarm_stale_coordinator" });
    attach(other, replacement, claimed);
    f.store.releaseLease(lease);
    assert.equal(f.store.acquireLease(1, run.id, "first", 1000), null);
    const restored = other.snapshot(1, run.id);
    assert.equal(restored.attempts.length, 1);
    assert.equal(restored.attempts[0].requestId, claimed.attempt.requestId);
    assert.equal(restored.attempts[0].handle.runId, "job-one");
  } finally { otherDb.close(); f.close(); }
});

test("dependent work waits for evidence-backed completion, and a review can inspect unverified work", () => {
  const f = fixture({ plan: plan([task("one"), task("review", { dependsOn: ["one"], verifies: "one" }), task("report", { dependsOn: ["one", "review"] })]) });
  try {
    const run = f.create(); const lease = f.store.acquireLease(1, run.id, "owner");
    const first = f.store.claimNext(lease); attach(f.store, lease, first);
    assert.equal(f.store.claimNext(lease), null);
    f.store.settle(lease, first.attempt.id, "completed", "Candidate result");
    assert.equal(f.store.get(1, run.id).status, "running");
    assert.throws(() => f.store.verify(1, run.id, "one", [{ criterion: first.task.acceptance[0], passed: true, evidenceIds: [] }]), { code: "swarm_verification" });
    const review = f.store.claimNext(lease); assert.equal(review.task.key, "review");
    const reviewEvidence = complete(f.store, lease, review);
    f.store.verify(1, run.id, "one", [{ criterion: first.task.acceptance[0], passed: true, evidenceIds: reviewEvidence }]);
    const report = f.store.claimNext(lease); assert.equal(report.task.key, "report");
    complete(f.store, lease, report);
    assert.equal(f.store.get(1, run.id).status, "completed");
    assert.equal(f.store.claimNext(lease), null);
  } finally { f.close(); }
});

test("usage snapshots are replay-safe and missing usage consumes its reservation", () => {
  const f = fixture();
  try {
    const run = f.create(); const lease = f.store.acquireLease(1, run.id, "owner");
    const first = f.store.claimNext(lease);
    assert.equal(f.store.get(1, run.id).reservedTokens, 100);
    f.store.reportUsage(lease, first.attempt.id, 20, false);
    f.store.reportUsage(lease, first.attempt.id, 20, false);
    f.store.reportUsage(lease, first.attempt.id, 10, false);
    assert.equal(f.store.get(1, run.id).chargedTokens, 20);
    assert.equal(f.store.get(1, run.id).reservedTokens, 80);
    f.store.settle(lease, first.attempt.id, "failed", "No usage receipt", "Failed before returning the full receipt.");
    assert.equal(f.store.get(1, run.id).chargedTokens, 100);
    f.store.reportUsage(lease, first.attempt.id, 70, true);
    assert.equal(f.store.get(1, run.id).chargedTokens, 70);
    const second = f.store.claimNext(lease);
    f.store.reportUsage(lease, second.attempt.id, 500, true);
    assert.equal(f.store.get(1, run.id).status, "budget_limited");
    assert.equal(f.store.claimNext(lease), null);
  } finally { f.close(); }
});

test("approval, pause and deadline prevent startup without discarding the plan", () => {
  const f = fixture({ admission: () => ({ available: true, requiresApproval: true }) });
  try {
    const run = f.create(); const lease = f.store.acquireLease(1, run.id, "owner");
    assert.equal(f.store.claimNext(lease), null);
    f.store.approve(1, run.id, "one");
    f.store.control(1, run.id, "pause"); assert.equal(f.store.claimNext(lease), null);
    f.store.control(1, run.id, "resume"); assert.equal(f.store.claimNext(lease).task.key, "one");
    f.advance(DEFAULT_SWARM_LIMITS.maxDurationMs + 1);
    const resumed = f.store.acquireLease(1, run.id, "replacement");
    assert.equal(f.store.claimNext(resumed), null);
    assert.equal(f.store.get(1, run.id).status, "budget_limited");
    assert.throws(() => f.store.control(1, run.id, "resume"), { code: "swarm_budget" });
  } finally { f.close(); }
});

test("shared resource leases span conversations and remain held for uncertain actions", () => {
  const work = plan([task("one", { executor: { kind: "runtime", id: "agent-browser" } }), task("two", { executor: { kind: "runtime", id: "agent-browser" } })]);
  const f = fixture({ plan: work, authority: { ...authority(), standingApproval: true } });
  try {
    const first = f.create(); const second = f.create({ authority: { ...authority(2), standingApproval: true } });
    const a = f.store.acquireLease(1, first.id, "a"); const b = f.store.acquireLease(1, second.id, "b");
    const claimed = f.store.claimNext(a);
    assert.equal(f.store.claimNext(a), null); assert.equal(f.store.claimNext(b), null);
    f.store.settle(a, claimed.attempt.id, "uncertain", "The runtime could not confirm whether the action happened.");
    assert.equal(f.store.claimNext(b), null);
    assert.throws(() => f.store.retry(1, first.id, "one", "Try another browser"), { code: "swarm_retry_state" });
  } finally { f.close(); }
});

test("cancellation reaches starting work and late completion cannot resurrect it", () => {
  const f = fixture();
  try {
    const run = f.create(); const lease = f.store.acquireLease(1, run.id, "owner");
    const first = f.store.claimNext(lease);
    f.store.control(1, run.id, "cancel");
    assert.equal(f.store.get(1, run.id).status, "cancelling");
    assert.equal(f.store.claimNext(lease), null);
    attach(f.store, lease, first);
    assert.equal(f.store.snapshot(1, run.id).attempts[0].status, "cancelling");
    f.store.settle(lease, first.attempt.id, "completed", "Result arrived after Stop");
    assert.equal(f.store.get(1, run.id).status, "cancelled");
    assert.ok(f.store.snapshot(1, run.id).tasks.every(task => task.status === "cancelled"));
    f.store.control(1, run.id, "resume");
    assert.equal(f.store.get(1, run.id).status, "cancelled");
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM swarm_resources").get().n, 0);
  } finally { f.close(); }
});

test("failures need a correction and retries cannot spend beyond their attempt bound", () => {
  const f = fixture();
  try {
    const run = f.create(); const lease = f.store.acquireLease(1, run.id, "owner");
    const first = f.store.claimNext(lease);
    f.store.settle(lease, first.attempt.id, "failed", "Failure", "Bad query");
    assert.throws(() => f.store.retry(1, run.id, "one", first.task.brief), { code: "swarm_retry_correction" });
    f.store.retry(1, run.id, "one", "Use the corrected subject and existing sources.");
    const second = f.store.claimNext(lease); assert.equal(second.task.key, "one");
    assert.notEqual(second.attempt.requestId, first.attempt.requestId);
    f.store.settle(lease, second.attempt.id, "failed", "Another failure");
    assert.throws(() => f.store.retry(1, run.id, "one", "A third strategy"), { code: "swarm_attempt_limit" });
  } finally { f.close(); }
});

test("evidence is deduplicated and foreign or stale attempt receipts cannot verify a task", () => {
  const f = fixture();
  try {
    const run = f.create(); const lease = f.store.acquireLease(1, run.id, "owner");
    const first = f.store.claimNext(lease); const oldEvidence = evidence(f.store, lease, first);
    assert.deepEqual(evidence(f.store, lease, first), oldEvidence);
    f.store.settle(lease, first.attempt.id, "failed", "Invalid result");
    f.store.retry(1, run.id, "one", "Correct the invalid result with new evidence.");
    const next = f.store.claimNext(lease);
    f.store.settle(lease, next.attempt.id, "completed", "New result");
    assert.throws(() => f.store.verify(1, run.id, "one", [{ criterion: next.task.acceptance[0], passed: true, evidenceIds: oldEvidence }]), { code: "swarm_verification_scope" });
    assert.throws(() => f.store.verify(1, run.id, "one", [{ criterion: next.task.acceptance[0], passed: true, evidenceIds: ["foreign"] }]), { code: "swarm_verification_scope" });
    assert.equal(f.store.get(1, run.id).status, "running");
  } finally { f.close(); }
});
