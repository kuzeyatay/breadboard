import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  parseConversationBranchHistory,
  projectConversationBranchMessages,
  runtimeMessagesForBranch,
  selectConversationBranchHistory,
} from "../src/lib/conversations/branch-history.ts";

function row(id, clientMessageId, role, content, orderIndex, metadata = null) {
  return {
    id,
    conversation_id: 1,
    client_message_id: clientMessageId,
    role,
    surface: "dashboard_terminal",
    content,
    status: "complete",
    order_index: orderIndex,
    metadata,
    sources: null,
    token_usage: null,
    error: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:01.000Z",
  };
}

test("session restoration replaces regenerated siblings instead of displaying every retry", () => {
  const branchMetadata = JSON.stringify({ branchGroupId: "turn-2" });
  const attempts = [
    row(1, "turn-1", "user", "First question", 0),
    row(2, "turn-1", "assistant", "First answer", 1),
    row(3, "turn-2", "user", "Visualize this", 2),
    row(4, "turn-2", "assistant", "Interrupted", 3),
    row(5, "turn-2-retry-1", "user", "Visualize this", 4, branchMetadata),
    row(6, "turn-2-retry-1", "assistant", "Interrupted", 5, branchMetadata),
    row(7, "turn-2-retry-2", "user", "Visualize this", 6, branchMetadata),
    row(8, "turn-2-retry-2", "assistant", "Interrupted", 7, branchMetadata),
    row(9, "turn-2-retry-3", "user", "Visualize this", 8, branchMetadata),
    row(10, "turn-2-retry-3", "assistant", "Latest answer", 9, branchMetadata),
  ];

  assert.deepEqual(
    projectConversationBranchMessages(attempts).map((message) => message.id),
    [1, 2, 9, 10],
  );
});

test("messages sent after a regenerated branch remain on its active path", () => {
  const branchMetadata = JSON.stringify({ branchGroupId: "turn-2" });
  const attempts = [
    row(1, "turn-1", "user", "First question", 0),
    row(2, "turn-1", "assistant", "First answer", 1),
    row(3, "turn-2", "user", "Original prompt", 2),
    row(4, "turn-2", "assistant", "Original answer", 3),
    row(5, "turn-3", "user", "Old follow-up", 4),
    row(6, "turn-3", "assistant", "Old follow-up answer", 5),
    row(7, "turn-2-retry", "user", "Edited prompt", 6, branchMetadata),
    row(8, "turn-2-retry", "assistant", "Regenerated answer", 7, branchMetadata),
    row(9, "turn-4", "user", "New follow-up", 8),
    row(10, "turn-4", "assistant", "New follow-up answer", 9),
  ];

  assert.deepEqual(
    projectConversationBranchMessages(attempts).map((message) => message.id),
    [1, 2, 7, 8, 9, 10],
  );
});

test("the sessions endpoint restores only the projected active branch", () => {
  const sessionsRoute = readFileSync(
    new URL(
      "../src/app/api/hermes/sessions/route.ts",
      import.meta.url,
    ),
    "utf8",
  );

  // Presentation was extracted from the route into session-presentation.ts,
  // which the route imports. What has to stay true is that the transcript a
  // session hands back is branch-projected somewhere on that path -- the
  // projection itself is exercised behaviourally above -- so this asserts the
  // wiring at the module that now holds it rather than at the old location.
  const sessionPresentation = readFileSync(
    new URL("../src/lib/hermes/session-presentation.ts", import.meta.url),
    "utf8",
  );
  assert.match(sessionsRoute, /from "@\/lib\/hermes\/session-presentation\.ts"/);
  assert.match(
    sessionPresentation,
    /projectConversationBranchMessages\(\s*listConversationMessages\(conversation\.id\),?\s*\)\.map/,
  );
});

const canonical = [
  row(1, "turn-1", "user", "First question", 0),
  row(2, "turn-1", "assistant", "First answer", 1),
  row(3, "turn-2", "user", "Prompt being regenerated", 2),
  row(4, "turn-2", "assistant", "Stale MCP failure", 3),
  row(5, "turn-2-branch", "user", "Prompt being regenerated", 4),
  row(6, "turn-2-branch", "assistant", "New branch answer", 5),
];

test("branch history resolves canonical content only along the selected prefix", () => {
  const references = parseConversationBranchHistory([
    {
      role: "user",
      clientMessageId: "turn-1",
      content: "browser content is deliberately ignored",
    },
    { role: "assistant", messageId: "msg_2" },
  ]);
  assert.ok(references);

  const selected = selectConversationBranchHistory(canonical, references);
  assert.deepEqual(
    runtimeMessagesForBranch(selected),
    [
      { role: "user", content: "First question" },
      { role: "assistant", content: "First answer" },
    ],
  );
  assert.doesNotMatch(
    runtimeMessagesForBranch(selected).map((message) => message.content).join("\n"),
    /Stale MCP failure|New branch answer/,
  );
});

test("stale or reordered branch references fail instead of leaking linear history", () => {
  assert.throws(
    () =>
      selectConversationBranchHistory(canonical, [
        { role: "assistant", clientMessageId: "turn-1" },
        { role: "user", clientMessageId: "turn-1" },
      ]),
    (error) => error?.code === "branch_history_stale",
  );
});

test("the client prepares a clean runtime before opening the regenerated stream", () => {
  const sessionHook = readFileSync(
    new URL(
      "../src/app/components/hermes/use-agent-session.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const branchEndpoint = sessionHook.indexOf("/branch-runtime");
  const eventStream = sessionHook.indexOf(
    "const streamPromise = streamEvents(",
    branchEndpoint,
  );
  assert.ok(branchEndpoint >= 0);
  assert.ok(eventStream > branchEndpoint);
  assert.match(sessionHook, /branchHistory,\s+branchContextId,/);
});

test("selecting an older visible branch also prepares its history for the next follow-up", () => {
  const sessionHook = readFileSync(
    new URL(
      "../src/app/components/hermes/use-agent-session.ts",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(
    sessionHook,
    /options\?\.historyOverride \?\? pendingHistoryOverrideRef\.current/,
  );
  assert.match(
    sessionHook,
    /pendingHistoryOverrideRef\.current = nextMessages;\s+setMessages\(nextMessages\)/,
  );
  assert.match(sessionHook, /setMessages: setMessagesExternal/);
});
