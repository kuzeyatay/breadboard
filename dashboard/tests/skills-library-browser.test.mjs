import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";
import { querySkillLibrary } from "../src/lib/hermes/skill-library.ts";

test("My skills opens ready documents, explains failures, searches across pages, and separates discovery", { timeout: 90_000 }, async (t) => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const bundle = await build({ absWorkingDir: root, stdin: { resolveDir: root, loader: "tsx", contents: `
    import React from 'react'; import { createRoot } from 'react-dom/client';
    import SkillsCatalogPanel from './src/app/components/hermes/skills-catalog-panel';
    createRoot(document.getElementById('root')).render(<SkillsCatalogPanel runtimeSessionId={null}
      onUse={skill => { window.usedSkill = skill.upstreamId; }} />);` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  });
  const stylesheet = path.join(root, "src/app/globals.css");
  const cssInput = fs.readFileSync(stylesheet, "utf8").replace('@source "../**/*.{js,mjs,cjs,ts,tsx,jsx,mdx}";', '@source "./components/hermes/skills-catalog-panel.tsx";');
  const css = (await postcss([tailwindcss({ base: root })]).process(cssInput, { from: stylesheet })).css;
  const skill = (slug, overrides = {}) => ({
    upstreamId: `builtin/${slug}`, name: slug, slug, command: `/${slug}`, slashCommand: slug,
    source: "Breadboard", sourceType: "first-party", description: `Guidance for ${slug}`,
    descriptionLoaded: true, installationStatus: "installed", availability: "ready", reasons: [],
    requiresOpenCode: false, files: null, audits: null, contract: null, requirements: [],
    installs: 0, ...overrides,
  });
  const skills = [
    skill("book", { upstreamId: "document:book", sourceType: "document", documentStatus: "ready" }),
    skill("building", { sourceType: "document", documentStatus: "building", availability: "unavailable", installationStatus: "not_installed", reasons: ["The document is still being distilled."] }),
    skill("failed", { sourceType: "document", documentStatus: "failed", availability: "unavailable", installationStatus: "not_installed", reasons: ["Extraction failed."] }),
    ...Array.from({ length: 54 }, (_, i) => skill(`writing-${String(i).padStart(2, "0")}`)),
  ];
  const requests = [];
  const server = http.createServer((req, res) => {
    if (req.url === "/app.js") { res.setHeader("Content-Type", "text/javascript"); return res.end(bundle.outputFiles[0].text); }
    if (req.url === "/style.css") { res.setHeader("Content-Type", "text/css"); return res.end(css); }
    if (req.url.startsWith("/api/")) {
      requests.push({ method: req.method, url: req.url });
      const url = new URL(req.url, "http://localhost");
      res.setHeader("Content-Type", "application/json");
      if (url.searchParams.get("filter") === "all" || url.pathname.endsWith("/search")) {
        return res.end(JSON.stringify({ skills: [skill("public-skill")], pagination: { page: 0, perPage: 50, total: 1, hasMore: false } }));
      }
      const result = querySkillLibrary({ skills, query: url.searchParams.get("q") ?? "", page: Number(url.searchParams.get("page") ?? 0) });
      return res.end(JSON.stringify(result));
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end('<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><main id="root" style="max-width:620px;margin:auto"></main><script src="/app.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const browser = await chromium.launch({ headless: true, ...(process.platform === "win32" ? { channel: "msedge" } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const library = page.getByRole("listbox", { name: "My skills", exact: true });
  await library.waitFor();
  assert.equal(await page.getByRole("button", { name: "My skills", exact: true }).getAttribute("aria-pressed"), "true");
  assert.match(requests[0].url, /filter=my/);
  await library.getByRole("button", { name: /^\/book\s/ }).click();
  await page.getByRole("button", { name: "Use /book", exact: true }).click();
  assert.equal(await page.evaluate(() => window.usedSkill), "document:book");
  await page.getByRole("button", { name: "← Back to skills" }).click();
  for (const slug of ["building", "failed"]) {
    await library.getByRole("button", { name: new RegExp(`^/${slug}\\s`) }).click();
    assert.equal(await page.getByRole("button", { name: `Use /${slug}`, exact: true }).count(), 0);
    await page.getByText(slug === "failed" ? "Document skill build failed" : "Building document skill", { exact: true }).waitFor();
    await page.getByRole("button", { name: "← Back to skills" }).click();
  }
  await page.getByRole("textbox", { name: "Search my skills", exact: true }).fill("writing");
  await page.getByRole("status").filter({ hasText: "54 matching skills" }).waitFor();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await library.getByRole("button", { name: /^\/writing-53\s/ }).waitFor();
  assert.equal(await library.getByRole("option").count(), 4);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await library.getByRole("button", { name: /^\/writing-53\s/ }).waitFor();
  assert.equal(requests.some(r => r.method === "POST" || r.url.includes("/search?")), false);
  await page.getByRole("textbox", { name: "Search my skills", exact: true }).fill("");
  await library.getByRole("button", { name: /^\/book\s/ }).waitFor();
  await page.setViewportSize({ width: 375, height: 812 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "library fits narrow screens");
  const output = path.join(root, "artifacts/skills-library-qa");
  fs.mkdirSync(output, { recursive: true });
  await page.screenshot({ path: path.join(output, "my-skills-mobile.png") });
  await page.getByRole("button", { name: "Discover", exact: true }).click();
  await page.getByRole("listbox", { name: "Public skills", exact: true }).waitFor();
  await page.getByRole("button", { name: /^\/public-skill\s/ }).waitFor();
  await page.getByRole("button", { name: "My skills", exact: true }).click();
  await library.getByRole("button", { name: /^\/book\s/ }).waitFor();
  await page.setViewportSize({ width: 800, height: 800 });
  await page.screenshot({ path: path.join(output, "my-skills-desktop.png") });
  assert.deepEqual(errors, []);
});
