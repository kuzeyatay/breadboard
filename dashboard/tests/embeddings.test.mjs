import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const embeddings = await import("../src/lib/embeddings.ts");
const semantic = await import("../src/lib/semantic-retrieval.ts");

const dashboardRoot = path.resolve(import.meta.dirname, "..");
const repositoryRoot = path.resolve(dashboardRoot, "..");
const source = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");
const repoSource = (relative) => fs.readFileSync(path.join(repositoryRoot, relative), "utf8");

test("embedding defaults need no key, and say which vector space they are", () => {
  const settings = embeddings.embeddingSettings({});
  assert.equal(settings.model, embeddings.EMBEDDING_MODEL);
  assert.equal(settings.dimension, embeddings.EMBEDDING_DIMENSION);
  assert.equal(settings.configured, false);
  // A local model served by ChatMock is the whole point: retrieval must work on
  // a machine with no provider key at all.
  assert.match(settings.model, /^local\//);
  assert.ok(settings.baseUrl.startsWith("http"));
  assert.ok(settings.apiKey, "an OpenAI-shaped client refuses to send no key");
  assert.equal(
    embeddings.embeddingFingerprint(),
    `${embeddings.EMBEDDING_MODEL}@${embeddings.EMBEDDING_DIMENSION}`,
  );
});

test("a configured provider overrides the default", () => {
  const settings = embeddings.embeddingSettings({
    BREADBOARD_EMBEDDING_MODEL: "text-embedding-3-small",
    BREADBOARD_EMBEDDING_BASE_URL: "https://api.openai.com/v1/",
    BREADBOARD_EMBEDDING_API_KEY: "sk-real",
    BREADBOARD_EMBEDDING_DIMENSIONS: "1536",
  });
  assert.equal(settings.model, "text-embedding-3-small");
  // The trailing slash is trimmed because callers append `/embeddings`.
  assert.equal(settings.baseUrl, "https://api.openai.com/v1");
  assert.equal(settings.apiKey, "sk-real");
  assert.equal(settings.dimension, 1536);
  assert.equal(settings.configured, true);
});

test("embeddings can be switched off deliberately", (t) => {
  for (const value of ["off", "0", "false", "OFF"]) {
    const settings = embeddings.embeddingSettings({ BREADBOARD_EMBEDDINGS: value });
    assert.equal(settings.model, "", value);
    assert.equal(settings.dimension, 0, value);
  }

  // The retriever must agree: off means no provider, which is what puts it back
  // on the lexical-only path it used to be stuck on by default.
  const previous = process.env.BREADBOARD_EMBEDDINGS;
  process.env.BREADBOARD_EMBEDDINGS = "off";
  t.after(() => {
    if (previous === undefined) delete process.env.BREADBOARD_EMBEDDINGS;
    else process.env.BREADBOARD_EMBEDDINGS = previous;
  });
  assert.equal(semantic.embeddingProviderFromEnv(), null);
});

test("the Garden retriever embeds by default instead of degrading to lexical", () => {
  const provider = semantic.embeddingProviderFromEnv();
  assert.ok(provider, "a default install must have an embedder");
  assert.equal(provider.model, embeddings.EMBEDDING_MODEL);
});

test("indexing inside a chat request is bounded", () => {
  const retriever = source("src/lib/semantic-retrieval.ts");
  // Indexing runs inside retrieveGraphRag, which runs inside a chat request, so
  // a cold garden must not be able to stall a reply for minutes.
  assert.match(retriever, /EMBED_CHUNKS_PER_PASS/);
  assert.match(retriever, /EMBED_BUDGET_MS/);
  assert.match(retriever, /Date\.now\(\) > deadline/);
  // The OpenAI SDK is gone: its own retry schedule would outlive that budget.
  assert.ok(!/from 'openai'/.test(retriever));
});

test("stored vectors are keyed by the model that produced them", () => {
  const retriever = source("src/lib/semantic-retrieval.ts");
  // Vectors from two models are not comparable, so the cache key and every
  // lookup carry the model. Without this a model change silently mixes spaces.
  assert.match(retriever, /PRIMARY KEY\(content_hash, model\)/);
  assert.match(retriever, /WHERE content_hash = \? AND model = \?/);
});

test("the knowledge graph embeds through the same gateway as Garden search", () => {
  const builder = source("src/lib/thought-topology/builder.ts");
  assert.match(builder, /embedTexts\(texts, embeddingSettings\(\)/);
  assert.doesNotMatch(builder, /GBrain/);
});
