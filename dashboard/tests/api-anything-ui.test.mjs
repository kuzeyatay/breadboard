import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";
import { chromium } from "playwright";

test("built-in website API settings use the authenticated real runtime and recover on mobile", { timeout: 60_000 }, async t => {
  const root = path.resolve(import.meta.dirname, "..");
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "api-anything-ui-"));
  const previous = { ...process.env };
  process.env.BREADBOARD_REPO_ROOT = path.resolve(root, "..");
  process.env.BREADBOARD_DATA_DIR = dataRoot;
  globalThis.__apiAnythingSignedIn = false;
  t.after(() => {
    for (const key of ["BREADBOARD_REPO_ROOT", "BREADBOARD_DATA_DIR", "BREADBOARD_API_ANYTHING_ENABLED"]) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
    delete globalThis.__apiAnythingSignedIn;
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });
  const stubs = {
    "next/server": "export const NextResponse = Response;",
    "@/lib/server-auth.ts": `export class RouteError extends Error { constructor(status, message) { super(message); this.status = status; } }
      export async function requireUserId() { if (!globalThis.__apiAnythingSignedIn) throw new RouteError(401, "Unauthorized"); return 17; }`,
  };
  const routeBundle = await build({ absWorkingDir: root, entryPoints: ["src/app/api/api-anything/route.ts"],
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external", logOverride: { "empty-import-meta": "silent" },
    plugins: [{ name: "auth-fixture", setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => args.path in stubs ? { path: args.path, namespace: "fixture" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: stubs[args.path] }));
    } }],
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", routeBundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  const route = module.exports.GET;
  assert.equal((await route(new Request("http://localhost/api/api-anything"))).status, 401);
  globalThis.__apiAnythingSignedIn = true;
  const found = await (await route(new Request("http://localhost/api/api-anything?query=news.ycombinator.com"))).json();
  assert.equal(found.sites[0].name, "hacker-news");
  const bundle = await build({ absWorkingDir: root, stdin: { resolveDir: root, loader: "tsx", contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {SettingsApiAnything} from './src/app/components/settings-api-anything';
    createRoot(document.getElementById('root')).render(<div style={{margin:16,maxWidth:640}}><SettingsApiAnything/></div>);` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' },
  });
  const stylesheet = path.join(root, "src/app/globals.css");
  const cssInput = fs.readFileSync(stylesheet, "utf8").replace('@source "../**/*.{js,mjs,cjs,ts,tsx,jsx,mdx}";', '@source "./components/settings-api-anything.tsx";');
  const css = (await postcss([tailwindcss({ base: root })]).process(cssInput, { from: stylesheet })).css;
  const server = http.createServer(async (req, res) => {
    if (req.url === "/app.js") { res.setHeader("content-type", "text/javascript"); return res.end(bundle.outputFiles[0].text); }
    if (req.url === "/style.css") { res.setHeader("content-type", "text/css"); return res.end(css); }
    if (req.url.startsWith("/api/api-anything")) {
      const response = await route(new Request(`http://localhost${req.url}`));
      res.statusCode = response.status; res.setHeader("content-type", "application/json"); return res.end(await response.text());
    }
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end('<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><main id="root"></main><script src="/app.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const browser = await chromium.launch({ headless: true, ...(process.platform === "win32" ? { channel: "msedge" } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  process.env.BREADBOARD_API_ANYTHING_ENABLED = "0";
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole("status").filter({ hasText: "Browser control remains available" }).waitFor();
  process.env.BREADBOARD_API_ANYTHING_ENABLED = "1";
  await page.getByRole("button", { name: "Check again", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "114 websites · 323 operations available" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Check again" }).count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  const artifacts = path.join(root, "artifacts/api-anything-qa");
  fs.mkdirSync(artifacts, { recursive: true });
  await page.screenshot({ path: path.join(artifacts, "mobile-light.png") });
  await page.setViewportSize({ width: 1000, height: 600 });
  await page.evaluate(() => document.documentElement.dataset.theme = "dark");
  await page.screenshot({ path: path.join(artifacts, "desktop-dark.png") });
  assert.deepEqual(errors, []);
});
