import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";

test("Garden image URLs work on the dashboard with Garden access checks", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "garden-image-route-"));
  const previous = process.env.QUARTZ_CONTENT_PATH;
  process.env.QUARTZ_CONTENT_PATH = root;
  const assets = path.join(root, "course", "assets");
  fs.mkdirSync(path.join(assets, "source-visuals"), { recursive: true });
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
  fs.writeFileSync(path.join(assets, "source-visuals", "sphere θ (1).png"), png);
  fs.writeFileSync(path.join(assets, "empty.png"), "");
  fs.writeFileSync(path.join(assets, "private.json"), "private");
  fs.mkdirSync(path.join(assets, "directory.png"));
  fs.mkdirSync(path.join(root, "other", "assets"), { recursive: true });
  fs.writeFileSync(path.join(root, "other", "assets", "private.png"), png);
  fs.symlinkSync(path.join(root, "other", "assets"), path.join(assets, "linked"), "junction");
  fs.symlinkSync(path.join(root, "other"), path.join(root, "alias"), "junction");
  fs.mkdirSync(path.join(root, "asset-alias"));
  fs.symlinkSync(path.join(root, "other", "assets"), path.join(root, "asset-alias", "assets"), "junction");
  globalThis.__gardenImageRoute = { allowed: true, reads: [] };
  t.after(() => {
    if (previous === undefined) delete process.env.QUARTZ_CONTENT_PATH;
    else process.env.QUARTZ_CONTENT_PATH = previous;
    delete globalThis.__gardenImageRoute;
    fs.rmSync(root, { recursive: true, force: true });
  });

  const lib = path.resolve(import.meta.dirname, "../src/lib");
  const bundle = await build({
    entryPoints: [path.resolve(import.meta.dirname, "../src/app/[clusterSlug]/assets/[...assetPath]/route.ts")],
    bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
    plugins: [{ name: "garden-auth-fixture", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\// }, args => args.path === "@/lib/server-auth"
        ? { path: args.path, namespace: "fixture" }
        : { path: path.join(lib, args.path.slice(6) + ".ts") });
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: `
        export async function requireReadableClusterFromSlugOrPublic(slug) {
          globalThis.__gardenImageRoute.reads.push(slug);
          if (!globalThis.__gardenImageRoute.allowed) throw Object.assign(new Error("Unauthorized"), {status: 401});
          return {cluster: {slug}};
        }
        export const routeErrorResponse = error => Response.json({error: error.message}, {status: error.status || 500});
      `, loader: "ts" }));
    }}],
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  const read = (assetPath = ["source-visuals", "sphere θ (1).png"], { clusterSlug = "course", method = "GET", headers } = {}) => module.exports[method](
    new Request(`http://dashboard.test/${clusterSlug}/assets/${assetPath.map(encodeURIComponent).join("/")}`, { method, headers }),
    { params: Promise.resolve({ clusterSlug, assetPath }) },
  );

  await t.test("nested image bytes, MIME type, HEAD, and revalidation", async () => {
    const response = await read();
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.equal(response.headers.get("cache-control"), "private, no-cache");
    assert.equal(response.headers.get("vary"), "Cookie");
    const etag = response.headers.get("etag");
    const head = await read(undefined, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("content-length"), String(png.length));
    assert.equal(await head.text(), "");
    const cached = await read(undefined, { headers: { "if-none-match": `"old", ${etag}` } });
    assert.equal(cached.status, 304);
    assert.equal(await cached.text(), "");
    fs.appendFileSync(path.join(assets, "source-visuals", "sphere θ (1).png"), "changed");
    assert.equal((await read(undefined, { headers: { "if-none-match": etag } })).status, 200);
  });

  await t.test("missing, empty, non-image, directory, traversal and symlink escapes stay unavailable", async () => {
    for (const parts of [[], ["missing.png"], ["empty.png"], ["private.json"], ["directory.png"],
      ["..", "other", "assets", "private.png"], ["../private.png"], ["..\\private.png"],
      ["C:", "private.png"], [".hidden", "private.png"], ["linked", "private.png"]]) {
      assert.equal((await read(parts)).status, 404, JSON.stringify(parts));
    }
    for (const clusterSlug of ["..", "../other", "alias", "asset-alias"]) {
      assert.equal((await read(["private.png"], { clusterSlug })).status, 404, clusterSlug);
    }
  });

  await t.test("authentication is checked even for HEAD and cached images", async () => {
    globalThis.__gardenImageRoute.allowed = false;
    assert.equal((await read()).status, 401);
    assert.equal((await read(undefined, { method: "HEAD" })).status, 401);
    assert.equal((await read(undefined, { headers: { "if-none-match": "*" } })).status, 401);
    globalThis.__gardenImageRoute.allowed = true;
    assert.ok(globalThis.__gardenImageRoute.reads.every(slug => ["course", "alias", "asset-alias"].includes(slug)));
  });

  await t.test("SVG images have a restrictive policy when opened directly", async () => {
    fs.writeFileSync(path.join(assets, "diagram.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const response = await read(["diagram.svg"]);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/svg+xml");
    assert.match(response.headers.get("content-security-policy"), /sandbox/);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  });

  await t.test("old source PDF links open the reader instead of an empty response", async () => {
    for (const method of ["GET", "HEAD"]) {
      const response = await read(["calculus-source.pdf"], { method });
      assert.equal(response.status, 307);
      assert.equal(response.headers.get("location"), "http://dashboard.test/gardens/course/pdf/calculus");
      assert.equal(response.headers.get("cache-control"), "private, no-store");
    }
    globalThis.__gardenImageRoute.allowed = false;
    assert.equal((await read(["calculus-source.pdf"])).status, 401);
    globalThis.__gardenImageRoute.allowed = true;
  });
});
