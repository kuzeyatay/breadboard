import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const dataRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "breadboard-memory-badge-"),
);
process.env.BREADBOARD_DATA_DIR = dataRoot;

const { default: db } = await import("../src/lib/db.ts");
const conversations = await import("../src/lib/conversations/store.ts");
const runtime = await import("../src/lib/hermes/runtime-store.ts");
const runs = await import("../src/lib/hermes/run-store.ts");
const memoryEvidence = await import(
  "../src/lib/hermes/memory-evidence.ts"
);

after(() => {
  db.close();
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

test("successful memory endpoint audits restore the badge for the matching turn", () => {
  db.prepare(
    "INSERT INTO users(id, username, email, password_hash) VALUES (1, 'alice', 'alice@example.test', 'x')",
  ).run();
  const conversation = conversations.createConversation({
    userId: 1,
    surface: "dashboard_terminal",
  });
  const session = runtime.createRuntimeSession({
    conversationId: conversation.id,
    surface: "dashboard_terminal",
    userId: 1,
    chatSessionId: null,
    agentName: "breadboard",
    clusterId: null,
    gardenId: null,
    pageSlug: null,
    workspaceKey: "memory-badge-test",
    activeDirectory: dataRoot,
    filesystemMode: "restricted",
  });
  const run = runs.beginRuntimeRun({
    runtimeSessionId: session.id,
    instruction: "Remember my name",
    dispatch: { clientMessageId: "client-memory-turn" },
  });
  const otherRun = runs.finishActiveRuntimeRun(session.id, "completed");
  const unrelated = runs.beginRuntimeRun({
    runtimeSessionId: session.id,
    instruction: "Another turn",
    dispatch: { clientMessageId: "client-unrelated-turn" },
  });

  runtime.recordAuditEvent({
    eventType: "memory.tool.save_memory",
    runtimeSessionId: session.id,
    userId: 1,
    payload: { runId: run.id, saved: true },
  });
  runtime.recordAuditEvent({
    eventType: "memory.tool.save_memory",
    runtimeSessionId: session.id,
    userId: 1,
    payload: { runId: unrelated.id, saved: false },
  });
  db.prepare(
    `INSERT INTO hermes_audit_events
       (event_type, runtime_session_id, user_id, payload)
     VALUES ('memory.tool.save_memory', ?, 1, 'not-json')`,
  ).run(session.id);

  const saves = memoryEvidence.listSuccessfulMemorySavesForRun(
    session.id,
    run.id,
  );
  assert.equal(saves.length, 1);
  assert.equal(saves[0].runId, run.id);
  assert.deepEqual(
    [...memoryEvidence.memoryUpdatedClientMessageIdsForSession(session.id)],
    ["client-memory-turn"],
  );
  assert.equal(otherRun?.id, run.id);
});

test("live and restored transcripts both consume authoritative memory evidence", () => {
  const eventStream = fs.readFileSync(
    new URL("../src/lib/hermes/event-stream.ts", import.meta.url),
    "utf8",
  );
  const sessionsRoute = fs.readFileSync(
    new URL(
      "../src/app/api/hermes/sessions/route.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const agentSession = fs.readFileSync(
    new URL(
      "../src/app/components/hermes/use-agent-session.ts",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(eventStream, /reconcileSuccessfulMemorySaves/);
  assert.match(eventStream, /toolCallId: `memory-audit-\$\{save\.auditEventId\}`/);
  // Same extraction: the restored transcript consumes memory evidence inside
  // session-presentation.ts now. The live path is exercised above against the
  // real store; this keeps the restored path wired to the same lookup.
  const sessionPresentation = fs.readFileSync(
    new URL("../src/lib/hermes/session-presentation.ts", import.meta.url),
    "utf8",
  );
  assert.match(sessionsRoute, /from "@\/lib\/hermes\/session-presentation\.ts"/);
  assert.match(
    sessionPresentation,
    /memoryUpdatedClientMessageIdsForSession\(runtime\.id\)/,
  );
  assert.match(agentSession, /normalized\.memoryUpdated = true/);
});
