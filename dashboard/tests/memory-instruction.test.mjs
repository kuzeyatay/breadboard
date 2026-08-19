import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, beforeEach } from "node:test";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-memory-instruction-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;

const { default: db } = await import("../src/lib/db.ts");
const store = await import("../src/lib/conversations/store.ts");
const memory = await import("../src/lib/conversations/memory.ts");
const inspection = await import("../src/lib/conversations/memory-inspection.ts");
const instructions = await import("../src/lib/conversations/memory-instruction.ts");

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

const panel = source("../src/app/components/settings-agent-memory.tsx");
const route = source("../src/app/api/agent-memory/instruct/route.ts");

const SUMMARY = "## Overview\n\nThe user was born on 23 June 2006.";

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

/** Answers the planning call and the summary call separately, by system prompt. */
function fakeFetcher(options = {}) {
  const captured = options.captured ?? [];
  return async (url, init) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const system = String(body.messages?.[0]?.content ?? "");
    const planning = system.startsWith("You edit a user's long-term memory");
    captured.push({ url: String(url), planning, body });
    if (options.offline || (planning && options.planOffline)) {
      return new Response("upstream unavailable", { status: 502 });
    }
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: planning ? options.plan : options.summary ?? SUMMARY } }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
}

function seedMemory(userId, content, kind = "project_fact") {
  return memory.saveDurableMemory({
    userId,
    content,
    kind,
    scope: "global",
    state: "confirmed",
    confidence: 0.95,
    salience: 0.9,
  });
}

test("a typed instruction becomes a memory later chats retrieve", async () => {
  const captured = [];
  const outcome = await instructions.applyMemoryInstruction({
    userId: 1,
    instruction: "remember that my birthday is 23rd of june 2006",
    fetcher: fakeFetcher({
      captured,
      plan: JSON.stringify({
        operations: [
          {
            action: "add",
            content: "The user's birthday is 23 June 2006.",
            kind: "project_fact",
          },
        ],
        reply: "Saved your birthday.",
      }),
    }),
  });

  assert.equal(outcome.result, "applied");
  assert.equal(outcome.planner, "model");
  assert.equal(outcome.reply, "Saved your birthday.");
  assert.deepEqual(outcome.changes.map((change) => change.action), ["add"]);

  const stored = inspection.listDurableMemories(1);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].content, "The user's birthday is 23 June 2006.");
  assert.equal(stored[0].state, "confirmed");
  // No chat and no garden is behind a settings edit, so it has to be global to
  // be worth anything at all.
  assert.equal(stored[0].scope, "global");

  const later = store.createConversation({ userId: 1, title: "A later chat" });
  const recalled = memory.retrieveDurableMemories({
    userId: 1,
    currentConversationId: later.id,
    query: "when is my birthday",
  });
  assert.ok(recalled.some((item) => item.content.includes("23 June 2006")));

  // The panel shows a summary, so the instruction has to reach the summary too.
  assert.equal(outcome.summaryRefreshed, true);
  assert.match(outcome.profile.summary, /23 June 2006/);
  const synthesis = captured.find((call) => !call.planning);
  assert.match(synthesis.body.messages[1].content, /Direct instruction from the user/);
  assert.match(synthesis.body.messages[1].content, /23rd of june 2006/);
});

test("a correction rewrites the memory it names and leaves other accounts alone", async () => {
  const mine = seedMemory(1, "The user's laptop is a ThinkPad X1.");
  const theirs = seedMemory(2, "The user's laptop is a MacBook Air.");

  const outcome = await instructions.applyMemoryInstruction({
    userId: 1,
    instruction: "actually my laptop is a Framework 13 now",
    fetcher: fakeFetcher({
      plan: JSON.stringify({
        operations: [
          { action: "update", id: mine.id, content: "The user's laptop is a Framework 13." },
        ],
        reply: "Updated your laptop.",
      }),
    }),
  });

  assert.equal(outcome.result, "applied");
  assert.deepEqual(outcome.changes.map((change) => change.action), ["update"]);
  const stored = inspection.listDurableMemories(1);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].content, "The user's laptop is a Framework 13.");
  assert.equal(
    inspection.listDurableMemories(2)[0].content,
    "The user's laptop is a MacBook Air.",
  );
  assert.equal(theirs.user_id, 2);
});

test("an id the model was never shown is refused", async () => {
  const theirs = seedMemory(2, "The user lives in Utrecht.");

  const outcome = await instructions.applyMemoryInstruction({
    userId: 1,
    instruction: "keep this tidy",
    fetcher: fakeFetcher({
      plan: JSON.stringify({
        operations: [{ action: "forget", id: theirs.id }],
        reply: "Done.",
      }),
    }),
  });

  assert.equal(outcome.result, "no_change");
  assert.deepEqual(outcome.changes, []);
  assert.equal(inspection.listDurableMemories(2)[0].state, "confirmed");
});

test("asking Breadboard to forget retires the memory instead of hiding it", async () => {
  const stale = seedMemory(1, "The user lives in Ankara.");

  const outcome = await instructions.applyMemoryInstruction({
    userId: 1,
    instruction: "forget where I live, that is out of date",
    fetcher: fakeFetcher({
      plan: JSON.stringify({
        operations: [{ action: "forget", id: stale.id }],
        reply: "Dropped where you live.",
      }),
      summary: "## Overview\n\nThe user keeps their memory tidy and current.",
    }),
  });

  assert.equal(outcome.result, "applied");
  assert.deepEqual(outcome.changes.map((change) => change.action), ["forget"]);
  assert.equal(inspection.listDurableMemories(1).length, 0);
  assert.equal(
    inspection.listDurableMemories(1, { includeSuperseded: true })[0].state,
    "superseded",
  );

  const later = store.createConversation({ userId: 1, title: "A later chat" });
  assert.deepEqual(
    memory.retrieveDurableMemories({
      userId: 1,
      currentConversationId: later.id,
      query: "where do I live",
    }),
    [],
  );
  assert.doesNotMatch(outcome.profile.summary, /Ankara/);
});

test("an unreachable model still keeps a plain remember, and never guesses at a removal", async () => {
  const saved = await instructions.applyMemoryInstruction({
    userId: 1,
    instruction: "Remember that I take my coffee black.",
    fetcher: fakeFetcher({ offline: true }),
  });

  assert.equal(saved.result, "applied");
  assert.equal(saved.planner, "fallback");
  // The summary is the part that failed; the memory itself still persisted and
  // is what chats actually read.
  assert.equal(saved.summaryRefreshed, false);
  assert.equal(inspection.listDurableMemories(1)[0].content, "I take my coffee black.");

  const refused = await instructions.applyMemoryInstruction({
    userId: 1,
    instruction: "forget what I said about coffee",
    fetcher: fakeFetcher({ offline: true }),
  });
  assert.equal(refused.result, "failed");
  assert.deepEqual(refused.changes, []);
  assert.equal(inspection.listDurableMemories(1).length, 1);
});

test("credentials are refused before any model sees them", async () => {
  const captured = [];
  const outcome = await instructions.applyMemoryInstruction({
    userId: 1,
    instruction: "remember my api key is sk-live-not-a-real-token",
    fetcher: fakeFetcher({ captured, plan: "{}" }),
  });

  assert.equal(outcome.result, "failed");
  assert.deepEqual(captured, []);
  assert.equal(inspection.listDurableMemories(1).length, 0);
});

test("the memory panel offers the instruction box and posts it to its own route", () => {
  assert.match(panel, /\/api\/agent-memory\/instruct/);
  assert.match(panel, /JSON\.stringify\(\{ instruction: typed \}\)/);
  assert.match(panel, /id="memory-instruction"/);
  assert.match(panel, /Save to memory/);
  assert.match(route, /applyMemoryInstruction/);
  assert.match(route, /requireUserId/);
  assert.match(route, /MAX_INSTRUCTION_CHARACTERS/);
});
