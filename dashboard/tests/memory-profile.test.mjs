import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, beforeEach } from "node:test";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-memory-profile-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;

const { default: db } = await import("../src/lib/db.ts");
const store = await import("../src/lib/conversations/store.ts");
const memory = await import("../src/lib/conversations/memory.ts");
const profiles = await import("../src/lib/conversations/memory-profile.ts");
const inspection = await import("../src/lib/conversations/memory-inspection.ts");

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
  db.prepare(
    "INSERT INTO users(id, username, email, password_hash) VALUES (2, 'bob', 'bob@example.test', 'x')",
  ).run();
});

function addTurn(conversation, id, text) {
  store.reserveConversationTurn({
    conversation,
    clientMessageId: id,
    surface: conversation.surface,
    content: text,
  });
  store.completeAssistantMessage({
    conversationId: conversation.id,
    clientMessageId: id,
    content: "Completed answer",
  });
}

function fakeProfileFetcher(summary, captured = []) {
  return async (url, init) => {
    captured.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
    return new Response(
      JSON.stringify({ choices: [{ message: { content: summary } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
}

test("profile synthesis combines eligible chats and atomic memories as weak context", async () => {
  const technical = store.createConversation({ userId: 1, title: "Local AI setup" });
  addTurn(technical, "profile-safe-1", "I enjoy building local AI tools and open-source software.");
  const learning = store.createConversation({ userId: 1, title: "Engineering study" });
  addTurn(learning, "profile-safe-2", "I study electrical engineering and prefer evidence-heavy explanations.");
  const style = store.createConversation({ userId: 1, title: "Response style" });
  addTurn(style, "profile-safe-3", "Please challenge my assumptions instead of just agreeing with me.");
  memory.saveDurableMemory({
    userId: 1,
    content: "The user's name is Kuzey.",
    kind: "project_fact",
    scope: "global",
    state: "confirmed",
    confidence: 0.95,
    salience: 0.9,
  });

  const captured = [];
  const outcome = await profiles.synthesizeMemoryProfile({
    userId: 1,
    force: true,
    database: db,
    fetcher: fakeProfileFetcher(
      "## Overview\n\nThe user's name is Kuzey and they study electrical engineering.\n\n## Conversation Style\n\nThey prefer evidence and constructive disagreement.",
      captured,
    ),
    baseUrl: "http://127.0.0.1:8765/v1",
    model: "default",
  });

  assert.equal(outcome.result, "generated");
  assert.equal(outcome.profile.status, "ready");
  assert.equal(outcome.profile.source, "generated");
  assert.equal(captured.length, 1);
  assert.match(captured[0].url, /\/v1\/chat\/completions$/);
  const sent = JSON.stringify(captured[0].body);
  assert.match(sent, /local AI tools/);
  assert.match(sent, /name is Kuzey/);
  assert.ok(sent.length < 50_000, "the consolidation request must remain hard-bounded");

  const current = store.createConversation({ userId: 1, title: "New chat" });
  const bundle = memory.loadConversationMemoryBundle({
    conversation: current,
    query: "How should you respond?",
    projectScopeId: "breadboard",
  });
  assert.match(bundle.profileSummary, /constructive disagreement/);
  const context = memory.composeMemoryContext(bundle);
  assert.match(context, /synthesized_user_profile/);
  assert.match(context, /synthesized user profile/);
});

test("opt-outs, secrets, and unresolved personal deliberations never reach synthesis", async () => {
  const chat = store.createConversation({ userId: 1, title: "Mixed privacy" });
  addTurn(chat, "profile-safe-a", "I often work on TypeScript desktop applications.");
  addTurn(chat, "profile-safe-b", "I prefer concise technical explanations with evidence.");
  addTurn(chat, "profile-safe-c", "I like open-source tools that run locally.");
  addTurn(chat, "profile-private-a", "Should I quit college or not?");
  addTurn(chat, "profile-private-b", "If I should quit collage or not (dont stire this in memory).");
  addTurn(chat, "profile-secret-a", "My api_key is sk-abcdefghijklmnop and this is a test.");

  const captured = [];
  const outcome = await profiles.synthesizeMemoryProfile({
    userId: 1,
    force: true,
    database: db,
    fetcher: fakeProfileFetcher(
      "## Overview\n\nThe user builds local TypeScript desktop applications.\n\n## Preferences\n\nThey prefer concise, evidence-based explanations.",
      captured,
    ),
  });
  assert.equal(outcome.result, "generated");
  const sent = JSON.stringify(captured[0].body);
  assert.doesNotMatch(sent, /quit (?:college|collage)/i);
  assert.doesNotMatch(sent, /sk-abcdefghijklmnop/i);
  assert.match(sent, /TypeScript desktop applications/);
});

test("automatic synthesis refreshes after every eligible completed message", async () => {
  const chat = store.createConversation({ userId: 1, title: "Gradual profile" });
  const captured = [];
  const fetcher = fakeProfileFetcher("## Overview\n\nThe user likes systems engineering.", captured);
  addTurn(chat, "profile-gradual-1", "I like systems engineering.");

  const first = await profiles.synthesizeMemoryProfile({ userId: 1, database: db, fetcher });
  assert.equal(first.result, "generated");
  assert.equal(captured.length, 1);

  addTurn(chat, "profile-gradual-2", "I build desktop tools.");
  const second = await profiles.synthesizeMemoryProfile({ userId: 1, database: db, fetcher });
  assert.equal(second.result, "generated");
  assert.equal(captured.length, 2, "each new eligible message refreshes the profile");
});

test("a completed turn schedules its profile refresh immediately", async () => {
  const chat = store.createConversation({ userId: 1, title: "Live profile" });
  addTurn(chat, "profile-live-1", "I prefer practical examples with concise explanations.");
  const originalFetch = globalThis.fetch;
  const captured = [];
  globalThis.fetch = fakeProfileFetcher(
    "## Conversation Style\n\nThe user prefers concise explanations with practical examples.",
    captured,
  );

  try {
    profiles.scheduleMemoryProfileSynthesisForConversation({
      conversationId: chat.id,
      outcome: "completed",
    }, db);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (profiles.getMemoryProfile(1, db).status === "ready") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const profile = profiles.getMemoryProfile(1, db);
    assert.equal(profile.status, "ready");
    assert.equal(profile.pendingMessageCount, 0);
    assert.equal(captured.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("profiles are user-scoped, always on, and independent from atomic memories", async () => {
  const alice = profiles.editMemoryProfile(
    1,
    "## Overview\n\nAlice prefers locally hosted engineering tools.",
    db,
  );
  assert.ok(alice);
  assert.equal(profiles.getMemoryProfile(2, db).summary, "");

  db.prepare(`
    UPDATE memory_profiles SET generation_enabled = 0, use_in_chats = 0 WHERE user_id = 1
  `).run();
  const repaired = profiles.getMemoryProfile(1, db);
  assert.equal(repaired.generationEnabled, true);
  assert.equal(repaired.useInChats, true);
  const chat = store.createConversation({ userId: 1, title: "Profile context" });
  const enabledBundle = memory.loadConversationMemoryBundle({ conversation: chat, query: "tools" }, db);
  assert.match(enabledBundle.profileSummary, /locally hosted/);

  memory.saveDurableMemory({
    userId: 1,
    content: "Prefer metric units.",
    kind: "preference",
    scope: "global",
    state: "confirmed",
    confidence: 0.9,
    salience: 0.8,
  });
  profiles.clearMemoryProfile(1, db);
  assert.equal(profiles.getMemoryProfile(1, db).summary, "");
  assert.equal(
    db.prepare("SELECT COUNT(*) AS total FROM durable_memories WHERE user_id = 1").get().total,
    1,
    "clearing the synthesized portrait must not delete atomic memory",
  );
});

test("changing an atomic memory invalidates the synthesized profile immediately", () => {
  profiles.editMemoryProfile(
    1,
    "## Overview\n\nThe user's name is Kuzey and they prefer concise answers.",
    db,
  );
  const durable = memory.saveDurableMemory({
    userId: 1,
    content: "The user's name is Kuzey.",
    kind: "project_fact",
    scope: "global",
    state: "confirmed",
    confidence: 0.9,
    salience: 0.8,
  });
  assert.deepEqual(
    inspection.updateDurableMemoryContent(1, durable.id, "The user's name is Kuzey Atay.", db),
    { status: "updated", content: "The user's name is Kuzey Atay." },
  );
  assert.equal(profiles.getMemoryProfile(1, db).summary, "");
});

test("cleared or forgotten profile facts are not rebuilt from old chat history", async () => {
  const chat = store.createConversation({ userId: 1, title: "Old personal context" });
  addTurn(chat, "profile-old-1", "My name is Kuzey.");
  addTurn(chat, "profile-old-2", "I study electrical engineering.");
  addTurn(chat, "profile-old-3", "I prefer concise explanations.");
  profiles.editMemoryProfile(
    1,
    "## Overview\n\nThe user's name is Kuzey and they study electrical engineering.",
    db,
  );

  profiles.clearMemoryProfile(1, db);
  const captured = [];
  const outcome = await profiles.synthesizeMemoryProfile({
    userId: 1,
    force: true,
    database: db,
    fetcher: fakeProfileFetcher("## Overview\n\nOld information returned.", captured),
  });

  assert.equal(outcome.result, "skipped");
  assert.equal(captured.length, 0, "clearing must create a history boundary");
  assert.equal(profiles.getMemoryProfile(1, db).summary, "");
});

test("a user edit made during generation wins the race", async () => {
  const chat = store.createConversation({ userId: 1, title: "Profile race" });
  addTurn(chat, "profile-race-1", "I like local-first software.");
  addTurn(chat, "profile-race-2", "I work on desktop applications.");
  addTurn(chat, "profile-race-3", "I prefer concise technical writing.");

  let release;
  const fetcher = () => new Promise((resolve) => {
    release = () => resolve(new Response(
      JSON.stringify({
        choices: [{ message: { content: "## Overview\n\nStale generated profile." } }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
  });
  const running = profiles.synthesizeMemoryProfile({
    userId: 1,
    force: true,
    database: db,
    fetcher,
  });
  assert.equal(profiles.getMemoryProfile(1, db).status, "generating");
  profiles.editMemoryProfile(
    1,
    "## Overview\n\nThe user-written profile must remain authoritative.",
    db,
  );
  release();
  const outcome = await running;
  assert.equal(outcome.result, "skipped");
  assert.match(profiles.getMemoryProfile(1, db).summary, /user-written profile/);
  assert.doesNotMatch(profiles.getMemoryProfile(1, db).summary, /Stale generated/);
});
