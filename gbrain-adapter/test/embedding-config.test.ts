import { test, expect } from "bun:test";
import { configureEmbedding } from "../src/backends/embedding-config.ts";

test("provider 'none' is truthfully unavailable (lexical)", () => {
  const s = configureEmbedding({ provider: "none", testMode: true });
  expect(s.available).toBe(false);
  expect(s.provider).toBe("none");
});

test("openai-compatible without credentials degrades truthfully to lexical", () => {
  const s = configureEmbedding({ provider: "openai-compatible", testMode: false });
  expect(s.available).toBe(false);
  expect(s.reason).toMatch(/requires .*API_KEY, MODEL, and DIMENSIONS/i);
});

test("openai-compatible with credentials configures the gateway and reports available", () => {
  const s = configureEmbedding({
    provider: "openai-compatible",
    baseUrl: "http://127.0.0.1:9/v1",
    apiKey: "sk-test",
    model: "text-embedding-3-small",
    dimensions: 1536,
    testMode: false,
  });
  expect(s.available).toBe(true);
  expect(s.provider).toBe("openai-compatible");
  expect(s.dimensions).toBe(1536);
});

test("deterministic-test is REJECTED outside test mode", () => {
  expect(() => configureEmbedding({ provider: "deterministic-test", testMode: false })).toThrow(/test mode/i);
});

test("deterministic-test is allowed in test mode and reports available (offline hybrid)", () => {
  const s = configureEmbedding({ provider: "deterministic-test", testMode: true });
  expect(s.available).toBe(true);
  expect(s.model).toBe("deterministic-test");
});

// Opt-in live provider test. Set the real endpoint credentials to run:
//   GBRAIN_LIVE_EMBED=1 GBRAIN_EMBEDDING_BASE_URL=... GBRAIN_EMBEDDING_API_KEY=... \
//   GBRAIN_EMBEDDING_MODEL=... GBRAIN_EMBEDDING_DIMENSIONS=... bun test embedding-config
const LIVE = process.env.GBRAIN_LIVE_EMBED === "1";
test.skipIf(!LIVE)("opt-in: a real OpenAI-compatible endpoint embeds a query", async () => {
  const { embedQuery } = await import("../../gbrain/src/core/embedding.ts");
  const s = configureEmbedding({
    provider: "openai-compatible",
    baseUrl: process.env.GBRAIN_EMBEDDING_BASE_URL,
    apiKey: process.env.GBRAIN_EMBEDDING_API_KEY,
    model: process.env.GBRAIN_EMBEDDING_MODEL,
    dimensions: Number(process.env.GBRAIN_EMBEDDING_DIMENSIONS),
    testMode: false,
  });
  expect(s.available).toBe(true);
  const vec = await embedQuery("a live embedding smoke test");
  expect(vec.length).toBe(Number(process.env.GBRAIN_EMBEDDING_DIMENSIONS));
});
