import { test, expect } from "bun:test";
import { resolveEmbeddingEnv, selectBackend } from "../src/backends/select.ts";

test("default backend is the real GBrain engine", () => {
  const { backend, requested } = selectBackend({ GBRAIN_TEST_MODE: "1" } as never, ":memory:", "none");
  expect(requested).toBe("gbrain");
  expect(backend.backendName).toBe("gbrain");
});

test("explicit fake backend is allowed in test mode and reports 'fake'", () => {
  const { backend, requested } = selectBackend(
    { GBRAIN_BACKEND: "fake", GBRAIN_TEST_MODE: "1" } as never,
    ":memory:",
    "hash",
  );
  expect(requested).toBe("fake");
  expect(backend.backendName).toBe("fake");
});

test("the production backend embeds through the local gateway by default", () => {
  // The default used to be "none", so every unconfigured install ran
  // lexical-only retrieval forever and said so. ChatMock needs no key, so it
  // can be the floor instead.
  const env = resolveEmbeddingEnv({} as never, false);
  expect(env.provider).toBe("openai-compatible");
  expect(env.baseUrl).toBe("http://127.0.0.1:8765/v1");
  expect(env.model).toBe("local/bge-small-en-v1.5");
  expect(env.dimensions).toBe(384);
  // The gateway refuses to configure without a key; ChatMock ignores the value.
  expect(env.apiKey).toBeTruthy();
});

test("a configured provider still overrides every field", () => {
  const env = resolveEmbeddingEnv(
    {
      GBRAIN_EMBEDDING_BASE_URL: "https://api.openai.com/v1",
      GBRAIN_EMBEDDING_API_KEY: "sk-real",
      GBRAIN_EMBEDDING_MODEL: "text-embedding-3-small",
      GBRAIN_EMBEDDING_DIMENSIONS: "1536",
    } as never,
    false,
  );
  expect(env.baseUrl).toBe("https://api.openai.com/v1");
  expect(env.apiKey).toBe("sk-real");
  expect(env.model).toBe("text-embedding-3-small");
  expect(env.dimensions).toBe(1536);
});

test("embeddings can still be turned off outright", () => {
  const env = resolveEmbeddingEnv({ GBRAIN_EMBEDDING_PROVIDER: "none" } as never, false);
  expect(env.provider).toBe("none");
});

test("fake backend is REFUSED in packaged production", () => {
  expect(() =>
    selectBackend({ GBRAIN_BACKEND: "fake", GBRAIN_PACKAGED: "1" } as never, ":memory:", "none"),
  ).toThrow(/refused in packaged production/i);
});

test("fake backend is REFUSED when NODE_ENV=production without test mode", () => {
  expect(() =>
    selectBackend({ GBRAIN_BACKEND: "fake", NODE_ENV: "production" } as never, ":memory:", "none"),
  ).toThrow(/test-only/i);
});
