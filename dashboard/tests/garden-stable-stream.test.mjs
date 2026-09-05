import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import { reserveLegacyGardenAssistantTurn } from "../src/lib/conversations/store.ts";
import { applyGardenStableTextEvent } from "../src/lib/hermes/garden-stable-stream.ts";
import { assistantVisibleContent } from "../src/lib/hermes/assistant-visible-content.ts";

test("public thinking updates stay out of the durable answer", () => {
  assert.equal(assistantVisibleContent(""), "");
  assert.equal(
    assistantVisibleContent("Here is the stable diagram."),
    "Here is the stable diagram.",
  );
});

test("two Hermes narration segments never become disappearing answer text", () => {
  let message = { role: "assistant", content: "", thinking: "" };
  message = applyGardenStableTextEvent(message, {
    type: "provisional",
    text: "I will inspect the runtime first.",
  });
  assert.equal(message.content, "");
  message = applyGardenStableTextEvent(message, {
    type: "provisional",
    text: "Now I will inspect the diagram tools.",
  });
  assert.equal(message.content, "");
  assert.match(message.thinking, /inspect the runtime/u);
  assert.match(message.thinking, /inspect the diagram tools/u);
  assert.deepEqual(message.progressNotes, [
    "I will inspect the runtime first.",
    "Now I will inspect the diagram tools.",
  ]);

  message = applyGardenStableTextEvent(message, {
    type: "replace",
    text: "Here is the stable diagram.",
  });
  assert.equal(message.content, "Here is the stable diagram.");
  assert.equal(message.progressNotes.length, 2);
});

test("legacy segment boundaries retain public progress without clearing answer text", () => {
  const message = applyGardenStableTextEvent(
    { role: "assistant", content: "Already stable" },
    { type: "segment", text: "I checked the calendar connection." },
  );
  assert.equal(message.content, "Already stable");
  assert.deepEqual(message.progressNotes, [
    "I checked the calendar connection.",
  ]);
});

test("legacy fallback deltas continue to stream normally", () => {
  const message = applyGardenStableTextEvent(
    { role: "assistant", content: "Hello" },
    { type: "delta", text: " world" },
  );
  assert.equal(message.content, "Hello world");
});

test("Garden recovery gets one idempotent canonical pending answer", () => {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE conversations (
      id INTEGER PRIMARY KEY,
      next_order_index INTEGER NOT NULL,
      updated_at TEXT
    );
    CREATE TABLE conversation_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      client_message_id TEXT NOT NULL,
      role TEXT NOT NULL,
      surface TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL,
      order_index INTEGER NOT NULL,
      metadata TEXT,
      sources TEXT,
      token_usage TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      sources TEXT,
      token_usage TEXT,
      tool_calls TEXT,
      runtime_status TEXT,
      runtime_error TEXT,
      order_index INTEGER NOT NULL,
      canonical_message_id INTEGER
    );
    CREATE TABLE chat_sessions (
      id INTEGER PRIMARY KEY,
      updated_at TEXT
    );
    INSERT INTO chat_sessions(id, updated_at) VALUES (803, datetime('now'));
    INSERT INTO conversations(id, next_order_index) VALUES (1, 1);
    INSERT INTO conversation_messages
      (id, conversation_id, client_message_id, role, surface, content, status, order_index)
    VALUES
      (10, 1, 'legacy-chat-803-2167', 'user', 'garden_chat',
       'draw a diagram', 'complete', 0);
    INSERT INTO chat_messages
      (session_id, role, content, order_index, canonical_message_id)
    VALUES (803, 'user', 'draw a diagram', 0, 10);
  `);
  const input = {
    conversation: { id: 1, legacy_chat_session_id: 803 },
    chatSessionId: 803,
    content: "draw a diagram",
  };
  const first = reserveLegacyGardenAssistantTurn(input, database);
  const second = reserveLegacyGardenAssistantTurn(input, database);
  assert.equal(first.clientMessageId, "legacy-chat-803-2167");
  assert.equal(first.assistantMessage.status, "pending");
  assert.equal(second.assistantMessage.id, first.assistantMessage.id);
  assert.equal(
    database.prepare(
      "SELECT count(*) AS count FROM conversation_messages WHERE role = 'assistant'",
    ).get().count,
    1,
  );
  assert.equal(
    database.prepare("SELECT next_order_index FROM conversations WHERE id = 1").get()
      .next_order_index,
    2,
  );
  database.close();
});

test("both Garden surfaces use the stable text projection", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const adapter = fs.readFileSync(
    path.join(root, "src/lib/hermes/garden-chat-adapter.ts"),
    "utf8",
  );
  const workspace = fs.readFileSync(
    path.join(root, "src/app/gardens/[clusterSlug]/workspace-client.tsx"),
    "utf8",
  );
  const assistant = fs.readFileSync(
    path.join(root, "src/app/garden/garden-assistant.tsx"),
    "utf8",
  );

  assert.doesNotMatch(adapter, /emit\(\{ type: "delta", text: event\.payload\.text \}\)/u);
  assert.match(adapter, /type: "provisional"/u);
  assert.match(adapter, /emit\(\{ type: "replace", text: assistantText \}\)/u);
  assert.match(adapter, /clientMessageId: reservedClientMessageId/u);
  assert.match(adapter, /preDispatchHeartbeat/u);
  assert.match(
    adapter,
    /setInterval\([\s\S]*touchRuntimeRunHeartbeat\(runId\)[\s\S]*RUN_HEARTBEAT_INTERVAL_MS/u,
  );
  assert.match(adapter, /clearInterval\(heartbeat\)/u);
  assert.match(workspace, /applyGardenStableTextEvent/u);
  assert.match(assistant, /applyGardenStableTextEvent/u);
  assert.match(workspace, /assistantVisibleContent/u);
  assert.match(assistant, /assistantVisibleContent/u);
  assert.match(workspace, /progressNotes=\{msg\.progressNotes\}/u);
  assert.match(assistant, /progressNotes=\{message\.progressNotes\}/u);
});
