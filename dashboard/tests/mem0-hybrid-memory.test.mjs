// The hybrid memory layer's promises:
//   1. lexical-only remains the answer whenever the semantic layer is absent;
//   2. semantic recall finds memories the lexical ranker cannot;
//   3. the same deterministic policy gates both channels — a forgotten memory
//      never returns, whichever channel found it;
//   4. the index converges on canon: edits reindex, supersedes retire, and a
//      permanent delete retires the vector even though the mirror row is gone.
//
// The mem0 engine itself is replaced by a deterministic in-process fake: these
// are tests of Breadboard's fusion, scoping and reconciliation, and a real
// engine would make them a test of ChatMock's uptime. `tests/mem0-live.test.mjs`
// covers the real engine, opt-in.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, beforeEach } from "node:test";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-mem0-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;

const { default: db } = await import("../src/lib/db.ts");
const store = await import("../src/lib/conversations/store.ts");
const memory = await import("../src/lib/conversations/memory.ts");
const inspection = await import("../src/lib/conversations/memory-inspection.ts");
const mirror = await import("../src/lib/mem0/mirror.ts");
const retrieval = await import("../src/lib/mem0/retrieval.ts");
const extraction = await import("../src/lib/mem0/extraction.ts");
const config = await import("../src/lib/mem0/config.ts");

const FINGERPRINT = "test-model@8";

after(() => {
  db.close();
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

beforeEach(() => {
  db.exec(`
    DELETE FROM mem0_tombstones;
    DELETE FROM mem0_mirrors;
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

/**
 * A deterministic stand-in for the mem0 engine. Similarity is token overlap on
 * a small hand-written synonym expansion — enough to relate "indent" to "tabs"
 * without any of the nondeterminism a real embedding model brings.
 */
function fakeSemanticClient(options = {}) {
  const entries = new Map();
  const calls = { index: 0, search: 0, remove: 0, extract: 0 };
  let nextId = 1;
  const SYNONYMS = {
    indent: ["tabs", "spaces", "indentation"],
    indentation: ["tabs", "spaces", "indent"],
    editor: ["vim", "emacs", "vscode"],
    database: ["sqlite", "postgres"],
  };
  const expand = (text) => {
    const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    const out = new Set(words);
    for (const word of words) for (const extra of SYNONYMS[word] ?? []) out.add(extra);
    return out;
  };
  return {
    calls,
    entries,
    async index(text, scope) {
      calls.index += 1;
      if (options.failIndex) throw new Error("embedding backend unreachable");
      for (const [id, entry] of entries) {
        if (entry.text === text && entry.userId === scope.userId) return id;
      }
      const id = `fake-${nextId++}`;
      entries.set(id, { text, userId: scope.userId });
      return id;
    },
    async search(query, scope) {
      calls.search += 1;
      if (options.failSearch) throw new Error("embedding backend unreachable");
      if (options.hangSearch) await new Promise(() => {});
      const queryTokens = expand(query);
      return [...entries.entries()]
        .filter(([, entry]) => entry.userId === scope.userId)
        .map(([id, entry]) => {
          const entryTokens = expand(entry.text);
          let overlap = 0;
          for (const token of queryTokens) if (entryTokens.has(token)) overlap += 1;
          return {
            mem0Id: id,
            text: entry.text,
            similarity: overlap / Math.max(1, Math.sqrt(queryTokens.size * entryTokens.size)),
          };
        })
        .filter((hit) => hit.similarity > 0)
        .sort((left, right) => right.similarity - left.similarity);
    },
    async extract(messages, scope) {
      calls.extract += 1;
      return (options.facts ?? []).map((text) => {
        const id = `fake-${nextId++}`;
        entries.set(id, { text, userId: scope.userId });
        return { mem0Id: id, text };
      });
    },
    async remove(mem0Id) {
      calls.remove += 1;
      entries.delete(mem0Id);
    },
  };
}

function conversationFor(userId = 1) {
  return store.createConversation({ userId, title: "Chat" });
}

function save(userId, content, overrides = {}) {
  return memory.saveDurableMemory({
    userId,
    content,
    kind: "preference",
    scope: "global",
    scopeId: null,
    state: "confirmed",
    confidence: 0.9,
    salience: 0.85,
    ...overrides,
  });
}

async function reconcile(client, userId = 1) {
  return mirror.reconcileSemanticMirrors({
    userId,
    client,
    fingerprint: FINGERPRINT,
    database: db,
  });
}

test("with no semantic client, retrieval stays lexical and reports nothing added", async () => {
  const conversation = conversationFor();
  save(1, "I prefer tabs over spaces");
  const result = await retrieval.hybridDurableMemories(
    {
      userId: 1,
      currentConversationId: conversation.id,
      query: "how should I indent?",
    },
    db,
    null,
  );
  assert.equal(result, null, "a null client must mean lexical-only, not an empty result");
});

test("semantic recall finds a memory the lexical ranker misses", async () => {
  const conversation = conversationFor();
  save(1, "I prefer tabs over spaces");
  const client = fakeSemanticClient();
  await reconcile(client);

  const query = "what indentation should I use?";
  const lexical = memory.retrieveDurableMemories({
    userId: 1,
    currentConversationId: conversation.id,
    query,
  }, db);
  assert.equal(lexical.length, 0, "no shared terms — the lexical ranker cannot see this");

  const hybrid = await retrieval.hybridDurableMemories(
    { userId: 1, currentConversationId: conversation.id, query },
    db,
    client,
  );
  assert.equal(hybrid?.length, 1);
  assert.equal(hybrid[0].content, "I prefer tabs over spaces");
});

test("a forgotten memory never returns through the semantic channel", async () => {
  const conversation = conversationFor();
  const row = save(1, "I prefer tabs over spaces");
  const client = fakeSemanticClient();
  await reconcile(client);
  assert.equal(client.entries.size, 1);

  // Forget it, then search BEFORE reconciling — the vector is still indexed.
  assert.equal(inspection.forgetDurableMemory(1, row.id, db), true);
  const hybrid = await retrieval.hybridDurableMemories(
    { userId: 1, currentConversationId: conversation.id, query: "indentation" },
    db,
    client,
  );
  assert.equal(hybrid, null, "a superseded row must not resurface from a stale index");
});

test("the semantic channel cannot cross user boundaries", async () => {
  const conversation = conversationFor(1);
  save(1, "I prefer tabs over spaces");
  save(2, "I prefer spaces over tabs");
  const client = fakeSemanticClient();
  await reconcile(client, 1);
  await reconcile(client, 2);

  const hybrid = await retrieval.hybridDurableMemories(
    { userId: 1, currentConversationId: conversation.id, query: "indentation" },
    db,
    client,
  );
  assert.equal(hybrid?.length, 1);
  assert.equal(hybrid[0].content, "I prefer tabs over spaces");
});

test("reconciliation is idempotent and follows edits and supersessions", async () => {
  const row = save(1, "I prefer tabs over spaces");
  const client = fakeSemanticClient();

  const first = await reconcile(client);
  assert.equal(first.indexed, 1);
  const second = await reconcile(client);
  assert.equal(second.indexed, 0, "an unchanged row must not be re-embedded");
  assert.equal(client.calls.index, 1);

  inspection.updateDurableMemoryContent(1, row.id, "I prefer spaces over tabs", db);
  const third = await reconcile(client);
  assert.equal(third.indexed, 1, "an edit must reindex");
  assert.equal(client.entries.size, 1, "the old vector must be retired, not accumulated");

  inspection.forgetDurableMemory(1, row.id, db);
  const fourth = await reconcile(client);
  assert.equal(fourth.removed, 1);
  assert.equal(client.entries.size, 0);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM mem0_mirrors").get().n,
    0,
    "the mirror row must go with the vector",
  );
});

test("a permanent delete retires the vector through a tombstone", async () => {
  const row = save(1, "I prefer tabs over spaces");
  const client = fakeSemanticClient();
  await reconcile(client);
  assert.equal(client.entries.size, 1);

  inspection.forgetDurableMemory(1, row.id, db);
  assert.equal(inspection.deleteDurableMemory(1, row.id, db), true);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM mem0_mirrors").get().n,
    0,
    "ON DELETE CASCADE removes the mirror row",
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM mem0_tombstones").get().n,
    1,
    "…so the trigger must have captured the mem0 id first",
  );

  const result = await reconcile(client);
  assert.equal(result.removed, 1);
  assert.equal(client.entries.size, 0, "the vector must not outlive a permanent delete");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM mem0_tombstones").get().n, 0);
});

test("an unreachable embedding backend degrades to lexical instead of failing", async () => {
  const conversation = conversationFor();
  save(1, "I prefer tabs over spaces");
  const failing = fakeSemanticClient({ failSearch: true, failIndex: true });
  const hybrid = await retrieval.hybridDurableMemories(
    { userId: 1, currentConversationId: conversation.id, query: "indentation" },
    db,
    failing,
  );
  assert.equal(hybrid, null);

  // The lexical path is untouched by the failure.
  const lexical = memory.retrieveDurableMemories({
    userId: 1,
    currentConversationId: conversation.id,
    query: "I prefer tabs",
  }, db);
  assert.equal(lexical.length, 1);
});

test("fusion keeps a memory both channels found ahead of one only lexical found", async () => {
  const conversation = conversationFor();
  save(1, "I prefer tabs over spaces for indentation");
  save(1, "the deploy script needs indentation checks", { kind: "project_fact" });
  const client = fakeSemanticClient();
  await reconcile(client);

  const hybrid = await retrieval.hybridDurableMemories(
    { userId: 1, currentConversationId: conversation.id, query: "indentation preference", limit: 2 },
    db,
    client,
  );
  assert.equal(hybrid?.length, 2, "both are relevant; fusion ranks rather than drops");
  assert.ok(
    hybrid.every((item) => typeof item.score === "number" && item.score > 0),
    "fused results still carry a policy score",
  );
});

test("extraction writes reviewable candidates, never confirmed memories", async () => {
  const conversation = conversationFor();
  const client = fakeSemanticClient({
    facts: ["Alice deploys on Fridays", "Alice prefers vim"],
  });
  const outcome = await extraction.extractDurableCandidates({
    userId: 1,
    conversationId: conversation.id,
    userText: "I always deploy on Fridays and I live in vim",
    assistantText: "Noted.",
    database: db,
    clientOverride: client,
  });
  assert.equal(outcome?.saved, 2);
  const rows = db.prepare("SELECT * FROM durable_memories WHERE user_id = 1").all();
  assert.equal(rows.length, 2);
  assert.ok(
    rows.every((row) => row.state === "candidate"),
    "an inferred fact is a proposal, not a confirmed memory",
  );
  assert.ok(rows.every((row) => row.confidence < 0.5));
});

test("extraction refuses to store a secret and retires it from the index", async () => {
  const conversation = conversationFor();
  const client = fakeSemanticClient({
    facts: ["Alice's api_key is sk-abcdefghijklmnop", "Alice prefers vim"],
  });
  const outcome = await extraction.extractDurableCandidates({
    userId: 1,
    conversationId: conversation.id,
    userText: "my api_key is sk-abcdefghijklmnop and I use vim",
    assistantText: "Noted.",
    database: db,
    clientOverride: client,
  });
  assert.equal(outcome?.saved, 1);
  assert.equal(outcome?.skipped, 1);
  const rows = db.prepare("SELECT content FROM durable_memories WHERE user_id = 1").all();
  assert.equal(rows.length, 1);
  assert.ok(!rows[0].content.includes("sk-"));
  assert.ok(
    ![...client.entries.values()].some((entry) => entry.text.includes("sk-")),
    "a rejected secret must be removed from the semantic index too",
  );
});

test("memory extraction never receives opted-out or unresolved deliberation turns", async () => {
  const conversation = conversationFor();
  const client = fakeSemanticClient({
    facts: ["Alice is considering whether to quit college"],
  });

  for (const userText of [
    "Should I quit college or not?",
    "If I should quit collage or not (dont stire this in memory).",
  ]) {
    const outcome = await extraction.extractDurableCandidates({
      userId: 1,
      conversationId: conversation.id,
      userText,
      assistantText: "Let us think it through.",
      database: db,
      clientOverride: client,
    });
    assert.equal(outcome, null);
  }

  assert.equal(client.calls.extract, 0);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS total FROM durable_memories").get().total,
    0,
  );
});

test("a rephrased deliberation is removed from the semantic index", async () => {
  const conversation = conversationFor();
  const client = fakeSemanticClient({
    facts: ["Alice is considering whether to quit college"],
  });
  const outcome = await extraction.extractDurableCandidates({
    userId: 1,
    conversationId: conversation.id,
    userText: "Tell me about educational options.",
    assistantText: "Here are the options.",
    database: db,
    clientOverride: client,
  });

  assert.deepEqual(outcome, { saved: 0, skipped: 1 });
  assert.equal(client.calls.remove, 1);
  assert.equal(client.entries.size, 0);
});

test("extraction reuses the fact's own vector rather than embedding it twice", async () => {
  const conversation = conversationFor();
  const client = fakeSemanticClient({ facts: ["Alice prefers vim"] });
  await extraction.extractDurableCandidates({
    userId: 1,
    conversationId: conversation.id,
    userText: "I live in vim",
    assistantText: "Noted.",
    database: db,
    clientOverride: client,
  });
  assert.equal(client.calls.index, 0, "extraction already embedded the fact");
  // Extraction stamps the mirror with the live config's fingerprint, which is
  // also what a real reconciler pass would use.
  const result = await mirror.reconcileSemanticMirrors({
    userId: 1,
    client,
    fingerprint: config.mem0Config().fingerprint,
    database: db,
  });
  assert.equal(result.indexed, 0, "the mirror is already current");
  assert.equal(client.calls.index, 0);
});

test("extraction refuses to claim a vector whose text differs from the saved row", async () => {
  const conversation = conversationFor();
  // Normalization collapses the whitespace, so the vector mem0 holds and the
  // row Breadboard stores are not the same string.
  const client = fakeSemanticClient({ facts: ["Alice    prefers   vim"] });
  const outcome = await extraction.extractDurableCandidates({
    userId: 1,
    conversationId: conversation.id,
    userText: "I live in vim",
    assistantText: "Noted.",
    database: db,
    clientOverride: client,
  });
  assert.equal(outcome?.saved, 1);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM mem0_mirrors").get().n,
    0,
    "a mismatched vector must not be claimed as the row's mirror",
  );

  // The next pass indexes the canonical text, so the index tells the truth.
  await mirror.reconcileSemanticMirrors({
    userId: 1,
    client,
    fingerprint: config.mem0Config({}).fingerprint,
    database: db,
  });
  const stored = db.prepare("SELECT content FROM durable_memories WHERE user_id = 1").get();
  assert.ok(
    [...client.entries.values()].some((entry) => entry.text === stored.content),
    "the index must end up holding exactly what the canonical row holds",
  );
});

test("a changed embedding model reindexes rather than mixing vector spaces", async () => {
  save(1, "I prefer tabs over spaces");
  const client = fakeSemanticClient();
  await reconcile(client);
  const before = db.prepare("SELECT fingerprint FROM mem0_mirrors").get().fingerprint;
  assert.equal(before, FINGERPRINT);

  const result = await mirror.reconcileSemanticMirrors({
    userId: 1,
    client,
    fingerprint: "other-model@1024",
    database: db,
  });
  assert.equal(result.indexed, 1, "a new vector space must be rebuilt, not reused");
  assert.equal(
    db.prepare("SELECT fingerprint FROM mem0_mirrors").get().fingerprint,
    "other-model@1024",
  );
});

test("reconciliation respects its budget and leaves the rest pending", async () => {
  for (let index = 0; index < 10; index += 1) save(1, `preference number ${index}`);
  const client = fakeSemanticClient();
  const result = await mirror.reconcileSemanticMirrors({
    userId: 1,
    client,
    fingerprint: FINGERPRINT,
    database: db,
    itemBudget: 3,
  });
  assert.equal(result.indexed, 3);
  assert.ok(result.pending > 0, "the backlog must be reported, not silently dropped");

  // Successive passes warm the index the rest of the way.
  await mirror.reconcileSemanticMirrors({
    userId: 1, client, fingerprint: FINGERPRINT, database: db, itemBudget: 100,
  });
  assert.equal(client.entries.size, 10);
});

test("the vector store path changes with the embedding model", () => {
  const first = config.mem0Config({
    BREADBOARD_EMBEDDING_MODEL: "model-a",
    BREADBOARD_EMBEDDING_DIMENSIONS: "384",
  });
  const second = config.mem0Config({
    BREADBOARD_EMBEDDING_MODEL: "model-b",
    BREADBOARD_EMBEDDING_DIMENSIONS: "1536",
  });
  assert.notEqual(first.vectorStorePath, second.vectorStorePath);
  assert.notEqual(first.fingerprint, second.fingerprint);
});

test("switching embeddings off switches the semantic layer off", () => {
  const off = config.mem0Config({ BREADBOARD_EMBEDDINGS: "off" });
  assert.equal(off.enabled, false);
  assert.equal(off.extractionEnabled, false);
});

test("the settings status reports index coverage, not intent", async () => {
  const status = await import("../src/lib/mem0/status.ts");
  save(1, "I prefer tabs over spaces");
  save(1, "the deploy script runs on Fridays", { kind: "project_fact" });

  const before = await status.semanticMemoryStatus(1, db, {});
  assert.equal(before.totalMemories, 2);
  assert.equal(before.indexedMemories, 0, "nothing is indexed until a pass runs");

  const client = fakeSemanticClient();
  await mirror.reconcileSemanticMirrors({
    userId: 1,
    client,
    fingerprint: config.mem0Config({}).fingerprint,
    database: db,
  });
  const after = await status.semanticMemoryStatus(1, db, {});
  assert.equal(after.indexedMemories, 2);
  assert.equal(after.totalMemories, 2);
});

test("the settings status is observational and never imports or starts mem0", async () => {
  const status = await import("../src/lib/mem0/status.ts");
  const reported = await status.semanticMemoryStatus(1, db, {});
  assert.equal(reported.engineAvailable, false);
  assert.match(reported.degradedReason ?? "", /Runtime service owner/i);
  const source = fs.readFileSync(
    new URL("../src/lib/mem0/status.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /mem0ai\/oss|semanticMemoryClient|acquireServiceLease/);
});

test("the dashboard mem0 client has no in-process engine fallback", async () => {
  const source = fs.readFileSync(
    new URL("../src/lib/mem0/client.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /mem0ai\/oss|new Memory\s*\(/);
  assert.match(source, /acquireServiceLease\(\s*"mem0-semantic-engine"/);
  assert.match(source, /BREADBOARD_MEM0_SERVICE_TOKEN/);
  const { semanticMemoryClient } = await import("../src/lib/mem0/client.ts");
  assert.equal(await semanticMemoryClient({}), null);
});

test("the settings status explains why recall is degraded", async () => {
  const status = await import("../src/lib/mem0/status.ts");
  const off = await status.semanticMemoryStatus(1, db, { BREADBOARD_EMBEDDINGS: "off" });
  assert.equal(off.enabled, false);
  assert.match(off.degradedReason ?? "", /wording only/i);
  assert.match(off.degradedReason ?? "", /BREADBOARD_EMBEDDINGS/);

  const disabled = await status.semanticMemoryStatus(1, db, { BREADBOARD_MEM0: "off" });
  assert.match(disabled.degradedReason ?? "", /BREADBOARD_MEM0/);
});

test("extraction stays off unless explicitly enabled", () => {
  assert.equal(config.mem0Config({}).extractionEnabled, false);
  assert.equal(
    config.mem0Config({ BREADBOARD_MEM0_EXTRACTION: "on" }).extractionEnabled,
    true,
  );
  assert.equal(
    config.mem0Config({ BREADBOARD_MEM0: "off", BREADBOARD_MEM0_EXTRACTION: "on" })
      .extractionEnabled,
    false,
    "the master switch must win",
  );
});
