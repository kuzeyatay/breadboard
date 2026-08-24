// Agents proposing automations, and the line between offering and doing.
//
// The property that matters is that a proposal is inert. The agent can draft
// anything it likes; until a person accepts it there is no row in `workflows`,
// nothing to run, and nothing scheduled. Everything else here guards the
// manners: no offering the same thing twice, no re-offering what was refused,
// no burying the user in offers.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, beforeEach } from "node:test";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-wf-proposals-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;

const { default: db } = await import("../src/lib/db.ts");
const proposals = await import("../src/lib/workflows/proposals.ts");
const { repetitionSignals, evidenceLines } = await import(
  "../src/lib/workflows/repetition.ts"
);

after(() => {
  db.close();
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

beforeEach(() => {
  db.exec(`
    DELETE FROM workflow_proposals;
    DELETE FROM workflow_runs;
    DELETE FROM workflows;
    DELETE FROM conversation_messages;
    DELETE FROM conversations;
    DELETE FROM users;
    DELETE FROM sqlite_sequence;
  `);
  db.prepare(
    "INSERT INTO users(id, username, email, password_hash) VALUES (1, 'alice', 'alice@example.test', 'x')",
  ).run();
});

const GRAPH = {
  blocks: { a: { type: "schedule", name: "Every Monday" }, b: { type: "http", name: "Fetch report" } },
  edges: [{ source: "a", target: "b" }],
};

function offer(overrides = {}) {
  return proposals.proposeWorkflow({
    userId: 1,
    name: "Monday report fetch",
    description: "Pulls the weekly report and files it.",
    rationale: "You have asked for this every Monday for a month.",
    evidence: ["Asked 4 times across 4 separate days."],
    state: GRAPH,
    ...overrides,
  });
}

// ── inertness ─────────────────────────────────────────────────────────

test("a proposal creates no workflow", () => {
  const result = offer();
  assert.equal(result.created, true);
  const count = db.prepare("SELECT COUNT(*) AS n FROM workflows").get();
  assert.equal(count.n, 0, "offering must not create anything that can run");
});

test("accepting is what makes it real", () => {
  const { proposal } = offer();
  const accepted = proposals.acceptProposal(1, proposal.id);
  assert.ok(accepted);

  const row = db.prepare("SELECT * FROM workflows WHERE id = ?").get(accepted.workflowId);
  assert.ok(row, "accepting copies the draft into workflows");
  assert.equal(row.name, "Monday report fetch");
  assert.deepEqual(JSON.parse(row.state).blocks, GRAPH.blocks);
  assert.equal(accepted.proposal.status, "accepted");
});

test("the record of what was offered survives acceptance", () => {
  const { proposal } = offer();
  const accepted = proposals.acceptProposal(1, proposal.id);
  const stored = proposals.getProposal(1, proposal.id);
  assert.equal(stored.status, "accepted");
  assert.equal(stored.workflowId, accepted.workflowId);
  assert.equal(stored.rationale, "You have asked for this every Monday for a month.");
});

test("declining creates nothing", () => {
  const { proposal } = offer();
  assert.equal(proposals.declineProposal(1, proposal.id), true);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM workflows").get().n, 0);
  assert.equal(proposals.getProposal(1, proposal.id).status, "declined");
});

test("a proposal can only be accepted once", () => {
  const { proposal } = offer();
  assert.ok(proposals.acceptProposal(1, proposal.id));
  assert.equal(proposals.acceptProposal(1, proposal.id), null);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM workflows").get().n, 1);
});

test("another user's proposal is not reachable", () => {
  db.prepare(
    "INSERT INTO users(id, username, email, password_hash) VALUES (2, 'bob', 'bob@example.test', 'x')",
  ).run();
  const { proposal } = offer();
  assert.equal(proposals.getProposal(2, proposal.id), null);
  assert.equal(proposals.acceptProposal(2, proposal.id), null);
  assert.equal(proposals.declineProposal(2, proposal.id), false);
});

// ── manners ───────────────────────────────────────────────────────────

test("the same idea is not offered twice", () => {
  offer();
  const second = offer();
  assert.equal(second.created, false);
  assert.equal(second.reason, "already_pending");
  assert.equal(proposals.countPendingProposals(1), 1);
});

test("rewording an idea does not make it a new one", () => {
  offer();
  const reworded = offer({
    rationale: "This keeps coming up, so here is a different way of putting it.",
    description: "Completely different words for the same automation.",
  });
  assert.equal(reworded.created, false);
  assert.equal(reworded.reason, "already_pending");
});

test("a refused idea does not come back", () => {
  const { proposal } = offer();
  proposals.declineProposal(1, proposal.id);
  const again = offer();
  assert.equal(again.created, false);
  assert.equal(again.reason, "already_declined");
});

test("but the user can let it be offered again", () => {
  const { proposal } = offer();
  proposals.declineProposal(1, proposal.id);
  assert.equal(proposals.reopenProposal(1, proposal.id), true);
  assert.equal(offer().created, true);
});

test("a genuinely different automation is a different offer", () => {
  offer();
  const other = offer({
    name: "Archive last quarter's invoices",
    state: { blocks: { z: { type: "file", name: "Archive" } }, edges: [] },
  });
  assert.equal(other.created, true);
  assert.equal(proposals.countPendingProposals(1), 2);
});

test("offers are capped so they cannot pile up", () => {
  for (let index = 0; index < proposals.MAX_PENDING_PROPOSALS; index += 1) {
    const created = offer({
      name: `Automation number ${index}`,
      state: { blocks: { [`b${index}`]: { type: "http", name: `Step ${index}` } }, edges: [] },
    });
    assert.equal(created.created, true, `offer ${index}`);
  }
  const overflow = offer({
    name: "One too many",
    state: { blocks: { x: { type: "http", name: "Extra" } }, edges: [] },
  });
  assert.equal(overflow.created, false);
  assert.equal(overflow.reason, "too_many_pending");
});

test("accepting one makes room for another", () => {
  for (let index = 0; index < proposals.MAX_PENDING_PROPOSALS; index += 1) {
    offer({
      name: `Automation number ${index}`,
      state: { blocks: { [`b${index}`]: { type: "http", name: `Step ${index}` } }, edges: [] },
    });
  }
  const pending = proposals.listProposals(1, "pending");
  proposals.acceptProposal(1, pending[0].id);
  const next = offer({
    name: "Now there is room",
    state: { blocks: { y: { type: "http", name: "New" } }, edges: [] },
  });
  assert.equal(next.created, true);
});

// ── the evidence ──────────────────────────────────────────────────────

function conversation() {
  return Number(
    db
      .prepare(
        `INSERT INTO conversations (public_id, user_id, title) VALUES (?, 1, 'Chat')`,
      )
      .run(`c-${Math.random().toString(36).slice(2)}`).lastInsertRowid,
  );
}

function said(conversationId, text, daysAgo, index) {
  db.prepare(
    `INSERT INTO conversation_messages
       (conversation_id, client_message_id, role, surface, content, status,
        order_index, created_at)
     VALUES (?, ?, 'user', 'dashboard_terminal', ?, 'complete', ?, datetime('now', ?))`,
  ).run(conversationId, `m-${conversationId}-${index}`, text, index, `-${daysAgo} days`);
}

test("a routine is reported, with the days it spans", () => {
  const id = conversation();
  said(id, "Please fetch the weekly pump report and summarise it", 21, 0);
  said(id, "Fetch the weekly pump report again and summarise", 14, 1);
  said(id, "Can you fetch the weekly pump report and summarise it", 7, 2);
  said(id, "Fetch the weekly pump report please and summarise", 1, 3);

  const signals = repetitionSignals(1, {}, db);
  assert.ok(signals.length >= 1, "four requests across four days is a routine");
  const [top] = signals;
  assert.ok(top.occurrences >= 3);
  assert.ok(top.distinctDays >= 2);
  assert.ok(top.terms.some((term) => /pump|report|weekly|fetch/.test(term)));
  assert.ok(top.examples.length > 0, "the evidence quotes rather than paraphrases");
});

test("three requests in one afternoon are not a routine", () => {
  const id = conversation();
  said(id, "Please fetch the weekly pump report and summarise it", 3, 0);
  said(id, "Fetch the weekly pump report and summarise it again", 3, 1);
  said(id, "Fetch the weekly pump report and summarise", 3, 2);

  const signals = repetitionSignals(1, {}, db);
  assert.equal(signals.length, 0, "one task going badly is not a habit");
});

test("one-off requests produce nothing", () => {
  const id = conversation();
  said(id, "What is the capital of Portugal", 5, 0);
  said(id, "Rename this file to something shorter", 3, 1);
  said(id, "Summarise the attached contract for me", 1, 2);
  assert.equal(repetitionSignals(1, {}, db).length, 0);
});

test("no history is not an error", () => {
  assert.deepEqual(repetitionSignals(1, {}, db), []);
});

test("evidence reads as something a person can check", () => {
  const id = conversation();
  [21, 14, 7, 1].forEach((daysAgo, index) => {
    said(id, "Fetch the weekly pump report and summarise it", daysAgo, index);
  });
  const [signal] = repetitionSignals(1, {}, db);
  const lines = evidenceLines(signal);
  assert.match(lines[0], /separate days/);
  assert.match(lines[1], /Recurring subject/);
  assert.ok(lines.some((line) => line.startsWith("You said:")));
});
