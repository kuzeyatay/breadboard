import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assembleBoundedGraphContext,
  corsHeaders,
  enforceRateLimit,
  newClientToken,
  quartzSystemContext,
} from "../src/lib/hermes/quartz-support.ts";
import { ApiError } from "../src/lib/hermes/route-core.ts";

test("corsHeaders echoes an allowed origin and always sets credentials", () => {
  const headers = corsHeaders("http://localhost:8081");
  assert.equal(headers["Access-Control-Allow-Origin"], "http://localhost:8081");
  assert.equal(headers["Access-Control-Allow-Credentials"], "true");
  assert.match(headers["Access-Control-Allow-Methods"], /POST/);
});

test("corsHeaders falls back to an allowlisted origin for an unknown origin", () => {
  const headers = corsHeaders("http://evil.example.com");
  assert.notEqual(headers["Access-Control-Allow-Origin"], "http://evil.example.com");
});

test("enforceRateLimit allows up to the window limit then throws 429", () => {
  const key = `test-key-${Math.random()}`;
  const now = 1_000_000;
  // 20 allowed per fixed window.
  for (let i = 0; i < 20; i += 1) {
    enforceRateLimit(key, now);
  }
  assert.throws(() => enforceRateLimit(key, now), (err) => err instanceof ApiError && err.status === 429);
});

test("enforceRateLimit resets after the window", () => {
  const key = `test-reset-${Math.random()}`;
  const start = 2_000_000;
  for (let i = 0; i < 20; i += 1) enforceRateLimit(key, start);
  assert.throws(() => enforceRateLimit(key, start));
  // Advance beyond the 60s window.
  enforceRateLimit(key, start + 61_000);
});

test("newClientToken returns a long unguessable token", () => {
  const a = newClientToken();
  const b = newClientToken();
  assert.notEqual(a, b);
  assert.ok(a.length >= 24);
});

const pageContext = {
  gardenId: "garden-a",
  gardenName: "Garden A",
  pageSlug: "garden-a/lesson",
  pageTitle: "Lesson",
  excerpt: "Short excerpt",
  visibleContent: "The complete bounded visible lesson.",
  sources: ["source-anchor-1"],
  prerequisites: ["intro"],
  backlinks: ["intro"],
  outgoingLinks: ["next"],
  neighboringConcepts: ["intro", "next"],
  neighbors: [{ related: "intro", relation: "prerequisite" }],
  graph: null,
};

test("page-only Quartz context includes page relationships and no selection or graph packet", () => {
  const system = quartzSystemContext(pageContext);
  assert.match(system, /Visible page content/);
  assert.match(system, /Backlinks: intro/);
  assert.match(system, /Outgoing links: next/);
  assert.doesNotMatch(system, /Reader selection/);
  assert.doesNotMatch(system, /graph interaction context/);
});

test("selected-text Quartz context contains only the bounded selection", () => {
  const selection = "chosen sentence";
  const system = quartzSystemContext(pageContext, selection);
  assert.match(system, /Reader selection:\nchosen sentence/);
});

test("graph-node requests receive a bounded, garden-scoped map packet", () => {
  const graph = assembleBoundedGraphContext(
    "garden-a",
    [
      { slug: "lesson", title: "Lesson" },
      { slug: "next", title: "Next" },
      { slug: "private/other", title: "Unrelated" },
    ],
    [{ source: "lesson", target: "next", relation: "explains" }],
    {
      selectedNodeSlug: "garden-a/lesson",
      visibleNodeSlugs: ["garden-a/lesson", "garden-a/next", "garden-b/private/other"],
      directNeighborSlugs: ["garden-a/next", "garden-b/private/other"],
      relationshipTypes: ["explains", "unrelated"],
      filters: ["learning"],
      depth: 99,
      viewport: { x: 1, y: 2, width: 800, height: 600, scale: 1.5 },
    },
  );
  assert.equal(graph.selectedNode.slug, "garden-a/lesson");
  assert.deepEqual(graph.visibleNodes.map((node) => node.slug), ["garden-a/lesson", "garden-a/next"]);
  assert.deepEqual(graph.directNeighbors.map((node) => node.slug), ["garden-a/next"]);
  assert.deepEqual(graph.relationshipTypes, ["explains"]);
  assert.equal(graph.depth, 3);
  assert.doesNotMatch(JSON.stringify(graph), /garden-b|Unrelated/);
  assert.match(quartzSystemContext({ ...pageContext, graph }), /Bounded graph interaction context/);
});

test("Quartz browser code calls only dashboard proxy routes and contains no Hermes secret", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const source = fs.readFileSync(
    path.resolve(here, "..", "..", "quartz", "quartz", "components", "scripts", "breadboardAI.inline.ts"),
    "utf8",
  );
  assert.match(source, /\/api\/quartz-ai\/chat/);
  assert.match(source, /\/api\/quartz-ai\/events/);
  assert.match(source, /\/api\/quartz-ai\/abort/);
  assert.doesNotMatch(source, /HERMES_(?:PASSWORD|AUTH|BASE_URL)|127\.0\.0\.1:4096/);
});
