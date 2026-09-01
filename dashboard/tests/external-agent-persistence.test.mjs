// Two promises every agent in Breadboard makes, checked for all of them at
// once rather than one agent at a time:
//
//   1. A run card survives. Reload the page, come back to the chat a day later,
//      and the turn still shows which agent ran and what it produced.
//   2. An artifact belongs to the chat that made it, and to no other.
//
// Both used to be per-agent wiring, which is why both had holes: Agent TARS and
// Parametric CAD were missing from the hand-written list the save path used, so
// a chat containing either lost its card on the next reload. The registry is now
// one table that both directions read, and these tests walk every kind in it.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dashboardRoot = path.resolve(import.meta.dirname, "..");
const source = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");

const {
  EXTERNAL_AGENT_RUN_KINDS,
  EXTERNAL_AGENT_RUN_FIELD_BY_KIND,
  assistantExternalAgentRunId,
  delegatedAgentPresentation,
  externalAgentMessageFields,
  parseExternalAgentRun,
  parseExternalAgentState,
} = await import("../src/lib/conversations/external-agent-runs.ts");

/** A descriptor carrying every field any kind needs; each parser keeps its own. */
const descriptorFor = (kind) => ({
  kind,
  runId: "run_1",
  agentId: "agent_1",
  task: "a task",
  query: "a question",
  output: "report",
  brief: "a brief",
  capability: "chat",
  gardenSlug: "garden",
  repository: "C:/repo",
});

// Agent TARS drives a real browser from the Terminal only — see the surfaces
// note on its runtime-agent profile — so it has no Garden card to miss.
const TERMINAL_ONLY = new Set(["agent_tars"]);

test("every agent's run descriptor round-trips into a transcript field", () => {
  for (const kind of EXTERNAL_AGENT_RUN_KINDS) {
    const parsed = parseExternalAgentRun(descriptorFor(kind));
    assert.ok(parsed, `${kind} does not parse`);
    assert.equal(parsed.kind, kind);

    const fields = externalAgentMessageFields({
      externalAgent: true,
      externalAgentRun: parsed,
      externalAgentOutcome: "completed",
      delegatedAgentRun: true,
      externalAgentResult: "The specialist result.",
      delegatedAgentPreamble: "I’m handing this to the specialist.",
      delegatedAgentReason: "The specialist can reach the required live service.",
    });
    const field = EXTERNAL_AGENT_RUN_FIELD_BY_KIND[kind];
    assert.ok(fields[field], `${kind} did not land on ${field}`);
    assert.equal(fields[field].runId, "run_1");
    assert.equal(fields.externalAgentOutcome, "completed");
    assert.equal(fields.delegatedAgentRun, true);
    assert.equal(fields.externalAgentResult, "The specialist result.");
    assert.equal(
      fields.delegatedAgentReason,
      "The specialist can reach the required live service.",
    );
    assert.ok(fields.externalAgentName);
    assert.equal(
      fields.delegatedAgentPreamble,
      "I’m handing this to the specialist.",
    );

    // The transcript finds a turn's run only through the shared field list; a
    // kind missing from it is a card that never reconnects.
    assert.equal(
      assistantExternalAgentRunId({ role: "assistant", ...fields }),
      "run_1",
      `${kind} is not discoverable on an assistant turn`,
    );
    // The user half of a turn carries the same descriptor, and must never be
    // mistaken for the run's own message.
    assert.equal(assistantExternalAgentRunId({ role: "user", ...fields }), null);
  }
});

test("openGym's quiet Super Agent presentation survives persistence", () => {
  const parsed = parseExternalAgentRun({
    ...descriptorFor("open_gym"),
    quiet: true,
  });
  assert.ok(parsed);
  assert.equal(parsed.kind, "open_gym");
  assert.equal(parsed.quiet, true);

  const fields = externalAgentMessageFields({
    externalAgent: true,
    externalAgentRun: parsed,
    externalAgentOutcome: "completed",
    externalAgentResult: "Exercise guidance and animation metadata.",
  });
  assert.equal(fields.openGymRun?.quiet, true);
});

test("legacy delegated rows restore the Super Agent text without losing the worker result", () => {
  const fields = externalAgentMessageFields({
    externalAgent: true,
    externalAgentRun: descriptorFor("deep_research"),
    externalAgentOutcome: "completed",
    delegatedAgentRun: true,
    delegatedAgentPreamble: "I am sending this to Deep Research.",
  });
  const restored = delegatedAgentPresentation(
    "The private research result.",
    fields,
  );

  assert.equal(restored.content, "I am sending this to Deep Research.");
  assert.equal(restored.externalAgentResult, "The private research result.");
});

test("structured run-card state round-trips with a finished transcript", () => {
  const state = parseExternalAgentState({
    kind: "hardware-blueprint",
    designTitle: "Universal Clip-On AR Glasses",
    specs: [["Parts", "12"]],
    pins: [{ pin: "D21", purpose: "i2c-sda" }],
    firmwareFiles: ["src/main.cpp"],
    enclosureTitle: "AR glasses enclosure and universal mount",
  });
  assert.ok(state);
  const fields = externalAgentMessageFields({
    externalAgent: true,
    externalAgentRun: descriptorFor("hardware_blueprint"),
    externalAgentOutcome: "completed",
    externalAgentState: state,
  });
  assert.deepEqual(fields.externalAgentState, state);
  assert.equal(parseExternalAgentState([]), null);
  assert.equal(parseExternalAgentState({ payload: "x".repeat(100_001) }), null);

  const card = source("src/app/components/hermes/inline-hardware-blueprint-run.tsx");
  assert.match(card, /persistedState/);
  assert.match(card, /persistedBlueprintState/);
  assert.match(card, /kind: "hardware-blueprint"/);
});

test("external-agent persistence stays bound to the launch conversation", () => {
  const session = source("src/app/components/hermes/use-agent-session.ts");
  assert.match(session, /externalAgentConversationIdsRef/);
  assert.match(
    session,
    /externalAgentConversationIdsRef\.current\.get\(input\.clientMessageId\)[\s\S]{0,140}\(await ensureConversation\(input\.clientMessageId\)\)/,
  );
  assert.match(session, /pendingConversationCreationRef/);
  assert.doesNotMatch(session, /turnsWaitingForThisConversation/);
  assert.match(
    session,
    /`\/api\/hermes\/sessions\/\$\{targetSessionId\}\/external-turns`/,
  );
  assert.match(session, /if \(sessionRef\.current !== targetSessionId\) return;/);
  assert.doesNotMatch(
    session,
    /const activeSessionId = sessionRef\.current;[\s\S]{0,180}\/external-turns/,
    "a completed background run can still be written into the newly selected chat",
  );
  const terminal = source("src/app/components/hermes/dashboard-agent-terminal.tsx");
  const codex = source("src/app/components/hermes/use-codex-agent.ts");
  assert.doesNotMatch(terminal, /session\.ensureConversation\(\)/);
  assert.doesNotMatch(codex, /session\.ensureConversation\(\)/);
});

test("the Garden save path covers every kind by construction, not by a list", () => {
  const route = source("src/app/api/chat-sessions/[sessionId]/route.ts");
  // Deriving the candidates from the registry is what makes a forgotten agent
  // impossible; a hand-written field list here is the bug this replaced.
  assert.match(route, /EXTERNAL_AGENT_RUN_KINDS\.map/);
  assert.match(route, /EXTERNAL_AGENT_RUN_FIELD_BY_KIND\[kind\]/);
  assert.match(route, /metadata\.delegatedAgentReason/);
  assert.match(route, /delegatedAgentReason: record\.delegatedAgentReason/);
  for (const field of Object.values(EXTERNAL_AGENT_RUN_FIELD_BY_KIND)) {
    assert.doesNotMatch(
      route,
      new RegExp(`record\\.${field}\\b`),
      `${field} is hand-listed again in the save path`,
    );
  }
});

test("both chat surfaces render a card for every agent that can run there", () => {
  const terminal = source("src/app/components/hermes/agent-runtime-panel.tsx");
  const garden = source("src/app/gardens/[clusterSlug]/workspace-client.tsx");
  for (const kind of EXTERNAL_AGENT_RUN_KINDS) {
    const field = EXTERNAL_AGENT_RUN_FIELD_BY_KIND[kind];
    assert.ok(terminal.includes(`message.${field}`), `the Terminal has no card for ${kind}`);
    if (TERMINAL_ONLY.has(kind)) continue;
    assert.ok(garden.includes(`msg.${field}`), `Garden Chat has no card for ${kind}`);
  }
  assert.match(terminal, /message\.delegatedAgentPreamble/);
  assert.match(garden, /msg\.delegatedAgentPreamble/);
  // The two self-presenting delegations stay visible; everything else hides.
  assert.match(
    terminal,
    /message\.delegatedAgentRun &&\s+!message\.openGymRun &&\s+!message\.godsEyeRun/,
  );
  assert.match(
    garden,
    /msg\.delegatedAgentRun &&\s+!msg\.openGymRun &&\s+!msg\.godsEyeRun/,
  );
  assert.match(terminal, /externalAgentCardContent\(storedMessage\)/);
  assert.match(garden, /externalAgentCardContent\(storedMessage\)/);
});

test("a card that is still running reconnects instead of showing a dead turn", () => {
  // Every card guards its event stream the same way: a finished turn with saved
  // content renders from that content, anything else reopens the stream. Without
  // the guard a run in flight would look finished after a reload.
  const cards = fs
    .readdirSync(path.join(dashboardRoot, "src/app/components/hermes"))
    .filter((name) => name.startsWith("inline-") && name.endsWith("-run.tsx"));
  assert.ok(cards.length >= 15, `expected every agent's card, found ${cards.length}`);
  for (const card of cards) {
    const body = source(`src/app/components/hermes/${card}`);
    // Two equally correct spellings across the cards: skip a finished turn
    // outright, or skip one whose result is already saved.
    const guards = [
      'persistedOutcome && persistedOutcome !== "running"',
      '!persistedOutcome || persistedOutcome === "running"',
    ];
    assert.ok(
      guards.some((guard) => body.includes(guard)),
      `${card} opens a live stream for a turn that already finished`,
    );
    // Some cards replay from a cursor, some just subscribe; either way the
    // card is live only because it opens the run's event stream.
    assert.match(body, /new EventSource\(/, `${card} never opens its event stream`);
    // A run the manager has already cleaned up answers with an error, not a
    // stream. Without this the browser reconnects to it for as long as the
    // transcript is on screen — Agent TARS and Agent Browser both did.
    assert.match(body, /onerror/, `${card} never closes a dead stream`);
    // Beyond the prop and its type, the card has to actually read the saved
    // result, or a reloaded turn renders empty.
    assert.ok(
      body.split("persistedContent").length - 1 >= 3,
      `${card} ignores the result saved with the turn`,
    );
  }
});

test("an artifact belongs to the chat that made it, and to no other", async () => {
  const Database = (await import("better-sqlite3")).default;
  const { ensureArtifactSchema } = await import("../src/lib/hermes/artifact-schema.ts");
  const { createArtifact, listArtifactsForUser } = await import(
    "../src/lib/hermes/artifact-store.ts"
  );

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-artifact-scope-"));
  const database = new Database(path.join(root, "artifacts.sqlite"));
  const storageRoot = path.join(root, "storage");
  try {
    database.pragma("foreign_keys = ON");
    database.exec(`
      CREATE TABLE users(id INTEGER PRIMARY KEY);
      CREATE TABLE clusters(id INTEGER PRIMARY KEY, slug TEXT NOT NULL, user_id INTEGER);
      CREATE TABLE conversations(id INTEGER PRIMARY KEY, public_id TEXT UNIQUE, user_id INTEGER, surface TEXT, default_garden_id INTEGER);
      CREATE TABLE hermes_runtime_sessions(id INTEGER PRIMARY KEY);
      CREATE TABLE hermes_runs(id TEXT PRIMARY KEY, runtime_session_id INTEGER);
      CREATE TABLE conversation_messages(id INTEGER PRIMARY KEY);
      INSERT INTO users VALUES (1), (2);
      INSERT INTO conversations VALUES (10, 'conv_a', 1, 'dashboard_terminal', NULL);
      INSERT INTO conversations VALUES (11, 'conv_b', 1, 'dashboard_terminal', NULL);
      INSERT INTO conversations VALUES (12, 'conv_other_user', 2, 'dashboard_terminal', NULL);
      INSERT INTO hermes_runtime_sessions VALUES (20);
      INSERT INTO hermes_runs VALUES ('run_a', 20), ('run_b', 20);
    `);
    ensureArtifactSchema(database);

    const make = (conversationId, runId, title) =>
      createArtifact({
        userId: 1,
        runtimeSessionId: 20,
        hermesSessionId: "session",
        conversationId,
        clusterId: null,
        runId,
        assistantMessageId: null,
        surface: "dashboard_terminal",
        kind: "markdown",
        rendererId: "markdown",
        title,
        content: `# ${title}\n`,
        database,
        storageRoot,
      });

    const fromA = make(10, "run_a", "From chat A");
    make(11, "run_b", "From chat B");

    const inA = listArtifactsForUser({
      userId: 1,
      conversationPublicId: "conv_a",
      database,
    });
    const inB = listArtifactsForUser({
      userId: 1,
      conversationPublicId: "conv_b",
      database,
    });
    assert.deepEqual(inA.map((row) => row.title), ["From chat A"]);
    assert.deepEqual(inB.map((row) => row.title), ["From chat B"]);

    // Background runs used to leave the artifact row unassigned even though a
    // later version event already named its assistant response. The idempotent
    // schema repair recovers that owner for existing chats without touching the
    // artifact's archive timestamp.
    database.prepare("INSERT INTO conversation_messages(id) VALUES (77)").run();
    database.prepare(`
      UPDATE hermes_artifact_events
      SET assistant_message_id = 77
      WHERE artifact_id = ?
    `).run(fromA.id);
    ensureArtifactSchema(database);
    const [repaired] = listArtifactsForUser({
      userId: 1,
      conversationPublicId: "conv_a",
      database,
    });
    assert.equal(repaired.originating_message_id, 77);

    // Another person's chat never sees them, even by naming the conversation.
    assert.deepEqual(
      listArtifactsForUser({ userId: 2, conversationPublicId: "conv_a", database }),
      [],
    );

    // An artifact cannot be filed into a conversation the user does not own.
    assert.throws(
      () => make(12, "run_a", "Into someone else's chat"),
      /conversation/i,
    );

    // Listing without any scope would be "every artifact you have ever made",
    // which is exactly what must not appear inside one chat.
    assert.throws(() => listArtifactsForUser({ userId: 1, database }), /scope/i);
  } finally {
    database.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("both artifact views ask for one chat's artifacts, never the whole archive", () => {
  const panel = source("src/app/components/hermes/artifact-panel.tsx");
  const inline = source("src/app/components/hermes/inline-artifact-cards.tsx");
  for (const [name, body] of [
    ["the artifact panel", panel],
    ["the inline artifact cards", inline],
  ]) {
    assert.match(body, /conversationId/, `${name} does not scope its request to a chat`);
    assert.match(body, /api\/hermes\/artifacts\?\$\{query\}/, `${name} does not read the archive`);
  }
  const route = source("src/app/api/hermes/artifacts/route.ts");
  // The route refuses an unscoped read, so a missing scope fails loudly rather
  // than quietly showing another chat's work.
  assert.match(route, /getConversationForUser/);
});
