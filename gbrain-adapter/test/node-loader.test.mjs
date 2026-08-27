import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { load, resolve } from "../src/node-loader.mjs";

const markdownUrl = new URL("../../gbrain/src/core/markdown.ts", import.meta.url).href;
const codeChunkerUrl = new URL(
  "../../gbrain/src/core/chunkers/code.ts",
  import.meta.url,
).href;

test("maps only vendored WASM type=file imports to filesystem paths", async () => {
  const assetUrl = new URL(
    "../../gbrain/src/assets/wasm/tree-sitter.wasm",
    import.meta.url,
  ).href;
  const loaded = await load(
    assetUrl,
    { importAttributes: { type: "file" } },
    async () => {
      throw new Error("default loader must not receive an allowed asset");
    },
  );

  assert.equal(loaded.shortCircuit, true);
  assert.match(loaded.source, /^export default /u);
  assert.ok(loaded.source.includes(JSON.stringify(fileURLToPath(assetUrl))));
});

test("refuses type=file imports outside the vendored WASM root", async () => {
  await assert.rejects(
    load(
      import.meta.url,
      { importAttributes: { type: "file" } },
      async () => ({ format: "module", source: "" }),
    ),
    /refused a type=file import outside/u,
  );
});

test("shims js-yaml only for GBrain's exact markdown module", async () => {
  const shim = await resolve(
    "js-yaml",
    { parentURL: markdownUrl },
    async () => {
      throw new Error("default resolver must not receive the allowlisted import");
    },
  );
  assert.equal(shim.url, "breadboard-gbrain-node:js-yaml");

  const delegated = await resolve(
    "js-yaml",
    { parentURL: import.meta.url },
    async () => ({ url: "default:js-yaml" }),
  );
  assert.equal(delegated.url, "default:js-yaml");
});

test("injects createRequire only into exact allowlisted GBrain modules", async () => {
  const nextLoad = async () => ({
    format: "module-typescript",
    source: 'const tokenizer = require("@dqbd/tiktoken");',
  });
  const allowed = await load(codeChunkerUrl, { importAttributes: {} }, nextLoad);
  assert.match(allowed.source, /__breadboardGbrainCreateRequire/u);
  assert.match(allowed.source, /createRequire/u);

  const alreadyLoaded = await load(
    codeChunkerUrl,
    { importAttributes: {} },
    async () => allowed,
  );
  assert.equal(
    alreadyLoaded.source.match(/const require =/gu)?.length,
    1,
    "a repeated loader identity must not inject a second declaration",
  );

  const unlisted = await load(
    new URL("../src/backends/gbrain-backend.ts", import.meta.url).href,
    { importAttributes: {} },
    nextLoad,
  );
  assert.doesNotMatch(unlisted.source, /__breadboardGbrainCreateRequire/u);
});
