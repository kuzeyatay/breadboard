import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const sessionRoute = fs.readFileSync(
  new URL("../src/app/api/hermes/sessions/route.ts", import.meta.url),
  "utf8",
);
const sessionHook = fs.readFileSync(
  new URL("../src/app/components/hermes/use-agent-session.ts", import.meta.url),
  "utf8",
);
const terminal = fs.readFileSync(
  new URL("../src/app/components/hermes/dashboard-agent-terminal.tsx", import.meta.url),
  "utf8",
);

test("session creation durably reserves an optional first turn before runtime setup", () => {
  assert.match(sessionRoute, /parseInitialTurn\(body\.initialTurn/);
  assert.match(sessionRoute, /createConversationWithInitialTurn\(/);
  assert.doesNotMatch(
    sessionRoute,
    /resolveConversationRuntime/,
    "creating a durable conversation must not cold-start the agent runtime",
  );
  assert.match(sessionRoute, /activeDirectory: null/);
  assert.match(sessionRoute, /initialTurnReserved: initialTurn !== null/);
});

test("a newly reserved turn is claimed through the ordinary send endpoints", () => {
  assert.match(sessionHook, /body: JSON\.stringify\(\{ surface, \.\.\.options, initialTurn \}\)/);
  assert.equal(
    (sessionHook.match(/Boolean\(resumedBlockedTurn\) \|\| ensured\.initialTurnReserved/g) ?? [])
      .length,
    2,
    "agent and direct-provider sends must both retry the recoverable placeholder",
  );
  assert.match(sessionHook, /if \(ensured\.initialTurnReserved\) \{\s*markTurnPersisted/);
  assert.match(sessionHook, /if \(dispatched\.ok\) markTurnPersisted/);
});

test("the Terminal keeps submitted text as a draft until persistence is acknowledged", () => {
  assert.match(terminal, /const \[submittedDraft, setSubmittedDraft\] = useState/);
  assert.match(terminal, /value: input \|\| submittedDraft \|\| ""/);
  assert.ok(
    terminal.indexOf("setSubmittedDraft(displayText)") <
      terminal.indexOf('setInput("")', terminal.indexOf("setSubmittedDraft(displayText)")),
    "the retained draft must be set before the visible composer is cleared",
  );
  assert.match(terminal, /onTurnPersisted: \(persistedSessionId\) =>/);
  assert.match(
    terminal,
    /chatDraftKey\("dashboard_terminal", persistedSessionId\)/,
  );
  assert.match(
    terminal,
    /submittedDraftSequence\.current === draftSubmission/,
    "an acknowledgement from an older chat must not clear a newer same-text submission",
  );
  assert.match(
    terminal,
    /if \(sessionId !== session\.sessionId\)[\s\S]*?setSubmittedDraft\(null\)/,
    "switching chats must release the outgoing draft shadow so it can be restored by key",
  );
});
