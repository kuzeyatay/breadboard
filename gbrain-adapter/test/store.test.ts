import { test, expect } from "bun:test";
import { GBrainStore } from "../src/store.ts";

// Two fixture "gardens" (sources) with deliberately overlapping terminology so a
// source-scope failure is detectable: both mention "capacitor", but only source
// A discusses "breadboard rails" and only source B discusses "quantum tunneling".

const SOURCE_A = "gbrain-src-alice-electronics";
const SOURCE_B = "gbrain-src-bob-physics";

function fixtureA() {
  return [
    {
      pageId: "rails",
      title: "Breadboard Power Rails",
      path: "electronics/rails.md",
      content:
        "The breadboard rails distribute power. A capacitor across the rails smooths supply noise. Connect the red rail to positive.",
      links: ["decoupling"],
    },
    {
      pageId: "decoupling",
      title: "Decoupling Capacitors",
      path: "electronics/decoupling.md",
      content: "A decoupling capacitor sits near each chip on the breadboard to stabilize the local supply voltage.",
    },
  ];
}

function fixtureB() {
  return [
    {
      pageId: "tunneling",
      title: "Quantum Tunneling",
      path: "physics/tunneling.md",
      content:
        "Quantum tunneling lets a particle cross a barrier. A capacitor in a resonant tunneling diode exploits this quantum effect.",
    },
  ];
}

async function seeded(provider = "none") {
  const store = new GBrainStore({ pgDir: ":memory:", embeddingProvider: provider });
  await store.init();
  await store.registerSource(SOURCE_A, "alice/electronics", fixtureA());
  await store.registerSource(SOURCE_B, "bob/physics", fixtureB());
  return store;
}

test("durable index registers pages and chunks", async () => {
  const store = await seeded();
  const stats = await store.stats();
  expect(stats.sources).toBe(2);
  expect(stats.pages).toBe(3);
  expect(stats.chunks).toBeGreaterThanOrEqual(3);
  await store.close();
});

test("scoped search returns only authorized source", async () => {
  const store = await seeded();
  const res = await store.search(
    { userId: "1", authorizedSourceIds: [SOURCE_A] },
    "breadboard rails capacitor",
    undefined,
    5,
  );
  expect(res.results.length).toBeGreaterThan(0);
  for (const r of res.results) expect(r.citation.sourceId).toBe(SOURCE_A);
  await store.close();
});

test("cross-source leak is impossible even with a shared term", async () => {
  const store = await seeded();
  // Alice authorized only for A queries a term present in BOTH sources.
  const res = await store.search(
    { userId: "1", authorizedSourceIds: [SOURCE_A] },
    "capacitor quantum tunneling",
    undefined,
    5,
  );
  for (const r of res.results) {
    expect(r.citation.sourceId).toBe(SOURCE_A);
    expect(r.excerpt.toLowerCase()).not.toContain("quantum tunneling");
  }
  await store.close();
});

test("requesting an unauthorized source id does not broaden scope", async () => {
  const store = await seeded();
  const res = await store.search(
    { userId: "1", authorizedSourceIds: [SOURCE_A] },
    "capacitor",
    [SOURCE_B], // explicitly asks for B while only authorized for A
    5,
  );
  // Intersection is empty -> no results, fail closed.
  expect(res.results.length).toBe(0);
  await store.close();
});

test("empty scope fails closed", async () => {
  const store = await seeded();
  const res = await store.search({ userId: "1", authorizedSourceIds: [] }, "capacitor", undefined, 5);
  expect(res.results.length).toBe(0);
  await store.close();
});

test("retrieve enforces scope", async () => {
  const store = await seeded();
  const denied = await store.retrieve({ userId: "1", authorizedSourceIds: [SOURCE_A] }, SOURCE_B, "tunneling");
  expect(denied.found).toBe(false);
  const ok = await store.retrieve({ userId: "1", authorizedSourceIds: [SOURCE_A] }, SOURCE_A, "rails");
  expect(ok.found).toBe(true);
  expect(ok.citation?.sourceId).toBe(SOURCE_A);
  await store.close();
});

test("graph neighbors stay within scope", async () => {
  const store = await seeded();
  const res = await store.graphNeighbors({ userId: "1", authorizedSourceIds: [SOURCE_A] }, "rails", SOURCE_A, 10);
  expect(res.neighbors.length).toBeGreaterThan(0);
  for (const n of res.neighbors) expect(n.sourceId).toBe(SOURCE_A);
  await store.close();
});

test("lexical_degraded mode is reported honestly without embeddings", async () => {
  const store = await seeded("none");
  expect(store.mode).toBe("lexical_degraded");
  const res = await store.search({ userId: "1", authorizedSourceIds: [SOURCE_A] }, "capacitor", undefined, 5);
  expect(res.mode).toBe("lexical_degraded");
  await store.close();
});

test("hybrid mode is reported when a deterministic embedder is available", async () => {
  const store = await seeded("hash");
  expect(store.mode).toBe("hybrid");
  expect(store.embeddingsAvailable).toBe(true);
  const res = await store.search({ userId: "1", authorizedSourceIds: [SOURCE_A] }, "capacitor rails", undefined, 5);
  expect(res.mode).toBe("hybrid");
  expect(res.results.length).toBeGreaterThan(0);
  await store.close();
});

test("synthesize returns citations mapped to authorized source only", async () => {
  const store = await seeded("hash");
  const res = await store.synthesize({ userId: "1", authorizedSourceIds: [SOURCE_A] }, "capacitor", undefined, 5);
  expect(res.citations.length).toBeGreaterThan(0);
  for (const c of res.citations) expect(c.sourceId).toBe(SOURCE_A);
  expect(res.synthesis.length).toBeGreaterThan(0);
  await store.close();
});

test("re-registering a source is idempotent (durable overwrite, no dup rows)", async () => {
  const store = await seeded();
  await store.registerSource(SOURCE_A, "alice/electronics", fixtureA());
  const stats = await store.stats();
  expect(stats.pages).toBe(3); // unchanged, not doubled
  await store.close();
});
