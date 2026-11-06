import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-turn-grant-"));
process.env.BREADBOARD_DATA_DIR = directory;
const { default: db } = await import("../src/lib/db.ts");
const {
  createRuntimeSession,
  persistCapabilityDecision,
  getActiveCapabilityDecision,
  revokeCapabilityDecision,
} = await import("../src/lib/hermes/runtime-store.ts");
const { prepareTurn } = await import("../src/lib/hermes/dispatch-core.ts");
const { decideCapabilityMode } = await import("../src/lib/hermes/capability-policy.ts");

test.after(() => {
  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
db.prepare("INSERT INTO users(id,username,email,password_hash) VALUES(1,'test','turn@example.test','x')").run();

function session() {
  return createRuntimeSession({
    surface: "dashboard_terminal", userId: 1, chatSessionId: null,
    agentName: "breadboard-assistant", clusterId: null, gardenId: null,
    pageSlug: null, workspaceKey: `grant-${crypto.randomUUID()}`,
    activeDirectory: directory, filesystemMode: "restricted",
  });
}

function decisions() {
  return [
    prepareTurn({
      request: "Write a full lesson from these notes.",
      surface: "garden_chat", userId: 1, grants: [], workspaceRoot: directory,
    }).decision,
    ...[
      "Diagnose why this TypeScript route reports an error, but do not change it.",
      "Implement keyboard navigation in the capability palette and add a focused regression test.",
    ].map((requestedOutcome) => decideCapabilityMode({
      surface: "dashboard_terminal", userId: 1, authorizedRoot: directory,
      requestedOutcome,
    })),
  ];
}

test("long active turns retain their original scope beyond thirty minutes", () => {
  for (const decision of decisions()) {
    const s = session();
    const stored = persistCapabilityDecision(s.id, decision);
    assert.equal(stored.expiresAt, null);
    for (const minutes of [31, 120, 24 * 60]) {
      const active = getActiveCapabilityDecision(s.id,
        new Date(Date.parse(decision.createdAt) + minutes * 60_000));
      assert.equal(active?.id, stored.id);
      assert.deepEqual(active?.allowedTools, decision.allowedTools);
      assert.deepEqual(active?.authorizedRoots, decision.authorizedRoots);
    }
  }
});

test("turn completion, cancellation and failure still revoke grants immediately", () => {
  for (const reason of ["completed", "cancelled", "abandoned"]) {
    const s = session();
    persistCapabilityDecision(s.id, decisions()[2]);
    assert.equal(revokeCapabilityDecision(s.id, reason), true);
    assert.equal(getActiveCapabilityDecision(s.id), null);
    assert.deepEqual(db.prepare(
      "SELECT capability_mode, capability_decision_id FROM hermes_runtime_sessions WHERE id=?",
    ).get(s.id), { capability_mode: "knowledge", capability_decision_id: null });
  }
});

test("a new turn supersedes the previous turn's grant", () => {
  const s = session();
  const old = persistCapabilityDecision(s.id, decisions()[2]);
  const current = persistCapabilityDecision(s.id, decisions()[0]);
  assert.equal(getActiveCapabilityDecision(s.id)?.id, current.id);
  assert.equal(db.prepare(
    "SELECT revocation_reason FROM hermes_capability_decisions WHERE id=?",
  ).get(old.id).revocation_reason, "superseded");
});
