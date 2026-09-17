import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { quartzUrlFromBase } from "../src/lib/quartz-url.ts";

// Compare against the publisher itself so filename rules cannot silently drift.
const result = await build({
  stdin: { contents: 'export { slugifyFilePath } from "../quartz/quartz/util/path.ts"', resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  bundle: true, platform: "node", format: "cjs", write: false,
});
const loaded = { exports: {} };
new Function("module", "exports", result.outputFiles[0].text)(loaded, loaded.exports);
const { slugifyFilePath } = loaded.exports;

test("Quartz reader URLs match published nested Markdown filenames", () => {
  const base = "http://127.0.0.1:61374";
  for (const filename of [
    "electromagnetism-1/learning/1. Fields and the Mathematical Language of Space/1.1 Why Electromagnetic Fields Matter.md",
    "physics/Fields & Waves/50% charge?#.md",
    "physics/Électricité/Two  spaces.md",
    "physics/Units/_index.md",
    "physics/already-published.html",
    "physics/1.1-already-slugged.md",
  ]) {
    const publishedPath = slugifyFilePath(filename).split("/").map(encodeURIComponent).join("/");
    assert.equal(quartzUrlFromBase(base, ...filename.split("/")), `${base}/${publishedPath}/`, filename);
    assert.equal(quartzUrlFromBase(base, filename.replace(/\.md$/, "")), `${base}/${publishedPath}/`, filename);
  }
});

test("Quartz reader URLs retain the launch base and garden index", () => {
  assert.equal(quartzUrlFromBase("http://127.0.0.1:61374/"), "http://127.0.0.1:61374/");
  assert.equal(quartzUrlFromBase("https://garden.example/base", "/physics/"), "https://garden.example/base/physics/");
});
