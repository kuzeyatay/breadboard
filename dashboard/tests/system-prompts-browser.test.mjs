import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(path.resolve(import.meta.dirname, "../package.json"));
const esbuild = require("esbuild");
const postcss = require("postcss");
const tailwindcss = require("@tailwindcss/postcss");
const { chromium } = require("playwright");

test("System settings autosave through the real API and storage, survive races, and fit desktop and mobile", { timeout: 90_000 }, async (t) => {
  const root = path.resolve(import.meta.dirname, "..");
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-system-ui-"));
  process.env.BREADBOARD_DATA_DIR = temporary;
  process.env.BREADBOARD_REPO_ROOT = path.dirname(root);
  const { default: db } = await import("../src/lib/db.ts");
  db.prepare("INSERT INTO users (id, username, email, password_hash) VALUES (703, 'prompts-ui', 'prompts-ui@test.local', 'test')").run();
  db.prepare("INSERT INTO users (id, username, email, password_hash) VALUES (704, 'prompts-other', 'prompts-other@test.local', 'test')").run();
  globalThis.__systemPromptsTestUserId = 703;
  const { composeHermesSystemPrompt } = await import("../src/lib/hermes/system-prompts.ts");
  const { systemPromptText } = await import("../src/lib/system-prompts/service.ts");
  let signedIn = true;
  globalThis.__systemPromptsTestAuth = () => signedIn;
  globalThis.__systemPromptsTestDb = db;
  t.after(() => {
    db.close();
    delete globalThis.__systemPromptsTestAuth;
    delete globalThis.__systemPromptsTestDb;
    delete globalThis.__systemPromptsTestUserId;
    fs.rmSync(temporary, { recursive: true, force: true });
  });
  const stubs = {
    "next/server": "export const NextResponse = Response;",
    "@/lib/server-auth": `export class RouteError extends Error { constructor(status, message) { super(message); this.status = status; } }
      export async function requireUserId() { if (!globalThis.__systemPromptsTestAuth()) throw new RouteError(401, 'Unauthorized'); return globalThis.__systemPromptsTestUserId; }
      export function routeErrorResponse(error) { return Response.json({error:error.message},{status:error.status ?? 500}); }`,
  };
  const routeBundle = await esbuild.build({
    entryPoints: [path.join(root, "src/app/api/system-prompts/route.ts")], absWorkingDir: root,
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    plugins: [{ name: "test-session", setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.path in stubs) return { path: args.path, namespace: "fixture" };
        if (args.path === "../db.ts" && args.importer.endsWith("system-prompts/service.ts")) return { path: "database", namespace: "fixture" };
      });
      build.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({ contents: args.path === "database" ? "export default globalThis.__systemPromptsTestDb;" : stubs[args.path] }));
    } }],
  });
  const routeModule = { exports: {} };
  new Function("require", "module", "exports", routeBundle.outputFiles[0].text)(createRequire(path.join(root, "package.json")), routeModule, routeModule.exports);
  const route = routeModule.exports;
  signedIn = false;
  assert.equal((await route.GET()).status, 401);
  assert.equal((await route.PATCH(new Request("http://local/api/system-prompts", { method: "PATCH", body: "{}" }))).status, 401);
  signedIn = true;
  for (const body of ["not json", "null", "[]", JSON.stringify({ id: "chat-core", content: "x" })]) {
    assert.equal((await route.PATCH(new Request("http://local/api/system-prompts", { method: "PATCH", body }))).status, 400);
  }
  const initialResponse = await route.GET();
  assert.equal(initialResponse.headers.get("cache-control"), "no-store");
  const original = (await initialResponse.json()).prompts.find((item) => item.id === "chat-core").content;

  const bundle = await esbuild.build({
    absWorkingDir: root, nodePaths: [path.join(root, "node_modules")], stdin: { resolveDir: root, loader: "tsx", contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import SettingsDialog from './src/app/components/settings-dialog';
      function App() { const [open,setOpen] = React.useState(true); return <>
        <button onClick={()=>setOpen(true)}>Open settings</button>
        {open && <SettingsDialog initialTab="system" onClose={()=>setOpen(false)}/>}</>; }
      createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' },
    plugins: [{ name: "unrelated-settings", setup(build) {
      build.onResolve({ filter: /settings-(agent-memory|accounts|connections|messaging|guardrails|mcp|providers|recall|speech|voice-calibration)$/ },
        (args) => ({ path: args.path, namespace: "fixture" }));
      build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export default function UnrelatedSettings(){return null;}" }));
    } }],
  });
  const stylesheet = path.join(root, "src/app/globals.css");
  const cssInput = fs.readFileSync(stylesheet, "utf8").replace('@source "../**/*.{js,mjs,cjs,ts,tsx,jsx,mdx}";', '@source "./components/settings-system.tsx"; @source "./components/settings-dialog.tsx";');
  const css = (await postcss([tailwindcss({ base: root })]).process(cssInput, { from: stylesheet })).css;
  let failReads = true;
  let failWrites = false;
  let holdNextWrite = false;
  let holdNextRead = false;
  let releaseRead;
  let releaseWrite;
  const writes = [];
  const server = http.createServer(async (req, res) => {
    if (req.url === "/app.js") { res.setHeader("Content-Type", "text/javascript"); return res.end(bundle.outputFiles[0].text); }
    if (req.url === "/style.css") { res.setHeader("Content-Type", "text/css"); return res.end(css); }
    if (req.url === "/api/system-prompts") {
      res.setHeader("Content-Type", "application/json");
      if ((req.method === "GET" && failReads) || (req.method === "PATCH" && failWrites)) {
        res.statusCode = 503; return res.end(JSON.stringify({ error: "Temporarily unavailable." }));
      }
      let body = ""; for await (const chunk of req) body += chunk;
      const response = await route[req.method](new Request("http://local/api/system-prompts", { method: req.method, ...(body ? { body } : {}) }));
      if (req.method === "GET" && holdNextRead) { holdNextRead = false; await new Promise(resolve => { releaseRead = resolve; }); }
      if (req.method === "PATCH") {
        writes.push(JSON.parse(body));
        if (holdNextWrite) { holdNextWrite = false; await new Promise((resolve) => { releaseWrite = resolve; }); }
      }
      res.statusCode = response.status; return res.end(await response.text());
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end('<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><main id="root"></main><script src="/app.js"></script></body></html>');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { releaseRead?.(); releaseWrite?.(); server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  const browser = await chromium.launch({ headless: true, ...(process.platform === "win32" ? { channel: "msedge" } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const url = `http://127.0.0.1:${server.address().port}`;
  await page.goto(url);
  await page.getByRole("alert").waitFor();
  failReads = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Main assistant system prompt", exact: true });
  await editor.waitFor();
  assert.equal(await page.getByRole("tab", { name: "System", exact: true }).getAttribute("aria-selected"), "true");
  assert.equal(await editor.inputValue(), original);
  // StrictMode starts two loads. A late first response cannot replace edits
  // made after the second load has already rendered the editor.
  holdNextRead = true;
  await page.reload();
  await editor.waitFor();
  await editor.fill("TYPED_AFTER_LATEST_LOAD");
  await page.getByRole("status").filter({ hasText: "All changes saved" }).waitFor();
  assert.ok(releaseRead, "the older initial load is still in flight");
  releaseRead(); releaseRead = undefined;
  await page.waitForLoadState("networkidle");
  assert.equal(await editor.inputValue(), "TYPED_AFTER_LATEST_LOAD");
  await editor.fill("Reply in Italian. UI_LIVE_ONE");
  await page.getByText("Custom prompt · Applied", { exact: true }).waitFor();
  assert.equal(systemPromptText("chat-core", 703), "Reply in Italian. UI_LIVE_ONE");
  const composed = composeHermesSystemPrompt({ userId: 703, surface: "dashboard_terminal", decision: {
    mode: "knowledge", implementationRequired: false, allowedTools: [], authorizedRoots: [], authorizedPathPatterns: [], allowedOperations: [], allowedCommandPatterns: [],
  } });
  assert.match(composed, /UI_LIVE_ONE/);

  // JSON escaping can exceed the keepalive budget even when the raw text fits.
  const escapedPrompt = String.fromCharCode(92).repeat(40_000);
  assert.ok(new Blob([escapedPrompt]).size < 48_000);
  assert.ok(new Blob([JSON.stringify({ content: escapedPrompt })]).size > 65_536);
  await editor.fill(escapedPrompt);
  await page.getByRole("status").filter({ hasText: "All changes saved" }).waitFor();
  assert.equal(systemPromptText("chat-core", 703), escapedPrompt);
  await editor.fill("Reply in Italian. UI_LIVE_ONE");
  await page.getByRole("status").filter({ hasText: "All changes saved" }).waitFor();

  holdNextWrite = true;
  await editor.fill("OLDER_SAVE");
  await page.waitForFunction(() => document.querySelector('textarea').value === 'OLDER_SAVE');
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { clearInterval(interval); reject(new Error("No pending write")); }, 5000);
    const interval = setInterval(() => { if (releaseWrite) { clearInterval(interval); clearTimeout(timeout); resolve(); } }, 20);
  });
  await editor.fill("NEWEST_SAVE");
  releaseWrite(); releaseWrite = undefined;
  await page.getByRole("status").filter({ hasText: "All changes saved" }).waitFor();
  assert.equal(await editor.inputValue(), "NEWEST_SAVE");
  assert.equal(systemPromptText("chat-core", 703), "NEWEST_SAVE");

  failWrites = true;
  await editor.fill("RETRY_ME");
  await page.getByRole("alert").waitFor();
  assert.equal(systemPromptText("chat-core", 703), "NEWEST_SAVE");
  assert.equal(await editor.inputValue(), "RETRY_ME");
  failWrites = false;
  await page.getByRole("button", { name: "Retry save", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "All changes saved" }).waitFor();
  assert.equal(systemPromptText("chat-core", 703), "RETRY_ME");

  const other = await browser.newPage();
  await other.goto(url);
  const otherEditor = other.getByRole("textbox", { name: "Main assistant system prompt", exact: true });
  await otherEditor.waitFor();
  await editor.fill("FIRST_WINDOW");
  await page.getByRole("status").filter({ hasText: "All changes saved" }).waitFor();
  await otherEditor.fill("SECOND_WINDOW_DRAFT");
  await other.getByRole("alert").filter({ hasText: "another window" }).waitFor();
  assert.equal(await otherEditor.inputValue(), "SECOND_WINDOW_DRAFT");
  assert.equal(systemPromptText("chat-core", 703), "FIRST_WINDOW");
  await other.getByRole("button", { name: "Discard draft and reload latest" }).click();
  await other.waitForFunction(() => document.querySelector('textarea').value === 'FIRST_WINDOW');
  await other.close();

  await page.getByRole("searchbox", { name: "Search system prompts" }).fill("Spoken conversation");
  await page.getByRole("button", { name: "Spoken conversation Voice", exact: true }).click();
  await page.getByRole("textbox", { name: "Spoken conversation system prompt" }).fill("VOICE_FROM_EDITOR");
  await page.getByRole("status").filter({ hasText: "All changes saved" }).waitFor();
  assert.equal(systemPromptText("voice-conversation", 703), "VOICE_FROM_EDITOR");
  await page.getByRole("searchbox").fill("");
  await page.getByRole("button", { name: /^Main assistant/ }).click();
  assert.equal(await editor.inputValue(), "FIRST_WINDOW");
  await page.getByRole("button", { name: "Restore default", exact: true }).click();
  await page.getByText("Using default", { exact: true }).waitFor();
  assert.equal(systemPromptText("chat-core", 703), original);
  await editor.fill("CLOSE_IMMEDIATELY");
  await page.getByRole("button", { name: "Close settings" }).click();
  await page.getByRole("button", { name: "Open settings", exact: true }).click();
  await editor.waitFor();
  assert.equal(await editor.inputValue(), "CLOSE_IMMEDIATELY");
  await page.reload();
  await editor.waitFor();
  assert.equal(await editor.inputValue(), "CLOSE_IMMEDIATELY");

  await page.getByRole("searchbox").fill("Maintenance repair");
  await page.getByRole("button", { name: /^Maintenance repair/ }).click();
  const maintenance = page.getByRole("textbox", { name: "Maintenance repair system prompt", exact: true });
  await maintenance.waitFor();
  await page.getByText(/Your first saved edit makes your account the owner/).waitFor();
  await maintenance.fill("GLOBAL_FROM_EDITOR");
  await page.getByRole("status").filter({ hasText: "All changes saved" }).waitFor();
  assert.equal(systemPromptText("maintenance-repair", null), "GLOBAL_FROM_EDITOR");
  await page.getByText(/You manage these prompts/).waitFor();
  await page.getByRole("searchbox").fill("Maintenance assistant");
  await page.getByRole("button", { name: /^Maintenance assistant Maintenance/ }).click();
  await page.getByText(/You manage these prompts/).waitFor();
  await page.getByRole("searchbox").fill("Maintenance repair");
  await page.getByRole("button", { name: /^Maintenance repair/ }).click();
  await maintenance.fill("");
  await page.getByRole("status").filter({ hasText: "All changes saved" }).waitFor();
  assert.equal(systemPromptText("maintenance-repair", null), "");
  await maintenance.fill("SHARED_WITH_OTHER_ACCOUNT");
  await page.getByRole("status").filter({ hasText: "All changes saved" }).waitFor();
  globalThis.__systemPromptsTestUserId = 704;
  await page.reload();
  await page.getByRole("searchbox").fill("Maintenance repair");
  await page.getByRole("button", { name: /^Maintenance repair/ }).click();
  assert.equal(await maintenance.inputValue(), "SHARED_WITH_OTHER_ACCOUNT");
  assert.equal(await maintenance.isEditable(), false);
  assert.equal(await page.getByRole("button", { name: "Restore default", exact: true }).isDisabled(), true);
  await page.getByText(/Managed by another account/).waitFor();
  const otherView = (await (await route.GET()).json()).prompts.find(item => item.id === "maintenance-repair");
  assert.equal((await route.PATCH(new Request("http://local/api/system-prompts", { method: "PATCH", body: JSON.stringify({ id: otherView.id, revision: otherView.revision, content: "FORGED_OTHER_OWNER" }) }))).status, 403);
  assert.equal(systemPromptText("maintenance-repair", null), "SHARED_WITH_OTHER_ACCOUNT");
  globalThis.__systemPromptsTestUserId = 703;
  await page.reload();
  await page.getByRole("searchbox").fill("Maintenance repair");
  await page.getByRole("button", { name: /^Maintenance repair/ }).click();
  assert.equal(await maintenance.isEditable(), true);

  const artifacts = path.resolve(root, "../qa/system-prompts-maintenance");
  fs.mkdirSync(artifacts, { recursive: true });
  await page.getByRole("button", { name: "Restore default", exact: true }).click();
  await page.getByText("Using default", { exact: true }).waitFor();
  await page.screenshot({ path: path.join(artifacts, "desktop-light.png") });
  await page.evaluate(() => document.documentElement.dataset.theme = "dark");
  await page.screenshot({ path: path.join(artifacts, "desktop-dark.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.documentElement.dataset.theme = "light");
  const bounds = await page.getByRole("dialog").boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.ok(await page.getByRole("tab", { name: "System", exact: true }).isVisible());
  await page.screenshot({ path: path.join(artifacts, "mobile-light.png") });
  await maintenance.scrollIntoViewIfNeeded();
  await maintenance.fill("MOBILE_INSTALLATION_EDIT");
  await page.getByRole("status").filter({ hasText: "All changes saved" }).waitFor();
  assert.equal(systemPromptText("maintenance-repair", null), "MOBILE_INSTALLATION_EDIT");
  const mobileEditor = await maintenance.boundingBox();
  assert.ok(mobileEditor.y >= bounds.y && mobileEditor.y + mobileEditor.height <= bounds.y + bounds.height);
  await page.screenshot({ path: path.join(artifacts, "mobile-editor.png") });
  await page.getByRole("button", { name: "Restore default", exact: true }).click();
  await page.getByText("Using default", { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  assert.ok(writes.length > 5);
});
