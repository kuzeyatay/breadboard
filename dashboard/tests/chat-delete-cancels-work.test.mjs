import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Deleting a chat destroys the only record of what that chat had running: the
// transcript row holding an agent's run id, and the runtime session holding the
// turn and the terminal child process. Whatever is not stopped before the
// delete keeps running with nothing able to reach it, so these tests pin that
// every run kind has a stop, that the stop it names really exists, and that
// both delete paths call them before they remove anything.

const libDir = path.join(import.meta.dirname, "../src/lib");
const read = (relative) =>
  fs.readFileSync(path.join(import.meta.dirname, "..", relative), "utf8");

const cancelSource = read("src/lib/conversations/external-agent-cancel.ts");
const runKindsSource = read("src/lib/conversations/external-agent-runs.ts");
const canonicalDelete = read("src/app/api/hermes/sessions/[sessionId]/route.ts");
const gardenDelete = read("src/app/api/chat-sessions/[sessionId]/route.ts");
const sessionCancel = read("src/lib/hermes/session-cancel.ts");

/** The declared run kinds, read from the list every agent registers in. */
function runKinds() {
  const block = runKindsSource.match(
    /export const EXTERNAL_AGENT_RUN_KINDS = \[([\s\S]*?)\] as const;/,
  );
  assert.ok(block, "EXTERNAL_AGENT_RUN_KINDS must be a readable literal");
  return [...block[1].matchAll(/"([a-z_]+)"/g)].map((match) => match[1]);
}

/** kind -> {module, fn}, read from the dynamic imports in the abort table. */
function abortTable() {
  const block = cancelSource.match(
    /const EXTERNAL_AGENT_ABORT_BY_KIND = \{([\s\S]*?)\n\} as const satisfies/,
  );
  assert.ok(block, "EXTERNAL_AGENT_ABORT_BY_KIND must be a readable literal");
  const entries = [
    ...block[1].matchAll(
      /(\w+): async \(userId, runId\) =>\s*\(await import\("\.\.\/([^"]+)"\)\)\.(\w+)\(userId, runId\)/g,
    ),
  ];
  return new Map(entries.map((m) => [m[1], { module: m[2], fn: m[3] }]));
}

test("every external agent run kind knows how it is stopped", () => {
  const kinds = runKinds();
  const table = abortTable();
  assert.ok(kinds.length >= 30, `expected the full agent roster, saw ${kinds.length}`);
  for (const kind of kinds) {
    assert.ok(table.has(kind), `${kind} has no entry in EXTERNAL_AGENT_ABORT_BY_KIND`);
  }
  // And nothing stale: a removed agent must not leave a stop behind.
  for (const kind of table.keys()) {
    assert.ok(kinds.includes(kind), `${kind} is not a declared run kind`);
  }
});

test("every stop names a function that actually exists", () => {
  for (const [kind, target] of abortTable()) {
    const file = path.join(libDir, target.module);
    assert.ok(fs.existsSync(file), `${kind}: ${target.module} is missing`);
    assert.match(
      fs.readFileSync(file, "utf8"),
      new RegExp(`export (async )?function ${target.fn}\\b`),
      `${kind}: ${target.module} does not export ${target.fn}`,
    );
  }
});

test("the running-run query reads the marker the history list already trusts", () => {
  // Same predicate as summarizeConversationMessages, which is what shows a chat
  // as busy — so what gets stopped is exactly what the person can see running.
  assert.match(cancelSource, /role = 'assistant'/);
  assert.match(cancelSource, /json_extract\(metadata, '\$\.externalAgentOutcome'\) = 'running'/);
  // A run its manager already retired is not an error on a delete path.
  assert.match(cancelSource, /} catch \{\s*return false;/);
});

test("both delete paths stop the chat's work before removing its rows", () => {
  for (const [label, source, deleteStatement] of [
    ["canonical", canonicalDelete, "db.transaction"],
    ["garden", gardenDelete, "DELETE FROM chat_sessions"],
  ]) {
    assert.match(source, /cancelRunningExternalAgentRuns\(/, label);
    assert.match(source, /cancelRuntimeSessionWork\(/, label);
    const removal = source.indexOf(deleteStatement, source.indexOf("export async function DELETE"));
    assert.ok(removal > 0, `${label}: no delete statement found`);
    for (const cancel of ["cancelRunningExternalAgentRuns(", "cancelRuntimeSessionWork("]) {
      assert.ok(
        source.indexOf(cancel) < removal,
        `${label}: ${cancel} must run before ${deleteStatement}`,
      );
    }
  }
});

test("cancelling a runtime session kills the local children even when the runtime is unreachable", () => {
  // The turn lives in the runtime, but the terminal command is a real child
  // process group of ours and the visualizer is our AbortController. A runtime
  // that has dropped the session must not stop us from killing either.
  assert.match(sessionCancel, /Promise\.allSettled/);
  assert.match(sessionCancel, /cancelAuthorizedTerminalCommand\(runtimeSessionId\)/);
  assert.match(sessionCancel, /cancelInteractiveVisualizerWork\(runtimeSessionId\)/);
  // A session that was never initialized cannot be addressed, and must not
  // throw the delete off its feet.
  assert.match(sessionCancel, /session = authorizeRuntimeSession\(userId, row\.id\);/);
  assert.match(sessionCancel, /\} catch \{[\s\S]{0,200}session = null;/);
  assert.match(sessionCancel, /finishRuntimeRun\(activeRun\.id, "cancelled"\)/);
  assert.match(sessionCancel, /revokeCapabilityDecision\(row\.id, "cancelled"\)/);
});

test("the abort button and the delete share one stop", () => {
  const abortRoute = read("src/app/api/hermes/sessions/[sessionId]/abort/route.ts");
  assert.match(abortRoute, /stopRuntimeSessionWork\(session\.row\.id, session\)/);
  assert.match(sessionCancel, /export async function stopRuntimeSessionWork/);
  assert.match(sessionCancel, /export async function cancelRuntimeSessionWork/);
});
