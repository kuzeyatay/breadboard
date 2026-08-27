// Temporary chat: what "off the record" has to mean end to end.
//
// The toggle in the terminal is one boolean on the conversation row, but the
// promise it makes is only as good as the narrowest gate it holds. These tests
// walk the gates one at a time — the two directions memory can flow, the two
// places a chat can resurface (history and search), and the one instruction
// ("remember this") that normally outranks everything else and here must not.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, beforeEach } from "node:test";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-temporary-chat-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;
// The semantic layer has its own tests; here it would only add a network call.
process.env.BREADBOARD_MEM0 = "off";
delete process.env.BREADBOARD_AGENT_MEMORY;
delete process.env.BREADBOARD_AGENT_MEMORY_AGENTS;

const { default: db } = await import("../src/lib/db.ts");
const store = await import("../src/lib/conversations/store.ts");
const memory = await import("../src/lib/conversations/memory.ts");
const profiles = await import("../src/lib/conversations/memory-profile.ts");
const titles = await import("../src/lib/conversations/title-service.ts");
const agentMemory = await import("../src/lib/conversations/agent-memory-context.ts");

after(() => {
  db.close();
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

beforeEach(() => {
  db.exec(`
    DELETE FROM memory_profiles;
    DELETE FROM durable_memories;
    DELETE FROM conversations;
    DELETE FROM users;
    DELETE FROM sqlite_sequence;
  `);
  db.prepare(
    "INSERT INTO users(id, username, email, password_hash) VALUES (1, 'alice', 'alice@example.test', 'x')",
  ).run();
});

function addTurn(conversation, id, text, answer = "Completed answer") {
  store.reserveConversationTurn({
    conversation,
    clientMessageId: id,
    surface: conversation.surface,
    content: text,
  });
  store.completeAssistantMessage({
    conversationId: conversation.id,
    clientMessageId: id,
    content: answer,
  });
}

function rememberedFact(content, sourceConversationId = null) {
  return memory.saveDurableMemory({
    userId: 1,
    content,
    kind: "project_fact",
    scope: "global",
    state: "confirmed",
    confidence: 0.95,
    salience: 0.9,
    sourceConversationId,
  });
}

test("a temporary chat is created off the record and says so to the client", () => {
  const temporary = store.createConversation({ userId: 1, title: "Off record", temporary: true });
  const ordinary = store.createConversation({ userId: 1, title: "On record" });

  assert.equal(store.conversationIsTemporary(temporary), true);
  assert.equal(store.conversationIsTemporary(ordinary), false);
  assert.equal(store.presentConversation(temporary).temporary, true);
  assert.equal(store.presentConversation(ordinary).temporary, false);
});

test("a temporary chat never appears in history", () => {
  const ordinary = store.createConversation({ userId: 1, title: "On record" });
  const temporary = store.createConversation({ userId: 1, title: "Off record", temporary: true });
  addTurn(temporary, "temp-listed-01", "Something private.");

  const listed = store.listConversationsForUser(1).map((row) => row.id);
  assert.deepEqual(listed, [ordinary.id]);
});

test("no cross-chat memory is read into a temporary chat", () => {
  rememberedFact("The user's build server is called Halcyon.");
  const temporary = store.createConversation({ userId: 1, title: "Off record", temporary: true });

  const bundle = memory.loadConversationMemoryBundle({
    conversation: temporary,
    query: "What is my build server called?",
    projectScopeId: "breadboard",
  });

  assert.equal(bundle.temporary, true);
  assert.deepEqual(bundle.durableMemories, []);
  assert.equal(bundle.profileSummary, "");
  assert.equal(bundle.crossConversation, null);
  // The assistant is told, rather than finding out by being refused.
  assert.match(memory.composeMemoryContext(bundle), /This is a temporary chat\./);
  // The same question in an ordinary chat is the control: the memory exists and
  // is retrievable, so the empty bundle above is the mode, not an empty store.
  const ordinary = store.createConversation({ userId: 1, title: "On record" });
  const control = memory.loadConversationMemoryBundle({
    conversation: ordinary,
    query: "What is my build server called?",
    projectScopeId: "breadboard",
  });
  assert.equal(control.durableMemories.length, 1);
  assert.equal(control.temporary, false);
  assert.doesNotMatch(memory.composeMemoryContext(control), /This is a temporary chat\./);
});

test("a temporary chat keeps its own thread of context", () => {
  const temporary = store.createConversation({ userId: 1, title: "Off record", temporary: true });
  addTurn(temporary, "temp-context-01", "Call the prototype Kestrel for now.");

  const bundle = memory.loadConversationMemoryBundle({
    conversation: temporary,
    query: "What did I call the prototype?",
    projectScopeId: "breadboard",
  });
  assert.match(
    bundle.recentMessages.map((message) => message.content).join("\n"),
    /Kestrel/,
  );
});

test("nothing said in a temporary chat becomes durable memory, not even on request", () => {
  const temporary = store.createConversation({ userId: 1, title: "Off record", temporary: true });

  const saved = memory.maintainDurableMemoryFromUserTurn({
    conversation: temporary,
    content: "Please remember globally: my deployment window is Thursday evening.",
  });
  assert.equal(saved, null);

  // The identical instruction in an ordinary chat does write, so the refusal
  // above is about the chat rather than about the sentence.
  const ordinary = store.createConversation({ userId: 1, title: "On record" });
  const written = memory.maintainDurableMemoryFromUserTurn({
    conversation: ordinary,
    content: "Please remember globally: my deployment window is Thursday evening.",
  });
  assert.ok(written);
  assert.match(written.content, /Thursday evening/);
});

test("a temporary chat is not a candidate for an explicit cross-chat reference", () => {
  const temporary = store.createConversation({ userId: 1, title: "Off record", temporary: true });
  addTurn(temporary, "temp-cross-01", "The staging password rotation is on Fridays.", "Noted.");
  const current = store.createConversation({ userId: 1, title: "Current" });

  assert.equal(
    memory.retrieveExplicitCrossConversationContext({
      userId: 1,
      currentConversationId: current.id,
      query: "In our previous chat, what did we say about the rotation?",
    }),
    null,
  );
});

test("a temporary chat is not evidence for the synthesized profile", async () => {
  const temporary = store.createConversation({ userId: 1, title: "Off record", temporary: true });
  addTurn(temporary, "temp-profile-01", "I am quietly job hunting at the moment.");
  addTurn(temporary, "temp-profile-02", "I would rather my manager did not know.");
  addTurn(temporary, "temp-profile-03", "Help me think through the timing.");
  const ordinary = store.createConversation({ userId: 1, title: "On record" });
  addTurn(ordinary, "kept-profile-01", "I study electrical engineering.");
  addTurn(ordinary, "kept-profile-02", "I prefer evidence-heavy explanations.");
  addTurn(ordinary, "kept-profile-03", "Please challenge my assumptions.");

  const captured = [];
  await profiles.synthesizeMemoryProfile({
    userId: 1,
    database: db,
    force: true,
    fetcher: async (url, init) => {
      captured.push(String(JSON.parse(String(init?.body ?? "{}")).messages?.at(-1)?.content ?? ""));
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "## Overview\n\nThe user studies engineering." } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
  });

  const evidence = captured.join("\n");
  assert.match(evidence, /electrical engineering/);
  assert.doesNotMatch(evidence, /job hunting/);
});

test("finishing a temporary turn schedules no profile synthesis", () => {
  const temporary = store.createConversation({ userId: 1, title: "Off record", temporary: true });
  addTurn(temporary, "temp-schedule-01", "Something private.");
  // A scheduled refresh is observable as the row the scheduler has to create
  // before it can queue anything.
  profiles.scheduleMemoryProfileSynthesisForConversation({
    conversationId: temporary.id,
    outcome: "completed",
  }, db);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM memory_profiles WHERE user_id = 1").get().n,
    0,
  );
});

test("a temporary chat is never named by the title model", async () => {
  const temporary = store.createConversation({ userId: 1, title: "New chat", temporary: true });
  let called = false;
  const applied = await titles.generateAndApplyConversationTitle({
    conversation: temporary,
    firstPrompt: "Help me think through a private decision.",
    fetcher: async () => {
      called = true;
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "Private decision help" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
  });
  assert.equal(applied, null);
  assert.equal(called, false, "the transcript must not reach the title model");
  assert.equal(store.getConversationById(temporary.id).title, "New chat");
});

// The toggle itself. Source-shape assertions, in the house style for the
// terminal's chrome: what matters is that the switch creates chats rather than
// relabels them, and that leaving is always possible from either direction.

const terminal = fs.readFileSync(
  new URL("../src/app/components/hermes/dashboard-agent-terminal.tsx", import.meta.url),
  "utf8",
);
const agentSession = fs.readFileSync(
  new URL("../src/app/components/hermes/use-agent-session.ts", import.meta.url),
  "utf8",
);
const runtimePanel = fs.readFileSync(
  new URL("../src/app/components/hermes/agent-runtime-panel.tsx", import.meta.url),
  "utf8",
);
const globalCss = fs.readFileSync(
  new URL("../src/app/globals.css", import.meta.url),
  "utf8",
);
const emptyState = fs.readFileSync(
  new URL("../src/app/components/hermes/chat-greeting-empty-state.tsx", import.meta.url),
  "utf8",
);
const greetingEngine = fs.readFileSync(
  new URL("../src/lib/hermes/chat-greeting.ts", import.meta.url),
  "utf8",
);

test("the switch floats in the corner of the new chat page, not in the toolbar", () => {
  assert.match(
    terminal,
    /const newChatPageSelected =\s*session\.sessionId === null &&\s*session\.messages\.length === 0 &&\s*!currentChatActive;/,
  );
  assert.match(
    terminal,
    /\{newChatPageSelected \? \(\s*<button[\s\S]{0,220}onClick=\{toggleTemporaryChat\}/,
  );
  assert.match(terminal, /aria-pressed=\{temporaryChat\}/);
  assert.match(terminal, /onClick=\{toggleTemporaryChat\}/);
  // A bare glyph in the chat's own top-right corner: no raised button, no
  // border, and no vertical space taken from an ordinary chat.
  assert.match(terminal, /className=\{`absolute right-3 top-2 z-20 flex h-10 w-10/);
  assert.doesNotMatch(
    terminal,
    /neu-button-icon[^`]*\n?[^`]*aria-pressed=\{temporaryChat\}/,
  );
  // Announced in words as well as in state, because the mode is a promise.
  assert.match(terminal, /Temporary chat\./);
});

test("the switch wears a tick while the mode is on", () => {
  assert.match(
    terminal,
    /temporaryChat \? \(\s*<path strokeWidth=\{2\} d="M8\.6 12\.1l2\.4 2\.4 4\.6-5" \/>/,
  );
});

test("what the user says in a temporary chat is drawn on a broken outline", () => {
  // One attribute on the transcript root drives every user bubble, including
  // the ones rendered by nested components.
  assert.match(runtimePanel, /data-temporary-chat=\{temporaryChat \? "true" : undefined\}/);
  assert.match(terminal, /temporaryChat=\{temporaryChat\}/);
  assert.match(
    globalCss,
    /\[data-temporary-chat="true"\] \.neu-chat-message-user \{[^}]*border-style: dashed;/,
  );
  // The raised shadow goes with it: nothing about to disappear should look
  // pressed into the paper.
  assert.match(
    globalCss,
    /\[data-temporary-chat="true"\] \.neu-chat-message-user \{[^}]*box-shadow: none;/,
  );
  // It has to win over the base rule it is overriding, so it must come after it.
  assert.ok(
    globalCss.indexOf('[data-temporary-chat="true"] .neu-chat-message-user') >
      globalCss.indexOf(".neu-chat-message-user {"),
  );
});

test("the blank temporary chat asks for different things, and says so without a disclaimer", () => {
  // The greeting and the openers are chosen by the hour now, so the mode is
  // something the terminal hands to that engine rather than a branch in the
  // markup. What must not change is that the mode still reaches it.
  assert.match(terminal, /useChatGreeting\(\{ scope, temporary: temporaryChat \}\)/);
  assert.match(greetingEngine, /const TEMPORARY_OWN_SUGGESTIONS: SuggestionCandidate\[\] = \[/);
  assert.match(greetingEngine, /const TEMPORARY_PUBLIC_SUGGESTIONS: SuggestionCandidate\[\] = \[/);
  // Both scopes are covered: the mode is available over the public hub too.
  assert.match(
    greetingEngine,
    /if \(context\.temporary\) \{\s*\n\s*return context\.scope === "public"\s*\n?\s*\? TEMPORARY_PUBLIC_SUGGESTIONS\s*\n?\s*: TEMPORARY_OWN_SUGGESTIONS;/,
  );
  // The banner above the transcript already says what is switched off, so the
  // empty state does not say it a second time — and never did say it twice.
  assert.doesNotMatch(terminal, /Answers are still grounded/);
  assert.doesNotMatch(terminal, /Answers are grounded in the notes/);
  assert.doesNotMatch(emptyState, /Answers are grounded/);
  // Off the record, the cards wear the same broken outline as the messages.
  assert.match(emptyState, /className="bb-terminal-suggestion neu-button/);
  assert.match(
    globalCss,
    /\[data-temporary-chat="true"\] \.bb-terminal-suggestion \{[^}]*border-style: dashed;/,
  );
  assert.match(
    globalCss,
    /\[data-temporary-chat="true"\] \.bb-terminal-suggestion \{[^}]*box-shadow: none;/,
  );
  // Hover must not put the raised shadow back on a card that is about to go.
  assert.match(
    globalCss,
    /\[data-temporary-chat="true"\] \.bb-terminal-suggestion:hover:not\(:disabled\) \{[^}]*box-shadow: none;/,
  );
  assert.ok(
    globalCss.indexOf('[data-temporary-chat="true"] .bb-terminal-suggestion') >
      globalCss.indexOf(".neu-button,"),
  );
});

test("toggling temporary chat starts or restores a chat rather than relabelling one", () => {
  assert.match(
    terminal,
    /const sessionCreateOptions = useMemo\(\s*\(\) => \(\{[\s\S]{0,160}title: "New chat",[\s\S]{0,80}temporary: temporaryChat,[\s\S]{0,100}restoreLastConversation: false/,
  );
  // On: remember where we were, then start a fresh off-record chat.
  assert.match(
    terminal,
    /chatBeforeTemporary\.current = session\.sessionId;\s*setTemporaryChat\(true\);\s*startNewChat\(\);/,
  );
  // Off: back to that chat, or to a blank ordinary one.
  assert.match(terminal, /if \(previous\) openHistorySession\(previous\);\s*else startNewChat\(\);/);
  // Both other ways out of the mode: the rail's New chat and opening history.
  assert.match(terminal, /function startNewSavedChat\(\)/);
  assert.match(terminal, /onNewChat=\{startNewSavedChat\}/);
});

test("temporary mode cannot reset a chat while its response is still active", () => {
  // The guard covers the optimistic Thinking window as well as established
  // streams and external-agent runs. Keeping it in the handler protects the
  // transition itself; disabled makes the constraint visible and accessible.
  assert.match(
    terminal,
    /function toggleTemporaryChat\(\) \{[\s\S]{0,600}if \(currentChatActive\) return;/,
  );
  assert.match(
    terminal,
    /onClick=\{toggleTemporaryChat\}\s*disabled=\{currentChatActive\}/,
  );
  assert.match(
    terminal,
    /currentChatActive\s*\? "Temporary chat can be changed after the current response finishes"/,
  );
});

test("the browser does not keep a pointer to a temporary chat", () => {
  assert.match(agentSession, /if \(temporaryChats\) return;\s*window\.localStorage\.setItem\(storageKey, id\)/);
  assert.doesNotMatch(
    agentSession,
    /rememberActiveConversation\(ensured\.id\);\s*window\.localStorage/,
  );
});

test("an external agent launched from a temporary chat is given no memory", async () => {
  rememberedFact("The user's build server is called Halcyon.");
  const temporary = store.createConversation({ userId: 1, title: "Off record", temporary: true });
  const ordinary = store.createConversation({ userId: 1, title: "On record" });
  const env = { BREADBOARD_AGENT_MEMORY_AGENTS: "deep_research" };

  assert.equal(
    await agentMemory.composeAgentMemoryContext({
      userId: 1,
      agentId: "deep_research",
      query: "Research build server options for Halcyon.",
      conversationPublicId: temporary.public_id,
      env,
    }, db),
    null,
  );
  const allowed = await agentMemory.composeAgentMemoryContext({
    userId: 1,
    agentId: "deep_research",
    query: "Research build server options for Halcyon.",
    conversationPublicId: ordinary.public_id,
    env,
  }, db);
  assert.match(allowed?.text ?? "", /Halcyon/);
});
