import { test, expect, beforeAll, afterAll } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GBrainEngineBackend } from "../src/backends/gbrain-backend.ts";

// End-to-end against the ACTUAL vendored GBrain engine (no mocks). Deterministic
// embeddings are injected through GBrain's supported test seam so vector search
// runs offline. Requires GBRAIN_TEST_MODE=1 (set below).
process.env.GBRAIN_TEST_MODE = "1";

const SRC_A = "gbrain-src-alice"; // user 1
const SRC_B = "gbrain-src-bob"; //   user 2 (a DIFFERENT user)

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gbrain-real-"));
const pgDir = path.join(tmpDir, "pglite");

let backend: GBrainEngineBackend;

function detEnv() {
  return { provider: "deterministic-test" as const, testMode: true };
}

const aliceScope = { userId: "1", authorizedSourceIds: [SRC_A] };
const bobScope = { userId: "2", authorizedSourceIds: [SRC_B] };

beforeAll(async () => {
  backend = new GBrainEngineBackend({ pgDir, embeddingEnv: detEnv() });
  await backend.init();

  await backend.registerSource(SRC_A, "alice/electronics", [
    {
      pageId: "rails",
      title: "Breadboard Power Rails",
      path: "rails.md",
      content: "The breadboard rails distribute power. A capacitor across the rails smooths supply noise.",
      links: ["decoupling"], // explicit graph link
    },
    {
      pageId: "decoupling",
      title: "Decoupling Capacitors",
      path: "decoupling.md",
      content: "A decoupling capacitor stabilizes the local supply voltage. A common value is 100 nanofarads.",
      links: [],
    },
    {
      pageId: "supply-early",
      title: "Supply Voltage (early)",
      path: "supply-early.md",
      content: "In the early design the breadboard supply voltage is five volts.",
      links: [],
    },
    {
      pageId: "supply-late",
      title: "Supply Voltage (revised)",
      path: "supply-late.md",
      content: "Revised: the breadboard supply voltage is now three point three volts, not five volts.",
      links: [],
    },
  ]);

  await backend.registerSource(SRC_B, "bob/physics", [
    {
      pageId: "tunneling",
      title: "Quantum Tunneling",
      path: "tunneling.md",
      // Overlapping vocabulary ("capacitor") with Alice's garden.
      content: "Quantum tunneling lets a particle cross a barrier. A capacitor in a resonant tunneling diode exploits this quantum effect.",
      links: [],
    },
  ]);
}, 120000);

afterAll(async () => {
  await backend.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("the real GBrain engine is the backend (not the fake)", () => {
  expect(backend.backendName).toBe("gbrain");
  expect(backend.embeddingsAvailable).toBe(true);
  expect(backend.mode).toBe("hybrid");
});

test("1. actual GBrain lexical search returns the expected page", async () => {
  const res = await backend.search(aliceScope, "rails distribute power", undefined, 5);
  expect(res.results.length).toBeGreaterThan(0);
  expect(res.results.some((r) => r.citation.pageId === "rails")).toBe(true);
});

test("2. actual GBrain vector search (deterministic embeddings) ranks semantically", async () => {
  const res = await backend.search(aliceScope, "stabilize local supply near a chip", undefined, 5);
  expect(res.mode).toBe("hybrid");
  expect(res.results.length).toBeGreaterThan(0);
  // decoupling is the semantically closest page.
  expect(res.results.some((r) => r.citation.pageId === "decoupling")).toBe(true);
});

test("3. graph traversal uses real indexed links", async () => {
  const res = await backend.graphNeighbors(aliceScope, "rails", SRC_A, 10);
  expect(res.neighbors.some((n) => n.pageId === "decoupling" && n.relation === "links_to")).toBe(true);
  // Backlink direction from the other side.
  const back = await backend.graphNeighbors(aliceScope, "decoupling", SRC_A, 10);
  expect(back.neighbors.some((n) => n.pageId === "rails" && n.relation === "linked_from")).toBe(true);
});

test("4. multi-source synthesis assembles multiple authorized pages with citations", async () => {
  const res = await backend.synthesize(aliceScope, "capacitor", undefined, 6);
  expect(res.citations.length).toBeGreaterThan(1);
  for (const c of res.citations) expect(c.sourceId).toBe(SRC_A);
  expect(res.synthesis.length).toBeGreaterThan(0);
});

test("5. contradictory statements across pages are both retrievable (gap/contradiction surfacing)", async () => {
  const res = await backend.search(aliceScope, "breadboard supply voltage volts", undefined, 8);
  const slugs = res.results.map((r) => r.citation.pageId);
  expect(slugs).toContain("supply-early");
  expect(slugs).toContain("supply-late");
});

test("6. durable retrieval survives a full close + reopen on the same data dir", async () => {
  // Isolated dir so we can close the writer before reopening (PGLite is
  // single-writer; a second opener on a live dir would contend on the lock).
  const durDir = path.join(tmpDir, "durable");
  const first = new GBrainEngineBackend({ pgDir: durDir, embeddingEnv: detEnv() });
  await first.init();
  await first.registerSource(SRC_A, "alice/electronics", [
    { pageId: "ohms", title: "Ohm's Law", path: "ohms.md", content: "Voltage equals current times resistance across a resistor.", links: [] },
  ]);
  await first.close(); // flush + release lock

  const second = new GBrainEngineBackend({ pgDir: durDir, embeddingEnv: detEnv() });
  await second.init();
  try {
    const res = await second.search(aliceScope, "voltage current resistance", undefined, 5);
    expect(res.results.some((r) => r.citation.pageId === "ohms")).toBe(true);
  } finally {
    await second.close();
  }
}, 180000);

test("7. unauthorized source is excluded from SEARCH (cross-user isolation)", async () => {
  // Alice queries a term present ONLY in Bob's garden; authorized for src-a only.
  const res = await backend.search(aliceScope, "quantum tunneling barrier", undefined, 5);
  for (const r of res.results) {
    expect(r.citation.sourceId).toBe(SRC_A);
    expect(r.excerpt.toLowerCase()).not.toContain("quantum tunneling");
  }
});

test("8. unauthorized source is excluded from GRAPH traversal", async () => {
  // Alice asks for connections of a Bob page while authorized only for src-a.
  const res = await backend.graphNeighbors(aliceScope, "tunneling", SRC_B, 10);
  expect(res.neighbors.length).toBe(0);
});

test("9. synthesis drops unauthorized citations even for a shared term", async () => {
  // "capacitor" appears in BOTH Alice's and Bob's gardens.
  const res = await backend.synthesize(aliceScope, "capacitor", undefined, 8);
  for (const c of res.citations) expect(c.sourceId).toBe(SRC_A);
  expect(res.citations.some((c) => c.pageId === "tunneling")).toBe(false);
});

test("9b. Bob cannot see Alice's pages", async () => {
  const res = await backend.search(bobScope, "breadboard rails decoupling", undefined, 5);
  for (const r of res.results) expect(r.citation.sourceId).toBe(SRC_B);
});

test("10. clean disconnect + reconnect cycle works", async () => {
  const cycleDir = path.join(tmpDir, "cycle");
  const b = new GBrainEngineBackend({ pgDir: cycleDir, embeddingEnv: detEnv() });
  await b.init();
  await b.registerSource(SRC_A, "alice", [
    { pageId: "p1", title: "P1", path: "p1.md", content: "capacitor across the rails", links: [] },
  ]);
  const stats = await b.stats();
  expect(stats.pages).toBeGreaterThanOrEqual(1);
  await b.close();
  // Re-init after close on the same dir must succeed.
  await b.init();
  const stats2 = await b.stats();
  expect(stats2.pages).toBeGreaterThanOrEqual(1);
  await b.close();
}, 180000);

test("empty scope fails closed on the real backend", async () => {
  const res = await backend.search({ userId: "1", authorizedSourceIds: [] }, "capacitor", undefined, 5);
  expect(res.results.length).toBe(0);
});
