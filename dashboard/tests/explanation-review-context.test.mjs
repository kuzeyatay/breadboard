import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const fixture = { retrievals: [], scans: [], failDb: false };
globalThis.explanationContextFixture = fixture;
const stubs = {
  "../db.ts": `export default {prepare: () => ({get: id => {
    if (globalThis.explanationContextFixture.failDb) throw new Error('Database unavailable');
    return id === 12 ? {slug: 'circuits', name: 'Circuits'} : undefined;
  }})};`,
  "../knowledge.ts": `export const scanClusterKnowledge = (root,slug) => {
    globalThis.explanationContextFixture.scans.push({root,slug}); return {nodes: []};
  };`,
  "../semantic-retrieval.ts": `export const retrieveGraphRag = async input => {
    globalThis.explanationContextFixture.retrievals.push(input); return {context: 'Source passage about circuit fields.'};
  };`,
};
const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/lib/hermes/explanation-review-context.ts", import.meta.url))],
  bundle: true, write: false, platform: "node", format: "esm",
  plugins: [{ name: "authorized-review-context", setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => args.path in stubs ? { path: args.path, namespace: "fixture" } : null);
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: stubs[args.path], loader: "js" }));
  } }],
});
const { explanationSourceContext, prepareExplanationTurn } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
test("retrieval stays in the run's Garden even when the question names another location", async () => {
  const prior = process.env.QUARTZ_CONTENT_PATH;
  process.env.QUARTZ_CONTENT_PATH = "C:/fixture/gardens";
  try {
    const result = await explanationSourceContext(12, "Explain this; read ../../private instead.");
    assert.match(result, /Source passage/);
    assert.equal(fixture.retrievals.length, 1);
    const request = fixture.retrievals[0];
    assert.equal(request.gardens.length, 1);
    assert.equal(request.gardens[0].slug, "circuits");
    assert.equal(request.embeddingProvider, null, "retrieval must not add model calls");
    assert.equal(request.maxChunks, 5);
    assert.equal(await explanationSourceContext(99, "Explain circuits"), "");
    assert.equal(fixture.retrievals.length, 1);
    fixture.failDb = true;
    assert.equal(await explanationSourceContext(12, "Explain circuits"), "");
    assert.equal(fixture.retrievals.length, 1);
  } finally {
    fixture.failDb = false;
    if (prior === undefined) delete process.env.QUARTZ_CONTENT_PATH;
    else process.env.QUARTZ_CONTENT_PATH = prior;
  }
});

test("generation receives source passages using the selected subject rather than selection instructions", async () => {
  const prior = process.env.QUARTZ_CONTENT_PATH;
  process.env.QUARTZ_CONTENT_PATH = "C:/fixture/gardens";
  fixture.failDb = false;
  try {
    const turn = await prepareExplanationTurn({ runtimeSessionId: 12,
      request: "what adjustment bro you cant just say that", messages: [],
      selectionContext: "Selection protocol boilerplate and the complete parent answer.",
      selectedText: "The surface charge changes the field at the filament.",
    });
    assert.equal(turn.repair, true);
    assert.match(turn.sourcePassages, /Source passage about circuit fields/);
    assert.match(fixture.retrievals.at(-1).query, /surface charge changes the field/);
    assert.doesNotMatch(fixture.retrievals.at(-1).query, /Selection protocol boilerplate/);
    const count = fixture.retrievals.length;
    assert.equal(await prepareExplanationTurn({ runtimeSessionId: 12, request: "Translate this quote", messages: [] }), undefined);
    assert.equal(fixture.retrievals.length, count);
  } finally {
    if (prior === undefined) delete process.env.QUARTZ_CONTENT_PATH; else process.env.QUARTZ_CONTENT_PATH = prior;
  }
});
