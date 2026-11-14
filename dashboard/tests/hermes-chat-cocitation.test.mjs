import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// A private database: these tests write conversations.
process.env.BREADBOARD_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "chat-cocitation-"));
const { default: db } = await import("../src/lib/db.ts");
const { chatCocitations, citedNotes } = await import("../src/lib/hermes/chat-cocitation.ts");
const { queryThoughtTopologyGraph, compactThoughtTopologyGraph } = await import("../src/lib/hermes/thought-topology-graph.ts");

const link = (garden, note, title = note) => `[${title}](/garden/${garden}?note=${encodeURIComponent(note)})`;

function user(name) {
  return Number(db.prepare("INSERT INTO users (username, email, password_hash) VALUES (?, ?, 'x')").run(name, `${name}@test`).lastInsertRowid);
}

let order = 0;
function conversation(userId, turns, { temporary = 0 } = {}) {
  const id = Number(
    db.prepare("INSERT INTO conversations (public_id, user_id, title, temporary) VALUES (?, ?, 't', ?)")
      .run(`c-${Math.random()}`, userId, temporary).lastInsertRowid,
  );
  for (const [role, content] of turns) {
    order += 1;
    db.prepare(
      `INSERT INTO conversation_messages (conversation_id, client_message_id, role, surface, content, status, order_index)
       VALUES (?, ?, ?, 'garden_chat', ?, 'complete', ?)`,
    ).run(id, `m-${order}`, role, content, order);
  }
  return id;
}

function page(id, relPath, title) {
  return {
    id, slug: `calc/${relPath.replace(/\.md$/, "")}`, relPath, folderId: "folder:$root", title,
    kind: "markdown", knowledgeType: "learning-page", contentHash: id,
    summary: { state: "ready", text: title }, primaryConcepts: [], supportingConcepts: [], claimIds: [], wordCount: 10,
  };
}

function topology() {
  return {
    schemaVersion: 1, scoringVersion: "v", sourceRevision: "r1",
    garden: { id: 1, slug: "calc", title: "Calc", summary: { state: "ready", text: "" } },
    folders: [{ id: "folder:$root", path: "", parentId: null, title: "root", depth: 0, nodeCount: 3, summary: { state: "ready", text: "" } }],
    nodes: [
      page("page:partials", "notes/13-3 Partial Derivatives.md", "13.3 Partial derivatives"),
      page("page:gradients", "notes/13-7-gradients.md", "13.7 Gradients"),
      page("page:chain", "notes/13-5-chain-rule.md", "13.5 Chain rule"),
    ],
    edges: [{
      id: "edge:map", source: "page:partials", target: "page:chain", origin: "inferred", score: 0.7,
      components: { embedding: 0.7, concept: 0.5, lexical: 0.3 }, relationType: "related", direction: "undirected",
      explanation: { state: "ready", text: "Map link." }, evidence: [], pairHash: "m", visual: { width: 1, opacity: 1, distance: 1, strength: 1 },
    }],
    build: { state: "degraded", generatedAt: "", embeddingModel: "unavailable", embeddingDimension: 0, summaryModel: "", nodePromptVersion: "", edgePromptVersion: "", retrievalMode: "concept-lexical", threshold: 0.62 },
  };
}

test("citedNotes reads this Garden's page links and ignores other Gardens and assets", () => {
  const content = `${link("calc", "notes/13-3 Partial Derivatives")} ${link("calc", "notes/13-7-gradients.md")} ` +
    `${link("other", "notes/x")} ![fig](/calc/assets/a.png) ${link("calc", "notes/13-3 Partial Derivatives")}`;
  assert.deepEqual(citedNotes(content, "calc"), ["notes/13-3 partial derivatives", "notes/13-7-gradients"]);
});

test("pages cited together in two of a user's own conversations become a co-studied link", () => {
  const alice = user("alice");
  const bob = user("bob");
  const pair = `${link("calc", "notes/13-3 Partial Derivatives")} and ${link("calc", "notes/13-7-gradients")}`;
  conversation(alice, [["user", "how do partials give the gradient?"], ["assistant", `See ${pair}.`]]);
  conversation(alice, [["user", "is the gradient\n  just partials stacked?"], ["assistant", `Yes: ${pair}.`]]);
  // Once only: not enough to call it a pattern.
  conversation(alice, [["user", "q"], ["assistant", `${link("calc", "notes/13-7-gradients")} ${link("calc", "notes/13-5-chain-rule")}`]]);
  // A reading list (7 pages) says nothing about any one pair.
  const list = Array.from({ length: 7 }, (_, i) => link("calc", `notes/p${i}`)).join(" ");
  conversation(alice, [["user", "list"], ["assistant", list]]);
  conversation(alice, [["user", "list"], ["assistant", list]]);
  // Temporary chats and other users never count.
  conversation(alice, [["user", "q"], ["assistant", `${link("calc", "notes/13-7-gradients")} ${link("calc", "notes/13-5-chain-rule")}`]], { temporary: 1 });
  conversation(bob, [["user", "q"], ["assistant", `${link("calc", "notes/13-7-gradients")} ${link("calc", "notes/13-5-chain-rule")}`]]);

  const links = chatCocitations(alice, "calc");
  assert.deepEqual(links, [{
    left: "notes/13-3 partial derivatives",
    right: "notes/13-7-gradients",
    conversations: 2,
    question: "is the gradient just partials stacked?",
  }]);
  assert.deepEqual(chatCocitations(null, "calc"), []);
  assert.equal(chatCocitations(bob, "calc").length, 0);

  // A pair the map already links gains the chat as evidence, no duplicate.
  conversation(alice, [["user", "partials and chain rule?"], ["assistant", `${link("calc", "notes/13-3 Partial Derivatives")} ${link("calc", "notes/13-5-chain-rule")}`]]);
  conversation(alice, [["user", "again"], ["assistant", `${link("calc", "notes/13-5-chain-rule")} ${link("calc", "notes/13-3 Partial Derivatives")}`]]);
  const chatLinks = chatCocitations(alice, "calc"); // cache is invalidated by the new messages
  assert.equal(chatLinks.length, 2);

  const graph = queryThoughtTopologyGraph(topology(), { start: "page:gradients", chatLinks });
  const added = graph.edges.find((edge) => edge.origin === "conversation");
  assert.equal(added.relation, "co-studied");
  assert.equal(added.weight, 0.75);
  assert.equal(added.reads, "You studied 13.3 Partial derivatives and 13.7 Gradients together in 2 chats.");
  assert.match(added.evidence[0].label, /for example: "is the gradient just partials stacked\?"/);
  const pagesOnly = queryThoughtTopologyGraph(topology(), { start: "page:gradients", chatLinks, includeHierarchy: false });
  // 13.7 Gradients had no link in the map; the chats give it one.
  assert.deepEqual(pagesOnly.nodes.map((node) => node.id).sort(), ["page:gradients", "page:partials"]);

  const confirmed = queryThoughtTopologyGraph(topology(), { start: "page:chain", chatLinks, includeHierarchy: false });
  assert.equal(confirmed.edges.filter((edge) => edge.source === "page:partials" && edge.target === "page:chain").length, 1);
  const mapEdge = confirmed.edges.find((edge) => edge.id === "edge:map");
  assert.equal(mapEdge.conversations, 2);
  assert.equal(mapEdge.evidence[0].kind, "conversation");

  // The verdict still describes the map, and says what the chat links are.
  assert.equal(graph.linkQuality.status, "sparse");
  assert.equal(graph.linkQuality.chatLinks, 1);
  assert.match(graph.linkQuality.note, /1 co-studied links come from the user's own chats \(1 touch this page\)/);

  // Chat links connect pages the map could not: a path now exists.
  const path = queryThoughtTopologyGraph(topology(), { start: "page:gradients", target: "page:chain", chatLinks });
  assert.equal(path.path.found, true);
  assert.deepEqual(path.path.reads, [
    "You studied 13.3 Partial derivatives and 13.7 Gradients together in 2 chats.",
    "13.3 Partial derivatives and 13.5 Chain rule are related.",
  ]);
  // Undirected chat links never enter a directed prerequisite walk.
  const directed = queryThoughtTopologyGraph(topology(), { start: "page:gradients", follow: "out", chatLinks });
  assert.equal(directed.edges.length, 0);

  const compact = compactThoughtTopologyGraph(graph);
  assert.equal(compact.edges.find((edge) => edge.origin === "conversation").conversations, 2);
  // The question text stays out of the every-turn packet.
  assert.doesNotMatch(JSON.stringify(compact), /partials stacked/);
});

test("without chat links the graph is unchanged", () => {
  const graph = queryThoughtTopologyGraph(topology(), { start: "page:gradients" });
  assert.equal(graph.linkQuality.chatLinks, 0);
  assert.equal(graph.edges.some((edge) => edge.origin === "conversation"), false);
  assert.doesNotMatch(graph.linkQuality.note, /co-studied/);
});
