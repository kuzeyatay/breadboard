import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-uitars-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;
process.env.UI_TARS_MODE = "optional";

const { default: db } = await import("../src/lib/db.ts");
const store = await import("../src/lib/ui-tars/store.ts");
const config = await import("../src/lib/ui-tars/config.ts");
const adapterConfig = await import("../src/lib/ui-tars/adapter-config.ts");

after(() => {
  db.close();
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

// Create a user by satisfying all NOT NULL columns without a default.
function createUser(email) {
  const cols = db.prepare("PRAGMA table_info(users)").all();
  const names = [];
  const values = [];
  for (const c of cols) {
    if (c.pk) continue;
    if (c.notnull === 1 && c.dflt_value === null) {
      names.push(c.name);
      // Unique per user to satisfy UNIQUE columns (e.g. username).
      values.push(c.name === "email" ? email : `${c.name}-${email}`);
    }
  }
  if (!names.includes("email")) {
    names.push("email");
    values.push(email);
  }
  const placeholders = names.map(() => "?").join(", ");
  const info = db.prepare(`INSERT INTO users (${names.join(", ")}) VALUES (${placeholders})`).run(...values);
  return Number(info.lastInsertRowid);
}

const userA = createUser("a@example.com");
const userB = createUser("b@example.com");

// ---------------- pure config ----------------

test("config: computer operator rejected, defaults valid", () => {
  assert.equal(config.validateAgentConfiguration({ ...config.defaultAgentConfiguration(), operator: "computer" }).ok, false);
  assert.equal(config.validateAgentConfiguration(config.defaultAgentConfiguration()).ok, true);
});

test("config: patch preserves omitted fields and keeps operator browser", () => {
  const base = config.defaultAgentConfiguration();
  const r = config.applyConfigurationPatch(base, { model: "m", browserStrategy: "hybrid" });
  assert.equal(r.ok, true);
  assert.equal(r.value.operator, "browser");
  assert.equal(r.value.browserStrategy, "hybrid");
  assert.equal(r.value.approvalMode, base.approvalMode);
});

test("mode: defaults optional; disabled/required honored", () => {
  assert.equal(adapterConfig.uiTarsMode({ UI_TARS_MODE: undefined }), "optional");
  assert.equal(adapterConfig.uiTarsMode({ UI_TARS_MODE: "disabled" }), "disabled");
  assert.equal(adapterConfig.uiTarsMode({ UI_TARS_MODE: "required" }), "required");
  assert.equal(adapterConfig.uiTarsEnabled({ UI_TARS_MODE: "disabled" }), false);
});

// ---------------- store: ownership + secrets ----------------

test("default agent is created once per user and appears in listing", () => {
  const a1 = store.ensureDefaultAgent(userA);
  const a2 = store.ensureDefaultAgent(userA);
  assert.equal(a1.id, a2.id, "idempotent");
  const list = store.listAgents(userA);
  assert.ok(list.some((a) => a.id === a1.id));
  assert.equal(store.presentAgent(a1).name, "UI-TARS Browser Operator");
});

test("cross-user agent access is impossible", () => {
  const a = store.ensureDefaultAgent(userA);
  assert.equal(store.getAgent(userB, a.id), null, "user B cannot read user A's agent");
  assert.ok(store.getAgent(userA, a.id));
});

test("provider key is write-only: never in presented DTO, readable only server-side", () => {
  const a = store.ensureDefaultAgent(userA);
  store.setSecret(a.id, "sk-super-secret-value-1234567890");
  assert.equal(store.hasSecret(a.id), true);
  const presented = store.presentAgent(a);
  assert.equal(presented.secretConfigured, true);
  assert.ok(!JSON.stringify(presented).includes("sk-super-secret-value"));
  // Server-side accessor still works (used only for injection into the adapter).
  assert.equal(store.getSecret(a.id), "sk-super-secret-value-1234567890");
  store.clearSecret(a.id);
  assert.equal(store.hasSecret(a.id), false);
});

// ---------------- store: runs + idempotent events ----------------

test("run events are idempotent (duplicate sequence numbers ignored) and drive status", () => {
  const agent = store.ensureDefaultAgent(userA);
  const runId = store.publicId("run");
  store.createRunRecord({ id: runId, agentId: agent.id, userId: userA, task: "t" });
  const events = [
    { sequenceNumber: 1, type: "run.started", payload: { task: "t" } },
    { sequenceNumber: 2, type: "approval.requested", payload: { actionId: "x", action: "submit", explanation: "e", risk: "high", requestedAt: new Date().toISOString() } },
  ];
  assert.equal(store.persistEvents(runId, events), 2);
  // Re-delivering the same events inserts nothing new.
  assert.equal(store.persistEvents(runId, events), 0);
  assert.equal(store.lastSequence(runId), 2);
  const run = store.getRun(userA, runId);
  assert.equal(run.status, "awaiting_approval");
  // Cross-user cannot read the run or its events.
  assert.equal(store.getRun(userB, runId), null);
  assert.equal(store.listEvents(userB, runId, 0).length, 0);
  // Owner can resume from a sequence cursor.
  assert.equal(store.listEvents(userA, runId, 1).length, 1);
});
