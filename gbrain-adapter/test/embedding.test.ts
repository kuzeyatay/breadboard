import { test, expect } from "bun:test";
import { chatmockProvider, cosine, resolveProvider } from "../src/embedding.ts";
import { GBrainStore } from "../src/store.ts";

// An address nothing listens on, so "the endpoint is configured but down" is
// exercised for real rather than mocked.
const DEAD_ENDPOINT = "http://127.0.0.1:9/v1";

test("a remote embedder claims nothing until it has been probed", async () => {
  const provider = chatmockProvider({ baseUrl: DEAD_ENDPOINT });
  // Configuration alone is not availability: a provider that reported its
  // declared width here would make the store announce hybrid retrieval it
  // cannot perform.
  expect(provider.dimension).toBe(0);

  const alive = await provider.probe!();
  expect(alive).toBe(false);
  expect(provider.dimension).toBe(0);
  expect(await provider.embed("anything")).toBeNull();
});

test("a store on an unreachable embedder degrades honestly", async () => {
  const store = new GBrainStore({
    pgDir: ":memory:",
    embeddingProvider: "chatmock",
    embeddingBaseUrl: DEAD_ENDPOINT,
  });
  await store.init();
  expect(store.embeddingsAvailable).toBe(false);
  expect(store.mode).toBe("lexical_degraded");
});

test("chatmock is the default provider, and 'none' still turns embeddings off", () => {
  expect(resolveProvider("").name).toMatch(/^chatmock:/);
  expect(resolveProvider("chatmock").name).toMatch(/^chatmock:/);
  // openai-compatible is the name the production backend's config uses; both
  // spellings must reach the same place.
  expect(resolveProvider("openai-compatible").name).toMatch(/^chatmock:/);
  expect(resolveProvider("none").dimension).toBe(0);
  expect(resolveProvider("hash").dimension).toBeGreaterThan(0);
  expect(resolveProvider("something-unknown").dimension).toBe(0);
});

test("vectors of different widths are not comparable", () => {
  const short = [1, 0, 0];
  const long = [1, 0, 0, 0, 0];
  // Truncating to the shorter vector would report a confident 1.0 here, which
  // is how a change of embedding model used to corrupt ranking silently.
  expect(cosine(short, long)).toBe(0);
  expect(cosine(short, short)).toBeCloseTo(1, 6);
  expect(cosine([], [])).toBe(0);
});
