import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { registerHooks } from "node:module";
import db from "../src/lib/db.ts";
import { planTask } from "../src/lib/hermes/task-plan.ts";
import { retrieveTerminalGardenGrounding, shouldGroundTerminalInGardens } from "../src/lib/hermes/terminal-garden-grounding.ts";

function shouldGround(request, options = {}) {
  return shouldGroundTerminalInGardens({
    request,
    plan: planTask({ request, authenticated: true }),
    ...options,
  });
}

test("academic Terminal synthesis automatically consults authorized Gardens", () => {
  assert.equal(
    shouldGround(
      "Can you create a PDF explaining why SNNs can be the future in an academic style?",
    ),
    true,
  );
  assert.equal(
    shouldGround("Explain the limitations and future outlook of neuromorphic computing."),
    true,
  );
});

test("explicit requests to find personal Garden knowledge trigger retrieval", () => {
  for (const request of [
    "Which garden has my notes about spiking neural networks?",
    "Search my Gardens for the antenna design notes.",
    "Where are my knowledge pages about Fourier transforms?",
    "What do I know about event-driven computing?",
    "Have I written anything about metamaterials?",
  ]) {
    assert.equal(shouldGround(request), true, request);
  }
});

test("operational, attachment-grounded, and opted-out requests do not mix in Garden context", () => {
  assert.equal(shouldGround("Fix the bug in this React component."), false);
  assert.equal(
    shouldGround("Summarize this academic report.", { hasAttachments: true }),
    false,
  );
  assert.equal(
    shouldGround("Explain SNNs without using my Garden."),
    false,
  );
});

test("an active Garden supplies context for teaching phrased without trigger words and alongside attachments", () => {
  assert.equal(shouldGround("Cover LTI systems.", { activeGardenSlug: "signals" }), true);
  assert.equal(shouldGround("Build on this lecture.", { activeGardenSlug: "signals", hasAttachments: true }), true);
  assert.equal(shouldGround("Explain resonance without using my Garden.", { activeGardenSlug: "signals" }), false);
});

test("retrieved Garden pages are injected and persisted as response evidence", () => {
  const turnService = readFileSync(
    new URL("../src/lib/conversations/turn-service.ts", import.meta.url),
    "utf8",
  );
  const eventStream = readFileSync(
    new URL("../src/lib/hermes/event-stream.ts", import.meta.url),
    "utf8",
  );

  assert.match(turnService, /retrieveTerminalGardenGrounding/);
  assert.match(turnService, /gardenGrounding\.context/);
  assert.match(turnService, /gardenGrounding:\s*\{/);
  assert.match(eventStream, /kind: "garden"/);
  assert.match(eventStream, /Garden source: \$\{source\.title\}/);
  assert.match(eventStream, /sources\.push\(label\)/);
});

test("active Garden grounding carries actual passages and directed topology without scanning another Garden", async () => {
  const oldRoot = process.env.QUARTZ_CONTENT_PATH;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "garden-teaching-"));
  const slug = `teaching-${crypto.randomUUID()}`;
  const other = `${slug}-other`;
  const inserted = [];
  let userId;
  // Session-service owns authentication and runtime startup. Supply its
  // already-authorized inventory here; exercise the real filesystem, retrieval
  // and topology code without loading Next's runtime inside a Node unit test.
  const authorization = registerHooks({ resolve(specifier, context, nextResolve) {
    if (specifier === "./session-service.ts" && context.parentURL?.endsWith("/terminal-garden-grounding.ts")) {
      const gardens = [slug, other].map(value => ({ slug: value, name: value, isOwner: true }));
      const source = `export function listAuthorizedGardens() { return ${JSON.stringify(gardens)}; }`;
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  } });
  const enrichment = text => ({ state: "ready", text });
  try {
    userId = Number(db.prepare("INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)")
      .run(slug, `${slug}@example.test`, "unused-test-fixture").lastInsertRowid);
    for (const garden of [slug, other]) {
      inserted.push(Number(db.prepare("INSERT INTO clusters (user_id, name, slug) VALUES (?, ?, ?)").run(userId, garden, garden).lastInsertRowid));
      fs.mkdirSync(path.join(root, garden, "notes"), { recursive: true });
    }
    fs.writeFileSync(path.join(root, slug, "notes", "aster.md"), "---\ntitle: Aster memory\n---\n\nAster memory stores a bit in each cell. A bit can be zero or one; a row of bits preserves the recorded state.");
    fs.writeFileSync(path.join(root, other, "notes", "aster.md"), "---\ntitle: Aster memory\n---\n\nUNRELATED_GARDEN_CONTENT about aster memory.");
    const topology = {
      schemaVersion: 1, scoringVersion: "test", sourceRevision: "revision-before-reading",
      garden: { id: inserted[0], slug, title: "Aster", summary: enrichment("Memory") }, folders: [],
      nodes: [
        { id: "page:aster", slug: `${slug}/notes/aster`, relPath: "notes/aster.md", title: "Aster memory", folderId: "folder:$root", summary: enrichment("Storage"), primaryConcepts: [], supportingConcepts: [], claimIds: [] },
        { id: "page:bits", slug: `${slug}/notes/bits`, relPath: "notes/bits.md", title: "Bits", folderId: "folder:$root", summary: enrichment("Two states"), primaryConcepts: [], supportingConcepts: [], claimIds: [] },
      ],
      edges: [{ id: "edge:prerequisite", source: "page:bits", target: "page:aster", origin: "inferred", score: 0.9, threshold: 0.68,
        relationType: "depends-on", direction: "target-to-source", explanation: enrichment("Aster memory uses bits."), evidence: [],
        visual: { width: 2, opacity: 1, distance: 80, strength: 0.7 } }],
      build: { state: "ready", threshold: 0.68 },
    };
    fs.mkdirSync(path.join(root, slug, ".breadboard"));
    const topologyPath = path.join(root, slug, ".breadboard", "thought-topology.json");
    const topologyText = JSON.stringify(topology);
    fs.writeFileSync(topologyPath, topologyText);
    process.env.QUARTZ_CONTENT_PATH = root;
    const request = "Explain how aster memory stores a bit.";
    const input = { userId, request, plan: planTask({ request, authenticated: true }), activeGardenSlug: slug };
    const result = await retrieveTerminalGardenGrounding(input);
    assert.equal(result.attempted, true);
    assert.ok(result.sources.length > 0, JSON.stringify(result));
    assert.ok(result.sources.every(source => source.gardenSlug === slug));
    assert.match(result.context, /a row of bits preserves the recorded state/i);
    assert.match(result.context, /untrusted reference data/);
    assert.match(result.context, /edge:prerequisite/);
    assert.match(result.context, /target-to-source/);
    assert.match(result.context, /revision-before-reading/);
    assert.doesNotMatch(result.context, /UNRELATED_GARDEN_CONTENT/);
    assert.match(result.sources[0].location, /notes%2Faster/);
    assert.equal(fs.readFileSync(topologyPath, "utf8"), topologyText, "retrieval must not rebuild or mutate topology");
    const denied = await retrieveTerminalGardenGrounding({ ...input, activeGardenSlug: "not-authorized" });
    assert.deepEqual(denied.sources, []);
    assert.equal(denied.context, "");
    fs.unlinkSync(topologyPath);
    const noGraph = await retrieveTerminalGardenGrounding(input);
    assert.match(noGraph.context, /Aster memory stores a bit/);
    assert.doesNotMatch(noGraph.context, /edge:prerequisite/);
  } finally {
    authorization.deregister();
    for (const id of inserted) db.prepare("DELETE FROM clusters WHERE id = ?").run(id);
    if (userId !== undefined) db.prepare("DELETE FROM users WHERE id = ?").run(userId);
    if (oldRoot === undefined) delete process.env.QUARTZ_CONTENT_PATH;
    else process.env.QUARTZ_CONTENT_PATH = oldRoot;
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("garden-teaching-"));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
