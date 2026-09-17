import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, beforeEach } from "node:test";
import Database from "better-sqlite3";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-conversations-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;

const { default: db } = await import("../src/lib/db.ts");
const schema = await import("../src/lib/conversations/schema.ts");
const store = await import("../src/lib/conversations/store.ts");
const memory = await import("../src/lib/conversations/memory.ts");
const runtime = await import("../src/lib/hermes/runtime-store.ts");
const capability = await import("../src/lib/hermes/capability-token.ts");
const gardenTools = await import("../src/lib/hermes/garden-tools.ts");
const toolScopes = await import("../src/lib/hermes/tool-scopes.ts");
const messaging = await import("../src/lib/hermes/messaging-service.ts");
const { getTelegramStore } = await import("../src/lib/telegram/instance.ts");
const { getWhatsAppStore } = await import("../src/lib/whatsapp/instance.ts");

after(() => {
  db.close();
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

beforeEach(() => {
  db.exec(`
    DELETE FROM hermes_runtime_sessions;
    DELETE FROM durable_memories;
    DELETE FROM conversations;
    DELETE FROM clusters;
    DELETE FROM users;
    DELETE FROM sqlite_sequence;
  `);
  db.prepare("INSERT INTO users(id, username, email, password_hash) VALUES (1, 'alice', 'alice@example.test', 'x')").run();
  db.prepare("INSERT INTO users(id, username, email, password_hash) VALUES (2, 'bob', 'bob@example.test', 'x')").run();
  db.prepare("INSERT INTO clusters(id, user_id, name, slug, visibility, chat_accessible) VALUES (10, 1, 'Aurora Garden', 'aurora', 'private', 0)").run();
});

function conversation(userId = 1, title = "New chat") {
  return store.createConversation({ userId, title });
}

test("new legacy Garden chats receive a canonical conversation immediately", () => {
  const result = db.prepare(
    "INSERT INTO chat_sessions(cluster_id, user_id, title) VALUES (10, 1, 'Garden question')",
  ).run();
  const chatSessionId = Number(result.lastInsertRowid);
  const first = store.ensureConversationForLegacyChatSession(chatSessionId, 1);
  const second = store.ensureConversationForLegacyChatSession(chatSessionId, 1);
  const linked = db.prepare(
    "SELECT conversation_id FROM chat_sessions WHERE id = ?",
  ).get(chatSessionId);

  assert.equal(first.id, second.id, "the binding must be idempotent");
  assert.equal(first.surface, "garden_chat");
  assert.equal(first.scope_kind, "garden");
  assert.equal(first.default_garden_id, 10);
  assert.equal(first.legacy_chat_session_id, chatSessionId);
  assert.equal(linked.conversation_id, first.id);
  assert.ok(memory.loadConversationMemoryState(first.id));
});

test("active Agency Agent selection is isolated per conversation and can be cleared", () => {
  const first = conversation(1, "First");
  const second = conversation(1, "Second");
  const selected = store.updateConversation(first, {
    activeAgencyAgentSlug: "frontend-developer",
  });
  assert.equal(selected.active_agency_agent_slug, "frontend-developer");
  assert.equal(store.getConversationById(second.id).active_agency_agent_slug, null);
  const presented = store.presentConversation(selected);
  assert.equal(presented.activeAgencyAgentSlug, "frontend-developer");
  assert.equal(
    store.updateConversation(selected, { activeAgencyAgentSlug: null })
      .active_agency_agent_slug,
    null,
  );
});

function finishTurn(conversationRow, clientMessageId, surface, userText, assistantText = "Done") {
  const reserved = store.reserveConversationTurn({
    conversation: conversationRow,
    clientMessageId,
    surface,
    content: userText,
  });
  store.completeAssistantMessage({
    conversationId: conversationRow.id,
    clientMessageId,
    content: assistantText,
  });
  return reserved;
}

test("compacting Ask here turns preserves the main conversation goal", () => {
  const chat = conversation();
  const goal = "Review the whole architecture, including storage and authentication.";
  finishTurn(chat, "main-goal", "dashboard_terminal", goal);
  for (let index = 0; index < 24; index += 1) {
    const clientMessageId = `inline-aside-${index}`;
    store.reserveConversationTurn({
      conversation: chat, clientMessageId, surface: "dashboard_terminal", content: "Why cache this?",
      metadata: { textSelection: {
        id: `inline:${index}`, mode: "inline", sourceMessageId: "msg_2", start: 0, end: 7, quote: "caching",
      } },
    });
    store.completeAssistantMessage({ conversationId: chat.id, clientMessageId, content: "A local caching explanation." });
  }
  memory.compactConversationMemoryIfNeeded(chat.id);
  assert.equal(memory.loadConversationMemoryState(chat.id).workingState.currentGoal, goal);
});

const notesWithVisualDescriptions = "what i was trying to do was to write an intuitive and detailed and no maths introduction to electromagnetic fields and the general misconceptions about the topic and explain electricity, in the attahced pdf are three pages of my notes which, based on this chat, you must write the rest, if a visual is needed , add that to the text you are writing, inside partantheses indicating what the visual should be";

test("a task's formatting request survives compaction as scoped history, not a decision", () => {
  const chat = conversation(1, "Question about shared meaning");
  const first = finishTurn(chat, "notes-request", "garden_chat", notesWithVisualDescriptions,
    "The introduction. (Visual: Draw the circuit.)");
  finishTurn(chat, "example-choice", "garden_chat", "We decided to use the copper wire example.");
  finishTurn(chat, "one-off-preference", "garden_chat", "I prefer a table for this comparison.");
  finishTurn(chat, "standing-preference", "garden_chat", "For future explanations, always include visual descriptions in parentheses.");
  for (let index = 0; index < 18; index += 1) {
    finishTurn(chat, `followup-${index}`, "garden_chat", "Explain how electric current works.");
  }
  memory.compactConversationMemoryIfNeeded(chat.id);
  const saved = memory.loadConversationMemoryState(chat.id);
  assert.deepEqual(saved.workingState.decisions, ["We decided to use the copper wire example."]);
  assert.deepEqual(saved.workingState.temporaryPreferences, []);
  const historical = saved.workingState.historicalInstructions;
  const visual = historical.find((entry) => entry.sourceMessageId === first.userMessage.id);
  assert.equal(visual.content, notesWithVisualDescriptions);
  assert.equal(visual.sourceOrder, first.userMessage.order_index);
  assert.equal(visual.truncated, false, "the scope at the end must survive the old 320-character cutoff");
  assert.ok(historical.some((entry) => entry.content === "I prefer a table for this comparison."));
  assert.ok(historical.some((entry) => entry.content === "For future explanations, always include visual descriptions in parentheses."),
    "explicit future scope must survive so the model can honor it");
  assert.doesNotMatch(saved.summary, /^Current goal:/m, "a compacted old task is not the active task");
  const bundle = memory.loadConversationMemoryBundle({ conversation: chat, query: "Explain the transient in detail." });
  const prompt = memory.composeMemoryContext(bundle);
  assert.match(prompt, /# instruction_scope/);
  assert.match(prompt, /continues or revises the same deliverable/);
  assert.match(prompt, /only when the user's wording establishes that scope/);
  assert.equal(db.prepare("SELECT content FROM conversation_messages WHERE id = ?").get(first.userMessage.id).content,
    notesWithVisualDescriptions, "the exact transcript stays intact");
});

test("existing keyword decisions are upgraded with their original source before the next prompt", () => {
  const chat = conversation();
  const turn = finishTurn(chat, "old-notes", "garden_chat", notesWithVisualDescriptions);
  const initial = memory.loadConversationMemoryState(chat.id);
  const oldState = { ...initial.workingState, currentGoal: "Continue my introduction",
    decisions: [notesWithVisualDescriptions.slice(0, 320)], temporaryPreferences: ["I prefer a table for this answer."] };
  delete oldState.instructionScopeVersion;
  db.prepare(`UPDATE conversation_memory_state
    SET working_state = ?, rolling_summary = ?, summarized_through_order = ?, version = 9
    WHERE conversation_id = ?`).run(JSON.stringify(oldState), "Decisions:\n- " + notesWithVisualDescriptions.slice(0, 320),
      turn.assistantMessage.order_index, chat.id);
  const migrated = memory.loadConversationMemoryState(chat.id);
  assert.deepEqual(migrated.workingState.decisions, []);
  assert.deepEqual(migrated.workingState.temporaryPreferences, []);
  assert.equal(migrated.workingState.instructionScopeVersion, 1);
  assert.equal(migrated.version, 10);
  assert.equal(migrated.workingState.historicalInstructions[0].content, notesWithVisualDescriptions);
  assert.equal(migrated.workingState.historicalInstructions[0].sourceMessageId, turn.userMessage.id);
  assert.equal(migrated.workingState.historicalInstructions[1].sourceMessageId, null);
  assert.equal(migrated.workingState.historicalInstructions[1].truncated, true);
  assert.doesNotMatch(migrated.summary, /^Decisions:/m);
  assert.deepEqual(memory.loadConversationMemoryState(chat.id), migrated, "migration is idempotent");
});

test("cleared memory stays cleared and exact history still carries the scoping policy", () => {
  const chat = conversation();
  finishTurn(chat, "old-request", "garden_chat", notesWithVisualDescriptions);
  memory.loadConversationMemoryState(chat.id);
  db.prepare(`UPDATE conversation_memory_state SET rolling_summary = '', working_state = '{}',
    summarized_through_order = -1, version = 7 WHERE conversation_id = ?`).run(chat.id);
  const cleared = memory.loadConversationMemoryState(chat.id);
  assert.equal(cleared.summary, "");
  assert.equal(cleared.version, 7);
  assert.deepEqual(cleared.workingState.historicalInstructions, []);
  const prompt = memory.composeMemoryContext(memory.loadConversationMemoryBundle({ conversation: chat, query: "Why?" }),
    { includeConversationState: false });
  assert.match(prompt, /# instruction_scope/);
  assert.doesNotMatch(prompt, /# rolling_conversation_summary|# structured_working_state/);
  assert.match(prompt, /inside partantheses/);
});

test("ambiguous truncated legacy instructions cannot acquire an invented source or scope", () => {
  const chat = conversation();
  const prefix = "You must use this presentation format. " + "Background detail. ".repeat(20);
  finishTurn(chat, "local-request", "garden_chat", prefix + "Only for this draft.");
  const second = finishTurn(chat, "future-request", "garden_chat", prefix + "For all future replies.");
  const initial = memory.loadConversationMemoryState(chat.id);
  db.prepare(`UPDATE conversation_memory_state SET working_state = ?, summarized_through_order = ?
    WHERE conversation_id = ?`).run(JSON.stringify({ ...initial.workingState, decisions: [prefix.slice(0, 320)] }),
      second.assistantMessage.order_index, chat.id);
  const migrated = memory.loadConversationMemoryState(chat.id);
  assert.deepEqual(migrated.workingState.decisions, []);
  assert.equal(migrated.workingState.historicalInstructions[0].sourceMessageId, null);
  assert.equal(migrated.workingState.historicalInstructions[0].truncated, true);
  assert.equal(migrated.workingState.historicalInstructions[0].content, prefix.slice(0, 320).trim());
});

test("a long decision keeps its trailing task limitation instead of saving an unconditional prefix", () => {
  const chat = conversation();
  const request = "We decided to use visual descriptions. " + "This explains our drafting approach. ".repeat(12) + "Only for this introduction, not later explanations.";
  finishTurn(chat, "long-decision", "garden_chat", request);
  for (let index = 0; index < 18; index += 1) {
    finishTurn(chat, `later-question-${index}`, "garden_chat", "Explain charge.");
  }
  memory.compactConversationMemoryIfNeeded(chat.id);
  const saved = memory.loadConversationMemoryState(chat.id);
  assert.deepEqual(saved.workingState.decisions, []);
  assert.equal(saved.workingState.historicalInstructions[0].content, request);
  assert.equal(saved.workingState.historicalInstructions[0].truncated, false);
});

test("a proactive assistant message can open the canonical conversation", () => {
  const chat = conversation(1, "Telegram reminder");
  const first = store.appendConversationAssistantMessage({
    conversation: chat,
    clientMessageId: "external-outbound-telegram-test-001",
    surface: "dashboard_terminal",
    content: "⏰ In 20 minutes: Control systems",
    metadata: {
      externalMessaging: true,
      externalMessagingChannel: "telegram",
      externalMessagingDirection: "outbound",
      externalMessagingKind: "reminder",
    },
  });
  const retry = store.appendConversationAssistantMessage({
    conversation: chat,
    clientMessageId: "external-outbound-telegram-test-001",
    surface: "dashboard_terminal",
    content: "⏰ In 20 minutes: Control systems",
    metadata: { ignoredOnIdempotentReplay: true },
  });

  assert.equal(first.id, retry.id, "replaying the persistence step must not duplicate it");
  assert.equal(first.role, "assistant");
  assert.equal(first.status, "complete");
  assert.equal(first.order_index, 0);
  assert.equal(store.listRecentConversationMessages(chat.id)[0].content, first.content);

  const followUp = store.reserveConversationTurn({
    conversation: store.getConversationById(chat.id),
    clientMessageId: "telegram-follow-up-test-001",
    surface: "dashboard_terminal",
    content: "Is this class streamed?",
  });
  assert.equal(followUp.userMessage.order_index, 1);
  assert.equal(followUp.assistantMessage.order_index, 2);
});

test("a delivered Telegram reminder is bound to the conversation containing it", async () => {
  const telegram = getTelegramStore();
  telegram.upsertChat({
    chatId: "123456789",
    userId: 1,
    contactLabel: "Alice",
    contactHandle: "@alice",
    isGroup: false,
  });

  const chat = await messaging.recordDeliveredOwnerMessage({
    channel: "telegram",
    userId: 1,
    target: { chatId: "123456789", label: "Alice" },
    text: "⏰ In 20 minutes: Control systems\n13:30 – 15:30\n📍 Gemini-Noord 1.610",
    kind: "reminder",
  });

  assert.equal(telegram.getChat("123456789").conversation_id, chat.id);
  const messages = store.listConversationMessages(chat.id);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, "assistant");
  assert.match(messages[0].content, /Gemini-Noord 1\.610/);
  assert.deepEqual(JSON.parse(messages[0].metadata), {
    externalMessaging: true,
    externalMessagingChannel: "telegram",
    externalMessagingDirection: "outbound",
    externalMessagingKind: "reminder",
  });
});

test("a delivered WhatsApp reminder is bound to the conversation containing it", async () => {
  const whatsapp = getWhatsAppStore();
  whatsapp.upsertChat({
    chatId: "31600000000@s.whatsapp.net",
    userId: 1,
    contactLabel: "Alice",
    contactNumber: "31600000000",
    isGroup: false,
  });

  const chat = await messaging.recordDeliveredOwnerMessage({
    channel: "whatsapp",
    userId: 1,
    target: { chatId: "31600000000@s.whatsapp.net", label: "Alice" },
    text: "▶️ Starting now: Control systems\n13:30 – 15:30",
    kind: "reminder",
  });

  assert.equal(whatsapp.getChat("31600000000@s.whatsapp.net").conversation_id, chat.id);
  const [message] = store.listConversationMessages(chat.id);
  assert.equal(message.role, "assistant");
  assert.match(message.content, /Starting now: Control systems/);
  assert.equal(JSON.parse(message.metadata).externalMessagingChannel, "whatsapp");
});

for (const channel of ["telegram", "whatsapp"]) {
  const target = { chatId: channel === "telegram" ? "daily-123" : "31655500000@s.whatsapp.net", label: "Alice" };
  const channelStore = () => channel === "telegram" ? getTelegramStore() : getWhatsAppStore();
  const send = (text, extra = {}) => messaging.recordDeliveredOwnerMessage({
    channel, userId: 1, target, text, kind: "reminder", ...extra,
  });

  test(`${channel}: reminders, user messages and replies share one durable daily transcript`, async () => {
    const first = await send("Morning reminder");
    finishTurn(first, "phone-question", "dashboard_terminal", "Where is the class?", "Room 12");
    const second = await send("Afternoon reminder");
    assert.equal(second.id, first.id);
    const review = await messaging.recordDeliveredOwnerExchange({
      channel, userId: 1, chatId: target.chatId, userText: "My review answer",
      assistantText: "Correct", clientMessageId: "phone-review",
    });
    assert.equal(review.id, first.id);
    const third = await send("Evening reminder");
    assert.equal(third.id, first.id);
    assert.equal(channelStore().getChat(target.chatId).conversation_id, first.id);
    assert.deepEqual(store.listConversationMessages(first.id).map(message => [message.role, message.content]), [
      ["assistant", "Morning reminder"],
      ["user", "Where is the class?"],
      ["assistant", "Room 12"],
      ["assistant", "Afternoon reminder"],
      ["user", "My review answer"],
      ["assistant", "Correct"],
      ["assistant", "Evening reminder"],
    ]);
    assert.equal(store.listConversationsForUser(1).length, 1);
  });

  test(`${channel}: outgoing messages reuse a user-started chat and respect an explicit new chat`, async () => {
    // Seed the contact, then mirror the ordinary inbound and /new bindings.
    await send("First reminder");
    const userStarted = conversation(1, "My own title");
    finishTurn(userStarted, "user-started", "dashboard_terminal", "Hello", "Hi");
    channelStore().bindConversation(target.chatId, userStarted.id);
    const delivered = await send("Later reminder");
    assert.equal(delivered.id, userStarted.id);
    assert.equal(delivered.title, "My own title");
    assert.equal(store.listConversationMessages(userStarted.id).length, 3);
    const explicitNew = conversation(1, "Fresh chat");
    channelStore().bindConversation(target.chatId, explicitNew.id);
    assert.equal((await send("After /new")).id, explicitNew.id);
  });

  test(`${channel}: the next local day starts a new transcript for outgoing messages and review replies`, async () => {
    const first = await send("Yesterday's reminder");
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    db.prepare("UPDATE conversations SET created_at = ? WHERE id = ?").run(yesterday.toISOString(), first.id);
    const today = await send("Today's reminder");
    assert.notEqual(today.id, first.id);
    assert.equal((await send("Another reminder today")).id, today.id);
    assert.deepEqual(store.listConversationMessages(first.id).map(message => message.content), ["Yesterday's reminder"]);
    db.prepare("UPDATE conversations SET created_at = ? WHERE id = ?").run(yesterday.toISOString(), today.id);
    const review = await messaging.recordDeliveredOwnerExchange({
      channel, userId: 1, chatId: target.chatId, userText: "Answer today",
      assistantText: "Feedback today", clientMessageId: "review-new-day",
    });
    assert.notEqual(review.id, today.id);
    assert.equal((await send("Reminder after the review")).id, review.id);
  });

  test(`${channel}: concurrent deliveries and a completed review preserve an active user turn`, async () => {
    const deliveries = await Promise.all(["First", "Second", "Third"].map(text => send(text)));
    assert.equal(new Set(deliveries.map(item => item.id)).size, 1);
    const chat = deliveries[0];
    store.reserveConversationTurn({
      conversation: chat, clientMessageId: "still-running", surface: "dashboard_terminal", content: "Research this",
    });
    await send("Reminder during research");
    await messaging.recordDeliveredOwnerExchange({
      channel, userId: 1, chatId: target.chatId, userText: "Review during research",
      assistantText: "Review feedback", clientMessageId: "concurrent-review",
    });
    const messages = store.listConversationMessages(chat.id);
    assert.equal(messages.length, 8);
    assert.equal(messages.find(message => message.client_message_id === "still-running" && message.role === "assistant").status, "pending");
    assert.equal(messages.filter(message => message.status === "pending").length, 1);
    assert.equal(new Set(messages.map(message => message.order_index)).size, messages.length);
  });

  test(`${channel}: daily continuity stays within the recipient and account`, async () => {
    const first = await send("Alice's reminder");
    const other = await send("Separate recipient", { target: { chatId: target.chatId + "-other", label: "Other chat" } });
    assert.notEqual(other.id, first.id);
    await assert.rejects(() => send("Wrong account", { userId: 2 }), /different Breadboard account/);
    assert.equal(store.listConversationMessages(first.id).length, 1);
  });
}

test("a failed turn keeps the tokens it spent", () => {
  const chat = conversation();
  store.reserveConversationTurn({
    conversation: chat,
    clientMessageId: "terminal-failed-001",
    surface: "dashboard_terminal",
    content: "do deep research on robotics",
  });
  // The turn burned its context before the gate stopped it. Persisting the
  // failure without the usage left the row reporting nothing, so the count the
  // live meter had been showing disappeared on the next reload.
  store.failAssistantMessage({
    conversationId: chat.id,
    clientMessageId: "terminal-failed-001",
    status: "failed",
    content: "The required visualizer was not published before this turn ended.",
    error: "failed",
    tokenUsage: { inputTokens: 35_200, outputTokens: 1_100, totalTokens: 36_300 },
  });

  const row = db.prepare(
    "SELECT status, token_usage FROM conversation_messages WHERE conversation_id = ? AND client_message_id = ? AND role = 'assistant'",
  ).get(chat.id, "terminal-failed-001");
  assert.equal(row.status, "failed");
  assert.deepEqual(JSON.parse(row.token_usage), {
    inputTokens: 35_200,
    outputTokens: 1_100,
    totalTokens: 36_300,
  });
});

test("same conversation has exact cross-surface continuity", () => {
  const chat = conversation();
  finishTurn(chat, "terminal-aurora-001", "dashboard_terminal", "My temporary project codename is Aurora.");
  finishTurn(chat, "garden-question-001", "garden_chat", "What project codename did I give you?", "Aurora.");

  const bundle = memory.loadConversationMemoryBundle({
    conversation: chat,
    query: "What was the codename?",
    activeGardenId: 10,
    projectScopeId: "breadboard",
  });
  assert.match(bundle.recentMessages.map((message) => message.content).join("\n"), /Aurora/);

  finishTurn(chat, "quartz-followup-001", "quartz_ai", "Keep using that codename.");
  assert.deepEqual(
    [...new Set(store.listConversationMessages(chat.id).map((message) => message.surface))],
    ["dashboard_terminal", "garden_chat", "quartz_ai"],
  );
});

test("different conversations never receive each other's transcript", () => {
  const chatA = conversation(1, "Chat A");
  const chatB = conversation(1, "Chat B");
  finishTurn(chatA, "chat-a-aurora-001", "dashboard_terminal", "The codename is Aurora.");
  finishTurn(chatB, "chat-b-question-01", "dashboard_terminal", "What is the codename?");

  const bundle = memory.loadConversationMemoryBundle({
    conversation: chatB,
    query: "codename",
    projectScopeId: "breadboard",
  });
  assert.doesNotMatch(bundle.recentMessages.map((message) => message.content).join("\n"), /Aurora/);
  assert.equal(bundle.crossConversation, null);
});

test("an explicit previous-chat reference loads one bounded same-user transcript", () => {
  const source = conversation(1, "Downloads inventory");
  finishTurn(
    source,
    "source-downloads-01",
    "dashboard_terminal",
    "List my largest downloads.",
    "Demo_Team14.mp4 was in the verified list.",
  );
  const unrelated = conversation(1, "Unrelated recipes");
  finishTurn(unrelated, "source-recipe-001", "dashboard_terminal", "Discuss soup.", "Use carrots.");
  const current = conversation(1, "Current");

  const bundle = memory.loadConversationMemoryBundle({
    conversation: current,
    query: "In another chat, what did we say about Demo_Team14.mp4?",
    projectScopeId: "breadboard",
  });
  assert.equal(bundle.crossConversation?.conversationId, source.id);
  assert.match(
    bundle.crossConversation.messages.map((message) => message.content).join("\n"),
    /Demo_Team14/,
  );
  assert.match(memory.composeMemoryContext(bundle), /explicitly_requested_cross_chat_context/);
});

test("last chat follows chronology instead of an older incidental keyword match", () => {
  const older = conversation(1, "Make Me Kindle Clone");
  finishTurn(
    older,
    "older-next-quarter-001",
    "dashboard_terminal",
    "Write a social post.",
    "We will publish it next quarter.",
  );
  const actualLast = conversation(1, "What Elective Should I Pick");
  finishTurn(
    actualLast,
    "latest-elective-001",
    "dashboard_terminal",
    "I take 5ECE0 and 5EPF0. Recommend an elective for Q1.",
    "Approve the Deep Research run before I recommend one elective.",
  );
  const current = conversation(1, "Current");

  const bundle = memory.loadConversationMemoryBundle({
    conversation: current,
    query: "Can you tell me the result my last chat produced about class selection for next quarter?",
    projectScopeId: "breadboard",
  });

  assert.equal(bundle.crossConversation?.conversationId, actualLast.id);
  assert.match(
    bundle.crossConversation.messages.map((message) => message.content).join("\n"),
    /5ECE0.*5EPF0/,
  );
});

test("subject-based recall searches beyond the 20 most recent chats", () => {
  const source = conversation(1, "Cryogenic routing decision");
  finishTurn(
    source,
    "old-source-001",
    "garden_chat",
    "How should cryogenic narwhal routing work?",
    "Use the cobalt relay for cryogenic narwhal routing.",
  );
  for (let index = 0; index < 21; index += 1) {
    const distractor = conversation(1, `Distractor ${index}`);
    finishTurn(
      distractor,
      `distractor-${String(index).padStart(3, "0")}`,
      "dashboard_terminal",
      `Unrelated conversation ${index}.`,
      "No related decision here.",
    );
  }
  const current = conversation(1, "Current");

  const bundle = memory.loadConversationMemoryBundle({
    conversation: current,
    query: "What did we decide about cryogenic narwhal routing in an earlier chat?",
    projectScopeId: "breadboard",
  });

  assert.equal(bundle.crossConversation?.conversationId, source.id);
  assert.match(
    bundle.crossConversation.messages.map((message) => message.content).join("\n"),
    /cobalt relay/,
  );
});

test("ambiguous or foreign-user cross-chat history is not loaded", () => {
  const first = conversation(1, "First matching chat");
  finishTurn(first, "same-subject-0001", "dashboard_terminal", "Discuss Falcon.", "Falcon notes.");
  const second = conversation(1, "Second matching chat");
  finishTurn(second, "same-subject-0002", "dashboard_terminal", "Discuss Falcon.", "More Falcon notes.");
  const foreign = conversation(2, "Private foreign chat");
  finishTurn(foreign, "foreign-secret-01", "dashboard_terminal", "Discuss SecretFalcon.", "Foreign only.");
  const current = conversation(1, "Current");
  const bundle = memory.loadConversationMemoryBundle({
    conversation: current,
    query: "Use the Falcon details from another chat.",
    projectScopeId: "breadboard",
  });
  assert.equal(bundle.crossConversation, null);
  const previous = memory.loadConversationMemoryBundle({
    conversation: current,
    query: "Summarize the previous chat.",
    projectScopeId: "breadboard",
  });
  assert.notEqual(previous.crossConversation?.conversationId, foreign.id);
});

test("durable memory is weak, selective, and current-chat text wins", () => {
  const source = conversation(1, "Preferences");
  memory.saveDurableMemory({
    userId: 1,
    content: "Prefer React for project UI work.",
    kind: "preference",
    scope: "project",
    scopeId: "breadboard",
    sourceConversationId: source.id,
    state: "confirmed",
    confidence: 0.95,
    salience: 0.9,
    memoryKey: "ui-framework",
  });
  const current = conversation(1, "Current work");
  finishTurn(current, "current-no-react-01", "dashboard_terminal", "Do not use React for this component.");
  const bundle = memory.loadConversationMemoryBundle({
    conversation: current,
    query: "React component UI",
    projectScopeId: "breadboard",
  });
  assert.equal(bundle.durableMemories.length, 1);
  assert.ok(bundle.durableMemories[0].score < 0.55, "durable score remains below project scope weight");
  const context = memory.composeMemoryContext(bundle);
  assert.ok(context.indexOf("Do not use React") < context.indexOf("Prefer React"));
  assert.match(context, /current user instruction > current conversation exact messages/);
});

test("a confirmed global name is retrieved inside a Garden conversation", () => {
  const source = conversation(1, "Profile");
  memory.saveDurableMemory({
    userId: 1,
    content: "The user's name is Kuzey.",
    kind: "project_fact",
    scope: "global",
    sourceConversationId: source.id,
    state: "confirmed",
    confidence: 0.9,
    salience: 0.85,
    memoryKey: "user-name",
  });
  const garden = store.createConversation({
    userId: 1,
    title: "Garden chat",
    surface: "garden_chat",
    scopeKind: "garden",
    defaultGardenId: 10,
  });
  const bundle = memory.loadConversationMemoryBundle({
    conversation: garden,
    query: "What's my name?",
    activeGardenId: 10,
    projectScopeId: "breadboard",
  });

  assert.equal(bundle.durableMemories.length, 1);
  assert.match(bundle.durableMemories[0].content, /Kuzey/);
  assert.match(memory.composeMemoryContext(bundle), /The user's name is Kuzey/);
});

test("branch context uses only the selected exact transcript and omits stale rolling state", () => {
  const bundle = {
    summary: "The PDF backend is missing.",
    workingState: {
      knownFacts: ["mcpServer is required"],
      decisions: [],
      completedActions: [],
      openQuestions: [],
      referencedGardenIds: [],
      referencedPages: [],
      referencedFiles: [],
      temporaryPreferences: [],
    },
    recentMessages: [
      {
        role: "assistant",
        surface: "dashboard_terminal",
        content: "No PDF was created because mcpServer is required.",
      },
    ],
    durableMemories: [],
    crossConversation: null,
  };
  const context = memory.composeMemoryContext(bundle, {
    recentMessages: [
      {
        role: "user",
        surface: "dashboard_terminal",
        content: "Create the PDF again.",
      },
    ],
    includeConversationState: false,
  });

  assert.match(context, /Create the PDF again/);
  assert.doesNotMatch(context, /mcpServer|PDF backend is missing/);
  assert.doesNotMatch(
    context,
    /rolling_conversation_summary|structured_working_state/,
  );
});

test("exact chat context includes the finished answer stored in delegated metadata", () => {
  const chat = conversation();
  store.reserveConversationTurn({
    conversation: chat, clientMessageId: "delegated-context-1",
    surface: "dashboard_terminal", content: "Compare the options",
  });
  store.completeAssistantMessage({
    conversationId: chat.id, clientMessageId: "delegated-context-1",
    content: "The comparison is ready.",
    metadata: {
      externalAgent: true,
      delegatedAgentRun: true,
      delegatedAgentPreamble: "The comparison is ready.",
      externalAgentResult: "Option two uses a shared cache.",
    },
  });
  const bundle = memory.loadConversationMemoryBundle({
    conversation: chat, query: "based on the chat above, explain option two",
    personalize: false,
  });
  const context = memory.composeMemoryContext(bundle);
  assert.match(context, /The comparison is ready/);
  assert.match(context, /Option two uses a shared cache/);
  // A selected branch must not reintroduce the answer from the abandoned path.
  assert.doesNotMatch(memory.composeMemoryContext(bundle, {
    recentMessages: [], includeConversationState: false,
  }), /Option two uses a shared cache/);
});

test("save_memory is authorized only on authenticated conversational surfaces", () => {
  assert.ok(toolScopes.allowedToolsForSurface("garden_chat").includes("save_memory"));
  assert.ok(toolScopes.allowedToolsForSurface("dashboard_terminal").includes("save_memory"));
  // Anonymous Quartz AI must never be able to write a user's durable memory.
  assert.ok(!toolScopes.allowedToolsForSurface("quartz_ai").includes("save_memory"));
});

test("explicit remember promotes, secrets never do, and changed keys supersede", () => {
  const chat = conversation();
  const first = memory.maintainDurableMemoryFromUserTurn({
    conversation: chat,
    content: "Please remember globally: I prefer concise status updates.",
  });
  assert.equal(first?.state, "confirmed");
  assert.equal(first?.scope, "global");
  const secret = memory.maintainDurableMemoryFromUserTurn({
    conversation: chat,
    content: "Remember globally: my API key is sk-example-secret-123456789.",
  });
  assert.equal(secret, null);

  const old = memory.saveDurableMemory({
    userId: 1,
    content: "Prefer React.",
    kind: "preference",
    scope: "project",
    scopeId: "breadboard",
    sourceConversationId: chat.id,
    state: "confirmed",
    confidence: 0.9,
    salience: 0.8,
    memoryKey: "framework",
  });
  memory.saveDurableMemory({
    userId: 1,
    content: "Prefer Svelte.",
    kind: "preference",
    scope: "project",
    scopeId: "breadboard",
    sourceConversationId: chat.id,
    state: "confirmed",
    confidence: 0.9,
    salience: 0.8,
    memoryKey: "framework",
  });
  assert.equal(db.prepare("SELECT state FROM durable_memories WHERE id = ?").get(old.id).state, "superseded");
});

test("opted-out and unresolved personal deliberations never become durable memory", () => {
  const chat = conversation();
  const privatePrompt =
    "If I should quit collage or not (dont stire this in memory).";

  assert.equal(
    memory.durableMemoryExclusionReason(privatePrompt),
    "user_opt_out",
  );
  assert.equal(
    memory.durableMemoryExclusionReason("Should I quit college or not?"),
    "temporary_deliberation",
  );
  assert.equal(
    memory.durableMemoryExclusionReason("We decided to use SQLite."),
    null,
  );

  assert.equal(
    memory.saveDurableMemory({
      userId: 1,
      content: "The user is considering whether to quit college.",
      kind: "decision",
      scope: "global",
      state: "candidate",
      confidence: 0.4,
      salience: 0.5,
    }),
    null,
  );
  assert.equal(
    memory.maintainDurableMemoryFromUserTurn({
      conversation: chat,
      content: `Remember globally: ${privatePrompt}`,
    }),
    null,
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS total FROM durable_memories").get().total,
    0,
  );
});

test("client retries deduplicate and simultaneous turns are serialized", () => {
  const chat = conversation();
  const first = store.reserveConversationTurn({
    conversation: chat,
    clientMessageId: "retry-message-001",
    surface: "dashboard_terminal",
    content: "Hello",
  });
  const retry = store.reserveConversationTurn({
    conversation: chat,
    clientMessageId: "retry-message-001",
    surface: "dashboard_terminal",
    content: "Hello",
  });
  assert.equal(first.isNew, true);
  assert.equal(retry.isNew, false);
  assert.throws(
    () => store.reserveConversationTurn({
      conversation: chat,
      clientMessageId: "parallel-message-02",
      surface: "garden_chat",
      content: "A simultaneous request",
    }),
    (error) => error.code === "conversation_turn_active",
  );
  store.completeAssistantMessage({
    conversationId: chat.id,
    clientMessageId: "retry-message-001",
    content: "Hello back",
  });
  store.completeAssistantMessage({
    conversationId: chat.id,
    clientMessageId: "retry-message-001",
    content: "Duplicate should not replace",
  });
  const rows = store.listConversationMessages(chat.id);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.order_index), [0, 1]);
  assert.equal(rows[1].content, "Hello back");
});

test("a new conversation and its first prompt commit as one recoverable unit", () => {
  const created = store.createConversationWithInitialTurn({
    conversation: {
      userId: 1,
      title: "New chat",
      surface: "dashboard_terminal",
    },
    turn: {
      clientMessageId: "initial-turn-0001",
      surface: "dashboard_terminal",
      content: "Why is robotics considered the future?",
      metadata: {
        attachmentNames: ["forecast.pdf"],
        attachments: [{ type: "file", name: "forecast.pdf" }],
      },
    },
  });

  const rows = store.listConversationMessages(created.conversation.id);
  assert.deepEqual(rows.map((row) => [row.role, row.status, row.order_index]), [
    ["user", "complete", 0],
    ["assistant", "aborted", 1],
  ]);
  assert.equal(rows[0].content, "Why is robotics considered the future?");
  assert.deepEqual(store.presentConversationMessage(rows[0]).metadata, {
    attachmentNames: ["forecast.pdf"],
    attachments: [{ type: "file", name: "forecast.pdf" }],
  });
  assert.equal(store.isPreDispatchReservedAssistant(rows[1]), true);

  const retried = store.retryAssistantMessage(
    created.conversation.id,
    "initial-turn-0001",
  );
  assert.equal(retried.status, "pending");
  assert.equal(store.isPreDispatchReservedAssistant(retried), false);
});

test("an invalid first turn rolls its newly-created conversation back", () => {
  const before = db.prepare("SELECT COUNT(*) AS total FROM conversations").get().total;
  assert.throws(
    () => store.createConversationWithInitialTurn({
      conversation: { userId: 1, title: "New chat" },
      turn: {
        clientMessageId: "short",
        surface: "dashboard_terminal",
        content: "This must not leave an empty chat behind.",
      },
    }),
    (error) => error.code === "invalid_client_message_id",
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS total FROM conversations").get().total,
    before,
  );
});

test("course correction is inserted before the pending assistant deterministically", () => {
  const chat = conversation();
  store.reserveConversationTurn({
    conversation: chat,
    clientMessageId: "original-message-01",
    surface: "dashboard_terminal",
    content: "Initial request",
  });
  store.appendConversationSteerMessage({
    conversationId: chat.id,
    clientMessageId: "steer:request-0001",
    surface: "dashboard_terminal",
    content: "Use the newer file instead.",
    targetClientMessageId: "original-message-01",
    assistantContentOffset: 24,
  });
  const rows = store.listConversationMessages(chat.id);
  assert.deepEqual(rows.map((row) => [row.role, row.order_index]), [
    ["user", 0],
    ["user", 1],
    ["assistant", 2],
  ]);
  assert.deepEqual(store.presentConversationMessage(rows[1]).metadata, {
    courseCorrection: true,
    courseCorrectionTargetClientMessageId: "original-message-01",
    courseCorrectionOffset: 24,
  });
});

test("clarification answers retain their hidden runtime-input marker", () => {
  const chat = conversation();
  store.reserveConversationTurn({
    conversation: chat,
    clientMessageId: "original-message-01",
    surface: "dashboard_terminal",
    content: "Initial request",
  });
  store.appendConversationSteerMessage({
    conversationId: chat.id,
    clientMessageId: "clarify:request-0001",
    surface: "dashboard_terminal",
    content: "Dopamine levels and effects in the morning",
    clarificationAnswer: true,
    targetClientMessageId: "original-message-01",
    assistantContentOffset: 24,
  });

  const rows = store.listConversationMessages(chat.id);
  assert.deepEqual(store.presentConversationMessage(rows[1]).metadata, {
    courseCorrection: true,
    clarificationAnswer: true,
    courseCorrectionTargetClientMessageId: "original-message-01",
    courseCorrectionOffset: 24,
  });
});

test("one runtime is bound per conversation and active context is replaced", () => {
  const first = conversation(1, "First");
  const second = conversation(1, "Second");
  const runtimeA = runtime.createRuntimeSession({
    conversationId: first.id,
    surface: "garden_chat",
    userId: 1,
    chatSessionId: null,
    agentName: "breadboard-assistant",
    clusterId: 10,
    gardenId: "aurora",
    pageSlug: null,
    allowedGardenIds: [10],
    workspaceKey: "conversations/a",
    activeDirectory: dataRoot,
    filesystemMode: "restricted",
    hermesSessionId: "oh-a",
  });
  const runtimeB = runtime.createRuntimeSession({
    conversationId: second.id,
    surface: "dashboard_terminal",
    userId: 1,
    chatSessionId: null,
    agentName: "breadboard-assistant",
    clusterId: null,
    gardenId: null,
    pageSlug: null,
    allowedGardenIds: [10],
    workspaceKey: "conversations/b",
    activeDirectory: dataRoot,
    filesystemMode: "restricted",
    hermesSessionId: "oh-b",
  });
  assert.equal(runtime.getRuntimeSessionByConversation(first.id).id, runtimeA.id);
  assert.notEqual(runtimeA.hermes_session_id, runtimeB.hermes_session_id);
  const terminal = runtime.updateRuntimeActiveContext({
    runtimeSessionId: runtimeA.id,
    surface: "dashboard_terminal",
    clusterId: null,
    gardenId: null,
    pageSlug: null,
    allowedGardenIds: [10],
  });
  assert.equal(terminal.garden_id, null);
  assert.equal(terminal.page_slug, null);
});

test("exact delete targets survive capability-decision persistence", () => {
  const chat = conversation(1, "Delete scope");
  const session = runtime.createRuntimeSession({
    conversationId: chat.id,
    surface: "dashboard_terminal",
    userId: 1,
    chatSessionId: null,
    agentName: "breadboard-assistant",
    clusterId: null,
    gardenId: null,
    pageSlug: null,
    allowedGardenIds: [],
    workspaceKey: "conversations/delete-scope",
    activeDirectory: dataRoot,
    filesystemMode: "restricted",
    hermesSessionId: "oh-delete-scope",
  });
  const target = path.join(dataRoot, "target.txt");
  const stored = runtime.persistCapabilityDecision(session.id, {
    mode: "scoped_implementation",
    requestedOutcome: "Delete the confirmed file.",
    implementationRequired: false,
    decisionReason: "Exact target was verified.",
    decisionSource: "breadboard_server_policy_v1",
    authorizedRoots: [dataRoot],
    authorizedPathPatterns: [`${dataRoot}/**`],
    authorizedDeleteTargets: [target],
    allowedTools: ["terminal_execute_command"],
    allowedOperations: [],
    allowedCommandPatterns: [],
    selectedConditionalSkills: [],
    selectedConnections: [],
    createdAt: new Date().toISOString(),
    expiresAt: null,
    revokedAt: null,
  });
  assert.deepEqual(stored.authorizedDeleteTargets, [target]);
  assert.deepEqual(
    runtime.getActiveCapabilityDecision(session.id)?.authorizedDeleteTargets,
    [target],
  );
});

test("ownership is indistinguishable from a missing opaque id", () => {
  const chat = conversation(1);
  assert.throws(
    () => store.getConversationForUser(chat.public_id, 2),
    (error) => error.status === 404 && error.code === "conversation_not_found",
  );
});

test("workspace tools expose only the signed server-authorized garden set", async () => {
  db.prepare("INSERT INTO clusters(id, user_id, name, slug, visibility, chat_accessible) VALUES (11, 2, 'Bob Garden', 'bob-private', 'private', 0)").run();
  const token = capability.issueCapabilityToken({
    userId: 1,
    conversationId: conversation().id,
    surface: "dashboard_terminal",
    hermesSessionId: "oh-authorized-set",
    allowedGardenIds: [10],
    activeGardenId: 10,
    allowedTools: [...toolScopes.GARDEN_TOOLS],
  });

  const listed = await gardenTools.executeGardenTool({ rawToken: token, tool: "garden_list", args: {} });
  assert.equal(listed.ok, true);
  assert.deepEqual(listed.data.gardens, [{ id: 10, slug: "aurora", name: "Aurora Garden" }]);

  const escaped = await gardenTools.executeGardenTool({
    rawToken: token,
    tool: "garden_get_page",
    args: { gardenId: "bob-private", slug: "anything" },
  });
  assert.equal(escaped.ok, false);
  assert.match(escaped.error, /outside.*authorized/i);
});

test("rolling compaction advances once and retains recent exact messages", () => {
  const chat = conversation();
  for (let index = 0; index < 18; index += 1) {
    finishTurn(
      chat,
      `compaction-turn-${String(index).padStart(3, "0")}`,
      index % 2 ? "garden_chat" : "dashboard_terminal",
      index === 0
        ? "We decided to keep the canonical server transcript."
        : index === 5
          ? "Open question: Which database should own future migrations?"
          : index === 2
            ? "Should I quit college or not? Do not store this in memory."
          : `Question ${index}?`,
      index === 1 ? "Implemented the transcript store." : `Answer ${index}.`,
    );
  }
  // Compaction is a side effect of completing an answer, on every surface,
  // so by now it has already run: an explicit call finds nothing left to do.
  const state = memory.loadConversationMemoryState(chat.id);
  assert.ok(state.summarizedThroughOrder >= 0, "completion already compacted");
  assert.ok(state.version >= 1);
  assert.equal(memory.compactConversationMemoryIfNeeded(chat.id), false);
  assert.match(state.summary, /canonical server transcript/);
  assert.doesNotMatch(state.summary, /quit college|store this in memory/i);
  assert.ok(state.workingState.openQuestions.some((question) => /future migrations/i.test(question)));
  assert.equal(memory.compactConversationMemoryIfNeeded(chat.id), false);
  const recent = memory.loadConversationMemoryBundle({ conversation: chat, query: "latest" }).recentMessages;
  assert.ok(recent.length <= 24);
  assert.equal(recent.at(-1).content, "Answer 17.");
});

test("legacy backfill is repeatable and preserves order without duplicates", () => {
  const legacy = new Database(":memory:");
  legacy.pragma("foreign_keys = ON");
  seedLegacySchema(legacy);
  legacy.prepare("INSERT INTO users VALUES (1, 'alice', 'alice@example.test', 'x')").run();
  legacy.prepare("INSERT INTO clusters(id, user_id, name, slug, visibility, chat_accessible) VALUES (10, 1, 'A', 'a', 'private', 0)").run();
  legacy.prepare("INSERT INTO chat_sessions(id, cluster_id, user_id, title, created_at, updated_at) VALUES (20, 10, 1, 'Old chat', '2025-01-01', '2025-01-02')").run();
  legacy.prepare("INSERT INTO chat_messages(id, session_id, role, content, order_index, created_at) VALUES (30, 20, 'user', 'first', 0, '2025-01-01')").run();
  legacy.prepare("INSERT INTO chat_messages(id, session_id, role, content, order_index, created_at) VALUES (31, 20, 'assistant', 'second', 1, '2025-01-01')").run();
  schema.ensureConversationSchema(legacy);
  schema.ensureConversationSchema(legacy);
  assert.equal(legacy.prepare("SELECT COUNT(*) AS count FROM conversations").get().count, 1);
  const copied = legacy.prepare("SELECT content, order_index FROM conversation_messages ORDER BY order_index").all();
  assert.deepEqual(copied, [
    { content: "first", order_index: 0 },
    { content: "second", order_index: 1 },
  ]);
  assert.equal(legacy.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  legacy.close();
});

test("legacy backfill preserves canonical bindings carried by rewritten compatibility rows", () => {
  const legacy = new Database(":memory:");
  legacy.pragma("foreign_keys = ON");
  seedLegacySchema(legacy);
  legacy.prepare("INSERT INTO users VALUES (1, 'alice', 'alice@example.test', 'x')").run();
  legacy.prepare("INSERT INTO clusters(id, user_id, name, slug, visibility, chat_accessible) VALUES (10, 1, 'A', 'a', 'private', 0)").run();
  legacy.prepare("INSERT INTO chat_sessions(id, cluster_id, user_id, title, created_at, updated_at) VALUES (20, 10, 1, 'Old chat', '2025-01-01', '2025-01-02')").run();
  legacy.prepare("INSERT INTO chat_messages(id, session_id, role, content, order_index, created_at) VALUES (30, 20, 'user', 'first', 0, '2025-01-01')").run();
  legacy.prepare("INSERT INTO chat_messages(id, session_id, role, content, order_index, created_at) VALUES (31, 20, 'assistant', 'second', 1, '2025-01-01')").run();
  schema.ensureConversationSchema(legacy);

  const bindings = legacy.prepare(
    "SELECT role, canonical_message_id FROM chat_messages ORDER BY order_index",
  ).all();
  legacy.prepare("DELETE FROM chat_messages WHERE session_id = 20").run();
  const insert = legacy.prepare(`
    INSERT INTO chat_messages
      (id, session_id, role, content, order_index, created_at, canonical_message_id)
    VALUES (?, 20, ?, ?, ?, '2025-01-01', ?)
  `);
  insert.run(40, "user", "first", 0, bindings[0].canonical_message_id);
  insert.run(41, "assistant", "second", 1, bindings[1].canonical_message_id);

  schema.ensureConversationSchema(legacy);
  assert.equal(
    legacy.prepare("SELECT COUNT(*) AS count FROM conversation_messages").get().count,
    2,
  );
  assert.deepEqual(
    legacy.prepare(
      "SELECT role, canonical_message_id FROM chat_messages ORDER BY order_index",
    ).all(),
    bindings,
  );
  assert.equal(legacy.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  legacy.close();
});

function seedLegacySchema(database) {
  database.exec(`
    CREATE TABLE users(id INTEGER PRIMARY KEY, username TEXT, email TEXT, password_hash TEXT);
    CREATE TABLE clusters(id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, slug TEXT, visibility TEXT, chat_accessible INTEGER);
    CREATE TABLE chat_sessions(id INTEGER PRIMARY KEY, cluster_id INTEGER, user_id INTEGER, title TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE chat_messages(
      id INTEGER PRIMARY KEY, session_id INTEGER, role TEXT, content TEXT, sources TEXT,
      token_usage TEXT, order_index INTEGER, created_at TEXT, tool_calls TEXT,
      permission_decisions TEXT, runtime_error TEXT, runtime_status TEXT, proposal TEXT
    );
    CREATE TABLE hermes_runtime_sessions(
      id INTEGER PRIMARY KEY, surface TEXT, user_id INTEGER, chat_session_id INTEGER,
      hermes_session_id TEXT, agent_name TEXT, cluster_id INTEGER, garden_id TEXT,
      page_slug TEXT, workspace_key TEXT, active_directory TEXT, filesystem_mode TEXT,
      capability_mode TEXT, capability_decision_id INTEGER, runtime_metadata TEXT,
      last_runtime_status TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE hermes_messages(
      id INTEGER PRIMARY KEY, runtime_session_id INTEGER, role TEXT, content TEXT,
      sources TEXT, token_usage TEXT, tool_calls TEXT, permission_decisions TEXT,
      runtime_error TEXT, runtime_status TEXT, proposal TEXT, order_index INTEGER, created_at TEXT
    );
  `);
}


test("mentioning a question's keywords never resolves it, including objections without punctuation", () => {
  const chat = conversation(1, "Explanation continuity");
  finishTurn(chat, "initial-question", "garden_chat", "Why does redistribution change the electric field?",
    "Redistribution changes the electric field through adjustment.");
  finishTurn(chat, "still-confused", "garden_chat", "what adjustment bro you cant just say the adjustment before like telling what happens",
    "The adjustment is redistribution.");
  for (let index = 0; index < 25; index += 1) finishTurn(chat, `padding-${index}`, "garden_chat", "Continue.", "Continuing.");
  memory.compactConversationMemoryIfNeeded(chat.id);
  const state = memory.loadConversationMemoryState(chat.id);
  assert.ok(state.workingState.openQuestions.some(q => q.includes("Why does redistribution")));
  assert.ok(state.workingState.openQuestions.some(q => q.includes("what adjustment bro")));
});
