import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import esbuild from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const built = await esbuild.build({
  entryPoints: [path.join(root, "src/lib/vox-director/model-client.ts")],
  bundle: true, format: "esm", platform: "node", write: false,
  plugins: [{ name: "local-provider", setup(build) {
    build.onResolve({ filter: /agent-browser\/provider\.ts$/ }, () => ({ path: "provider", namespace: "fixture" }));
    build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: 'export const chatmockApiKeyValue = () => "local";', loader: "js" }));
  } }],
});
const { chooseStyle } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);
const target = { baseUrl: "http://127.0.0.1:8765/v1", model: "test-model", reasoningEffort: "xhigh" };
const input = { request: { brief: "Microeconomics", style: null }, title: "Small choices", arc: "how_it_works", beatSummary: "Prices and tradeoffs", cloneRoot: root, themes: {} };

function pendingFetch(_url, { signal }) {
  return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
}

test("slow structured planning can finish past the old three-minute deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let finish;
  t.mock.method(globalThis, "fetch", (_url, { signal, body }) => {
    assert.equal(JSON.parse(body).reasoning_effort, "xhigh");
    return new Promise((resolve, reject) => {
      finish = () => resolve(new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify({ theme: "newsprint-editorial" }) } }] } }] })));
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  });
  const result = chooseStyle(target, input);
  t.mock.timers.tick(181_000);
  finish();
  assert.equal((await result).theme, "newsprint-editorial");
});

test("planning deadline is reported as a timeout rather than a stopped run", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(globalThis, "fetch", pendingFetch);
  const result = chooseStyle(target, input);
  const checked = assert.rejects(result, error => error.code === "model_timeout" && /10 minutes/.test(error.message));
  t.mock.timers.tick(600_000);
  await checked;
});

test("user cancellation remains immediate and distinct from a deadline", async (t) => {
  t.mock.method(globalThis, "fetch", pendingFetch);
  const controller = new AbortController();
  const result = chooseStyle({ ...target, signal: controller.signal }, input);
  controller.abort();
  await assert.rejects(result, error => error.code === "aborted");
  await assert.rejects(chooseStyle({ ...target, signal: controller.signal }, input), error => error.code === "aborted");
  assert.equal(globalThis.fetch.mock.callCount(), 1);
});
