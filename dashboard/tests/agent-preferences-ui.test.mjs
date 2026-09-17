import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import esbuild from "esbuild";
import ts from "typescript";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";
import { chromium } from "playwright";
import { agentPreferencesContext, readAgentPreferences } from "../src/lib/agent-preferences/store.ts";

test("agent settings save through the real route and Markdown file, support no preference, and work on narrow screens", { timeout: 90_000 }, async (t) => {
  const root = path.resolve(import.meta.dirname, "..");
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-agent-preferences-ui-"));
  const oldData = process.env.BREADBOARD_DATA_DIR;
  const oldRepo = process.env.BREADBOARD_REPO_ROOT;
  process.env.BREADBOARD_DATA_DIR = temporary;
  process.env.BREADBOARD_REPO_ROOT = path.resolve(root, "..");
  let signedIn = true;
  globalThis.__agentPreferencesAuth = () => signedIn;
  t.after(() => {
    if (oldData === undefined) delete process.env.BREADBOARD_DATA_DIR; else process.env.BREADBOARD_DATA_DIR = oldData;
    if (oldRepo === undefined) delete process.env.BREADBOARD_REPO_ROOT; else process.env.BREADBOARD_REPO_ROOT = oldRepo;
    delete globalThis.__agentPreferencesAuth;
    fs.rmSync(temporary, { recursive: true, force: true });
  });
  const stubs = {
    "next/server": "export const NextResponse = Response;",
    "@/lib/server-auth": `export class RouteError extends Error { constructor(status, message) { super(message); this.status = status; } }
      export async function requireUserId() { if (!globalThis.__agentPreferencesAuth()) throw new RouteError(401, 'Unauthorized'); return 17; }`,
  };
  const routeBundle = await esbuild.build({
    entryPoints: [path.join(root, "src/app/api/agent-preferences/route.ts")], absWorkingDir: root,
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    plugins: [{ name: "authenticated-test-user", setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => args.path in stubs ? { path: args.path, namespace: "fixture" } : undefined);
      build.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({ contents: stubs[args.path] }));
    } }],
  });
  const routeModule = { exports: {} };
  new Function("require", "module", "exports", routeBundle.outputFiles[0].text)(createRequire(import.meta.url), routeModule, routeModule.exports);
  const route = routeModule.exports;
  signedIn = false;
  assert.equal((await route.GET()).status, 401);
  assert.equal((await route.PUT(new Request("http://localhost/api/agent-preferences", { method: "PUT", body: "{}" }))).status, 401);
  signedIn = true;
  const loaded = await (await route.GET()).json();
  assert.ok(loaded.agents.some((agent) => agent.command === "/agents:hyperframes"));
  assert.ok(loaded.agents.some((agent) => agent.command === "/agent:agent-spotify"));
  assert.ok(loaded.agents.some((agent) => agent.command.startsWith("/agents:agency-agents:")));
  assert.equal(loaded.settings.enabled, false);
  const invalid = structuredClone(loaded.settings);
  invalid.tasks[0].agents = ["/agents:made-up-agent"];
  const rejected = await route.PUT(new Request("http://localhost/api/agent-preferences", { method: "PUT", body: JSON.stringify(invalid) }));
  assert.equal(rejected.status, 400);
  assert.equal(agentPreferencesContext(17), "");

  const hubFile = path.join(root, "src/app/components/hermes/command-hub.tsx");
  const hubTree = ts.createSourceFile(hubFile, fs.readFileSync(hubFile, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let triggerJsx;
  let dialogJsx;
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(hubTree) === "button" &&
        node.openingElement.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(hubTree) === "aria-label" && attribute.initializer?.text === "Agent selection settings")) triggerJsx = node.getText(hubTree);
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(hubTree) === "AgentPreferencesDialog") dialogJsx = node.getText(hubTree);
    ts.forEachChild(node, visit);
  }
  visit(hubTree);
  assert.ok(triggerJsx && dialogJsx, "the Agents screen must wire a settings trigger to its dialog");
  const bundle = await esbuild.build({
    absWorkingDir: root, stdin: { resolveDir: root, loader: "tsx", contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import AgentPreferencesDialog from './src/app/components/hermes/agent-preferences-dialog';
      import {Settings2} from 'lucide-react';
      function App() { const [agentPreferencesOpen,setAgentPreferencesOpen] = React.useState(false); const agentPreferencesTriggerRef = React.useRef(null);
        return <><div style={{position:'relative',margin:24,maxWidth:500,height:44}}>${triggerJsx}</div>
          {agentPreferencesOpen && (${dialogJsx})}</>; }
      createRoot(document.getElementById('root')).render(<App/>);` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' },
  });
  const stylesheet = path.join(root, "src/app/globals.css");
  const cssInput = fs.readFileSync(stylesheet, "utf8").replace('@source "../**/*.{js,mjs,cjs,ts,tsx,jsx,mdx}";', '@source "./components/hermes/agent-preferences-dialog.tsx"; @source "./components/hermes/command-hub.tsx";');
  const css = (await postcss([tailwindcss({ base: root })]).process(cssInput, { from: stylesheet })).css;
  let failReads = true;
  let failWrites = false;
  const server = http.createServer(async (req, res) => {
    if (req.url === "/app.js") { res.setHeader("Content-Type", "text/javascript"); return res.end(bundle.outputFiles[0].text); }
    if (req.url === "/style.css") { res.setHeader("Content-Type", "text/css"); return res.end(css); }
    if (req.url === "/api/agent-preferences") {
      res.setHeader("Content-Type", "application/json");
      if ((req.method === "GET" && failReads) || (req.method === "PUT" && failWrites)) {
        res.statusCode = 503; return res.end(JSON.stringify({ error: "Temporarily unavailable." }));
      }
      let body = ""; for await (const chunk of req) body += chunk;
      const response = await route[req.method](new Request("http://localhost/api/agent-preferences", { method: req.method, ...(body ? { body } : {}) }));
      res.statusCode = response.status; return res.end(await response.text());
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end('<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><main id="root"></main><script src="/app.js"></script></body></html>');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  const browser = await chromium.launch({ headless: true, ...(process.platform === "win32" ? { channel: "msedge" } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const trigger = page.getByRole("button", { name: "Agent selection settings", exact: true });
  await trigger.click();
  await page.getByRole("alert").waitFor();
  const enabled = page.getByRole("switch", { name: "Use task preferences" });
  assert.equal(await enabled.isDisabled(), true);
  failReads = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page.waitForFunction(() => !document.getElementById("agent-preferences-enabled").disabled);
  assert.equal(await enabled.getAttribute("aria-checked"), "false");
  assert.equal(await page.locator("details summary").filter({ hasText: "No preference" }).count(), loaded.settings.tasks.length);

  await enabled.click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Saved." }).waitFor();
  assert.ok(readAgentPreferences(17).tasks.every((task) => task.agents.length === 0));
  assert.doesNotMatch(agentPreferencesContext(17), /Preferred agents, in order/);
  const video = page.locator("details").filter({ has: page.locator("summary").filter({ hasText: "Producing video" }) });
  await video.locator("summary").click();
  await video.getByRole("button", { name: "Choose agents", exact: true }).click();
  const search = video.getByRole("textbox", { name: "Search agents for Producing video" });
  await search.fill("HyperFrames");
  await video.getByRole("button", { name: /HyperFrames Runtime agents/ }).click();
  assert.equal(await video.getByRole("button", { name: "No preference", exact: true }).getAttribute("aria-pressed"), "false");
  await search.fill("Music Producer");
  assert.equal(await video.getByRole("button", { name: /Music Producer Runtime agents/ }).count(), 1, "all agents are available even outside the suggested task category");
  await video.getByRole("button", { name: "Close agent picker", exact: true }).click();
  failWrites = true;
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.doesNotMatch(agentPreferencesContext(17), /hyperframes/);
  failWrites = false;
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Saved." }).waitFor();
  assert.match(agentPreferencesContext(17), /\/agents:hyperframes/);
  assert.doesNotMatch(agentPreferencesContext(17), /### Creating music|### Analyzing stocks/);

  const artifacts = path.join(root, "artifacts/agent-preferences-qa");
  fs.mkdirSync(artifacts, { recursive: true });
  await page.getByRole("textbox", { name: "Filter task preferences" }).evaluate((element) => element.parentElement.parentElement.parentElement.scrollTop = 0);
  await page.screenshot({ path: path.join(artifacts, "desktop-light.png") });
  await page.evaluate(() => document.documentElement.dataset.theme = "dark");
  await page.screenshot({ path: path.join(artifacts, "desktop-dark.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.documentElement.dataset.theme = "light");
  const bounds = await page.getByRole("dialog").boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
  assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 844);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: path.join(artifacts, "mobile-light.png") });

  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Agent selection settings");
  await trigger.click();
  await page.getByRole("textbox", { name: "Filter task preferences" }).fill("producing video");
  await video.locator("summary").click();
  assert.equal(await video.getByRole("button", { name: "Remove HyperFrames", exact: true }).count(), 1);
  await video.getByRole("button", { name: "No preference", exact: true }).click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Saved." }).waitFor();
  assert.doesNotMatch(agentPreferencesContext(17), /hyperframes/);
  assert.ok(readAgentPreferences(17).tasks.every((task) => task.agents.length === 0));
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.deepEqual(errors, []);
});
