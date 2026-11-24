import test from "node:test";
import assert from "node:assert/strict";
import { answerMapQuestion } from "../../quartz/quartz/components/scripts/topologyAssistant.ts";

const node = (id, title, sectorId, kind = "page") => ({
  id, title, sectorId, kind, concepts: [], folderTitle: "", summary: { text: title + " covers electric circuits." },
});
const edge = (id, source, target, crossFolder = false) => ({
  id, source, target, crossFolder, strength: 0.7, score: 0.46, evidence: [],
});
const nodes = [node("g1","Circuits","g1","folder"), node("g2","Physics","g2","folder"),
  node("a","Norton theorem","g1"), node("b","Source equivalence","g1"), node("c","Thevenin theorem","g2")];
const edges = [edge("ab","a","b"),edge("bc","b","c",true)];
const ask = (q, focus = {}) => answerMapQuestion(nodes, edges, q,
  { multipleGardens: true, visibleConnectionCount: 4, ...focus });

test("unrelated requests return scope guidance and no citations even with a selection", () => {
  for (const question of ["Write a poem about Circuits", "What is the weather today?", "What is 3+3?"]) {
    const reply = ask(question, {selectedNodeId:"a", selectedEdge:edges[0]});
    assert.match(reply.text,/this map/);
    assert.deepEqual([reply.nodes,reply.edges],[[],[]]);
  }
  assert.equal(ask("Which connections across gardens involve spaghetti?").edges.length,0);
});
test("a grounded answer cites precisely the path, a Garden pair, or the selected connection", () => {
  assert.deepEqual(ask("How are Norton theorem and Thevenin theorem connected?").edges,edges);
  assert.deepEqual(ask("Which connections link Circuits and Physics?").edges,[edges[1]]);
  assert.deepEqual(ask("Explain this connection",{selectedEdge:edges[1]}).edges,[edges[1]]);
  assert.deepEqual(ask("Find connections to this node",{selectedNodeId:"a"}).edges,[edges[0]]);
});
test("node details and view counts use the graph and never invent edges", () => {
  assert.deepEqual(ask("Tell me about Norton theorem").nodes,[nodes[2]]);
  const stats=ask("How many nodes are in this map?");
  assert.match(stats.text,/2 Gardens, 5 nodes \(3 pages\), and 4 connections/);
  assert.equal(stats.edges.length,0);
});
