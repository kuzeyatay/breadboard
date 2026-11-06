import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-runtime-registration-"));
process.env.BREADBOARD_DATA_DIR = root;
const { default: db } = await import("../src/lib/db.ts");
const { createConversation } = await import("../src/lib/conversations/store.ts");
const { registerConversationRuntime } = await import("../src/lib/hermes/runtime-store.ts");
db.prepare("INSERT INTO users(id,username,email,password_hash) VALUES (1,'registration','registration@example.test','x')").run();
const conversation = createConversation({ userId: 1, title: "Concurrent first turn" });
const input = {
  conversationId: conversation.id, surface: conversation.surface, userId: 1,
  chatSessionId: null, agentName: "breadboard-assistant", clusterId: null,
  gardenId: null, pageSlug: null, workspaceKey: "winner", activeDirectory: root,
  filesystemMode: "restricted", externalSessionId: "winner-session",
};
after(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test("two completed startup requests keep one durable identity without replacing its workspace", () => {
  const first = registerConversationRuntime(input);
  const second = registerConversationRuntime({ ...input, workspaceKey: "loser", externalSessionId: "loser-session" });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.row.id, first.row.id);
  assert.equal(second.row.external_session_id, "winner-session");
  assert.equal(second.row.workspace_key, "winner");
  assert.equal(db.prepare("SELECT count(*) AS n FROM hermes_runtime_sessions WHERE conversation_id=?").get(conversation.id).n, 1);
});

test("inline questions remain isolated while duplicate registrations share their own identity", () => {
  const inline = { ...input, externalSessionId: "inline-session", runtimeMetadata: { inlineTurnId: "highlight-one" } };
  const first = registerConversationRuntime(inline);
  const second = registerConversationRuntime({ ...inline, externalSessionId: "unused-session" });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.row.id, first.row.id);
  assert.equal(second.row.external_session_id, "inline-session");
  assert.notEqual(first.row.id, registerConversationRuntime(input).row.id);
});

test("a collision cannot return another user's session", () => {
  assert.throws(() => registerConversationRuntime({ ...input, userId: 2 }), /ownership mismatch/);
});
