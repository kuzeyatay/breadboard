import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { appAssetUrl, createAppAssetLoader } from "../src/main/app-assets";
import { artifactPreviewUrl } from "../src/main/artifact-preview-transport";
import { runElectronFixture } from "./helpers/run-electron-fixture";

const base = "http://127.0.0.1:32123/new-tab";
test("private preview transport accepts only artifact previews on the app origin", () => {
  const preview = "http://127.0.0.1:32123/api/hermes/artifacts/art_test/preview?version=2";
  assert.equal(artifactPreviewUrl(preview, base)?.href, preview);
  for (const value of [preview.replace("32123", "32124"), preview.replace("127.0.0.1:32123", "example.com"),
    preview.replace("/preview", "/download"), preview.replace("art_test", "%2e%2e"),
    "http://127.0.0.1:32123/api/auth/session", preview.replace("http://", "http://user:pass@")]) {
    assert.equal(artifactPreviewUrl(value, base), null, value);
  }
});
test("only public static files of the current loopback dashboard use the asset transport", () => {
  assert.equal(appAssetUrl("http://127.0.0.1:32123/_next/static/chunks/home.js?v=1", base)?.pathname, "/_next/static/chunks/home.js");
  assert.equal(appAssetUrl("http://127.0.0.1:32123/logo.png", base)?.pathname, "/logo.png");
  for (const url of ["https://example.com/_next/static/home.js", "http://127.0.0.1:32124/_next/static/home.js",
    "http://127.0.0.1:32123/api/auth/session", "http://127.0.0.1:32123/new-tab", "http://127.0.0.1:32123/uploads/private.png",
    "http://127.0.0.1:32123/_next/static/%2fapi/auth/session", "http://user:pass@127.0.0.1:32123/_next/static/a.js"])
    assert.equal(appAssetUrl(url, base), null, url);
  assert.equal(appAssetUrl("https://example.com/_next/static/a.js", "https://example.com"), null);
  assert.equal(appAssetUrl("http://127.0.0.1:32123/_next/static/a.js", null), null);
});

test("concurrent tabs share a completed immutable asset, without cookies or cache-entry locks", async () => {
  let reads = 0; let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const load = createAppAssetLoader((async (_url, init) => {
    reads++; assert.equal(init?.redirect, "error");
    assert.equal(new Headers(init?.headers).has("Cookie"), false);
    await gate;
    return new Response("startup code", { headers: { "cache-control": "public, max-age=31536000, immutable",
      "content-type": "text/javascript", "content-encoding": "gzip", "set-cookie": "must-not-copy=yes" } });
  }) as typeof fetch);
  const first = load("http://127.0.0.1:32123/_next/static/a.js");
  const second = load("http://127.0.0.1:32123/_next/static/a.js");
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a, b); assert.equal(reads, 1);
  assert.equal(await load("http://127.0.0.1:32123/_next/static/a.js"), a);
  assert.equal(reads, 1);
  assert.equal(new Headers(a.headers).get("content-encoding"), null);
  assert.equal(new Headers(a.headers).get("set-cookie"), null);
});

test("failed and mutable responses are retried, never saved as startup code", async () => {
  let reads = 0;
  const load = createAppAssetLoader((async () => {
    reads++;
    if (reads === 1) throw new Error("temporary reset");
    return new Response("missing", { status: 404, headers: { "cache-control": "immutable" } });
  }) as typeof fetch);
  assert.equal((await load("one")).status, 404);
  assert.equal(reads, 2, "a transient reset is retried inside the shared load");
  await load("one"); assert.equal(reads, 3);
  let mutableReads = 0;
  const mutable = createAppAssetLoader((async () => { mutableReads++; return new Response("dev", { headers: { "cache-control": "no-store" } }); }) as typeof fetch);
  await mutable("dev"); await mutable("dev"); assert.equal(mutableReads, 2);
});

test("cold asset fanout is bounded and retries are shared by every waiting tab", async () => {
  let active = 0; let peak = 0;
  const attempts = new Map<string, number>();
  const load = createAppAssetLoader((async (input) => {
    const url = String(input);
    const attempt = (attempts.get(url) ?? 0) + 1;
    attempts.set(url, attempt);
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 10));
    active--;
    return new Response(attempt === 1 ? "restarting" : "code", {
      status: attempt === 1 ? 503 : 200,
      headers: { "cache-control": "public, immutable" },
    });
  }) as typeof fetch);
  const urls = Array.from({ length: 24 }, (_, i) => `chunk-${i}`);
  const results = await Promise.all(urls.flatMap(url => [load(url), load(url), load(url)]));
  assert.ok(results.every(asset => asset.status === 200));
  assert.equal(peak, 4, "the asset storm leaves room for documents and API reads");
  assert.ok([...attempts.values()].every(count => count === 2));
  await load(urls[0]!);
  assert.equal(attempts.get(urls[0]!), 2, "the recovered immutable chunk is cached");
});

test("asset recovery is bounded and a broken response body is retried", async () => {
  let failures = 0;
  const unavailable = createAppAssetLoader((async () => { failures++; throw new Error("offline"); }) as typeof fetch);
  await assert.rejects(unavailable("offline"), /offline/);
  assert.equal(failures, 3);
  let reads = 0;
  const truncated = createAppAssetLoader((async () => {
    if (++reads === 1) return new Response(new ReadableStream({ start(controller) {
      controller.error(new Error("connection lost during body"));
    } }));
    return new Response("complete code");
  }) as typeof fetch);
  assert.equal(new TextDecoder().decode((await truncated("truncated")).bytes), "complete code");
  assert.equal(reads, 2);
});

test("real Electron loads and reuses startup assets while all six API sockets stay occupied", { timeout: 35_000 }, async t => {
  const desktop = path.resolve(__dirname, "../..");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bb-app-assets-"));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_TEST_CONTEXT;
  try {
    const result = await runElectronFixture(require("electron") as string,
      [path.join(desktop, "tests/fixtures/app-assets.cjs"), directory], desktop, env, 30_000);
    assert.equal(result.error, undefined, `${result.error?.message}\n${result.output}`);
    assert.equal(result.status, 0, result.output);
    const timing = result.output.split(/\r?\n/).find(line => line.startsWith('{"assetReadyMs":'));
    if (timing) t.diagnostic(timing);
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
