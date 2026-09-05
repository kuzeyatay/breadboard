import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, beforeEach } from "node:test";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-chat-reference-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;
process.env.BREADBOARD_MEM0 = "off";

const { default: db } = await import("../src/lib/db.ts");
const store = await import("../src/lib/conversations/store.ts");
const memory = await import("../src/lib/conversations/memory.ts");
const reference = await import("../src/lib/conversations/chat-reference.ts");
const combinations = await import("../src/lib/hermes/capability-combinations.ts");
const commands = await import("../src/lib/hermes/commands.ts");

after(() => {
  db.close();
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

beforeEach(() => {
  db.exec(`
    DELETE FROM durable_memories;
    DELETE FROM conversations;
    DELETE FROM users;
    DELETE FROM sqlite_sequence;
  `);
  db.prepare(
    "INSERT INTO users(id, username, email, password_hash) VALUES (1, 'alice', 'alice@example.test', 'x')",
  ).run();
  db.prepare(
    "INSERT INTO users(id, username, email, password_hash) VALUES (2, 'bob', 'bob@example.test', 'x')",
  ).run();
});

function addTurn(conversation, clientMessageId, question, answer) {
  store.reserveConversationTurn({
    conversation,
    clientMessageId,
    surface: conversation.surface,
    content: question,
  });
  store.completeAssistantMessage({
    conversationId: conversation.id,
    clientMessageId,
    content: answer,
  });
}

test("reference selectors are readable, stable, and removed from the request", () => {
  const key = reference.chatReferenceKey({
    title: "Résumé: Project Alpha",
    publicId: "conv_AbC_123",
  });
  assert.equal(key, "resume-project-alpha.conv_abc_123");
  assert.equal(reference.chatReferencePublicId(key), "conv_abc_123");

  const parsed = reference.parseChatReferenceCommand(
    `/reference:${key} /agents:codex Compare the decisions`,
  );
  assert.deepEqual(parsed.keys, [key]);
  assert.equal(parsed.userText, "/agents:codex Compare the decisions");
});

test("the capability broker treats Reference as context rather than a stacked skill", () => {
  const parsed = combinations.leadingCapabilityTokens(
    "/reference:project-alpha.conv_abc /agents:codex update it",
  );
  assert.equal(parsed.tokens[0].kind, "context");
  assert.equal(parsed.tokens[1].kind, "runtime_agent");
});

test("command resolution consumes Reference without treating it as unavailable", async () => {
  const resolved = await commands.resolveCommandMessage(
    null,
    "/reference:project-alpha.conv_abc Compare the decisions",
    undefined,
    { mode: "knowledge", surface: "dashboard_terminal" },
  );
  assert.equal(resolved.userText, "Compare the decisions");
  assert.deepEqual(resolved.invocations, []);
  const referenceOnly = await commands.resolveCommandMessage(
    null,
    "/reference:project-alpha.conv_abc",
    undefined,
    { mode: "knowledge", surface: "dashboard_terminal" },
  );
  assert.equal(referenceOnly.userText, "Summarize the referenced chat.");
});

test("an exact selector reads a saved transcript across surfaces", () => {
  const source = store.createConversation({
    userId: 1,
    title: "Project Alpha",
    surface: "quartz_ai",
  });
  addTurn(source, "alpha-turn-001", "The launch color is amber.", "Decision recorded.");
  const current = store.createConversation({
    userId: 1,
    title: "Current Garden chat",
    surface: "garden_chat",
  });
  const key = reference.chatReferenceKey({ title: source.title, publicId: source.public_id });

  const selected = memory.retrieveExplicitCrossConversationContext({
    userId: 1,
    currentConversationId: current.id,
    query: `/reference:${key} What color did we choose?`,
  });

  assert.equal(selected?.publicId, source.public_id);
  assert.match(selected.messages.map((message) => message.content).join("\n"), /amber/);
  assert.match(memory.composeExplicitCrossConversationContext(selected), /direct context/);
});

test("a stable selector survives a later chat rename", () => {
  const source = store.createConversation({ userId: 1, title: "Original name" });
  addTurn(source, "rename-turn-01", "Keep the oak desk.", "Done.");
  const key = reference.chatReferenceKey({ title: source.title, publicId: source.public_id });
  db.prepare("UPDATE conversations SET title = 'Renamed chat' WHERE id = ?").run(source.id);
  const current = store.createConversation({ userId: 1, title: "Current" });

  const selected = memory.retrieveExplicitCrossConversationContext({
    userId: 1,
    currentConversationId: current.id,
    query: `/reference:${key} Which desk?`,
  });
  assert.equal(selected?.conversationId, source.id);
  assert.equal(selected?.title, "Renamed chat");
});

test("a hand-typed chat-name resolves only when it is unambiguous", () => {
  const first = store.createConversation({ userId: 1, title: "Roadmap" });
  addTurn(first, "roadmap-turn-01", "Ship search first.", "Okay.");
  const current = store.createConversation({ userId: 1, title: "Current" });

  assert.equal(
    memory.retrieveExplicitCrossConversationContext({
      userId: 1,
      currentConversationId: current.id,
      query: "/reference:roadmap What ships first?",
    })?.conversationId,
    first.id,
  );

  const duplicate = store.createConversation({ userId: 1, title: "Roadmap" });
  addTurn(duplicate, "roadmap-turn-02", "Ship export first.", "Okay.");
  assert.equal(
    memory.retrieveExplicitCrossConversationContext({
      userId: 1,
      currentConversationId: current.id,
      query: "/reference:roadmap What ships first?",
    }),
    null,
  );
});

test("references never cross accounts or include temporary chats", () => {
  const foreign = store.createConversation({ userId: 2, title: "Foreign plan" });
  addTurn(foreign, "foreign-turn-01", "Secret foreign decision.", "Okay.");
  const temporary = store.createConversation({ userId: 1, title: "Private plan", temporary: true });
  addTurn(temporary, "private-turn-01", "Secret temporary decision.", "Okay.");
  const current = store.createConversation({ userId: 1, title: "Current" });

  for (const source of [foreign, temporary]) {
    const key = reference.chatReferenceKey({ title: source.title, publicId: source.public_id });
    assert.equal(memory.retrieveExplicitCrossConversationContext({
      userId: 1,
      currentConversationId: current.id,
      query: `/reference:${key} Read it`,
    }), null);
  }
});

test("the capability palette exposes the cross-surface Reference picker", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const hub = fs.readFileSync(
    path.join(root, "src/app/components/hermes/command-hub.tsx"),
    "utf8",
  );
  const panel = fs.readFileSync(
    path.join(root, "src/app/components/hermes/reference-chats-panel.tsx"),
    "utf8",
  );
  const reloadableError = fs.readFileSync(
    path.join(root, "src/app/components/reloadable-fetch-error.tsx"),
    "utf8",
  );
  const composer = fs.readFileSync(
    path.join(root, "src/app/components/assistant-composer.tsx"),
    "utf8",
  );
  const route = fs.readFileSync(
    path.join(root, "src/app/api/hermes/references/route.ts"),
    "utf8",
  );

  assert.match(hub, /id: "reference", label: "Reference"/);
  assert.match(hub, /<ReferenceChatsPanel/);
  assert.match(hub, /tab === "reference"[\s\S]*?<CapabilityIcon kind="mcp" \/>/);
  assert.match(panel, /Search chats from every surface/);
  assert.match(panel, /\/api\/hermes\/references/);
  assert.match(panel, /setReload\(\(current\) => current \+ 1\)/);
  assert.match(panel, /label="Reload chats"/);
  assert.match(reloadableError, /RefreshCw/);
  assert.match(reloadableError, /role="alert"/);
  assert.match(composer, /onSelectReference=\{\(token\) => insertCommandToken\(`\/\$\{token\}`\)\}/);
  assert.match(route, /WHERE user_id = \? AND temporary = 0 AND buzz_room_id IS NULL/);
  assert.match(route, /surfaceLabel/);
});
