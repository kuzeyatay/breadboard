import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const dataRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "breadboard-terminal-evidence-"),
);
process.env.BREADBOARD_DATA_DIR = dataRoot;

const { default: db } = await import("../src/lib/db.ts");
const conversations = await import("../src/lib/conversations/store.ts");
const runtime = await import("../src/lib/hermes/runtime-store.ts");
const runs = await import("../src/lib/hermes/run-store.ts");
const terminalEvidence = await import(
  "../src/lib/hermes/terminal-evidence.ts"
);

after(() => {
  db.close();
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

function session() {
  const conversation = conversations.createConversation({
    userId: 1,
    surface: "dashboard_terminal",
  });
  return runtime.createRuntimeSession({
    conversationId: conversation.id,
    surface: "dashboard_terminal",
    userId: 1,
    chatSessionId: null,
    agentName: "breadboard",
    clusterId: null,
    gardenId: null,
    pageSlug: null,
    workspaceKey: `terminal-evidence-${conversation.id}`,
    activeDirectory: dataRoot,
    filesystemMode: "restricted",
  });
}

test("the server's own record of a finished command is this turn's tool evidence", () => {
  db.prepare(
    "INSERT INTO users(id, username, email, password_hash) VALUES (1, 'alice', 'alice@example.test', 'x')",
  ).run();
  const runtimeSession = session();
  const run = runs.beginRuntimeRun({
    runtimeSessionId: runtimeSession.id,
    instruction: "how much space is FRC taking",
    dispatch: { clientMessageId: "client-terminal-turn" },
  });
  runs.finishActiveRuntimeRun(runtimeSession.id, "completed");
  const laterRun = runs.beginRuntimeRun({
    runtimeSessionId: runtimeSession.id,
    instruction: "a later turn",
    dispatch: { clientMessageId: "client-later-turn" },
  });

  const audit = (payload) =>
    runtime.recordAuditEvent({
      eventType: "terminal.command_completed",
      runtimeSessionId: runtimeSession.id,
      userId: 1,
      payload,
    });
  audit({ runId: run.id, category: "approved", commandFamily: "Get-ChildItem", exitCode: 0, timedOut: false });
  audit({ runId: run.id, category: "approved", commandFamily: "rg", exitCode: 1, timedOut: false });
  audit({ runId: run.id, category: "approved", commandFamily: "ls", exitCode: 0, timedOut: true });
  audit({ runId: laterRun.id, category: "inspect", exitCode: 0, timedOut: false });
  // A still-running slice is not a completion, and neither is a malformed row.
  runtime.recordAuditEvent({
    eventType: "terminal.command_running",
    runtimeSessionId: runtimeSession.id,
    userId: 1,
    payload: { runId: run.id, category: "approved", exitCode: null },
  });
  db.prepare(
    `INSERT INTO hermes_audit_events
       (event_type, runtime_session_id, user_id, payload)
     VALUES ('terminal.command_completed', ?, 1, 'not-json')`,
  ).run(runtimeSession.id);

  const commands = terminalEvidence.listCompletedTerminalCommandsForRun(
    runtimeSession.id,
    run.id,
  );
  assert.deepEqual(
    commands.map((command) => [command.commandFamily, command.success]),
    [["Get-ChildItem", true], ["rg", false], ["ls", false]],
  );
  assert.ok(commands.every((command) => command.runId === run.id));
});

test("the turn's evidence does not depend on the runtime echoing a tool event", () => {
  const eventStream = fs.readFileSync(
    new URL("../src/lib/hermes/event-stream.ts", import.meta.url),
    "utf8",
  );
  const terminalRoute = fs.readFileSync(
    new URL(
      "../src/app/api/hermes/tools/terminal/route.ts",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(eventStream, /reconcileCompletedTerminalCommands/);
  assert.match(
    eventStream,
    /toolCallId: `terminal-audit-\$\{command\.auditEventId\}`/,
  );
  // Reconciliation only adds what the stream did not already report.
  assert.match(eventStream, /commands\.slice\(observed\)/);
  assert.match(terminalRoute, /commandFamily: command\.split/);
});
