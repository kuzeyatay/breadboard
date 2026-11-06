import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

// Exercise both real provider clients. Persistence belongs to the route and
// must not start until a provider has returned the finished image.
const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/lib/hermes/image-generation-fallback.ts", import.meta.url))],
  bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
  plugins: [{ name: "no-artifact-persistence", setup(builder) {
    builder.onResolve({ filter: /^\.\/artifact-store\.ts$/ }, () => ({ path: "store", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
      contents: 'export function createImportedArtifact() { throw new Error("Unexpected persistence during generation"); }',
    }));
  } }],
});
const bundledModule = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), bundledModule, bundledModule.exports);
const { generateImageWithProviderFallback } = bundledModule.exports;
const model = "cliproxy/gemini-3.1-flash-image";
const bytes = Buffer.from("verified-gemini-fallback-image");
const input = { baseURL: "http://image-provider.test/v1", prompt: "A seaside villa" };

function primaryReply(success) {
  const events = success ? [
    { type: "response.output_item.done", item: { type: "image_generation_call", id: "primary-image", result: bytes.toString("base64") } },
    { type: "response.completed", response: { output: [] } },
  ] : [{ type: "response.failed", response: { error: { message: "ChatGPT image quota exhausted" } } }];
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream" },
  });
}

async function withProviders({ primarySuccess = false, geminiStatus = 200 } = {}, work) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const pathname = new URL(url).pathname;
    assert.equal(new URL(url).origin, "http://image-provider.test", "all generation stays on the configured ChatMock route");
    calls.push(pathname);
    if (pathname === "/v1/responses") return primaryReply(primarySuccess);
    if (pathname === "/v1/models") return Response.json({ data: [{ id: model }] });
    assert.equal(pathname, "/v1/chat/completions");
    const payload = JSON.parse(init.body);
    assert.equal(payload.model, model);
    assert.equal(payload.council, false);
    assert.equal(payload.messages[0].content[0].text, input.prompt);
    if (geminiStatus !== 200) return Response.json({ error: { message: "Google subscription quota exhausted" } }, { status: geminiStatus });
    return Response.json({ id: "fallback-response", choices: [{ message: {
      images: [{ image_url: { url: `data:image/jpeg;base64,${bytes.toString("base64")}` } }],
    } }] });
  };
  try { await work(calls); } finally { globalThis.fetch = originalFetch; }
}

test("a failed ChatGPT image request falls back through Gemini without profile credentials", async () => {
  await withProviders({}, async calls => {
    const generated = await generateImageWithProviderFallback({ ...input, signal: new AbortController().signal });
    assert.deepEqual(calls, ["/v1/responses", "/v1/models", "/v1/chat/completions"]);
    assert.deepEqual(generated.buffer, bytes);
    assert.equal(generated.filename, "generated-image.jpg");
    assert.equal(generated.providerMetadata.imageProvider, "google");
    assert.equal(generated.providerMetadata.imageModel, model);
    assert.equal(generated.providerMetadata.providerResponseId, "fallback-response");
    assert.match(generated.providerMetadata.primaryGenerationFailure, /ChatGPT image quota exhausted/);
    assert.equal(generated.fallback.provider, "google_image_generation");
  });
});

test("successful ChatGPT generation does not call Gemini", async () => {
  await withProviders({ primarySuccess: true }, async calls => {
    const generated = await generateImageWithProviderFallback({ ...input, signal: new AbortController().signal });
    assert.deepEqual(calls, ["/v1/responses"]);
    assert.equal(generated.providerMetadata.imageProvider, "chatgpt");
    assert.equal(generated.fallback, undefined);
  });
});

test("both providers failing retains both causes without requesting a Google key", async () => {
  await withProviders({ geminiStatus: 429 }, async calls => {
    await assert.rejects(generateImageWithProviderFallback({ ...input, signal: new AbortController().signal }), error => {
      assert.equal(error.code, "image_generation_fallback_unavailable");
      assert.match(error.message, /ChatGPT image quota exhausted/);
      assert.match(error.message, /Google subscription quota exhausted/);
      assert.doesNotMatch(error.message, /API key/);
      return true;
    });
    assert.equal(calls.length, 3);
  });
});

test("cancelled generation never falls back to Gemini", async () => {
  await withProviders({}, async calls => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(generateImageWithProviderFallback({ ...input, signal: controller.signal }), { name: "AbortError" });
    assert.deepEqual(calls, []);
  });
});
