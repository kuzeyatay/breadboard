import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

// A private database and a stub embedding endpoint: these tests write chats
// and vectors. The stub maps words to fixed axes so scores are predictable.
process.env.BREADBOARD_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "topology-chats-"));
const AXES = ["gradient", "chain", "series"];
const embedCalls = [];
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const { input } = JSON.parse(body);
    embedCalls.push(input.length);
    const data = input.map((text, index) => ({ index, embedding: AXES.map((word) => (text.toLowerCase().includes(word) ? 1 : 0.01)) }));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data, model: "test/axes" }));
  });
}).listen(0);
process.env.BREADBOARD_EMBEDDING_MODEL = "test/axes";
process.env.BREADBOARD_EMBEDDING_BASE_URL = `http://127.0.0.1:${server.address().port}/v1`;
process.env.BREADBOARD_EMBEDDING_API_KEY = "x";
test.after(() => server.close());

const { default: db } = await import("../src/lib/db.ts");
const chatNodes = await import("../src/lib/thought-topology/chat-nodes.ts");
const { addChatNodes, readGardenChats, withViewerChats, embedGardenChatAfterAnswer, settleChatEmbedding, preparePages, CHATS_FOLDER_ID } = chatNodes;
const { rendererArtifactContainsVector } = await import("../src/lib/thought-topology/storage.ts");
const { normalizeQuartzChatLink } = await import("../src/lib/quartz-chat-link.ts");

const link = (note) => `[${note}](/garden/calc?note=${encodeURIComponent(note)})`;
const userId = Number(db.prepare("INSERT INTO users (username, email, password_hash) VALUES ('ann', 'ann@test', 'x')").run().lastInsertRowid);
const otherId = Number(db.prepare("INSERT INTO users (username, email, password_hash) VALUES ('bo', 'bo@test', 'x')").run().lastInsertRowid);
const clusterId = Number(db.prepare("INSERT INTO clusters (user_id, name, slug) VALUES (?, 'Calc', 'calc')").run(userId).lastInsertRowid);

let order = 0;
function chat(owner, title, turns, { temporary = 0 } = {}) {
  const conversationId = Number(db.prepare("INSERT INTO conversations (public_id, user_id, title, temporary) VALUES (?, ?, ?, ?)")
    .run(`c-${Math.random()}`, owner, title, temporary).lastInsertRowid);
  for (const [role, content] of turns) {
    order += 1;
    db.prepare(`INSERT INTO conversation_messages (conversation_id, client_message_id, role, surface, content, status, order_index)
                VALUES (?, ?, ?, 'garden_chat', ?, 'complete', ?)`).run(conversationId, `m-${order}`, role, content, order);
  }
  const id = Number(db.prepare("INSERT INTO chat_sessions (user_id, cluster_id, title, conversation_id) VALUES (?, ?, ?, ?)")
    .run(owner, clusterId, title, conversationId).lastInsertRowid);
  return { id, conversationId };
}

function page(id, relPath, title) {
  return { id, slug: `calc/${relPath}`, relPath: `${relPath}.md`, folderId: "folder:$root", title, kind: "markdown", knowledgeType: "learning-page",
    contentHash: id, summary: { state: "ready", text: title }, primaryConcepts: [], supportingConcepts: [], claimIds: [], wordCount: 10 };
}
const topology = (retrievalMode = "semantic-vector") => ({
  schemaVersion: 1, scoringVersion: "v", sourceRevision: "r",
  garden: { id: clusterId, slug: "calc", title: "Calc", summary: { state: "ready", text: "" } },
  folders: [{ id: "folder:$root", path: "", parentId: null, title: "Calc", depth: 0, nodeCount: 3, summary: { state: "ready", text: "" } }],
  nodes: [page("page:grad", "notes/gradients", "Gradients"), page("page:chain", "notes/chain-rule", "Chain rule"), page("page:series", "notes/series", "Series")],
  edges: [],
  build: { state: "ready", generatedAt: "", embeddingModel: "test/axes", embeddingDimension: 3, summaryModel: "", nodePromptVersion: "", edgePromptVersion: "",
    retrievalMode, threshold: 0.2 },
});

// The map's page vectors, as the builder stores them.
const gardenDir = fs.mkdtempSync(path.join(os.tmpdir(), "topology-chats-garden-"));
fs.mkdirSync(path.join(gardenDir, ".breadboard"));
const cacheNode = (id, embedding) => ({ id, folderId: "folder:$root", contentHash: id, embeddingHash: id, summaryHash: id, semanticText: "", lexicalText: "",
  embeddingModel: "test/axes", embeddingDimension: 3, embedding, summary: { state: "ready", text: "" } });
fs.writeFileSync(path.join(gardenDir, ".breadboard/thought-topology-cache.json"), JSON.stringify({
  schemaVersion: 1, sourceRevision: "r", scoringVersion: "v", edges: {},
  nodes: { "page:grad": cacheNode("page:grad", [1, 0, 0]), "page:chain": cacheNode("page:chain", [0, 1, 0]), "page:series": cacheNode("page:series", [0, 0, 1]) },
}));
const viewer = (id) => ({ userId: id, clusterId, gardenSlug: "calc", gardenDir });

let mixed;
test("a chat reads turn by turn; temporary chats, other users and unanswered questions stay out", () => {
  mixed = chat(userId, "Calc questions", [
    ["user", "why is the gradient  normal to level sets?"], ["assistant", `See ${link("notes/gradients")}.`],
    ["user", "and how does the chain rule apply?"], ["assistant", "Differentiate the outer function, then the inner one."],
    ["user", "still thinking"],
  ]);
  chat(userId, "scratch", [["user", "temp series"], ["assistant", link("notes/series")]], { temporary: 1 });
  chat(otherId, "Bo's", [["user", "series?"], ["assistant", link("notes/series")]]);
  const [only, ...rest] = readGardenChats(userId, clusterId, "calc");
  assert.equal(rest.length, 0);
  assert.equal(only.title, "Calc questions");
  assert.deepEqual(only.turns.map((turn) => [turn.question, turn.cited, turn.answerId]), [
    ["why is the gradient normal to level sets?", ["notes/gradients"], "m-2"],
    ["and how does the chain rule apply?", [], "m-4"],
  ]);
  assert.match(only.turns[0].text, /^Calc questions\. why is the gradient normal to level sets\?\. See \[notes\/gradients\]\./);
});

test("each page keeps the turn closest to it; cited pages link outright; vectors never leave the server", () => {
  const chats = readGardenChats(userId, clusterId, "calc");
  const [first, second] = chats[0].turns;
  const pages = preparePages([
    { nodeId: "page:grad", embedding: [1, 0, 0] },
    { nodeId: "page:chain", embedding: [0, 0.6, 0.8], sections: [{ label: "Chapter 2: Composition", embedding: [0, 1, 0] }] },
    { nodeId: "page:series", embedding: [0, 0, 1] },
  ]);
  const vectors = new Map([[first.messageId, [1, 0.01, 0.01]], [second.messageId, [0.01, 1, 0.01]]]);
  const map = addChatNodes(topology(), chats, vectors, pages);

  const folder = map.folders.find((f) => f.id === CHATS_FOLDER_ID);
  assert.equal(folder.parentId, "folder:$root");
  const node = map.nodes.find((n) => n.kind === "chat");
  assert.equal(node.id, `chat:${mixed.id}`);
  // The strongest link (the cited page, from turn 1) decides where a click opens.
  assert.equal(node.slug, `chat:${mixed.id}#m-2`);
  assert.deepEqual(map.edges.map((e) => [e.target, e.origin]), [["page:grad", "authored"], ["page:chain", "inferred"]]);
  const chain = map.edges[1];
  assert.match(chain.explanation.text, /^You asked "and how does the chain rule apply\?"; Chain rule \(Chapter 2: Composition\) is the closest page\.$/);
  assert.ok(chain.score >= 0.45 && chain.score <= 1);
  assert.equal(rendererArtifactContainsVector(map), false);
  assert.equal(topology().nodes.length, 3);
});

test("a completed answer stores its turn vectors; the map reads them and never embeds on load", async () => {
  // Before any vector exists the map still shows the cited link, and
  // queues one background pass instead of waiting for it.
  const before = withViewerChats(topology(), viewer(userId));
  assert.deepEqual(before.edges.map((e) => [e.target, e.origin]), [["page:grad", "authored"]]);
  await settleChatEmbedding();
  const stored = db.prepare("SELECT COUNT(*) AS n FROM thought_topology_chat_turn_vectors").get().n;
  assert.equal(stored, 2);

  embedCalls.length = 0;
  const after = withViewerChats(topology(), viewer(userId));
  assert.deepEqual(after.edges.map((e) => [e.target, e.origin]), [["page:grad", "authored"], ["page:chain", "inferred"]]);
  await settleChatEmbedding();
  assert.equal(embedCalls.length, 0, "a load with every vector stored embeds nothing");

  // A new answer is embedded by the completion hook, only that turn.
  order += 1;
  db.prepare(`INSERT INTO conversation_messages (conversation_id, client_message_id, role, surface, content, status, order_index)
              VALUES (?, 'm-late', 'assistant', 'garden_chat', 'Series converge when the terms shrink fast enough.', 'complete', ?)`).run(mixed.conversationId, order);
  embedGardenChatAfterAnswer(mixed.conversationId);
  await settleChatEmbedding();
  assert.deepEqual(embedCalls, [1]);
  const latest = withViewerChats(topology(), viewer(userId));
  assert.ok(latest.edges.some((e) => e.target === "page:series" && e.origin === "inferred"));

  // Deleting a message drops its vector with it.
  db.prepare("DELETE FROM conversation_messages WHERE conversation_id = ?").run(mixed.conversationId);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM thought_topology_chat_turn_vectors").get().n, 0);
});

test("a question in one Garden links to the closest page of another Garden", async () => {
  const { crossGardenChatLinks } = chatNodes;
  const physicsDir = fs.mkdtempSync(path.join(os.tmpdir(), "topology-chats-physics-"));
  fs.mkdirSync(path.join(physicsDir, ".breadboard"));
  fs.writeFileSync(path.join(physicsDir, ".breadboard/thought-topology-cache.json"), JSON.stringify({
    schemaVersion: 1, sourceRevision: "r", scoringVersion: "v", edges: {},
    nodes: { "phys:grad": cacheNode("phys:grad", [1, 0, 0]), "phys:chain": cacheNode("phys:chain", [0, 1, 0]), "phys:series": cacheNode("phys:series", [0, 0, 1]) },
  }));
  const physicsId = Number(db.prepare("INSERT INTO clusters (user_id, name, slug) VALUES (?, 'Physics', 'physics')").run(userId).lastInsertRowid);
  const asked = chat(userId, "Composites", [["user", "how does the chain rule work for composites?"], ["assistant", "Use the chain rule."]]);
  withViewerChats(topology(), viewer(userId));
  await settleChatEmbedding();

  const gardens = [
    { clusterId, slug: "calc", gardenDir },
    { clusterId: physicsId, slug: "physics", gardenDir: physicsDir },
  ];
  const links = crossGardenChatLinks(userId, gardens);
  const fromChat = links.filter((entry) => entry.chatId === asked.id);
  assert.deepEqual(fromChat.map((entry) => [entry.fromSlug, entry.toSlug, entry.pageId]), [["calc", "physics", "phys:chain"]]);
  assert.ok(fromChat[0].score >= chatNodes.CHAT_LINK_FLOOR);
  assert.ok(links.every((entry) => entry.fromSlug !== entry.toSlug), "a chat's own Garden is not a cross-Garden target");
  assert.deepEqual(crossGardenChatLinks(userId, gardens.slice(0, 1)), [], "one Garden has nothing to cross to");
  assert.deepEqual(crossGardenChatLinks(otherId, gardens), [], "only the viewer's own chats link");
});

test("anonymous viewers and lexical maps", () => {
  const base = topology();
  assert.equal(withViewerChats(base, viewer(null)), base);
  const other = withViewerChats(topology("concept-lexical"), viewer(otherId));
  assert.deepEqual(other.nodes.filter((n) => n.kind === "chat").map((n) => n.title), ["Bo's"]);
  assert.deepEqual(other.edges.map((e) => [e.target, e.origin]), [["page:series", "authored"]]);
});

test("a Quartz chat link may name an answer instead of a selection", () => {
  assert.deepEqual(normalizeQuartzChatLink({ chatId: "12", selectionId: "", messageId: "m-4", surface: "garden" }),
    { chatId: "12", selectionId: "", surface: "garden", messageId: "m-4" });
  assert.deepEqual(normalizeQuartzChatLink({ chatId: "12", selectionId: "sel-1", surface: "page" }),
    { chatId: "12", selectionId: "sel-1", surface: "page" });
  assert.equal(normalizeQuartzChatLink({ chatId: "12", selectionId: "", surface: "garden" }), null);
  assert.equal(normalizeQuartzChatLink({ chatId: "12", selectionId: "", messageId: "bad id!", surface: "garden" }), null);
});

test("a chat's summary names it and gathers questions until it says something", () => {
  const turn = (question) => ({ question });
  assert.equal(chatNodes.chatSummary({ title: "Derivatives", turns: [turn("why did we use the derivative"), turn("is this important for em1?"), turn("third")] }),
    'In "Derivatives" you asked "why did we use the derivative", then "is this important for em1?".');
  assert.ok(chatNodes.chatSummary({ title: "T", turns: [turn("ok")] }).length >= 15);
});
