import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, beforeEach } from "node:test";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-recent-activity-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;
const { default: db } = await import("../src/lib/db.ts");
const store = await import("../src/lib/conversations/store.ts");
const activity = await import("../src/lib/conversations/recent-activity.ts");

after(() => { db.close(); fs.rmSync(dataRoot, { recursive: true, force: true }); });

const NOW = new Date("2026-11-25T10:22:00Z");
const at = (minutesBefore) => new Date(NOW.getTime() - minutesBefore * 60_000).toISOString().replace("T", " ").slice(0, 19);
let order = 0;

function turn(conversation, question, answer, minutesBefore, clientMessageId = `c-${order}`) {
  const created = at(minutesBefore);
  db.prepare(`INSERT INTO conversation_messages(conversation_id, client_message_id, role, surface, content, status, order_index, created_at)
    VALUES (?, ?, 'user', ?, ?, 'complete', ?, ?)`).run(conversation.id, clientMessageId, conversation.surface, question, order++, created);
  if (answer !== null) {
    db.prepare(`INSERT INTO conversation_messages(conversation_id, client_message_id, role, surface, content, status, order_index, created_at)
      VALUES (?, ?, 'assistant', ?, ?, 'complete', ?, ?)`).run(conversation.id, `${clientMessageId}-a`, conversation.surface, answer, order++, created);
  }
  db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(created, conversation.id);
}

function writeBrowserHistory(entries) {
  fs.mkdirSync(path.join(dataRoot, "config"), { recursive: true });
  fs.writeFileSync(path.join(dataRoot, "config", "browser-history.json"), JSON.stringify({
    version: 1,
    entries: entries.map(([url, title, minutesBefore]) => ({
      url, visitsByUser: { 1: { title, visitedAt: new Date(NOW.getTime() - minutesBefore * 60_000).toISOString(), days: ["2026-11-25"] } },
    })),
  }));
}

let math, neuro, current;
beforeEach(() => {
  db.exec(`DELETE FROM conversations; DELETE FROM clusters; DELETE FROM users;
    INSERT INTO users(id, username, email, password_hash) VALUES (1, 'alice', 'alice@example.test', 'x'), (2, 'bob', 'bob@example.test', 'x');
    INSERT INTO clusters(id, user_id, name, slug) VALUES (10, 1, 'Math 1', 'math-1'), (11, 1, 'Neuro Comp', 'neuro-comp');`);
  writeBrowserHistory([]);
  math = store.createConversation({ userId: 1, title: "Planes", surface: "garden_chat", defaultGardenId: 10 });
  neuro = store.createConversation({ userId: 1, title: "Perceptrons", surface: "garden_chat", defaultGardenId: 11 });
  current = neuro;
});

const query = (overrides = {}) => ({
  userId: 1, conversationId: current.id, query: "is that a hyperplane?", gardenId: 11, surface: "garden_chat",
  personalize: true, now: NOW, dataRoot, ...overrides,
});

test("a question from another Garden's chat reaches the turn with its answer, place and link", async () => {
  turn(math, "how do you find the intersection of two planes", "Solve the two **plane equations** at the same time. In 3D, two nonparallel planes meet in a line.", 65);
  const block = await activity.recentActivityContext(query());
  assert.match(block, /^# recent_activity/);
  assert.match(block, /1 h 5 min ago, in their Math 1 Garden chat "Planes"/);
  assert.match(block, /asked "how do you find the intersection of two planes"/);
  assert.match(block, /Your answer then: Solve the two plane equations at the same time\./, "Markdown emphasis is stripped from the gist");
  assert.match(block, new RegExp(`\\[link: /dashboard\\?terminalChat=${math.public_id}\\]`));
  assert.match(block, /connect it explicitly in the answer and explain the link/, "the editable guidance travels with it");
});

test("the window is the last three hours up to now, newest first, retries counted once", async () => {
  turn(math, "too old", "x", 200);
  turn(math, "first", "a", 90);
  turn(math, "second", "b", 30);
  turn(math, "second", "b again", 20);
  turn(math, "asked after this turn", "z", -5);
  const questions = activity.recentQuestions(query());
  assert.deepEqual(questions.map((q) => q.question), ["second", "first"]);
  assert.equal(questions[0].answer, "b again");
});

test("the current chat, temporary, archived, scheduled and machine-started turns never appear", async () => {
  turn(neuro, "in this very chat", "x", 5);
  const temporary = store.createConversation({ userId: 1, title: "Temp", temporary: true });
  turn(temporary, "temporary question", "x", 5);
  const archived = store.createConversation({ userId: 1, title: "Old" });
  turn(archived, "archived question", "x", 5);
  store.setConversationArchived(store.getConversationById(archived.id), true);
  const other = store.createConversation({ userId: 2, title: "Bob's" });
  turn(other, "someone else's question", "x", 5);
  turn(math, "check my grade [Background schedule delivery]", "x", 4);
  turn(math, "a goal continuation", "x", 3, "goal-123");
  turn(math, "real question", "real answer", 2);
  assert.deepEqual(activity.recentQuestions(query()).map((q) => q.question), ["real question"]);
});

test("nothing is read with Personalize off, in a temporary chat, or on a worker hand-back", async () => {
  turn(math, "how do you find the intersection of two planes", "x", 5);
  for (const overrides of [{ personalize: false }, { temporary: true }, { internal: true }]) {
    assert.equal(await activity.recentActivityContext(query(overrides)), "", JSON.stringify(overrides));
  }
});

test("a garden-only Garden neither lends its chats elsewhere nor reads other Gardens", async () => {
  turn(math, "private math question", "x", 5);
  db.prepare("UPDATE clusters SET memory_scope = 'garden_only' WHERE id = 10").run();
  assert.deepEqual(activity.recentQuestions(query()).map((q) => q.question), []);
  db.prepare("UPDATE clusters SET memory_scope = 'default' WHERE id = 10").run();
  db.prepare("UPDATE clusters SET memory_scope = 'garden_only' WHERE id = 11").run();
  assert.deepEqual(activity.recentQuestions(query()).map((q) => q.question), [], "a sealed current Garden reads only itself");
  writeBrowserHistory([["https://www.geeksforgeeks.org/perceptron", "Perceptron Convergence Theorem", 5]]);
  assert.doesNotMatch(await activity.recentActivityContext(query()), /GeeksforGeeks|Perceptron Convergence/);
});

test("recent websites: one page per site, no sign-in hops, messaging apps or Breadboard itself", async () => {
  writeBrowserHistory([
    ["https://www.geeksforgeeks.org/deep-learning/perceptron-convergence-theorem/", "Perceptron Convergence Theorem in Neural Networks", 7],
    ["https://www.geeksforgeeks.org/older-page/", "An older GfG page", 20],
    ["https://web.whatsapp.com/", "(18) WhatsApp", 8],
    ["https://engine.surfconext.nl/authentication/sp/consume-assertion", "SURFconext - POST Data", 9],
    ["https://login.microsoftonline.com/abc/saml2", "Working...", 9],
    ["http://localhost:3000/dashboard", "Breadboard", 2],
    ["https://www.youtube.com/watch", "Best Explanation of Maxwell's Equations - YouTube", 60],
    ["https://example.com/ancient", "Long ago", 400],
  ]);
  const sites = await activity.recentWebsites(query());
  assert.deepEqual(sites.map((site) => site.title), [
    "Perceptron Convergence Theorem in Neural Networks",
    "Best Explanation of Maxwell's Equations - YouTube",
  ]);
  const block = await activity.recentActivityContext(query());
  assert.match(block, /7 min ago: "Perceptron Convergence Theorem in Neural Networks"/);
});

test("Recall is offered only when the turn has the tool and the user's Recall settings allow agents", async () => {
  turn(math, "q", "a", 5);
  db.exec(`CREATE TABLE IF NOT EXISTS recall_user_settings (user_id INTEGER PRIMARY KEY, capture_enabled INTEGER, agent_access INTEGER)`);
  db.prepare("DELETE FROM recall_user_settings").run();
  db.prepare("INSERT INTO recall_user_settings(user_id, capture_enabled, agent_access) VALUES (1, 1, 1)").run();
  assert.match(await activity.recentActivityContext(query({ allowedTools: ["recall_activity"] })), /call recall_activity/);
  assert.doesNotMatch(await activity.recentActivityContext(query({ allowedTools: [] })), /recall_activity/);
  db.prepare("UPDATE recall_user_settings SET agent_access = 0").run();
  assert.doesNotMatch(await activity.recentActivityContext(query({ allowedTools: ["recall_activity"] })), /recall_activity/);
});

test("with nothing recent the turn gets no block at all", async () => {
  assert.equal(await activity.recentActivityContext(query()), "");
});

test("helpers: readable gists, page titles and relative times", () => {
  assert.equal(activity.answerGist("## Title\n**Bold** `code` $$x$$ and [a link](https://x.test)."), "Title Bold code x and a link.");
  assert.equal(activity.pageTitleFromSlug("Concepts/1.-linear-algebra/hyperplanes-and-linear-functionals"), "Hyperplanes and linear functionals");
  assert.equal(activity.minutesAgo(new Date(NOW.getTime() - 65 * 60_000), NOW), "1 h 5 min ago");
  assert.equal(activity.minutesAgo(new Date(NOW.getTime() - 20_000), NOW), "just now");
  assert.equal(activity.minutesAgo(new Date("2026-11-20T10:00:00Z"), NOW), "5 days ago (Friday)");
});

test("recently added to Gardens: uploads, and new pages grouped by chapter with titles", async () => {
  const content = path.join(dataRoot, "content");
  const chapter = path.join(content, "neuro-comp", "Concepts", "37. spike-coding");
  fs.mkdirSync(chapter, { recursive: true });
  for (const name of ["rate-coding.md", "temporal-coding.md", "_index.md"]) fs.writeFileSync(path.join(chapter, name), "# x");
  fs.mkdirSync(path.join(content, "neuro-comp", "Internal"), { recursive: true });
  fs.writeFileSync(path.join(content, "neuro-comp", "Internal", "graph.md"), "# x");
  fs.mkdirSync(path.join(content, "math-1", "Office"), { recursive: true });
  fs.writeFileSync(path.join(content, "math-1", "Office", "planes-pdf.md"), "# x");
  db.exec("CREATE TABLE IF NOT EXISTS garden_files (id TEXT PRIMARY KEY, cluster_id INTEGER, owner_id INTEGER, kind TEXT, path TEXT, path_key TEXT, visibility TEXT, version INTEGER, revision INTEGER, size INTEGER, mime_type TEXT, created_at TEXT, updated_at TEXT, deleted_at TEXT, deletion_id TEXT)");
  db.prepare(`INSERT INTO garden_files(id, cluster_id, owner_id, kind, path, path_key, visibility, version, revision, size, created_at, updated_at)
    VALUES ('f1', 10, 1, 'file', 'Office/planes.pdf', 'office/planes.pdf', 'private', 1, 1, 10, ?, ?)`).run(NOW.toISOString(), NOW.toISOString());
  activity.resetGardenPageIndex();
  const now = new Date(Date.now() + 60_000);
  const additions = await activity.recentGardenAdditions(query({ contentRoot: content, now }));
  const pages = additions.find((item) => item.kind === "pages");
  assert.equal(pages.garden, "Neuro Comp");
  assert.equal(pages.count, 2, "index pages and generated Internal wiring are not material");
  assert.match(pages.section, /^Concepts \/ 37\. spike coding$/i);
  const upload = additions.find((item) => item.kind === "upload");
  assert.equal(upload.section, "Office/planes.pdf");
  assert.equal(additions.filter((item) => item.garden === "Math 1").length, 1, "the page converted from the upload is not listed again");
  assert.match(await activity.recentActivityContext(query({ contentRoot: content, now })), /2 new pages in their Neuro Comp Garden under Concepts/);

  db.prepare("UPDATE clusters SET memory_scope = 'garden_only' WHERE id = 10").run();
  assert.ok(!(await activity.recentGardenAdditions(query({ contentRoot: content, now }))).some((item) => item.garden === "Math 1"), "a garden-only Garden's additions stay inside it");
});

test("the sampled new pages are the ones that match the question", async () => {
  const content = path.join(dataRoot, "content-rank");
  const chapter = path.join(content, "neuro-comp", "Concepts", "37. neuromorphic");
  fs.mkdirSync(chapter, { recursive: true });
  for (const name of ["action-potential.md", "analog-cmos.md", "backpropagation.md", "biological-signaling.md", "encoding-inputs-as-spikes.md"]) {
    fs.writeFileSync(path.join(chapter, name), "# x");
  }
  activity.resetGardenPageIndex();
  const now = new Date(Date.now() + 60_000);
  const [pages] = await activity.recentGardenAdditions(query({ contentRoot: content, now, query: "how do I encode an image as spikes?" }));
  assert.equal(pages.titles[0], "Encoding inputs as spikes");
  assert.equal(pages.matching, 1);
  assert.match(await activity.recentActivityContext(query({ contentRoot: content, now, query: "how do I encode an image as spikes?" })),
    /including pages that match this question: "Encoding inputs as spikes"/);
});
